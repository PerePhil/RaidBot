const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { guildParticipation, getNoShowCount } = require('../state');

// Achievement definitions
const ACHIEVEMENTS = [
    { id: 'first_raid', name: 'Rookie Raider', emoji: '🎮', description: 'Complete your first raid', check: (stats) => stats.totalRaids >= 1 },
    { id: 'raids_10', name: 'Regular', emoji: '⭐', description: 'Complete 10 raids', check: (stats) => stats.totalRaids >= 10 },
    { id: 'raids_25', name: 'Veteran', emoji: '🏅', description: 'Complete 25 raids', check: (stats) => stats.totalRaids >= 25 },
    { id: 'raids_50', name: 'Elite Raider', emoji: '🏆', description: 'Complete 50 raids', check: (stats) => stats.totalRaids >= 50 },
    { id: 'raids_100', name: 'Raid Master', emoji: '👑', description: 'Complete 100 raids', check: (stats) => stats.totalRaids >= 100 },
    { id: 'flex_5', name: 'Flexible', emoji: '🔄', description: 'Play 5 different roles', check: (stats) => stats.roleCounts && Object.keys(stats.roleCounts).length >= 5 },
    { id: 'flex_10', name: 'Jack of All Trades', emoji: '🎭', description: 'Play 10 different roles', check: (stats) => stats.roleCounts && Object.keys(stats.roleCounts).length >= 10 },
    {
        id: 'weekend_warrior', name: 'Weekend Warrior', emoji: '📅', description: 'Complete 10 weekend raids', check: (stats) => {
            if (!stats.weekdayCounts) return false;
            const weekend = (stats.weekdayCounts[0] || 0) + (stats.weekdayCounts[6] || 0);
            return weekend >= 10;
        }
    },
    { id: 'reliable', name: 'Reliable', emoji: '✅', description: 'Complete 20 raids with no no-shows', check: (stats, noShows) => stats.totalRaids >= 20 && noShows === 0 },
    {
        id: 'specialist', name: 'Specialist', emoji: '🎯', description: 'Play the same role 20 times', check: (stats) => {
            if (!stats.roleCounts) return false;
            return Object.values(stats.roleCounts).some(count => count >= 20);
        }
    },
    {
        id: 'master_specialist', name: 'Master Specialist', emoji: '💎', description: 'Play the same role 50 times', check: (stats) => {
            if (!stats.roleCounts) return false;
            return Object.values(stats.roleCounts).some(count => count >= 50);
        }
    }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View raid leaderboards and achievements')
        .addSubcommand(sub =>
            sub.setName('top')
                .setDescription('View top raiders by total raids'))
        .addSubcommand(sub =>
            sub.setName('role')
                .setDescription('View top raiders for a specific role')
                .addStringOption(opt =>
                    opt.setName('role_name')
                        .setDescription('Role name to check (e.g., "Hunter")')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('achievements')
                .setDescription('View your achievements')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('User to view achievements for')
                        .setRequired(false))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (!interaction.guildId) {
            return interaction.reply({
                content: 'This command can only be used in a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        switch (subcommand) {
            case 'top':
                return showTopRaiders(interaction);
            case 'role':
                return showRoleLeaderboard(interaction);
            case 'achievements':
                return showAchievements(interaction);
            default:
                return interaction.reply({ content: 'Unknown subcommand.', flags: MessageFlags.Ephemeral });
        }
    }
};

async function showTopRaiders(interaction) {
    await interaction.deferReply();

    const guildId = interaction.guildId;
    const guildStats = guildParticipation.get(guildId);

    if (!guildStats || guildStats.size === 0) {
        return interaction.editReply({ content: 'No stats recorded yet for this server.' });
    }

    const leaderboard = Array.from(guildStats.entries())
        .map(([userId, stats]) => ({ userId, totalRaids: stats.totalRaids || 0 }))
        .filter(entry => entry.totalRaids > 0)
        .sort((a, b) => b.totalRaids - a.totalRaids)
        .slice(0, 10);

    if (leaderboard.length === 0) {
        return interaction.editReply({ content: 'No raid activity yet.' });
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = leaderboard.map((entry, idx) => {
        const medal = medals[idx] || `**${idx + 1}.**`;
        return `${medal} <@${entry.userId}> — ${entry.totalRaids} raids`;
    });

    const embed = new EmbedBuilder()
        .setTitle('🏆 Top Raiders')
        .setDescription(lines.join('\n'))
        .setColor(0xFFD700)
        .setFooter({ text: `${guildStats.size} total participants` });

    return interaction.editReply({ embeds: [embed] });
}

async function showRoleLeaderboard(interaction) {
    await interaction.deferReply();

    const guildId = interaction.guildId;
    const roleName = interaction.options.getString('role_name');
    const guildStats = guildParticipation.get(guildId);

    if (!guildStats || guildStats.size === 0) {
        return interaction.editReply({ content: 'No stats recorded yet for this server.' });
    }

    const leaderboard = Array.from(guildStats.entries())
        .map(([userId, stats]) => ({
            userId,
            roleCount: stats.roleCounts?.[roleName] || 0
        }))
        .filter(entry => entry.roleCount > 0)
        .sort((a, b) => b.roleCount - a.roleCount)
        .slice(0, 10);

    if (leaderboard.length === 0) {
        return interaction.editReply({ content: `No one has played **${roleName}** yet.` });
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = leaderboard.map((entry, idx) => {
        const medal = medals[idx] || `**${idx + 1}.**`;
        return `${medal} <@${entry.userId}> — ${entry.roleCount}x ${roleName}`;
    });

    const embed = new EmbedBuilder()
        .setTitle(`🎯 Top ${roleName} Players`)
        .setDescription(lines.join('\n'))
        .setColor(0x5865F2);

    return interaction.editReply({ embeds: [embed] });
}

async function showAchievements(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guildId;
    const target = interaction.options.getUser('user') || interaction.user;
    const guildStats = guildParticipation.get(guildId)?.get(target.id);

    if (!guildStats || guildStats.totalRaids === 0) {
        return interaction.editReply({
            content: `${target.id === interaction.user.id ? 'You have' : `${target.username} has`} no raids yet. Start participating to earn achievements!`
        });
    }

    const noShows = getNoShowCount(guildId, target.id);

    const unlocked = [];
    const locked = [];

    for (const achievement of ACHIEVEMENTS) {
        if (achievement.check(guildStats, noShows)) {
            unlocked.push(achievement);
        } else {
            locked.push(achievement);
        }
    }

    const embed = new EmbedBuilder()
        .setTitle(`🏅 ${target.username}'s Achievements`)
        .setThumbnail(target.displayAvatarURL())
        .setColor(unlocked.length >= 5 ? 0xFFD700 : unlocked.length >= 2 ? 0xC0C0C0 : 0xCD7F32);

    if (unlocked.length > 0) {
        embed.addFields({
            name: `✅ Unlocked (${unlocked.length}/${ACHIEVEMENTS.length})`,
            value: unlocked.map(a => `${a.emoji} **${a.name}** — ${a.description}`).join('\n'),
            inline: false
        });
    }

    if (locked.length > 0 && locked.length <= 6) {
        embed.addFields({
            name: '🔒 Locked',
            value: locked.map(a => `${a.emoji} ~~${a.name}~~ — ${a.description}`).join('\n'),
            inline: false
        });
    } else if (locked.length > 0) {
        embed.addFields({
            name: '🔒 Locked',
            value: `${locked.length} more achievements to unlock...`,
            inline: false
        });
    }

    embed.setFooter({ text: `${unlocked.length}/${ACHIEVEMENTS.length} achievements unlocked` });

    return interaction.editReply({ embeds: [embed] });
}
