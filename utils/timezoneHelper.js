'use strict';

/**
 * Get the UTC offset in minutes for an IANA timezone at a given instant.
 * Positive = ahead of UTC (e.g., +60 for CET), negative = behind (e.g., -300 for EST).
 */
function getTimezoneOffsetMinutes(timezone, date = new Date()) {
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    return Math.round((tzDate - utcDate) / 60000);
}

/**
 * Validate that a string is a valid IANA timezone.
 */
function isValidTimezone(timezone) {
    if (!timezone || typeof timezone !== 'string') return false;
    try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
        return true;
    } catch {
        return false;
    }
}

module.exports = { getTimezoneOffsetMinutes, isValidTimezone };
