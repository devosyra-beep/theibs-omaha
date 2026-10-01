'use strict';
// MODEL + HARNESS. Real LP/exact arithmetic; injected client transport is not a
// browser Worker or provider test. The required reference must never be skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const helper = require('./helpers/river-hu-expanded-contract-reference.cjs');
const fixtures = require('./helpers/solver-reference-fixtures.cjs');
const { available } = require('./helpers/sequence-form-reference.cjs');
const adapter = require('../src/solver/plo-river-game');
const core = require('../src/solver/extensive-solver');
const worker = require('../src/solver/job-worker');
const session = require('../src/multiway-session');
const { create: createBrowserClient } = require('../public/browser-solver-client');
const { createSolutionCache, keyFor } = require('../src/solver/solution-cache');
const cases = helper.scenarios();

test('required independent LP runtime is present (no skip or application dependency)', () => {
  assert.equal(available(), true, 'Set THEIBS_REFERENCE_PYTHON to the existing QA environment; the expanded LP gate cannot be skipped.');
});
for (const scenario of cases) test(`expanded HU river: ${scenario.id}`, () => {
  const result = helper.runReferenceCase(scenario);
  assert.equal(result.defaultVsTrustedBrowserFixedMathematicsEqual, true);
  assert.equal(result.independentTerminalAudit.worlds, result.build.worlds);
  if (scenario.reference) {
    assert.ok(result.actions.length >= 2);
    assert.ok(result.actions.every(action => action.fixedWorkCertifiedBounds.boundsToleranceBB === 0
      && action.fixedWorkCertifiedBounds.strictLPFeasibleEnvelopeContainment && action.fixedWorkCertifiedBounds.strictNumericLPPointContainment));
    assert.ok(result.actions.every(action => action.refinements.every(row => row.boundsToleranceBB === 0
      && row.strictExactBestResponseContainment && row.strictLPFeasibleEnvelopeContainment && row.strictNumericLPPointContainment)));
  } else assert.equal(result.referenceStatus, 'NOT_APPLICABLE_UNQUALIFIED_FEE_CLASS');
});

test('exact binary64 fractions and pure-policy oracle reproduce known mixed bounds', () => {
  assert.deepEqual(helper.fromNumber(.5), helper.fraction(1n, 2n));
  assert.equal(helper.compare(helper.fromNumber(.1), helper.fraction(1n, 10n)) > 0, true, 'The oracle must use supplied binary64, not silently replace it with a decimal rational.');
  const game = fixtures.matrixGame([[1, -1], [-1, 1]]);
  const envelope = helper.exactPolicyEnvelope(game, [{ row: { R0: .8, R1: .2 } }, { column: { C0: .4, C1: .6 } }]);
  assert.equal(helper.compare(envelope.lower, helper.fraction(-3n, 5n)), 0);
  assert.ok(Math.abs(helper.toNumber(envelope.upper) - .2) < 1e-15);
  assert.deepEqual(envelope.metrics.purePolicies, [2, 2]);
});

test('exact independent oracle respects hidden types rather than choosing by chance world', () => {
  const game = fixtures.privateTypeGame();
  const policy = [{ TYPE0: { A: 1, B: 0 }, TYPE1: { A: 1, B: 0 } }, { HIDDEN: { L: .5, R: .5 } }];
  const envelope = helper.exactPolicyEnvelope(game, policy);
  assert.equal(helper.compare(envelope.lower, helper.ZERO), 0);
  assert.equal(helper.compare(envelope.upper, helper.ZERO), 0);
  // A clairvoyant opponent could choose opposite moves in the two worlds and
  // obtain -1. The common HIDDEN information set permits only one shared move.
  assert.deepEqual(envelope.metrics.purePolicies, [4, 2]);
});

test('strict rational checks reject an excluded endpoint even below any usual LP epsilon', () => {
  const target = helper.fraction(1n, 2n);
  assert.throws(() => helper.assertOuterInterval(.5000000000000001, .6, target, target), /lower endpoint/);
  assert.throws(() => helper.assertOuterInterval(.4, .49999999999999994, target, target), /upper endpoint/);
  helper.assertOuterInterval(.5, .5, target, target);
});

test('exact QA enumeration enforces explicit resource caps and perfect recall', () => {
  const terminal = fixtures.terminal(0);
  const forgotten = () => fixtures.decision(0, 'forgotten', { A: terminal, B: terminal });
  const game = { playerCount: 2, root: fixtures.decision(0, 'earlier', { A: forgotten(), B: forgotten() }) };
  assert.throws(() => helper.inspect(game), /imperfect recall/i);
  const many = { playerCount: 2, root: fixtures.chance(Array.from({ length: 13 }, (_, index) => [1 / 13,
    fixtures.decision(0, 'type-' + index, { A: fixtures.terminal(0), B: fixtures.terminal(1) })])) };
  assert.throws(() => helper.inspect(many), /pure-policy cap/);
});

