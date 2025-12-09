const { activeRaids } = require('./state');

let botClient = null;

function setPresenceClient(client) {
    botClient = client;
    updateBotPresence().catch(() => {});
}

function getPresenceClient() {
    return botClient;
}

async function updateBotPresence() {
    if (!botClient || !botClient.user) {
        return;
    }

    const raidCount = Array.from(activeRaids.values()).filter((raidData) => !raidData.closed).length;
    const pluralized = raidCount === 1 ? 'raid' : 'raids';
    const activityName = `Hosting ${raidCount} ${pluralized}`;

    try {
        await botClient.user.setPresence({
            activities: [{ name: activityName }],
            status: 'online'
        });
    } catch (error) {
        // Presence updates can fail if the client is not ready or permissions are missing.
        console.error('Failed to update bot presence:', error);
    }
}

module.exports = {
    setPresenceClient,
    updateBotPresence,
    getPresenceClient
};
