/**
 * Discord-based alerting system for WizBot
 * Sends DMs to the bot owner when performance issues are detected
 */

const { logger } = require('./logger');
const { getMetricsJSON } = require('./metrics');
const { getCircuitBreakerStats } = require('./circuitBreaker');

// Alert configuration
const ALERT_CONFIG = {
    // Owner user ID (set via environment variable or config)
    ownerId: process.env.BOT_OWNER_ID || null,

    // Alert thresholds
    thresholds: {
        commandLatencyP95: 2.0,        // Alert if p95 > 2 seconds
        dmFailureRate: 0.15,           // Alert if >15% DM failure rate
        activeRaidsHigh: 50,           // Alert if >50 active raids
        memoryUsageMB: 512,            // Alert if >512MB RAM
        circuitBreakerOpen: true       // Alert when circuit breaker opens
    },

    // Alert cooldowns (prevent spam)
    cooldowns: {
        commandLatency: 15 * 60 * 1000,    // 15 minutes
        dmFailureRate: 30 * 60 * 1000,     // 30 minutes
        activeRaidsHigh: 60 * 60 * 1000,   // 1 hour
        memoryUsage: 30 * 60 * 1000,       // 30 minutes
        circuitBreaker: 10 * 60 * 1000     // 10 minutes
    }
};

// Track last alert times to implement cooldowns
const lastAlertTimes = new Map();

// Track circuit breaker states to detect changes
let lastCircuitBreakerStates = {};

/**
 * Initialize the alerting system
 * @param {Client} client - Discord client
 * @param {string} ownerId - Bot owner user ID
 */
function initializeAlerts(client, ownerId) {
    if (ownerId) {
        ALERT_CONFIG.ownerId = ownerId;
    }

    if (!ALERT_CONFIG.ownerId) {
        logger.warn('Bot owner ID not set - alerts will not be sent. Set BOT_OWNER_ID environment variable.');
        return;
    }

    logger.info('Alert system initialized', { ownerId: ALERT_CONFIG.ownerId });

    // Check alerts every 2 minutes
    setInterval(() => checkAlerts(client), 2 * 60 * 1000);

    // Daily health report at 9 AM (if running)
    setInterval(() => sendDailyReport(client), 60 * 60 * 1000); // Check every hour
}

/**
 * Check all alert conditions
 */
async function checkAlerts(client) {
    if (!ALERT_CONFIG.ownerId) return;

    try {
        const metrics = getMetricsJSON();
        const circuitBreakers = getCircuitBreakerStats();
        const memoryUsage = process.memoryUsage();

        // Check circuit breaker states
        await checkCircuitBreakerAlerts(client, circuitBreakers);

        // Check command latency
        await checkCommandLatency(client, metrics);

        // Check DM failure rate
        await checkDMFailureRate(client, metrics);

        // Check active raids
        await checkActiveRaids(client, metrics);

        // Check memory usage
        await checkMemoryUsage(client, memoryUsage);

    } catch (error) {
        logger.error('Alert check failed', { error });
    }
}

/**
 * Check circuit breaker states
 */
async function checkCircuitBreakerAlerts(client, circuitBreakers) {
    for (const [name, state] of Object.entries(circuitBreakers)) {
        const key = `circuitBreaker_${name}`;
        const previousState = lastCircuitBreakerStates[name];

        // Detect state change to OPEN
        if (state.state === 'OPEN' && previousState !== 'OPEN') {
            if (canSendAlert(key)) {
                await sendAlert(client, {
                    title: '⚠️ Circuit Breaker Opened',
                    description: `The **${name}** circuit breaker has opened due to repeated failures.`,
                    fields: [
                        { name: 'State', value: state.state, inline: true },
                        { name: 'Failure Count', value: state.failureCount.toString(), inline: true },
                        { name: 'Next Retry', value: `<t:${Math.floor(state.nextAttempt / 1000)}:R>`, inline: true },
                        { name: 'Total Requests', value: state.stats.requests.toString(), inline: true },
                        { name: 'Rejections', value: state.stats.rejections.toString(), inline: true }
                    ],
                    color: 0xED4245 // Red
                });
                markAlertSent(key);
            }
        }

        // Detect recovery (OPEN -> CLOSED)
        if (state.state === 'CLOSED' && previousState === 'OPEN') {
            await sendAlert(client, {
                title: '✅ Circuit Breaker Recovered',
                description: `The **${name}** circuit breaker has closed and service is restored.`,
                fields: [
                    { name: 'State', value: state.state, inline: true },
                    { name: 'Success Count', value: state.successCount.toString(), inline: true }
                ],
                color: 0x57F287 // Green
            });
        }

        lastCircuitBreakerStates[name] = state.state;
    }
}

