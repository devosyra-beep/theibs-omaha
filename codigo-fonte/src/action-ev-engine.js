const { normalizeRakeSchedule, calculateRake } = require('./rake-model');
const { isMissing, optionalNumber } = require('./input-number');
const ACTIONS = ['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE'];

function numberOrNull(value, label) { return optionalNumber(value, label); }

function nonNegativeOrNull(value, label) {
  const number = numberOrNull(value, label);
  if (number !== null && number < 0) throw new Error(`${label} deve ser maior ou igual a zero.`);
  return number;
}

function probabilityOrNull(value, label) {
  const number = numberOrNull(value, label);
  if (number !== null && (number < 0 || number > 1)) throw new Error(`${label} deve estar entre zero e um.`);
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
    if ((!isMissing(input.rake)) || input.assumeNoRake === true) throw Error('Informe somente rakeSchedule, rake fixo ou assumeNoRake.');
    const schedule = normalizeRakeSchedule(input.rakeSchedule);
    return { value:null, schedule, assumption:`Rake percentual com teto declarado (${schedule.source}); aplicado ao pote elegível de cada ramo.` };
  }
  const explicitRake = !isMissing(input.rake);
  if (explicitRake) return { value: nonNegativeOrNull(input.rake, 'rake'), assumption: 'Rake informado explicitamente.' };
  if (input.assumeNoRake === true) return { value: 0, assumption: 'Rake assumido como zero por configuração explícita.' };
  return { value: null, assumption: null };
}

function rakeAt(rake, pot, boardCount) {
  return rake.schedule ? calculateRake({pot, boardCount}, rake.schedule) : rake.value;
}

function calculateCall(input, equity, rake) {
  const responseModel = input.actionResponseModels?.CALL;
  if (responseModel) return calculateScenarioEV('CALL', input, responseModel, rake);
  if (Array.isArray(input.sidePots) ? input.sidePots.length > 0 : Boolean(input.sidePots)) {
    return missingResult('CALL', ['modelo de potes laterais e elegibilidade'], [], ['A fórmula de pote único não cobre potes laterais.']);
  }
  const amountToCall = nonNegativeOrNull(input.amountToCall, 'amountToCall');
  const potBeforeAction = nonNegativeOrNull(input.potBeforeAction, 'potBeforeAction');
  const missing = [];
  if (amountToCall === null) missing.push('amountToCall');
  if (potBeforeAction === null) missing.push('potBeforeAction');
  if (missing.length) return missingResult('CALL', missing);
  if (amountToCall === 0) return missingResult('CALL', ['amountToCall must be greater than zero']);
  if (equity === null) return missingResult('CALL', ['equity']);
  if (rake.value === null && !rake.schedule) return missingResult('CALL', input.costInputMissing?.length ? input.costInputMissing : ['rake or assumeNoRake'], [], ['EV de call não foi modelado porque a premissa de rake não foi informada.']);
  const potAfterCall = potBeforeAction + amountToCall;
  const chargedRake = rakeAt(rake, potAfterCall, 5);
  if (!Number.isFinite(potAfterCall) || chargedRake > potAfterCall) return missingResult('CALL', ['rake válido para o pote final'], [], ['O rake não pode exceder o pote final.']);
  const ev = equity * Math.max(0, potAfterCall - chargedRake) - amountToCall;
  return {
    action: 'CALL',
    legal: true,
    status: 'MODELED',
    ev,
    rake: chargedRake,
    netPot: Math.max(0, potAfterCall - chargedRake),
    model: 'SHOWDOWN_ONLY',
    assumptions: ['Um único pote inteiramente elegível; sem novas contribuições ou apostas futuras.', rake.assumption],
    missingInputs: [],
    warnings: []
  };
}

