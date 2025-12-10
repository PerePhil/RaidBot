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
    createRecurringRaid,
    updateRecurringRaid,
    deleteRecurringRaid,
    toggleRecurringRaid,
    getRecurringRaid,
    getGuildRecurringRaids,
    formatScheduleDescription,
    spawnRaidFromRecurring
} = require('../recurringManager');

const { templatesForGuild } = require('../templatesManager');
const { raidChannels, museumChannels } = require('../state');
const chrono = require('chrono-node');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Parse day of week from string input
 * Accepts: day names (Monday), abbreviations (Mon), numbers (1)
 * Returns: 0-6 (Sunday-Saturday) or null if not recognized
 */
function parseDayOfWeek(input) {
    if (!input) return null;
    const lower = input.toLowerCase().trim();

    // Try number first
    const num = parseInt(lower, 10);
    if (!isNaN(num) && num >= 0 && num <= 6) return num;

    // Try day name or abbreviation
    const dayMap = {
        'sunday': 0, 'sun': 0, 'su': 0,
        'monday': 1, 'mon': 1, 'mo': 1,
        'tuesday': 2, 'tue': 2, 'tu': 2,
        'wednesday': 3, 'wed': 3, 'we': 3,
        'thursday': 4, 'thu': 4, 'th': 4,
        'friday': 5, 'fri': 5, 'fr': 5,
        'saturday': 6, 'sat': 6, 'sa': 6
    };

    return dayMap[lower] ?? null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('recurring')
        .setDescription('Manage recurring raid schedules')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('What to do')
                .setRequired(true)
                .addChoices(
                    { name: 'create', value: 'create' },
                    { name: 'list', value: 'list' },
                    { name: 'delete', value: 'delete' },
                    { name: 'toggle', value: 'toggle' },
                    { name: 'trigger', value: 'trigger' }
                ))
        .addStringOption(option =>
            option.setName('id')
                .setDescription('Recurring raid ID (required for delete/toggle/trigger)')
                .setRequired(false)),
    requiresManageGuild: true,

    async execute(interaction) {
        const action = interaction.options.getString('action');
        const id = interaction.options.getString('id');

        if (action === 'create') {
            return startCreateFlow(interaction);
        } else if (action === 'list') {
            return listRecurring(interaction);
        } else if (action === 'delete') {
            return handleDelete(interaction, id);
        } else if (action === 'toggle') {
            return handleToggle(interaction, id);
        } else if (action === 'trigger') {
            return handleTrigger(interaction, id);
        }

        return interaction.reply({
            content: 'Unknown action.',
            flags: MessageFlags.Ephemeral
        });
    }
};

// State for create flow
const createStates = new Map();

