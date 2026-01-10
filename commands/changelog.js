const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('changelog')
        .setDescription('Show recent changes (Release 12)'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Release 12 Changelog')
            .setDescription('Performance monitoring and alerting system for bot owners.')
            .addFields(
                {
                    name: '📊 Performance Monitoring',
                    value: [
                        '• Real-time metrics tracking (command latency, reaction times)',
                        '• Circuit breaker protection for Discord API and DM delivery',
                        '• `/ping` now shows bot health, latency, uptime, and active raid count'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🔔 DM-Based Alerts',
                    value: [
                        '• Bot owner receives DM alerts for performance issues',
                        '• Alerts for: high latency, DM failures, memory issues, circuit breaker trips',
                        '• Daily health report sent at 9 AM with bot stats',
                        '• Set `BOT_OWNER_ID` in config to enable alerts'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🧪 /testalert Command',
                    value: [
                        '• Send a test alert to verify the DM alert system is working',
                        '• Admin-only command for troubleshooting'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Previous (Release 11)',
                    value: 'Inactive member filtering with weeks parameter, waitlist activity tracking',
                    inline: false
                }
            );

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
