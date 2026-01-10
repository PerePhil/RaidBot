/**
 * Configuration loader with environment variable support.
 * Environment variables take precedence over config.json values.
 */

// Load .env file if present (must be before accessing process.env)
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadConfig() {
    let fileConfig = {};

    if (fs.existsSync(CONFIG_PATH)) {
        try {
            fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch (error) {
            console.error('Failed to parse config.json:', error.message);
        }
    }

    // Environment variables take precedence
    const clientId = process.env.DISCORD_CLIENT_ID || fileConfig.clientId;
    const token = process.env.DISCORD_TOKEN || fileConfig.token;

    // Parse allowedGuildIds from env (comma-separated) or use config
    let allowedGuildIds = fileConfig.allowedGuildIds || [];
    if (process.env.DISCORD_ALLOWED_GUILDS) {
        allowedGuildIds = process.env.DISCORD_ALLOWED_GUILDS
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);
    }

    // Restricted server message
    const restrictedMessage = process.env.RESTRICTED_MESSAGE ||
        fileConfig.restrictedMessage ||
        'This bot is not authorized for this server.';

    // Bot owner ID for alerts (optional)
    const ownerId = process.env.BOT_OWNER_ID || fileConfig.ownerId || null;

    if (!clientId || !token) {
        console.error('Missing required config: clientId and token must be set via environment variables or config.json');
        process.exit(1);
    }

    return {
        clientId,
        token,
        allowedGuildIds,
        restrictedMessage,
        ownerId
    };
}

module.exports = loadConfig();
