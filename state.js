const fs = require('fs');
const path = require('path');
const { db, prepare, transaction, initializeSchema } = require('./db/database');

const DATA_DIR = path.join(__dirname, 'data');
function dataPath(filename) {
    return path.join(DATA_DIR, filename);
}

// In-memory caches (for fast access)
const activeRaids = new Map();
const raidChannels = new Map();
const museumChannels = new Map();
const guildSettings = new Map();
const raidStats = new Map();
const guildParticipation = new Map();
const adminRoles = new Map(); // guildId -> Set(roleIds)
const commandRoles = new Map(); // guildId -> Map(commandName -> Set(roleIds))
const signupRoles = new Map(); // guildId -> Set(roleIds)

// Prepared statements (lazily initialized)
let statements = null;

function getStatements() {
    if (statements) return statements;

    statements = {
        // Guilds
        getGuild: prepare('SELECT * FROM guilds WHERE id = ?'),
        upsertGuild: prepare(`
            INSERT INTO guilds (id, raid_channel_id, museum_channel_id, audit_channel_id,
                creator_reminder_seconds, participant_reminder_seconds, auto_close_seconds,
                last_auto_close_seconds, creator_reminders_enabled, participant_reminders_enabled,
                raid_leader_role_id)
            VALUES (@id, @raid_channel_id, @museum_channel_id, @audit_channel_id,
                @creator_reminder_seconds, @participant_reminder_seconds, @auto_close_seconds,
                @last_auto_close_seconds, @creator_reminders_enabled, @participant_reminders_enabled,
                @raid_leader_role_id)
            ON CONFLICT(id) DO UPDATE SET
                raid_channel_id = excluded.raid_channel_id,
                museum_channel_id = excluded.museum_channel_id,
                audit_channel_id = excluded.audit_channel_id,
                creator_reminder_seconds = excluded.creator_reminder_seconds,
                participant_reminder_seconds = excluded.participant_reminder_seconds,
                auto_close_seconds = excluded.auto_close_seconds,
                last_auto_close_seconds = excluded.last_auto_close_seconds,
                creator_reminders_enabled = excluded.creator_reminders_enabled,
                participant_reminders_enabled = excluded.participant_reminders_enabled,
                raid_leader_role_id = excluded.raid_leader_role_id
        `),
        updateGuildChannel: prepare('UPDATE guilds SET raid_channel_id = ? WHERE id = ?'),
        updateMuseumChannel: prepare('UPDATE guilds SET museum_channel_id = ? WHERE id = ?'),

        // Raids
        getRaid: prepare('SELECT * FROM raids WHERE message_id = ?'),
        getAllRaids: prepare('SELECT * FROM raids WHERE closed_at IS NULL'),
        insertRaid: prepare(`
            INSERT INTO raids (message_id, raid_id, guild_id, channel_id, type,
                template_slug, template_data, datetime, timestamp, length, strategy,
                creator_id, max_slots, recurring_id, creator_reminder_sent, participant_reminder_sent)
            VALUES (@message_id, @raid_id, @guild_id, @channel_id, @type,
                @template_slug, @template_data, @datetime, @timestamp, @length, @strategy,
                @creator_id, @max_slots, @recurring_id, @creator_reminder_sent, @participant_reminder_sent)
        `),
        updateRaid: prepare(`
            UPDATE raids SET
                creator_reminder_sent = @creator_reminder_sent,
                participant_reminder_sent = @participant_reminder_sent
            WHERE message_id = @message_id
        `),
        deleteRaid: prepare('DELETE FROM raids WHERE message_id = ?'),
        closeRaid: prepare('UPDATE raids SET closed_at = unixepoch() WHERE message_id = ?'),

        // Signups
        getSignups: prepare('SELECT * FROM signups WHERE message_id = ? ORDER BY slot_index'),
        insertSignup: prepare(`
            INSERT INTO signups (message_id, user_id, role_name, role_emoji, role_icon,
                group_name, slot_index, slots, is_waitlist, side_assignment)
            VALUES (@message_id, @user_id, @role_name, @role_emoji, @role_icon,
                @group_name, @slot_index, @slots, @is_waitlist, @side_assignment)
        `),
        deleteSignup: prepare('DELETE FROM signups WHERE message_id = ? AND user_id = ? AND role_name = ?'),
        deleteRaidSignups: prepare('DELETE FROM signups WHERE message_id = ?'),
        updateSideAssignment: prepare('UPDATE signups SET side_assignment = ? WHERE message_id = ? AND user_id = ? AND role_name = ?'),

        // Museum waitlist
        getMuseumWaitlist: prepare('SELECT * FROM museum_waitlist WHERE message_id = ? ORDER BY position'),
        insertMuseumWaitlist: prepare('INSERT OR REPLACE INTO museum_waitlist (message_id, user_id, position) VALUES (?, ?, ?)'),
        deleteMuseumWaitlist: prepare('DELETE FROM museum_waitlist WHERE message_id = ? AND user_id = ?'),

        // User stats
        getUserStats: prepare('SELECT * FROM user_stats WHERE user_id = ?'),
        upsertUserStats: prepare(`
            INSERT INTO user_stats (user_id, total_raids, role_counts, template_counts,
                weekday_counts, last_updated, last_raid_at)
            VALUES (@user_id, @total_raids, @role_counts, @template_counts,
                @weekday_counts, @last_updated, @last_raid_at)
            ON CONFLICT(user_id) DO UPDATE SET
                total_raids = excluded.total_raids,
                role_counts = excluded.role_counts,
                template_counts = excluded.template_counts,
                weekday_counts = excluded.weekday_counts,
                last_updated = excluded.last_updated,
                last_raid_at = excluded.last_raid_at
        `),

        // Guild user stats
        getGuildUserStats: prepare('SELECT * FROM guild_user_stats WHERE guild_id = ? AND user_id = ?'),
        getAllGuildStats: prepare('SELECT * FROM guild_user_stats WHERE guild_id = ?'),
        upsertGuildUserStats: prepare(`
            INSERT INTO guild_user_stats (guild_id, user_id, total_raids, role_counts,
                template_counts, weekday_counts, last_updated, last_raid_at)
            VALUES (@guild_id, @user_id, @total_raids, @role_counts,
                @template_counts, @weekday_counts, @last_updated, @last_raid_at)
            ON CONFLICT(guild_id, user_id) DO UPDATE SET
                total_raids = excluded.total_raids,
                role_counts = excluded.role_counts,
                template_counts = excluded.template_counts,
                weekday_counts = excluded.weekday_counts,
                last_updated = excluded.last_updated,
                last_raid_at = excluded.last_raid_at
        `),

        // Admin roles
        getAdminRoles: prepare('SELECT role_id FROM admin_roles WHERE guild_id = ?'),
        insertAdminRole: prepare('INSERT OR IGNORE INTO admin_roles (guild_id, role_id) VALUES (?, ?)'),
        deleteAdminRoles: prepare('DELETE FROM admin_roles WHERE guild_id = ?'),

        // Command permissions
        getCommandRoles: prepare('SELECT role_id FROM command_permissions WHERE guild_id = ? AND command_name = ?'),
        insertCommandRole: prepare('INSERT OR IGNORE INTO command_permissions (guild_id, command_name, role_id) VALUES (?, ?, ?)'),
        deleteCommandRoles: prepare('DELETE FROM command_permissions WHERE guild_id = ? AND command_name = ?'),

        // Signup roles
        getSignupRoles: prepare('SELECT role_id FROM signup_roles WHERE guild_id = ?'),
        insertSignupRole: prepare('INSERT OR IGNORE INTO signup_roles (guild_id, role_id) VALUES (?, ?)'),
        deleteSignupRoles: prepare('DELETE FROM signup_roles WHERE guild_id = ?'),

        // Ensure guild exists
        ensureGuild: prepare('INSERT OR IGNORE INTO guilds (id) VALUES (?)')
    };

    return statements;
}

