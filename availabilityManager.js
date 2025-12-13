const chrono = require('chrono-node');
const { db, prepare } = require('./db/database');

// In-memory cache
const availability = new Map(); // guildId -> Map(userId -> data)

// Prepared statements
let statements = null;

function getStatements() {
    if (statements) return statements;

    statements = {
        getAll: prepare('SELECT * FROM availability'),
        getGuild: prepare('SELECT * FROM availability WHERE guild_id = ?'),
        getUser: prepare('SELECT * FROM availability WHERE guild_id = ? AND user_id = ?'),
        upsert: prepare(`
            INSERT INTO availability (guild_id, user_id, timezone, days, roles, notes, windows)
            VALUES (@guild_id, @user_id, @timezone, @days, @roles, @notes, @windows)
            ON CONFLICT(guild_id, user_id) DO UPDATE SET
                timezone = excluded.timezone,
                days = excluded.days,
                roles = excluded.roles,
                notes = excluded.notes,
                windows = excluded.windows
        `),
        delete: prepare('DELETE FROM availability WHERE guild_id = ? AND user_id = ?')
    };

    return statements;
}

function loadAvailability() {
    availability.clear();
    const stmts = getStatements();
    const rows = stmts.getAll.all();

    rows.forEach(row => {
        if (!availability.has(row.guild_id)) {
            availability.set(row.guild_id, new Map());
        }
        availability.get(row.guild_id).set(row.user_id, {
            timezone: row.timezone || '',
            days: row.days || '',
            roles: row.roles || '',
            notes: row.notes || '',
            windows: row.windows ? JSON.parse(row.windows) : []
        });
    });

    console.log(`Loaded availability for ${availability.size} guilds`);
}

function saveAvailability() {
    // No-op: changes are persisted immediately
}

function setAvailability(guildId, userId, data) {
    const stmts = getStatements();
    const normalized = normalizeAvailability(data);

    stmts.upsert.run({
        guild_id: guildId,
        user_id: userId,
        timezone: normalized?.timezone || null,
        days: normalized?.days || null,
        roles: normalized?.roles || null,
        notes: normalized?.notes || null,
        windows: normalized?.windows ? JSON.stringify(normalized.windows) : null
    });

    // Update cache
    if (!availability.has(guildId)) {
        availability.set(guildId, new Map());
    }
    availability.get(guildId).set(userId, normalized);
}

function getAvailability(guildId, userId) {
    // Check cache first
    const cached = availability.get(guildId)?.get(userId);
    if (cached) return cached;

    // Fallback to database
    const stmts = getStatements();
    const row = stmts.getUser.get(guildId, userId);

    if (!row) return null;

    return {
        timezone: row.timezone || '',
        days: row.days || '',
        roles: row.roles || '',
        notes: row.notes || '',
        windows: row.windows ? JSON.parse(row.windows) : []
    };
}

function deleteAvailability(guildId, userId) {
    const stmts = getStatements();
    stmts.delete.run(guildId, userId);

    // Remove from cache
    const guildMap = availability.get(guildId);
    if (guildMap) {
        guildMap.delete(userId);
    }
}

function usersAvailableAt(guildId, timestampSeconds) {
    // Ensure cache is populated
    if (!availability.has(guildId)) {
        const stmts = getStatements();
        const rows = stmts.getGuild.all(guildId);
        const guildMap = new Map();
        rows.forEach(row => {
            guildMap.set(row.user_id, {
                timezone: row.timezone || '',
                days: row.days || '',
                roles: row.roles || '',
                notes: row.notes || '',
                windows: row.windows ? JSON.parse(row.windows) : []
            });
        });
        availability.set(guildId, guildMap);
    }

    const guildMap = availability.get(guildId);
    if (!guildMap || !timestampSeconds) return [];

    const date = new Date(timestampSeconds * 1000);
    const day = date.getUTCDay();
    const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    const result = [];

    for (const [userId, entry] of guildMap.entries()) {
        const windows = entry?.windows || [];
        const match = windows.some((w) => w.day === day && minutes >= w.start && minutes <= w.end);
        if (match) {
            result.push(userId);
        }
    }
    return result;
}

function normalizeAvailability(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        return attachParsedWindows({ timezone: '', days: '', roles: '', notes: value });
    }
    return attachParsedWindows({
        timezone: value.timezone || '',
        days: value.days || '',
        roles: value.roles || '',
        notes: value.notes || ''
    });
}

