const templates = require('../templates');
const {
    activeRaids,
    loadActiveRaidState,
    saveActiveRaidState,
    setActiveRaid,
    deleteActiveRaid
} = require('../state');
const { updateBotPresence } = require('../presence');
const { deriveSlug } = require('../templatesManager');
const {
    updateRaidEmbed,
    updateMuseumEmbed,
    getRaidSignupChannel,
    getMuseumSignupChannel,
    fetchRaidMessage
} = require('../utils/raidHelpers');

async function reinitializeRaids(client) {
    console.log('Restoring stored raids...');
    loadActiveRaidState();

    let stateChanged = await refreshStoredRaids(client);
    const discovered = await scanForExistingRaids(client);
    stateChanged = stateChanged || discovered;

    if (stateChanged) {
        saveActiveRaidState();
    }

    console.log(`Reinitialized ${activeRaids.size} active raids`);
    await updateBotPresence();
}

async function refreshStoredRaids(client) {
    if (activeRaids.size === 0) {
        return false;
    }

    let removedAny = false;

    for (const [messageId, raidData] of activeRaids.entries()) {
        if (!raidData.guildId || !raidData.channelId) {
            deleteActiveRaid(messageId, { persist: false });
            removedAny = true;
            continue;
        }

        const guild = await resolveGuild(client, raidData.guildId);
        if (!guild) {
            deleteActiveRaid(messageId, { persist: false });
            removedAny = true;
            continue;
        }

        const message = await fetchRaidMessage(guild, raidData, messageId);
        if (!message) {
            deleteActiveRaid(messageId, { persist: false });
            removedAny = true;
            continue;
        }

        try {
            if (raidData.type === 'museum') {
                await updateMuseumEmbed(message, raidData);
            } else {
                await updateRaidEmbed(message, raidData);
            }
        } catch (error) {
            console.error('Error syncing stored raid embed:', error);
        }
    }

    if (removedAny) {
        console.log('Removed stale raid entries from storage');
    }

    return removedAny;
}

async function scanForExistingRaids(client) {
    let stateChanged = false;

    for (const guild of client.guilds.cache.values()) {
        const channels = await collectChannels(guild);

        for (const channel of channels) {
            try {
                const messages = await channel.messages.fetch({ limit: 100 });

                for (const message of messages.values()) {
                    if (message.author.id !== client.user.id || message.embeds.length === 0) {
                        continue;
                    }

                    if (activeRaids.has(message.id)) {
                        continue;
                    }

                    const embed = message.embeds[0];
                    const description = embed.description || '';
                    const raidIdField = embed.fields?.find((f) => f.value && f.value.includes('Raid ID:'));
                    if (!raidIdField) continue;

                    const raidIdMatch = raidIdField.value.match(/Raid ID: `([A-Z0-9]+)`/);
                    const creatorMatch = raidIdField.value.match(/Created by <@!?(\d+)>/);

                    if (!raidIdMatch || !creatorMatch) continue;

                    const raidId = raidIdMatch[1];
                    const creatorId = creatorMatch[1];
                    const title = embed.title || '';

                    if (title.includes('Museum')) {
                        const created = await rebuildMuseumSignup(message, guild.id, raidId, creatorId, description);
                        stateChanged = stateChanged || created;
                        continue;
                    }

                    let template = null;
                    if (title.includes('The Voracious Void')) {
                        template = templates.raids.find((r) => r.name === 'The Voracious Void Raid');
                    } else if (title.includes('Ghastly Conspiracy')) {
                        template = templates.raids.find((r) => r.name === 'The Ghastly Conspiracy Raid');
                    } else if (title.includes('Cabal\'s Revenge')) {
                        template = templates.raids.find((r) => r.name === 'The Cabal\'s Revenge Raid');
                    }

                    if (!template) continue;

                    const templateWithSlug = { ...template, slug: deriveSlug(template.name || '') };
                    const created = await rebuildRaidSignup(message, guild.id, raidId, creatorId, templateWithSlug, description);
                    stateChanged = stateChanged || created;
                }
            } catch (error) {
                console.error('Error reinitializing raids:', error);
            }
        }
    }

    return stateChanged;
}

