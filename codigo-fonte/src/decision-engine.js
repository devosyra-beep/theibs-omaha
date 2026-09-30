const { calculateEquity } = require('./equity-engine');
const { calculatePotMath } = require('./pot-math');
const { legalActions } = require('./action-validator');
const { normalizeGameState } = require('./game-state');
const { resolveOpponentRanges } = require('./range-engine');
const { calculateActionEV } = require('./action-ev-engine');
const { enrichActionEV } = require('./action-ev-presentation');
const { evaluateStrategy } = require('./strategy-engine');
const { applyExploit } = require('./exploit-engine');
const { describeHand } = require('./hand-insights');
const { studySettings, buildStudyModels } = require('./aggression-scenarios');
const { attachAnalysisContract } = require('./analysis-contract');
const { sharedEquityLeadership } = require('./analyze-inference');

function actionReason(action, strategy) {
  const base = action === 'FOLD'
    ? 'This line folds when the equity or scenario does not justify continuing.'
    : action === 'RAISE'
      ? 'This line applies pressure or seeks value when the strategy and assumptions support aggression.'
      : action === 'BET'
        ? 'This line bets for value or pressure under the stated assumptions.'
        : action === 'CALL'
          ? 'This line continues to realize equity at the current price and under the current assumptions.'
          : action === 'CHECK'
            ? 'This line preserves equity realization and controls the pot.'
            : 'No action can be determined from the current data.';
  if (strategy?.exploit?.finalSource === 'EXPLOIT_ADJUSTMENT') {
    return `${base} An exploitative adjustment was applied to the baseline strategy.`;
  }
  return base;
}

