'use strict';

// Full-tree, alternating CFR+ with linear average-strategy weighting.
// Tammelin, https://arxiv.org/abs/1407.5042; Zinkevich et al., NIPS 2007.
// No equilibrium label is assigned here. Exact NashConv concerns ONLY this
// supplied finite game, never an unrepresented action/range or the full game.
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const VERSION = 'THEIBS_FULL_TREE_CFR_PLUS_V1';
const STOP = Symbol('solver-budget');
const DEFAULT_LIMITS = Object.freeze({ maxNodes: 250000, maxInformationSets: 100000, maxDepth: 512, maxWorkingBytes: 256 * 1024 * 1024 });
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const compilationContexts = new WeakMap();
const MAX_RETAINED_COMPILATION_BYTES = 8 * 1024 * 1024;

// An execution-local capability, never checkpoint data. Initialization happens
// inside the caller's existing compilation deadline/cancellation control.
function createCompilationContext(game, { maxRetainedBytes = MAX_RETAINED_COMPILATION_BYTES, immutableSourceContext } = {}) {
  if (!game || typeof game !== 'object') throw Error('A compilation context requires an owned game.');
  if (!Number.isSafeInteger(maxRetainedBytes) || maxRetainedBytes < 0 || maxRetainedBytes > MAX_RETAINED_COMPILATION_BYTES)
    throw Error('Compilation retention must be between zero and 8 MiB.');
  const source = immutableSourceContext === undefined ? null : compilationContexts.get(immutableSourceContext);
  if (immutableSourceContext !== undefined && !source?.frozen) throw Error('The immutable source context is invalid or unprepared.');
  const context = Object.freeze({});
  compilationContexts.set(context, { game, limitsKey: null, frozen: false, compiled: null, disabled: false,
    deeplyFrozen: new WeakSet(), immutableSources: source ? [source.deeplyFrozen, ...source.immutableSources] : [],
    stats: { compileCount: 0, reuseCount: 0, freezeMs: 0, compileMs: 0, retainedBytes: 0, maxRetainedBytes } });
  return context;
}
function compilationContextStats(context) {
  const state = compilationContexts.get(context);
  if (!state) throw Error('The compilation context is invalid or released.');
  return { ...state.stats };
}
function releaseCompilationContext(context) {
  const state = compilationContexts.get(context);
  if (state) { state.game = null; state.compiled = null; state.deeplyFrozen = null; state.immutableSources = null; }
  compilationContexts.delete(context);
}
function plainPrototype(prototype) {
  if (prototype === null || prototype === Object.prototype) return true;
  // A browser/VM structured clone may belong to another realm. Accept its
  // native Object prototype, never a class/custom prototype or an accessor.
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  return Object.getPrototypeOf(prototype) === null && typeof constructor?.value === 'function' &&
    constructor.value.prototype === prototype && Function.prototype.toString.call(constructor.value) === 'function Object() { [native code] }';
}
function plainArrayPrototype(prototype) {
  if (prototype === Array.prototype) return true;
  if (!prototype) return false;
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  return plainPrototype(Object.getPrototypeOf(prototype)) && typeof constructor?.value === 'function' &&
    constructor.value.prototype === prototype && Function.prototype.toString.call(constructor.value) === 'function Array() { [native code] }';
}
function freezeOwnedGame(game, control, deeplyFrozen, immutableSources) {
  const pending = [game], seen = new Set();
  function alreadyVerified(value) {
    if (deeplyFrozen.has(value)) return true;
    for (const source of immutableSources) if (source.has(value)) return true;
    return false;
  }
  while (pending.length) {
    control();
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value) || alreadyVerified(value)) continue;
    seen.add(value);
    const prototype = Object.getPrototypeOf(value);
    if (!(Array.isArray(value) ? plainArrayPrototype(prototype) : plainPrototype(prototype)))
      throw Error('Prepared games require plain owned data.');
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor.get || descriptor.set) throw Error('Prepared games cannot contain mutable accessor fields.');
      if (typeof descriptor.value === 'function') throw Error('Prepared games cannot contain executable fields.');
      if (descriptor.value && typeof descriptor.value === 'object') pending.push(descriptor.value);
    }
    // Freeze parents before walking children, so a control callback cannot
    // replace a not-yet-frozen branch while preparation is in progress.
    Object.freeze(value);
  }
  // Certify only after the entire reachable walk succeeds. A shallow freeze or
  // an interrupted walk never permits skipping a mutable descendant later.
  for (const value of seen) deeplyFrozen.add(value);
}
function compiledGame(game, options = {}, control = () => {}) {
  if (options.compilationContext === undefined) return compile(game, options, control);
  const state = compilationContexts.get(options.compilationContext);
  if (!state || state.game !== game) throw Error('The compilation context does not match this owned game.');
  const limitsKey = JSON.stringify(Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => [key, positiveInteger(options[key], fallback, key)]));
  if (state.limitsKey !== null && state.limitsKey !== limitsKey) throw Error('The compilation context limits changed.');
  state.limitsKey = limitsKey;
  control(true);
  if (state.compiled) { state.stats.reuseCount++; return state.compiled; }
  if (!state.frozen) {
    const started = performance.now();
    try { freezeOwnedGame(game, control, state.deeplyFrozen, state.immutableSources); state.frozen = true; }
    finally { state.stats.freezeMs += performance.now() - started; }
  }
  const started = performance.now(); let compiled;
  try { state.stats.compileCount++; compiled = compile(game, options, control); }
  finally { state.stats.compileMs += performance.now() - started; }
  // A retention ceiling is an optimization gate, never an admission rule.
  // Oversized contexts keep the original uncached numerical path.
  if (!state.disabled && compiled.metrics.estimatedWorkingBytes <= state.stats.maxRetainedBytes) {
    state.compiled = compiled; state.stats.retainedBytes = compiled.metrics.estimatedWorkingBytes;
  } else state.disabled = true;
  return compiled;
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function compile(game, options = {}, control = () => {}) {
  if (!game || typeof game !== 'object' || !Number.isSafeInteger(game.playerCount) || game.playerCount < 2 || game.playerCount > 16) {
    throw new Error('The game must identify between 2 and 16 players.');
  }
  const limits = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([key, value]) => [key, positiveInteger(options[key], value, key)]));
  const nodes = [], informationSets = [], infoLookup = new Map(), path = new Set();
  const hash = createHash('sha256');
  let edges = 0, maxDepth = 0, terminalCount = 0, constantSum = null, isConstantSum = true, estimatedWorkingBytes = 0;
  hash.update(JSON.stringify([VERSION, game.id ?? null, game.playerCount]));
  function visit(node, depth, recalls) {
    control();
    if (!node || typeof node !== 'object') throw new Error('Every edge must reference a game node.');
    if (path.has(node)) throw new Error('A finite game cannot contain a cycle.');
    if (depth > limits.maxDepth) throw new Error('Game depth exceeds the configured limit.');
    if (nodes.length >= limits.maxNodes) throw new Error('Game nodes exceed the configured limit.');
    maxDepth = Math.max(maxDepth, depth);
    path.add(node);
    const index = nodes.length, compiled = { type: node.type, index };
    nodes.push(compiled);
    estimatedWorkingBytes += 256;
    if (node.type === 'terminal') {
      if (!Array.isArray(node.payoffs) || node.payoffs.length !== game.playerCount || !node.payoffs.every(finite)) throw new Error('Terminal payoffs must be finite and include every player.');
      compiled.payoffs = node.payoffs.slice();
      const sum = node.payoffs.reduce((a, b) => a + b, 0);
      if (constantSum === null) constantSum = sum;
      else if (Math.abs(sum - constantSum) > 1e-10 * Math.max(1, Math.abs(sum), Math.abs(constantSum))) isConstantSum = false;
      hash.update(JSON.stringify(['T', compiled.payoffs]));
      terminalCount++;
    } else if (node.type === 'chance') {
      if (!Array.isArray(node.outcomes) || !node.outcomes.length) throw new Error('A chance node needs outcomes.');
      const probabilities = node.outcomes.map(outcome => outcome.probability);
      if (!probabilities.every(p => finite(p) && p >= 0 && p <= 1) || Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) > 1e-12) throw new Error('Chance probabilities must sum to one.');
      compiled.probabilities = probabilities;
      hash.update(JSON.stringify(['C', probabilities]));
      compiled.children = node.outcomes.map(outcome => visit(outcome.node, depth + 1, recalls));
      edges += compiled.children.length;
    } else if (node.type === 'decision') {
      if (!Number.isSafeInteger(node.player) || node.player < 0 || node.player >= game.playerCount) throw new Error('Decision player is invalid.');
      if (typeof node.informationSet !== 'string' || !node.informationSet.length) throw new Error('Every decision needs a nonempty information set.');
      if (!Array.isArray(node.actions) || !node.actions.length) throw new Error('Every decision needs legal actions.');
      const actions = node.actions.map(action => action.id);
      if (!actions.every(action => typeof action === 'string' && action.length) || new Set(actions).size !== actions.length) throw new Error('Action IDs must be unique nonempty strings.');
      const key = JSON.stringify([node.player, node.informationSet]);
      const remembered = JSON.stringify(recalls[node.player]);
      let info = infoLookup.get(key);
      if (!info) {
        if (informationSets.length >= limits.maxInformationSets) throw new Error('Information sets exceed the configured limit.');
        info = { index: informationSets.length, player: node.player, key: node.informationSet, actions, remembered, ownDepth: recalls[node.player].length, nodes: [] };
        infoLookup.set(key, info);
        informationSets.push(info);
        estimatedWorkingBytes += 256 + key.length * 2 + remembered.length * 2 + actions.reduce((sum, action) => sum + action.length * 2 + 80, 0);
      } else if (info.remembered !== remembered) throw new Error('Imperfect recall is not supported: an information set forgets an earlier own observation or action.');
      else if (JSON.stringify(info.actions) !== JSON.stringify(actions)) throw new Error('Actions must match throughout an information set.');
      compiled.info = info.index;
      compiled.player = node.player;
      info.nodes.push(index);
      hash.update(JSON.stringify(['D', node.player, node.informationSet, actions]));
      compiled.children = node.actions.map(action => {
        const nextRecalls = recalls.slice();
        nextRecalls[node.player] = recalls[node.player].concat([[node.informationSet, action.id]]);
        return visit(action.node, depth + 1, nextRecalls);
      });
      edges += compiled.children.length;
    } else throw new Error('Unknown game node type.');
    hash.update(']');
    estimatedWorkingBytes += (compiled.children?.length || 0) * 40;
    if (estimatedWorkingBytes > limits.maxWorkingBytes) throw new Error('Estimated solver working memory exceeds the configured limit.');
    path.delete(node);
    return index;
  }
  visit(game.root, 0, Array.from({ length: game.playerCount }, () => []));
  return { nodes, informationSets, playerCount: game.playerCount, hash: hash.digest('hex'), metrics: { nodeCount: nodes.length, informationSetCount: informationSets.length,
    strategicDecisionCount: informationSets.filter(info => info.actions.length > 1).length,
    terminalCount, edges, maxDepth, estimatedWorkingBytes, constantSum: isConstantSum ? constantSum : null, perfectRecall: true } };
}

