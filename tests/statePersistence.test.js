const test = require('node:test');
const assert = require('node:assert/strict');

const {
    activeRaids,
    loadActiveRaidState,
    setActiveRaid,
    deleteActiveRaid
} = require('../state');

// Now using in-memory SQLite for tests, so we just test the API behavior

test.beforeEach(() => {
    activeRaids.clear();
});

test('setActiveRaid stores raid in memory and database', () => {
    const firstRaid = {
        raidId: 'A1',
        guildId: '1',
        channelId: 'channel1',
        creatorId: 'creator1',
        type: 'raid',
        signups: []
    };
    setActiveRaid('message-1', firstRaid);

    // Check it's in the in-memory map
    assert.ok(activeRaids.has('message-1'), 'raid not in memory');
    const stored = activeRaids.get('message-1');
    assert.equal(stored.raidId, 'A1');

    // Cleanup
    deleteActiveRaid('message-1');
});

test('loadActiveRaidState restores previous entries', () => {
    const storedRaid = {
        raidId: 'RESTORE',
        guildId: '2',
        channelId: 'channel2',
        creatorId: 'creator2',
        type: 'raid',
        signups: []
    };
    setActiveRaid('message-restore', storedRaid);
    activeRaids.clear();

    loadActiveRaidState();
    const entry = activeRaids.get('message-restore');
    assert.ok(entry);
    assert.equal(entry.raidId, 'RESTORE');
    deleteActiveRaid('message-restore');
});

test('deleteActiveRaid removes raid from memory and database', () => {
    const raid = {
        raidId: 'DEL1',
        guildId: '3',
        channelId: 'channel3',
        creatorId: 'creator3',
        type: 'raid',
        signups: []
    };
    setActiveRaid('message-delete', raid);
    assert.ok(activeRaids.has('message-delete'));

    deleteActiveRaid('message-delete');
    assert.ok(!activeRaids.has('message-delete'), 'raid still in memory after delete');

    // Verify it's not reloaded from DB
    activeRaids.clear();
    loadActiveRaidState();
    assert.ok(!activeRaids.has('message-delete'), 'raid still in database after delete');
});
