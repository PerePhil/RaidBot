const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('changelog')
        .setDescription('Show recent changes (Release 9)'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Release 9 Changelog')
            .setDescription('Enhanced availability system with timezone support and new features.')
            .addFields(
                {
                    name: 'Timezone Support',
                    value: [
                        '• Times now display in your local timezone (not UTC)',
                        '• Set your timezone in `/availability set` (EST, PST, UTC-5, etc.)',
                        '• Viewer-centric display — times convert to your timezone automatically'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'New Availability Commands',
                    value: [
                        '• `/availability check <time>` — see who\'s available at a specific time',
                        '• `/availability post-button` — post a persistent button for new members',
                        '• `/availability clear` — remove your availability data',
                        '• Admins can now set/clear availability for other users'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Quality of Life',
                    value: [
                        '• Confirmation now shows parsed time windows',
                        '• Onboarding embed explains acceptable formats',
                        '• Availability data included in `/stats export` CSV',
                        '• Cleaner embeds (emojis removed)'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Previous (Release 8)',
                    value: 'Time slot polling, availability heatmaps, optimal time finding',
                    inline: false
                }
            );

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
