const test = require('node:test');
const assert = require('node:assert/strict');
const { getAdminRoles, setAdminRoles, setCommandRoles, getCommandRoles } = require('../state');

function mockMember(roleIds = [], manage = false, ownerId = null, userId = 'user') {
    return {
        user: { id: userId },
        roles: {
            cache: {
                some: (fn) => roleIds.some((id) => fn({ id })),
                map: new Map(roleIds.map((id) => [id, { id }]))
            }
        },
        permissions: { has: (perm) => manage && perm === 'ManageGuild' },
        guild: { ownerId }
    };
}

test('command role overrides allow access', () => {
    setAdminRoles('g1', []);
    setCommandRoles('g1', 'raid', ['roleA']);
    const cmdRoles = getCommandRoles('g1', 'raid');
    assert.ok(cmdRoles.has('roleA'));
    const member = mockMember(['roleA'], false, 'ownerX', 'userX');
    const hasCmdRole = cmdRoles.size > 0 && member.roles.cache.some((role) => cmdRoles.has(role.id));
    assert.equal(hasCmdRole, true);
});
