(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
  const ACTIONS = {
    FOLD: { label: 'Fold', past: 'folded' }, CHECK: { label: 'Check', past: 'checked' },
    CALL: { label: 'Call', past: 'called' }, BET: { label: 'Bet', past: 'bet' }, RAISE: { label: 'Raise', past: 'raised' }
  };
  const COMMANDS = [
    {id:'leave',key:'f',resolve:()=> 'FOLD'},
    {id:'call',key:'g',resolve:state=>state?.legal?.actions?.includes('CHECK')?'CHECK':'CALL'},
    {id:'aggressive',key:'h',resolve:state=>state?.currentBet?'RAISE':'BET'}
  ];
  const POSITIONS = { 2: ['SB', 'BB'], 3: ['SB', 'BB', 'BTN'], 4: ['SB', 'BB', 'CO', 'BTN'],
    5: ['SB', 'BB', 'HJ', 'CO', 'BTN'], 6: ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'],
    7: ['SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO', 'BTN'], 8: ['SB', 'BB', 'UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN'],
    9: ['SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN'], 10: ['SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'UTG3', 'LJ', 'HJ', 'CO', 'BTN'] };
  const STREETS = { PREFLOP: 'Preflop', FLOP: 'Flop', TURN: 'Turn', RIVER: 'River' };
  let options = {}, view = { enabled: false, state: null, config: null, busy: false, error: '' };
  let initialized = false, localBusy = false, setupDirty = false, sizeDraft = null, boardDraft = null, selectedPlayer = null;
  let setupHost, setupDialog, controlsHost, boardDialog, seatDialog, setupPurpose = 'activate', nextSetupDraft = null;
  let rakeChoice = { mode: 'GROSS' }, nextRakeChoice = null;
  let completionDialog, revealDialog, rakeDialog, completionToken = null, revealDraft = null;
  let completionSeenHand = null, completionTransition = false, recoveryDialog = null;
  let resultDraft = null;
  let sizeEvaluationTimer = null, lastEvaluationSize = null;
  const busy = () => localBusy || view.busy;
  const context = () => options.getContext?.() || {};
  const player = id => view.state?.players?.find(item => item.id === id);
  const playerName = item => item?.hero ? 'You' : (item?.name || 'Opponent').replace(/^Adv\./i,'Opp.');
  const actor = () => player(view.state?.actor);
  const inAnalysis = () => document.body.dataset.view === 'analyze' && !$('#analyze-workspace')?.classList.contains('hidden');
  const legal = action => view.enabled && !busy() && view.state?.phase === 'BETTING' && view.state.legal?.actions?.includes(action);
  const resolveCommand = command => view.enabled && !busy() && view.state?.phase === 'BETTING' ? command.resolve(view.state) : null;
  const activeToken = () => JSON.stringify([view.state?.revisionKey ?? view.state?.revision, view.state?.actor, view.state?.street, view.state?.phase, view.state?.log?.length, view.state?.pot]);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const bb = value => finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 1 })}` : '—';
  const numericalLabel = value => ({
    SAMPLING_INTERVAL_95: '95% sampling interval', CONDITIONAL_ENVELOPE: 'Conditional scenario range',
    EXACT_ENUMERATION: 'Exact within the model', DECISION_REFERENCE: 'Decision reference',
    NO_NUMERICAL_INTERVAL: 'No numerical interval', NOT_AVAILABLE: 'Unavailable',
    FIXED_INPUT_ARITHMETIC: 'Exact arithmetic for stated inputs',
    INVALID_INTERVAL: 'Reported interval unavailable'
  })[value] || value;
  const methodLabel = value => ({
    SHOWDOWN_ONLY: 'Showdown only', SCENARIO_SHOWDOWN_ONLY: 'Modeled responses, then showdown',
    FIXED_RESPONSE_SHOWDOWN_ONLY: 'Fixed response, then showdown', RELATIVE_DECISION_POINT: 'Decision reference'
  })[value] || String(value).replace(/_/g, ' ').toLowerCase();
  const precisionReason = precision => ({
    EQUILIBRIUM_ACTION_VALUE_UNCERTAINTY_UNAVAILABLE:'Action EV error bounds unavailable.',
    DEFENSIBLE_UNCERTAINTY_UNAVAILABLE:'Defensible error bounds unavailable.',
    INVALID_OR_MISSING_ACTION_BOUNDS:'An action has no valid error interval.',
    INVALID_ACTION_BOUND_CONTEXT:'Action bounds use incompatible contexts.',
    ACTION_BOUNDS_PENDING:'Action bounds are still being resolved.',
    BEST_SECOND_INTERVALS_OVERLAP:'The top two uncertainty intervals overlap.',
    OTHER_ALTERNATIVE_INTERVAL_OVERLAPS:'Another action’s uncertainty interval overlaps.',
    INCOMPATIBLE_ORIGINS:'Sources, quality or decision contexts differ.',
    COMPARISON_ORIGIN_MISSING:'Comparison origin was not recorded.',
    INSUFFICIENT_COMPARABLE_ACTIONS:'At least two comparable actions are required.',
    MISSING_ACTION_VALUES:'Some alternatives have no modeled EV.',
    TIED_POINT_ESTIMATES:'The top two point estimates are tied.',
    SEPARATED_UNDER_FIXED_POLICY:'95% bounds separate within the fixed model.',
    SEPARATED_ACTION_COMMITMENT_BOUNDS:'Bounds separate from every compared action.'
  })[precision?.reasonCode] || precision?.reason || 'Defensible error bounds unavailable.';
  function describeDecisionEV(state, analysis, readiness = {}) {
    const current = state?.players?.find(item => item.id === state.actor);
    if (state?.phase !== 'BETTING' || !current?.hero) return null;
    const fresh = analysis?.status === 'OK' && ['FINAL','PROVISIONAL'].includes(analysis.analysisStage) &&
      analysis.observedState?.revisionKey === state.revisionKey && (state.handId===undefined || analysis.observedState?.handId===state.handId);
    const ev = fresh && readiness.heroDraftReady !== false ? analysis.ev : null;
    const waitingCards = readiness.heroDraftReady === false;
    const provisional = Boolean(fresh && !waitingCards && analysis.analysisStage === 'PROVISIONAL');
    const refinement = provisional && ['TIME_BUDGET','FAILED'].includes(analysis?.refinement?.status) &&
      !(analysis.clientTiming?.refinementPending===true && readiness.analysisBusy!==false) ? analysis.refinement : null;
    const refining = provisional && readiness.analysisBusy!==false && !refinement;
    const idle = !ev && !provisional && readiness.analysisBusy === false;
    const bigBlind = finite(ev?.bigBlind) && ev.bigBlind > 0 ? ev.bigBlind : finite(state.bigBlind) && state.bigBlind > 0 ? state.bigBlind : null;
    const decisionActions = (state.legal?.actions || []).filter(action => action !== 'FOLD' || state.legal.toCall > 0);
    const candidates = Array.isArray(ev?.candidates) ? ev.candidates.filter(item => decisionActions.includes(item.action)) : null;
    const entries = candidates?.length ? candidates : decisionActions.map(action => ({ ...ev?.actions?.[action], action }));
    const comparisonCurrent = !(state.legal?.toCall === 0 && (ev?.candidates?.some(item => item.action === 'FOLD') || ev?.actions?.FOLD?.status === 'MODELED'));
    const rows = entries.map(item => {
      const action = item.action;
      const modeled = item?.status === 'MODELED' && finite(item.ev);
      const valueBB = modeled ? finite(item.evBB) ? item.evBB : bigBlind ? item.ev / bigBlind : null : null;
      return {
        action, optionId: item?.optionId || action, size: finite(item?.size) ? item.size : null,
        status: !ev ? waitingCards || idle || provisional && !refining ? 'NOT_MODELED' : 'PENDING' : modeled ? 'MODELED' : 'NOT_MODELED',
        evBB: valueBB,
        differenceBB: comparisonCurrent && !provisional && modeled && ev?.decisionPrecision?.bestActionId && finite(item.differenceToBestModeledBB) ? item.differenceToBestModeledBB : null,
        method: item?.method || item?.model || null,
        numericalQuality: item?.numericalQuality || null,
        numericalBounds: [item?.numericalBounds, item?.confidenceInterval95].find(bounds => Array.isArray(bounds) && bounds.length === 2 && bounds.every(finite)) || null,
        samples: finite(item?.samples) ? item.samples : null,
        assumptions: Array.isArray(item?.assumptions) ? item.assumptions : [],
        missingInputs: Array.isArray(item?.missingInputs) ? item.missingInputs : []
      };
    });
    const modeledCount = rows.filter(row => row.status === 'MODELED' && finite(row.evBB)).length;
    const estimateCount = rows.filter(row=>row.status==='MODELED' && finite(row.evBB) && row.action!=='FOLD' && row.method!=='DECISION_REFERENCE').length;
    const foldReference = rows.some(row=>row.action==='FOLD' && row.status==='MODELED' && row.evBB===0 && row.method==='DECISION_REFERENCE');
    return {
      rows, bigBlind,feeBasis:ev?.feeBasis || (rakeChoice.mode==='GROSS'?'BEFORE_FEES':null),
      potBeforeDecision: finite(ev?.potBeforeDecision) ? ev.potBeforeDecision : finite(state.pot) ? state.pot : null,
      toCall: finite(state.legal?.toCall) ? state.legal.toCall : null,
      stage: waitingCards ? 'WAITING_CARDS' : analysis?.status && analysis.status !== 'OK' ? analysis.status === 'NO_DECISION' ? 'NO_DECISION' : 'UNAVAILABLE' : idle ? 'IDLE' : provisional ? 'PROVISIONAL' : !ev ? 'PENDING' : String(ev.comparisonStatus || '').startsWith('INCOMPARABLE_') ? 'INCOMPARABLE' : !ev.comparisonComplete ? 'PARTIAL' : ev.globalBestSupported ? 'COMPLETE' : 'INCONCLUSIVE',
      refinement,refining,
      comparisonStatus: ev?.comparisonStatus || null,
      modeledCount,estimateCount,foldReference,
      bestModeledAction: comparisonCurrent && !provisional && modeledCount && decisionActions.includes(ev.bestModeledAction) && (!ev.decisionPrecision || ev.decisionPrecision.bestActionId) ? ev.bestModeledAction : null,
      bestModeledSize: rows.find(row => row.optionId === ev?.bestModeledOptionId)?.size ?? null,
      finiteSizeGrid: Boolean(candidates?.length),
      globalBestSupported: comparisonCurrent && !provisional && ev?.globalBestSupported === true,
      leaderConclusive: comparisonCurrent && !provisional && ev?.decisionPrecision?.status === 'CONCLUSIVE' && ev.decisionPrecision.leaderConclusive === true,
      precision: provisional || !comparisonCurrent ? null : ev?.decisionPrecision || null,
      gapBestSecondBB: provisional || !comparisonCurrent ? null : finite(ev?.decisionPrecision?.deltaEVBB) ? ev.decisionPrecision.deltaEVBB : null,
      missingLegalActions: Array.isArray(ev?.missingLegalActions) ? ev.missingLegalActions.filter(action => decisionActions.includes(action)) : [],
      assumptions: Array.isArray(ev?.assumptions) ? ev.assumptions : [],
      warnings: [...(Array.isArray(ev?.warnings) ? ev.warnings : []),
        ...(view.config?.stackEstimates?.some(Boolean) ? ['EV and legal sizes use estimated stacks carried from an unresolved hand. Payouts were not inferred.'] : [])],
      reason: analysis?.status && analysis.status !== 'OK' ? analysis.reason : null
    };
  }
  function placeDecisionEV() {
    const host = $('#mw-decision-ev');
    if (!host) return;
    const rail = $('#analyze-workspace .context-rail');
    if (view.enabled && rail) {
      if (host.parentElement !== rail || host !== rail.firstElementChild) rail.prepend(host);
    } else if (host.parentElement !== controlsHost) {
      controlsHost.insertBefore(host, $('#mw-board-prompt'));
    }
  }
  function solverControls() {
    const job = window.TheibsMultiwaySolverUI?.getState?.();
    if (!job) return '';
    const running = ['QUEUED','BUILDING','REFINING'].includes(job.phase);
    const reason = job.error || job.result?.reasons?.[0]?.message;
    const comparing=job.comparisonPhase==='RUNNING';
    return `<div class="mw-solver-controls"><button type="button" class="text-button" data-mw-solver-setup>${job.configured ? 'Edit study scenarios' : 'Set up river study'}</button>${job.configured ? `<button type="button" class="text-button" data-mw-solver-standard${running?' disabled':''}>Refine</button><button type="button" class="text-button" data-mw-solver-deep${running?' disabled':''}>Deep · up to 30s</button>` : ''}${job.runtime==='BROWSER' && job.studyProvenance?.scenarioCount>1 ? `<button type="button" class="text-button" data-mw-solver-compare${running || comparing?' disabled':''}>Compare scenarios</button>`:''}${comparing?'<button type="button" class="text-button" data-mw-solver-comparison-stop>Stop comparison</button>':''}${running ? '<button type="button" class="text-button" data-mw-solver-cancel>Stop refinement</button>' : ''}</div>${reason ? `<p>${esc(reason)}</p>` : ''}`;
  }
  function studyComparisonDetails(state=window.TheibsMultiwaySolverUI?.getComparisonState?.()) {
    if(!state || state.phase==='IDLE' && !state.error)return '';
    const precise=value=>!finite(value)?'—':value!==0 && (Math.abs(value)<.001 || Math.abs(value)>=1e6)?value.toExponential(3):value.toLocaleString('en-US',{maximumFractionDigits:5});
    const report=state.report;
    const summaries=(report?.scenarios || []).map(item=>`<tr><th scope="row">${esc(item.name)}</th><td><span>${esc(item.currentHand?.pointLeaderActionIds?.join(', ') || 'Unavailable')}</span><small>Profile estimate</small></td><td><span>${esc(item.commitment?.status || 'Unavailable')}</span>${item.commitment?.nearGroupActionIds?.length?`<small>${esc(item.commitment.nearGroupActionIds.join(', '))}</small>`:''}</td><td><span>${esc(item.usable===false?'Unavailable':item.global?.status || 'Unavailable')}</span><small>NashConv ${precise(item.global?.nashConv)} bb</small></td></tr>`).join('');
    const scenarioDetails=(report?.scenarios || []).map(item=>`<details><summary>${esc(item.name)} · values & coverage</summary><p>Current-hand EV against the returned profile; these estimates do not certify equilibrium action values.</p><ul>${(item.currentHand?.actions || []).map(row=>`<li>${esc(row.id)}: ${precise(row.evBB)} bb · ${precise(100*row.frequency)}% mix.</li>`).join('')}</ul><p>Full-prior commitment bounds · ${esc(item.commitment?.status || 'Unavailable')}. They do not imply equal EV for your current hand.</p><ul>${(item.commitment?.rows || []).map(row=>`<li>${esc(row.id)}: ${row.certified?`estimate ${precise(row.estimateBB)} bb; lower ${precise(row.lowerBB)}, upper ${precise(row.upperBB)} bb.`:'Certified bounds pending.'}</li>`).join('')}</ul><p>${item.coverage?.fullLegalSizingCoverage===true?'All legal sizes covered in the declared tree.':'Restricted or unavailable sizing coverage.'}${finite(item.coverage?.omittedSizingNodes) && finite(item.coverage?.omittedLegalSizeCount)?` ${item.coverage.omittedLegalSizeCount} omitted legal sizes across ${item.coverage.omittedSizingNodes} nodes; ${finite(item.coverage.aggressionCapNodes)?item.coverage.aggressionCapNodes:'unavailable'} nodes reached the aggression cap.`:''}</p>${item.reasonCodes?.length?`<p>Details: ${esc(item.reasonCodes.join(', '))}.</p>`:''}</details>`).join('');
    const pairs=(report?.comparisons || []).map(pair=>{
      const from=report.scenarios.find(item=>item.id===pair.fromId)?.name || pair.fromId,to=report.scenarios.find(item=>item.id===pair.toId)?.name || pair.toId;
      return `<details><summary>${esc(from)} → ${esc(to)} · profile changes</summary><p>Returned-profile model sensitivity, not uncertainty. Each value belongs to its declared ranges and tree; commitment bounds are not combined across studies.</p><table><thead><tr><th>Action</th><th>Baseline EV · bb</th><th>Alternative EV · bb</th><th>Change · bb</th></tr></thead><tbody>${(pair.actionComparisons || []).map(row=>`<tr><th>${esc(row.id || row.actionId)}</th><td>${row.state==='MISSING_IN_BASELINE'?'Not in this tree':precise(row.baselineEVBB)}</td><td>${row.state==='MISSING_IN_CANDIDATE'?'Not in this tree':precise(row.candidateEVBB)}</td><td>${precise(row.deltaBB)}</td></tr>`).join('')}</tbody></table></details>`;
    }).join('');
    return `<details class="mw-solver-comparison"><summary>Scenario comparison · ${esc(state.phase.toLowerCase())}</summary><p>${state.phase==='RUNNING'?'Sequential Browser compute · up to 3s per alternative, 6s total.':'The active study result remains the primary decision display.'}</p>${state.error?`<p>${esc(state.error)}</p>`:''}${report?`<p>${esc(String(report.classification).replaceAll('_',' ').toLowerCase())}. Comparisons apply only to these explicitly supplied studies.</p>`:''}${summaries?`<table><thead><tr><th>Scenario</th><th>Current-hand profile leader</th><th>Commitment outcome</th><th>Solver convergence</th></tr></thead><tbody>${summaries}</tbody></table>`:''}${scenarioDetails}${pairs}</details>`;
  }
  function renderSolverDecision(host, priorDetails) {
    const solved = window.TheibsMultiwaySolverUI?.decisionSnapshot?.();
    if (!solved || solved.revisionKey !== view.state?.revisionKey || solved.handId !== view.state?.handId) return false;
    const rows = solved.actions, precision = solved.decisionPrecision;
    const suppliedOutcome=solved.decisionOutcome, policy=suppliedOutcome?.policy, expectedPolicyKey=solved.comparisonPolicyKey || solved.policyKey;
    const outcomeGlobalMet=suppliedOutcome?.globalConverged===true && solved.convergence?.exact===true && solved.convergence.thresholdMet===true &&
      finite(solved.convergence.nashConv) && solved.convergence.nashConv>=0 && solved.convergence.nashConv<=.01 && finite(solved.convergence.thresholdBB) && solved.convergence.thresholdBB>=0 && solved.convergence.thresholdBB<=.01 && solved.convergence.nashConv<=solved.convergence.thresholdBB;
    const certificateFrame=solved.actionPrecision;
    const validBoundFrame=solved.decisionPrecision?.target==='PRIVATE_INFORMATION_SET_COMMITMENT_VALUE' && solved.decisionPrecision.contextKey===certificateFrame?.baseContextKey &&
      certificateFrame?.target==='PRIVATE_INFORMATION_SET_COMMITMENT_VALUE' && certificateFrame.supportedGameClass===true && certificateFrame.fullPriorPreserved===true && certificateFrame.originalHandActionEV===false &&
      certificateFrame.utility?.unit==='BB' && certificateFrame.utility.basis==='INCREMENTAL_TERMINAL_PAYOFF_FROM_ORIGINAL_DECISION' && certificateFrame.utility.scope==='FULL_PRIOR_EX_ANTE' &&
      Array.isArray(certificateFrame.actions) && certificateFrame.actions.length===rows.length && new Set(certificateFrame.actions.map(row=>row.id)).size===rows.length &&
      rows.every(action=>certificateFrame.actions.some(row=>row.id===action.id && row.certified===true && row.baseGameHash===solved.gameHash && row.baseContextKey===certificateFrame.baseContextKey &&
        row.target===certificateFrame.target && row.origin===certificateFrame.origin && row.version===certificateFrame.version && row.solverVersion===solved.solverVersion &&
        row.utility?.unit==='BB' && row.utility.basis===certificateFrame.utility.basis && row.utility.scope==='FULL_PRIOR_EX_ANTE' && typeof row.gameHash==='string' && row.conditionedHash===row.gameHash &&
        finite(row.lowerBB) && finite(row.estimateBB) && finite(row.upperBB) && row.lowerBB<=row.estimateBB && row.estimateBB<=row.upperBB));
    const outcomeValid=suppliedOutcome?.version==='THEIBS_DECISION_OUTCOME_V1' &&
      ['ESTIMATING','CERTIFIED','NEAR_EQUIVALENT','INCONCLUSIVE'].includes(suppliedOutcome.status) &&
      suppliedOutcome.scope==='FULL_PRIOR_COMMITMENT' && suppliedOutcome.target==='PRIVATE_INFORMATION_SET_COMMITMENT_VALUE' && suppliedOutcome.actualHandEVEquivalence===false &&
      policy?.version==='THEIBS_COMPARISON_POLICY_V1' && policy.unit==='BB' && policy.scope==='FULL_PRIOR_COMMITMENT' && finite(policy.nearEquivalenceBB) && policy.nearEquivalenceBB>=0 &&
      /^[a-f0-9]{64}$/.test(suppliedOutcome.policyKey || '') && (!expectedPolicyKey || suppliedOutcome.policyKey===expectedPolicyKey) &&
      (!solved.comparisonPolicy || policy.nearEquivalenceBB===solved.comparisonPolicy.nearEquivalenceBB && policy.version===solved.comparisonPolicy.version) &&
      Array.isArray(suppliedOutcome.actionIds) && suppliedOutcome.actionIds.length===rows.length && new Set(suppliedOutcome.actionIds).size===rows.length && rows.every(row=>suppliedOutcome.actionIds.includes(row.id));
    const validNear=outcomeValid && outcomeGlobalMet && validBoundFrame && suppliedOutcome.status==='NEAR_EQUIVALENT' &&
      Array.isArray(suppliedOutcome.nearGroupActionIds) && suppliedOutcome.nearGroupActionIds.length>=2 && new Set(suppliedOutcome.nearGroupActionIds).size===suppliedOutcome.nearGroupActionIds.length &&
      suppliedOutcome.nearGroupActionIds.every(id=>rows.some(row=>row.id===id)) && finite(suppliedOutcome.robustWorstDifferenceBB) && suppliedOutcome.robustWorstDifferenceBB>=0 && suppliedOutcome.robustWorstDifferenceBB<=policy.nearEquivalenceBB;
    const validCertified=outcomeValid && outcomeGlobalMet && validBoundFrame && suppliedOutcome.status==='CERTIFIED' && typeof suppliedOutcome.strictLeaderActionId==='string' &&
      rows.some(row=>row.id===suppliedOutcome.strictLeaderActionId) && precision?.status==='CONCLUSIVE' && precision.leaderConclusive===true && suppliedOutcome.strictLeaderActionId===precision.bestActionId;
    const outcome=suppliedOutcome ? outcomeValid && (suppliedOutcome.status!=='NEAR_EQUIVALENT' || validNear) && (suppliedOutcome.status!=='CERTIFIED' || validCertified)?suppliedOutcome:{status:'INCONCLUSIVE',invalid:true} : null;
    const commitment = precision?.target === 'PRIVATE_INFORMATION_SET_COMMITMENT_VALUE';
    const cert = solved.actionPrecision;
    const sameBounds = commitment && precision.contextKey === cert?.baseContextKey
      && precision.reasonCode !== 'INVALID_ACTION_BOUND_CONTEXT';
    const boundFor = row => sameBounds ? cert.actions?.find(item=>item.id===row.id && item.certified === true) : null;
    const valueFor = row => commitment ? boundFor(row)?.estimateBB : row.evBB;
    const displayedLeaderId=outcome && !outcome.invalid && ['ESTIMATING','INCONCLUSIVE'].includes(outcome.status)?outcome.diagnostics?.pointLeaderActionId || precision?.bestActionId:precision?.bestActionId;
    const bestRow = rows.find(row=>row.id===displayedLeaderId), best = bestRow && valueFor(bestRow);
    const precise = value => !finite(value) ? '—' : value !== 0 && (Math.abs(value)<.001 || Math.abs(value)>=1e6)
      ? value.toExponential(2).replace(/e\+?/,'e').replace(/-/g,'−')
      : value.toLocaleString('en-US',{maximumSignificantDigits:6});
    const gap = finite(precision?.deltaEVBB) ? precision.deltaEVBB : null;
    const conclusive = precision?.status === 'CONCLUSIVE' && precision.leaderConclusive === true &&
      (!outcome || outcome.status==='CERTIFIED' && outcome.strictLeaderActionId===precision.bestActionId);
    const running = ['QUEUED','BUILDING','REFINING'].includes(solved.phase);
    const paused = !running && solved.adaptation?.phase === 'REFINING';
    const nc = solved.convergence?.exact && finite(solved.convergence.nashConv) ? solved.convergence.nashConv : null;
    const meta = solved.abstraction || {}, legal = view.state.legal;
    const provenance=solved.studyProvenance;
    const studyLabel=provenance?`<p class="mw-solver-study-label">Scenario: ${esc(provenance.name)} · Tree: ${esc(provenance.treeName)}</p>`:'';
    const templateNotes=Object.entries(provenance?.rangeOriginsBySeat || {}).map(([seat,origin])=>`<details><summary>Seat ${esc(seat)} · reviewed template origin${origin.edited?' · edited':''}</summary><p>${esc(origin.model)} · ${esc(origin.conditioningScope)}. User-reviewed hypothesis, not inferred card evidence.</p><p>Source hand: ${esc(origin.sourceHandId)} · revision ${esc(origin.sourceRevisionKey)} · scenario ${esc(origin.sourceScenarioId)}. Source board: ${esc(origin.sourceBoard?.join(' ') || 'Unknown')}.</p><p>${origin.edited?'The current range differs from the original template; its prior weights were not treated as observations.':'Original combinations and relative weights were retained.'}</p><ul>${(origin.sourceCombos || []).map(combo=>`<li>${esc(combo.cards.join(' '))} · weight ${esc(combo.weight)}</li>`).join('')}</ul></details>`).join('');
    const studyNotes=provenance?`<details><summary>Declared range hypotheses</summary><p>Scenario: ${esc(provenance.name)} · Tree: ${esc(provenance.treeName)}. Names and rationale record user hypotheses; they are not observed cards or learned statistics.</p>${Object.entries(provenance.rationaleBySeat || {}).filter(([,value])=>value).map(([seat,value])=>`<p>${Number(seat)===meta.heroSeat?'You':`Seat ${esc(seat)}`} · ${esc(value)}</p>`).join('')}${templateNotes}</details>`:'';
    const belowLeader = value => !finite(value) ? '—' : precise(Math.abs(value));
    const fees = meta.feeModel?.type === 'NONE' ? meta.feeModel.basis === 'BEFORE_FEES' ? ' · Before fees' : ' · No fees assumed' : ' · Declared fees';
    const rowHtml = rows.map(row=>{
      const bound = boundFor(row), value = valueFor(row);
      const secondary = commitment ? bound ? `<span>${precise(bound.lowerBB)}</span><span>to ${precise(bound.upperBB)}</span>` : 'Pending'
        : `${(100*row.frequency).toLocaleString('en-US',{maximumFractionDigits:1})}%`;
      return `<tr><th scope="row">${esc(ACTIONS[row.action]?.label || row.action)}${finite(row.size)?` <small>to ${esc(money(row.size))}</small>`:''}</th><td><span>${precise(value)}</span></td><td>${secondary}</td><td><span>${belowLeader(outcome?.status!=='NEAR_EQUIVALENT' && finite(best)&&finite(value)?best-value:null)}</span></td></tr>`;
    }).join('');
    const quality = nc === null ? 'Deviation quality unavailable' : `NashConv ${nc.toLocaleString('en-US',{maximumFractionDigits:5})} bb · target ≤ ${money(solved.convergence.thresholdBB)} bb`;
    const computeLocation = solved.runtime === 'BROWSER' ? 'Browser compute' : 'Server compute';
    const actionName=row=>`${ACTIONS[row.action]?.label || row.action}${finite(row.size)?' to '+money(row.size):''}`;
    const leader = outcome?.status==='NEAR_EQUIVALENT' ? `Near-equivalent commitments: ${outcome.nearGroupActionIds.map(id=>actionName(rows.find(row=>row.id===id))).join(', ')}`
      : outcome?.status==='ESTIMATING' ? finite(best)?`Current commitment estimate leader · provisional: ${actionName(bestRow)}`:'Commitment bounds pending'
      : outcome?.invalid ? 'Commitment comparison unavailable'
      : bestRow ? `${conclusive?commitment?'Certified commitment leader':'Best action':outcome?'Current commitment estimate leader · provisional':'Current EV leader'}: ${actionName(bestRow)}` : 'No comparable EV leader';
    const reason = outcome?.status==='NEAR_EQUIVALENT' ? 'Full-prior commitment comparison.' : outcome?.status==='ESTIMATING' ? running?'Commitment bounds are still being estimated.':'Commitment comparison remains provisional; refinement is paused.' : outcome?.invalid ? 'Comparison outcome context unavailable.' : outcome?.reason || precisionReason(precision);
    const gapSummary=outcome?.status==='NEAR_EQUIVALENT' ? `Robust commitment difference: ${precise(outcome.robustWorstDifferenceBB)} bb` : `ΔEV · top two: ${gap===null?'unavailable':precise(gap)+' bb'}`;
    const comparisonDetails=outcome && !outcome.invalid ? `<p>Decision outcome: ${esc(outcome.status)}. Comparison policy: ${precise(policy.nearEquivalenceBB)} bb · FULL_PRIOR_COMMITMENT. Near-equivalence concerns ex-ante values across the full supplied prior. It does not imply equal EV for your current hand. Solver qualification and the legacy strict comparison (${esc(precision?.status)}) remain separate.</p><details><summary>Comparison diagnostics</summary><pre>${esc(JSON.stringify(outcome.diagnostics || {},null,2))}</pre></details>` : '';
    const decisionRows=rows.filter(row=>row.action!=='FOLD' || view.state.legal?.toCall>0);
    const freeFoldExcluded=decisionRows.length!==rows.length;
    const profileValues=decisionRows.map(row=>row.evBB).filter(finite).sort((a,b)=>b-a),profileBest=profileValues[0];
    const profileLeaders=decisionRows.filter(row=>row.evBB===profileBest);
    const compactEV=value=>!finite(value)?'—':value!==0 && (Math.abs(value)<.001 || Math.abs(value)>=1000)?value.toExponential(1).replace('e+','e'):value.toLocaleString('en-US',{maximumFractionDigits:3});
    const compactMix=value=>!finite(value)?'—':value>0 && value<.001?'<0.1%':(100*value).toLocaleString('en-US',{maximumFractionDigits:1})+'%';
    const profileCell=(value,label,display)=>{const full=finite(value)?`${label}: ${String(value)}`:`${label}: unavailable`;return `<td title="${esc(full)}"><span aria-label="${esc(full)}">${esc(display)}</span></td>`;};
    const primaryRows=decisionRows.map(row=>{
      const value=row.evBB,difference=commitment || freeFoldExcluded?finite(profileBest)&&finite(value)?profileBest-value:null:outcome?.status!=='NEAR_EQUIVALENT' && finite(best)&&finite(value)?best-value:null;
      return `<tr><th scope="row">${esc(actionName(row))}</th>${profileCell(value,'Current-hand profile EV · bb',compactEV(value))}${profileCell(finite(row.frequency)?100*row.frequency:null,'Profile mix · percent',compactMix(row.frequency))}${profileCell(difference,'Below profile leader · bb',compactEV(difference))}</tr>`;
    }).join('');
    const primaryConclusion=commitment || freeFoldExcluded?`<div class="mw-ev-conclusion">${esc(profileLeaders.length?`Current profile EV leader${profileLeaders.length>1?'s':''} · provisional: ${profileLeaders.map(actionName).join(', ')}`:'Current-hand profile estimates unavailable')}<span>Profile EV gap · top two: ${profileValues.length>1?precise(profileValues[0]-profileValues[1])+' bb':'unavailable'}</span><span>INCONCLUSIVE · Returned-profile estimates; commitment certificates do not bound your current-hand action EV.</span></div>`:`<div class="mw-ev-conclusion">${esc(leader)}<span>${gapSummary}</span><span>${outcome?esc(outcome.status):conclusive?'CONCLUSIVE':'INCONCLUSIVE'} · ${esc(reason)}</span></div>`;
    const commitments=commitment?`<details class="mw-solver-profile"><summary>Full-prior commitments</summary><p>Ex-ante range commitment values, separate from current-hand profile EV. Any certified leader or near-equivalence applies only to this full-prior comparison.</p><table class="mw-ev-table mw-ev-bounds"><thead><tr><th>Action</th><th>Range commitment · bb</th><th>Bounds · bb</th><th>Below leader · bb</th></tr></thead><tbody>${rowHtml}</tbody></table><div class="mw-ev-conclusion">${esc(leader)}<span>${gapSummary}</span><span>${outcome?esc(outcome.status):conclusive?'CONCLUSIVE':'INCONCLUSIVE'} · ${esc(reason)}</span></div>${comparisonDetails}</details>`:'';
    const actionDetails = commitment ? `<details><summary>Action bounds & computation</summary><p>The action is fixed only at your private information set. Both players may re-optimize elsewhere; all original ranges and hidden information are preserved. Values average over the entire supplied range, not only your current hand. No statistical confidence interval is inferred from NashConv.</p><p>Displayed values are rounded. Comparisons use the full-precision bounds.</p><ul>${rows.map(row=>{const b=boundFor(row);return `<li><strong>${esc(row.id)}</strong>: ${b?`estimate ${precise(b.estimateBB)} bb; lower ${precise(b.lowerBB)}, upper ${precise(b.upperBB)} bb; ${money(b.iterations)} iterations; ${precise(b.elapsedMs)} ms. Source: ${esc(b.origin)}. Version: ${esc(b.solverVersion)}.`:'Certified bounds pending.'}</li>`;}).join('')}</ul><p>Every comparison uses the same base state, ranges, fees, utility and complete declared tree. A candidate stops receiving focused refinement only after its upper bound is strictly below a rival’s lower bound with the numerical guard.</p></details>` : '';
    const costs = solved.metrics?.costs;
    const diagnostics = solved.rootDiagnostics;
    const omissions=finite(solved.metrics?.omittedSizingNodes) && finite(solved.metrics?.omittedLegalSizeCount)?` ${solved.metrics.omittedLegalSizeCount} omitted legal sizes across ${solved.metrics.omittedSizingNodes} nodes; ${finite(solved.metrics.aggressionCapNodes)?solved.metrics.aggressionCapNodes:'unavailable'} nodes reached the aggression cap.`:'';
    const measurement = `<p>Exploitability: ${precise(solved.convergence?.exploitability)} bb. Root profile one-step regret: ${precise(diagnostics?.profileRegretBB ?? diagnostics?.oneStepRegret)} bb. ${diagnostics?.stability?.comparable ? `Checkpoint changes: EV ${precise(diagnostics.stability.maxActionEVChange)} bb; frequency ${precise(diagnostics.stability.maxFrequencyChange)}.` : 'Checkpoint stability is not yet available.'}</p>${costs?`<p>Compute: global ${precise(costs.globalSolveMs)} ms; action refinement ${precise(costs.actionSolveMs)} ms; certificates ${precise(costs.actionCertificateMs)} ms; total ${precise(costs.totalComputeMs)} ms.</p>`:''}${solved.adaptation?`<p>Refinement: ${esc(String(paused ? 'PAUSED' : solved.adaptation.stopReason || solved.adaptation.phase || '').replaceAll('_',' ').toLowerCase())}. Numerical quality is independent of the resource ceiling.</p>`:''}`;
    host.innerHTML = `<div class="mw-ev-heading"><strong>${commitment?'Current-hand EV · returned strategy':'Decision EV'}</strong><span class="mw-ev-badge">${outcome?'Solver · ':''}${esc(solved.status)}${running?' · refining':paused?' · paused':''}</span></div>
      <p class="mw-ev-context">River subgame · ${computeLocation} · Pot ${money(view.state.pot)} · Call ${money(legal?.toCall)}${fees}</p>${studyLabel}
      <table class="mw-ev-table mw-ev-strategy mw-ev-profile"><thead><tr><th scope="col">Action</th><th scope="col">EV · bb</th><th scope="col">Mix</th><th scope="col">Below leader · bb</th></tr></thead><tbody>${primaryRows}</tbody></table>${primaryConclusion}
      <details class="mw-ev-details"${priorDetails?' open':''}><summary>Methods & limits</summary><p>EV is incremental from the current decision. Below leader = leader EV − action EV within the displayed scope; it is a comparison gap, not an uncertainty interval or another EV estimate.</p><p>CFR+ · ${esc(solved.solverVersion)} · ${esc(solved.status)}. ${esc(quality)}. ${money(solved.iterations)} iterations.</p><p>EV and frequencies describe your hand against the returned continuation profile. Frequencies apply to your exact five-card combination; global convergence does not certify these action values.</p>
      ${studyNotes}${commitments}${actionDetails}${measurement}${commitment?'':comparisonDetails}${studyComparisonDetails()}
      <p>${meta.fullLegalSizingCoverage?'All legal sizes covered within this subgame.':'Restricted sizes or aggression depth: omitted actions remain outside this study.'}${omissions} This is not a solution of full-hand PLO5. ${meta.originalSeats>2?'Multiplayer CFR+ has no general Nash-convergence guarantee.':'Convergence qualification applies only to the supported two-player constant-sum subgame.'} NashConv measures unilateral deviation within the supplied game; it is not an action EV error bound.</p><p>Source: ${esc(solved.source)} · ${esc(meta.rulesVersion)}. Equity remains a separate showdown estimate.</p>${solverControls()}<ul>${(solved.limitations||[]).map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details>`;
    return true;
  }
  function refreshDecisionEV() {
    placeDecisionEV();
    const host = $('#mw-decision-ev'), decision = !view.enabled ? null : describeDecisionEV(view.state, view.analysis, view);
    const equityOrigin = $('#equity-origin');
    if(equityOrigin){equityOrigin.hidden=!decision || !window.TheibsMultiwaySolverUI?.decisionSnapshot?.();equityOrigin.textContent='Continuation model · separate from river study';}
    host.hidden = !view.enabled;
    host.classList.toggle('mw-ev-waiting',!!view.enabled&&!decision);
    if (!decision) {
      if(view.enabled){
        const current=actor(), waitingBoard=view.state?.phase==='WAIT_BOARD';
        const detail=waitingBoard?'Waiting for board cards':view.state?.phase==='BETTING'?`Waiting for ${playerName(current)} · ${current?.position||''}`:'Waiting for the hand result';
        host.innerHTML=`<div class="mw-ev-heading"><strong>Decision EV</strong><span class="mw-ev-badge">On your turn</span></div><p>${esc(detail)}</p><small>Automatic with your cards and the current board complete.</small>`;
      }
      return;
    }
    const priorDetails = host.querySelector('details')?.open ?? (document.body.dataset.analysisSecondary === 'expanded');
    if (renderSolverDecision(host, priorDetails)) return;
    const price = decision.toCall === null ? 'Call price unavailable' : decision.toCall === 0 ? 'Check available' : `Call ${money(decision.toCall)}${decision.bigBlind ? ` (${bb(decision.toCall / decision.bigBlind)} bb)` : ''}`;
    const pot = (decision.potBeforeDecision === null ? 'Pot unavailable' : `Pot ${money(decision.potBeforeDecision)}`)+(decision.feeBasis==='BEFORE_FEES'?' · Before fees':'');
    const needsRake = decision.rows.some(row => row.missingInputs.some(text => /rake/i.test(text)));
    const badge = needsRake ? 'Fee basis required' : decision.stage === 'WAITING_CARDS' ? 'Add your cards' : decision.stage === 'IDLE' ? 'Not calculated' : decision.stage === 'PROVISIONAL' ? decision.estimateCount ? decision.refining ? 'HEURISTIC · refining' : 'HEURISTIC · preliminary' : decision.refining ? 'Calculating action EV' : 'No sampled EV estimate' : decision.stage === 'PENDING' ? 'Calculating' : decision.stage === 'NO_DECISION' ? 'No decision' : decision.stage === 'UNAVAILABLE' ? 'Calculation unavailable' : decision.leaderConclusive ? 'HEURISTIC · separated estimates' : decision.stage==='PARTIAL'?'HEURISTIC · partial':'HEURISTIC · inconclusive';
    const rows = decision.rows.map(row => {
      const status = ['WAITING_CARDS','IDLE','NO_DECISION','UNAVAILABLE'].includes(decision.stage) ? 'Unavailable' : row.status === 'PENDING' ? 'Calculating' : row.status === 'MODELED' ? row.method==='DECISION_REFERENCE'?'Decision reference':'Modeled' : 'Not modeled';
      const size = row.size === null ? '' : ` <small>to ${esc(money(row.size))}</small>`;
      const difference = row.differenceBB === null ? '—' : bb(Math.abs(row.differenceBB)).replace(/^\+/, '');
      return `<tr><th scope="row"><span>${esc(ACTIONS[row.action]?.label || row.action)}${size}</span><small>${status}</small></th><td>${row.evBB === null ? '—' : bb(row.evBB)}</td><td>${difference}</td></tr>`;
    }).join('');
    const optionsHtml=decision.rows.map(row=>{
      const highest=decision.modeledCount>1 && row.action===decision.bestModeledAction && (row.size===null||row.size===decision.bestModeledSize);
      const label=(ACTIONS[row.action]?.label||row.action)+(row.size===null?'':' to '+money(row.size));
      const status=row.status==='PENDING'?'Calculating':row.status!=='MODELED'?'Unavailable':'';
      return `<div class="mw-ev-option" role="listitem" data-estimate-leader="${highest}"><strong>${esc(label)}</strong><b>${row.evBB===null?'—':bb(row.evBB)}${row.evBB===null?'':' <small>bb</small>'}</b>${status?`<small>${status}</small>`:''}</div>`;
    }).join('');
    const bestLabel = `${ACTIONS[decision.bestModeledAction]?.label || decision.bestModeledAction}${decision.bestModeledSize === null ? '' : ` to ${money(decision.bestModeledSize)}`}`;
    const leader = needsRake ? 'Declare rake or choose No rake to evaluate the other actions.' : decision.bestModeledAction
      ? decision.modeledCount === 1
        ? `Only ${esc(ACTIONS[decision.bestModeledAction]?.label || decision.bestModeledAction)} modeled · no overall best action.`
        : `${decision.leaderConclusive ? 'Best modeled action' : 'Current EV leader'}: ${esc(bestLabel)}`
      : decision.stage === 'WAITING_CARDS' ? 'Enter your cards to evaluate this decision.' : decision.stage === 'IDLE' ? 'No estimate for this decision.' : decision.stage === 'PROVISIONAL' ? decision.estimateCount ? decision.refining ? 'Preliminary estimates · refinement in progress.' : 'Preliminary estimates retained.' : decision.refining ? 'Waiting for the first sampled action EV estimate.' : decision.foldReference ? 'Fold is the exact zero reference; other action EV is unavailable.' : 'No action EV estimate is available.' : decision.stage === 'PENDING' ? 'Waiting for the current decision estimate.' : decision.stage === 'INCOMPARABLE' ? decision.comparisonStatus === 'INCOMPARABLE_ASSUMPTIONS' ? 'Action assumptions differ; EVs cannot be ranked.' : 'Opponent coverage differs; action EVs cannot be compared.' : decision.reason ? esc(decision.reason) : 'No action has modeled EV.';
    const gap = decision.stage === 'PROVISIONAL' || decision.modeledCount < 1 ? '' : `<span>ΔEV · top two: ${decision.gapBestSecondBB===null?'unavailable':money(decision.gapBestSecondBB)+' bb'}</span><span>${decision.leaderConclusive?'CONCLUSIVE':'INCONCLUSIVE'} · ${esc(precisionReason(decision.precision))}</span>`;
    const details = [
      '<li>EV is incremental from the current decision. Below leader = leader EV − action EV; it is a comparison gap, not an uncertainty interval or another EV estimate.</li>',
      ...(view.analysis?.performance?.runtimeLabel ? [`<li>Compute: ${esc(view.analysis.performance.runtimeLabel)}. ${esc(view.analysis.performance.runtimeReason || '')}</li>`] : []),
      ...(decision.precision ? [`<li>${esc(decision.precision.reason)}${decision.precision.differenceBoundsBB ? ' ΔEV interval: '+decision.precision.differenceBoundsBB.map(value=>bb(value)).join(' to ')+' bb.' : ''}</li>`] : []),
      ...decision.rows.map(row => {
        if (!row.method && !row.assumptions.length && !row.missingInputs.length && !row.numericalQuality) return '';
        const title = `${ACTIONS[row.action]?.label || row.action}${row.size === null ? '' : ` to ${money(row.size)}`}`;
        const bounds = row.numericalBounds && decision.bigBlind ? `EV range: ${bb(row.numericalBounds[0] / decision.bigBlind)} to ${bb(row.numericalBounds[1] / decision.bigBlind)} bb` : null;
        const facts = [row.method && `Method: ${methodLabel(row.method)}`, typeof row.numericalQuality === 'string' && `Numerical quality: ${numericalLabel(row.numericalQuality)}`, bounds, row.samples !== null && `Samples: ${row.samples}`,
          ...row.assumptions, row.missingInputs.length && `Needs: ${row.missingInputs.join(', ')}`].filter(Boolean);
        return `<li><strong>${esc(title)}</strong> · ${esc(facts.join(' · '))}</li>`;
      }).filter(Boolean),
      '<li>Source: legacy contextual continuation · '+esc(view.analysis?.strategyMetadata?.version || view.analysis?.multiwayEvaluation?.model || 'MULTIWAY_CONTEXT_POLICY_V1')+'. HEURISTIC: no equilibrium or strategy frequencies established.</li>',
      ...(decision.finiteSizeGrid ? ['<li>Compared sizes only · fixed continuation policy, not a solved strategy. No overall best action is established.</li>'] : []),
      ...decision.assumptions.map(item => `<li>${esc(item)}</li>`),
      ...decision.warnings.map(item => `<li>${esc(item)}</li>`)
    ].join('');
    const solverJob = window.TheibsMultiwaySolverUI?.getState?.();
    const refinementStatus = decision.refinement ? `<p class="mw-ev-limit" role="status">${decision.estimateCount?'Latest estimate retained.':'No sampled action EV estimate was completed.'} ${decision.refinement.status === 'TIME_BUDGET' ? 'Refinement reached its time budget.' : 'Refinement unavailable.'} Analyze hand to retry.</p>` : '';
    const runtimeNotice=view.analysis?.performance?.runtimeReason ? `<p class="mw-ev-limit" role="status">${esc(view.analysis.performance.runtimeReason)}</p>` : '';
    const solverPending = ['QUEUED','BUILDING','REFINING'].includes(solverJob?.phase) ? '<p class="mw-ev-limit" role="status">River study refining · current table uses heuristic EV.</p>' : '';
    host.innerHTML = `<div class="mw-ev-heading"><strong>Decision EV</strong><span class="mw-ev-badge" data-status="${decision.stage.toLowerCase()}">${badge}</span></div><div class="mw-ev-options" role="list" aria-label="Estimated action EV in big blinds">${optionsHtml}</div>${needsRake ? '<button type="button" class="ghost-button" data-mw-rake>Set fee basis</button>' : ''}${decision.missingLegalActions.length && decision.modeledCount > 1 ? '<p class="mw-ev-limit">Some legal actions have no estimate.</p>' : ''}<details class="mw-ev-details"${priorDetails ? ' open' : ''}><summary>Methods & limits${decision.feeBasis==='BEFORE_FEES'?' · before fees':''}${decision.refinement?' · refinement paused':''}</summary><p class="mw-ev-context">${pot} · ${price} · ${decision.bigBlind ? `1 bb = ${money(decision.bigBlind)} chips` : 'Big blind unavailable'}</p><table class="mw-ev-table"><thead><tr><th scope="col">Action</th><th scope="col">EV · bb</th><th scope="col">Below leader · bb</th></tr></thead><tbody>${rows}</tbody></table><div class="mw-ev-conclusion">${leader}${gap}</div>${runtimeNotice}${refinementStatus}${solverPending}<button type="button" class="text-button" data-mw-rake>Room fees · optional</button>${solverControls()}<ul>${details}</ul></details>`;
    if (typeof options.handlers?.profileComparison === 'function') {
      const comparison = view.profileComparison || {}, report = comparison.report;
      const ready = !view.analysisBusy && !busy() && decision.estimateCount > 0 && comparison.phase !== 'RUNNING';
      const comparisonRows = (report?.rows || []).map(row => `<tr><th scope="row">${esc(ACTIONS[row.action]?.label || row.action)}${row.size === null ? '' : ` to ${money(row.size)}`}</th><td>${row.profileEVBB === null ? '—' : bb(row.profileEVBB)}</td><td>${row.referenceEVBB === null ? '—' : bb(row.referenceEVBB)}</td><td>${row.changeBB === null ? '—' : bb(row.changeBB)}</td></tr>`).join('');
      host.querySelector('.mw-ev-details').insertAdjacentHTML('beforeend', `<section class="mw-profile-review" aria-label="Player profile sensitivity"><button type="button" class="ghost-button" data-mw-profile-compare${ready ? '' : ' disabled'}>${comparison.phase === 'RUNNING' ? 'Comparing profiles…' : 'Compare player profiles'}</button><p role="status">${esc(comparison.reason || (report ? 'HEURISTIC · model sensitivity, not a certified EV gain.' : 'Compare saved player evidence with the reference policy for this decision.'))}</p>${report ? `<table class="mw-ev-table"><thead><tr><th>Action</th><th>Profiles · bb</th><th>Reference · bb</th><th>Change · bb</th></tr></thead><tbody>${comparisonRows}</tbody></table><p>Same decision, fees, declared card priors and sizes. Profiles affect responses and action-history conditioning; the resulting card distributions can differ. Numerical sampling and profile uncertainty remain. This does not measure the gain of an adapted strategy against a fixed opponent.</p><p>Samples: profiles ${money(report.samples.profile)}, reference ${money(report.samples.reference)}. Reference compute: ${money(report.elapsedMs.reference)} ms.</p>` : ''}</section>`);
      if (report) host.querySelector('.mw-profile-review table').insertAdjacentHTML('beforebegin', `<p>${money(report.priorRecordedActions)} recorded opponent actions before this hand, across separate contexts. Point estimates can change with sparse evidence or sampling; a changed leader is not certified superiority.</p>`);
    }
  }
  function refreshDecisionFeedback() {
    const host = $('#mw-decision-feedback'), result = view.decisionFeedback;
    const valid = view.enabled && result && (!result.handId || !view.state?.handId || result.handId === view.state.handId);
    host.hidden = !valid;
    if (!valid) return;
    const selected = `${ACTIONS[result.chosenAction]?.label || result.chosenAction || 'Action'}${finite(result.chosenSize) ? ` to ${money(result.chosenSize)}` : ''}`;
    const loss = result.status === 'MODELED' && finite(result.lossBB) ? `EV loss ${bb(result.lossBB).replace(/^\+/, '')} bb${finite(result.lossPotPct) ? ` · ${result.lossPotPct.toLocaleString('en-US', { maximumFractionDigits: 1 })}% of the prior pot` : ''}` : 'EV loss inconclusive';
    const content = `<strong>Recorded ${esc(selected)}</strong><span>${esc(loss)}</span>`;
    if (host.innerHTML !== content) host.innerHTML = content;
  }

  function dialog(id, title, body) {
    const node = document.createElement('dialog'); node.id = id; node.className = 'multiway-dialog';
    node.innerHTML = `<div class="multiway-dialog-head"><h2>${title}</h2><button type="button" class="text-button" data-mw-close aria-label="Close">×</button></div>${body}<p class="multiway-error" data-mw-error role="alert" hidden></p>`;
    document.body.append(node); node.querySelector('[data-mw-close]').onclick = () => node.close();
    return node;
  }
  function setError(message = '') {
    view.error = String(message || '');
    if (!initialized) return;
    for (const node of document.querySelectorAll('#multiway-error,[data-mw-error],#multiway-setup-error,#mw-quick-error')) {
      node.textContent = view.error; node.hidden = !view.error;
    }
  }
  function setBusy(value) { view.busy = Boolean(value); if (initialized) refresh(); }
  async function invoke(name, payload) {
    if (busy()) return false;
    if (typeof options.handlers?.[name] !== 'function') { setError('This control is not available yet.'); return false; }
    localBusy = true; setError(''); refresh();
    try { await options.handlers[name](payload); return true; }
    catch (error) { setError(error?.message || 'Could not record the action. Check the data and try again.'); return false; }
    finally { localBusy = false; refresh(); options.onSettled?.(); }
  }
  function currentVariant() { const source = view.config || context(); return source.variant || `PLO${$('#variant-select')?.value || 5}_HIGH`; }
  function fillPositions(preferred) {
    const count = Number($('#mw-player-count').value), values = POSITIONS[count] || POSITIONS[5];
    const previous = preferred === undefined ? $('#mw-hero-position').value : preferred;
    $('#mw-hero-position').innerHTML = `${setupPurpose === 'next' ? '<option value="">Rotate automatically</option>' : ''}${values.map(position => `<option value="${position}">${count === 2 && position === 'SB' ? 'BTN / SB' : position}</option>`).join('')}`;
    $('#mw-hero-position').value = setupPurpose === 'next' && !previous ? '' : values.includes(previous) ? previous : count === 2 && previous === 'BTN' ? 'SB' : values.includes('BTN') ? 'BTN' : values[0];
  }
  function renderAssignments() {
    const panel = $('#mw-assignments'), list = $('#mw-assignment-grid');
    panel.hidden = setupPurpose === 'next';
    if (panel.hidden) return;
    const count = Number($('#mw-player-count').value);
    const saved = new Map([...list.querySelectorAll('[data-mw-assign]')].map(node => [Number(node.dataset.mwAssign),node.value]));
    const known = window.theibsPlayersUI?.list?.() || [];
    const hero = POSITIONS[count].indexOf($('#mw-hero-position').value);
    list.innerHTML = Array.from({length:count-1},(_,index) => {
      const seat = index+1;
      return `<label>A${seat} · ${esc(POSITIONS[count][(hero+seat)%count])}<select data-mw-assign="${seat}"><option value="">New unknown player</option>${known.map(item=>`<option value="${esc(item.playerId)}">${esc(item.nickname)} · ${esc(item.playerId.slice(-6))}</option>`).join('')}</select><small data-mw-player-evidence="${seat}"></small></label>`;
    }).join('');
    for (const node of list.querySelectorAll('[data-mw-assign]')) node.value = saved.get(Number(node.dataset.mwAssign)) || '';
    const current = window.TheibsPlayerDecisionReview?.currentRoster(view.config, view.state?.heroId, known, count);
    $('#mw-keep-players').hidden = setupPurpose !== 'new-game' || !view.enabled;
    $('#mw-keep-players').disabled = !current;
    updateAssignmentEvidence(known);
  }
  function updateAssignmentEvidence(players = window.theibsPlayersUI?.list?.() || []) {
    const known = new Map(players.map(item => [item.playerId,item]));
    for (const node of $('#mw-assignment-grid').querySelectorAll('[data-mw-assign]')) {
      const item = known.get(node.value), evidence = $(`[data-mw-player-evidence="${node.dataset.mwAssign}"]`);
      evidence.textContent = item ? `${item.observations} recorded ${item.observations === 1 ? 'action' : 'actions'} · ${item.handCount} ${item.handCount === 1 ? 'hand' : 'hands'}` : 'Separate profile · no recorded actions';
    }
  }
  function fillSetup(force = false) {
    if (!initialized || setupDirty && !force) return;
    const source = { ...context(), ...(view.config || {}), ...(setupPurpose === 'next' ? nextSetupDraft || {} : {}) }, variant = currentVariant();
    const count = Number(variant.match(/PLO([456])/i)?.[1] || 5), max = count === 6 ? 5 : count === 5 ? 6 : 10;
    $('#mw-player-count').innerHTML = Array.from({ length: max - 1 }, (_, index) => `<option value="${index + 2}">${index + 2} players</option>`).join('');
    $('#mw-player-count').value = Math.min(max, Math.max(2, Number(source.playerCount || source.players || (count === 6 ? 5 : 6))));
    $('#mw-player-count').disabled = setupPurpose === 'next';
    fillPositions(setupPurpose === 'next' ? nextSetupDraft?.heroPosition || '' : source.heroPosition || source.position || 'BTN');
    $('#mw-hero-position').required = setupPurpose !== 'next';
    $('#mw-small-blind').value = source.smallBlind ?? .5; $('#mw-big-blind').value = source.bigBlind ?? 1;
    $('#mw-starting-stack').value = source.startingStack ?? source.effectiveStack ?? 100;
    $('#mw-starting-stack').closest('label').hidden = setupPurpose === 'next';
    $('#mw-starting-stack').disabled = setupPurpose === 'next';
    const savedRake = setupPurpose === 'next' && nextRakeChoice || rakeChoice;
    $('#mw-rake-mode').value = savedRake.mode;
    $('#mw-rake-fixed').value = savedRake.amount ?? '';
    $('#mw-rake-fixed').closest('label').hidden = savedRake.mode !== 'FIXED';
    renderAssignments();
    $('#mw-start-note').textContent = setupPurpose === 'next'
      ? 'Changes apply when you start the next hand. This hand and its action log stay as they are.'
      : 'Blinds and stacks start the table. Cards can be entered after actions begin.';
    setupDirty = false;
  }
  function getDraft() {
    const source = context();
    const playerCount = Number($('#mw-player-count').value), position = $('#mw-hero-position').value;
    let players;
    if (setupPurpose !== 'next') {
      const heroId = POSITIONS[playerCount].indexOf(position);
      if (heroId < 0) throw Error('Choose a valid Hero position.');
      players = Array.from({length:playerCount},()=>null);
      const registry = window.theibsPlayersUI;
      players[heroId] = { playerId: registry?.ready?.() ? registry.heroId() : 'hero_' + crypto.randomUUID(), name:'You' };
      const used = new Set([players[heroId].playerId]);
      for (let seat=1;seat<playerCount;seat++) {
        const id = (heroId+seat)%playerCount;
        const selected = $(`[data-mw-assign="${seat}"]`)?.value || '';
        if (selected && used.has(selected)) throw Error('Choose a different player identity for each seat.');
        const known = selected && registry?.byId?.(selected);
        if (selected && !known) throw Error(`A${seat}: this saved player is no longer available.`);
        const playerId = known?.playerId || registry?.freshId?.() || crypto.randomUUID();
        used.add(playerId); players[id] = {playerId,name:known?.nickname || `A${seat}`};
      }
    }
    return { variant: currentVariant(), playerCount,
      ...($('#mw-hero-position').value ? { heroPosition: $('#mw-hero-position').value } : {}),
      smallBlind: parseAmount($('#mw-small-blind').value), bigBlind: parseAmount($('#mw-big-blind').value), startingStack: parseAmount($('#mw-starting-stack').value),
      ...(players ? {players} : {}),
      ...(['next','new-game'].includes(setupPurpose) ? { heroCards: [] } : Array.isArray(source.heroCards) ? { heroCards: source.heroCards.slice() } : {}) };
  }
  function openSetup({ forNextHand = view.enabled, newGame = false } = {}) {
    if (!initialized) return;
    if (seatDialog?.open) seatDialog.close();
    setupPurpose = newGame ? 'new-game' : forNextHand ? 'next' : 'activate';
    if (newGame) for (const node of $('#mw-assignment-grid').querySelectorAll('[data-mw-assign]')) node.value = '';
    setupDirty = false; fillSetup(true);
    $('#mw-assignments').open = setupPurpose !== 'next';
    $('#mw-setup-dialog .multiway-dialog-head h2').textContent = newGame ? 'New game' : forNextHand ? 'Next hand setup' : 'Set up Multiway';
    $('#mw-start').textContent = newGame ? 'Start new game' : forNextHand ? 'Save for next hand' : 'Start Multiway';
    const settings = $('#settings-dialog'); if (settings?.open) settings.close();
    if (!setupDialog.open) setupDialog.showModal();
    (forNextHand ? $('#mw-hero-position') : $('#mw-player-count')).focus({ preventScroll: true });
  }
  const completed = () => view.enabled && ['SHOWDOWN', 'FINISHED'].includes(view.state?.phase);
  const pendingResult = () => view.state?.phase === 'SHOWDOWN' || view.state?.result?.reason === 'UNKNOWN';
  function completionContents() {
    const state = view.state, pending = pendingResult();
    const rows = state.players.map(item => `<label class="mw-stack-row"><span>${esc(playerName(item))} <small>${esc(item.position)}</small></span><input data-mw-ending-stack="${item.id}" type="text" inputmode="decimal" autocomplete="off" aria-label="${esc(playerName(item))} ending stack" value="${pending ? '' : esc(item.stack)}" placeholder="Confirm stack"></label>`).join('');
    const pots = (state.pots || []).map((pot, index) => `<fieldset class="mw-result-pot"><legend>${index ? `Side pot ${index}` : 'Main pot'} · ${money(pot.amount)} chips</legend>${pot.eligible.map(id => `<label><input type="checkbox" data-mw-pot="${index}" value="${id}"><kbd>${esc(window.TheibsMultiwayResultKeys.keyForPlayer(player(id),state))}</kbd><span>${esc(playerName(player(id)))} · ${esc(player(id)?.position)}</span></label>`).join('')}</fieldset>`).join('');
    const awards = (state.result?.awards || []).map(item => `${playerName(player(item.player))} +${money(item.amount)}`).join(' · ');
    const note = pending ? '1–9: A1–A9 · 0: You · Enter: next hand. Leave unselected to continue incomplete.' : awards ? `Awarded · ${awards}` : 'Result recorded.';
    $('#mw-completion-content').innerHTML = `<p class="mw-result-summary">${esc(note)}</p>${pending ? `<form id="mw-result-form">${pots}<details><summary>Rake · optional</summary><label>Actual rake · chips<input id="mw-result-rake" type="text" inputmode="decimal" autocomplete="off" value="0"></label></details></form>` : ''}<div class="mw-result-actions"><button id="mw-result-shown" type="button" class="ghost-button">Shown cards · V</button><button id="mw-result-undo" type="button" class="text-button">Undo last action</button></div><details id="mw-ending-stacks"><summary>Update ending stacks · optional</summary><div class="mw-ending-stack-grid">${rows}</div></details><button id="mw-next-hand" type="button" class="primary-button">${pending ? 'Continue incomplete' : 'Save & next hand'} · Enter</button>`;
    $('#mw-result-shown').onclick = () => openReveal();
    const resultForm = $('#mw-result-form');
    if (resultForm) {
      if(resultDraft?.handId===state.handId){
        for(const node of resultForm.querySelectorAll('[data-mw-pot]'))node.checked=!!resultDraft.winners[Number(node.dataset.mwPot)]?.includes(Number(node.value));
        $('#mw-result-rake').value=resultDraft.rake;
      }
      resultForm.onsubmit = event => { event.preventDefault(); void finishCompletion(); };
      resultForm.onchange = () => { $('#mw-next-hand').textContent = resultForm.querySelector(':checked') ? 'Save & next hand · Enter' : 'Continue incomplete · Enter'; };
      resultForm.onchange();
    }
    $('#mw-result-undo').onclick = async () => { completionTransition=true; try { if(await invoke('undo')) {completionDialog.close(); completionSeenHand=null;} } finally {completionTransition=false;} };
    const next = $('#mw-next-hand');
    if (next) next.onclick = () => void finishCompletion();
  }
  async function finishCompletion() {
    if (busy() || completionTransition) return false;
    completionTransition=true;
    try {
      if (completionToken !== activeToken()) throw Error('The hand changed. Open its result again.');
      const stacks=getEndingStacks();
      const form=$('#mw-result-form');
      if (pendingResult() && form?.querySelector(':checked')) {
        const winners=(view.state.pots||[]).map((_,index)=>[...form.querySelectorAll(`[data-mw-pot="${index}"]:checked`)].map(node=>Number(node.value)));
        if(winners.some(ids=>!ids.length)) throw Error('Select the winners of each pot, or clear the selection to continue incomplete.');
        const rake=parseAmount($('#mw-result-rake').value);
        if(rake===null || rake>view.state.pot) throw Error('Rake must be between zero and the pot.');
        if(!await invoke('settle',{winners,rake}))return false;
        completionToken=activeToken();
      }
      if(await invoke('nextHand',stacks?{stacks}:{})){completionDialog.close();return true;}
      return false;
    } catch(error) {setError(error.message);return false;}
    finally {completionTransition=false;}
  }
  function getEndingStacks() {
    if (!completionDialog?.open || completionToken !== activeToken()) throw Error('Open the current result before confirming stacks.');
    const inputs = [...completionDialog.querySelectorAll('[data-mw-ending-stack]')];
    if (inputs.every(input => !input.value.trim())) return undefined;
    const values = inputs.map(input => parseAmount(input.value));
    if (values.length !== view.state.players.length || values.some(value => value === null || value < 0)) throw Error('Confirm a non-negative ending stack for every player.');
    return pendingResult() || values.some((value, index) => value !== view.state.players[index].stack) ? values : undefined;
  }
  function openCompletion() {
    if (!initialized || !completed() || busy()) return false;
    for (const node of [seatDialog, revealDialog]) if (node?.open) node.close();
    completionToken = activeToken(); completionSeenHand=view.state.handId; setError(''); completionContents();
    if (!completionDialog.open) completionDialog.showModal();
    (completionDialog.querySelector('[data-mw-pot]') || $('#mw-next-hand')).focus({preventScroll:true});
    return true;
  }
  function parsedShown() { return window.TheibsCards.parsePortugueseCards($('#mw-reveal-cards').value).map(window.TheibsCards.toCanonical); }
  function validateShown(cards, target) {
    const count = Number(currentVariant().match(/PLO([456])/i)?.[1] || 5);
    if (!Array.isArray(cards) || cards.length > count || cards.some(card => !/^[2-9TJQKA][shdc]$/.test(card))) throw Error(`Enter up to ${count} complete cards.`);
    const hero = view.config?.heroCards || context().heroCards || [];
    if (target.hero && hero.length && cards.some(card => !hero.includes(card))) throw Error('Shown cards do not match your recorded hand.');
    const known = [...(view.state.board || []), ...(target.hero ? [] : [...new Set([...hero, ...(view.state.players.find(item => item.hero)?.shownCards || [])])]), ...view.state.players.filter(item => item.id !== target.id && !item.hero).flatMap(item => item.shownCards || []), ...cards];
    if (new Set(known).size !== known.length) throw Error('A shown card is already used by the board or another player.');
    return cards;
  }
  function selectShownPlayer(id) {
    const item = player(Number(id)); if (!item) return;
    revealDraft = { actor: item.id, stateToken: activeToken(), seen: new Set() };
    $('#mw-reveal-player').value = String(item.id);
    $('#mw-reveal-cards').value = (item.shownCards || []).map(window.TheibsCards.fromCanonical).join(' ');
    setError('');
  }
  function rememberResultDraft(){
    const form=$('#mw-result-form');
    if(form)resultDraft={handId:view.state.handId,rake:$('#mw-result-rake').value,winners:(view.state.pots||[]).map((_,index)=>[...form.querySelectorAll(`[data-mw-pot="${index}"]:checked`)].map(node=>Number(node.value)))};
  }
  function openReveal(id) {
    if (!initialized || !completed() || busy()) return false;
    if(completionDialog?.open){
      rememberResultDraft();
    }
    for (const node of [seatDialog, completionDialog]) if (node?.open) node.close();
    $('#mw-reveal-player').innerHTML = view.state.players.map(item => `<option value="${item.id}">${esc(playerName(item))} · ${esc(item.position)}</option>`).join('');
    selectShownPlayer(id ?? view.state.players.find(item => !item.hero)?.id ?? view.state.heroId);
    if (!revealDialog.open) revealDialog.showModal();
    $('#mw-reveal-cards').focus({ preventScroll: true }); return true;
  }
  function refreshCompletion() {
    const ready = completed();
    $('#mw-completion-actions').hidden = !ready;
    $('#mw-completion-open').textContent = 'Result · optional';
    for (const button of document.querySelectorAll('#mw-completion-actions button')) button.disabled = busy();
    if (completionDialog?.open && completionToken !== activeToken() && !completionTransition) completionDialog.close();
    if (completionDialog?.open) for (const field of completionDialog.querySelectorAll('#mw-completion-content button,input')) field.disabled = busy();
    if (revealDialog?.open && revealDraft?.stateToken !== activeToken()) revealDialog.close();
    if (revealDialog?.open) {
      $('#mw-reveal-save').disabled = busy();
      $('#mw-reveal-player').disabled = busy(); $('#mw-reveal-cards').disabled = busy();
      const voice = window.theibsCardVoice?.getStatus?.();
      $('#mw-reveal-voice').textContent = voice?.enabled ? voice.audioReady ? 'Voice · listening' : 'Voice on · waiting' : 'Voice off';
      $('#mw-reveal-voice').setAttribute('aria-pressed', String(Boolean(voice?.enabled)));
    }
    if(ready && inAnalysis() && !busy() && !completionTransition && completionSeenHand!==view.state.handId && !document.querySelector('dialog[open]')) {
      const handId=view.state.handId;
      queueMicrotask(()=>{if(completed() && view.state.handId===handId && !busy() && !document.querySelector('dialog[open]'))openCompletion();});
    }
  }
  function openRecoveryEditor(kind, id) {
    if(!view.enabled || busy())return false;
    const item=player(Number(id ?? window.theibsKeyboard?.getState().selectedPlayerId ?? view.state.actor ?? view.state.heroId));
    if(!item)return false;
    if(recoveryDialog?.open)recoveryDialog.close();
    recoveryDialog?.remove();
    const isStack=kind==='stack', token=activeToken();
    recoveryDialog=dialog('mw-recovery-dialog',isStack?`${playerName(item)} · current stack`:'Correct button',
      `<form id="mw-recovery-form">${isStack?`<label>Available chips<input id="mw-recovery-value" inputmode="decimal" value="${esc(item.stack)}" required></label>`:`<label>Button<select id="mw-recovery-value">${view.state.players.map(p=>`<option value="${p.id}"${p.position==='BTN'||view.state.players.length===2&&p.position==='SB'?' selected':''}>${esc(playerName(p))} · ${esc(p.position)}</option>`).join('')}</select></label>`}<p class="micro">${isStack?'Recorded contributions stay in the hand history.':'Positions and recorded actions will be checked. The previous version is kept.'}</p><button class="primary-button" type="submit">Save correction</button></form>`);
    recoveryDialog.dataset.keyboardContext=kind;
    $('#mw-recovery-form').onsubmit=async event=>{
      event.preventDefault();if(busy())return;
      if(token!==activeToken()){setError('The hand changed. Reopen the correction.');return;}
      const value=parseAmount($('#mw-recovery-value').value);
      if(value===null){setError('Enter a valid non-negative amount.');return;}
      if(await invoke(isStack?'adjustStack':'correctButton',isStack?{actor:item.id,stack:value}:{buttonId:value}))recoveryDialog.close();
    };
    recoveryDialog.showModal();const field=$('#mw-recovery-value');field.focus({preventScroll:true});if(isStack)field.select();return true;
  }
  const openStackEditor=id=>openRecoveryEditor('stack',id);
  const openButtonCorrection=()=>openRecoveryEditor('button');
  function refreshControls() {
    controlsHost.hidden = !view.enabled;
    controlsHost.dataset.phase = view.state?.phase || '';
    document.body.dataset.multiway = view.enabled ? 'on' : 'off';
    const state = view.state, current = actor(), isHero = current?.id === state?.heroId;
    const heading = !state ? 'Preparing table' : state.phase === 'BETTING' ? `${isHero ? 'Your turn' : playerName(current) + "'s turn"} · ${current?.position || ''}`
      : state.phase === 'WAIT_BOARD' ? `Enter ${STREETS[state.nextStreet] || 'next street'} on the table` : state.phase === 'SHOWDOWN' ? 'Showdown · betting complete' : 'Hand complete';
    document.body.dataset.multiwayPhase = state?.phase || '';
    document.body.dataset.multiwayHeroTurn = String(Boolean(view.enabled && isHero && state?.phase === 'BETTING'));
    document.body.dataset.multiwayCardsReady = String(view.heroDraftReady !== false);
    $('#mw-actor').classList.toggle('is-board-phase', state?.phase === 'WAIT_BOARD');
    $('#mw-actor').textContent = heading; $('#mw-actor').classList.toggle('is-hero-turn', Boolean(isHero && state?.phase === 'BETTING'));
    const amountToCall = state?.phase === 'BETTING' ? Number(state.legal?.toCall) : 0;
    $('.mw-call-amount').hidden = !Number.isFinite(amountToCall) || amountToCall <= 0;
    $('#mw-to-call').textContent = amountToCall > 0 ? money(amountToCall) : '';
    $('#mw-action-stage').hidden = state?.phase !== 'BETTING';
    for (const command of COMMANDS) {
      const button = $(`[data-mw-command="${command.id}"]`), actionCode = resolveCommand(command);
      button.disabled = !actionCode; button.dataset.mwAction = actionCode || '';
      button.hidden=false; button.dataset.keyboardCommand=command.id==='leave'?'FOLD':command.id==='call'?'MATCH':'AGGRESSIVE';
      const fallback = command.id === 'call' ? 'Call' : command.id === 'aggressive' ? 'Bet / Raise' : 'Check / Fold';
      button.querySelector('span').textContent = actionCode ? ACTIONS[actionCode].label + (actionCode === 'CALL' ? ' ' + money(state.legal.toCall) : '') : fallback;
      button.title = `${actionCode ? ACTIONS[actionCode].label : fallback} · ${command.key === ',' ? 'COMMA' : command.key === '.' ? 'PERIOD' : 'SEMICOLON'}`;
    }
    const boardPrompt = $('#mw-board-prompt');
    boardPrompt.hidden = state?.phase !== 'WAIT_BOARD';
    boardPrompt.textContent = state?.phase === 'WAIT_BOARD'
      ? `${STREETS[state.nextStreet] || 'Next street'} · select the empty board cards, then enter ${state.nextStreet === 'FLOP' ? 'all 3 flop cards' : 'the turn/river card'} with voice or Cards.` : '';
    $('#mw-undo').disabled = busy() || !state || !(view.canUndo ?? (state.log || []).some(event => !['SB', 'BB'].includes(event.action)));
    $('#mw-setup-status').textContent = view.enabled ? 'On' : 'Off';
    $('#mw-setup-summary').textContent = view.enabled && state
      ? `${currentVariant().replace('_HIGH','')} · ${state.players.length} players${nextSetupDraft ? ' · next hand configured' : ''}`
      : 'Configure players, position, blinds and stacks';
    $('#mw-exit').hidden = !view.enabled; $('#mw-exit').disabled = busy();
    $('#mw-start').disabled = busy();
    $('#mw-setup-open').disabled = busy();
    $('#mw-toggle').textContent=view.enabled?'Multiway on · Turn off':'Turn on Multiway';
    $('#mw-toggle').setAttribute('aria-pressed',String(view.enabled));
    $('#mw-toggle').disabled=busy();
    controlsHost.setAttribute('aria-busy', String(busy()));
    const potDetail = $('#table-pot-detail');
    potDetail.hidden = !view.enabled || !state || !state.hasSidePots;
    potDetail.textContent = state?.hasSidePots ? `${state.pots.length - 1} side pot${state.pots.length === 2 ? '' : 's'} · main ${money(state.pots[0]?.amount)}` : '';
    const heroSeat = $('#mw-hero-seat'), hero = state?.players?.find(item => item.hero);
    if (heroSeat) {
      const stackLabel = heroSeat.querySelector('.hero-stack-line');
      if (stackLabel?.firstChild?.nodeType === 3) stackLabel.firstChild.textContent = hero?.stackEstimated ? 'Est. stack ' : 'Stack ';
      if (view.enabled && hero) heroSeat.dataset.multiwayPlayer = String(hero.id);
      else delete heroSeat.dataset.multiwayPlayer;
      heroSeat.disabled = !view.enabled || busy();
      heroSeat.classList.toggle('mw-actor-seat', Boolean(view.enabled && hero && state.actor === hero.id));
      heroSeat.classList.toggle('mw-folded-seat', Boolean(view.enabled && hero?.folded));
      heroSeat.classList.toggle('mw-allin-seat', Boolean(view.enabled && hero?.allIn));
      heroSeat.setAttribute('aria-label', hero ? `You, ${hero.position}, ${hero.stackEstimated ? "estimated stack" : "stack"} ${money(hero.stack)}, ${money(hero.streetPaid)} committed this street. View seat.` : 'Your seat');
    }
    const heroPaid = $('#hero-street-paid');
    if (heroPaid) { heroPaid.hidden = !view.enabled || !hero; heroPaid.textContent = hero ? `In ${money(hero.streetPaid)} this street` : ''; }
    const logs = (state?.log || []).slice(-6);
    $('#mw-history-list').innerHTML = logs.map(event => {
      const name = Number.isInteger(event.actor) ? `${playerName(player(event.actor))} · ${player(event.actor)?.position || ''}` : STREETS[event.street] || '';
      const action = ACTIONS[event.action]?.past || ({ SB: 'small blind', BB: 'big blind', BOARD: 'board dealt', MARK_FOLD: 'observed fold', RETURN: 'returned', SHOWDOWN: 'showdown' })[event.action] || event.action;
      return `<li><span>${esc(name)}</span><span>${esc(action)}${Number.isFinite(event.amount) && event.amount > 0 ? ' ' + money(event.amount) : ''}</span></li>`;
    }).join('');
    $('#mw-history').hidden = !logs.length;
    for (const node of document.querySelectorAll('[data-multiway-player]')) {
      const item = player(Number(node.dataset.multiwayPlayer)); if (!item) continue;
      node.classList.toggle('mw-actor-seat', view.enabled && state.actor === item.id);
      node.classList.toggle('mw-folded-seat', view.enabled && item.folded);
      node.classList.toggle('mw-allin-seat', view.enabled && (item.allIn || item.stack === 0));
      node.classList.toggle('mw-checked-seat', view.enabled && !item.folded && !item.allIn && item.lastAction === 'CHECK');
      if (view.enabled) node.setAttribute('aria-label', `${playerName(item)}, ${item.position}, ${item.stackEstimated ? "estimated stack" : "stack"} ${money(item.stack)}, ${money(item.streetPaid)} committed this street, ${item.folded ? 'folded' : item.allIn || item.stack === 0 ? 'all-in' : state.actor === item.id ? 'to act' : item.lastAction === 'CHECK' ? 'checked' : 'in hand'}. View seat.`);
    }
    $('#mw-size-confirm').disabled = busy();
    refreshDecisionEV();
    refreshDecisionFeedback();
    refreshCompletion();
    document.dispatchEvent(new CustomEvent('theibs:multiway-render'));
    if (boardDialog.open) $('#mw-board-confirm').disabled = busy();
    if (seatDialog.open) refreshSeat();
  }
  function refresh() { if (!initialized) return; refreshControls(); setError(view.error); }
  function render(next = {}) {
    if (next.state && next.state.revisionKey !== view.state?.revisionKey) { clearTimeout(sizeEvaluationTimer); sizeEvaluationTimer = null; lastEvaluationSize = null; }
    view = { ...view, ...next };
    if (!initialized) return;
    if (!view.enabled) { cancelPendingAmount(); for (const node of [boardDialog, seatDialog, completionDialog, revealDialog, rakeDialog]) if (node?.open) node.close(); nextSetupDraft = null; nextRakeChoice = null; }
    if (sizeDraft && sizeDraft.token !== activeToken()) cancelPendingAmount();
    if (boardDialog.open && boardDraft?.token !== activeToken()) boardDialog.close();
    if (!setupDialog.open) fillSetup();
    refresh();
  }
  const parseAmount = raw => /^\d+(?:[.,]\d{1,2})?$/.test(String(raw).trim()) ? Number(String(raw).trim().replace(',', '.')) : null;
  function getEvaluationSize() {
    if (!sizeDraft || sizeDraft.token !== activeToken() || !actor()?.hero || view.state?.phase !== 'BETTING') return null;
    const amount = parseAmount($('#mw-size')?.value ?? '');
    return amount !== null && amount >= view.state.legal.minTo - 1e-9 && amount <= view.state.legal.maxTo + 1e-9 ? amount : null;
  }
  function scheduleSizeEvaluation() {
    clearTimeout(sizeEvaluationTimer);
    const amount = getEvaluationSize();
    if (amount === lastEvaluationSize) return;
    const token = activeToken();
    sizeEvaluationTimer = setTimeout(() => {
      sizeEvaluationTimer = null;
      if (activeToken() !== token || getEvaluationSize() !== amount || busy()) return;
      lastEvaluationSize = amount; options.handlers?.evaluationChanged?.();
    }, 180);
  }
  function sizeHelp() {
    if (!sizeDraft) return;
    const raw = $('#mw-size').value.trim(), value = parseAmount(raw), paid = view.state?.legal?.totalThisStreet ?? actor()?.streetPaid ?? 0;
    const cost = value - paid;
    $('#mw-size-cost').textContent = value !== null && cost >= 0
      ? `${playerName(actor())} adds ${money(cost)} ${cost === 1 ? 'chip' : 'chips'} now. Total this street: ${money(value)}.`
      : 'Enter the total committed this street.';
    scheduleSizeEvaluation();
  }
  function cancelPendingAmount() {
    if (!initialized) return false;
    const hadDraft = Boolean(sizeDraft);
    sizeDraft = null;
    $('#mw-inline-size').hidden = true;
    $('#mw-actions').hidden = false;
    controlsHost.classList.remove('mw-sizing');
    $('#mw-size').value = '';
    $('#mw-size-limits').textContent = '';
    $('#mw-size-cost').textContent = '';
    if (hadDraft) scheduleSizeEvaluation();
    return hadDraft;
  }
  function openPendingAmount({ action: actionCode, expectedToken, originEventId } = {}) {
    if (!inAnalysis() || expectedToken && voiceContext().token !== expectedToken) return false;
    actionCode ||= resolveCommand(COMMANDS.find(item => item.id === 'aggressive'));
    if (!['BET', 'RAISE'].includes(actionCode) || !legal(actionCode)) return false;
    const state = view.state, current = actor();
    if (!current || !Number.isFinite(state.legal.minTo) || !Number.isFinite(state.legal.maxTo)) return false;
    sizeDraft = { action: actionCode, actor: state.actor, token: activeToken(), originEventId };
    $('#mw-size-label').textContent = `${ACTIONS[actionCode].label} to total`;
    $('#mw-size').value = String(state.legal.minTo);
    $('#mw-size-limits').textContent = `This street · min ${money(state.legal.minTo)} · max ${money(state.legal.maxTo)}`;
    const allInTo = Math.round((current.streetPaid + current.stack) * 100) / 100;
    const potButton = $('#mw-pot-size'), allInButton = $('#mw-allin-size');
    potButton.hidden = !(state.legal.maxTo >= state.legal.minTo && state.legal.maxTo < allInTo - 0.001);
    allInButton.hidden = !(allInTo >= state.legal.minTo - 0.001 && allInTo <= state.legal.maxTo + 0.001);
    $('#mw-actions').hidden = true;
    $('#mw-inline-size').hidden = false;
    controlsHost.classList.add('mw-sizing');
    sizeHelp(); setError('');
    $('#mw-size').focus({ preventScroll: true });
    $('#mw-size').select();
    return { pending: true, action: actionCode };
  }
  async function submitPendingAmount({ to, expectedToken, originEventId } = {}) {
    if (!sizeDraft || busy() || !inAnalysis() || sizeDraft.token !== activeToken() || expectedToken && voiceContext().token !== expectedToken) {
      setError('The turn changed. Choose the action again.'); cancelPendingAmount(); return false;
    }
    if (to !== undefined) $('#mw-size').value = String(to);
    const input = $('#mw-size'), amount = parseAmount(input.value);
    if (amount === null) {
      setError('Enter a legal total with at most two decimal places.'); input.focus(); return false;
    }
    if (amount < view.state.legal.minTo - 1e-9 || amount > view.state.legal.maxTo + 1e-9) {
      setError(`Use a total between ${money(view.state.legal.minTo)} and ${money(view.state.legal.maxTo)} chips this street.`);
      input.focus(); return false;
    }
    const draft = sizeDraft;
    const finalEventId = originEventId || draft.originEventId;
    const confirmed = await invoke('act', { actor: draft.actor, action: draft.action, to: amount,
      ...(finalEventId ? { originEventId: finalEventId } : {}) });
    if (confirmed) cancelPendingAmount();
    return confirmed;
  }
  async function action(actionCode) {
    if (!inAnalysis() || !legal(actionCode)) return;
    window.theibsCardKeyboard?.cancelPending?.();
    const activeButton = document.querySelector(`[data-mw-action="${actionCode}"]`);
    if (activeButton) {
      activeButton.classList.add('is-key-active');
      setTimeout(() => activeButton.classList.remove('is-key-active'), 90);
    }
    if (actionCode === 'BET' || actionCode === 'RAISE') {
      return openPendingAmount({ action: actionCode });
    }
    return invoke('act', { actor: view.state.actor, action: actionCode });
  }
  function openBoard() {
    if (!view.enabled || busy() || view.state?.phase !== 'WAIT_BOARD') return;
    const state = view.state; boardDraft = { token: activeToken(), previous: [...state.board], nextStreet: state.nextStreet };
    const needed = state.nextStreet === 'FLOP' ? 3 : 1;
    $('#mw-board-title').textContent = `Enter ${STREETS[state.nextStreet]}`;
    $('#mw-board-label').textContent = needed === 3 ? 'Three flop cards' : 'New card';
    $('#mw-board-new').value = ''; $('#mw-board-new').placeholder = needed === 3 ? '2E 3C 4O' : '10P';
    $('#mw-board-existing').textContent = state.board.length ? 'Already on the board: ' + state.board.map(window.TheibsCards.fromCanonical).join(' ') : 'The betting round is complete.';
    setError(''); $('#mw-board-confirm').disabled = false; boardDialog.showModal(); $('#mw-board-new').focus();
  }
  function refreshSeat() {
    const item = player(selectedPlayer); if (!item) { seatDialog.close(); return; }
    $('#mw-seat-title').textContent = `${playerName(item)} · ${item.position}`;
    $('#mw-seat-info').textContent = `${item.folded ? 'Folded' : item.allIn || item.stack === 0 ? 'All-in' : 'In hand'} · ${item.stackEstimated ? "estimated stack" : "stack"} ${money(item.stack)} · committed ${money(item.streetPaid)} this street`;
    const turnFold = item.id === view.state.actor && view.state.legal?.actions?.includes('FOLD');
    $('#mw-seat-fold').disabled = busy() || !turnFold;
    $('#mw-seat-fold').textContent = turnFold ? "Record fold · it is this player's turn" : "Wait for this player's turn";
    $('#mw-seat-note').textContent = item.hero ? 'Your poker position is set for this hand. Use Multiway settings when starting a new hand to change it.'
      : item.folded ? 'Fold recorded. Undo reverses events in order; a recent fold can be undone here.' : item.allIn || item.stack === 0 ? 'An all-in player remains eligible for the pot.' : !turnFold ? "Wait for this player's turn to record another action." : 'Record only the action observed for the current player.';
    const latest=window.theibsApp?.getState().multiway?.events?.at(-1);
    const undoFold=item.folded&&latest?.actor===item.id&&(latest.type==='MARK_FOLD'||latest.type==='ACT'&&latest.action==='FOLD');
    $('#mw-seat-undo').hidden=!undoFold;
    $('#mw-seat-undo').disabled=busy()||!undoFold;
    $('#mw-seat-edit-details').hidden = Boolean(item.hero);
    const insightButton=$('#mw-seat-insights');
    if(insightButton){insightButton.hidden=Boolean(item.hero) || !item.playerId || !window.theibsPlayersUI?.ready?.();insightButton.disabled=busy();}
    $('#mw-seat-editor').disabled=busy()||item.folded||item.hero;
    $('#mw-seat-remove').disabled=busy()||item.folded||item.hero||!window.theibsOpponentInputs?.seatEditor(item.id).hasOverride;
    $('#mw-seat-rate').closest('label').hidden = true;
    $('#mw-seat-edit-note').textContent=item.folded?'Undo the latest fold to edit this player.':'Optional known cards or a weighted range for this seat.';
  }
  function placeSeatDialog(anchor) {
    if(!anchor)return;
    const rect=anchor.getBoundingClientRect(),width=seatDialog.offsetWidth,height=seatDialog.offsetHeight;
    const left=Math.max(8,Math.min(window.innerWidth-width-8,rect.left+rect.width/2-width/2));
    const top=rect.bottom+10+height<=window.innerHeight-8?rect.bottom+10:Math.max(8,rect.top-height-10);
    seatDialog.style.left=`${left}px`;seatDialog.style.top=`${top}px`;
  }
  function openPlayer(id, anchor = null) {
    if (!view.enabled || !inAnalysis() || busy() || !player(Number(id)) || [...document.querySelectorAll('dialog[open]')].some(node=>node!==seatDialog)) return;
    if(seatDialog.open)seatDialog.close();
    if (player(Number(id)).hero) { openSetup({ forNextHand: true }); return; }
    if (completed()) { openReveal(Number(id)); return; }
    selectedPlayer = Number(id);window.theibsKeyboard?.selectPlayer(selectedPlayer); setError('');
    const editor=player(selectedPlayer).hero ? null : window.theibsOpponentInputs?.seatEditor(selectedPlayer);
    $('#mw-seat-hand').value=editor?.hand||'';
    $('#mw-seat-range').value=editor?.rangeText||'';
    $('#mw-seat-rate').value=editor?.rateText||'';
    $('#mw-seat-edit-error').hidden=true;
    refreshSeat();seatDialog.show();
    placeSeatDialog(anchor||document.querySelector(`[data-multiway-player="${id}"]`));
    const focusTarget=player(selectedPlayer).folded?seatDialog.querySelector('[data-mw-close]'):$('#mw-seat-fold');
    focusTarget.focus({preventScroll:true});
  }
  function init(settings = {}) {
    options = settings;
    if (initialized) { fillSetup(); refresh(); return window.theibsMultiwayUI; }
    setupHost = $(settings.setupSelector || '#multiway-setup'); controlsHost = $(settings.controlsSelector || '#multiway-controls');
    if (!setupHost || !controlsHost) throw Error('Multiway containers are missing.');
    setupHost.innerHTML = `<div class="mw-quick-setup"><div><strong>Multiway <span id="mw-setup-status" class="mw-chip">Off</span></strong><small id="mw-setup-summary">Configure players, position, blinds and stacks</small></div><div class="mw-setup-switches"><button id="mw-setup-open" type="button" class="ghost-button">Setup</button><button id="mw-toggle" type="button" class="ghost-button" aria-pressed="false">Turn on Multiway</button></div></div><button id="mw-exit" type="button" class="text-button" hidden>Return to simple mode</button><p id="mw-quick-error" class="multiway-error" role="alert" hidden></p>`;
    setupDialog = dialog('mw-setup-dialog', 'Set up Multiway', `<div class="mw-setup-fields"><p class="mw-setup-intro" id="mw-start-note"></p><div class="mw-config-grid"><label>Players, including you<select id="mw-player-count" required></select></label><label>Your position<select id="mw-hero-position" required></select></label><label>Small blind<input id="mw-small-blind" type="text" inputmode="decimal" autocomplete="off" required></label><label>Big blind<input id="mw-big-blind" type="text" inputmode="decimal" autocomplete="off" required></label><label>Starting stack per player<input id="mw-starting-stack" type="text" inputmode="decimal" autocomplete="off" required></label></div><details class="mw-assignments"><summary>Advanced calculation options</summary><div class="mw-config-grid"><label>Room fees<select id="mw-rake-mode"><option value="GROSS">Before fees · default</option><option value="NO_RAKE">No room fee</option><option value="FIXED">Fixed room fee in chips</option></select></label><label id="mw-rake-fixed-row" hidden>Fixed room fee · chips<input id="mw-rake-fixed" type="text" inputmode="decimal" autocomplete="off"></label></div></details><details id="mw-assignments" class="mw-assignments"><summary>Assign saved players to seats</summary><div id="mw-assignment-grid"></div></details><div class="mw-setup-actions"><button id="mw-start" type="button" class="primary-button">Start Multiway</button></div><p id="multiway-setup-error" class="multiway-error" role="alert" hidden></p></div>`);
    setupDialog.setAttribute('aria-labelledby', 'mw-setup-title');
    $('#mw-assignments summary').textContent = 'Players & learning';
    $('#mw-assignment-grid').insertAdjacentHTML('beforebegin', '<div class="mw-roster-actions"><button type="button" id="mw-keep-players" class="ghost-button" hidden>Use current players</button><button type="button" id="mw-fresh-players" class="text-button">Use new players</button></div><p class="micro">Saved players keep their recorded history. Unknown players get separate profiles.</p>');
    $('#mw-keep-players').onclick = () => {
      const roster = window.TheibsPlayerDecisionReview.currentRoster(view.config,view.state?.heroId,window.theibsPlayersUI?.list?.() || [],Number($('#mw-player-count').value));
      if (!roster) return;
      for (const node of $('#mw-assignment-grid').querySelectorAll('[data-mw-assign]')) node.value = roster[Number(node.dataset.mwAssign)-1];
      setupDirty = true; updateAssignmentEvidence();
    };
    $('#mw-fresh-players').onclick = () => { for (const node of $('#mw-assignment-grid').querySelectorAll('[data-mw-assign]')) node.value = ''; setupDirty = true; updateAssignmentEvidence(); };
    $('#mw-assignment-grid').addEventListener('change', () => { setupDirty = true; updateAssignmentEvidence(); });
    $('#mw-hero-position').addEventListener('change',renderAssignments);
    setupDialog.querySelector('h2').id = 'mw-setup-title';
    controlsHost.classList.add('multiway-controls'); controlsHost.hidden = true;
    controlsHost.innerHTML = `<div class="mw-control-heading"><div class="mw-turn-context"><strong id="mw-actor"></strong></div><span class="mw-call-amount">To call <b id="mw-to-call"></b></span><button id="mw-undo" type="button" class="text-button" title="Undo the last confirmed event · Ctrl+Z">↶ Undo</button></div><div id="mw-action-stage" class="mw-action-stage"><div id="mw-actions" class="mw-action-row">${COMMANDS.map(item => `<button type="button" data-mw-command="${item.id}" data-mw-action="" disabled title="${item.key === ',' ? 'COMMA' : item.key === '.' ? 'PERIOD' : 'SEMICOLON'}"><kbd>${item.key}</kbd><span>${item.id === 'passive' ? 'Check / Call' : item.id === 'aggressive' ? 'Bet / Raise' : 'Fold'}</span></button>`).join('')}</div><div id="mw-inline-size" class="mw-inline-size" hidden><label for="mw-size" id="mw-size-label">Total this street</label><input id="mw-size" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" required><button id="mw-pot-size" type="button" class="ghost-button">Pot</button><button id="mw-allin-size" type="button" class="ghost-button">All-in</button><button id="mw-size-confirm" type="button" class="primary-button">Confirm</button><button id="mw-size-cancel" type="button" class="text-button" aria-label="Cancel amount entry">×</button></div></div><p class="mw-action-hint" id="mw-size-limits"></p><p class="mw-action-hint" id="mw-size-cost" role="status" aria-live="polite"></p><section id="mw-decision-ev" class="mw-decision-ev" aria-label="Decision EV by legal action" hidden></section><p id="mw-decision-feedback" class="mw-decision-feedback" role="status" hidden></p><p id="mw-board-prompt" class="mw-board-prompt" role="status" aria-live="polite" hidden></p><p id="multiway-error" class="multiway-error" role="alert" hidden></p><details id="mw-history"><summary>Recent actions</summary><ol id="mw-history-list"></ol></details>`;
    $('#mw-history').open = document.body.dataset.analysisSecondary === 'expanded';
    $('#mw-action-stage').insertAdjacentHTML('afterend', '<div id="mw-completion-actions" class="mw-result-actions" hidden><button id="mw-next-direct" type="button" class="primary-button">Next hand</button><button id="mw-completion-open" type="button" class="ghost-button">Result · optional</button><button id="mw-shown-open" type="button" class="ghost-button">Shown cards</button></div>');
    completionDialog = dialog('mw-completion-dialog', 'Hand result', '<div id="mw-completion-content" class="mw-completion-content"></div>');
    window.TheibsMultiwayResultKeys.bind({dialog:completionDialog,getState:()=>view.state,isBusy:()=>busy()||completionTransition,onError:setError,onBack:()=>{rememberResultDraft();completionDialog.close();}});
    revealDialog = dialog('mw-reveal-dialog', 'Shown cards', '<form id="mw-reveal-form"><label>Player<select id="mw-reveal-player"></select></label><label>Cards shown<input id="mw-reveal-cards" type="text" autocomplete="off" spellcheck="false" placeholder="AE KC · partial hands are welcome"></label><p class="mw-card-legend">Only cards you saw. Rank + suit: ♠ E · ♥ C · ♦ O · ♣ P.</p><div class="mw-result-actions"><button id="mw-reveal-voice" type="button" class="ghost-button" aria-pressed="false">Voice off</button><button id="mw-reveal-save" type="submit" class="primary-button">Save shown cards</button></div></form>');
    boardDialog = dialog('multiway-board-dialog', '<span id="mw-board-title">Next street</span>', '<form id="mw-board-form"><p id="mw-board-existing"></p><label><span id="mw-board-label">New cards</span><input id="mw-board-new" autocomplete="off" spellcheck="false" required></label><p class="mw-card-legend">Rank + suit: ♠ E · ♥ C · ♦ O · ♣ P. Ten = D, T or 10.</p><button id="mw-board-confirm" type="submit" class="primary-button">Deal street · Enter</button></form>');
    seatDialog = dialog('multiway-seat-dialog', '<span id="mw-seat-title">Player</span>', '<p id="mw-seat-info"></p><div class="seat-popover-actions"><button id="mw-seat-fold" type="button" class="ghost-button">Record fold</button><button id="mw-seat-undo" type="button" class="text-button" hidden>Undo latest fold</button></div><p id="mw-seat-note"></p><details id="mw-seat-edit-details"><summary>Opponent assumptions</summary><p id="mw-seat-edit-note" class="micro"></p><fieldset id="mw-seat-editor"><label>Known hand<input id="mw-seat-hand" autocomplete="off" placeholder="AE KC QO JP TE"></label><label>Range<textarea id="mw-seat-range" rows="2" placeholder="One hand per line"></textarea></label><label>Call chance (%)<input id="mw-seat-rate" type="number" min="0" max="100" step="0.1" placeholder="Unknown"></label><div class="seat-popover-actions"><button id="mw-seat-apply" type="button" class="primary-button">Apply to seat</button><button id="mw-seat-remove" type="button" class="text-button">Remove assumption</button></div></fieldset><p id="mw-seat-edit-error" class="multiway-error" role="alert" hidden></p></details>');
    const insightButton=document.createElement('button');insightButton.id='mw-seat-insights';insightButton.type='button';insightButton.className='text-button';insightButton.textContent='Player insights';
    seatDialog.querySelector('.seat-popover-actions').append(insightButton);
    insightButton.onclick=()=>{const item=player(selectedPlayer);if(!item || busy() || item.hero)return;seatDialog.close();options.handlers?.playerInsights?.({playerId:item.playerId});};
    seatDialog.classList.add('seat-popover');
    seatDialog.setAttribute('aria-labelledby','mw-seat-title');
    rakeDialog = dialog('mw-rake-dialog', 'Room fees · optional', '<form id="mw-current-rake-form"><label>Calculation basis<select id="mw-current-rake-mode"><option value="GROSS">Before fees · default</option><option value="NO_RAKE">No room fee</option><option value="FIXED">Fixed room fee in chips</option></select></label><label id="mw-current-rake-row" hidden>Fixed room fee · chips<input id="mw-current-rake-amount" type="text" inputmode="decimal" autocomplete="off"></label><p class="micro">Calculation assumption only. Previously recorded decisions and actual chip balances stay unchanged.</p><p id="mw-current-rake-error" class="multiway-error" role="alert" hidden></p><button type="submit" class="primary-button">Apply to current calculation</button></form>');
    let rakeEditorToken = null;
    $('#mw-decision-ev').addEventListener('click', event => {
      if (event.target.closest('[data-mw-profile-compare]')) { void options.handlers?.profileComparison?.(); return; }
      if (!event.target.closest('[data-mw-rake]') || busy()) return;
      rakeEditorToken = activeToken();
      $('#mw-current-rake-mode').value = rakeChoice.mode;
      $('#mw-current-rake-amount').value = rakeChoice.amount ?? '';
      $('#mw-current-rake-row').hidden = rakeChoice.mode !== 'FIXED';
      $('#mw-current-rake-error').hidden = true;
      rakeDialog.showModal();
    });
    $('#mw-current-rake-mode').onchange = event => { $('#mw-current-rake-row').hidden = event.target.value !== 'FIXED'; };
    $('#mw-current-rake-form').onsubmit = event => {
      event.preventDefault();
      try {
        if (busy() || rakeEditorToken !== activeToken()) throw Error('The decision changed. Reopen the rake model for the current hand.');
        const mode = $('#mw-current-rake-mode').value, amount = parseAmount($('#mw-current-rake-amount').value);
        if (mode === 'FIXED' && (amount === null || amount < 0)) throw Error('Enter a fixed rake of zero or more chips.');
        rakeChoice = {mode,...(mode === 'FIXED' ? {amount} : {})};
        rakeDialog.close(); options.handlers?.evaluationChanged?.(); refresh();
      } catch(error) { $('#mw-current-rake-error').textContent=error.message;$('#mw-current-rake-error').hidden=false; }
    };
    controlsHost.querySelector('.mw-control-heading').insertAdjacentHTML('beforeend','<button type="button" class="text-button" id="mw-correct-button" title="Correct button · B">B · Button</button><button type="button" class="text-button" id="mw-correct-stack" title="Selected player stack · N">N · Stack</button>');
    $('#mw-correct-button').onclick=openButtonCorrection;
    $('#mw-correct-stack').onclick=()=>openStackEditor();
    completionDialog.addEventListener('keydown',event=>{
      if(event.isComposing || event.ctrlKey || event.metaKey || event.altKey)return;
      if(event.repeat && ['Enter',' ','v','V'].includes(event.key)){event.preventDefault();return;}
      const target=event.target, textField=target.matches('input:not([type=checkbox]),select,textarea');
      if(!textField && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){
        const fields=[...completionDialog.querySelectorAll('[data-mw-pot]')];
        if(fields.length){event.preventDefault();const index=fields.indexOf(target),step=['ArrowUp','ArrowLeft'].includes(event.key)?-1:1;fields[Math.max(0,Math.min(fields.length-1,index+step))].focus();}return;
      }
      if(!textField && event.key.toLowerCase()==='v'){event.preventDefault();openReveal(target.matches('[data-mw-pot]')?Number(target.value):undefined);return;}
      if(event.key==='Enter'){event.preventDefault();event.stopPropagation();void finishCompletion();}
    });
    initialized = true; fillSetup(true);
    $('#mw-completion-open').onclick = () => openCompletion();
    $('#mw-next-direct').onclick = () => openCompletion();
    $('#mw-shown-open').onclick = () => openReveal();
    $('#mw-reveal-player').onchange = event => selectShownPlayer(event.target.value);
    $('#mw-reveal-voice').onclick = () => { window.theibsCardVoice?.toggle?.(); refreshCompletion(); };
    let revealVoiceTimer = null;
    revealDialog.addEventListener('close', () => { clearInterval(revealVoiceTimer); revealVoiceTimer = null; revealDraft = null; });
    revealDialog.addEventListener('keydown',event=>{
      if(event.key!=='Backspace'||event.repeat||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||busy()||event.target.closest('input,textarea,select,[contenteditable]'))return;
      event.preventDefault();event.stopPropagation();revealDialog.close();openCompletion();
    });
    new MutationObserver(() => {
      if (revealDialog.open && !revealVoiceTimer) revealVoiceTimer = setInterval(() => refreshCompletion(), 250);
      else if (!revealDialog.open && revealVoiceTimer) { clearInterval(revealVoiceTimer); revealVoiceTimer = null; }
    }).observe(revealDialog, { attributes: true, attributeFilter: ['open'] });
    $('#mw-reveal-form').onsubmit = async event => {
      event.preventDefault();
      try {
        if (!revealDraft || revealDraft.stateToken !== activeToken()) throw Error('The hand changed. Open shown cards again.');
        const draft = revealDraft, cards = validateShown(parsedShown(), player(draft.actor));
        if(!cards.length&&!player(draft.actor)?.shownCards?.length){revealDialog.close();openCompletion();return;}
        if (await invoke('reveal', { actor: draft.actor, cards })) { revealDialog.close(); openCompletion(); }
      } catch (error) { setError(error.message); }
    };
    setupDialog.addEventListener('input', () => { setupDirty = true; });
    $('#mw-player-count').addEventListener('change', () => { setupDirty = true; fillPositions(); renderAssignments(); });
    $('#mw-rake-mode').addEventListener('change', () => { $('#mw-rake-fixed-row').hidden = $('#mw-rake-mode').value !== 'FIXED'; });
    $('#mw-start').onclick = async () => {
      try {
        for (const input of setupDialog.querySelectorAll('input[required],select[required]')) if (!input.reportValidity()) return;
        const draft = getDraft();
        if (![draft.smallBlind,draft.bigBlind,draft.startingStack].every(value => value !== null && value > 0)) throw Error('Enter positive chip amounts with at most two decimal places.');
        if (draft.smallBlind >= draft.bigBlind) throw Error('The small blind must be lower than the big blind.');
        const cost = $('#mw-rake-mode').value === 'FIXED'
          ? { mode: 'FIXED', amount: parseAmount($('#mw-rake-fixed').value) }
          : { mode: $('#mw-rake-mode').value };
        if (cost.mode === 'FIXED' && (cost.amount === null || cost.amount < 0)) throw Error('Enter a fixed rake of zero or more chips.');
        if (setupPurpose === 'next') {
          nextSetupDraft = { smallBlind: draft.smallBlind, bigBlind: draft.bigBlind,
            ...(draft.heroPosition ? { heroPosition: draft.heroPosition } : {}) };
          nextRakeChoice = cost; setupDirty = false; setupDialog.close(); refresh();
        } else if (await invoke('start', draft)) { rakeChoice = cost; nextSetupDraft = null; nextRakeChoice = null; setupDirty = false; setupDialog.close(); }
      } catch (error) { setError(error.message); }
    };
    $('#mw-exit').onclick = () => invoke('exit'); $('#mw-undo').onclick = () => undoAction();
    $('#mw-setup-open').onclick = () => openSetup({ forNextHand: view.enabled });
    $('#mw-toggle').onclick=()=>{
      if(busy())return;
      if(view.enabled)void invoke('exit');else openSetup({ forNextHand: false });
    };
    controlsHost.addEventListener('click', event => { const button = event.target.closest('[data-mw-command]'); if (!button || button.disabled) return; if(window.theibsKeyboard) { window.theibsKeyboard.dispatch({type:button.dataset.keyboardCommand}); } else if(button.dataset.mwAction) void action(button.dataset.mwAction); });
    $('#mw-size').addEventListener('input', sizeHelp);
    $('#mw-size-confirm').onclick = () => { void submitPendingAmount(); };
    $('#mw-size').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); void submitPendingAmount(); } });
    $('#mw-size-cancel').onclick = () => { cancelPendingAmount(); $('#mw-actions [data-mw-command=aggressive]').focus({ preventScroll: true }); };
    $('#mw-pot-size').onclick = () => { $('#mw-size').value = String(view.state.legal.maxTo); sizeHelp(); $('#mw-size').focus({ preventScroll: true }); };
    $('#mw-allin-size').onclick = () => { const current = actor(); $('#mw-size').value = String(Math.round((current.streetPaid + current.stack) * 100) / 100); sizeHelp(); $('#mw-size').focus({ preventScroll: true }); };
    $('#mw-board-form').onsubmit = async event => {
      event.preventDefault(); if (!boardDraft || boardDraft.token !== activeToken()) { setError('The street changed. Check the table again.'); return; }
      try {
        const added = window.TheibsCards.parsePortugueseCards($('#mw-board-new').value).map(window.TheibsCards.toCanonical);
        if (added.length !== (boardDraft.nextStreet === 'FLOP' ? 3 : 1)) throw Error(boardDraft.nextStreet === 'FLOP' ? 'Enter exactly three flop cards.' : 'Enter only the new card.');
        const source = context(), visibleHero = source.variant === view.config?.variant && Array.isArray(source.heroCards) ? source.heroCards : view.config?.heroCards || [];
        const cards = [...boardDraft.previous, ...added], known = [...visibleHero, ...cards];
        if (new Set(known).size !== known.length) throw Error('That card is already in the hand or on the board.');
        if (await invoke('board', { cards })) boardDialog.close();
      } catch (error) { setError(error.message); }
    };
    $('#mw-seat-fold').onclick = async () => {
      const item = player(selectedPlayer); if (!item || busy()) return;
      const isTurn = item.id === view.state.actor && view.state.legal?.actions?.includes('FOLD');
      if (!isTurn) return;
      if (await invoke('act', { actor: item.id, action: 'FOLD' })) seatDialog.close();
    };
    $('#mw-seat-undo').onclick=async()=>{const item=player(selectedPlayer),latest=window.theibsApp?.getState().multiway?.events?.at(-1);if(item?.folded&&latest?.actor===item.id&&(latest.type==='MARK_FOLD'||latest.type==='ACT'&&latest.action==='FOLD')&&await invoke('undo'))seatDialog.close();};
    $('#mw-seat-apply').onclick=()=>{
      try{window.theibsOpponentInputs.applySeat(selectedPlayer,{hand:$('#mw-seat-hand').value,rangeText:$('#mw-seat-range').value,rateText:$('#mw-seat-rate').value});$('#mw-seat-edit-error').hidden=true;refreshSeat();}
      catch(error){$('#mw-seat-edit-error').textContent=error.message;$('#mw-seat-edit-error').hidden=false;}
    };
    $('#mw-seat-remove').onclick=()=>{window.theibsOpponentInputs.removeSeat(selectedPlayer);$('#mw-seat-hand').value='';$('#mw-seat-range').value='';$('#mw-seat-rate').value='';refreshSeat();};
    document.addEventListener('click', event => { const seat = event.target.closest?.('[data-multiway-player]'); if (seat) openPlayer(Number(seat.dataset.multiwayPlayer),seat); });
    document.addEventListener('pointerdown',event=>{if(seatDialog.open&&!seatDialog.contains(event.target)&&!event.target.closest?.('[data-multiway-player]'))seatDialog.close();});
    document.addEventListener('focusin',event=>{if(seatDialog.open&&!seatDialog.contains(event.target)&&!event.target.closest?.('[data-multiway-player]'))seatDialog.close();});
    window.addEventListener('resize',()=>{if(seatDialog.open)seatDialog.close();placeDecisionEV();});
    refresh(); return window.theibsMultiwayUI;
  }
  function voiceContext() {
    const source = context(), state = view.state;
    const needed = Number(currentVariant().match(/PLO([456])/i)?.[1] || 5);
    const pendingAmount = sizeDraft ? { action: sizeDraft.action, actor: sizeDraft.actor,
      minTo: state?.legal?.minTo, maxTo: state?.legal?.maxTo, totalThisStreet: state?.legal?.totalThisStreet } : null;
    const shown = revealDialog?.open && revealDraft?.stateToken === activeToken() ? player(revealDraft.actor) : null;
    let shownCards = []; if (shown) { try { shownCards = parsedShown(); } catch {} }
    const destination = shown ? 'shown' : state?.phase === 'WAIT_BOARD' || state?.cardTarget === 'BOARD' ? 'board'
      : state?.phase === 'BETTING' && (view.heroDraftReady === false || state?.cardTarget === 'HERO' || view.enabled && (source.heroCards?.length || 0) < needed) ? 'hero' : null;
    return { token: JSON.stringify([activeToken(), pendingAmount, view.config, source, window.theibsApp?.getVoiceContext?.(), shown?.id ?? null]),
      stateToken: activeToken(),
      revision: state?.revision, revisionKey: state?.revisionKey,
      enabled: view.enabled, busy: busy(), heroDraftReady: view.heroDraftReady !== false, phase: view.state?.phase, nextStreet: view.state?.nextStreet,
      actor: state?.actor, nextActor: state?.nextPlayerId ?? state?.actor, destination, pendingAmount,
      ...(shown ? { shownTarget: { actor: shown.id, playerId: shown.playerId, cards: shownCards } } : {}),
      board: [...(view.state?.board || [])],
      actionState: view.state ? { phase:view.state.phase, actor:view.state.actor, heroId:view.state.heroId,
        currentBet:view.state.currentBet, bigBlind:view.state.bigBlind,
        legal:{...view.state.legal,actions:[...(view.state.legal?.actions||[])]},
        players:view.state.players.map(item=>({id:item.id,hero:item.hero,name:item.name,seatName:item.seatName,position:item.position,folded:item.folded,allIn:item.allIn,streetPaid:item.streetPaid,stack:item.stack})) } : null };
  }
  async function commitVoiceBoard({ addedCards, expectedToken, originEventId }) {
    const current = voiceContext();
    if (!inAnalysis() || !current.enabled || current.busy || current.phase !== 'WAIT_BOARD' || current.token !== expectedToken) return false;
    if (!Array.isArray(addedCards) || addedCards.length !== (current.nextStreet === 'FLOP' ? 3 : 1) ||
        addedCards.some(card => typeof card !== 'string' || !/^[2-9TJQKA][shdc]$/.test(card))) return false;
    const source = context(), hero = source.heroCards || view.config?.heroCards || [];
    const cards = [...current.board, ...addedCards], known = [...hero, ...cards];
    if (new Set(known).size !== known.length) return false;
    return invoke('board', { cards, ...(originEventId ? { originEventId } : {}) });
  }
  async function commitKeyboardBoard({ addedCards, expectedStateToken }) {
    const current = voiceContext();
    if (!current.enabled || current.busy || current.phase !== 'WAIT_BOARD' || current.stateToken !== expectedStateToken) return false;
    return commitVoiceBoard({ addedCards, expectedToken: current.token });
  }
  async function undoVoiceBoard({ expectedToken }) {
    const current = voiceContext(), events = window.theibsApp?.getState().multiway?.events;
    if (!inAnalysis() || !current.enabled || current.busy || current.token !== expectedToken || events?.at(-1)?.type !== 'BOARD') return false;
    return invoke('undo');
  }
  async function commitVoiceAction({ command, action: actionCode, to, expectedToken, originEventId }) {
    const current=voiceContext();
    if(!inAnalysis()||!current.enabled||current.busy||current.token!==expectedToken)return false;
    try {
      const requested = command || {type:'action',actor:null,action:actionCode,...(to===undefined?{}:{to})};
      if (['BET', 'RAISE'].includes(requested.action) && requested.to === undefined && requested.by === undefined) {
        // Resolve a legal sample total before opening the draft, so an
        // explicit out-of-turn A1/A2 command cannot focus another seat.
        window.TheibsCardVoice.resolveAction({...requested,to:current.actionState.legal.minTo},current.actionState);
        return openPendingAmount({action:requested.action,expectedToken,originEventId});
      }
      return await invoke('act',{...window.TheibsCardVoice.resolveAction(requested,current.actionState),
        ...(originEventId ? { originEventId } : {})});
    }
    catch(error){setError(error.message);return false;}
  }
  async function commitVoiceSequence({ commands, expectedToken, originEventId }) {
    const captured = voiceContext();
    if (!inAnalysis() || !captured.enabled || captured.busy || captured.token !== expectedToken || captured.phase !== 'BETTING' || captured.pendingAmount) return { ok: false };
    if (!Array.isArray(commands) || commands.length < 2 || commands.length > 6 || !originEventId) return { ok: false };
    if (typeof options.handlers?.previewSequence !== 'function' || typeof options.handlers?.batchSequence !== 'function') { setError('Observed sequences are unavailable. Record each action with the table controls.'); return { ok: false }; }
    localBusy = true; setError(''); refresh();
    try {
      const payload = { commands, originEventId, expectedRevisionKey: captured.revisionKey };
      const preview = await options.handlers.previewSequence(payload);
      if (activeToken() !== captured.stateToken || preview?.revisionKey !== captured.revisionKey || !preview.previewKey) throw Error('The hand changed before the sequence was recorded. Review the current turn.');
      const result = await options.handlers.batchSequence({ ...payload, expectedPreviewKey: preview.previewKey });
      if (!result?.sequence) throw Error('The sequence could not be confirmed. Check the action history before repeating it.');
      return { ok: true, sequence: result.sequence };
    } catch (error) { setError(error.message); return { ok: false }; }
    finally { localBusy = false; refresh(); options.onSettled?.(); }
  }
  function commitVoiceShownCards({ cards, expectedToken, originEventId }) {
    const current = voiceContext();
    if (!inAnalysis() || !current.enabled || current.busy || current.destination !== 'shown' || current.token !== expectedToken) return { ok: false };
    try {
      if (originEventId && revealDraft.seen.has(originEventId)) return { ok: true, reviewRequired: true };
      const joined = validateShown([...parsedShown(), ...cards], player(revealDraft.actor));
      $('#mw-reveal-cards').value = joined.map(window.TheibsCards.fromCanonical).join(' ');
      if (originEventId) revealDraft.seen.add(originEventId);
      setError(''); return { ok: true, reviewRequired: true };
    } catch (error) { setError(error.message); return { ok: false }; }
  }
  async function undoAction({expectedToken} = {}) {
    const current = voiceContext();
    if (!inAnalysis() || !current.enabled || current.busy || expectedToken && current.token !== expectedToken) return false;
    if (!(view.canUndo ?? (view.state?.log || []).some(event => !['SB', 'BB'].includes(event.action)))) return false;
    cancelPendingAmount();
    return invoke('undo');
  }
  async function undoVoiceAction({ expectedToken }) {
    const current=voiceContext(),events=window.theibsApp?.getState().multiway?.events;
    if(!inAnalysis()||!current.enabled||current.busy||current.token!==expectedToken||events?.at(-1)?.type!=='ACT')return false;
    return invoke('undo');
  }
  function requestHeroPosition() {
    if (!initialized || !view.enabled || busy()) return;
    openSetup({ forNextHand: true });
  }
  function getRakeChoice() { return { ...rakeChoice }; }
  function getPlannedRakeChoice() { return nextRakeChoice ? { ...nextRakeChoice } : null; }
  function getPlannedSetup() { return nextSetupDraft ? { ...nextSetupDraft } : null; }
  function acceptNextSetup() {
    if (nextRakeChoice) rakeChoice = nextRakeChoice;
    nextSetupDraft = null; nextRakeChoice = null; setupDirty = false;
    refresh();
  }
  function restorePreferences(raw = {}) {
    const valid = choice => choice && ['GROSS','UNKNOWN','NO_RAKE','FIXED'].includes(choice.mode) &&
      (choice.mode !== 'FIXED' || Number.isFinite(choice.amount) && choice.amount >= 0);
    if (valid(raw.rakeChoice)) rakeChoice = raw.rakeChoice.mode==='UNKNOWN' ? {mode:'GROSS'} : { ...raw.rakeChoice };
    if (valid(raw.nextRakeChoice)) nextRakeChoice = raw.nextRakeChoice.mode==='UNKNOWN' ? {mode:'GROSS'} : { ...raw.nextRakeChoice };
    nextSetupDraft = raw.nextSetupDraft && typeof raw.nextSetupDraft === 'object' ? { ...raw.nextSetupDraft } : null;
    refresh();
  }
  window.theibsMultiwayUI = { init, render, setBusy, setError, openSetup, requestHeroPosition, openPlayer, openBoard, openCompletion, openReveal, getEndingStacks, getEvaluationSize, getDraft, voiceContext, commitVoiceBoard, commitKeyboardBoard, undoVoiceBoard, commitVoiceAction, commitVoiceSequence, commitVoiceShownCards, undoVoiceAction, undoAction, cancelPendingAmount, openPendingAmount, submitPendingAmount, describeDecisionEV,
    openStackEditor, openButtonCorrection, finishCompletion,
    getRakeChoice, getPlannedRakeChoice, getPlannedSetup, acceptNextSetup, restorePreferences,
    _testing:{studyComparisonDetails},
    getPreferences: () => ({ rakeChoice: { ...rakeChoice }, nextRakeChoice: nextRakeChoice && { ...nextRakeChoice }, nextSetupDraft: getPlannedSetup() }),
    keyboardPlayers:()=>{const draft=getDraft(),positions=POSITIONS[draft.playerCount]||POSITIONS[6];return positions.map((position,id)=>({id,position,hero:position===draft.heroPosition,name:position===draft.heroPosition?'You':`Opp. ${id+1}`,stack:draft.startingStack,folded:false}));},
    keyboardAction: (event, observed=false) => invoke(observed?'markFold':'act',event), keyboardBoard: cards => invoke('board',{cards}), keyboardUndo:()=>invoke('undo'),
    getState: () => ({ enabled: view.enabled, state: view.state, config: view.config, heroDraftReady: view.heroDraftReady !== false, busy: busy(), error: view.error }) };
})();
