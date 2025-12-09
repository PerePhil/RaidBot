const { SlashCommandBuilder } = require('discord.js');
const { activeRaids } = require('../state');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot health and response time'),
    requiresManageGuild: false,
    async execute(interaction) {
        const sent = await interaction.reply({
            content: 'Pinging...',
            fetchReply: true
        });

        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
        const wsLatency = interaction.client.ws.ping;
        const activeRaidCount = activeRaids.size;
        const openRaidCount = [...activeRaids.values()].filter(r => !r.closed).length;
        const uptime = formatUptime(process.uptime());

        await interaction.editReply([
            '🏓 **Pong!**',
            `• Roundtrip: **${roundtrip}ms**`,
            `• WebSocket: **${wsLatency}ms**`,
            `• Uptime: **${uptime}**`,
            `• Active Raids: **${openRaidCount}** open, **${activeRaidCount - openRaidCount}** closed`
        ].join('\n'));
    }
};

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (parts.length === 0) parts.push(`${Math.floor(seconds)}s`);

    return parts.join(' ');
}
