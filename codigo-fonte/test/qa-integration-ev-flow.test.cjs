'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { replay } = require('../src/hand-flow');
const multiway = require('../src/multiway-session');
const { calculateActionEV } = require('../src/action-ev-engine');
const { createSession, publicSession, applyAction } = require('../src/training-simulator');
const { replayPlan, replayDecision } = require('../src/training-replay');
const { decisionQuality } = require('../src/training-store');

const config = { variant: 'PLO4_HIGH', playerCount: 3, heroPosition: 'BTN',
  startingStack: 30, stacks: [10, 20, 30], smallBlind: 1, bigBlind: 2,
  heroCards: ['As', 'Ks', 'Qh', 'Jh'] };
const act = (actor, action, to) => ({ type: 'ACT', actor, action, ...(to == null ? {} : { to }) });
const cents = value => Math.round(value * 100);

function checkLedger(state) {
  assert.equal(state.players.reduce((total, player) => total + cents(player.stack), 0)
    + cents(state.pot) + cents(state.rake), cents(state.totalChips));
  if (state.phase !== 'FINISHED') {
    assert.equal(state.players.reduce((total, player) => total + cents(player.totalPaid), 0), cents(state.pot));
    assert.equal(state.pots.reduce((total, pot) => total + cents(pot.amount), 0), cents(state.pot));
    for (const pot of state.pots) assert.ok(pot.eligible.length > 0);
  }
}

test('unequal all-ins retain main/side eligibility, split odd cents and restore exactly on undo', () => {
  const events = [act(2, 'RAISE', 7), act(0, 'CALL'), act(1, 'RAISE', 20),
    act(2, 'CALL'), act(0, 'CALL')];
  for (let prefix = 0; prefix <= events.length; prefix++) checkLedger(replay(config, events.slice(0, prefix)));
  const allIn = replay(config, events);
  assert.equal(allIn.phase, 'WAIT_BOARD');
  assert.deepEqual(allIn.pots, [
    { amount: 30, eligible: [0, 1, 2] },
    { amount: 20, eligible: [1, 2] }
  ]);
  assert.equal(allIn.analysisReadiness.status, 'WAIT_BOARD');
  assert.ok(allIn.analysisReadiness.reasonCodes.includes('SIDE_POTS_UNMODELED'));
  const beforeLastCall = replay(config, events.slice(0, -1));
  assert.deepEqual(replay(config, events.slice(0, -1)), beforeLastCall, 'undo replays the exact prior ledger');
  assert.throws(() => replay(config, [...events, { type: 'BOARD', cards: ['2s', '3h', '4d'] },
    { type: 'SETTLE', winners: [[0], [0]], rake: 0 }]), /showdown/);
  for (const cards of [['2s', '3h', '4d'], ['2s', '3h', '4d', '5c'], ['2s', '3h', '4d', '5c', '6h']]) {
    events.push({ type: 'BOARD', cards });
    checkLedger(replay(config, events));
  }
  const showdown = replay(config, events);
  assert.equal(showdown.phase, 'SHOWDOWN');
  assert.throws(() => replay(config, [...events, { type: 'SETTLE', winners: [[0, 1], [0]], rake: 1.01 }]), /ineligible/);
  events.push({ type: 'SETTLE', winners: [[0, 1], [2]], rake: 1.01 });
  const settled = replay(config, events);
  checkLedger(settled);
  assert.deepEqual(settled.players.map(player => player.stack), [14.5, 14.49, 30]);
  assert.deepEqual(replay(config, events.slice(0, -1)), showdown);
});

