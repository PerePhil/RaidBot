const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
    findRaidByIdInGuild,
    updateRaidEmbed,
    updateMuseumEmbed,
    updateKeyEmbed,
    fetchRaidMessage
} = require('../utils/raidHelpers');
const { processWaitlistOpenings } = require('../utils/waitlistNotifications');
const { markActiveRaidUpdated } = require('../state');
const { sendAuditLog } = require('../auditLog');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('raidsignup')
        .setDescription('Assign/remove users or set Lemuria side')
        .addStringOption((option) =>
            option.setName('action')
                .setDescription('assign | remove | side | waitlist')
                .setRequired(true)
                .addChoices(
                    { name: 'assign', value: 'assign' },
                    { name: 'remove', value: 'remove' },
                    { name: 'side', value: 'side' },
                    { name: 'waitlist', value: 'waitlist' }
                ))
        .addStringOption((option) =>
            option.setName('raid_id')
                .setDescription('Raid ID (found at bottom of raid message)')
                .setRequired(true))
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('Target user')
                .setRequired(true))
        .addIntegerOption((option) =>
            option.setName('position')
                .setDescription('Position number (1-12)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(12))
        .addStringOption((option) =>
            option.setName('role')
                .setDescription('Role name or emoji (optional alternative to position for assign)')
                .setRequired(false))
        .addStringOption((option) =>
            option.setName('side')
                .setDescription('Which side to assign (Lemuria only)')
                .setRequired(false)
                .addChoices(
                    { name: 'Left side (Bomb)', value: 'Left side (Bomb)' },
                    { name: 'Left side (Polymorph)', value: 'Left side (Polymorph)' },
                    { name: 'Right side (Automaton)', value: 'Right side (Automaton)' },
                    { name: 'Right side (Bomb)', value: 'Right side (Bomb)' }
                )),
    requiresManageGuild: true,
    async execute(interaction) {
        const action = interaction.options.getString('action');
        if (action === 'remove') {
            return removeSignup(interaction);
        }
        if (action === 'assign') {
            return assignSignup(interaction);
        }
        if (action === 'side') {
            return assignSide(interaction);
        }
        if (action === 'waitlist') {
            return waitlistSignup(interaction);
        }
        return interaction.reply({
            content: 'Unsupported action.',
            flags: MessageFlags.Ephemeral
        });
    }
};

async function removeSignup(interaction) {
    const raidId = interaction.options.getString('raid_id');
    const user = interaction.options.getUser('user');
    const position = interaction.options.getInteger('position');

    const result = findRaidByIdInGuild(interaction.guild, raidId);
    if (!result) {
        return interaction.reply({
            content: 'Raid not found. Make sure the Raid ID is correct.'
        });
    }

    const { messageId, raidData } = result;

    if (raidData.type === 'museum') {
        const message = await fetchRaidMessage(interaction.guild, raidData, messageId);
        if (!message) {
            return interaction.reply({
                content: 'Could not find the museum signup message.'
            });
        }

        const userIndex = raidData.signups.indexOf(user.id);
        if (userIndex === -1) {
            return interaction.reply({
                content: `${user.username} is not signed up for this museum event.`
            });
        }

        raidData.signups.splice(userIndex, 1);
        raidData.waitlist = raidData.waitlist || [];

        try {
            const reaction = message.reactions.cache.find((r) => r.emoji.name === '✅');
            if (reaction) {
                await reaction.users.remove(user.id);
            }
        } catch (error) {
            console.error('Error removing museum reaction:', error);
        }

        await processWaitlistOpenings(interaction.client, raidData, messageId);
        await updateMuseumEmbed(message, raidData);
        markActiveRaidUpdated(messageId);
        const panelLink = buildPanelLink(interaction.guildId, raidData, messageId);
        await sendAuditLog(interaction.guild, `Removed ${user.username} from museum raid ${raidId}.`, {
            title: 'Signup Removed (Museum)',
            color: 0xFEE75C,
            fields: [
                { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'User', value: `<@${user.id}>`, inline: true },
                { name: 'Raid ID', value: raidId, inline: true },
                panelLink ? { name: 'View panel', value: panelLink, inline: false } : null
            ],
            components: panelLink ? [makePanelButton(panelLink)] : undefined
        });

        return interaction.reply({
            content: `Removed ${user.username} from the museum signup.`
        });
    }

    if (raidData.type === 'key') {
        if (!raidData.teams) {
            return interaction.reply({ content: 'This key raid uses an older format. Cannot modify via command.', flags: MessageFlags.Ephemeral });
        }

        // Find which team the user is on
        let foundTeamIndex = -1;
        let foundUserIndex = -1;
        for (let i = 0; i < raidData.teams.length; i++) {
            const idx = raidData.teams[i].users.indexOf(user.id);
            if (idx > -1) {
                foundTeamIndex = i;
                foundUserIndex = idx;
                break;
            }
        }

        if (foundTeamIndex === -1) {
            return interaction.reply({ content: `${user.username} is not signed up for this key boss event.` });
        }

        raidData.teams[foundTeamIndex].users.splice(foundUserIndex, 1);

        const message = await fetchRaidMessage(interaction.guild, raidData, messageId);
        if (!message) {
            return interaction.reply({ content: 'Could not find the key boss signup message.' });
        }

        // Remove their reaction for that team
        const teamEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
        try {
            const reaction = message.reactions.cache.find((r) => r.emoji.name === teamEmojis[foundTeamIndex]);
            if (reaction) await reaction.users.remove(user.id);
        } catch (error) {
            console.error('Error removing key reaction:', error);
        }

        await processWaitlistOpenings(interaction.client, raidData, messageId, { teamIndex: foundTeamIndex });
        await updateKeyEmbed(message, raidData);
        markActiveRaidUpdated(messageId);
        const panelLink = buildPanelLink(interaction.guildId, raidData, messageId);
        await sendAuditLog(interaction.guild, `Removed ${user.username} from key boss raid ${raidId} (Team ${foundTeamIndex + 1}).`, {
            title: 'Signup Removed (Key Boss)',
            color: 0xFEE75C,
            fields: [
                { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'User', value: `<@${user.id}>`, inline: true },
                { name: 'Raid ID', value: raidId, inline: true },
                { name: 'Team', value: `Team ${foundTeamIndex + 1}`, inline: true },
                panelLink ? { name: 'View panel', value: panelLink, inline: false } : null
            ].filter(Boolean),
            components: panelLink ? [makePanelButton(panelLink)] : undefined
        });

        return interaction.reply({ content: `Removed ${user.username} from Team ${foundTeamIndex + 1}.` });
    }

    if (position < 1 || position > raidData.signups.length) {
        return interaction.reply({
            content: `Invalid position. This raid has ${raidData.signups.length} positions.`
        });
    }

    const role = raidData.signups[position - 1];
    role.waitlist = role.waitlist || [];
    const userIndex = role.users.indexOf(user.id);

    if (userIndex === -1) {
        return interaction.reply({
            content: `${user.username} is not signed up for position ${position} (${role.name}).`
        });
    }

    role.users.splice(userIndex, 1);

    const message = await fetchRaidMessage(interaction.guild, raidData, messageId);
    if (!message) {
        return interaction.reply({
            content: 'Could not find the raid signup message.'
        });
    }

    try {
        const reaction = message.reactions.cache.find((r) => r.emoji.name === role.emoji);
        if (reaction) {
            await reaction.users.remove(user.id);
        }
    } catch (error) {
        console.error('Error removing raid reaction:', error);
    }

    await processWaitlistOpenings(interaction.client, raidData, messageId);
    await updateRaidEmbed(message, raidData);
    markActiveRaidUpdated(messageId);
    const panelLink = buildPanelLink(interaction.guildId, raidData, messageId);
    await sendAuditLog(interaction.guild, `Removed ${user.username} from raid ${raidId} (position ${position}).`, {
        title: 'Signup Removed',
        color: 0xFEE75C,
        fields: [
            { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'User', value: `<@${user.id}>`, inline: true },
            { name: 'Raid ID', value: raidId, inline: true },
            { name: 'Position', value: String(position), inline: true },
            { name: 'Role', value: role.name, inline: true },
            panelLink ? { name: 'View panel', value: panelLink, inline: false } : null
        ],
        components: panelLink ? [makePanelButton(panelLink)] : undefined
    });

    return interaction.reply({
        content: `Removed ${user.username} from position ${position} (${role.name}).`
    });
}

async function assignSignup(interaction) {
    const raidId = interaction.options.getString('raid_id');
    const user = interaction.options.getUser('user');
    const position = interaction.options.getInteger('position');
    const roleLabel = interaction.options.getString('role');
    const side = interaction.options.getString('side');

    const result = findRaidByIdInGuild(interaction.guild, raidId);
    if (!result) {
        return interaction.reply({
            content: 'Raid not found. Make sure the Raid ID is correct.',
            flags: MessageFlags.Ephemeral
        });
    }

    const { messageId, raidData } = result;

    if (raidData.closed) {
        return interaction.reply({
            content: 'Cannot assign users to a closed raid. Reopen it first with `/raid`.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (raidData.type === 'museum') {
        if (raidData.signups.includes(user.id)) {
            return interaction.reply({
                content: `${user.username} is already signed up for this museum event.`,
                flags: MessageFlags.Ephemeral
            });
        }

        raidData.signups.push(user.id);
        raidData.waitlist = raidData.waitlist || [];
        const waitlistIndex = raidData.waitlist.indexOf(user.id);
        if (waitlistIndex > -1) {
            raidData.waitlist.splice(waitlistIndex, 1);
        }

        const message = await fetchRaidMessage(interaction.guild, raidData, messageId);
        if (message) {
            await updateMuseumEmbed(message, raidData);
            markActiveRaidUpdated(messageId);
            const panelLink = buildPanelLink(interaction.guildId, raidData, messageId);
            await sendAuditLog(interaction.guild, `Assigned ${user.username} to museum raid ${raidId}.`, {
                title: 'Signup Added (Museum)',
                color: 0x57F287,
                fields: [
                    { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'User', value: `<@${user.id}>`, inline: true },
                    { name: 'Raid ID', value: raidId, inline: true },
                    panelLink ? { name: 'View panel', value: panelLink, inline: false } : null
                ],
                components: panelLink ? [makePanelButton(panelLink)] : undefined
            });
        } else {
            return interaction.reply({
                content: 'Could not locate the museum signup message.',
                flags: MessageFlags.Ephemeral
            });
        }

        return interaction.reply({
            content: `Added ${user.username} to the museum signup.`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (raidData.type === 'key') {
        if (!raidData.teams) {
            return interaction.reply({ content: 'This key raid uses an older format. Cannot modify via command.', flags: MessageFlags.Ephemeral });
        }

        // Check if user is already on any team
        for (let i = 0; i < raidData.teams.length; i++) {
            if (raidData.teams[i].users.includes(user.id)) {
                return interaction.reply({
                    content: `${user.username} is already on Team ${i + 1}.`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Use position as team number (1-based), or default to first team with space
        const teamIndex = position ? position - 1 : raidData.teams.findIndex(t => t.users.length < (raidData.maxPerTeam || 4));
        if (teamIndex < 0 || teamIndex >= raidData.teams.length) {
            return interaction.reply({
                content: position
                    ? `Invalid team number. This raid has ${raidData.teams.length} teams.`
                    : 'All teams are full.',
                flags: MessageFlags.Ephemeral
            });
        }

        const team = raidData.teams[teamIndex];
        if (team.users.length >= (raidData.maxPerTeam || 4)) {
            return interaction.reply({
                content: `Team ${teamIndex + 1} is full.`,
                flags: MessageFlags.Ephemeral
            });
        }

        team.users.push(user.id);
        // Remove from any waitlist
        for (const t of raidData.teams) {
            const wIdx = t.waitlist.indexOf(user.id);
            if (wIdx > -1) t.waitlist.splice(wIdx, 1);
        }

        const message = await fetchRaidMessage(interaction.guild, raidData, messageId);
        if (message) {
            await updateKeyEmbed(message, raidData);
            markActiveRaidUpdated(messageId);
            const panelLink = buildPanelLink(interaction.guildId, raidData, messageId);
            await sendAuditLog(interaction.guild, `Assigned ${user.username} to key boss raid ${raidId} (Team ${teamIndex + 1}).`, {
                title: 'Signup Added (Key Boss)',
                color: 0x57F287,
                fields: [
                    { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'User', value: `<@${user.id}>`, inline: true },
                    { name: 'Raid ID', value: raidId, inline: true },
                    { name: 'Team', value: `Team ${teamIndex + 1}`, inline: true },
                    panelLink ? { name: 'View panel', value: panelLink, inline: false } : null
                ].filter(Boolean),
                components: panelLink ? [makePanelButton(panelLink)] : undefined
            });
        } else {
            return interaction.reply({ content: 'Could not locate the key boss signup message.', flags: MessageFlags.Ephemeral });
        }

        return interaction.reply({
            content: `Added ${user.username} to Team ${teamIndex + 1}.`,
            flags: MessageFlags.Ephemeral
        });
    }

    const resolution = resolveRoleSelection(raidData.signups, position, roleLabel);
    if (resolution.error) {
        return interaction.reply({
            content: resolution.error,
            flags: MessageFlags.Ephemeral
        });
    }

    const { role, index: roleIndex } = resolution;
    role.waitlist = role.waitlist || [];
    role.sideAssignments = role.sideAssignments || {};
    const existingRole = raidData.signups.find((r) => r.users.includes(user.id));

    if (existingRole) {
        existingRole.waitlist = existingRole.waitlist || [];
        existingRole.users = existingRole.users.filter((userId) => userId !== user.id);
        existingRole.sideAssignments = existingRole.sideAssignments || {};
        delete existingRole.sideAssignments[user.id];
    }

    raidData.signups.forEach((signupRole) => {
        signupRole.waitlist = signupRole.waitlist || [];
        signupRole.sideAssignments = signupRole.sideAssignments || {};
        const waitIdx = signupRole.waitlist.indexOf(user.id);
        if (waitIdx > -1) {
            signupRole.waitlist.splice(waitIdx, 1);
        }
    });

    if (!role.users.includes(user.id)) {
        role.users.push(user.id);
    } else {
        return interaction.reply({
            content: `${user.username} is already signed up for ${role.name}.`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (side && isLemuriaRaid(raidData)) {
        role.sideAssignments[user.id] = side;
    }

    const message = await fetchRaidMessage(interaction.guild, raidData, messageId);
    if (!message) {
        return interaction.reply({
            content: 'Could not find the raid signup message.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (existingRole) {
        const oldReaction = message.reactions.cache.find((r) => r.emoji.name === existingRole.emoji);
        if (oldReaction) {
            await oldReaction.users.remove(user.id);
        }
    }

    await processWaitlistOpenings(interaction.client, raidData, messageId);
    await updateRaidEmbed(message, raidData);
    markActiveRaidUpdated(messageId);
    const panelLink = buildPanelLink(interaction.guildId, raidData, messageId);
    await sendAuditLog(interaction.guild, `Assigned ${user.username} to raid ${raidId} at ${role.name}.`, {
        title: 'Signup Added',
        color: 0x57F287,
        fields: [
            { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'User', value: `<@${user.id}>`, inline: true },
            { name: 'Raid ID', value: raidId, inline: true },
            { name: 'Role', value: role.name, inline: true },
            typeof roleIndex === 'number' ? { name: 'Slot', value: String(roleIndex + 1), inline: true } : null,
            panelLink ? { name: 'View panel', value: panelLink, inline: false } : null
        ].filter(Boolean),
        components: panelLink ? [makePanelButton(panelLink)] : undefined
    });

    return interaction.reply({
        content: `Added ${user.username} to ${role.name}${typeof roleIndex === 'number' ? ` (slot ${roleIndex + 1})` : ''}.`,
        flags: MessageFlags.Ephemeral
    });
}

async function waitlistSignup(interaction) {
    const raidId = interaction.options.getString('raid_id');
    const user = interaction.options.getUser('user');
    const position = interaction.options.getInteger('position');
    const roleLabel = interaction.options.getString('role');

    const result = findRaidByIdInGuild(interaction.guild, raidId);
    if (!result) {
        return interaction.reply({
            content: 'Raid not found. Make sure the Raid ID is correct.',
            flags: MessageFlags.Ephemeral
        });
    }

    const { messageId, raidData } = result;

    if (raidData.closed) {
        return interaction.reply({
            content: 'Cannot modify waitlist on a closed raid. Reopen it first with `/raid`.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Museum: add to raidData.waitlist
    if (raidData.type === 'museum') {
        raidData.waitlist = raidData.waitlist || [];

        // If already on the waitlist, nothing to do
        if (raidData.waitlist.includes(user.id)) {
            return interaction.reply({
                content: `${user.username} is already on the waitlist.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Remove from main roster if present (frees a slot)
        const mainIndex = raidData.signups.indexOf(user.id);
        if (mainIndex > -1) {
            raidData.signups.splice(mainIndex, 1);
        }

        raidData.waitlist.push(user.id);

        const message = await fetchRaidMessage(interaction.guild, raidData, messageId);
        if (!message) {
            return interaction.reply({
                content: 'Could not find the signup message.',
                flags: MessageFlags.Ephemeral
            });
        }

        // The vacated main slot may promote someone else from the waitlist
        if (mainIndex > -1) {
            await processWaitlistOpenings(interaction.client, raidData, messageId);
        }

        await updateMuseumEmbed(message, raidData);
        markActiveRaidUpdated(messageId);

        const panelLink = buildPanelLink(interaction.guildId, raidData, messageId);
        await sendAuditLog(interaction.guild, `Placed ${user.username} on waitlist for museum raid ${raidId}.`, {
            title: 'Waitlist Added (Museum)',
            color: 0xFFA500,
            fields: [
                { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'User', value: `<@${user.id}>`, inline: true },
                { name: 'Raid ID', value: raidId, inline: true },
                mainIndex > -1 ? { name: 'Note', value: 'Moved from main roster', inline: false } : null,
                panelLink ? { name: 'View panel', value: panelLink, inline: false } : null
            ].filter(Boolean),
            components: panelLink ? [makePanelButton(panelLink)] : undefined
        });

        const movedNote = mainIndex > -1 ? ' (moved from main roster)' : '';
        return interaction.reply({
            content: `Placed ${user.username} on the waitlist${movedNote}.`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (raidData.type === 'key') {
        if (!raidData.teams) {
            return interaction.reply({ content: 'This key raid uses an older format.', flags: MessageFlags.Ephemeral });
        }

        // Check if already on a waitlist
        for (let i = 0; i < raidData.teams.length; i++) {
            if (raidData.teams[i].waitlist.includes(user.id)) {
                return interaction.reply({
                    content: `${user.username} is already on Team ${i + 1}'s waitlist.`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Find which team they're on (if any) and remove from roster
        let removedFromTeam = -1;
        for (let i = 0; i < raidData.teams.length; i++) {
            const idx = raidData.teams[i].users.indexOf(user.id);
            if (idx > -1) {
                raidData.teams[i].users.splice(idx, 1);
                removedFromTeam = i;
                break;
            }
        }

        // Use position as target team waitlist (1-based), or default to first team
        const targetTeam = position ? position - 1 : (removedFromTeam > -1 ? removedFromTeam : 0);
        if (targetTeam < 0 || targetTeam >= raidData.teams.length) {
            return interaction.reply({
                content: `Invalid team number. This raid has ${raidData.teams.length} teams.`,
                flags: MessageFlags.Ephemeral
            });
        }

        raidData.teams[targetTeam].waitlist.push(user.id);

        const message = await fetchRaidMessage(interaction.guild, raidData, messageId);
        if (!message) {
            return interaction.reply({ content: 'Could not find the signup message.', flags: MessageFlags.Ephemeral });
        }

        if (removedFromTeam > -1) {
            await processWaitlistOpenings(interaction.client, raidData, messageId, { teamIndex: removedFromTeam });
        }

        await updateKeyEmbed(message, raidData);
        markActiveRaidUpdated(messageId);

        const panelLink = buildPanelLink(interaction.guildId, raidData, messageId);
        const movedNote = removedFromTeam > -1 ? ` (moved from Team ${removedFromTeam + 1} roster)` : '';
        await sendAuditLog(interaction.guild, `Placed ${user.username} on Team ${targetTeam + 1} waitlist for key boss raid ${raidId}.`, {
            title: 'Waitlist Added (Key Boss)',
            color: 0xFFA500,
            fields: [
                { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'User', value: `<@${user.id}>`, inline: true },
                { name: 'Raid ID', value: raidId, inline: true },
                { name: 'Team', value: `Team ${targetTeam + 1}`, inline: true },
                removedFromTeam > -1 ? { name: 'Note', value: `Moved from Team ${removedFromTeam + 1} roster`, inline: false } : null,
                panelLink ? { name: 'View panel', value: panelLink, inline: false } : null
            ].filter(Boolean),
            components: panelLink ? [makePanelButton(panelLink)] : undefined
        });

        return interaction.reply({
            content: `Placed ${user.username} on Team ${targetTeam + 1}'s waitlist${movedNote}.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Regular raids: resolve role and add to role-specific waitlist
    const resolution = resolveRoleSelection(raidData.signups, position, roleLabel);
    if (resolution.error) {
        return interaction.reply({
            content: resolution.error,
            flags: MessageFlags.Ephemeral
        });
    }

    const { role, index: roleIndex } = resolution;
    role.waitlist = role.waitlist || [];

    // Already on this role's waitlist?
    if (role.waitlist.includes(user.id)) {
        return interaction.reply({
            content: `${user.username} is already on the waitlist for ${role.name}.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Remove from any main roster slot (frees a slot for promotion)
    let wasOnRoster = false;
    const existingRole = raidData.signups.find((r) => r.users.includes(user.id));
    if (existingRole) {
        existingRole.users = existingRole.users.filter((id) => id !== user.id);
        existingRole.sideAssignments = existingRole.sideAssignments || {};
        delete existingRole.sideAssignments[user.id];
        wasOnRoster = true;
    }

    // Remove from all other role waitlists (prevent multi-waitlist)
    raidData.signups.forEach((signupRole) => {
        signupRole.waitlist = signupRole.waitlist || [];
        if (signupRole !== role) {
            const idx = signupRole.waitlist.indexOf(user.id);
            if (idx > -1) {
                signupRole.waitlist.splice(idx, 1);
            }
        }
    });

    role.waitlist.push(user.id);

    const message = await fetchRaidMessage(interaction.guild, raidData, messageId);
    if (!message) {
        return interaction.reply({
            content: 'Could not find the raid signup message.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Remove reaction from old role if they were on the roster
    if (wasOnRoster && existingRole) {
        try {
            const oldReaction = message.reactions.cache.find((r) => r.emoji.name === existingRole.emoji);
            if (oldReaction) {
                await oldReaction.users.remove(user.id);
            }
        } catch (error) {
            console.error('Error removing reaction for waitlist move:', error);
        }
    }

    // The vacated main slot may promote someone from that role's waitlist
    if (wasOnRoster) {
        await processWaitlistOpenings(interaction.client, raidData, messageId);
    }

    await updateRaidEmbed(message, raidData);
    markActiveRaidUpdated(messageId);

    const panelLink = buildPanelLink(interaction.guildId, raidData, messageId);
    await sendAuditLog(interaction.guild, `Placed ${user.username} on waitlist for ${role.name} in raid ${raidId}.`, {
        title: 'Waitlist Added',
        color: 0xFFA500,
        fields: [
            { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'User', value: `<@${user.id}>`, inline: true },
            { name: 'Raid ID', value: raidId, inline: true },
            { name: 'Role', value: role.name, inline: true },
            typeof roleIndex === 'number' ? { name: 'Slot', value: String(roleIndex + 1), inline: true } : null,
            wasOnRoster ? { name: 'Note', value: 'Moved from main roster', inline: false } : null,
            panelLink ? { name: 'View panel', value: panelLink, inline: false } : null
        ].filter(Boolean),
        components: panelLink ? [makePanelButton(panelLink)] : undefined
    });

    const movedNote = wasOnRoster ? ' (moved from main roster)' : '';
    return interaction.reply({
        content: `Placed ${user.username} on the waitlist for ${role.name}${typeof roleIndex === 'number' ? ` (slot ${roleIndex + 1})` : ''}${movedNote}.`,
        flags: MessageFlags.Ephemeral
    });
}

async function assignSide(interaction) {
    const raidId = interaction.options.getString('raid_id');
    const user = interaction.options.getUser('user');
    const side = interaction.options.getString('side');

    const result = findRaidByIdInGuild(interaction.guild, raidId);
    if (!result) {
        return interaction.reply({
            content: 'Raid not found. Make sure the Raid ID is correct.',
            flags: MessageFlags.Ephemeral
        });
    }

    const { messageId, raidData } = result;

    if (!isLemuriaRaid(raidData)) {
        return interaction.reply({
            content: 'This command can only be used on Ghastly Conspiracy (Lemuria) raids.',
            flags: MessageFlags.Ephemeral
        });
    }

    const userRole = raidData.signups.find((role) => role.users.includes(user.id));
    if (!userRole) {
        return interaction.reply({
            content: `${user.username} is not signed up for this raid.`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (!userRole.sideAssignments) {
        userRole.sideAssignments = {};
    }
    userRole.sideAssignments[user.id] = side;

    const message = await fetchRaidMessage(interaction.guild, raidData, messageId);
    if (message) {
        try {
            await updateRaidEmbed(message, raidData);
            markActiveRaidUpdated(messageId);
            const panelLink = buildPanelLink(interaction.guildId, raidData, messageId);
            await sendAuditLog(interaction.guild, `Set side for ${user.username} to ${side} on raid ${raidId}.`, {
                title: 'Side Assigned',
                color: 0x5865F2,
                fields: [
                    { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'User', value: `<@${user.id}>`, inline: true },
                    { name: 'Raid ID', value: raidId, inline: true },
                    { name: 'Side', value: side, inline: true },
                    panelLink ? { name: 'View panel', value: panelLink, inline: false } : null
                ],
                components: panelLink ? [makePanelButton(panelLink)] : undefined
            });
        } catch (error) {
            console.error('Error updating message:', error);
        }
    } else {
        return interaction.reply({
            content: 'Could not find the raid signup message.',
            flags: MessageFlags.Ephemeral
        });
    }

    return interaction.reply({
        content: `Assigned ${user.username} to ${side}.`,
        flags: MessageFlags.Ephemeral
    });
}

function resolveRoleSelection(signups, position, label) {
    const total = signups.length;
    let selectedIndex = null;

    if (typeof position === 'number') {
        if (position < 1 || position > total) {
            return { error: `Invalid position. This raid has ${total} positions.` };
        }
        selectedIndex = position - 1;
    }

    if (label) {
        const trimmed = label.trim();

        if (/^\d+$/.test(trimmed)) {
            const numericIndex = parseInt(trimmed, 10);
            if (numericIndex >= 1 && numericIndex <= total) {
                if (selectedIndex !== null && selectedIndex !== numericIndex - 1) {
                    return { error: 'The provided position and role names do not match. Please specify only one.' };
                }
                selectedIndex = numericIndex - 1;
            }
        }

        if (selectedIndex === null) {
            const exactIndex = signups.findIndex((role) =>
                [role.emoji, role.icon, role.name].some((value) =>
                    typeof value === 'string' && value.toLowerCase() === trimmed.toLowerCase()
                )
            );
            if (exactIndex >= 0) {
                selectedIndex = exactIndex;
            }
        }

        if (selectedIndex === null) {
            const partialMatches = signups
                .map((role, idx) => ({ role, idx }))
                .filter(({ role }) => role.name.toLowerCase().includes(trimmed.toLowerCase()));

            if (partialMatches.length === 1) {
                selectedIndex = partialMatches[0].idx;
            } else if (partialMatches.length > 1) {
                return { error: 'Multiple roles match that name. Please be more specific or provide the numeric position.' };
            }
        }

        if (selectedIndex === null) {
            return { error: 'Could not find a role matching that name or emoji.' };
        }
    }

    if (selectedIndex === null) {
        return { error: 'Provide either the position number or the role name/emoji.' };
    }

    return { role: signups[selectedIndex], index: selectedIndex };
}

function makePanelButton(link) {
    return {
        type: 2,
        label: 'View panel',
        style: 5, // Link button
        url: link
    };
}

function buildPanelLink(guildId, raidData, messageId) {
    if (!raidData.channelId || !messageId) return null;
    return `https://discord.com/channels/${guildId}/${raidData.channelId}/${messageId}`;
}

function isLemuriaRaid(raidData) {
    const slug = (raidData.template && raidData.template.slug) ? raidData.template.slug.toLowerCase() : '';
    const name = raidData.template?.name?.toLowerCase() || '';
    return slug === 'lemuria' || name.includes('lemuria') || name.includes('ghastly');
}