function decide(input) {
  const inputState = normalizeGameState(input);
  const warnings = [...inputState.warnings];
  if (!inputState.valid) {
    return {
      status: 'NO_DECISION',
      contractVersion: 'THEIBS_DECISION_V1',
      reason: inputState.errors[0] || 'Invalid hand state.',
      state: inputState.state,
      errors: inputState.errors,
      warnings
    };
  }
  let normalizedInput = inputState.normalizedInput;
  const missingCore = [
    ['position', inputState.state.knownInformation.position],
    ['potBeforeAction', inputState.state.knownInformation.pot],
    ['amountToCall', inputState.state.knownInformation.amountToCall]
  ].filter(([, known]) => !known).map(([field]) => field);
  if (missingCore.length > 0) {
    return {
      status: 'NO_DECISION', contractVersion: 'THEIBS_DECISION_V1',
      reason: `Missing essential data: ${missingCore.join(', ')}.`,
      state: inputState.state, missingInputs: missingCore, warnings
    };
  }
  if (normalizedInput.effectiveStack === null) {
    return {
      status: 'NO_DECISION',
      contractVersion: 'THEIBS_DECISION_V1',
      reason: 'Effective stack is required to validate actions and calculate SPR.',
      state: inputState.state,
      warnings
    };
  }
  let rangeModel;
  try {
    rangeModel = resolveOpponentRanges(normalizedInput);
  } catch (error) {
    return {
      status: 'NO_DECISION',
      contractVersion: 'THEIBS_DECISION_V1',
      reason: 'Opponent range is missing or invalid.',
      state: inputState.state,
      errors: [error.message],
      warnings
    };
  }
  warnings.push(...rangeModel.warnings);
  let study;
  try { study=studySettings(normalizedInput,rangeModel); }
  catch(error){return {status:'NO_DECISION',reason:error.message,state:inputState.state,warnings};}
  let equityInput = rangeModel.mode === 'KNOWN_HAND'
    ? normalizedInput
    : { ...normalizedInput, opponentHands: undefined, opponentRanges: rangeModel.ranges };
  if(study)equityInput={...equityInput,samples:study.samplesPerCount,samplingMode:'FIXED'};
  let equity,scenarioSummary=null;
  try {
    equity = calculateEquity(equityInput);
    if(study){const prepared=buildStudyModels(normalizedInput,study,equity);normalizedInput=prepared.input;scenarioSummary=prepared.summary;}
  } catch (error) {
    return { status: 'NO_DECISION', contractVersion: 'THEIBS_DECISION_V1', reason: 'A valid opponent range is required to calculate equity.', state: inputState.state, ranges: rangeModel.publicRanges, warnings: [...warnings, error.message] };
  }
  if (normalizedInput.players && normalizedInput.players - 1 !== equity.opponents) warnings.push(`Equity was calculated against ${equity.opponents} modeled opponent(s); the reported table has ${normalizedInput.players - 1} opponent(s). This does not automatically represent the full multiway scenario.`);
  const actions = legalActions(normalizedInput);
  let ev;
  try { ev = calculateActionEV({ ...normalizedInput, equity: equity.equity, legalActions: actions }); }
  catch(error) { return {status:'NO_DECISION',reason:error.message,state:inputState.state,warnings,errors:[error.message]}; }
  const math = calculatePotMath({ ...normalizedInput, equity: equity.equity, callModel: ev.actions.CALL });
  if(equity.confidenceInterval95){
    const bounds=equity.confidenceInterval95.map(q=>calculateActionEV({...normalizedInput,equity:q,legalActions:actions}));
    for(const action of ['CALL','CHECK'])if(ev.actions[action]?.status==='MODELED'&&!ev.actions[action].scenarioBreakdown){
      ev.actions[action].confidenceInterval95=bounds.map(b=>b.actions[action].ev);
      ev.actions[action].intervalScope='SAMPLING_ERROR_ONLY_FIXED_ASSUMPTIONS';
    }
  }
  enrichActionEV(ev, { ...normalizedInput, legalActions: actions }, equity);
  warnings.push(...ev.warnings);
  if (actions.length === 0) return { status: 'NO_DECISION', contractVersion: 'THEIBS_DECISION_V1', reason: 'No legal action is available.', state: inputState.state, ranges: rangeModel.publicRanges, equity, potMath: math, ev, legalActions: actions, warnings };
  const strategyInput = { ...normalizedInput, equity, potMath: math, ev, legalActions: actions, state: inputState.state };
  const baseline = evaluateStrategy({ input: strategyInput, equity, potMath: math, ev, legalActions: actions, state: inputState.state });
  const epsilonBB=normalizedInput.practicalEquivalenceBB,bb=Number(normalizedInput.bigBlind);
  if(epsilonBB!=null&&(!Number.isFinite(Number(epsilonBB))||Number(epsilonBB)<0||!Number.isFinite(bb)||bb<=0))return {status:'NO_DECISION',reason:'Practical equivalence requires nonnegative epsilon and positive bigBlind.',state:inputState.state,warnings};
  if(normalizedInput.selectionInference!==undefined&&!['MARGINAL','SHARED_EQUITY_PAIRED'].includes(normalizedInput.selectionInference))return {status:'NO_DECISION',reason:'Invalid selectionInference.',state:inputState.state,warnings};
  const paired=normalizedInput.selectionInference==='MARGINAL'?null:sharedEquityLeadership({ev,equity,study,marginal:baseline.leadership,epsilonChips:epsilonBB==null?null:Number(epsilonBB)*bb});
  if(paired){
    baseline.leadership=paired;
    baseline.reasonCodes=baseline.reasonCodes.filter(code=>!['EV_LEADERSHIP_OVERLAP','EV_LEADER_SEPARATED_WITHIN_BOUNDS'].includes(code));
    baseline.reasonCodes.push(paired.status==='SEPARATED'?'EV_LEADER_SEPARATED_PAIRED':'EV_LEADERSHIP_PAIRED_INCONCLUSIVE');
    baseline.warnings=baseline.warnings.filter(text=>!text.startsWith('Nominal lead by '));
    baseline.assumptions.push('EV differences share one equity estimate in the uniform heads-up scenario; the joint interval is conditional on fixed assumptions and excludes model error.');
    baseline.confidence=paired.status==='SEPARATED'?'MEDIUM':'LOW';
  }
  let exploit;
  try {
    exploit = applyExploit({ input: strategyInput, baseline, equity, ev, legalActions: actions });
  } catch (error) {
    return {
      status: 'NO_DECISION',
      contractVersion: 'THEIBS_DECISION_V1',
      reason: 'Invalid exploitative profile.',
      state: inputState.state,
      ranges: rangeModel.publicRanges,
      equity,
      potMath: math,
      ev,
      legalActions: actions,
      errors: [error.message],
      warnings
    };
  }
  const strategy = {
    baseline,
    exploit,
    finalAction: exploit.finalAction,
    finalSource: exploit.finalSource,
    confidence: exploit.confidence,
    conflicts: exploit.conflicts,
    warnings: [...new Set([...(baseline.warnings || []), ...(exploit.warnings || [])])]
  };
  warnings.push(...strategy.warnings);
  const recommendedAction = strategy.finalAction;
  return attachAnalysisContract({
    status: 'OK',
    contractVersion: 'THEIBS_DECISION_V1',
    engineBuild: require('../package.json').version,
    state: inputState.state,
    ranges: rangeModel.publicRanges,
    baselineAction: baseline.action,
    recommendedAction,
    confidence: strategy.confidence,
    equity,
    potMath: math,
    ev,
    strategy,
    scenarioSummary,
    ...(normalizedInput.opponentModelScope?{opponentModelScope:normalizedInput.opponentModelScope}:{}),
    handInsights: describeHand(normalizedInput.heroCards, normalizedInput.board),
    legalActions: actions,
    reason: !ev.comparisonComplete ? `Partial comparison: ${recommendedAction} leads only among modeled actions. Missing: ${(ev.missingLegalActions||[]).join(', ')}; this is not a conclusion about the best overall play.` : baseline.leadership.status !== 'SEPARATED' ? `${recommendedAction} leads the calculated values, but its lead is inconclusive because of a tie, overlap, or missing valid intervals. This does not support a confident preference among the alternatives.` : `${recommendedAction} has the highest EV and is separated within the supplied intervals across the stated sizes and assumptions. This does not establish the best strategy outside this model.`,
    assumptions: [`${equity.method} against ${equity.opponents} opponent(s)`, ...rangeModel.assumptions, ...(baseline.assumptions || []), 'Future action EV depends on separate assumptions; there is no complete turn/river tree.'],
    warnings
  }, normalizedInput);
}

module.exports = { decide };
