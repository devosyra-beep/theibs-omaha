'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-multiway-api-'));
Object.assign(process.env, { THEIBS_DATA_PATH: path.join(temp, 'events.jsonl'), THEIBS_WORKSPACE_PATH: path.join(temp, 'workspace.json'),
  THEIBS_LLM_CONFIG_PATH: path.join(temp, 'llm.json'), THEIBS_LLM_PROVIDER: 'none' });
const { server } = require('../server');
const pool = require('../src/analysis-worker');
const multiway = require('../src/multiway-session');
const { saveWorkspace, readWorkspace } = require('../src/workspace-store');
const { CardKeyboardState } = require('../public/card-model');
const config = { variant: 'PLO5_HIGH', playerCount: 3, heroPosition: 'BTN', startingStack: 100,
  smallBlind: 1, bigBlind: 2, heroCards: ['As', 'Ks', 'Qh', 'Jh', 'Td'] };
const act = (actor, action, to) => ({ type: 'ACT', actor, action, ...(to === undefined ? {} : { to }) });
const simple = { variant: 'PLO5_HIGH', heroCards: config.heroCards, board: [], position: 'BTN', players: 3,
  potBeforeAction: 12, amountToCall: 2, effectiveStack: 100, unknownOpponentModel: 'UNIFORM', assumeNoRake: true, samples: 128, seed: 42 };
