/**
 * Circuit Breaker pattern for Discord API calls
 * Prevents cascading failures when Discord API is down or slow
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests rejected immediately
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 */

const { logger } = require('./logger');

const State = {
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN'
};

class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5; // Failures before opening
        this.successThreshold = options.successThreshold || 2; // Successes to close from half-open
        this.timeout = options.timeout || 60000; // Time in ms before trying half-open
        this.name = options.name || 'default';

        this.state = State.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.nextAttempt = Date.now();
        this.stats = {
            requests: 0,
            successes: 0,
            failures: 0,
            rejections: 0 // Requests rejected due to open circuit
        };
    }

    /**
     * Execute a function with circuit breaker protection
     */
    async execute(fn, fallback = null) {
        this.stats.requests++;

        if (this.state === State.OPEN) {
            if (Date.now() < this.nextAttempt) {
                this.stats.rejections++;
                logger.warn(`Circuit breaker ${this.name} is OPEN, rejecting request`, {
                    nextAttempt: new Date(this.nextAttempt).toISOString()
                });
                if (fallback) {
                    return fallback();
                }
                throw new Error(`Circuit breaker ${this.name} is OPEN`);
            }
            // Transition to half-open
            this.state = State.HALF_OPEN;
            this.successCount = 0;
            logger.info(`Circuit breaker ${this.name} entering HALF_OPEN state`);
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure(error);
            if (fallback) {
                return fallback();
            }
            throw error;
        }
    }

    onSuccess() {
        this.stats.successes++;
        this.failureCount = 0;

        if (this.state === State.HALF_OPEN) {
            this.successCount++;
            if (this.successCount >= this.successThreshold) {
                this.close();
            }
        }
    }

    onFailure(error) {
        this.stats.failures++;
        this.failureCount++;
        this.successCount = 0;

        logger.warn(`Circuit breaker ${this.name} recorded failure`, {
            error: error.message,
            failureCount: this.failureCount,
            state: this.state
        });

        if (this.failureCount >= this.failureThreshold) {
            this.open();
        }
    }

    open() {
        this.state = State.OPEN;
        this.nextAttempt = Date.now() + this.timeout;
        logger.error(`Circuit breaker ${this.name} opened`, {
            failureCount: this.failureCount,
            nextAttempt: new Date(this.nextAttempt).toISOString()
        });
    }

    close() {
        this.state = State.CLOSED;
        this.failureCount = 0;
        logger.info(`Circuit breaker ${this.name} closed`);
    }

    halfOpen() {
        this.state = State.HALF_OPEN;
        this.successCount = 0;
    }

    getState() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            nextAttempt: this.nextAttempt,
            stats: { ...this.stats }
        };
    }

    reset() {
        this.state = State.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.nextAttempt = Date.now();
    }
}

// Create circuit breakers for different Discord API operations
const discordApiBreaker = new CircuitBreaker({
    name: 'discord-api',
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000 // 1 minute
});

const dmBreaker = new CircuitBreaker({
    name: 'discord-dm',
    failureThreshold: 10, // More tolerant since DMs fail often
    successThreshold: 3,
    timeout: 30000 // 30 seconds
});

/**
 * Wrap a Discord API call with circuit breaker protection
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Options
 * @returns {Promise} Result of fn or fallback
 */
async function withCircuitBreaker(fn, options = {}) {
    const breaker = options.breaker || discordApiBreaker;
    const fallback = options.fallback || null;
    return breaker.execute(fn, fallback);
}

/**
 * Wrap a DM send with circuit breaker protection
 * @param {User} user - Discord user
 * @param {string|Object} content - Message content
 * @returns {Promise<boolean>} True if sent, false if failed
 */
async function sendDMWithBreaker(user, content) {
    try {
        await dmBreaker.execute(async () => {
            await user.send(content);
        });
        return true;
    } catch (error) {
        logger.warn('DM send failed through circuit breaker', {
            userId: user.id,
            error: error.message
        });
        return false;
    }
}

/**
 * Fetch a Discord entity with circuit breaker protection
 * @param {Function} fetchFn - Function that returns a promise
 * @param {any} fallback - Fallback value if circuit is open
 * @returns {Promise} Entity or fallback
 */
async function fetchWithBreaker(fetchFn, fallback = null) {
    return withCircuitBreaker(fetchFn, {
        breaker: discordApiBreaker,
        fallback: () => fallback
    });
}

/**
 * Get stats for all circuit breakers
 */
function getCircuitBreakerStats() {
    return {
        discordApi: discordApiBreaker.getState(),
        dm: dmBreaker.getState()
    };
}

module.exports = {
    CircuitBreaker,
    withCircuitBreaker,
    sendDMWithBreaker,
    fetchWithBreaker,
    getCircuitBreakerStats,
    discordApiBreaker,
    dmBreaker
};
