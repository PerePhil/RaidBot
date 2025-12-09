const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('changelog')
        .setDescription('Show recent changes (Release 6)'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Release 6 Changelog')
            .setDescription('Highlights of new features, panels, and fixes.')
            .addFields(
                {
                    name: 'Command updates',
                    value: [
                        '• Condensed admin commands: `/raid` (manage), `/raidsignup` (assign/remove/side), `/raidinfo` (list/detail/export), `/setchannel` (interactive).',
                        '• Added `/create` interactive flow for raid/museum creation; `/settings` panel for reminders/auto-close; `/raidstats` for participation stats.',
                        '• Added `/changelog` (this) and `/raidinfo export` for calendar .ics downloads.'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Interactive panels',
                    value: [
                        '• Raid management buttons (Close/Reopen/Delete/Change Time) with modal time edits.',
                        '• Channel picker and settings panels using buttons/selects; raid signup embeds show bold display names instead of pings.'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Scheduling & reminders',
                    value: [
                        '• Natural-language time parsing via chrono; per-guild reminder/auto-close settings with longer durations.',
                        '• Date + Time moved to its own field (no duplicates) and kept first in embeds; change-time now replaces the field.',
                        '• Bug fixes: reminder flags persist, reopen/close feedback, and time updates replace the Date + Time field.'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Extras',
                    value: [
                        '• `/raidinfo export` outputs an .ics calendar of upcoming raids.',
                        '• Participation stats recorded on close; `/raidstats` shows totals/favorites.'
                    ].join('\n'),
                    inline: false
                }
            );

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
