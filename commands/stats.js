const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const {
    generateWeeklyReport,
    generateMonthlyReport,
    exportToCSV,
    getAttendanceRate
} = require('../utils/analytics');
const { getGuildUserStats, guildParticipation, getAdminRoles, getCommandRoles } = require('../state');
const { getAvailability } = require('../availabilityManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View raid participation statistics and analytics')
        .addSubcommand((sub) =>
            sub.setName('user')
                .setDescription('View individual user statistics')
                .addUserOption((opt) =>
                    opt.setName('user')
                        .setDescription('User to view stats for (default: yourself)')
                        .setRequired(false)))
        .addSubcommand((sub) =>
            sub.setName('server')
                .setDescription('View server-wide participation statistics'))
        .addSubcommand((sub) =>
            sub.setName('weekly')
                .setDescription('View weekly participation summary')
                .addIntegerOption((opt) =>
                    opt.setName('weeks_back')
                        .setDescription('How many weeks back (0 = current)')
                        .setMinValue(0)
                        .setMaxValue(12)
                        .setRequired(false)))
        .addSubcommand((sub) =>
            sub.setName('monthly')
                .setDescription('View monthly participation summary')
                .addIntegerOption((opt) =>
                    opt.setName('months_back')
                        .setDescription('How many months back (0 = current)')
                        .setMinValue(0)
                        .setMaxValue(12)
                        .setRequired(false)))
        .addSubcommand((sub) =>
            sub.setName('inactive')
                .setDescription('View members with no participation')
                .addRoleOption((opt) =>
                    opt.setName('role')
                        .setDescription('Optional: limit to members with this role')
                        .setRequired(false)))
        .addSubcommand((sub) =>
            sub.setName('export')
                .setDescription('Export participation data as CSV')),

    requiresManageGuild: false, // user stats available to all, others check guild context

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!interaction.guildId && subcommand !== 'user') {
            return interaction.editReply({
                content: 'Server statistics are only available in servers.',
                flags: MessageFlags.Ephemeral
            });
        }

        switch (subcommand) {
            case 'user':
                return handleUserStats(interaction);
            case 'server':
                return handleServerStats(interaction);
            case 'weekly':
                return handleWeeklyReport(interaction);
            case 'monthly':
                return handleMonthlyReport(interaction);
            case 'inactive':
                return handleInactive(interaction);
            case 'export':
                return handleExport(interaction);
            default:
                return interaction.editReply({ content: 'Unknown subcommand.' });
        }
    }
};

