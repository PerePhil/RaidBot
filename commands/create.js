const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
    MessageFlags
} = require('discord.js');
const { setActiveRaid, getGuildSettings } = require('../state');
const {
    parseDateTimeToTimestamp,
    getRaidSignupChannel,
    getMuseumSignupChannel,
    getKeySignupChannel,
    updateMuseumEmbed,
    updateKeyEmbed
} = require('../utils/raidHelpers');
const { updateBotPresence } = require('../presence');
const { templatesForGuild } = require('../templatesManager');
const { generateId } = require('../utils/idGenerator');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('create')
        .setDescription('Interactive creation flow for raids or museum signups'),
    requiresManageGuild: true,
    async execute(interaction) {
        const availableTemplates = templatesForGuild(interaction.guildId);
        const state = {
            type: null,
            datetime: null,
            timestamp: null,
            length: null,
            strategy: null,
            templates: availableTemplates
        };

        await interaction.reply({
            content: 'Pick what to create, then set the time. Length/strategy only appear when needed.',
            embeds: [buildSummaryEmbed(state)],
            components: buildComponents(state),
            flags: MessageFlags.Ephemeral
        });

        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({
            filter: (i) => i.user.id === interaction.user.id,
            time: 5 * 60 * 1000
        });

        collector.on('collect', async (i) => {
            if (i.customId === 'create:type') {
                const selected = i.values[0];
                state.type = selected;
                state.length = null;
                state.strategy = null;
                await i.update({
                    embeds: [buildSummaryEmbed(state)],
                    components: buildComponents(state)
                });
                return;
            }

            if (i.customId === 'create:length') {
                state.length = i.values[0];
                await i.update({
                    embeds: [buildSummaryEmbed(state)],
                    components: buildComponents(state)
                });
                return;
            }

            if (i.customId === 'create:strategy') {
                state.strategy = i.values[0];
                await i.update({
                    embeds: [buildSummaryEmbed(state)],
                    components: buildComponents(state)
                });
                return;
            }

            if (i.customId === 'create:settime') {
                const modal = new ModalBuilder()
                    .setCustomId('create:settime:modal')
                    .setTitle('Set date/time')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('datetime')
                                .setLabel('Date/time')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('e.g., "tomorrow 7pm"')
                                .setRequired(true)
                        )
                    );

                await i.showModal(modal);
                const submission = await i.awaitModalSubmit({
                    time: 60 * 1000,
                    filter: (sub) => sub.customId === 'create:settime:modal' && sub.user.id === interaction.user.id
                }).catch(() => null);

                if (!submission) return;

                const datetime = submission.fields.getTextInputValue('datetime');
                const timestamp = parseDateTimeToTimestamp(datetime);
                if (!timestamp && !datetime.match(/^\d{4}-\d{2}-\d{2}/)) {
                    return submission.reply({
                        content: 'Could not parse that time. Try natural language like "tomorrow 7pm" or a Unix timestamp.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                state.datetime = datetime;
                state.timestamp = timestamp;
                await submission.reply({ content: 'Time set.', flags: MessageFlags.Ephemeral });
                await interaction.editReply({
                    embeds: [buildSummaryEmbed(state)],
                    components: buildComponents(state)
                }).catch(() => { });
                return;
            }

            if (i.customId === 'create:submit') {
                await i.deferUpdate();
                const success = await handleCreate(interaction, state);
                if (success) {
                    collector.stop('created');
                } else {
                    await interaction.editReply({
                        embeds: [buildSummaryEmbed(state)],
                        components: buildComponents(state)
                    }).catch(() => { });
                }
                return;
            }

            await i.reply({ content: 'Unsupported action.', flags: MessageFlags.Ephemeral });
        });

        collector.on('end', async (_collected, reason) => {
            if (reason === 'created') return;
            const disabled = disableComponents(buildComponents(state));
            await interaction.editReply({ components: disabled }).catch(() => { });
        });
    }
};

function buildSummaryEmbed(state) {
    const lines = [];
    if (state.type) lines.push(`Type: **${labelForType(state.type)}**`);
    if (state.datetime) {
        const timestampStr = state.timestamp ? `<t:${state.timestamp}:F>` : state.datetime;
        lines.push(`Time: ${timestampStr}`);
    }
    if (state.length && state.type !== 'museum') lines.push(`Length: \`${state.length} HOUR KEY\``);
    if (state.strategy) lines.push(`Strategy: ${state.strategy}`);

    const ready = isReady(state);
    return new EmbedBuilder()
        .setTitle('Create Signup')
        .setDescription(lines.length > 0 ? lines.join('\n') : 'Select a type, set time, and (if needed) choose length/strategy.')
        .setFooter({ text: ready ? 'Ready to create' : 'Fill required fields to enable Create' });
}

