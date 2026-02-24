const { activeRaids, markActiveRaidUpdated, getSignupRoles, recordUserActivity } = require('../state');
const { updateRaidEmbed, updateMuseumEmbed, updateKeyEmbed } = require('../utils/raidHelpers');
const { processWaitlistOpenings } = require('../utils/waitlistNotifications');
const { reactionLimiter } = require('../utils/rateLimiter');
const { Mutex } = require('async-mutex');
const { logger } = require('../utils/logger');
const { incrementCounter } = require('../utils/metrics');
const { sendDebugLog } = require('../auditLog');

// Per-raid mutex locks to prevent race conditions
const locks = new Map(); // messageId -> Mutex

function getLock(messageId) {
    if (!locks.has(messageId)) {
        locks.set(messageId, new Mutex());
    }
    return locks.get(messageId);
}

async function handleReactionAdd(reaction, user) {
    if (user.bot) return;

    incrementCounter('reactions_total', { action: 'add' });

    // Rate limit check (before acquiring lock to avoid blocking)
    if (!reactionLimiter.isAllowed(user.id)) {
        try {
            await reaction.users.remove(user.id);
            await safeDm(user, 'You\'re reacting too quickly. Please wait a few seconds and try again.');
        } catch (error) {
            // Ignore - user may have left or reaction already removed
        }
        return;
    }

    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            logger.error('Error fetching reaction', { error });
            // Cleanup reaction on fetch failure
            try {
                await reaction.users.remove(user.id);
                await safeDm(user, 'Your signup could not be processed. Please try again.');
            } catch (e) { /* ignore cleanup errors */ }
            return;
        }
    }

    const raidData = activeRaids.get(reaction.message.id);
    if (!raidData) return;

    // Acquire mutex lock for this specific raid
    const lock = getLock(reaction.message.id);
    const release = await lock.acquire();

    try {
        if (raidData.closed) {
            await reaction.users.remove(user.id);
            await safeDm(user, 'Signups for this raid are closed. Please contact a staff member if you need assistance.');
            sendDebugLog(reaction.message.guild, 'BLOCKED', `<@${user.id}> tried to sign up but raid \`${raidData.raidId}\` is closed`);
            return;
        }

        const allowedCheck = await isAllowed(interactionGuild(reaction), user, raidData.type);

        if (raidData.type === 'museum') {
            if (!allowedCheck.allowed) {
                await reaction.users.remove(user.id);
                await safeDm(user, await buildRestrictionMessage(reaction.guild, allowedCheck.roles, 'museum'));
                return;
            }
            await handleMuseumReactionAdd(reaction, user, raidData);
            return;
        }

        if (raidData.type === 'key') {
            if (!allowedCheck.allowed) {
                await reaction.users.remove(user.id);
                await safeDm(user, await buildRestrictionMessage(reaction.guild, allowedCheck.roles, 'key boss'));
                return;
            }
            await handleKeyReactionAdd(reaction, user, raidData);
            return;
        }

        if (!allowedCheck.allowed) {
            await reaction.users.remove(user.id);
            await safeDm(user, await buildRestrictionMessage(reaction.guild, allowedCheck.roles, 'raid'));
            sendDebugLog(reaction.message.guild, 'RESTRICTED', `<@${user.id}> lacks required role for raid signup`);
            return;
        }

        const roleIndex = raidData.signups.findIndex((r) => r.emoji === reaction.emoji.name);
        if (roleIndex === -1) return;

        const role = raidData.signups[roleIndex];
        role.waitlist = role.waitlist || [];
        const alreadySignedUp = raidData.signups.some((r) => r.users.includes(user.id));

        if (role.waitlist.includes(user.id)) {
            await safeDm(user, `You're already on the waitlist for ${role.name} in this raid.`);
            return;
        }

        if (alreadySignedUp) {
            // Remove the reaction since they can't sign up for another role
            try {
                await reaction.users.remove(user.id);
            } catch (error) {
                // Ignore - reaction may already be removed
            }
            await safeDm(user, `You're already signed up for a role in this raid! Please remove your current signup before choosing a different role.`);
            return;
        }

        if (role.users.length >= role.slots) {
            if (!role.waitlist.includes(user.id)) {
                role.waitlist.push(user.id);
                // Record activity for waitlist signup (tracks as active but not as completed raid)
                if (raidData.guildId) {
                    recordUserActivity(raidData.guildId, user.id);
                }
                sendDebugLog(reaction.message.guild, 'WAITLIST', `<@${user.id}> added to waitlist for ${role.name} (raid \`${raidData.raidId}\`)`);
            }
            await updateRaidEmbed(reaction.message, raidData);
            markActiveRaidUpdated(reaction.message.id);
            await safeDm(user, `The ${role.name} role is full. You've been added to the waitlist and will be notified when a spot opens.`);
            return;
        }

        role.users.push(user.id);
        sendDebugLog(reaction.message.guild, 'SIGNUP', `<@${user.id}> signed up for ${role.name} (raid \`${raidData.raidId}\`)`);
        await updateRaidEmbed(reaction.message, raidData);
        markActiveRaidUpdated(reaction.message.id);

        const totalSlots = raidData.signups.reduce((sum, r) => sum + r.slots, 0);
        const filledSlots = raidData.signups.reduce((sum, r) => sum + r.users.length, 0);

        if (filledSlots >= totalSlots) {
            try {
                const creator = await reaction.message.client.users.fetch(raidData.creatorId);
                await creator.send(`Your raid "${raidData.template.name}" (ID: \`${raidData.raidId}\`) is now full!`);
            } catch (error) {
                logger.warn('Could not send DM to raid creator', { error });
            }
        }
    } finally {
        release();
    }
}

