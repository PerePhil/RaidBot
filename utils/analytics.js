/**
 * Advanced analytics for raid participation tracking.
 * Uses Option B: All signups are counted as attended by default.
 */

const fs = require('fs');
const path = require('path');
const { dataPath, safeWriteFile } = require('../state');

const ANALYTICS_FILE = dataPath('analytics.json');

// In-memory analytics store
let analyticsData = {
    global: {
        totalRaids: 0,
        totalSignups: 0,
        raidsByWeek: {},  // 'YYYY-WW' -> count
        raidsByMonth: {}  // 'YYYY-MM' -> count
    },
    guilds: {}  // guildId -> analytics object
};

/**
 * Load analytics from disk
 */
function loadAnalytics() {
    try {
        if (fs.existsSync(ANALYTICS_FILE)) {
            analyticsData = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Failed to load analytics:', error.message);
    }
}

/**
 * Save analytics to disk
 */
function saveAnalytics() {
    try {
        safeWriteFile(ANALYTICS_FILE, JSON.stringify(analyticsData, null, 2));
    } catch (error) {
        console.error('Failed to save analytics:', error.message);
    }
}

/**
 * Get week number from date
 * @param {Date} date 
 * @returns {string} 'YYYY-WW' format
 */
function getWeekKey(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Get month key from date
 * @param {Date} date 
 * @returns {string} 'YYYY-MM' format
 */
function getMonthKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Initialize guild analytics if not exists
 * @param {string} guildId 
 */
function ensureGuildAnalytics(guildId) {
    if (!analyticsData.guilds[guildId]) {
        analyticsData.guilds[guildId] = {
            totalRaids: 0,
            totalSignups: 0,
            raidsByWeek: {},
            raidsByMonth: {},
            userStats: {}  // userId -> { signups, attended, noShows, lastActive }
        };
    }
}

/**
 * Record a completed raid for analytics.
 * Option B: All signups are assumed to have attended.
 * @param {Object} raidData - The raid data
 */
function recordRaidAnalytics(raidData) {
    if (!raidData || !raidData.signups) return;

    const guildId = raidData.guildId;
    const timestamp = raidData.timestamp ? raidData.timestamp * 1000 : Date.now();
    const weekKey = getWeekKey(new Date(timestamp));
    const monthKey = getMonthKey(new Date(timestamp));

    // Get all signup user IDs
    let userIds = [];
    if (raidData.type === 'museum') {
        userIds = raidData.signups;
    } else {
        raidData.signups.forEach((role) => {
            if (role.users) {
                userIds.push(...role.users);
            }
        });
    }

    // Update global stats
    analyticsData.global.totalRaids++;
    analyticsData.global.totalSignups += userIds.length;
    analyticsData.global.raidsByWeek[weekKey] = (analyticsData.global.raidsByWeek[weekKey] || 0) + 1;
    analyticsData.global.raidsByMonth[monthKey] = (analyticsData.global.raidsByMonth[monthKey] || 0) + 1;

    // Update guild stats
    if (guildId) {
        ensureGuildAnalytics(guildId);
        const guild = analyticsData.guilds[guildId];

        guild.totalRaids++;
        guild.totalSignups += userIds.length;
        guild.raidsByWeek[weekKey] = (guild.raidsByWeek[weekKey] || 0) + 1;
        guild.raidsByMonth[monthKey] = (guild.raidsByMonth[monthKey] || 0) + 1;

        // Update per-user stats (Option B: signups = attended)
        userIds.forEach((userId) => {
            if (!guild.userStats[userId]) {
                guild.userStats[userId] = { signups: 0, attended: 0, noShows: 0, lastActive: null };
            }
            guild.userStats[userId].signups++;
            guild.userStats[userId].attended++;  // Option B: assume attended
            guild.userStats[userId].lastActive = timestamp;
        });
    }

    saveAnalytics();
}

/**
 * Get attendance rate for a user
 * @param {string} guildId 
 * @param {string} userId 
 * @returns {number} Attendance rate 0-1
 */
function getAttendanceRate(guildId, userId) {
    ensureGuildAnalytics(guildId);
    const stats = analyticsData.guilds[guildId].userStats[userId];
    if (!stats || stats.signups === 0) return 1;  // Perfect if no data
    return stats.attended / stats.signups;
}

/**
 * Get no-show rate for a user
 * @param {string} guildId 
 * @param {string} userId 
 * @returns {number} No-show rate 0-1
 */
function getNoShowRate(guildId, userId) {
    ensureGuildAnalytics(guildId);
    const stats = analyticsData.guilds[guildId].userStats[userId];
    if (!stats || stats.signups === 0) return 0;
    return stats.noShows / stats.signups;
}

/**
 * Generate weekly report
 * @param {string} guildId 
 * @param {number} weeksBack - How many weeks back (0 = current week)
 * @returns {Object} Report data
 */
function generateWeeklyReport(guildId, weeksBack = 0) {
    ensureGuildAnalytics(guildId);
    const guild = analyticsData.guilds[guildId];

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - (weeksBack * 7));
    const weekKey = getWeekKey(targetDate);

    const raidsThisWeek = guild.raidsByWeek[weekKey] || 0;

    // Get active users this week
    const weekStart = new Date(targetDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const activeUsers = Object.entries(guild.userStats)
        .filter(([, stats]) => stats.lastActive && stats.lastActive >= weekStart.getTime())
        .length;

    // Top participants
    const topParticipants = Object.entries(guild.userStats)
        .map(([userId, stats]) => ({ userId, ...stats }))
        .sort((a, b) => b.signups - a.signups)
        .slice(0, 5);

    return {
        week: weekKey,
        totalRaids: raidsThisWeek,
        activeUsers,
        totalRaidsAllTime: guild.totalRaids,
        topParticipants
    };
}

/**
 * Generate monthly report
 * @param {string} guildId 
 * @param {number} monthsBack - How many months back (0 = current month)
 * @returns {Object} Report data
 */
function generateMonthlyReport(guildId, monthsBack = 0) {
    ensureGuildAnalytics(guildId);
    const guild = analyticsData.guilds[guildId];

    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() - monthsBack);
    const monthKey = getMonthKey(targetDate);

    const raidsThisMonth = guild.raidsByMonth[monthKey] || 0;

    // Get month boundaries
    const monthStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
    const monthEnd = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);

    const activeUsers = Object.entries(guild.userStats)
        .filter(([, stats]) =>
            stats.lastActive &&
            stats.lastActive >= monthStart.getTime() &&
            stats.lastActive <= monthEnd.getTime()
        )
        .length;

    // Calculate signup trends (compare to previous month)
    const prevMonthKey = getMonthKey(new Date(targetDate.getFullYear(), targetDate.getMonth() - 1, 1));
    const prevMonthRaids = guild.raidsByMonth[prevMonthKey] || 0;
    const trend = prevMonthRaids > 0 ? ((raidsThisMonth - prevMonthRaids) / prevMonthRaids * 100).toFixed(1) : null;

    return {
        month: monthKey,
        totalRaids: raidsThisMonth,
        previousMonthRaids: prevMonthRaids,
        trendPercent: trend,
        activeUsers,
        totalRaidsAllTime: guild.totalRaids
    };
}

