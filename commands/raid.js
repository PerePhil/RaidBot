const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    MessageFlags
} = require('discord.js');
const {
    findRaidByIdInGuild,
    fetchRaidMessage,
    closeRaidSignup,
    reopenRaidSignup,
    parseDateTimeToTimestamp,
    getRaidSignupChannel,
    getMuseumSignupChannel,
    getKeySignupChannel,
    updateRaidEmbed,
    updateMuseumEmbed,
    updateKeyEmbed
} = require('../utils/raidHelpers');
const { buildMessageLink } = require('../utils/raidFormatters');
const { updateBotPresence } = require('../presence');
const { activeRaids, deleteActiveRaid, markActiveRaidUpdated, setActiveRaid, getGuildSettings, recordNoShow, clearNoShow, guildParticipation } = require('../state');
const { sendAuditLog } = require('../auditLog');
const { usersAvailableAt } = require('../availabilityManager');
const { generateId } = require('../utils/idGenerator');
const { templatesForGuild } = require('../templatesManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('raid')
        .setDescription('Manage raid signups with an interactive panel')
        .addStringOption((option) =>
            option.setName('raid_id')
                .setDescription('Raid ID (found at the bottom of the signup embed)')
                .setRequired(true)),
    requiresManageGuild: true,
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const raidId = interaction.options.getString('raid_id');
        const result = findRaidByIdInGuild(interaction.guild, raidId);
        if (!result) {
            return interaction.editReply({ content: 'Raid not found. Please verify the Raid ID.' });
        }

        const { messageId, raidData } = result;
        await sendPanel(interaction, raidId, raidData, messageId);
    }
};