/**
 * Check command latency
 */
async function checkCommandLatency(client, metrics) {
    const commandDurations = metrics.histograms.command_duration_seconds;

    for (const cmd of commandDurations) {
        if (cmd.p95 > ALERT_CONFIG.thresholds.commandLatencyP95) {
            const key = `commandLatency_${cmd.labels}`;
            if (canSendAlert(key)) {
                await sendAlert(client, {
                    title: '⚠️ High Command Latency',
                    description: `Command execution is taking longer than expected.`,
                    fields: [
                        { name: 'Command', value: cmd.labels || 'Unknown', inline: true },
                        { name: 'P95 Latency', value: `${cmd.p95.toFixed(2)}s`, inline: true },
                        { name: 'Threshold', value: `${ALERT_CONFIG.thresholds.commandLatencyP95}s`, inline: true },
                        { name: 'P50 Latency', value: `${cmd.p50.toFixed(2)}s`, inline: true },
                        { name: 'Count', value: cmd.count.toString(), inline: true }
                    ],
                    color: 0xFEE75C // Yellow
                });
                markAlertSent(key);
            }
        }
    }
}

/**
 * Check DM failure rate
 */
async function checkDMFailureRate(client, metrics) {
    const dmFailures = metrics.counters.dm_failures_total;
    const waitlistPromotions = metrics.counters.waitlist_promotions_total;

    if (waitlistPromotions > 0) {
        const failureRate = dmFailures / waitlistPromotions;

        if (failureRate > ALERT_CONFIG.thresholds.dmFailureRate) {
            const key = 'dmFailureRate';
            if (canSendAlert(key)) {
                await sendAlert(client, {
                    title: '⚠️ High DM Failure Rate',
                    description: `Many DMs are failing to deliver to users.`,
                    fields: [
                        { name: 'Failure Rate', value: `${(failureRate * 100).toFixed(1)}%`, inline: true },
                        { name: 'Threshold', value: `${(ALERT_CONFIG.thresholds.dmFailureRate * 100).toFixed(1)}%`, inline: true },
                        { name: 'Failed DMs', value: dmFailures.toString(), inline: true },
                        { name: 'Total Attempts', value: waitlistPromotions.toString(), inline: true }
                    ],
                    color: 0xFEE75C // Yellow
                });
                markAlertSent(key);
            }
        }
    }
}

/**
 * Check active raids count
 */
async function checkActiveRaids(client, metrics) {
    const activeRaids = metrics.gauges.active_raids_gauge;

    if (activeRaids > ALERT_CONFIG.thresholds.activeRaidsHigh) {
        const key = 'activeRaidsHigh';
        if (canSendAlert(key)) {
            await sendAlert(client, {
                title: '📊 High Active Raids',
                description: `There are an unusually high number of active raids.`,
                fields: [
                    { name: 'Active Raids', value: activeRaids.toString(), inline: true },
                    { name: 'Threshold', value: ALERT_CONFIG.thresholds.activeRaidsHigh.toString(), inline: true },
                    { name: 'Participants', value: metrics.gauges.participants_gauge.toString(), inline: true }
                ],
                color: 0x5865F2 // Blurple
            });
            markAlertSent(key);
        }
    }
}

/**
 * Check memory usage
 */
async function checkMemoryUsage(client, memoryUsage) {
    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;

    if (heapUsedMB > ALERT_CONFIG.thresholds.memoryUsageMB) {
        const key = 'memoryUsage';
        if (canSendAlert(key)) {
            await sendAlert(client, {
                title: '⚠️ High Memory Usage',
                description: `Bot is using more memory than expected.`,
                fields: [
                    { name: 'Heap Used', value: `${heapUsedMB.toFixed(1)} MB`, inline: true },
                    { name: 'Threshold', value: `${ALERT_CONFIG.thresholds.memoryUsageMB} MB`, inline: true },
                    { name: 'RSS', value: `${(memoryUsage.rss / 1024 / 1024).toFixed(1)} MB`, inline: true },
                    { name: 'External', value: `${(memoryUsage.external / 1024 / 1024).toFixed(1)} MB`, inline: true }
                ],
                color: 0xED4245 // Red
            });
            markAlertSent(key);
        }
    }
}

