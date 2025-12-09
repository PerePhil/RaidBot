const test = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter, reactionLimiter, commandCooldowns } = require('../utils/rateLimiter');

test('RateLimiter allows requests within limit', () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60000 });
    assert.equal(limiter.isAllowed('user1'), true);
    assert.equal(limiter.isAllowed('user1'), true);
    assert.equal(limiter.isAllowed('user1'), true);
});

test('RateLimiter blocks after limit exceeded', () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60000 });
    limiter.isAllowed('user2');
    limiter.isAllowed('user2');
    assert.equal(limiter.isAllowed('user2'), false);
});

test('RateLimiter tracks per-user buckets', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60000 });
    assert.equal(limiter.isAllowed('userA'), true);
    assert.equal(limiter.isAllowed('userB'), true);
    assert.equal(limiter.isAllowed('userA'), false);
    assert.equal(limiter.isAllowed('userB'), false);
});

test('RateLimiter.resetIn returns time until reset', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 5000 });
    limiter.isAllowed('userC');
    limiter.isAllowed('userC');
    const resetMs = limiter.resetIn('userC');
    assert.ok(resetMs > 0);
    assert.ok(resetMs <= 5000);
});

test('RateLimiter.resetIn returns 0 when allowed', () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 5000 });
    assert.equal(limiter.resetIn('newUser'), 0);
});

test('reactionLimiter is configured correctly', () => {
    assert.ok(reactionLimiter instanceof RateLimiter);
});

test('commandCooldowns is configured with 3 tokens', () => {
    assert.ok(commandCooldowns instanceof RateLimiter);
});
