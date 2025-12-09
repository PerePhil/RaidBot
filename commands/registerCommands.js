const { REST, Routes } = require('discord.js');

async function registerCommands(clientId, token, commands) {
    const rest = new REST({ version: '10' }).setToken(token);
    const payload = commands.map((command) => command.data.toJSON());

    console.log('Started refreshing application (/) commands.');

    await rest.put(
        Routes.applicationCommands(clientId),
        { body: payload }
    );

    console.log('Successfully reloaded application (/) commands.');
}

module.exports = { registerCommands };
