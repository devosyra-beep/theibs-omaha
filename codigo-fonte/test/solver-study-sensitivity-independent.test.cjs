'use strict';

// Independent study QA: model sensitivity is a comparison of distinct games,
// never a confidence interval or a shared certificate across hypotheses.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const core = require('../src/solver/extensive-solver');
const builder = require('../src/solver/plo-river-game');
const conditioned = require('../src/solver/action-conditioned');
const job = require('../src/solver/job-worker');
const fixtures = require('./helpers/solver-reference-fixtures.cjs');
const exact = require('./helpers/river-hu-expanded-contract-reference.cjs');
const session = require('../src/multiway-session');
const BASELINE = '3b13746aea7b0df410bdfe8b7304fbde5b225e9a';
const sourceRoot = path.resolve(__dirname, '..');
const ids = new Set(['src/solver/extensive-solver.js', 'src/solver/action-conditioned.js', 'src/solver/job-worker.js',
  'src/solver/plo-river-game.js', 'src/solver/versions.js', 'src/solver/solution-status.js', 'src/solver/decision-outcome.js', 'src/decision-precision.js']);
const loaded = new Map();
function baseline(id) {
  if (loaded.has(id)) return loaded.get(id).exports;
  const filename = path.join(sourceRoot, id), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => {
    if (name.startsWith('.')) {
      const target = path.relative(sourceRoot, path.resolve(path.dirname(filename), name.endsWith('.js') ? name : name + '.js')).split(path.sep).join('/');
      if (ids.has(target)) return baseline(target);
    }
    return normal(name);
  };
  loaded.set(id, mod);
  mod._compile(execFileSync('git', ['show', `${BASELINE}:codigo-fonte/${id}`], {
    cwd: path.dirname(sourceRoot), encoding: 'utf8', windowsHide: true
  }), filename);
  return mod.exports;
}
const oldBuilder = baseline('src/solver/plo-river-game.js');
const oldCore = baseline('src/solver/extensive-solver.js');
const oldConditioned = baseline('src/solver/action-conditioned.js');
const oldJob = baseline('src/solver/job-worker.js');
const clone = structuredClone;
function math(value) {
  if (Array.isArray(value)) return value.map(math);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !key.endsWith('Ms') && !['metrics', 'costs', 'actionCosts', 'traversalVisits', 'studyContext'].includes(key))
    .map(([key, item]) => [key, math(item)]));
  return value;
}
function grid() {
  const base = fixtures.riverMixedInput();
  base.multiway.handId = '11111111-1111-4111-8111-111111111111';
  const output = [];
  for (const prior of ['A', 'B']) for (const tree of ['A', 'B']) {
    const input = clone(base), weights = prior === 'A' ? [[3, 1], [1, 4]] : [[.001, 5], [4, 1]];
    input.ranges.forEach((range, seat) => range.combos.forEach((combo, index) => { combo.weight = weights[seat][index]; }));
    input.sizing = { type: 'EXPLICIT_TOTALS', levels: tree === 'A' ? [1, 2] : [1, 1.5, 2], maxAggressions: 1 };
    output.push({ id: `prior${prior}-tree${tree}`, name: `Prior ${prior} / tree ${tree}`, input });
  }
  return output;
}
function ready(input, adapter = builder) {
  const built = adapter.buildPloRiverGame(input);
  assert.equal(built.status, 'READY', JSON.stringify(built.reasons)); return built.game;
}
function execute(input, checkpoint, iterations = 64) {
  return job.execute({ input: clone(input), checkpoint, budget: { timeMs: 3000, iterations } }, { compilationReuse: true, now: () => 0 });
}
function traces(game) {
  const rows = new Map();
  function visit(node, parts) {
    const key = parts.join('/');
    if (node.type === 'terminal') { rows.set(key, { type: node.type, payoffs: node.payoffs }); return; }
    if (node.type === 'chance') return node.outcomes.forEach((edge, index) => visit(edge.node, [...parts, `W${index}`]));
    rows.set(key, { type: node.type, player: node.player, informationSet: node.informationSet });
    node.actions.forEach(edge => visit(edge.node, [...parts, edge.id]));
  }
  visit(game.root, []); return rows;
}

