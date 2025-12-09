const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
function dataPath(filename) {
    return path.join(DATA_DIR, filename);
}

const RAID_CHANNELS_FILE = dataPath('raid_channels.json');
const MUSEUM_CHANNELS_FILE = dataPath('museum_channels.json');
const ACTIVE_RAIDS_FILE = process.env.ACTIVE_RAIDS_FILE
    ? path.resolve(process.env.ACTIVE_RAIDS_FILE)
    : dataPath('active_raids.json');
const ACTIVE_RAIDS_BACKUP_FILE = `${ACTIVE_RAIDS_FILE}.bak`;
const GUILD_SETTINGS_FILE = dataPath('guild_settings.json');
const RAID_STATS_FILE = dataPath('raid_stats.json');
const ADMIN_ROLES_FILE = dataPath('admin_roles.json');
const COMMAND_PERMISSIONS_FILE = dataPath('command_permissions.json');
const SIGNUP_ROLES_FILE = dataPath('signup_roles.json');

const activeRaids = new Map();
const raidChannels = new Map();
const museumChannels = new Map();
const guildSettings = new Map();
const raidStats = new Map();
const guildParticipation = new Map();
const adminRoles = new Map(); // guildId -> Set(roleIds)
const commandRoles = new Map(); // guildId -> Map(commandName -> Set(roleIds))
const signupRoles = new Map(); // guildId -> Set(roleIds)

