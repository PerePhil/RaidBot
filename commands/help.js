const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getAdminRoles, getCommandRoles } = require('../state');

// Detailed command documentation by category
const CATEGORIES = {
    overview: {
        title: 'IOP Raids Command Reference',
        description: 'Select a category below to see detailed command help.',
        color: 0x5865F2
    },
    status: {
        title: 'Status & Info Commands',
        description: 'Commands for viewing raid information and bot status.',
        color: 0x3498db,
        commands: [
            { name: '/raidinfo action:list [days]', desc: 'List all upcoming raids. Defaults to 7 days.' },
            { name: '/raidinfo action:detail <raid_id>', desc: 'View full signup details for a specific raid.' },
            { name: '/raidinfo action:export', desc: 'Download an .ics calendar file of upcoming raids.' },
            { name: '/changelog', desc: 'View recent bot updates and new features.' },
            { name: '/stats user', desc: 'View your own participation stats, favorite roles, and attendance rate.' }
        ]
    },
    availability: {
        title: 'Availability Commands',
        description: 'Commands for recording and viewing when members are available.',
        color: 0x2ecc71,
        commands: [
            { name: '/availability set', desc: 'Open a form to set your timezone, preferred days/times, roles, and notes.' },
            { name: '/availability view [user]', desc: 'View someone\'s availability (defaults to you). Shows parsed time windows.' },
            { name: '/availability summary', desc: 'Server-wide heatmap showing when the most users are available.' },
            { name: '/availability optimal [min_users]', desc: 'Find time slots where X+ members are available.' },
            { name: '/availability check <time>', desc: 'See who is available at a specific time (e.g., "Saturday 7pm").' },
            { name: '/availability clear', desc: 'Remove your availability data from the server.' },
            { name: '/availability list', desc: 'View all members who have set availability (shows parse status).' }
        ],
        examples: [
            '**Time formats:** "Mon-Fri 7-10pm", "Weekends 6-11pm", "Everyday evenings"',
            '**Timezone formats:** EST, PST, UTC-5, GMT+1'
        ]
    },
    raids: {
        title: 'Raid Management (Admin)',
        description: 'Commands for creating and managing raid signups.',
        color: 0xe74c3c,
        adminOnly: true,
        commands: [
            { name: '/create', desc: 'Interactive flow to create a raid or museum signup. Prompts for type, time, and options.' },
            { name: '/raid <raid_id>', desc: 'Open management panel for a raid. Close, reopen, delete, or change the time.' },
            { name: '/raidsignup action:assign <raid_id> <user>', desc: 'Manually assign a user to a raid slot.' },
            { name: '/raidsignup action:remove <raid_id> <user>', desc: 'Remove a user from a raid (specify position).' },
            { name: '/raidsignup action:side <raid_id> <user>', desc: 'Set user\'s side preference (Lemuria only).' }
        ],
        examples: [
            '**Time formats:** "tomorrow 7pm", "next Friday 6:30pm", Unix timestamp',
            '**Cancel raid:** Use /raid then click Delete'
        ]
    },
    setup: {
        title: 'Server Setup (Admin)',
        description: 'Commands for configuring bot behavior in your server.',
        color: 0x9b59b6,
        adminOnly: true,
        commands: [
            { name: '/setchannel', desc: 'Interactive picker to set raid, museum, and audit log channels.' },
            { name: '/settings', desc: 'Configure reminder timing, auto-close behavior, and other server options.' },
            { name: '/templates', desc: 'Enable/disable raid templates or rename them for your server.' },
            { name: '/permissions', desc: 'Set which roles can use admin commands or sign up for raids.' }
        ]
    },
    recurring: {
        title: 'Recurring Raids (Admin)',
        description: 'Commands for automatic raid scheduling.',
        color: 0xf39c12,
        adminOnly: true,
        commands: [
            { name: '/recurring action:create', desc: 'Set up a recurring raid that spawns automatically (weekly, daily, or custom interval).' },
            { name: '/recurring action:list', desc: 'View all recurring raid schedules for this server.' },
            { name: '/recurring action:toggle id:<id>', desc: 'Enable or disable a recurring schedule.' },
            { name: '/recurring action:trigger id:<id>', desc: 'Manually spawn a raid from a recurring schedule now.' },
            { name: '/recurring action:delete id:<id>', desc: 'Delete a recurring schedule.' }
        ],
        examples: [
            '**Spawn time:** Set when the signup post appears (e.g., 24h before raid start)',
            '**Patterns:** weekly, daily, or every X hours'
        ]
    },
    stats: {
        title: 'Stats & Analytics (Admin)',
        description: 'Commands for viewing server-wide participation data.',
        color: 0x1abc9c,
        adminOnly: true,
        commands: [
            { name: '/stats server', desc: 'View top participants and total raid counts.' },
            { name: '/stats weekly [weeks_back]', desc: 'Weekly participation report with trends.' },
            { name: '/stats monthly [months_back]', desc: 'Monthly participation report with trends.' },
            { name: '/stats inactive [role]', desc: 'List members with no raid participation.' },
            { name: '/stats export', desc: 'Download all participation data as a CSV file.' },
            { name: '/availability set user:@someone', desc: 'Set availability for another user (Admin).' },
            { name: '/availability post-button', desc: 'Post a persistent "Set Availability" button for onboarding.' }
        ]
    },
    polls: {
        title: 'Polling (Admin)',
        description: 'Commands for creating time slot polls.',
        color: 0xe91e63,
        adminOnly: true,
        commands: [
            { name: '/poll create', desc: 'Create a reaction-based poll with multiple time options.' },
            { name: '/poll results <poll_id>', desc: 'View current voting breakdown with progress bars.' },
            { name: '/poll close <poll_id>', desc: 'Finalize poll and highlight the winning options.' }
        ]
    }
};