test('Multiway stale revision cannot mutate after undo even when event count is restored', () => {
  const initial = multiway.start(config);
  const first = multiway.step(initial.multiway, act(2, 'CALL'), initial.state.revision, initial.state.revisionKey);
  const stale = first.state.revisionKey;
  const undone = multiway.undo(first.multiway, stale);
  assert.equal(undone.state.revision, initial.state.revision);
  assert.notEqual(undone.state.revisionKey, initial.state.revisionKey);
  const replacement = multiway.step(undone.multiway, act(2, 'RAISE', 7), undone.state.revision, undone.state.revisionKey);
  assert.equal(replacement.state.revision, first.state.revision);
  assert.notEqual(replacement.state.revisionKey, stale);
  assert.throws(() => multiway.step(replacement.multiway, act(0, 'CALL'), first.state.revision, stale),
    error => error.statusCode === 409);
});

test('unknown action EV stays null and an exactly breakeven call remains a modeled zero', () => {
  const result = calculateActionEV({ equity: .2, players: 3, potBeforeAction: 16,
    amountToCall: 4, bigBlind: 2, assumeNoRake: true,
    legalActions: ['FOLD', 'CALL', 'RAISE'], raiseTo: 12 });
  assert.equal(result.actions.CALL.status, 'MODELED');
  assert.equal(result.actions.CALL.ev, 0);
  assert.equal(result.actions.RAISE.status, 'NOT_MODELED');
  assert.equal(result.actions.RAISE.ev, null);
  assert.equal(result.comparisonComplete, false);
  assert.equal(result.globalBestSupported, false);
});

test('training replay restores only the public prefix from before the choice', () => {
  const session = createSession({ variant: 'PLO4_HIGH', seed: 17, targetStreet: 'TURN' });
  const original = publicSession(session), plan = replayPlan(session);
  assert.equal(original.street, 'TURN');
  assert.equal(plan.events.length, original.revision);
  assert.equal(JSON.stringify(plan).includes('boardAll'), false);
  assert.equal(JSON.stringify(plan).includes('villainCards'), false);
  applyAction(session, original.amountToCall ? 'CALL' : 'CHECK');
  const restored = replayDecision(plan);
  assert.notEqual(restored.session.id, session.id);
  for (const field of ['street', 'board', 'heroCards', 'pot', 'amountToCall', 'revision', 'history']) {
    assert.deepEqual(restored.publicState[field], original[field], field);
  }
  assert.equal(restored.publicState.opponentCards, undefined);
  assert.equal(restored.publicState.boardAll, undefined);
  assert.equal(restored.publicState.revision, plan.events.length);
  const tampered = structuredClone(plan);
  tampered.events.push({ type: 'BOARD', cards: [...original.board, '8s'] });
  assert.throws(() => replayDecision(tampered), /decision sequence/);
});

test('training quality separates top-two gap, chosen loss and prior-pot percentage', () => {
  const result = { status: 'OK', legalActions: ['FOLD', 'CALL', 'RAISE'],
    state: { bigBlind: 2, potBeforeAction: 20 },
    trainingEvaluation: { leadership: { status: 'SEPARATED' }, candidates: [
      { optionId: 'FOLD', action: 'FOLD', ev: 0, confidenceInterval95: [0, 0] },
      { optionId: 'CALL', action: 'CALL', ev: 1, confidenceInterval95: [.9, 1.1] },
      { optionId: 'RAISE:7', action: 'RAISE', size: 7, ev: 4, confidenceInterval95: [3.9, 4.1] }
    ] } };
  const quality = decisionQuality(result, 'CALL');
  assert.equal(quality.label, 'DIFFERENT_MODELED');
  assert.equal(quality.gapBestSecondBB, 1.5);
  assert.equal(quality.evLoss, 3);
  assert.equal(quality.evLossBB, 1.5);
  assert.equal(quality.evLossPotPct, 15);
  result.trainingEvaluation.candidates[2].confidenceInterval95 = [.5, 4.5];
  const inconclusive = decisionQuality(result, 'CALL');
  assert.equal(inconclusive.evLoss, null);
  assert.equal(inconclusive.evLossBB, undefined);
  assert.equal(inconclusive.evLossPotPct, undefined);
});
