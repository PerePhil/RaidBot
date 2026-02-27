const assert = require('assert');
const { test } = require('node:test');
const { getTimezoneOffsetMinutes, isValidTimezone } = require('../utils/timezoneHelper');
const { parseDateTimeToTimestamp } = require('../utils/raidHelpers');

test('timezone helper functions', async (t) => {
    await t.test('getTimezoneOffsetMinutes returns -300 for EST in winter', () => {
        const winter = new Date('2026-01-15T12:00:00Z');
        const offset = getTimezoneOffsetMinutes('America/New_York', winter);
        assert.strictEqual(offset, -300);
    });

    await t.test('getTimezoneOffsetMinutes returns -240 for EDT in summer', () => {
        const summer = new Date('2026-07-15T12:00:00Z');
        const offset = getTimezoneOffsetMinutes('America/New_York', summer);
        assert.strictEqual(offset, -240);
    });

    await t.test('getTimezoneOffsetMinutes returns 0 for UTC', () => {
        const offset = getTimezoneOffsetMinutes('UTC');
        assert.strictEqual(offset, 0);
    });

    await t.test('isValidTimezone accepts valid IANA names', () => {
        assert.strictEqual(isValidTimezone('America/New_York'), true);
        assert.strictEqual(isValidTimezone('America/Chicago'), true);
        assert.strictEqual(isValidTimezone('UTC'), true);
        assert.strictEqual(isValidTimezone('Europe/London'), true);
    });

    await t.test('isValidTimezone rejects invalid names', () => {
        assert.strictEqual(isValidTimezone('Not/A/Timezone'), false);
        assert.strictEqual(isValidTimezone(''), false);
    });
});

test('parseDateTimeToTimestamp with timezone', async (t) => {
    await t.test('with EST timezone parses 7pm correctly', () => {
        // Reference: Jan 15 2026 noon UTC
        const ref = new Date('2026-01-15T12:00:00Z');
        const result = parseDateTimeToTimestamp('7pm', ref, 'America/New_York');
        // 7pm EST = midnight UTC next day (UTC-5)
        const resultDate = new Date(result * 1000);
        assert.strictEqual(resultDate.getUTCHours(), 0);
        assert.strictEqual(resultDate.getUTCDate(), 16);
    });

    await t.test('with Pacific timezone parses 7pm correctly', () => {
        const ref = new Date('2026-01-15T12:00:00Z');
        const result = parseDateTimeToTimestamp('7pm', ref, 'America/Los_Angeles');
        // 7pm PST = 3am UTC next day (UTC-8)
        const resultDate = new Date(result * 1000);
        assert.strictEqual(resultDate.getUTCHours(), 3);
        assert.strictEqual(resultDate.getUTCDate(), 16);
    });

    await t.test('without timezone still works', () => {
        const ref = new Date('2026-01-15T12:00:00Z');
        const result = parseDateTimeToTimestamp('7pm', ref);
        assert.ok(result);
    });

    await t.test('with timezone handles raw unix timestamp', () => {
        const result = parseDateTimeToTimestamp('1731196800', new Date(), 'America/New_York');
        assert.strictEqual(result, 1731196800);
    });
});