function buildComponents(state) {
    const rows = [];
    if (!state.type) {
        const options = state.templates.map((tpl) => ({
            label: tpl.name,
            value: tpl.slug
        }));
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('create:type')
                .setPlaceholder('Select activity type')
                .addOptions(options.concat([
                    { label: 'Museum Signup', value: 'museum' },
                    { label: 'Gold Key Boss', value: 'key' }
                ]))
        ));
    } else {
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('create:type:locked')
                .setLabel(`Type: ${labelForType(state.type)}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        ));
    }

    if (state.type && state.type !== 'museum' && state.type !== 'key') {
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('create:length')
                .setPlaceholder('Select length')
                .addOptions(
                    { label: '1.5 hours', value: '1.5', default: state.length === '1.5' },
                    { label: '3 hours', value: '3', default: state.length === '3' }
                )
        ));
    }

    if (state.type === 'dragonspyre') {
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('create:strategy')
                .setPlaceholder('Select strategy')
                .addOptions(
                    { label: 'Triple Storm', value: 'triple storm', default: state.strategy === 'triple storm' },
                    { label: '2 Myth 1 Storm', value: '2 myth 1 storm', default: state.strategy === '2 myth 1 storm' }
                )
        ));
    }

    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('create:settime')
            .setLabel('Set date/time')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('create:submit')
            .setLabel('Create')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!isReady(state))
    ));

    return rows;
}

function disableComponents(rows) {
    return rows.map((row) => {
        const newRow = new ActionRowBuilder();
        newRow.addComponents(
            ...row.components.map((component) => {
                const json = component.toJSON();
                json.disabled = true;
                if (json.type === 3) {
                    return StringSelectMenuBuilder.from(json);
                }
                return ButtonBuilder.from(json);
            })
        );
        return newRow;
    });
}

function isReady(state) {
    if (!state.type || !state.datetime) return false;
    if (state.type !== 'museum' && state.type !== 'key' && !state.length) return false;
    if (state.type === 'dragonspyre' && !state.strategy) return false;
    return true;
}

function labelForType(type) {
    const map = {
        dragonspyre: 'Dragonspyre (Voracious Void)',
        lemuria: 'Lemuria (Ghastly Conspiracy)',
        polaris: 'Polaris (Cabal\'s Revenge)',
        museum: 'Museum Signup',
        key: 'Gold Key Boss'
    };
    return map[type] || type;
}

async function handleCreate(interaction, state) {
    if (!isReady(state)) {
        await interaction.followUp({ content: 'Please fill in all required fields first.', flags: MessageFlags.Ephemeral });
        return false;
    }

    const timestamp = state.timestamp ?? parseDateTimeToTimestamp(state.datetime);
    if (!timestamp && !state.datetime.match(/^\d{4}-\d{2}-\d{2}/)) {
        await interaction.followUp({
            content: 'Could not parse that time. Try natural language like "tomorrow 7pm" or a Unix timestamp.',
            flags: MessageFlags.Ephemeral
        });
        return false;
    }

    if (state.type === 'museum') {
        return createMuseum(interaction, state, timestamp);
    }
    if (state.type === 'key') {
        return createKey(interaction, state, timestamp);
    }
    return createRaid(interaction, state, timestamp);
}

async function createMuseum(interaction, state, timestamp) {
    const signupChannel = await getMuseumSignupChannel(interaction.guild);
    if (!signupChannel) {
        await interaction.followUp({
            content: 'No museum channel configured. Use `/setchannel` to pick one (or pass the museum channel option), or create a channel named "museum-signups".',
            flags: MessageFlags.Ephemeral
        });
        return false;
    }

    const raidId = generateRaidId();
    const timestampStr = timestamp ? `<t:${timestamp}:F>` : state.datetime;
    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('Museum Signup')
        .setDescription('React with ✅ to reserve a slot. Max 12 players.')
        .addFields(
            {
                name: '\n**Date + Time:**',
                value: timestampStr,
                inline: false
            },
            {
                name: '\u200b',
                value: `*Raid ID: \`${raidId}\`*\nCreated by <@${interaction.user.id}>`,
                inline: false
            }
        )
        .setTimestamp(timestamp ? new Date(timestamp * 1000) : undefined);

    await interaction.editReply({ content: 'Creating museum signup...', embeds: [], components: [] });
    const museumMessage = await signupChannel.send({ embeds: [embed] });
    await museumMessage.react('✅');

    // Create discussion thread if enabled
    let threadId = null;
    const settings = getGuildSettings(interaction.guild.id);
    if (settings.threadsEnabled) {
        try {
            const thread = await museumMessage.startThread({
                name: `Museum - ${raidId}`,
                autoArchiveDuration: settings.threadAutoArchiveMinutes || 1440
            });
            threadId = thread.id;
            await thread.send(`💬 Discussion thread for **Museum Signup** (ID: \`${raidId}\`)\n⏰ Time: <t:${timestamp}:F>`);
        } catch (error) {
            console.error('Failed to create museum thread:', error);
        }
    }

    const raidData = {
        raidId,
        type: 'museum',
        signups: [],
        datetime: state.datetime,
        timestamp,
        creatorId: interaction.user.id,
        guildId: interaction.guild.id,
        maxSlots: 12,
        waitlist: [],
        channelId: signupChannel.id,
        threadId,
        creatorReminderSent: false,
        participantReminderSent: false
    };

    setActiveRaid(museumMessage.id, raidData);
    await updateMuseumEmbed(museumMessage, raidData);
    await updateBotPresence();

    const replyContent = threadId
        ? `Museum signup created in ${signupChannel}! Discussion: <#${threadId}>`
        : `Museum signup created in ${signupChannel}!`;

    await interaction.editReply({
        content: replyContent,
        embeds: [],
        components: []
    });
    return true;
}

