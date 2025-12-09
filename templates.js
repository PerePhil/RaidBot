const fs = require('fs');
const { dataPath } = require('./state');

const templatePath = dataPath('raid_templates.json');

module.exports = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