async function startCreateFlow(interaction) {
    const guildId = interaction.guildId;
    const templates = templatesForGuild(guildId);

    // Add museum option
    const templateOptions = [
        { label: 'Museum Signup', value: 'museum', emoji: '🏛️' },
        ...templates.slice(0, 24).map(t => ({
            label: t.name,
            value: t.slug || t.id,
            emoji: t.emoji || undefined
        }))
    ];

    const state = {
        step: 'template',
        guildId,
        creatorId: interaction.user.id
    };
    createStates.set(interaction.user.id, state);

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('recurring_template')
            .setPlaceholder('Select raid type')
            .addOptions(templateOptions)
    );

    await interaction.reply({
        content: '**Create Recurring Raid** (Step 1/5)\nSelect the raid template:',
        components: [row],
        flags: MessageFlags.Ephemeral
    });

    // Set up collector
    const collector = interaction.channel.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id && i.customId.startsWith('recurring_'),
        time: 300000
    });

    collector.on('collect', async i => {
        try {
            await handleCreateStep(i, state, collector);
        } catch (error) {
            console.error('Error in recurring create flow:', error);
            await i.reply({ content: 'An error occurred. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => { });
        }
    });

    collector.on('end', (_, reason) => {
        createStates.delete(interaction.user.id);
        if (reason === 'time') {
            interaction.editReply({ content: 'Recurring raid creation timed out.', components: [] }).catch(() => { });
        }
    });
}

async function handleCreateStep(interaction, state, collector) {
    if (interaction.customId === 'recurring_template') {
        state.templateSlug = interaction.values[0];
        state.step = 'schedule_type';

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('recurring_schedule_type')
                .setPlaceholder('Select schedule type')
                .addOptions([
                    { label: 'Weekly', value: 'weekly', description: 'Same day each week', emoji: '📅' },
                    { label: 'Daily', value: 'daily', description: 'Every day at the same time', emoji: '🌅' },
                    { label: 'Custom Interval', value: 'interval', description: 'Every N hours', emoji: '⏱️' }
                ])
        );

        await interaction.update({
            content: '**Create Recurring Raid** (Step 2/5)\nHow often should this raid run?',
            components: [row]
        });
    }
    else if (interaction.customId === 'recurring_schedule_type') {
        state.scheduleType = interaction.values[0];
        state.step = 'schedule_details';

        if (state.scheduleType === 'weekly') {
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('recurring_day')
                    .setPlaceholder('Select day of week')
                    .addOptions(DAYS.map((d, i) => ({ label: d, value: i.toString() })))
            );
            await interaction.update({
                content: '**Create Recurring Raid** (Step 3/5)\nWhich day of the week?',
                components: [row]
            });
        } else if (state.scheduleType === 'daily') {
            // Skip day selection, go to time
            await showTimeModal(interaction, state, collector);
        } else if (state.scheduleType === 'interval') {
            await showIntervalModal(interaction, state, collector);
        }
    }
    else if (interaction.customId === 'recurring_day') {
        state.dayOfWeek = parseInt(interaction.values[0], 10);
        await showTimeModal(interaction, state, collector);
    }
    else if (interaction.customId === 'recurring_spawn_option') {
        if (interaction.values[0] === 'custom') {
            await showSpawnModal(interaction, state, collector);
        } else {
            // No custom spawn, go to copy participants
            await showCopyOption(interaction, state, collector);
        }
    }
    else if (interaction.customId === 'recurring_copy') {
        state.copyParticipants = interaction.values[0] === 'yes';
        await finishCreate(interaction, state, collector);
    }
}

async function showTimeModal(interaction, state, collector) {
    const modal = new ModalBuilder()
        .setCustomId('recurring_time_modal')
        .setTitle('Raid Time')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('time')
                    .setLabel('Time (e.g., 7pm, 7:00 PM, 19:00)')
                    .setPlaceholder('7pm')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('timezone')
                    .setLabel('Timezone (e.g., America/New_York)')
                    .setPlaceholder('America/New_York')
                    .setValue('America/New_York')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            )
        );

    await interaction.showModal(modal);

    try {
        const modalSubmit = await interaction.awaitModalSubmit({
            filter: i => i.customId === 'recurring_time_modal' && i.user.id === interaction.user.id,
            time: 120000
        });

        state.timeOfDay = modalSubmit.fields.getTextInputValue('time') || '19:00';
        state.timezone = modalSubmit.fields.getTextInputValue('timezone') || 'America/New_York';

        // Ask about custom spawn schedule
        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('recurring_spawn_option')
                .setPlaceholder('When should signups spawn?')
                .addOptions([
                    { label: 'At raid time', value: 'raid_time', description: 'Signup appears when raid starts' },
                    { label: 'Custom time', value: 'custom', description: 'Set a specific day/time for signups' }
                ])
        );

        await modalSubmit.reply({
            content: '**Create Recurring Raid** (Step 4/6)\\nWhen should the signup message appear?',
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        if (error.code !== 'InteractionCollectorError') {
            console.error('Modal error:', error);
        }
    }
}