async function sendPanel(interaction, raidId, raidData, messageId) {
    const embed = buildPanelEmbed(raidId, raidData, messageId);
    const buttons = buildPanelComponents(messageId, raidData);

    await interaction.editReply({
        content: buildMessageLink(raidData, messageId) || null,
        embeds: [embed],
        components: buttons
    });

    const replyMessage = await interaction.fetchReply();
    const collector = replyMessage.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id,
        time: 5 * 60 * 1000
    });

    collector.on('collect', async (i) => {
        try {
            const parts = i.customId.split(':');
            if (parts[0] !== 'raid' || parts.length < 3) {
                return i.reply({ content: 'Unsupported action.', flags: MessageFlags.Ephemeral });
            }
            const action = parts[1];
            const msgId = parts[2];
            const raidEntry = activeRaids.get(msgId);
            if (!raidEntry) {
                return i.reply({ content: 'Raid data not found (maybe deleted).', flags: MessageFlags.Ephemeral });
            }

            if (action === 'close') {
                return closeRaid(i, { raidId: raidEntry.raidId, messageId: msgId, raidData: raidEntry, updatePanel: true });
            }
            if (action === 'reopen') {
                return reopenRaid(i, { raidId: raidEntry.raidId, messageId: msgId, raidData: raidEntry, updatePanel: true });
            }
            if (action === 'delete') {
                return deleteRaid(i, { raidId: raidEntry.raidId, messageId: msgId, raidData: raidEntry, updatePanel: true });
            }
            if (action === 'time') {
                return showTimeModal(i, raidEntry, msgId);
            }
            if (action === 'length') {
                return showLengthSelect(i, raidEntry, msgId);
            }
            if (action === 'noshow') {
                return showNoShowSelect(i, raidEntry, msgId);
            }
            if (action === 'findsub') {
                return showFindSubSelect(i, raidEntry, msgId);
            }
            if (action === 'duplicate') {
                return showDuplicateFlow(i, raidEntry, msgId);
            }
            return i.reply({ content: 'Unsupported action.', flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('Collector handler error:', error);
            collector.stop('error');
            throw error;
        }
    });

    collector.on('end', async () => {
        const disabledRows = buttons.map(row =>
            new ActionRowBuilder().addComponents(
                ...row.components.map((btn) => ButtonBuilder.from(btn.data).setDisabled(true))
            )
        );
        await replyMessage.edit({ components: disabledRows }).catch(() => { });
    });
}

async function closeRaid(interaction, context = {}) {
    if (interaction.isButton() && !interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
    }
    const raidId = context.raidId || interaction.options.getString('raid_id');
    const found = context.raidData && context.messageId
        ? { messageId: context.messageId, raidData: context.raidData }
        : findRaidByIdInGuild(interaction.guild, raidId);
    const result = found;

    if (!result) {
        return respond(interaction, 'Raid not found. Please verify the Raid ID.');
    }

    const { messageId, raidData } = result;
    const message = await fetchRaidMessage(interaction.guild, raidData, messageId);

    if (!message) {
        return respond(interaction, 'Could not locate the raid message. It may have been deleted.');
    }

    const closed = await closeRaidSignup(message, raidData, {
        closedByUserId: interaction.user.id,
        reason: 'manual'
    });
    if (!closed) {
        return respond(interaction, 'Failed to update the raid message while closing.');
    }

    await updateBotPresence();
    markActiveRaidUpdated(messageId);

    const link = buildMessageLink(raidData, messageId);
    const replyLines = [
        'Raid closed successfully.',
        link ? `Message link: ${link}` : null
    ].filter(Boolean);

    await respond(interaction, replyLines.join('\n'));
    await sendAuditLog(interaction.guild, `Raid ${raidId} closed`, {
        title: 'Raid Closed',
        color: 0xED4245,
        fields: [
            { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Raid ID', value: raidId, inline: true },
            link ? { name: 'Message', value: link, inline: false } : null
        ].filter(Boolean),
        components: link ? [makePanelButton(link)] : undefined
    });
    if (context.updatePanel) {
        await refreshPanel(interaction, raidData, messageId);
    }
    return null;
}

async function reopenRaid(interaction, context = {}) {
    if (interaction.isButton() && !interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
    }
    const raidId = context.raidId || interaction.options.getString('raid_id');
    const found = context.raidData && context.messageId
        ? { messageId: context.messageId, raidData: context.raidData }
        : findRaidByIdInGuild(interaction.guild, raidId);
    const result = found;

    if (!result) {
        return respond(interaction, 'Raid not found. Please verify the Raid ID.');
    }

    const { messageId, raidData } = result;

    if (!raidData.closed) {
        return respond(interaction, 'That raid is already open for signups.');
    }

    const message = await fetchRaidMessage(interaction.guild, raidData, messageId);
    if (!message) {
        return respond(interaction, 'Could not locate the raid message. It may have been deleted.');
    }

    const reopened = await reopenRaidSignup(message, raidData, {
        reopenedByUserId: interaction.user.id
    });

    if (!reopened) {
        return respond(interaction, 'Failed to update the raid message while reopening.');
    }

    await updateBotPresence();
    markActiveRaidUpdated(messageId);

    const link = buildMessageLink(raidData, messageId);
    const replyLines = [
        'Raid reopened successfully.',
        link ? `Message link: ${link}` : null
    ].filter(Boolean);

    await respond(interaction, replyLines.join('\n'));
    await sendAuditLog(interaction.guild, `Raid ${raidId} reopened`, {
        title: 'Raid Reopened',
        color: 0x57F287,
        fields: [
            { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Raid ID', value: raidId, inline: true },
            link ? { name: 'Message', value: link, inline: false } : null
        ].filter(Boolean),
        components: link ? [makePanelButton(link)] : undefined
    });
    if (context.updatePanel) {
        await refreshPanel(interaction, raidData, messageId);
    }
    return null;
}

async function deleteRaid(interaction, context = {}) {
    if (interaction.isButton() && !interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
    }
    const raidId = context.raidId || interaction.options.getString('raid_id');
    const found = context.raidData && context.messageId
        ? { messageId: context.messageId, raidData: context.raidData }
        : findRaidByIdInGuild(interaction.guild, raidId);
    const result = found;
    if (!result) {
        return respond(interaction, 'Raid not found. Make sure the Raid ID is correct.');
    }

    const { messageId, raidData } = result;
    const message = await fetchRaidMessage(interaction.guild, raidData, messageId);
    if (!message) {
        return respond(interaction, 'Could not find the raid message in this server.');
    }

    try {
        await message.delete();
        deleteActiveRaid(messageId);
        await updateBotPresence();
        const link = buildMessageLink(raidData, messageId);

        await respond(interaction, `Raid ${raidId} has been deleted.`);
        await sendAuditLog(interaction.guild, `Raid ${raidId} deleted`, {
            title: 'Raid Deleted',
            color: 0x99AAb5,
            fields: [
                { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Raid ID', value: raidId, inline: true }
            ],
            components: link ? [makePanelButton(link)] : undefined
        });
        if (context.updatePanel) {
            await disablePanel(interaction);
        }
        return null;
    } catch (error) {
        console.error('Error deleting raid message:', error);
        return respond(interaction, 'Failed to delete raid message.');
    }
}

async function respond(interaction, content) {
    if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content });
    }
    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function showTimeModal(interaction, raidData, messageId) {
    const modal = new ModalBuilder()
        .setCustomId(`raid:timeModal:${messageId}`)
        .setTitle('Change Raid Time')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('new_datetime')
                    .setLabel('New date/time')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g., "tomorrow 7pm" or Unix timestamp')
                    .setRequired(true)
            )
        );

    await interaction.showModal(modal);

    const submission = await interaction.awaitModalSubmit({
        time: 60 * 1000,
        filter: (i) => i.customId === `raid:timeModal:${messageId}` && i.user.id === interaction.user.id
    }).catch(() => null);

    if (!submission) {
        return;
    }

    const newDatetime = submission.fields.getTextInputValue('new_datetime');
    const timestamp = parseDateTimeToTimestamp(newDatetime);
    if (!timestamp && !newDatetime.match(/^\d{4}-\d{2}-\d{2}/)) {
        return submission.reply({
            content: 'Could not parse that time. Try natural language like "tomorrow 7pm" or a Unix timestamp.',
            flags: MessageFlags.Ephemeral
        });
    }

    const message = await fetchRaidMessage(submission.guild, raidData, messageId);
    if (!message) {
        return submission.reply({
            content: 'Could not find the signup message for this raid.',
            flags: MessageFlags.Ephemeral
        });
    }

    try {
        const embed = EmbedBuilder.from(message.embeds[0]);
        const timestampStr = timestamp ? `<t:${timestamp}:F>` : newDatetime;
        const existingFields = embed.data.fields || [];
        const length = raidData.length || '1.5';
        const lengthPart = raidData.type === 'museum' ? '' : ` || \`${length} HOUR KEY\``;
        const dateFieldValue = `${timestampStr}${lengthPart}`;

        const filtered = existingFields.filter((field) => !(typeof field.name === 'string' && field.name.includes('Date + Time')));
        const newFields = [
            {
                name: '\n**Date + Time:**',
                value: dateFieldValue,
                inline: false
            },
            ...filtered
        ];

        embed.setFields(newFields);
        embed.setTimestamp(timestamp ? new Date(timestamp * 1000) : undefined);

        await message.edit({ embeds: [embed] });

        raidData.datetime = newDatetime;
        raidData.timestamp = timestamp;
        raidData.creatorReminderSent = false;
        raidData.participantReminderSent = false;
        markActiveRaidUpdated(messageId);

        await submission.reply({
            content: 'Raid time updated successfully!',
            flags: MessageFlags.Ephemeral
        });
        const panelLink = buildMessageLink(raidData, messageId);
        await sendAuditLog(submission.guild, `Raid ${raidData.raidId} time changed`, {
            title: 'Raid Time Updated',
            color: 0x5865F2,
            fields: [
                { name: 'By', value: `<@${submission.user.id}>`, inline: true },
                { name: 'Raid ID', value: raidData.raidId || 'Unknown', inline: true },
                { name: 'New time', value: timestampStr, inline: false },
                panelLink ? { name: 'View panel', value: panelLink, inline: false } : null
            ].filter(Boolean),
            components: panelLink ? [makePanelButton(panelLink)] : undefined
        });

        await refreshPanel(submission, raidData, messageId);
    } catch (error) {
        console.error('Error updating raid time from panel:', error);
        return submission.reply({
            content: 'Failed to update raid time.',
            flags: MessageFlags.Ephemeral
        });
    }
}

