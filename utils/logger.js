/**
 * Structured logging utility with levels, timestamps, and context.
 * Designed for easy debugging and production monitoring.
 */

const fs = require('fs');
const path = require('path');

const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

const LOG_COLORS = {
    DEBUG: '\x1b[36m', // Cyan
    INFO: '\x1b[32m',  // Green
    WARN: '\x1b[33m',  // Yellow
    ERROR: '\x1b[31m', // Red
    RESET: '\x1b[0m'
};

class Logger {
    constructor(options = {}) {
        this.level = LOG_LEVELS[options.level?.toUpperCase()] ?? LOG_LEVELS.INFO;
        this.context = options.context || 'wizbot';
        this.colorize = options.colorize ?? true;
        this.logToFile = options.logToFile ?? false;
        this.logDir = options.logDir || path.join(__dirname, '..', 'logs');
        this.maxFileSize = options.maxFileSize || 5 * 1024 * 1024; // 5MB

        if (this.logToFile) {
            this._ensureLogDir();
        }
    }

    _ensureLogDir() {
        try {
            fs.mkdirSync(this.logDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create log directory:', error);
            this.logToFile = false;
        }
    }

    _formatTimestamp() {
        return new Date().toISOString();
    }

    _formatMessage(level, message, meta = {}) {
        const timestamp = this._formatTimestamp();
        const context = meta.context || this.context;
        const requestId = meta.requestId ? `[${meta.requestId}]` : '';

        const structured = {
            timestamp,
            level,
            context,
            message,
            ...(meta.requestId && { requestId: meta.requestId }),
            ...(meta.guildId && { guildId: meta.guildId }),
            ...(meta.userId && { userId: meta.userId }),
            ...(meta.commandName && { commandName: meta.commandName }),
            ...(meta.error && {
                error: {
                    name: meta.error.name,
                    message: meta.error.message,
                    code: meta.error.code,
                    stack: meta.error.stack?.split('\n').slice(0, 5).join('\n')
                }
            }),
            ...(meta.duration && { durationMs: meta.duration })
        };

        return structured;
    }

    _log(level, message, meta = {}) {
        if (LOG_LEVELS[level] < this.level) return;

        const structured = this._formatMessage(level, message, meta);

        // Console output
        const color = this.colorize ? LOG_COLORS[level] : '';
        const reset = this.colorize ? LOG_COLORS.RESET : '';
        const prefix = `${color}[${structured.timestamp}] [${level}]${reset}`;
        const contextStr = meta.context ? ` [${meta.context}]` : ` [${this.context}]`;

        const consoleMsg = `${prefix}${contextStr} ${message}`;

        if (level === 'ERROR') {
            console.error(consoleMsg);
            if (meta.error?.stack) {
                console.error(meta.error.stack);
            }
        } else if (level === 'WARN') {
            console.warn(consoleMsg);
        } else {
            console.log(consoleMsg);
        }

        // File output (JSON lines format)
        if (this.logToFile) {
            this._writeToFile(structured);
        }

        return structured;
    }

    _writeToFile(structured) {
        const date = new Date().toISOString().split('T')[0];
        const logFile = path.join(this.logDir, `wizbot-${date}.log`);

        try {
            const line = JSON.stringify(structured) + '\n';
            fs.appendFileSync(logFile, line);

            // Rotate if needed
            this._rotateIfNeeded(logFile);
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    _rotateIfNeeded(logFile) {
        try {
            const stats = fs.statSync(logFile);
            if (stats.size > this.maxFileSize) {
                const rotatedPath = `${logFile}.${Date.now()}.old`;
                fs.renameSync(logFile, rotatedPath);
            }
        } catch (error) {
            // Ignore rotation errors
        }
    }

    debug(message, meta = {}) {
        return this._log('DEBUG', message, meta);
    }

    info(message, meta = {}) {
        return this._log('INFO', message, meta);
    }

    warn(message, meta = {}) {
        return this._log('WARN', message, meta);
    }

    error(message, meta = {}) {
        return this._log('ERROR', message, meta);
    }

    /**
     * Create a child logger with additional context.
     * @param {string} context - Additional context name
     * @returns {Object} - Logger methods bound to child context
     */
    child(context) {
        const childContext = `${this.context}:${context}`;
        return {
            debug: (msg, meta = {}) => this.debug(msg, { ...meta, context: childContext }),
            info: (msg, meta = {}) => this.info(msg, { ...meta, context: childContext }),
            warn: (msg, meta = {}) => this.warn(msg, { ...meta, context: childContext }),
            error: (msg, meta = {}) => this.error(msg, { ...meta, context: childContext })
        };
    }

    /**
     * Log command execution with timing.
     * @param {Interaction} interaction - Discord interaction
     * @param {Function} fn - Async function to execute
     * @returns {Promise<any>}
     */
    async logCommand(interaction, fn) {
        const start = Date.now();
        const meta = {
            commandName: interaction.commandName,
            userId: interaction.user.id,
            guildId: interaction.guildId
        };

        this.debug(`Executing command: ${interaction.commandName}`, meta);

        try {
            const result = await fn();
            const duration = Date.now() - start;
            this.info(`Command completed: ${interaction.commandName}`, { ...meta, duration });
            return result;
        } catch (error) {
            const duration = Date.now() - start;
            this.error(`Command failed: ${interaction.commandName}`, { ...meta, duration, error });
            throw error;
        }
    }
}

// Create default logger instance
const logger = new Logger({
    level: process.env.LOG_LEVEL || 'INFO',
    colorize: process.env.LOG_COLORIZE !== 'false',
    logToFile: process.env.LOG_TO_FILE === 'true'
});

module.exports = {
    Logger,
    logger,
    LOG_LEVELS
};
