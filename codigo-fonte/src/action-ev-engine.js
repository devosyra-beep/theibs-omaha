const { normalizeRakeSchedule, calculateRake } = require('./rake-model');
const ACTIONS = ['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE'];

function numberOrNull(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
}

function nonNegativeOrNull(value, label) {
  const number = numberOrNull(value, label);
  if (number !== null && number < 0) throw new Error(`${label} must be greater than or equal to zero.`);
  return number;
}

function probabilityOrNull(value, label) {
  const number = numberOrNull(value, label);
  if (number !== null && (number < 0 || number > 1)) throw new Error(`${label} must be between zero and one.`);
  return number;
}

function equityValue(input) {
  const equity = input.equity && typeof input.equity === 'object' ? input.equity.equity : input.equity;
  const number = numberOrNull(equity, 'equity');
  if (number === null || number < 0 || number > 1) return null;
  return number;
}

function missingResult(action, missingInputs, assumptions = [], warnings = []) {
  return {
    action,
    legal: true,
    status: 'NOT_MODELED',
    ev: null,
    model: null,
    assumptions,
    missingInputs,
    warnings
  };
}

function notLegalResult(action) {
  return {
    action,
    legal: false,
    status: 'NOT_LEGAL',
    ev: null,
    model: null,
    assumptions: [],
    missingInputs: [],
    warnings: []
  };
}

function rakeInfo(input) {
  if (input.rakeSchedule != null) {
    if ((input.rake != null && input.rake !== '') || input.assumeNoRake === true) throw Error('Enter only rakeSchedule, a fixed rake, or assumeNoRake.');
    const schedule = normalizeRakeSchedule(input.rakeSchedule);
    return { value:null, schedule, assumption:`Percentage rake with a declared cap (${schedule.source}); applied to the eligible pot in each branch.` };
  }
  const explicitRake = input.rake !== undefined && input.rake !== null && input.rake !== '';
  if (explicitRake) return { value: nonNegativeOrNull(input.rake, 'rake'), assumption: 'Rake entered explicitly.' };
  if (input.assumeNoRake === true) return { value: 0, assumption: 'Rake assumed zero through an explicit setting.' };
  return { value: null, assumption: null };
}

function rakeAt(rake, pot, boardCount) {
  return rake.schedule ? calculateRake({pot, boardCount}, rake.schedule) : rake.value;
}

function calculateCall(input, equity, rake) {
  const responseModel = input.actionResponseModels?.CALL;
  if (responseModel) return calculateScenarioEV('CALL', input, responseModel, rake);
  const amountToCall = nonNegativeOrNull(input.amountToCall, 'amountToCall');
  const potBeforeAction = nonNegativeOrNull(input.potBeforeAction, 'potBeforeAction');
  if (amountToCall === null || potBeforeAction === null) return missingResult('CALL', ['amountToCall', 'potBeforeAction']);
  if (amountToCall === 0) return missingResult('CALL', ['amountToCall must be greater than zero']);
  if (equity === null) return missingResult('CALL', ['equity']);
  if (rake.value === null && !rake.schedule) return missingResult('CALL', ['rake or assumeNoRake'], [], ['CALL EV was not modeled because the rake assumption was not entered.']);
  const potAfterCall = potBeforeAction + amountToCall;
  const chargedRake = rakeAt(rake, potAfterCall, 5);
  const ev = equity * Math.max(0, potAfterCall - chargedRake) - amountToCall;
  return {
    action: 'CALL',
    legal: true,
    status: 'MODELED',
    ev,
    rake: chargedRake,
    netPot: Math.max(0, potAfterCall - chargedRake),
    model: 'SHOWDOWN_ONLY',
    assumptions: ['No future bets.', rake.assumption],
    missingInputs: [],
    warnings: []
  };
}

function calculateCheck(input, equity, rake) {
  const future = input.futureStreetModel;
  if (!future || typeof future !== 'object' || future.type !== 'SHOWDOWN_ONLY') {
    return missingResult('CHECK', ['futureStreetModel'], [], ['CHECK EV depends on future actions and was not estimated.']);
  }
  if (equity === null) return missingResult('CHECK', ['equity']);
  if (rake.value === null && !rake.schedule) return missingResult('CHECK', ['rake or assumeNoRake']);
  const potAtShowdown = nonNegativeOrNull(future.potAtShowdown ?? input.potBeforeAction, 'potAtShowdown');
  if (potAtShowdown === null) return missingResult('CHECK', ['potAtShowdown']);
  return {
    action: 'CHECK',
    legal: true,
    status: 'MODELED',
    ev: equity * Math.max(0, potAtShowdown - rakeAt(rake, potAtShowdown, 5)),
    rake: rakeAt(rake, potAtShowdown, 5),
    netPot: Math.max(0, potAtShowdown - rakeAt(rake, potAtShowdown, 5)),
    model: 'SHOWDOWN_ONLY',
    assumptions: ['No future bets; direct showdown.', rake.assumption],
    missingInputs: [],
    warnings: ['This scenario does not model equity realization or future bets.']
  };
}

