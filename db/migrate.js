#!/usr/bin/env node
/**
 * Migration script to import existing JSON data into SQLite
 * 
 * Usage: node db/migrate.js
 * 
 * This script:
 * 1. Initializes the SQLite schema
 * 2. Reads all existing JSON files
 * 3. Imports data into the appropriate tables
 * 4. Renames JSON files to .json.migrated (as backup)
 */

const fs = require('fs');
const path = require('path');
const { db, initializeSchema, DATA_DIR } = require('./database');

// JSON file paths
const FILES = {
    raidChannels: path.join(DATA_DIR, 'raid_channels.json'),
    museumChannels: path.join(DATA_DIR, 'museum_channels.json'),
    auditChannels: path.join(DATA_DIR, 'audit_channels.json'),
    guildSettings: path.join(DATA_DIR, 'guild_settings.json'),
    activeRaids: path.join(DATA_DIR, 'active_raids.json'),
    raidStats: path.join(DATA_DIR, 'raid_stats.json'),
    adminRoles: path.join(DATA_DIR, 'admin_roles.json'),
    commandPermissions: path.join(DATA_DIR, 'command_permissions.json'),
    signupRoles: path.join(DATA_DIR, 'signup_roles.json'),
    availability: path.join(DATA_DIR, 'availability.json'),
    templateOverrides: path.join(DATA_DIR, 'template_overrides.json')
};

function readJsonFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Failed to parse ${filePath}:`, error.message);
        return null;
    }
}

function migrateGuilds() {
    console.log('Migrating guild configurations...');

    const insertGuild = db.prepare(`
        INSERT OR REPLACE INTO guilds (
            id, raid_channel_id, museum_channel_id, audit_channel_id,
            creator_reminder_seconds, participant_reminder_seconds,
            auto_close_seconds, last_auto_close_seconds,
            creator_reminders_enabled, participant_reminders_enabled,
            raid_leader_role_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const raidChannels = readJsonFile(FILES.raidChannels) || {};
    const museumChannels = readJsonFile(FILES.museumChannels) || {};
    const auditChannels = readJsonFile(FILES.auditChannels) || {};
    const guildSettings = readJsonFile(FILES.guildSettings) || {};

    // Collect all guild IDs
    const guildIds = new Set([
        ...Object.keys(raidChannels),
        ...Object.keys(museumChannels),
        ...Object.keys(auditChannels),
        ...Object.keys(guildSettings)
    ]);

    let count = 0;
    for (const guildId of guildIds) {
        const settings = guildSettings[guildId] || {};
        insertGuild.run(
            guildId,
            raidChannels[guildId] || null,
            museumChannels[guildId] || null,
            auditChannels[guildId] || null,
            settings.creatorReminderSeconds ?? 1800,
            settings.participantReminderSeconds ?? 600,
            settings.autoCloseSeconds ?? 3600,
            settings.lastAutoCloseSeconds ?? 3600,
            settings.creatorRemindersEnabled !== false ? 1 : 0,
            settings.participantRemindersEnabled !== false ? 1 : 0,
            settings.raidLeaderRoleId || null
        );
        count++;
    }
    console.log(`  Migrated ${count} guilds`);
}

