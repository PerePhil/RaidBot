const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('changelog')
        .setDescription('Show recent changes (Release 7)'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Release 7 Changelog')
            .setDescription('Recurring raids, unified stats, and quality-of-life improvements.')
            .addFields(
                {
                    name: '🔄 Recurring Raids',
                    value: [
                        '• `/recurring action:create` — schedule automatic raid spawning (weekly, daily, or custom interval)',
                        '• Custom spawn times — set when signups appear separately from raid start time',
                        '• `/recurring action:trigger` — manually spawn a scheduled raid immediately',
                        '• Copy participants option — pre-register users from previous instance'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '📊 Unified Stats Command',
                    value: [
                        '• Consolidated `/raidstats` and `/analytics` into single `/stats` command',
                        '• `/stats user` — individual stats with attendance %, favorite roles, preferred days',
                        '• `/stats server` — top participants and guild totals',
                        '• `/stats weekly` / `/stats monthly` — time-based trends',
                        '• `/stats inactive` — find members not participating',
                        '• `/stats export` — download CSV of all data'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🏛️ Museum Improvements',
                    value: [
                        '• Museum signups auto-lock at raid start time',
                        '• Museum participants now tracked in analytics',
                        '• Attendance recorded for guild content monitoring'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🐛 Bug Fixes',
                    value: [
                        '• Fixed recurring raid start times when using custom spawn schedules',
                        '• Improved recurring raid re-initialization after bot restart'
                    ].join('\n'),
                    inline: false
                }
            );

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
