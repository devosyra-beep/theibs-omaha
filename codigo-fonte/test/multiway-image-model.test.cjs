'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const image = require('../public/multiway-image-model');

test('OCR candidates need a complete rank and suit and remain unconfirmed', () => {
  const result = image.reviewCards([{ text: 'Pot 12  Ah  K♠  QO  Jc  9h', confidence: .84 }], 4);
  assert.deepEqual(result.cards, ['Ah', 'Ks', 'Qd', 'Jc']);
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.confidence, .84);
  assert.match(result.issues.join(' '), /more cards/);
  assert.deepEqual(image.reviewCards([{ text: 'A K Q J' }], 4).cards, []);
});

test('unknown OCR confidence stays unknown instead of becoming a made-up percentage', () => {
  assert.equal(image.reviewCards([{ text: 'As Kd' }], 4).confidence, null);
});

test('review accepts complete PLO4/5/6 private cards and rejects duplicates', () => {
  const base = ['As', 'Kd', 'Qh', 'Jc', 'Ts', '9d'];
  for (const count of [4, 5, 6]) {
    const draft = image.validateReview({ variant: `PLO${count}_HIGH`, heroCards: base.slice(0, count), board: [], existingBoard: [], phase: 'BETTING' });
    assert.equal(draft.ok, true);
  }
  assert.equal(image.validateReview({ variant: 'PLO4_HIGH', heroCards: base.slice(0, 4), board: ['As', '2h', '3d'], existingBoard: [], phase: 'WAIT_BOARD', nextStreet: 'FLOP' }).ok, false);
});

test('image cannot advance the street before observed actions or overwrite recorded board', () => {
  const base = { variant: 'PLO4_HIGH', heroCards: ['As', 'Kd', 'Qh', 'Jc'], currentHero: ['As', 'Kd', 'Qh', 'Jc'] };
  const flop = ['2s', '3h', '4d'];
  assert.match(image.validateReview({ ...base, board: flop, phase: 'BETTING', nextStreet: 'FLOP' }).reason, /actions/);
  assert.equal(image.validateReview({ ...base, board: flop, phase: 'WAIT_BOARD', nextStreet: 'FLOP' }).boardChanged, true);
  assert.deepEqual(image.validateReview({ ...base, board: [...flop, '5c'], existingBoard: flop, phase: 'WAIT_BOARD', nextStreet: 'TURN' }).addedBoard, ['5c']);
  assert.match(image.validateReview({ ...base, board: ['2s', '6h', '4d'], existingBoard: flop, phase: 'WAIT_BOARD', nextStreet: 'TURN' }).reason, /conflicts/);
});

test('private cards can be reviewed before the photographed board is ready', () => {
  const draft = image.validateReview({ variant: 'PLO4_HIGH', heroCards: ['As', 'Kd', 'Qh', 'Jc'], board: [], existingBoard: [], phase: 'BETTING', scope: 'hero' });
  assert.equal(draft.ok, true);
  assert.equal(draft.heroChanged, true);
});