function validateGame(game, options, control) {
  const compiled = compiledGame(game, options, control);
  return { gameHash: compiled.hash, ...compiled.metrics };
}

function normalized(values) {
  const sum = values.reduce((a, b) => a + b, 0);
  return sum > 0 ? values.map(value => value / sum) : values.map(() => 1 / values.length);
}

function readStrategy(compiled, strategy) {
  return compiled.informationSets.map(info => {
    if (strategy === undefined) return info.actions.map(() => 1 / info.actions.length);
    const supplied = strategy?.[info.player]?.[info.key];
    if (!supplied || typeof supplied !== 'object') throw new Error(`Missing strategy for player ${info.player}, information set ${info.key}.`);
    const row = info.actions.map(action => own(supplied, action) ? supplied[action] : NaN);
    if (!row.every(p => finite(p) && p >= 0 && p <= 1) || Math.abs(row.reduce((a, b) => a + b, 0) - 1) > 1e-10) throw new Error('Every information-set strategy must be a probability distribution.');
    return row;
  });
}

function exportStrategy(compiled, rows) {
  const strategy = Array.from({ length: compiled.playerCount }, () => Object.create(null));
  for (const info of compiled.informationSets) {
    strategy[info.player][info.key] = Object.fromEntries(info.actions.map((action, a) => [action, rows[info.index][a]]));
  }
  return strategy;
}

