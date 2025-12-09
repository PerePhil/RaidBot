const chrono = require('chrono-node');
const { EmbedBuilder, ChannelType } = require('discord.js');
const { activeRaids, raidChannels, museumChannels, recordRaidStats, getGuildSettings } = require('../state');
const { recordRaidAnalytics } = require('./analytics');
const { sendAuditLog } = require('../auditLog');
const { buildLabelsForRaid } = require('./userLabels');

async function getRaidSignupChannel(guild) {
    const configuredChannelId = raidChannels.get(guild.id);
    if (configuredChannelId) {
        const channel = await fetchChannelById(guild, configuredChannelId);
        if (channel) {
            return channel;
        }
    }

    return guild.channels.cache.find(
        (ch) => ch.type === ChannelType.GuildText &&
            (ch.name === 'raid-signups' || ch.name === 'raid signups')
    ) || null;
}

async function getMuseumSignupChannel(guild) {
    const configuredChannelId = museumChannels.get(guild.id);
    if (configuredChannelId) {
        const channel = await fetchChannelById(guild, configuredChannelId);
        if (channel) {
            return channel;
        }
    }

    const fallback = guild.channels.cache.find(
        (ch) => ch.type === ChannelType.GuildText &&
            (ch.name === 'museum-signups' || ch.name === 'museum signups')
    );

    if (fallback) {
        return fallback;
    }

    return getRaidSignupChannel(guild);
}

async function fetchChannelById(guild, channelId) {
    try {
        return await guild.channels.fetch(channelId);
    } catch (error) {
        return guild.channels.cache.get(channelId) || null;
    }
}

async function getChannelForRaid(guild, raidData) {
    if (raidData.channelId) {
        const channel = await fetchChannelById(guild, raidData.channelId);
        if (channel) {
            return channel;
        }
    }

    return raidData.type === 'museum'
        ? getMuseumSignupChannel(guild)
        : getRaidSignupChannel(guild);
}

async function fetchRaidMessage(guild, raidData, messageId) {
    const channel = await getChannelForRaid(guild, raidData);
    if (!channel) {
        return null;
    }

    try {
        return await channel.messages.fetch(messageId);
    } catch (error) {
        return null;
    }
}

function parseDateTimeToTimestamp(datetimeStr, referenceDate = new Date()) {
    try {
        if (!datetimeStr) return null;

        const trimmed = datetimeStr.trim();

        if (/^\d+$/.test(trimmed)) {
            return parseInt(trimmed, 10);
        }

        const parsedDate = chrono.parseDate(trimmed, referenceDate, { forwardDate: true });
        if (parsedDate) {
            return Math.floor(parsedDate.getTime() / 1000);
        }

        if (/^\d{4}-\d{2}-\d{2}([ T].*)?$/.test(trimmed)) {
            const isoDate = new Date(trimmed);
            if (!Number.isNaN(isoDate.getTime())) {
                return Math.floor(isoDate.getTime() / 1000);
            }
        }

        return null;
    } catch (error) {
        console.error('Error parsing datetime:', error);
        return null;
    }
}

function buildDateField(raidData) {
    const timestampLabel = raidData.timestamp ? `<t:${raidData.timestamp}:F>` : (raidData.datetime || 'Not specified');
    const lengthBadge = raidData.length ? ` \`${raidData.length} HOUR KEY\`` : '';
    return {
        name: '\n**Date + Time:**',
        value: `${timestampLabel}${lengthBadge}`,
        inline: false
    };
}

