const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    activeRaids,
    loadActiveRaidState,
    setActiveRaid,
    deleteActiveRaid
} = require('../state');

const ACTIVE_FILE = path.resolve('.test_active_raids.json');
const BACKUP_FILE = `${ACTIVE_FILE}.bak`;

test.beforeEach(() => {
    activeRaids.clear();
    if (fs.existsSync(ACTIVE_FILE)) {
        fs.unlinkSync(ACTIVE_FILE);
    }
    if (fs.existsSync(BACKUP_FILE)) {
        fs.unlinkSync(BACKUP_FILE);
    }
});

test.after(() => {
    if (fs.existsSync(ACTIVE_FILE)) {
        fs.unlinkSync(ACTIVE_FILE);
    }
    if (fs.existsSync(BACKUP_FILE)) {
        fs.unlinkSync(BACKUP_FILE);
    }
});

test('setActiveRaid persists to disk and creates backup on subsequent writes', () => {
    const firstRaid = { raidId: 'A1', guildId: '1' };
    setActiveRaid('message-1', firstRaid);

    assert.ok(fs.existsSync(ACTIVE_FILE), 'active_raids file not written');
    const raw = JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8'));
    assert.ok(raw['message-1']);

    const secondRaid = { raidId: 'B2', guildId: '1' };
    setActiveRaid('message-2', secondRaid);
    assert.ok(fs.existsSync(BACKUP_FILE), 'backup file not created');

    deleteActiveRaid('message-1');
    deleteActiveRaid('message-2');
});

test('loadActiveRaidState restores previous entries', () => {
    const storedRaid = { raidId: 'RESTORE', guildId: '2' };
    setActiveRaid('message-restore', storedRaid);
    activeRaids.clear();

    loadActiveRaidState();
    const entry = activeRaids.get('message-restore');
    assert.ok(entry);
    assert.equal(entry.raidId, 'RESTORE');
    deleteActiveRaid('message-restore');
});
