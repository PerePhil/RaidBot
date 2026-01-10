/**
 * Prometheus-compatible metrics for WizBot
 * Provides observability into bot performance and usage
 *
 * Access metrics at: GET /metrics endpoint (if you add an HTTP server)
 * Or log periodically for monitoring systems to scrape
 */

const { logger } = require('./logger');

// Metric storage
const metrics = {
    // Counters
    reactions_total: new Map(), // key: 'add|remove' -> count
    commands_total: new Map(), // key: commandName -> count
    dm_failures_total: 0,
    raids_created_total: 0,
    raids_closed_total: 0,
    waitlist_promotions_total: 0,

    // Histograms (stored as buckets)
    command_duration_seconds: new Map(), // key: commandName -> [durations]
    db_query_duration_seconds: [], // array of durations

    // Gauges
    active_raids_gauge: 0,
    participants_gauge: 0
};

/**
 * Increment a counter metric
 */
function incrementCounter(name, labels = {}) {
    const key = formatLabels(labels);

    switch (name) {
        case 'reactions_total':
            metrics.reactions_total.set(key, (metrics.reactions_total.get(key) || 0) + 1);
            break;
        case 'commands_total':
            metrics.commands_total.set(key, (metrics.commands_total.get(key) || 0) + 1);
            break;
        case 'dm_failures_total':
            metrics.dm_failures_total++;
            break;
        case 'raids_created_total':
            metrics.raids_created_total++;
            break;
        case 'raids_closed_total':
            metrics.raids_closed_total++;
            break;
        case 'waitlist_promotions_total':
            metrics.waitlist_promotions_total++;
            break;
        default:
            logger.warn(`Unknown metric: ${name}`);
    }
}

/**
 * Record a histogram observation
 */
function recordHistogram(name, value, labels = {}) {
    const key = formatLabels(labels);

    switch (name) {
        case 'command_duration_seconds':
            if (!metrics.command_duration_seconds.has(key)) {
                metrics.command_duration_seconds.set(key, []);
            }
            metrics.command_duration_seconds.get(key).push(value);
            // Keep only last 1000 samples per command to prevent unbounded growth
            const samples = metrics.command_duration_seconds.get(key);
            if (samples.length > 1000) {
                samples.shift();
            }
            break;
        case 'db_query_duration_seconds':
            metrics.db_query_duration_seconds.push(value);
            if (metrics.db_query_duration_seconds.length > 10000) {
                metrics.db_query_duration_seconds.shift();
            }
            break;
        default:
            logger.warn(`Unknown histogram: ${name}`);
    }
}

/**
 * Set a gauge value
 */
function setGauge(name, value) {
    switch (name) {
        case 'active_raids_gauge':
            metrics.active_raids_gauge = value;
            break;
        case 'participants_gauge':
            metrics.participants_gauge = value;
            break;
        default:
            logger.warn(`Unknown gauge: ${name}`);
    }
}

/**
 * Format labels for use as Map key
 */