async function handleReactionRemove(reaction, user) {
    if (user.bot) return;

    incrementCounter('reactions_total', { action: 'remove' });

    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            logger.error('Error fetching reaction', { error });
            return;
        }
    }

    const raidData = activeRaids.get(reaction.message.id);
    if (!raidData || raidData.closed) return;

    // Acquire mutex lock for this specific raid
    const lock = getLock(reaction.message.id);
    const release = await lock.acquire();

    try {
        if (raidData.type === 'museum') {
            await handleMuseumReactionRemove(reaction, user, raidData);
            return;
        }

        if (raidData.type === 'key') {
            await handleKeyReactionRemove(reaction, user, raidData);
            return;
        }

        const roleIndex = raidData.signups.findIndex((r) => r.emoji === reaction.emoji.name);
        if (roleIndex === -1) return;

        const role = raidData.signups[roleIndex];
        role.waitlist = role.waitlist || [];
        const userIndex = role.users.indexOf(user.id);

        if (userIndex > -1) {
            role.users.splice(userIndex, 1);
            sendDebugLog(reaction.message.guild, 'UNSIGN', `<@${user.id}> removed from ${role.name} (raid \`${raidData.raidId}\`)`);
            await processWaitlistOpenings(reaction.message.client, raidData, reaction.message.id);
            await updateRaidEmbed(reaction.message, raidData);
            markActiveRaidUpdated(reaction.message.id);
            return;
        }

        const waitlistIndex = role.waitlist.indexOf(user.id);
        if (waitlistIndex > -1) {
            role.waitlist.splice(waitlistIndex, 1);
            await updateRaidEmbed(reaction.message, raidData);
            markActiveRaidUpdated(reaction.message.id);
        }
    } finally {
        release();
    }
}