/**
 * Send daily health report
 */
async function sendDailyReport(client) {
    if (!ALERT_CONFIG.ownerId) return;

    const now = new Date();
    // Send at 9 AM local time
    if (now.getHours() !== 9 || now.getMinutes() > 5) return;

    // Check if we already sent today
    const key = `dailyReport_${now.toDateString()}`;
    if (lastAlertTimes.has(key)) return;

    try {
        const metrics = getMetricsJSON();
        const circuitBreakers = getCircuitBreakerStats();
        const memoryUsage = process.memoryUsage();
        const uptime = process.uptime();

        const uptimeDays = Math.floor(uptime / 86400);
        const uptimeHours = Math.floor((uptime % 86400) / 3600);

        await sendAlert(client, {
            title: '📊 Daily Health Report',
            description: `Bot health summary for ${now.toLocaleDateString()}`,
            fields: [
                { name: '⏱️ Uptime', value: `${uptimeDays}d ${uptimeHours}h`, inline: true },
                { name: '🎮 Active Raids', value: metrics.gauges.active_raids_gauge.toString(), inline: true },
                { name: '👥 Participants', value: metrics.gauges.participants_gauge.toString(), inline: true },
                { name: '📝 Commands', value: metrics.counters.commands_total ? Object.values(metrics.counters.commands_total).reduce((a, b) => a + b, 0).toString() : '0', inline: true },
                { name: '🎯 Reactions', value: metrics.counters.reactions_total ? Object.values(metrics.counters.reactions_total).reduce((a, b) => a + b, 0).toString() : '0', inline: true },
                { name: '📊 Raids Created', value: metrics.counters.raids_created_total.toString(), inline: true },
                { name: '✅ Raids Closed', value: metrics.counters.raids_closed_total.toString(), inline: true },
                { name: '💬 DM Failures', value: metrics.counters.dm_failures_total.toString(), inline: true },
                { name: '🔄 Promotions', value: metrics.counters.waitlist_promotions_total.toString(), inline: true },
                { name: '💾 Memory', value: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(1)} MB`, inline: true },
                { name: '🔌 Discord API', value: circuitBreakers.discordApi.state, inline: true },
                { name: '💌 DM Circuit', value: circuitBreakers.dm.state, inline: true }
            ],
            color: 0x57F287, // Green
            footer: { text: 'WizBot Health Monitor' }
        });

        markAlertSent(key);
    } catch (error) {
        logger.error('Failed to send daily report', { error });
    }
}

/**
 * Check if an alert can be sent (respects cooldowns)
 */
function canSendAlert(key) {
    const lastTime = lastAlertTimes.get(key);
    if (!lastTime) return true;

    const cooldown = ALERT_CONFIG.cooldowns[key.split('_')[0]] || 15 * 60 * 1000;
    return Date.now() - lastTime > cooldown;
}

/**
 * Mark an alert as sent
 */
function markAlertSent(key) {
    lastAlertTimes.set(key, Date.now());
}

/**
 * Send alert DM to owner
 */
async function sendAlert(client, alertData) {
    if (!ALERT_CONFIG.ownerId) return;

    try {
        const owner = await client.users.fetch(ALERT_CONFIG.ownerId);
        const embed = {
            title: alertData.title,
            description: alertData.description,
            fields: alertData.fields || [],
            color: alertData.color || 0x5865F2,
            timestamp: new Date().toISOString(),
            footer: alertData.footer || { text: 'WizBot Alert System' }
        };

        await owner.send({ embeds: [embed] });
        logger.info('Alert sent to owner', { title: alertData.title });
    } catch (error) {
        logger.error('Failed to send alert to owner', { error });
    }
}

/**
 * Manually trigger an alert (for testing)
 */
async function sendTestAlert(client) {
    await sendAlert(client, {
        title: '🧪 Test Alert',
        description: 'This is a test alert to verify the alerting system is working.',
        fields: [
            { name: 'Status', value: '✅ Working', inline: true },
            { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
        ],
        color: 0x5865F2
    });
}

module.exports = {
    initializeAlerts,
    sendTestAlert,
    ALERT_CONFIG
};