async function showSpawnModal(interaction, state, collector) {
    const modal = new ModalBuilder()
        .setCustomId('recurring_spawn_modal')
        .setTitle('Spawn Schedule')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('spawn_day')
                    .setLabel('Spawn day (e.g., Monday, Friday)')
                    .setPlaceholder('Monday')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('spawn_time')
                    .setLabel('Spawn time (e.g., 10am, 10:00)')
                    .setPlaceholder('10am')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );

    await interaction.showModal(modal);

    try {
        const modalSubmit = await interaction.awaitModalSubmit({
            filter: i => i.customId === 'recurring_spawn_modal' && i.user.id === interaction.user.id,
            time: 120000
        });

        const spawnDayInput = modalSubmit.fields.getTextInputValue('spawn_day');
        const spawnTimeInput = modalSubmit.fields.getTextInputValue('spawn_time') || '10:00';

        // Parse day using chrono-node or day name matching
        let spawnDay = parseDayOfWeek(spawnDayInput);
        if (spawnDay === null) {
            // Try chrono-node for natural language
            const parsed = chrono.parseDate(spawnDayInput + ' at noon');
            if (parsed) {
                spawnDay = parsed.getDay();
            } else {
                spawnDay = 1; // Default Monday
            }
        }

        state.spawnDayOfWeek = spawnDay;
        state.spawnTimeOfDay = spawnTimeInput;

        await showCopyOption(modalSubmit, state, collector);
    } catch (error) {
        if (error.code !== 'InteractionCollectorError') {
            console.error('Modal error:', error);
        }
    }
}

async function showCopyOption(interaction, state, collector) {
    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('recurring_copy')
            .setPlaceholder('Copy participants?')
            .addOptions([
                { label: 'Yes', value: 'yes', description: 'Pre-register participants from previous instance' },
                { label: 'No', value: 'no', description: 'Start with empty signups each time' }
            ])
    );

    // Handle both update and reply depending on interaction type
    const replyFn = interaction.replied || interaction.deferred ? 'followUp' : 'reply';
    await interaction[replyFn]({
        content: '**Create Recurring Raid** (Step 6/6)\\nCopy participants from previous instance?',
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

async function showIntervalModal(interaction, state, collector) {
    const modal = new ModalBuilder()
        .setCustomId('recurring_interval_modal')
        .setTitle('Interval Schedule')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('hours')
                    .setLabel('Hours between raids')
                    .setPlaceholder('24')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );

    await interaction.showModal(modal);

    try {
        const modalSubmit = await interaction.awaitModalSubmit({
            filter: i => i.customId === 'recurring_interval_modal' && i.user.id === interaction.user.id,
            time: 120000
        });

        state.intervalHours = parseInt(modalSubmit.fields.getTextInputValue('hours'), 10) || 24;

        // Show copy participants option
        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('recurring_copy')
                .setPlaceholder('Copy participants?')
                .addOptions([
                    { label: 'Yes', value: 'yes', description: 'Pre-register participants from previous instance' },
                    { label: 'No', value: 'no', description: 'Start with empty signups each time' }
                ])
        );

        await modalSubmit.reply({
            content: '**Create Recurring Raid** (Step 5/5)\nCopy participants from previous instance?',
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        if (error.code !== 'InteractionCollectorError') {
            console.error('Modal error:', error);
        }
    }
}

async function finishCreate(interaction, state, collector) {
    collector.stop('completed');

    // Get template data if custom
    const templates = templatesForGuild(state.guildId);
    const template = templates.find(t => t.slug === state.templateSlug || t.id === state.templateSlug);

    const recurring = createRecurringRaid({
        guildId: state.guildId,
        channelId: null, // Use default channel
        templateSlug: state.templateSlug,
        templateData: template || null,
        scheduleType: state.scheduleType,
        dayOfWeek: state.dayOfWeek,
        timeOfDay: state.timeOfDay,
        intervalHours: state.intervalHours,
        timezone: state.timezone || 'America/New_York',
        copyParticipants: state.copyParticipants,
        advanceHours: 0,
        spawnDayOfWeek: state.spawnDayOfWeek,       // Custom spawn day (null = same as raid)
        spawnTimeOfDay: state.spawnTimeOfDay,       // Custom spawn time (null = same as raid)
        creatorId: state.creatorId
    });

    const scheduleDesc = formatScheduleDescription(recurring);
    const templateName = template?.name || (state.templateSlug === 'museum' ? 'Museum Signup' : state.templateSlug);

    const embed = new EmbedBuilder()
        .setTitle('✅ Recurring Raid Created')
        .setColor(0x00FF00)
        .addFields(
            { name: 'Template', value: templateName, inline: true },
            { name: 'Schedule', value: scheduleDesc, inline: true },
            { name: 'Copy Participants', value: state.copyParticipants ? 'Yes' : 'No', inline: true },
            { name: 'ID', value: `\`${recurring.id}\``, inline: true },
            { name: 'Next Spawn', value: `<t:${recurring.nextScheduledAt}:R>`, inline: true }
        )
        .setFooter({ text: 'Use /recurring action:list to see all schedules' });

    await interaction.update({
        content: null,
        embeds: [embed],
        components: []
    });
}

async function listRecurring(interaction) {
    const guildId = interaction.guildId;
    const recurring = getGuildRecurringRaids(guildId);

    if (recurring.length === 0) {
        return interaction.reply({
            content: 'No recurring raids configured. Use `/recurring action:create` to set one up.',
            flags: MessageFlags.Ephemeral
        });
    }

    const templates = templatesForGuild(guildId);

    const fields = recurring.map(r => {
        const template = templates.find(t => t.slug === r.templateSlug || t.id === r.templateSlug);
        const name = template?.name || (r.templateSlug === 'museum' ? 'Museum' : r.templateSlug);
        const status = r.enabled ? '🟢' : '🔴';
        const schedule = formatScheduleDescription(r);

        return {
            name: `${status} ${name}`,
            value: `ID: \`${r.id}\`\n${schedule}\nNext: <t:${r.nextScheduledAt}:R>`,
            inline: true
        };
    });

    const embed = new EmbedBuilder()
        .setTitle('📅 Recurring Raids')
        .setColor(0x5865F2)
        .addFields(fields)
        .setFooter({ text: 'Use /recurring action:toggle id:<id> to enable/disable' });

    await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
    });
}

