const test = require('node:test');
const assert = require('node:assert');

const createCommand = require('../commands/create');
const setChannelCommand = require('../commands/setchannel');
const { buildLabelsForRaid } = require('../utils/userLabels');
const { prepare } = require('../db/database');
const {
    activeRaids,
    deleteActiveRaid,
    keyChannels,
    challengeChannels,
    setChallengeChannel
} = require('../state');

function extractComponentIds(rows) {
    return rows
        .flatMap((row) => row.components || [])
        .map((component) => component.data?.custom_id || component.customId)
        .filter(Boolean);
}

function createFakeTeamSignupMessage(messageId, guild, embed) {
    const reactionsAdded = [];
    const message = {
        id: messageId,
        guild,
        client: guild.client,
        embeds: [embed.toJSON()],
        reactions: { cache: new Map() },
        reactionsAdded,
        async react(emoji) {
            reactionsAdded.push(emoji);
            this.reactions.cache.set(emoji, { emoji: { name: emoji }, me: true });
        },
        async edit(payload) {
            if (payload?.embeds) {
                this.embeds = payload.embeds.map((e) => (typeof e.toJSON === 'function' ? e.toJSON() : e));
            }
        }
    };
    return message;
}

test('buildLabelsForRaid supports challenge team-based signups', async () => {
    const labels = await buildLabelsForRaid({
        type: 'challenge',
        teams: [
            { users: ['user-1'], waitlist: ['user-2'] },
            { users: [], waitlist: [] }
        ]
    });

    assert.strictEqual(labels.get('user-1'), 'Unknown');
    assert.strictEqual(labels.get('user-2'), 'Unknown');
});

test('create command key flow executes end-to-end via handleCreate', async () => {
    const guildId = 'guild-create-key-regression';
    const channelId = 'channel-create-key-regression';
    const beforeIds = new Set(activeRaids.keys());
    let replyPayload = null;
    let followUpPayload = null;
    let sentMessage = null;

    const guild = {
        id: guildId,
        client: {
            users: {
                async fetch() {
                    return { async send() {} };
                }
            }
        },
        channels: {
            cache: new Map(),
            async fetch(id) {
                return this.cache.get(id) || null;
            }
        }
    };

    const signupChannel = {
        id: channelId,
        toString() {
            return `<#${channelId}>`;
        },
        async send(payload) {
            sentMessage = createFakeTeamSignupMessage('msg-create-key-regression', guild, payload.embeds[0]);
            return sentMessage;
        }
    };
    guild.channels.cache.set(channelId, signupChannel);
    keyChannels.set(guildId, channelId);

    const interaction = {
        guildId,
        guild,
        user: { id: 'creator-key-regression' },
        async editReply(payload) {
            replyPayload = payload;
        },
        async followUp(payload) {
            followUpPayload = payload;
        }
    };

    const state = {
        type: 'key',
        datetime: 'tomorrow 7pm',
        timestamp: 1893456000,
        length: null,
        strategy: null,
        teamCount: '2',
        bossName: 'Rattlebones',
        countsForParticipation: true,
        templates: []
    };

    const ok = await createCommand.__test.handleCreate(interaction, state);
    assert.strictEqual(ok, true);
    assert.ok(sentMessage, 'expected signup message to be sent');
    assert.deepStrictEqual(sentMessage.reactionsAdded, ['1️⃣', '2️⃣']);
    assert.match(replyPayload?.content || '', /Key boss signup created/i);
    assert.strictEqual(followUpPayload, null);

    for (const [messageId] of activeRaids.entries()) {
        if (!beforeIds.has(messageId)) {
            deleteActiveRaid(messageId);
        }
    }
    keyChannels.delete(guildId);
});

test('setchannel direct challenge option persists challenge channel to database', async () => {
    const guildId = 'guild-setchannel-challenge-regression';
    const challengeChannelId = 'channel-setchannel-challenge-regression';
    let replyPayload = null;

    const guild = {
        id: guildId,
        channels: {
            cache: new Map([
                [challengeChannelId, { id: challengeChannelId, toString: () => `<#${challengeChannelId}>` }]
            ])
        }
    };

    const interaction = {
        guildId,
        guild,
        options: {
            getChannel(name) {
                if (name === 'challenge_channel') {
                    return { id: challengeChannelId };
                }
                return null;
            }
        },
        async reply(payload) {
            replyPayload = payload;
        }
    };

    await setChannelCommand.execute(interaction);
    const row = prepare('SELECT challenge_channel_id FROM guilds WHERE id = ?').get(guildId);
    assert.strictEqual(row?.challenge_channel_id, challengeChannelId);
    assert.strictEqual(challengeChannels.get(guildId), challengeChannelId);
    assert.match(replyPayload?.content || '', /Channels updated/i);

    setChallengeChannel(guildId, null);
});

test('create command does not show length selector for challenge mode', () => {
    const challengeState = {
        type: 'challenge',
        datetime: null,
        timestamp: null,
        length: null,
        strategy: null,
        teamCount: null,
        bossName: null,
        countsForParticipation: true,
        templates: []
    };
    const raidState = { ...challengeState, type: 'dragonspyre' };

    const challengeIds = extractComponentIds(createCommand.__test.buildComponents(challengeState));
    const raidIds = extractComponentIds(createCommand.__test.buildComponents(raidState));

    assert.ok(!challengeIds.includes('create:length'));
    assert.ok(raidIds.includes('create:length'));
});
