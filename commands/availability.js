const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, MessageFlags, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const {
    setAvailability,
    getAvailability,
    getGuildAvailability,
    getAvailabilityHeatmap,
    findOptimalTimes,
    parseTimezone
} = require('../availabilityManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('availability')
        .setDescription('Record your availability or view server-wide availability data')
        .addSubcommand((sub) =>
            sub.setName('set')
                .setDescription('Set your availability (opens a form)'))
        .addSubcommand((sub) =>
            sub.setName('view')
                .setDescription('View availability for a user')
                .addUserOption((opt) =>
                    opt.setName('user')
                        .setDescription('User to view (defaults to you)')
                        .setRequired(false)))
        .addSubcommand((sub) =>
            sub.setName('summary')
                .setDescription('View server-wide availability breakdown'))
        .addSubcommand((sub) =>
            sub.setName('optimal')
                .setDescription('Find times when the most users are available')
                .addIntegerOption((opt) =>
                    opt.setName('min_users')
                        .setDescription('Minimum number of available users')
                        .setMinValue(1)
                        .setMaxValue(100)
                        .setRequired(false)))
        .addSubcommand((sub) =>
            sub.setName('post-button')
                .setDescription('Post a persistent "Set Availability" button in this channel (Admin only)')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'set':
                return handleSet(interaction);
            case 'view':
                return handleView(interaction);
            case 'summary':
                return handleSummary(interaction);
            case 'optimal':
                return handleOptimal(interaction);
            case 'post-button':
                return handlePostButton(interaction);
            default:
                return interaction.reply({ content: 'Unknown subcommand.', flags: MessageFlags.Ephemeral });
        }
    }
};