let origin;
test.before(async () => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await pool.close(); await new Promise(resolve => server.close(resolve)); });
async function post(route, payload) {
  const response = await fetch(origin + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return { httpStatus: response.status, ...await response.json() };
}

test('stateless start and observed fold preserve pot, physical seats and canonical replay', async () => {
  const started = await post('/api/multiway/start', { config });
  assert.equal(started.httpStatus, 200);
  assert.equal(started.state.pot, 3);
  assert.equal(started.state.actor, 2);
  const before = JSON.stringify(started.multiway);
  const next = await post('/api/multiway/step', { multiway: started.multiway, expectedRevision: 0, event: { type: 'MARK_FOLD', actor: 0 } });
  assert.equal(next.httpStatus, 200, next.reason);
  assert.equal(JSON.stringify(started.multiway), before);
  assert.equal(next.state.pot, 3);
  assert.equal(next.state.players[0].totalPaid, 1);
  assert.equal(next.state.players[0].folded, true);
  assert.equal(next.state.actor, 2);
  assert.equal(next.state.heroId, 2);
  assert.deepEqual(next.state.activeOpponentIds, [1]);
  assert.equal(next.state.players[2].position, 'BTN');
  assert.equal(next.state.observation.actionsInferred, false);
  assert.equal(next.multiway.events.length, 1);
  const restored = await post('/api/multiway/state', { multiway: next.multiway });
  assert.deepEqual(restored.state, next.state);
  assert.deepEqual(restored.analysis.input, next.analysis.input);
  assert.equal((await post('/api/multiway/step', { multiway: next.multiway, expectedRevision: 0, event: act(2, 'CALL') })).httpStatus, 409);
});

test('revision key rejects delayed actions after undo and New Game even when event counts match', async () => {
  const first = await post('/api/multiway/start', { config });
  assert.match(first.multiway.handId, /^[0-9a-f-]{36}$/i);
  assert.equal(first.multiway.editEpoch, 0);
  const firstKey = first.state.revisionKey;
  const acted = await post('/api/multiway/step', { multiway: first.multiway, event: act(2, 'CALL'),
    expectedRevision: 0, expectedRevisionKey: firstKey });
  assert.equal(acted.httpStatus, 200, acted.reason);
  assert.notEqual(acted.state.revisionKey, firstKey);
  const undone = await post('/api/multiway/undo', { multiway: acted.multiway, expectedRevisionKey: acted.state.revisionKey });
  assert.equal(undone.httpStatus, 200, undone.reason);
  assert.equal(undone.multiway.handId, first.multiway.handId);
  assert.equal(undone.multiway.editEpoch, 1);
  assert.equal(undone.state.revision, 0);
  assert.equal(undone.state.actor, first.state.actor);
  assert.equal(undone.state.pot, first.state.pot);
  assert.deepEqual(undone.state.players.map(player => player.stack), first.state.players.map(player => player.stack));
  assert.notEqual(undone.state.revisionKey, firstKey);
  assert.equal((await post('/api/multiway/step', { multiway: undone.multiway, event: act(2, 'CALL'),
    expectedRevision: 0, expectedRevisionKey: firstKey })).httpStatus, 409);
  const newGame = await post('/api/multiway/start', { config });
  assert.notEqual(newGame.multiway.handId, first.multiway.handId);
  assert.notEqual(newGame.state.revisionKey, firstKey);
  assert.equal((await post('/api/multiway/step', { multiway: newGame.multiway, event: act(2, 'CALL'),
    expectedRevision: 0, expectedRevisionKey: firstKey })).httpStatus, 409);
});

test('legacy Multiway workspace can replay and receives an identity on mutation', () => {
  const current = multiway.start(config).multiway;
  const legacy = { schemaVersion: 1, enabled: true, config: current.config, events: [] };
  assert.deepEqual(multiway.validateRecord(legacy), legacy);
  const next = multiway.step(legacy, act(2, 'CALL'));
  assert.match(next.multiway.handId, /^[0-9a-f-]{36}$/i);
  assert.equal(next.multiway.editEpoch, 0);
  assert.equal(next.state.revision, 1);
});

test('analyze and doubt derive observed facts and withhold unknown responses instead of recommending fold by default', async () => {
  const record = multiway.start(config).multiway;
  const payload = { ...simple, multiway: record, potBeforeAction: 99999, amountToCall: 99, players: 9,
    heroCards: ['2s', '3s', '4s', '5s', '6s'], effectiveStack: 1, heroContribution: 777 };
  const result = await post('/api/analyze', payload);
  assert.equal(result.status, 'OK', result.reason);
  assert.equal(result.state.potBeforeAction, 3);
  assert.equal(result.state.amountToCall, 2);
  assert.equal(result.state.players, 3);
  assert.deepEqual(result.state.heroCards, config.heroCards);
  assert.equal(result.equity.opponents, 2);
  assert.equal(result.observedSource, 'USER_OBSERVED_ACTIONS');
  assert.equal(result.ev.actions.CALL.status, 'NOT_MODELED');
  assert.equal(result.ev.actions.RAISE.status, 'NOT_MODELED');
  assert.equal(result.ev.comparisonComplete, false);
  assert.equal(result.recommendedAction, 'NO_DECISION');
  assert.equal(result.potMath.evCall, null);
  const doubt = await post('/api/analysis/doubt', { input: payload, question: 'Por que pagar?' });
  assert.equal(doubt.status, 'OK', doubt.reason);
  assert.equal(doubt.context.ev.CALL.status, 'NOT_MODELED');
  assert.equal(doubt.context.observedState.pot, 3);
  assert.equal(doubt.context.equity.value, result.equity.equity);
  const folded = multiway.step(record, { type: 'MARK_FOLD', actor: 0 }).multiway;
  const headsUp = await post('/api/analyze', { ...simple, multiway: folded });
  assert.equal(headsUp.equity.opponents, 1);
  assert.equal(headsUp.ev.actions.CALL.status, 'MODELED');
  assert.equal(headsUp.ev.actions.RAISE.status, 'NOT_MODELED');
  assert.equal(headsUp.observedState.pot, 3);
});

test('out-of-turn and all-in guards remain while the BB option requires explicit raise assumptions', async () => {
  let record = multiway.start(config).multiway;
  record = multiway.step(record, act(2, 'CALL')).multiway;
  const outside = await post('/api/analyze', { ...simple, multiway: record });
  assert.equal(outside.status, 'NO_DECISION');
  assert.ok(outside.reasonCodes.includes('NOT_HERO_TURN'));
  const bb = multiway.start({ ...config, heroPosition: 'BB' }).multiway;
  const bbOption = [act(2, 'CALL'), act(0, 'CALL')].reduce((r, event) => multiway.step(r, event).multiway, bb);
  const free = await post('/api/analyze', { ...simple, multiway: bbOption });
  assert.equal(free.status, 'OK');
  assert.deepEqual(free.legalActions, ['CHECK', 'RAISE']);
  assert.equal(free.ev.actions.RAISE.status, 'NOT_MODELED');
  assert.equal(free.recommendation.action, null);
  assert.equal(free.recommendation.status, 'UNAVAILABLE');
  const short = multiway.start({ ...config, stacks: [100, 100, 2] }).multiway;
  const callAllIn = await post('/api/analyze', { ...simple, multiway: short });
  assert.equal(callAllIn.status, 'NO_DECISION');
  assert.ok(callAllIn.reasonCodes.includes('CALL_REACHES_ALL_IN'));
  const initialAllIn = multiway.start({ ...config, stacks: [100, 2, 100] }).multiway;
  const allIn = await post('/api/analyze', { ...simple, multiway: initialAllIn });
  assert.equal(allIn.status, 'NO_DECISION');
  assert.ok(allIn.reasonCodes.includes('ALL_IN_UNSUPPORTED'));
  const noCards = multiway.start({ ...config, heroCards: [] }).multiway;
  assert.ok((await post('/api/analyze', { ...simple, multiway: noCards })).reasonCodes.includes('HERO_CARDS_INCOMPLETE'));
});

test('invalid events and variant capacities leave the caller record intact', async () => {
  const original = multiway.start(config).multiway, before = JSON.stringify(original);
  for (const event of [act(0, 'CALL'), act(2, 'RAISE', 500), { type: 'BOARD', cards: ['2s', '3s', '4s'] }, { type: 'MARK_FOLD', actor: 2 }]) {
    assert.equal((await post('/api/multiway/step', { multiway: original, event })).httpStatus, 400);
    assert.equal(JSON.stringify(original), before);
  }
  for (const [variant, playerCount, heroCards] of [['PLO5_HIGH', 7, config.heroCards], ['PLO6_HIGH', 6, [...config.heroCards, '9c']]]) {
    assert.equal((await post('/api/multiway/start', { config: { ...config, variant, playerCount, heroCards } })).httpStatus, 400);
  }
});

test('a showdown-only observed check cannot invent a future pot', async () => {
  const flopConfig = { ...config, heroCards: ['As', 'Ks', '2d', '3d', '4c'] };
  let record = multiway.start(flopConfig).multiway;
  for (const event of [act(2, 'CALL'), act(0, 'CALL'), act(1, 'CHECK'),
    { type: 'BOARD', cards: ['Qs', 'Js', 'Ts'] }, act(0, 'CHECK'), act(1, 'CHECK')]) {
    record = multiway.step(record, event).multiway;
  }
  const result = await post('/api/analyze', { ...simple, multiway: record,
    futureStreetModel: { type: 'SHOWDOWN_ONLY', potAtShowdown: 1000000 } });
  assert.equal(result.status, 'OK', result.reason);
  assert.equal(result.observedState.pot, 6);
  assert.equal(result.equity.equity, 1);
  assert.equal(result.ev.actions.CHECK.status, 'MODELED');
  assert.equal(result.ev.actions.CHECK.ev, 6);
});

test('response hypotheses require exact physical seat mapping and observed contributions', async () => {
  const record = multiway.start(config).multiway;
  const study = { enabled: true, assumptionsAccepted: true, heroContribution: 999, minRaiseTo: 1,
    opponents: [{ seatId: 1, contribution: 999, callProbability: .5 }, { seatId: 0, contribution: 999, callProbability: .5 }] };
  const result = await post('/api/analyze', { ...simple, multiway: record, raiseTo: 6, aggressionStudy: study });
  assert.equal(result.status, 'OK', result.reason);
  assert.equal(result.ev.actions.CALL.status, 'MODELED');
  assert.equal(result.ev.actions.RAISE.status, 'MODELED');
  const stale = await post('/api/analyze', { ...simple, multiway: record, raiseTo: 6,
    aggressionStudy: { ...study, opponents: study.opponents.map(({ seatId, ...item }) => item) } });
  assert.equal(stale.status, 'OK');
  assert.equal(stale.ev.actions.RAISE.status, 'NOT_MODELED');
  assert.equal(stale.ev.actions.CALL.status, 'NOT_MODELED');
  const partialCoverage = multiway.start({ ...config, stacks: [5, 100, 100] }).multiway;
  const uncovered = await post('/api/analyze', { ...simple, multiway: partialCoverage, raiseTo: 6, aggressionStudy: study });
  assert.equal(uncovered.ev.actions.RAISE.status, 'NOT_MODELED');
  assert.match(uncovered.ev.actions.RAISE.missingInputs.join(' '), /side pot/);
  const hand = ['2s', '3s', '4s', '5s', '6s'];
  const specific = await post('/api/analyze', { ...simple, multiway: record, opponentHand: hand.join(' ') });
  assert.equal(specific.status, 'NO_DECISION');
  assert.ok(specific.reasonCodes.includes('RANGE_SEAT_MAPPING_REQUIRED'));
});

test('workspace saves and restores by replay, rejects corrupt records and preserves Simple backup', () => {
  const file = path.join(temp, 'roundtrip.json'), record = multiway.start(config).multiway;
  const workspace = { schemaVersion: 1, keyboard: new CardKeyboardState().snapshot(), fields: {}, ui: { felt: 'verde', deck: 'cores' },
    snapshots: [], multiway: record, multiwaySimple: { keyboard: new CardKeyboardState(4).snapshot(), fields: { potBeforeAction: 11 } } };
  saveWorkspace(workspace, 0, file);
  const good = fs.readFileSync(file, 'utf8');
  assert.deepEqual(readWorkspace(file).workspace.multiway, record);
  assert.equal(readWorkspace(file).workspace.multiwaySimple.fields.potBeforeAction, 11);
  const invalid = structuredClone(workspace); invalid.multiway.events.push(act(0, 'CALL'));
  assert.throws(() => saveWorkspace(invalid, 1, file), /out of turn/);
  assert.equal(fs.readFileSync(file, 'utf8'), good);
  const corruptFile = path.join(temp, 'corrupt.json'), corrupt = JSON.parse(good);
  corrupt.workspace = invalid;
  const content = JSON.stringify(corrupt); fs.writeFileSync(corruptFile, content);
  assert.throws(() => readWorkspace(corruptFile), /out of turn/);
  assert.equal(fs.readFileSync(corruptFile, 'utf8'), content);
});

test('Simple analysis and training start remain independent of Multiway', async () => {
  const result = await post('/api/analyze', simple);
  assert.equal(result.status, 'OK');
  assert.equal(result.state.potBeforeAction, 12);
  assert.equal(result.observedState, undefined);
  const session = await post('/api/training/start', { variant: 'PLO6_HIGH', seed: 31 });
  assert.equal(session.status, 'OK');
  assert.equal(session.session.variant, 'PLO6_HIGH');
  assert.equal(session.session.opponentCards, undefined);
});

test('malformed Simple backups cannot be saved or restored and valid legacy drafts remain accepted', () => {
  const file = path.join(temp, 'simple-backup.json');
  const workspace = { schemaVersion: 1, keyboard: new CardKeyboardState().snapshot(), fields: {},
    ui: { felt: 'roxo', deck: 'classico' }, snapshots: [] };
  saveWorkspace(workspace, 0, file);
  assert.equal(readWorkspace(file).workspace.multiwaySimple, undefined);
  const valid = { ...workspace, multiwaySimple: { keyboard: new CardKeyboardState(6).snapshot(), fields: { players: 5 } } };
  saveWorkspace(valid, 1, file);
  const saved = fs.readFileSync(file, 'utf8');
  for (const backup of [[], { keyboard: {}, fields: {} }, { keyboard: new CardKeyboardState().snapshot(), fields: [] }, { keyboard: new CardKeyboardState().snapshot(), fields: null }]) {
    assert.throws(() => saveWorkspace({ ...valid, multiwaySimple: backup }, 2, file));
    assert.equal(fs.readFileSync(file, 'utf8'), saved);
    const corrupted = JSON.parse(saved); corrupted.workspace.multiwaySimple = backup;
    const corruptFile = path.join(temp, 'corrupt-backup.json'), content = JSON.stringify(corrupted);
    fs.writeFileSync(corruptFile, content);
    assert.throws(() => readWorkspace(corruptFile));
    assert.equal(fs.readFileSync(corruptFile, 'utf8'), content);
  }
});
