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
    console.log('Database schema initialized');
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
