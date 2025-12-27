const { activeRaids, markActiveRaidUpdated, getGuildSettings } = require('./state');
const { getPresenceClient, updateBotPresence } = require('./presence');
const { buildMessageLink, formatTimeLabel } = require('./utils/raidFormatters');
const { fetchRaidMessage, closeRaidSignup, isRaidFull } = require('./utils/raidHelpers');
const { sendAuditLog } = require('./auditLog');
const { checkAndSpawnRecurringRaids } = require('./recurringManager');

const CHECK_INTERVAL_MS = 60 * 1000;
const DM_DELAY_MS = 10 * 1000;

let reminderInterval = null;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function startReminderScheduler() {
    if (reminderInterval) {
        clearInterval(reminderInterval);
    }

    reminderInterval = setInterval(runReminderCheck, CHECK_INTERVAL_MS);
    runReminderCheck().catch((error) => {
        console.error('Initial reminder check failed:', error);
    });
}

async function runReminderCheck() {
    const client = getPresenceClient();
    if (!client) return;

    const now = Math.floor(Date.now() / 1000);

    for (const [messageId, raidData] of activeRaids.entries()) {
        if (!raidData.timestamp) continue;

        const settings = getGuildSettings(raidData.guildId);
        const secondsUntil = raidData.timestamp - now;

        if (!raidData.closed && raidData.type !== 'museum' && !raidData.autoCloseExecuted &&
            settings.autoCloseSeconds > 0 &&
            secondsUntil <= settings.autoCloseSeconds && isRaidFull(raidData)) {
            await autoCloseRaid(client, raidData, messageId);
            continue;
        }

        // Auto-close museum raids at start time to lock signups and record analytics
        if (!raidData.closed && raidData.type === 'museum' && !raidData.autoCloseExecuted && secondsUntil <= 0) {
            await autoCloseMuseum(client, raidData, messageId);
            continue;
        }

        // Auto-close key boss raids at start time to lock signups and record analytics
        if (!raidData.closed && raidData.type === 'key' && !raidData.autoCloseExecuted && secondsUntil <= 0) {
            await autoCloseKey(client, raidData, messageId);
            continue;
        }

        if (raidData.closed || secondsUntil <= 0) continue;

        let updated = false;

        if (settings.creatorRemindersEnabled && !raidData.creatorReminderSent && secondsUntil <= settings.creatorReminderSeconds) {
            await sendCreatorReminder(client, raidData, messageId);
            raidData.creatorReminderSent = true;
            updated = true;
        }

        if (settings.participantRemindersEnabled && !raidData.participantReminderSent && secondsUntil <= settings.participantReminderSeconds) {
            await sendParticipantReminder(client, raidData, messageId);
            raidData.participantReminderSent = true;
            updated = true;
        }

        if (updated) {
            markActiveRaidUpdated(messageId);
        }
    }

    // Check and spawn any due recurring raids
    try {
        await checkAndSpawnRecurringRaids(client);
    } catch (error) {
        console.error('Failed to check recurring raids:', error);
    }
}

async function sendCreatorReminder(client, raidData, messageId) {
    try {
        const creator = await client.users.fetch(raidData.creatorId);
        const link = buildMessageLink(raidData, messageId);
        const when = formatTimeLabel(raidData);
        const type = raidData.template?.name || (raidData.type === 'museum' ? 'Museum Signup' : 'Raid');
        await creator.send([
            `Reminder: your ${type} (ID: \`${raidData.raidId}\`) starts soon.`,
            `Scheduled time: ${when}`,
            link ? `Signup link: ${link}` : null
        ].filter(Boolean).join('\n'));
    } catch (error) {
        console.error('Failed to send creator reminder:', error);
    }
}

