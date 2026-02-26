function isTeamBased(raidData) {
    return raidData?.type === 'key' || raidData?.type === 'challenge';
}

function getTeamColor(raidData) {
    return raidData?.type === 'challenge' ? '#FF0000' : '#FFD700';
}

function getTeamTypeLabel(raidData) {
    if (raidData?.type === 'challenge') {
        return raidData.bossName ? `Challenge Mode — ${raidData.bossName}` : 'Challenge Mode';
    }
    return raidData?.bossName ? `Gold Key Boss — ${raidData.bossName}` : 'Gold Key Boss';
}

module.exports = { isTeamBased, getTeamColor, getTeamTypeLabel };
