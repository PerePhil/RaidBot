const test = require('node:test');
const assert = require('node:assert/strict');

// Initialize database schema before importing modules that use it
const { initializeSchema } = require('../db/database');
initializeSchema();

const availability = require('../availabilityManager');

test('parses weekday windows and matches usersAvailableAt', () => {
    const guildId = 'guild1';
    availability.setAvailability(guildId, 'userA', { timezone: 'UTC-5', days: 'Mon 6pm-9pm', roles: '', notes: '' });
    availability.setAvailability(guildId, 'userB', { timezone: 'UTC', days: 'weekend 12-2pm', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'userA');
    assert.ok(a && a.windows && a.windows.length > 0);
});

test('getGuildAvailability returns all users', () => {
    const guildId = 'guildAgg1';
    availability.setAvailability(guildId, 'user1', { timezone: 'EST', days: 'Mon 7pm-10pm', roles: 'DPS', notes: '' });
    availability.setAvailability(guildId, 'user2', { timezone: 'EST', days: 'Mon 7pm-10pm', roles: 'Tank', notes: '' });
    availability.setAvailability(guildId, 'user3', { timezone: 'PST', days: 'Tue 6pm-9pm', roles: 'Healer', notes: '' });

    const all = availability.getGuildAvailability(guildId);
    assert.equal(all.length, 3, 'Should have 3 users');
    assert.ok(all.some(u => u.userId === 'user1'));
    assert.ok(all.some(u => u.userId === 'user2'));
    assert.ok(all.some(u => u.userId === 'user3'));
});

test('getAvailabilityHeatmap aggregates time slots', () => {
    const guildId = 'guildHeatmap1';
    // Both users available Mon 7-9pm
    availability.setAvailability(guildId, 'huser1', { timezone: 'UTC', days: 'Mon 7pm-9pm', roles: '', notes: '' });
    availability.setAvailability(guildId, 'huser2', { timezone: 'UTC', days: 'Mon 7pm-9pm', roles: '', notes: '' });

    const heatmap = availability.getAvailabilityHeatmap(guildId);
    assert.ok(heatmap.length > 0, 'Heatmap should have entries');

    // Monday = 1, should have slots with count 2
    const mondaySlots = heatmap.filter(h => h.day === 1);
    assert.ok(mondaySlots.some(s => s.count === 2), 'Should have slots with 2 users');
});

test('findOptimalTimes returns sorted slots', () => {
    const guildId = 'guildOptimal1';
    // 3 users on Saturday, 1 on Sunday
    availability.setAvailability(guildId, 'opt1', { timezone: 'UTC', days: 'Sat 2pm-4pm', roles: '', notes: '' });
    availability.setAvailability(guildId, 'opt2', { timezone: 'UTC', days: 'Sat 2pm-4pm', roles: '', notes: '' });
    availability.setAvailability(guildId, 'opt3', { timezone: 'UTC', days: 'Sat 2pm-4pm', roles: '', notes: '' });
    availability.setAvailability(guildId, 'opt4', { timezone: 'UTC', days: 'Sun 3pm-5pm', roles: '', notes: '' });

    const optimal = availability.findOptimalTimes(guildId, { minUsers: 2, limit: 5 });

    assert.ok(optimal.length > 0, 'Should find optimal times');
    assert.equal(optimal[0].dayName, 'Saturday', 'Saturday should be first (most users)');
    assert.equal(optimal[0].availableUsers, 3, 'Should have 3 available users');
});

// ===== EDGE CASE TESTS =====

test('parses day ranges like Mon-Fri', () => {
    const guildId = 'guildRange1';
    availability.setAvailability(guildId, 'rangeUser', { timezone: 'EST', days: 'Mon-Fri 6pm-9pm', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'rangeUser');
    // Should have 5 windows (Mon, Tue, Wed, Thu, Fri)
    assert.ok(a.windows && a.windows.length === 5, 'Should have 5 day windows for Mon-Fri');
});

test('parses weekdays keyword', () => {
    const guildId = 'guildWeekdays';
    availability.setAvailability(guildId, 'wdUser', { timezone: 'UTC', days: 'weekdays 5-7pm', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'wdUser');
    assert.ok(a.windows && a.windows.length === 5, 'weekdays should parse to 5 days');
});

test('parses everyday/daily keyword', () => {
    const guildId = 'guildDaily';
    availability.setAvailability(guildId, 'dailyUser', { timezone: 'UTC', days: 'everyday 8pm-10pm', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'dailyUser');
    assert.ok(a.windows && a.windows.length === 7, 'everyday should parse to 7 days');
});

test('parses relative time terms like evenings', () => {
    const guildId = 'guildEvenings';
    availability.setAvailability(guildId, 'eveUser', { timezone: 'UTC', days: 'Mon evenings', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'eveUser');
    assert.ok(a.windows && a.windows.length > 0, 'evenings should parse');
});

test('parses 24-hour military time', () => {
    const guildId = 'guildMilitary';
    availability.setAvailability(guildId, 'milUser', { timezone: 'UTC', days: 'Sat 1800-2100', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'milUser');
    assert.ok(a.windows && a.windows.length > 0, '24-hour time should parse');
});

test('parses "after X" pattern', () => {
    const guildId = 'guildAfter';
    availability.setAvailability(guildId, 'afterUser', { timezone: 'UTC', days: 'Fri after 7pm', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'afterUser');
    assert.ok(a.windows && a.windows.length > 0, '"after 7pm" should parse');
});

test('parses "between X and Y" pattern', () => {
    const guildId = 'guildBetween';
    availability.setAvailability(guildId, 'betweenUser', { timezone: 'UTC', days: 'Sat between 2 and 6pm', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'betweenUser');
    assert.ok(a.windows && a.windows.length > 0, '"between X and Y" should parse');
});

test('handles named timezone abbreviations', () => {
    const guildId = 'guildTZ1';
    availability.setAvailability(guildId, 'tzUser1', { timezone: 'EST', days: 'Mon 7pm-9pm', roles: '', notes: '' });
    availability.setAvailability(guildId, 'tzUser2', { timezone: 'PST', days: 'Tue 6pm-8pm', roles: '', notes: '' });

    const a1 = availability.getAvailability(guildId, 'tzUser1');
    const a2 = availability.getAvailability(guildId, 'tzUser2');
    assert.ok(a1.windows && a1.windows.length > 0, 'EST should be recognized');
    assert.ok(a2.windows && a2.windows.length > 0, 'PST should be recognized');
});

test('parses times without am/pm using context', () => {
    const guildId = 'guildNoAMPM';
    availability.setAvailability(guildId, 'noAmPm', { timezone: 'UTC', days: 'Sat 5-7', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'noAmPm');
    // Should infer PM for typical raid hours
    assert.ok(a.windows && a.windows.length > 0, 'Should parse times without am/pm');
});

test('handles multiple time entries separated by comma', () => {
    const guildId = 'guildMulti';
    availability.setAvailability(guildId, 'multiUser', { timezone: 'UTC', days: 'Mon 6-8pm, Wed 7-9pm, Sat afternoon', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'multiUser');
    assert.ok(a.windows && a.windows.length >= 2, 'Multiple entries should create multiple windows');
});

test('handles relative time terms on individual days', () => {
    const guildId = 'guildFlex';
    // Note: relative terms work best with explicit day names
    availability.setAvailability(guildId, 'flexUser', { timezone: 'UTC', days: 'Sat anytime, Sun anytime', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'flexUser');
    assert.ok(a.windows && a.windows.length >= 2, 'anytime should parse for weekend days');
});

test('handles full day names', () => {
    const guildId = 'guildFull';
    availability.setAvailability(guildId, 'fullUser', { timezone: 'UTC', days: 'Saturday 2pm-5pm, Sunday 3pm-6pm', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'fullUser');
    assert.ok(a.windows && a.windows.length === 2, 'Full day names should parse');
});

// ===== TIMEZONE CONVERSION TESTS =====

test('parseTimezone returns correct offset for EST', () => {
    const offset = availability.parseTimezone('EST');
    assert.equal(offset, -300, 'EST should be -300 minutes (UTC-5)');
});

test('parseTimezone returns correct offset for PST', () => {
    const offset = availability.parseTimezone('PST');
    assert.equal(offset, -480, 'PST should be -480 minutes (UTC-8)');
});

test('parseTimezone returns correct offset for UTC', () => {
    const offset = availability.parseTimezone('UTC');
    assert.equal(offset, 0, 'UTC should be 0 minutes');
});

test('parseTimezone handles UTC+X format', () => {
    const offset = availability.parseTimezone('UTC+5');
    assert.equal(offset, 300, 'UTC+5 should be 300 minutes');
});

test('parseTimezone handles UTC-X format', () => {
    const offset = availability.parseTimezone('UTC-8');
    assert.equal(offset, -480, 'UTC-8 should be -480 minutes');
});

test('parseTimezone handles plain offset format', () => {
    const offset = availability.parseTimezone('-5');
    assert.equal(offset, -300, '-5 should be -300 minutes');
});

test('parseTimezone returns null for empty input', () => {
    const offset = availability.parseTimezone('');
    assert.equal(offset, null, 'Empty string should return null');
});

test('parseTimezone returns null for null input', () => {
    const offset = availability.parseTimezone(null);
    assert.equal(offset, null, 'Null should return null');
});

test('stores times in UTC and converts correctly for EST user', () => {
    const guildId = 'guildTzConvert1';
    // User enters 6pm-9pm EST
    availability.setAvailability(guildId, 'estUser', { timezone: 'EST', days: 'Mon 6pm-9pm', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'estUser');

    assert.ok(a.windows && a.windows.length > 0, 'Should have parsed windows');

    // 6pm EST = 11pm UTC (23:00), 9pm EST = 2am UTC next day (02:00)
    // But since we store as minutes: 6pm EST = 18:00 local = 23:00 UTC = 1380 minutes
    const window = a.windows[0];
    assert.equal(window.start, 1380, '6pm EST should be stored as 1380 minutes (11pm UTC)');
});

test('stores times in UTC and converts correctly for PST user', () => {
    const guildId = 'guildTzConvert2';
    // User enters 6pm-9pm PST
    availability.setAvailability(guildId, 'pstUser', { timezone: 'PST', days: 'Tue 6pm-9pm', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'pstUser');

    assert.ok(a.windows && a.windows.length > 0, 'Should have parsed windows');

    // 6pm PST = 2am UTC (02:00 next day) = 120 minutes
    const window = a.windows[0];
    assert.equal(window.start, 120, '6pm PST should be stored as 120 minutes (2am UTC)');
});

test('weekend availability parses both Saturday and Sunday', () => {
    const guildId = 'guildWeekend';
    availability.setAvailability(guildId, 'weekendUser', { timezone: 'EST', days: 'weekends 6-11pm', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'weekendUser');

    assert.ok(a.windows && a.windows.length === 2, 'weekends should parse to 2 days (Sat and Sun)');

    // Check both Saturday (6) and Sunday (0) are present
    const days = a.windows.map(w => w.day).sort();
    assert.deepEqual(days, [0, 6], 'Should have Sunday (0) and Saturday (6)');
});

test('6-11PM parses as 6pm to 11pm, not midnight', () => {
    const guildId = 'guildTimeRange';
    availability.setAvailability(guildId, 'rangeUser', { timezone: 'UTC', days: 'Sat 6-11pm', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'rangeUser');

    assert.ok(a.windows && a.windows.length > 0, 'Should have parsed windows');

    const window = a.windows[0];
    // 6pm = 18:00 = 1080 minutes, 11pm = 23:00 = 1380 minutes
    assert.equal(window.start, 1080, '6pm should be 1080 minutes');
    assert.equal(window.end, 1380, '11pm should be 1380 minutes');
});

test('timezone offset correctly applied when storing', () => {
    const guildId = 'guildTzStorage';
    // Same time, different timezones
    availability.setAvailability(guildId, 'utcUser', { timezone: 'UTC', days: 'Mon 8pm-10pm', roles: '', notes: '' });
    availability.setAvailability(guildId, 'estUser2', { timezone: 'EST', days: 'Mon 8pm-10pm', roles: '', notes: '' });

    const utcData = availability.getAvailability(guildId, 'utcUser');
    const estData = availability.getAvailability(guildId, 'estUser2');

    // UTC user: 8pm = 1200 minutes
    // EST user: 8pm EST = 1am UTC = 60 minutes (next day crosses midnight)
    assert.equal(utcData.windows[0].start, 1200, 'UTC 8pm should be 1200 minutes');
    assert.equal(estData.windows[0].start, 60, 'EST 8pm should be stored as 60 minutes (1am UTC)');
});