async function collectChannels(guild) {
    const uniqueChannels = new Map();
    const raidChannel = await getRaidSignupChannel(guild);
    const museumChannel = await getMuseumSignupChannel(guild);

    if (raidChannel) {
        uniqueChannels.set(raidChannel.id, raidChannel);
    }

    if (museumChannel) {
        uniqueChannels.set(museumChannel.id, museumChannel);
    }

    return Array.from(uniqueChannels.values());
}

async function rebuildMuseumSignup(message, guildId, raidId, creatorId, description) {
    const reactionSignups = [];
    const reaction = message.reactions.cache.find((r) => r.emoji.name === '✅');

    if (reaction) {
        try {
            if (reaction.partial) await reaction.fetch();
            const userCollection = await reaction.users.fetch();
            userCollection.forEach((reactUser) => {
                if (!reactUser.bot && !reactionSignups.includes(reactUser.id)) {
                    reactionSignups.push(reactUser.id);
                }
            });
        } catch (err) {
            console.error('Error fetching museum reaction users:', err);
        }
    }

    const museumDetails = extractMuseumSignupDetails(message);
    const signups = mergeUniqueUsers(reactionSignups, museumDetails.signups);
    const waitlist = museumDetails.waitlist.filter((userId) => !signups.includes(userId));
    const timingInfo = extractTimingFromDescription(description, message.embeds?.[0]?.fields);
    const statusInfo = extractStatusFromEmbed(message.embeds?.[0]);

    const raidRecord = {
        raidId,
        type: 'museum',
        signups,
        datetime: timingInfo.datetime,
        timestamp: timingInfo.timestamp,
        creatorId,
        maxSlots: 12,
        guildId,
        waitlist,
        channelId: message.channel.id,
        creatorReminderSent: false,
        participantReminderSent: false,
        ...statusInfo
    };

    setActiveRaid(message.id, raidRecord, { persist: false });

    await updateMuseumEmbed(message, raidRecord);
    console.log(`Reinitialized museum signup ${raidId} with ${signups.length} signups`);
    return true;
}

async function rebuildRaidSignup(message, guildId, raidId, creatorId, template, description) {
    const lengthMatch = description.match(/`(\d+\.?\d*) HOUR KEY`/);
    const length = lengthMatch ? lengthMatch[1] : '1.5';
    const strategy = description.includes('2 myth 1 storm') ? '2 myth 1 storm' : 'triple storm';
    let roleGroups = JSON.parse(JSON.stringify(template.roleGroups));
    const embedSideAssignments = extractSideAssignmentsFromMessage(message);
    const roleDetails = extractRoleDetailsFromEmbed(message);
    const timingInfo = extractTimingFromDescription(description, message.embeds?.[0]?.fields);
    const statusInfo = extractStatusFromEmbed(message.embeds?.[0]);

    if (strategy === '2 myth 1 storm') {
        const vanguardGroup = roleGroups.find((g) => g.name === 'VANGAURD');
        if (vanguardGroup) {
            vanguardGroup.roles = [
                { emoji: '1️⃣', icon: '<:Myth:1430673701439017100>', name: 'Myth 1', slots: 1 },
                { emoji: '2️⃣', icon: '<:Myth:1430673701439017100>', name: 'Myth 2', slots: 1 },
                { emoji: '3️⃣', icon: '<:Storm:1430690317421776957>', name: 'Storm 1', slots: 1 },
                { emoji: '4️⃣', icon: '<:Balance:1430673056380092457>', name: 'Jade', slots: 1 }
            ];
        }
    }

    const allRoles = [];

    for (const group of roleGroups) {
        for (const role of group.roles) {
            const users = [];
            const reaction = message.reactions.cache.find((r) => r.emoji.name === role.emoji);

            if (reaction) {
                try {
                    if (reaction.partial) await reaction.fetch();
                    const userCollection = await reaction.users.fetch();
                    userCollection.forEach((reactUser) => {
                        if (!reactUser.bot && !users.includes(reactUser.id)) {
                            users.push(reactUser.id);
                        }
                    });
                } catch (err) {
                    console.error('Error fetching reaction users:', err);
                }
            }

            const embedDetails = roleDetails.get(role.emoji) || { users: [], waitlist: [] };
            const combinedUsers = mergeUniqueUsers(users, embedDetails.users);
            const waitlist = (embedDetails.waitlist || []).filter((userId) => !combinedUsers.includes(userId));
            const roleSideAssignments = filterAssignmentsForRole(role.emoji, combinedUsers, embedSideAssignments);

            allRoles.push({
                emoji: role.emoji,
                icon: role.icon,
                name: role.name,
                slots: role.slots,
                users: combinedUsers,
                groupName: group.name,
                sideAssignments: roleSideAssignments,
                waitlist
            });
        }
    }

    const raidRecord = {
        raidId,
        template,
        signups: allRoles,
        datetime: timingInfo.datetime,
        timestamp: timingInfo.timestamp,
        length,
        strategy,
        creatorId,
        guildId,
        channelId: message.channel.id,
        creatorReminderSent: false,
        participantReminderSent: false,
        ...statusInfo
    };

    setActiveRaid(message.id, raidRecord, { persist: false });

    await updateRaidEmbed(message, raidRecord);
    const filled = allRoles.reduce((sum, r) => sum + r.users.length, 0);
    console.log(`Reinitialized raid ${raidId} with ${filled} signups`);
    return true;
}