async function handleSet(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('availability:set')
        .setTitle('Set your availability')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('timezone')
                    .setLabel('Timezone')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('EST, PST, UTC-5, GMT+1, etc.')
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('days')
                    .setLabel('Preferred days/times')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Mon-Fri 7-10pm, Weekends 12-6pm')
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('roles')
                    .setLabel('Preferred roles')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Vanguard, Support, Surge, Gates, Flex')
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('notes')
                    .setLabel('Notes')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Any other scheduling notes or constraints?')
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

async function handleView(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const existing = getAvailability(interaction.guildId, target.id);

    if (!existing) {
        return interaction.reply({
            content: `${target.id === interaction.user.id ? 'You have' : `${target.username} has`} not recorded availability. Use \`/availability set\` to record yours.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Get viewer's timezone for display conversion
    const viewerData = getAvailability(interaction.guildId, interaction.user.id);
    const viewerTz = viewerData?.timezone || existing.timezone || null;
    const viewerOffset = parseTimezone(viewerTz);
    const tzLabel = viewerTz || 'UTC';

    const embed = new EmbedBuilder()
        .setTitle(`${target.username}'s Availability`)
        .setColor(0x3498db)
        .addFields(
            { name: 'Timezone', value: existing.timezone || '—', inline: true },
            { name: 'Preferred Days', value: existing.days || '—', inline: true },
            { name: 'Preferred Roles', value: existing.roles || '—', inline: true },
            { name: 'Notes', value: existing.notes || '—', inline: false }
        );

    // Show parsed windows if any, converted to viewer's timezone
    if (existing.windows && existing.windows.length > 0) {
        const windowStr = existing.windows
            .slice(0, 5)
            .map(w => {
                const localStart = convertUtcToLocal(w.start, viewerOffset);
                const localEnd = convertUtcToLocal(w.end, viewerOffset);
                return `${getDayName(w.day)} ${formatMinutes(localStart)}-${formatMinutes(localEnd)}`;
            })
            .join('\n');
        embed.addFields({ name: `Parsed Time Windows (${tzLabel})`, value: windowStr, inline: false });
    }

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleSummary(interaction) {
    const entries = getGuildAvailability(interaction.guildId);

    if (entries.length === 0) {
        return interaction.reply({
            content: 'No availability data recorded yet. Have members use `/availability set` first.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Get viewer's timezone for display conversion
    const viewerData = getAvailability(interaction.guildId, interaction.user.id);
    const viewerTz = viewerData?.timezone || null;
    const viewerOffset = parseTimezone(viewerTz);
    const tzLabel = viewerTz || 'UTC';

    const heatmap = getAvailabilityHeatmap(interaction.guildId);
    const top = heatmap.slice(0, 15);

    const embed = new EmbedBuilder()
        .setTitle('Server Availability Summary')
        .setColor(0x2ecc71)
        .setDescription(`**${entries.length} members** have recorded their availability.\nTimes shown in **${tzLabel}**`);

    // Build heatmap visualization
    if (top.length > 0) {
        let heatmapStr = '```\n';
        heatmapStr += 'Day       Time      Users\n';
        heatmapStr += '─────────────────────────\n';

        top.forEach(slot => {
            const dayName = getDayName(slot.day).padEnd(9);
            // Convert UTC hour to local timezone
            const localHour = convertUtcHourToLocal(slot.hour, viewerOffset);
            const timeStr = formatHour(localHour).padEnd(9);
            const bar = '█'.repeat(Math.min(slot.count, 15));
            heatmapStr += `${dayName} ${timeStr} ${bar} ${slot.count}\n`;
        });

        heatmapStr += '```';
        embed.addFields({ name: 'Hottest Time Slots', value: heatmapStr, inline: false });
    }

    // Top optimal slots
    const optimal = findOptimalTimes(interaction.guildId, { limit: 5 });
    if (optimal.length > 0) {
        const optimalStr = optimal
            .map((slot, i) => {
                const localHour = convertUtcHourToLocal(slot.hour, viewerOffset);
                return `${i + 1}. **${slot.dayName} ${formatHour(localHour)}** — ${slot.availableUsers} available`;
            })
            .join('\n');
        embed.addFields({ name: 'Best Times for Raids', value: optimalStr, inline: false });
    }

    embed.setFooter({ text: 'Use /availability optimal for more options' });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleOptimal(interaction) {
    const minUsers = interaction.options.getInteger('min_users') || 1;
    const entries = getGuildAvailability(interaction.guildId);

    if (entries.length === 0) {
        return interaction.reply({
            content: 'No availability data recorded yet. Have members use `/availability set` first.',
            flags: MessageFlags.Ephemeral
        });
    }

    const optimal = findOptimalTimes(interaction.guildId, { minUsers, limit: 20 });

    if (optimal.length === 0) {
        return interaction.reply({
            content: `No time slots found with at least ${minUsers} available users. Try lowering the minimum.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Get viewer's timezone for display conversion
    const viewerData = getAvailability(interaction.guildId, interaction.user.id);
    const viewerTz = viewerData?.timezone || null;
    const viewerOffset = parseTimezone(viewerTz);
    const tzLabel = viewerTz || 'UTC';

    const embed = new EmbedBuilder()
        .setTitle(`Optimal Times (${minUsers}+ users)`)
        .setDescription(`Times shown in **${tzLabel}**`)
        .setColor(0x9b59b6);

    // Group by day
    const byDay = {};
    optimal.forEach(slot => {
        if (!byDay[slot.day]) byDay[slot.day] = [];
        byDay[slot.day].push(slot);
    });

    Object.entries(byDay).forEach(([day, slots]) => {
        const dayName = getDayName(parseInt(day));
        const slotsStr = slots
            .map(s => {
                const localHour = convertUtcHourToLocal(s.hour, viewerOffset);
                return `${formatHour(localHour)} (${s.availableUsers} users)`;
            })
            .join(', ');
        embed.addFields({ name: dayName, value: slotsStr, inline: false });
    });

    embed.setFooter({ text: `Based on ${entries.length} member availability records` });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handlePostButton(interaction) {
    // Check for admin/manage server permissions
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
            content: 'You need the "Manage Server" permission to post the availability button.',
            flags: MessageFlags.Ephemeral
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('Set Your Availability')
        .setDescription(
            'Click the button below to set your availability for raids and events.\n\n' +
            '**Your availability helps leadership schedule events** at times when the most members can participate.\n\n' +
            '**What you can specify:**\n' +
            '• **Timezone** — EST, PST, UTC-5, GMT+1, etc.\n' +
            '• **Preferred Days/Times** — When you\'re typically free\n' +
            '• **Preferred Roles** — What roles you like to play\n' +
            '• **Notes** — Any other scheduling constraints\n\n' +
            '**Example availability formats:**\n' +
            '```\n' +
            'Mon-Fri 7-10pm\n' +
            'Weekends 6-11pm\n' +
            'Sat 2pm-6pm, Sun afternoons\n' +
            'Weekdays evenings\n' +
            'Everyday after 5pm\n' +
            '```'
        )
        .setColor(0x3498db);

    const button = new ButtonBuilder()
        .setCustomId('availability:set:button')
        .setLabel('Set Availability')
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    // Post the message publicly in the channel
    await interaction.channel.send({ embeds: [embed], components: [row] });

    return interaction.reply({
        content: 'Availability button posted successfully.',
        flags: MessageFlags.Ephemeral
    });
}

// Helper functions
function getDayName(day) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[day] || 'Unknown';
}

function formatHour(hour) {
    if (hour === 0) return '12 AM';
    if (hour === 12) return '12 PM';
    if (hour < 12) return `${hour} AM`;
    return `${hour - 12} PM`;
}

function formatMinutes(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${displayHour}:${mins.toString().padStart(2, '0')} ${period}`;
}

/**
 * Convert UTC minutes to local timezone minutes
 * @param {number} utcMinutes - Minutes since midnight in UTC
 * @param {number|null} tzOffset - Timezone offset in minutes (e.g., -300 for EST)
 * @returns {number} - Minutes since midnight in local timezone
 */
function convertUtcToLocal(utcMinutes, tzOffset) {
    if (tzOffset === null || tzOffset === undefined) {
        return utcMinutes; // No conversion if no timezone
    }
    // Add the offset back (we subtracted it when storing)
    return (utcMinutes + tzOffset + 24 * 60) % (24 * 60);
}

/**
 * Convert UTC hour to local timezone hour
 * @param {number} utcHour - Hour of day in UTC (0-23)
 * @param {number|null} tzOffset - Timezone offset in minutes (e.g., -300 for EST)
 * @returns {number} - Hour of day in local timezone (0-23)
 */
function convertUtcHourToLocal(utcHour, tzOffset) {
    if (tzOffset === null || tzOffset === undefined) {
        return utcHour; // No conversion if no timezone
    }
    const utcMinutes = utcHour * 60;
    const localMinutes = (utcMinutes + tzOffset + 24 * 60) % (24 * 60);
    return Math.floor(localMinutes / 60);
}
