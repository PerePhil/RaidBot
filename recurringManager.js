/**
 * Recurring Raids Manager
 * Handles scheduled automatic raid creation
 */

const { db, prepare, transaction } = require('./db/database');
const { templatesForGuild, deriveSlug } = require('./templatesManager');
const { raidChannels, museumChannels, setActiveRaid, getActiveRaid, getGuildSettings } = require('./state');
const { EmbedBuilder } = require('discord.js');
const chrono = require('chrono-node');

// In-memory cache
const recurringRaids = new Map(); // id -> recurring data

// Prepared statements
let statements = null;

function getStatements() {
    if (statements) return statements;

    statements = {
        getAll: prepare('SELECT * FROM recurring_raids'),
        getGuild: prepare('SELECT * FROM recurring_raids WHERE guild_id = ?'),
        getById: prepare('SELECT * FROM recurring_raids WHERE id = ?'),
        getEnabled: prepare('SELECT * FROM recurring_raids WHERE enabled = 1 AND next_scheduled_at <= ?'),

        insert: prepare(`
            INSERT INTO recurring_raids (
                id, guild_id, channel_id, template_slug, template_data,
                schedule_type, day_of_week, time_of_day, interval_hours, timezone,
                length, strategy, copy_participants, advance_hours,
                creator_id, enabled, next_scheduled_at, created_at
            ) VALUES (
                @id, @guild_id, @channel_id, @template_slug, @template_data,
                @schedule_type, @day_of_week, @time_of_day, @interval_hours, @timezone,
                @length, @strategy, @copy_participants, @advance_hours,
                @creator_id, @enabled, @next_scheduled_at, unixepoch()
            )
        `),

        update: prepare(`
            UPDATE recurring_raids SET
                channel_id = @channel_id,
                template_slug = @template_slug,
                template_data = @template_data,
                schedule_type = @schedule_type,
                day_of_week = @day_of_week,
                time_of_day = @time_of_day,
                interval_hours = @interval_hours,
                timezone = @timezone,
                length = @length,
                strategy = @strategy,
                copy_participants = @copy_participants,
                advance_hours = @advance_hours,
                enabled = @enabled,
                next_scheduled_at = @next_scheduled_at
            WHERE id = @id
        `),

        updateAfterSpawn: prepare(`
            UPDATE recurring_raids SET
                last_created_at = @last_created_at,
                last_message_id = @last_message_id,
                next_scheduled_at = @next_scheduled_at
            WHERE id = @id
        `),

        delete: prepare('DELETE FROM recurring_raids WHERE id = ?'),

        toggleEnabled: prepare('UPDATE recurring_raids SET enabled = ? WHERE id = ?')
    };

    return statements;
}

function loadRecurringRaids() {
    recurringRaids.clear();
    const stmts = getStatements();
    const rows = stmts.getAll.all();

    rows.forEach(row => {
        recurringRaids.set(row.id, rowToRecurring(row));
    });

    console.log(`Loaded ${recurringRaids.size} recurring raid schedules`);
}

function rowToRecurring(row) {
    return {
        id: row.id,
        guildId: row.guild_id,
        channelId: row.channel_id,
        templateSlug: row.template_slug,
        templateData: row.template_data ? JSON.parse(row.template_data) : null,
        scheduleType: row.schedule_type,
        dayOfWeek: row.day_of_week,
        timeOfDay: row.time_of_day,
        intervalHours: row.interval_hours,
        timezone: row.timezone || 'America/New_York',
        length: row.length,
        strategy: row.strategy,
        copyParticipants: row.copy_participants === 1,
        advanceHours: row.advance_hours || 24,
        creatorId: row.creator_id,
        enabled: row.enabled === 1,
        lastCreatedAt: row.last_created_at,
        lastMessageId: row.last_message_id,
        nextScheduledAt: row.next_scheduled_at,
        createdAt: row.created_at
    };
}