// Initialize database on first load
try {
    initializeSchema();
} catch (error) {
    console.error('Failed to initialize database schema:', error);
}

// ===== RAID CHANNELS =====

function loadRaidChannels() {
    raidChannels.clear();
    const rows = prepare('SELECT id, raid_channel_id FROM guilds WHERE raid_channel_id IS NOT NULL').all();
    rows.forEach(row => raidChannels.set(row.id, row.raid_channel_id));
    console.log(`Loaded ${raidChannels.size} raid channel configurations`);
}

function saveRaidChannels() {
    // No-op: changes are persisted immediately
}

function setRaidChannel(guildId, channelId) {
    const stmts = getStatements();
    stmts.ensureGuild.run(guildId);
    stmts.updateGuildChannel.run(channelId, guildId);
    if (channelId) {
        raidChannels.set(guildId, channelId);
    } else {
        raidChannels.delete(guildId);
    }
}

// ===== MUSEUM CHANNELS =====

function loadMuseumChannels() {
    museumChannels.clear();
    const rows = prepare('SELECT id, museum_channel_id FROM guilds WHERE museum_channel_id IS NOT NULL').all();
    rows.forEach(row => museumChannels.set(row.id, row.museum_channel_id));
    console.log(`Loaded ${museumChannels.size} museum channel configurations`);
}