async function showLengthSelect(interaction, raidData, messageId) {
    const currentLength = raidData.length || '1.5';

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`raid:lengthSelect:${messageId}`)
            .setPlaceholder('Select new length')
            .addOptions(
                { label: '1.5 hours', value: '1.5', default: currentLength === '1.5' },
                { label: '3 hours', value: '3', default: currentLength === '3' }
            )
    );

    await interaction.reply({
        content: `Current length: **${currentLength} hours**\nSelect new length:`,
        components: [row],
        flags: MessageFlags.Ephemeral
    });

    const selectInteraction = await interaction.channel.awaitMessageComponent({
        filter: (i) => i.customId === `raid:lengthSelect:${messageId}` && i.user.id === interaction.user.id,
        time: 30000
    }).catch(() => null);

    if (!selectInteraction) {
        return interaction.editReply({ content: 'Selection timed out.', components: [] });
    }

    const newLength = selectInteraction.values[0];

    if (newLength === currentLength) {
        return selectInteraction.update({ content: 'Length unchanged.', components: [] });
    }

    const message = await fetchRaidMessage(selectInteraction.guild, raidData, messageId);
    if (!message) {
        return selectInteraction.update({ content: 'Could not find the signup message.', components: [] });
    }

    try {
        const embed = EmbedBuilder.from(message.embeds[0]);
        const existingFields = embed.data.fields || [];
        const timestampStr = raidData.timestamp ? `<t:${raidData.timestamp}:F>` : (raidData.datetime || 'Not specified');
        const dateFieldValue = `${timestampStr} || \`${newLength} HOUR KEY\``;

        const filtered = existingFields.filter((field) =>
            !(typeof field.name === 'string' && field.name.includes('Date + Time'))
        );
        embed.setFields([
            { name: '\n**Date + Time:**', value: dateFieldValue, inline: false },
            ...filtered
        ]);

        await message.edit({ embeds: [embed] });

        raidData.length = newLength;
        markActiveRaidUpdated(messageId);

        await selectInteraction.update({
            content: `Length updated to **${newLength} hours**!`,
            components: []
        });

        const panelLink = buildMessageLink(raidData, messageId);
        await sendAuditLog(selectInteraction.guild, `Raid ${raidData.raidId} length changed`, {
            title: 'Raid Length Updated',
            color: 0x5865F2,
            fields: [
                { name: 'By', value: `<@${selectInteraction.user.id}>`, inline: true },
                { name: 'Raid ID', value: raidData.raidId || 'Unknown', inline: true },
                { name: 'New length', value: `${newLength} hours`, inline: true },
                panelLink ? { name: 'View signup', value: panelLink, inline: false } : null
            ].filter(Boolean)
        });

        await refreshPanel(selectInteraction, raidData, messageId);
    } catch (error) {
        console.error('Error updating raid length:', error);
        return selectInteraction.update({
            content: 'Failed to update raid length.',
            components: []
        });
    }
}