async function handleDelete(interaction, id) {
    if (!id) {
        return interaction.reply({
            content: 'Please provide an ID when using `action: delete`. Use `/recurring action:list` to see available IDs.',
            flags: MessageFlags.Ephemeral
        });
    }

    const guildId = interaction.guildId;
    const recurring = getRecurringRaid(id);

    if (!recurring || recurring.guildId !== guildId) {
        return interaction.reply({
            content: `Recurring raid \`${id}\` not found. Use \`/recurring action:list\` to see available IDs.`,
            flags: MessageFlags.Ephemeral
        });
    }

    deleteRecurringRaid(id);

    await interaction.reply({
        content: `✅ Deleted recurring raid \`${id}\`.`,
        flags: MessageFlags.Ephemeral
    });
}

async function handleToggle(interaction, id) {
    if (!id) {
        return interaction.reply({
            content: 'Please provide an ID when using `action: toggle`. Use `/recurring action:list` to see available IDs.',
            flags: MessageFlags.Ephemeral
        });
    }

    const guildId = interaction.guildId;
    const recurring = getRecurringRaid(id);

    if (!recurring || recurring.guildId !== guildId) {
        return interaction.reply({
            content: `Recurring raid \`${id}\` not found. Use \`/recurring action:list\` to see available IDs.`,
            flags: MessageFlags.Ephemeral
        });
    }

    const newState = !recurring.enabled;
    toggleRecurringRaid(id, newState);

    const status = newState ? '🟢 Enabled' : '🔴 Disabled';
    await interaction.reply({
        content: `${status} recurring raid \`${id}\`.`,
        flags: MessageFlags.Ephemeral
    });
}

async function handleTrigger(interaction, id) {
    if (!id) {
        return interaction.reply({
            content: 'Please provide an ID when using `action: trigger`. Use `/recurring action:list` to see available IDs.',
            flags: MessageFlags.Ephemeral
        });
    }

    const guildId = interaction.guildId;
    const recurring = getRecurringRaid(id);

    if (!recurring || recurring.guildId !== guildId) {
        return interaction.reply({
            content: `Recurring raid \`${id}\` not found. Use \`/recurring action:list\` to see available IDs.`,
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const result = await spawnRaidFromRecurring(interaction.client, recurring);
        if (result) {
            await interaction.editReply({
                content: `✅ Manually spawned raid **${result.raidData.raidId}** from recurring \`${id}\`.`
            });
        } else {
            await interaction.editReply({
                content: '❌ Failed to spawn raid. Check that the channel is configured.'
            });
        }
    } catch (error) {
        console.error('Failed to trigger recurring raid:', error);
        await interaction.editReply({
            content: '❌ Failed to spawn raid: ' + error.message
        });
    }
}