async function updateRaidEmbed(message, raidData) {
    const embed = EmbedBuilder.from(message.embeds[0]);
    const existingFields = embed.data.fields || [];
    const newFields = [];
    const groupedRoles = new Map();
    const guildSettings = raidData.guildId ? getGuildSettings(raidData.guildId) : null;
    const userLabels = await buildLabelsForRaid(
        raidData,
        { guild: message.guild, client: message.client },
        { leaderRoleId: guildSettings?.raidLeaderRoleId }
    );

    raidData.signups.forEach((role) => {
        role.waitlist = role.waitlist || [];
        if (!groupedRoles.has(role.groupName)) {
            groupedRoles.set(role.groupName, []);
        }
        groupedRoles.get(role.groupName).push(role);
    });

    newFields.push(buildDateField(raidData));

    groupedRoles.forEach((roles, groupName) => {
        const roleLines = roles.map((role) => {
            const icon = role.icon ? `${role.icon} ` : '';
            let line = `${role.emoji} ${icon}${role.name}`;
            if (role.users.length > 0) {
                const userMentions = role.users.map((userId) => {
                    const label = userLabels.get(userId) || 'Unknown';
                    const linked = `[**${label}**](https://discord.com/users/${userId})`;
                    if (role.sideAssignments && role.sideAssignments[userId]) {
                        return `${linked} - ${role.sideAssignments[userId]}`;
                    }
                    return linked;
                }).join(', ');
                line += ` - ${userMentions}`;
            }

            if (role.waitlist.length > 0) {
                const waitlistMentions = role.waitlist
                    .map((userId, idx) => {
                        const label = userLabels.get(userId) || 'Unknown';
                        return `${idx + 1}. [**${label}**](https://discord.com/users/${userId})`;
                    })
                    .join(', ');
                line += `\n> Waitlist: ${waitlistMentions}`;
            }
            return line;
        });

        newFields.push({
            name: `\n**${groupName}:**`,
            value: roleLines.join('\n'),
            inline: false
        });
    });

    const raidIdField = existingFields.find((f) => f.value && f.value.includes('Raid ID:'));
    const statusField = existingFields.find((f) => f.name === '\n**Status:**');
    if (raidIdField) {
        newFields.push(raidIdField);
    }
    if (statusField) {
        newFields.push(statusField);
    }

    embed.data.fields = newFields;
    await message.edit({ embeds: [embed] });
}

async function updateMuseumEmbed(message, raidData) {
    const embed = EmbedBuilder.from(message.embeds[0]);
    const existingFields = embed.data.fields || [];
    const guildSettings = raidData.guildId ? getGuildSettings(raidData.guildId) : null;
    const userLabels = await buildLabelsForRaid(
        raidData,
        { guild: message.guild, client: message.client },
        { leaderRoleId: guildSettings?.raidLeaderRoleId }
    );
    const signupLines = raidData.signups
        .map((userId, idx) => {
            const label = userLabels.get(userId) || 'Unknown';
            return `${idx + 1}. [**${label}**](https://discord.com/users/${userId})`;
        });
    const fieldValue = signupLines.length > 0
        ? `${signupLines.join('\n')}\n\nSlots: ${raidData.signups.length}/${raidData.maxSlots}`
        : `No signups yet.\n\nSlots: 0/${raidData.maxSlots}`;

    const raidIdField = existingFields.find((f) => f.value && f.value.includes('Raid ID:'));
    const statusField = existingFields.find((f) => f.name === '\n**Status:**');
    const dateField = {
        name: '\n**Date + Time:**',
        value: raidData.timestamp ? `<t:${raidData.timestamp}:F>` : (raidData.datetime || 'Not specified'),
        inline: false
    };
    const waitlistLines = (raidData.waitlist || [])
        .map((userId, idx) => {
            const label = userLabels.get(userId) || 'Unknown';
            return `${idx + 1}. [**${label}**](https://discord.com/users/${userId})`;
        });
    const newFields = [
        dateField,
        {
            name: '\n**Signups:**',
            value: fieldValue,
            inline: false
        }
    ];

    if (waitlistLines.length > 0) {
        newFields.push({
            name: '\n**Waitlist:**',
            value: waitlistLines.join('\n'),
            inline: false
        });
    }

    if (raidIdField) {
        newFields.push(raidIdField);
    }
    if (statusField) {
        newFields.push(statusField);
    }

    embed.data.fields = newFields;
    await message.edit({ embeds: [embed] });
}

function isRaidFull(raidData) {
    if (raidData.type === 'museum') {
        const maxSlots = raidData.maxSlots || raidData.signups.length;
        return raidData.signups.length >= maxSlots;
    }

    const totalSlots = raidData.signups.reduce((sum, role) => sum + (role.slots || 0), 0);
    if (totalSlots === 0) {
        return false;
    }
    const filledSlots = raidData.signups.reduce((sum, role) => sum + role.users.length, 0);
    return filledSlots >= totalSlots;
}