function generateId() {
    return `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function createRecurringRaid(data) {
    const stmts = getStatements();
    const id = generateId();
    const nextScheduledAt = calculateNextScheduledTime(data);

    const row = {
        id,
        guild_id: data.guildId,
        channel_id: data.channelId || null,
        template_slug: data.templateSlug,
        template_data: data.templateData ? JSON.stringify(data.templateData) : null,
        schedule_type: data.scheduleType,
        day_of_week: data.dayOfWeek ?? null,
        time_of_day: data.timeOfDay || null,
        interval_hours: data.intervalHours ?? null,
        timezone: data.timezone || 'America/New_York',
        length: data.length || null,
        strategy: data.strategy || null,
        copy_participants: data.copyParticipants ? 1 : 0,
        advance_hours: data.advanceHours || 24,
        creator_id: data.creatorId,
        enabled: 1,
        next_scheduled_at: nextScheduledAt
    };

    stmts.insert.run(row);

    const recurring = {
        ...data,
        id,
        enabled: true,
        nextScheduledAt,
        lastCreatedAt: null,
        lastMessageId: null
    };

    recurringRaids.set(id, recurring);
    return recurring;
}

function updateRecurringRaid(id, updates) {
    const stmts = getStatements();
    const existing = recurringRaids.get(id);
    if (!existing) return null;

    const merged = { ...existing, ...updates };
    const nextScheduledAt = calculateNextScheduledTime(merged);

    stmts.update.run({
        id,
        channel_id: merged.channelId || null,
        template_slug: merged.templateSlug,
        template_data: merged.templateData ? JSON.stringify(merged.templateData) : null,
        schedule_type: merged.scheduleType,
        day_of_week: merged.dayOfWeek ?? null,
        time_of_day: merged.timeOfDay || null,
        interval_hours: merged.intervalHours ?? null,
        timezone: merged.timezone || 'America/New_York',
        length: merged.length || null,
        strategy: merged.strategy || null,
        copy_participants: merged.copyParticipants ? 1 : 0,
        advance_hours: merged.advanceHours || 24,
        enabled: merged.enabled ? 1 : 0,
        next_scheduled_at: nextScheduledAt
    });

    merged.nextScheduledAt = nextScheduledAt;
    recurringRaids.set(id, merged);
    return merged;
}

function deleteRecurringRaid(id) {
    const stmts = getStatements();
    stmts.delete.run(id);
    recurringRaids.delete(id);
}

function toggleRecurringRaid(id, enabled) {
    const stmts = getStatements();
    const existing = recurringRaids.get(id);
    if (!existing) return null;

    stmts.toggleEnabled.run(enabled ? 1 : 0, id);
    existing.enabled = enabled;

    // Recalculate next time if re-enabling
    if (enabled) {
        const nextScheduledAt = calculateNextScheduledTime(existing);
        stmts.updateAfterSpawn.run({
            id,
            last_created_at: existing.lastCreatedAt,
            last_message_id: existing.lastMessageId,
            next_scheduled_at: nextScheduledAt
        });
        existing.nextScheduledAt = nextScheduledAt;
    }

    return existing;
}

function getRecurringRaid(id) {
    return recurringRaids.get(id);
}

function getGuildRecurringRaids(guildId) {
    return Array.from(recurringRaids.values()).filter(r => r.guildId === guildId);
}

/**
 * Calculate the next scheduled spawn time based on schedule type
 * Returns Unix timestamp (seconds) when we should CREATE the raid
 * (which is advanceHours before the actual raid time)
 */
function calculateNextScheduledTime(recurring) {
    const now = new Date();
    const tz = recurring.timezone || 'America/New_York';
    const advanceMs = (recurring.advanceHours || 24) * 60 * 60 * 1000;

    let raidTime;

    if (recurring.scheduleType === 'weekly') {
        raidTime = getNextWeeklyTime(now, recurring.dayOfWeek, recurring.timeOfDay, tz);

        // If spawn time (raid time - advance) is in the past, get next week
        let spawnTime = new Date(raidTime.getTime() - advanceMs);
        while (spawnTime <= now) {
            raidTime = new Date(raidTime.getTime() + 7 * 24 * 60 * 60 * 1000);
            spawnTime = new Date(raidTime.getTime() - advanceMs);
        }
    } else if (recurring.scheduleType === 'daily') {
        raidTime = getNextDailyTime(now, recurring.timeOfDay, tz);

        // If spawn time (raid time - advance) is in the past, get next day
        let spawnTime = new Date(raidTime.getTime() - advanceMs);
        while (spawnTime <= now) {
            raidTime = new Date(raidTime.getTime() + 24 * 60 * 60 * 1000);
            spawnTime = new Date(raidTime.getTime() - advanceMs);
        }
    } else if (recurring.scheduleType === 'interval') {
        // For interval, base off last created time or now
        const baseTime = recurring.lastCreatedAt
            ? new Date(recurring.lastCreatedAt * 1000)
            : now;
        raidTime = new Date(baseTime.getTime() + (recurring.intervalHours || 24) * 60 * 60 * 1000);

        // If calculated time is in the past, keep adding intervals
        while (raidTime <= now) {
            raidTime = new Date(raidTime.getTime() + (recurring.intervalHours || 24) * 60 * 60 * 1000);
        }
    } else {
        // Default: 24 hours from now
        raidTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }

    // Spawn time is advanceHours before raid time
    const spawnTime = new Date(raidTime.getTime() - advanceMs);

    return Math.floor(spawnTime.getTime() / 1000);
}

function getNextWeeklyTime(now, dayOfWeek, timeOfDay, tz) {
    const [hours, minutes] = parseTimeOfDay(timeOfDay);

    // Create date in target timezone
    const target = new Date(now);

    // Find next occurrence of dayOfWeek
    const currentDay = now.getDay();
    let daysUntil = (dayOfWeek - currentDay + 7) % 7;

    // If it's today, check if time has passed
    if (daysUntil === 0) {
        const todayTarget = new Date(now);
        todayTarget.setHours(hours, minutes, 0, 0);
        if (todayTarget <= now) {
            daysUntil = 7; // Next week
        }
    }

    target.setDate(target.getDate() + daysUntil);
    target.setHours(hours, minutes, 0, 0);

    return target;
}

function getNextDailyTime(now, timeOfDay, tz) {
    const [hours, minutes] = parseTimeOfDay(timeOfDay);

    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);

    // If time has passed today, use tomorrow
    if (target <= now) {
        target.setDate(target.getDate() + 1);
    }

    return target;
}

function parseTimeOfDay(timeStr) {
    if (!timeStr) return [19, 0]; // Default 7pm

    // Try 24h format first (e.g., "19:00")
    const match24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
        return [parseInt(match24[1], 10), parseInt(match24[2], 10)];
    }

    // Try 12h format (e.g., "7:00 PM", "7pm", "7 PM")
    const match12 = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)$/i);
    if (match12) {
        let hours = parseInt(match12[1], 10);
        const minutes = match12[2] ? parseInt(match12[2], 10) : 0;
        const isPM = match12[3].toLowerCase() === 'pm';

        if (isPM && hours !== 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;

        return [hours, minutes];
    }

    // Try natural language with chrono-node (e.g., "tomorrow at 7pm" -> extract time)
    try {
        const parsed = chrono.parseDate(timeStr);
        if (parsed) {
            return [parsed.getHours(), parsed.getMinutes()];
        }
    } catch (e) {
        // Ignore parsing errors
    }

    return [19, 0];
}

/**
 * Check for recurring raids that need to spawn and create them
 */
async function checkAndSpawnRecurringRaids(client) {
    const now = Math.floor(Date.now() / 1000);
    const stmts = getStatements();

    // Get all enabled recurring raids that are due
    const dueRaids = stmts.getEnabled.all(now);

    for (const row of dueRaids) {
        const recurring = rowToRecurring(row);
        try {
            await spawnRaidFromRecurring(client, recurring);
        } catch (error) {
            console.error(`Failed to spawn recurring raid ${recurring.id}:`, error);
        }
    }
}

/**
 * Create an actual raid from a recurring definition
 */
async function spawnRaidFromRecurring(client, recurring) {
    const stmts = getStatements();

    // Calculate the actual raid time (spawn time + advance hours)
    const raidTimestamp = recurring.nextScheduledAt + (recurring.advanceHours || 24) * 60 * 60;

    // Get channel
    let channelId = recurring.channelId;
    if (!channelId) {
        if (recurring.templateSlug === 'museum') {
            channelId = museumChannels.get(recurring.guildId);
        } else {
            channelId = raidChannels.get(recurring.guildId);
        }
    }

    if (!channelId) {
        console.warn(`No channel configured for recurring raid ${recurring.id}`);
        return null;
    }

    // Fetch channel
    let channel;
    try {
        const guild = await client.guilds.fetch(recurring.guildId);
        channel = await guild.channels.fetch(channelId);
    } catch (error) {
        console.error(`Failed to fetch channel for recurring raid ${recurring.id}:`, error);
        return null;
    }

    // Get template
    const templates = templatesForGuild(recurring.guildId);
    let template = templates.find(t => t.slug === recurring.templateSlug || t.id === recurring.templateSlug);

    if (!template && recurring.templateData) {
        template = recurring.templateData;
    }

    if (!template && recurring.templateSlug !== 'museum') {
        console.error(`Template not found for recurring raid ${recurring.id}: ${recurring.templateSlug}`);
        return null;
    }

    // Build raid data
    const raidId = generateRaidId();
    const isMuseum = recurring.templateSlug === 'museum';

    const raidData = {
        raidId,
        type: isMuseum ? 'museum' : 'raid',
        guildId: recurring.guildId,
        channelId,
        creatorId: recurring.creatorId,
        timestamp: raidTimestamp,
        recurringId: recurring.id,
        template: isMuseum ? null : template,
        length: recurring.length,
        strategy: recurring.strategy,
        signups: isMuseum ? [] : initializeSignups(template),
        waitlist: isMuseum ? [] : undefined,
        maxSlots: isMuseum ? 12 : undefined
    };

    // Copy participants from previous instance if enabled
    if (recurring.copyParticipants && recurring.lastMessageId) {
        await copyParticipantsFromPrevious(client, recurring, raidData);
    }

    // Create the raid message embed
    let embed;
    if (isMuseum) {
        embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('🏛️ Museum Signup! 🏛️')
            .setDescription('React below to sign up for the museum run!')
            .addFields(
                { name: '\n**Date + Time:**', value: `<t:${raidTimestamp}:F>`, inline: false },
                { name: '\n**Signups (0/12):**', value: '*No signups yet*', inline: false },
                { name: '\u200b', value: `*Raid ID: \`${raidId}\`*\n🔄 Recurring raid`, inline: false }
            )
            .setTimestamp(new Date(raidTimestamp * 1000));
    } else {
        const timestampStr = `<t:${raidTimestamp}:F>`;
        const lengthBadge = recurring.length ? `\`${recurring.length} HOUR KEY\`` : '';

        const fields = [
            {
                name: '\n**Date + Time:**',
                value: lengthBadge ? `${timestampStr} || ${lengthBadge}` : timestampStr,
                inline: false
            }
        ];

        // Add role groups
        if (template.roleGroups) {
            for (const group of template.roleGroups) {
                fields.push({
                    name: `\n**${group.name}:**`,
                    value: group.roles.map(role => `${role.emoji} ${role.icon || ''} ${role.name}`).join('\n'),
                    inline: false
                });
            }
        }

        fields.push({
            name: '\u200b',
            value: `*Raid ID: \`${raidId}\`*\n🔄 Recurring raid`,
            inline: false
        });

        embed = new EmbedBuilder()
            .setColor(template.color || '#0099ff')
            .setTitle(`${template.emoji || ''} ${template.name}! ${template.emoji || ''}`)
            .setDescription(template.description || '')
            .setFields(fields)
            .setTimestamp(new Date(raidTimestamp * 1000));
    }

    let message;
    try {
        message = await channel.send({ embeds: [embed] });

        // Add reactions for museum or raid roles
        if (isMuseum) {
            await message.react('✅');
        } else if (template.roleGroups) {
            for (const group of template.roleGroups) {
                for (const role of group.roles) {
                    await message.react(role.emoji);
                }
            }
        }
    } catch (error) {
        console.error(`Failed to send raid message for recurring ${recurring.id}:`, error);
        return null;
    }

    // Create discussion thread if enabled
    const settings = getGuildSettings(recurring.guildId);
    if (settings.threadsEnabled) {
        try {
            const threadName = isMuseum ? `Museum - ${raidId}` : `${template?.name || 'Raid'} - ${raidId}`;
            const thread = await message.startThread({
                name: threadName,
                autoArchiveDuration: settings.threadAutoArchiveMinutes || 1440
            });
            raidData.threadId = thread.id;
            await thread.send(`💬 Discussion thread for **${threadName}**\n⏰ Raid time: <t:${raidTimestamp}:F>\n🔄 This is a recurring raid.`);
        } catch (error) {
            console.error(`Failed to create thread for recurring raid ${recurring.id}:`, error);
        }
    }

    // Save the raid
    setActiveRaid(message.id, raidData);

    // Update recurring state
    const nextScheduled = calculateNextScheduledTime({
        ...recurring,
        lastCreatedAt: Math.floor(Date.now() / 1000)
    });

    stmts.updateAfterSpawn.run({
        id: recurring.id,
        last_created_at: Math.floor(Date.now() / 1000),
        last_message_id: message.id,
        next_scheduled_at: nextScheduled
    });

    // Update cache
    recurring.lastCreatedAt = Math.floor(Date.now() / 1000);
    recurring.lastMessageId = message.id;
    recurring.nextScheduledAt = nextScheduled;
    recurringRaids.set(recurring.id, recurring);

    console.log(`Spawned recurring raid ${recurring.id} -> ${raidId} (message: ${message.id})`);

    return { raidData, messageId: message.id };
}

