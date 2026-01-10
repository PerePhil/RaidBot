const { SlashCommandBuilder } = require('discord.js');
const { sendTestAlert } = require('../utils/alerts');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testalert')
        .setDescription('Send a test alert to the bot owner to verify the alert system is working'),
    requiresManageGuild: true,
    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            await sendTestAlert(interaction.client);

            await interaction.editReply({
                content: '✅ Test alert sent to bot owner. Check your DMs to verify the alert system is working.'
            });
        } catch (error) {
            await interaction.editReply({
                content: '❌ Failed to send test alert. Make sure BOT_OWNER_ID is configured correctly.'
            });
        }
    }
};