async function handleMuseumReactionAdd(reaction, user, raidData) {
    if (reaction.emoji.name !== '✅') {
        return;
    }

    if (raidData.signups.includes(user.id)) {
        return;
    }

    const maxSlots = raidData.maxSlots || 12;
    raidData.waitlist = raidData.waitlist || [];

    if (raidData.signups.length >= maxSlots) {
        if (!raidData.waitlist.includes(user.id)) {
            raidData.waitlist.push(user.id);
            // Record activity for waitlist signup (tracks as active but not as completed raid)
            if (raidData.guildId) {
                recordUserActivity(raidData.guildId, user.id);
            }
            sendDebugLog(reaction.message.guild, 'WAITLIST', `<@${user.id}> added to museum waitlist (\`${raidData.raidId}\`)`);
        }
        await updateMuseumEmbed(reaction.message, raidData);
        markActiveRaidUpdated(reaction.message.id);
        await safeDm(user, 'The museum signup is full. You have been added to the waitlist and will be notified when a spot opens.');
        return;
    }

    raidData.signups.push(user.id);
    sendDebugLog(reaction.message.guild, 'SIGNUP', `<@${user.id}> signed up for museum (\`${raidData.raidId}\`)`);
    await updateMuseumEmbed(reaction.message, raidData);
    markActiveRaidUpdated(reaction.message.id);

    if (raidData.signups.length >= maxSlots) {
        try {
            const creator = await reaction.message.client.users.fetch(raidData.creatorId);
            await creator.send(`Your Museum signup (ID: \`${raidData.raidId}\`) is now full!`);
        } catch (error) {
            console.error('Could not send DM to raid creator:', error);
        }
    }
}

async function handleMuseumReactionRemove(reaction, user, raidData) {
    if (reaction.emoji.name !== '✅') return;
    raidData.waitlist = raidData.waitlist || [];

    const signupIndex = raidData.signups.indexOf(user.id);
    if (signupIndex > -1) {
        raidData.signups.splice(signupIndex, 1);
        sendDebugLog(reaction.message.guild, 'UNSIGN', `<@${user.id}> removed from museum (\`${raidData.raidId}\`)`);

        await processWaitlistOpenings(reaction.message.client, raidData, reaction.message.id);
        await updateMuseumEmbed(reaction.message, raidData);
        markActiveRaidUpdated(reaction.message.id);
        return;
    }

    const waitlistIndex = raidData.waitlist.indexOf(user.id);
    if (waitlistIndex > -1) {
        raidData.waitlist.splice(waitlistIndex, 1);
        await updateMuseumEmbed(reaction.message, raidData);
        markActiveRaidUpdated(reaction.message.id);
    }
}

const TEAM_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

function getTeamIndex(emojiName) {
    return TEAM_EMOJIS.indexOf(emojiName);
}

function findUserTeam(raidData, userId) {
    for (let i = 0; i < raidData.teams.length; i++) {
        if (raidData.teams[i].users.includes(userId)) return i;
    }
    return -1;
}

async function handleKeyReactionAdd(reaction, user, raidData) {
    const teamIndex = getTeamIndex(reaction.emoji.name);
    if (teamIndex === -1 || teamIndex >= raidData.teams.length) return;

    const existingTeam = findUserTeam(raidData, user.id);
    if (existingTeam > -1) {
        await safeDm(user, `You're already signed up for Team ${existingTeam + 1}. Remove your reaction there first to switch teams.`);
        return;
    }

    // Also check if on any team's waitlist
    for (let i = 0; i < raidData.teams.length; i++) {
        if (raidData.teams[i].waitlist.includes(user.id)) {
            await safeDm(user, `You're already on the waitlist for Team ${i + 1}. Remove your reaction there first to switch teams.`);
            return;
        }
    }

    const team = raidData.teams[teamIndex];
    const maxPerTeam = raidData.maxPerTeam || 4;

    if (team.users.length >= maxPerTeam) {
        if (!team.waitlist.includes(user.id)) {
            team.waitlist.push(user.id);
            if (raidData.guildId) {
                recordUserActivity(raidData.guildId, user.id);
            }
            sendDebugLog(reaction.message.guild, 'WAITLIST', `<@${user.id}> added to key boss Team ${teamIndex + 1} waitlist (\`${raidData.raidId}\`)`);
        }
        await updateKeyEmbed(reaction.message, raidData);
        markActiveRaidUpdated(reaction.message.id);
        await safeDm(user, `Team ${teamIndex + 1} is full. You've been added to its waitlist and will be notified when a spot opens.`);
        return;
    }

    team.users.push(user.id);
    sendDebugLog(reaction.message.guild, 'SIGNUP', `<@${user.id}> signed up for key boss Team ${teamIndex + 1} (\`${raidData.raidId}\`)`);
    await updateKeyEmbed(reaction.message, raidData);
    markActiveRaidUpdated(reaction.message.id);

    // Notify creator when all teams are full
    const allFull = raidData.teams.every((t) => t.users.length >= maxPerTeam);
    if (allFull) {
        try {
            const creator = await reaction.message.client.users.fetch(raidData.creatorId);
            await creator.send(`Your Gold Key Boss signup (ID: \`${raidData.raidId}\`) is now full!`);
        } catch (error) {
            console.error('Could not send DM to raid creator:', error);
        }
    }
}

