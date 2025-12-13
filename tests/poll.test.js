const test = require('node:test');
const assert = require('node:assert/strict');

// Initialize database schema before importing modules that use it
const { initializeSchema } = require('../db/database');
initializeSchema();

const pollManager = require('../pollManager');

test('createPoll creates a poll with correct data', () => {
    const poll = pollManager.createPoll(
        'guildTest1',
        'channelTest1',
        'userTest1',
        'Test Poll',
        ['Option 1', 'Option 2', 'Option 3']
    );

    assert.ok(poll.id, 'Poll should have an ID');
    assert.equal(poll.guildId, 'guildTest1');
    assert.equal(poll.title, 'Test Poll');
    assert.equal(poll.options.length, 3);
    assert.equal(poll.closed, false);
});

test('recordVote and getPollResults work correctly', () => {
    const poll = pollManager.createPoll(
        'guildTest2',
        'channelTest2',
        'userTest2',
        'Vote Test',
        ['Mon 7pm', 'Tue 8pm', 'Wed 6pm']
    );

    // Record votes
    pollManager.recordVote(poll.id, 'voter1', 0);
    pollManager.recordVote(poll.id, 'voter2', 0);
    pollManager.recordVote(poll.id, 'voter3', 1);
    pollManager.recordVote(poll.id, 'voter1', 1); // voter1 votes for 2 options

    const results = pollManager.getPollResults(poll.id);

    assert.ok(results, 'Results should exist');
    assert.equal(results.totalVoters, 3, 'Should have 3 unique voters');
    assert.equal(results.results[0].count, 2, 'Option 0 should have 2 votes');
    assert.equal(results.results[1].count, 2, 'Option 1 should have 2 votes');
    assert.equal(results.results[2].count, 0, 'Option 2 should have 0 votes');
});

test('removeVote removes a vote correctly', () => {
    const poll = pollManager.createPoll(
        'guildTest3',
        'channelTest3',
        'userTest3',
        'Remove Test',
        ['Option A', 'Option B']
    );

    pollManager.recordVote(poll.id, 'voter1', 0);
    pollManager.recordVote(poll.id, 'voter1', 1);

    let results = pollManager.getPollResults(poll.id);
    assert.equal(results.results[0].count, 1);
    assert.equal(results.results[1].count, 1);

    pollManager.removeVote(poll.id, 'voter1', 0);

    results = pollManager.getPollResults(poll.id);
    assert.equal(results.results[0].count, 0);
    assert.equal(results.results[1].count, 1);
});

test('getOptimalSlots returns top voted options', () => {
    const poll = pollManager.createPoll(
        'guildTest4',
        'channelTest4',
        'userTest4',
        'Optimal Test',
        ['Sat 2pm', 'Sat 4pm', 'Sun 3pm', 'Sun 5pm']
    );

    // Sat 4pm gets most votes
    pollManager.recordVote(poll.id, 'v1', 1);
    pollManager.recordVote(poll.id, 'v2', 1);
    pollManager.recordVote(poll.id, 'v3', 1);
    // Sun 3pm gets 2 votes
    pollManager.recordVote(poll.id, 'v1', 2);
    pollManager.recordVote(poll.id, 'v2', 2);
    // Sat 2pm gets 1 vote
    pollManager.recordVote(poll.id, 'v3', 0);

    const optimal = pollManager.getOptimalSlots(poll.id, 1, 3);

    assert.equal(optimal.length, 3);
    assert.equal(optimal[0].option, 'Sat 4pm');
    assert.equal(optimal[0].count, 3);
    assert.equal(optimal[1].option, 'Sun 3pm');
    assert.equal(optimal[1].count, 2);
});

test('closePoll marks poll as closed', () => {
    const poll = pollManager.createPoll(
        'guildTest5',
        'channelTest5',
        'userTest5',
        'Close Test',
        ['A', 'B']
    );

    assert.equal(poll.closed, false);
    pollManager.closePoll(poll.id);

    const retrieved = pollManager.getPoll(poll.id);
    assert.equal(retrieved.closed, true);
});

test('handles 50+ voters efficiently', () => {
    const poll = pollManager.createPoll(
        'guildTest6',
        'channelTest6',
        'userTest6',
        'Scalability Test',
        ['Time 1', 'Time 2', 'Time 3']
    );

    // Simulate 60 voters
    for (let i = 0; i < 60; i++) {
        const option = i % 3; // Distribute votes across options
        pollManager.recordVote(poll.id, `voter${i}`, option);
    }

    const results = pollManager.getPollResults(poll.id);

    assert.equal(results.totalVoters, 60);
    assert.equal(results.results[0].count, 20);
    assert.equal(results.results[1].count, 20);
    assert.equal(results.results[2].count, 20);
});

test('getNumberEmoji returns correct emojis', () => {
    assert.equal(pollManager.getNumberEmoji(0), '1️⃣');
    assert.equal(pollManager.getNumberEmoji(1), '2️⃣');
    assert.equal(pollManager.getNumberEmoji(9), '🔟');
});

test('getIndexFromEmoji returns correct index', () => {
    assert.equal(pollManager.getIndexFromEmoji('1️⃣'), 0);
    assert.equal(pollManager.getIndexFromEmoji('2️⃣'), 1);
    assert.equal(pollManager.getIndexFromEmoji('🔟'), 9);
    assert.equal(pollManager.getIndexFromEmoji('👍'), -1); // Invalid emoji
});
