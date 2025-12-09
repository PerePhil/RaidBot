const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./utils/config');
const commands = require('./commands');
const { registerCommands } = require('./commands/registerCommands');
const {
    loadRaidChannels,
    loadMuseumChannels,
    loadGuildSettings,
    loadRaidStats,
    getAdminRoles,
    loadAdminRoles,
    getCommandRoles,
    loadCommandRoles,
    loadSignupRoles,
    saveActiveRaidState
} = require('./state');
const { reinitializeRaids } = require('./raids/reinitialize');
const { handleReactionAdd, handleReactionRemove } = require('./raids/reactionHandlers');
const { setPresenceClient, updateBotPresence } = require('./presence');
const { startReminderScheduler } = require('./reminderScheduler');
const { loadTemplateOverrides } = require('./templatesManager');
const { loadAuditChannels } = require('./auditLog');
const { loadAvailability } = require('./availabilityManager');
const { loadAnalytics } = require('./utils/analytics');
const { logger } = require('./utils/logger');

const CLIENT_ID = config.clientId;
const TOKEN = config.token;
const ALLOWED_GUILD_IDS = new Set(config.allowedGuildIds || []);
const LIMIT_TO_ALLOWED_GUILDS = ALLOWED_GUILD_IDS.size > 0;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const commandMap = new Map(commands.map((command) => [command.data.name, command]));

client.once('clientReady', async () => {
    logger.info(`Logged in as ${client.user.tag}!`);
    setPresenceClient(client);

    loadRaidChannels();
    loadMuseumChannels();
    loadGuildSettings();
    loadRaidStats();
    loadTemplateOverrides();
    loadAuditChannels();
    loadAvailability();
    loadAdminRoles();
    loadCommandRoles();
    loadSignupRoles();
    loadAnalytics();

    try {
        await enforceGuildAllowlist();
        await registerCommands(CLIENT_ID, TOKEN, commands);
        await reinitializeRaids(client);
        await updateBotPresence();
        startReminderScheduler();
    } catch (error) {
        console.error('Failed to initialize commands or raids:', error);
    }
});

const { commandCooldowns } = require('./utils/rateLimiter');
const { formatError, getErrorMessage } = require('./utils/errorMessages');

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.guildId && !isGuildAllowed(interaction.guildId)) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'This bot is restricted to IOP and cannot be used in this server.',
                ephemeral: true
            }).catch(() => { });
        }
        return;
    }

    const command = commandMap.get(interaction.commandName);
    if (!command) return;

    // Command cooldown check (skip for ping command)
    if (interaction.commandName !== 'ping' && !commandCooldowns.isAllowed(interaction.user.id)) {
        const resetMs = commandCooldowns.resetIn(interaction.user.id);
        const resetSec = Math.ceil(resetMs / 1000);
        return interaction.reply({
            content: `${getErrorMessage('RATE_LIMITED')} Try again in ${resetSec} seconds.`,
            ephemeral: true
        }).catch(() => { });
    }

    if (command.requiresManageGuild) {
        const hasManageGuild = interaction.member?.permissions.has('ManageGuild');
        const adminRoles = getAdminRoles(interaction.guildId);
        const cmdRoles = getCommandRoles(interaction.guildId, command.data.name);
        const hasAdminRole = adminRoles.size > 0 && interaction.member?.roles?.cache?.some((role) => adminRoles.has(role.id));
        const hasCommandRole = cmdRoles.size > 0 && interaction.member?.roles?.cache?.some((role) => cmdRoles.has(role.id));
        const isOwner = interaction.guild?.ownerId === interaction.user.id;
        if (!hasManageGuild && !hasAdminRole && !hasCommandRole && !isOwner) {
            return interaction.reply({
                content: getErrorMessage('MISSING_MANAGE_GUILD'),
                flags: 64
            });
        }
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(`Error executing /${interaction.commandName}:`, error);
        const userMessage = formatError(error);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
                content: userMessage
            }).catch(() => { });
        } else {
            await interaction.reply({
                content: userMessage,
                ephemeral: true
            }).catch(() => { });
        }
    }
});

client.on('messageReactionAdd', handleReactionAdd);
client.on('messageReactionRemove', handleReactionRemove);

client.on('guildCreate', async (guild) => {
    if (isGuildAllowed(guild.id)) {
        console.log(`Joined allowed guild: ${guild.name} (${guild.id})`);
        return;
    }

    console.log(`Leaving unauthorized guild: ${guild.name} (${guild.id})`);
    try {
        await guild.leave();
    } catch (error) {
        console.error('Failed to leave unauthorized guild:', error);
    }
});

client.login(TOKEN);

// Graceful shutdown handling
let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        logger.warn('Shutdown already in progress, forcing exit');
        process.exit(1);
    }

    isShuttingDown = true;
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    try {
        // Save all pending state
        logger.info('Saving active raid state...');
        saveActiveRaidState();

        // Destroy the Discord client
        logger.info('Destroying Discord client...');
        await client.destroy();

        logger.info('Graceful shutdown complete');
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown', { error });
        process.exit(1);
    }
}

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions and rejections
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error });
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', { error: reason, context: 'promise rejection' });
});

async function enforceGuildAllowlist() {
    if (!LIMIT_TO_ALLOWED_GUILDS) return;

    const unauthorizedGuilds = client.guilds.cache.filter((guild) => !isGuildAllowed(guild.id));
    for (const guild of unauthorizedGuilds.values()) {
        logger.info(`Leaving unauthorized guild: ${guild.name} (${guild.id})`);
        try {
            await guild.leave();
        } catch (error) {
            logger.error('Failed to leave unauthorized guild', { error, guildId: guild.id });
        }
    }
}

function isGuildAllowed(guildId) {
    if (!LIMIT_TO_ALLOWED_GUILDS) {
        return true;
    }
    return ALLOWED_GUILD_IDS.has(guildId);
}
