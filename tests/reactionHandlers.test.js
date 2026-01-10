const test = require('node:test');
const assert = require('node:assert/strict');

const { handleReactionAdd, handleReactionRemove } = require('../raids/reactionHandlers');
const { setActiveRaid, deleteActiveRaid, activeRaids, markActiveRaidUpdated } = require('../state');

// Mock Discord objects
function createMockReaction(emoji, messageId, guildId = 'test-guild') {
    return {
        emoji: { name: emoji },
        message: {
            id: messageId,
            guild: guildId ? { id: guildId } : null,
            embeds: [
                {
                    title: 'Test Raid',
                    description: 'Test Description',
                    fields: []
                }
            ],
            async edit() {
                return this;
            },
            async react() {
                return true;
            },
            reactions: {
                cache: new Map()
            },
            client: {
                users: {
                    async fetch() {
                        return {
                            id: 'creator-id',
                            async send() {
                                return true;
                            }
                        };
                    }
                }
            }
        },
        partial: false,
        users: {
            async remove() {
                return true;
            }
        }
    };
}

function createMockUser(userId) {
    return {
        id: userId,
        bot: false,
        async send() {
            return true;
        }
    };
}

test.beforeEach(() => {
    activeRaids.clear();
});

test.afterEach(() => {
    try {
        deleteActiveRaid('test-message', { persist: false });
    } catch {
        // ignore
    }
});

test('handleReactionAdd adds user to empty slot', async () => {
    const raidData = {
        template: { name: 'Test Raid' },
        type: 'raid',
        raidId: 'TEST01',
        guildId: 'test-guild',
        channelId: 'test-channel',
        creatorId: 'creator-id',
        signups: [
            {
                emoji: '🛡️',
                name: 'Tank',
                slots: 1,
                users: [],
                waitlist: []
            }
        ],
        closed: false
    };

    setActiveRaid('test-message', raidData, { persist: false });

    const reaction = createMockReaction('🛡️', 'test-message');
    const user = createMockUser('user-1');

    await handleReactionAdd(reaction, user);

    assert.deepEqual(raidData.signups[0].users, ['user-1']);
    assert.deepEqual(raidData.signups[0].waitlist, []);
});

test('handleReactionAdd adds user to waitlist when slot is full', async () => {
    const raidData = {
        template: { name: 'Test Raid' },
        type: 'raid',
        raidId: 'TEST02',
        guildId: 'test-guild',
        channelId: 'test-channel',
        creatorId: 'creator-id',
        signups: [
            {
                emoji: '🛡️',
                name: 'Tank',
                slots: 1,
                users: ['user-1'],
                waitlist: []
            }
        ],
        closed: false
    };

    setActiveRaid('test-message', raidData, { persist: false });

    const reaction = createMockReaction('🛡️', 'test-message');
    const user = createMockUser('user-2');

    await handleReactionAdd(reaction, user);

    assert.deepEqual(raidData.signups[0].users, ['user-1']);
    assert.deepEqual(raidData.signups[0].waitlist, ['user-2']);
});

test('handleReactionAdd prevents double signup to different roles', async () => {
    const raidData = {
        template: { name: 'Test Raid' },
        type: 'raid',
        raidId: 'TEST03',
        guildId: 'test-guild',
        channelId: 'test-channel',
        creatorId: 'creator-id',
        signups: [
            {
                emoji: '🛡️',
                name: 'Tank',
                slots: 1,
                users: ['user-1'],
                waitlist: []
            },
            {
                emoji: '⚔️',
                name: 'DPS',
                slots: 2,
                users: [],
                waitlist: []
            }
        ],
        closed: false
    };

    setActiveRaid('test-message', raidData, { persist: false });

    const reaction = createMockReaction('⚔️', 'test-message');
    const user = createMockUser('user-1'); // Already signed as Tank

    await handleReactionAdd(reaction, user);

    // User should remain only in Tank, not added to DPS
    assert.deepEqual(raidData.signups[0].users, ['user-1']);
    assert.deepEqual(raidData.signups[1].users, []);
});

test('handleReactionAdd ignores reactions when raid is closed', async () => {
    const raidData = {
        template: { name: 'Test Raid' },
        type: 'raid',
        raidId: 'TEST04',
        guildId: 'test-guild',
        channelId: 'test-channel',
        creatorId: 'creator-id',
        signups: [
            {
                emoji: '🛡️',
                name: 'Tank',
                slots: 1,
                users: [],
                waitlist: []
            }
        ],
        closed: true // Raid is closed
    };

    setActiveRaid('test-message', raidData, { persist: false });

    const reaction = createMockReaction('🛡️', 'test-message');
    const user = createMockUser('user-1');

    await handleReactionAdd(reaction, user);

    // No signup should be added
    assert.deepEqual(raidData.signups[0].users, []);
});

