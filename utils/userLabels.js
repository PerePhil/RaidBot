const labelCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function buildCacheKey(guildId, userId, extra = '') {
    const baseGuild = guildId || 'global';
    const suffix = extra ? `:${extra}` : '';
    return `${baseGuild}:${userId}${suffix}`;
}

function getCachedLabel(cacheKey) {
    if (!cacheKey) return null;
    const entry = labelCache.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
        labelCache.delete(cacheKey);
        return null;
    }
    return entry.value;
}

function storeLabel(cacheKey, label) {
    if (!cacheKey || !label) return;
    labelCache.set(cacheKey, {
        value: label,
        expiresAt: Date.now() + CACHE_TTL_MS
    });
}

async function resolveUserLabel(context, userId, options = {}) {
    if (!userId) return 'Unknown';
    const guild = context?.guild || null;
    const client = context?.client || guild?.client || null;
    const cacheSalt = [
        options.leaderRoleId ? `leader:${options.leaderRoleId}` : null,
        options.includeMention ? 'mention' : null
    ].filter(Boolean).join('|');
    const cacheKey = buildCacheKey(guild?.id, userId, cacheSalt);
    const cached = getCachedLabel(cacheKey);
    if (cached) {
        return cached;
    }

    let username = null;
    let member = null;

    if (guild) {
        try {
            member = await guild.members.fetch(userId);
            if (member?.displayName) {
                username = member.displayName;
            } else if (member?.user?.username) {
                username = member.user.username;
            }
        } catch {
            // ignore guild fetch errors
        }
    }

    if (!username && client) {
        try {
            const user = await client.users.fetch(userId);
            if (user?.username) {
                username = user.username;
            }
        } catch {
            // ignore global fetch errors
        }
    }

    if (!username) {
        username = 'Unknown';
    }

    const isRaidLeader = options.leaderRoleId && member?.roles?.cache?.has(options.leaderRoleId);
    const decoratedName = isRaidLeader ? `⭐ ${username}` : username;

    const label = options.includeMention ? `${decoratedName} (<@${userId}>)` : decoratedName;
    storeLabel(cacheKey, label);
    return label;
}

async function buildLabelsForRaid(raidData, context = {}, options = {}) {
    const userIds = new Set();

    if (raidData.type === 'museum') {
        raidData.signups.forEach((userId) => userIds.add(userId));
        (raidData.waitlist || []).forEach((userId) => userIds.add(userId));
    } else {
        raidData.signups.forEach((role) => {
            role.users.forEach((userId) => userIds.add(userId));
            (role.waitlist || []).forEach((userId) => userIds.add(userId));
        });
    }

    const labels = new Map();
    await Promise.all(Array.from(userIds).map(async (userId) => {
        const label = await resolveUserLabel(context, userId, options);
        if (label) {
            labels.set(userId, label);
        }
    }));
    return labels;
}

module.exports = {
    resolveUserLabel,
    buildLabelsForRaid
};