function loadChannelMap(map, filePath) {
    if (!fs.existsSync(filePath)) {
        return;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    Object.entries(data).forEach(([guildId, channelId]) => {
        map.set(guildId, channelId);
    });
}

function saveChannelMap(map, filePath) {
    const payload = Object.fromEntries(map);
    safeWriteFile(filePath, JSON.stringify(payload, null, 2));
}

function loadRaidChannels() {
    loadChannelMap(raidChannels, RAID_CHANNELS_FILE);
    console.log(`Loaded ${raidChannels.size} raid channel configurations`);
}

function saveRaidChannels() {
    saveChannelMap(raidChannels, RAID_CHANNELS_FILE);
}

function loadMuseumChannels() {
    loadChannelMap(museumChannels, MUSEUM_CHANNELS_FILE);
    console.log(`Loaded ${museumChannels.size} museum channel configurations`);
}

function saveMuseumChannels() {
    saveChannelMap(museumChannels, MUSEUM_CHANNELS_FILE);
}

function loadAdminRoles() {
    adminRoles.clear();
    if (!fs.existsSync(ADMIN_ROLES_FILE)) return;
    try {
        const data = JSON.parse(fs.readFileSync(ADMIN_ROLES_FILE, 'utf8'));
        Object.entries(data).forEach(([guildId, roles]) => {
            adminRoles.set(guildId, new Set(roles));
        });
        console.log(`Loaded admin role configs for ${adminRoles.size} guilds`);
    } catch (error) {
        console.error('Failed to load admin roles:', error);
    }
}

function saveAdminRoles() {
    const payload = {};
    adminRoles.forEach((set, guildId) => {
        payload[guildId] = Array.from(set);
    });
    safeWriteFile(ADMIN_ROLES_FILE, JSON.stringify(payload, null, 2));
}

function getAdminRoles(guildId) {
    return adminRoles.get(guildId) || new Set();
}

function setAdminRoles(guildId, roleIds) {
    adminRoles.set(guildId, new Set(roleIds));
    saveAdminRoles();
}

function loadSignupRoles() {
    signupRoles.clear();
    if (!fs.existsSync(SIGNUP_ROLES_FILE)) return;
    try {
        const data = JSON.parse(fs.readFileSync(SIGNUP_ROLES_FILE, 'utf8'));
        Object.entries(data).forEach(([guildId, roles]) => signupRoles.set(guildId, new Set(roles)));
        console.log(`Loaded signup role requirements for ${signupRoles.size} guilds`);
    } catch (error) {
        console.error('Failed to load signup roles:', error);
    }
}

function saveSignupRoles() {
    const payload = {};
    signupRoles.forEach((set, guildId) => {
        payload[guildId] = Array.from(set);
    });
    safeWriteFile(SIGNUP_ROLES_FILE, JSON.stringify(payload, null, 2));
}

function getSignupRoles(guildId) {
    return signupRoles.get(guildId) || new Set();
}

function setSignupRoles(guildId, roleIds) {
    signupRoles.set(guildId, new Set(roleIds));
    saveSignupRoles();
}

function loadCommandRoles() {
    commandRoles.clear();
    if (!fs.existsSync(COMMAND_PERMISSIONS_FILE)) return;
    try {
        const data = JSON.parse(fs.readFileSync(COMMAND_PERMISSIONS_FILE, 'utf8'));
        Object.entries(data).forEach(([guildId, entries]) => {
            const map = new Map();
            Object.entries(entries).forEach(([cmd, roles]) => map.set(cmd, new Set(roles)));
            commandRoles.set(guildId, map);
        });
        console.log(`Loaded command permissions for ${commandRoles.size} guilds`);
    } catch (error) {
        console.error('Failed to load command permissions:', error);
    }
}

function saveCommandRoles() {
    const payload = {};
    for (const [guildId, map] of commandRoles.entries()) {
        payload[guildId] = {};
        for (const [cmd, roles] of map.entries()) {
            payload[guildId][cmd] = Array.from(roles);
        }
    }
    safeWriteFile(COMMAND_PERMISSIONS_FILE, JSON.stringify(payload, null, 2));
}

function getCommandRoles(guildId, commandName) {
    return commandRoles.get(guildId)?.get(commandName) || new Set();
}

function setCommandRoles(guildId, commandName, roleIds) {
    if (!commandRoles.has(guildId)) commandRoles.set(guildId, new Map());
    commandRoles.get(guildId).set(commandName, new Set(roleIds));
    saveCommandRoles();
}

function loadGuildSettings() {
    guildSettings.clear();
    if (!fs.existsSync(GUILD_SETTINGS_FILE)) {
        return;
    }
    try {
        const data = JSON.parse(fs.readFileSync(GUILD_SETTINGS_FILE, 'utf8'));
        Object.entries(data).forEach(([guildId, settings]) => {
            guildSettings.set(guildId, settings);
        });
        console.log(`Loaded settings for ${guildSettings.size} guilds`);
    } catch (error) {
        console.error('Failed to load guild settings:', error);
    }
}

function saveGuildSettings() {
    const payload = Object.fromEntries(guildSettings);
    safeWriteFile(GUILD_SETTINGS_FILE, JSON.stringify(payload, null, 2));
}

function getGuildSettings(guildId) {
    const defaults = {
        creatorReminderSeconds: 30 * 60,
        participantReminderSeconds: 10 * 60,
        autoCloseSeconds: 60 * 60,
        lastAutoCloseSeconds: 60 * 60,
        creatorRemindersEnabled: true,
        participantRemindersEnabled: true,
        raidLeaderRoleId: null
    };
    const overrides = guildSettings.get(guildId) || {};
    return { ...defaults, ...overrides };
}

function updateGuildSettings(guildId, updates) {
    const current = guildSettings.get(guildId) || {};
    guildSettings.set(guildId, { ...current, ...updates });
    saveGuildSettings();
}

function loadActiveRaidState() {
    activeRaids.clear();
    if (!fs.existsSync(ACTIVE_RAIDS_FILE)) {
        return;
    }

    try {
        const data = JSON.parse(fs.readFileSync(ACTIVE_RAIDS_FILE, 'utf8'));
        Object.entries(data).forEach(([messageId, raidData]) => {
            setActiveRaid(messageId, raidData, { persist: false });
        });
        console.log(`Loaded ${activeRaids.size} stored raid entries`);
    } catch (error) {
        console.error('Failed to load active raid state:', error);
    }
}

function saveActiveRaidState() {
    const payload = Object.fromEntries(activeRaids);
    safeWriteFile(ACTIVE_RAIDS_FILE, JSON.stringify(payload, null, 2), ACTIVE_RAIDS_BACKUP_FILE);
}

function setActiveRaid(messageId, raidData, options = {}) {
    activeRaids.set(messageId, raidData);
    if (options.persist !== false) {
        saveActiveRaidState();
    }
}

function deleteActiveRaid(messageId, options = {}) {
    const removed = activeRaids.delete(messageId);
    if (removed && options.persist !== false) {
        saveActiveRaidState();
    }
}

function markActiveRaidUpdated(messageId, options = {}) {
    if (!activeRaids.has(messageId)) {
        return;
    }
    if (options.persist !== false) {
        saveActiveRaidState();
    }
}

function safeWriteFile(filePath, contents, backupPath) {
    const directory = path.dirname(filePath);
    try {
        fs.mkdirSync(directory, { recursive: true });
    } catch (dirError) {
        console.error(`Failed to ensure directory for ${filePath}:`, dirError);
        return;
    }

    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(tempPath, contents);
        if (backupPath && fs.existsSync(filePath)) {
            try {
                fs.copyFileSync(filePath, backupPath);
            } catch (copyError) {
                if (copyError.code !== 'ENOENT') {
                    console.error('Failed to create backup file:', copyError);
                }
            }
        }
        fs.renameSync(tempPath, filePath);
    } catch (error) {
        console.error(`Failed to write file ${filePath}:`, error);
        try {
            if (error.code === 'ENOENT') {
                // Fallback: try writing directly if the temp renaming failed.
                fs.writeFileSync(filePath, contents);
            }
        } catch (fallbackError) {
            console.error(`Fallback write failed for ${filePath}:`, fallbackError);
        }
        try {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        } catch {
            // ignore cleanup errors
        }
    }
}