async function createKey(interaction, state, timestamp) {
    const signupChannel = await getKeySignupChannel(interaction.guild);
    if (!signupChannel) {
        await interaction.followUp({
            content: 'No key boss channel configured. Use `/setchannel` to pick one (or pass the key channel option), or create a channel named "key-signups".',
            flags: MessageFlags.Ephemeral
        });
        return false;
    }

    const raidId = generateRaidId();
    const timestampStr = timestamp ? `<t:${timestamp}:F>` : state.datetime;
    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('Gold Key Boss')
        .setDescription('React with 🔑 to reserve a slot. Max 12 players.')
        .addFields(
            {
                name: '\n**Date + Time:**',
                value: timestampStr,
                inline: false
            },
            {
                name: '\u200b',
                value: `*Raid ID: \`${raidId}\`*\nCreated by <@${interaction.user.id}>`,
                inline: false
            }
        )
        .setTimestamp(timestamp ? new Date(timestamp * 1000) : undefined);

    await interaction.editReply({ content: 'Creating key boss signup...', embeds: [], components: [] });
    const keyMessage = await signupChannel.send({ embeds: [embed] });
    await keyMessage.react('🔑');

    // Create discussion thread if enabled
    let threadId = null;
    const settings = getGuildSettings(interaction.guild.id);
    if (settings.threadsEnabled) {
        try {
            const thread = await keyMessage.startThread({
                name: `Key Boss - ${raidId}`,
                autoArchiveDuration: settings.threadAutoArchiveMinutes || 1440
            });
            threadId = thread.id;
            await thread.send(`💬 Discussion thread for **Gold Key Boss** (ID: \`${raidId}\`)\n⏰ Time: <t:${timestamp}:F>`);
        } catch (error) {
            console.error('Failed to create key boss thread:', error);
        }
    }

    const raidData = {
        raidId,
        type: 'key',
        signups: [],
        datetime: state.datetime,
        timestamp,
        creatorId: interaction.user.id,
        guildId: interaction.guild.id,
        maxSlots: 12,
        waitlist: [],
        channelId: signupChannel.id,
        threadId,
        creatorReminderSent: false,
        participantReminderSent: false
    };

    setActiveRaid(keyMessage.id, raidData);
    await updateKeyEmbed(keyMessage, raidData);
    await updateBotPresence();

    const replyContent = threadId
        ? `Key boss signup created in ${signupChannel}! Discussion: <#${threadId}>`
        : `Key boss signup created in ${signupChannel}!`;

    await interaction.editReply({
        content: replyContent,
        embeds: [],
        components: []
    });
    return true;
}

