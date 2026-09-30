'use strict';
// HARNESS: cache safety using valid replayed PLO5 river inputs. This does not
// measure solver accuracy, latency, production persistence or new coverage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const cacheModule = require('../src/solver/solution-cache');
const { createSolutionCache, keyFor } = cacheModule;
const { createSolverService } = require('../src/solver/job-service');
const adapter = require('../src/solver/plo-river-game');
const core = require('../src/solver/extensive-solver');
const worker = require('../src/solver/job-worker');
const session = require('../src/multiway-session');
const fixtures = require('./helpers/solver-reference-fixtures.cjs');

const clone = structuredClone;
function ready(input) {
  const covered = adapter.coverage(input);
  assert.equal(covered.status, 'READY', JSON.stringify(covered));
  // Exactly the supported-input identity used by job-service.start().
  return { ...covered, cacheKey: keyFor({ game: covered.key, heroInformationSet: covered.heroInformationSet }) };
}
function options(input, budget = 'FAST') {
  const observed = session.envelope(input.multiway);
  return { budget, handId: observed.multiway.handId, revisionKey: observed.state.revisionKey };
}
function changed(input, edit) { const next = clone(input); edit(next); return next; }
function checkedRiver({ playerCount = 2, heroPosition = 'SB', foldedSeat, stacks } = {}) {
  let observed = session.start({ variant: 'PLO5_HIGH', playerCount, heroPosition,
    startingStack: 100, smallBlind: .5, bigBlind: 1, heroCards: fixtures.heroCards,
    ...(stacks ? { stacks } : {}) });
  for (let step = 0; !(observed.state.street === 'RIVER' && observed.state.actor === observed.state.heroId); step++) {
    assert.ok(step < 40, 'fixture must reach a live river decision');
    const state = observed.state;
    observed = session.step(observed.multiway, state.phase === 'WAIT_BOARD'
      ? { type: 'BOARD', cards: fixtures.board.slice(0, { FLOP: 3, TURN: 4, RIVER: 5 }[state.nextStreet]) }
      : { type: 'ACT', actor: state.actor, action: state.actor === foldedSeat ? 'FOLD' : state.legal.toCall ? 'CALL' : 'CHECK' });
  }
  const remaining = [fixtures.weak, fixtures.strong];
  return { multiway: observed.multiway,
    ranges: Array.from({ length: playerCount }, (_, seatId) => fixtures.range(seatId,
      [[seatId === observed.state.heroId ? fixtures.heroCards : remaining.shift(), 1]])),
    sizing: { type: 'MIN_MID_MAX', maxAggressions: 0 }, rake: { type: 'NONE', basis: 'BEFORE_FEES' } };
}
async function temporaryDirectory(t) {
  const parent = path.resolve(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'theibs-cache-audit-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), parent);
    assert.ok(path.basename(directory).startsWith('theibs-cache-audit-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}
async function until(read, predicate) {
  const start = performance.now();
  while (performance.now() - start < 4000) {
    const value = read(); if (predicate(value)) return value; await delay(10);
  }
  assert.fail(`Expected lifecycle state, got ${JSON.stringify(read())}`);
}
async function fingerprintWorker(t) {
  const directory = await temporaryDirectory(t), file = path.join(directory, 'fingerprint-worker.cjs');
  await fs.writeFile(file, `
    const {parentPort}=require('node:worker_threads');
    const adapter=require(${JSON.stringify(require.resolve('../src/solver/plo-river-game'))});
    parentPort.on('message',({input,checkpoint})=>{
      const coverage=adapter.coverage(input),iterations=(checkpoint?.iterations||0)+1;
      const result={status:'APPROXIMATE',actions:[{id:'CHECK',frequency:1,evBB:1}],
        fingerprint:coverage.key,informationSet:coverage.heroInformationSet,iterations,
        resumedFrom:checkpoint?.fingerprint||null,qualification:{gto:false}};
      parentPort.postMessage({type:'done',result,checkpoint:{iterations,fingerprint:coverage.key},workerMs:1});
    });
  `);
  return file;
}
async function proveMisses(t, base, cases) {
  const baseline = ready(base), cache = createSolutionCache();
  await cache.put('owner', baseline.cacheKey, { marker: 'baseline' }, { marker: 'checkpoint' });
  for (const [name, input] of cases) await t.test(name, async () => {
    const candidate = ready(input);
    assert.notEqual(candidate.cacheKey, baseline.cacheKey, name);
    assert.equal(await cache.get('owner', candidate.cacheKey), null, `${name}: must not return old result or checkpoint`);
  });
  assert.equal((await cache.get('owner', baseline.cacheKey)).result.marker, 'baseline');
}

test('valid ledger, board, monetary scale and stack differences invalidate results and checkpoints', async t => {
  const base = fixtures.riverCallInput();
  await proveMisses(t, base, [
    ['river card', changed(base, x => { x.multiway.events.find(e => e.type === 'BOARD' && e.cards.length === 5).cards[4] = '9d'; })],
    ['flop card throughout board history', changed(base, x => { for (const e of x.multiway.events) if (e.type === 'BOARD') e.cards[0] = '5c'; })],
    ['current bet changes call price and pot', changed(base, x => { x.multiway.events.at(-1).to = 11; })],
    ['past raise changes contributed chips and pot', changed(base, x => { x.multiway.events.find(e => e.action === 'RAISE').to = 7; })],
    ['past turn bet changes stacks and pot', changed(base, x => { x.multiway.events.find((e, i) => i > 6 && e.action === 'BET').to = 4; })],
    ['small blind', changed(base, x => { x.multiway.config.smallBlind = .25; })],
    ['big blind and BB payoff unit', changed(base, x => { x.multiway.config.bigBlind = 2; })],
    ['starting stack', changed(base, x => { x.multiway.config.startingStack = 120; })],
    ['unequal per-seat stacks', changed(base, x => { x.multiway.config.stacks = [100, 80]; })],
    ['Hero effective stack', changed(base, x => { x.multiway.config.stacks = [80, 100]; })]
  ]);
  const historyA = changed(base, x => { x.multiway.events.find(e => e.action === 'RAISE').to = 4; });
  const historyB = changed(historyA, x => { x.multiway.events.find(e => e.action === 'BET').to = 1; });
  const stateA = session.envelope(historyA.multiway).state, stateB = session.envelope(historyB.multiway).state;
  assert.equal(stateA.pot, stateB.pot);
  assert.equal(stateA.legal.toCall, stateB.legal.toCall);
  assert.deepEqual(stateA.players.map(p => p.stack), stateB.players.map(p => p.stack));
  assert.notEqual(ready(historyA).cacheKey, ready(historyB).cacheKey,
    'same current chips are insufficient: the ordered public history is part of the declared boundary');
});

test('physical seats, original player count and folded blockers cannot share a cache entry', async t => {
  const base = checkedRiver();
  await proveMisses(t, base, [
    ['Hero and opponent positions', checkedRiver({ heroPosition: 'BB' })],
    ['three original seats', checkedRiver({ playerCount: 3 })],
    ['three original seats including a folded seat', checkedRiver({ playerCount: 3, foldedSeat: 2 })]
  ]);
  const folded = checkedRiver({ playerCount: 3, foldedSeat: 2 });
  const changedFoldedRange = changed(folded, x => { x.ranges[2].combos[0].cards[4] = '5d'; });
  assert.notEqual(ready(folded).cacheKey, ready(changedFoldedRange).cacheKey,
    'folded-player private cards still affect joint blocker conditioning');
});

test('finite range support, relative weights and current Hero information set have distinct identities', async t => {
  const base = fixtures.riverMixedInput();
  await proveMisses(t, base, [
    ['opponent relative weight', changed(base, x => { x.ranges[1].combos[1].weight = 3; })],
    ['Hero relative weight', changed(base, x => { x.ranges[0].combos[1].weight = 3; })],
    ['opponent combo', changed(base, x => { x.ranges[1].combos[0].cards[2] = '6c'; })],
    ['Hero range support', changed(base, x => { x.ranges[0].combos[1].cards[0] = '5c'; })],
    ['range ownership by physical seat', changed(base, x => {
      x.ranges.forEach(r => { r.seatId = 1 - r.seatId; });
      x.multiway.config.heroCards = [...x.ranges.find(r => r.seatId === 0).combos[0].cards];
    })],
    ['joint private-card blockers', changed(base, x => { x.ranges[1].combos[0].cards[0] = '5s'; })],
    ['range provenance retained in declared study', changed(base, x => { x.ranges[1].source = 'USER_DEFINED_REVISION_2'; })]
  ]);
  const alternateHero = changed(base, x => { x.multiway.config.heroCards = [...x.ranges[0].combos[1].cards]; });
  assert.equal(ready(base).key, ready(alternateHero).key, 'full-prior game keeps both Hero combinations');
  assert.notEqual(ready(base).heroInformationSet, ready(alternateHero).heroInformationSet);
  assert.notEqual(ready(base).cacheKey, ready(alternateHero).cacheKey,
    'rendered action values and private-infoset commitments must not use another Hero combo');
});

test('sizing trees, aggression caps and every declared fee field invalidate their cache context', async t => {
  const base = fixtures.riverMixedInput();
  await proveMisses(t, base, [
    ['aggression depth', changed(base, x => { x.sizing.maxAggressions = 2; })],
    ['explicit action abstraction', changed(base, x => { x.sizing = { type: 'EXPLICIT_TOTALS', levels: [1, 2], maxAggressions: 1 }; })],
    ['before-fees versus explicit no-fees basis', changed(base, x => { x.rake.basis = 'NO_FEES'; })],
    ['fixed fee', changed(base, x => { x.rake = { type: 'FIXED', amount: .1 }; })]
  ]);
  const explicit = changed(base, x => { x.sizing = { type: 'EXPLICIT_TOTALS', levels: [1, 2], maxAggressions: 1 }; });
  assert.notEqual(ready(explicit).cacheKey, ready(changed(explicit, x => { x.sizing.levels = [1, 1.5]; })).cacheKey);
  const fixed = changed(base, x => { x.rake = { type: 'FIXED', amount: .1 }; });
  assert.notEqual(ready(fixed).cacheKey, ready(changed(fixed, x => { x.rake.amount = .3; })).cacheKey);
  const capped = changed(base, x => { x.rake = { type: 'PERCENT_CAPPED', rate: .05, cap: 1,
    noFlopNoDrop: true, rounding: 'FLOOR_CENT', source: 'USER_PROVIDED', version: '1' }; });
  await proveMisses(t, capped, [
    ['fee rate', changed(capped, x => { x.rake.rate = .1; })],
    ['fee cap', changed(capped, x => { x.rake.cap = .5; })],
    ['fee rounding', changed(capped, x => { x.rake.rounding = 'NEAREST_CENT'; })],
    ['no-flop policy provenance', changed(capped, x => { x.rake.noFlopNoDrop = false; })],
    ['fee source', changed(capped, x => { x.rake.source = 'SYNTHETIC_STUDY'; })]
  ]);
});

test('equivalent transport, serialization and normalized-range order safely reuse the exact mathematical entry', async () => {
  const base = fixtures.riverMixedInput(), baseline = ready(base), cache = createSolutionCache();
  await cache.put('owner', baseline.cacheKey, { fingerprint: baseline.key }, { fingerprint: baseline.key });
  const equivalent = [
    ['new hand and edit revision', changed(base, x => { x.multiway.handId = randomUUID(); x.multiway.editEpoch = 8; })],
    ['event identities', changed(base, x => { x.multiway.events.forEach((e, i) => { e.eventId = `event-${i}`; e.originEventId = `voice-${i}`; }); })],
    ['names and durable player identities', changed(base, x => { x.multiway.config.players = [{ playerId: 'alice', name: 'Alice' }, { playerId: 'bob', name: 'Bob' }]; })],
    ['Hero card display order', changed(base, x => { x.multiway.config.heroCards.reverse(); })],
    ['range, combo and private card ordering', changed(base, x => { x.ranges.reverse(); for (const r of x.ranges) { r.combos.reverse(); r.combos.forEach(c => c.cards.reverse()); } })],
    ['equal rescaling of each player range', changed(base, x => { x.ranges.forEach((r, i) => r.combos.forEach(c => { c.weight *= i ? 8 : 4; })); })],
    ['display and exploit data outside the reference model', changed(base, x => { x.layout = 'mobile'; x.profiles = [{ aggression: 99 }]; x.transcript = 'ignored'; })]
  ];
  for (const [name, input] of equivalent) {
    assert.equal(ready(input).cacheKey, baseline.cacheKey, name);
    assert.equal((await cache.get('owner', ready(input).cacheKey)).result.fingerprint, baseline.key);
  }
  const explicit = changed(base, x => { x.sizing = { type: 'EXPLICIT_TOTALS', levels: [1, 2], maxAggressions: 1 }; });
  assert.equal(ready(explicit).cacheKey, ready(changed(explicit, x => { x.sizing.levels = [2, 1, 2]; })).cacheKey);
});

test('unsupported variant, street, history and incomplete inputs cannot inherit an existing result', async t => {
  const base = fixtures.riverMixedInput(), file = await fingerprintWorker(t), service = createSolverService({ workerFile: file });
  const partial = checkedRiver({ playerCount: 3 });
  partial.multiway.events.push({ type: 'MARK_FOLD', actor: 2 });
  const cases = [
    ['PLO4', changed(base, x => { x.multiway.config.variant = 'PLO4_HIGH'; x.multiway.config.heroCards.pop(); })],
    ['PLO6', changed(base, x => { x.multiway.config.variant = 'PLO6_HIGH'; x.multiway.config.heroCards.push('7s'); })],
    ['turn without river', changed(base, x => { x.multiway.events = x.multiway.events.slice(0, x.multiway.events.findIndex(e => e.type === 'BOARD' && e.cards.length === 5)); })],
    ['partial out-of-turn history', partial],
    ['unknown fee', changed(base, x => { delete x.rake; })],
    ['incomplete range', changed(base, x => { x.ranges[1].complete = false; })],
    ['missing seat range', changed(base, x => { x.ranges.pop(); })],
    ['zero weight', changed(base, x => { x.ranges[1].combos[0].weight = 0; })],
    ['unsupported fee schema', changed(base, x => { x.rake = { type: 'PERCENT_CAPPED', version: '2' }; })],
    ['disabled Multiway', changed(base, x => { x.multiway.enabled = false; })]
  ];
  try {
    const seed = await service.start('owner', base, options(base));
    await until(() => service.get('owner', seed.jobId), x => x.phase === 'COMPLETE');
    assert.equal((await service.start('owner', base, options(base))).cache.hit, true);
    for (const [name, input] of cases) {
      assert.equal(adapter.coverage(input).status, 'NOT_SOLVED', name);
      const response = await service.start('owner', input, { revisionKey: name, handId: base.multiway.handId });
      assert.equal(response.phase, 'UNSUPPORTED', name); assert.equal(response.result.status, 'NOT_SOLVED', name);
      assert.deepEqual(response.result.actions, [], name); assert.equal(response.cache.hit, false, name);
    }
  } finally { await service.close(); }
});

test('dependency-version changes invalidate keys; caller-supplied version claims cannot bypass them', () => {
  const coverage = ready(fixtures.riverMixedInput());
  const input = { game: coverage.key, heroInformationSet: coverage.heroInformationSet }, original = keyFor(input);
  const dependencies = [[core, 'VERSION'], [adapter, 'VERSION'], [adapter, 'RULES_VERSION'],
    [require('../src/solver/solution-status'), 'VERSION'], [require('../src/decision-precision'), 'VERSION'],
    [require('../src/solver/action-conditioned'), 'VERSION']];
  // Module-boundary test only. These versions and the payoff rules are server
  // code, not editable product settings or fictional user-configurable options.
  for (const [module, field] of dependencies) {
    const saved = module[field];
    try { module[field] = `${saved}_AUDIT_CHANGE`; assert.notEqual(keyFor(input), original, `${saved} must invalidate`); }
    finally { module[field] = saved; }
  }
  assert.equal(keyFor({ ...input, version: 'fake', solver: 'fake', adapter: 'fake', rules: 'fake',
    qualification: 'fake', precision: 'fake', actionCertificate: 'fake', adaptive: 'fake' }), original);
});

test('core utility, chance, action topology and information-set changes reject checkpoint reuse', () => {
  const base = fixtures.matrixGame([[1, -1], [-1, 1]], 'same-id');
  const solved = core.solve(base, { iterations: 8 });
  assert.ok(core.solve(clone(base), { iterations: 1, checkpoint: solved.checkpoint }).iterations > solved.iterations);
  // The production UI has one fixed incremental BB utility. At the generic
  // engine boundary, changing utilities must invalidate even without a new id.
  const variants = [
    ['payoff utility', changed(base, x => { x.root.actions[0].node.actions[0].node.payoffs = [2, -2]; })],
    ['action name / sizing interpretation', changed(base, x => { x.root.actions[0].id = 'BET:2.00'; })],
    ['additional legal alternative', changed(base, x => { x.root.actions.push({ id: 'R2', node: fixtures.terminal(0) }); })],
    ['public information partition', changed(base, x => { x.root.actions[0].node.informationSet = 'revealed-row-zero'; })],
    ['player owning the decision', changed(base, x => { x.root.player = 1; x.root.actions.forEach(a => { a.node.player = 0; }); })]
  ];
  for (const [name, game] of variants) {
    assert.notEqual(core.validateGame(game).gameHash, solved.gameHash, name);
    assert.throws(() => core.solve(game, { iterations: 1, checkpoint: solved.checkpoint }), /Checkpoint does not match/, name);
  }
  const chance = fixtures.kuhnGame(), chanceSolved = core.solve(chance, { iterations: 8 });
  chance.root.outcomes[0].probability += .01; chance.root.outcomes[1].probability -= .01;
  assert.throws(() => core.solve(chance, { iterations: 1, checkpoint: chanceSolved.checkpoint }), /Checkpoint does not match/);
  assert.throws(() => core.solve(base, { iterations: 1, averagingDelay: 1, checkpoint: solved.checkpoint }), /Checkpoint does not match/);
  assert.throws(() => core.solve(base, { iterations: 1, checkpoint: { ...solved.checkpoint, version: 'OLD_SOLVER' } }), /Checkpoint does not match/);
});

test('disk envelopes reject mismatched owner, key and cache schema after process recreation', async t => {
  const directory = await temporaryDirectory(t), key = ready(fixtures.riverMixedInput()).cacheKey;
  const file = path.join(directory, `${createHash('sha256').update('owner').digest('hex')}.${key}.json`);
  const cache = createSolutionCache({ directory });
  await cache.put('owner', key, { marker: 'valid' }, { iterations: 1 });
  const original = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const [field, value] of [['version', 'OLD_CACHE'], ['key', '0'.repeat(64)], ['owner', '0'.repeat(64)]]) {
    await fs.writeFile(file, JSON.stringify({ ...original, [field]: value }));
    assert.equal(await createSolutionCache({ directory }).get('owner', key), null, field);
  }
  await fs.writeFile(file, JSON.stringify(original));
  assert.equal((await createSolutionCache({ directory }).get('owner', key)).result.marker, 'valid');
});

test('real service reuses only the same game and Hero context, rebound to the current owner and revision', async t => {
  const file = await fingerprintWorker(t), service = createSolverService({ workerFile: file });
  const input = fixtures.riverMixedInput();
  try {
    const first = await service.start('owner', input, options(input));
    const completed = await until(() => service.get('owner', first.jobId), x => x.phase === 'COMPLETE');
    assert.equal(completed.result.fingerprint, ready(input).key);
    const transport = changed(input, x => { x.multiway.handId = randomUUID(); x.multiway.editEpoch = 3; });
    const hit = await service.start('owner', transport, options(transport));
    assert.equal(hit.cache.hit, true); assert.equal(hit.phase, 'COMPLETE');
    assert.equal(hit.revisionKey, options(transport).revisionKey); assert.equal(hit.handId, transport.multiway.handId);
    assert.notEqual(hit.jobId, first.jobId); assert.deepEqual(hit.result, completed.result);
    const refining = await service.start('owner', transport, options(transport, 'STANDARD'));
    assert.equal(refining.cache.hit, true, 'calculation budget changes effort, not the modeled game');
    const resumed = await until(() => service.get('owner', refining.jobId), x => x.phase === 'COMPLETE');
    assert.equal(resumed.result.resumedFrom, completed.result.fingerprint);
    assert.throws(() => service.get('other-owner', hit.jobId), /not found/);
    assert.throws(() => service.cancel('other-owner', hit.jobId), /not found/);
    const other = await service.start('other-owner', transport, options(transport));
    assert.equal(other.cache.hit, false); await until(() => service.get('other-owner', other.jobId), x => x.phase === 'COMPLETE');
    const weightChange = changed(input, x => { x.ranges[1].combos[1].weight = 3; });
    const miss = await service.start('owner', weightChange, options(weightChange));
    assert.equal(miss.cache.hit, false);
    const newResult = await until(() => service.get('owner', miss.jobId), x => x.phase === 'COMPLETE');
    assert.notEqual(newResult.result.fingerprint, completed.result.fingerprint);
    assert.equal(newResult.result.resumedFrom, null, 'incompatible checkpoint must not resume');
    const heroChange = changed(input, x => { x.multiway.config.heroCards = [...x.ranges[0].combos[1].cards]; });
    const heroMiss = await service.start('owner', heroChange, options(heroChange)); assert.equal(heroMiss.cache.hit, false);
    const heroResult = await until(() => service.get('owner', heroMiss.jobId), x => x.phase === 'COMPLETE');
    assert.equal(heroResult.result.fingerprint, completed.result.fingerprint);
    assert.notEqual(heroResult.result.informationSet, completed.result.informationSet);
    assert.equal(heroResult.result.resumedFrom, null);
  } finally { await service.close(); }
});

test('unchanged mathematics does not permit an older queued revision to complete', async t => {
  const file = await fingerprintWorker(t), service = createSolverService({ workerFile: file }), release = service.prioritize();
  try {
    const input = fixtures.riverMixedInput(), old = await service.start('owner', input, options(input));
    const repeat = await service.start('owner', clone(input), options(input));
    assert.equal(repeat.jobId, old.jobId, 'same owner, hand, revision and budget deduplicate');
    const next = changed(input, x => { x.multiway.editEpoch = 1; });
    assert.equal(ready(next).cacheKey, ready(input).cacheKey);
    const current = await service.start('owner', next, options(next));
    assert.notEqual(current.jobId, old.jobId);
    assert.equal(service.get('owner', old.jobId).phase, 'CANCELLED');
    release();
    const end = await until(() => service.get('owner', current.jobId), x => x.phase === 'COMPLETE');
    assert.equal(end.revisionKey, options(next).revisionKey); assert.equal(service.stats().completed, 1);
    assert.equal(service.get('owner', old.jobId).result, null);
  } finally { release(); await service.close(); }
});

test('queued service requests snapshot the mathematical input used to calculate their key', async t => {
  const file = await fingerprintWorker(t), service = createSolverService({ workerFile: file }), release = service.prioritize();
  try {
    const input = fixtures.riverMixedInput(), original = clone(input), expected = ready(original);
    const pending = service.start('owner', input, options(input));
    // Mutation before start resolves also exercises the asynchronous cache-read
    // boundary. More nested changes below occur while the job waits in queue.
    input.ranges[1].combos[1].weight = 9;
    const job = await pending;
    input.multiway.config.stacks = [100, 80];
    assert.notEqual(ready(input).key, expected.key);
    release();
    const completed = await until(() => service.get('owner', job.jobId), x => x.phase === 'COMPLETE');
    assert.equal(completed.result.fingerprint, expected.key, 'worker input must be the same snapshot as its cache key');
    const cachedOriginal = await service.start('owner', original, options(original));
    assert.equal(cachedOriginal.cache.hit, true);
    assert.equal(cachedOriginal.result.fingerprint, expected.key, 'caller mutation must never poison the original exact cache entry');
  } finally { release(); await service.close(); }
});

test('shared adaptive version invalidates cached responses without importing worker side effects', async () => {
  const coverage = ready(fixtures.riverMixedInput());
  const input = { game: coverage.key, heroInformationSet: coverage.heroInformationSet };
  const versions = require('../src/solver/versions'), original = keyFor(input), saved = versions.ADAPTIVE_VERSION;
  assert.equal(worker.VERSION, saved, 'the worker checkpoint and cache use the same authoritative version');
  try {
    versions.ADAPTIVE_VERSION = `${saved}_AUDIT_CHANGE`;
    assert.notEqual(keyFor(input), original, 'a changed adaptive certificate/refinement implementation must invalidate completed cached responses');
  } finally { versions.ADAPTIVE_VERSION = saved; }
  let previousKey;
  try { versions.ADAPTIVE_VERSION = 'THEIBS_HU_ADAPTIVE_V1'; previousKey = keyFor(input); }
  finally { versions.ADAPTIVE_VERSION = saved; }
  const cache = createSolutionCache();
  await cache.put('owner', previousKey, { limitations: ['Old validation notice'] }, { version: 'THEIBS_HU_ADAPTIVE_V1' });
  assert.notEqual(original, previousKey, 'pre-snapshot V1 cached responses must be invalidated by this release');
  assert.equal(await cache.get('owner', original), null);
  const isolated = spawnSync(process.execPath, ['-e', `
    const assert=require('node:assert/strict');
    const cache=require(${JSON.stringify(require.resolve('../src/solver/solution-cache'))});
    cache.keyFor({fixture:'isolated-import'});
    assert.equal(require.cache[${JSON.stringify(require.resolve('../src/solver/job-worker'))}],undefined);
  `], { encoding: 'utf8' });
  assert.equal(isolated.status, 0, isolated.stderr);
});
