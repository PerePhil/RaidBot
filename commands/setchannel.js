const { SlashCommandBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelSelectMenuBuilder, ComponentType, MessageFlags } = require('discord.js');
const {
    raidChannels,
    museumChannels,
    saveRaidChannels,
    saveMuseumChannels
} = require('../state');
const { setAuditChannel, getAuditChannel } = require('../auditLog');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Configure posting channels for raid or museum signups (interactive)')
        .addChannelOption((option) =>
            option.setName('raid_channel')
                .setDescription('Optional: set raid channel directly')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addChannelOption((option) =>
            option.setName('museum_channel')
                .setDescription('Optional: set museum channel directly')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addChannelOption((option) =>
            option.setName('audit_channel')
                .setDescription('Optional: set audit log channel directly')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)),
    requiresManageGuild: true,
    async execute(interaction) {
        const directRaid = interaction.options.getChannel('raid_channel');
        const directMuseum = interaction.options.getChannel('museum_channel');
        const directAudit = interaction.options.getChannel('audit_channel');

        if (directRaid) {
            raidChannels.set(interaction.guildId, directRaid.id);
            saveRaidChannels();
        }
        if (directMuseum) {
            museumChannels.set(interaction.guildId, directMuseum.id);
            saveMuseumChannels();
        }
        if (directAudit) {
            setAuditChannel(interaction.guildId, directAudit.id);
        }

        if (directRaid || directMuseum) {
            return interaction.reply({
                content: `Channels updated.\nRaid: ${formatChannel(raidChannels.get(interaction.guildId), interaction.guild)}\nMuseum: ${formatChannel(museumChannels.get(interaction.guildId), interaction.guild)}\nAudit: ${formatChannel(getAuditChannel(interaction.guildId), interaction.guild)}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const embed = buildEmbed(interaction.guildId, interaction.guild);
        const rows = buildComponents();

        await interaction.reply({
            embeds: [embed],
            components: rows,
            flags: MessageFlags.Ephemeral
        });

        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({
            filter: (i) => i.user.id === interaction.user.id,
            time: 5 * 60 * 1000
        });

        collector.on('collect', async (i) => {
            if (i.customId === 'setchannel:set:raid') {
                const channel = i.channels.first();
                if (!channel) return i.reply({ content: 'Select a channel.', flags: MessageFlags.Ephemeral });
                raidChannels.set(interaction.guildId, channel.id);
                saveRaidChannels();
                const refreshed = buildEmbed(interaction.guildId, interaction.guild);
                return i.update({ embeds: [refreshed] });
            }
            if (i.customId === 'setchannel:set:museum') {
                const channel = i.channels.first();
                if (!channel) return i.reply({ content: 'Select a channel.', flags: MessageFlags.Ephemeral });
                museumChannels.set(interaction.guildId, channel.id);
                saveMuseumChannels();
                const refreshed = buildEmbed(interaction.guildId, interaction.guild);
                return i.update({ embeds: [refreshed] });
            }
            if (i.customId === 'setchannel:set:audit') {
                const channel = i.channels.first();
                if (!channel) return i.reply({ content: 'Select a channel.', flags: MessageFlags.Ephemeral });
                setAuditChannel(interaction.guildId, channel.id);
                const refreshed = buildEmbed(interaction.guildId, interaction.guild);
                return i.update({ embeds: [refreshed] });
            }
            return i.reply({ content: 'Unsupported action.', flags: MessageFlags.Ephemeral });
        });

        collector.on('end', async () => {
            const disabledComponents = message.components.map((row) => {
                const newRow = new ActionRowBuilder();
                newRow.addComponents(
                    ...row.components.map((comp) => {
                        const json = comp.toJSON();
                        json.disabled = true;
                        if (json.type === ComponentType.ChannelSelect) {
                            return ChannelSelectMenuBuilder.from(json);
                        }
                        return ButtonBuilder.from(json);
                    })
                );
                return newRow;
            });
            await message.edit({ components: disabledComponents }).catch(() => {});
        });
    }
};

function buildEmbed(guildId, guild) {
    const raidId = raidChannels.get(guildId);
    const museumId = museumChannels.get(guildId);
    const auditId = getAuditChannel(guildId);
    return new EmbedBuilder()
        .setTitle('Channel Setup')
        .setDescription('Select channels for raid and museum signups.')
        .addFields(
            { name: 'Raid channel', value: formatChannel(raidId, guild), inline: false },
            { name: 'Museum channel', value: formatChannel(museumId, guild), inline: false },
            { name: 'Audit log channel', value: formatChannel(auditId, guild), inline: false }
        );
}

function buildComponents() {
    const raidRow = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('setchannel:set:raid')
            .setPlaceholder('Select raid channel')
            .addChannelTypes(ChannelType.GuildText)
    );
    const museumRow = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('setchannel:set:museum')
            .setPlaceholder('Select museum channel')
            .addChannelTypes(ChannelType.GuildText)
    );
    const auditRow = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('setchannel:set:audit')
            .setPlaceholder('Select audit log channel')
            .addChannelTypes(ChannelType.GuildText)
    );
    return [raidRow, museumRow, auditRow];
}

function formatChannel(channelId, guild) {
    if (!channelId) {
        return '*Not set*';
    }
    const channel = guild?.channels?.cache?.get(channelId);
    return channel ? `${channel}` : `<#${channelId}>`;
}
