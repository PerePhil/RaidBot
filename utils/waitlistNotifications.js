const { formatRaidType, formatTimeLabel, buildMessageLink } = require('./raidFormatters');
const { markActiveRaidUpdated } = require('../state');

async function processWaitlistOpenings(client, raidData, messageId) {
    if (raidData.closed) return false;

    if (raidData.type === 'museum') {
        return promoteMuseumWaitlist(client, raidData, messageId);
    }

    let promoted = false;
    for (let index = 0; index < raidData.signups.length; index += 1) {
        const role = raidData.signups[index];
        role.waitlist = role.waitlist || [];

        while (role.waitlist.length > 0 && role.users.length < role.slots) {
            const userId = role.waitlist.shift();

            // Idempotency check - skip if already promoted by concurrent call
            if (role.users.includes(userId)) {
                continue;
            }

            cleanupUserAssignments(raidData, userId, role);
            role.users.push(userId);
            await dmAutoAssignment(client, raidData, messageId, userId, role, index);
            promoted = true;
        }
    }

    if (promoted) {
        markActiveRaidUpdated(messageId);
    }
    return promoted;
}

function cleanupUserAssignments(raidData, userId, assignedRole) {
    raidData.signups.forEach((role) => {
        role.waitlist = (role.waitlist || []).filter((id) => id !== userId);
        if (role !== assignedRole) {
            role.users = role.users.filter((id) => id !== userId);
        }
    });
}

async function dmAutoAssignment(client, raidData, messageId, userId, role, roleIndex) {
    const link = buildMessageLink(raidData, messageId);
    const typeLabel = formatRaidType(raidData);
    const timeLabel = formatTimeLabel(raidData);
    const positionLabel = `position ${roleIndex + 1} (${role.name})`;
    const lines = [
        `Good news! A spot opened in ${typeLabel} (ID: \`${raidData.raidId}\`).`,
        `You've been automatically assigned to ${positionLabel}.`,
        `Scheduled: ${timeLabel}`,
        link ? `Signup link: ${link}` : null,
        'If this no longer works for you, please contact a staff member.'
    ].filter(Boolean);
    await notifyUser(client, raidData, messageId, userId, lines);
}

async function promoteMuseumWaitlist(client, raidData, messageId) {
    raidData.waitlist = raidData.waitlist || [];
    if (raidData.waitlist.length === 0) return false;

    const maxSlots = raidData.maxSlots || 12;
    const available = maxSlots - raidData.signups.length;
    if (available <= 0) return false;

    let promoted = false;
    while (raidData.waitlist.length > 0 && raidData.signups.length < maxSlots) {
        const userId = raidData.waitlist.shift();
        if (!raidData.signups.includes(userId)) {
            raidData.signups.push(userId);
            await dmMuseumAssignment(client, raidData, messageId, userId);
            promoted = true;
        }
    }

    if (promoted) {
        markActiveRaidUpdated(messageId);
    }
    return promoted;
}

async function dmMuseumAssignment(client, raidData, messageId, userId) {
    const link = buildMessageLink(raidData, messageId);
    const typeLabel = formatRaidType(raidData);
    const timeLabel = formatTimeLabel(raidData);
    const lines = [
        `You're now signed up for ${typeLabel} (ID: \`${raidData.raidId}\`).`,
        `Scheduled: ${timeLabel}`,
        link ? `Signup link: ${link}` : null,
        'If you can no longer make it, please remove your reaction or tell staff.'
    ].filter(Boolean);
    await notifyUser(client, raidData, messageId, userId, lines);
}

async function notifyUser(client, raidData, messageId, userId, lines) {
    const payload = lines.join('\n');
    try {
        const user = await client.users.fetch(userId);
        await user.send(payload);
        return;
    } catch (error) {
        console.error('Could not DM user about waitlist promotion:', error);
    }

    // Fallback: post in the signup channel so they still see the notice.
    if (raidData.channelId) {
        try {
            const channel = await client.channels.fetch(raidData.channelId);
            if (channel) {
                await channel.send({
                    content: `<@${userId}> ${payload}`,
                    allowedMentions: { users: [userId] }
                });
                return;
            }
        } catch (error) {
            console.error('Failed to send fallback waitlist notice in channel:', error);
        }
    }

    // Final attempt via guild member DM if available.
    try {
        if (raidData.guildId) {
            const guild = await client.guilds.fetch(raidData.guildId);
            const member = await guild?.members.fetch(userId);
            await member?.send(payload);
        }
    } catch (error) {
        console.error('Could not deliver waitlist promotion by any path:', error);
    }
}

module.exports = {
    processWaitlistOpenings
};