function attachParsedWindows(data) {
    const windows = parseAvailabilityWindows(data.days, data.timezone);
    return { ...data, windows };
}

function parseAvailabilityWindows(text, tzHint) {
    if (!text || !text.trim()) return [];
    const lower = text.toLowerCase();
    const segments = lower.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
    const windows = [];
    const timezoneOffset = parseTimezone(tzHint);
    const now = new Date();

    for (const segment of segments) {
        const days = extractDays(segment);
        let times = extractTimes(segment);

        // If days were found but no time specified, default to evenings (common raid time)
        if (days.length > 0 && !times) {
            times = { start: '5pm', end: '10pm' };
        }

        if (days.length === 0 || !times) continue;

        for (const day of days) {
            // Try to parse times directly to minutes first
            const startMinutes = parseTimeToMinutes(times.start);
            const endMinutes = parseTimeToMinutes(times.end);

            if (startMinutes !== null && endMinutes !== null) {
                let adjustedEnd = endMinutes;

                // Special case: "6-12pm" likely means 6pm to midnight, not 6pm to noon
                // If end time is noon (720 mins) and start is in afternoon/evening, treat as midnight
                if (endMinutes === 12 * 60 && startMinutes >= 12 * 60) {
                    adjustedEnd = 24 * 60; // Treat as midnight (end of day)
                }

                // Validate window duration in LOCAL time (before timezone conversion)
                if (adjustedEnd <= startMinutes || adjustedEnd - startMinutes > 12 * 60) {
                    continue; // Invalid window in local time
                }

                // Apply timezone offset for UTC storage
                let startMin = startMinutes;
                let endMin = adjustedEnd;
                if (timezoneOffset !== null) {
                    startMin = (startMinutes - timezoneOffset + 24 * 60) % (24 * 60);
                    endMin = (adjustedEnd - timezoneOffset + 24 * 60) % (24 * 60);
                }

                windows.push({ day, start: startMin, end: endMin, tz: tzHint || '' });
            } else {
                // Fallback to chrono-node for complex expressions
                const base = nextWeekday(now, day);
                const start = chrono.parseDate(times.start, base, { forwardDate: true });
                const end = chrono.parseDate(times.end, base, { forwardDate: true });
                if (!start || !end) continue;

                let startMin = toUtcMinutes(start, timezoneOffset);
                let endMin = toUtcMinutes(end, timezoneOffset);
                // For chrono-parsed times, check the original time difference
                const origStartMin = start.getHours() * 60 + start.getMinutes();
                const origEndMin = end.getHours() * 60 + end.getMinutes();
                if (origEndMin <= origStartMin || origEndMin - origStartMin > 12 * 60) continue;

                windows.push({ day, start: startMin % (24 * 60), end: endMin % (24 * 60), tz: tzHint || '' });
            }
        }
    }
    return windows;
}

function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const s = timeStr.trim().toLowerCase();

    // 24-hour format: "18:00", "1800", "18"
    const military = s.match(/^(\d{1,2}):?(\d{2})?$/);
    if (military) {
        const hour = parseInt(military[1], 10);
        const min = military[2] ? parseInt(military[2], 10) : 0;
        if (hour >= 0 && hour < 24 && min >= 0 && min < 60) {
            return hour * 60 + min;
        }
    }

    // 12-hour format: "6pm", "6:30pm", "6 pm"
    const twelveHour = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (twelveHour) {
        let hour = parseInt(twelveHour[1], 10);
        const min = twelveHour[2] ? parseInt(twelveHour[2], 10) : 0;
        const period = twelveHour[3]?.toLowerCase();

        if (period === 'pm' && hour !== 12) hour += 12;
        if (period === 'am' && hour === 12) hour = 0;

        // If no period specified, use heuristics (assume PM for typical raid hours)
        if (!period) {
            if (hour >= 1 && hour <= 11) hour += 12; // Assume PM
        }

        if (hour >= 0 && hour < 24 && min >= 0 && min < 60) {
            return hour * 60 + min;
        }
    }

    return null;
}


