const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
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
const { activeRaids, deleteActiveRaid, markActiveRaidUpdated } = require('../state');
const { sendAuditLog } = require('../auditLog');

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
        return i.reply({ content: 'Unsupported action.', flags: MessageFlags.Ephemeral });
    });

    collector.on('end', async () => {
        const disabledRow = new ActionRowBuilder().addComponents(
            ButtonBuilder.from(buttons.components[0].data).setDisabled(true),
            ButtonBuilder.from(buttons.components[1].data).setDisabled(true),
            ButtonBuilder.from(buttons.components[2].data).setDisabled(true),
            ButtonBuilder.from(buttons.components[3].data).setDisabled(true)
        );
        await replyMessage.edit({ components: [disabledRow] }).catch(() => {});
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
    return new ActionRowBuilder().addComponents(
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
            .setStyle(ButtonStyle.Primary)
    );
}

async function refreshPanel(interaction, raidData, messageId) {
    try {
        const embed = buildPanelEmbed(raidData.raidId, raidData, messageId);
        const components = [buildPanelComponents(messageId, raidData)];
        if (interaction.message) {
            await interaction.message.edit({ embeds: [embed], components }).catch(() => {});
        } else {
            await interaction.editReply({ embeds: [embed], components }).catch(() => {});
        }
    } catch (error) {
        console.error('Failed to refresh raid panel:', error);
    }
}

async function disablePanel(interaction) {
    try {
        if (interaction.message) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('raid:close:disabled').setLabel('Close').setStyle(ButtonStyle.Danger).setDisabled(true),
                new ButtonBuilder().setCustomId('raid:reopen:disabled').setLabel('Reopen').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId('raid:delete:disabled').setLabel('Delete').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('raid:time:disabled').setLabel('Change Time').setStyle(ButtonStyle.Primary).setDisabled(true)
            );
            await interaction.message.edit({ components: [row] }).catch(() => {});
        } else {
            await interaction.editReply({ components: [] }).catch(() => {});
        }
    } catch (error) {
        console.error('Failed to disable raid panel:', error);
    }
}

function makePanelButton(link) {
    return {
        type: 2,
        label: 'View panel',
        style: 5,
        url: link
    };
}