function expectedValues(compiled, policy, control = () => {}) {
  const cache = new Array(compiled.nodes.length);
  function value(index) {
    control();
    if (cache[index]) return cache[index];
    const node = compiled.nodes[index];
    if (node.type === 'terminal') return (cache[index] = node.payoffs);
    const probabilities = node.type === 'chance' ? node.probabilities : policy[node.info];
    const result = Array(compiled.playerCount).fill(0);
    for (let a = 0; a < node.children.length; a++) {
      const child = value(node.children[a]);
      for (let p = 0; p < result.length; p++) result[p] += probabilities[a] * child[p];
    }
    return (cache[index] = result);
  }
  return { values: value(0).slice(), cache };
}

function counterfactualReach(compiled, policy, player, control = () => {}) {
  const reach = new Float64Array(compiled.nodes.length);
  function visit(index, probability) {
    control();
    reach[index] = probability;
    const node = compiled.nodes[index];
    if (node.type === 'terminal') return;
    const row = node.type === 'chance' ? node.probabilities : policy[node.info];
    for (let a = 0; a < node.children.length; a++) visit(node.children[a], probability * (node.type === 'decision' && node.player === player ? 1 : row[a]));
  }
  visit(0, 1);
  return reach;
}

function exactBestResponse(compiled, policy, player, control = () => {}) {
  const reach = counterfactualReach(compiled, policy, player, control);
  const selected = new Map(), cache = new Float64Array(compiled.nodes.length).fill(NaN);
  function value(index) {
    control();
    if (!Number.isNaN(cache[index])) return cache[index];
    const node = compiled.nodes[index];
    let result = 0;
    if (node.type === 'terminal') result = node.payoffs[player];
    else if (node.type === 'decision' && node.player === player) {
      if (!selected.has(node.info)) throw new Error('Invalid best-response ordering: perfect recall is required.');
      result = value(node.children[selected.get(node.info)]);
    } else {
      const row = node.type === 'chance' ? node.probabilities : policy[node.info];
      for (let a = 0; a < node.children.length; a++) result += row[a] * value(node.children[a]);
    }
    cache[index] = result;
    return result;
  }
  const informationSets = compiled.informationSets.filter(info => info.player === player).sort((a, b) => b.ownDepth - a.ownDepth || a.index - b.index);
  const choices = Object.create(null);
  for (const info of informationSets) {
    const actionValues = info.actions.map(() => 0);
    for (const index of info.nodes) {
      const node = compiled.nodes[index];
      for (let a = 0; a < info.actions.length; a++) actionValues[a] += reach[index] * value(node.children[a]);
    }
    let best = 0;
    for (let a = 1; a < actionValues.length; a++) if (actionValues[a] > actionValues[best]) best = a;
    selected.set(info.index, best);
    choices[info.key] = info.actions[best];
  }
  return { value: value(0), actions: choices, exact: true };
}

