/**
 * Input validation utilities for raid data, user inputs, and configuration.
 */

const { ERROR_MESSAGES } = require('./errorMessages');

/**
 * Validation result object.
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the input is valid
 * @property {string} [error] - Error message if invalid
 * @property {any} [value] - Sanitized/transformed value if valid
 */

/**
 * Validate a Discord snowflake ID.
 * @param {string} id - The ID to validate
 * @param {string} type - Type label for error messages (e.g., 'user', 'guild')
 * @returns {ValidationResult}
 */
function validateSnowflake(id, type = 'ID') {
    if (!id || typeof id !== 'string') {
        return { valid: false, error: `Invalid ${type}: must be a non-empty string` };
    }

    // Discord snowflakes are 17-20 digits
    if (!/^\d{17,20}$/.test(id)) {
        return { valid: false, error: `Invalid ${type}: must be a valid Discord ID` };
    }

    return { valid: true, value: id };
}

/**
 * Validate a raid ID format.
 * @param {string} raidId - The raid ID to validate
 * @returns {ValidationResult}
 */
function validateRaidId(raidId) {
    if (!raidId || typeof raidId !== 'string') {
        return { valid: false, error: ERROR_MESSAGES.RAID_NOT_FOUND };
    }

    const trimmed = raidId.trim().toUpperCase();

    // Raid IDs are typically 4-8 alphanumeric characters
    if (!/^[A-Z0-9]{4,8}$/.test(trimmed)) {
        return { valid: false, error: 'Invalid Raid ID format. Check the ID at the bottom of the signup message.' };
    }

    return { valid: true, value: trimmed };
}

/**
 * Validate a Unix timestamp.
 * @param {number|string} timestamp - The timestamp to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.allowPast - Allow past timestamps (default: false)
 * @returns {ValidationResult}
 */
function validateTimestamp(timestamp, options = {}) {
    const allowPast = options.allowPast ?? false;

    let ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;

    if (typeof ts !== 'number' || Number.isNaN(ts)) {
        return { valid: false, error: ERROR_MESSAGES.INVALID_TIME };
    }

    // Validate reasonable range (year 2020 to 2100)
    const minTimestamp = 1577836800; // 2020-01-01
    const maxTimestamp = 4102444800; // 2100-01-01

    if (ts < minTimestamp || ts > maxTimestamp) {
        return { valid: false, error: ERROR_MESSAGES.INVALID_TIME };
    }

    const now = Math.floor(Date.now() / 1000);
    if (!allowPast && ts < now) {
        return { valid: false, error: ERROR_MESSAGES.TIME_IN_PAST };
    }

    return { valid: true, value: ts };
}

/**
 * Validate slot count for raids.
 * @param {number|string} slots - Number of slots
 * @param {Object} options - Validation options
 * @param {number} options.min - Minimum slots (default: 1)
 * @param {number} options.max - Maximum slots (default: 12)
 * @returns {ValidationResult}
 */
function validateSlotCount(slots, options = {}) {
    const min = options.min ?? 1;
    const max = options.max ?? 12;

    const count = typeof slots === 'string' ? parseInt(slots, 10) : slots;

    if (typeof count !== 'number' || Number.isNaN(count)) {
        return { valid: false, error: 'Slot count must be a number' };
    }

    if (count < min) {
        return { valid: false, error: `Slot count must be at least ${min}` };
    }

    if (count > max) {
        return { valid: false, error: `Slot count cannot exceed ${max}` };
    }

    return { valid: true, value: count };
}

/**
 * Sanitize a display name for safe embed display.
 * Prevents embed injection and removes problematic characters.
 * @param {string} name - The display name to sanitize
 * @param {number} maxLength - Maximum length (default: 32)
 * @returns {string}
 */
