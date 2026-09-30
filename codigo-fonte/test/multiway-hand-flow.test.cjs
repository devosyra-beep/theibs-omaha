'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { replay, POSITIONS } = require('../src/hand-flow');
const config = { variant: 'PLO5_HIGH', playerCount: 4, heroPosition: 'CO', startingStack: 100,
  smallBlind: .5, bigBlind: 1, heroCards: ['As', 'Kd', 'Qh', 'Jc', '9s'] };
const act = (actor, action, to) => ({ type: 'ACT', actor, action, ...(to == null ? {} : { to }) });
const exit = actor => ({ type: 'MARK_FOLD', actor });
const board = cards => ({ type: 'BOARD', cards });
const cents = number => Math.round(number * 100);

function conserved(state) {
  assert.equal(state.players.reduce((sum, player) => sum + cents(player.stack), 0) + cents(state.pot) + cents(state.rake), cents(state.totalChips));
  if (state.phase !== 'FINISHED') assert.equal(state.players.reduce((sum, player) => sum + cents(player.totalPaid), 0), cents(state.pot));
  assert.equal(state.players.filter(player => player.hero).length, 1);
  assert.equal(state.players[state.heroId].hero, true);
  assert.equal(new Set(state.pending).size, state.pending.length);
  for (const id of state.pending) assert.ok(!state.players[id].folded && state.players[id].stack > 0);
  if (state.phase === 'BETTING') assert.ok(state.pending.includes(state.actor));
  else assert.equal(state.actor, null);
}

test('out-of-turn exit keeps the current actor, physical IDs and all invested chips', () => {
  const original = replay(config), state = replay(config, [exit(3)]);
  assert.equal(original.heroId, 2);
  assert.equal(state.actor, 2);
  assert.equal(state.heroId, 2);
  assert.equal(state.heroPosition, 'CO');
  assert.equal(state.initialPlayerCount, 4);
  assert.equal(state.buttonId, 3);
  assert.deepEqual(state.players.map(player => player.position), original.players.map(player => player.position));
  assert.deepEqual(state.players.map(player => player.id), [0, 1, 2, 3]);
  assert.equal(state.pot, original.pot);
  assert.deepEqual(state.players.map(player => [player.stack, player.totalPaid]), original.players.map(player => [player.stack, player.totalPaid]));
  assert.equal(state.activeOpponentCount, 2);
  assert.deepEqual(state.activeOpponentIds, [0, 1]);
  assert.equal(state.observation.hasOutOfTurnExits, true);
  assert.equal(state.observation.actionsInferred, false);
  assert.equal(state.log.at(-1).source, 'OBSERVED_EXIT');
  assert.equal(state.log.at(-1).outOfTurn, true);
  assert.equal(state.analysisReadiness.status, 'READY');
  conserved(state);
});

test('exit of the current opponent advances only to the next pending physical seat', () => {
  const cfg = { ...config, playerCount: 6, heroPosition: 'BTN' };
  let state = replay(cfg);
  assert.equal(state.heroId, 5);
  assert.equal(state.actor, 2);
  assert.equal(state.analysisReadiness.status, 'BLOCKED');
  assert.ok(state.analysisReadiness.reasonCodes.includes('OPPONENT_TO_ACT'));
  state = replay(cfg, [exit(2), exit(3), exit(4)]);
  assert.equal(state.actor, 5);
  assert.equal(state.analysisReadiness.status, 'READY');
  assert.equal(state.pot, 1.5);
  assert.equal(state.log.length, 5);
  assert.equal(state.log.filter(item => item.action === 'CALL' || item.action === 'CHECK').length, 0);
  conserved(state);
});

test('folded blind stays in the pot and postflop order does not become a newly renumbered heads-up table', () => {
  const events = [exit(3), act(2, 'CALL'), exit(1), act(0, 'CALL')];
  let state = replay(config, events);
  assert.equal(state.phase, 'WAIT_BOARD');
  assert.equal(state.analysisReadiness.status, 'WAIT_BOARD');
  assert.equal(state.pot, 3);
  assert.equal(state.players[1].totalPaid, 1);
  assert.equal(state.players[1].stack, 99);
  assert.deepEqual(state.pots, [{ amount: 3, eligible: [0, 2] }]);
  events.push(board(['2s', '3h', '4d']));
  state = replay(config, events);
  assert.equal(state.actor, 0);
  assert.equal(state.heroId, 2);
  assert.equal(state.players[2].position, 'CO');
  events.push(act(0, 'CHECK'));
  state = replay(config, events);
  assert.equal(state.actor, 2);
  assert.equal(state.analysisReadiness.status, 'READY');
  assert.deepEqual(state.legal.actions, ['FOLD', 'CHECK', 'BET']);
  assert.equal(state.legal.maxTo, 3);
  conserved(state);
});

test('undo by replay restores the same positions, actor, stacks and pot exactly', () => {
  const prefix = [exit(3), act(2, 'CALL')], before = replay(config, prefix);
  const extended = [...prefix, exit(1)];
  assert.equal(replay(config, extended).activeOpponentCount, 1);
  assert.deepEqual(replay(config, extended.slice(0, -1)), before);
  assert.equal(prefix.length, 2);
});

