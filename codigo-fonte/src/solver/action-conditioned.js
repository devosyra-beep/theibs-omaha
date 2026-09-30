'use strict';

const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const core = require('./extensive-solver');
const VERSION = 'THEIBS_ACTION_CONDITIONED_V1';
const TARGET = 'PRIVATE_INFORMATION_SET_COMMITMENT_VALUE';
const ORIGIN = 'OUTWARD_ROUNDED_INFORMATION_SET_BEST_RESPONSE_SADDLE_BOUNDS';
const SUPPORTED_GAME_CLASS = 'TWO_PLAYER_CONSTANT_SUM_PERFECT_RECALL';
const STOP = Symbol('action-conditioning-budget');

function buildActionConditionedGame(game, { player, informationSet, actionId, control = () => {} } = {}) {
  if (game?.playerCount !== 2 || ![0, 1].includes(player)) throw new Error('Action conditioning requires two players and a valid player index.');
  if (typeof informationSet !== 'string' || !informationSet || typeof actionId !== 'string' || !actionId) throw new Error('Action conditioning requires an information set and action ID.');
  let count = 0;
  const path = new Set();
  function copy(node, beforeDecision) {
    control();
    if (!node || path.has(node)) throw new Error('The conditioned game must be a finite tree.');
    path.add(node);
    let result;
    if (node.type === 'terminal') result = { ...node, payoffs: node.payoffs.slice() };
    else if (node.type === 'chance') result = { ...node, outcomes: node.outcomes.map(outcome => ({ ...outcome, node: copy(outcome.node, beforeDecision) })) };
    else if (node.type === 'decision') {
      let actions = node.actions;
      if (node.player === player && node.informationSet === informationSet) {
        if (!beforeDecision) throw new Error('Only an initial decision information set can be conditioned.');
        actions = actions.filter(action => action.id === actionId);
        if (actions.length !== 1) throw new Error('The conditioned action must exist exactly once at every information-set member.');
        count++;
      }
      result = { ...node, actions: actions.map(action => ({ ...action, node: copy(action.node, false) })) };
    } else throw new Error('Unknown conditioned game node type.');
    path.delete(node);
    return result;
  }
  const root = copy(game.root, true);
  if (!count) throw new Error('The requested information set is not in this game.');
  const commitment = { version: VERSION, target: TARGET, player, informationSet, actionId,
    scope: 'FULL_PRIOR_EX_ANTE_VALUE_WITH_ONE_PRIVATE_INFORMATION_SET_ACTION_FIXED',
    privateInformationPreserved: true, originalHandActionEV: false };
  const suffix = createHash('sha256').update(JSON.stringify([VERSION, player, informationSet, actionId])).digest('hex');
  return { ...game, id: `${game.id ?? 'game'}:commitment:${suffix}`, root,
    meta: { ...game.meta, actionConditioning: commitment } };
}

function evaluateActionConditioned(game, strategy, options = {}) {
  const conditioned = buildActionConditionedGame(game, options);
  const bounds = core.saddleBounds(conditioned, strategy, options.player, options);
  return { ...bounds, version: VERSION, target: TARGET, origin: ORIGIN,
    actionId: options.actionId, informationSet: options.informationSet,
    supportedGameClass: bounds.certified ? SUPPORTED_GAME_CLASS : null,
    lowerBB: bounds.lower, upperBB: bounds.upper, boundsBB: bounds.bounds,
    originalHandActionEV: false, fullPriorPreserved: true };
}

