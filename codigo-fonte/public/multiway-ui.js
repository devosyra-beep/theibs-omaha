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
    { id: 'leave', key: ',', code: 'Comma', resolve: state => state?.legal?.actions?.includes('FOLD') ? 'FOLD' : null },
    { id: 'passive', key: '.', code: 'Period', resolve: state => state?.legal?.actions?.includes('CHECK') ? 'CHECK' : state?.legal?.actions?.includes('CALL') ? 'CALL' : null },
    { id: 'aggressive', key: ';', code: 'Semicolon', resolve: state => state?.legal?.actions?.includes('BET') ? 'BET' : state?.legal?.actions?.includes('RAISE') ? 'RAISE' : null }
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
      analysis.observedState?.revisionKey === state.revisionKey;
    const ev = fresh && readiness.heroDraftReady !== false ? analysis.ev : null;
    const waitingCards = readiness.heroDraftReady === false;
    const idle = !ev && readiness.analysisBusy === false;
    const provisional = Boolean(ev && analysis.analysisStage === 'PROVISIONAL');
    const bigBlind = finite(ev?.bigBlind) && ev.bigBlind > 0 ? ev.bigBlind : finite(state.bigBlind) && state.bigBlind > 0 ? state.bigBlind : null;
    const candidates = Array.isArray(ev?.candidates) ? ev.candidates.filter(item => state.legal?.actions?.includes(item.action)) : null;
    const entries = candidates?.length ? candidates : (state.legal?.actions || []).map(action => ({ ...ev?.actions?.[action], action }));
    const rows = entries.map(item => {
      const action = item.action;
      const modeled = item?.status === 'MODELED' && finite(item.ev);
      const valueBB = modeled ? finite(item.evBB) ? item.evBB : bigBlind ? item.ev / bigBlind : null : null;
      return {
        action, optionId: item?.optionId || action, size: finite(item?.size) ? item.size : null,
        status: !ev ? waitingCards || idle ? 'NOT_MODELED' : 'PENDING' : modeled ? 'MODELED' : 'NOT_MODELED',
        evBB: valueBB,
        differenceBB: !provisional && modeled && ev?.decisionPrecision?.bestActionId && finite(item.differenceToBestModeledBB) ? item.differenceToBestModeledBB : null,
        method: item?.method || item?.model || null,
        numericalQuality: item?.numericalQuality || null,
        numericalBounds: [item?.numericalBounds, item?.confidenceInterval95].find(bounds => Array.isArray(bounds) && bounds.length === 2 && bounds.every(finite)) || null,
        samples: finite(item?.samples) ? item.samples : null,
        assumptions: Array.isArray(item?.assumptions) ? item.assumptions : [],
        missingInputs: Array.isArray(item?.missingInputs) ? item.missingInputs : []
      };
    });
    const modeledCount = rows.filter(row => row.status === 'MODELED' && finite(row.evBB)).length;
    return {
      rows, bigBlind,feeBasis:ev?.feeBasis || (rakeChoice.mode==='GROSS'?'BEFORE_FEES':null),
      potBeforeDecision: finite(ev?.potBeforeDecision) ? ev.potBeforeDecision : finite(state.pot) ? state.pot : null,
      toCall: finite(state.legal?.toCall) ? state.legal.toCall : null,
      stage: waitingCards ? 'WAITING_CARDS' : analysis?.status && analysis.status !== 'OK' ? analysis.status === 'NO_DECISION' ? 'NO_DECISION' : 'UNAVAILABLE' : idle ? 'IDLE' : !ev ? 'PENDING' : provisional ? 'PROVISIONAL' : String(ev.comparisonStatus || '').startsWith('INCOMPARABLE_') ? 'INCOMPARABLE' : !ev.comparisonComplete ? 'PARTIAL' : ev.globalBestSupported ? 'COMPLETE' : 'INCONCLUSIVE',
      refinement: provisional && ['TIME_BUDGET', 'FAILED'].includes(analysis?.refinement?.status) ? analysis.refinement : null,
      comparisonStatus: ev?.comparisonStatus || null,
      modeledCount,
      bestModeledAction: !provisional && modeledCount && (!ev.decisionPrecision || ev.decisionPrecision.bestActionId) ? ev.bestModeledAction : null,
      bestModeledSize: rows.find(row => row.optionId === ev?.bestModeledOptionId)?.size ?? null,
      finiteSizeGrid: Boolean(candidates?.length),
      globalBestSupported: !provisional && ev?.globalBestSupported === true,
      leaderConclusive: !provisional && ev?.decisionPrecision?.status === 'CONCLUSIVE' && ev.decisionPrecision.leaderConclusive === true,
      precision: provisional ? null : ev?.decisionPrecision || null,
      gapBestSecondBB: provisional ? null : finite(ev?.decisionPrecision?.deltaEVBB) ? ev.decisionPrecision.deltaEVBB : null,
      missingLegalActions: Array.isArray(ev?.missingLegalActions) ? ev.missingLegalActions : [],
      assumptions: Array.isArray(ev?.assumptions) ? ev.assumptions : [],
      warnings: Array.isArray(ev?.warnings) ? ev.warnings : [],
      reason: analysis?.status && analysis.status !== 'OK' ? analysis.reason : null
    };
  }
  function placeDecisionEV() {
    const host = $('#mw-decision-ev');
    if (!host) return;
    const rail = $('#analyze-workspace .context-rail');
    if (window.matchMedia?.('(min-width: 1000px)').matches && rail) {
      if (host.parentElement !== rail || host !== rail.firstElementChild) rail.prepend(host);
    } else if (host.parentElement !== controlsHost) {
      controlsHost.insertBefore(host, $('#mw-decision-feedback'));
    }
  }
  function solverControls() {
    const job = window.TheibsMultiwaySolverUI?.getState?.();
    if (!job) return '';
    const running = ['QUEUED','BUILDING','REFINING'].includes(job.phase);
    const reason = job.error || job.result?.reasons?.[0]?.message;
    return `<div class="mw-solver-controls"><button type="button" class="text-button" data-mw-solver-setup>${job.configured ? 'Edit study ranges' : 'Set up river study'}</button>${job.configured ? `<button type="button" class="text-button" data-mw-solver-standard${running?' disabled':''}>Refine</button><button type="button" class="text-button" data-mw-solver-deep${running?' disabled':''}>Deep · up to 30s</button>` : ''}${running ? '<button type="button" class="text-button" data-mw-solver-cancel>Stop refinement</button>' : ''}</div>${reason ? `<p>${esc(reason)}</p>` : ''}`;
  }
  function renderSolverDecision(host, priorDetails) {
    const solved = window.TheibsMultiwaySolverUI?.decisionSnapshot?.();
    if (!solved || solved.revisionKey !== view.state?.revisionKey || solved.handId !== view.state?.handId) return false;
    const rows = solved.actions, precision = solved.decisionPrecision;
    const commitment = precision?.target === 'PRIVATE_INFORMATION_SET_COMMITMENT_VALUE';
    const cert = solved.actionPrecision;
    const sameBounds = commitment && precision.contextKey === cert?.baseContextKey
      && precision.reasonCode !== 'INVALID_ACTION_BOUND_CONTEXT';
    const boundFor = row => sameBounds ? cert.actions?.find(item=>item.id===row.id && item.certified === true) : null;
    const valueFor = row => commitment ? boundFor(row)?.estimateBB : row.evBB;
    const bestRow = rows.find(row=>row.id===precision?.bestActionId), best = bestRow && valueFor(bestRow);
    const precise = value => !finite(value) ? '—' : value !== 0 && (Math.abs(value)<.001 || Math.abs(value)>=1e6)
      ? value.toExponential(2).replace(/e\+?/,'e').replace(/-/g,'−')
      : value.toLocaleString('en-US',{maximumSignificantDigits:6});
    const gap = finite(precision?.deltaEVBB) ? precision.deltaEVBB : null;
    const conclusive = precision?.status === 'CONCLUSIVE' && precision.leaderConclusive === true;
    const running = ['QUEUED','BUILDING','REFINING'].includes(solved.phase);
    const paused = !running && solved.adaptation?.phase === 'REFINING';
    const nc = solved.convergence?.exact && finite(solved.convergence.nashConv) ? solved.convergence.nashConv : null;
    const meta = solved.abstraction || {}, legal = view.state.legal;
    const belowLeader = value => !finite(value) ? '—' : precise(Math.abs(value));
    const fees = meta.feeModel?.type === 'NONE' ? meta.feeModel.basis === 'BEFORE_FEES' ? ' · Before fees' : ' · No fees assumed' : ' · Declared fees';
    const rowHtml = rows.map(row=>{
      const bound = boundFor(row), value = valueFor(row);
      const secondary = commitment ? bound ? `<span>${precise(bound.lowerBB)}</span><span>to ${precise(bound.upperBB)}</span>` : 'Pending'
        : `${(100*row.frequency).toLocaleString('en-US',{maximumFractionDigits:1})}%`;
      return `<tr><th scope="row">${esc(ACTIONS[row.action]?.label || row.action)}${finite(row.size)?` <small>to ${esc(money(row.size))}</small>`:''}</th><td><span>${precise(value)}</span></td><td>${secondary}</td><td><span>${belowLeader(finite(best)&&finite(value)?best-value:null)}</span></td></tr>`;
    }).join('');
    const quality = nc === null ? 'Deviation quality unavailable' : `NashConv ${nc.toLocaleString('en-US',{maximumFractionDigits:5})} bb · target ≤ ${money(solved.convergence.thresholdBB)} bb`;
    const computeLocation = solved.runtime === 'BROWSER' ? 'Browser compute' : 'Server compute';
    const leader = bestRow ? `${conclusive?'Best action':'Current EV leader'}: ${ACTIONS[bestRow.action]?.label || bestRow.action}${finite(bestRow.size)?' to '+money(bestRow.size):''}` : 'No comparable EV leader';
    const reason = precisionReason(precision);
    const profile = commitment ? `<details class="mw-solver-profile"><summary>Current hand · original strategy</summary><table class="mw-ev-table"><thead><tr><th>Action</th><th>EV · bb</th><th>Mix</th></tr></thead><tbody>${rows.map(row=>`<tr><th>${esc(ACTIONS[row.action]?.label || row.action)}${finite(row.size)?' '+money(row.size):''}</th><td>${precise(row.evBB)}</td><td>${precise(100*row.frequency)}%</td></tr>`).join('')}</tbody></table><p>These EVs and frequencies describe your hand against the original average profile. They are separate from the range commitment values above.</p></details>` : '';
    const actionDetails = commitment ? `<details><summary>Action bounds & computation</summary><p>The action is fixed only at your private information set. Both players may re-optimize elsewhere; all original ranges and hidden information are preserved. Values average over the entire supplied range, not only your current hand. No statistical confidence interval is inferred from NashConv.</p><p>Displayed values are rounded. Comparisons use the full-precision bounds.</p><ul>${rows.map(row=>{const b=boundFor(row);return `<li><strong>${esc(row.id)}</strong>: ${b?`estimate ${precise(b.estimateBB)} bb; lower ${precise(b.lowerBB)}, upper ${precise(b.upperBB)} bb; ${money(b.iterations)} iterations; ${precise(b.elapsedMs)} ms. Source: ${esc(b.origin)}. Version: ${esc(b.solverVersion)}.`:'Certified bounds pending.'}</li>`;}).join('')}</ul><p>Every comparison uses the same base state, ranges, fees, utility and complete declared tree. A candidate stops receiving focused refinement only after its upper bound is strictly below a rival’s lower bound with the numerical guard.</p></details>` : '';
    const costs = solved.metrics?.costs;
    const diagnostics = solved.rootDiagnostics;
    const measurement = `<p>Exploitability: ${precise(solved.convergence?.exploitability)} bb. Root one-step regret: ${precise(diagnostics?.oneStepRegret)} bb. ${diagnostics?.stability?.comparable ? `Checkpoint changes: EV ${precise(diagnostics.stability.maxActionEVChange)} bb; frequency ${precise(diagnostics.stability.maxFrequencyChange)}.` : 'Checkpoint stability is not yet available.'}</p>${costs?`<p>Compute: global ${precise(costs.globalSolveMs)} ms; action bounds ${precise(costs.actionSolveMs)} ms; total ${precise(costs.totalComputeMs)} ms.</p>`:''}${solved.adaptation?`<p>Refinement: ${esc(String(paused ? 'PAUSED' : solved.adaptation.stopReason || solved.adaptation.phase || '').replaceAll('_',' ').toLowerCase())}. Numerical quality is independent of the resource ceiling.</p>`:''}`;
    host.innerHTML = `<div class="mw-ev-heading"><strong>${commitment?'Range commitment EV':'Decision EV'}</strong><span class="mw-ev-badge">${esc(solved.status)}${running?' · refining':paused?' · paused':''}</span></div><p class="mw-ev-context">River subgame · ${computeLocation} · Pot ${money(view.state.pot)} · Call ${money(legal?.toCall)}${fees}</p><table class="mw-ev-table mw-ev-strategy${commitment?' mw-ev-bounds':''}"><thead><tr><th scope="col">Action</th><th scope="col">EV · bb</th><th scope="col">${commitment?'Bounds · bb':'Mix'}</th><th scope="col">Below leader · bb</th></tr></thead><tbody>${rowHtml}</tbody></table><div class="mw-ev-conclusion">${esc(leader)}<span>ΔEV · top two: ${gap===null?'unavailable':precise(gap)+' bb'}</span><span>${conclusive?'CONCLUSIVE':'INCONCLUSIVE'} · ${esc(reason)}</span></div><details class="mw-ev-details"${priorDetails?' open':''}><summary>Methods & limits</summary><p>EV is incremental from the current decision. Below leader = leader EV − action EV; it is a comparison gap, not an uncertainty interval or another EV estimate.</p><p>CFR+ · ${esc(solved.solverVersion)} · ${esc(solved.status)}. ${esc(quality)}. ${money(solved.iterations)} iterations.</p>${commitment?'':"<p>EV and frequencies describe your hand against the returned continuation profile. Frequencies apply to your exact five-card combination.</p>"}${profile}${actionDetails}${measurement}<p>${meta.fullLegalSizingCoverage?'All legal sizes covered within this subgame.':'Restricted sizes or aggression depth: omitted actions remain outside this study.'} This is not a solution of full-hand PLO5. ${meta.originalSeats>2?'Multiplayer CFR+ has no general Nash-convergence guarantee.':'Convergence qualification applies only to the supported two-player constant-sum subgame.'} NashConv measures unilateral deviation within the supplied game; it is not an action EV error bound.</p><p>Source: ${esc(solved.source)} · ${esc(meta.rulesVersion)}. Equity remains a separate showdown estimate.</p>${solverControls()}<ul>${(solved.limitations||[]).map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details>`;
    return true;
  }
  function refreshDecisionEV() {
    placeDecisionEV();
    const host = $('#mw-decision-ev'), decision = !view.enabled ? null : describeDecisionEV(view.state, view.analysis, view);
    const equityOrigin = $('#equity-origin');
    if(equityOrigin){equityOrigin.hidden=!decision || !window.TheibsMultiwaySolverUI?.decisionSnapshot?.();equityOrigin.textContent='Continuation model · separate from river study';}
    host.hidden = !decision;
    if (!decision) return;
    const priorDetails = host.querySelector('details')?.open ?? (document.body.dataset.analysisSecondary === 'expanded');
    if (renderSolverDecision(host, priorDetails)) return;
    const price = decision.toCall === null ? 'Call price unavailable' : `Call ${money(decision.toCall)}${decision.bigBlind ? ` (${bb(decision.toCall / decision.bigBlind)} bb)` : ''}`;
    const pot = (decision.potBeforeDecision === null ? 'Pot unavailable' : `Pot ${money(decision.potBeforeDecision)}`)+(decision.feeBasis==='BEFORE_FEES'?' · Before fees':'');
    const needsRake = decision.rows.some(row => row.missingInputs.some(text => /rake/i.test(text)));
    const badge = needsRake ? 'Fee basis required' : decision.stage === 'WAITING_CARDS' ? 'Add your cards' : decision.stage === 'IDLE' ? 'Not calculated' : decision.stage === 'PROVISIONAL' ? decision.refinement ? 'HEURISTIC · preliminary' : 'HEURISTIC · refining' : decision.stage === 'PENDING' ? 'Calculating' : decision.stage === 'NO_DECISION' ? 'No decision' : decision.stage === 'UNAVAILABLE' ? 'Calculation unavailable' : 'HEURISTIC';
    const rows = decision.rows.map(row => {
      const status = ['WAITING_CARDS','IDLE','NO_DECISION','UNAVAILABLE'].includes(decision.stage) ? 'Unavailable' : row.status === 'PENDING' ? 'Calculating' : row.status === 'MODELED' ? 'Modeled' : 'Not modeled';
      const size = row.size === null ? '' : ` <small>to ${esc(money(row.size))}</small>`;
      const difference = row.differenceBB === null ? '—' : bb(Math.abs(row.differenceBB)).replace(/^\+/, '');
      return `<tr><th scope="row"><span>${esc(ACTIONS[row.action]?.label || row.action)}${size}</span><small>${status}</small></th><td>${row.evBB === null ? '—' : bb(row.evBB)}</td><td>${difference}</td></tr>`;
    }).join('');
    const bestLabel = `${ACTIONS[decision.bestModeledAction]?.label || decision.bestModeledAction}${decision.bestModeledSize === null ? '' : ` to ${money(decision.bestModeledSize)}`}`;
    const leader = needsRake ? 'Declare rake or choose No rake to evaluate the other actions.' : decision.bestModeledAction
      ? decision.modeledCount === 1
        ? `Only ${esc(ACTIONS[decision.bestModeledAction]?.label || decision.bestModeledAction)} modeled · no overall best action.`
        : `${decision.leaderConclusive ? 'Best modeled action' : 'Current EV leader'}: ${esc(bestLabel)}`
      : decision.stage === 'WAITING_CARDS' ? 'Enter your cards to evaluate this decision.' : decision.stage === 'IDLE' ? 'No estimate for this decision.' : decision.stage === 'PROVISIONAL' ? decision.refinement ? 'Preliminary estimates retained.' : 'Preliminary estimates · refinement in progress.' : decision.stage === 'PENDING' ? 'Waiting for the current decision estimate.' : decision.stage === 'INCOMPARABLE' ? decision.comparisonStatus === 'INCOMPARABLE_ASSUMPTIONS' ? 'Action assumptions differ; EVs cannot be ranked.' : 'Opponent coverage differs; action EVs cannot be compared.' : decision.reason ? esc(decision.reason) : 'No action has modeled EV.';
    const gap = decision.stage === 'PROVISIONAL' || decision.modeledCount < 1 ? '' : `<span>ΔEV · top two: ${decision.gapBestSecondBB===null?'unavailable':money(decision.gapBestSecondBB)+' bb'}</span><span>${decision.leaderConclusive?'CONCLUSIVE':'INCONCLUSIVE'} · ${esc(precisionReason(decision.precision))}</span>`;
    const details = [
      '<li>EV is incremental from the current decision. Below leader = leader EV − action EV; it is a comparison gap, not an uncertainty interval or another EV estimate.</li>',
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
    const refinementStatus = decision.refinement ? `<p class="mw-ev-limit" role="status">Latest estimate retained. ${decision.refinement.status === 'TIME_BUDGET' ? 'Refinement reached its time budget.' : 'Refinement unavailable.'} Analyze hand to retry.</p>` : '';
    const solverPending = ['QUEUED','BUILDING','REFINING'].includes(solverJob?.phase) ? '<p class="mw-ev-limit" role="status">River study refining · current table uses heuristic EV.</p>' : '';
    host.innerHTML = `<div class="mw-ev-heading"><strong>Decision EV</strong><span class="mw-ev-badge" data-status="${decision.stage.toLowerCase()}">${badge}</span></div><p class="mw-ev-context">${pot} · ${price} · ${decision.bigBlind ? `1 bb = ${money(decision.bigBlind)} chips` : 'Big blind unavailable'}</p><table class="mw-ev-table"><thead><tr><th scope="col">Action</th><th scope="col">EV · bb</th><th scope="col">Below leader · bb</th></tr></thead><tbody>${rows}</tbody></table><div class="mw-ev-conclusion">${leader}${gap}</div>${refinementStatus}${solverPending}${needsRake ? '<button type="button" class="ghost-button" data-mw-rake>Set fee basis</button>' : ''}${decision.missingLegalActions.length && decision.modeledCount > 1 ? '<p class="mw-ev-limit">Some legal actions are not modeled; no overall best action.</p>' : ''}<details class="mw-ev-details"${priorDetails ? ' open' : ''}><summary>Methods & limits</summary><button type="button" class="text-button" data-mw-rake>Room fees · optional</button>${solverControls()}<ul>${details}</ul></details>`;
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
    list.innerHTML = Array.from({length:count-1},(_,index) => {
      const seat = index+1;
      return `<label>A${seat}<select data-mw-assign="${seat}"><option value="">New unknown player</option>${known.map(item=>`<option value="${esc(item.playerId)}">${esc(item.nickname)} · ${esc(item.playerId.slice(-6))}</option>`).join('')}</select></label>`;
    }).join('');
    for (const node of list.querySelectorAll('[data-mw-assign]')) node.value = saved.get(Number(node.dataset.mwAssign)) || '';
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
      ...(setupPurpose === 'next' ? { heroCards: [] } : Array.isArray(source.heroCards) ? { heroCards: source.heroCards.slice() } : {}) };
  }
  function openSetup({ forNextHand = view.enabled } = {}) {
    if (!initialized) return;
    if (seatDialog?.open) seatDialog.close();
    setupPurpose = forNextHand ? 'next' : 'activate';
    setupDirty = false; fillSetup(true);
    $('#mw-setup-dialog .multiway-dialog-head h2').textContent = forNextHand ? 'Next hand setup' : 'Set up Multiway';
    $('#mw-start').textContent = forNextHand ? 'Save for next hand' : 'Start Multiway';
    const settings = $('#settings-dialog'); if (settings?.open) settings.close();
    if (!setupDialog.open) setupDialog.showModal();
    (forNextHand ? $('#mw-hero-position') : $('#mw-player-count')).focus({ preventScroll: true });
  }
  const completed = () => view.enabled && ['SHOWDOWN', 'FINISHED'].includes(view.state?.phase);
  const pendingResult = () => view.state?.phase === 'SHOWDOWN' || view.state?.result?.reason === 'UNKNOWN';
  function completionContents() {
    const state = view.state, pending = pendingResult();
    const rows = state.players.map(item => `<label class="mw-stack-row"><span>${esc(playerName(item))} <small>${esc(item.position)}</small></span><input data-mw-ending-stack="${item.id}" type="text" inputmode="decimal" autocomplete="off" aria-label="${esc(playerName(item))} ending stack" value="${pending ? '' : esc(item.stack)}" placeholder="Confirm stack"></label>`).join('');
    const pots = (state.pots || []).map((pot, index) => `<fieldset class="mw-result-pot"><legend>${index ? `Side pot ${index}` : 'Main pot'} · ${money(pot.amount)} chips</legend>${pot.eligible.map(id => `<label><input type="checkbox" data-mw-pot="${index}" value="${id}"><span>${esc(playerName(player(id)))} · ${esc(player(id)?.position)}</span></label>`).join('')}</fieldset>`).join('');
    const awards = (state.result?.awards || []).map(item => `${playerName(player(item.player))} +${money(item.amount)}`).join(' · ');
    const note = pending ? 'Result unknown. Confirm every remaining stack to continue, or record the pot winners.' : state.result?.reason === 'ALL_FOLDED' ? `Pot awarded · ${awards}. Rake was not recorded; review ending stacks if needed.` : awards ? `Pot awarded · ${awards}. Rake ${money(state.rake)} chips.` : 'Result recorded.';
    $('#mw-completion-content').innerHTML = `<p class="mw-result-summary">${esc(note)}</p>${pending ? `<details id="mw-result-details"${state.phase === 'SHOWDOWN' ? ' open' : ''}><summary>Record pot winners</summary><form id="mw-result-form">${pots}<label>Actual rake · chips<input id="mw-result-rake" type="text" inputmode="decimal" autocomplete="off" placeholder="Enter 0 for no rake" required></label><button type="submit" class="primary-button">Record result</button></form></details>` : ''}<div class="mw-result-actions"><button id="mw-result-shown" type="button" class="ghost-button">Shown cards</button>${state.phase === 'SHOWDOWN' ? '<button id="mw-result-skip" type="button" class="text-button">Keep result unknown</button>' : ''}</div>${state.phase === 'FINISHED' ? `<details id="mw-ending-stacks"${pending ? ' open' : ''}><summary>${pending ? 'Confirm ending stacks' : 'Review ending stacks'}</summary><div class="mw-ending-stack-grid">${rows}</div></details><button id="mw-next-hand" type="button" class="primary-button">Next hand</button>` : ''}`;
    $('#mw-result-shown').onclick = () => openReveal();
    const resultForm = $('#mw-result-form');
    if (resultForm) resultForm.onsubmit = async event => {
      event.preventDefault();
      if (completionToken !== activeToken()) { setError('The hand changed. Open its result again.'); return; }
      const winners = (view.state.pots || []).map((pot, index) => [...resultForm.querySelectorAll(`[data-mw-pot="${index}"]:checked`)].map(node => Number(node.value)));
      const rake = parseAmount($('#mw-result-rake').value);
      if (winners.some(ids => !ids.length)) { setError('Select every winner for each pot. Select multiple players for a tie.'); return; }
      if (rake === null || rake > view.state.pot) { setError('Enter the actual rake from zero up to the total pot.'); return; }
      if (await invoke('settle', { winners, rake })) openCompletion();
    };
    const skip = $('#mw-result-skip');
    if (skip) skip.onclick = async () => { if (completionToken === activeToken() && await invoke('skipResult')) openCompletion(); };
    const next = $('#mw-next-hand');
    if (next) next.onclick = async () => {
      try {
        if (completionToken !== activeToken()) throw Error('The hand changed. Open its result again.');
        const stacks = getEndingStacks();
        if (await invoke('nextHand', { ...(stacks ? { stacks } : {}) })) completionDialog.close();
      } catch (error) { setError(error.message); }
    };
  }
  function getEndingStacks() {
    if (!completionDialog?.open || completionToken !== activeToken()) throw Error('Open the current result before confirming stacks.');
    const inputs = [...completionDialog.querySelectorAll('[data-mw-ending-stack]')];
    const values = inputs.map(input => parseAmount(input.value));
    if (values.length !== view.state.players.length || values.some(value => value === null || value < 0)) throw Error('Confirm a non-negative ending stack for every player.');
    return pendingResult() || values.some((value, index) => value !== view.state.players[index].stack) ? values : undefined;
  }
  function openCompletion() {
    if (!initialized || !completed() || busy()) return false;
    for (const node of [seatDialog, revealDialog]) if (node?.open) node.close();
    completionToken = activeToken(); setError(''); completionContents();
    if (!completionDialog.open) completionDialog.showModal();
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
  function openReveal(id) {
    if (!initialized || !completed() || busy()) return false;
    for (const node of [seatDialog, completionDialog]) if (node?.open) node.close();
    $('#mw-reveal-player').innerHTML = view.state.players.map(item => `<option value="${item.id}">${esc(playerName(item))} · ${esc(item.position)}</option>`).join('');
    selectShownPlayer(id ?? view.state.players.find(item => !item.hero)?.id ?? view.state.heroId);
    if (!revealDialog.open) revealDialog.showModal();
    $('#mw-reveal-cards').focus({ preventScroll: true }); return true;
  }
  function refreshCompletion() {
    const ready = completed();
    $('#mw-completion-actions').hidden = !ready;
    $('#mw-completion-open').textContent = view.state?.phase === 'FINISHED' ? 'Result & next hand' : 'Record result';
    for (const button of document.querySelectorAll('#mw-completion-actions button')) button.disabled = busy();
    if (completionDialog?.open && completionToken !== activeToken()) completionDialog.close();
    if (completionDialog?.open) for (const field of completionDialog.querySelectorAll('#mw-completion-content button,input')) field.disabled = busy();
    if (revealDialog?.open && revealDraft?.stateToken !== activeToken()) revealDialog.close();
    if (revealDialog?.open) {
      $('#mw-reveal-save').disabled = busy();
      $('#mw-reveal-player').disabled = busy(); $('#mw-reveal-cards').disabled = busy();
      const voice = window.theibsCardVoice?.getStatus?.();
      $('#mw-reveal-voice').textContent = voice?.enabled ? voice.audioReady ? 'Voice · listening' : 'Voice on · waiting' : 'Voice off';
      $('#mw-reveal-voice').setAttribute('aria-pressed', String(Boolean(voice?.enabled)));
    }
  }
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
      const fallback = command.id === 'passive' ? 'Check / Call' : command.id === 'aggressive' ? 'Bet / Raise' : 'Fold';
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
      if (view.enabled && hero) heroSeat.dataset.multiwayPlayer = String(hero.id);
      else delete heroSeat.dataset.multiwayPlayer;
      heroSeat.disabled = !view.enabled || busy();
      heroSeat.classList.toggle('mw-actor-seat', Boolean(view.enabled && hero && state.actor === hero.id));
      heroSeat.classList.toggle('mw-folded-seat', Boolean(view.enabled && hero?.folded));
      heroSeat.classList.toggle('mw-allin-seat', Boolean(view.enabled && hero?.allIn));
      heroSeat.setAttribute('aria-label', hero ? `You, ${hero.position}, stack ${money(hero.stack)}, ${money(hero.streetPaid)} committed this street. View seat.` : 'Your seat');
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
      if (view.enabled) node.setAttribute('aria-label', `${playerName(item)}, ${item.position}, stack ${money(item.stack)}, ${money(item.streetPaid)} committed this street, ${item.folded ? 'folded' : item.allIn || item.stack === 0 ? 'all-in' : state.actor === item.id ? 'to act' : item.lastAction === 'CHECK' ? 'checked' : 'in hand'}. View seat.`);
    }
    $('#mw-size-confirm').disabled = busy();
    refreshDecisionEV();
    refreshDecisionFeedback();
    refreshCompletion();
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
    $('#mw-seat-info').textContent = `${item.folded ? 'Folded' : item.allIn || item.stack === 0 ? 'All-in' : 'In hand'} · stack ${money(item.stack)} · committed ${money(item.streetPaid)} this street`;
    const turnFold = item.id === view.state.actor && view.state.legal?.actions?.includes('FOLD');
    $('#mw-seat-fold').disabled = busy() || !(turnFold || !item.hero && item.canMarkFold);
    $('#mw-seat-fold').textContent = turnFold ? "Record fold · it is this player's turn" : 'Record observed fold';
    $('#mw-seat-note').textContent = item.hero ? 'Your poker position is set for this hand. Use Multiway settings when starting a new hand to change it.'
      : item.folded ? 'Fold recorded. Undo reverses events in order; a recent fold can be undone here.' : item.allIn || item.stack === 0 ? 'An all-in player remains eligible for the pot.' : item.markFoldReason === 'UNMATCHED_CONTRIBUTION' ? 'Record responses to the largest bet first.' : !turnFold && !item.canMarkFold ? "Wait for this player's turn to record another action." : 'Use this only for a fold you observed.';
    const latest=window.theibsApp?.getState().multiway?.events?.at(-1);
    const undoFold=item.folded&&latest?.actor===item.id&&(latest.type==='MARK_FOLD'||latest.type==='ACT'&&latest.action==='FOLD');
    $('#mw-seat-undo').hidden=!undoFold;
    $('#mw-seat-undo').disabled=busy()||!undoFold;
    $('#mw-seat-edit-details').hidden = Boolean(item.hero);
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
    selectedPlayer = Number(id); setError('');
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
  function keydown(event) {
    if (!view.enabled || !inAnalysis() || busy() || event.defaultPrevented || event.repeat || event.isComposing || document.querySelector('dialog[open]')) return;
    const editing = event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    if (sizeDraft && event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault(); event.stopPropagation(); cancelPendingAmount(); return;
    }
    if (sizeDraft && !editing && !event.ctrlKey && !event.altKey && !event.metaKey && /^[0-9.,]$/.test(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const input = $('#mw-size'); input.focus({ preventScroll: true });
      input.value = (input.value || '') + (event.key === ',' ? '.' : event.key); sizeHelp(); return;
    }
    if (sizeDraft || editing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const command = COMMANDS.find(item => (item.code && item.code === event.code) || (item.key && item.key === event.key.toLowerCase())), actionCode = command && resolveCommand(command);
    if (actionCode) { event.preventDefault(); void action(actionCode); return; }
    const seat = event.target.closest?.('[data-multiway-player]');
    if (seat && seat.tagName !== 'BUTTON' && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openPlayer(Number(seat.dataset.multiwayPlayer)); }
  }
  function init(settings = {}) {
    options = settings;
    if (initialized) { fillSetup(); refresh(); return window.theibsMultiwayUI; }
    setupHost = $(settings.setupSelector || '#multiway-setup'); controlsHost = $(settings.controlsSelector || '#multiway-controls');
    if (!setupHost || !controlsHost) throw Error('Multiway containers are missing.');
    setupHost.innerHTML = `<div class="mw-quick-setup"><div><strong>Multiway <span id="mw-setup-status" class="mw-chip">Off</span></strong><small id="mw-setup-summary">Configure players, position, blinds and stacks</small></div><div class="mw-setup-switches"><button id="mw-setup-open" type="button" class="ghost-button">Setup</button><button id="mw-toggle" type="button" class="ghost-button" aria-pressed="false">Turn on Multiway</button></div></div><button id="mw-exit" type="button" class="text-button" hidden>Return to simple mode</button><p id="mw-quick-error" class="multiway-error" role="alert" hidden></p>`;
    setupDialog = dialog('mw-setup-dialog', 'Set up Multiway', `<div class="mw-setup-fields"><p class="mw-setup-intro" id="mw-start-note"></p><div class="mw-config-grid"><label>Players, including you<select id="mw-player-count" required></select></label><label>Your position<select id="mw-hero-position" required></select></label><label>Small blind<input id="mw-small-blind" type="text" inputmode="decimal" autocomplete="off" required></label><label>Big blind<input id="mw-big-blind" type="text" inputmode="decimal" autocomplete="off" required></label><label>Starting stack per player<input id="mw-starting-stack" type="text" inputmode="decimal" autocomplete="off" required></label></div><details class="mw-assignments"><summary>Advanced calculation options</summary><div class="mw-config-grid"><label>Room fees<select id="mw-rake-mode"><option value="GROSS">Before fees · default</option><option value="NO_RAKE">No room fee</option><option value="FIXED">Fixed room fee in chips</option></select></label><label id="mw-rake-fixed-row" hidden>Fixed room fee · chips<input id="mw-rake-fixed" type="text" inputmode="decimal" autocomplete="off"></label></div></details><details id="mw-assignments" class="mw-assignments"><summary>Assign saved players to seats</summary><div id="mw-assignment-grid"></div></details><div class="mw-setup-actions"><button id="mw-start" type="button" class="primary-button">Start Multiway</button></div><p id="multiway-setup-error" class="multiway-error" role="alert" hidden></p></div>`);
    setupDialog.setAttribute('aria-labelledby', 'mw-setup-title');
    setupDialog.querySelector('h2').id = 'mw-setup-title';
    controlsHost.classList.add('multiway-controls'); controlsHost.hidden = true;
    controlsHost.innerHTML = `<div class="mw-control-heading"><div class="mw-turn-context"><strong id="mw-actor"></strong></div><span class="mw-call-amount">To call <b id="mw-to-call"></b></span><button id="mw-undo" type="button" class="text-button" title="Undo the last confirmed event · Ctrl+Z">↶ Undo</button></div><div id="mw-action-stage" class="mw-action-stage"><div id="mw-actions" class="mw-action-row">${COMMANDS.map(item => `<button type="button" data-mw-command="${item.id}" data-mw-action="" disabled title="${item.key === ',' ? 'COMMA' : item.key === '.' ? 'PERIOD' : 'SEMICOLON'}"><kbd>${item.key}</kbd><span>${item.id === 'passive' ? 'Check / Call' : item.id === 'aggressive' ? 'Bet / Raise' : 'Fold'}</span></button>`).join('')}</div><div id="mw-inline-size" class="mw-inline-size" hidden><label for="mw-size" id="mw-size-label">Total this street</label><input id="mw-size" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" required><button id="mw-pot-size" type="button" class="ghost-button">Pot</button><button id="mw-allin-size" type="button" class="ghost-button">All-in</button><button id="mw-size-confirm" type="button" class="primary-button">Confirm</button><button id="mw-size-cancel" type="button" class="text-button" aria-label="Cancel amount entry">×</button></div></div><p class="mw-action-hint" id="mw-size-limits"></p><p class="mw-action-hint" id="mw-size-cost" role="status" aria-live="polite"></p><section id="mw-decision-ev" class="mw-decision-ev" aria-label="Decision EV by legal action" hidden></section><p id="mw-decision-feedback" class="mw-decision-feedback" role="status" hidden></p><p id="mw-board-prompt" class="mw-board-prompt" role="status" aria-live="polite" hidden></p><p id="multiway-error" class="multiway-error" role="alert" hidden></p><details id="mw-history"><summary>Recent actions</summary><ol id="mw-history-list"></ol></details>`;
    $('#mw-history').open = document.body.dataset.analysisSecondary === 'expanded';
    $('#mw-action-stage').insertAdjacentHTML('afterend', '<div id="mw-completion-actions" class="mw-result-actions" hidden><button id="mw-completion-open" type="button" class="primary-button">Record result</button><button id="mw-shown-open" type="button" class="ghost-button">Shown cards</button></div>');
    completionDialog = dialog('mw-completion-dialog', 'Hand result', '<div id="mw-completion-content" class="mw-completion-content"></div>');
    revealDialog = dialog('mw-reveal-dialog', 'Shown cards', '<form id="mw-reveal-form"><label>Player<select id="mw-reveal-player"></select></label><label>Cards shown<input id="mw-reveal-cards" type="text" autocomplete="off" spellcheck="false" placeholder="AE KC · partial hands are welcome"></label><p class="mw-card-legend">Only cards you saw. Rank + suit: ♠ E · ♥ C · ♦ O · ♣ P.</p><div class="mw-result-actions"><button id="mw-reveal-voice" type="button" class="ghost-button" aria-pressed="false">Voice off</button><button id="mw-reveal-save" type="submit" class="primary-button">Save shown cards</button></div></form>');
    boardDialog = dialog('multiway-board-dialog', '<span id="mw-board-title">Next street</span>', '<form id="mw-board-form"><p id="mw-board-existing"></p><label><span id="mw-board-label">New cards</span><input id="mw-board-new" autocomplete="off" spellcheck="false" required></label><p class="mw-card-legend">Rank + suit: ♠ E · ♥ C · ♦ O · ♣ P. Ten = D, T or 10.</p><button id="mw-board-confirm" type="submit" class="primary-button">Deal street · Enter</button></form>');
    seatDialog = dialog('multiway-seat-dialog', '<span id="mw-seat-title">Player</span>', '<p id="mw-seat-info"></p><div class="seat-popover-actions"><button id="mw-seat-fold" type="button" class="ghost-button">Record fold</button><button id="mw-seat-undo" type="button" class="text-button" hidden>Undo latest fold</button></div><p id="mw-seat-note"></p><details id="mw-seat-edit-details"><summary>Opponent assumptions</summary><p id="mw-seat-edit-note" class="micro"></p><fieldset id="mw-seat-editor"><label>Known hand<input id="mw-seat-hand" autocomplete="off" placeholder="AE KC QO JP TE"></label><label>Range<textarea id="mw-seat-range" rows="2" placeholder="One hand per line"></textarea></label><label>Call chance (%)<input id="mw-seat-rate" type="number" min="0" max="100" step="0.1" placeholder="Unknown"></label><div class="seat-popover-actions"><button id="mw-seat-apply" type="button" class="primary-button">Apply to seat</button><button id="mw-seat-remove" type="button" class="text-button">Remove assumption</button></div></fieldset><p id="mw-seat-edit-error" class="multiway-error" role="alert" hidden></p></details>');
    seatDialog.classList.add('seat-popover');
    seatDialog.setAttribute('aria-labelledby','mw-seat-title');
    rakeDialog = dialog('mw-rake-dialog', 'Room fees · optional', '<form id="mw-current-rake-form"><label>Calculation basis<select id="mw-current-rake-mode"><option value="GROSS">Before fees · default</option><option value="NO_RAKE">No room fee</option><option value="FIXED">Fixed room fee in chips</option></select></label><label id="mw-current-rake-row" hidden>Fixed room fee · chips<input id="mw-current-rake-amount" type="text" inputmode="decimal" autocomplete="off"></label><p class="micro">Calculation assumption only. Previously recorded decisions and actual chip balances stay unchanged.</p><p id="mw-current-rake-error" class="multiway-error" role="alert" hidden></p><button type="submit" class="primary-button">Apply to current calculation</button></form>');
    let rakeEditorToken = null;
    $('#mw-decision-ev').addEventListener('click', event => {
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
    initialized = true; fillSetup(true);
    $('#mw-completion-open').onclick = () => openCompletion();
    $('#mw-shown-open').onclick = () => openReveal();
    $('#mw-reveal-player').onchange = event => selectShownPlayer(event.target.value);
    $('#mw-reveal-voice').onclick = () => { window.theibsCardVoice?.toggle?.(); refreshCompletion(); };
    let revealVoiceTimer = null;
    revealDialog.addEventListener('close', () => { clearInterval(revealVoiceTimer); revealVoiceTimer = null; revealDraft = null; });
    new MutationObserver(() => {
      if (revealDialog.open && !revealVoiceTimer) revealVoiceTimer = setInterval(() => refreshCompletion(), 250);
      else if (!revealDialog.open && revealVoiceTimer) { clearInterval(revealVoiceTimer); revealVoiceTimer = null; }
    }).observe(revealDialog, { attributes: true, attributeFilter: ['open'] });
    $('#mw-reveal-form').onsubmit = async event => {
      event.preventDefault();
      try {
        if (!revealDraft || revealDraft.stateToken !== activeToken()) throw Error('The hand changed. Open shown cards again.');
        const draft = revealDraft, cards = validateShown(parsedShown(), player(draft.actor));
        if (await invoke('reveal', { actor: draft.actor, cards })) { revealDialog.close(); }
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
    controlsHost.addEventListener('click', event => { const button = event.target.closest('[data-mw-command]'); if (button && !button.disabled && button.dataset.mwAction) void action(button.dataset.mwAction); });
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
      if (!isTurn && (item.hero || !item.canMarkFold)) return;
      if (await invoke(isTurn ? 'act' : 'markFold', { actor: item.id, ...(isTurn ? { action: 'FOLD' } : {}) })) seatDialog.close();
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
    document.addEventListener('keydown', keydown, true);
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
    getRakeChoice, getPlannedRakeChoice, getPlannedSetup, acceptNextSetup, restorePreferences,
    getPreferences: () => ({ rakeChoice: { ...rakeChoice }, nextRakeChoice: nextRakeChoice && { ...nextRakeChoice }, nextSetupDraft: getPlannedSetup() }),
    getState: () => ({ enabled: view.enabled, state: view.state, config: view.config, heroDraftReady: view.heroDraftReady !== false, busy: busy(), error: view.error }) };
})();