function loadRaidStats() {
    raidStats.clear();
    guildParticipation.clear();
    if (!fs.existsSync(RAID_STATS_FILE)) {
        return;
    }
    try {
        const data = JSON.parse(fs.readFileSync(RAID_STATS_FILE, 'utf8'));
        // Legacy shape: flat map of userId -> stats
        const globalData = data.global || data;
        Object.entries(globalData).forEach(([userId, stats]) => {
            raidStats.set(userId, stats);
        });
        const guildData = data.guild || {};
        Object.entries(guildData).forEach(([guildId, users]) => {
            const map = new Map();
            Object.entries(users).forEach(([userId, stats]) => {
                map.set(userId, stats);
            });
            guildParticipation.set(guildId, map);
        });
        console.log(`Loaded stats for ${raidStats.size} users across ${guildParticipation.size} guilds`);
    } catch (error) {
        console.error('Failed to load raid stats:', error);
    }
}

function saveRaidStats() {
    const guildObj = {};
    for (const [guildId, map] of guildParticipation.entries()) {
        guildObj[guildId] = Object.fromEntries(map);
    }
    const payload = {
        global: Object.fromEntries(raidStats),
        guild: guildObj
    };
    safeWriteFile(RAID_STATS_FILE, JSON.stringify(payload, null, 2));
}

function baseStats() {
    return {
        totalRaids: 0,
        roleCounts: {},
        templateCounts: {},
        weekdayCounts: {},
        lastUpdated: null,
        lastRaidAt: null
    };
}

function getUserStats(userId) {
    const defaults = baseStats();
    const existing = raidStats.get(userId) || {};
    return { ...defaults, ...existing };
}

function getGuildUserStats(guildId, userId) {
    const defaults = baseStats();
    const guildMap = guildParticipation.get(guildId);
    const existing = guildMap ? guildMap.get(userId) : null;
    return { ...defaults, ...(existing || {}) };
}

function recordRaidStats(raidData) {
    if (!raidData || !raidData.signups) return;
    const type = raidData.template?.name || (raidData.type === 'museum' ? 'Museum Signup' : 'Raid');
    const timestamp = raidData.timestamp ? raidData.timestamp * 1000 : null;
    const weekday = timestamp ? new Date(timestamp).getDay() : null;
    const guildId = raidData.guildId;

    const incrementUser = (userId, roleName) => {
        if (!userId) return;
        const stats = getUserStats(userId);
        stats.totalRaids += 1;
        stats.roleCounts[roleName] = (stats.roleCounts[roleName] || 0) + 1;
        stats.templateCounts[type] = (stats.templateCounts[type] || 0) + 1;
        if (weekday !== null) {
            stats.weekdayCounts[weekday] = (stats.weekdayCounts[weekday] || 0) + 1;
        }
        stats.lastUpdated = Date.now();
        stats.lastRaidAt = timestamp || Date.now();
        raidStats.set(userId, stats);

        if (guildId) {
            const guildStats = getGuildUserStats(guildId, userId);
            guildStats.totalRaids += 1;
            guildStats.roleCounts[roleName] = (guildStats.roleCounts[roleName] || 0) + 1;
            guildStats.templateCounts[type] = (guildStats.templateCounts[type] || 0) + 1;
            if (weekday !== null) {
                guildStats.weekdayCounts[weekday] = (guildStats.weekdayCounts[weekday] || 0) + 1;
            }
            guildStats.lastUpdated = Date.now();
            guildStats.lastRaidAt = timestamp || Date.now();

            if (!guildParticipation.has(guildId)) {
                guildParticipation.set(guildId, new Map());
            }
            guildParticipation.get(guildId).set(userId, guildStats);
        }
    };

    if (raidData.type === 'museum') {
        raidData.signups.forEach((userId) => incrementUser(userId, 'Museum'));
    } else {
        raidData.signups.forEach((role) => {
            role.users.forEach((userId) => incrementUser(userId, role.name));
        });
    }
    saveRaidStats();
}

module.exports = {
    activeRaids,
    raidChannels,
    museumChannels,
    guildSettings,
    raidStats,
    guildParticipation,
    adminRoles,
    signupRoles,
    loadRaidChannels,
    saveRaidChannels,
    loadMuseumChannels,
    saveMuseumChannels,
    loadAdminRoles,
    saveAdminRoles,
    getAdminRoles,
    setAdminRoles,
    loadCommandRoles,
    saveCommandRoles,
    getCommandRoles,
    setCommandRoles,
    loadSignupRoles,
    saveSignupRoles,
    getSignupRoles,
    setSignupRoles,
    loadGuildSettings,
    saveGuildSettings,
    loadActiveRaidState,
    saveActiveRaidState,
    setActiveRaid,
    deleteActiveRaid,
    markActiveRaidUpdated,
    getGuildSettings,
    updateGuildSettings,
    loadRaidStats,
    recordRaidStats,
    getUserStats,
    getGuildUserStats,
    saveRaidStats,
    safeWriteFile,
    dataPath,
    DATA_DIR
};
