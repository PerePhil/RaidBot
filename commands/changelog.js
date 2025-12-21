const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('changelog')
        .setDescription('Show recent changes (Release 11)'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Release 11 Changelog')
            .setDescription('Enhanced inactive member detection and activity tracking.')
            .addFields(
                {
                    name: 'Inactive Member Filtering',
                    value: [
                        '• `/stats inactive weeks:4` — find members inactive for 4+ weeks',
                        '• Shows last active date for each member',
                        '• `refresh:True` option forces fresh member list from Discord',
                        '• Results sorted with longest inactive first'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Waitlist Activity Tracking',
                    value: [
                        '• Joining a waitlist now counts as "activity"',
                        '• Waitlisted members won\'t show as inactive',
                        '• Raid completion count remains accurate (only actual signups)'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Previous (Release 10)',
                    value: 'Availability list command, parse failure notifications, admin audit logging',
                    inline: false
                }
            );

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
