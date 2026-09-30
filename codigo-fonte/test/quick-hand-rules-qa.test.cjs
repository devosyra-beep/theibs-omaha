'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { replay } = require('../src/hand-flow');

const base = { variant:'PLO4_HIGH', playerCount:3, heroPosition:'BTN',
  startingStack:100, smallBlind:0.5, bigBlind:1, heroCards:['As','Kh','Qd','Jc'] };
const act = (actor, action, to) => ({ type:'ACT', actor, action, ...(to === undefined ? {} : { to }) });

function checkChips(state) {
  const cents = value => Math.round(value * 100);
  assert.equal(state.players.reduce((sum, item) => sum + cents(item.stack), 0) + cents(state.pot) + cents(state.rake), cents(state.totalChips));
  if (state.phase !== 'FINISHED') {
    assert.equal(state.players.reduce((sum, item) => sum + cents(item.totalPaid), 0), cents(state.pot));
    assert.equal(state.pots.reduce((sum, pot) => sum + cents(pot.amount), 0), cents(state.pot));
  }
}

test('short all-in raise does not reopen a player who already acted', () => {
  const config = { ...base, stacks:[5,100,100] };
  const events = [act(2,'RAISE',3.5), act(0,'RAISE',5), act(1,'CALL')];
  const state = replay(config, events);
  assert.equal(state.actor, 2);
  assert.equal(state.legal.toCall, 1.5);
  assert.deepEqual(state.legal.actions, ['FOLD','CALL']);
  assert.equal(state.players[0].allIn, true);
  assert.equal(state.currentBet, 5);
  assert.equal(state.lastFullRaise, 2.5);
  assert.throws(() => replay(config, [...events, act(2,'RAISE',10)]), /Illegal action/);
  checkChips(state);
});

test('pot-limit cap and cents reject invalid totals instead of silently adjusting them', () => {
  const initial = replay(base);
  assert.equal(initial.legal.maxTo, 3.5);
  for (const to of [3.51, 100, 3.005, -1, NaN])
    assert.throws(() => replay(base, [act(2,'RAISE',to)]));
  const valid = replay(base, [act(2,'RAISE',3.5)]);
  assert.equal(valid.players[2].streetPaid, 3.5);
  assert.equal(valid.players[2].stack, 96.5);
  checkChips(valid);
});

test('main and side pots stay eligible and chip-conserving through all-in showdown', () => {
  const config = { ...base, stacks:[10,20,30] };
  const events = [act(2,'RAISE',3.5), act(0,'RAISE',10), act(1,'RAISE',20), act(2,'CALL')];
  let state = replay(config, events);
  assert.equal(state.phase, 'WAIT_BOARD');
  assert.equal(state.pot, 50);
  assert.deepEqual(state.pots, [
    { amount:30, eligible:[0,1,2] },
    { amount:20, eligible:[1,2] }
  ]);
  assert.deepEqual(state.pending, []);
  checkChips(state);
  for (const cards of [['2s','3h','4d'],['2s','3h','4d','5c'],['2s','3h','4d','5c','6h']]) {
    events.push({ type:'BOARD', cards });
    state = replay(config, events);
    checkChips(state);
  }
  assert.equal(state.phase, 'SHOWDOWN');
  assert.throws(() => replay(config, [...events, {type:'SETTLE', winners:[[0],[0]]}]), /Invalid winner/);
  events.push({type:'SETTLE', winners:[[0],[1,2]], rake:0.01});
  state = replay(config, events);
  assert.equal(state.phase, 'FINISHED');
  assert.equal(state.pot, 0);
  assert.equal(state.rake, 0.01);
  checkChips(state);
});
