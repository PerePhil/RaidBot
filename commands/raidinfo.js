const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { activeRaids, getAdminRoles, getCommandRoles } = require('../state');
const { findRaidByIdInGuild, getRaidHistory } = require('../utils/raidHelpers');
const {
    formatRaidType,
    formatSignupCounts,
    formatTimeLabel,
    buildMessageLink,
    buildSummaryLines
} = require('../utils/raidFormatters');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('raidinfo')
        .setDescription('List active raids or view details for one raid')
        .addStringOption((option) =>
            option.setName('action')
                .setDescription('list | detail')
                .setRequired(true)
                .addChoices(
                    { name: 'list', value: 'list' },
                    { name: 'detail', value: 'detail' },
                    { name: 'export', value: 'export' },
                    { name: 'history', value: 'history' }
                ))
        .addStringOption((option) =>
            option.setName('raid_id')
                .setDescription('Raid ID shown at the bottom of the signup embed (required for detail)')
                .setRequired(false))
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('User to view history for (default: yourself)')
                .setRequired(false))
        .addIntegerOption((option) =>
            option.setName('limit')
                .setDescription('Number of raids to show in history (default: 10)')
                .setMinValue(1)
                .setMaxValue(50)
                .setRequired(false))
        .addIntegerOption((option) =>
            option.setName('days')
                .setDescription('When exporting calendar: how many days ahead (default 30)')
                .setMinValue(1)
                .setMaxValue(120)
                .setRequired(false)),
    async execute(interaction) {
        const action = interaction.options.getString('action');
        if (action === 'list') {
            return listActiveRaids(interaction);
        }
        if (action === 'detail') {
            return detailRaid(interaction);
        }
        if (action === 'export') {
            return exportCalendar(interaction);
        }
        if (action === 'history') {
            return showHistory(interaction);
        }
        return interaction.reply({
            content: 'Unsupported action.',
            flags: MessageFlags.Ephemeral
        });
    }
};