function saveMuseumChannels() {
    // No-op: changes are persisted immediately
}

function setMuseumChannel(guildId, channelId) {
    const stmts = getStatements();
    stmts.ensureGuild.run(guildId);
    stmts.updateMuseumChannel.run(channelId, guildId);
    if (channelId) {
        museumChannels.set(guildId, channelId);
    } else {
        museumChannels.delete(guildId);
    }
}

// ===== ADMIN ROLES =====

function loadAdminRoles() {
    adminRoles.clear();
    const rows = prepare('SELECT guild_id, role_id FROM admin_roles').all();
    rows.forEach(row => {
        if (!adminRoles.has(row.guild_id)) {
            adminRoles.set(row.guild_id, new Set());
        }
        adminRoles.get(row.guild_id).add(row.role_id);
    });
    console.log(`Loaded admin role configs for ${adminRoles.size} guilds`);
}

function saveAdminRoles() {
    // No-op: changes are persisted immediately
}

function getAdminRoles(guildId) {
    return adminRoles.get(guildId) || new Set();
}

function setAdminRoles(guildId, roleIds) {
    const stmts = getStatements();
    const roleSet = new Set(roleIds);

    transaction(() => {
        stmts.ensureGuild.run(guildId);
        stmts.deleteAdminRoles.run(guildId);
        for (const roleId of roleSet) {
            stmts.insertAdminRole.run(guildId, roleId);
        }
    })();

    adminRoles.set(guildId, roleSet);
}

// ===== SIGNUP ROLES =====

function loadSignupRoles() {
    signupRoles.clear();
    const rows = prepare('SELECT guild_id, role_id FROM signup_roles').all();
    rows.forEach(row => {
        if (!signupRoles.has(row.guild_id)) {
            signupRoles.set(row.guild_id, new Set());
        }
        signupRoles.get(row.guild_id).add(row.role_id);
    });
    console.log(`Loaded signup role requirements for ${signupRoles.size} guilds`);
}

function saveSignupRoles() {
    // No-op: changes are persisted immediately
}

function getSignupRoles(guildId) {
    return signupRoles.get(guildId) || new Set();
}

function setSignupRoles(guildId, roleIds) {
    const stmts = getStatements();
    const roleSet = new Set(roleIds);

    transaction(() => {
        stmts.ensureGuild.run(guildId);
        stmts.deleteSignupRoles.run(guildId);
        for (const roleId of roleSet) {
            stmts.insertSignupRole.run(guildId, roleId);
        }
    })();

    signupRoles.set(guildId, roleSet);
}

// ===== COMMAND ROLES =====

function loadCommandRoles() {
    commandRoles.clear();
    const rows = prepare('SELECT guild_id, command_name, role_id FROM command_permissions').all();
    rows.forEach(row => {
        if (!commandRoles.has(row.guild_id)) {
            commandRoles.set(row.guild_id, new Map());
        }
        const guildMap = commandRoles.get(row.guild_id);
        if (!guildMap.has(row.command_name)) {
            guildMap.set(row.command_name, new Set());
        }
        guildMap.get(row.command_name).add(row.role_id);
    });
    console.log(`Loaded command permissions for ${commandRoles.size} guilds`);
}

