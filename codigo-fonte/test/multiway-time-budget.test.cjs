'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Lcg } = require('../src/equity-engine');

const filename = path.resolve(__dirname, '../src/multiway-evaluator.js');
const localRequire = createRequire(filename);
const fast = localRequire('./fast-evaluator');
const insights = localRequire('./hand-insights');
const handFlow = localRequire('./hand-flow');
const plain = value => JSON.parse(JSON.stringify(value));

function river(extra = {}) {
  const config = { variant: 'PLO4_HIGH', playerCount: 2, heroPosition: 'BB', startingStack: 20,
    smallBlind: .5, bigBlind: 1, heroCards: ['As', 'Ah', 'Kd', 'Qc'] };
  const board = ['2s', '3h', '4d', '8c', '9s'];
  const events = [{ type: 'ACT', actor: 0, action: 'CALL' }, { type: 'ACT', actor: 1, action: 'CHECK' }];
  for (const length of [3, 4, 5]) {
    events.push({ type: 'BOARD', cards: board.slice(0, length) });
    if (length < 5) events.push({ type: 'ACT', actor: 1, action: 'CHECK' }, { type: 'ACT', actor: 0, action: 'CHECK' });
  }
  return { config, events, handId: 'time-budget-test', revisionKey: 'current-revision', samples: 32,
    timeBudgetMs: 100, assumeNoRake: true, ...extra };
}

// Keep the real card evaluator, replay ledger and policy. Only the clock and
// injected interruption are controlled, so cold/partial deadlines are repeatable.
function load({ expireAtInitialization = false, expireAfterNormalization = false, failScoreAt = null, scoreError, failCandidateAction = null } = {}) {
  let now = 0, clockCalls = 0, scoreCalls = 0, initializationCalls = 0, insightCalls = 0;
  const candidateActions = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    performance: { now() { clockCalls++; return expireAfterNormalization && clockCalls > 1 ? 101 : now; } },
    require(name) {
      if (name === './fast-evaluator') return { ...fast,
        initialize() { initializationCalls++; fast.initialize(); if (expireAtInitialization) now = 101; },
        omahaScore(...args) {
          scoreCalls++;
          if (scoreCalls === failScoreAt) throw scoreError || Object.assign(new Error('The calculation reached its time budget.'), { code: 'TIME_BUDGET' });
          return fast.omahaScore(...args);
        }
      };
      if (name === './hand-flow') return { ...handFlow, replay(config, events) {
        if (scoreCalls && events.length === river().events.length + 1) {
          const action = events.at(-1).action;
          candidateActions.push(action);
          if (action === failCandidateAction) throw Object.assign(new Error('The calculation reached its time budget.'), { code: 'TIME_BUDGET' });
        }
        return handFlow.replay(config, events);
      } };
      if (name === './hand-insights') return { ...insights, describeHand(...args) { insightCalls++; return insights.describeHand(...args); } };
      return localRequire(name);
    }
  }, { filename });
  return { ...module.exports, stats: () => ({ initializationCalls, scoreCalls, insightCalls }), candidateActions: () => [...candidateActions] };
}

