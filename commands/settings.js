const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    EmbedBuilder,
    MessageFlags
} = require('discord.js');
const { getGuildSettings, updateGuildSettings } = require('../state');

const REMINDER_CHOICES = [
    { label: 'Disabled', value: '0' },
    { label: '5 min', value: '5' },
    { label: '10 min', value: '10' },
    { label: '15 min', value: '15' },
    { label: '30 min', value: '30' },
    { label: '60 min', value: '60' }
];

const AUTO_CLOSE_CHOICES = [
    { label: 'Disabled', value: '0' },
    { label: '15 min', value: '15' },
    { label: '30 min', value: '30' },
    { label: '60 min', value: '60' },
    { label: '2 hours', value: '120' },
    { label: '8 hours', value: '480' },
    { label: '24 hours', value: '1440' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Interactive panel for reminders and auto-close timing'),
    requiresManageGuild: true,
    async execute(interaction) {
        if (!interaction.guildId) {
            return interaction.reply({ content: 'This must be used in a server.', flags: MessageFlags.Ephemeral });
        }

        const settings = getGuildSettings(interaction.guildId);
        const embed = buildSettingsEmbed(interaction.guild, settings);
        const components = buildComponents(settings);

        await interaction.reply({
            embeds: [embed],
            components,
            flags: MessageFlags.Ephemeral
        });

        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({
            filter: (i) => i.user.id === interaction.user.id,
            time: 5 * 60 * 1000
        });

        collector.on('collect', async (i) => {
            if (!i.isButton() && !i.isStringSelectMenu() && !i.isRoleSelectMenu()) return;
            let updatedSettings = { ...settings };

            if (i.customId.startsWith('settings:toggle:')) {
                const key = i.customId.split(':')[2];
                if (key === 'autoCloseSeconds') {
                    const last = settings.lastAutoCloseSeconds > 0 ? settings.lastAutoCloseSeconds : 60 * 60;
                    if (settings.autoCloseSeconds > 0) {
                        updatedSettings.lastAutoCloseSeconds = settings.autoCloseSeconds;
                        updatedSettings.autoCloseSeconds = 0;
                    } else {
                        updatedSettings.autoCloseSeconds = last;
                    }
                } else {
                    updatedSettings[key] = !settings[key];
                }
            } else if (i.customId === 'settings:clear:raidLeaderRoleId') {
                updatedSettings.raidLeaderRoleId = null;
            } else if (i.customId === 'settings:set:raidLeaderRoleId') {
                updatedSettings.raidLeaderRoleId = i.values?.[0] || null;
            } else if (i.customId.startsWith('settings:set:')) {
                const [, , key] = i.customId.split(':');
                const minutes = parseInt(i.values[0], 10);
                updatedSettings[key] = Math.max(0, minutes) * 60;
                if (key === 'autoCloseSeconds') {
                    updatedSettings.lastAutoCloseSeconds = updatedSettings[key];
                }
            } else {
                return i.reply({ content: 'Unsupported action.', flags: MessageFlags.Ephemeral });
            }

            updateGuildSettings(interaction.guildId, updatedSettings);
            Object.assign(settings, updatedSettings);

            const refreshedEmbed = buildSettingsEmbed(interaction.guild, settings);
            const refreshedComponents = buildComponents(settings);
            await i.update({ embeds: [refreshedEmbed], components: refreshedComponents });
        });

        collector.on('end', async () => {
            const disabledComponents = message.components.map((row) => {
                const newRow = new ActionRowBuilder();
                newRow.addComponents(
                    ...row.components.map((comp) => {
                        const json = comp.toJSON();
                        json.disabled = true;
                        switch (json.type) {
                        case 2: // button
                            return ButtonBuilder.from(json);
                        case 3: // string select
                            return StringSelectMenuBuilder.from(json);
                        case 6: // role select
                            return RoleSelectMenuBuilder.from(json);
                        case 8: // channel select
                            return ChannelSelectMenuBuilder.from(json);
                        default:
                            return ButtonBuilder.from(json);
                        }
                    })
                );
                return newRow;
            });
            await message.edit({ components: disabledComponents }).catch(() => {});
        });
    }
};

function buildSettingsEmbed(guild, settings) {
    const leaderRoleLabel = formatLeaderRole(guild, settings.raidLeaderRoleId);
    return new EmbedBuilder()
        .setTitle(`${guild.name} • Settings`)
        .setDescription('Configure reminders, auto-close timing, and an optional raid leader marker. Use the buttons and dropdowns below.')
        .addFields(
            {
                name: 'Creator reminders',
                value: settings.creatorRemindersEnabled ? `${settings.creatorReminderSeconds / 60} min before start` : 'Disabled',
                inline: false
            },
            {
                name: 'Participant reminders',
                value: settings.participantRemindersEnabled ? `${settings.participantReminderSeconds / 60} min before start` : 'Disabled',
                inline: false
            },
            {
                name: 'Auto-close full raids',
                value: settings.autoCloseSeconds > 0 ? `${settings.autoCloseSeconds / 60} min before start` : 'Disabled',
                inline: false
            },
            {
                name: 'Raid leader role',
                value: leaderRoleLabel,
                inline: false
            }
        );
}

function buildComponents(settings) {
    const toggleRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('settings:toggle:creatorRemindersEnabled')
            .setLabel(`Creator reminders: ${settings.creatorRemindersEnabled ? 'On' : 'Off'}`)
            .setStyle(settings.creatorRemindersEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('settings:toggle:participantRemindersEnabled')
            .setLabel(`Participant reminders: ${settings.participantRemindersEnabled ? 'On' : 'Off'}`)
            .setStyle(settings.participantRemindersEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('settings:toggle:autoCloseSeconds')
            .setLabel(`Auto-close: ${settings.autoCloseSeconds > 0 ? 'On' : 'Off'}`)
            .setStyle(settings.autoCloseSeconds > 0 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('settings:clear:raidLeaderRoleId')
            .setLabel('Clear raid leader role')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!settings.raidLeaderRoleId)
    );

    const creatorSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('settings:set:creatorReminderSeconds')
            .setPlaceholder('Creator reminder timing')
            .addOptions(REMINDER_CHOICES.map((choice) => ({
                ...choice,
                default: settings.creatorReminderSeconds / 60 === parseInt(choice.value, 10)
            })))
    );

    const participantSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('settings:set:participantReminderSeconds')
            .setPlaceholder('Participant reminder timing')
            .addOptions(REMINDER_CHOICES.map((choice) => ({
                ...choice,
                default: settings.participantReminderSeconds / 60 === parseInt(choice.value, 10)
            })))
    );

    const autoCloseSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('settings:set:autoCloseSeconds')
            .setPlaceholder('Auto-close timing')
            .addOptions(AUTO_CLOSE_CHOICES.map((choice) => ({
                ...choice,
                default: settings.autoCloseSeconds / 60 === parseInt(choice.value, 10)
            })))
    );

    const leaderMenu = new RoleSelectMenuBuilder()
        .setCustomId('settings:set:raidLeaderRoleId')
        .setPlaceholder(settings.raidLeaderRoleId ? 'Change raid leader role' : 'Pick raid leader role')
        .setMinValues(1)
        .setMaxValues(1);

    if (settings.raidLeaderRoleId) {
        leaderMenu.setDefaultRoles([settings.raidLeaderRoleId]);
    }

    const leaderSelect = new ActionRowBuilder().addComponents(leaderMenu);

    return [toggleRow, creatorSelect, participantSelect, autoCloseSelect, leaderSelect];
}

function formatLeaderRole(guild, roleId) {
    if (!roleId) return 'None — no ⭐ marker on signups';
    const role = guild?.roles?.cache?.get(roleId);
    return role ? `${role.name} (⭐ on signups)` : `Role ID ${roleId} (⭐ on signups)`;
}
