const fs = require('fs');
const { safeWriteFile, dataPath } = require('./state');

const AUDIT_FILE = dataPath('audit_channels.json');
const auditChannels = new Map();

const pendingEmbeds = new Map(); // guildId -> [payloads]
const flushTimers = new Map(); // guildId -> timeout
const guildRefs = new Map(); // guildId -> guild ref
const BATCH_WINDOW_MS = 2 * 60 * 1000;
const EMBEDS_PER_MESSAGE = 10;

function loadAuditChannels() {
    if (!fs.existsSync(AUDIT_FILE)) return;
    try {
        const data = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
        Object.entries(data).forEach(([guildId, channelId]) => auditChannels.set(guildId, channelId));
    } catch (error) {
        console.error('Failed to load audit channels:', error);
    }
}

function saveAuditChannels() {
    safeWriteFile(AUDIT_FILE, JSON.stringify(Object.fromEntries(auditChannels), null, 2));
}

function setAuditChannel(guildId, channelId) {
    if (!channelId) {
        auditChannels.delete(guildId);
    } else {
        auditChannels.set(guildId, channelId);
    }
    saveAuditChannels();
}

function getAuditChannel(guildId) {
    return auditChannels.get(guildId) || null;
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
