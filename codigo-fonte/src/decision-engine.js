const { calculateEquity } = require('./equity-engine');
const { calculatePotMath } = require('./pot-math');
const { legalActions } = require('./action-validator');
const { normalizeGameState } = require('./game-state');
const { resolveOpponentRanges } = require('./range-engine');
const { calculateActionEV } = require('./action-ev-engine');
const { evaluateStrategy } = require('./strategy-engine');
const { applyExploit } = require('./exploit-engine');
const { describeHand } = require('./hand-insights');
const { studySettings, buildStudyModels } = require('./aggression-scenarios');
const { attachAnalysisContract } = require('./analysis-contract');
const { sharedEquityLeadership } = require('./analyze-inference');

// One economic calculation and one interval propagation, shared by the
// statistical-only and full-context flows. This never runs a new simulation.
function economics(input, equity, actions) {
  const ev = calculateActionEV({ ...input, equity: equity.equity, legalActions: actions });
  const math = calculatePotMath({ ...input, equity: equity.equity, callModel: ev.actions.CALL });
  if (equity.confidenceInterval95) {
    const bounds = equity.confidenceInterval95.map(q => calculateActionEV({ ...input, equity:q, legalActions:actions }));
    for (const action of ['CALL','CHECK']) if (ev.actions[action]?.status === 'MODELED' && !ev.actions[action].scenarioBreakdown) {
      ev.actions[action].confidenceInterval95 = bounds.map(b => b.actions[action].ev);
      ev.actions[action].intervalScope = 'SOMENTE_ERRO_AMOSTRAL_COM_PREMISSAS_FIXAS';
    }
  }
  return { ev, math };
}

