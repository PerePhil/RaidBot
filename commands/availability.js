const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { setAvailability, getAvailability } = require('../availabilityManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('availability')
        .setDescription('Record your usual raid availability (days/times/timezone)')
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('View availability for a user (defaults to you)')
                .setRequired(false)),
    async execute(interaction) {
        const target = interaction.options.getUser('user');
        if (target && target.id !== interaction.user.id) {
            const existing = getAvailability(interaction.guildId, target.id);
            if (!existing) {
                return interaction.reply({ content: `${target.username} has not recorded availability.`, flags: MessageFlags.Ephemeral });
            }
            const embed = new EmbedBuilder()
                .setTitle(`${target.username}'s Availability`)
                .addFields(
                    { name: 'Timezones', value: existing.timezone || '—', inline: true },
                    { name: 'Preferred days', value: existing.days || '—', inline: true },
                    { name: 'Preferred roles', value: existing.roles || '—', inline: true },
                    { name: 'Notes', value: existing.notes || '—', inline: false }
                );
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const modal = new ModalBuilder()
            .setCustomId('availability:set')
            .setTitle('Set your availability')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('timezone')
                        .setLabel('Timezone')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('e.g., EST / UTC-5')
                        .setRequired(false)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('days')
                        .setLabel('Preferred days/times')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('e.g., Weeknights 6-10pm, Sat 12-4pm')
                        .setRequired(false)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('roles')
                        .setLabel('Preferred roles (pick from bot roles)')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('e.g., Vanguard, Support, Surge, Gates')
                        .setRequired(false)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('notes')
                        .setLabel('Notes')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('Anything else to know?')
                        .setRequired(false)
                )
            );

        await interaction.showModal(modal);
        const submission = await interaction.awaitModalSubmit({
            time: 120 * 1000,
            filter: (i) => i.customId === 'availability:set' && i.user.id === interaction.user.id
        }).catch(() => null);

        if (!submission) return;

        const data = {
            timezone: submission.fields.getTextInputValue('timezone').trim(),
            days: submission.fields.getTextInputValue('days').trim(),
            roles: submission.fields.getTextInputValue('roles').trim(),
            notes: submission.fields.getTextInputValue('notes').trim()
        };
        setAvailability(interaction.guildId, interaction.user.id, data);
        return submission.reply({ content: 'Availability saved.', flags: MessageFlags.Ephemeral });
    }
};
