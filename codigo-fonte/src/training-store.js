const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PATH = process.env.THEIBS_DATA_PATH || path.join(__dirname, '..', 'data', 'training-events.jsonl');

function appendEvent(event, filePath = DEFAULT_PATH) {
  return appendEvents([event], filePath);
}

function appendEvents(events, filePath = DEFAULT_PATH) {
  if (!Array.isArray(events) || !events.length || events.some(event => !event || typeof event !== 'object' || !['DECISION', 'DOUBT', 'HAND_COMPLETE', 'IMPORT', 'OBSERVED_HAND'].includes(event.type))) {
    throw new Error('Evento de treino inválido.');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, events.map(event => JSON.stringify({ ...event, timestamp: event.timestamp || new Date().toISOString() }) + '\n').join(''), 'utf8');
}

function readEvents(filePath = DEFAULT_PATH) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function decisionQuality(result, chosenAction, chosenSize) {
  if (!result || result.status !== 'OK') return { label: 'UNVERIFIED', evLoss: null };
  if (result.trainingEvaluation) return trainingDecisionQuality(result, chosenAction, chosenSize);
  const legal = result.legalActions || [];
  const actions = result.ev?.actions || {};
  if (!legal.includes(chosenAction)) return { label: 'UNVERIFIED', evLoss: null };
  const complete = legal.length > 0 && legal.every((action) => actions[action]?.status === 'MODELED' && Number.isFinite(actions[action].ev));
  if (!complete) {
    return { label: 'INCOMPLETE_COMPARISON', evLoss: null };
  }
  const best = Math.max(...legal.map((action) => actions[action].ev));
  const nominalEvDifference = Math.max(0, best - actions[chosenAction].ev);
  const leadership = result.strategy?.baseline?.leadership;
  const reference = { nominalEvDifference, referenceScope: 'MODEL_SCENARIO_ONLY', leadershipStatus: leadership?.status || 'MISSING_BOUNDS' };
  if (leadership?.status !== 'SEPARATED') {
    return { label: 'INCONCLUSIVE_COMPARISON', evLoss: null, ...reference };
  }
  return { label: nominalEvDifference === 0 ? 'MATCHED_MODELED' : 'DIFFERENT_MODELED', evLoss: nominalEvDifference, ...reference };
}

function trainingDecisionQuality(result, chosenAction, chosenSize) {
  const evaluation = result.trainingEvaluation, candidates = evaluation.candidates || [], legal = result.legalActions || [];
  const aggressive = ['BET', 'RAISE'].includes(chosenAction);
  const chosen = candidates.find(option => option.action === chosenAction && (!aggressive ||
    (chosenSize != null && Number.isFinite(Number(chosenSize)) && Math.abs(option.size - Number(chosenSize)) < 1e-8)));
  if (!legal.includes(chosenAction) || !chosen) return { label: 'UNVERIFIED', evLoss: null, reason: 'Ação ou tamanho escolhido não foi avaliado.' };
  if (!legal.every(action => candidates.some(option => option.action === action)) ||
    new Set(candidates.map(option => option.optionId)).size !== candidates.length ||
    candidates.some(option => !legal.includes(option.action) || !Number.isFinite(option.ev) ||
      (['BET', 'RAISE'].includes(option.action) && !Number.isFinite(option.size)))) return { label: 'INCOMPLETE_COMPARISON', evLoss: null };
  const ranked = [...candidates].sort((a, b) => b.ev - a.ev), best = ranked[0];
  const nominalEvDifference = Math.max(0, best.ev - chosen.ev);
  const boundsValid = option => Array.isArray(option.confidenceInterval95) && option.confidenceInterval95.length === 2 &&
    option.confidenceInterval95.every(Number.isFinite) && option.confidenceInterval95[0] <= option.ev && option.confidenceInterval95[1] >= option.ev;
  const separated = ranked.length > 1 && ranked.every(boundsValid) &&
    ranked.slice(1).every(option => best.confidenceInterval95[0] > option.confidenceInterval95[1]) &&
    evaluation.leadership?.status === 'SEPARATED';
  const reference = { nominalEvDifference, referenceScope: 'TRAINING_POLICY_ROLLOUT',
    leadershipStatus: separated ? 'SEPARATED' : evaluation.leadership?.status === 'SEPARATED' ? 'MISSING_BOUNDS' : evaluation.leadership?.status || 'MISSING_BOUNDS',
    evaluationId: evaluation.evaluationId || null, chosenOptionId: chosen.optionId, recommendedOptionId: best.optionId,
    chosenSize: aggressive ? chosen.size : null, recommendedSize: best.size ?? null, chosenEV: chosen.ev, bestEV: best.ev };
  if (!separated) return { label: 'INCONCLUSIVE_COMPARISON', evLoss: null, ...reference };
  return { label: nominalEvDifference === 0 ? 'MATCHED_MODELED' : 'DIFFERENT_MODELED', evLoss: nominalEvDifference, ...reference };
}

