const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('changelog')
        .setDescription('Show recent changes (Release 8)'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Release 8 Changelog')
            .setDescription('Time slot polling, availability aggregation, and optimal time finding.')
            .addFields(
                {
                    name: '📊 Time Slot Polling',
                    value: [
                        '• `/poll create` — create a reaction-based poll with multiple time options',
                        '• Supports 50+ voters with live vote counting',
                        '• `/poll results` — view current voting breakdown with progress bars',
                        '• `/poll close` — finalize poll and highlight optimal times',
                        '• Automatically tracks reactions for seamless voting'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '📅 Availability Enhancements',
                    value: [
                        '• `/availability set` — improved modal with better placeholders',
                        '• `/availability summary` — server-wide heatmap showing when users are free',
                        '• `/availability optimal` — find time slots with the most available users',
                        '• Aggregates data from all members to suggest best raid times'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🔥 Heatmap Visualization',
                    value: [
                        '• Text-based heatmap shows hottest time slots at a glance',
                        '• Ranked list of optimal times with user counts',
                        '• Filter by minimum users required'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🔄 Previous (Release 7)',
                    value: 'Recurring raids, unified `/stats` command, museum improvements',
                    inline: false
                }
            );

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
