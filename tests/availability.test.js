const test = require('node:test');
const assert = require('node:assert/strict');
const availability = require('../availabilityManager');

test('parses weekday windows and matches usersAvailableAt', () => {
    const guildId = 'guild1';
    availability.setAvailability(guildId, 'userA', { timezone: 'UTC-5', days: 'Mon 6pm-9pm', roles: '', notes: '' });
    availability.setAvailability(guildId, 'userB', { timezone: 'UTC', days: 'weekend 12-2pm', roles: '', notes: '' });
    const a = availability.getAvailability(guildId, 'userA');
    assert.ok(a && a.windows && a.windows.length > 0);
});
