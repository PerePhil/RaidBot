#!/usr/bin/env node
/**
 * Stats Restore Script
 * 
 * Restores user statistics from the raid_stats.json.migrated backup file.
 * Use this after accidentally running repair-stats.js.
 * 
 * Usage: node db/restore-stats.js [--dry-run]
 * 
 * Options:
 *   --dry-run    Show what would be restored without actually updating
 */

const fs = require('fs');
const path = require('path');
const { db, initializeSchema, DATA_DIR } = require('./database');

const isDryRun = process.argv.includes('--dry-run');
const BACKUP_FILE = path.join(DATA_DIR, 'raid_stats.json.migrated');

function restoreStats() {
    console.log('='.repeat(50));
    console.log('WizBot Stats Restore Tool');
    console.log('='.repeat(50));
    console.log();

    if (isDryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }

    // Check if backup file exists
    if (!fs.existsSync(BACKUP_FILE)) {
        console.error(`❌ Backup file not found: ${BACKUP_FILE}`);
        console.error('Cannot restore stats without the backup file.');
        process.exit(1);
    }

    // Initialize schema (ensures migrations are run)
    initializeSchema();
    console.log();

    // Read backup file
    let backupData;
    try {
        backupData = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
    } catch (error) {
        console.error(`❌ Failed to parse backup file: ${error.message}`);
        process.exit(1);
    }

    const globalStats = backupData.global || backupData;
    const guildStats = backupData.guild || {};

    console.log(`Found ${Object.keys(globalStats).length} global user stats in backup`);
    console.log(`Found ${Object.keys(guildStats).length} guilds with stats in backup`);
    console.log();

    // Count guild user stats
    let guildUserCount = 0;
    for (const guildId of Object.keys(guildStats)) {
        guildUserCount += Object.keys(guildStats[guildId] || {}).length;
    }
    console.log(`Total guild-user stat entries: ${guildUserCount}`);
    console.log();

    if (isDryRun) {
        console.log('DRY RUN - Would restore the above stats.');
        console.log('Run without --dry-run to apply restoration.');
        return;
    }

    // Restore stats
    console.log('Restoring stats from backup...\n');

    const upsertGlobal = db.prepare(`
        INSERT OR REPLACE INTO user_stats (
            user_id, total_raids, role_counts, template_counts, weekday_counts, last_updated, last_raid_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const upsertGuild = db.prepare(`
        INSERT OR REPLACE INTO guild_user_stats (
            guild_id, user_id, total_raids, role_counts, template_counts, weekday_counts, last_updated, last_raid_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const runRestore = db.transaction(() => {
        // Restore global stats
        let globalCount = 0;
        for (const [userId, stats] of Object.entries(globalStats)) {
            if (typeof stats !== 'object') continue;
            upsertGlobal.run(
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
        console.log(`  Restored ${globalCount} global user stats`);

        // Restore guild stats
        let guildCount = 0;
        for (const [guildId, users] of Object.entries(guildStats)) {
            // Ensure guild exists
            db.prepare('INSERT OR IGNORE INTO guilds (id) VALUES (?)').run(guildId);

            for (const [userId, stats] of Object.entries(users || {})) {
                if (typeof stats !== 'object') continue;
                upsertGuild.run(
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
        console.log(`  Restored ${guildCount} guild user stats`);
    });

    runRestore();

    console.log();
    console.log('✅ Stats restoration complete!');
    console.log();
    console.log('='.repeat(50));
}

// Run if called directly
if (require.main === module) {
    try {
        restoreStats();
    } catch (error) {
        console.error('Stats restore failed:', error);
        process.exit(1);
    }
}

module.exports = { restoreStats };
