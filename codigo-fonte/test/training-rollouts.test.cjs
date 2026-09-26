'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSession, publicSession } = require('../src/training-simulator');
const { replay } = require('../src/hand-flow');
const { evaluateTraining, trainingEvaluationInput, sizeCandidates, _testing } = require('../src/training-evaluator');
const fast = require('../src/fast-evaluator');
fast.initialize();

function riverContext(heroCards, board) {
  const config = { variant: 'PLO4_HIGH', playerCount: 2, heroPosition: 'BTN', startingStack: 100,
    smallBlind: 1, bigBlind: 2, heroCards };
  const events = [{ type: 'ACT', actor: 0, action: 'CALL' }, { type: 'ACT', actor: 1, action: 'CHECK' }];
  for (const count of [3, 4, 5]) {
    events.push({ type: 'BOARD', cards: board.slice(0, count) }, { type: 'ACT', actor: 1, action: 'CHECK' });
    if (count !== 5) events.push({ type: 'ACT', actor: 0, action: 'CHECK' });
  }
  return { config, events, state: replay(config, events), opponentStyle: 'MIXED' };
}
const callOrCheck = ({ legal }) => ({ action: legal.toCall ? 'CALL' : 'CHECK' });

test('training input has only public cards/events and hides session seed and future deal', () => {
  const session = createSession({ seed: 174, targetStreet: 'FLOP' });
  const before = trainingEvaluationInput(session, { samples: 32 });
  session.villainCards = ['As']; session.boardAll = ['Ks']; session.seed = 999;
  assert.deepEqual(trainingEvaluationInput(session, { samples: 32 }), before);
  assert.equal(before.seed, undefined);
  assert.equal(before.events.filter(event => event.type === 'BOARD').at(-1).cards.length, 3);
  const publicView = publicSession(session);
  assert.equal(publicView.revision, session.events.length);
  assert.ok(publicView.sizeCandidates.length);
  assert.equal(publicView.sizeCandidates.some(item => 'ev' in item), false);
});

test('fresh rollouts ignore injected hidden cards and are deterministic for the same public state', () => {
  const session = createSession({ seed: 13 });
  const input = trainingEvaluationInput(session, { samples: 32 });
  const first = evaluateTraining(input);
  const second = evaluateTraining({ ...input, villainCards: ['As'], boardAll: ['Ks'], seed: session.seed, evaluationSeed: 7 });
  assert.deepEqual(first.trainingEvaluation.candidates, second.trainingEvaluation.candidates);
  assert.equal(first.trainingEvaluation.seed, second.trainingEvaluation.seed);
  assert.notEqual(first.trainingEvaluation.seed, session.seed);
  assert.equal(first.ev.comparisonComplete, true);
  assert.deepEqual(first.ev.missingLegalActions, []);
  assert.equal(first.ev.actions.RAISE.model, 'POLICY_ROLLOUT');
  assert.ok(first.trainingEvaluation.candidates.filter(item => item.action === 'RAISE').length >= 3);
});

test('arbitrary legal size is separately evaluated with identical worlds for common candidates', () => {
  const session = createSession({ seed: 42 });
  const first = evaluateTraining(trainingEvaluationInput(session, { samples: 32 }));
  const second = evaluateTraining(trainingEvaluationInput(session, { samples: 32, chosenSize: 4.37, chosenAction: 'RAISE' }));
  assert.equal(second.trainingEvaluation.chosenOptionId, 'RAISE:4.37');
  assert.ok(second.trainingEvaluation.candidates.some(item => item.optionId === 'RAISE:4.37'));
  for (const candidate of first.trainingEvaluation.candidates) {
    const same = second.trainingEvaluation.candidates.find(item => item.optionId === candidate.optionId);
    assert.equal(same.ev, candidate.ev);
    assert.deepEqual(same.terminalOutcomes, candidate.terminalOutcomes);
  }
  assert.throws(() => evaluateTraining(trainingEvaluationInput(session, { samples: 32, chosenSize: 7 })), /entre/);
  assert.throws(() => evaluateTraining(trainingEvaluationInput(session, { samples: 32, chosenAction: 'RAISE' })), /tamanho/);
});

test('river value uses incremental cost, actual winner and conserved chips', () => {
  const board = ['Qs', 'Js', 'Ts', '5d', '6h'];
  const hero = ['As', 'Ks', '2d', '3c'], opponent = ['4h', '5h', '6d', '7c'];
  const context = riverContext(hero, board), world = { opponent, board, policySeed: 17 };
  const checked = _testing.rollout(context, { action: 'CHECK' }, world, callOrCheck);
  const bet = _testing.rollout(context, { action: 'BET', size: 2 }, world, callOrCheck);
  const lost = _testing.rollout(riverContext(opponent, board), { action: 'BET', size: 2 }, { opponent: hero, board, policySeed: 17 }, callOrCheck);
  assert.equal(checked.value, 4);
  assert.equal(bet.value, 6);
  assert.equal(lost.value, -2);
  for (const result of [checked, bet, lost]) assert.equal(result.terminalStacks.reduce((a, b) => a + b), 200);
});

test('fold returns decision-point zero; winning by fold returns current pot, not own uncalled bet', () => {
  const session = createSession({ seed: 2 });
  const context = _testing.normalizeInput(trainingEvaluationInput(session, { samples: 32 }));
  const world = { opponent: ['2c', '3c', '4c', '5c', '6c'], board: ['As', 'Ks', 'Qs', 'Js', 'Ts'], policySeed: 7 };
  assert.equal(_testing.rollout(context, { action: 'FOLD' }, world, () => { throw Error('No response after fold'); }).value, 0);
  assert.equal(_testing.rollout(context, { action: 'RAISE', size: 6 }, world, () => ({ action: 'FOLD' })).value, 3);
});

