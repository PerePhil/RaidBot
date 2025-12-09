const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags
} = require('discord.js');
const {
    getGuildTemplateOverrides,
    updateGuildTemplateOverrides,
    templatesForGuild,
    addCustomTemplate,
    updateCustomTemplate,
    deleteCustomTemplate
} = require('../templatesManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('templates')
        .setDescription('Manage raid templates (enable/disable, edit labels, clone)'),
    requiresManageGuild: true,
    async execute(interaction) {
        const overrides = getGuildTemplateOverrides(interaction.guildId);
        const current = templatesForGuild(interaction.guildId, { includeDisabled: true });
        await interaction.reply({
            embeds: [buildSummaryEmbed(current, overrides)],
            components: buildComponents(current, overrides),
            flags: MessageFlags.Ephemeral
        });

        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({
            filter: (i) => i.user.id === interaction.user.id,
            time: 5 * 60 * 1000
        });

        collector.on('collect', async (i) => {
            if (i.customId === 'templates:select') {
                const selected = i.values[0];
                const template = current.find((t) => t.id === selected);
                if (!template) {
                    return i.reply({ content: 'Template not found.', flags: MessageFlags.Ephemeral });
                }
                await i.update({
                    embeds: [buildDetailEmbed(template, overrides)],
                    components: buildDetailComponents(template, overrides)
                });
                return;
            }

            if (i.customId === 'templates:create') {
                const modal = new ModalBuilder()
                    .setCustomId('templates:create:modal')
                    .setTitle('Create new template')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('name')
                                .setLabel('Template name')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('emoji')
                                .setLabel('Emoji (optional)')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('color')
                                .setLabel('Hex color (optional, e.g. #ff9900)')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false)
                        )
                    );
                await i.showModal(modal);
                const submission = await i.awaitModalSubmit({
                    time: 60 * 1000,
                    filter: (m) => m.customId === 'templates:create:modal' && m.user.id === interaction.user.id
                }).catch(() => null);
                if (!submission) return;
                const name = submission.fields.getTextInputValue('name').trim();
                const emoji = submission.fields.getTextInputValue('emoji').trim();
                const color = submission.fields.getTextInputValue('color').trim();
                const newTemplate = addCustomTemplate(interaction.guildId, {
                    name,
                    emoji,
                    color: color && /^#?[0-9a-fA-F]{6}$/.test(color) ? (color.startsWith('#') ? color : `#${color}`) : ''
                });
                const refreshed = templatesForGuild(interaction.guildId, { includeDisabled: true });
                await submission.reply({ content: 'Template created. Edit roles to add positions.', flags: MessageFlags.Ephemeral });
                await interaction.editReply({
                    embeds: [buildDetailEmbed(newTemplate, getGuildTemplateOverrides(interaction.guildId))],
                    components: buildDetailComponents(newTemplate, getGuildTemplateOverrides(interaction.guildId))
                }).catch(() => {});
                current.push(newTemplate);
                return;
            }

            if (i.customId.startsWith('templates:toggle:')) {
                const id = i.customId.split(':')[2];
                const template = current.find((tpl) => tpl.id === id);
                const override = overrides[id] || {};
                const newDisabled = !(override.disabled === true);
                if (template?.isCustom) {
                    updateCustomTemplate(interaction.guildId, id, { disabled: newDisabled });
                } else {
                    override.disabled = newDisabled;
                    updateGuildTemplateOverrides(interaction.guildId, id, override);
                }
                const refreshed = templatesForGuild(interaction.guildId, { includeDisabled: true });
                await i.update({
                    embeds: [buildSummaryEmbed(refreshed, getGuildTemplateOverrides(interaction.guildId))],
                    components: buildComponents(refreshed, getGuildTemplateOverrides(interaction.guildId))
                });
                return;
            }

            if (i.customId.startsWith('templates:editlabel:')) {
                const id = i.customId.split(':')[2];
                const modal = new ModalBuilder()
                    .setCustomId(`templates:label:${id}`)
                    .setTitle('Rename template')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('name')
                                .setLabel('Display name')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                await i.showModal(modal);
                const submission = await i.awaitModalSubmit({
                    time: 60 * 1000,
                    filter: (m) => m.customId === `templates:label:${id}` && m.user.id === interaction.user.id
                }).catch(() => null);
                if (!submission) return;
                const name = submission.fields.getTextInputValue('name').trim();
                if (!name) {
                    return submission.reply({ content: 'Name cannot be empty.', flags: MessageFlags.Ephemeral });
                }
                const template = current.find((tpl) => tpl.id === id);
                if (template?.isCustom) {
                    updateCustomTemplate(interaction.guildId, id, { name });
                } else {
                    const override = getGuildTemplateOverrides(interaction.guildId)[id] || {};
                    override.name = name;
                    updateGuildTemplateOverrides(interaction.guildId, id, override);
                }
                await submission.reply({ content: 'Name updated.', flags: MessageFlags.Ephemeral });
                const refreshed = templatesForGuild(interaction.guildId, { includeDisabled: true });
                await interaction.editReply({
                    embeds: [buildSummaryEmbed(refreshed, getGuildTemplateOverrides(interaction.guildId))],
                    components: buildComponents(refreshed, getGuildTemplateOverrides(interaction.guildId))
                }).catch(() => {});
                return;
            }

            if (i.customId.startsWith('templates:reset:')) {
                const id = i.customId.split(':')[2];
                updateGuildTemplateOverrides(interaction.guildId, id, null, { reset: true });
                const refreshed = templatesForGuild(interaction.guildId, { includeDisabled: true });
                await i.update({
                    embeds: [buildSummaryEmbed(refreshed, getGuildTemplateOverrides(interaction.guildId))],
                    components: buildComponents(refreshed, getGuildTemplateOverrides(interaction.guildId))
                });
                return;
            }

            if (i.customId.startsWith('templates:editmeta:')) {
                const id = i.customId.split(':')[2];
                const template = current.find((tpl) => tpl.id === id);
                if (!template) {
                    return i.reply({ content: 'Template not found.', flags: MessageFlags.Ephemeral });
                }
                const modal = new ModalBuilder()
                    .setCustomId(`templates:meta:${id}`)
                    .setTitle('Edit template')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('name')
                                .setLabel('Display name')
                                .setStyle(TextInputStyle.Short)
                                .setValue(template.name || '')
                                .setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('emoji')
                                .setLabel('Emoji (optional)')
                                .setStyle(TextInputStyle.Short)
                                .setValue(template.emoji || '')
                                .setRequired(false)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('color')
                                .setLabel('Hex color (optional, e.g. #ff9900)')
                                .setStyle(TextInputStyle.Short)
                                .setValue(template.color || '')
                                .setRequired(false)
                        )
                    );
                await i.showModal(modal);
                const submission = await i.awaitModalSubmit({
                    time: 60 * 1000,
                    filter: (m) => m.customId === `templates:meta:${id}` && m.user.id === interaction.user.id
                }).catch(() => null);
                if (!submission) return;
                const name = submission.fields.getTextInputValue('name').trim();
                const emoji = submission.fields.getTextInputValue('emoji').trim();
                const color = submission.fields.getTextInputValue('color').trim();
                const updates = { name };
                if (emoji) updates.emoji = emoji;
                if (color && /^#?[0-9a-fA-F]{6}$/.test(color)) {
                    updates.color = color.startsWith('#') ? color : `#${color}`;
                }
                if (template.isCustom) {
                    updateCustomTemplate(interaction.guildId, id, updates);
                } else {
                    updateGuildTemplateOverrides(interaction.guildId, id, updates);
                }
                await submission.reply({ content: 'Template updated.', flags: MessageFlags.Ephemeral });
                const refreshed = templatesForGuild(interaction.guildId, { includeDisabled: true });
                await interaction.editReply({
                    embeds: [buildSummaryEmbed(refreshed, getGuildTemplateOverrides(interaction.guildId))],
                    components: buildComponents(refreshed, getGuildTemplateOverrides(interaction.guildId))
                }).catch(() => {});
                return;
            }

            if (i.customId.startsWith('templates:delete:')) {
                const id = i.customId.split(':')[2];
                deleteCustomTemplate(interaction.guildId, id);
                const refreshed = templatesForGuild(interaction.guildId, { includeDisabled: true });
                await i.update({
                    embeds: [buildSummaryEmbed(refreshed, getGuildTemplateOverrides(interaction.guildId))],
                    components: buildComponents(refreshed, getGuildTemplateOverrides(interaction.guildId))
                });
                return;
            }

            if (i.customId.startsWith('templates:duplicate:')) {
                const id = i.customId.split(':')[2];
                const base = current.find((tpl) => tpl.id === id);
                if (!base) return i.reply({ content: 'Template not found.', flags: MessageFlags.Ephemeral });
                const clone = addCustomTemplate(interaction.guildId, {
                    name: `${base.name} Copy`,
                    emoji: base.emoji,
                    description: base.description,
                    color: base.color,
                    roleGroups: base.roleGroups
                });
                const refreshed = templatesForGuild(interaction.guildId, { includeDisabled: true });
                await i.update({
                    embeds: [buildDetailEmbed(clone, getGuildTemplateOverrides(interaction.guildId))],
                    components: buildDetailComponents(clone, getGuildTemplateOverrides(interaction.guildId))
                });
                return;
            }

            if (i.customId.startsWith('templates:editroles:')) {
                const id = i.customId.split(':')[2];
                const template = current.find((tpl) => tpl.id === id);
                if (!template) return i.reply({ content: 'Template not found.', flags: MessageFlags.Ephemeral });
                if (!template.isCustom) {
                    return i.reply({ content: 'Duplicate this template first, then edit roles on the custom copy.', flags: MessageFlags.Ephemeral });
                }
                const modal = new ModalBuilder()
                    .setCustomId(`templates:roles:${id}`)
                    .setTitle('Edit roles & groups')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('roles')
                                .setLabel('Roles (Group|Emoji|Role|Slots|Icon)')
                                .setStyle(TextInputStyle.Paragraph)
                                .setPlaceholder('Vanguard|1️⃣|Storm 1|1|<:Storm:...>\nSupport|2️⃣|Jade|1')
                                .setRequired(true)
                                .setMaxLength(4000)
                        )
                    );
                await i.showModal(modal);
                const submission = await i.awaitModalSubmit({
                    time: 90 * 1000,
                    filter: (m) => m.customId === `templates:roles:${id}` && m.user.id === interaction.user.id
                }).catch(() => null);
                if (!submission) return;
                const input = submission.fields.getTextInputValue('roles') || '';
                const parsed = parseRoleInput(input);
                if (parsed.error) {
                    return submission.reply({ content: parsed.error, flags: MessageFlags.Ephemeral });
                }
                updateCustomTemplate(interaction.guildId, id, { roleGroups: parsed.roleGroups });
                await submission.reply({ content: 'Roles updated.', flags: MessageFlags.Ephemeral });
                const refreshed = templatesForGuild(interaction.guildId, { includeDisabled: true });
                await interaction.editReply({
                    embeds: [buildDetailEmbed(template, getGuildTemplateOverrides(interaction.guildId))],
                    components: buildDetailComponents(template, getGuildTemplateOverrides(interaction.guildId))
                }).catch(() => {});
                return;
            }

            await i.reply({ content: 'Unsupported action.', flags: MessageFlags.Ephemeral });
        });

        collector.on('end', async () => {
            const disabled = buildComponents(current, overrides).map((row) => {
                const newRow = new ActionRowBuilder();
                newRow.addComponents(...row.components.map((comp) => {
                    const json = comp.toJSON();
                    json.disabled = true;
                    if (json.type === 3) return StringSelectMenuBuilder.from(json);
                    return ButtonBuilder.from(json);
                }));
                return newRow;
            });
            await interaction.editReply({ components: disabled }).catch(() => {});
        });
    }
};