test('strict action order remains strict and observations reject invalid, hero, folded and completed seats', () => {
  assert.throws(() => replay(config, [act(3, 'FOLD')]), /out of turn/);
  assert.throws(() => replay(config, [exit(2)]), error => error.code === 'HERO_USE_ACTION');
  assert.throws(() => replay(config, [exit(9)]), error => error.code === 'INVALID_SEAT');
  assert.throws(() => replay(config, [exit('3')]), error => error.code === 'INVALID_SEAT');
  assert.throws(() => replay(config, [exit(3), exit(3)]), error => error.code === 'ALREADY_FOLDED');
  assert.throws(() => replay(config, [act(2, 'CALL'), act(3, 'CALL'), exit(3)]), error => error.code === 'NO_PENDING_RESPONSE');
  assert.throws(() => replay(config, [act(2, 'CALL'), act(3, 'CALL'), act(0, 'CALL'), act(1, 'CHECK'), exit(3)]), error => error.code === 'ROUND_CLOSED');
});

test('unmatched upper contribution cannot be removed out of turn and create an ownerless pot', () => {
  const before = replay(config);
  assert.equal(before.players[1].canMarkFold, false);
  assert.equal(before.players[1].markFoldReason, 'UNMATCHED_CONTRIBUTION');
  assert.throws(() => replay(config, [exit(1)]), error => error.code === 'UNMATCHED_CONTRIBUTION');
  const afterCall = replay(config, [act(2, 'CALL')]);
  assert.equal(afterCall.players[1].canMarkFold, true);
  const afterExit = replay(config, [act(2, 'CALL'), exit(1)]);
  assert.equal(afterExit.actor, 3);
  assert.equal(afterExit.players[1].totalPaid, 1);
  assert.equal(afterExit.pot, 2.5);
  assert.ok(afterExit.pots.every(pot => pot.eligible.length));
  conserved(afterExit);
});

test('last opponent exit finishes the hand, awards all dead money and blocks stale analysis', () => {
  const state = replay(config, [exit(3), exit(0), exit(1)]);
  assert.equal(state.phase, 'FINISHED');
  assert.equal(state.result.reason, 'ALL_FOLDED');
  assert.deepEqual(state.result.winners, [2]);
  assert.equal(state.players[2].stack, 101.5);
  assert.equal(state.activeOpponentCount, 0);
  assert.equal(state.analysisReadiness.status, 'BLOCKED');
  assert.ok(state.analysisReadiness.reasonCodes.includes('HAND_FINISHED'));
  assert.deepEqual(state.legal.actions, []);
  conserved(state);
});

test('all-in, side-pot and a call consuming the hero stack explicitly block the simple EV model', () => {
  const cfg = { ...config, playerCount: 3, heroPosition: 'BTN', stacks: [10, 20, 30] };
  let state = replay(cfg, [act(2, 'RAISE', 3.5), act(0, 'RAISE', 10), act(1, 'RAISE', 20)]);
  assert.equal(state.actor, 2);
  assert.equal(state.analysisReadiness.status, 'BLOCKED');
  assert.ok(state.analysisReadiness.reasonCodes.includes('LIVE_ALL_IN_UNMODELED'));
  assert.ok(state.analysisReadiness.reasonCodes.includes('SIDE_POTS_UNMODELED'));
  assert.equal(state.players[0].allIn, true);
  assert.equal(state.players[0].canMarkFold, false);
  assert.throws(() => replay(cfg, [act(2, 'RAISE', 3.5), act(0, 'RAISE', 10), act(1, 'RAISE', 20), exit(0)]), error => error.code === 'ALL_IN_CANNOT_FOLD');
  state = replay({ ...config, stacks: [100, 100, 1, 100] });
  assert.equal(state.actor, 2);
  assert.ok(state.analysisReadiness.reasonCodes.includes('CALL_REACHES_ALL_IN'));
  conserved(state);
});

test('hero fold and absent cards cannot receive a ready recommendation', () => {
  const folded = replay(config, [act(2, 'FOLD')]);
  assert.equal(folded.heroId, 2);
  assert.equal(folded.analysisReadiness.status, 'BLOCKED');
  assert.ok(folded.analysisReadiness.reasonCodes.includes('HERO_FOLDED'));
  assert.ok(replay({ ...config, heroCards: [] }).analysisReadiness.reasonCodes.includes('HERO_CARDS_INCOMPLETE'));
});

test('six table sizes retain chip and turn invariants through legal streets and settlements', () => {
  const cards = ['2s', '3h', '4d', '5c', '6h'];
  for (let count = 2; count <= 7; count++) {
    const cfg = { ...config, playerCount: count, heroPosition: count === 2 ? 'BTN' : POSITIONS[count].at(-1) };
    const events = [];
    for (let step = 0; step < 90; step++) {
      const state = replay(cfg, events);
      conserved(state);
      if (state.phase === 'FINISHED') break;
      if (state.phase === 'WAIT_BOARD') events.push(board(cards.slice(0, { FLOP: 3, TURN: 4, RIVER: 5 }[state.nextStreet])));
      else if (state.phase === 'SHOWDOWN') events.push({ type: 'SETTLE', winners: state.pots.map(pot => pot.eligible), rake: .01 });
      else events.push(act(state.actor, state.legal.toCall ? 'CALL' : 'CHECK'));
    }
    const final = replay(cfg, events);
    assert.equal(final.phase, 'FINISHED');
    conserved(final);
  }
});