test('four prior/tree games preserve baseline 3b fixed-work strategy, profile EV, full-prior bounds and checkpoints exactly', () => {
  for (const scenario of grid()) {
    const input = clone(scenario.input), before = clone(input), current = ready(input), previous = ready(input, oldBuilder);
    assert.deepEqual(current, previous, scenario.id + ': mathematical tree');
    const solved = core.solve(current, { iterations: 32 }), oldSolved = oldCore.solve(previous, { iterations: 32 });
    assert.deepEqual(math(solved), math(oldSolved), scenario.id + ': fixed global work');
    for (const action of current.meta.rootActions) {
      const condition = { player: current.meta.heroSeat, informationSet: current.meta.heroInformationSet, actionId: action.id };
      const fixed = conditioned.buildActionConditionedGame(current, condition), oldFixed = oldConditioned.buildActionConditionedGame(previous, condition);
      assert.deepEqual(fixed, oldFixed); const profile = core.solve(fixed, { iterations: 16 });
      assert.deepEqual(math(profile), math(oldCore.solve(oldFixed, { iterations: 16 })));
      assert.deepEqual(math(conditioned.evaluateActionConditioned(current, profile.strategy, condition)),
        math(oldConditioned.evaluateActionConditioned(previous, profile.strategy, condition)));
    }
    const output = execute(input), expected = oldJob.execute({ input: clone(input), budget: { timeMs: 3000, iterations: 64 } }, { compilationReuse: true, now: () => 0 });
    assert.deepEqual(math(output.result), math(expected.result)); assert.deepEqual(math(output.checkpoint), math(expected.checkpoint));
    assert.deepEqual(input, before, 'No input mutation.');
    assert.equal(output.result.actionPrecision.fullPriorPreserved, true);
    assert.equal(output.result.actionPrecision.originalHandActionEV, false);
  }
});

test('sizing enrichment retains exact joint prior, every common path utility and original legal action while adding declared paths', () => {
  const cases = grid();
  for (const prior of ['A', 'B']) {
    const first = ready(cases.find(row => row.id === `prior${prior}-treeA`).input);
    const second = ready(cases.find(row => row.id === `prior${prior}-treeB`).input);
    assert.deepEqual(first.meta.ranges, second.meta.ranges);
    assert.equal(first.meta.heroWorldProbability, second.meta.heroWorldProbability);
    assert.deepEqual(first.root.outcomes.map(row => row.probability), second.root.outcomes.map(row => row.probability));
    assert.notEqual(first.meta.key, second.meta.key);
    assert.ok(first.meta.rootActions.every(row => second.meta.rootActions.some(next => next.id === row.id)));
    assert.ok(second.meta.rootActions.some(row => !first.meta.rootActions.some(old => old.id === row.id)));
    const before = traces(first), after = traces(second);
    for (const [key, row] of before) assert.deepEqual(after.get(key), row, key + ': shared public action path');
    assert.ok(after.size > before.size);
    core.validateGame(second); // Includes the existing perfect-recall guard.
  }
});