function saveCommandRoles() {
    // No-op: changes are persisted immediately
}

function getCommandRoles(guildId, commandName) {
    return commandRoles.get(guildId)?.get(commandName) || new Set();
}

function setCommandRoles(guildId, commandName, roleIds) {
    const stmts = getStatements();
    const roleSet = new Set(roleIds);

    transaction(() => {
        stmts.ensureGuild.run(guildId);
        stmts.deleteCommandRoles.run(guildId, commandName);
        for (const roleId of roleSet) {
            stmts.insertCommandRole.run(guildId, commandName, roleId);
        }
    })();

    if (!commandRoles.has(guildId)) {
        commandRoles.set(guildId, new Map());
    }
    commandRoles.get(guildId).set(commandName, roleSet);
}

// ===== GUILD SETTINGS =====

function loadGuildSettings() {
    guildSettings.clear();
    const rows = prepare('SELECT * FROM guilds').all();
    rows.forEach(row => {
        guildSettings.set(row.id, {
            creatorReminderSeconds: row.creator_reminder_seconds,
            participantReminderSeconds: row.participant_reminder_seconds,
            autoCloseSeconds: row.auto_close_seconds,
            lastAutoCloseSeconds: row.last_auto_close_seconds,
            creatorRemindersEnabled: row.creator_reminders_enabled === 1,
            participantRemindersEnabled: row.participant_reminders_enabled === 1,
            raidLeaderRoleId: row.raid_leader_role_id
        });
    });
    console.log(`Loaded settings for ${guildSettings.size} guilds`);
}

function saveGuildSettings() {
    // No-op: changes are persisted immediately
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
    const current = getGuildSettings(guildId);
    const newSettings = { ...current, ...updates };

    const stmts = getStatements();
    const row = stmts.getGuild.get(guildId);

    stmts.upsertGuild.run({
        id: guildId,
        raid_channel_id: row?.raid_channel_id || raidChannels.get(guildId) || null,
        museum_channel_id: row?.museum_channel_id || museumChannels.get(guildId) || null,
        audit_channel_id: row?.audit_channel_id || null,
        creator_reminder_seconds: newSettings.creatorReminderSeconds,
        participant_reminder_seconds: newSettings.participantReminderSeconds,
        auto_close_seconds: newSettings.autoCloseSeconds,
        last_auto_close_seconds: newSettings.lastAutoCloseSeconds,
        creator_reminders_enabled: newSettings.creatorRemindersEnabled ? 1 : 0,
        participant_reminders_enabled: newSettings.participantRemindersEnabled ? 1 : 0,
        raid_leader_role_id: newSettings.raidLeaderRoleId
    });

    guildSettings.set(guildId, newSettings);
}

// ===== ACTIVE RAIDS =====

function loadActiveRaidState() {
    activeRaids.clear();
    const stmts = getStatements();
    const raids = stmts.getAllRaids.all();

    for (const raid of raids) {
        const signups = stmts.getSignups.all(raid.message_id);
        const raidData = reconstructRaidData(raid, signups);
        activeRaids.set(raid.message_id, raidData);
    }
    console.log(`Loaded ${activeRaids.size} stored raid entries`);
}

