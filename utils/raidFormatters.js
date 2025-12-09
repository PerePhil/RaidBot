const { resolveUserLabel } = require('./userLabels');
const { getGuildSettings } = require('../state');

function formatRaidType(raidData) {
    if (raidData.type === 'museum') {
        return 'Museum Signup';
    }

    if (raidData.template?.name) {
        return raidData.template.name;
    }

    return 'Unknown Raid';
}

function getSignupStats(raidData) {
    if (raidData.type === 'museum') {
        const taken = raidData.signups.length;
        const capacity = raidData.maxSlots || taken;
        const waitlist = raidData.waitlist ? raidData.waitlist.length : 0;
        return { taken, capacity, waitlist };
    }

    let taken = 0;
    let capacity = 0;
    let waitlist = 0;

    raidData.signups.forEach((role) => {
        taken += (role.users || []).length;
        capacity += role.slots || 0;
        waitlist += role.waitlist ? role.waitlist.length : 0;
    });

    return { taken, capacity, waitlist };
}

function formatSignupCounts(raidData) {
    const { taken, capacity, waitlist } = getSignupStats(raidData);
    let result = capacity > 0 ? `${taken}/${capacity}` : `${taken}`;
    if (waitlist > 0) {
        result += ` (+${waitlist} waitlist)`;
    }
    return result;
}

function formatTimeLabel(raidData) {
    if (raidData.timestamp) {
        return `<t:${raidData.timestamp}:F>`;
    }

    if (raidData.datetime) {
        return raidData.datetime;
    }

    return 'Not specified';
}

function buildMessageLink(raidData, messageId) {
    if (!raidData.guildId || !raidData.channelId) {
        return null;
    }

    return `https://discord.com/channels/${raidData.guildId}/${raidData.channelId}/${messageId}`;
}

async function buildSummaryLines(raidData, options = {}) {
    const context = {
        guild: options.guild || null,
        client: options.client || null
    };
    const leaderRoleId = raidData.guildId ? getGuildSettings(raidData.guildId).raidLeaderRoleId : null;
    const labelOptions = leaderRoleId ? { leaderRoleId } : {};

    if (raidData.type === 'museum') {
        const mainLines = [];
        for (let idx = 0; idx < raidData.signups.length; idx += 1) {
            const userId = raidData.signups[idx];
            const label = await resolveUserLabel(context, userId, labelOptions);
            mainLines.push(`${idx + 1}. ${label}`);
        }

        const waitlistEntries = raidData.waitlist || [];
        if (waitlistEntries.length > 0) {
            const waitlistLines = [];
            for (let idx = 0; idx < waitlistEntries.length; idx += 1) {
                const userId = waitlistEntries[idx];
                const label = await resolveUserLabel(context, userId, labelOptions);
                waitlistLines.push(`WL ${idx + 1}. ${label}`);
            }
            return [...mainLines, 'Waitlist:', ...waitlistLines];
        }
        return mainLines;
    }

    const lines = [];
    for (const role of raidData.signups) {
        if (role.users.length > 0) {
            const resolvedUsers = [];
            for (const userId of role.users) {
                resolvedUsers.push(await resolveUserLabel(context, userId, labelOptions));
            }
            lines.push(`${role.emoji} ${role.name}: ${resolvedUsers.join(', ')}`);
        } else {
            lines.push(`${role.emoji} ${role.name}: None`);
        }

        if (role.waitlist && role.waitlist.length > 0) {
            const waitlistMentions = [];
            for (let idx = 0; idx < role.waitlist.length; idx += 1) {
                const userId = role.waitlist[idx];
                waitlistMentions.push(`${idx + 1}. ${await resolveUserLabel(context, userId, labelOptions)}`);
            }
            lines.push(` └─ Waitlist: ${waitlistMentions.join(', ')}`);
        }
    }

    return lines;
}

module.exports = {
    formatRaidType,
    formatSignupCounts,
    formatTimeLabel,
    buildMessageLink,
    getSignupStats,
    buildSummaryLines
};
