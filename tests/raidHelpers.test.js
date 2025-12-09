const test = require('node:test');
const assert = require('node:assert/strict');

const { parseDateTimeToTimestamp } = require('../utils/raidHelpers');

test('parseDateTimeToTimestamp returns unix value for numeric input', () => {
    const value = parseDateTimeToTimestamp('1731196800');
    assert.equal(value, 1731196800);
});

test('parseDateTimeToTimestamp handles ISO strings', () => {
    const iso = '2025-01-01T00:00:00Z';
    const expected = Math.floor(new Date(iso).getTime() / 1000);
    const result = parseDateTimeToTimestamp(iso);
    assert.equal(result, expected);
});

test('parseDateTimeToTimestamp schedules upcoming weekday relative to reference date', () => {
    const reference = new Date('2025-01-01T00:00:00Z'); // Wednesday
    const result = parseDateTimeToTimestamp('Friday 6:00 PM', reference);
    const base = Math.floor(reference.getTime() / 1000);
    assert.ok(result > base);
    assert.ok(result - base <= 7 * 24 * 60 * 60);
});