test('nonuniform rare Hero and blockers retain every positive compatible world without conditioning the opponent on observed Hero cards', () => {
  const rare = ready(grid().find(row => row.id === 'priorB-treeA').input);
  assert.equal(rare.root.outcomes.length, 4);
  assert.ok(rare.root.outcomes.every(row => row.probability > 0));
  assert.equal(rare.meta.ranges[rare.meta.heroSeat].combos.length, 2);
  assert.ok(rare.meta.heroWorldProbability > 0 && rare.meta.heroWorldProbability < .001);
  const opponentSets = new Map();
  function visit(node, world) {
    if (node.type !== 'decision') return;
    if (node.player !== rare.meta.heroSeat) {
      const worlds = opponentSets.get(node.informationSet) || new Set(); worlds.add(world); opponentSets.set(node.informationSet, worlds);
    }
    node.actions.forEach(edge => visit(edge.node, world));
  }
  rare.root.outcomes.forEach((edge, index) => visit(edge.node, index));
  assert.ok([...opponentSets.values()].some(worlds => worlds.size > 1), 'Opponent information sets must span unobserved Hero private types.');
  const blockedInput = fixtures.riverCallInput({ blockers: true }), blocked = ready(blockedInput);
  assert.equal(blocked.root.outcomes.length, 3); assert.ok(blocked.root.outcomes.every(row => row.probability > 0));
  assert.equal(exact.terminalAudit(blockedInput, blocked).worlds, 3);
  assert.equal(exact.terminalAudit(grid()[0].input, ready(grid()[0].input)).worlds, 4);
});

test('changing a prior or sizing discards old global/action resumes and certificate intersections even at an unchanged ledger revision', () => {
  const cases = grid(), baselineInput = cases[0].input, before = execute(baselineInput);
  assert.ok(before.result.actionPrecision.actions.some(row => row.certified));
  for (const scenario of cases.slice(1)) {
    assert.equal(session.envelope(scenario.input.multiway).state.revisionKey, session.envelope(baselineInput.multiway).state.revisionKey);
    const resumed = execute(scenario.input, before.checkpoint, 1), fresh = execute(scenario.input, undefined, 1);
    assert.notEqual(resumed.result.gameHash, before.result.gameHash);
    assert.notEqual(resumed.result.actionPrecision.baseContextKey, before.result.actionPrecision.baseContextKey);
    assert.deepEqual(math(resumed.result), math(fresh.result)); assert.deepEqual(resumed.checkpoint, fresh.checkpoint);
    assert.deepEqual(resumed.checkpoint.actionCheckpoints, {}); assert.deepEqual(resumed.checkpoint.actionCertificates, {});
  }
});

test('each new game keeps its own exact rational full-prior commitment envelope, separate from conditional current-hand profile EV', () => {
  for (const scenario of grid()) {
    const game = ready(scenario.input), output = execute(scenario.input);
    for (const action of game.meta.rootActions) {
      const condition = { player: game.meta.heroSeat, informationSet: game.meta.heroInformationSet, actionId: action.id };
      const fixed = conditioned.buildActionConditionedGame(game, condition), solved = core.solve(fixed, { iterations: 16 });
      const witness = exact.exactPolicyEnvelope(exact.restrictIndependently(game, condition), solved.strategy, condition.player);
      const bounds = conditioned.evaluateActionConditioned(game, solved.strategy, condition);
      assert.equal(bounds.certified, true); exact.assertOuterInterval(bounds.lowerBB, bounds.upperBB, witness.lower, witness.upper, scenario.id + ':' + action.id);
      assert.equal(bounds.fullPriorPreserved, true); assert.equal(bounds.originalHandActionEV, false);
    }
    assert.equal(output.result.status, 'APPROXIMATE'); assert.equal(output.result.qualification.gto, false);
    assert.equal(output.result.qualification.fullHandEquilibrium, false);
  }
});

function completeCases() {
  const { richRiverInput } = require('./helpers/solver-river-growth-reference.cjs');
  const a = richRiverInput({ combos: 4, sizings: 2 });
  a.multiway.config.stacks = [2, 2]; a.sizing = { type: 'MIN_MID_MAX', maxAggressions: 1 };
  const b = richRiverInput({ combos: 4, sizings: 2 });
  b.ranges.forEach(range => { range.combos = range.combos.slice(0, 2); });
  b.multiway.config.stacks = [2.02, 2.02]; b.sizing = { type: 'EXPLICIT_TOTALS', levels: [1, 1.01, 1.02], maxAggressions: 2 };
  const c = fixtures.riverCallInput({ blockers: true }); c.multiway.config.stacks = [20, 20];
  return [{ id: 'A_complete_4x4_short_stack', input: a }, { id: 'B_complete_2x2_cent_raise', input: b }, { id: 'C_complete_joint_blockers', input: c }];
}
const evidence = { schemaVersion: 1, classification: 'INDEPENDENT_SMALL_MODEL_REFERENCE_QA', baseline: BASELINE,
  generatedAt: new Date().toISOString(), scope: 'Existing PLO5 river HU only; current-hand profile EV separate from full-prior commitments.',
  boundsToleranceBB: 0, numericalLPResidualToleranceScope: 'NUMERICAL_REFERENCE_ONLY', cases: [] };
