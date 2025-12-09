const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const {
    generateWeeklyReport,
    generateMonthlyReport,
    exportToCSV,
    getAttendanceRate
} = require('../utils/analytics');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('analytics')
        .setDescription('View raid participation analytics')
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
            sub.setName('attendance')
                .setDescription('View attendance rate for a user')
                .addUserOption((opt) =>
                    opt.setName('user')
                        .setDescription('User to check (default: yourself)')
                        .setRequired(false)))
        .addSubcommand((sub) =>
            sub.setName('export')
                .setDescription('Export participation data as CSV')),

    requiresManageGuild: true,

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!interaction.guildId) {
            return interaction.editReply({
                content: 'Analytics are only available in servers.',
                flags: MessageFlags.Ephemeral
            });
        }

        switch (subcommand) {
            case 'weekly':
                return handleWeeklyReport(interaction);
            case 'monthly':
                return handleMonthlyReport(interaction);
            case 'attendance':
                return handleAttendance(interaction);
            case 'export':
                return handleExport(interaction);
            default:
                return interaction.editReply({ content: 'Unknown subcommand.' });
        }
    }
};

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

async function handleAttendance(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const rate = getAttendanceRate(interaction.guildId, target.id);
    const percentage = (rate * 100).toFixed(1);

    const emoji = rate >= 0.9 ? '🌟' : rate >= 0.7 ? '✅' : rate >= 0.5 ? '⚠️' : '❌';

    const embed = new EmbedBuilder()
        .setTitle(`${emoji} Attendance: ${target.username}`)
        .setDescription(`**${percentage}%** attendance rate`)
        .setColor(rate >= 0.7 ? 0x57F287 : rate >= 0.5 ? 0xFEE75C : 0xED4245)
        .setFooter({ text: 'Based on Option B: All signups counted as attended' });

    return interaction.editReply({ embeds: [embed] });
}

async function handleExport(interaction) {
    const csvData = exportToCSV(interaction.guildId);

    if (csvData.split('\n').length <= 1) {
        return interaction.editReply({
            content: 'No data to export yet. Analytics will populate as raids are completed.'
        });
    }

    const buffer = Buffer.from(csvData, 'utf-8');
    const attachment = new AttachmentBuilder(buffer, {
        name: `analytics_${interaction.guildId}_${Date.now()}.csv`
    });

    return interaction.editReply({
        content: '📊 Here\'s your participation data export:',
        files: [attachment]
    });
}
