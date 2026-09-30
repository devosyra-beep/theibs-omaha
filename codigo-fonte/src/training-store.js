const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PATH = process.env.THEIBS_DATA_PATH || path.join(__dirname, '..', 'data', 'training-events.jsonl');

function appendEvent(event, filePath = DEFAULT_PATH) {
  return appendEvents([event], filePath);
}

function appendEvents(events, filePath = DEFAULT_PATH) {
  if (!Array.isArray(events) || !events.length || events.some(event => !event || typeof event !== 'object' || !['DECISION', 'DOUBT', 'HAND_COMPLETE', 'IMPORT', 'OBSERVED_HAND'].includes(event.type))) {
    throw new Error('Invalid training event.');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, events.map(event => JSON.stringify({ ...event, timestamp: event.timestamp || new Date().toISOString() }) + '\n').join(''), 'utf8');
}

function readEvents(filePath = DEFAULT_PATH) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

// A cursor is the byte boundary before the oldest returned event. Appending
// newer records does not shift that boundary, so subsequent pages do not repeat
// or omit existing records. This reader does not rewrite malformed history.
async function readEventPage({ filePath = DEFAULT_PATH, limit = 20, beforeOffset = null, types = [], maxScannedBytes = Infinity, signal } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('History page size must be between 1 and 100.');
  if (beforeOffset !== null && (!Number.isSafeInteger(beforeOffset) || beforeOffset < 0)) throw Error('Invalid history cursor.');
  if (!Array.isArray(types) || types.some(type => typeof type !== 'string')) throw Error('Invalid history event filter.');
  if (maxScannedBytes !== Infinity && (!Number.isSafeInteger(maxScannedBytes) || maxScannedBytes < 1)) throw Error('Invalid history scan budget.');
  signal?.throwIfAborted();
  let file;
  try { file = await fs.promises.open(filePath, 'r'); }
  catch (error) { if (error.code === 'ENOENT') return { events: [], nextOffset: null, hasMore: false, fileSize: 0, scannedBytes: 0, scanLimited: false }; throw error; }
  try {
    const { size: fileSize } = await file.stat();
    if (beforeOffset !== null && beforeOffset > fileSize) throw Error('History changed or was truncated; restart pagination.');
    let position = beforeOffset ?? fileSize;
    if (position > 0 && position < fileSize) {
      const boundary = Buffer.alloc(1);
      await file.read(boundary, 0, 1, position - 1);
      if (boundary[0] !== 10) throw Error('History cursor is not an event boundary.');
    }
    const events = [], filter = new Set(types);
    let carry = Buffer.alloc(0), scannedBytes = 0, nextBoundary = position;
    const consume = (bytes, offset) => {
      const line = bytes.toString('utf8').trim();
      if (!line) return;
      let event;
      try { event = JSON.parse(line); }
      catch { throw Error(`Malformed history record at byte ${offset}; the file was preserved.`); }
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw Error(`Invalid history record at byte ${offset}; the file was preserved.`);
      nextBoundary = offset;
      if (!filter.size || filter.has(event.type)) events.push(event);
    };
    while (position > 0) {
      signal?.throwIfAborted();
      if (scannedBytes >= maxScannedBytes) return { events, nextOffset: nextBoundary > 0 ? nextBoundary : null,
        hasMore: nextBoundary > 0, fileSize, scannedBytes, scanLimited: true };
      const start = Math.max(0, position - Math.min(65536, maxScannedBytes - scannedBytes)), chunk = Buffer.alloc(position - start);
      const { bytesRead } = await file.read(chunk, 0, chunk.length, start);
      signal?.throwIfAborted();
      if (bytesRead !== chunk.length) throw Error('History changed during pagination; retry without a cursor.');
      scannedBytes += bytesRead;
      const bytes = Buffer.concat([chunk, carry]);
      let end = bytes.length;
      while (end > 0) {
        const newline = bytes.lastIndexOf(10, end - 1);
        if (newline < 0) break;
        const offset = start + newline + 1;
        consume(bytes.subarray(newline + 1, end), offset);
        if (events.length === limit) return { events, nextOffset: offset > 0 ? offset : null, hasMore: offset > 0, fileSize, scannedBytes, scanLimited: false };
        end = newline;
      }
      carry = bytes.subarray(0, end);
      if (carry.length > 2 * 1024 * 1024) throw Error('History record exceeds 2 MiB; the file was preserved.');
      position = start;
    }
    consume(carry, 0);
    return { events, nextOffset: null, hasMore: false, fileSize, scannedBytes, scanLimited: false };
  } finally { await file.close(); }
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
  if (!legal.includes(chosenAction) || !chosen) return { label: 'UNVERIFIED', evLoss: null, reason: 'The chosen action or size was not evaluated.' };
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

const positiveNumber = value => Number.isFinite(value) && value > 0 ? value : null;
const finiteNumber = value => Number.isFinite(value) ? value : null;

function decisionCohort(event) {
  const context = event.context || {};
  const dimensions = {
    variant: context.variant || null,
    engineBuild: event.engineBuild || context.engineBuild || null,
    opponentPolicy: event.opponentPolicyVersion || context.simulationPolicy || context.trainingEvaluation?.policy?.opponent || null,
    opponentStyle: context.opponentStyle || context.trainingEvaluation?.policy?.opponentStyle || null,
    continuationPolicy: context.trainingEvaluation?.policy?.heroContinuation || null,
    model: context.trainingEvaluation?.model || event.qualityDetails?.referenceScope || 'MODEL_SCENARIO_ONLY',
    source: event.source || null,
    unit: context.unit || 'chips',
    bigBlind: positiveNumber(context.bigBlind ?? context.blinds?.bigBlind),
    startingStack: positiveNumber(context.startingStack),
    rangeSource: event.rangeSource || context.rangeSource || null,
    costModel: context.costModel ? { mode: context.costModel.mode || 'UNKNOWN', amount: finiteNumber(context.costModel.amount) } : null
  };
  return { id: JSON.stringify(dimensions), dimensions,
    metadataComplete: ['variant', 'engineBuild', 'opponentPolicy', 'source', 'bigBlind', 'startingStack'].every(key => dimensions[key] != null)
      && dimensions.costModel?.mode !== 'UNKNOWN' && Number.isFinite(dimensions.costModel?.amount) };
}

// Unknown results stay unknown, including corrupt numeric strings and NaN.
// A known zero is a completed break-even result, not a missing result.
function outcomeTimeline(events) {
  const contextBySession = new Map();
  for (const event of events) if (event.type === 'DECISION' && event.sessionId) contextBySession.set(event.sessionId, event);
  return events.filter(event => event.type === 'HAND_COMPLETE').map(event => {
    const decision = contextBySession.get(event.sessionId) || {};
    const cohort = decisionCohort({ ...decision, ...event, context: event.context || decision.context,
      opponentPolicyVersion: event.policyVersion || decision.opponentPolicyVersion });
    const net = finiteNumber(event.outcome?.heroNet);
    const bigBlind = positiveNumber(event.bigBlind ?? cohort.dimensions.bigBlind);
    return { timestamp: event.timestamp || null, sessionId: event.sessionId || null, net,
      resultStatus: net === null ? 'UNKNOWN' : 'KNOWN', unit: 'chips',
      bigBlind, netBigBlinds: net !== null && bigBlind !== null ? net / bigBlind : null,
      cohortId: cohort.id, cohort: cohort.dimensions, metadataComplete: cohort.metadataComplete };
  });
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
  const cohorts = new Map();
  const measuredSet = new Set(measured);
  for (const event of decisions) {
    const cohort = decisionCohort(event);
    if (!cohorts.has(cohort.id)) cohorts.set(cohort.id, { ...cohort, decisions: 0, modeledDecisions: 0,
      inconclusiveDecisions: 0, incompleteDecisions: 0, sumEvLoss: 0 });
    const group = cohorts.get(cohort.id);
    group.decisions++;
    group.inconclusiveDecisions += Number(event.quality === 'INCONCLUSIVE_COMPARISON');
    group.incompleteDecisions += Number(event.quality === 'INCOMPLETE_COMPARISON');
    if (measuredSet.has(event)) { group.modeledDecisions++; group.sumEvLoss += event.evLoss; }
  }
  const evLossCohorts = [...cohorts.values()].map(group => ({ ...group,
    ungradedDecisions: group.decisions - group.modeledDecisions,
    averageEvLoss: group.modeledDecisions ? group.sumEvLoss / group.modeledDecisions : null,
    averageEvLossBigBlinds: group.modeledDecisions && group.dimensions.bigBlind !== null
      ? group.sumEvLoss / group.modeledDecisions / group.dimensions.bigBlind : null,
    unit: 'chips', denominator: group.modeledDecisions, denominatorScope: 'COMPLETE_SEPARATED_COMPARISONS_ONLY' }));
  const measuredCohorts = evLossCohorts.filter(group => group.modeledDecisions > 0);
  const outcomes = outcomeTimeline(events), knownOutcomes = outcomes.filter(item => item.resultStatus === 'KNOWN');
  const singleCohort = measuredCohorts.length === 1 ? measuredCohorts[0] : null;
  return {
    hands: hands.length, decisions: decisions.length, doubts: doubts.length,
    wins: hands.filter((event) => event.outcome?.winner === 'HERO').length,
    losses: hands.filter((event) => event.outcome?.winner === 'OPPONENT').length,
    ties: hands.filter((event) => event.outcome?.winner === 'TIE').length,
    unknownOutcomes: hands.filter(event => !['HERO', 'OPPONENT', 'TIE'].includes(event.outcome?.winner)).length,
    knownNetResults: knownOutcomes.length,
    unknownNetResults: outcomes.length - knownOutcomes.length,
    modeledDecisions: measured.length,
    ungradedDecisions: decisions.length - measured.length,
    incompleteDecisions: decisions.filter(event => event.quality === 'INCOMPLETE_COMPARISON').length,
    inconclusiveDecisions: decisions.filter(event => event.quality === 'INCONCLUSIVE_COMPARISON').length,
    // Do not combine stakes, versions or policies into an apparently comparable
    // scalar. Existing single-cohort consumers retain the original field.
    averageEvLoss: singleCohort?.averageEvLoss ?? null,
    averageEvLossBigBlinds: singleCohort?.averageEvLossBigBlinds ?? null,
    averageEvLossUnit: 'chips',
    averageEvLossMetadataComplete: singleCohort?.metadataComplete ?? false,
    averageEvLossDenominator: singleCohort?.modeledDecisions || 0,
    averageEvLossStatus: measuredCohorts.length > 1 ? 'MIXED_COHORTS' : singleCohort ? 'AVAILABLE' : 'NO_EVALUABLE_DECISIONS',
    evLossCohorts,
    metricInterpretation: 'Difference from the highest modeled EV; not realized profit or a demonstrated learning score.',
    metricScope: 'MODEL_SCENARIOS_WITH_REPORTED_SEPARATION_NOT_OPTIMAL_STRATEGY',
    automaticTraining: false,
    byStreet,
    nextExercise: difficult ? { street: difficult, basis: 'ACTIVITY_AND_QUESTIONS', masteryMeasured: false,
      reason: 'Street with the most recorded decisions, questions or divergences; a review suggestion, not a demonstrated leak.' } : null
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
    warning: `Descriptive simulator rate for ${policyVersion}; this is not a calibrated prediction of a real player. Earlier versions are not combined.`
  };
}

module.exports = { DEFAULT_PATH, appendEvent, appendEvents, readEvents, readEventPage, decisionQuality, summarize, similarDecisions, opponentTendencies, decisionCohort, outcomeTimeline };
