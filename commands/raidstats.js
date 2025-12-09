const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getUserStats, getGuildUserStats, raidStats, guildParticipation } = require('../state');
const { getAvailability } = require('../availabilityManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('raidstats')
        .setDescription('View raid participation totals and preferences')
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('Whose stats to view (default: you)')
                .setRequired(false))
        .addStringOption((option) =>
            option.setName('scope')
                .setDescription('View user stats, top server, or inactive members')
                .addChoices(
                    { name: 'User', value: 'user' },
                    { name: 'Server top', value: 'server' },
                    { name: 'Inactive members', value: 'inactive' }
                )
                .setRequired(false))
        .addRoleOption((option) =>
            option.setName('role')
                .setDescription('Optional: when viewing inactive, limit to members with this role')
                .setRequired(false)),
    async execute(interaction) {
        const scope = interaction.options.getString('scope') || 'user';
        const filterRole = interaction.options.getRole('role');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (scope === 'server') {
            return showServerStats(interaction);
        }
        if (scope === 'inactive') {
            return showInactive(interaction, filterRole);
        }
        const target = interaction.options.getUser('user') || interaction.user;
        const stats = interaction.guildId ? getGuildUserStats(interaction.guildId, target.id) : getUserStats(target.id);

        if (!stats.totalRaids) {
            return interaction.editReply({
                content: `${target.username} has no recorded raids yet.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const favoriteRole = topEntry(stats.roleCounts);
        const favoriteTemplate = topEntry(stats.templateCounts);
        const favoriteDay = topEntry(stats.weekdayCounts);
        const dayLabel = favoriteDay ? weekdayName(parseInt(favoriteDay.key, 10)) : '—';

        const embed = new EmbedBuilder()
            .setTitle(`${target.username}'s Raid Stats`)
            .addFields(
                { name: 'Total raids', value: String(stats.totalRaids), inline: true },
                { name: 'Favorite role', value: favoriteRole ? `${favoriteRole.key} (${favoriteRole.count})` : '—', inline: true },
                { name: 'Favorite raid type', value: favoriteTemplate ? `${favoriteTemplate.key} (${favoriteTemplate.count})` : '—', inline: true },
                { name: 'Most active day', value: dayLabel, inline: true }
            );

        const availability = interaction.guildId ? getAvailability(interaction.guildId, target.id) : null;
        if (availability) {
            const fields = [
                { name: 'Timezone', value: availability.timezone || '—', inline: true },
                { name: 'Preferred days', value: availability.days || '—', inline: true },
                { name: 'Preferred roles', value: availability.roles || '—', inline: true }
            ];
            if (availability.notes) {
                fields.push({ name: 'Notes', value: availability.notes, inline: false });
            }
            embed.addFields(fields).setFooter({ text: embed.data.footer?.text || `Availability set for ${target.username}` });
        }

        if (stats.lastUpdated) {
            embed.setFooter({ text: `Last updated ${new Date(stats.lastUpdated).toLocaleString()}` });
        }

        return interaction.editReply({ embeds: [embed] });
    }
};

function topEntry(mapLike) {
    if (!mapLike) return null;
    return Object.entries(mapLike).reduce((top, [key, count]) => {
        if (!top || count > top.count) {
            return { key, count };
        }
        return top;
    }, null);
}

function weekdayName(index) {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return names[index] || '—';
}

function showServerStats(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
        return interaction.editReply({ content: 'Server stats can only be viewed in a server.' });
    }
    const guildMap = guildParticipation.get(guildId);
    if (!guildMap || guildMap.size === 0) {
        return interaction.editReply({ content: 'No stats recorded yet for this server.' });
    }
    const topUsers = aggregateTotals(Array.from(guildMap.entries()), 5);
    const embed = new EmbedBuilder()
        .setTitle('Server Raid Stats')
        .setDescription('Top participants by total raids and favorite roles/types.')
        .addFields(
            {
                name: 'Top participants',
                value: topUsers.length > 0 ? topUsers.map((u, idx) => `${idx + 1}. <@${u.userId}> — ${u.totalRaids} raids`).join('\n') : 'No data',
                inline: false
            }
        );
    return interaction.editReply({ embeds: [embed] });
}

function aggregateTotals(entries, limit) {
    return entries
        .map(([userId, stats]) => ({ userId, totalRaids: stats.totalRaids || 0 }))
        .filter((x) => x.totalRaids > 0)
        .sort((a, b) => b.totalRaids - a.totalRaids)
        .slice(0, limit);
}

async function showInactive(interaction, filterRole) {
    if (!interaction.guild) {
        return interaction.editReply({ content: 'Inactive members list can only be viewed in a server.' });
    }
    const guildId = interaction.guildId;
    const guildMap = guildParticipation.get(guildId) || new Map();
    let members = null;
    let partialNote = '';

    // If we already have role membership cached, prefer that to avoid a full guild fetch.
    if (filterRole && filterRole.members?.size > 0) {
        members = filterRole.members;
        partialNote = '\n\n_(Used cached role members; list may be incomplete if the bot has not fully synced members.)_';
    }

    if (!members) {
        try {
            members = await interaction.guild.members.fetch({ withPresences: false, time: 15_000 });
        } catch (error) {
            console.warn('Failed to fetch members for inactive list:', error?.code || error);
            // fallback to cached members or cached role members if available
            if (filterRole && filterRole.members?.size > 0) {
                members = filterRole.members;
                partialNote = '\n\n_(Member fetch timed out; using cached role members. List may be incomplete.)_';
            } else {
                members = interaction.guild.members.cache;
                if (members && members.size > 0) {
                    partialNote = '\n\n_(Member fetch timed out; using cached members. List may be incomplete.)_';
                } else {
                    const friendly = error?.code === 'GuildMembersTimeout'
                        ? 'Member fetch timed out and no cached members are available. This usually means the server is large or the bot lacks the Guild Members intent.'
                        : 'Unable to load member list right now. Please try again.';
                    return interaction.editReply({ content: friendly });
                }
            }
        }
    }

    const inactive = [];
    for (const member of members.values()) {
        if (member.user.bot) continue;
        if (filterRole && !member.roles.cache.has(filterRole.id)) continue;
        const stats = guildMap.get(member.id);
        if (!stats || (stats.totalRaids || 0) === 0) {
            inactive.push(member);
        }
    }
    const qualifier = filterRole ? ` with role "${filterRole.name}"` : '';
    if (inactive.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('Inactive Members')
            .setDescription(`Everyone${qualifier} has at least one recorded raid signup.${partialNote}`)
            .setColor(0x57F287);
        return interaction.editReply({ embeds: [embed] });
    }
    const list = inactive.slice(0, 20).map((m) => `• ${m.user.username}`).join('\n');
    const more = inactive.length > 20 ? `\n...and ${inactive.length - 20} more.` : '';
    const embed = new EmbedBuilder()
        .setTitle('Inactive Members')
        .setDescription([
            `Members${qualifier} with no recorded raids (${inactive.length}):`,
            list,
            more,
            partialNote
        ].filter(Boolean).join('\n'))
        .setColor(0xFEE75C);
    return interaction.editReply({ embeds: [embed] });
}
