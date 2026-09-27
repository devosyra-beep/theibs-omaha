'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CARD_RANKS, CARD_SUITS, CardKeyboardState, normalizeKeyboardRank,
  normalizeKeyboardCard, portugueseCard, parsePortugueseCards, toCanonical, fromCanonical
} = require('../public/card-model');

test('D, T and 10 normalize to the same rank in both cases', () => {
  for (const rank of ['D', 'd', 'T', 't', '10']) {
    assert.equal(normalizeKeyboardRank(rank), 'T');
    for (const suit of CARD_SUITS) {
      assert.equal(portugueseCard(rank + suit.code), 'T' + suit.code);
      assert.equal(normalizeKeyboardCard(rank + suit.code.toLowerCase()), 'T' + suit.code);
      assert.equal(toCanonical(rank + suit.code), 'T' + suit.canonical);
    }
  }
});

test('all 52 cards round trip without changing the suit boundary', () => {
  assert.equal(CARD_RANKS.length * CARD_SUITS.length, 52);
  for (const rank of CARD_RANKS) for (const suit of CARD_SUITS) {
    const card = rank + suit.code;
    assert.equal(fromCanonical(toCanonical(card)), card);
  }
  assert.equal(toCanonical('dc'), 'Th');
  assert.equal(toCanonical('dp'), 'Tc');
  assert.equal(normalizeKeyboardCard('Ad'), 'AO');
  assert.equal(fromCanonical('Td'), 'TO');
  assert.throws(() => fromCanonical('Dd'));
});

test('mixed aliases work in compact text, separators and suit symbols', () => {
  assert.deepEqual(parsePortugueseCards('de tc | 10o; d♣'), ['TE', 'TC', 'TO', 'TP']);
  assert.deepEqual(parsePortugueseCards('detc10odp'), ['TE', 'TC', 'TO', 'TP']);
});

test('aliases cannot bypass duplicate checks and failed paste is atomic', () => {
  assert.throws(() => parsePortugueseCards('DE TE'), /Duplicate card/);
  assert.throws(() => parsePortugueseCards('DP 10P'), /Duplicate card/);
  const state = new CardKeyboardState();
  state.assign('DE');
  const before = state.snapshot();
  assert.equal(state.paste('KC TE'), false);
  assert.deepEqual(state.snapshot(), before);
});

test('all variants preserve aliases, undo, board positions and canonical export', () => {
  for (const count of [4, 5, 6]) {
    const state = new CardKeyboardState(count);
    const hero = ['DE', 'TC', '10O', 'DP', 'AE', 'KC'].slice(0, count);
    assert.equal(state.paste(hero.join(' ') + ' 2E 3C 4O'), true);
    assert.equal(state.selected, count + 3);
    assert.deepEqual(state.canonicalCards().heroCards, ['Ts', 'Th', 'Td', 'Tc', 'As', 'Kh'].slice(0, count));
    const before = state.snapshot();
    state.select(count + 1);
    state.removeSelected();
    assert.equal(state.validation().valid, false);
    state.undo();
    assert.deepEqual(state.slots, before.slots);
    const restored = new CardKeyboardState();
    assert.equal(restored.restore(state.snapshot()), true);
    assert.deepEqual(restored.exportDraft(), state.exportDraft());
  }
});

test('invalid rank input stays invalid', () => {
  for (const rank of ['0', '1', 'DD', 'Enter', 'E', 'Dead']) assert.equal(normalizeKeyboardRank(rank), null);
  for (const card of ['DD', '1E', '0C', 'D', '10', 'DDE']) assert.throws(() => portugueseCard(card));
});