function summarize(events) {
  const decisions = events.filter((event) => event.type === 'DECISION');
  const doubts = events.filter((event) => event.type === 'DOUBT');
  const hands = events.filter((event) => event.type === 'HAND_COMPLETE');
  // Legacy or uncertain comparisons stay in history, but cannot become a
  // verified EV-loss average merely because an old record contains a number.
  const measured = decisions.filter((event) => Number.isFinite(event.evLoss) && event.evLoss >= 0
    && ['MATCHED_MODELED', 'DIFFERENT_MODELED'].includes(event.quality)
    && event.context?.comparisonComplete === true
    && (event.context.leadership || event.context.strategy?.leadership)?.status === 'SEPARATED');
  const byStreet = Object.fromEntries(['PREFLOP', 'FLOP', 'TURN', 'RIVER'].map((street) => [street, {
    decisions: decisions.filter((event) => event.street === street).length,
    doubts: doubts.filter((event) => event.street === street).length,
    divergences: decisions.filter((event) => event.street === street && String(event.quality || '').startsWith('DIFFERENT')).length
  }]));
  const difficult = Object.entries(byStreet).filter(([, value]) => value.decisions + value.doubts > 0)
    .sort((a, b) => (b[1].doubts * 2 + b[1].divergences * 2 + b[1].decisions) - (a[1].doubts * 2 + a[1].divergences * 2 + a[1].decisions))[0]?.[0] || null;
  return {
    hands: hands.length, decisions: decisions.length, doubts: doubts.length,
    wins: hands.filter((event) => event.outcome?.winner === 'HERO').length,
    losses: hands.filter((event) => event.outcome?.winner === 'OPPONENT').length,
    ties: hands.filter((event) => event.outcome?.winner === 'TIE').length,
    modeledDecisions: measured.length,
    ungradedDecisions: decisions.length - measured.length,
    incompleteDecisions: decisions.filter(event => event.quality === 'INCOMPLETE_COMPARISON').length,
    inconclusiveDecisions: decisions.filter(event => event.quality === 'INCONCLUSIVE_COMPARISON').length,
    averageEvLoss: measured.length ? measured.reduce((sum, event) => sum + event.evLoss, 0) / measured.length : null,
    metricScope: 'MODEL_SCENARIOS_WITH_REPORTED_SEPARATION_NOT_OPTIMAL_STRATEGY',
    automaticTraining: false,
    byStreet,
    nextExercise: difficult ? { street: difficult, reason: 'Street com maior concentração de decisões, dúvidas ou divergências; sugestão provisória, não diagnóstico de leak.' } : null
  };
}

function similarDecisions(events, context, limit = 3) {
  return events.flatMap((event) => {
    if (event.type === 'DECISION' && event.context?.street === context.street && (event.context.variant || 'PLO5_HIGH') === (context.variant || 'PLO5_HIGH')) {
      return [{ timestamp: event.timestamp, street: event.street, chosenAction: event.chosenAction,
        recommendedAction: event.recommendedAction, quality: event.quality,
        similarity: (event.context.amountToCall > 0) === (context.amountToCall > 0) ? 1 : 0.5,
        similarityBasis: 'VARIANT_STREET_AND_CALL_STATE_ONLY', similarityIsProbability: false,
        referenceStatus: 'OWN_HISTORY_NOT_STRATEGIC_GROUND_TRUTH', engineBuild: event.engineBuild || event.context.engineBuild || null,
        comparisonComplete: event.context.comparisonComplete === true,
        leadershipStatus: (event.context.leadership || event.context.strategy?.leadership)?.status || null,
        source: 'OWN_SIMULATED_HISTORY' }];
    }
    if (event.type === 'IMPORT' && event.hand?.state?.street === context.street && (event.hand.variant || 'PLO5_HIGH') === (context.variant || 'PLO5_HIGH')) {
      return [{ timestamp: event.timestamp, street: event.hand.state.street,
        chosenAction: event.hand.chosenAction, recommendedAction: null, quality: 'UNVERIFIED',
        similarity: (event.hand.state.amountToCall > 0) === (context.amountToCall > 0) ? 1 : 0.5,
        similarityBasis: 'VARIANT_STREET_AND_CALL_STATE_ONLY', similarityIsProbability: false,
        referenceStatus: 'IMPORTED_HAND_WITHOUT_VERIFIED_STRATEGIC_LABEL',
        source: event.hand.source, rights: event.hand.rights }];
    }
    return [];
  }).sort((a, b) => b.similarity - a.similarity || String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).slice(0, limit);
}

function opponentTendencies(events, style) {
  const allHands = events.filter((event) => event.type === 'HAND_COMPLETE' && event.opponentStyle === style);
  const policyVersion=allHands.at(-1)?.policyVersion||'LEGACY_V1';
  const hands=allHands.filter(hand=>(hand.policyVersion||'LEGACY_V1')===policyVersion);
  const actions = hands.flatMap((hand) => hand.opponentActions || []);
  const opportunities = actions.filter((action) => !action.setup && ['BET', 'CHECK'].includes(action.action));
  const bets = opportunities.filter((action) => action.action === 'BET').length;
  const n = opportunities.length;
  return {
    source: 'SIMULATED_OBSERVATIONS', opponentStyle: style, policyVersion,
    observedResponses:Object.fromEntries(['FOLD','CALL','RAISE'].map(action=>[action,actions.filter(e=>!e.setup&&e.action===action).length])),
    opportunities: n, observedBets: bets,
    smoothedBetRate: n ? (bets + 2) / (n + 4) : null,
    prior: 'Beta(2,2)', confidence: n >= 30 ? 'MEDIUM' : 'LOW',
    warning: `Taxa descritiva do simulador ${policyVersion}; não é previsão calibrada de um jogador real. Versões anteriores não são misturadas.`
  };
}

module.exports = { DEFAULT_PATH, appendEvent, appendEvents, readEvents, decisionQuality, summarize, similarDecisions, opponentTendencies };
