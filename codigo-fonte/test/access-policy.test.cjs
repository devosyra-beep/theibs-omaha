'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DAY_MS, evaluateAccess } = require('../src/access-policy');

const now = Date.parse('2026-09-26T12:00:00Z');
const user = { id: 'u-1', email: 'cliente@example.com', created_at: new Date(now - 2 * DAY_MS).toISOString() };

test('trial libera exatamente os três primeiros dias e expira no limite', () => {
  const active = evaluateAccess({ user, now, trialDays: 3 });
  assert.equal(active.allowed, true); assert.equal(active.state, 'TRIAL'); assert.equal(active.daysRemaining, 1);
  const expired = evaluateAccess({ user, now: Date.parse(user.created_at) + 3 * DAY_MS, trialDays: 3 });
  assert.equal(expired.allowed, false); assert.equal(expired.state, 'EXPIRED');
});

test('assinatura ativa e acesso vitalício vencem a regra do trial', () => {
  const oldUser = { ...user, created_at: new Date(now - 50 * DAY_MS).toISOString() };
  assert.equal(evaluateAccess({ user: oldUser, entitlement: { status: 'ACTIVE' }, now }).state, 'ACTIVE');
  assert.equal(evaluateAccess({ user: oldUser, lifetimeEmails: ' DEVOSYRA@GMAIL.COM ', now,
    entitlement: null, trialDays: 3, lifetimeUserIds: '' }).allowed, false);
  assert.equal(evaluateAccess({ user: { ...oldUser, email: 'devosyra@gmail.com' }, lifetimeEmails: ' DEVOSYRA@GMAIL.COM ', now }).state, 'LIFETIME');
  assert.equal(evaluateAccess({ user: { ...oldUser, email: 'ninjadevtester@gmail.com' },
    lifetimeEmails: 'devosyra@gmail.com,ninjadevtester@gmail.com', now }).state, 'LIFETIME');
  assert.equal(evaluateAccess({ user: oldUser, entitlement: { access_kind: 'LIFETIME' }, now }).state, 'LIFETIME');
});

test('assinatura com período encerrado não libera acesso', () => {
  const oldUser = { ...user, created_at: new Date(now - 50 * DAY_MS).toISOString() };
  const result = evaluateAccess({ user: oldUser, entitlement: { status: 'ACTIVE', current_period_end: new Date(now - 1).toISOString() }, now });
  assert.equal(result.allowed, false); assert.equal(result.state, 'EXPIRED');
});
