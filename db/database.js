/**
 * Database connection wrapper for WizBot
 * Uses better-sqlite3 for synchronous, fast SQLite access
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Determine if we're in test mode
const isTestMode = process.env.NODE_ENV === 'test' ||
    process.env.ACTIVE_RAIDS_FILE?.includes('test') ||
    process.argv.some(arg => arg.includes('node:test') || arg.includes('--test'));

// Use in-memory database for tests to avoid locking
const DB_PATH = isTestMode ? ':memory:' : path.join(DATA_DIR, 'wizbot.db');

// Ensure data directory exists (only for non-test mode)
if (!isTestMode && !fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Create database connection
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance (only for file-based DB)
if (!isTestMode) {
    db.pragma('journal_mode = WAL');
}

// Enable foreign key enforcement
db.pragma('foreign_keys = ON');

/**
 * Initialize the database schema
 */
function initializeSchema() {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);

    // Run migrations for existing databases
    runMigrations();

    console.log('Database schema initialized');
}

/**
 * Run migrations to add new columns to existing tables
 * SQLite doesn't support IF NOT EXISTS for columns, so we check first
 */
function runMigrations() {
    const migrations = [
        // Threads support (added Dec 2024)
        { table: 'guilds', column: 'threads_enabled', sql: 'ALTER TABLE guilds ADD COLUMN threads_enabled INTEGER DEFAULT 0' },
        { table: 'guilds', column: 'thread_auto_archive_minutes', sql: 'ALTER TABLE guilds ADD COLUMN thread_auto_archive_minutes INTEGER DEFAULT 1440' },
        { table: 'raids', column: 'thread_id', sql: 'ALTER TABLE raids ADD COLUMN thread_id TEXT' },
        { table: 'raids', column: 'recurring_id', sql: 'ALTER TABLE raids ADD COLUMN recurring_id TEXT' },
        // Spawn schedule support (added Dec 2024)
        { table: 'recurring_raids', column: 'spawn_day_of_week', sql: 'ALTER TABLE recurring_raids ADD COLUMN spawn_day_of_week INTEGER' },
        { table: 'recurring_raids', column: 'spawn_time_of_day', sql: 'ALTER TABLE recurring_raids ADD COLUMN spawn_time_of_day TEXT' },
        // Key boss signups support (added Dec 2024)
        { table: 'guilds', column: 'key_channel_id', sql: 'ALTER TABLE guilds ADD COLUMN key_channel_id TEXT' },
        // Optimistic locking support (added Dec 2024)
        { table: 'raids', column: 'version', sql: 'ALTER TABLE raids ADD COLUMN version INTEGER DEFAULT 1' },
        // Recurring raid role mentions (added Dec 2024)
        { table: 'recurring_raids', column: 'mention_role_id', sql: 'ALTER TABLE recurring_raids ADD COLUMN mention_role_id TEXT' },
        // Closure metadata persistence (added Jan 2025)
        { table: 'raids', column: 'closed_by', sql: 'ALTER TABLE raids ADD COLUMN closed_by TEXT' },
        { table: 'raids', column: 'closed_reason', sql: 'ALTER TABLE raids ADD COLUMN closed_reason TEXT' },
        { table: 'raids', column: 'auto_close_executed', sql: 'ALTER TABLE raids ADD COLUMN auto_close_executed INTEGER DEFAULT 0' },
        // Stats tracking persistence (added Jan 2025)
        { table: 'raids', column: 'stats_recorded', sql: 'ALTER TABLE raids ADD COLUMN stats_recorded INTEGER DEFAULT 0' },
        // No-show tracking (added Jan 2025)
        { table: 'guild_user_stats', column: 'no_shows', sql: 'ALTER TABLE guild_user_stats ADD COLUMN no_shows INTEGER DEFAULT 0' },
        { table: 'user_stats', column: 'no_shows', sql: 'ALTER TABLE user_stats ADD COLUMN no_shows INTEGER DEFAULT 0' },
        // Debug logging channel (added Feb 2025)
        { table: 'guilds', column: 'debug_channel_id', sql: 'ALTER TABLE guilds ADD COLUMN debug_channel_id TEXT' },
        // Challenge Mode signups support (added Feb 2026)
        { table: 'guilds', column: 'challenge_channel_id', sql: 'ALTER TABLE guilds ADD COLUMN challenge_channel_id TEXT' },
    ];

    // Create raid_attendance table if it doesn't exist
    db.exec(`
        CREATE TABLE IF NOT EXISTS raid_attendance (
            message_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            attended INTEGER DEFAULT 1,
            marked_by TEXT,
            marked_at INTEGER,
            PRIMARY KEY (message_id, user_id),
            FOREIGN KEY (message_id) REFERENCES raids(message_id) ON DELETE CASCADE
        )
    `);

    for (const migration of migrations) {
        if (!columnExists(migration.table, migration.column)) {
            try {
                db.exec(migration.sql);
                console.log(`Migration: Added ${migration.column} to ${migration.table}`);
            } catch (error) {
                console.error(`Migration failed for ${migration.column}:`, error.message);
                throw new Error(`Critical migration failed: ${migration.column}. Cannot start bot.`);
            }
        }
    }
}

/**
 * Check if a column exists in a table
 */
function columnExists(table, column) {
    const result = db.prepare(`PRAGMA table_info(${table})`).all();
    return result.some(row => row.name === column);
}

/**
 * Create a prepared statement (cached for performance)
 */
function prepare(sql) {
    return db.prepare(sql);
}

/**
 * Execute a transaction
 * @param {Function} fn - Function to execute within transaction
 */
function transaction(fn) {
    return db.transaction(fn);
}

/**
 * Close the database connection
 */
function close() {
    db.close();
    console.log('Database connection closed');
}

/**
 * Check if database has been migrated (has data)
 */
function hasMigrated() {
    const result = db.prepare('SELECT COUNT(*) as count FROM guilds').get();
    return result.count > 0;
}

/**
 * Get database stats for debugging
 */
function getStats() {
    return {
        guilds: db.prepare('SELECT COUNT(*) as count FROM guilds').get().count,
        raids: db.prepare('SELECT COUNT(*) as count FROM raids').get().count,
        signups: db.prepare('SELECT COUNT(*) as count FROM signups').get().count,
        userStats: db.prepare('SELECT COUNT(*) as count FROM user_stats').get().count,
        guildUserStats: db.prepare('SELECT COUNT(*) as count FROM guild_user_stats').get().count
    };
}

module.exports = {
    db,
    prepare,
    transaction,
    close,
    initializeSchema,
    hasMigrated,
    getStats,
    DB_PATH,
    DATA_DIR
};