module.exports = { reinitializeRaids };

function extractSideAssignmentsFromMessage(message) {
    const embed = message.embeds?.[0];
    if (!embed || !Array.isArray(embed.fields)) {
        return new Map();
    }

    const assignments = new Map();

    embed.fields.forEach((field) => {
        if (!field?.value || typeof field.value !== 'string') {
            return;
        }

        const lines = field.value.split('\n');
        lines.forEach((rawLine) => {
            const line = rawLine.trim();
            if (!line || line.startsWith('Waitlist:')) return;

            const dashIndex = line.indexOf(' - ');
            if (dashIndex === -1 || !line.includes('<@')) return;

            const header = line.slice(0, dashIndex);
            const emojiMatch = header.match(/^(\S+)/);
            if (!emojiMatch) return;
            const emoji = emojiMatch[1];

            const userSection = line.slice(dashIndex + 3).trim();
            if (!userSection) return;

            const userEntries = userSection.split(',').map((entry) => entry.trim()).filter(Boolean);
            userEntries.forEach((entry) => {
                if (!entry.startsWith('<@')) return;
                const mentionMatch = entry.match(/<@!?(\d+)>/);
                if (!mentionMatch) return;

                const userId = mentionMatch[1];
                const assignmentIndex = entry.indexOf(' - ', entry.indexOf('>'));
                if (assignmentIndex === -1) return;

                const assignment = entry.slice(assignmentIndex + 3).trim();
                if (!assignment) return;

                const emojiAssignments = assignments.get(emoji) || {};
                emojiAssignments[userId] = assignment;
                assignments.set(emoji, emojiAssignments);
            });
        });
    });

    return assignments;
}

function filterAssignmentsForRole(emoji, users, embedAssignments) {
    const roleAssignments = embedAssignments.get(emoji);
    if (!roleAssignments) {
        return {};
    }

    const filtered = {};
    users.forEach((userId) => {
        if (roleAssignments[userId]) {
            filtered[userId] = roleAssignments[userId];
        }
    });
    return filtered;
}

function extractRoleDetailsFromEmbed(message) {
    const embed = message.embeds?.[0];
    const details = new Map();
    if (!embed?.fields) {
        return details;
    }

    embed.fields.forEach((field) => {
        if (!field?.value || typeof field.value !== 'string') {
            return;
        }

        const lines = field.value.split('\n');
        let currentEmoji = null;

        lines.forEach((rawLine) => {
            const line = rawLine.trim();
            if (!line) return;

            if (/waitlist:/i.test(line)) {
                if (!currentEmoji) return;
                const waitlistMentions = extractUserIdsFromLine(line);
                if (waitlistMentions.length === 0) return;
                const entry = details.get(currentEmoji) || { users: [], waitlist: [] };
                waitlistMentions.forEach((userId) => {
                    if (!entry.waitlist.includes(userId)) {
                        entry.waitlist.push(userId);
                    }
                });
                details.set(currentEmoji, entry);
                return;
            }

            const emojiMatch = line.match(/^(\S+)/);
            if (!emojiMatch) {
                currentEmoji = null;
                return;
            }

            const emoji = emojiMatch[1];
            currentEmoji = emoji;
            const userMentions = extractUserIdsFromLine(line);
            if (userMentions.length === 0) {
                return;
            }

            const entry = details.get(emoji) || { users: [], waitlist: [] };
            userMentions.forEach((userId) => {
                if (!entry.users.includes(userId)) {
                    entry.users.push(userId);
                }
            });
            details.set(emoji, entry);
        });
    });

    return details;
}