test('handleReactionRemove removes user and promotes from waitlist', async () => {
    const raidData = {
        template: { name: 'Test Raid' },
        type: 'raid',
        raidId: 'TEST05',
        guildId: 'test-guild',
        channelId: 'test-channel',
        creatorId: 'creator-id',
        signups: [
            {
                emoji: '🛡️',
                name: 'Tank',
                slots: 1,
                users: ['user-1'],
                waitlist: ['user-2', 'user-3']
            }
        ],
        closed: false
    };

    setActiveRaid('test-message', raidData, { persist: false });

    const reaction = createMockReaction('🛡️', 'test-message');
    const user = createMockUser('user-1');

    await handleReactionRemove(reaction, user);

    // user-1 should be removed, user-2 promoted from waitlist
    assert.deepEqual(raidData.signups[0].users, ['user-2']);
    assert.deepEqual(raidData.signups[0].waitlist, ['user-3']);
});

test('handleReactionRemove removes user from waitlist', async () => {
    const raidData = {
        template: { name: 'Test Raid' },
        type: 'raid',
        raidId: 'TEST06',
        guildId: 'test-guild',
        channelId: 'test-channel',
        creatorId: 'creator-id',
        signups: [
            {
                emoji: '🛡️',
                name: 'Tank',
                slots: 1,
                users: ['user-1'],
                waitlist: ['user-2', 'user-3']
            }
        ],
        closed: false
    };

    setActiveRaid('test-message', raidData, { persist: false });

    const reaction = createMockReaction('🛡️', 'test-message');
    const user = createMockUser('user-2');

    await handleReactionRemove(reaction, user);

    // user-2 removed from waitlist, user-1 still in users
    assert.deepEqual(raidData.signups[0].users, ['user-1']);
    assert.deepEqual(raidData.signups[0].waitlist, ['user-3']);
});

test('handleReactionAdd museum signup adds to empty slot', async () => {
    const raidData = {
        type: 'museum',
        raidId: 'MUSEUM1',
        guildId: 'test-guild',
        channelId: 'test-channel',
        creatorId: 'creator-id',
        signups: [],
        waitlist: [],
        maxSlots: 2,
        closed: false
    };

    setActiveRaid('test-message', raidData, { persist: false });

    const reaction = createMockReaction('✅', 'test-message');
    const user = createMockUser('user-1');

    await handleReactionAdd(reaction, user);

    assert.deepEqual(raidData.signups, ['user-1']);
    assert.deepEqual(raidData.waitlist, []);
});

test('handleReactionAdd museum signup adds to waitlist when full', async () => {
    const raidData = {
        type: 'museum',
        raidId: 'MUSEUM2',
        guildId: 'test-guild',
        channelId: 'test-channel',
        creatorId: 'creator-id',
        signups: ['user-1', 'user-2'],
        waitlist: [],
        maxSlots: 2,
        closed: false
    };

    setActiveRaid('test-message', raidData, { persist: false });

    const reaction = createMockReaction('✅', 'test-message');
    const user = createMockUser('user-3');

    await handleReactionAdd(reaction, user);

    assert.deepEqual(raidData.signups, ['user-1', 'user-2']);
    assert.deepEqual(raidData.waitlist, ['user-3']);
});

test('handleReactionRemove museum signup promotes from waitlist', async () => {
    const raidData = {
        type: 'museum',
        raidId: 'MUSEUM3',
        guildId: 'test-guild',
        channelId: 'test-channel',
        creatorId: 'creator-id',
        signups: ['user-1', 'user-2'],
        waitlist: ['user-3'],
        maxSlots: 2,
        closed: false
    };

    setActiveRaid('test-message', raidData, { persist: false });

    const reaction = createMockReaction('✅', 'test-message');
    const user = createMockUser('user-1');

    await handleReactionRemove(reaction, user);

    // user-1 removed, user-3 promoted
    assert.deepEqual(raidData.signups, ['user-2', 'user-3']);
    assert.deepEqual(raidData.waitlist, []);
});

test('handleReactionAdd ignores bot reactions', async () => {
    const raidData = {
        template: { name: 'Test Raid' },
        type: 'raid',
        raidId: 'TEST07',
        guildId: 'test-guild',
        channelId: 'test-channel',
        creatorId: 'creator-id',
        signups: [
            {
                emoji: '🛡️',
                name: 'Tank',
                slots: 1,
                users: [],
                waitlist: []
            }
        ],
        closed: false
    };

    setActiveRaid('test-message', raidData, { persist: false });

    const reaction = createMockReaction('🛡️', 'test-message');
    const botUser = {
        id: 'bot-id',
        bot: true, // This is a bot
        async send() {
            return true;
        }
    };

    await handleReactionAdd(reaction, botUser);

    // Bot reaction should be ignored
    assert.deepEqual(raidData.signups[0].users, []);
});
