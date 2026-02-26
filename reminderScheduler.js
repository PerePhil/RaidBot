const { activeRaids, markActiveRaidUpdated, getGuildSettings } = require('./state');
const { getPresenceClient, updateBotPresence } = require('./presence');
const { buildMessageLink, formatTimeLabel } = require('./utils/raidFormatters');
const { fetchRaidMessage, closeRaidSignup, isRaidFull } = require('./utils/raidHelpers');
const { sendAuditLog } = require('./auditLog');
const { checkAndSpawnRecurringRaids } = require('./recurringManager');
const { logger } = require('./utils/logger');
const { sendDMWithBreaker, fetchWithBreaker } = require('./utils/circuitBreaker');
const { isTeamBased, getTeamTypeLabel } = require('./utils/raidTypes');

const CHECK_INTERVAL_MS = 60 * 1000;
const DM_DELAY_MS = 10 * 1000; // Deprecated: kept for compatibility
const CLOSED_RAID_RETENTION_SECONDS = 24 * 60 * 60; // 24 hours
const DM_BATCH_SIZE = 5; // Send 5 DMs in parallel
const DM_BATCH_DELAY_MS = 1200; // Wait 1.2s between batches (avoids Discord rate limits)

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
        logger.error('Initial reminder check failed', { error });
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

        // Auto-close team-based raids (key/challenge) at start time
        if (!raidData.closed && isTeamBased(raidData) && !raidData.autoCloseExecuted && secondsUntil <= 0) {
            await autoCloseTeamRaid(client, raidData, messageId);
            continue;
        }

        if (raidData.closed || secondsUntil <= 0) continue;

        let updated = false;

        if (settings.creatorRemindersEnabled && !raidData.creatorReminderSent && secondsUntil <= settings.creatorReminderSeconds) {
            logger.info('Creator reminder triggered', {
                raidId: raidData.raidId,
                secondsUntil,
                threshold: settings.creatorReminderSeconds
            });
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

    // Clean up closed raids from memory after retention period
    cleanupOldClosedRaids(now);

    // Check and spawn any due recurring raids
    try {
        await checkAndSpawnRecurringRaids(client);
    } catch (error) {
        logger.error('Failed to check recurring raids', { error });
    }
}

async function sendCreatorReminder(client, raidData, messageId) {
    try {
        const creator = await fetchWithBreaker(
            () => client.users.fetch(raidData.creatorId),
            null
        );
        if (!creator) {
            logger.warn('Could not fetch creator for reminder', {
                raidId: raidData.raidId,
                creatorId: raidData.creatorId
            });
            return;
        }

        const link = buildMessageLink(raidData, messageId);
        const when = formatTimeLabel(raidData);
        const type = raidData.template?.name || (raidData.type === 'museum' ? 'Museum Signup' : (isTeamBased(raidData) ? getTeamTypeLabel(raidData) : 'Raid'));

        const sent = await sendDMWithBreaker(creator, [
            `Reminder: your ${type} (ID: \`${raidData.raidId}\`) starts soon.`,
            `Scheduled time: ${when}`,
            link ? `Signup link: ${link}` : null
        ].filter(Boolean).join('\n'));

        if (sent) {
            logger.info('Creator reminder sent successfully', {
                raidId: raidData.raidId,
                creatorId: raidData.creatorId
            });
        } else {
            logger.warn('Creator reminder DM failed to send', {
                raidId: raidData.raidId,
                creatorId: raidData.creatorId
            });
        }
    } catch (error) {
        logger.warn('Failed to send creator reminder', { error, raidId: raidData.raidId });
    }
}

