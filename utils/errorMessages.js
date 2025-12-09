/**
 * User-friendly error messages for common error scenarios.
 */

const ERROR_MESSAGES = {
    // Permission errors
    MISSING_PERMISSIONS: 'You don\'t have permission to use this command. Ask a server admin for help.',
    MISSING_MANAGE_GUILD: 'This command requires the "Manage Server" permission or an approved admin role.',
    BOT_MISSING_PERMISSIONS: 'I\'m missing the required permissions to do that. Please check my role settings.',

    // Raid errors
    RAID_NOT_FOUND: 'Couldn\'t find that raid. Double-check the Raid ID at the bottom of the signup message.',
    RAID_ALREADY_CLOSED: 'This raid is already closed. Use the management panel to reopen it if needed.',
    RAID_ALREADY_OPEN: 'This raid is already open for signups.',
    RAID_FULL: 'This raid is full! You\'ve been added to the waitlist and will be notified if a spot opens.',

    // User errors
    USER_NOT_FOUND: 'Couldn\'t find that user. Make sure they\'re in this server.',
    USER_ALREADY_SIGNED_UP: 'That user is already signed up for this raid.',
    USER_NOT_SIGNED_UP: 'That user isn\'t signed up for this raid.',

    // Channel errors
    CHANNEL_NOT_CONFIGURED: 'No signup channel is configured. Use `/setchannel` to set one up.',
    CHANNEL_NOT_FOUND: 'The configured channel couldn\'t be found. It may have been deleted.',
    MESSAGE_NOT_FOUND: 'Couldn\'t find the signup message. It may have been deleted.',

    // Time errors
    INVALID_TIME: 'I couldn\'t understand that time. Try formats like "tomorrow 7pm", "Friday 6:30", or a Unix timestamp.',
    TIME_IN_PAST: 'That time is in the past. Please choose a future date and time.',

    // Rate limiting
    RATE_LIMITED: 'Slow down! Please wait a moment before trying again.',
    TOO_MANY_REACTIONS: 'You\'re reacting too quickly. Wait a few seconds and try again.',

    // Generic
    UNKNOWN_ERROR: 'Something went wrong. Please try again in a moment.',
    TIMEOUT: 'This action timed out. Please try again.',
    DM_FAILED: 'I couldn\'t send you a DM. Please check your privacy settings.'
};

/**
 * Get a user-friendly error message.
 * @param {string} code - Error code from ERROR_MESSAGES
 * @param {Object} context - Optional context for string interpolation
 * @returns {string}
 */
function getErrorMessage(code, context = {}) {
    let message = ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN_ERROR;

    // Simple template replacement
    for (const [key, value] of Object.entries(context)) {
        message = message.replace(`{${key}}`, value);
    }

    return message;
}

/**
 * Format an error for display to users.
 * @param {Error|string} error - The error object or code
 * @param {Object} context - Optional context
 * @returns {string}
 */
function formatError(error, context = {}) {
    if (typeof error === 'string') {
        return getErrorMessage(error, context);
    }

    // Map common Discord.js error codes
    if (error.code === 50007) {
        return ERROR_MESSAGES.DM_FAILED;
    }
    if (error.code === 50001) {
        return ERROR_MESSAGES.BOT_MISSING_PERMISSIONS;
    }
    if (error.code === 10008) {
        return ERROR_MESSAGES.MESSAGE_NOT_FOUND;
    }

    return ERROR_MESSAGES.UNKNOWN_ERROR;
}

/**
 * Check if an error should be shown to the user.
 * Some errors are internal and shouldn't be exposed.
 * @param {Error} error
 * @returns {boolean}
 */
function isUserFacingError(error) {
    // Rate limits and known codes are user-facing
    const userFacingCodes = [50007, 50001, 10008, 50013];
    return userFacingCodes.includes(error.code);
}

module.exports = {
    ERROR_MESSAGES,
    getErrorMessage,
    formatError,
    isUserFacingError
};
