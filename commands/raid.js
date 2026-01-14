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
    parseDateTimeToTimestamp
} = require('../utils/raidHelpers');
const { buildMessageLink } = require('../utils/raidFormatters');
const { updateBotPresence } = require('../presence');
const { activeRaids, deleteActiveRaid, markActiveRaidUpdated, recordNoShow, clearNoShow, guildParticipation } = require('../state');
const { sendAuditLog } = require('../auditLog');
const { usersAvailableAt } = require('../availabilityManager');

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
        components: [buttons]
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
            return i.reply({ content: 'Unsupported action.', flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('Collector handler error:', error);
            collector.stop('error');
            throw error;
        }
    });

    collector.on('end', async () => {
        const disabledRow = new ActionRowBuilder().addComponents(
            ...buttons.components.map((btn) => ButtonBuilder.from(btn.data).setDisabled(true))
        );
        await replyMessage.edit({ components: [disabledRow] }).catch(() => { });
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
            .setDisabled(isMuseumOrKey) // Disabled for museum/key (no roles)
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
                new ButtonBuilder().setCustomId('raid:findsub:disabled').setLabel('Find Sub').setEmoji('🔍').setStyle(ButtonStyle.Primary).setDisabled(true)
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

function makePanelButton(link) {
    return {
        type: 2,
        label: 'View panel',
        style: 5,
        url: link
    };
}
