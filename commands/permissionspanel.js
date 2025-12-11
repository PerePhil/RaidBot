const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, RoleSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getAdminRoles, setAdminRoles, getCommandRoles, setCommandRoles, getSignupRoles, setSignupRoles } = require('../state');

const ADMIN_COMMANDS = ['create', 'raid', 'raidsignup', 'setchannel', 'settings', 'templates', 'permissions', 'recurring'];
const SPECIAL_ENTRIES = [
    { label: 'Raid signup', value: 'signup_raid' },
    { label: 'Museum signup', value: 'signup_museum' },
    { label: 'View others\' stats', value: 'stats_others' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('permissions')
        .setDescription('Interactive permissions setup for admin and signup commands'),
    requiresManageGuild: true,
    async execute(interaction) {
        const guildId = interaction.guildId;
        const state = {
            selectedCommand: ADMIN_COMMANDS[0]
        };
        await interaction.reply({ embeds: [buildEmbed(interaction)], components: buildComponents(state, interaction), flags: MessageFlags.Ephemeral });
        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id, time: 5 * 60 * 1000 });

        collector.on('collect', async (i) => {
            if (i.customId === 'perm:selectCommand') {
                state.selectedCommand = i.values[0];
                return i.update({ embeds: [buildEmbed(interaction, state.selectedCommand)], components: buildComponents(state, interaction) });
            }
            if (i.customId === 'perm:saveRoles') {
                const roles = i.roles;
                const roleIds = roles.map((r) => r.id);
                if (state.selectedCommand === 'global') {
                    setAdminRoles(guildId, roleIds);
                } else if (state.selectedCommand === 'signup_raid') {
                    setSignupRoles(guildId, roleIds);
                } else if (state.selectedCommand === 'signup_museum') {
                    setSignupRoles(`${guildId}:museum`, roleIds);
                } else if (state.selectedCommand === 'stats_others') {
                    setCommandRoles(guildId, 'stats_others', roleIds);
                } else {
                    setCommandRoles(guildId, state.selectedCommand, roleIds);
                }
                return i.update({ embeds: [buildEmbed(interaction, state.selectedCommand)], components: buildComponents(state, interaction) });
            }
            if (i.customId === 'perm:clear') {
                if (state.selectedCommand === 'global') {
                    setAdminRoles(guildId, []);
                } else if (state.selectedCommand === 'signup_raid') {
                    setSignupRoles(guildId, []);
                } else if (state.selectedCommand === 'signup_museum') {
                    setSignupRoles(`${guildId}:museum`, []);
                } else if (state.selectedCommand === 'stats_others') {
                    setCommandRoles(guildId, 'stats_others', []);
                } else {
                    setCommandRoles(guildId, state.selectedCommand, []);
                }
                return i.update({ embeds: [buildEmbed(interaction, state.selectedCommand)], components: buildComponents(state, interaction) });
            }
            return i.reply({ content: 'Unsupported action.', flags: MessageFlags.Ephemeral });
        });

        collector.on('end', async () => {
            const disabled = buildComponents(state, interaction).map((row) => {
                const newRow = new ActionRowBuilder();
                newRow.addComponents(...row.components.map((c) => {
                    const json = c.toJSON();
                    json.disabled = true;
                    if (json.type === 3 && json.custom_id === 'perm:selectCommand') return StringSelectMenuBuilder.from(json);
                    if (json.type === 3) return RoleSelectMenuBuilder.from(json);
                    return ButtonBuilder.from(json);
                }));
                return newRow;
            });
            await interaction.editReply({ components: disabled }).catch(() => { });
        });
    }
};

function buildEmbed(interaction, selected = ADMIN_COMMANDS[0]) {
    const adminRoles = getAdminRoles(interaction.guildId);
    let cmdRoles;
    if (selected === 'signup_raid') {
        cmdRoles = getSignupRoles(interaction.guildId);
    } else if (selected === 'signup_museum') {
        cmdRoles = getSignupRoles(`${interaction.guildId}:museum`);
    } else if (selected === 'stats_others') {
        cmdRoles = getCommandRoles(interaction.guildId, 'stats_others');
    } else {
        cmdRoles = getCommandRoles(interaction.guildId, selected);
    }
    const lines = [];
    lines.push(`Global admin roles: ${formatRoles(adminRoles) || 'none (uses Manage Server)'}`);
    if (selected !== 'global') {
        if (selected === 'signup_raid') {
            lines.push(`Roles allowed to sign up for raids: ${formatRoles(cmdRoles) || 'none (anyone can sign up)'}`);
        } else if (selected === 'signup_museum') {
            lines.push(`Roles allowed to sign up for museums: ${formatRoles(cmdRoles) || 'none (anyone can sign up)'}`);
        } else if (selected === 'stats_others') {
            lines.push(`Roles allowed to view others' stats: ${formatRoles(cmdRoles) || 'none (admin/Manage Server only)'}`);
        } else {
            lines.push(`Roles for /${selected}: ${formatRoles(cmdRoles) || 'none (uses global/Manage Server)'}`);
        }
    }
    return new EmbedBuilder()
        .setTitle('Permissions Setup')
        .setDescription('Select a command, assign roles that can run it (in addition to Manage Server/owner).')
        .addFields({ name: 'Current', value: lines.join('\n') });
}

function buildComponents(state, interaction) {
    const commandSelect = new StringSelectMenuBuilder()
        .setCustomId('perm:selectCommand')
        .setPlaceholder('Select command')
        .addOptions(
            [{ label: 'Global admin roles', value: 'global', default: state.selectedCommand === 'global' }]
                .concat(SPECIAL_ENTRIES.map((entry) => ({ ...entry, default: state.selectedCommand === entry.value })))
                .concat(ADMIN_COMMANDS.map((cmd) => ({ label: `/${cmd}`, value: cmd, default: state.selectedCommand === cmd })))
        );
    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('perm:saveRoles')
        .setPlaceholder('Select roles for this command')
        .setMinValues(0)
        .setMaxValues(25);
    const clearBtn = new ButtonBuilder().setCustomId('perm:clear').setLabel('Clear roles').setStyle(ButtonStyle.Danger);
    return [new ActionRowBuilder().addComponents(commandSelect), new ActionRowBuilder().addComponents(roleSelect), new ActionRowBuilder().addComponents(clearBtn)];
}

function formatRoles(set) {
    const ids = Array.from(set || []);
    if (ids.length === 0) return '';
    return ids.map((id) => `<@&${id}>`).join(', ');
}
