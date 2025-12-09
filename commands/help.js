const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show what this bot can do and how to use each command'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('IOP Raids Command Reference')
            .setDescription('Tools for scheduling Wizard101 raids and events. Most commands require the Manage Server permission so only trusted staff can change signups.')
            .addFields(
                {
                    name: 'Create Signups',
                    value: '`/create` — interactive flow for raids/museum (prompts length & strategy only when needed)\n_Time accepts natural language like "tomorrow 7pm", "next Friday 6:30", or a Unix timestamp._',
                    inline: false
                },
                {
                    name: 'Manage Schedules',
                    value: '`/raid <raid_id>` — interactive raid management panel (close/reopen/delete/change time; auto-close uses server settings)',
                    inline: false
                },
                {
                    name: 'Manage Signups',
                    value: '`/raidsignup action:<remove|assign|side> <raid_id> <user> [position|role|side]`\n- `remove` needs a position\n- `assign` takes position or role name/emoji\n- `side` is Lemuria only\n`/permissions` — set admin/command roles and who can sign up',
                    inline: false
                },
                {
                    name: 'Status & Info',
                    value: '`/raidinfo action:<list|detail|export> [raid_id] [days]` — list raids, view one signup, or download an .ics of upcoming raids\n`/changelog` — highlights of recent updates',
                    inline: false
                },
                {
                    name: 'Channel Setup',
                    value: '`/setchannel` — interactive channel picker for raid/museum posts',
                    inline: false
                },
                {
                    name: 'Server Settings',
                    value: '`/settings` — interactive panel for reminders and auto-close timing\n`/templates` — enable/disable or rename raid templates per server\n`/setchannel` — also configures audit log channel\n`/permissions` — manage which roles can use admin commands',
                    inline: false
                },
                {
                    name: 'Stats',
                    value: '`/raidstats [user] [scope:<user|server|inactive>]` — view user stats, top server, or inactive members\n`/availability [user]` — record or view availability (days/times/timezone)',
                    inline: false
                }
            )
            .setFooter({ text: 'Tip: every signup shows its Raid ID at the bottom of the embed.' });

        return interaction.reply({ embeds: [embed] });
    }
};
