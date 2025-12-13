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
const { loadPolls, getPollByMessage, recordVote, removeVote, getIndexFromEmoji } = require('./pollManager');
const { loadAnalytics } = require('./utils/analytics');
const { logger } = require('./utils/logger');
const { close: closeDatabase } = require('./db/database');
const { loadRecurringRaids } = require('./recurringManager');

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
    loadRecurringRaids();
    loadPolls();

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
    // Handle button interactions for availability
    if (interaction.isButton() && interaction.customId === 'availability:set:button') {
        const availabilityCommand = commandMap.get('availability');
        if (availabilityCommand) {
            try {
                // Import the components we need for the modal
                const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
                const { setAvailability, getAvailability, parseTimezone } = require('./availabilityManager');

                const modal = new ModalBuilder()
                    .setCustomId('availability:set')
                    .setTitle('Set your availability')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('timezone')
                                .setLabel('Timezone')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('EST, PST, UTC-5, GMT+1, etc.')
                                .setRequired(false)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('days')
                                .setLabel('Preferred days/times')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Mon-Fri 7-10pm, Weekends 12-6pm')
                                .setRequired(false)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('roles')
                                .setLabel('Preferred roles')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Vanguard, Support, Surge, Gates, Flex')
                                .setRequired(false)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('notes')
                                .setLabel('Notes')
                                .setStyle(TextInputStyle.Paragraph)
                                .setPlaceholder('Any other scheduling notes or constraints?')
                                .setRequired(false)
                        )
                    );

                await interaction.showModal(modal);

                const submission = await interaction.awaitModalSubmit({
                    time: 120 * 1000,
                    filter: (i) => i.customId === 'availability:set' && i.user.id === interaction.user.id
                }).catch(() => null);

                if (!submission) return;

                const data = {
                    timezone: submission.fields.getTextInputValue('timezone').trim(),
                    days: submission.fields.getTextInputValue('days').trim(),
                    roles: submission.fields.getTextInputValue('roles').trim(),
                    notes: submission.fields.getTextInputValue('notes').trim()
                };
                setAvailability(interaction.guildId, interaction.user.id, data);

                // Get the saved data to show parsed windows
                const saved = getAvailability(interaction.guildId, interaction.user.id);
                let response = 'Availability saved.';

                if (saved?.windows && saved.windows.length > 0) {
                    const tzLabel = saved.timezone || 'UTC';
                    const viewerOffset = parseTimezone(saved.timezone);
                    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                    const formatMins = (mins) => {
                        const h = Math.floor(mins / 60);
                        const m = mins % 60;
                        const period = h >= 12 ? 'PM' : 'AM';
                        const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
                        return `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
                    };
                    const convertToLocal = (utcMins, offset) => {
                        if (offset === null || offset === undefined) return utcMins;
                        return (utcMins + offset + 24 * 60) % (24 * 60);
                    };
                    const windowStr = saved.windows.slice(0, 5).map(w => {
                        const localStart = convertToLocal(w.start, viewerOffset);
                        const localEnd = convertToLocal(w.end, viewerOffset);
                        return `• ${days[w.day]} ${formatMins(localStart)}-${formatMins(localEnd)}`;
                    }).join('\n');
                    response += `\n\n**Parsed time windows (${tzLabel}):**\n${windowStr}`;
                    if (saved.windows.length > 5) {
                        response += `\n_(+${saved.windows.length - 5} more)_`;
                    }
                } else if (data.days) {
                    response += '\n\n_Could not parse time windows from your input. Use formats like "Mon-Fri 7-10pm" or "Weekends evenings"._';
                }

                return submission.reply({ content: response, flags: MessageFlags.Ephemeral });
            } catch (error) {
                console.error('Error handling availability button:', error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: 'An error occurred while setting your availability.',
                        ephemeral: true
                    }).catch(() => { });
                }
            }
        }
        return;
    }

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

client.on('messageReactionAdd', async (reaction, user) => {
    // Handle poll votes
    if (!user.bot) {
        const poll = getPollByMessage(reaction.message.id);
        if (poll && !poll.closed) {
            const optionIndex = getIndexFromEmoji(reaction.emoji.name);
            if (optionIndex >= 0 && optionIndex < poll.options.length) {
                recordVote(poll.id, user.id, optionIndex);
            }
        }
    }
    // Handle raid reactions
    handleReactionAdd(reaction, user);
});

client.on('messageReactionRemove', async (reaction, user) => {
    // Handle poll vote removal
    if (!user.bot) {
        const poll = getPollByMessage(reaction.message.id);
        if (poll && !poll.closed) {
            const optionIndex = getIndexFromEmoji(reaction.emoji.name);
            if (optionIndex >= 0 && optionIndex < poll.options.length) {
                removeVote(poll.id, user.id, optionIndex);
            }
        }
    }
    // Handle raid reaction removals
    handleReactionRemove(reaction, user);
});

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

        // Close database connection
        logger.info('Closing database connection...');
        closeDatabase();

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