function buildSummaryEmbed(templates, overrides) {
    const embed = new EmbedBuilder()
        .setTitle('Templates')
        .setDescription('Enable/disable, rename, duplicate, or create custom raid templates. Duplicate a built-in to edit roles.');
    templates.forEach((tpl) => {
        const override = overrides[tpl.id] || {};
        embed.addFields({
            name: tpl.name,
            value: [
                override.disabled ? 'Status: Disabled' : 'Status: Enabled',
                override.name ? `Override name: ${override.name}` : null,
                tpl.isCustom ? 'Type: Custom' : 'Type: Built-in'
            ].filter(Boolean).join('\n') || '—',
            inline: false
        });
    });
    return embed;
}

function buildComponents(templates, overrides) {
    const select = new StringSelectMenuBuilder()
        .setCustomId('templates:select')
        .setPlaceholder('Select a template to manage')
        .addOptions(templates.map((tpl) => ({
            label: `${overrides[tpl.id]?.disabled ? '🔒 ' : ''}${overrides[tpl.id]?.name || tpl.name}`,
            value: tpl.id
        })));
    const createRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('templates:create').setLabel('Create new').setStyle(ButtonStyle.Success)
    );
    return [new ActionRowBuilder().addComponents(select), createRow];
}

function buildDetailEmbed(template, overrides) {
    const override = overrides[template.id] || {};
    return new EmbedBuilder()
        .setTitle(override.name || template.name)
        .setDescription(override.disabled ? 'Currently disabled in this server.' : 'Enabled.')
        .addFields(
            { name: 'Base name', value: template.name, inline: true },
            { name: 'Override name', value: override.name || '—', inline: true },
            { name: 'Emoji', value: override.emoji || template.emoji || '—', inline: true },
            { name: 'Color', value: override.color || template.color || '—', inline: true },
            { name: 'Type', value: template.isCustom ? 'Custom' : 'Built-in', inline: true },
            { name: 'Roles', value: countRoles(template), inline: true }
        );
}

