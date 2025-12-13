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
                    name: 'Stats & Analytics',
                    value: '`/stats user [user]` — view individual stats (attendance %, favorite roles, days)\n`/stats server` — top participants and guild totals\n`/stats weekly` / `/stats monthly` — time-based reports with trends\n`/stats inactive [role]` — members with no participation\n`/stats export` — download CSV of all data',
                    inline: false
                },
                {
                    name: 'Availability & Polling',
                    value: '`/availability set [user]` — set availability (Admin can set for others)\n`/availability view [user]` — view someone\'s availability\n`/availability summary` — server heatmap of when users are free\n`/availability optimal [min_users]` — find times with X+ available\n`/availability check <time>` — see who is available at a specific time\n`/availability clear [user]` — remove availability data\n`/availability post-button` — post onboarding button (Admin)\n`/poll create` — create a time slot poll\n`/poll results` / `/poll close` — view or finalize poll',
                    inline: false
                },
                {
                    name: 'Recurring Raids',
                    value: '`/recurring action:create` — set up automatic raid spawning (weekly, daily, interval)\n`/recurring action:list` — view all scheduled recurring raids\n`/recurring action:toggle id:<id>` — enable/disable a recurring schedule\n`/recurring action:trigger id:<id>` — manually spawn a raid now',
                    inline: false
                }
            )
            .setFooter({ text: 'Tip: every signup shows its Raid ID at the bottom of the embed.' });

        return interaction.reply({ embeds: [embed] });
    }
};
