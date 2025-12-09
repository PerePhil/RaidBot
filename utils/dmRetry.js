/**
 * DM sender with retry logic and fallback notifications.
 */

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Attempts to send a DM to a user with retry logic.
 * @param {Client} client - Discord client
 * @param {string} userId - User ID to DM
 * @param {string|Object} message - Message content or options
 * @param {Object} options - Additional options
 * @param {string} options.fallbackChannelId - Channel to post in if DM fails
 * @param {string} options.guildId - Guild ID for member lookup
 * @returns {Promise<{success: boolean, method: string, error?: Error}>}
 */
async function sendDMWithRetry(client, userId, message, options = {}) {
    const content = typeof message === 'string' ? message : message.content;

    // Attempt DM with retries
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const user = await client.users.fetch(userId);
            await user.send(message);
            return { success: true, method: 'dm' };
        } catch (error) {
            const isLastAttempt = attempt === MAX_RETRIES;

            // Don't retry for specific errors
            if (error.code === 50007) { // Cannot send to this user (DMs disabled)
                break;
            }

            if (!isLastAttempt) {
                await sleep(RETRY_DELAY_MS * attempt);
            }
        }
    }

    // Fallback: try channel mention
    if (options.fallbackChannelId) {
        try {
            const channel = await client.channels.fetch(options.fallbackChannelId);
            if (channel) {
                await channel.send({
                    content: `<@${userId}> ${content}`,
                    allowedMentions: { users: [userId] }
                });
                return { success: true, method: 'channel' };
            }
        } catch (error) {
            console.error('Fallback channel notification failed:', error);
        }
    }

    // Final fallback: try via guild member
    if (options.guildId) {
        try {
            const guild = await client.guilds.fetch(options.guildId);
            const member = await guild.members.fetch(userId);
            await member.send(message);
            return { success: true, method: 'member' };
        } catch (error) {
            console.error('Member DM fallback failed:', error);
        }
    }

    return { success: false, method: 'none', error: new Error('All notification attempts failed') };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
    sendDMWithRetry
};
