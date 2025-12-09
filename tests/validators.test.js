const test = require('node:test');
const assert = require('node:assert/strict');
const {
    validateSnowflake,
    validateRaidId,
    validateTimestamp,
    validateSlotCount,
    sanitizeDisplayName,
    validateTemplateType,
    validateReminderDuration,
    validateBatch
} = require('../utils/validators');

// validateSnowflake tests
test('validateSnowflake accepts valid 18-digit ID', () => {
    const result = validateSnowflake('123456789012345678', 'user');
    assert.equal(result.valid, true);
    assert.equal(result.value, '123456789012345678');
});

test('validateSnowflake accepts valid 19-digit ID', () => {
    const result = validateSnowflake('1234567890123456789', 'guild');
    assert.equal(result.valid, true);
});

test('validateSnowflake rejects too short ID', () => {
    const result = validateSnowflake('12345', 'user');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('user'));
});

test('validateSnowflake rejects non-numeric ID', () => {
    const result = validateSnowflake('abc456789012345678', 'channel');
    assert.equal(result.valid, false);
});

test('validateSnowflake rejects null/undefined', () => {
    assert.equal(validateSnowflake(null).valid, false);
    assert.equal(validateSnowflake(undefined).valid, false);
});

// validateRaidId tests
test('validateRaidId accepts valid 4-char uppercase ID', () => {
    const result = validateRaidId('AB12');
    assert.equal(result.valid, true);
    assert.equal(result.value, 'AB12');
});

test('validateRaidId normalizes to uppercase', () => {
    const result = validateRaidId('abc123');
    assert.equal(result.valid, true);
    assert.equal(result.value, 'ABC123');
});

test('validateRaidId accepts 8-char ID', () => {
    const result = validateRaidId('ABCD1234');
    assert.equal(result.valid, true);
});

test('validateRaidId rejects too short ID', () => {
    const result = validateRaidId('AB');
    assert.equal(result.valid, false);
});

test('validateRaidId rejects too long ID', () => {
    const result = validateRaidId('ABCDEFGHI');
    assert.equal(result.valid, false);
});

test('validateRaidId rejects special characters', () => {
    const result = validateRaidId('AB-12');
    assert.equal(result.valid, false);
});

// validateTimestamp tests
test('validateTimestamp accepts valid future timestamp', () => {
    const futureTs = Math.floor(Date.now() / 1000) + 3600;
    const result = validateTimestamp(futureTs);
    assert.equal(result.valid, true);
    assert.equal(result.value, futureTs);
});

test('validateTimestamp accepts string timestamp', () => {
    const futureTs = Math.floor(Date.now() / 1000) + 3600;
    const result = validateTimestamp(String(futureTs));
    assert.equal(result.valid, true);
    assert.equal(result.value, futureTs);
});

test('validateTimestamp rejects past timestamp by default', () => {
    const pastTs = Math.floor(Date.now() / 1000) - 3600;
    const result = validateTimestamp(pastTs);
    assert.equal(result.valid, false);
});

test('validateTimestamp allows past when option set', () => {
    const pastTs = Math.floor(Date.now() / 1000) - 3600;
    const result = validateTimestamp(pastTs, { allowPast: true });
    assert.equal(result.valid, true);
});

test('validateTimestamp rejects timestamp before 2020', () => {
    const result = validateTimestamp(1500000000);
    assert.equal(result.valid, false);
});

// validateSlotCount tests
test('validateSlotCount accepts valid count', () => {
    const result = validateSlotCount(6);
    assert.equal(result.valid, true);
    assert.equal(result.value, 6);
});

test('validateSlotCount accepts string number', () => {
    const result = validateSlotCount('4');
    assert.equal(result.valid, true);
    assert.equal(result.value, 4);
});

test('validateSlotCount rejects zero', () => {
    const result = validateSlotCount(0);
    assert.equal(result.valid, false);
});

test('validateSlotCount rejects above max', () => {
    const result = validateSlotCount(15);
    assert.equal(result.valid, false);
});

test('validateSlotCount respects custom min/max', () => {
    const result = validateSlotCount(5, { min: 2, max: 4 });
    assert.equal(result.valid, false);
});

// sanitizeDisplayName tests
test('sanitizeDisplayName removes markdown', () => {
    const result = sanitizeDisplayName('**bold** _italic_');
    assert.equal(result, 'bold italic');
});

test('sanitizeDisplayName removes Discord mentions', () => {
    const result = sanitizeDisplayName('Hello <@123456789012345678>');
    assert.equal(result, 'Hello');
});

test('sanitizeDisplayName limits length', () => {
    const long = 'a'.repeat(50);
    const result = sanitizeDisplayName(long);
    assert.equal(result.length, 32);
});

test('sanitizeDisplayName returns Unknown for empty input', () => {
    assert.equal(sanitizeDisplayName(''), 'Unknown');
    assert.equal(sanitizeDisplayName(null), 'Unknown');
});

test('sanitizeDisplayName collapses whitespace', () => {
    const result = sanitizeDisplayName('hello    world');
    assert.equal(result, 'hello world');
});

// validateTemplateType tests
test('validateTemplateType accepts valid type', () => {
    const result = validateTemplateType('lemuria', ['lemuria', 'museum']);
    assert.equal(result.valid, true);
    assert.equal(result.value, 'lemuria');
});

test('validateTemplateType is case insensitive', () => {
    const result = validateTemplateType('LEMURIA', ['lemuria', 'museum']);
    assert.equal(result.valid, true);
});

test('validateTemplateType rejects invalid type', () => {
    const result = validateTemplateType('unknown', ['lemuria', 'museum']);
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('lemuria'));
});

// validateReminderDuration tests
test('validateReminderDuration accepts valid duration', () => {
    const result = validateReminderDuration(3600);
    assert.equal(result.valid, true);
    assert.equal(result.value, 3600);
});

test('validateReminderDuration rejects too short', () => {
    const result = validateReminderDuration(30);
    assert.equal(result.valid, false);
});

test('validateReminderDuration rejects too long', () => {
    const result = validateReminderDuration(100000);
    assert.equal(result.valid, false);
});

// validateBatch tests
test('validateBatch validates multiple inputs', () => {
    const inputs = { slots: 4, raidId: 'abc1' };
    const validators = {
        slots: { validator: validateSlotCount, options: {} },
        raidId: { validator: validateRaidId, options: {} }
    };
    const result = validateBatch(inputs, validators);
    assert.equal(result.valid, true);
    assert.equal(result.values.slots, 4);
    assert.equal(result.values.raidId, 'ABC1');
});

test('validateBatch collects all errors', () => {
    const inputs = { slots: 0, raidId: 'x' };
    const validators = {
        slots: { validator: validateSlotCount, options: {} },
        raidId: { validator: validateRaidId, options: {} }
    };
    const result = validateBatch(inputs, validators);
    assert.equal(result.valid, false);
    assert.ok(result.errors.slots);
    assert.ok(result.errors.raidId);
});