function solveActionConditioned(game, options = {}) {
  const started = performance.now();
  const timeBudgetMs = options.timeBudgetMs ?? Infinity;
  if (!(timeBudgetMs === Infinity || Number.isFinite(timeBudgetMs) && timeBudgetMs >= 0)) throw new Error('timeBudgetMs must be nonnegative.');
  const actions = [], player = options.player, informationSet = options.informationSet;
  const envelope = { version: VERSION, target: TARGET, origin: ORIGIN, solverVersion: core.VERSION,
    player, informationSet, baseGameHash: null, supportedGameClass: null,
    utility: { unit: 'BB', basis: 'INCREMENTAL_TERMINAL_PAYOFF_FROM_ORIGINAL_DECISION', scope: 'FULL_PRIOR_EX_ANTE' },
    originalHandActionEV: false, fullPriorPreserved: true, actions };
  let termination = 'COMPLETE', visits = 0;
  const remaining = () => Math.max(0, timeBudgetMs - (performance.now() - started));
  function control(force = false) {
    if (!force && ++visits % 128 !== 0) return;
    if (options.shouldCancel?.()) { termination = 'CANCELLED'; throw STOP; }
    if (remaining() <= 0) { termination = 'TIME_BUDGET'; throw STOP; }
  }
  try {
    control(true);
    const validation = core.validateGame(game, options, control);
    if (game.playerCount !== 2 || validation.constantSum === null) throw new Error('Action certificates require a two-player constant-sum game.');
    envelope.baseGameHash = validation.gameHash;
    const requestedIds = options.actionIds;
    if (!Array.isArray(requestedIds) || !requestedIds.length || requestedIds.some(id => typeof id !== 'string' || !id) || new Set(requestedIds).size !== requestedIds.length) throw new Error('actionIds must contain distinct action IDs.');
    for (const id of requestedIds) {
      control(true);
      const actionStarted = performance.now();
      const conditioned = buildActionConditionedGame(game, { player, informationSet, actionId: id, control });
      const prior = options.checkpoints?.[id];
      // Reserve time for the independent best-response certificate instead of
      // spending the entire chunk on an uncertified last CFR iteration.
      const iterationBudgetMs = remaining() === Infinity ? Infinity : remaining() * .65;
      const solved = core.solve(conditioned, { ...options, checkpoint: prior, timeBudgetMs: iterationBudgetMs });
      // An interrupted validation cannot certify a supplied checkpoint's game
      // identity. The caller may retain an already validated cached checkpoint,
      // but this function never reexports an unvalidated incoming checkpoint.
      const checkpoint = solved.checkpoint || null;
      const result = { id, target: TARGET, origin: ORIGIN, version: VERSION, solverVersion: core.VERSION,
        baseGameHash: validation.gameHash, gameHash: solved.gameHash, player, informationSet,
        estimateBB: null, lowerBB: null, upperBB: null, boundsBB: null, certified: false,
        iterations: solved.iterations, additionalIterations: solved.additionalIterations,
        strategicDecisionCount: solved.metrics.strategicDecisionCount ?? null,
        elapsedMs: 0, checkpoint, termination: solved.termination,
        profileValueBB: solved.values?.[player] ?? null, convergence: solved.convergence,
        originalHandActionEV: false, fullPriorPreserved: true, supportedGameClass: null,
        rootActionFixed: id, utility: envelope.utility };
      if (solved.strategy && remaining() > 0 && !options.shouldCancel?.()) {
        const certified = core.saddleBounds(conditioned, solved.strategy, player, { ...options, timeBudgetMs: remaining() });
        if (certified.certified) {
          Object.assign(result, { certified: true, lowerBB: certified.lower, upperBB: certified.upper,
            boundsBB: certified.bounds, estimateBB: certified.lower / 2 + certified.upper / 2,
            estimateMethod: 'SADDLE_INTERVAL_MIDPOINT', widthBB: certified.width,
            supportedGameClass: SUPPORTED_GAME_CLASS, rounding: certified.rounding,
            probabilitySemantics: certified.probabilitySemantics, constantSumBounds: certified.constantSumBounds,
            originalConstantSumBounds: certified.originalConstantSumBounds,
            opponentBestResponseUtility: certified.opponentBestResponseUtility,
            payoffNormalizationMaxResidual: certified.payoffNormalizationMaxResidual,
            bestResponseBounds: certified.bestResponseBounds, perfectRecall: true,
            certificateElapsedMs: certified.elapsedMs });
          envelope.supportedGameClass = SUPPORTED_GAME_CLASS;
        } else result.termination = certified.termination;
      }
      if (options.shouldCancel?.()) result.termination = 'CANCELLED';
      result.elapsedMs = performance.now() - actionStarted;
      actions.push(result);
      if (['TIME_BUDGET', 'CANCELLED'].includes(result.termination)) termination = result.termination;
    }
  } catch (error) {
    if (error !== STOP) throw error;
  }
  return { ...envelope, termination, metrics: { elapsedMs: performance.now() - started,
    actionCount: actions.length, certifiedActionCount: actions.filter(action => action.certified).length,
    additionalIterations: actions.reduce((sum, action) => sum + action.additionalIterations, 0) } };
}

module.exports = { VERSION, TARGET, ORIGIN, SUPPORTED_GAME_CLASS, buildActionConditionedGame, evaluateActionConditioned, solveActionConditioned };