const fs = require('node:fs'), crypto = require('node:crypto');
const sourceNames = ['extensive-solver.js', 'plo-river-game.js', 'action-conditioned.js', 'job-worker.js', 'versions.js'];
const digest = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceRoot, 'src/solver', name))).digest('hex');
evidence.sourceDigests = Object.fromEntries(sourceNames.map(name => [name, digest(name)]));

test('three tiny complete legal trees have independent LP action references contained by exact outward full-prior bounds', () => {
  const lp = require('./helpers/sequence-form-reference.cjs');
  assert.equal(lp.available(), true, 'Required LP cannot be skipped. Set THEIBS_REFERENCE_PYTHON to the existing reference environment.');
  for (const scenario of completeCases()) {
    const game = ready(scenario.input), player = game.meta.heroSeat;
    assert.equal(game.meta.fullLegalSizingCoverage, true, scenario.id + ': complete legal sizing tree');
    assert.equal(builder.buildPloRiverGame(scenario.input).coverage, 'FINITE_RIVER_SUBGAME');
    const row = { id: scenario.id, input: scenario.input, revisionKey: session.envelope(scenario.input.multiway).state.revisionKey,
      gameHash: core.validateGame(game).gameHash, inputKey: game.meta.key, heroWorldProbability: game.meta.heroWorldProbability,
      fullLegalSizingCoverage: game.meta.fullLegalSizingCoverage, worldCount: game.root.outcomes.length, actions: [] };
    for (const action of game.meta.rootActions) {
      const condition = { player, informationSet: game.meta.heroInformationSet, actionId: action.id };
      const independentGame = exact.restrictIndependently(game, condition), oracle = lp.reference({ game: independentGame });
      const feasible = exact.exactPolicyEnvelope(independentGame, oracle.strategy, player);
      const fixed = conditioned.buildActionConditionedGame(game, condition), solved = core.solve(fixed, { iterations: 32 });
      const own = exact.exactPolicyEnvelope(independentGame, solved.strategy, player);
      const bounds = conditioned.evaluateActionConditioned(game, solved.strategy, condition);
      assert.equal(bounds.certified, true);
      exact.assertOuterInterval(bounds.lowerBB, bounds.upperBB, own.lower, own.upper, scenario.id + ':' + action.id + ':returned-policy');
      exact.assertOuterInterval(bounds.lowerBB, bounds.upperBB, feasible.lower, feasible.upper, scenario.id + ':' + action.id + ':LP-feasible-policy');
      assert.ok(bounds.lowerBB <= oracle.values[player] && oracle.values[player] <= bounds.upperBB, 'Numeric LP point outside the production interval.');
      row.actions.push({ id: action.id, target: 'PRIVATE_INFORMATION_SET_COMMITMENT_VALUE', scope: 'FULL_PRIOR_EX_ANTE',
        numericalReferenceValueBB: oracle.values[player], numericalReferenceMethod: oracle.method,
        numericalResiduals: oracle.residuals, numericalResidualToleranceBB: oracle.validationTolerance,
        symbolicallyExactLP: false, exactLPFeasiblePolicyEnvelope: { lower: exact.encode(feasible.lower), upper: exact.encode(feasible.upper) },
        productionBounds: { lowerBB: bounds.lowerBB, upperBB: bounds.upperBB, certified: true, boundsToleranceBB: 0,
          fullPriorPreserved: bounds.fullPriorPreserved, originalHandActionEV: bounds.originalHandActionEV } });
    }
    evidence.cases.push(row);
  }
});