async function listActiveRaids(interaction) {
    const guildId = interaction.guild?.id;

    if (!guildId) {
        return interaction.reply({
            content: 'This command can only be used inside a server.'
        });
    }

    const guildRaids = Array.from(activeRaids.entries())
        .filter(([, raidData]) => raidData.guildId === guildId && !raidData.closed)
        .sort(([, a], [, b]) => {
            const timeA = typeof a.timestamp === 'number' ? a.timestamp : Number.MAX_SAFE_INTEGER;
            const timeB = typeof b.timestamp === 'number' ? b.timestamp : Number.MAX_SAFE_INTEGER;
            return timeA - timeB;
        });

    if (guildRaids.length === 0) {
        return interaction.reply({
            content: 'There are no active raids for this server right now.',
            flags: MessageFlags.Ephemeral
        });
    }

    const embed = new EmbedBuilder()
        .setTitle(`Active Raids (${guildRaids.length})`)
        .setDescription('Current signup posts and their status.');

    guildRaids.forEach(([messageId, raidData], index) => {
        const type = formatRaidType(raidData);
        const signups = formatSignupCounts(raidData);
        const timeInfo = formatTimeLabel(raidData);
        const fieldTitle = `${index + 1}. ${type}`;

        embed.addFields({
            name: fieldTitle,
            value: [
                `Raid ID: \`${raidData.raidId || messageId}\``,
                `Signups: ${signups}`,
                `Scheduled: ${timeInfo}`
            ].join('\n'),
            inline: false
        });
    });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function detailRaid(interaction) {
    const raidId = interaction.options.getString('raid_id');
    if (!raidId) {
        return interaction.reply({
            content: 'Please provide a Raid ID when using `action: detail`.',
            flags: MessageFlags.Ephemeral
        });
    }
    const result = findRaidByIdInGuild(interaction.guild, raidId);

    if (!result) {
        return interaction.reply({
            content: 'Raid not found. Double-check the Raid ID and try again.',
            flags: MessageFlags.Ephemeral
        });
    }

    const { messageId, raidData } = result;
    const typeLabel = formatRaidType(raidData);
    const embed = new EmbedBuilder()
        .setTitle(`${typeLabel} — ${raidData.raidId}`)
        .addFields(
            { name: 'Type', value: typeLabel, inline: true },
            { name: 'Signups', value: formatSignupCounts(raidData), inline: true },
            { name: 'Scheduled', value: formatTimeLabel(raidData), inline: true }
        )
        .setTimestamp();

    const summaryLines = await buildSummaryLines(raidData, {
        guild: interaction.guild,
        client: interaction.client
    });
    embed.addFields({
        name: '\n**Currently Signed Up:**',
        value: summaryLines.length > 0 ? summaryLines.join('\n') : 'No signups yet.',
        inline: false
    });

    const link = buildMessageLink(raidData, messageId);
    if (link) {
        embed.addFields({
            name: 'Signup Link',
            value: link,
            inline: false
        });
    }

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function exportCalendar(interaction) {
    const days = interaction.options.getInteger('days') || 30;
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now + days * 24 * 60 * 60;

    const events = Array.from(activeRaids.entries())
        .filter(([, raidData]) => raidData.guildId === interaction.guildId)
        .filter(([, raidData]) => typeof raidData.timestamp === 'number' && raidData.timestamp >= now && raidData.timestamp <= cutoff)
        .map(([messageId, raidData]) => buildEvent(messageId, raidData));

    if (events.length === 0) {
        return interaction.reply({
            content: 'No upcoming raids with a set time in this window.',
            flags: MessageFlags.Ephemeral
        });
    }

    const icsContent = buildCalendar(events);
    const attachment = new AttachmentBuilder(Buffer.from(icsContent, 'utf8'), { name: 'raids.ics' });

    return interaction.reply({
        content: `Calendar generated for the next ${days} day(s). Import this file into Google Calendar, Outlook, or iCal.`,
        files: [attachment],
        flags: MessageFlags.Ephemeral
    });
}

function buildEvent(messageId, raidData) {
    const start = new Date(raidData.timestamp * 1000);
    const durationMinutes = Math.round((parseFloat(raidData.length) || 1.5) * 60);
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    const summary = formatRaidType(raidData);
    const link = buildMessageLink(raidData, messageId);
    const description = [
        summary,
        raidData.raidId ? `Raid ID: ${raidData.raidId}` : null,
        link ? `Signup: ${link}` : null
    ].filter(Boolean).join('\n');

    return {
        uid: `${messageId}@wizbot-raids`,
        dtStamp: formatIcsDate(new Date()),
        start: formatIcsDate(start),
        end: formatIcsDate(end),
        summary: escapeText(summary),
        description: escapeText(description),
        url: escapeText(link || '')
    };
}

function buildCalendar(events) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//wizbot//raidcalendar//EN'
    ];

    events.forEach((event) => {
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${event.uid}`);
        lines.push(`DTSTAMP:${event.dtStamp}`);
        lines.push(`DTSTART:${event.start}`);
        lines.push(`DTEND:${event.end}`);
        lines.push(`SUMMARY:${event.summary}`);
        if (event.description) {
            lines.push(`DESCRIPTION:${event.description}`);
        }
        if (event.url) {
            lines.push(`URL:${event.url}`);
        }
        lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
}

function formatIcsDate(date) {
    const pad = (num) => String(num).padStart(2, '0');
    return [
        date.getUTCFullYear(),
        pad(date.getUTCMonth() + 1),
        pad(date.getUTCDate())
    ].join('') + 'T' + [
        pad(date.getUTCHours()),
        pad(date.getUTCMinutes()),
        pad(date.getUTCSeconds())
    ].join('') + 'Z';
}

function escapeText(text) {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');
}

async function showHistory(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const limit = interaction.options.getInteger('limit') || 10;
    const guildId = interaction.guildId;

    // Check if viewing another user's history (requires admin)
    if (targetUser.id !== interaction.user.id) {
        const isAdmin = interaction.memberPermissions?.has('ManageGuild');
        const adminRoles = getAdminRoles(guildId);
        const commandRoles = getCommandRoles(guildId, 'stats');
        const memberRoles = interaction.member?.roles?.cache?.map(r => r.id) || [];
        const hasAdminRole = [...adminRoles, ...commandRoles].some(r => memberRoles.includes(r));

        if (!isAdmin && !hasAdminRole) {
            return interaction.reply({
                content: 'You need admin permissions to view another user\'s raid history.',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const history = getRaidHistory(guildId, targetUser.id, limit);

    if (history.length === 0) {
        return interaction.editReply({
            content: `${targetUser.id === interaction.user.id ? 'You have' : `<@${targetUser.id}> has`} no raid history in this server.`
        });
    }

    const embed = new EmbedBuilder()
        .setTitle(`Raid History for ${targetUser.displayName || targetUser.username}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .setFooter({ text: `Showing ${history.length} most recent raids` });

    const lines = history.map((entry, index) => {
        const date = entry.timestamp
            ? `<t:${entry.timestamp}:d>`
            : entry.closedAt
                ? `<t:${entry.closedAt}:d>`
                : 'Unknown date';
        const templateName = entry.templateName || (entry.type === 'museum' ? 'Museum' : 'Raid');
        const role = entry.roleName || '-';
        return `**${index + 1}.** ${templateName} • ${role} • ${date}`;
    });

    // Split into chunks if too long
    const chunkSize = 15;
    for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize);
        embed.addFields({
            name: i === 0 ? 'Recent Raids' : '\u200b',
            value: chunk.join('\n'),
            inline: false
        });
    }

    return interaction.editReply({ embeds: [embed] });
}