async function createRaid(interaction, state, timestamp) {
    const template = resolveTemplate(state.templates, state.type);
    if (!template) {
        await interaction.followUp({ content: 'Raid template not found for that type.', flags: MessageFlags.Ephemeral });
        return false;
    }

    const signupChannel = await getRaidSignupChannel(interaction.guild);
    if (!signupChannel) {
        await interaction.followUp({
            content: 'No raid channel configured. Use `/setchannel` to pick one (or pass the raid channel option), or create a channel named "raid-signups".',
            flags: MessageFlags.Ephemeral
        });
        return false;
    }

    const raidId = generateRaidId();
    const timestampStr = timestamp ? `<t:${timestamp}:F>` : state.datetime;
    const lengthBadge = `\`${state.length} HOUR KEY\``;
    const { roleGroups, description } = buildRoleGroups(template, state.strategy);

    const embed = new EmbedBuilder()
        .setColor(template.color || '#0099ff')
        .setTitle(`${template.emoji} ${template.name}! ${template.emoji}`)
        .setDescription(description)
        .setTimestamp(timestamp ? new Date(timestamp * 1000) : undefined);

    const fields = [
        {
            name: '\n**Date + Time:**',
            value: `${timestampStr} || ${lengthBadge}`,
            inline: false
        }
    ];

    roleGroups.forEach((group) => {
        fields.push({
            name: `\n**${group.name}:**`,
            value: group.roles.map((role) => `${role.emoji} ${role.icon} ${role.name}`).join('\n'),
            inline: false
        });
    });

    fields.push({
        name: '\u200b',
        value: `*Raid ID: \`${raidId}\`*\nCreated by <@${interaction.user.id}>`,
        inline: false
    });

    embed.setFields(fields);

    await interaction.editReply({ content: 'Creating raid signup...', embeds: [], components: [] });
    const raidMessage = await signupChannel.send({ embeds: [embed] });

    const allRoles = [];
    for (const group of roleGroups) {
        for (const role of group.roles) {
            allRoles.push({
                emoji: role.emoji,
                icon: role.icon,
                name: role.name,
                slots: role.slots,
                users: [],
                groupName: group.name,
                sideAssignments: {},
                waitlist: []
            });
            await raidMessage.react(role.emoji);
        }
    }

    // Create discussion thread if enabled
    let threadId = null;
    const settings = getGuildSettings(interaction.guild.id);
    if (settings.threadsEnabled) {
        try {
            const thread = await raidMessage.startThread({
                name: `${template.name} - ${raidId}`,
                autoArchiveDuration: settings.threadAutoArchiveMinutes || 1440
            });
            threadId = thread.id;
            await thread.send(`💬 Discussion thread for **${template.name}** (ID: \`${raidId}\`)\n⏰ Raid time: <t:${timestamp}:F>`);
        } catch (error) {
            console.error('Failed to create raid thread:', error);
        }
    }

    setActiveRaid(raidMessage.id, {
        raidId,
        template,
        signups: allRoles,
        datetime: state.datetime,
        timestamp,
        length: state.length,
        strategy: state.strategy,
        creatorId: interaction.user.id,
        guildId: interaction.guild.id,
        channelId: signupChannel.id,
        threadId,
        creatorReminderSent: false,
        participantReminderSent: false
    });
    await updateBotPresence();

    const replyContent = threadId
        ? `Raid signup created in ${signupChannel}! Discussion: <#${threadId}>`
        : `Raid signup created in ${signupChannel}!`;

    await interaction.editReply({
        content: replyContent,
        embeds: [],
        components: []
    });
    return true;
}

function resolveTemplate(templates, type) {
    return templates.find((tpl) => tpl.slug === type) || null;
}

function buildRoleGroups(template, strategy) {
    const roleGroups = JSON.parse(JSON.stringify(template.roleGroups));
    let description = template.description || '';

    if (template.slug === 'dragonspyre') {
        if (strategy) {
            description = description.replace('triple storm', strategy);
        }
        if (strategy === '2 myth 1 storm') {
            const vanguardGroup = roleGroups.find((g) => g.name === 'VANGAURD');
            if (vanguardGroup) {
                vanguardGroup.roles = [
                    { emoji: '1️⃣', icon: '<:Myth:1430673701439017100>', name: 'Myth 1', slots: 1 },
                    { emoji: '2️⃣', icon: '<:Myth:1430673701439017100>', name: 'Myth 2', slots: 1 },
                    { emoji: '3️⃣', icon: '<:Storm:1430690317421776957>', name: 'Storm 1', slots: 1 },
                    { emoji: '4️⃣', icon: '<:Balance:1430673056380092457>', name: 'Jade', slots: 1 }
                ];
            }
        }
    }

    return { roleGroups, description };
}

function generateRaidId() {
    return generateId('', 6);
}
