const fs = require('fs');
const path = require('path');

const commandFiles = fs.readdirSync(__dirname)
    .filter((file) => file.endsWith('.js') && !['index.js', 'registerCommands.js'].includes(file));

const commands = commandFiles.map((file) => require(path.join(__dirname, file)));

module.exports = commands;