function migrateActiveRaids() {
    console.log('Migrating active raids...');

    const insertRaid = db.prepare(`
        INSERT OR REPLACE INTO raids (
            message_id, raid_id, guild_id, channel_id, type,
            template_slug, template_data, datetime, timestamp,
            length, strategy, creator_id, max_slots,
            creator_reminder_sent, participant_reminder_sent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSignup = db.prepare(`
        INSERT OR REPLACE INTO signups (
            message_id, user_id, role_name, role_emoji, role_icon,
            group_name, slot_index, slots, is_waitlist, side_assignment
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMuseumWaitlist = db.prepare(`
        INSERT OR REPLACE INTO museum_waitlist (message_id, user_id, position)
        VALUES (?, ?, ?)
    `);

    const activeRaids = readJsonFile(FILES.activeRaids) || {};

    let raidCount = 0;
    let signupCount = 0;

    for (const [messageId, raid] of Object.entries(activeRaids)) {
        // Ensure guild exists
        db.prepare('INSERT OR IGNORE INTO guilds (id) VALUES (?)').run(raid.guildId);

        // Insert raid
        insertRaid.run(
            messageId,
            raid.raidId,
            raid.guildId,
            raid.channelId,
            raid.type || 'raid',
            raid.template?.slug || null,
            raid.template ? JSON.stringify(raid.template) : null,
            raid.datetime || null,
            raid.timestamp || null,
            raid.length || null,
            raid.strategy || null,
            raid.creatorId,
            raid.maxSlots || null,
            raid.creatorReminderSent ? 1 : 0,
            raid.participantReminderSent ? 1 : 0
        );
        raidCount++;

        // Insert signups
        if (raid.type === 'museum') {
            // Museum signups are just an array of user IDs
            if (Array.isArray(raid.signups)) {
                raid.signups.forEach((userId, index) => {
                    insertSignup.run(
                        messageId, userId, 'Museum', '✅', null,
                        null, index, 1, 0, null
                    );
                    signupCount++;
                });
            }
            // Museum waitlist
            if (Array.isArray(raid.waitlist)) {
                raid.waitlist.forEach((userId, index) => {
                    insertMuseumWaitlist.run(messageId, userId, index);
                });
            }
        } else {
            // Regular raid signups are structured with roles
            if (Array.isArray(raid.signups)) {
                raid.signups.forEach((role, roleIndex) => {
                    if (Array.isArray(role.users)) {
                        role.users.forEach((userId, userIndex) => {
                            insertSignup.run(
                                messageId, userId, role.name, role.emoji, role.icon,
                                role.groupName, userIndex, role.slots || 1, 0,
                                role.sideAssignments?.[userId] || null
                            );
                            signupCount++;
                        });
                    }
                    // Role waitlist
                    if (Array.isArray(role.waitlist)) {
                        role.waitlist.forEach((userId, waitIndex) => {
                            insertSignup.run(
                                messageId, userId, role.name, role.emoji, role.icon,
                                role.groupName, waitIndex, role.slots || 1, 1,
                                null
                            );
                            signupCount++;
                        });
                    }
                });
            }
        }
    }
    console.log(`  Migrated ${raidCount} raids with ${signupCount} signups`);
}

function migrateRaidStats() {
    console.log('Migrating raid statistics...');

    const insertUserStats = db.prepare(`
        INSERT OR REPLACE INTO user_stats (
            user_id, total_raids, role_counts, template_counts,
            weekday_counts, last_updated, last_raid_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertGuildUserStats = db.prepare(`
        INSERT OR REPLACE INTO guild_user_stats (
            guild_id, user_id, total_raids, role_counts, template_counts,
            weekday_counts, last_updated, last_raid_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const statsData = readJsonFile(FILES.raidStats) || {};
    const globalStats = statsData.global || statsData; // Handle legacy format
    const guildStats = statsData.guild || {};

    let globalCount = 0;
    let guildCount = 0;

    // Global stats
    for (const [userId, stats] of Object.entries(globalStats)) {
        if (typeof stats !== 'object') continue;
        insertUserStats.run(
            userId,
            stats.totalRaids || 0,
            JSON.stringify(stats.roleCounts || {}),
            JSON.stringify(stats.templateCounts || {}),
            JSON.stringify(stats.weekdayCounts || {}),
            stats.lastUpdated || null,
            stats.lastRaidAt || null
        );
        globalCount++;
    }

    // Guild-specific stats
    for (const [guildId, users] of Object.entries(guildStats)) {
        // Ensure guild exists
        db.prepare('INSERT OR IGNORE INTO guilds (id) VALUES (?)').run(guildId);

        for (const [userId, stats] of Object.entries(users)) {
            if (typeof stats !== 'object') continue;
            insertGuildUserStats.run(
                guildId,
                userId,
                stats.totalRaids || 0,
                JSON.stringify(stats.roleCounts || {}),
                JSON.stringify(stats.templateCounts || {}),
                JSON.stringify(stats.weekdayCounts || {}),
                stats.lastUpdated || null,
                stats.lastRaidAt || null
            );
            guildCount++;
        }
    }
    console.log(`  Migrated ${globalCount} global stats, ${guildCount} guild stats`);
}

function migratePermissions() {
    console.log('Migrating permissions...');

    const insertAdminRole = db.prepare(
        'INSERT OR IGNORE INTO admin_roles (guild_id, role_id) VALUES (?, ?)'
    );
    const insertCommandPerm = db.prepare(
        'INSERT OR IGNORE INTO command_permissions (guild_id, command_name, role_id) VALUES (?, ?, ?)'
    );
    const insertSignupRole = db.prepare(
        'INSERT OR IGNORE INTO signup_roles (guild_id, role_id) VALUES (?, ?)'
    );

    // Admin roles
    const adminRoles = readJsonFile(FILES.adminRoles) || {};
    let adminCount = 0;
    for (const [guildId, roles] of Object.entries(adminRoles)) {
        db.prepare('INSERT OR IGNORE INTO guilds (id) VALUES (?)').run(guildId);
        for (const roleId of (roles || [])) {
            insertAdminRole.run(guildId, roleId);
            adminCount++;
        }
    }

    // Command permissions
    const commandPerms = readJsonFile(FILES.commandPermissions) || {};
    let cmdCount = 0;
    for (const [guildId, commands] of Object.entries(commandPerms)) {
        db.prepare('INSERT OR IGNORE INTO guilds (id) VALUES (?)').run(guildId);
        for (const [cmdName, roles] of Object.entries(commands || {})) {
            for (const roleId of (roles || [])) {
                insertCommandPerm.run(guildId, cmdName, roleId);
                cmdCount++;
            }
        }
    }

    // Signup roles
    const signupRoles = readJsonFile(FILES.signupRoles) || {};
    let signupCount = 0;
    for (const [guildId, roles] of Object.entries(signupRoles)) {
        db.prepare('INSERT OR IGNORE INTO guilds (id) VALUES (?)').run(guildId);
        for (const roleId of (roles || [])) {
            insertSignupRole.run(guildId, roleId);
            signupCount++;
        }
    }

    console.log(`  Migrated ${adminCount} admin roles, ${cmdCount} command perms, ${signupCount} signup roles`);
}

function migrateAvailability() {
    console.log('Migrating availability...');

    const insertAvail = db.prepare(`
        INSERT OR REPLACE INTO availability (
            guild_id, user_id, timezone, days, roles, notes, windows
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const availability = readJsonFile(FILES.availability) || {};
    let count = 0;

    for (const [guildId, users] of Object.entries(availability)) {
        db.prepare('INSERT OR IGNORE INTO guilds (id) VALUES (?)').run(guildId);
        for (const [userId, data] of Object.entries(users || {})) {
            const avail = typeof data === 'string'
                ? { notes: data }
                : (data || {});
            insertAvail.run(
                guildId,
                userId,
                avail.timezone || null,
                avail.days || null,
                avail.roles || null,
                avail.notes || null,
                avail.windows ? JSON.stringify(avail.windows) : null
            );
            count++;
        }
    }
    console.log(`  Migrated ${count} availability entries`);
}

function migrateTemplates() {
    console.log('Migrating template overrides...');

    const insertOverride = db.prepare(`
        INSERT OR REPLACE INTO template_overrides (
            guild_id, template_id, name, emoji, description, color, disabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertCustom = db.prepare(`
        INSERT OR REPLACE INTO custom_templates (
            id, guild_id, name, emoji, description, color, role_groups
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const templateData = readJsonFile(FILES.templateOverrides) || {};
    const overrides = templateData.overrides || templateData;
    const custom = templateData.custom || {};

    let overrideCount = 0;
    let customCount = 0;

    // Template overrides
    for (const [guildId, templates] of Object.entries(overrides)) {
        if (guildId === 'custom') continue; // Skip if legacy format
        db.prepare('INSERT OR IGNORE INTO guilds (id) VALUES (?)').run(guildId);
        for (const [templateId, data] of Object.entries(templates || {})) {
            insertOverride.run(
                guildId,
                templateId,
                data.name || null,
                data.emoji || null,
                data.description || null,
                data.color || null,
                data.disabled ? 1 : 0
            );
            overrideCount++;
        }
    }

    // Custom templates
    for (const [guildId, templates] of Object.entries(custom)) {
        db.prepare('INSERT OR IGNORE INTO guilds (id) VALUES (?)').run(guildId);
        for (const [templateId, data] of Object.entries(templates || {})) {
            insertCustom.run(
                templateId,
                guildId,
                data.name || 'Custom Raid',
                data.emoji || null,
                data.description || null,
                data.color || null,
                data.roleGroups ? JSON.stringify(data.roleGroups) : null
            );
            customCount++;
        }
    }

    console.log(`  Migrated ${overrideCount} overrides, ${customCount} custom templates`);
}

function backupJsonFiles() {
    console.log('Backing up JSON files...');

    for (const [name, filePath] of Object.entries(FILES)) {
        if (fs.existsSync(filePath)) {
            const backupPath = `${filePath}.migrated`;
            try {
                fs.renameSync(filePath, backupPath);
                console.log(`  Backed up ${name}`);
            } catch (error) {
                console.error(`  Failed to backup ${name}: ${error.message}`);
            }
        }
    }
}

function migrate() {
    console.log('='.repeat(50));
    console.log('WizBot SQLite Migration');
    console.log('='.repeat(50));
    console.log();

    // Initialize schema
    initializeSchema();
    console.log();

    // Run all migrations in a transaction
    const runMigration = db.transaction(() => {
        migrateGuilds();
        migrateActiveRaids();
        migrateRaidStats();
        migratePermissions();
        migrateAvailability();
        migrateTemplates();
    });

    try {
        runMigration();
        console.log();
        console.log('Migration completed successfully!');
        console.log();

        // Backup JSON files
        backupJsonFiles();
        console.log();

        // Print summary
        const stats = require('./database').getStats();
        console.log('Database summary:');
        console.log(`  Guilds: ${stats.guilds}`);
        console.log(`  Raids: ${stats.raids}`);
        console.log(`  Signups: ${stats.signups}`);
        console.log(`  User stats: ${stats.userStats}`);
        console.log(`  Guild user stats: ${stats.guildUserStats}`);
        console.log();
        console.log('='.repeat(50));
        console.log('To revert: delete data/wizbot.db and rename .json.migrated files back to .json');
        console.log('='.repeat(50));

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

// Run migration if called directly
if (require.main === module) {
    migrate();
}

module.exports = { migrate };
