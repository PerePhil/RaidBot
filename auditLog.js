const { db, prepare } = require('./db/database');

// In-memory cache
const auditChannels = new Map();

// Batching state
const pendingEmbeds = new Map(); // guildId -> [payloads]
const flushTimers = new Map(); // guildId -> timeout
const guildRefs = new Map(); // guildId -> guild ref
const BATCH_WINDOW_MS = 2 * 60 * 1000;
const EMBEDS_PER_MESSAGE = 10;

// Prepared statements
let statements = null;

function getStatements() {
    if (statements) return statements;

    statements = {
        getAuditChannel: prepare('SELECT audit_channel_id FROM guilds WHERE id = ?'),
        updateAuditChannel: prepare('UPDATE guilds SET audit_channel_id = ? WHERE id = ?'),
        ensureGuild: prepare('INSERT OR IGNORE INTO guilds (id) VALUES (?)')
    };

    return statements;
}

function loadAuditChannels() {
    auditChannels.clear();
    const rows = prepare('SELECT id, audit_channel_id FROM guilds WHERE audit_channel_id IS NOT NULL').all();
    rows.forEach(row => auditChannels.set(row.id, row.audit_channel_id));
    console.log(`Loaded ${auditChannels.size} audit channel configurations`);
}

function saveAuditChannels() {
    // No-op: changes are persisted immediately
}

function setAuditChannel(guildId, channelId) {
    const stmts = getStatements();
    stmts.ensureGuild.run(guildId);
    stmts.updateAuditChannel.run(channelId || null, guildId);

    if (!channelId) {
        auditChannels.delete(guildId);
    } else {
        auditChannels.set(guildId, channelId);
    }
}

function getAuditChannel(guildId) {
    // Check cache first
    if (auditChannels.has(guildId)) {
        return auditChannels.get(guildId);
    }

    // Fallback to database
    const stmts = getStatements();
    const row = stmts.getAuditChannel.get(guildId);
    const channelId = row?.audit_channel_id || null;

    // Cache the result
    if (channelId) {
        auditChannels.set(guildId, channelId);
    }

    return channelId;
}

function enqueueAudit(guild, payload) {
    guildRefs.set(guild.id, guild);
    if (!pendingEmbeds.has(guild.id)) pendingEmbeds.set(guild.id, []);
    const queue = pendingEmbeds.get(guild.id);
    queue.push(payload);
    if (queue.length >= EMBEDS_PER_MESSAGE) {
        flushGuild(guild.id);
        return;
    }
    if (!flushTimers.has(guild.id)) {
        const timer = setTimeout(() => flushGuild(guild.id), BATCH_WINDOW_MS);
        flushTimers.set(guild.id, timer);
    }
}

async function flushGuild(guildId) {
    flushTimers.delete(guildId);
    const payloads = pendingEmbeds.get(guildId);
    pendingEmbeds.delete(guildId);
    if (!payloads || payloads.length === 0) return;

    const channelId = getAuditChannel(guildId);
    const guild = guildRefs.get(guildId);
    if (!channelId || !guild) return;

    let channel = null;
    try {
        channel = await guild.channels.fetch(channelId).catch(() => guild.channels.cache.get(channelId));
    } catch {
        channel = null;
    }
    if (!channel) return;

    for (let i = 0; i < payloads.length; i += EMBEDS_PER_MESSAGE) {
        const chunk = payloads.slice(i, i + EMBEDS_PER_MESSAGE);
        const embeds = chunk.map((p) => p.embed || p);
        const components = chunk.flatMap((p) => p.components || []);
        const rows = [];
        if (components.length > 0) {
            for (let idx = 0; idx < components.length; idx += 5) {
                rows.push({ type: 1, components: components.slice(idx, idx + 5) });
            }
        }
        try {
            await channel.send({ embeds, components: rows });
        } catch (error) {
            console.error('Failed to send audit chunk:', error);
            break;
        }
    }
}

async function sendAuditLog(guild, content, options = {}) {
    const channelId = getAuditChannel(guild.id);
    if (!channelId) return;
    const embed = options.embed || buildEmbed(content, options);
    enqueueAudit(guild, { embed, components: options.components });
}

function buildEmbed(description, options = {}) {
    const embed = {
        description,
        color: options.color || 0x5865F2,
        timestamp: new Date().toISOString()
    };
    if (options.title) embed.title = options.title;
    if (options.fields) embed.fields = options.fields;
    if (options.footer) embed.footer = options.footer;
    return embed;
}

module.exports = {
    loadAuditChannels,
    saveAuditChannels,
    setAuditChannel,
    getAuditChannel,
    sendAuditLog,
    auditChannels
};