function buildPanelEmbed(raidId, raidData, messageId) {
    const status = raidData.closed ? 'Closed' : 'Open';
    const link = buildMessageLink(raidData, messageId);
    const lines = [
        `Raid ID: \`${raidId}\``,
        `Type: ${raidData.template?.name || (raidData.type === 'museum' ? 'Museum' : 'Raid')}`,
        `Status: ${status}`,
        link ? `Signup: ${link}` : null
    ].filter(Boolean);
    return new EmbedBuilder()
        .setTitle('Raid Management')
        .setDescription(lines.join('\n'));
}

function buildPanelComponents(messageId, raidData) {
    const isMuseumOrKey = raidData?.type === 'museum' || raidData?.type === 'key';
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`raid:close:${messageId}`)
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(raidData?.closed === true),
        new ButtonBuilder()
            .setCustomId(`raid:reopen:${messageId}`)
            .setLabel('Reopen')
            .setStyle(ButtonStyle.Success)
            .setDisabled(raidData?.closed === false),
        new ButtonBuilder()
            .setCustomId(`raid:delete:${messageId}`)
            .setLabel('Delete')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`raid:time:${messageId}`)
            .setLabel('Change Time')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`raid:length:${messageId}`)
            .setLabel('Change Length')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(isMuseumOrKey)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`raid:noshow:${messageId}`)
            .setLabel('Mark No-Show')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!raidData?.closed), // Only enabled when raid is closed
        new ButtonBuilder()
            .setCustomId(`raid:findsub:${messageId}`)
            .setLabel('Find Sub')
            .setEmoji('🔍')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(isMuseumOrKey), // Disabled for museum/key (no roles)
        new ButtonBuilder()
            .setCustomId(`raid:duplicate:${messageId}`)
            .setLabel('Duplicate')
            .setEmoji('📋')
            .setStyle(ButtonStyle.Secondary)
    );

    return [row1, row2];
}

async function refreshPanel(interaction, raidData, messageId) {
    try {
        const embed = buildPanelEmbed(raidData.raidId, raidData, messageId);
        const components = buildPanelComponents(messageId, raidData);
        if (interaction.message) {
            await interaction.message.edit({ embeds: [embed], components }).catch(() => { });
        } else {
            await interaction.editReply({ embeds: [embed], components }).catch(() => { });
        }
    } catch (error) {
        console.error('Failed to refresh raid panel:', error);
    }
}