function evaluateCompiled(compiled, policy, control = () => {}) {
  const { values } = expectedValues(compiled, policy, control);
  const bestResponseValues = Array.from({ length: compiled.playerCount }, (_, player) => exactBestResponse(compiled, policy, player, control).value);
  const unilateralGains = bestResponseValues.map((value, player) => Math.max(0, value - values[player]));
  return {
    values,
    convergence: {
      metric: 'EXACT_NASH_CONV', exact: true,
      nashConv: unilateralGains.reduce((a, b) => a + b, 0),
      maxUnilateralGain: Math.max(...unilateralGains), unilateralGains, bestResponseValues,
      exploitability: compiled.playerCount === 2 && compiled.metrics.constantSum !== null ? unilateralGains.reduce((a, b) => a + b, 0) / 2 : null,
      scope: 'SUPPLIED_FINITE_GAME',
      convergenceGuarantee: compiled.playerCount === 2 && compiled.metrics.constantSum !== null ? 'TWO_PLAYER_CONSTANT_SUM_PERFECT_RECALL' : 'NONE_FOR_GENERAL_SUM_OR_MULTIPLAYER'
    }
  };
}

function evaluate(game, strategy, options = {}) {
  const compiled = compiledGame(game, options);
  return evaluateCompiled(compiled, readStrategy(compiled, strategy));
}

function bestResponse(game, strategy, player, options = {}) {
  const compiled = compiledGame(game, options);
  if (!Number.isSafeInteger(player) || player < 0 || player >= compiled.playerCount) throw new Error('Best-response player is invalid.');
  return exactBestResponse(compiled, readStrategy(compiled, strategy), player);
}

function actionValues(game, strategy, player, informationSet, options = {}) {
  const compiled = compiledGame(game, options), policy = readStrategy(compiled, strategy);
  const info = compiled.informationSets.find(candidate => candidate.player === player && candidate.key === informationSet);
  if (!info) throw new Error('The requested information set is not in this game.');
  const reach = counterfactualReach(compiled, policy, player);
  const values = expectedValues(compiled, policy).cache;
  const mass = info.nodes.reduce((sum, index) => sum + reach[index], 0);
  return {
    player, informationSet, counterfactualReach: mass, reachable: mass > 0,
    actions: info.actions.map((id, a) => ({ id, frequency: policy[info.index][a], ev: mass > 0 ? info.nodes.reduce((sum, index) => sum + reach[index] * values[compiled.nodes[index].children[a]][player], 0) / mass : null })),
    method: 'EXACT_AVERAGE_STRATEGY_CONTINUATION', scope: 'SUPPLIED_FINITE_GAME'
  };
}