// Map command names to their permission keys
const ADMIN_COMMAND_MAPPING = {
    create: 'create',
    raid: 'raid',
    raidsignup: 'raidsignup',
    setchannel: 'setchannel',
    settings: 'settings',
    templates: 'templates',
    permissions: 'permissions',
    recurring: 'recurring',
    polls: 'poll'
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show what this bot can do and how to use each command'),
    async execute(interaction) {
        const isFullAdmin = await hasFullAdminAccess(interaction);
        const privilegedCommands = getPrivilegedCommands(interaction);

        // Initial overview embed
        const embed = buildOverviewEmbed(isFullAdmin, privilegedCommands, interaction);
        const buttons = buildButtons(isFullAdmin, privilegedCommands);

        const message = await interaction.reply({
            embeds: [embed],
            components: buttons,
            flags: MessageFlags.Ephemeral,
            fetchReply: true
        });

        // Create collector for button interactions
        const collector = message.createMessageComponentCollector({
            filter: (i) => i.user.id === interaction.user.id,
            time: 5 * 60 * 1000 // 5 minutes
        });

        collector.on('collect', async (i) => {
            const categoryKey = i.customId.replace('help:', '');

            if (categoryKey === 'overview') {
                const newEmbed = buildOverviewEmbed(isFullAdmin, privilegedCommands, interaction);
                return i.update({ embeds: [newEmbed], components: buildButtons(isFullAdmin, privilegedCommands) });
            }

            const category = CATEGORIES[categoryKey];
            if (!category) return;

            const detailEmbed = buildCategoryEmbed(category);
            const backButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('help:overview')
                    .setLabel('← Back to Overview')
                    .setStyle(ButtonStyle.Secondary)
            );

            return i.update({ embeds: [detailEmbed], components: [backButton] });
        });

        collector.on('end', async () => {
            // Disable buttons after timeout
            try {
                const disabledButtons = buildButtons(isFullAdmin, privilegedCommands).map(row => {
                    const newRow = new ActionRowBuilder();
                    newRow.addComponents(row.components.map(btn => ButtonBuilder.from(btn.toJSON()).setDisabled(true)));
                    return newRow;
                });
                await interaction.editReply({ components: disabledButtons });
            } catch { }
        });
    }
};