function extractDays(segment) {
    const days = [];
    const dayMap = {
        sun: 0, sunday: 0,
        mon: 1, monday: 1,
        tue: 2, tues: 2, tuesday: 2,
        wed: 3, wednesday: 3, weds: 3,
        thu: 4, thur: 4, thurs: 4, thursday: 4,
        fri: 5, friday: 5,
        sat: 6, saturday: 6
    };

    const lower = segment.toLowerCase();

    // Handle keyword groups first
    if (/weeknight/i.test(lower)) {
        days.push(1, 2, 3, 4); // Mon-Thu
    }
    if (/weekday/i.test(lower)) {
        days.push(1, 2, 3, 4, 5); // Mon-Fri
    }
    if (/weekend/i.test(lower)) {
        days.push(0, 6); // Sun, Sat
    }
    if (/everyday|every\s*day|daily/i.test(lower)) {
        days.push(0, 1, 2, 3, 4, 5, 6);
    }

    // Handle day ranges like "Mon-Fri", "Tue-Thu", "Monday-Friday"
    // Negative lookahead prevents matching "mon 6pm-9pm" as a day range
    const rangePattern = /\b(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r?s?(?:day)?)?|fri(?:day)?|sat(?:urday)?)\s*-\s*(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r?s?(?:day)?)?|fri(?:day)?|sat(?:urday)?)\b/gi;

    let match;
    while ((match = rangePattern.exec(lower)) !== null) {
        const startDay = parseDayName(match[1]);
        const endDay = parseDayName(match[2]);
        if (startDay !== -1 && endDay !== -1) {
            // Handle wraparound (e.g., Fri-Mon)
            if (startDay <= endDay) {
                for (let d = startDay; d <= endDay; d++) {
                    days.push(d);
                }
            } else {
                for (let d = startDay; d <= 6; d++) days.push(d);
                for (let d = 0; d <= endDay; d++) days.push(d);
            }
        }
    }

    // Handle individual day names
    const tokens = lower.split(/[\s,;\/]+/);
    for (const token of tokens) {
        const cleaned = token.replace(/[^a-z]/g, '');
        // Try full match first, then prefix
        if (dayMap[cleaned] !== undefined) {
            days.push(dayMap[cleaned]);
        } else {
            const prefix = cleaned.slice(0, 3);
            if (dayMap[prefix] !== undefined) {
                days.push(dayMap[prefix]);
            }
        }
    }

    return Array.from(new Set(days));
}

function parseDayName(str) {
    const s = str.toLowerCase().replace(/[^a-z]/g, '');
    const map = {
        m: 1, mon: 1, monday: 1,
        t: 2, tu: 2, tue: 2, tues: 2, tuesday: 2,
        w: 3, wed: 3, weds: 3, wednesday: 3,
        th: 4, thu: 4, thur: 4, thurs: 4, thursday: 4,
        f: 5, fri: 5, friday: 5,
        s: 6, sa: 6, sat: 6, saturday: 6,
        su: 0, sun: 0, sunday: 0
    };
    return map[s] !== undefined ? map[s] : -1;
}

function extractTimes(segment) {
    const lower = segment.toLowerCase();

    // Handle relative time terms first
    const relativeTerms = {
        morning: { start: '6am', end: '12pm' },
        mornings: { start: '6am', end: '12pm' },
        afternoon: { start: '12pm', end: '5pm' },
        afternoons: { start: '12pm', end: '5pm' },
        evening: { start: '5pm', end: '10pm' },
        evenings: { start: '5pm', end: '10pm' },
        night: { start: '7pm', end: '11pm' },
        nights: { start: '7pm', end: '11pm' },
        'late night': { start: '9pm', end: '12am' },
        latenight: { start: '9pm', end: '12am' },
        'all day': { start: '10am', end: '10pm' },  // 12 hours
        allday: { start: '10am', end: '10pm' },
        anytime: { start: '10am', end: '10pm' },    // 12 hours
        flexible: { start: '10am', end: '10pm' }    // 12 hours
    };

    for (const [term, times] of Object.entries(relativeTerms)) {
        if (lower.includes(term)) {
            return times;
        }
    }

    // 24-hour format: 1800-2100, 18:00-21:00
    const military = segment.match(/\b(\d{3,4})\s*[-–—to]+\s*(\d{3,4})\b/);
    if (military) {
        const startStr = military[1].padStart(4, '0');
        const endStr = military[2].padStart(4, '0');
        const startHour = parseInt(startStr.slice(0, 2));
        const startMin = parseInt(startStr.slice(2));
        const endHour = parseInt(endStr.slice(0, 2));
        const endMin = parseInt(endStr.slice(2));

        if (startHour < 24 && endHour < 24 && startMin < 60 && endMin < 60) {
            return {
                start: `${startHour}:${startMin.toString().padStart(2, '0')}`,
                end: `${endHour}:${endMin.toString().padStart(2, '0')}`
            };
        }
    }

    // Standard patterns (most flexible)
    const patterns = [
        // "5pm-7pm", "5:00pm-7:00pm", "5pm - 7pm"
        /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–—to]+\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
        // "5-7pm" (end has am/pm, infer start)
        /(\d{1,2}(?::\d{2})?)\s*[-–—to]+\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
        // "5pm to 7pm"
        /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+to\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
        // "from 5pm to 7pm"
        /from\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+to\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
        // "between 5 and 7pm"
        /between\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+and\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
        // "after 5pm" -> 5pm-11pm
        /after\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
        // "before 9pm" -> 12pm-9pm (afternoon assumed)
        /before\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
    ];

    for (let i = 0; i < patterns.length; i++) {
        const match = segment.match(patterns[i]);
        if (match) {
            // Handle "after X" pattern
            if (i === 5 && match[1]) {
                return { start: normalizeTimeStr(match[1]), end: '11pm' };
            }
            // Handle "before X" pattern
            if (i === 6 && match[1]) {
                const endTime = normalizeTimeStr(match[1]);
                // Assume afternoon context if no am/pm
                return { start: '12pm', end: endTime };
            }

            if (match[1] && match[2]) {
                return {
                    start: normalizeTimeStr(match[1]),
                    end: normalizeTimeStr(match[2], match[1])
                };
            }
        }
    }

    return null;
}