function evaluateInformationSet(game, strategy, informationSet, options = {}) {
  const compiled = compiledGame(game, options);
  const matching = compiled.informationSets.filter(info => info.key === informationSet);
  if (matching.length !== 1) throw new Error('The requested information set must identify exactly one player.');
  return actionValues(game, strategy, matching[0].player, informationSet, options);
}

// Interval arithmetic encloses the real operations on the supplied binary64
// inputs. Strategy/chance rows are interpreted as normalized nonnegative
// weights, so a rounding residual in their sum cannot create probability mass.
const intervalBits = new DataView(new ArrayBuffer(8));
function nextFloat(value, up) {
  if (Number.isNaN(value) || value === (up ? Infinity : -Infinity)) return value;
  if (value === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
  intervalBits.setFloat64(0, value);
  let bits = intervalBits.getBigUint64(0);
  bits += (value > 0) === up ? 1n : -1n;
  intervalBits.setBigUint64(0, bits);
  return intervalBits.getFloat64(0);
}
const down = value => nextFloat(value, false), up = value => nextFloat(value, true);
function intervalAdd(a, b) {
  if (a[0] === 0 && a[1] === 0) return b.slice();
  if (b[0] === 0 && b[1] === 0) return a.slice();
  return [down(a[0] + b[0]), up(a[1] + b[1])];
}
function intervalMultiply(a, b) {
  if (a[0] === 0 && a[1] === 0 || b[0] === 0 && b[1] === 0) return [0, 0];
  const products = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
  return [down(Math.min(...products)), up(Math.max(...products))];
}
function intervalProbabilities(row) {
  if (row.filter(value => value > 0).length === 1) return row.map(value => value > 0 ? [1, 1] : [0, 0]);
  const sum = row.reduce((total, value) => intervalAdd(total, [value, value]), [0, 0]);
  return row.map(value => value === 0 ? [0, 0] : [Math.max(0, down(value / sum[1])), Math.min(1, up(value / sum[0]))]);
}

function intervalBestResponse(compiled, policy, player, control, terminalUtility = node => [node.payoffs[player], node.payoffs[player]]) {
  const rows = policy.map(intervalProbabilities);
  const reach = new Array(compiled.nodes.length);
  function visit(index, probability) {
    control();
    reach[index] = probability;
    const node = compiled.nodes[index];
    if (node.type === 'terminal') return;
    const row = node.type === 'chance' ? intervalProbabilities(node.probabilities) : rows[node.info];
    for (let a = 0; a < node.children.length; a++) visit(node.children[a],
      node.type === 'decision' && node.player === player ? probability : intervalMultiply(probability, row[a]));
  }
  visit(0, [1, 1]);
  // Aggregate counterfactual terminal contributions between consecutive OWN
  // information sets. Perfect recall gives each successor a unique previous
  // own (information set, action), so its aggregate is included exactly once.
  // Maximizing each history separately would disclose the opponent's cards.
  function segment(starts) {
    let terminals = [0, 0];
    const successors = new Set();
    function walk(index) {
      control();
      const node = compiled.nodes[index];
      if (node.type === 'terminal') terminals = intervalAdd(terminals, intervalMultiply(reach[index], terminalUtility(node)));
      else if (node.type === 'decision' && node.player === player) successors.add(node.info);
      else for (const child of node.children) walk(child);
    }
    for (const start of starts) walk(start);
    return { terminals, successors };
  }
  const values = new Map();
  function total(part) {
    let value = part.terminals;
    for (const successor of part.successors) value = intervalAdd(value, values.get(successor));
    return value;
  }
  const infos = compiled.informationSets.filter(info => info.player === player).sort((a, b) => b.ownDepth - a.ownDepth);
  for (const info of infos) {
    control();
    const actionBounds = info.actions.map((_, a) => total(segment(info.nodes.map(index => compiled.nodes[index].children[a]))));
    values.set(info.index, [Math.max(...actionBounds.map(value => value[0])), Math.max(...actionBounds.map(value => value[1]))]);
  }
  return total(segment([0]));
}

function saddleBounds(game, strategy, player, options = {}) {
  const started = performance.now();
  const timeBudgetMs = options.timeBudgetMs ?? Infinity;
  if (!(timeBudgetMs === Infinity || finite(timeBudgetMs) && timeBudgetMs >= 0)) throw new Error('timeBudgetMs must be nonnegative.');
  let visits = 0, termination = null;
  function control(force = false) {
    if (!force && ++visits % 128 !== 0) return;
    if (options.shouldCancel?.()) { termination = 'CANCELLED'; throw STOP; }
    if (performance.now() - started >= timeBudgetMs) { termination = 'TIME_BUDGET'; throw STOP; }
  }
  try {
    control(true);
    const compiled = compiledGame(game, options, control);
    if (compiled.playerCount !== 2 || compiled.metrics.constantSum === null || game.meta?.constantSum === false) throw new Error('Saddle certificates require a two-player constant-sum game.');
    if (player !== 0 && player !== 1) throw new Error('Saddle certificate player is invalid.');
    const policy = readStrategy(compiled, strategy);
    let minimumSum = Infinity, maximumSum = -Infinity;
    for (const node of compiled.nodes) if (node.type === 'terminal') {
      control();
      const sum = intervalAdd([node.payoffs[0], node.payoffs[0]], [node.payoffs[1], node.payoffs[1]]);
      minimumSum = Math.min(minimumSum, sum[0]); maximumSum = Math.max(maximumSum, sum[1]);
    }
    // In a declared constant-sum chip game decimal-to-binary conversion can
    // leave tiny payoff-sum residuals, especially after cancellation. Preserve
    // every Hero payoff exactly and define the minimizing player's utility as
    // K - uHero. This gives a rigorous zero-sum equivalent for that objective;
    // no tolerance is used as an action-value error bar. Nonconstant-sum input
    // remains rejected above, including a contrary adapter declaration.
    const offset = compiled.metrics.constantSum;
    const heroBR = intervalBestResponse(compiled, policy, player, control);
    const opponentBR = intervalBestResponse(compiled, policy, 1 - player, control,
      node => intervalAdd([offset, offset], [-node.payoffs[player], -node.payoffs[player]]));
    const lower = down(offset - opponentBR[1]), upper = heroBR[1];
    if (![lower, upper, ...heroBR, ...opponentBR].every(finite) || lower > upper) throw new Error('Saddle interval could not be certified.');
    return { certified: true, lower, upper, bounds: [lower, upper], width: up(upper - lower),
      player, gameHash: compiled.hash, target: 'SUPPLIED_GAME_EX_ANTE_MAXMIN_VALUE',
      origin: 'OUTWARD_ROUNDED_INFORMATION_SET_BEST_RESPONSE_SADDLE_BOUNDS',
      rounding: 'IEEE754_BINARY64_NEXTAFTER_EACH_OPERATION',
      probabilitySemantics: 'NORMALIZED_SUPPLIED_BINARY64_WEIGHTS',
      constantSumBounds: [offset, offset], originalConstantSumBounds: [minimumSum, maximumSum],
      opponentBestResponseUtility: 'CONSTANT_MINUS_HERO_PAYOFF',
      payoffNormalizationMaxResidual: up(Math.max(Math.abs(minimumSum - offset), Math.abs(maximumSum - offset))),
      bestResponseBounds: { hero: heroBR, opponent: opponentBR },
      perfectRecall: true, playerCount: 2, elapsedMs: performance.now() - started, traversalVisits: visits };
  } catch (error) {
    if (error !== STOP) throw error;
    return { certified: false, lower: null, upper: null, bounds: null, termination, elapsedMs: performance.now() - started, traversalVisits: visits };
  }
}

function rootDiagnostics(game, strategy, player, informationSet, options = {}) {
  const compiled = compiledGame(game, options), policy = readStrategy(compiled, strategy);
  const info = compiled.informationSets.find(candidate => candidate.player === player && candidate.key === informationSet);
  if (!info || info.ownDepth !== 0) throw new Error('Root diagnostics require a first own information set.');
  const reach = counterfactualReach(compiled, policy, player);
  const mass = info.nodes.reduce((sum, index) => sum + reach[index], 0);
  const expected = expectedValues(compiled, policy).cache;
  const actions = info.actions.map((id, a) => ({ id, frequency: policy[info.index][a], ev: mass > 0 ? info.nodes.reduce((sum, index) => sum + reach[index] * expected[compiled.nodes[index].children[a]][player], 0) / mass : null }));
  const value = mass > 0 ? actions.reduce((sum, action) => sum + action.frequency * action.ev, 0) : null;
  const oneStepRegret = mass > 0 ? Math.max(0, Math.max(...actions.map(action => action.ev)) - value) : null;
  const previous = options.previous;
  const compatible = mass > 0 && previous?.gameHash === compiled.hash && previous?.informationSet === informationSet && previous?.player === player
    && Array.isArray(previous.actions) && previous.actions.length === actions.length
    && actions.every(action => previous.actions.some(old => old.id === action.id && finite(old.ev) && finite(old.frequency)));
  const stability = compatible ? {
    comparable: true, maxActionEVChange: Math.max(...actions.map(action => Math.abs(action.ev - previous.actions.find(old => old.id === action.id).ev))),
    maxFrequencyChange: Math.max(...actions.map(action => Math.abs(action.frequency - previous.actions.find(old => old.id === action.id).frequency)))
  } : { comparable: false, maxActionEVChange: null, maxFrequencyChange: null };
  return { gameHash: compiled.hash, player, informationSet, actions, counterfactualReach: mass, profileValue: value,
    oneStepRegret, counterfactualOneStepRegret: oneStepRegret === null ? null : mass * oneStepRegret,
    scope: 'CURRENT_PROFILE_FIRST_INFORMATION_SET_ONE_STEP_DEVIATION', stability,
    certifiesEquilibriumActionValues: false, certifiesConvergence: false };
}

function solve(game, options = {}) {
  const started = performance.now();
  const requested = options.iterations === undefined ? 1000 : options.iterations;
  if (!Number.isSafeInteger(requested) || requested < 0) throw new Error('iterations must be a nonnegative integer.');
  const timeBudgetMs = options.timeBudgetMs === undefined ? Infinity : options.timeBudgetMs;
  if (!(timeBudgetMs === Infinity || finite(timeBudgetMs) && timeBudgetMs >= 0)) throw new Error('timeBudgetMs must be nonnegative.');
  const checkEvery = positiveInteger(options.checkEvery, 100, 'checkEvery');
  const averagingDelay = options.averagingDelay ?? options.checkpoint?.averagingDelay ?? 0;
  if (!Number.isSafeInteger(averagingDelay) || averagingDelay < 0) throw new Error('averagingDelay must be a nonnegative integer.');
  if (options.targetNashConv !== undefined && (!finite(options.targetNashConv) || options.targetNashConv < 0)) throw new Error('targetNashConv must be finite and nonnegative.');
  let visits = 0, termination = 'ITERATION_BUDGET';
  function control(force = false) {
    if (!force && ++visits % 512 !== 0) return;
    if (options.shouldCancel?.()) { termination = 'CANCELLED'; throw STOP; }
    if (performance.now() - started >= timeBudgetMs) { termination = 'TIME_BUDGET'; throw STOP; }
  }
  let compiled;
  try { compiled = compiledGame(game, options, control); }
  catch (error) {
    if (error !== STOP) throw error;
    return { method: 'ALTERNATING_CFR_PLUS_LINEAR_AVERAGE', solverVersion: VERSION, gameHash: null, strategy: null, iterations: options.checkpoint?.iterations ?? 0, additionalIterations: 0, termination, stopReason: termination, values: null, convergence: { exact: false, nashConv: null, reason: 'GAME_VALIDATION_BUDGET_OR_CANCELLATION' }, checkpoint: null, metrics: { elapsedMs: performance.now() - started, traversalVisits: visits } };
  }
  let iterations = 0;
  let regrets = compiled.informationSets.map(info => Array(info.actions.length).fill(0));
  let sums = compiled.informationSets.map(info => Array(info.actions.length).fill(0));
  const checkpoint = options.checkpoint;
  if (checkpoint) {
    if (checkpoint.version !== VERSION || checkpoint.gameHash !== compiled.hash || checkpoint.averagingDelay !== averagingDelay || !Number.isSafeInteger(checkpoint.iterations) || checkpoint.iterations < 0) throw new Error('Checkpoint does not match this exact game and solver configuration.');
    function restoreRows(rows) {
      if (!Array.isArray(rows) || rows.length !== compiled.informationSets.length) throw new Error('Checkpoint information sets do not match.');
      return rows.map((row, i) => {
        if (!Array.isArray(row) || row.length !== regrets[i].length || !row.every(value => finite(value) && value >= 0)) throw new Error('Checkpoint numerical state is invalid.');
        return row.slice();
      });
    }
    regrets = restoreRows(checkpoint.regrets);
    sums = restoreRows(checkpoint.strategySums);
    iterations = checkpoint.iterations;
  }
  const firstIteration = iterations;
  let evaluation = null, evaluationIteration = -1;
  function evaluateCurrent() {
    control(true);
    evaluation = evaluateCompiled(compiled, sums.map(normalized), control);
    evaluationIteration = iterations;
    return options.targetNashConv !== undefined && evaluation.convergence.nashConv <= options.targetNashConv;
  }
  try {
    if (checkpoint && options.targetNashConv !== undefined && evaluateCurrent()) termination = 'TARGET_NASH_CONV';
    else for (let additional = 0; additional < requested; additional++) {
      control(true);
      const nextRegrets = regrets.map(row => row.slice());
      const averageAdds = compiled.informationSets.map(info => Array(info.actions.length).fill(0));
      const weight = Math.max(0, iterations + 1 - averagingDelay);
      for (let player = 0; player < compiled.playerCount; player++) {
        const policy = nextRegrets.map(normalized);
        const deltas = compiled.informationSets.map(info => info.player === player ? Array(info.actions.length).fill(0) : null);
        const averaged = new Set();
        function traverse(index, ownReach, othersReach) {
          control();
          const node = compiled.nodes[index];
          if (node.type === 'terminal') return node.payoffs[player];
          const row = node.type === 'chance' ? node.probabilities : policy[node.info];
          const isOwn = node.type === 'decision' && node.player === player;
          const children = node.children.map((child, a) => traverse(child, ownReach * (isOwn ? row[a] : 1), othersReach * (isOwn ? 1 : row[a])));
          const value = children.reduce((sum, child, a) => sum + row[a] * child, 0);
          if (isOwn) {
            for (let a = 0; a < row.length; a++) deltas[node.info][a] += othersReach * (children[a] - value);
            // Perfect recall makes own reach identical across the histories in I.
            if (!averaged.has(node.info)) {
              for (let a = 0; a < row.length; a++) averageAdds[node.info][a] = weight * ownReach * row[a];
              averaged.add(node.info);
            }
          }
          return value;
        }
        traverse(0, 1, 1);
        for (const info of compiled.informationSets) if (info.player === player) {
          for (let a = 0; a < info.actions.length; a++) nextRegrets[info.index][a] = Math.max(0, nextRegrets[info.index][a] + deltas[info.index][a]);
        }
      }
      // Commit only a complete alternating sweep. Cancellation cannot leave a
      // half-iteration checkpoint or double-count the next resumed average.
      regrets = nextRegrets;
      for (const info of compiled.informationSets) for (let a = 0; a < info.actions.length; a++) sums[info.index][a] += averageAdds[info.index][a];
      iterations++;
      if (iterations % checkEvery === 0 && evaluateCurrent()) { termination = 'TARGET_NASH_CONV'; break; }
    }
    if (evaluationIteration !== iterations) evaluateCurrent();
  } catch (error) {
    if (error !== STOP) throw error;
  }
  if (evaluationIteration !== iterations) evaluation = null;
  const strategy = exportStrategy(compiled, sums.map(normalized));
  return {
    method: 'ALTERNATING_CFR_PLUS_LINEAR_AVERAGE', solverVersion: VERSION,
    gameHash: compiled.hash, strategy, iterations, additionalIterations: iterations - firstIteration, termination, stopReason: termination,
    values: evaluation?.values ?? null,
    convergence: evaluation?.convergence ?? { metric: 'EXACT_NASH_CONV', exact: false, nashConv: null, maxUnilateralGain: null, unilateralGains: null, bestResponseValues: null, exploitability: null, scope: 'SUPPLIED_FINITE_GAME', reason: 'EVALUATION_BUDGET_OR_CANCELLATION' },
    checkpoint: { version: VERSION, gameHash: compiled.hash, averagingDelay, iterations, regrets, strategySums: sums },
    metrics: { ...compiled.metrics, elapsedMs: performance.now() - started, traversalVisits: visits, requestedIterations: requested }
  };
}

module.exports = { VERSION, DEFAULT_LIMITS, MAX_RETAINED_COMPILATION_BYTES, createCompilationContext, compilationContextStats, releaseCompilationContext,
  validateGame, solve, evaluate, bestResponse, actionValues, evaluateInformationSet, saddleBounds, rootDiagnostics };
