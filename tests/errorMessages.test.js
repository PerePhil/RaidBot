const test = require('node:test');
const assert = require('node:assert/strict');
const { ERROR_MESSAGES, getErrorMessage, formatError } = require('../utils/errorMessages');

test('ERROR_MESSAGES contains expected keys', () => {
    assert.ok(ERROR_MESSAGES.MISSING_PERMISSIONS);
    assert.ok(ERROR_MESSAGES.RAID_NOT_FOUND);
    assert.ok(ERROR_MESSAGES.DM_FAILED);
    assert.ok(ERROR_MESSAGES.RATE_LIMITED);
    assert.ok(ERROR_MESSAGES.UNKNOWN_ERROR);
});

test('getErrorMessage returns message for valid key', () => {
    const msg = getErrorMessage('RAID_NOT_FOUND');
    assert.equal(typeof msg, 'string');
    assert.ok(msg.length > 0);
});

test('getErrorMessage returns UNKNOWN_ERROR for unknown key', () => {
    const msg = getErrorMessage('NONEXISTENT_KEY');
    assert.equal(msg, ERROR_MESSAGES.UNKNOWN_ERROR);
});

test('formatError handles Discord API error code 50007', () => {
    const error = { code: 50007, message: 'Cannot send messages to user' };
    const result = formatError(error);
    assert.equal(result, ERROR_MESSAGES.DM_FAILED);
});

test('formatError handles generic error', () => {
    const error = new Error('Something broke');
    const result = formatError(error);
    assert.equal(result, ERROR_MESSAGES.UNKNOWN_ERROR);
});

test('formatError handles unknown error object', () => {
    const result = formatError({});
    assert.equal(result, ERROR_MESSAGES.UNKNOWN_ERROR);
});
