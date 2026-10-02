(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TheibsSolverStudyComparison = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const VERSION = 'THEIBS_STUDY_COMPARISON_V1';
  const CONTEXT_VERSION = 'THEIBS_STUDY_CONTEXT_V1';
  const SCOPE = 'FULL_PRIOR_COMMITMENT';
  const SOLVER_VERSION = 'THEIBS_FULL_TREE_CFR_PLUS_V1';
  const BOUND_VERSION = 'THEIBS_ACTION_CONDITIONED_V1';
  const BOUND_ORIGIN = 'OUTWARD_ROUNDED_INFORMATION_SET_BEST_RESPONSE_SADDLE_BOUNDS';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const text = value => typeof value === 'string' && value.length > 0;
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']'
    : object(value) ? '{' + Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}'
      : JSON.stringify(value);
  const equal = (a, b) => stable(a) === stable(b);
  const cards = value => Array.isArray(value) && value.every(card => typeof card === 'string' && /^[2-9TJQKA][cdhs]$/.test(card))
    && new Set(value).size === value.length;
  const number = value => finite(value) && value >= 0;

  // The solver calls this only after its authoritative builder validates the
  // input. This selective echo binds comparison data without player names,
  // profile identifiers, event metadata, notes or transcripts.
  function ledgerFor(input) {
    try {
      const record = input?.multiway, config = record?.config;
      if (!object(record) || record.schemaVersion !== 1 || record.enabled !== true || !object(config)
          || config.variant !== 'PLO5_HIGH' || config.playerCount !== 2 || !['SB', 'BB'].includes(config.heroPosition)
          || !['startingStack', 'smallBlind', 'bigBlind'].every(key => number(config[key])) || !(config.bigBlind > 0)
          || !cards(config.heroCards) || config.heroCards.length !== 5 || !Array.isArray(record.events) || record.events.length > 500
          || record.handId !== undefined && !text(record.handId)
          || record.editEpoch !== undefined && (!Number.isSafeInteger(record.editEpoch) || record.editEpoch < 0)
          || config.stacks !== undefined && (!Array.isArray(config.stacks) || config.stacks.length !== 2 || !config.stacks.every(number))) return null;
      const events = [];
      for (const event of record.events) {
        if (event?.type === 'BOARD' && cards(event.cards) && [3, 4, 5].includes(event.cards.length)) events.push({ type: 'BOARD', cards: [...event.cards] });
        else if (event?.type === 'ACT' && [0, 1].includes(event.actor) && ['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE'].includes(event.action)) {
          if (['BET', 'RAISE'].includes(event.action) && !number(event.to)) return null;
          events.push({ type: 'ACT', actor: event.actor, action: event.action, ...(['BET', 'RAISE'].includes(event.action) ? { to: event.to } : {}) });
        } else return null;
      }
      return { handId: record.handId || null, ...(record.editEpoch !== undefined ? { editEpoch: record.editEpoch } : {}),
        config: { variant: config.variant, playerCount: config.playerCount, heroPosition: config.heroPosition,
          startingStack: config.startingStack, smallBlind: config.smallBlind, bigBlind: config.bigBlind,
          ...(config.stacks !== undefined ? { stacks: [...config.stacks] } : {}), heroCards: [...config.heroCards] }, events };
    } catch (_) { return null; }
  }
  function rangesFor(value, normalized = false) {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const seats = new Set(), result = [];
    for (const range of value) {
      if (!object(range) || ![0, 1].includes(range.seatId) || seats.has(range.seatId) || range.complete !== true || !text(range.source)
          || !Array.isArray(range.combos) || range.combos.length < 1 || range.combos.length > 32) return null;
      seats.add(range.seatId); const seen = new Set(), combos = [];
      for (const combo of range.combos) {
        if (!cards(combo?.cards) || combo.cards.length !== 5 || !finite(combo.weight) || combo.weight <= 0 || combo.weight > 1e12) return null;
        const hand = [...combo.cards].sort(), key = hand.join(',');
        if (seen.has(key)) return null;
        seen.add(key); combos.push({ cards: hand, weight: combo.weight });
      }
      // Match the authoritative builder's summation order exactly. This is
      // verification of its emitted input, not approximate cache equivalence.
      combos.sort((a, b) => a.cards.join(',').localeCompare(b.cards.join(',')));
      const total = combos.reduce((sum, combo) => sum + combo.weight, 0);
      if (!finite(total) || total <= 0) return null;
      if (normalized) for (const combo of combos) { combo.weight /= total; if (!(combo.weight > 0)) return null; }
      result.push({ seatId: range.seatId, complete: true, source: range.source.trim(), combos });
    }
    return result.sort((a, b) => a.seatId - b.seatId);
  }
  function sizingFor(value) {
    if (!object(value) || !['MIN_MID_MAX', 'EXPLICIT_TOTALS', 'ALL_LEGAL_TOTALS'].includes(value.type)
        || !Number.isSafeInteger(value.maxAggressions) || value.maxAggressions < 0 || value.maxAggressions > 3) return null;
    if (value.type === 'MIN_MID_MAX') return { type: value.type, maxAggressions: value.maxAggressions };
    if (value.type === 'ALL_LEGAL_TOTALS') return {type:value.type,version:'LEGAL_CENT_ENUMERATION_V1',maxAggressions:value.maxAggressions,maxLevels:12};
    if (!Array.isArray(value.levels) || value.levels.length < 1 || value.levels.length > 12 || !value.levels.every(level => finite(level) && level > 0)) return null;
    return { type: value.type, levels: [...new Set(value.levels)].sort((a, b) => a - b), maxAggressions: value.maxAggressions };
  }
  function feeFor(value) {
    if (!object(value)) return null;
    if (value.type === 'NONE') return { type: 'NONE', basis: value.basis === 'BEFORE_FEES' ? 'BEFORE_FEES' : 'NO_FEES' };
    if (value.type === 'FIXED' && number(value.amount)) return { type: 'FIXED', amount: value.amount };
    if (value.type !== 'PERCENT_CAPPED' || !number(value.rate) || value.rate > 1 || !number(value.cap)
        || typeof value.noFlopNoDrop !== 'boolean' || !['FLOOR_CENT', 'NEAREST_CENT'].includes(value.rounding)
        || !['USER_PROVIDED', 'SYNTHETIC_STUDY'].includes(value.source) || value.version !== '1') return null;
    return { type: value.type, rate: value.rate, cap: value.cap, noFlopNoDrop: value.noFlopNoDrop,
      rounding: value.rounding, source: value.source, version: value.version };
  }
  function policyFor(value) {
    if (value !== undefined && !object(value)) return null;
    const epsilon = value?.nearEquivalenceBB === undefined ? .01 : value.nearEquivalenceBB;
    if (!number(epsilon)) return null;
    for (const [key, expected] of [['version', 'THEIBS_COMPARISON_POLICY_V1'], ['unit', 'BB'], ['scope', SCOPE]])
      if (value?.[key] !== undefined && value[key] !== expected) return null;
    return { version: 'THEIBS_COMPARISON_POLICY_V1', nearEquivalenceBB: epsilon === 0 ? 0 : epsilon, unit: 'BB', scope: SCOPE };
  }
  const utilityFor = value => value?.unit === 'BB' && value.basis === 'INCREMENTAL_TERMINAL_PAYOFF_FROM_ORIGINAL_DECISION'
    && value.scope === 'FULL_PRIOR_EX_ANTE' ? { unit: value.unit, basis: value.basis, scope: value.scope } : null;
  const numericBits = new DataView(new ArrayBuffer(8));
  function outwardDifference(upper, lower) {
    if (upper === lower) return 0;
    const difference = upper - lower;
    if (!finite(difference)) return difference;
    numericBits.setFloat64(0, difference);
    numericBits.setBigUint64(0, numericBits.getBigUint64(0) + (difference > 0 ? 1n : -1n));
    return numericBits.getFloat64(0);
  }
  function inspectRaw(entry) {
    const result = entry?.result, meta = result?.abstraction, certificate = result?.actionPrecision, outcome = result?.decisionOutcome;
    const reasons = [], ledger = ledgerFor(entry?.input), ranges = rangesFor(entry?.input?.ranges),
      sizing = sizingFor(entry?.input?.sizing), rake = feeFor(entry?.input?.rake), policy = policyFor(entry?.input?.comparisonPolicy);
    const utility = utilityFor(certificate?.utility);
    if (!text(entry?.id) || !text(entry?.name)) reasons.push('INVALID_SCENARIO_IDENTITY');
    if (!ledger || !ranges || !sizing || !rake || !policy) reasons.push('INVALID_STUDY_INPUT');
    if (!object(result) || !['SOLVED', 'APPROXIMATE', 'REFINING'].includes(result.status)
        || !Number.isSafeInteger(result.iterations) || result.iterations < 1 || !hash(result.gameHash)
        || result.source !== 'REFERENCE_SUBGAME_STRATEGY' || result.method !== 'ALTERNATING_CFR_PLUS_LINEAR_AVERAGE'
        || result.solverVersion !== SOLVER_VERSION || result.qualification?.strategyFrequenciesSupported !== true) reasons.push('UNUSABLE_PROFILE_RESULT');
    if (result?.studyContext?.version !== CONTEXT_VERSION || !hash(meta?.key) || result.studyContext?.inputKey !== meta.key
        || !ledger || !equal(result.studyContext.ledger, ledger)) reasons.push('RESULT_INPUT_CONTEXT_MISMATCH');
    if (!meta || meta.variant !== 'PLO5_HIGH' || meta.street !== 'RIVER' || meta.scope !== 'FINITE_RIVER_SUBGAME' || meta.originalSeats !== 2
        || meta.version !== 'PLO5_FINITE_RIVER_V2' || meta.rulesVersion !== 'OBSERVED_HAND_CENT_LEDGER_0148'
        || meta.payoffUnit !== 'BB' || meta.payoffBasis !== 'INCREMENTAL_FROM_CURRENT_DECISION'
        || !finite(meta.bigBlind) || !ledger || meta.bigBlind !== ledger.config.bigBlind
        || meta.heroSeat !== (ledger.config.heroPosition === 'SB' ? 0 : 1)
        || meta.heroInformationSet !== `${meta.heroSeat}|${[...ledger.config.heroCards].sort().join(',')}|` || !utility) reasons.push('INVALID_PAYOFF_OR_SOLVER_PROVENANCE');
    if (meta?.treeComplete !== true || meta.chanceSupportComplete !== true || meta.chanceEnumeration !== 'EXACT_JOINT_RANGE_ENUMERATION'
        || typeof meta.fullLegalSizingCoverage !== 'boolean' || !finite(meta.heroWorldProbability) || meta.heroWorldProbability <= 0 || meta.heroWorldProbability > 1)
      reasons.push('INCOMPLETE_DECLARED_TREE');
    if (!ranges || !equal(rangesFor(entry.input.ranges, true), rangesFor(meta?.ranges)) || !equal(sizing, sizingFor(meta?.sizing)) || !equal(rake, feeFor(meta?.feeModel)))
      reasons.push('RESULT_ASSUMPTIONS_MISMATCH');
    if (!policy || !equal(policyFor(result?.comparisonPolicy), policy)) reasons.push('COMPARISON_POLICY_MISMATCH');
    const rows = Array.isArray(result?.actions) && result.actions.every(object) ? result.actions : [];
    const declared = Array.isArray(meta?.rootActions) && meta.rootActions.every(object) ? meta.rootActions : [];
    const ids = rows.map(row => row?.id), declaredIds = declared.map(row => row?.id);
    if (!ids.length || !ids.every(text) || new Set(ids).size !== ids.length || new Set(declaredIds).size !== declaredIds.length
        || declaredIds.length !== ids.length || !declaredIds.every(id => ids.includes(id))
        || rows.some(row => !finite(row.evBB) || !finite(row.frequency) || row.frequency < 0 || row.frequency > 1
          || !declared.some(action => action.id === row.id && action.action === row.action && action.size === row.size))
        || Math.abs(rows.reduce((sum, row) => sum + (finite(row.frequency) ? row.frequency : 0), 0) - 1) > 1e-8) reasons.push('INCOMPLETE_PROFILE_ACTIONS');
    const convergence = result?.convergence;
    if (convergence?.exact !== true || convergence.metric !== 'EXACT_NASH_CONV' || convergence.scope !== 'SUPPLIED_FINITE_GAME'
        || !number(convergence.nashConv) || convergence.thresholdBB !== .01
        || convergence.thresholdMet !== (number(convergence.nashConv) && convergence.nashConv <= .01)) reasons.push('INVALID_GLOBAL_MEASUREMENT');
    const count = key => Number.isSafeInteger(result?.metrics?.[key]) && result.metrics[key] >= 0 ? result.metrics[key] : null;
    if (['omittedSizingNodes', 'omittedLegalSizeCount', 'aggressionCapNodes'].some(key => count(key) === null)
        || meta?.fullLegalSizingCoverage !== (count('omittedSizingNodes') === 0)) reasons.push('INVALID_SIZING_COVERAGE');
    if (result?.status === 'SOLVED' && (meta?.fullLegalSizingCoverage !== true || convergence?.thresholdMet !== true || result.qualification?.solvedSubgame !== true))
      reasons.push('INVALID_SOLVED_QUALIFICATION');
    const validFrame = hash(certificate?.baseContextKey) && certificate.baseGameHash === result?.gameHash && certificate.version === BOUND_VERSION
      && certificate.target === 'PRIVATE_INFORMATION_SET_COMMITMENT_VALUE' && certificate.origin === BOUND_ORIGIN
      && certificate.solverVersion === result?.solverVersion && certificate.player === meta?.heroSeat && certificate.informationSet === meta?.heroInformationSet
      && certificate.fullPriorPreserved === true && certificate.originalHandActionEV === false && utility;
    if (!validFrame) reasons.push('INVALID_COMMITMENT_FRAME');
    const supplied = Array.isArray(certificate?.actions) ? certificate.actions : [];
    if (supplied.length !== ids.length || new Set(supplied.map(row => row?.id)).size !== supplied.length || supplied.some(row => !ids.includes(row?.id))) reasons.push('INCOMPLETE_COMMITMENT_ACTIONS');
    const commitmentRows = rows.map(row => {
      const bound = supplied.find(candidate => candidate?.id === row.id), certified = bound?.certified === true;
      const valid = validFrame && certified && bound.baseGameHash === result.gameHash && bound.baseContextKey === certificate.baseContextKey
        && bound.solverVersion === certificate.solverVersion && bound.version === certificate.version && bound.origin === certificate.origin
        && bound.target === certificate.target && bound.player === certificate.player && bound.informationSet === certificate.informationSet
        && bound.rootActionFixed === row.id && hash(bound.gameHash) && bound.conditionedHash === bound.gameHash
        && bound.rounding === 'IEEE754_BINARY64_NEXTAFTER_EACH_OPERATION'
        && (bound.source === undefined || bound.source === result.source) && (bound.resultStatus === undefined || bound.resultStatus === result.status)
        && bound.fullPriorPreserved === true && bound.originalHandActionEV === false
        && equal(utilityFor(bound.utility), utility) && finite(bound.lowerBB) && finite(bound.upperBB) && bound.lowerBB <= bound.upperBB
        && finite(bound.estimateBB) && bound.estimateBB >= bound.lowerBB && bound.estimateBB <= bound.upperBB;
      if (certified && !valid) reasons.push('INVALID_COMMITMENT_BOUND_CONTEXT');
      return { id: row.id, certified: Boolean(valid), estimateBB: valid ? bound.estimateBB : null,
        lowerBB: valid ? bound.lowerBB : null, upperBB: valid ? bound.upperBB : null };
    });
    const globalConverged = convergence?.exact === true && convergence.thresholdMet === true && number(convergence.nashConv) && convergence.nashConv <= .01;
    if (!outcome || outcome.version !== 'THEIBS_DECISION_OUTCOME_V1' || outcome.scope !== SCOPE || outcome.actualHandEVEquivalence !== false
        || !['ESTIMATING', 'CERTIFIED', 'NEAR_EQUIVALENT', 'INCONCLUSIVE'].includes(outcome.status) || !equal(policyFor(outcome.policy), policy)
        || outcome.target !== certificate?.target || !equal(outcome.actionIds, ids) || outcome.globalConverged !== globalConverged
        || !hash(outcome.policyKey) || outcome.policyKey !== result?.comparisonPolicyKey)
      reasons.push('INVALID_COMMITMENT_OUTCOME');
    const allBounded = ids.length >= 2 && commitmentRows.every(row => row.certified);
    const supported = certificate?.supportedGameClass === true && certificate.gameClass === 'TWO_PLAYER_CONSTANT_SUM_PERFECT_RECALL'
      && meta?.constantSum === true;
    const pointRows = commitmentRows.filter(row => row.certified).slice().sort((a, b) => b.estimateBB - a.estimateBB);
    const leader = pointRows[0], alternatives = pointRows.slice(1);
    const guard = 16 * Number.EPSILON * Math.max(1, ...pointRows.flatMap(row => [Math.abs(row.lowerBB), Math.abs(row.upperBB)]));
    const strict = allBounded && leader.estimateBB > alternatives[0].estimateBB
      && leader.lowerBB > Math.max(...alternatives.map(row => row.upperBB)) + guard;
    if (result?.decisionPrecision?.status === 'CONCLUSIVE' && (!supported || !strict
        || result.decisionPrecision.bestActionId !== leader?.id || result.decisionPrecision.uncertaintyMethod !== BOUND_ORIGIN
        || result.decisionPrecision.uncertaintyScope !== certificate?.target)) reasons.push('INVALID_COMMITMENT_OUTCOME');
    if (['CERTIFIED', 'NEAR_EQUIVALENT'].includes(outcome?.status) && (!globalConverged || !supported || !allBounded))
      reasons.push('INVALID_COMMITMENT_OUTCOME');
    if (outcome?.status === 'CERTIFIED' && (!strict || outcome.strictLeaderActionId !== leader?.id || result?.decisionPrecision?.status !== 'CONCLUSIVE'))
      reasons.push('INVALID_COMMITMENT_OUTCOME');
    if (outcome?.status === 'NEAR_EQUIVALENT') {
      const group = Array.isArray(outcome.nearGroupActionIds) ? outcome.nearGroupActionIds : [];
      const groupRows = commitmentRows.filter(row => group.includes(row.id));
      const worst = allBounded && groupRows.length ? outwardDifference(Math.max(...commitmentRows.map(row => row.upperBB)), Math.min(...groupRows.map(row => row.lowerBB))) : null;
      if (!policy || group.length < 2 || new Set(group).size !== group.length || groupRows.length !== group.length
          || !finite(worst) || worst > policy.nearEquivalenceBB || outcome.robustWorstDifferenceBB !== worst) reasons.push('INVALID_COMMITMENT_OUTCOME');
    }
    const usable = reasons.length === 0, maximum = usable ? Math.max(...rows.map(row => row.evBB)) : null;
    const timing = Object.fromEntries(['acknowledgementMs', 'firstResponseMs', 'firstValueMs', 'completionMs', 'workerMs'].map(key => [key, number(entry?.timing?.[key]) ? entry.timing[key] : null]));
    const summary = { id: text(entry?.id) ? entry.id : null, name: text(entry?.name) ? entry.name : null, usable, reasonCodes: [...new Set(reasons)],
      phase: typeof entry?.phase === 'string' ? entry.phase : null, timing, gameHash: hash(result?.gameHash) ? result.gameHash : null,
      baseContextKey: hash(certificate?.baseContextKey) ? certificate.baseContextKey : null,
      currentHand: { scope: 'CURRENT_HAND_COMBINATION_RETURNED_PROFILE', certifiesEquilibriumActionValues: false, certifiesConvergence: false,
        actions: usable ? rows.map(row => ({ id: row.id, action: row.action, size: row.size, evBB: row.evBB, frequency: row.frequency })) : [],
        pointLeaderActionIds: usable ? rows.filter(row => row.evBB === maximum).map(row => row.id) : [] },
      heroWorldProbability: usable ? meta.heroWorldProbability : null,
      rangeSources: usable ? ranges.map(range => ({ seatId: range.seatId, source: range.source, combinations: range.combos.length })) : [],
      global: { status: typeof result?.status === 'string' ? result.status : null, nashConv: usable ? convergence.nashConv : null,
        thresholdMet: usable ? convergence.thresholdMet : false, iterations: usable ? result.iterations : null },
      coverage: { treeComplete: meta?.treeComplete === true, chanceSupportComplete: meta?.chanceSupportComplete === true,
        fullLegalSizingCoverage: meta?.fullLegalSizingCoverage === true, omittedSizingNodes: count('omittedSizingNodes'),
        omittedLegalSizeCount: count('omittedLegalSizeCount'), aggressionCapNodes: count('aggressionCapNodes') },
      commitment: { scope: SCOPE, actualHandEVEquivalence: false, status: usable ? outcome.status : 'INCONCLUSIVE',
        precisionStatus: usable ? result.decisionPrecision?.status || 'INCONCLUSIVE' : 'INCONCLUSIVE', rows: usable ? commitmentRows : [],
        nearGroupActionIds: usable && Array.isArray(outcome.nearGroupActionIds) ? outcome.nearGroupActionIds.filter(id => ids.includes(id)) : [] } };
    const provenance = usable ? { source: result.source, method: result.method, solverVersion: result.solverVersion,
      adapterVersion: meta.version, rulesVersion: meta.rulesVersion, utility, bigBlind: meta.bigBlind } : null;
    return { summary, ledger, ranges, sizing, rake, policy, provenance, inputKey: meta?.key };
  }
  function inspect(entry) {
    try { return inspectRaw(entry); }
    catch (_) {
      const invalid = inspectRaw({});
      invalid.summary.reasonCodes.push('MALFORMED_SCENARIO');
      return invalid;
    }
  }
  function pair(a, b) {
    const reasons = [];
    if (a.summary.id === b.summary.id) reasons.push('DUPLICATE_SCENARIO_ID');
    if (!a.summary.usable || !b.summary.usable) reasons.push('UNUSABLE_SCENARIO');
    if (!equal(a.ledger, b.ledger)) reasons.push('DECISION_LEDGER_CHANGED');
    if (!equal(a.rake, b.rake)) reasons.push('FEE_MODEL_CHANGED');
    if (!equal(a.policy, b.policy)) reasons.push('COMPARISON_POLICY_CHANGED');
    if (!equal(a.provenance, b.provenance)) reasons.push('SOLVER_OR_PAYOFF_PROVENANCE_CHANGED');
    const sameRanges = equal(a.ranges, b.ranges), sameSizing = equal(a.sizing, b.sizing);
    let classification = 'INCOMPARABLE';
    if (!reasons.length) {
      if (sameRanges && sameSizing) {
        if (a.inputKey === b.inputKey && a.summary.gameHash === b.summary.gameHash && a.summary.baseContextKey === b.summary.baseContextKey) classification = 'SAME_GAME';
        else reasons.push('EXACT_GAME_IDENTITY_MISMATCH');
      } else if (!sameRanges && sameSizing) classification = 'RANGE_SENSITIVITY';
      else if (sameRanges && !sameSizing) classification = 'SIZING_SENSITIVITY';
      else reasons.push('MULTIPLE_ASSUMPTIONS_CHANGED');
    }
    const oldRows = a.summary.currentHand.actions, newRows = b.summary.currentHand.actions;
    const ids = [...new Set([...oldRows.map(row => row.id), ...newRows.map(row => row.id)])];
    const actionComparisons = ids.map(id => {
      const before = oldRows.find(row => row.id === id), after = newRows.find(row => row.id === id);
      const delta = classification !== 'INCOMPARABLE' && before && after ? after.evBB - before.evBB : null;
      return { id, state: !before ? 'MISSING_IN_BASELINE' : !after ? 'MISSING_IN_CANDIDATE' : 'PRESENT_IN_BOTH',
        baselineEVBB: before?.evBB ?? null, candidateEVBB: after?.evBB ?? null, deltaBB: finite(delta) ? delta : null,
        baselineFrequency: before?.frequency ?? null, candidateFrequency: after?.frequency ?? null };
    });
    return { fromId: a.summary.id, toId: b.summary.id, classification, reasonCodes: [...new Set(reasons)], actionComparisons,
      interpretation: 'RETURNED_PROFILE_MODEL_SENSITIVITY_NOT_UNCERTAINTY', certifiesActualHandActionValues: false };
  }
  function classify(a, b) { return pair(inspect(a), inspect(b)); }
  function compare(entries) {
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 3)
      return { version: VERSION, classification: 'INCOMPARABLE', reasonCodes: ['ONE_TO_THREE_SCENARIOS_REQUIRED'], scenarios: [], comparisons: [] };
    const inspected = entries.map(inspect), scenarios = inspected.map(entry => entry.summary), comparisons = inspected.slice(1).map(entry => pair(inspected[0], entry));
    const reasonCodes = [];
    let classification = 'INCOMPARABLE';
    if (entries.length < 2) reasonCodes.push('INSUFFICIENT_SCENARIOS');
    if (new Set(scenarios.map(row => row.id)).size !== scenarios.length) reasonCodes.push('DUPLICATE_SCENARIO_ID');
    if (scenarios.some(row => !row.usable)) reasonCodes.push('UNUSABLE_SCENARIO');
    if (comparisons.some(row => row.classification === 'INCOMPARABLE')) reasonCodes.push(...comparisons.flatMap(row => row.reasonCodes));
    const axes = [...new Set(comparisons.map(row => row.classification).filter(value => value !== 'SAME_GAME'))];
    if (!reasonCodes.length && axes.length > 1) reasonCodes.push('MIXED_SCENARIO_AXES');
    if (!reasonCodes.length) classification = axes[0] || 'SAME_GAME';
    return { version: VERSION, classification, reasonCodes: [...new Set(reasonCodes)], scenarios, comparisons };
  }
  return Object.freeze({ VERSION, CONTEXT_VERSION, compare, classify, ledgerFor });
});