function assertUnknownExceptFold(result) {
  assert.equal(result.status, 'OK');
  assert.equal(result.analysisStage, 'PROVISIONAL');
  assert.equal(result.refinement.status, 'TIME_BUDGET');
  assert.match(result.refinement.reasonEnglish, /before any complete joint world/);
  assert.equal(result.multiwayEvaluation.samples, 0);
  assert.equal(result.multiwayEvaluation.effectiveSamples, 0);
  assert.equal(result.multiwayEvaluation.stopReason, 'TIME_BUDGET');
  assert.equal(result.multiwayEvaluation.partial, true);
  assert.equal(result.equity.equity, null);
  assert.equal(result.equity.confidenceInterval95, null);
  assert.equal(result.equity.samples, 0);
  assert.equal(result.equity.effectiveSamples, 0);
  const fold = result.ev.actions.FOLD;
  assert.equal(fold.legal, true);
  assert.equal(fold.status, 'MODELED');
  assert.equal(fold.ev, 0);
  assert.equal(fold.evBB, 0);
  assert.deepEqual(fold.confidenceInterval95, [0, 0]);
  assert.deepEqual(fold.numericalBounds, [0, 0]);
  assert.equal(fold.method, 'DECISION_REFERENCE');
  assert.equal(fold.numericalQuality, 'DECISION_REFERENCE');
  assert.equal(fold.numericalScope, 'EXACT_REFERENCE');
  for (const item of result.ev.candidates.filter(item => item.action !== 'FOLD')) {
    assert.equal(item.status, 'NOT_MODELED');
    assert.equal(item.ev, null);
    assert.equal(item.evBB, null);
    assert.equal(item.confidenceInterval95, null);
    assert.equal(item.confidenceInterval95BB, null);
    assert.equal(item.differenceToBestModeledBB, null);
    assert.equal(item.samples, 0);
    assert.equal(item.unavailableReasonCode, 'NO_COMPLETE_JOINT_WORLDS');
    assert.match(item.unavailableReason, /time budget/);
  }
  for (const action of result.legalActions.filter(action => action !== 'FOLD')) {
    assert.equal(result.ev.actions[action].numericalBounds, null);
    assert.equal(result.ev.actions[action].numericalQuality, 'NOT_AVAILABLE');
  }
  assert.equal(result.ev.comparisonStatus, 'PARTIAL');
  assert.equal(result.ev.comparisonComplete, false);
  assert.equal(result.ev.leaderConclusive, false);
  assert.equal(result.ev.globalBestSupported, false);
  assert.deepEqual(result.ev.comparableActions, ['FOLD']);
  assert.equal(result.ev.gapBestSecondCandidateBB, null);
  assert.equal(result.recommendedAction, 'NO_DECISION');
  assert.equal(result.recommendation.action, null);
  assert.equal(result.recommendation.status, 'PROVISIONAL');
  assert.equal(result.ev.decisionPrecision.source, 'LEGACY_CONTEXT_CONTINUATION');
  assert.equal(result.ev.decisionPrecision.resultStatus, 'HEURISTIC');
  assert.equal(result.ev.decisionPrecision.status, 'INCONCLUSIVE');
  assert.equal(result.ev.decisionPrecision.modelUncertaintyIncluded, false);
  assert.equal(result.provenance.stopReason, 'TIME_BUDGET');
  assert.equal(result.provenance.samples, 0);
  assert.equal(result.continuationAssessment.equity, null);
  assert.equal(result.continuationAssessment.evChips, null);
  assert.equal(result.handInsights, null);
  assert.ok(result.analysisDiagnostics.reasonCodes.includes('SAMPLING_TIME_BUDGET'));
}

test('cold initialization exhausting the budget returns only the legal exact Fold reference', () => {
  const evaluator = load({ expireAtInitialization: true }), input = river(), before = JSON.stringify(input);
  const result = plain(evaluator.evaluateMultiway(input));
  assertUnknownExceptFold(result);
  assert.deepEqual(result.ev.actions.CHECK.missingInputs, []);
  assert.equal(result.ev.actions.CALL.status, 'NOT_LEGAL');
  assert.equal(result.ev.actions.CALL.ev, null);
  assert.equal(result.multiwayEvaluation.handId, input.handId);
  assert.equal(result.multiwayEvaluation.revisionKey, input.revisionKey);
  assert.deepEqual(evaluator.stats(), { initializationCalls: 1, scoreCalls: 0, insightCalls: 0 });
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(result).includes('NaN'), false);
});

test('a budget already exhausted by validation skips cold initialization and sampling', () => {
  const evaluator = load({ expireAfterNormalization: true });
  assertUnknownExceptFold(plain(evaluator.evaluateMultiway(river())));
  assert.deepEqual(evaluator.stats(), { initializationCalls: 0, scoreCalls: 0, insightCalls: 0 });
});

test('a preflop three-player timeout keeps CALL and every legal RAISE size unknown', () => {
  const evaluator = load({ expireAtInitialization: true });
  const input = { config: { variant: 'PLO5_HIGH', playerCount: 3, heroPosition: 'BTN', startingStack: 100,
    smallBlind: 1, bigBlind: 2, heroCards: ['As', 'Ks', 'Qh', 'Jh', 'Td'] }, events: [],
    handId: 'preflop-time-budget', samples: 32, timeBudgetMs: 100, assumeNoRake: true, chosenSize: 4.37 };
  const result = plain(evaluator.evaluateMultiway(input));
  assertUnknownExceptFold(result);
  assert.equal(result.state.street, 'PREFLOP');
  assert.equal(result.state.opponentCount, 2);
  assert.deepEqual(result.legalActions, ['FOLD', 'CALL', 'RAISE']);
  assert.equal(result.ev.actions.CALL.status, 'NOT_MODELED');
  assert.equal(result.ev.actions.CALL.ev, null);
  assert.equal(result.potMath.evCall, null);
  assert.ok(result.ev.candidates.some(item => item.action === 'RAISE' && item.size === 4.37 && item.ev === null));
});