function normalizeTimeStr(timeStr, referenceTime = null) {
    let s = timeStr.trim().toLowerCase();

    // Already has am/pm
    if (/[ap]m/.test(s)) {
        return s;
    }

    // Extract hour
    const hourMatch = s.match(/^(\d{1,2})/);
    if (!hourMatch) return s;

    const hour = parseInt(hourMatch[1]);

    // If reference time has am/pm, use same period for ambiguous times
    if (referenceTime && /pm/i.test(referenceTime) && hour <= 12) {
        return `${s}pm`;
    }
    if (referenceTime && /am/i.test(referenceTime) && hour <= 12) {
        return `${s}am`;
    }

    // Heuristic: hours 1-6 are likely PM, 7-11 are likely PM evening, 12 is noon
    if (hour >= 1 && hour <= 6) {
        return `${s}pm`; // 5 -> 5pm
    }
    if (hour >= 7 && hour <= 11) {
        return `${s}pm`; // 7 -> 7pm (evening context more common for raids)
    }
    if (hour === 12) {
        return `${s}pm`; // noon
    }

    return s;
}

function nextWeekday(from, weekday) {
    const date = new Date(from);
    const diff = (weekday + 7 - date.getDay()) % 7 || 7;
    date.setDate(date.getDate() + diff);
    return date;
}

function toUtcMinutes(dateObj, tzOffset) {
    const minutes = dateObj.getUTCHours() * 60 + dateObj.getUTCMinutes();
    if (tzOffset === null || tzOffset === undefined) return minutes;
    return (minutes - tzOffset + 24 * 60) % (24 * 60);
}

function parseTimezone(tz) {
    if (!tz) return null;

    const s = tz.trim().toUpperCase();

    // Named timezone abbreviations (common US ones)
    const namedOffsets = {
        EST: -5 * 60, EDT: -4 * 60,
        CST: -6 * 60, CDT: -5 * 60,
        MST: -7 * 60, MDT: -6 * 60,
        PST: -8 * 60, PDT: -7 * 60,
        AKST: -9 * 60, AKDT: -8 * 60,
        HST: -10 * 60, HDT: -9 * 60,
        ET: -5 * 60, CT: -6 * 60, MT: -7 * 60, PT: -8 * 60, // Common short forms
        GMT: 0, UTC: 0,
        BST: 1 * 60, // British Summer Time
        CET: 1 * 60, CEST: 2 * 60, // Central European
        AEST: 10 * 60, AEDT: 11 * 60, // Australian Eastern
        JST: 9 * 60, // Japan
        IST: 5.5 * 60 // India
    };

    // Check for named timezone
    for (const [name, offset] of Object.entries(namedOffsets)) {
        if (s === name || s.startsWith(name + ' ') || s.endsWith(' ' + name)) {
            return offset;
        }
    }

    // UTC+X or UTC-X format
    const utcMatch = tz.match(/utc\s*([+-]?\d{1,2}(?:[:.]\d{2})?)/i);
    if (utcMatch) {
        return parseOffsetString(utcMatch[1]);
    }

    // GMT+X or GMT-X format
    const gmtMatch = tz.match(/gmt\s*([+-]?\d{1,2}(?:[:.]\d{2})?)/i);
    if (gmtMatch) {
        return parseOffsetString(gmtMatch[1]);
    }

    // Plain offset: +5, -8, +5:30
    const offsetMatch = tz.match(/^([+-]?\d{1,2}(?:[:.]\d{2})?)$/);
    if (offsetMatch) {
        return parseOffsetString(offsetMatch[1]);
    }

    return null;
}

