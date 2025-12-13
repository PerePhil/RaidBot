const { db, prepare } = require('./db/database');
const crypto = require('crypto');

// In-memory cache
const polls = new Map(); // pollId -> poll data

// Prepared statements
let statements = null;

function getStatements() {
    if (statements) return statements;

    statements = {
        getAll: prepare('SELECT * FROM polls WHERE closed = 0'),
        getById: prepare('SELECT * FROM polls WHERE id = ?'),
        getByMessage: prepare('SELECT * FROM polls WHERE message_id = ?'),
        getGuildPolls: prepare('SELECT * FROM polls WHERE guild_id = ? ORDER BY created_at DESC'),
        create: prepare(`
            INSERT INTO polls (id, guild_id, channel_id, message_id, creator_id, title, options, expires_at)
            VALUES (@id, @guild_id, @channel_id, @message_id, @creator_id, @title, @options, @expires_at)
        `),
        updateMessage: prepare('UPDATE polls SET message_id = ? WHERE id = ?'),
        closePoll: prepare('UPDATE polls SET closed = 1 WHERE id = ?'),
        deletePoll: prepare('DELETE FROM polls WHERE id = ?'),

        // Votes
        addVote: prepare(`
            INSERT OR IGNORE INTO poll_votes (poll_id, user_id, option_index)
            VALUES (@poll_id, @user_id, @option_index)
        `),
        removeVote: prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_index = ?'),
        removeAllUserVotes: prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?'),
        getVotes: prepare('SELECT * FROM poll_votes WHERE poll_id = ?'),
        getUserVotes: prepare('SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?'),
        getVoteCounts: prepare(`
            SELECT option_index, COUNT(*) as count 
            FROM poll_votes 
            WHERE poll_id = ? 
            GROUP BY option_index 
            ORDER BY option_index
        `)
    };

    return statements;
}

function generatePollId() {
    return crypto.randomBytes(4).toString('hex');
}

function loadPolls() {
    polls.clear();
    const stmts = getStatements();
    const rows = stmts.getAll.all();

    rows.forEach(row => {
        polls.set(row.id, {
            id: row.id,
            guildId: row.guild_id,
            channelId: row.channel_id,
            messageId: row.message_id,
            creatorId: row.creator_id,
            title: row.title,
            options: JSON.parse(row.options),
            expiresAt: row.expires_at,
            closed: !!row.closed,
            createdAt: row.created_at
        });
    });

    console.log(`Loaded ${polls.size} active polls`);
}

function createPoll(guildId, channelId, creatorId, title, options, expiresAt = null) {
    const stmts = getStatements();
    const id = generatePollId();

    stmts.create.run({
        id,
        guild_id: guildId,
        channel_id: channelId,
        message_id: null,
        creator_id: creatorId,
        title,
        options: JSON.stringify(options),
        expires_at: expiresAt
    });

    const poll = {
        id,
        guildId,
        channelId,
        messageId: null,
        creatorId,
        title,
        options,
        expiresAt,
        closed: false,
        createdAt: Math.floor(Date.now() / 1000)
    };

    polls.set(id, poll);
    return poll;
}

function updatePollMessage(pollId, messageId) {
    const stmts = getStatements();
    stmts.updateMessage.run(messageId, pollId);

    const poll = polls.get(pollId);
    if (poll) {
        poll.messageId = messageId;
    }
}

function getPoll(pollId) {
    // Check cache first
    const cached = polls.get(pollId);
    if (cached) return cached;

    // Fallback to database
    const stmts = getStatements();
    const row = stmts.getById.get(pollId);
    if (!row) return null;

    return {
        id: row.id,
        guildId: row.guild_id,
        channelId: row.channel_id,
        messageId: row.message_id,
        creatorId: row.creator_id,
        title: row.title,
        options: JSON.parse(row.options),
        expiresAt: row.expires_at,
        closed: !!row.closed,
        createdAt: row.created_at
    };
}

