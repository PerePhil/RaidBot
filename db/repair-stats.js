#!/usr/bin/env node
/**
 * Stats Repair Script
 * 
 * Recalculates user statistics from the signups table to fix
 * any double-counting that may have occurred due to bot restarts.
 * 
 * Usage: node db/repair-stats.js [--dry-run]
 * 
 * Options:
 *   --dry-run    Show what would be changed without actually updating
 */

const { db, initializeSchema } = require('./database');

const isDryRun = process.argv.includes('--dry-run');

function parseBossName(templateData) {
    if (!templateData) return null;
    try {
        const parsed = JSON.parse(templateData);
        return parsed?.bossName || null;
    } catch {
        return null;
    }
}

function repairStats() {
    console.log('='.repeat(50));
    console.log('WizBot Stats Repair Tool');
    console.log('='.repeat(50));
    console.log();

    if (isDryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }

    // Initialize schema (ensures migrations are run)
    initializeSchema();
    console.log();

    // Get current stats for comparison
    const currentGlobalStats = new Map();
    const currentGuildStats = new Map();

    db.prepare('SELECT * FROM user_stats').all().forEach(row => {
        currentGlobalStats.set(row.user_id, {
            totalRaids: row.total_raids,
            roleCounts: JSON.parse(row.role_counts || '{}'),
            templateCounts: JSON.parse(row.template_counts || '{}'),
            weekdayCounts: JSON.parse(row.weekday_counts || '{}')
        });
    });

    db.prepare('SELECT * FROM guild_user_stats').all().forEach(row => {
        const key = `${row.guild_id}:${row.user_id}`;
        currentGuildStats.set(key, {
            totalRaids: row.total_raids,
            roleCounts: JSON.parse(row.role_counts || '{}'),
            templateCounts: JSON.parse(row.template_counts || '{}'),
            weekdayCounts: JSON.parse(row.weekday_counts || '{}')
        });
    });

    console.log(`Found ${currentGlobalStats.size} users with global stats`);
    console.log(`Found ${currentGuildStats.size} guild-user stat entries`);
    console.log();

    // Calculate correct stats from signups table
    // Join with raids to get template info and guild
    const signupQuery = `
        SELECT 
            s.user_id,
            s.role_name,
            s.is_waitlist,
            r.guild_id,
            r.type,
            r.template_slug,
            r.template_data,
            r.timestamp,
            r.closed_at
        FROM signups s
        JOIN raids r ON s.message_id = r.message_id
        WHERE s.is_waitlist = 0
        ORDER BY s.user_id
    `;

    const signups = db.prepare(signupQuery).all();
    console.log(`Processing ${signups.length} total signups from database...\n`);

    // Calculate new stats
    const newGlobalStats = new Map();
    const newGuildStats = new Map();

    for (const signup of signups) {
        const { user_id, role_name, guild_id, type, template_slug, template_data, timestamp } = signup;

        // Determine template name
        let templateName = 'Raid';
        if (type === 'museum') {
            templateName = 'Museum Signup';
        } else if (type === 'key') {
            const bossName = parseBossName(template_data);
            templateName = bossName ? `Gold Key Boss — ${bossName}` : 'Gold Key Boss';
        } else if (type === 'challenge') {
            const bossName = parseBossName(template_data);
            templateName = bossName ? `Challenge Mode — ${bossName}` : 'Challenge Mode';
        } else if (template_data) {
            try {
                const template = JSON.parse(template_data);
                templateName = template.name || template_slug || 'Raid';
            } catch {
                templateName = template_slug || 'Raid';
            }
        }

        // Calculate weekday (0-6, Sunday = 0)
        const weekday = timestamp ? new Date(timestamp * 1000).getDay() : null;

        // Update global stats
        if (!newGlobalStats.has(user_id)) {
            newGlobalStats.set(user_id, {
                totalRaids: 0,
                roleCounts: {},
                templateCounts: {},
                weekdayCounts: {}
            });
        }
        const globalStats = newGlobalStats.get(user_id);
        globalStats.totalRaids += 1;
        globalStats.roleCounts[role_name] = (globalStats.roleCounts[role_name] || 0) + 1;
        globalStats.templateCounts[templateName] = (globalStats.templateCounts[templateName] || 0) + 1;
        if (weekday !== null) {
            globalStats.weekdayCounts[weekday] = (globalStats.weekdayCounts[weekday] || 0) + 1;
        }

        // Update guild stats
        if (guild_id) {
            const guildKey = `${guild_id}:${user_id}`;
            if (!newGuildStats.has(guildKey)) {
                newGuildStats.set(guildKey, {
                    guildId: guild_id,
                    userId: user_id,
                    totalRaids: 0,
                    roleCounts: {},
                    templateCounts: {},
                    weekdayCounts: {}
                });
            }
            const guildStats = newGuildStats.get(guildKey);
            guildStats.totalRaids += 1;
            guildStats.roleCounts[role_name] = (guildStats.roleCounts[role_name] || 0) + 1;
            guildStats.templateCounts[templateName] = (guildStats.templateCounts[templateName] || 0) + 1;
            if (weekday !== null) {
                guildStats.weekdayCounts[weekday] = (guildStats.weekdayCounts[weekday] || 0) + 1;
            }
        }
    }

    // Compare and report differences
    let globalDiffs = 0;
    let guildDiffs = 0;
    let totalOvercount = 0;

    console.log('Comparing calculated stats with stored stats...\n');

    // Check global stats
    for (const [userId, newStats] of newGlobalStats) {
        const current = currentGlobalStats.get(userId);
        if (current) {
            const diff = current.totalRaids - newStats.totalRaids;
            if (diff !== 0) {
                globalDiffs++;
                totalOvercount += diff;
                if (diff > 0) {
                    console.log(`  User ${userId}: ${current.totalRaids} → ${newStats.totalRaids} (overcounted by ${diff})`);
                } else {
                    console.log(`  User ${userId}: ${current.totalRaids} → ${newStats.totalRaids} (undercounted by ${-diff})`);
                }
            }
        }
    }

    // Also check for users in current stats but not in new (shouldn't happen, but check)
    for (const [userId, current] of currentGlobalStats) {
        if (!newGlobalStats.has(userId) && current.totalRaids > 0) {
            console.log(`  User ${userId}: ${current.totalRaids} → 0 (no signups found)`);
            globalDiffs++;
            totalOvercount += current.totalRaids;
        }
    }

    console.log();
    console.log(`Found ${globalDiffs} users with incorrect global stats`);
    console.log(`Total overcount: ${totalOvercount} raid signups\n`);

    if (isDryRun) {
        console.log('DRY RUN - No changes made. Run without --dry-run to apply fixes.');
        return;
    }

    if (globalDiffs === 0) {
        console.log('✅ No discrepancies found! Stats are accurate.');
        return;
    }

    // Apply fixes
    console.log('Applying fixes...\n');

    const updateGlobal = db.prepare(`
        INSERT OR REPLACE INTO user_stats (
            user_id, total_raids, role_counts, template_counts, weekday_counts, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const updateGuild = db.prepare(`
        INSERT OR REPLACE INTO guild_user_stats (
            guild_id, user_id, total_raids, role_counts, template_counts, weekday_counts, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();

    const runUpdates = db.transaction(() => {
        // Update global stats
        for (const [userId, stats] of newGlobalStats) {
            updateGlobal.run(
                userId,
                stats.totalRaids,
                JSON.stringify(stats.roleCounts),
                JSON.stringify(stats.templateCounts),
                JSON.stringify(stats.weekdayCounts),
                now
            );
        }

        // Clear stats for users with no signups
        for (const [userId, current] of currentGlobalStats) {
            if (!newGlobalStats.has(userId)) {
                updateGlobal.run(
                    userId,
                    0,
                    '{}',
                    '{}',
                    '{}',
                    now
                );
            }
        }

        // Update guild stats
        for (const [, stats] of newGuildStats) {
            updateGuild.run(
                stats.guildId,
                stats.userId,
                stats.totalRaids,
                JSON.stringify(stats.roleCounts),
                JSON.stringify(stats.templateCounts),
                JSON.stringify(stats.weekdayCounts),
                now
            );
        }

        // Clear guild stats for users with no signups in that guild
        for (const [key, current] of currentGuildStats) {
            if (!newGuildStats.has(key)) {
                const [guildId, userId] = key.split(':');
                updateGuild.run(
                    guildId,
                    userId,
                    0,
                    '{}',
                    '{}',
                    '{}',
                    now
                );
            }
        }
    });

    runUpdates();

    console.log('✅ Stats repair complete!');
    console.log(`   Updated ${newGlobalStats.size} global user stats`);
    console.log(`   Updated ${newGuildStats.size} guild user stats`);
    console.log();
    console.log('='.repeat(50));
}

// Run if called directly
if (require.main === module) {
    try {
        repairStats();
    } catch (error) {
        console.error('Stats repair failed:', error);
        process.exit(1);
    }
}

module.exports = { repairStats };