async function sendParticipantReminder(client, raidData, messageId) {
    const participantIds = collectParticipantIds(raidData);
    if (participantIds.length === 0) return;

    const link = buildMessageLink(raidData, messageId);
    const when = formatTimeLabel(raidData);
    const type = raidData.template?.name || (raidData.type === 'museum' ? 'Museum Signup' : (isTeamBased(raidData) ? getTeamTypeLabel(raidData) : 'Raid'));

    // Batch DMs for better performance (5 DMs in parallel, 1.2s delay between batches)
    // This reduces send time from ~17 min (100 users @ 10s each) to ~24s (100 users @ 5/batch)
    for (let i = 0; i < participantIds.length; i += DM_BATCH_SIZE) {
        const batch = participantIds.slice(i, i + DM_BATCH_SIZE);

        await Promise.all(batch.map(async (userId) => {
            try {
                const user = await fetchWithBreaker(
                    () => client.users.fetch(userId),
                    null
                );
                if (!user) return;

                const roleName = findUserRoleName(raidData, userId);
                await sendDMWithBreaker(user, [
                    `Reminder: ${type} (ID: \`${raidData.raidId}\`) is starting soon.`,
                    `Scheduled time: ${when}`,
                    roleName ? `Your role: **${roleName}**` : null,
                    link ? `Signup link: ${link}` : null
                ].filter(Boolean).join('\n'));
            } catch (error) {
                logger.warn('Failed to send participant reminder', { error, userId });
            }
        }));

        // Wait between batches to avoid Discord rate limits (except after the last batch)
        if (i + DM_BATCH_SIZE < participantIds.length) {
            await sleep(DM_BATCH_DELAY_MS);
        }
    }

    logger.info(`Sent reminders to ${participantIds.length} participants in ${Math.ceil(participantIds.length / DM_BATCH_SIZE)} batches`, {
        raidId: raidData.raidId,
        participantCount: participantIds.length
    });
}

function collectParticipantIds(raidData) {
    if (raidData.type === 'museum') {
        return [...raidData.signups];
    }

    if (isTeamBased(raidData) && raidData.teams) {
        const ids = new Set();
        raidData.teams.forEach(team => team.users.forEach(id => ids.add(id)));
        return Array.from(ids);
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

    if (isTeamBased(raidData) && raidData.teams) {
        for (let i = 0; i < raidData.teams.length; i++) {
            if (raidData.teams[i].users.includes(userId)) return `Team ${i + 1}`;
        }
        return null;
    }

    const role = raidData.signups.find((signupRole) => signupRole.users.includes(userId));
    return role ? role.name : null;
}

/**
 * Clean up old closed raids from activeRaids Map to prevent memory leak
 * Keeps raids in memory for 24 hours after closing to allow for queries/reopens
 * @param {number} now - Current timestamp in seconds
 */
function cleanupOldClosedRaids(now) {
    const { cleanupRaidLock } = require('./raids/reactionHandlers');
    let cleanedCount = 0;

    for (const [messageId, raidData] of activeRaids.entries()) {
        if (raidData.closed && raidData.closedAt) {
            const timeSinceClosed = now - raidData.closedAt;
            if (timeSinceClosed > CLOSED_RAID_RETENTION_SECONDS) {
                activeRaids.delete(messageId);
                cleanupRaidLock(messageId); // Belt-and-suspenders cleanup
                cleanedCount++;
            }
        }
    }

    if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} old closed raid(s) from memory`);
    }
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
        logger.error('Failed to fetch guild for auto-closing', { error, guildId });
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
 * Auto-close team-based raids (key/challenge) at start time
 */
async function autoCloseTeamRaid(client, raidData, messageId) {
    if (!raidData.guildId) return;
    if (raidData.closed) return;

    const guild = await resolveGuild(client, raidData.guildId);
    if (!guild) return;

    const message = await fetchRaidMessage(guild, raidData, messageId);
    if (!message) return;

    const signupCount = raidData.teams
        ? raidData.teams.reduce((sum, t) => sum + t.users.length, 0)
        : (raidData.signups?.length || 0);

    const isChallenge = raidData.type === 'challenge';
    const reason = isChallenge ? 'challenge_start' : 'key_start';
    const typeLabel = isChallenge ? 'Challenge Mode' : 'Gold Key Boss';

    const closed = await closeRaidSignup(message, raidData, { reason });
    if (closed) {
        raidData.autoCloseExecuted = true;
        await updateBotPresence();
        markActiveRaidUpdated(messageId);
        await sendAuditLog(guild, `${typeLabel} ${raidData.raidId || '?'} auto-locked at start time with ${signupCount} participant(s). Attendance recorded for analytics.`);
    }
}
