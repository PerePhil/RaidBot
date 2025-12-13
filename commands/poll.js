const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const chrono = require('chrono-node');
const {
    createPoll,
    updatePollMessage,
    getPoll,
    getGuildPolls,
    getPollResults,
    getOptimalSlots,
    closePoll,
    deletePoll,
    getNumberEmoji,
    NUMBER_EMOJIS
} = require('../pollManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Create time slot polls to find optimal raid/event times')
        .addSubcommand((sub) =>
            sub.setName('create')
                .setDescription('Create a new time slot poll')
                .addStringOption((opt) =>
                    opt.setName('title')
                        .setDescription('Poll title (e.g., "Weekly Raid Time")')
                        .setRequired(true))
                .addStringOption((opt) =>
                    opt.setName('options')
                        .setDescription('Time slots, comma-separated (e.g., "Sat 7pm, Sat 8pm, Sun 3pm")')
                        .setRequired(true))
                .addIntegerOption((opt) =>
                    opt.setName('duration')
                        .setDescription('Hours until poll closes (0 = no auto-close)')
                        .setMinValue(0)
                        .setMaxValue(168)
                        .setRequired(false)))
        .addSubcommand((sub) =>
            sub.setName('list')
                .setDescription('List recent polls in this server'))
        .addSubcommand((sub) =>
            sub.setName('results')
                .setDescription('View current voting breakdown')
                .addStringOption((opt) =>
                    opt.setName('id')
                        .setDescription('Poll ID')
                        .setRequired(true)))
        .addSubcommand((sub) =>
            sub.setName('close')
                .setDescription('Close a poll and show final results')
                .addStringOption((opt) =>
                    opt.setName('id')
                        .setDescription('Poll ID')
                        .setRequired(true)))
        .addSubcommand((sub) =>
            sub.setName('delete')
                .setDescription('Delete a poll')
                .addStringOption((opt) =>
                    opt.setName('id')
                        .setDescription('Poll ID')
                        .setRequired(true))),

    requiresManageGuild: true,

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'create':
                return handleCreate(interaction);
            case 'list':
                return handleList(interaction);
            case 'results':
                return handleResults(interaction);
            case 'close':
                return handleClose(interaction);
            case 'delete':
                return handleDelete(interaction);
            default:
                return interaction.reply({ content: 'Unknown subcommand.', flags: MessageFlags.Ephemeral });
        }
    }
};