test('a tied showdown correctly splits pot after subtracting only new contributions', () => {
  const board = ['Qs', 'Jd', 'Tc', '9d', '8h'];
  const context = riverContext(['As', 'Kd', '2c', '3c'], board);
  const result = _testing.rollout(context, { action: 'BET', size: 2 }, {
    opponent: ['Ah', 'Ks', '4c', '5c'], board, policySeed: 1
  }, callOrCheck);
  assert.equal(result.value, 2);
  assert.deepEqual(result.terminalStacks, [100, 100]);
});

test('short all-in calls return uncalled chips before settling the contested pot', () => {
  const board = ['Qs', 'Js', 'Ts', '5d', '6h'];
  const hero = ['As', 'Ks', '2d', '3c'], opponent = ['4h', '5h', '6d', '7c'];
  const context = riverContext(hero, board);
  context.config.stacks = [10, 5];
  context.state = replay(context.config, context.events);
  const won = _testing.rollout(context, { action: 'BET', size: 4 }, { opponent, board, policySeed: 3 }, callOrCheck);
  assert.equal(won.value, 7);
  assert.deepEqual(won.terminalStacks, [15, 0]);
  const weak = riverContext(opponent, board);
  weak.config.stacks = [10, 5];
  weak.state = replay(weak.config, weak.events);
  const lost = _testing.rollout(weak, { action: 'BET', size: 4 }, { opponent: hero, board, policySeed: 3 }, callOrCheck);
  assert.equal(lost.value, -3);
  assert.deepEqual(lost.terminalStacks, [5, 10]);
});

test('policy receives only its own hand and current board, and can reraise legally', () => {
  const session = createSession({ seed: 24, variant: 'PLO4_HIGH' });
  const context = _testing.normalizeInput(trainingEvaluationInput(session, { samples: 32 }));
  const used = new Set(session.heroCards), remaining = require('../src/cards').cardCodes(require('../src/cards').makeDeck()).filter(card => !used.has(card));
  const world = { opponent: remaining.slice(0, 4), board: remaining.slice(4, 9), policySeed: 1 };
  const seenBoards = [], policy = argument => {
    assert.deepEqual(argument.cards, argument.style === 'AGGRESSIVE' ? world.opponent : session.heroCards);
    assert.equal('opponentCards' in argument, false);
    assert.equal('futureBoard' in argument, false);
    assert.deepEqual(argument.board, world.board.slice(0, argument.board.length));
    seenBoards.push(argument.board.length);
    if (argument.style === 'AGGRESSIVE' && argument.streetRaises === 0 && argument.legal.actions.includes('RAISE')) return { action: 'RAISE', to: argument.legal.minTo };
    return callOrCheck(argument);
  };
  context.opponentStyle = 'AGGRESSIVE';
  const result = _testing.rollout(context, { action: 'RAISE', size: 4 }, world, policy);
  assert.ok(result.raises > 0);
  assert.ok(seenBoards.includes(0) && seenBoards.includes(3) && seenBoards.includes(4) && seenBoards.includes(5));
  assert.equal(result.terminalStacks.reduce((a, b) => a + b), 200);
});

test('interval stays nondegenerate for zero observed variance and covers simultaneous candidate selection', () => {
  const stats = _testing.moments();
  for (let index = 0; index < 256; index++) _testing.addMoment(stats, 3);
  const interval = _testing.empiricalInterval(stats, -99, 101, 5);
  assert.ok(interval[0] < 3 && interval[1] > 3);
  const logarithm = Math.log(4 * 5 / .05);
  assert.ok(Math.abs(interval[1] - (3 + 7 * 200 * logarithm / (3 * 255))) < 1e-10);
  const leadership = _testing.candidateLeadership([
    { optionId: 'BET:2.00', ev: 3, confidenceInterval95: [1, 5] },
    { optionId: 'BET:4.00', ev: 2, confidenceInterval95: [1, 3] }
  ]);
  assert.equal(leadership.status, 'OVERLAPPING');
  assert.equal(leadership.simultaneousConfidenceLevel, .95);
});

test('all supported variants return legal complete action and sizing comparisons', () => {
  for (const variant of ['PLO4_HIGH', 'PLO5_HIGH', 'PLO6_HIGH']) {
    const session = createSession({ variant, seed: 11, targetStreet: 'RIVER' });
    const result = evaluateTraining(trainingEvaluationInput(session, { samples: 32 }));
    assert.equal(result.ev.comparisonComplete, true);
    for (const candidate of result.trainingEvaluation.candidates) {
      assert.ok(session.state.legal.actions.includes(candidate.action));
      assert.ok(Number.isFinite(candidate.ev));
      assert.ok(candidate.confidenceInterval95[0] <= candidate.ev && candidate.confidenceInterval95[1] >= candidate.ev);
    }
    assert.equal(result.trainingEvaluation.rangeAssumption, 'UNIFORM_AT_CURRENT_STATE_NOT_HISTORY_CONDITIONED');
    assert.ok(sizeCandidates(session.state).every(candidate => candidate.size >= session.state.legal.minTo && candidate.size <= session.state.legal.maxTo));
  }
});