async function sendParticipantReminder(client, raidData, messageId) {
    const participantIds = collectParticipantIds(raidData);
    if (participantIds.length === 0) return;

    const link = buildMessageLink(raidData, messageId);
    const when = formatTimeLabel(raidData);
    const type = raidData.template?.name || (raidData.type === 'museum' ? 'Museum Signup' : 'Raid');

    for (const userId of participantIds) {
        try {
            const user = await client.users.fetch(userId);
            const roleName = findUserRoleName(raidData, userId);
            await user.send([
                `Reminder: ${type} (ID: \`${raidData.raidId}\`) is starting soon.`,
                `Scheduled time: ${when}`,
                roleName ? `Your role: **${roleName}**` : null,
                link ? `Signup link: ${link}` : null
            ].filter(Boolean).join('\n'));
        } catch (error) {
            console.error('Failed to send participant reminder:', error);
        }
        await sleep(DM_DELAY_MS);
    }
}

function collectParticipantIds(raidData) {
    if (raidData.type === 'museum') {
        return [...raidData.signups];
    }

    const ids = new Set();
    raidData.signups.forEach((role) => {
        role.users.forEach((userId) => ids.add(userId));
    });
    return Array.from(ids);
}

function findUserRoleName(raidData, userId) {
    if (raidData.type === 'museum') {
        return null;
    }

    const role = raidData.signups.find((signupRole) => signupRole.users.includes(userId));
    return role ? role.name : null;
}

module.exports = {
    startReminderScheduler
};

async function autoCloseRaid(client, raidData, messageId) {
    if (!raidData.guildId) return;
    if (raidData.closed || !isRaidFull(raidData)) return;

    const guild = await resolveGuild(client, raidData.guildId);
    if (!guild) return;

    const message = await fetchRaidMessage(guild, raidData, messageId);
    if (!message) return;

    const closed = await closeRaidSignup(message, raidData, { reason: 'auto' });
    if (closed) {
        raidData.autoCloseExecuted = true;
        await updateBotPresence();
        markActiveRaidUpdated(messageId);
        await sendAuditLog(guild, `Raid ${raidData.raidId || '?'} auto-closed when full (${formatTimeLabel(raidData)}).`);
    }
}

async function resolveGuild(client, guildId) {
    if (!guildId) return null;
    const cached = client.guilds.cache.get(guildId);
    if (cached) {
        return cached;
    }

    try {
        return await client.guilds.fetch(guildId);
    } catch (error) {
        console.error('Failed to fetch guild for auto-closing:', error);
        return null;
    }
}

/**
 * Auto-close museum raids at start time to lock signups and record attendance analytics
 */
async function autoCloseMuseum(client, raidData, messageId) {
    if (!raidData.guildId) return;
    if (raidData.closed) return;

    const guild = await resolveGuild(client, raidData.guildId);
    if (!guild) return;

    const message = await fetchRaidMessage(guild, raidData, messageId);
    if (!message) return;

    const signupCount = raidData.signups?.length || 0;
    const closed = await closeRaidSignup(message, raidData, { reason: 'museum_start' });
    if (closed) {
        raidData.autoCloseExecuted = true;
        await updateBotPresence();
        markActiveRaidUpdated(messageId);
        await sendAuditLog(guild, `Museum ${raidData.raidId || '?'} auto-locked at start time with ${signupCount} participant(s). Attendance recorded for analytics.`);
    }
}

/**
 * Auto-close key boss raids at start time to lock signups and record attendance analytics
 */
async function autoCloseKey(client, raidData, messageId) {
    if (!raidData.guildId) return;
    if (raidData.closed) return;

    const guild = await resolveGuild(client, raidData.guildId);
    if (!guild) return;

    const message = await fetchRaidMessage(guild, raidData, messageId);
    if (!message) return;

    const signupCount = raidData.signups?.length || 0;
    const closed = await closeRaidSignup(message, raidData, { reason: 'key_start' });
    if (closed) {
        raidData.autoCloseExecuted = true;
        await updateBotPresence();
        markActiveRaidUpdated(messageId);
        await sendAuditLog(guild, `Gold Key Boss ${raidData.raidId || '?'} auto-locked at start time with ${signupCount} participant(s). Attendance recorded for analytics.`);
    }
}