function reconstructRaidData(raid, signups) {
    const isMuseum = raid.type === 'museum';

    const raidData = {
        raidId: raid.raid_id,
        type: raid.type,
        datetime: raid.datetime,
        timestamp: raid.timestamp,
        creatorId: raid.creator_id,
        guildId: raid.guild_id,
        channelId: raid.channel_id,
        recurringId: raid.recurring_id || null,
        creatorReminderSent: raid.creator_reminder_sent === 1,
        participantReminderSent: raid.participant_reminder_sent === 1
    };

    if (isMuseum) {
        raidData.maxSlots = raid.max_slots || 12;
        raidData.signups = signups.filter(s => !s.is_waitlist).map(s => s.user_id);
        // Load museum waitlist
        const stmts = getStatements();
        const waitlist = stmts.getMuseumWaitlist.all(raid.message_id);
        raidData.waitlist = waitlist.map(w => w.user_id);
    } else {
        raidData.template = raid.template_data ? JSON.parse(raid.template_data) : null;
        raidData.length = raid.length;
        raidData.strategy = raid.strategy;

        // Reconstruct role-based signups
        const roleMap = new Map();
        for (const signup of signups) {
            const key = signup.role_name;
            if (!roleMap.has(key)) {
                roleMap.set(key, {
                    emoji: signup.role_emoji,
                    icon: signup.role_icon,
                    name: signup.role_name,
                    slots: signup.slots,
                    users: [],
                    groupName: signup.group_name,
                    sideAssignments: {},
                    waitlist: []
                });
            }
            const role = roleMap.get(key);
            if (signup.is_waitlist) {
                role.waitlist.push(signup.user_id);
            } else {
                role.users.push(signup.user_id);
                if (signup.side_assignment) {
                    role.sideAssignments[signup.user_id] = signup.side_assignment;
                }
            }
        }
        raidData.signups = Array.from(roleMap.values());
    }

    return raidData;
}

function saveActiveRaidState() {
    // No-op: changes are persisted immediately
}

function setActiveRaid(messageId, raidData, options = {}) {
    const stmts = getStatements();

    // Ensure guild exists (only if guildId is provided)
    if (raidData.guildId) {
        stmts.ensureGuild.run(raidData.guildId);
    }

    // Check if raid already exists
    const existing = stmts.getRaid.get(messageId);

    if (!existing) {
        // Insert new raid
        stmts.insertRaid.run({
            message_id: messageId,
            raid_id: raidData.raidId,
            guild_id: raidData.guildId,
            channel_id: raidData.channelId,
            type: raidData.type || 'raid',
            template_slug: raidData.template?.slug || null,
            template_data: raidData.template ? JSON.stringify(raidData.template) : null,
            datetime: raidData.datetime || null,
            timestamp: raidData.timestamp || null,
            length: raidData.length || null,
            strategy: raidData.strategy || null,
            creator_id: raidData.creatorId,
            max_slots: raidData.maxSlots || null,
            recurring_id: raidData.recurringId || null,
            creator_reminder_sent: raidData.creatorReminderSent ? 1 : 0,
            participant_reminder_sent: raidData.participantReminderSent ? 1 : 0
        });
    }

    // Sync signups to database
    syncSignupsToDb(messageId, raidData);

    // Update in-memory cache
    activeRaids.set(messageId, raidData);
}

function syncSignupsToDb(messageId, raidData) {
    const stmts = getStatements();

    transaction(() => {
        // Delete existing signups for this raid
        stmts.deleteRaidSignups.run(messageId);

        if (raidData.type === 'museum') {
            // Museum signups
            if (Array.isArray(raidData.signups)) {
                raidData.signups.forEach((userId, index) => {
                    stmts.insertSignup.run({
                        message_id: messageId,
                        user_id: userId,
                        role_name: 'Museum',
                        role_emoji: '✅',
                        role_icon: null,
                        group_name: null,
                        slot_index: index,
                        slots: 1,
                        is_waitlist: 0,
                        side_assignment: null
                    });
                });
            }
            // Museum waitlist
            if (Array.isArray(raidData.waitlist)) {
                prepare('DELETE FROM museum_waitlist WHERE message_id = ?').run(messageId);
                raidData.waitlist.forEach((userId, index) => {
                    stmts.insertMuseumWaitlist.run(messageId, userId, index);
                });
            }
        } else {
            // Regular raid signups
            if (Array.isArray(raidData.signups)) {
                raidData.signups.forEach((role, roleIndex) => {
                    if (Array.isArray(role.users)) {
                        role.users.forEach((userId, userIndex) => {
                            stmts.insertSignup.run({
                                message_id: messageId,
                                user_id: userId,
                                role_name: role.name,
                                role_emoji: role.emoji,
                                role_icon: role.icon,
                                group_name: role.groupName,
                                slot_index: userIndex,
                                slots: role.slots || 1,
                                is_waitlist: 0,
                                side_assignment: role.sideAssignments?.[userId] || null
                            });
                        });
                    }
                    if (Array.isArray(role.waitlist)) {
                        role.waitlist.forEach((userId, waitIndex) => {
                            stmts.insertSignup.run({
                                message_id: messageId,
                                user_id: userId,
                                role_name: role.name,
                                role_emoji: role.emoji,
                                role_icon: role.icon,
                                group_name: role.groupName,
                                slot_index: waitIndex,
                                slots: role.slots || 1,
                                is_waitlist: 1,
                                side_assignment: null
                            });
                        });
                    }
                });
            }
        }
    })();
}