function calculateCheck(input, equity, rake) {
  if (Array.isArray(input.sidePots) ? input.sidePots.length > 0 : Boolean(input.sidePots)) return missingResult('CHECK', ['modelo de potes laterais e elegibilidade']);
  const future = input.futureStreetModel;
  if (!future || typeof future !== 'object' || future.type !== 'SHOWDOWN_ONLY') {
    return missingResult('CHECK', ['futureStreetModel'], [], ['EV de check depende de ações futuras e não foi estimado.']);
  }
  if (equity === null) return missingResult('CHECK', ['equity']);
  if (rake.value === null && !rake.schedule) return missingResult('CHECK', ['rake or assumeNoRake']);
  const potAtShowdown = nonNegativeOrNull(future.potAtShowdown ?? input.potBeforeAction, 'potAtShowdown');
  if (potAtShowdown === null) return missingResult('CHECK', ['potAtShowdown']);
  if (rakeAt(rake, potAtShowdown, 5) > potAtShowdown) return missingResult('CHECK', ['rake válido para o pote final']);
  return {
    action: 'CHECK',
    legal: true,
    status: 'MODELED',
    ev: equity * Math.max(0, potAtShowdown - rakeAt(rake, potAtShowdown, 5)),
    rake: rakeAt(rake, potAtShowdown, 5),
    netPot: Math.max(0, potAtShowdown - rakeAt(rake, potAtShowdown, 5)),
    model: 'SHOWDOWN_ONLY',
    assumptions: ['Nenhuma aposta futura; showdown direto.', rake.assumption],
    missingInputs: [],
    warnings: ['Este cenário não modela realização de equity nem apostas futuras.']
  };
}

function closeEnough(left, right) {
  return Math.abs(left - right) <= 1e-8 * Math.max(1, Math.abs(left), Math.abs(right));
}

function requiredNonNegative(value, label) {
  const number = nonNegativeOrNull(value, label);
  if (number === null) throw new Error(`${label} é necessário.`);
  return number;
}

function requiredProbability(value, label) {
  const number = probabilityOrNull(value, label);
  if (number === null) throw new Error(`${label} é necessário.`);
  return number;
}

