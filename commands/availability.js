const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, MessageFlags, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const {
    setAvailability,
    getAvailability,
    deleteAvailability,
    getGuildAvailability,
    getAvailabilityHeatmap,
    findOptimalTimes,
    parseTimezone,
    usersAvailableAt
} = require('../availabilityManager');
const { sendAuditLog } = require('../auditLog');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('availability')
        .setDescription('Record your availability or view server-wide availability data')
        .addSubcommand((sub) =>
            sub.setName('set')
                .setDescription('Set your availability (opens a form)')
                .addUserOption((opt) =>
                    opt.setName('user')
                        .setDescription('User to set availability for (Admin only, defaults to you)')
                        .setRequired(false)))
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
            sub.setName('check')
                .setDescription('Check who is available at a specific time')
                .addStringOption((opt) =>
                    opt.setName('time')
                        .setDescription('Time to check (e.g., "Saturday 7pm", "tomorrow 8pm", or a timestamp)')
                        .setRequired(true)))
        .addSubcommand((sub) =>
            sub.setName('clear')
                .setDescription('Clear your availability data')
                .addUserOption((opt) =>
                    opt.setName('user')
                        .setDescription('User to clear availability for (Admin only)')
                        .setRequired(false)))
        .addSubcommand((sub) =>
            sub.setName('post-button')
                .setDescription('Post a persistent "Set Availability" button in this channel (Admin only)'))
        .addSubcommand((sub) =>
            sub.setName('list')
                .setDescription('View all members who have set their availability')),

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
            case 'check':
                return handleCheck(interaction);
            case 'clear':
                return handleClear(interaction);
            case 'post-button':
                return handlePostButton(interaction);
            case 'list':
                return handleList(interaction);
            default:
                return interaction.reply({ content: 'Unknown subcommand.', flags: MessageFlags.Ephemeral });
        }
    }
};

async function handleSet(interaction) {
    const targetUser = interaction.options.getUser('user');
    const isSettingForOther = targetUser && targetUser.id !== interaction.user.id;

    // Check admin permission if setting for another user
    if (isSettingForOther && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
            content: 'You need the "Manage Server" permission to set availability for other users.',
            flags: MessageFlags.Ephemeral
        });
    }

    const targetId = targetUser?.id || interaction.user.id;
    const targetName = targetUser?.username || interaction.user.username;

    const modal = new ModalBuilder()
        .setCustomId('availability:set')
        .setTitle(isSettingForOther ? `Set availability for ${targetName}` : 'Set your availability')
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
    setAvailability(interaction.guildId, targetId, data);

    // Get the saved data to show parsed windows
    const saved = getAvailability(interaction.guildId, targetId);

    // Build confirmation message with parsed windows
    let response = isSettingForOther
        ? `Availability saved for ${targetName}.`
        : 'Availability saved.';

    if (saved?.windows && saved.windows.length > 0) {
        const tzLabel = saved.timezone || 'UTC';
        const viewerOffset = parseTimezone(saved.timezone);
        const windowStr = saved.windows
            .slice(0, 5)
            .map(w => {
                const localStart = convertUtcToLocal(w.start, viewerOffset);
                const localEnd = convertUtcToLocal(w.end, viewerOffset);
                return `• ${getDayName(w.day)} ${formatMinutes(localStart)}-${formatMinutes(localEnd)}`;
            })
            .join('\n');
        response += `\n\n**Parsed time windows (${tzLabel}):**\n${windowStr}`;
        if (saved.windows.length > 5) {
            response += `\n_(+${saved.windows.length - 5} more)_`;
        }
    } else if (data.days) {
        response += '\n\n_Could not parse time windows from your input. Use formats like "Mon-Fri 7-10pm" or "Weekends evenings"._';

        // Notify admins via audit log about parse failure
        try {
            const guild = interaction.guild;
            if (guild) {
                sendAuditLog(guild, null, {
                    title: 'Availability Parse Failure',
                    color: 0xf39c12,
                    fields: [
                        { name: 'User', value: `<@${targetId}> (${targetName})`, inline: true },
                        { name: 'Timezone', value: data.timezone || 'Not set', inline: true },
                        { name: 'Input', value: `\`\`\`${data.days}\`\`\``, inline: false }
                    ],
                    footer: { text: 'Use /availability set user:@user to fix this' }
                });
            }
        } catch (err) {
            console.error('Failed to send parse failure audit log:', err);
        }
    }

    return submission.reply({ content: response, flags: MessageFlags.Ephemeral });
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