function buildOverviewEmbed(isFullAdmin, privilegedCommands, interaction) {
    const embed = new EmbedBuilder()
        .setTitle('IOP Raids Command Reference')
        .setColor(0x5865F2)
        .setDescription(isFullAdmin
            ? 'You have full admin access. Click a category for detailed help.'
            : 'Click a category for detailed command help.');

    // Base categories everyone sees
    embed.addFields(
        { name: '📋 Status & Info', value: 'View raids, stats, changelog', inline: true },
        { name: '📅 Availability', value: 'Set/view availability times', inline: true }
    );

    if (isFullAdmin) {
        embed.addFields(
            { name: '⚔️ Raid Management', value: 'Create & manage raids', inline: true },
            { name: '⚙️ Server Setup', value: 'Channels, settings, templates', inline: true },
            { name: '🔄 Recurring Raids', value: 'Automatic scheduling', inline: true },
            { name: '📊 Stats & Analytics', value: 'Server-wide data', inline: true },
            { name: '📝 Polling', value: 'Time slot polls', inline: true }
        );
    } else if (privilegedCommands.length > 0) {
        const rolesMention = privilegedCommands.map(p => `<@&${p.roleId}>`).join(', ');
        embed.addFields({
            name: `✨ Privileged via ${rolesMention}`,
            value: privilegedCommands.map(p => `\`/${p.command}\``).join(', '),
            inline: false
        });
    }

    embed.setFooter({ text: 'Buttons expire after 5 minutes' });
    return embed;
}

function buildCategoryEmbed(category) {
    const embed = new EmbedBuilder()
        .setTitle(category.title)
        .setDescription(category.description)
        .setColor(category.color);

    if (category.commands) {
        const commandList = category.commands
            .map(cmd => `**${cmd.name}**\n${cmd.desc}`)
            .join('\n\n');
        embed.addFields({ name: 'Commands', value: commandList });
    }

    if (category.examples) {
        embed.addFields({ name: 'Tips', value: category.examples.join('\n') });
    }

    return embed;
}

function buildButtons(isFullAdmin, privilegedCommands) {
    const rows = [];

    // Row 1: Base categories
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('help:status').setLabel('Status & Info').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('help:availability').setLabel('Availability').setStyle(ButtonStyle.Primary)
    );

    if (isFullAdmin) {
        row1.addComponents(
            new ButtonBuilder().setCustomId('help:raids').setLabel('Raid Mgmt').setStyle(ButtonStyle.Danger)
        );
    }
    rows.push(row1);

    // Row 2: More admin categories (if admin)
    if (isFullAdmin) {
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('help:setup').setLabel('Server Setup').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('help:recurring').setLabel('Recurring').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('help:stats').setLabel('Stats').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('help:polls').setLabel('Polls').setStyle(ButtonStyle.Secondary)
        );
        rows.push(row2);
    }

    return rows;
}

function getPrivilegedCommands(interaction) {
    const guildId = interaction.guildId;
    const member = interaction.member;
    const privileged = [];

    if (!member || !guildId) return privileged;

    for (const [cmdName, permKey] of Object.entries(ADMIN_COMMAND_MAPPING)) {
        const cmdRoles = getCommandRoles(guildId, permKey);
        for (const roleId of cmdRoles) {
            if (member.roles?.cache?.has(roleId)) {
                privileged.push({ command: cmdName, roleId });
                break;
            }
        }
    }

    return privileged;
}

async function hasFullAdminAccess(interaction) {
    const member = interaction.member;
    const guildId = interaction.guildId;

    if (!member || !guildId) return false;
    if (member.id === interaction.guild?.ownerId) return true;
    if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;

    const adminRoles = getAdminRoles(guildId);
    if (adminRoles.size > 0 && member.roles?.cache?.some(role => adminRoles.has(role.id))) {
        return true;
    }

    return false;
}