function scenarioError(action, reason) {
  return missingResult(action, ['modelo de resposta válido'], [], [`${action}: ${reason}`]);
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
    if (!model || model.type !== 'SCENARIO_SHOWDOWN_ONLY') throw new Error('tipo de modelo de resposta não suportado.');
    if (model.action !== action) throw new Error('o modelo foi definido para outra ação.');
    if (!['USER_PROVIDED', 'HEURISTIC_PRESET', 'USER_SUPPLIED_HYPOTHESIS'].includes(model.source)) throw new Error('source deve identificar uma hipótese USER_PROVIDED, USER_SUPPLIED_HYPOTHESIS ou HEURISTIC_PRESET.');
    for (const other of Object.values(input.actionResponseModels || {})) {
      if (other?.type === 'SCENARIO_SHOWDOWN_ONLY' && !sameScenarioState(model, other)) throw new Error('os modelos das ações devem compartilhar o mesmo estado de contribuições e stacks.');
    }
    const hasSidePots = value => Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (model.allowReRaises || hasSidePots(model.sidePots) || hasSidePots(input.sidePots)) throw new Error('reaumentos e potes laterais não estão modelados.');
    const pot = requiredNonNegative(input.potBeforeAction, 'potBeforeAction');
    const call = requiredNonNegative(input.amountToCall, 'amountToCall');
    const stack = requiredNonNegative(input.effectiveStack, 'effectiveStack');
    const heroContribution = requiredNonNegative(model.heroContribution, 'heroContribution');
    const target = requiredNonNegative(model.targetStreetTotal, 'targetStreetTotal');
    const currentBet = heroContribution + call;
    const heroCost = target - heroContribution;
    if (heroCost <= 0 || heroCost > stack + 1e-8) throw new Error('o custo incremental deve ser positivo e caber no stack do herói.');
    if (action === 'CALL') {
      if (call <= 0 || !closeEnough(target, currentBet)) throw new Error('CALL deve igualar a aposta atual com custo amountToCall.');
    } else if (action === 'BET') {
      if (call !== 0) throw new Error('BET exige que não haja valor para pagar.');
      const minimumBet = requiredNonNegative(input.minBet, 'minBet');
      if (minimumBet <= 0) throw new Error('minBet deve ser positivo.');
      if (heroCost + 1e-8 < minimumBet) throw new Error('o custo da aposta fica abaixo de minBet.');
      if (heroCost > pot + 1e-8) throw new Error('o tamanho da aposta excede o pote.');
      if (input.betSize != null && input.betSize !== '' && !closeEnough(requiredNonNegative(input.betSize, 'betSize'), heroCost)) throw new Error('betSize deve ser o custo incremental de targetStreetTotal.');
    } else {
      if (currentBet <= 0 || target <= currentBet) throw new Error('RAISE exige aposta atual positiva e total maior que ela.');
      if (heroCost > pot + 2 * call + 1e-8) throw new Error('o aumento excede o limite do pote: custo máximo = pote + 2 × call.');
      if (input.raiseTo != null && input.raiseTo !== '' && !closeEnough(requiredNonNegative(input.raiseTo, 'raiseTo'), target)) throw new Error('raiseTo deve ser o total da rodada, igual a targetStreetTotal.');
      const explicitMinimum = model.minRaiseTo ?? input.minRaiseTo;
      const minimum = explicitMinimum == null || explicitMinimum === '' ? 2 * currentBet : requiredNonNegative(explicitMinimum, 'minRaiseTo');
      if (minimum <= currentBet) throw new Error('minRaiseTo deve exceder a aposta atual.');
      if (target + 1e-8 < minimum) throw new Error(explicitMinimum == null || explicitMinimum === ''
        ? 'o aumento requer minRaiseTo real; sem esse dado só aceitamos total de pelo menos duas vezes a aposta atual.'
        : 'o aumento fica abaixo de minRaiseTo.');
      if (input.maxRaiseTo != null && input.maxRaiseTo !== '' && target > requiredNonNegative(input.maxRaiseTo, 'maxRaiseTo') + 1e-8) throw new Error('o aumento excede maxRaiseTo.');
    }
    if (!Array.isArray(model.opponents) || model.opponents.length < 1) throw new Error('informe os adversários e suas contribuições atuais.');
    if (Number.isInteger(Number(input.players)) && model.opponents.length !== Number(input.players) - 1) throw new Error('a quantidade de adversários do modelo difere da mão.');
    const opponents = new Map();
    let contributions = heroContribution;
    for (const opponent of model.opponents) {
      const id = typeof opponent.id === 'string' ? opponent.id.trim() : '';
      if (!id || opponents.has(id)) throw new Error('cada adversário deve ter um id único.');
      const contribution = requiredNonNegative(opponent.contribution, `contribution de ${id}`);
      const stackRemaining = requiredNonNegative(opponent.stackRemaining, `stackRemaining de ${id}`);
      if (contribution > currentBet + 1e-8) throw new Error(`contribuição de ${id} incompatível com o valor para pagar.`);
      contributions += contribution;
      opponents.set(id, { id, contribution, stackRemaining });
    }
    if (contributions > pot + 1e-8) throw new Error('a soma das contribuições atuais excede o pote informado.');
    if ((call > 0 || action === 'RAISE') && ![...opponents.values()].some(opponent => closeEnough(opponent.contribution, currentBet))) throw new Error('nenhum adversário tem a aposta atual que o herói enfrenta.');
    if (!Array.isArray(model.scenarios) || model.scenarios.length < 1) throw new Error('informe os cenários de resposta.');
    const seenSubsets = new Set();
    let probabilitySum = 0;
    let ev = 0;
    let envelopeLow = 0;
    let envelopeHigh = 0;
    let completeEnvelope = true;
    const scenarioBreakdown = [];
    for (const [index, scenario] of model.scenarios.entries()) {
      const probability = requiredProbability(scenario.probability, `probability do cenário ${index + 1}`);
      probabilitySum += probability;
      if (!Array.isArray(scenario.callers)) throw new Error('callers deve listar os pagadores, podendo ser vazio quando todos desistem.');
      const ids = [];
      let opponentAdditional = 0;
      for (const caller of scenario.callers) {
        const opponent = opponents.get(caller.id);
        if (!opponent || ids.includes(caller.id)) throw new Error('pagador desconhecido ou repetido no cenário.');
        const additional = requiredNonNegative(caller.additional, `additional de ${caller.id}`);
        if (!closeEnough(additional, target - opponent.contribution)) throw new Error(`additional de ${caller.id} deve completar exatamente o total da rodada.`);
        if (additional > opponent.stackRemaining + 1e-8) throw new Error(`o stack de ${caller.id} exige pagamento parcial/pote lateral, ainda não modelado.`);
        ids.push(caller.id);
        opponentAdditional += additional;
      }
      ids.sort();
      const subset = JSON.stringify(ids);
      if (seenSubsets.has(subset)) throw new Error('há cenários repetidos para o mesmo conjunto de pagadores.');
      seenSubsets.add(subset);
      for (const opponent of opponents.values()) {
        if ((opponent.stackRemaining === 0 || (action === 'CALL' && closeEnough(opponent.contribution, target))) && !ids.includes(opponent.id)) throw new Error(`o adversário ${opponent.id} já igualado/all-in não pode desaparecer deste showdown.`);
      }
      if (action === 'CALL' && ids.length === 0) throw new Error('CALL não pode ganhar o pote por todos desistirem.');
      // Folding to a raise returns only the unmatched raise increment. The
      // hero's call-sized matching part remains in the contested pot and can
      // incur rake, even though its gross award cancels that new investment.
      const uncalledReturned = ids.length ? 0 : Math.max(0,target-Math.max(...[...opponents.values()].map(p=>p.contribution)));
      const matchedHeroCost = ids.length ? heroCost : heroCost-uncalledReturned;
      const potAtShowdown = pot + matchedHeroCost + opponentAdditional;
      if (rake.schedule && scenario.rake != null && scenario.rake !== '') throw new Error('Não combine rakeSchedule com rake fixo de cenário.');
      const branchRake = scenario.rake == null || scenario.rake === ''
        ? rakeAt(rake, potAtShowdown, ids.length ? 5 : (input.board || []).length)
        : requiredNonNegative(scenario.rake, 'rake do cenário');
      if (branchRake === null) throw new Error('informe rake, rakeSchedule ou assumeNoRake para cada cenário.');
      if (branchRake > potAtShowdown) throw new Error('rake do cenário excede seu pote.');
      let branchEquity = null;
      let branchEv = pot - branchRake;
      let branchEnvelope = [branchEv, branchEv];
      if (ids.length > 0) {
        branchEquity = requiredProbability(scenario.equity, 'equity condicional do cenário');
        if (!['USER_CONDITIONAL', 'CALCULATED_CONDITIONAL'].includes(scenario.equitySource)) throw new Error('equitySource deve identificar a equity condicional informada ou calculada.');
        if (!Array.isArray(scenario.equityOpponentIds) || new Set(scenario.equityOpponentIds).size !== ids.length || JSON.stringify([...scenario.equityOpponentIds].sort()) !== subset) throw new Error('equityOpponentIds deve corresponder exatamente aos pagadores do cenário.');
        const netPot = potAtShowdown - branchRake;
        branchEv = branchEquity * netPot - heroCost;
        if (scenario.equityInterval == null) {
          branchEnvelope = null;
          if (probability > 0) completeEnvelope = false;
        } else {
          if (!Array.isArray(scenario.equityInterval) || scenario.equityInterval.length !== 2) throw new Error('equityInterval deve conter limite inferior e superior.');
          const low = requiredProbability(scenario.equityInterval[0], 'limite inferior da equity');
          const high = requiredProbability(scenario.equityInterval[1], 'limite superior da equity');
          if (low > branchEquity || high < branchEquity || low > high) throw new Error('equityInterval deve conter a estimativa condicional.');
          if (scenario.equityIntervalLevel != null) {
            const level = requiredProbability(scenario.equityIntervalLevel, 'equityIntervalLevel');
            if (level === 0 || level === 1) throw new Error('equityIntervalLevel deve ficar estritamente entre zero e um.');
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
    if (!closeEnough(probabilitySum, 1)) throw new Error('as probabilidades dos cenários devem somar 1.');
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
        'Probabilidades de resposta são hipóteses fixas; não são frequências estratégicas validadas.',
        'Cada equity é condicional ao conjunto de pagadores identificado no cenário.',
        'Um único pote elegível, sem reaumentos, pagamentos parciais nem apostas futuras.',
        `Total da rodada ${target}; já investido pelo herói ${heroContribution}; custo incremental ${heroCost}.`
      ],
      missingInputs: [],
      warnings: ['EV condicionado ao modelo de resposta informado e ao tamanho avaliado; não compara todos os tamanhos, não é solução ótima/GTO nem cobre erro das premissas.']
    };
  } catch (error) {
    return scenarioError(action, error.message);
  }
}

function calculateAggression(action, input, equity, rake) {
  const responseModel = input.actionResponseModels?.[action] || input.opponentResponseModel;
  if (responseModel?.type === 'SCENARIO_SHOWDOWN_ONLY') return calculateScenarioEV(action, input, responseModel, rake);
  if (responseModel?.type && responseModel.type !== 'ALL_FOLD_OR_ONE_CALLER') return scenarioError(action, 'tipo de modelo de resposta não suportado.');
  if (Number(input.players) > 2) return missingResult(action, ['modelo de continuação multiway'], [], ['EV de agressão multiway exige cenários com pagadores, contribuições e equities condicionais identificados.']);
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
  if (action === 'BET' && (amountToCall > 0 || heroContribution > 0) || action === 'RAISE' && currentBet <= 0) return scenarioError(action, 'ação incompatível com o valor para pagar.');
  if (heroCost <= 0 || opponentAdditional < 0 || (action === 'RAISE' && opponentAdditional === 0)) return scenarioError(action, 'tamanho não aumenta a aposta atual.');
  if (Number.isFinite(Number(input.effectiveStack)) && heroCost > Number(input.effectiveStack)) return scenarioError(action, 'o custo incremental excede o stack efetivo.');
  if (heroCost > potBeforeAction + 2 * amountToCall + 1e-8) return scenarioError(action, 'tamanho excede o limite do pote.');
  if (action === 'RAISE') {
    const minimum = input.minRaiseTo == null || input.minRaiseTo === '' ? 2 * currentBet : requiredNonNegative(input.minRaiseTo, 'minRaiseTo');
    if (size < minimum) return scenarioError(action, 'aumento abaixo do mínimo informado ou da faixa conservadora de duas vezes a aposta atual.');
    if (input.maxRaiseTo != null && input.maxRaiseTo !== '' && size > requiredNonNegative(input.maxRaiseTo, 'maxRaiseTo')) return scenarioError(action, 'aumento excede maxRaiseTo.');
  }
  if (2 * heroContribution + amountToCall > potBeforeAction + 1e-8) return scenarioError(action, 'contribuições atuais excedem o pote informado.');
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
      `Fold equity de ${(foldEquity * 100).toFixed(1)}%.`,
      `Equity de continuação de ${(continuationEquity * 100).toFixed(1)}%.`,
      'Sem nova agressão após a continuação.',
      rake.assumption
    ],
    missingInputs: [],
    warnings: ['Cenário simplificado: não modela uma resposta adicional do adversário.', ...(!heroContributionProvided && action === 'RAISE' ? ['Compatibilidade: contribuição atual do herói assumida como zero; raiseTo é o total da rodada.'] : [])]
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
      assumptions: ['EV relativo ao ponto da decisão.'],
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
      warnings: ['Não há ações legais para comparar.']
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
  if (incomplete) warnings.push('A comparação está incompleta: algumas ações legais não têm premissas suficientes.');
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