function studyEntries() {
  return grid().map(row => ({ ...row, result: execute(row.input).result, phase: 'COMPLETE' }));
}
test('study comparison separates prior and sizing hypotheses, shows missing actions and never creates combined proof intervals', () => {
  const comparison = require('../public/solver-study-comparison'), [aa, ab, ba, bb] = studyEntries();
  const untouched = clone([aa, ab, ba, bb]);
  const range = comparison.compare([aa, ba]), tree = comparison.compare([aa, ab]);
  assert.equal(range.classification, 'RANGE_SENSITIVITY'); assert.equal(tree.classification, 'SIZING_SENSITIVITY');
  assert.equal(comparison.compare([aa, ab, ba]).classification, 'INCOMPARABLE', 'Mixed axes cannot be summarized as a single sensitivity.');
  const same = comparison.classify(aa, { ...clone(aa), id: 'same-second' }); assert.equal(same.classification, 'SAME_GAME');
  const added = tree.comparisons[0].actionComparisons.filter(row => row.state === 'MISSING_IN_BASELINE');
  assert.ok(added.some(row => row.id === 'BET:1.50'));
  assert.ok(added.every(row => row.baselineEVBB === null && row.deltaBB === null));
  for (const report of [range, tree]) {
    for (const row of report.comparisons) {
      assert.equal(row.certifiesActualHandActionValues, false);
      assert.equal(row.interpretation, 'RETURNED_PROFILE_MODEL_SENSITIVITY_NOT_UNCERTAINTY');
      assert.equal(Object.hasOwn(row, 'lowerBB'), false); assert.equal(Object.hasOwn(row, 'upperBB'), false);
    }
    for (const row of report.scenarios) {
      assert.equal(row.currentHand.certifiesEquilibriumActionValues, false);
      assert.equal(row.commitment.actualHandEVEquivalence, false);
      const source = untouched.find(entry => entry.id === row.id);
      for (const bound of row.commitment.rows.filter(item => item.certified)) {
        const original = source.result.actionPrecision.actions.find(item => item.id === bound.id);
        assert.equal(bound.lowerBB, original.lowerBB); assert.equal(bound.upperBB, original.upperBB);
      }
    }
  }
  assert.deepEqual([aa, ab, ba, bb], untouched);
});