function parseOffsetString(str) {
    // Handle +5:30, -8, +05:00, etc.
    const match = str.match(/([+-]?)(\d{1,2})(?:[:.:](\d{2}))?/);
    if (!match) return null;

    const sign = match[1] === '-' ? -1 : 1;
    const hours = parseInt(match[2], 10);
    const minutes = match[3] ? parseInt(match[3], 10) : 0;

    return sign * (hours * 60 + minutes);
}


// ===== AGGREGATION FUNCTIONS =====

function getGuildAvailability(guildId) {
    // Ensure cache is populated
    if (!availability.has(guildId)) {
        const stmts = getStatements();
        const rows = stmts.getGuild.all(guildId);
        const guildMap = new Map();
        rows.forEach(row => {
            guildMap.set(row.user_id, {
                timezone: row.timezone || '',
                days: row.days || '',
                roles: row.roles || '',
                notes: row.notes || '',
                windows: row.windows ? JSON.parse(row.windows) : []
            });
        });
        availability.set(guildId, guildMap);
    }

    const guildMap = availability.get(guildId);
    if (!guildMap) return [];

    const entries = [];
    for (const [userId, data] of guildMap.entries()) {
        entries.push({ userId, ...data });
    }
    return entries;
}

function getAvailabilityHeatmap(guildId) {
    const entries = getGuildAvailability(guildId);
    const heatmap = {}; // { day: { hour: count } }

    // Initialize heatmap
    for (let day = 0; day < 7; day++) {
        heatmap[day] = {};
        for (let hour = 0; hour < 24; hour++) {
            heatmap[day][hour] = 0;
        }
    }

    // Count users for each hour slot based on parsed windows
    for (const entry of entries) {
        const windows = entry.windows || [];
        for (const window of windows) {
            const startHour = Math.floor(window.start / 60);
            const endHour = Math.ceil(window.end / 60);

            // Handle windows that cross midnight (start > end in UTC)
            if (startHour <= endHour) {
                // Normal case: window within same day
                for (let hour = startHour; hour < endHour && hour < 24; hour++) {
                    heatmap[window.day][hour]++;
                }
            } else {
                // Window crosses midnight - count hours from start to midnight
                for (let hour = startHour; hour < 24; hour++) {
                    heatmap[window.day][hour]++;
                }
                // And from midnight to end (next day, but we attribute to same day for simplicity)
                for (let hour = 0; hour < endHour; hour++) {
                    heatmap[window.day][hour]++;
                }
            }
        }
    }

    // Convert to array format
    const result = [];
    for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
            if (heatmap[day][hour] > 0) {
                result.push({ day, hour, count: heatmap[day][hour] });
            }
        }
    }

    // Sort by count descending
    result.sort((a, b) => b.count - a.count);
    return result;
}

function findOptimalTimes(guildId, options = {}) {
    const { minUsers = 1, duration = 60, preferredDays = null, limit = 10 } = options;
    const heatmap = getAvailabilityHeatmap(guildId);

    // Filter by minimum users
    let filtered = heatmap.filter(slot => slot.count >= minUsers);

    // Filter by preferred days if specified
    if (preferredDays && preferredDays.length > 0) {
        filtered = filtered.filter(slot => preferredDays.includes(slot.day));
    }

    // Return top slots
    return filtered.slice(0, limit).map(slot => ({
        day: slot.day,
        dayName: getDayName(slot.day),
        hour: slot.hour,
        timeStr: formatHour(slot.hour),
        availableUsers: slot.count
    }));
}

function getDayName(day) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[day] || 'Unknown';
}

function formatHour(hour) {
    if (hour === 0) return '12:00 AM';
    if (hour === 12) return '12:00 PM';
    if (hour < 12) return `${hour}:00 AM`;
    return `${hour - 12}:00 PM`;
}

module.exports = {
    loadAvailability,
    saveAvailability,
    setAvailability,
    getAvailability,
    deleteAvailability,
    usersAvailableAt,
    getGuildAvailability,
    getAvailabilityHeatmap,
    findOptimalTimes,
    parseTimezone
};