/**
 * Export guild data to CSV format
 * @param {string} guildId 
 * @returns {string} CSV data
 */
function exportToCSV(guildId) {
    ensureGuildAnalytics(guildId);
    const guild = analyticsData.guilds[guildId];

    const headers = ['User ID', 'Total Signups', 'Attended', 'No Shows', 'Attendance Rate', 'Last Active'];
    const rows = Object.entries(guild.userStats)
        .map(([userId, stats]) => {
            const rate = stats.signups > 0 ? (stats.attended / stats.signups * 100).toFixed(1) : '100.0';
            const lastActive = stats.lastActive ? new Date(stats.lastActive).toISOString().split('T')[0] : 'Never';
            return `${userId},${stats.signups},${stats.attended},${stats.noShows},${rate}%,${lastActive}`;
        });

    return [headers.join(','), ...rows].join('\n');
}

/**
 * Get all analytics data for a guild
 * @param {string} guildId 
 * @returns {Object} Guild analytics
 */
function getGuildAnalytics(guildId) {
    ensureGuildAnalytics(guildId);
    return analyticsData.guilds[guildId];
}

module.exports = {
    loadAnalytics,
    saveAnalytics,
    recordRaidAnalytics,
    getAttendanceRate,
    getNoShowRate,
    generateWeeklyReport,
    generateMonthlyReport,
    exportToCSV,
    getGuildAnalytics
};