test('study comparison rejects mismatched current decisions, fees, policies, source and forged proof while excluding narrative metadata', () => {
  const comparison = require('../public/solver-study-comparison'), [base, , changed] = studyEntries();
  const ledgerInput = clone(base.input), secret = 'QA_NARRATIVE_MUST_NOT_APPEAR';
  ledgerInput.multiway.config.players.forEach(player => { player.name = secret; player.notes = secret; player.playerId = secret; });
  ledgerInput.multiway.events.forEach(event => { event.eventId = secret; event.transcript = secret; });
  ledgerInput.multiway.notes = secret;
  assert.equal(JSON.stringify(comparison.ledgerFor(ledgerInput)).includes(secret), false);
  const narrativeOnly = { ...clone(base), id: 'narrative-second', input: ledgerInput, rationaleBySeat: { 0: secret }, voiceTranscript: secret };
  const summarized = comparison.compare([base, narrativeOnly]);
  assert.equal(summarized.classification, 'SAME_GAME'); assert.equal(JSON.stringify(summarized).includes(secret), false);
  const poisons = [
    entry => { entry.input.multiway.editEpoch++; },
    entry => { entry.input.multiway.config.heroCards = clone(entry.input.ranges[0].combos[1].cards); },
    entry => { entry.input.rake = { type: 'FIXED', amount: .01 }; },
    entry => { entry.input.comparisonPolicy = { nearEquivalenceBB: .02 }; },
    entry => { entry.result.source = 'HEURISTIC'; },
    entry => { entry.result.studyContext.inputKey = 'f'.repeat(64); },
    entry => { entry.result.actions.pop(); },
    entry => { entry.result.convergence.nashConv = -1; },
    entry => { entry.result.convergence.thresholdBB = 1; entry.result.convergence.thresholdMet = true; },
    entry => { entry.result.actionPrecision.actions[0].origin = 'UNKNOWN_ORIGIN'; },
    entry => { entry.result.actionPrecision.actions[0].conditionedHash = 'f'.repeat(64); },
    entry => { entry.result.actionPrecision.actions[0].lowerBB = NaN; },
    entry => { entry.result.decisionOutcome.status = 'CERTIFIED'; entry.result.decisionOutcome.strictLeaderActionId = 'FOLD';
      entry.result.decisionPrecision.status = 'CONCLUSIVE'; entry.result.decisionPrecision.bestActionId = 'FOLD';
      entry.result.convergence.nashConv = 0; entry.result.convergence.thresholdMet = true;
      entry.result.actionPrecision.actions.forEach(row => { row.lowerBB = -100; row.upperBB = 100; row.estimateBB = 0; }); },
    entry => { entry.result.decisionOutcome.status = 'NEAR_EQUIVALENT'; entry.result.decisionOutcome.nearGroupActionIds = entry.result.actions.map(row => row.id);
      entry.result.convergence.nashConv = 0; entry.result.convergence.thresholdMet = true;
      entry.result.actionPrecision.actions.forEach(row => { row.lowerBB = -100; row.upperBB = 100; row.estimateBB = 0; }); }
  ];
  for (const poison of poisons) {
    const candidate = clone(changed); poison(candidate);
    assert.equal(comparison.classify(base, candidate).classification, 'INCOMPARABLE', poison.toString());
  }
});