test('interruption inside the first world discards every unfinished non-fold alternative', () => {
  const evaluator = load({ failScoreAt: 2 });
  assertUnknownExceptFold(plain(evaluator.evaluateMultiway(river())));
  assert.equal(evaluator.stats().scoreCalls, 2);
  assert.equal(evaluator.stats().insightCalls, 0);
});

test('a world with a completed CHECK but unfinished BET is not committed for any candidate', () => {
  const evaluator = load({ failCandidateAction: 'BET' });
  assertUnknownExceptFold(plain(evaluator.evaluateMultiway(river())));
  assert.deepEqual(evaluator.candidateActions(), ['CHECK', 'BET']);
});

test('completed worlds retain their exact means and unchanged simultaneous stopping bounds', () => {
  const reference = load(), input = river(), context = reference._testing.normalize(input);
  const world = reference._testing.drawWorld(context, new Lcg(context.seed));
  const scores = reference._testing.scoresFor(world), weight = reference._testing.historyWeight(context, world);
  const expected = context.candidates.map(candidate => candidate.action === 'FOLD' ? 0 : reference._testing.rollout(context, candidate, world, scores));
  const evaluator = load({ failScoreAt: context.state.activePlayers + 1 });
  const result = plain(evaluator.evaluateMultiway(input));
  assert.equal(result.multiwayEvaluation.samples, 1);
  assert.equal(result.equity.samples, 1);
  assert.equal(result.refinement.status, 'TIME_BUDGET');
  assert.equal(result.analysisStage, undefined);
  const lower = -context.state.players[context.state.heroId].stack;
  const upper = context.state.pot + context.state.players.filter(player => !player.hero).reduce((sum, player) => sum + player.stack, 0);
  for (let index = 0; index < result.ev.candidates.length; index++) {
    const item = result.ev.candidates[index];
    assert.equal(item.status, 'MODELED');
    assert.equal(item.ev, expected[index]);
    assert.equal(item.samples, item.action === 'FOLD' ? 0 : 1);
    assert.deepEqual(item.confidenceInterval95, item.action === 'FOLD' ? [0, 0] :
      plain(reference._testing.weightedBounds([expected[index]], [weight], lower, upper, context.candidates.length + 1, context.samples)));
  }
  const activeOpponents = context.state.players.filter(player => !player.folded && !player.hero);
  const max = Math.max(scores[context.state.heroId], ...activeOpponents.map(player => scores[player.id]));
  const tied = 1 + activeOpponents.filter(player => scores[player.id] === scores[context.state.heroId]).length;
  assert.equal(result.equity.equity, scores[context.state.heroId] === max ? 1 / tied : 0);
  assert.deepEqual(result.equity.confidenceInterval95, plain(reference._testing.weightedBounds([result.equity.equity], [weight], 0, 1, context.candidates.length + 1, context.samples)));
  assert.equal(result.ev.globalBestSupported, false);
  assert.equal(result.recommendation.action, null);
});

test('missing rake remains a genuine missing input even when no world completes', () => {
  const evaluator = load({ expireAtInitialization: true }), input = river();
  delete input.assumeNoRake;
  const result = plain(evaluator.evaluateMultiway(input));
  assertUnknownExceptFold(result);
  assert.deepEqual(result.ev.actions.CHECK.missingInputs, ['Declared rake or explicit no-rake assumption']);
  assert.equal(result.ev.feeBasis, 'UNKNOWN');
});

test('ordinary evaluator failures and invalid public inputs still fail rather than become partial EV', () => {
  const failure = Object.assign(new Error('Evaluator failed.'), { code: 'INTERNAL_FAILURE' });
  const evaluator = load({ failScoreAt: 1, scoreError: failure });
  assert.throws(() => evaluator.evaluateMultiway(river()), error => error === failure);
  const expired = load({ expireAtInitialization: true });
  assert.throws(() => expired.evaluateMultiway(river({ chosenSize: 500 })), /legal/);
  assert.equal(expired.stats().initializationCalls, 0);
});