async function disablePanel(interaction) {
    try {
        if (interaction.message) {
            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('raid:close:disabled').setLabel('Close').setStyle(ButtonStyle.Danger).setDisabled(true),
                new ButtonBuilder().setCustomId('raid:reopen:disabled').setLabel('Reopen').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId('raid:delete:disabled').setLabel('Delete').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('raid:time:disabled').setLabel('Change Time').setStyle(ButtonStyle.Primary).setDisabled(true),
                new ButtonBuilder().setCustomId('raid:length:disabled').setLabel('Change Length').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );
            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('raid:noshow:disabled').setLabel('Mark No-Show').setEmoji('❌').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('raid:findsub:disabled').setLabel('Find Sub').setEmoji('🔍').setStyle(ButtonStyle.Primary).setDisabled(true),
                new ButtonBuilder().setCustomId('raid:duplicate:disabled').setLabel('Duplicate').setEmoji('📋').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );
            await interaction.message.edit({ components: [row1, row2] }).catch(() => { });
        } else {
            await interaction.editReply({ components: [] }).catch(() => { });
        }
    } catch (error) {
        console.error('Failed to disable raid panel:', error);
    }
}

async function showNoShowSelect(interaction, raidData, messageId) {
    if (!raidData.closed) {
        return interaction.reply({
            content: 'You can only mark no-shows after a raid is closed.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Collect all signed up users
    const participants = [];
    if (raidData.type === 'museum' || raidData.type === 'key') {
        raidData.signups?.forEach(userId => participants.push(userId));
    } else {
        raidData.signups?.forEach(role => {
            role.users?.forEach(userId => participants.push(userId));
        });
    }

    if (participants.length === 0) {
        return interaction.reply({
            content: 'No participants to mark as no-shows.',
            flags: MessageFlags.Ephemeral
        });
    }

    const selectMenu = new UserSelectMenuBuilder()
        .setCustomId(`raid:noshowSelect:${messageId}`)
        .setPlaceholder('Select user(s) who did not show up')
        .setMinValues(1)
        .setMaxValues(Math.min(participants.length, 25));

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
        content: '**Select the user(s) who did not attend this raid:**\n(They will have their no-show count incremented)',
        components: [row],
        flags: MessageFlags.Ephemeral
    });

    const selectInteraction = await interaction.channel.awaitMessageComponent({
        filter: (i) => i.customId === `raid:noshowSelect:${messageId}` && i.user.id === interaction.user.id,
        time: 60000
    }).catch(() => null);

    if (!selectInteraction) {
        return interaction.editReply({ content: 'Selection timed out.', components: [] });
    }

    const selectedUsers = selectInteraction.values;
    const results = [];

    for (const userId of selectedUsers) {
        // Verify user was actually signed up
        if (!participants.includes(userId)) {
            results.push(`<@${userId}> was not signed up for this raid`);
            continue;
        }

        const isNew = recordNoShow(messageId, raidData.guildId, userId, interaction.user.id);
        if (isNew) {
            results.push(`✓ <@${userId}> marked as no-show`);
        } else {
            results.push(`<@${userId}> was already marked as no-show`);
        }
    }

    await selectInteraction.update({
        content: `**No-Show Results:**\n${results.join('\n')}`,
        components: []
    });

    // Audit log
    await sendAuditLog(selectInteraction.guild, `No-shows marked for raid ${raidData.raidId}`, {
        title: 'No-Shows Marked',
        color: 0xED4245,
        fields: [
            { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Raid ID', value: raidData.raidId || 'Unknown', inline: true },
            { name: 'Users', value: selectedUsers.map(id => `<@${id}>`).join(', '), inline: false }
        ]
    });
}

async function showFindSubSelect(interaction, raidData, messageId) {
    if (raidData.type === 'museum' || raidData.type === 'key') {
        return interaction.reply({
            content: 'Find Sub is not available for museum or key boss signups.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Build role options from the raid's signups
    const roleOptions = raidData.signups
        .filter(role => role.name)
        .map(role => ({
            label: role.name,
            value: role.name,
            emoji: role.emoji || undefined
        }));

    if (roleOptions.length === 0) {
        return interaction.reply({
            content: 'No roles found in this raid.',
            flags: MessageFlags.Ephemeral
        });
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`raid:findsubRole:${messageId}`)
        .setPlaceholder('Select role to find subs for')
        .addOptions(roleOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
        content: '**Select the role you need a substitute for:**',
        components: [row],
        flags: MessageFlags.Ephemeral
    });

    const selectInteraction = await interaction.channel.awaitMessageComponent({
        filter: (i) => i.customId === `raid:findsubRole:${messageId}` && i.user.id === interaction.user.id,
        time: 60000
    }).catch(() => null);

    if (!selectInteraction) {
        return interaction.editReply({ content: 'Selection timed out.', components: [] });
    }

    const selectedRole = selectInteraction.values[0];
    const guildId = raidData.guildId;

    // Get all guild members with role experience
    const guildStats = guildParticipation.get(guildId);
    if (!guildStats || guildStats.size === 0) {
        return selectInteraction.update({
            content: 'No participation data found for this server.',
            components: []
        });
    }

    // Collect who's already signed up
    const alreadySignedUp = new Set();
    raidData.signups.forEach(role => {
        role.users?.forEach(userId => alreadySignedUp.add(userId));
        role.waitlist?.forEach(userId => alreadySignedUp.add(userId));
    });

    // Find users with experience in this role
    const candidates = [];
    for (const [userId, stats] of guildStats.entries()) {
        if (alreadySignedUp.has(userId)) continue;

        const roleCount = stats.roleCounts?.[selectedRole] || 0;
        if (roleCount > 0) {
            candidates.push({
                userId,
                roleCount,
                totalRaids: stats.totalRaids || 0,
                lastRaidAt: stats.lastRaidAt
            });
        }
    }

    // Check availability if raid has a timestamp
    let availableUserIds = null;
    if (raidData.timestamp) {
        availableUserIds = new Set(usersAvailableAt(guildId, raidData.timestamp));
    }

    // Score and sort candidates
    const scoredCandidates = candidates.map(c => {
        let score = c.roleCount * 10; // Weight role experience heavily
        score += Math.min(c.totalRaids, 50); // Cap total raids contribution
        if (availableUserIds && availableUserIds.has(c.userId)) {
            score += 100; // Big bonus for availability
            c.available = true;
        }
        // Recency bonus
        if (c.lastRaidAt && Date.now() - c.lastRaidAt < 14 * 24 * 60 * 60 * 1000) {
            score += 20; // Active in last 2 weeks
        }
        c.score = score;
        return c;
    }).sort((a, b) => b.score - a.score);

    const top5 = scoredCandidates.slice(0, 5);

    if (top5.length === 0) {
        return selectInteraction.update({
            content: `No users found with experience in **${selectedRole}** who aren't already signed up.`,
            components: []
        });
    }

    const lines = top5.map((c, idx) => {
        const availTag = c.available ? ' ✅ available' : '';
        return `**${idx + 1}.** <@${c.userId}> — ${c.roleCount}x ${selectedRole}, ${c.totalRaids} total raids${availTag}`;
    });

    const embed = new EmbedBuilder()
        .setTitle(`🔍 Substitute Candidates for ${selectedRole}`)
        .setDescription(lines.join('\n'))
        .setColor(0x5865F2)
        .setFooter({ text: raidData.timestamp ? 'Sorted by role experience + availability' : 'Sorted by role experience' });

    return selectInteraction.update({
        content: null,
        embeds: [embed],
        components: []
    });
}

async function showDuplicateFlow(interaction, raidData, messageId) {
    const modal = new ModalBuilder()
        .setCustomId(`raid:dupModal:${messageId}`)
        .setTitle('Duplicate Raid')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('new_datetime')
                    .setLabel('New date/time for the duplicate')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g., "next friday 7pm" or Unix timestamp')
                    .setRequired(true)
            )
        );

    await interaction.showModal(modal);

    const submission = await interaction.awaitModalSubmit({
        time: 60 * 1000,
        filter: (i) => i.customId === `raid:dupModal:${messageId}` && i.user.id === interaction.user.id
    }).catch(() => null);

    if (!submission) return;

    const newDatetime = submission.fields.getTextInputValue('new_datetime');
    const timestamp = parseDateTimeToTimestamp(newDatetime);
    if (!timestamp && !newDatetime.match(/^\d{4}-\d{2}-\d{2}/)) {
        return submission.reply({
            content: 'Could not parse that time. Try natural language like "next friday 7pm" or a Unix timestamp.',
            flags: MessageFlags.Ephemeral
        });
    }

    const isMuseumOrKey = raidData.type === 'museum' || raidData.type === 'key';

    // Museum/key: skip roster choice, always create empty
    if (isMuseumOrKey) {
        await submission.deferReply({ flags: MessageFlags.Ephemeral });
        return createDuplicateRaid(submission, raidData, messageId, {
            datetime: newDatetime,
            timestamp,
            copyRoster: false
        });
    }

    // Regular raids: ask whether to copy roster
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`raid:dupCopy:${messageId}`)
            .setLabel('Copy Roster')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`raid:dupEmpty:${messageId}`)
            .setLabel('Start Empty')
            .setStyle(ButtonStyle.Secondary)
    );

    await submission.reply({
        content: `Duplicating raid for **${timestamp ? `<t:${timestamp}:F>` : newDatetime}**.\nCopy the current roster, or start with empty slots?`,
        components: [row],
        flags: MessageFlags.Ephemeral
    });

    const choice = await submission.channel.awaitMessageComponent({
        filter: (i) => (i.customId === `raid:dupCopy:${messageId}` || i.customId === `raid:dupEmpty:${messageId}`) && i.user.id === interaction.user.id,
        time: 30000
    }).catch(() => null);

    if (!choice) {
        return submission.editReply({ content: 'Selection timed out.', components: [] });
    }

    const copyRoster = choice.customId === `raid:dupCopy:${messageId}`;
    await choice.deferUpdate();
    await submission.editReply({ content: 'Creating duplicate...', components: [] });

    return createDuplicateRaid(submission, raidData, messageId, {
        datetime: newDatetime,
        timestamp,
        copyRoster
    });
}