async function handleCreate(interaction) {
    const title = interaction.options.getString('title');
    const optionsStr = interaction.options.getString('options');
    const durationHours = interaction.options.getInteger('duration') || 0;

    // Parse options (comma-separated)
    const options = optionsStr
        .split(/[,;]+/)
        .map(s => s.trim())
        .filter(Boolean);

    if (options.length < 2) {
        return interaction.reply({
            content: '❌ Please provide at least 2 time slot options, separated by commas.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (options.length > 10) {
        return interaction.reply({
            content: '❌ Maximum 10 time slot options allowed.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Calculate expiration
    const expiresAt = durationHours > 0
        ? Math.floor(Date.now() / 1000) + (durationHours * 3600)
        : null;

    // Create poll
    const poll = createPoll(
        interaction.guildId,
        interaction.channelId,
        interaction.user.id,
        title,
        options,
        expiresAt
    );

    // Build embed
    const embed = buildPollEmbed(poll, null, false);

    await interaction.reply({ content: '📊 Creating poll...', flags: MessageFlags.Ephemeral });

    // Send the poll message
    const message = await interaction.channel.send({ embeds: [embed] });
    updatePollMessage(poll.id, message.id);

    // Add reaction options
    for (let i = 0; i < options.length; i++) {
        try {
            await message.react(getNumberEmoji(i));
        } catch (err) {
            console.error(`Failed to add reaction ${i}:`, err.message);
        }
    }

    await interaction.editReply({
        content: `✅ Poll created! ID: \`${poll.id}\`\nUsers can vote by reacting to the poll message.`
    });
}

function buildPollEmbed(poll, results = null, showVoters = false) {
    const embed = new EmbedBuilder()
        .setTitle(`📊 ${poll.title}`)
        .setColor(poll.closed ? 0x95a5a6 : 0x3498db);

    let description = poll.closed
        ? '**Poll Closed** — Final Results\n\n'
        : 'React with a number to vote for your preferred time(s)!\n\n';

    poll.options.forEach((option, index) => {
        const emoji = getNumberEmoji(index);
        const count = results?.results?.[index]?.count || 0;
        const bar = generateBar(count, results?.totalVoters || 0);

        description += `${emoji} **${option}**`;
        if (results) {
            description += ` — ${count} vote${count !== 1 ? 's' : ''}`;
            if (count > 0) {
                description += ` ${bar}`;
            }
            if (showVoters && results.results[index]?.voters?.length > 0) {
                const voterMentions = results.results[index].voters
                    .slice(0, 10)
                    .map(id => `<@${id}>`)
                    .join(', ');
                const extra = results.results[index].voters.length > 10
                    ? ` +${results.results[index].voters.length - 10} more`
                    : '';
                description += `\n   └ ${voterMentions}${extra}`;
            }
        }
        description += '\n';
    });

    if (results && results.totalVoters > 0) {
        description += `\n**Total Voters:** ${results.totalVoters}`;

        // Highlight top choices
        const top = results.sortedByVotes.filter(r => r.count > 0).slice(0, 3);
        if (top.length > 0 && !poll.closed) {
            description += '\n\n🏆 **Top Choices:**';
            top.forEach((r, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
                description += `\n${medal} ${r.option} (${r.count} votes)`;
            });
        }
    }

    embed.setDescription(description);

    // Footer
    const footerParts = [`Poll ID: ${poll.id}`];
    if (poll.expiresAt && !poll.closed) {
        footerParts.push(`Closes: <t:${poll.expiresAt}:R>`);
    }
    embed.setFooter({ text: footerParts.join(' • ') });

    return embed;
}

function generateBar(count, total) {
    if (total === 0) return '';
    const filled = Math.round((count / total) * 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

async function handleList(interaction) {
    const polls = getGuildPolls(interaction.guildId, 10);

    if (polls.length === 0) {
        return interaction.reply({
            content: 'No polls found in this server.',
            flags: MessageFlags.Ephemeral
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('📊 Recent Polls')
        .setColor(0x3498db);

    let description = '';
    polls.forEach(poll => {
        const status = poll.closed ? '🔒 Closed' : '✅ Open';
        const created = `<t:${poll.createdAt}:R>`;
        description += `**${poll.title}** (ID: \`${poll.id}\`)\n`;
        description += `${status} • Created ${created}`;
        if (poll.messageId) {
            description += ` • [Jump](https://discord.com/channels/${poll.guildId}/${poll.channelId}/${poll.messageId})`;
        }
        description += '\n\n';
    });

    embed.setDescription(description);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleResults(interaction) {
    const pollId = interaction.options.getString('id');
    const results = getPollResults(pollId);

    if (!results) {
        return interaction.reply({
            content: `❌ Poll \`${pollId}\` not found.`,
            flags: MessageFlags.Ephemeral
        });
    }

    const embed = buildPollEmbed(results.poll, results, true);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleClose(interaction) {
    const pollId = interaction.options.getString('id');
    const poll = getPoll(pollId);

    if (!poll) {
        return interaction.reply({
            content: `❌ Poll \`${pollId}\` not found.`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (poll.closed) {
        return interaction.reply({
            content: `Poll \`${pollId}\` is already closed.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Close the poll
    closePoll(pollId);

    // Get final results
    const results = getPollResults(pollId);
    const embed = buildPollEmbed({ ...poll, closed: true }, results, true);

    // Add optimal time summary
    const optimal = getOptimalSlots(pollId, 1, 3);
    let summary = '**🏆 Optimal Time Slots:**\n';
    if (optimal.length === 0) {
        summary += 'No votes recorded.';
    } else {
        optimal.forEach((slot, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
            summary += `${medal} **${slot.option}** — ${slot.count} vote${slot.count !== 1 ? 's' : ''}\n`;
        });
    }

    // Update original poll message if possible
    if (poll.messageId) {
        try {
            const channel = await interaction.client.channels.fetch(poll.channelId);
            const message = await channel.messages.fetch(poll.messageId);
            await message.edit({ embeds: [embed] });
        } catch (err) {
            console.error('Failed to update poll message:', err.message);
        }
    }

    const resultEmbed = new EmbedBuilder()
        .setTitle(`📊 Poll Closed: ${poll.title}`)
        .setDescription(summary)
        .setColor(0x2ecc71)
        .setFooter({ text: `Poll ID: ${pollId} • Total voters: ${results.totalVoters}` });

    return interaction.reply({ embeds: [resultEmbed] });
}

async function handleDelete(interaction) {
    const pollId = interaction.options.getString('id');
    const poll = getPoll(pollId);

    if (!poll) {
        return interaction.reply({
            content: `❌ Poll \`${pollId}\` not found.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Delete the poll message if possible
    if (poll.messageId) {
        try {
            const channel = await interaction.client.channels.fetch(poll.channelId);
            const message = await channel.messages.fetch(poll.messageId);
            await message.delete();
        } catch (err) {
            console.error('Failed to delete poll message:', err.message);
        }
    }

    deletePoll(pollId);

    return interaction.reply({
        content: `✅ Poll \`${pollId}\` deleted.`,
        flags: MessageFlags.Ephemeral
    });
}