function deleteActiveRaid(messageId, options = {}) {
    const stmts = getStatements();
    const removed = activeRaids.delete(messageId);

    if (removed) {
        stmts.deleteRaid.run(messageId);
    }

    return removed;
}

function markActiveRaidUpdated(messageId, options = {}) {
    const raidData = activeRaids.get(messageId);
    if (!raidData) return;

    const stmts = getStatements();

    // Update reminder flags
    stmts.updateRaid.run({
        message_id: messageId,
        creator_reminder_sent: raidData.creatorReminderSent ? 1 : 0,
        participant_reminder_sent: raidData.participantReminderSent ? 1 : 0
    });

    // Sync signups
    syncSignupsToDb(messageId, raidData);
}

// ===== RAID STATS =====

function loadRaidStats() {
    raidStats.clear();
    guildParticipation.clear();

    const stmts = getStatements();

    // Load global stats
    const globalRows = prepare('SELECT * FROM user_stats').all();
    globalRows.forEach(row => {
        raidStats.set(row.user_id, {
            totalRaids: row.total_raids,
            roleCounts: JSON.parse(row.role_counts || '{}'),
            templateCounts: JSON.parse(row.template_counts || '{}'),
            weekdayCounts: JSON.parse(row.weekday_counts || '{}'),
            lastUpdated: row.last_updated,
            lastRaidAt: row.last_raid_at
        });
    });

    // Load guild stats
    const guildRows = prepare('SELECT * FROM guild_user_stats').all();
    guildRows.forEach(row => {
        if (!guildParticipation.has(row.guild_id)) {
            guildParticipation.set(row.guild_id, new Map());
        }
        guildParticipation.get(row.guild_id).set(row.user_id, {
            totalRaids: row.total_raids,
            roleCounts: JSON.parse(row.role_counts || '{}'),
            templateCounts: JSON.parse(row.template_counts || '{}'),
            weekdayCounts: JSON.parse(row.weekday_counts || '{}'),
            lastUpdated: row.last_updated,
            lastRaidAt: row.last_raid_at
        });
    });

    console.log(`Loaded stats for ${raidStats.size} users across ${guildParticipation.size} guilds`);
}

function saveRaidStats() {
    // No-op: changes are persisted immediately
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

    const stmts = getStatements();

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

        // Persist to database
        stmts.upsertUserStats.run({
            user_id: userId,
            total_raids: stats.totalRaids,
            role_counts: JSON.stringify(stats.roleCounts),
            template_counts: JSON.stringify(stats.templateCounts),
            weekday_counts: JSON.stringify(stats.weekdayCounts),
            last_updated: stats.lastUpdated,
            last_raid_at: stats.lastRaidAt
        });

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

            // Persist to database
            stmts.upsertGuildUserStats.run({
                guild_id: guildId,
                user_id: userId,
                total_raids: guildStats.totalRaids,
                role_counts: JSON.stringify(guildStats.roleCounts),
                template_counts: JSON.stringify(guildStats.templateCounts),
                weekday_counts: JSON.stringify(guildStats.weekdayCounts),
                last_updated: guildStats.lastUpdated,
                last_raid_at: guildStats.lastRaidAt
            });
        }
    };

    if (raidData.type === 'museum') {
        raidData.signups.forEach((userId) => incrementUser(userId, 'Museum'));
    } else {
        raidData.signups.forEach((role) => {
            role.users.forEach((userId) => incrementUser(userId, role.name));
        });
    }
}

// Legacy compatibility - safeWriteFile (may still be used by other modules)
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