function formatLabels(labels) {
    return Object.entries(labels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
}

/**
 * Calculate histogram statistics
 */
function calculateHistogramStats(values) {
    if (values.length === 0) {
        return { count: 0, sum: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
        count,
        sum,
        p50: sorted[Math.floor(count * 0.50)] || 0,
        p95: sorted[Math.floor(count * 0.95)] || 0,
        p99: sorted[Math.floor(count * 0.99)] || 0
    };
}

/**
 * Generate Prometheus-formatted metrics output
 */
function generatePrometheusMetrics() {
    const lines = [];

    // Counters
    lines.push('# HELP wizbot_reactions_total Total number of reactions processed');
    lines.push('# TYPE wizbot_reactions_total counter');
    for (const [labels, value] of metrics.reactions_total.entries()) {
        lines.push(`wizbot_reactions_total{${labels}} ${value}`);
    }

    lines.push('# HELP wizbot_commands_total Total number of commands executed');
    lines.push('# TYPE wizbot_commands_total counter');
    for (const [labels, value] of metrics.commands_total.entries()) {
        lines.push(`wizbot_commands_total{${labels}} ${value}`);
    }

    lines.push('# HELP wizbot_dm_failures_total Total number of DM delivery failures');
    lines.push('# TYPE wizbot_dm_failures_total counter');
    lines.push(`wizbot_dm_failures_total ${metrics.dm_failures_total}`);

    lines.push('# HELP wizbot_raids_created_total Total number of raids created');
    lines.push('# TYPE wizbot_raids_created_total counter');
    lines.push(`wizbot_raids_created_total ${metrics.raids_created_total}`);

    lines.push('# HELP wizbot_raids_closed_total Total number of raids closed');
    lines.push('# TYPE wizbot_raids_closed_total counter');
    lines.push(`wizbot_raids_closed_total ${metrics.raids_closed_total}`);

    lines.push('# HELP wizbot_waitlist_promotions_total Total number of waitlist promotions');
    lines.push('# TYPE wizbot_waitlist_promotions_total counter');
    lines.push(`wizbot_waitlist_promotions_total ${metrics.waitlist_promotions_total}`);

    // Histograms
    lines.push('# HELP wizbot_command_duration_seconds Command execution duration');
    lines.push('# TYPE wizbot_command_duration_seconds summary');
    for (const [labels, values] of metrics.command_duration_seconds.entries()) {
        const stats = calculateHistogramStats(values);
        lines.push(`wizbot_command_duration_seconds_count{${labels}} ${stats.count}`);
        lines.push(`wizbot_command_duration_seconds_sum{${labels}} ${stats.sum.toFixed(3)}`);
        lines.push(`wizbot_command_duration_seconds{${labels},quantile="0.5"} ${stats.p50.toFixed(3)}`);
        lines.push(`wizbot_command_duration_seconds{${labels},quantile="0.95"} ${stats.p95.toFixed(3)}`);
        lines.push(`wizbot_command_duration_seconds{${labels},quantile="0.99"} ${stats.p99.toFixed(3)}`);
    }

    const dbStats = calculateHistogramStats(metrics.db_query_duration_seconds);
    lines.push('# HELP wizbot_db_query_duration_seconds Database query duration');
    lines.push('# TYPE wizbot_db_query_duration_seconds summary');
    lines.push(`wizbot_db_query_duration_seconds_count ${dbStats.count}`);
    lines.push(`wizbot_db_query_duration_seconds_sum ${dbStats.sum.toFixed(3)}`);
    lines.push(`wizbot_db_query_duration_seconds{quantile="0.5"} ${dbStats.p50.toFixed(3)}`);
    lines.push(`wizbot_db_query_duration_seconds{quantile="0.95"} ${dbStats.p95.toFixed(3)}`);
    lines.push(`wizbot_db_query_duration_seconds{quantile="0.99"} ${dbStats.p99.toFixed(3)}`);

    // Gauges
    lines.push('# HELP wizbot_active_raids Current number of active raids');
    lines.push('# TYPE wizbot_active_raids gauge');
    lines.push(`wizbot_active_raids ${metrics.active_raids_gauge}`);

    lines.push('# HELP wizbot_participants Current number of raid participants');
    lines.push('# TYPE wizbot_participants gauge');
    lines.push(`wizbot_participants ${metrics.participants_gauge}`);

    return lines.join('\n') + '\n';
}

/**
 * Get current metrics as JSON (for logging/debugging)
 */
function getMetricsJSON() {
    return {
        counters: {
            reactions_total: Object.fromEntries(metrics.reactions_total),
            commands_total: Object.fromEntries(metrics.commands_total),
            dm_failures_total: metrics.dm_failures_total,
            raids_created_total: metrics.raids_created_total,
            raids_closed_total: metrics.raids_closed_total,
            waitlist_promotions_total: metrics.waitlist_promotions_total
        },
        histograms: {
            command_duration_seconds: Array.from(metrics.command_duration_seconds.entries()).map(([labels, values]) => ({
                labels,
                ...calculateHistogramStats(values)
            })),
            db_query_duration_seconds: calculateHistogramStats(metrics.db_query_duration_seconds)
        },
        gauges: {
            active_raids_gauge: metrics.active_raids_gauge,
            participants_gauge: metrics.participants_gauge
        },
        timestamp: new Date().toISOString()
    };
}

/**
 * Reset all metrics (useful for testing)
 */
function resetMetrics() {
    metrics.reactions_total.clear();
    metrics.commands_total.clear();
    metrics.dm_failures_total = 0;
    metrics.raids_created_total = 0;
    metrics.raids_closed_total = 0;
    metrics.waitlist_promotions_total = 0;
    metrics.command_duration_seconds.clear();
    metrics.db_query_duration_seconds = [];
    metrics.active_raids_gauge = 0;
    metrics.participants_gauge = 0;
}

/**
 * Start periodic metrics logging (every 5 minutes)
 */
function startMetricsLogging(intervalMs = 5 * 60 * 1000) {
    setInterval(() => {
        logger.info('Metrics snapshot', getMetricsJSON());
    }, intervalMs);
    logger.info('Started metrics logging', { intervalMs });
}

module.exports = {
    incrementCounter,
    recordHistogram,
    setGauge,
    generatePrometheusMetrics,
    getMetricsJSON,
    resetMetrics,
    startMetricsLogging
};