async function handleCheck(interaction) {
    const timeInput = interaction.options.getString('time');
    const chrono = require('chrono-node');

    // Parse the time input
    let timestamp;

    // Check if it's a Unix timestamp
    if (/^\d{10,13}$/.test(timeInput)) {
        timestamp = timeInput.length === 13
            ? Math.floor(parseInt(timeInput) / 1000)
            : parseInt(timeInput);
    } else {
        // Use chrono to parse natural language
        const parsed = chrono.parseDate(timeInput, new Date(), { forwardDate: true });
        if (!parsed) {
            return interaction.reply({
                content: `Could not parse "${timeInput}" as a time. Try formats like "Saturday 7pm", "tomorrow 8pm", or a Unix timestamp.`,
                flags: MessageFlags.Ephemeral
            });
        }
        timestamp = Math.floor(parsed.getTime() / 1000);
    }

    // Get users available at this time
    const availableUserIds = usersAvailableAt(interaction.guildId, timestamp);

    // Format the time for display
    const dateObj = new Date(timestamp * 1000);
    const timeStr = dateObj.toLocaleString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
    });

    const embed = new EmbedBuilder()
        .setTitle('Availability Check')
        .setColor(availableUserIds.length > 0 ? 0x2ecc71 : 0xe74c3c);

    if (availableUserIds.length === 0) {
        embed.setDescription(`**Time:** ${timeStr}\n\nNo members have recorded availability for this time.`);
    } else {
        // Fetch member info for display
        const memberMentions = [];
        for (const userId of availableUserIds.slice(0, 25)) { // Limit to 25 to avoid embed limits
            try {
                const member = await interaction.guild.members.fetch(userId).catch(() => null);
                if (member) {
                    memberMentions.push(`<@${userId}>`);
                }
            } catch {
                memberMentions.push(`<@${userId}>`);
            }
        }

        const moreCount = availableUserIds.length > 25 ? ` (+${availableUserIds.length - 25} more)` : '';

        embed.setDescription(
            `**Time:** ${timeStr}\n\n` +
            `**${availableUserIds.length} member${availableUserIds.length === 1 ? '' : 's'} available:**\n` +
            memberMentions.join(', ') + moreCount
        );
    }

    embed.setFooter({ text: 'Based on recorded availability windows' });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleClear(interaction) {
    const targetUser = interaction.options.getUser('user');
    const isClearingOther = targetUser && targetUser.id !== interaction.user.id;

    // Check admin permission if clearing for another user
    if (isClearingOther && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
            content: 'You need the "Manage Server" permission to clear availability for other users.',
            flags: MessageFlags.Ephemeral
        });
    }

    const targetId = targetUser?.id || interaction.user.id;
    const targetName = targetUser?.username || interaction.user.username;

    // Check if they have availability data
    const existing = getAvailability(interaction.guildId, targetId);
    if (!existing) {
        return interaction.reply({
            content: isClearingOther
                ? `${targetName} has no availability data to clear.`
                : 'You have no availability data to clear.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Delete the availability
    deleteAvailability(interaction.guildId, targetId);

    return interaction.reply({
        content: isClearingOther
            ? `Cleared availability data for ${targetName}.`
            : 'Your availability data has been cleared.',
        flags: MessageFlags.Ephemeral
    });
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

async function handleList(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const entries = getGuildAvailability(interaction.guildId);

    if (entries.length === 0) {
        return interaction.editReply({
            content: 'No members have set their availability yet. Use `/availability set` or `/availability post-button` to get started.'
        });
    }

    // Fetch member info for all users
    const memberList = [];
    for (const entry of entries) {
        let displayName = `<@${entry.userId}>`;
        try {
            const member = await interaction.guild.members.fetch(entry.userId).catch(() => null);
            if (member) {
                displayName = member.displayName;
            }
        } catch {
            // Keep the mention format if fetch fails
        }

        // Check if parsing failed (has days input but no windows)
        const parseFailed = entry.days && (!entry.windows || entry.windows.length === 0);
        const status = parseFailed ? '⚠️' : '✓';

        memberList.push({
            displayName,
            userId: entry.userId,
            timezone: entry.timezone || '—',
            days: entry.days || '—',
            roles: entry.roles || '—',
            parseFailed,
            status
        });
    }

    // Sort: parse failures first, then alphabetically
    memberList.sort((a, b) => {
        if (a.parseFailed && !b.parseFailed) return -1;
        if (!a.parseFailed && b.parseFailed) return 1;
        return a.displayName.localeCompare(b.displayName);
    });

    // Build embed
    const parseFailures = memberList.filter(m => m.parseFailed).length;
    const embed = new EmbedBuilder()
        .setTitle('Availability List')
        .setColor(parseFailures > 0 ? 0xf39c12 : 0x2ecc71)
        .setDescription(
            `**${entries.length} member${entries.length === 1 ? '' : 's'}** have set their availability.` +
            (parseFailures > 0 ? `\n⚠️ **${parseFailures}** with parse issues (check their input)` : '')
        );

    // Build field content (limit to ~15 users per field due to Discord limits)
    const lines = memberList.slice(0, 20).map(m => {
        const tzStr = m.timezone !== '—' ? ` (${m.timezone})` : '';
        const daysPreview = m.days.length > 30 ? m.days.substring(0, 27) + '...' : m.days;
        return `${m.status} **${m.displayName}**${tzStr}\n   ${daysPreview}`;
    });

    if (lines.length > 0) {
        embed.addFields({
            name: 'Members',
            value: lines.join('\n'),
            inline: false
        });
    }

    if (memberList.length > 20) {
        embed.setFooter({ text: `Showing 20 of ${memberList.length} members` });
    }

    if (parseFailures > 0) {
        embed.addFields({
            name: 'Parse Failures',
            value: 'Members marked with ⚠️ have entered availability that could not be parsed into time windows. Use `/availability set user:@user` to fix their input.',
            inline: false
        });
    }

    return interaction.editReply({ embeds: [embed] });
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