function decide(input) {
  const inputState = normalizeGameState(input);
  const warnings = [...inputState.warnings];
  if (!inputState.valid) {
    return {
      status: 'NO_DECISION',
      contractVersion: 'THEIBS_DECISION_V1',
      reason: inputState.errors[0] || 'Estado da mão inválido.',
      state: inputState.state,
      errors: inputState.errors,
      warnings
    };
  }
  let normalizedInput = inputState.normalizedInput;
  if (!inputState.state.knownInformation.players) {
    return {
      status: 'NO_DECISION', contractVersion: 'THEIBS_DECISION_V1',
      reason: 'Informe o número de jogadores ativos para definir quantos adversários entram na equity.',
      state: inputState.state, missingInputs: ['players'], warnings
    };
  }
  let rangeModel;
  try {
    rangeModel = resolveOpponentRanges(normalizedInput);
  } catch (error) {
    return {
      status: 'NO_DECISION',
      contractVersion: 'THEIBS_DECISION_V1',
      reason: 'Range adversário ausente ou inválido.',
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
    return { status: 'NO_DECISION', contractVersion: 'THEIBS_DECISION_V1', reason: 'Um range adversário válido é necessário para calcular equity.', state: inputState.state, ranges: rangeModel.publicRanges, warnings: [...warnings, error.message] };
  }
  if (normalizedInput.players && normalizedInput.players - 1 !== equity.opponents) warnings.push(`Equity calculada contra ${equity.opponents} oponente(s) modelado(s); a mesa informada tem ${normalizedInput.players - 1} adversário(s). Não representa automaticamente o cenário multiway completo.`);
  const handInsights = describeHand(normalizedInput.heroCards, normalizedInput.board, {
    deadCards: normalizedInput.deadCards || [],
    probabilitiesApplicable: rangeModel.ranges.every(range => range.kind === 'UNIFORM')
  });
  const hasPot = inputState.state.knownInformation.pot === true;
  const hasCallPrice = inputState.state.knownInformation.amountToCall === true;
  const hasStack = inputState.state.knownInformation.effectiveStack === true;
  const hasPosition = inputState.state.knownInformation.position === true;

  // Equity and hand quality need cards + opponent count/model, not financial
  // fields. If the full action state is incomplete, expose the statistical
  // result and, when the current call/check price is explicit, evaluate only
  // that decision instead of fabricating BET/RAISE assumptions.
  if (!hasPot || !hasCallPrice || !hasStack || !hasPosition) {
    let priceActions = hasCallPrice && normalizedInput.effectiveStack !== 0
      ? (normalizedInput.amountToCall > 0 ? ['FOLD','CALL'] : ['CHECK']) : [];
    if (Array.isArray(normalizedInput.availableActions)) priceActions = priceActions.filter(a => normalizedInput.availableActions.includes(a));
    const { ev, math } = economics(normalizedInput, equity, priceActions);
    ev.comparisonScope = 'CURRENT_PRICE_ONLY';
    ev.currentPriceComparisonComplete = ev.comparisonComplete;
    // A complete CALL/FOLD subset is not a complete action/size comparison.
    ev.comparisonComplete = false;
    warnings.push(...ev.warnings);
    const currentPriceMissing = [
      ...(!hasCallPrice ? ['amountToCall'] : []),
      ...(hasCallPrice && normalizedInput.amountToCall > 0 && !hasPot ? ['potBeforeAction'] : []),
      ...(ev.actions.CALL.legal ? ev.actions.CALL.missingInputs.filter(x => !['amountToCall','potBeforeAction'].includes(x)) : [])
    ];
    const fullComparisonMissing = [
      ...(!hasPosition ? ['position'] : []),
      ...(!hasStack ? ['effectiveStack'] : []),
      ...(!hasPot ? ['potBeforeAction'] : []),
      ...(!hasCallPrice ? ['amountToCall'] : [])
    ];
    const reason = currentPriceMissing.length
      ? `Equity e qualidade da mão calculadas. Para avaliar o preço atual, informe: ${currentPriceMissing.join(', ')}.`
      : priceActions.includes('CHECK')
        ? 'Equity e qualidade da mão calculadas. Não há custo para continuar nesta decisão; CHECK é tratado separadamente de força da mão.'
        : ev.actions.CALL.status === 'MODELED'
          ? 'Equity, qualidade da mão e EV do CALL atual foram calculados. A comparação completa de ações permanece separada e pode exigir mais contexto.'
          : 'Equity e qualidade da mão calculadas; não há CALL disponível no estado informado.';
    return attachAnalysisContract({
      status: 'OK',
      contractVersion: 'THEIBS_DECISION_V1',
      engineBuild: require('../package.json').version,
      analysisScope: currentPriceMissing.length ? 'STATISTICS_ONLY' : 'CURRENT_PRICE_ONLY',
      economicsAvailability: { currentPriceMissing, fullComparisonMissing },
      state: inputState.state,
      ranges: rangeModel.publicRanges,
      recommendedAction: null,
      confidence: 'LOW',
      equity,
      potMath: math,
      ev,
      strategy: null,
      scenarioSummary,
      ...(normalizedInput.opponentModelScope?{opponentModelScope:normalizedInput.opponentModelScope}:{}),
      handInsights,
      legalActions: priceActions,
      reason,
      assumptions: [`${equity.method} contra ${equity.opponents} oponente(s)`, ...rangeModel.assumptions,
        'Equity e qualidade da mão não dependem de preço, stack ou posição.',
        ...(priceActions.length ? ['EV do preço atual é incremental a partir desta decisão; valores já investidos são custos passados.'] : [])],
      warnings
    }, normalizedInput);
  }

  const actions = legalActions(normalizedInput);
  let ev, math;
  try { ({ ev, math } = economics(normalizedInput, equity, actions)); }
  catch(error) { return {status:'NO_DECISION',reason:error.message,state:inputState.state,equity,handInsights,warnings,errors:[error.message]}; }
  warnings.push(...ev.warnings);
  if (actions.length === 0) return { status: 'NO_DECISION', contractVersion: 'THEIBS_DECISION_V1', reason: 'Nenhuma ação legal disponível.', state: inputState.state, ranges: rangeModel.publicRanges, equity, potMath: math, ev, legalActions: actions, warnings };
  const strategyInput = { ...normalizedInput, equity, potMath: math, ev, legalActions: actions, state: inputState.state };
  const baseline = evaluateStrategy({ input: strategyInput, equity, potMath: math, ev, legalActions: actions, state: inputState.state });
  const epsilonBB=normalizedInput.practicalEquivalenceBB,bb=Number(normalizedInput.bigBlind);
  if(epsilonBB!=null&&(!Number.isFinite(Number(epsilonBB))||Number(epsilonBB)<0||!Number.isFinite(bb)||bb<=0))return {status:'NO_DECISION',reason:'Equivalência prática exige epsilon não negativo e bigBlind positivo.',state:inputState.state,warnings};
  if(normalizedInput.selectionInference!==undefined&&!['MARGINAL','SHARED_EQUITY_PAIRED'].includes(normalizedInput.selectionInference))return {status:'NO_DECISION',reason:'selectionInference inválida.',state:inputState.state,warnings};
  const paired=normalizedInput.selectionInference==='MARGINAL'?null:sharedEquityLeadership({ev,equity,study,marginal:baseline.leadership,epsilonChips:epsilonBB==null?null:Number(epsilonBB)*bb});
  if(paired){
    baseline.leadership=paired;
    baseline.reasonCodes=baseline.reasonCodes.filter(code=>!['EV_LEADERSHIP_OVERLAP','EV_LEADER_SEPARATED_WITHIN_BOUNDS'].includes(code));
    baseline.reasonCodes.push(paired.status==='SEPARATED'?'EV_LEADER_SEPARATED_PAIRED':'EV_LEADERSHIP_PAIRED_INCONCLUSIVE');
    baseline.warnings=baseline.warnings.filter(text=>!text.startsWith('Liderança nominal de'));
    baseline.assumptions.push('Diferenças de EV compartilham uma única equity no cenário HU uniforme; intervalo conjunto condicionado às premissas fixas, sem erro de modelo.');
    baseline.confidence=paired.status==='SEPARATED'?'MEDIUM':'LOW';
  }
  let exploit;
  try {
    exploit = applyExploit({ input: strategyInput, baseline, equity, ev, legalActions: actions });
  } catch (error) {
    return {
      status: 'NO_DECISION',
      contractVersion: 'THEIBS_DECISION_V1',
      reason: 'Perfil exploitativo inválido.',
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
    handInsights,
    legalActions: actions,
    reason: !ev.comparisonComplete ? `Comparação parcial: ${recommendedAction} lidera apenas entre as ações calculadas. Faltam ${(ev.missingLegalActions||[]).join(', ')}; não é uma conclusão sobre a melhor jogada geral.` : baseline.leadership.status !== 'SEPARATED' ? `${recommendedAction} está no topo dos valores calculados, mas a liderança é inconclusiva: empate, sobreposição ou ausência de faixas válidas. Isso não sustenta uma preferência segura entre as alternativas.` : `${recommendedAction} tem o maior EV e está separado nas faixas fornecidas entre os tamanhos e as hipóteses informados. Isso não prova a melhor estratégia fora desse modelo.`,
    assumptions: [`${equity.method} contra ${equity.opponents} oponente(s)`, ...rangeModel.assumptions, ...(baseline.assumptions || []), 'EV de ações futuras depende das premissas individuais; não há árvore completa turn/river.'],
    warnings
  }, normalizedInput);
}

module.exports = { decide };