function closeEnough(left, right) {
  return Math.abs(left - right) <= 1e-8 * Math.max(1, Math.abs(left), Math.abs(right));
}

function requiredNonNegative(value, label) {
  const number = nonNegativeOrNull(value, label);
  if (number === null) throw new Error(`${label} is required.`);
  return number;
}

function requiredProbability(value, label) {
  const number = probabilityOrNull(value, label);
  if (number === null) throw new Error(`${label} is required.`);
  return number;
}

function scenarioError(action, reason) {
  return missingResult(action, ['valid response model'], [], [`${action}: ${reason}`]);
}

function sameScenarioState(left, right) {
  if (!closeEnough(Number(left.heroContribution), Number(right.heroContribution))) return false;
  if (!Array.isArray(left.opponents) || !Array.isArray(right.opponents) || left.opponents.length !== right.opponents.length) return false;
  const other = new Map(right.opponents.map(opponent => [opponent.id, opponent]));
  return left.opponents.every(opponent => {
    const match = other.get(opponent.id);
    return match && closeEnough(Number(opponent.contribution), Number(match.contribution))
      && closeEnough(Number(opponent.stackRemaining), Number(match.stackRemaining));
  });
}

// A response tree is conditional on this exact action and street total. Every
// branch pays into one common pot; reraises, partial calls and side pots require
// a different model. Equity belongs to its caller subset, never the full table.
function calculateScenarioEV(action, input, model, rake) {
  try {
    if (!model || model.type !== 'SCENARIO_SHOWDOWN_ONLY') throw new Error('Unsupported response model type.');
    if (model.action !== action) throw new Error('The model was defined for another action.');
    if (!['USER_PROVIDED', 'HEURISTIC_PRESET', 'USER_SUPPLIED_HYPOTHESIS'].includes(model.source)) throw new Error('source must identify a USER_PROVIDED, USER_SUPPLIED_HYPOTHESIS or HEURISTIC_PRESET assumption.');
    for (const other of Object.values(input.actionResponseModels || {})) {
      if (other?.type === 'SCENARIO_SHOWDOWN_ONLY' && !sameScenarioState(model, other)) throw new Error('Action models must share the same contributions and stacks.');
    }
    const hasSidePots = value => Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (model.allowReRaises || hasSidePots(model.sidePots) || hasSidePots(input.sidePots)) throw new Error('Reraises and side pots are not modeled.');
    const pot = requiredNonNegative(input.potBeforeAction, 'potBeforeAction');
    const call = requiredNonNegative(input.amountToCall, 'amountToCall');
    const stack = requiredNonNegative(input.effectiveStack, 'effectiveStack');
    const heroContribution = requiredNonNegative(model.heroContribution, 'heroContribution');
    const target = requiredNonNegative(model.targetStreetTotal, 'targetStreetTotal');
    const currentBet = heroContribution + call;
    const heroCost = target - heroContribution;
    if (heroCost <= 0 || heroCost > stack + 1e-8) throw new Error('Incremental cost must be positive and fit within the hero stack.');
    if (action === 'CALL') {
      if (call <= 0 || !closeEnough(target, currentBet)) throw new Error('CALL must match the current bet at a cost of amountToCall.');
    } else if (action === 'BET') {
      if (call !== 0) throw new Error('BET requires no amount to call.');
      const minimumBet = requiredNonNegative(input.minBet, 'minBet');
      if (minimumBet <= 0) throw new Error('minBet must be positive.');
      if (heroCost + 1e-8 < minimumBet) throw new Error('The bet cost is below minBet.');
      if (heroCost > pot + 1e-8) throw new Error('The bet size exceeds the pot.');
      if (input.betSize != null && input.betSize !== '' && !closeEnough(requiredNonNegative(input.betSize, 'betSize'), heroCost)) throw new Error('betSize must be the incremental cost of targetStreetTotal.');
    } else {
      if (currentBet <= 0 || target <= currentBet) throw new Error('RAISE requires a positive current bet and a higher total.');
      if (heroCost > pot + 2 * call + 1e-8) throw new Error('The raise exceeds the pot limit: maximum cost = pot + 2 × call.');
      if (input.raiseTo != null && input.raiseTo !== '' && !closeEnough(requiredNonNegative(input.raiseTo, 'raiseTo'), target)) throw new Error('raiseTo must be the street total, equal to targetStreetTotal.');
      const explicitMinimum = model.minRaiseTo ?? input.minRaiseTo;
      const minimum = explicitMinimum == null || explicitMinimum === '' ? 2 * currentBet : requiredNonNegative(explicitMinimum, 'minRaiseTo');
      if (minimum <= currentBet) throw new Error('minRaiseTo must exceed the current bet.');
      if (target + 1e-8 < minimum) throw new Error(explicitMinimum == null || explicitMinimum === ''
        ? 'The raise requires an actual minRaiseTo; without it, only a total of at least twice the current bet is accepted.'
        : 'The raise is below minRaiseTo.');
      if (input.maxRaiseTo != null && input.maxRaiseTo !== '' && target > requiredNonNegative(input.maxRaiseTo, 'maxRaiseTo') + 1e-8) throw new Error('The raise exceeds maxRaiseTo.');
    }
    if (!Array.isArray(model.opponents) || model.opponents.length < 1) throw new Error('Enter opponents and their current contributions.');
    if (Number.isInteger(Number(input.players)) && model.opponents.length !== Number(input.players) - 1) throw new Error('The model’s opponent count differs from the hand.');
    const opponents = new Map();
    let contributions = heroContribution;
    for (const opponent of model.opponents) {
      const id = typeof opponent.id === 'string' ? opponent.id.trim() : '';
      if (!id || opponents.has(id)) throw new Error('Each opponent must have a unique ID.');
      const contribution = requiredNonNegative(opponent.contribution, `contribution for ${id}`);
      const stackRemaining = requiredNonNegative(opponent.stackRemaining, `stackRemaining for ${id}`);
      if (contribution > currentBet + 1e-8) throw new Error(`Contribution for ${id} is incompatible with the amount to call.`);
      contributions += contribution;
      opponents.set(id, { id, contribution, stackRemaining });
    }
    if (contributions > pot + 1e-8) throw new Error('Current contributions exceed the entered pot.');
    if ((call > 0 || action === 'RAISE') && ![...opponents.values()].some(opponent => closeEnough(opponent.contribution, currentBet))) throw new Error('No opponent has the current bet faced by the hero.');
    if (!Array.isArray(model.scenarios) || model.scenarios.length < 1) throw new Error('Enter response scenarios.');
    const seenSubsets = new Set();
    let probabilitySum = 0;
    let ev = 0;
    let envelopeLow = 0;
    let envelopeHigh = 0;
    let completeEnvelope = true;
    const scenarioBreakdown = [];
    for (const [index, scenario] of model.scenarios.entries()) {
      const probability = requiredProbability(scenario.probability, `probability for scenario ${index + 1}`);
      probabilitySum += probability;
      if (!Array.isArray(scenario.callers)) throw new Error('callers must list the callers; it may be empty when everyone folds.');
      const ids = [];
      let opponentAdditional = 0;
      for (const caller of scenario.callers) {
        const opponent = opponents.get(caller.id);
        if (!opponent || ids.includes(caller.id)) throw new Error('Unknown or duplicate caller in the scenario.');
        const additional = requiredNonNegative(caller.additional, `additional for ${caller.id}`);
        if (!closeEnough(additional, target - opponent.contribution)) throw new Error(`additional for ${caller.id} must complete the street total exactly.`);
        if (additional > opponent.stackRemaining + 1e-8) throw new Error(`The stack of ${caller.id} requires a partial payment or side pot, which is not yet modeled.`);
        ids.push(caller.id);
        opponentAdditional += additional;
      }
      ids.sort();
      const subset = JSON.stringify(ids);
      if (seenSubsets.has(subset)) throw new Error('Duplicate scenarios for the same set of callers.');
      seenSubsets.add(subset);
      for (const opponent of opponents.values()) {
        if ((opponent.stackRemaining === 0 || (action === 'CALL' && closeEnough(opponent.contribution, target))) && !ids.includes(opponent.id)) throw new Error(`Opponent ${opponent.id}, already matched or all-in, cannot disappear from this showdown.`);
      }
      if (action === 'CALL' && ids.length === 0) throw new Error('CALL cannot win the pot by everyone folding.');
      // Folding to a raise returns only the unmatched raise increment. The
      // hero's call-sized matching part remains in the contested pot and can
      // incur rake, even though its gross award cancels that new investment.
      const uncalledReturned = ids.length ? 0 : Math.max(0,target-Math.max(...[...opponents.values()].map(p=>p.contribution)));
      const matchedHeroCost = ids.length ? heroCost : heroCost-uncalledReturned;
      const potAtShowdown = pot + matchedHeroCost + opponentAdditional;
      if (rake.schedule && scenario.rake != null && scenario.rake !== '') throw new Error('Do not combine rakeSchedule with a fixed scenario rake.');
      const branchRake = scenario.rake == null || scenario.rake === ''
        ? rakeAt(rake, potAtShowdown, ids.length ? 5 : (input.board || []).length)
        : requiredNonNegative(scenario.rake, 'scenario rake');
      if (branchRake === null) throw new Error('Enter rake, rakeSchedule or assumeNoRake for each scenario.');
      if (branchRake > potAtShowdown) throw new Error('Scenario rake exceeds its pot.');
      let branchEquity = null;
      let branchEv = pot - branchRake;
      let branchEnvelope = [branchEv, branchEv];
      if (ids.length > 0) {
        branchEquity = requiredProbability(scenario.equity, 'scenario conditional equity');
        if (!['USER_CONDITIONAL', 'CALCULATED_CONDITIONAL'].includes(scenario.equitySource)) throw new Error('equitySource must identify entered or calculated conditional equity.');
        if (!Array.isArray(scenario.equityOpponentIds) || new Set(scenario.equityOpponentIds).size !== ids.length || JSON.stringify([...scenario.equityOpponentIds].sort()) !== subset) throw new Error('equityOpponentIds must match the scenario callers exactly.');
        const netPot = potAtShowdown - branchRake;
        branchEv = branchEquity * netPot - heroCost;
        if (scenario.equityInterval == null) {
          branchEnvelope = null;
          if (probability > 0) completeEnvelope = false;
        } else {
          if (!Array.isArray(scenario.equityInterval) || scenario.equityInterval.length !== 2) throw new Error('equityInterval must contain lower and upper bounds.');
          const low = requiredProbability(scenario.equityInterval[0], 'equity lower bound');
          const high = requiredProbability(scenario.equityInterval[1], 'equity upper bound');
          if (low > branchEquity || high < branchEquity || low > high) throw new Error('equityInterval must contain the conditional estimate.');
          if (scenario.equityIntervalLevel != null) {
            const level = requiredProbability(scenario.equityIntervalLevel, 'equityIntervalLevel');
            if (level === 0 || level === 1) throw new Error('equityIntervalLevel must be strictly between zero and one.');
          }
          branchEnvelope = [low * netPot - heroCost, high * netPot - heroCost];
        }
      }
      ev += probability * branchEv;
      if (branchEnvelope) {
        envelopeLow += probability * branchEnvelope[0];
        envelopeHigh += probability * branchEnvelope[1];
      }
      scenarioBreakdown.push({
        id: String(scenario.id || `scenario-${index + 1}`), probability, callers: ids,
        equity: branchEquity, equitySource: scenario.equitySource || null,
        heroCost: matchedHeroCost, uncalledReturned, eligibleRakePot:potAtShowdown,
        opponentAdditional, potAtShowdown, rake: branchRake, ev: branchEv, weightedEv: probability * branchEv,
        ...(branchEnvelope ? { conditionalEvEnvelope: branchEnvelope } : {}),
        ...(scenario.equityIntervalLevel != null ? { equityIntervalLevel: scenario.equityIntervalLevel } : {})
      });
    }
    if (!closeEnough(probabilitySum, 1)) throw new Error('Scenario probabilities must sum to 1.');
    return {
      action, legal: true, status: 'MODELED', ev, model: 'SCENARIO_SHOWDOWN_ONLY',
      modelScope: 'FIXED_RESPONSE_SHOWDOWN_ONLY', source: model.source,
      certainty: 'CONDITIONAL_ON_UNVALIDATED_RESPONSE_ASSUMPTIONS',
      targetStreetTotal: target, heroContribution, heroCost, scenarioBreakdown,
      ...(completeEnvelope ? {
        conditionalEvEnvelope: [envelopeLow, envelopeHigh],
        intervalScope: 'PROPAGACAO_DE_INTERVALOS_MARGINAIS_SEM_COBERTURA_CONJUNTA_GARANTIDA'
      } : {}),
      assumptions: [
        'Response probabilities are fixed assumptions, not validated strategic frequencies.',
        'Each equity is conditional on the caller set identified in the scenario.',
        'One eligible pot, without reraises, partial payments or future bets.',
        `Street total ${target}; hero already invested ${heroContribution}; incremental cost ${heroCost}.`
      ],
      missingInputs: [],
      warnings: ['EV is conditional on the entered response model and evaluated size; it does not compare all sizes, establish an optimal or GTO solution, or cover errors in the assumptions.']
    };
  } catch (error) {
    return scenarioError(action, error.message);
  }
}

