const test = require('node:test');
const assert = require('node:assert/strict');

// Initialize database schema FIRST before importing auditLog
const { initializeSchema } = require('../db/database');
initializeSchema();

const {
    loadAuditChannels,
    loadDebugChannels,
    setAuditChannel,
    getAuditChannel,
    setDebugChannel,
    getDebugChannel,
    sendDebugLog,
    auditChannels,
    debugChannels,
    DEBUG_CATEGORY
} = require('../auditLog');

// Test setup/cleanup
test.beforeEach(() => {
    auditChannels.clear();
    debugChannels.clear();
});

test.afterEach(() => {
    // Clean up any test data
    auditChannels.clear();
    debugChannels.clear();
});

// ===== AUDIT CHANNEL TESTS =====

test('setAuditChannel stores channel in memory and database', () => {
    setAuditChannel('guild-1', 'channel-audit-1');

    assert.equal(getAuditChannel('guild-1'), 'channel-audit-1');
    assert.ok(auditChannels.has('guild-1'));

    // Cleanup
    setAuditChannel('guild-1', null);
});

test('setAuditChannel with null removes channel', () => {
    setAuditChannel('guild-2', 'channel-audit-2');
    assert.equal(getAuditChannel('guild-2'), 'channel-audit-2');

    setAuditChannel('guild-2', null);
    assert.equal(getAuditChannel('guild-2'), null);
    assert.ok(!auditChannels.has('guild-2'));
});

test('getAuditChannel returns null for unconfigured guild', () => {
    assert.equal(getAuditChannel('nonexistent-guild'), null);
});

test('loadAuditChannels clears and reloads cache', () => {
    setAuditChannel('guild-3', 'channel-audit-3');
    auditChannels.clear();

    // After clearing cache, should still be able to get from database
    loadAuditChannels();
    assert.equal(getAuditChannel('guild-3'), 'channel-audit-3');

    // Cleanup
    setAuditChannel('guild-3', null);
});

// ===== DEBUG CHANNEL TESTS =====

test('setDebugChannel stores channel in memory and database', () => {
    setDebugChannel('guild-4', 'channel-debug-4');

    assert.equal(getDebugChannel('guild-4'), 'channel-debug-4');
    assert.ok(debugChannels.has('guild-4'));

    // Cleanup
    setDebugChannel('guild-4', null);
});

test('setDebugChannel with null removes channel', () => {
    setDebugChannel('guild-5', 'channel-debug-5');
    assert.equal(getDebugChannel('guild-5'), 'channel-debug-5');

    setDebugChannel('guild-5', null);
    assert.equal(getDebugChannel('guild-5'), null);
    assert.ok(!debugChannels.has('guild-5'));
});

test('getDebugChannel returns null for unconfigured guild', () => {
    assert.equal(getDebugChannel('nonexistent-guild-2'), null);
});

test('loadDebugChannels clears and reloads cache', () => {
    setDebugChannel('guild-6', 'channel-debug-6');
    debugChannels.clear();

    // After clearing cache, should still be able to get from database
    loadDebugChannels();
    assert.equal(getDebugChannel('guild-6'), 'channel-debug-6');

    // Cleanup
    setDebugChannel('guild-6', null);
});

// ===== INDEPENDENT CHANNEL TESTS =====

test('audit and debug channels are independent', () => {
    setAuditChannel('guild-7', 'channel-audit-7');
    setDebugChannel('guild-7', 'channel-debug-7');

    assert.equal(getAuditChannel('guild-7'), 'channel-audit-7');
    assert.equal(getDebugChannel('guild-7'), 'channel-debug-7');
    assert.notEqual(getAuditChannel('guild-7'), getDebugChannel('guild-7'));

    // Removing one doesn't affect the other
    setAuditChannel('guild-7', null);
    assert.equal(getAuditChannel('guild-7'), null);
    assert.equal(getDebugChannel('guild-7'), 'channel-debug-7');

    // Cleanup
    setDebugChannel('guild-7', null);
});

// ===== DEBUG_CATEGORY TESTS =====

test('DEBUG_CATEGORY contains all expected categories', () => {
    const expectedCategories = [
        'SIGNUP', 'WAITLIST', 'UNSIGN', 'PROMOTED', 'BLOCKED', 'RESTRICTED',
        'REINIT', 'RESTORED', 'STALE', 'DISCOVERED', 'SYNC',
        'CREATED', 'CLOSED', 'REOPENED', 'DELETED', 'TIME_CHANGE', 'LENGTH_CHANGE', 'NO_SHOWS', 'ASSIGNED',
        'THREAD', 'NOTIFIED', 'DM_FAILED',
        'STARTUP', 'SHUTDOWN', 'GUILD',
        'RECURRING', 'SCHEDULED', 'SYSTEM'
    ];

    for (const category of expectedCategories) {
        assert.ok(DEBUG_CATEGORY[category], `Missing category: ${category}`);
        assert.equal(typeof DEBUG_CATEGORY[category], 'string');
    }
});

test('DEBUG_CATEGORY values are emoji strings', () => {
    for (const [key, value] of Object.entries(DEBUG_CATEGORY)) {
        assert.ok(value.length > 0, `Empty value for ${key}`);
        assert.ok(typeof value === 'string', `${key} should be a string`);
    }
});

// ===== sendDebugLog TESTS =====

test('sendDebugLog does not throw with null guild', async () => {
    // Should not throw, just return early
    await sendDebugLog(null, 'SIGNUP', 'test message');
    await sendDebugLog(undefined, 'SIGNUP', 'test message');
});

test('sendDebugLog does not throw with guild without debug channel', async () => {
    const mockGuild = { id: 'mock-guild-no-channel' };
    // Should not throw when no channel configured
    await sendDebugLog(mockGuild, 'SIGNUP', 'test message');
});

// ===== PERSISTENCE TESTS =====

test('audit channel persists across cache clear', () => {
    setAuditChannel('persist-guild-1', 'persist-channel-1');
    auditChannels.clear();

    // Should fetch from database
    const channel = getAuditChannel('persist-guild-1');
    assert.equal(channel, 'persist-channel-1');

    // Cleanup
    setAuditChannel('persist-guild-1', null);
});

test('debug channel persists across cache clear', () => {
    setDebugChannel('persist-guild-2', 'persist-channel-2');
    debugChannels.clear();

    // Should fetch from database
    const channel = getDebugChannel('persist-guild-2');
    assert.equal(channel, 'persist-channel-2');

    // Cleanup
    setDebugChannel('persist-guild-2', null);
});

test('multiple guilds can have independent channels', () => {
    setAuditChannel('multi-guild-1', 'audit-1');
    setAuditChannel('multi-guild-2', 'audit-2');
    setDebugChannel('multi-guild-1', 'debug-1');
    setDebugChannel('multi-guild-2', 'debug-2');

    assert.equal(getAuditChannel('multi-guild-1'), 'audit-1');
    assert.equal(getAuditChannel('multi-guild-2'), 'audit-2');
    assert.equal(getDebugChannel('multi-guild-1'), 'debug-1');
    assert.equal(getDebugChannel('multi-guild-2'), 'debug-2');

    // Cleanup
    setAuditChannel('multi-guild-1', null);
    setAuditChannel('multi-guild-2', null);
    setDebugChannel('multi-guild-1', null);
    setDebugChannel('multi-guild-2', null);
});