function extractMuseumSignupDetails(message) {
    const embed = message.embeds?.[0];
    const details = { signups: [], waitlist: [] };
    if (!embed?.fields) {
        return details;
    }

    embed.fields.forEach((field) => {
        if (!field?.value || typeof field.value !== 'string') {
            return;
        }

        const fieldName = typeof field.name === 'string' ? field.name.trim() : '';

        if (fieldName === '**Signups:**') {
            const lines = field.value.split('\n');
            lines.forEach((line) => {
                extractUserIdsFromLine(line).forEach((id) => {
                    if (!details.signups.includes(id)) {
                        details.signups.push(id);
                    }
                });
            });
        } else if (fieldName === '**Waitlist:**') {
            const lines = field.value.split('\n');
            lines.forEach((line) => {
                extractUserIdsFromLine(line).forEach((id) => {
                    if (!details.waitlist.includes(id)) {
                        details.waitlist.push(id);
                    }
                });
            });
        }
    });

    return details;
}

function extractUserIdsFromLine(line) {
    const ids = [];
    const mentionMatches = Array.from(line.matchAll(/<@!?(\d+)>/g));
    mentionMatches.forEach((m) => ids.push(m[1]));
    const urlMatches = Array.from(line.matchAll(/https?:\/\/discord\.com\/users\/(\d+)/g));
    urlMatches.forEach((m) => ids.push(m[1]));
    return ids;
}

function mergeUniqueUsers(primary = [], secondary = []) {
    const seen = new Set();
    const merged = [];

    [...primary, ...secondary].forEach((userId) => {
        if (!userId || seen.has(userId)) {
            return;
        }
        seen.add(userId);
        merged.push(userId);
    });

    return merged;
}

function extractTimingFromDescription(description = '', fields = []) {
    const result = { timestamp: null, datetime: null };

    if (description) {
        const timestampMatch = description.match(/<t:(\d+):[a-zA-Z]>/i);
        if (timestampMatch) {
            result.timestamp = parseInt(timestampMatch[1], 10);
        }

        const labelMatch = description.match(/\*\*DATE \+ TIME\*\*\s*([^\n]+)/i);
        if (labelMatch) {
            const cleaned = labelMatch[1].split('||')[0].trim();
            if (cleaned.length > 0) {
                result.datetime = cleaned;
            }
        }
    }

    if (!result.timestamp || !result.datetime) {
        const dateField = (fields || []).find((f) => typeof f.name === 'string' && f.name.includes('Date + Time'));
        if (dateField?.value) {
            const tsMatch = dateField.value.match(/<t:(\d+):[a-zA-Z]>/i);
            if (tsMatch) {
                result.timestamp = parseInt(tsMatch[1], 10);
            }
            const cleaned = dateField.value.split('||')[0].trim();
            if (cleaned.length > 0) {
                result.datetime = cleaned;
            }
        }
    }

    return result;
}

function extractStatusFromEmbed(embed) {
    const status = {
        closed: false
    };

    if (!embed) {
        return status;
    }

    const statusField = embed.fields?.find((field) => field?.name === '\n**Status:**');
    const description = embed.description || '';

    if (statusField?.value) {
        const value = statusField.value;
        if (/Reopened/i.test(value)) {
            return status;
        }

        if (/Closed/i.test(value)) {
            status.closed = true;
            const closedByMatch = value.match(/Closed by <@!?(\d+)>/i);
            const timestampMatch = value.match(/<t:(\d+):[a-zA-Z]>/i);
            const autoMatch = /Closed automatically/i.test(value);

            if (closedByMatch) {
                status.closedBy = closedByMatch[1];
            }
            if (timestampMatch) {
                status.closedAt = parseInt(timestampMatch[1], 10);
            }
            if (autoMatch) {
                status.closedReason = 'auto';
                status.autoCloseExecuted = true;
            } else {
                status.closedReason = 'manual';
            }
            return status;
        }
    }

    if (/\*\*Signups Closed\*\*/i.test(description)) {
        status.closed = true;
        status.closedReason = 'manual';
    }

    return status;
}

async function resolveGuild(client, guildId) {
    if (!guildId) return null;
    const cached = client.guilds.cache.get(guildId);
    if (cached) {
        return cached;
    }

    try {
        return await client.guilds.fetch(guildId);
    } catch (error) {
        return null;
    }
}