function getPollByMessage(messageId) {
    const stmts = getStatements();
    const row = stmts.getByMessage.get(messageId);
    if (!row) return null;

    return {
        id: row.id,
        guildId: row.guild_id,
        channelId: row.channel_id,
        messageId: row.message_id,
        creatorId: row.creator_id,
        title: row.title,
        options: JSON.parse(row.options),
        expiresAt: row.expires_at,
        closed: !!row.closed,
        createdAt: row.created_at
    };
}

function getGuildPolls(guildId, limit = 10) {
    const stmts = getStatements();
    const rows = stmts.getGuildPolls.all(guildId);

    return rows.slice(0, limit).map(row => ({
        id: row.id,
        guildId: row.guild_id,
        channelId: row.channel_id,
        messageId: row.message_id,
        creatorId: row.creator_id,
        title: row.title,
        options: JSON.parse(row.options),
        expiresAt: row.expires_at,
        closed: !!row.closed,
        createdAt: row.created_at
    }));
}

function recordVote(pollId, userId, optionIndex) {
    const stmts = getStatements();
    const result = stmts.addVote.run({
        poll_id: pollId,
        user_id: userId,
        option_index: optionIndex
    });
    return result.changes > 0;
}

function removeVote(pollId, userId, optionIndex) {
    const stmts = getStatements();
    const result = stmts.removeVote.run(pollId, userId, optionIndex);
    return result.changes > 0;
}

function removeAllUserVotes(pollId, userId) {
    const stmts = getStatements();
    const result = stmts.removeAllUserVotes.run(pollId, userId);
    return result.changes;
}

function getUserVotes(pollId, userId) {
    const stmts = getStatements();
    const rows = stmts.getUserVotes.all(pollId, userId);
    return rows.map(r => r.option_index);
}

function getPollResults(pollId) {
    const poll = getPoll(pollId);
    if (!poll) return null;

    const stmts = getStatements();
    const votes = stmts.getVotes.all(pollId);
    const counts = stmts.getVoteCounts.all(pollId);

    // Build results for each option
    const results = poll.options.map((option, index) => {
        const countRow = counts.find(c => c.option_index === index);
        const voters = votes
            .filter(v => v.option_index === index)
            .map(v => v.user_id);

        return {
            index,
            option,
            count: countRow ? countRow.count : 0,
            voters
        };
    });

    // Sort by count descending for optimal slots
    const sortedByVotes = [...results].sort((a, b) => b.count - a.count);
    const totalVoters = new Set(votes.map(v => v.user_id)).size;

    return {
        poll,
        results,
        sortedByVotes,
        totalVoters
    };
}

function getOptimalSlots(pollId, minVotes = 1, maxSlots = 3) {
    const pollResults = getPollResults(pollId);
    if (!pollResults) return [];

    return pollResults.sortedByVotes
        .filter(r => r.count >= minVotes)
        .slice(0, maxSlots);
}

function closePoll(pollId) {
    const stmts = getStatements();
    stmts.closePoll.run(pollId);

    const poll = polls.get(pollId);
    if (poll) {
        poll.closed = true;
    }
}

function deletePoll(pollId) {
    const stmts = getStatements();
    stmts.deletePoll.run(pollId);
    polls.delete(pollId);
}

// Number emoji mapping for reactions
const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function getNumberEmoji(index) {
    return NUMBER_EMOJIS[index] || `${index + 1}️⃣`;
}

function getIndexFromEmoji(emoji) {
    const index = NUMBER_EMOJIS.indexOf(emoji);
    return index >= 0 ? index : -1;
}

module.exports = {
    loadPolls,
    createPoll,
    updatePollMessage,
    getPoll,
    getPollByMessage,
    getGuildPolls,
    recordVote,
    removeVote,
    removeAllUserVotes,
    getUserVotes,
    getPollResults,
    getOptimalSlots,
    closePoll,
    deletePoll,
    getNumberEmoji,
    getIndexFromEmoji,
    NUMBER_EMOJIS
};