function sanitizeDisplayName(name, maxLength = 32) {
    if (!name || typeof name !== 'string') {
        return 'Unknown';
    }

    return name
        // Remove markdown formatting characters
        .replace(/[*_~`|]/g, '')
        // Remove Discord mentions
        .replace(/<[@#&!]?\d+>/g, '')
        // Remove zero-width characters
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        // Collapse multiple spaces
        .replace(/\s+/g, ' ')
        // Trim and limit length
        .trim()
        .slice(0, maxLength) || 'Unknown';
}

/**
 * Validate raid template type.
 * @param {string} type - The template type
 * @param {string[]} allowedTypes - List of allowed types
 * @returns {ValidationResult}
 */
function validateTemplateType(type, allowedTypes) {
    if (!type || typeof type !== 'string') {
        return { valid: false, error: 'Template type is required' };
    }

    const normalized = type.toLowerCase();

    if (!allowedTypes.map(t => t.toLowerCase()).includes(normalized)) {
        return {
            valid: false,
            error: `Invalid template type. Choose from: ${allowedTypes.join(', ')}`
        };
    }

    return { valid: true, value: normalized };
}

/**
 * Validate reminder duration in seconds.
 * @param {number|string} seconds - Duration in seconds
 * @param {Object} options - Validation options
 * @param {number} options.min - Minimum seconds (default: 60)
 * @param {number} options.max - Maximum seconds (default: 86400)
 * @returns {ValidationResult}
 */
function validateReminderDuration(seconds, options = {}) {
    const min = options.min ?? 60;       // 1 minute
    const max = options.max ?? 86400;    // 24 hours

    const duration = typeof seconds === 'string' ? parseInt(seconds, 10) : seconds;

    if (typeof duration !== 'number' || Number.isNaN(duration)) {
        return { valid: false, error: 'Duration must be a number' };
    }

    if (duration < min) {
        return { valid: false, error: `Duration must be at least ${Math.floor(min / 60)} minutes` };
    }

    if (duration > max) {
        return { valid: false, error: `Duration cannot exceed ${Math.floor(max / 3600)} hours` };
    }

    return { valid: true, value: duration };
}

/**
 * Validate timezone string.
 * @param {string} timezone - Timezone string (e.g., "EST", "America/New_York")
 * @returns {ValidationResult}
 */
function validateTimezone(timezone) {
    if (!timezone || typeof timezone !== 'string') {
        return { valid: true, value: '' }; // Optional field
    }

    const trimmed = timezone.trim();

    // Check for reasonable length and valid characters
    if (trimmed.length > 50) {
        return { valid: false, error: 'Timezone must be 50 characters or less' };
    }

    // Prevent special characters that could break embeds
    if (/[<>@#`*_~|]/.test(trimmed)) {
        return { valid: false, error: 'Timezone contains invalid characters' };
    }

    return { valid: true, value: trimmed };
}

/**
 * Validate days of week string.
 * @param {string} days - Comma-separated days (e.g., "Mon, Tue, Wed")
 * @returns {ValidationResult}
 */
function validateDays(days) {
    if (!days || typeof days !== 'string') {
        return { valid: true, value: '' }; // Optional field
    }

    const trimmed = days.trim();

    if (trimmed.length > 100) {
        return { valid: false, error: 'Days must be 100 characters or less' };
    }

    // Prevent special characters that could break embeds
    if (/[<>@#`*_~|]/.test(trimmed)) {
        return { valid: false, error: 'Days contains invalid characters' };
    }

    return { valid: true, value: trimmed };
}

/**
 * Validate roles/preferences string.
 * @param {string} roles - Comma-separated roles
 * @returns {ValidationResult}
 */
function validateRoles(roles) {
    if (!roles || typeof roles !== 'string') {
        return { valid: true, value: '' }; // Optional field
    }

    const trimmed = roles.trim();

    if (trimmed.length > 200) {
        return { valid: false, error: 'Roles must be 200 characters or less' };
    }

    // Prevent special characters that could break embeds
    if (/[<>@#`*_~|]/.test(trimmed)) {
        return { valid: false, error: 'Roles contains invalid characters' };
    }

    return { valid: true, value: trimmed };
}

/**
 * Sanitize generic text input for safe storage and display.
 * @param {string} input - Text input to sanitize
 * @param {number} maxLength - Maximum length (default: 2000)
 * @returns {string}
 */
function sanitizeInput(input, maxLength = 2000) {
    if (!input || typeof input !== 'string') {
        return '';
    }

    return input
        // Remove Discord mentions
        .replace(/<[@#&!]?\d+>/g, '')
        // Remove zero-width characters
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        // Collapse multiple spaces
        .replace(/\s+/g, ' ')
        // Trim and limit length
        .trim()
        .slice(0, maxLength);
}

/**
 * Batch validate multiple inputs.
 * @param {Object} inputs - Object with input values
 * @param {Object} validators - Object with validator configs
 * @returns {{valid: boolean, errors: Object, values: Object}}
 */
function validateBatch(inputs, validators) {
    const errors = {};
    const values = {};
    let valid = true;

    for (const [key, config] of Object.entries(validators)) {
        const value = inputs[key];
        const result = config.validator(value, config.options);

        if (!result.valid) {
            valid = false;
            errors[key] = result.error;
        } else {
            values[key] = result.value;
        }
    }

    return { valid, errors, values };
}

module.exports = {
    validateSnowflake,
    validateRaidId,
    validateTimestamp,
    validateSlotCount,
    sanitizeDisplayName,
    validateTemplateType,
    validateReminderDuration,
    validateTimezone,
    validateDays,
    validateRoles,
    sanitizeInput,
    validateBatch
};