test('native client partitions prior/tree/owner caches and discards cancelled study packets before reuse', async () => {
  const { MessageChannel } = require('node:worker_threads'), { webcrypto } = require('node:crypto');
  const codec = require('../public/browser-solver-checkpoint-codec'), api = require('../public/browser-solver-client');
  const manifest = require('../public/browser-solver-manifest.json'), workers = [];
  const modelKey = input => JSON.stringify([input.ranges, input.sizing]);
  const cases = grid(), outputs = new Map(cases.map(row => [modelKey(row.input), execute(row.input)]));
  let held = false;
  const client = api.create({ manifest, crypto: webcrypto, createWorker: () => {
    const { port1, port2 } = new MessageChannel();
    const worker = { messages: [], terminated: false, postMessage: (value, transfer = []) => port1.postMessage(value, transfer),
      terminate() { this.terminated = true; port1.close(); port2.close(); } };
    port1.on('message', data => worker.onmessage?.({ data }));
    worker.reply = request => {
      const actual = outputs.get(modelKey(request.input)); assert.ok(actual, 'Unexpected or altered study input.');
      const source = cases.find(row => modelKey(row.input) === modelKey(request.input));
      assert.deepEqual(request.input, { ...clone(source.input), comparisonPolicy: api.normalizeComparisonPolicy(source.input.comparisonPolicy) },
        'The client may add its normalized policy but must preserve every mathematical input.');
      const result = clone(actual.result); result.adaptation.refinementRecommended = false;
      const packet = codec.pack(actual.checkpoint);
      port2.postMessage({ type: 'done', jobId: request.jobId, generation: request.generation, buildFingerprint: manifest.buildFingerprint,
        handId: request.input.multiway.handId, revisionKey: request.expectedRevisionKey, result, checkpoint: packet, workerMs: 1 }, codec.transfers(packet));
      assert.equal(packet.data.byteLength, 0, 'Only new packet buffer is transferred.');
    };
    port2.on('message', data => { worker.messages.push(data); if (!held) worker.reply(data); });
    workers.push(worker); port2.postMessage({ type: 'ready', schemaVersion: manifest.schemaVersion, buildFingerprint: manifest.buildFingerprint,
      checkpointTransportVersion: codec.VERSION }); return worker;
  } });
  const owner = 'independent-study-owner';
  const settings = input => ({ handId: input.multiway.handId, revisionKey: session.envelope(input.multiway).state.revisionKey, automatic: false });
  async function finish(initial, chosen = owner) {
    let current = initial;
    for (let i = 0; i < 10 && !['COMPLETE', 'FAILED', 'CANCELLED', 'UNSUPPORTED'].includes(current.phase); i++)
      current = await client.wait(chosen, current.jobId, { afterVersion: current.updateVersion, waitMs: 1000 });
    assert.equal(current.phase, 'COMPLETE'); return current;
  }
  try {
    const hashes = new Set(); let ownJobId;
    for (const scenario of cases) {
      const count = workers.length, cold = await finish(await client.start(owner, scenario.input, settings(scenario.input)));
      assert.equal(cold.cache.hit, false); assert.equal(workers.length, count + 1); hashes.add(cold.result.gameHash);
      ownJobId = cold.jobId;
      assert.equal(workers.at(-1).messages[0].checkpoint, null, 'A new model must not inherit another game checkpoint.');
      const warm = await client.start(owner, scenario.input, { ...settings(scenario.input), budget: 'FAST' });
      assert.equal(warm.cache.readOnly, true); assert.equal(warm.cache.hit, true); assert.equal(workers.length, count + 1);
      assert.deepEqual(warm.result, cold.result); warm.result.actions[0].evBB = 999;
      assert.notEqual(client.get(owner, warm.jobId).result.actions[0].evBB, 999);
    }
    assert.equal(hashes.size, 4); assert.equal(client.stats().entries, 4);
    const other = await finish(await client.start('another-owner', cases[0].input, settings(cases[0].input)), 'another-owner');
    assert.equal(other.cache.hit, false); assert.throws(() => client.get('another-owner', ownJobId), /owner/);
    client.clearOwner(owner); held = true;
    const pending = await client.start(owner, cases[0].input, settings(cases[0].input));
    const worker = workers.at(-1);
    for (let i = 0; i < 50 && !worker.messages.length; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(worker.messages.length, 1); const request = worker.messages[0], handler = worker.onmessage;
    client.clearOwner(owner); const entries = client.stats().entries;
    const poison = codec.pack(outputs.get(modelKey(cases[0].input)).checkpoint); poison.encoding = 'STALE_MUST_NOT_DECODE';
    handler({ data: { type: 'done', jobId: request.jobId, generation: request.generation, buildFingerprint: manifest.buildFingerprint,
      handId: request.input.multiway.handId, revisionKey: request.expectedRevisionKey, result: outputs.get(modelKey(cases[0].input)).result, checkpoint: poison } });
    assert.equal(worker.terminated, true); assert.equal(client.stats().entries, entries); assert.ok(client.stats().staleMessages > 0);
    assert.equal(client.stats().retainedCheckpointJobs, 0); assert.equal(pending.cache.hit, false);
  } finally { client.close(); }
});

test.after(() => {
  evidence.sourceStableThroughoutRun = sourceNames.every(name => evidence.sourceDigests[name] === digest(name));
  assert.equal(evidence.sourceStableThroughoutRun, true, 'Source changed during QA; regenerate after integration freeze.');
  evidence.summary = { cases: evidence.cases.length, lpActions: evidence.cases.reduce((sum, row) => sum + row.actions.length, 0),
    strictOuterIntervalChecks: evidence.cases.reduce((sum, row) => sum + row.actions.length * 2, 0) };
  const destination = path.resolve(sourceRoot, '../validacao/river-hu-study-sensitivity/independent-node-reference.json');
  if (evidence.cases.length) {
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(evidence, null, 2) + '\n');
  }
});

module.exports = { grid, ready, math, execute, completeCases, BASELINE };
