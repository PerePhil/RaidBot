/**
 * Rate limiting utility for reaction handling and command throttling.
 */

class RateLimiter {
    /**
     * @param {Object} options
     * @param {number} options.maxRequests - Maximum requests allowed in the window
     * @param {number} options.windowMs - Time window in milliseconds
     */
    constructor({ maxRequests = 10, windowMs = 60000 } = {}) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.requests = new Map(); // key -> [timestamps]
    }

    /**
     * Check if a key is rate limited.
     * @param {string} key - Identifier (userId, guildId, etc.)
     * @returns {boolean} - True if allowed, false if rate limited
     */
    isAllowed(key) {
        const now = Date.now();
        const timestamps = this.requests.get(key) || [];

        // Remove old timestamps outside the window
        const validTimestamps = timestamps.filter((ts) => now - ts < this.windowMs);

        if (validTimestamps.length >= this.maxRequests) {
            this.requests.set(key, validTimestamps);
            return false;
        }

        validTimestamps.push(now);
        this.requests.set(key, validTimestamps);
        return true;
    }

    /**
     * Get remaining requests for a key.
     * @param {string} key
     * @returns {number}
     */
    remaining(key) {
        const now = Date.now();
        const timestamps = this.requests.get(key) || [];
        const validTimestamps = timestamps.filter((ts) => now - ts < this.windowMs);
        return Math.max(0, this.maxRequests - validTimestamps.length);
    }

    /**
     * Get time until rate limit resets for a key.
     * @param {string} key
     * @returns {number} - Milliseconds until reset, 0 if not limited
     */
    resetIn(key) {
        const now = Date.now();
        const timestamps = this.requests.get(key) || [];
        if (timestamps.length === 0) return 0;

        const oldest = Math.min(...timestamps);
        const resetTime = oldest + this.windowMs - now;
        return Math.max(0, resetTime);
    }

    /**
     * Clear rate limit data for a key.
     * @param {string} key
     */
    reset(key) {
        this.requests.delete(key);
    }

    /**
     * Clear all rate limit data.
     */
    clear() {
        this.requests.clear();
    }

    /**
     * Periodic cleanup of old entries.
     */
    cleanup() {
        const now = Date.now();
        for (const [key, timestamps] of this.requests.entries()) {
            const valid = timestamps.filter((ts) => now - ts < this.windowMs);
            if (valid.length === 0) {
                this.requests.delete(key);
            } else {
                this.requests.set(key, valid);
            }
        }
    }
}

// Pre-configured limiters for common use cases
const reactionLimiter = new RateLimiter({ maxRequests: 5, windowMs: 10000 }); // 5 reactions per 10s per user
const commandCooldowns = new RateLimiter({ maxRequests: 3, windowMs: 30000 }); // 3 commands per 30s per user

// Cleanup old entries every 5 minutes (skip in test mode)
const isTestMode = process.env.NODE_ENV === 'test' ||
    process.argv.some(arg => arg.includes('node:test') || arg.includes('--test'));
if (!isTestMode) {
    setInterval(() => {
        reactionLimiter.cleanup();
        commandCooldowns.cleanup();
    }, 5 * 60 * 1000);
}

module.exports = {
    RateLimiter,
    reactionLimiter,
    commandCooldowns
};
