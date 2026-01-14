const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('changelog')
        .setDescription('Show recent changes (Release 13)'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Release 13 Changelog')
            .setDescription('Raid history, no-show tracking, smart substitute finder, and leaderboards!')
            .addFields(
                {
                    name: '📜 Raid History',
                    value: [
                        '• `/raidinfo action:history [user] [limit]` — View past raids you participated in',
                        '• Shows raid type, role played, and date',
                        '• Admins can view history for other users'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '❌ No-Show Tracking',
                    value: [
                        '• Mark no-shows via the `/raid` panel after a raid closes',
                        '• No-show count shown in `/stats user`',
                        '• "Reliable" achievement for perfect attendance'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🔍 Smart Substitute Finder',
                    value: [
                        '• "Find Sub" button in `/raid` panel',
                        '• Finds users with experience in the needed role',
                        '• Prioritizes users who are available at raid time',
                        '• Shows top 5 candidates ranked by fit'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🏆 Leaderboards & Achievements',
                    value: [
                        '• `/leaderboard top` — Top raiders by total raids',
                        '• `/leaderboard role <name>` — Top players for a specific role',
                        '• `/leaderboard achievements` — View unlocked achievements',
                        '• 11 achievements to unlock (Rookie Raider → Raid Master)'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Previous (Release 12)',
                    value: 'Performance monitoring, DM-based alerts, /testalert command',
                    inline: false
                }
            );

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