function calculateAggression(action, input, equity, rake) {
  const responseModel = input.actionResponseModels?.[action] || input.opponentResponseModel;
  if (responseModel?.type === 'SCENARIO_SHOWDOWN_ONLY') return calculateScenarioEV(action, input, responseModel, rake);
  if (responseModel?.type && responseModel.type !== 'ALL_FOLD_OR_ONE_CALLER') return scenarioError(action, 'Unsupported response model type.');
  if (Number(input.players) > 2) return missingResult(action, ['multiway continuation model'], [], ['Multiway aggression EV requires scenarios with identified callers, contributions and conditional equities.']);
  const sizeField = action === 'BET' ? 'betSize' : 'raiseTo';
  const size = nonNegativeOrNull(input[sizeField], sizeField);
  const potBeforeAction = nonNegativeOrNull(input.potBeforeAction, 'potBeforeAction');
  const foldEquity = probabilityOrNull(input.foldEquity, 'foldEquity');
  const continuationEquity = probabilityOrNull(input.continuationEquity ?? input.equityAgainstContinue, 'continuationEquity');
  const missing = [];
  if (size === null || size <= 0) missing.push(sizeField);
  if (potBeforeAction === null) missing.push('potBeforeAction');
  if (foldEquity === null) missing.push('foldEquity');
  if (continuationEquity === null) missing.push('continuationEquity');
  if (rake.value === null && !rake.schedule) missing.push('rake or assumeNoRake');
  if (missing.length > 0) return missingResult(action, [...new Set(missing)]);

  const amountToCall = nonNegativeOrNull(input.amountToCall, 'amountToCall') ?? 0;
  const heroContributionProvided = input.heroContribution != null && input.heroContribution !== '';
  const heroContribution = nonNegativeOrNull(input.heroContribution, 'heroContribution') ?? 0;
  const heroCost = action === 'BET' ? size : size - heroContribution;
  const currentBet = heroContribution + amountToCall;
  const opponentAdditional = action === 'BET' ? size : size - currentBet;
  if (action === 'BET' && (amountToCall > 0 || heroContribution > 0) || action === 'RAISE' && currentBet <= 0) return scenarioError(action, 'Action is incompatible with the amount to call.');
  if (heroCost <= 0 || opponentAdditional < 0 || (action === 'RAISE' && opponentAdditional === 0)) return scenarioError(action, 'The size does not increase the current bet.');
  if (Number.isFinite(Number(input.effectiveStack)) && heroCost > Number(input.effectiveStack)) return scenarioError(action, 'Incremental cost exceeds the effective stack.');
  if (heroCost > potBeforeAction + 2 * amountToCall + 1e-8) return scenarioError(action, 'Size exceeds the pot limit.');
  if (action === 'RAISE') {
    const minimum = input.minRaiseTo == null || input.minRaiseTo === '' ? 2 * currentBet : requiredNonNegative(input.minRaiseTo, 'minRaiseTo');
    if (size < minimum) return scenarioError(action, 'Raise is below the entered minimum or the conservative bound of twice the current bet.');
    if (input.maxRaiseTo != null && input.maxRaiseTo !== '' && size > requiredNonNegative(input.maxRaiseTo, 'maxRaiseTo')) return scenarioError(action, 'Raise exceeds maxRaiseTo.');
  }
  if (2 * heroContribution + amountToCall > potBeforeAction + 1e-8) return scenarioError(action, 'Current contributions exceed the entered pot.');
  const potIfCalled = potBeforeAction + heroCost + opponentAdditional;
  const continuationRake = rakeAt(rake, potIfCalled, 5), foldRake = rakeAt(rake, potBeforeAction + amountToCall, (input.board || []).length);
  const continuationEv = continuationEquity * Math.max(0, potIfCalled - continuationRake) - heroCost;
  const ev = foldEquity * Math.max(0, potBeforeAction - foldRake) + (1 - foldEquity) * continuationEv;
  return {
    action,
    legal: true,
    status: 'MODELED',
    ev,
    model: 'FOLD_EQUITY_SHOWDOWN_ONLY',
    modelScope: 'FIXED_RESPONSE_SHOWDOWN_ONLY',
    source: 'USER_PROVIDED',
    certainty: 'CONDITIONAL_ON_UNVALIDATED_RESPONSE_ASSUMPTIONS',
    targetStreetTotal: action === 'BET' ? heroContribution + size : size, heroContribution, heroCost,
    rakeByResponse: {fold:foldRake,call:continuationRake},
    assumptions: [
      `Fold equity of ${(foldEquity * 100).toFixed(1)}%.`,
      `Continuation equity of ${(continuationEquity * 100).toFixed(1)}%.`,
      'No further aggression after continuation.',
      rake.assumption
    ],
    missingInputs: [],
    warnings: ['Simplified scenario: an additional opponent response is not modeled.', ...(!heroContributionProvided && action === 'RAISE' ? ['Compatibility: current hero contribution is assumed to be zero; raiseTo is the street total.'] : [])]
  };
}