async function handleKeyReactionRemove(reaction, user, raidData) {
    const teamIndex = getTeamIndex(reaction.emoji.name);
    if (teamIndex === -1 || teamIndex >= raidData.teams.length) return;

    const team = raidData.teams[teamIndex];

    const signupIndex = team.users.indexOf(user.id);
    if (signupIndex > -1) {
        team.users.splice(signupIndex, 1);
        sendDebugLog(reaction.message.guild, 'UNSIGN', `<@${user.id}> removed from key boss Team ${teamIndex + 1} (\`${raidData.raidId}\`)`);

        // Promote from this team's waitlist
        await processWaitlistOpenings(reaction.message.client, raidData, reaction.message.id, { teamIndex });
        await updateKeyEmbed(reaction.message, raidData);
        markActiveRaidUpdated(reaction.message.id);
        return;
    }

    const waitlistIndex = team.waitlist.indexOf(user.id);
    if (waitlistIndex > -1) {
        team.waitlist.splice(waitlistIndex, 1);
        await updateKeyEmbed(reaction.message, raidData);
        markActiveRaidUpdated(reaction.message.id);
    }
}

/**
 * Clean up the mutex lock for a raid that has been closed
 * This prevents memory leaks from accumulating locks for historical raids
 * @param {string} messageId - The message ID of the raid
 */
function cleanupRaidLock(messageId) {
    if (locks.has(messageId)) {
        locks.delete(messageId);
    }
}

module.exports = {
    handleReactionAdd,
    handleReactionRemove,
    cleanupRaidLock
};

async function safeDm(user, content) {
    try {
        await user.send(content);
    } catch (error) {
        logger.warn('Could not send DM to user', { error });
    }
}

function interactionGuild(reaction) {
    return reaction.message?.guild || null;
}

async function isAllowed(guild, user, type) {
    if (!guild) return { allowed: true, roles: new Set() };
    const key = type === 'museum' ? `${guild.id}:museum` : guild.id;
    const allowedRoles = getSignupRoles(key);
    if (!allowedRoles || allowedRoles.size === 0) return { allowed: true, roles: allowedRoles };
    try {
        const member = await guild.members.fetch(user.id);
        if (!member) return { allowed: false, roles: allowedRoles };
        const allowed = member.roles.cache.some((role) => allowedRoles.has(role.id));
        return { allowed, roles: allowedRoles };
    } catch (error) {
        logger.warn('Failed to fetch member for signup role check', { error });
        return { allowed: true, roles: allowedRoles }; // be permissive on fetch error
    }
}

async function buildRestrictionMessage(guild, roleSet, type = 'raid') {
    const roles = Array.from(roleSet || []);
    if (roles.length === 0) {
        return `You are not allowed to sign up for this ${type}. Please contact a staff member if you believe this is a mistake.`;
    }

    const nameMap = new Map();

    if (guild) {
        try {
            // Ensure roles are fetched so names are available
            const fetched = await guild.roles.fetch();
            fetched.forEach((role) => nameMap.set(role.id, role.name));
        } catch (error) {
            logger.warn('Failed to fetch roles while building restriction message', { error });
        }
    }

    const lines = roles.map((id) => {
        const roleName = nameMap.get(id);
        return `> ${roleName || `Role ID ${id}`}`;
    });

    return [
        `You need one of these roles to sign up for this ${type}:`,
        ...lines,
        'If you need access, please reach out to a staff member.'
    ].join('\n');
}
