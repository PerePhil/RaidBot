const assert = require('assert');
const { test } = require('node:test');
const { parseDateTimeToTimestamp } = require('../utils/raidHelpers');

test('chrono-node natural language parsing', async (t) => {
    await t.test('parses "tomorrow at 5pm"', () => {
        const now = new Date('2023-10-25T12:00:00Z');
        const result = parseDateTimeToTimestamp('tomorrow at 5pm', now);
        assert.ok(result);
        assert.ok(result > Math.floor(now.getTime() / 1000));
    });

    await t.test('parses "next friday"', () => {
        const now = new Date('2023-10-25T12:00:00Z');
        const result = parseDateTimeToTimestamp('next friday', now);
        assert.ok(result);
    });

    await t.test('parses "in 2 hours"', () => {
        const now = new Date();
        const result = parseDateTimeToTimestamp('in 2 hours', now);
        const expected = Math.floor(now.getTime() / 1000) + 2 * 60 * 60;
        assert.ok(Math.abs(result - expected) < 5);
    });

    await t.test('prefers chrono over Date() for natural language', () => {
        const now = new Date();
        const result = parseDateTimeToTimestamp('tomorrow at 2', now);
        const nowSeconds = Math.floor(now.getTime() / 1000);
        assert.ok(result > nowSeconds, 'should resolve to a future time');
    });

    await t.test('returns null for invalid dates', () => {
        const result = parseDateTimeToTimestamp('not a date');
        assert.strictEqual(result, null);
    });
});