async function closeRaidSignup(message, raidData, options = {}) {
    if (!message || !message.embeds || message.embeds.length === 0) {
        return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const closedByUserId = options.closedByUserId || null;
    const reason = options.reason || (closedByUserId ? 'manual' : 'auto');
    const embed = EmbedBuilder.from(message.embeds[0]);

    const statusField = {
        name: '\n**Status:**',
        value: closedByUserId
            ? `Closed by <@${closedByUserId}> on <t:${now}:F>`
            : `Closed automatically on <t:${now}:F>`
    };

    embed.data.fields = embed.data.fields || [];
    const existingStatusIndex = embed.data.fields.findIndex((field) => field.name === statusField.name);
    if (existingStatusIndex >= 0) {
        embed.data.fields[existingStatusIndex] = statusField;
    } else {
        embed.addFields(statusField);
    }

    const currentDescription = embed.data.description || '';
    const closedMarker = '**Signups Closed**';
    if (!currentDescription.toLowerCase().includes(closedMarker.toLowerCase())) {
        const separator = currentDescription.length > 0 ? '\n\n' : '';
        embed.setDescription(`${currentDescription}${separator}${closedMarker}`);
    }

    try {
        await message.edit({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (error) {
        console.error('Failed to edit raid embed while closing:', error);
        return false;
    }

    try {
        await message.reactions.removeAll();
    } catch (error) {
        console.error('Failed to remove reactions when closing raid:', error);
    }

    raidData.closed = true;
    raidData.closedBy = closedByUserId;
    raidData.closedAt = now;
    raidData.closedReason = reason;
    if (!raidData.statsRecorded) {
        recordRaidStats(raidData);
        recordRaidAnalytics(raidData);  // Option B: all signups counted as attended
        raidData.statsRecorded = true;
    }

    return true;
}

async function reopenRaidSignup(message, raidData, options = {}) {
    if (!raidData.closed) {
        return false;
    }

    if (!message || !message.embeds || message.embeds.length === 0) {
        return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const reopenedByUserId = options.reopenedByUserId || null;
    const embed = EmbedBuilder.from(message.embeds[0]);
    const description = embed.data.description || '';
    const closedRegex = /\n*\*\*Signups Closed\*\*/gi;
    const cleanedDescription = description.replace(closedRegex, '').trimEnd();
    if (cleanedDescription !== description) {
        embed.setDescription(cleanedDescription);
    }

    const statusField = {
        name: '\n**Status:**',
        value: reopenedByUserId
            ? `Reopened by <@${reopenedByUserId}> on <t:${now}:F>`
            : `Reopened on <t:${now}:F>`
    };

    embed.data.fields = embed.data.fields || [];
    const existingStatusIndex = embed.data.fields.findIndex((field) => field.name === statusField.name);
    if (existingStatusIndex >= 0) {
        embed.data.fields[existingStatusIndex] = statusField;
    } else {
        embed.addFields(statusField);
    }

    try {
        await message.edit({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (error) {
        console.error('Failed to edit raid embed while reopening:', error);
        return false;
    }

    await restoreSignupReactions(message, raidData);

    raidData.closed = false;
    delete raidData.closedBy;
    delete raidData.closedReason;
    delete raidData.closedAt;
    delete raidData.autoCloseExecuted;

    return true;
}

async function restoreSignupReactions(message, raidData) {
    const emojis = new Set();

    if (raidData.type === 'museum') {
        emojis.add('✅');
    } else {
        raidData.signups.forEach((role) => {
            if (role.emoji) {
                emojis.add(role.emoji);
            }
        });
    }

    for (const emoji of emojis) {
        try {
            const existing = message.reactions.cache.find((reaction) => reaction.emoji.name === emoji);
            if (existing?.me) {
                continue;
            }
            await message.react(emoji);
        } catch (error) {
            console.error('Failed to add signup reaction when reopening raid:', error);
        }
    }
}

function findRaidByIdInGuild(guild, raidId) {
    for (const [messageId, raidData] of activeRaids.entries()) {
        if (raidData.raidId !== raidId) continue;
        if (!raidData.guildId || raidData.guildId === guild.id) {
            return { messageId, raidData };
        }
    }
    return null;
}

module.exports = {
    getRaidSignupChannel,
    getMuseumSignupChannel,
    getChannelForRaid,
    fetchRaidMessage,
    parseDateTimeToTimestamp,
    updateRaidEmbed,
    updateMuseumEmbed,
    findRaidByIdInGuild,
    closeRaidSignup,
    reopenRaidSignup,
    isRaidFull
};