function buildDetailComponents(template, overrides) {
    const override = overrides[template.id] || {};
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`templates:toggle:${template.id}`)
                .setLabel(override.disabled ? 'Enable' : 'Disable')
                .setStyle(override.disabled ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`templates:editlabel:${template.id}`)
                .setLabel('Rename')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`templates:editmeta:${template.id}`)
                .setLabel('Edit basic')
                .setStyle(ButtonStyle.Primary),
            template.isCustom
                ? new ButtonBuilder().setCustomId(`templates:editroles:${template.id}`).setLabel('Edit roles').setStyle(ButtonStyle.Primary)
                : new ButtonBuilder().setCustomId(`templates:duplicate:${template.id}`).setLabel('Duplicate to edit roles').setStyle(ButtonStyle.Success),
            template.isCustom
                ? new ButtonBuilder().setCustomId(`templates:delete:${template.id}`).setLabel('Delete').setStyle(ButtonStyle.Danger)
                : new ButtonBuilder().setCustomId(`templates:reset:${template.id}`).setLabel('Reset').setStyle(ButtonStyle.Danger)
        )
    ];
}

function parseRoleInput(raw) {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return { error: 'Please provide at least one role line.' };
    const groups = new Map();
    for (const line of lines) {
        const parts = line.split('|').map((p) => p.trim());
        if (parts.length < 4) {
            return { error: `Invalid line: "${line}". Use Group|Emoji|Role|Slots|Icon(optional).` };
        }
        const [groupName, emoji, roleName, slotsStr, icon = ''] = parts;
        const slots = parseInt(slotsStr, 10);
        if (!groupName || !emoji || !roleName || Number.isNaN(slots) || slots <= 0) {
            return { error: `Invalid line: "${line}". Ensure group, emoji, role name, and positive slots.` };
        }
        if (!groups.has(groupName)) groups.set(groupName, []);
        groups.get(groupName).push({ emoji, icon, name: roleName, slots });
    }
    const roleGroups = Array.from(groups.entries()).map(([name, roles]) => ({ name, roles }));
    return { roleGroups };
}

function countRoles(template) {
    const groups = template.roleGroups || [];
    return groups.reduce((sum, g) => sum + (g.roles ? g.roles.length : 0), 0).toString();
}