test('valid model changes invalidate exact cache/checkpoint context; transport changes preserve only mathematical identity', async () => {
  const base = cases.find(row => row.id === 'marginal_positive_call').input, original = adapter.coverage(base);
  const cache = createSolutionCache(), identity = keyFor({ game: original.key, heroInformationSet: original.heroInformationSet });
  await cache.put('qa-owner', identity, { game: original.key }, { game: original.key });
  const edits = [
    ['range weights', input => { input.ranges[1].combos[0].weight = .2; input.ranges[1].combos[1].weight = .8; }],
    ['range source', input => { input.ranges[1].source = 'DIFFERENT_EXPLICIT_STUDY'; }],
    ['fixed rake', input => { input.rake = { type: 'FIXED', amount: 8 }; }],
    ['before-fees basis', input => { input.rake.basis = 'NO_FEES'; }],
    ['sizing support', input => { input.sizing = { type: 'EXPLICIT_TOTALS', levels: [20], maxAggressions: 1 }; }],
    ['current call price', input => { input.multiway.events.at(-1).to = 11; }],
    ['historical pot', input => { input.multiway.events.find((event, index) => index > 6 && event.action === 'BET').to = 4; }],
    ['effective stack', input => { input.multiway.config.stacks = [20, 30]; }],
    ['river card', input => { input.multiway.events.find(event => event.type === 'BOARD' && event.cards.length === 5).cards[4] = '9d'; }],
    ['current Hero information set', input => {
      const other = ['Ks', '5s', '6s', '7h', 'Th']; input.ranges[0].combos.push({ cards: other, weight: 2 }); input.multiway.config.heroCards = other;
    }]
  ];
  for (const [label, edit] of edits) {
    const next = structuredClone(base); edit(next); const coverage = adapter.coverage(next);
    assert.equal(coverage.status, 'READY', label + ':' + JSON.stringify(coverage.reasons));
    const key = keyFor({ game: coverage.key, heroInformationSet: coverage.heroInformationSet });
    assert.notEqual(key, identity, label); assert.equal(await cache.get('qa-owner', key), null, label);
  }
  assert.equal(await cache.get('different-owner', identity), null);
  const newHand = structuredClone(base); newHand.multiway.handId = '00000000-0000-4000-8000-999999999999'; newHand.multiway.editEpoch = 1;
  const rebound = adapter.coverage(newHand);
  assert.equal(rebound.key, original.key); assert.equal(rebound.heroInformationSet, original.heroInformationSet);
  assert.notEqual(session.envelope(newHand.multiway).state.revisionKey, session.envelope(base.multiway).state.revisionKey);
});

test('HARNESS browser cache retains a real completed cold snapshot and misses each valid context/session/owner change', async () => {
  const fingerprint = createHash('sha256').update('THEIBS_EXPANDED_QA_INJECTED_NODE_TRANSPORT').digest('hex');
  const manifest = { schemaVersion: 1, buildFingerprint: fingerprint, versions: { solver: core.VERSION, adaptive: worker.VERSION } };
  const workers = [];
  const client = createBrowserClient({ manifest, crypto: webcrypto, createWorker: () => {
    const transport = { terminated: false, terminate() { this.terminated = true; }, postMessage(message) {
      const output = worker.execute({ input: message.input, budget: { timeMs: 5000, iterations: 128 }, checkpoint: message.checkpoint }, { compilationReuse: true });
      queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: { ...output, type: 'done', jobId: message.jobId,
        generation: message.generation, buildFingerprint: fingerprint, handId: message.input.multiway.handId, revisionKey: message.expectedRevisionKey } }); });
    } };
    workers.push(transport); queueMicrotask(() => transport.onmessage?.({ data: { type: 'ready', schemaVersion: 1, buildFingerprint: fingerprint } })); return transport;
  } });
  const binding = input => ({ handId: input.multiway.handId, revisionKey: session.envelope(input.multiway).state.revisionKey, budget: 'FAST', automatic: false });
  async function complete(owner, input, changed = {}) {
    let value = await client.start(owner, input, { ...binding(input), ...changed });
    for (let tries = 0; tries < 5 && !['COMPLETE', 'FAILED', 'UNSUPPORTED', 'CANCELLED'].includes(value.phase); tries++) value = await client.wait(owner, value.jobId, { afterVersion: value.updateVersion, waitMs: 1000 });
    assert.equal(value.phase, 'COMPLETE', value.reason); return value;
  }
  try {
    const input = structuredClone(cases.find(row => row.id === 'marginal_positive_call').input);
    const cold = await complete('owner-a', input), warm = await complete('owner-a', input);
    assert.equal(cold.cache.hit, false); assert.equal(warm.cache.hit, true); assert.equal(workers.length, 1);
    assert.deepEqual(warm.result, cold.result); assert.equal(warm.timing.workerMs, 0);
    const edits = [
      value => { value.ranges[1].combos[0].weight = .2; value.ranges[1].combos[1].weight = .8; },
      value => { value.rake = { type: 'FIXED', amount: 8 }; },
      value => { value.multiway.config.stacks = [20, 30]; },
      value => { value.multiway.events.at(-1).to = 11; },
      value => { value.rake.basis = 'NO_FEES'; }
    ];
    for (const edit of edits) { const value = structuredClone(input); edit(value); const next = await complete('owner-a', value); assert.equal(next.cache.hit, false); assert.equal((await complete('owner-a', value)).cache.hit, true); }
    assert.equal((await complete('owner-b', input)).cache.hit, false);
    assert.throws(() => client.get('owner-b', warm.jobId), /owner/);
    const newer = structuredClone(input); newer.multiway.editEpoch++;
    assert.equal((await complete('owner-a', newer)).cache.hit, false);
    const newHand = structuredClone(input); newHand.multiway.handId = '00000000-0000-4000-8000-888888888888';
    assert.equal((await complete('owner-a', newHand)).cache.hit, false);
    client.clearOwner('owner-a'); assert.equal((await complete('owner-a', input)).cache.hit, false);
  } finally { client.close(); }
});
