const test = require('node:test');
const assert = require('node:assert/strict');

const { processWaitlistOpenings } = require('../utils/waitlistNotifications');
const { setActiveRaid, deleteActiveRaid, activeRaids } = require('../state');

const client = {
    users: {
        async fetch() {
            return {
                async send() {
                    return true;
                }
            };
        }
    }
};

test.beforeEach(() => {
    activeRaids.clear();
    try {
        deleteActiveRaid('test-message', { persist: false });
    } catch {
        // ignore
    }
});

test('processWaitlistOpenings promotes raid waitlist users', async () => {
    const raidData = {
        template: { name: 'Waitlist Test' },
        type: 'raid',
        raidId: 'WAIT01',
        guildId: 'test-guild',
        channelId: 'test-channel',
        creatorId: 'test-creator',
        signups: [
            {
                emoji: '1️⃣',
                name: 'Slot 1',
                slots: 1,
                users: [],
                waitlist: ['user-b']
            }
        ],
        closed: false
    };

    setActiveRaid('test-message', raidData, { persist: false });

    const promoted = await processWaitlistOpenings(client, raidData, 'test-message');
    assert.equal(promoted, true);
    assert.deepEqual(raidData.signups[0].users, ['user-b']);
    assert.deepEqual(raidData.signups[0].waitlist, []);
});

test('processWaitlistOpenings promotes museum waitlist users', async () => {
    const raidData = {
        type: 'museum',
        raidId: 'MUSEUM1',
        guildId: 'test-guild',
        channelId: 'test-channel',
        creatorId: 'test-creator',
        signups: ['user-a'],
        waitlist: ['user-b'],
        maxSlots: 2,
        closed: false
    };

    setActiveRaid('test-message', raidData, { persist: false });

    const promoted = await processWaitlistOpenings(client, raidData, 'test-message');
    assert.equal(promoted, true);
    assert.deepEqual(raidData.signups, ['user-a', 'user-b']);
    assert.deepEqual(raidData.waitlist, []);
});
