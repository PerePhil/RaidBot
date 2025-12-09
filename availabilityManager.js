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
        const times = extractTimes(segment);
        if (days.length === 0 || !times) continue;

        for (const day of days) {
            const base = nextWeekday(now, day);
            const start = chrono.parseDate(times.start, base, { forwardDate: true });
            const end = chrono.parseDate(times.end, base, { forwardDate: true });
            if (!start || !end) continue;
            let startMin = toUtcMinutes(start, timezoneOffset);
            let endMin = toUtcMinutes(end, timezoneOffset);
            if (endMin <= startMin) continue;
            if (endMin - startMin > 12 * 60) continue;
            windows.push({ day, start: startMin % (24 * 60), end: endMin % (24 * 60), tz: tzHint || '' });
        }
    }
    return windows;
}

function extractDays(segment) {
    const days = [];
    const map = {
        mon: 1, tue: 2, tues: 2, wed: 3, thur: 4, thu: 4, fri: 5, sat: 6, sun: 0
    };
    const tokens = segment.split(/\s+/);
    for (const token of tokens) {
        if (token.includes('weeknight')) {
            days.push(1, 2, 3, 4);
        }
        if (token.includes('weekday')) {
            days.push(1, 2, 3, 4, 5);
        }
        if (token.includes('weekend')) {
            days.push(0, 6);
        }
        const key = token.replace(/[^a-z]/g, '').slice(0, 3);
        if (map[key] !== undefined) {
            days.push(map[key]);
        }
    }
    return Array.from(new Set(days));
}

function extractTimes(segment) {
    const match = segment.match(/(\d{1,2}(:\d{2})?\s*(am|pm)?)[\s\-to]+(\d{1,2}(:\d{2})?\s*(am|pm)?)/i);
    if (!match) return null;
    return { start: match[1], end: match[4] };
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
    const match = tz.match(/utc\s*([+-]\d{1,2})/i);
    if (match) return parseInt(match[1], 10) * 60;
    const offsetMatch = tz.match(/([+-]\d{1,2}):?(\d{2})?/);
    if (offsetMatch) {
        const hours = parseInt(offsetMatch[1], 10);
        const minutes = offsetMatch[2] ? parseInt(offsetMatch[2], 10) : 0;
        return hours * 60 + Math.sign(hours) * minutes;
    }
    return null;
}

module.exports = {
    loadAvailability,
    saveAvailability,
    setAvailability,
    getAvailability,
    usersAvailableAt
};
