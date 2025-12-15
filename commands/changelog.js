const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('changelog')
        .setDescription('Show recent changes (Release 10)'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Release 10 Changelog')
            .setDescription('Availability management improvements and admin tools.')
            .addFields(
                {
                    name: 'Availability List',
                    value: [
                        '• `/availability list` — view all members who have set availability',
                        '• Shows timezone and days input at a glance',
                        '• Parse failures flagged with ⚠️ and sorted to the top'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Parse Failure Notifications',
                    value: [
                        '• Admins notified via audit log when time parsing fails',
                        '• Users see a warning if their input could not be parsed',
                        '• Easy to fix with `/availability set user:@user`'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Previous (Release 9)',
                    value: 'Timezone support, check/clear commands, post-button for onboarding',
                    inline: false
                }
            );

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