async function createDuplicateRaid(interaction, sourceRaidData, sourceMessageId, options) {
    const { datetime, timestamp, copyRoster } = options;
    const guild = interaction.guild;
    const raidId = generateId('', 6);

    // Determine the signup channel
    let signupChannel;
    if (sourceRaidData.type === 'museum') {
        signupChannel = await getMuseumSignupChannel(guild);
    } else if (sourceRaidData.type === 'key') {
        signupChannel = await getKeySignupChannel(guild);
    } else {
        signupChannel = await getRaidSignupChannel(guild);
    }

    if (!signupChannel) {
        return interaction.editReply({ content: 'No signup channel configured. Use `/setchannel` to set one.' });
    }

    const timestampStr = timestamp ? `<t:${timestamp}:F>` : datetime;
    let embed;
    let newRaidData;

    if (sourceRaidData.type === 'museum') {
        embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('Museum Signup')
            .setDescription('React with ✅ to reserve a slot. Max 12 players.')
            .addFields(
                { name: '\n**Date + Time:**', value: timestampStr, inline: false },
                { name: '\u200b', value: `*Raid ID: \`${raidId}\`*\nCreated by <@${interaction.user.id}>`, inline: false }
            )
            .setTimestamp(timestamp ? new Date(timestamp * 1000) : undefined);

        newRaidData = {
            raidId,
            type: 'museum',
            signups: [],
            datetime,
            timestamp,
            creatorId: interaction.user.id,
            guildId: guild.id,
            maxSlots: sourceRaidData.maxSlots || 12,
            waitlist: [],
            channelId: signupChannel.id,
            threadId: null,
            creatorReminderSent: false,
            participantReminderSent: false
        };
    } else if (sourceRaidData.type === 'key') {
        embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('Gold Key Boss')
            .setDescription('React with 🔑 to reserve a slot. Max 12 players.')
            .addFields(
                { name: '\n**Date + Time:**', value: timestampStr, inline: false },
                { name: '\u200b', value: `*Raid ID: \`${raidId}\`*\nCreated by <@${interaction.user.id}>`, inline: false }
            )
            .setTimestamp(timestamp ? new Date(timestamp * 1000) : undefined);

        newRaidData = {
            raidId,
            type: 'key',
            signups: [],
            datetime,
            timestamp,
            creatorId: interaction.user.id,
            guildId: guild.id,
            maxSlots: sourceRaidData.maxSlots || 12,
            waitlist: [],
            channelId: signupChannel.id,
            threadId: null,
            creatorReminderSent: false,
            participantReminderSent: false
        };
    } else {
        // Regular raid — use the source template
        const template = sourceRaidData.template;
        if (!template) {
            return interaction.editReply({ content: 'Could not resolve the raid template for duplication.' });
        }

        const lengthBadge = sourceRaidData.length ? `\`${sourceRaidData.length} HOUR KEY\`` : '';
        const description = template.description || '';

        embed = new EmbedBuilder()
            .setColor(template.color || '#0099ff')
            .setTitle(`${template.emoji} ${template.name}! ${template.emoji}`)
            .setDescription(description)
            .setTimestamp(timestamp ? new Date(timestamp * 1000) : undefined);

        const fields = [
            { name: '\n**Date + Time:**', value: `${timestampStr}${lengthBadge ? ` || ${lengthBadge}` : ''}`, inline: false }
        ];

        // Build role group fields from the source signups' groupName structure
        const groupedRoles = new Map();
        sourceRaidData.signups.forEach((role) => {
            const gn = role.groupName || 'Roles';
            if (!groupedRoles.has(gn)) groupedRoles.set(gn, []);
            groupedRoles.get(gn).push(role);
        });

        groupedRoles.forEach((roles, groupName) => {
            fields.push({
                name: `\n**${groupName}:**`,
                value: roles.map((role) => `${role.emoji} ${role.icon || ''} ${role.name}`).join('\n'),
                inline: false
            });
        });

        fields.push({
            name: '\u200b',
            value: `*Raid ID: \`${raidId}\`*\nCreated by <@${interaction.user.id}>`,
            inline: false
        });

        embed.setFields(fields);

        // Deep clone signups structure
        const clonedSignups = sourceRaidData.signups.map((role) => ({
            emoji: role.emoji,
            icon: role.icon,
            name: role.name,
            slots: role.slots,
            groupName: role.groupName,
            users: copyRoster ? [...role.users] : [],
            sideAssignments: copyRoster ? { ...role.sideAssignments } : {},
            waitlist: []
        }));

        newRaidData = {
            raidId,
            template,
            signups: clonedSignups,
            datetime,
            timestamp,
            length: sourceRaidData.length,
            strategy: sourceRaidData.strategy,
            creatorId: interaction.user.id,
            guildId: guild.id,
            channelId: signupChannel.id,
            threadId: null,
            creatorReminderSent: false,
            participantReminderSent: false
        };
    }

    // Send the embed to the signup channel
    const newMessage = await signupChannel.send({ embeds: [embed] });

    // Add reactions
    try {
        if (sourceRaidData.type === 'museum') {
            await newMessage.react('✅');
        } else if (sourceRaidData.type === 'key') {
            await newMessage.react('🔑');
        } else {
            for (const role of newRaidData.signups) {
                await newMessage.react(role.emoji);
            }
        }
    } catch (error) {
        console.error('Failed to add reactions to duplicated raid:', error);
    }

    // Create discussion thread if guild has threads enabled
    const settings = getGuildSettings(guild.id);
    if (settings.threadsEnabled) {
        try {
            const threadName = sourceRaidData.type === 'museum'
                ? `Museum - ${raidId}`
                : sourceRaidData.type === 'key'
                    ? `Key Boss - ${raidId}`
                    : `${sourceRaidData.template?.name || 'Raid'} - ${raidId}`;
            const thread = await newMessage.startThread({
                name: threadName,
                autoArchiveDuration: settings.threadAutoArchiveMinutes || 1440
            });
            newRaidData.threadId = thread.id;
            await thread.send(`💬 Discussion thread for **${threadName}** (ID: \`${raidId}\`)\n⏰ Time: ${timestampStr}`);
        } catch (error) {
            console.error('Failed to create thread for duplicated raid:', error);
        }
    }

    setActiveRaid(newMessage.id, newRaidData);

    // Update the embed with signup data (renders copied roster or empty slots)
    if (sourceRaidData.type === 'museum') {
        await updateMuseumEmbed(newMessage, newRaidData);
    } else if (sourceRaidData.type === 'key') {
        await updateKeyEmbed(newMessage, newRaidData);
    } else {
        await updateRaidEmbed(newMessage, newRaidData);
    }

    await updateBotPresence();

    const link = `https://discord.com/channels/${guild.id}/${signupChannel.id}/${newMessage.id}`;
    await interaction.editReply({
        content: `Raid duplicated! New raid: ${link}\nRaid ID: \`${raidId}\`${copyRoster ? ' (roster copied)' : ''}`
    });

    const sourceLink = buildMessageLink(sourceRaidData, sourceMessageId);
    await sendAuditLog(guild, `Raid ${sourceRaidData.raidId} duplicated as ${raidId}`, {
        title: 'Raid Duplicated',
        color: 0x5865F2,
        fields: [
            { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Source', value: sourceRaidData.raidId || 'Unknown', inline: true },
            { name: 'New Raid ID', value: raidId, inline: true },
            { name: 'Roster', value: copyRoster ? 'Copied' : 'Empty', inline: true },
            sourceLink ? { name: 'Source raid', value: sourceLink, inline: false } : null,
            { name: 'New raid', value: link, inline: false }
        ].filter(Boolean)
    });
}

function makePanelButton(link) {
    return {
        type: 2,
        label: 'View panel',
        style: 5,
        url: link
    };
}