function actionResult(action, input, equity, rake) {
  if (action === 'FOLD') {
    return {
      action,
      legal: true,
      status: 'MODELED',
      ev: 0,
      model: 'RELATIVE_DECISION_POINT',
      assumptions: ['EV relative to the decision point.'],
      missingInputs: [],
      warnings: []
    };
  }
  if (action === 'CHECK') return calculateCheck(input, equity, rake);
  if (action === 'CALL') return calculateCall(input, equity, rake);
  if (action === 'BET' || action === 'RAISE') return calculateAggression(action, input, equity, rake);
  return notLegalResult(action);
}

function calculateActionEV(input = {}) {
  const legalActions = Array.isArray(input.legalActions)
    ? [...new Set(input.legalActions.map((action) => String(action).toUpperCase()))]
    : [];
  if (legalActions.length === 0) {
    return {
      status: 'NO_DECISION',
      model: null,
      actions: Object.fromEntries(ACTIONS.map((action) => [action, notLegalResult(action)])),
      bestModeledAction: null,
      positiveEvAction: null,
      comparisonComplete: false,
      missingLegalActions: [],
      confidence: 'LOW',
      assumptions: [],
      warnings: ['There are no legal actions to compare.']
    };
  }
  const equity = equityValue(input);
  const rake = rakeInfo(input);
  const actions = Object.fromEntries(ACTIONS.map((action) => [
    action,
    legalActions.includes(action) ? actionResult(action, input, equity, rake) : notLegalResult(action)
  ]));
  const modeled = legalActions
    .map((action) => actions[action])
    .filter((result) => result && result.status === 'MODELED' && Number.isFinite(result.ev));
  const sorted = [...modeled].sort((left, right) => right.ev - left.ev);
  const bestModeledAction = sorted[0]?.action || null;
  const positiveEvAction = sorted.find((result) => result.ev > 0)?.action || null;
  const missingLegalActions = legalActions.filter((action) => !actions[action] || actions[action].status !== 'MODELED' || !Number.isFinite(actions[action].ev));
  const incomplete = missingLegalActions.length > 0;
  const warnings = [];
  if (incomplete) warnings.push('The comparison is incomplete: some legal actions lack sufficient assumptions.');
  for (const result of Object.values(actions)) warnings.push(...result.warnings);
  return {
    status: modeled.length > 0 ? 'MODELED' : 'NOT_MODELED',
    model: modeled.length > 0 ? 'ACTION_COMPARISON' : null,
    unit: 'chips',
    actions,
    bestModeledAction,
    positiveEvAction,
    comparisonComplete: !incomplete,
    missingLegalActions,
    confidence: modeled.length > 0 && !incomplete ? 'MEDIUM' : 'LOW',
    assumptions: [rake.assumption].filter(Boolean),
    warnings: [...new Set(warnings)]
  };
}

module.exports = {
  ACTIONS,
  calculateActionEV
};
