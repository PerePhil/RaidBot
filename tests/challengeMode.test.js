const test = require('node:test');
const assert = require('node:assert');
const { isTeamBased, getTeamColor, getTeamTypeLabel } = require('../utils/raidTypes');

test('Challenge Mode Types', async (t) => {
    await t.test('isTeamBased returns true for key and challenge', () => {
        assert.strictEqual(isTeamBased({ type: 'key' }), true);
        assert.strictEqual(isTeamBased({ type: 'challenge' }), true);
        assert.strictEqual(isTeamBased({ type: 'raid' }), false);
        assert.strictEqual(isTeamBased({ type: 'museum' }), false);
        assert.strictEqual(isTeamBased(null), false);
    });

    await t.test('getTeamColor returns correct colors', () => {
        assert.strictEqual(getTeamColor({ type: 'challenge' }), '#FF0000');
        assert.strictEqual(getTeamColor({ type: 'key' }), '#FFD700');
        // Default to gold if unknown but handled by team logic
        assert.strictEqual(getTeamColor({ type: 'raid' }), '#FFD700');
    });

    await t.test('getTeamTypeLabel returns correct labels', () => {
        assert.strictEqual(getTeamTypeLabel({ type: 'challenge', bossName: 'Mount Olympus' }), 'Challenge Mode — Mount Olympus');
        assert.strictEqual(getTeamTypeLabel({ type: 'challenge' }), 'Challenge Mode');
        assert.strictEqual(getTeamTypeLabel({ type: 'key', bossName: 'Rattlebones' }), 'Gold Key Boss — Rattlebones');
        assert.strictEqual(getTeamTypeLabel({ type: 'key' }), 'Gold Key Boss');
    });
});