function generateRaidId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 4; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

function initializeSignups(template) {
    if (!template || !template.roleGroups) return [];

    const signups = [];
    for (const group of template.roleGroups) {
        for (const role of group.roles || []) {
            signups.push({
                emoji: role.emoji || group.emoji,
                icon: role.icon,
                name: role.name,
                slots: role.slots || 1,
                users: [],
                waitlist: [],
                groupName: group.name,
                sideAssignments: {}
            });
        }
    }
    return signups;
}

async function copyParticipantsFromPrevious(client, recurring, newRaidData) {
    const previousRaid = getActiveRaid(recurring.lastMessageId);
    if (!previousRaid) return;

    const participantIds = new Set();

    if (previousRaid.type === 'museum') {
        // Copy museum signups
        previousRaid.signups?.forEach(userId => participantIds.add(userId));
        newRaidData.signups = [...participantIds];
    } else {
        // Copy raid signups by role
        if (previousRaid.signups && newRaidData.signups) {
            for (const prevRole of previousRaid.signups) {
                const newRole = newRaidData.signups.find(r => r.name === prevRole.name);
                if (newRole && prevRole.users) {
                    // Copy users up to slot limit
                    const toCopy = prevRole.users.slice(0, newRole.slots);
                    newRole.users = [...toCopy];
                    toCopy.forEach(id => participantIds.add(id));
                }
            }
        }
    }

    // Send DM notifications to pre-registered users
    for (const userId of participantIds) {
        try {
            const user = await client.users.fetch(userId);
            const templateName = newRaidData.template?.name || 'Raid';
            const timeStr = `<t:${newRaidData.timestamp}:F>`;
            await user.send(
                `You've been pre-registered for the next **${templateName}** on ${timeStr}.\n` +
                `This is a recurring raid - react to change your role or remove your signup.`
            );
        } catch (error) {
            // Ignore DM failures (user may have DMs disabled)
        }
    }
}

/**
 * Get human-readable schedule description
 */
function formatScheduleDescription(recurring) {
    const timeStr = recurring.timeOfDay || '19:00';
    const [h, m] = parseTimeOfDay(timeStr);
    const time12 = `${h > 12 ? h - 12 : h || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    if (recurring.scheduleType === 'weekly') {
        const day = days[recurring.dayOfWeek] || 'Unknown';
        return `Weekly on ${day} at ${time12}`;
    } else if (recurring.scheduleType === 'daily') {
        return `Daily at ${time12}`;
    } else if (recurring.scheduleType === 'interval') {
        return `Every ${recurring.intervalHours} hours`;
    }
    return 'Unknown schedule';
}

module.exports = {
    loadRecurringRaids,
    createRecurringRaid,
    updateRecurringRaid,
    deleteRecurringRaid,
    toggleRecurringRaid,
    getRecurringRaid,
    getGuildRecurringRaids,
    calculateNextScheduledTime,
    checkAndSpawnRecurringRaids,
    spawnRaidFromRecurring,
    formatScheduleDescription
};
