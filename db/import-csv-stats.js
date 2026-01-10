#!/usr/bin/env node
/**
 * Import Stats from CSV Export
 * 
 * Restores user statistics from a /stats export CSV file.
 * 
 * Usage: node db/import-csv-stats.js <csv-file> <guild-id>
 * 
 * Example: node db/import-csv-stats.js stats-export.csv 1234567890
 */

const fs = require('fs');
const path = require('path');
const { db, initializeSchema } = require('./database');

const csvFile = process.argv[2];
const guildId = process.argv[3];

if (!csvFile || !guildId) {
    console.log('Usage: node db/import-csv-stats.js <csv-file> <guild-id>');
    console.log('Example: node db/import-csv-stats.js stats-export.csv 1032023492092248084');
    process.exit(1);
}

function parseCSV(content) {
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',');
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        // Handle quoted fields (for timezone, days, roles)
        const values = [];
        let current = '';
        let inQuotes = false;

        for (const char of line) {
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current);

        const row = {};
        headers.forEach((header, idx) => {
            row[header.trim()] = values[idx] || '';
        });
        rows.push(row);
    }

    return rows;
}

function importStats() {
    console.log('='.repeat(50));
    console.log('WizBot CSV Stats Import');
    console.log('='.repeat(50));
    console.log();

    // Check if file exists
    const csvPath = path.resolve(csvFile);
    if (!fs.existsSync(csvPath)) {
        console.error(`❌ CSV file not found: ${csvPath}`);
        process.exit(1);
    }

    // Initialize schema
    initializeSchema();
    console.log();

    // Read and parse CSV
    const content = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCSV(content);

    console.log(`Found ${rows.length} users in CSV`);
    console.log(`Importing to guild: ${guildId}`);
    console.log();

    // Prepare statements
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

    // Ensure guild exists
    db.prepare('INSERT OR IGNORE INTO guilds (id) VALUES (?)').run(guildId);

    const now = Date.now();

    const runImport = db.transaction(() => {
        let imported = 0;

        for (const row of rows) {
            const userId = row['User ID'];
            const totalRaids = parseInt(row['Total Signups'] || '0', 10);
            const lastActiveStr = row['Last Active'];

            if (!userId || userId === 'User ID') continue;

            // Parse last active date
            let lastRaidAt = null;
            if (lastActiveStr && lastActiveStr !== 'Never') {
                try {
                    lastRaidAt = new Date(lastActiveStr).getTime();
                } catch {
                    lastRaidAt = null;
                }
            }

            // Update global stats
            upsertGlobal.run(
                userId,
                totalRaids,
                '{}',  // role counts not in CSV
                '{}',  // template counts not in CSV
                '{}',  // weekday counts not in CSV
                now,
                lastRaidAt
            );

            // Update guild stats
            upsertGuild.run(
                guildId,
                userId,
                totalRaids,
                '{}',
                '{}',
                '{}',
                now,
                lastRaidAt
            );

            console.log(`  ${userId}: ${totalRaids} raids`);
            imported++;
        }

        return imported;
    });

    const count = runImport();

    console.log();
    console.log(`✅ Imported ${count} user stats`);
    console.log();
    console.log('Note: Role counts, template counts, and weekday counts were reset');
    console.log('(this data is not included in the CSV export)');
    console.log('='.repeat(50));
}

// Run if called directly
if (require.main === module) {
    try {
        importStats();
    } catch (error) {
        console.error('Import failed:', error);
        process.exit(1);
    }
}

module.exports = { importStats };
