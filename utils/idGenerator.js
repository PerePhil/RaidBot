/**
 * Centralized ID generation utility using cryptographically secure random bytes.
 * Replaces deprecated .substr() and provides consistent ID format across the app.
 */

const crypto = require('crypto');

// Character set optimized to avoid confusion (no 0/O, 1/I/l)
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generate a random ID with optional prefix
 * @param {string} prefix - Optional prefix for the ID (e.g., 'rec', 'custom')
 * @param {number} length - Length of random portion (default: 8)
 * @returns {string} Generated ID
 */
function generateId(prefix = '', length = 8) {
    const bytes = crypto.randomBytes(length);
    let randomPart = '';

    for (let i = 0; i < length; i++) {
        randomPart += CHARS[bytes[i] % CHARS.length];
    }

    return prefix ? `${prefix}-${randomPart}` : randomPart;
}

/**
 * Generate a timestamped ID (useful for ordering)
 * @param {string} prefix - Optional prefix for the ID
 * @param {number} randomLength - Length of random suffix (default: 6)
 * @returns {string} Generated ID with timestamp
 */
function generateTimestampedId(prefix = '', randomLength = 6) {
    const timestamp = Date.now().toString(36);
    const bytes = crypto.randomBytes(randomLength);
    let randomPart = '';

    for (let i = 0; i < randomLength; i++) {
        randomPart += CHARS[bytes[i] % CHARS.length];
    }

    return prefix ? `${prefix}-${timestamp}-${randomPart}` : `${timestamp}-${randomPart}`;
}

module.exports = {
    generateId,
    generateTimestampedId
};