// ============= USER STATS =============
async function handleUserStats(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guildId;

    // Permission check: viewing other users' stats requires permission
    if (target.id !== interaction.user.id && guildId) {
        const hasPermission = await canViewOthersStats(interaction);
        if (!hasPermission) {
            return interaction.editReply({
                content: 'You don\'t have permission to view other members\' stats. You can view your own stats with `/stats user`.',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    // Get stats from state.js (role preferences, weekday counts)
    const guildStats = guildId ? getGuildUserStats(guildId, target.id) : null;

    // Get analytics data (attendance rate)
    const attendanceRate = guildId ? getAttendanceRate(guildId, target.id) : 1;
    const percentage = (attendanceRate * 100).toFixed(1);

    if (!guildStats || !guildStats.totalRaids) {
        return interaction.editReply({
            content: `${target.username} has no recorded raids yet.`,
            flags: MessageFlags.Ephemeral
        });
    }

    const favoriteRole = topEntry(guildStats.roleCounts);
    const favoriteTemplate = topEntry(guildStats.templateCounts);
    const favoriteDay = topEntry(guildStats.weekdayCounts);
    const dayLabel = favoriteDay ? weekdayName(parseInt(favoriteDay.key, 10)) : '—';

    const attendanceEmoji = attendanceRate >= 0.9 ? '🌟' : attendanceRate >= 0.7 ? '✅' : attendanceRate >= 0.5 ? '⚠️' : '❌';

    const embed = new EmbedBuilder()
        .setTitle(`${target.username}'s Stats`)
        .setColor(attendanceRate >= 0.7 ? 0x57F287 : attendanceRate >= 0.5 ? 0xFEE75C : 0xED4245)
        .addFields(
            { name: 'Total Raids', value: String(guildStats.totalRaids), inline: true },
            { name: 'Attendance', value: `${attendanceEmoji} ${percentage}%`, inline: true },
            { name: 'Favorite Role', value: favoriteRole ? `${favoriteRole.key} (${favoriteRole.count})` : '—', inline: true },
            { name: 'Favorite Raid Type', value: favoriteTemplate ? `${favoriteTemplate.key} (${favoriteTemplate.count})` : '—', inline: true },
            { name: 'Most Active Day', value: dayLabel, inline: true }
        );

    // Add availability info if set
    const availability = guildId ? getAvailability(guildId, target.id) : null;
    if (availability) {
        const availFields = [];
        if (availability.timezone) availFields.push({ name: 'Timezone', value: availability.timezone, inline: true });
        if (availability.days) availFields.push({ name: 'Preferred Days', value: availability.days, inline: true });
        if (availability.roles) availFields.push({ name: 'Preferred Roles', value: availability.roles, inline: true });
        if (availability.notes) availFields.push({ name: 'Notes', value: availability.notes, inline: false });
        if (availFields.length > 0) embed.addFields(availFields);
    }

    if (guildStats.lastRaidAt) {
        embed.setFooter({ text: `Last active: ${new Date(guildStats.lastRaidAt).toLocaleDateString()}` });
    }

    return interaction.editReply({ embeds: [embed] });
}

/**
 * Check if the user has permission to view other members' stats
 */
async function canViewOthersStats(interaction) {
    const guildId = interaction.guildId;
    const member = interaction.member;

    // Server owner or Manage Guild permission always allowed
    if (member.id === interaction.guild.ownerId) return true;
    if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;

    // Check admin roles
    const adminRoles = getAdminRoles(guildId);
    for (const roleId of adminRoles) {
        if (member.roles.cache.has(roleId)) return true;
    }

    // Check stats_others specific permission
    const statsRoles = getCommandRoles(guildId, 'stats_others');
    for (const roleId of statsRoles) {
        if (member.roles.cache.has(roleId)) return true;
    }

    return false;
}

// ============= SERVER STATS =============
async function handleServerStats(interaction) {
    const guildId = interaction.guildId;
    const guildMap = guildParticipation.get(guildId);

    if (!guildMap || guildMap.size === 0) {
        return interaction.editReply({ content: 'No stats recorded yet for this server.' });
    }

    const topUsers = aggregateTotals(Array.from(guildMap.entries()), 5);
    const totalRaids = Array.from(guildMap.values()).reduce((sum, s) => sum + (s.totalRaids || 0), 0);
    const totalParticipants = guildMap.size;

    const embed = new EmbedBuilder()
        .setTitle('📊 Server Stats')
        .setColor(0x5865F2)
        .setDescription(`**${totalParticipants}** unique participants across **${totalRaids}** total raid signups`)
        .addFields({
            name: 'Top Participants',
            value: topUsers.length > 0
                ? topUsers.map((u, idx) => `${idx + 1}. <@${u.userId}> — ${u.totalRaids} raids`).join('\n')
                : 'No data',
            inline: false
        });

    return interaction.editReply({ embeds: [embed] });
}

// ============= WEEKLY REPORT =============
async function handleWeeklyReport(interaction) {
    const weeksBack = interaction.options.getInteger('weeks_back') || 0;
    const report = generateWeeklyReport(interaction.guildId, weeksBack);

    const topList = report.topParticipants.length > 0
        ? report.topParticipants.map((p, i) => `${i + 1}. <@${p.userId}> — ${p.signups} raids`).join('\n')
        : 'No data yet';

    const embed = new EmbedBuilder()
        .setTitle(`📊 Weekly Report: ${report.week}`)
        .setColor(0x5865F2)
        .addFields(
            { name: 'Raids This Week', value: String(report.totalRaids), inline: true },
            { name: 'Active Users', value: String(report.activeUsers), inline: true },
            { name: 'Total Raids (All Time)', value: String(report.totalRaidsAllTime), inline: true },
            { name: 'Top Participants', value: topList, inline: false }
        )
        .setFooter({ text: weeksBack === 0 ? 'Current week' : `${weeksBack} week(s) ago` });

    return interaction.editReply({ embeds: [embed] });
}

// ============= MONTHLY REPORT =============
async function handleMonthlyReport(interaction) {
    const monthsBack = interaction.options.getInteger('months_back') || 0;
    const report = generateMonthlyReport(interaction.guildId, monthsBack);

    const trendEmoji = report.trendPercent
        ? (parseFloat(report.trendPercent) >= 0 ? '📈' : '📉')
        : '➖';
    const trendText = report.trendPercent
        ? `${trendEmoji} ${report.trendPercent}% vs last month`
        : 'No previous data';

    const embed = new EmbedBuilder()
        .setTitle(`📊 Monthly Report: ${report.month}`)
        .setColor(0x57F287)
        .addFields(
            { name: 'Raids This Month', value: String(report.totalRaids), inline: true },
            { name: 'Active Users', value: String(report.activeUsers), inline: true },
            { name: 'Total Raids (All Time)', value: String(report.totalRaidsAllTime), inline: true },
            { name: 'Trend', value: trendText, inline: false }
        )
        .setFooter({ text: monthsBack === 0 ? 'Current month' : `${monthsBack} month(s) ago` });

    return interaction.editReply({ embeds: [embed] });
}

// ============= INACTIVE MEMBERS =============
async function handleInactive(interaction) {
    const filterRole = interaction.options.getRole('role');
    const guildId = interaction.guildId;
    const guildMap = guildParticipation.get(guildId) || new Map();

    let members = null;
    let partialNote = '';

    // Try cached role members first
    if (filterRole && filterRole.members?.size > 0) {
        members = filterRole.members;
        partialNote = '\n\n_(Used cached role members; list may be incomplete.)_';
    }

    if (!members) {
        try {
            members = await interaction.guild.members.fetch({ withPresences: false, time: 15_000 });
        } catch (error) {
            console.warn('Failed to fetch members for inactive list:', error?.code || error);
            if (filterRole && filterRole.members?.size > 0) {
                members = filterRole.members;
                partialNote = '\n\n_(Member fetch timed out; using cached role members.)_';
            } else {
                members = interaction.guild.members.cache;
                if (members && members.size > 0) {
                    partialNote = '\n\n_(Member fetch timed out; using cached members.)_';
                } else {
                    return interaction.editReply({
                        content: 'Unable to load member list. Please try again.'
                    });
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

// ============= EXPORT =============
async function handleExport(interaction) {
    const csvData = exportToCSV(interaction.guildId);

    if (csvData.split('\n').length <= 1) {
        return interaction.editReply({
            content: 'No data to export yet. Analytics will populate as raids are completed.'
        });
    }

    const buffer = Buffer.from(csvData, 'utf-8');
    const attachment = new AttachmentBuilder(buffer, {
        name: `stats_${interaction.guildId}_${Date.now()}.csv`
    });

    return interaction.editReply({
        content: '📊 Here\'s your participation data export:',
        files: [attachment]
    });
}

// ============= HELPERS =============
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

function aggregateTotals(entries, limit) {
    return entries
        .map(([userId, stats]) => ({ userId, totalRaids: stats.totalRaids || 0 }))
        .filter((x) => x.totalRaids > 0)
        .sort((a, b) => b.totalRaids - a.totalRaids)
        .slice(0, limit);
}
