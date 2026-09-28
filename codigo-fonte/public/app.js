/* Theibs controller. All analysis and simulated actions go to the Theibs web
   Theibs API. EssenceDeck supplies presentation only; no demo engine is loaded. */
(function () {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const form = $('#analysis-form'), result = $('#result'), emptyState = $('#empty-state');
  const analyzeButton = $('#analyze-button');
  const cards = window.theibsCardKeyboard;
  const feedback = window.TheibsAnalyzeFeedback;
  const snapshots = [];
  const snapshotModel = window.TheibsSnapshots;
  const metrics = window.theibsMetrics = { analyses: [] };
  const value = (id) => document.getElementById(id).value.trim();
  const percent = (number) => number == null || !Number.isFinite(Number(number)) ? '—' : `${(Number(number) * 100).toFixed(1)}%`;
  const money = (number) => number == null || !Number.isFinite(Number(number)) ? '—' : Number(number).toFixed(2);
  const esc = window.EssenceUI.esc;
  const streetName = (street) => ({ PREFLOP: 'Preflop', FLOP: 'Flop', TURN: 'Turn', RIVER: 'River' })[street] || street;
  const qualityName = (quality) => ({ INCONCLUSIVE_COMPARISON: 'No clear advantage between options', INCOMPLETE_COMPARISON: 'Limited comparison', MATCHED_HEURISTIC: 'Matches the previous heuristic', DIFFERENT_HEURISTIC: 'Differs from the previous heuristic', MATCHED_MODELED: 'Favored choice in this exercise', DIFFERENT_MODELED: 'Another option had higher EV', UNVERIFIED: 'Not evaluated yet' })[quality] || quality;
  const actionName = action => ({FOLD:'Fold',CALL:'Call',CHECK:'Check',BET:'Bet',RAISE:'Raise',NO_DECISION:'No recommendation'})[action] || action || '—';
  const actionWithSize = (action,size) => actionName(action)+(['BET','RAISE'].includes(action)&&Number.isFinite(size)?' to '+money(size):'');
  const comparisonLabel = data => data.analysisStage === 'PROVISIONAL' ? 'Provisional estimate · refining' : !data.ev?.comparisonComplete ? 'Partial comparison' : data.recommendation?.status === 'CONDITIONAL' ? 'Highest EV under assumptions' : 'Inconclusive comparison';
  const recommendationText = data => data.analysisStage === 'PROVISIONAL' ? 'Refining…' : data.recommendation?.action ? actionName(data.recommendation.action) : 'No clear choice';
  const numberLabel = n => Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
  const FIELD_IDS = ['position','players','potBeforeAction','amountToCall','effectiveStack','samples','seed',
    'opponentHand','opponentRange','opponentProfile','opponentProfileSource','observedFoldToBet','observedCallFrequency','observedRaiseFrequency','observedBluffFrequency',
    'betSize','raiseTo','foldEquity','continuationEquity','rake','assumeNoRake','opponentModel','auto-analysis','training-mode','training-style','training-street','training-seed','training-stack'];
  FIELD_IDS.push('rake-mode','rake-rate','rake-cap','rake-no-flop','rake-rounding','analysis-big-blind','analysis-equivalence');
  FIELD_IDS.push('study-mode','study-hero-contribution','study-min-raise','study-min-bet','study-accept',...Array.from({length:9},(_,i)=>['study-contribution-'+i,'study-probability-'+i]).flat());
  let activeView = 'analyze', inputRevision = 0, analysisBusy = false, trainingBusy = false;
  let lastAnalysis = null, trainingSession = null, trainingDecisions = [];
  let loaded = false, revision = 0, saveTimer = null, saveBusy = false, saveDirty = false, saveBlocked = false;
  let legacyHandFlow = null;
  let toastTimer = null, priorHero = '';
  let analysisTimer=null,analysisController=null,analysisQueued=false;
  let engineStatus = null;
  const webBuild = document.querySelector('meta[name="theibs-web-build"]')?.content;
  function engineVersionError() {
    return webBuild && engineStatus?.version && webBuild !== engineStatus.version
      ? `Versões incompatíveis: interface ${webBuild}, motor ${engineStatus.version}. Recarregue a página. Se persistir, aguarde a atualização do serviço antes de calcular.` : '';
  }
  function renderEngineVersion() {
    const warning = document.getElementById('engine-build-warning'), error = engineVersionError();
    warning.hidden = !error; warning.textContent = error;
    document.getElementById('view-title').title = `Interface ${webBuild || '—'} · motor ${engineStatus?.version || 'indisponível'}`;
  }
  let inputChangedAt = performance.now(), coachController = null, coachGeneration = 0;
  let multiway = null, multiwayState = null, multiwayAnalysis = null, multiwayYesple = null;
  let multiwayBusy = false, syncingMultiway = false, multiwayCardTimer = null, multiwayCardSnapshot = null, multiwayRevision = 0;
  const multiwayLocked = ['variant-select','players','opponent-count','position','potBeforeAction','amountToCall','effectiveStack','study-mode'];
  const multiwayManualModels = ['opponentProfile','opponentProfileSource','observedFoldToBet','observedCallFrequency','observedRaiseFrequency','observedBluffFrequency','betSize','raiseTo','foldEquity','continuationEquity','study-hero-contribution','study-min-raise','study-min-bet','study-accept',...Array.from({length:9},(_,i)=>['study-contribution-'+i,'study-probability-'+i]).flat()];
  function multiwayContext() {
    const hand=cards.state.cards();
    return {variant:`PLO${cards.state.count}_HIGH`,players:Number(value('players')),position:value('position'),effectiveStack:Number(value('effectiveStack')),heroCards:hand.hero.map(window.TheibsCards.toCanonical),board:hand.board.map(window.TheibsCards.toCanonical)};
  }
  function renderMultiway() {
    document.body.dataset.multiwayBusy=String(multiwayBusy);
    for(const id of ['hero-slots','card-grid'])document.getElementById(id).inert=multiwayBusy;
    window.theibsMultiwayUI.render({enabled:!!multiway,state:multiwayState,config:multiway?.config,busy:multiwayBusy});
    $('#analysis-seats').setAttribute('aria-label',multiway?'Table seats; click an opponent to record to fold.':'Opponents with face-down cards; illustrative positions.');
    for(const id of multiwayLocked) { const el=document.getElementById(id);el.disabled=!!multiway;el.title=multiway?'Defined by Multiway tracking. Exit the mode to edit freely.':''; }
    for(const id of multiwayManualModels){const el=document.getElementById(id);el.disabled=!!multiway;el.title=multiway?'Free-form assumptions from simple mode. Multiway models must identify each seat.':'';}
    // Board changes belong to to street event; existing card entry edits only the private hand.
    if(multiway)document.querySelectorAll('#board-slots [data-slot]').forEach(el=>{el.disabled=true;el.title='Use Deal board in Multiway.';});
    window.theibsOpponentInputs?.refresh();
  }
  function syncMultiwayCards() {
    if(!multiwayState)return;
    const snapshot=cards.state.snapshot();
    snapshot.count=Number(multiway.config.variant.match(/\d/)[0]);
    const hero=snapshot.slots.slice(0,snapshot.count);
    snapshot.slots=[...hero,...multiwayState.board.map(window.TheibsCards.fromCanonical),...Array(5-multiwayState.board.length).fill(null)];
    snapshot.selected=Math.min(snapshot.selected,snapshot.count-1);
    const sameCards=snapshot.count===cards.state.count&&JSON.stringify(snapshot.slots)===JSON.stringify(cards.state.slots);
    syncingMultiway=true;cards.restore(snapshot,{preserveUndo:sameCards});syncingMultiway=false;
  }
  function acceptMultiway(data) {
    multiway=data.multiway;multiwayState=data.state;multiwayAnalysis=data.analysis;
    syncMultiwayCards();updateTableContext();renderMultiway();updateBoardHelp();
    snapshots.forEach(item=>item.stale=true);invalidateAnalysis();renderStreetCards();scheduleSave();
  }
  function multiwayRequestContext() {
    return { revision: multiwayRevision, view: activeView, session: JSON.stringify(window.theibsVoiceSessionContext?.()) };
  }
  function currentMultiwayRequest(captured) {
    return captured.revision === multiwayRevision && captured.view === activeView &&
      captured.session === JSON.stringify(window.theibsVoiceSessionContext?.()) && !window.theibsVoiceSessionContext?.().expired;
  }
  async function runMultiway(operation, beforeAccept) {
    const entryView=activeView, entryRevision=multiwayRevision;
    await window.theibsAuth?.ensureSession?.();
    if(entryView!==activeView||entryRevision!==multiwayRevision)throw Error('Contexto alterado durante a confirmação da sessão. Repita a ação no contexto atual.');
    if(engineVersionError()) throw Error(engineVersionError());
    if(multiwayBusy) throw Error('Aguarde o registro da ação atual.');
    multiwayRevision++;
    const captured = multiwayRequestContext();
    clearTimeout(multiwayCardTimer);
    multiwayCardSnapshot=cards.state.snapshot();multiwayBusy=true;invalidateAnalysis();renderMultiway();
    try {
      const data=await operation();
      if (!currentMultiwayRequest(captured)) throw Error('Contexto ou sessão alterados. A resposta foi descartada; nenhuma ação nova foi aplicada.');
      if(data) { beforeAccept?.(); acceptMultiway(data); }
    }
    catch(error){window.theibsMultiwayUI.setError(error.message);throw error;}
    finally{multiwayBusy=false;multiwayCardSnapshot=null;renderMultiway();if(currentMultiwayRequest(captured))scheduleAnalysis();}
  }
  async function startMultiway(config) {
    return runMultiway(()=>postJson('/api/multiway/start',{config}),()=>{
      window.theibsOpponentInputs?.reset();
      if(!multiwayYesple)multiwayYesple={keyboard:cards.state.snapshot(),fields:Object.fromEntries(FIELD_IDS.map(id=>{const el=document.getElementById(id);return[id,el.type==='checkbox'?el.checked:el.value];}))};
      syncingMultiway=true;
      const count=Number(config.variant.match(/\d/)[0]);
      cards.restore({count,slots:[...(config.heroCards||[]).map(window.TheibsCards.fromCanonical),...Array(count-(config.heroCards?.length||0)+5).fill(null)],selected:0});
      syncingMultiway=false;snapshots.splice(0);$('#settings-dialog').close();window.theibsCardPicker.close();
    });
  }
  async function stepMultiway(event) {
    return runMultiway(()=>postJson('/api/multiway/step',{multiway,event}));
  }
  async function exitMultiway() {
    if(multiwayBusy)return;
    multiwayRevision++;
    clearTimeout(multiwayCardTimer);
    multiway=null;multiwayState=null;multiwayAnalysis=null;
    if(multiwayYesple){
      for(const [id,saved] of Object.entries(multiwayYesple.fields||{})){const el=document.getElementById(id);if(!el||!FIELD_IDS.includes(id))continue;if(el.type==='checkbox')el.checked=saved===true;else el.value=String(saved);}
      syncingMultiway=true;cards.restore(multiwayYesple.keyboard);syncingMultiway=false;
    }
    multiwayYesple=null;snapshots.splice(0);cards.render();renderMultiway();updateTableContext();updateBoardHelp();invalidateAnalysis();scheduleSave();
  }

  function renderEngineDetails() {
    const data=lastAnalysis?.data, perf=data?.performance, timing=data?.clientTiming;
    const measured=n=>Number.isFinite(n)?(n/1000).toFixed(3)+' s':'—';
    $('#engine-details').innerHTML=`<section class="engine-card"><span class="eyebrow">LATEST ANALYSIS</span><h3>${data?comparisonLabel(data):'Waiting for measurement'}</h3><dl class="engine-metrics"><div><dt>Input to display proxy</dt><dd>${measured(timing?.inputToFrameMs)}</dd></div><div><dt>HTTP round trip</dt><dd>${measured(timing?.httpElapsedMs)}</dd></div><div><dt>Worker calculation</dt><dd>${measured(perf?.workerExecutionMs)}</dd></div><div><dt>Actual samples</dt><dd>${numberLabel(data?.equity?.samples)}</dd></div><div><dt>Cached result</dt><dd>${perf?perf.cacheHit?'Yes · original calculation reused':'No':'—'}</dd></div></dl><p class="micro">Display timing ends at the second animation frame after rendering; it is a proxy, not a hardware paint measurement. Cache hits do not run new simulations. Sampling intervals do not include errors in opponent assumptions.</p></section><section class="engine-card"><h3>Coach & learning</h3><p>Calculated facts are available without waiting for a language model. Optional Llama selects verified facts; it cannot change EV or equity.</p><p>History supports reviews. It does not train weights, learn optimal play or prove profit. Comparisons remain conditional on ranges, future play and costs.</p></section>`;
  }

  function toast(text) {
    $('#toast').textContent = text; $('#toast').classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 5500);
  }
  async function requestJson(url, options = {}) {
    const protectedRequest = url !== '/api/status';
    if (protectedRequest) await window.theibsAuth?.ensureSession?.();
    const session = JSON.stringify(window.theibsVoiceSessionContext?.());
    const response = await fetch(url, options);
    let data; try { data = await response.json(); } catch { throw new Error(`Invalid response from the web engine (HTTP ${response.status}).`); }
    // Receiving headers does not finish the request: identity may change while
    // the response body is arriving or while another request is being awaited.
    if (protectedRequest && (session !== JSON.stringify(window.theibsVoiceSessionContext?.()) || window.theibsVoiceSessionContext?.().expired)) {
      const error = new Error('A sessão mudou durante a resposta. Entre novamente para continuar.');
      error.code = 'AUTH_SESSION_CHANGED'; throw error;
    }
    if (!response.ok) { const error = new Error(data.reason || `HTTP ${response.status}`); error.status = response.status; throw error; }
    return data;
  }
  const postJson = (url, payload, keepalive = false) => requestJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive });
  function currentStreet() {
    const n = cards.state.cards().board.length;
    return n === 0 ? 'PREFLOP' : n <= 3 ? 'FLOP' : n === 4 ? 'TURN' : 'RIVER';
  }
  function updateBoardHelp() {
    const street = currentStreet();
    document.querySelectorAll('.street-tab').forEach((b) => { b.classList.toggle('active', b.dataset.street === street); b.setAttribute('aria-pressed', String(b.dataset.street === street)); });
    const progress = feedback.inputProgress({count:cards.state.count,slots:cards.state.slots,manualInvalid:cards.isManualInvalid()});
    $('#board-help').textContent = !progress.ready && progress.street ? progress.detail : street === 'PREFLOP' ? 'Leave blank to analyze preflop only.' : `Enter ${{ FLOP: 3, TURN: 4, RIVER: 5 }[street]} board cards for this street.`;
  }
  function renderStreetCards() {
    const byStreet = new Map(snapshots.map((item) => [item.street, item]));
    $('#street-cards').innerHTML = ['PREFLOP','FLOP','TURN','RIVER'].map((street) => {
      const item = byStreet.get(street);
      return `<div class="street-card${currentStreet() === street ? ' current' : ''}"><div class="street-name">${streetName(street)}</div><div class="street-meta"><span>${item ? item.stale ? 'Analyze again' : 'Analyzed' : 'Waiting'}</span><span class="street-equity">${item && !item.stale ? percent(item.equity) : '—'}</span></div></div>`;
    }).join('');
    const valid = snapshotModel.ordered(snapshots.filter((item) => item.equity != null && !item.stale));
    $('#session-count').textContent = valid.length;
    $('#session-average').textContent = valid.length ? percent(valid.reduce((sum, item) => sum + item.equity, 0) / valid.length) : '—';
    $('#session-action').textContent = valid.at(-1)?.action || '—';
  }

function renderCharts(latest) {
  const equity = latest?.equity;
  document.querySelector('#hero-equity').textContent = equity == null ? '—' : percent(equity);
  document.querySelector('#hero-method').textContent = latest ? `${latest.method} · ${latest.samples} samples` : 'Waiting for hand';
  document.querySelector('#chart-total').textContent = latest ? streetName(latest.street) : '—';
  document.querySelector('#win-percent').textContent = latest ? percent(latest.winRate) : '—';
  document.querySelector('#loss-percent').textContent = latest ? percent(1 - latest.winRate) : '—';
  document.querySelector('#win-fill').style.width = latest ? `${Math.max(0, Math.min(100, latest.winRate * 100))}%` : '0%';
  const points = snapshotModel.ordered(snapshots.filter((item) => item.equity != null && !item.stale));
  document.querySelector('#timeline-range').textContent = points.length ? `${points.length} compatible point(s)` : '—';
  document.querySelector('#timeline-empty').style.display = points.length ? 'none' : 'block';
  if (!points.length) {
    document.querySelector('#chart-line').setAttribute('points', '');
    document.querySelector('#chart-area').setAttribute('d', '');
    document.querySelector('#chart-points').innerHTML = '';
    return;
  }
  const width = 300; const left = 15; const top = 15; const bottom = 145; const height = bottom - top;
  const coords = points.map((item, index) => {
    const x = points.length === 1 ? left + width / 2 : left + (index / (points.length - 1)) * width;
    const y = bottom - item.equity * height;
    return { x, y, item };
  });
  const line = coords.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  document.querySelector('#chart-line').setAttribute('points', line);
  document.querySelector('#chart-area').setAttribute('d', `M ${coords[0].x} ${bottom} L ${coords.map((point) => `${point.x} ${point.y}`).join(' L ')} L ${coords.at(-1).x} ${bottom} Z`);
  document.querySelector('#chart-points').innerHTML = coords.map(({ x, y, item }) => `<circle cx="${x}" cy="${y}" r="4" fill="#e3b866" stroke="#111719" stroke-width="2"><title>${esc(streetName(item.street))} · ${percent(item.equity)}${item.interval?' · sampling interval '+item.interval.map(percent).join(' to '):' · exact under assumptions'} · ${esc(item.method)} · ${item.samples} samples · build ${esc(item.engineBuild)} · ${esc(item.analysisId)}</title></circle>`).join('');
}

function renderEvTable(ev) {
  if (!ev || !ev.actions) return '';
  const order = ['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE'];
  const rows = order.map((action) => {
    const item = ev.actions[action];
    if (!item) return '';
    const evValue = item.ev == null ? '—' : `${item.ev > 0 ? '+' : ''}${money(item.ev)}`;
    const status = ({MODELED:'Calculated',NOT_MODELED:'Pending assumptions',NOT_LEGAL:'Unavailable'})[item.status]||item.status;
    const detail = item.missingInputs?.length ? `Falta: ${item.missingInputs.join(', ')}` : (item.assumptions || []).join(' · ');
    return `<tr><td>${esc(action)}</td><td class="ev-number ${item.ev > 0 && item.status === 'MODELED' ? 'positive' : ''}">${esc(evValue)}</td><td><span class="ev-status ${String(item.status).toLowerCase()}">${esc(status)}</span></td><td>${esc(detail || '—')}</td></tr>`;
  }).join('');
  const summary = ev.bestModeledAction ? `${ev.comparisonComplete?'Highest EV among evaluated actions/sizes':'Partial comparison · highest calculated EV'}: ${ev.bestModeledAction}` : 'No action has modeled EV.';
  const breakdown=Object.values(ev.actions).filter(a=>a.scenarioBreakdown?.length).map(a=>{
    const groups=new Map();for(const s of a.scenarioBreakdown){const n=s.callers.length,g=groups.get(n)||{n,probability:0,weightedEv:0};g.probability+=s.probability;g.weightedEv+=s.weightedEv;groups.set(n,g);}
    return `<details><summary>Scenarios for ${esc(a.action)} · ${a.scenarioBreakdown.length} possible responses</summary><p class="micro">Probabilities are user assumptions. No re-raise or future betting.</p><table class="ev-table"><thead><tr><th>Callers</th><th>Probability</th><th>EV contribution</th></tr></thead><tbody>${[...groups.values()].sort((a,b)=>a.n-b.n).map(g=>`<tr><td>${g.n}</td><td>${percent(g.probability)}</td><td>${money(g.weightedEv)}</td></tr>`).join('')}</tbody></table>${a.conditionalEvEnvelope?`<p>Conditional range: ${money(a.conditionalEvEnvelope[0])} to ${money(a.conditionalEvEnvelope[1])} chips. It propagates scenario intervals; it is not to joint 95% guarantee.</p>`:''}</details>`;
  }).join('');
  return `<section class="ev-block"><div class="ev-heading"><span>EV by action</span><span>${esc(summary)}</span></div><div class="ev-table-wrap"><table class="ev-table"><thead><tr><th>Action</th><th>EV</th><th>Status</th><th>Assumptions / missing inputs</th></tr></thead><tbody>${rows}</tbody></table></div>${breakdown}${(ev.warnings || []).map((warning) => `<div class="result-warning">${esc(warning)}</div>`).join('')}</section>`;
}

function renderAnalysisDiagnostics(data) {
  const d = data.analysisDiagnostics; if (!d) return '';
  const labels = { MISSING_ACTION_MODEL:'Some legal actions need a response model', MISSING_OPPONENTS:'Not all opponents are modeled',
    EXACT_POINT_TIE:'Point estimates are tied', OVERLAPPING_INTERVALS:'The difference is not separated by the uncertainty bounds',
    MISSING_INTERVALS:'Uncertainty bounds are unavailable', SINGLE_MODELED_ACTION:'Only one action is modeled',
    PRACTICAL_EQUIVALENCE:'The point leader is within the declared regret limit in this model',
    UNVERIFIED_HEURISTIC_ADJUSTMENT:'The heuristic adjustment has no verified advantage', SAMPLING_TIME_BUDGET:'Sampling reached its time budget',
    INVALID_OR_UNAVAILABLE_MODEL:'The state or model is unavailable', PROVISIONAL:'The estimate is provisional' };
  const reasons = (d.reasonCodes || []).map(code => labels[code] || code);
  const method = d.selectionMethod === 'SHARED_EQUITY_AFFINE_DIFFERENCES' ? 'Compared differences using the same sampled equity' : 'Compared marginal uncertainty bounds';
  const next = feedback.summary({data, action:Number(value('amountToCall'))>0?'CALL':'CHECK', multiway:!!multiway});
  return `<section class="result-detail"><strong>Decision support</strong><p>${esc(method)}. ${esc(reasons.join('. '))}</p><p>${esc(next.title)}. ${esc(next.detail)}</p><p>These are conditional showdown values. The return of following the complete policy is evaluated separately in the 100-hand experiment.</p></section>`;
}

function renderStrategyPanel(strategy) {
  if (!strategy) return '';
  const baseline = strategy.baseline || {};
  const exploit = strategy.exploit || {};
  const changed = exploit.finalSource === 'EXPLOIT_ADJUSTMENT';
  const adjustments = (exploit.adjustments || []).map((item) => `${item.field}: ${item.adjusted == null ? 'strategic adjustment' : Number(item.adjusted).toFixed(2)}`).join(' · ');
  return `<section class="strategy-block"><div class="ev-heading"><span>Strategy / exploit</span><span>${esc(exploit.profile || 'UNKNOWN')}</span></div><div class="strategy-grid"><div><small>Base</small><strong>${esc(baseline.action || '—')}</strong></div><div><small>Final</small><strong class="${changed ? 'strategy-changed' : ''}">${esc(strategy.finalAction || '—')}</strong></div><div><small>Source</small><strong>${esc(strategy.finalSource || '—')}</strong></div><div><small>Confidence</small><strong>${esc(strategy.confidence || '—')}</strong></div></div>${changed ? `<div class="strategy-adjustment">Action changed by the exploit assumption. ${esc(adjustments || 'No quantitative adjustment provided.')}</div>` : ''}${(exploit.warnings || []).map((warning) => `<div class="result-warning">${esc(warning)}</div>`).join('')}</section>`;
}

function renderResult(data, street) {
  emptyState.classList.add('hidden');
  result.classList.remove('hidden');
  if (data.status !== 'OK') {
    result.innerHTML = `<div class="result-action">NO_DECISION</div><div class="result-warning">${esc(data.reason || 'Insufficient data.')}<br>${[...(data.errors || []), ...(data.warnings || [])].map(esc).join('<br>')}</div>`;
    return;
  }
  const equity = data.equity || {}; const math = data.potMath || {};
  const modeledCall = data.ev?.actions?.CALL?.status === 'MODELED' ? data.ev.actions.CALL.ev : null;
  result.innerHTML = `<div class="result-top"><div><div class="result-label">${comparisonLabel(data)} · ${streetName(street)}</div><div class="result-action">${esc(recommendationText(data))}</div></div></div>
    <details class="result-disclosure"><summary>Why? View calculations & assumptions</summary><div><p class="result-reason">${esc(data.reason)}</p><span class="confidence">${esc(data.confidence)}</span><div class="result-metrics"><div class="mini-metric"><small>Equity</small><strong>${percent(equity.equity)}</strong></div><div class="mini-metric"><small>Pot odds</small><strong>${percent(math.potOdds)}</strong></div><div class="mini-metric"><small>EV call</small><strong>${money(modeledCall)}</strong></div><div class="mini-metric"><small>SPR</small><strong>${math.spr == null ? '—' : Number(math.spr).toFixed(1)}</strong></div></div>${renderAnalysisDiagnostics(data)}${renderEvTable(data.ev)}${renderStrategyPanel(data.strategy)}<div class="result-detail">${esc(equity.method)} · ${esc(equity.samples)} samples · ${esc(equity.opponents)} opponent(s) · legal: ${(data.legalActions || []).map(esc).join(' / ')}<br>${(data.assumptions || []).map(esc).join(' · ')}${equity.confidenceInterval95 ? `<br>95% Monte Carlo CI: ${percent(equity.confidenceInterval95[0])}–${percent(equity.confidenceInterval95[1])} (does not include range uncertainty)` : ''}</div>${(data.warnings || []).map((warning) => `<div class="result-warning">${esc(warning)}</div>`).join('')}</div></details>`;
}


  function updateTableContext() {
    if(multiwayState){
      const hero=multiwayState.players.find(p=>p.hero),opponents=multiwayState.players.filter(p=>!p.hero&&!p.folded);
      for(const [id,n] of Object.entries({players:multiwayState.activePlayers,position:hero.position,potBeforeAction:multiwayState.pot,amountToCall:multiwayState.heroToCall,effectiveStack:hero.stack}))document.getElementById(id).value=String(n);
      $('#table-pot').textContent=window.EssenceUI.money(multiwayState.pot);$('#table-call').textContent=window.EssenceUI.money(multiwayState.heroToCall);$('#table-stack').textContent=window.EssenceUI.money(hero.stack);$('#table-position').textContent=`YOU · ${hero.position}`;
      $('#opponent-count').innerHTML=`<option value="${opponents.length}">${opponents.length}</option>`;
      $('#opponent-total').textContent=`${opponents.length} active opponents`;
      $('#table-position').textContent=`YOU · ${hero.position}${hero.folded?' · Folded':hero.allIn?' · All-in':''}`;
      $('#analysis-seats').innerHTML=window.EssenceUI.multiwaySeats(multiwayState,cards.state.count);return;
    }
    $('#table-pot').textContent = value('potBeforeAction') === '' ? '—' : window.EssenceUI.money(value('potBeforeAction'));
    $('#table-call').textContent = value('amountToCall') === '' ? '—' : window.EssenceUI.money(value('amountToCall'));
    $('#table-stack').textContent = value('effectiveStack') === '' ? '—' : window.EssenceUI.money(value('effectiveStack'));
    $('#table-position').textContent = `YOU · ${value('position') || '—'}`;
    const maxPlayers=({6:5,5:6})[cards.state.count]||Math.min(10,Math.floor(47/cards.state.count));
    $('#players').max=String(maxPlayers);
    if(Number(value('players'))>maxPlayers){$('#players').value=String(maxPlayers);toast(`PLO${cards.state.count}: table adjusted to you + ${maxPlayers-1} opponents.`);}
    const players = Number(value('players'));
    const opponents = Number.isInteger(players) && players >= 2 && players <= 10 ? players - 1 : 0;
    document.querySelectorAll('[data-study-opponent]').forEach(row=>row.hidden=Number(row.dataset.studyOpponent)>=opponents);
    const maxOpponents=maxPlayers-1;
    const opponentSelect=$('#opponent-count');
    opponentSelect.innerHTML=(opponents?'':'<option value="" selected>Select…</option>')+Array.from({length:maxOpponents},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
    if(opponents>maxOpponents)opponentSelect.add(new Option(`${opponents} · · exceeds the deck`,String(opponents)));
    opponentSelect.value=String(opponents);
    $('#opponent-total').title='Opponent positions are illustrative; their cards remain unknown.';
    $('#opponent-total').textContent=opponents?`You + ${opponents} opponent${opponents===1?'':'s'} = ${players} players`:'Enter opponents';
    $('#analysis-seats').innerHTML = window.EssenceUI.opponentSeats(opponents,cards.state.count);
  }
  function quickAction(data, note) {
    const progress = feedback.inputProgress({count:cards.state.count,slots:cards.state.slots,manualInvalid:cards.isManualInvalid()});
    const rawCall=value('amountToCall');
    const action=rawCall===''?'CALL':Number(rawCall)>0?'CALL':'CHECK';
    const assessment=progress.ready?data?.continuationAssessment:null;
    const continuation=window.TheibsContinuationView.describe(assessment);
    const display=continuation||feedback.summary({data,action,progress,busy:analysisBusy,auto:$('#auto-analysis').checked,multiway:!!multiway,note});
    const facts=data?.handInsights;
    $('#nuts-badge').hidden=!(data?.status==='OK'&&facts?.made&&facts?.nuts?.unbeaten===true);
    $('#hand-facts-content').innerHTML=facts?`<p><strong>${esc(facts.made?.label||'Preflop')}</strong>${facts.made?`<br>Your cards used: ${facts.made.usedHeroCards.map(esc).join(' + ')}`:`<br>${facts.privatePairs.length} paired group(s) · ${facts.suited.length} suit(s) with two or more cards`}</p>${facts.nuts?`<p>${facts.nuts.unbeaten?'Nuts on the current board; ties are possible.':'Your hand can be beaten on the current board.'}</p>`:''}${facts.nextCard?`<p>Next card: <b>${facts.nextCard.flushCards.length}</b> complete a flush · <b>${facts.nextCard.straightCards.length}</b> complete a straight.</p><p class="micro">Improving does not guarantee a win; these are not clean outs.</p>`:''}${facts.blockers.map(b=>`<p>${esc(b.detail)}</p>`).join('')}`:'Complete the cards to see made hand, draws and blockers. You do not need to record actions.';
    $('#quick-action').textContent = data?.status === 'OK' ? recommendationText(data) : data ? 'NO_DECISION' : '—';
    $('#quick-action-note').textContent = note || (data?.status === 'OK' ? data.ev?.comparisonComplete?comparisonLabel(data):'Partial · missing '+(data.ev?.missingLegalActions||[]).join(', ') : data?.reason || 'Complete your cards.');
    if(continuation){$('#quick-action').textContent=continuation.shortTitle;$('#quick-action-note').textContent='Decisão atual · sem comparar BET/RAISE';}
    const model=data?.status==='OK'?data.ev?.actions?.[action]:null;
    const ev=model?.status==='MODELED'?model.ev:null;
    const interval=model?.confidenceInterval95;
    const envelope=model?.conditionalEvEnvelope;
    const bounds=envelope||interval;
    const uncertain=display.uncertain;
    const tone=display.tone;
    $('#ev-summary').dataset.tone=tone;
    $('#ev-label').textContent=`${data?.analysisStage==='PROVISIONAL'?'Provisional ':''}${action} EV`;
    $('#ev-value').textContent=ev==null?'—':`${ev>0?'+':''}${money(Math.abs(ev)<.005?0:ev)}`;
    $('#ev-state').textContent=display.state;
    $('#ev-state').classList.remove('sr-only');
    $('#analysis-next-title').textContent=display.title;
    $('#analysis-next-detail').textContent=display.detail;
    const scope=data?.opponentModelScope;
    if(!continuation&&scope&&data.ev?.missingLegalActions?.some(item=>['BET','RAISE'].includes(item))){
      const message={MISSING_SEAT_CALL_PROBABILITIES:'As respostas dos adversários não foram presumidas. O estudo de BET/RAISE é opcional; a equity e o CALL disponíveis continuam válidos dentro do modelo mostrado.',INDEPENDENT_STUDY_NOT_ACCEPTED:'As taxas individuais estão registradas. Para comparar BET/RAISE, confirme as hipóteses no estudo opcional.',SPECIFIC_RANGE_CONTINUATION_UNSUPPORTED:'O range individual foi usado na equity e no CALL. BET/RAISE com ranges específicos de continuação ainda não está disponível.',MISSING_SEAT_CONTRIBUTIONS:'Para estudar a aposta, informe os aportes desta street em Compare bet / raise. Os demais cálculos continuam disponíveis.',MISSING_LEGAL_MINIMUM:'Para estudar a aposta, informe seu mínimo legal em Compare bet / raise.'}[scope.aggression?.reasonCode];
      if(message)$('#analysis-next-detail').textContent=message;
    }
    $('#analysis-next-action').hidden=!display.target;
    $('#analysis-next-action').dataset.target=display.target||'';
    $('#analysis-next-action').textContent=display.label||'';
    const metricsHost=$('#continuation-metrics'),risk=$('#continuation-risk');
    metricsHost.replaceChildren();metricsHost.hidden=true;risk.hidden=true;
    if(assessment&&!['UNAVAILABLE','PROVISIONAL'].includes(assessment.status)){
      const add=(label,text)=>{const pair=document.createElement('div'),name=document.createElement('dt'),number=document.createElement('dd');name.textContent=label;number.textContent=text;pair.append(name,number);metricsHost.append(pair);};
      const pp=n=>`${n>0?'+':''}${n.toLocaleString('pt-BR',{maximumFractionDigits:2})} p.p.`;
      if(Number.isFinite(assessment.equity))add('Equity no modelo',percent(assessment.equity));
      if(Number.isFinite(assessment.breakEvenEquity))add('Equity necessária',percent(assessment.breakEvenEquity));
      if(Number.isFinite(assessment.amountToCall))add('Para pagar agora',money(assessment.amountToCall)+' fichas');
      if(Number.isFinite(assessment.conservativeMarginPP))add('Margem pelo limite inferior',pp(assessment.conservativeMarginPP));
      if(assessment.evBounds)add(assessment.boundsKind==='CONDITIONAL_ENVELOPE'?'Faixa nas hipóteses':assessment.boundsKind==='EXACT_MODEL_VALUE'?'EV exato neste modelo':'Intervalo amostral de EV (95%)',assessment.evBounds.map(money).join(' a ')+' fichas');
      metricsHost.hidden=!metricsHost.children.length;
      const hand=assessment.handContext;
      risk.textContent=(hand?.nutsOnCurrentBoard?'Nuts neste board; empates ainda são possíveis. ':hand?.madeHand?`${hand.madeHand} neste board. `:'')+(hand?.futureBoardCards?'Novas cartas e apostas podem mudar a decisão.':'Reavalie se o preço ou os jogadores ativos mudarem.');risk.hidden=false;
    }
    if(!progress.ready){$('#quick-action').textContent='Waiting for cards';$('#quick-action-note').textContent=progress.detail;}
    const random=data?.ranges?.some(range=>range.kind==='UNIFORM');
    $('#ev-assumption').textContent=data?.status==='OK'
      ? `${random?'Modelo: adversários com cartas aleatórias.':'Modelo: informação manual aplicada.'} ${data.equity.opponents} adversário(s) · sem apostas futuras${$('#assumeNoRake').checked?' · rake zero explícito':''}${ev==null?' · EV depende dos dados de preço/custo mostrados abaixo':''}.`
      : note||data?.reason||'Complete the cards to calculate.';
    if(interval)$('#ev-assumption').textContent+=` 95% sample range: ${money(interval[0])} to ${money(interval[1])} chips${uncertain?' · crosses zero':''}. Does not cover range error.`;
    if(envelope)$('#ev-assumption').textContent+=` Conditional range: ${money(envelope[0])} to ${money(envelope[1])} chips. Depends on response assumptions.`;
    if(data?.scenarioSummary)$('#ev-assumption').textContent+=` Active scenario · ${data.scenarioSummary.totalSamples.toLocaleString('en-US')} total simulations. On to call, everyone completes the price.`;
    if(data?.status==='OK' && data.equity.opponents !== Number(value('players'))-1)$('#ev-assumption').textContent=`WARNING: calculated against ${data.equity.opponents} of ${Number(value('players'))-1} table opponents. Models are missing for the others. `+$('#ev-assumption').textContent;
    if($('#ev-critical-warning')) {
      const mismatch=data?.status==='OK'&&data.equity.opponents!==Number(value('players'))-1;
      $('#ev-critical-warning').textContent=mismatch?`Calculation covers only ${data.equity.opponents} of ${Number(value('players'))-1} opponents.`:'';
      $('#ev-critical-warning').hidden=!mismatch;
    }
    if(data?.equity?.samplingMode==='ADAPTIVE')$('#ev-assumption').textContent+=` ${data.equity.samples.toLocaleString('en-US')} simulations · ${(data.equity.elapsedMs/1000).toFixed(2)} s · ${({PRECISION:'precision reached',CALL_EV_SIGN:'call EV sign separated from zero',TIME_BUDGET:'time limit',SAMPLE_LIMIT:'sample limit'})[data.equity.stopReason]}.`;
    $('#ev-alternatives').innerHTML=data?.status==='OK'?['FOLD','CALL','CHECK','BET','RAISE'].filter(a=>data.ev?.actions?.[a]?.legal).map(a=>{const item=data.ev.actions[a],n=item.status==='MODELED'?item.ev:null;return `<span>${a}<b class="${n>0?'positive':n<0?'negative':''}">${n==null?'—':(n>0?'+':'')+money(n)}</b></span>`;}).join(''):'';
  }
  const feedbackHost=document.createElement('section');feedbackHost.id='analysis-input-feedback';feedbackHost.className='analysis-input-feedback';
  feedbackHost.innerHTML='<div role="status" aria-live="polite"><strong id="analysis-next-title"></strong><p id="analysis-next-detail" class="micro"></p><dl id="continuation-metrics" hidden></dl><p id="continuation-risk" class="micro" hidden></p></div><p id="ev-scope" class="micro">Leitura do preço atual, sem comparar BET/RAISE. Depende do modelo de cartas e supõe nenhuma aposta futura. Não garante vitória nem lucro.</p><button id="analysis-next-action" type="button" class="text-button" hidden></button>';
  $('#ev-summary').append(feedbackHost);
  $('#analysis-next-action').addEventListener('click',()=>{
    const target=$('#analysis-next-action').dataset.target;
    if(target==='entry'){$('#open-entry').click();return;}
    if(target==='cards'){
      const next=cards.state.slots.findIndex(card=>!card);if(next>=0)cards.select(next);
      if(!$('#card-picker').open)$('#open-card-picker').click();return;
    }
    if(target==='calculation'){$('#open-analysis').click();return;}
    if(target==='responses'||target==='opponents'){$('#open-opponent-inputs').click();return;}
    const field=document.getElementById(({costs:'rake-mode',responses:'study-mode',precision:'samples',opponents:'opponentModel',price:'amountToCall',pot:'potBeforeAction'})[target]);
    if(!field)return;
    for(const dialog of document.querySelectorAll('dialog[open]'))if(dialog.id!=='settings-dialog')dialog.close();
    const settings=$('#settings-dialog');if(!settings.open)settings.showModal();
    for(let parent=field.parentElement;parent&&parent!==settings;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
    field.scrollIntoView({block:'center'});field.focus();
  });
  function scheduleAnalysis() {
    clearTimeout(analysisTimer);
    if(!loaded||window.theibsVoiceSessionContext?.().expired||activeView!=='analyze'||!$('#auto-analysis').checked)return;
    analysisTimer=setTimeout(async()=>{
      if(analysisBusy){analysisQueued=true;return;}
      const requestedRevision=inputRevision;
      try{
        await window.theibsAuth?.ensureSession?.();
        if(!loaded||activeView!=='analyze'||!$('#auto-analysis').checked||requestedRevision!==inputRevision)return;
        buildAnalysisPayload();
      }catch(error){if(activeView==='analyze'&&requestedRevision===inputRevision)quickAction({status:'ERROR',reason:error.message});return;}
      analyze();
    },80);
  }
  function invalidateAnalysis() {
    inputRevision += 1; lastAnalysis = null; inputChangedAt = performance.now();
    let input; try { input = buildAnalysisPayload(true); } catch { input = null; }
    snapshotModel.invalidate(snapshots, input, engineStatus?.version);
    renderStreetCards();
    document.dispatchEvent(new CustomEvent('theibs:analysis-invalidated'));
    renderEngineDetails();
    result.classList.add('hidden'); emptyState.classList.remove('hidden');
    quickAction(null, 'Refresh the analysis.'); renderCharts();
    analysisController?.abort(); scheduleAnalysis();
  }
  function applyAppearance(deck, felt) {
    if (['classico', 'cores'].includes(deck)) document.body.dataset.deck = deck;
    if (['roxo', 'verde', 'azul', 'preto'].includes(felt)) document.body.dataset.felt = felt;
    for (const key of ['deck', 'felt']) document.querySelectorAll(`button[data-${key}]`).forEach((button) => {
      const selected = button.dataset[key] === document.body.dataset[key];
      button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
    });
  }
  function costPayload() {
    const result = { rake: value('rake'), assumeNoRake: $('#assumeNoRake').checked };
    if (value('rake-mode') === 'PERCENT_CAPPED') {
      if (value('rake-rate') === '' || value('rake-cap') === '') throw Error('Enter the rake rate and cap.');
      result.rake = undefined; result.assumeNoRake = false;
      result.rakeSchedule = { type: 'PERCENT_CAPPED', rate: Number(value('rake-rate')) / 100,
        cap: Number(value('rake-cap')), noFlopNoDrop: $('#rake-no-flop').checked,
        rounding: value('rake-rounding'), source: 'USER_PROVIDED', version: '1' };
    }
    if (value('analysis-big-blind') !== '') result.bigBlind = Number(value('analysis-big-blind'));
    if (value('analysis-equivalence') !== '') {
      if (!result.bigBlind || result.bigBlind <= 0) throw Error('Enter the big blind for a comparison in BB.');
      result.practicalEquivalenceBB = Number(value('analysis-equivalence'));
    }
    return result;
  }
  function buildAnalysisPayload(allowIncomplete = false) {
    if(window.theibsVoiceSessionContext?.().expired) throw Error('Session changed or expired. Sign in again before analyzing.');
    if(engineVersionError()) throw Error(engineVersionError());
    if(cards.isManualInvalid())throw Error('Fix the cards in the text field.');
    if(multiway){
      if(multiwayBusy)throw Error('Updating the street.');
      const canonical=cards.canonicalForSubmit();
      if(JSON.stringify(canonical.heroCards)!==JSON.stringify(multiway.config.heroCards))throw Error('Confirm your cards before analyzing.');
      if(!multiwayAnalysis?.available)throw Error(multiwayAnalysis?.reasons?.map(r=>r.message).join(' ')||'Waiting for your turn.');
      const adaptive=value('samples')==='adaptive';
      return {...canonical,multiway,unknownOpponentModel:'UNIFORM',...window.theibsOpponentInputs.payload(),betSize:value('betSize'),raiseTo:value('raiseTo'),samples:adaptive?50000:value('samples'),...(adaptive?{samplingMode:'ADAPTIVE'}:{}),seed:value('seed')||'42',...costPayload(),futureStreetModel:{type:'SHOWDOWN_ONLY'}};
    }
    const canonical = allowIncomplete ? { variant: `PLO${cards.state.count}_HIGH`, street: currentStreet(),
      heroCards: cards.state.cards().hero.map(window.TheibsCards.toCanonical), board: cards.state.cards().board.map(window.TheibsCards.toCanonical) } : cards.canonicalForSubmit();
    const payload = { ...canonical,
      position: value('position'), players: value('players'), potBeforeAction: value('potBeforeAction'), amountToCall: value('amountToCall'), effectiveStack: value('effectiveStack'), samples: value('samples'), seed: value('seed') || '42',
      unknownOpponentModel:'UNIFORM', ...window.theibsOpponentInputs.payload(), futureStreetModel:{type:'SHOWDOWN_ONLY'},
      betSize:value('betSize'),raiseTo:value('raiseTo'),...costPayload(),
      heroContribution:value('study-hero-contribution'),minRaiseTo:value('study-min-raise'),minBet:value('study-min-bet'),
      opponentContributions:Array.from({length:Number(value('players'))-1},(_,seatId)=>({seatId,contribution:value('study-contribution-'+seatId)})).filter(item=>item.contribution!=='')
    };
    if(payload.samples==='adaptive'){payload.samples=50000;payload.samplingMode='ADAPTIVE';}
    return payload;
  }
  async function analyze(event) {
    event?.preventDefault();
    const entryView=activeView, entryRevision=inputRevision;
    try { await window.theibsAuth?.ensureSession?.(); } catch(error) { if(entryView===activeView&&entryRevision===inputRevision)quickAction({status:'ERROR',reason:error.message}); return; }
    if(entryView!==activeView||entryRevision!==inputRevision||activeView!=='analyze')return;
    if (analysisBusy) {analysisQueued=true;return;}
    let payload;
    try { payload = buildAnalysisPayload(); }
    catch (error) { const data = { status: 'NO_DECISION', reason: error.message }; renderResult(data, currentStreet()); quickAction(data); cards.announce(error.message, true); return; }
    const requestedRevision = inputRevision, inputAt = event?.type ? performance.now() : inputChangedAt;
    analysisBusy = true; const controller = analysisController = new AbortController();
    analyzeButton.disabled = true; $('#quick-analyze').disabled = true;
    analyzeButton.textContent = 'Calculating…'; $('#quick-analyze').textContent = 'Calculating…';
    quickAction(null, 'The engine is calculating this hand…');
    const publish = async (data, started, phase) => {
      if (requestedRevision !== inputRevision || controller.signal.aborted) return false;
      data.clientTiming={httpElapsedMs:performance.now()-started,scope:'HTTP_ROUND_TRIP_AND_SECOND_FRAME_PROXY'};
      renderResult(data, payload.street); quickAction(data);
      const snapshot=data.status==='OK'?snapshotModel.create(data,payload):null;
      if (phase==='FINAL') {
        lastAnalysis = { signature: snapshotModel.stable(payload), data, street: payload.street };
        if(snapshot) {
          const index=snapshots.findIndex(item=>item.street===payload.street);
          if(index>=0)snapshots.splice(index,1,snapshot);else snapshots.push(snapshot);
          renderStreetCards();
        }
      }
      renderCharts(snapshot);
      // Two rAF callbacks bound a display opportunity, not guaranteed physical paint.
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      if (requestedRevision !== inputRevision || controller.signal.aborted) return false;
      data.clientTiming.inputToFrameMs=performance.now()-inputAt;
      data.clientTiming.responseToFrameMs=performance.now()-started-data.clientTiming.httpElapsedMs;
      metrics.analyses.push({analysisId:data.analysisId,phase,status:data.status,...data.clientTiming});
      if(metrics.analyses.length>1000)metrics.analyses.shift();
      document.dispatchEvent(new CustomEvent('theibs:analysis-painted',{detail:metrics.analyses.at(-1)}));
      if(phase==='FINAL'){renderEngineDetails();scheduleSave();}
      return true;
    };
    try {
      // A short, explicitly provisional calculation never supplies an imperative action.
      // Full study branches retain their specified budgets, so skip duplicate study work.
      if (!payload.aggressionStudy && (payload.samplingMode==='ADAPTIVE' || Number(payload.samples)>512)) {
        const started=performance.now();
        const preview=await requestJson('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,analysisPhase:'PREVIEW'}),signal:controller.signal});
        if(!await publish(preview,started,'PREVIEW') || preview.status!=='OK')return;
      }
      const started=performance.now();
      const data=await requestJson('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,analysisPhase:'FINAL'}),signal:controller.signal});
      await publish(data,started,'FINAL');
    } catch (error) {
      if(error.name==='AbortError')return;
      if(requestedRevision===inputRevision){lastAnalysis=null;const data={status:'ERROR',reason:`Calculation unavailable: ${error.message}`};renderResult(data,payload.street);quickAction(data);renderCharts();}
    } finally {
      analysisBusy=false;analysisController=null;analyzeButton.disabled=false;$('#quick-analyze').disabled=false;
      analyzeButton.innerHTML='Analyze street <span>↗</span>';$('#quick-analyze').innerHTML='Analyze hand <span>↗</span>';
      if(analysisQueued){analysisQueued=false;scheduleAnalysis();}
    }
  }
  async function newAnalysisHand(confirm = true) {
    if(multiwayBusy){toast('Wait for the action to be recorded before clearing the hand.');return;}
    if (confirm && (cards.state.slots.some(Boolean) || cards.isManualInvalid() || multiway?.events.length) && !window.confirm(multiway?'Start another Multiway hand and clear this hand’s cards and actions? Table settings will be kept.':'Clear the current hand’s cards and analyses? Saved history and settings will be preserved.')) return;
    if(multiway){try{await startMultiway({...multiway.config,heroCards:[]});}catch(error){toast(error.message);}return;}
    window.theibsOpponentInputs.reset();
    snapshots.splice(0); cards.reset(); invalidateAnalysis(); updateBoardHelp(); renderStreetCards(); renderCharts();
    quickAction(null); scheduleSave();
  }
  function showView(view, save = true) {
    if (!['analyze', 'train', 'history'].includes(view)) return;
    const changed = view !== activeView;
    if (changed) {
      multiwayRevision++; inputRevision++;
      clearTimeout(multiwayCardTimer); clearTimeout(analysisTimer);
      analysisController?.abort(); analysisQueued=false;
    }
    activeView = view;
    document.body.dataset.view=view;
    $('.analysis-rail').classList.toggle('hidden', view !== 'analyze');
    ['analyze', 'train', 'history'].forEach((name) => document.getElementById(`${name}-workspace`).classList.toggle('hidden', name !== view));
    document.querySelectorAll('.nav-tab').forEach((button) => {
      const selected = button.dataset.view === view; button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    $('#view-title').textContent = { analyze: 'Hand analysis', train: 'Practice & review', history: 'Training history' }[view];
    if (view === 'history') renderHistory();
    if (view === 'train') renderTrainingSession();
    if (save) scheduleSave();
    if(changed&&view==='analyze')scheduleAnalysis();
  }

  // ---- Same guided/challenge, coaching, legal-action and review flows as Theibs. ----
  function trainingCalculation(context = {}, notes = []) {
    const candidates=context.trainingEvaluation?.candidates;
    const rows=Array.isArray(candidates)&&candidates.length?candidates:Object.entries(context.ev||{}).filter(([action])=>(context.legalActions||[]).includes(action)).map(([action,item])=>({...item,action}));
    const rowsHtml=rows.map(item=>{const amount=item.targetStreetTotal??item.size,ev=item.ev,bounds=item.confidenceInterval95||item.conditionalEvEnvelope;return `<tr><td>${esc(actionWithSize(item.action,amount))}</td><td class="${ev>0?'positive':ev<0?'negative':''}">${ev==null?'—':(ev>0?'+':'')+money(ev)}</td><td>${bounds?esc(bounds.map(money).join(' to ')):'—'}</td></tr>`;}).join('');
    const details=[...new Set([...notes,...(context.assumptions||[]),...(context.warnings||[])])].filter(Boolean);
    return `<div class="training-calculation"><div class="training-calculation-metrics"><span>Equity <strong>${percent(context.equity?.value)}</strong></span><span>To call <strong>${money(context.amountToCall)}</strong></span></div><table class="ev-table"><thead><tr><th>Evaluated option</th><th>EV · chips</th><th>Estimated range</th></tr></thead><tbody>${rowsHtml}</tbody></table><details><summary>How it was calculated</summary>${details.map(text=>`<p>${esc(text)}</p>`).join('')}${context.equity?`<p>${esc(context.equity.samples)} simulations · equity ${percent(context.equity.value)}${context.equity.confidenceInterval95?' · range '+context.equity.confidenceInterval95.map(percent).join(' to '):''}.</p>`:''}</details></div>`;
  }
  function renderCoachAnswer(target, answer, context) {
    const summary=answer?.summary;
    if(!summary){target.textContent=answer?.answer||'Could not explain this hand.';return;}
    const details=[...(summary.details||[]),...(answer.warning?[answer.warning]:[])];
    target.innerHTML=`<div class="coach-summary"><strong class="coach-headline">${esc(summary.headline||'Your hand')}</strong>${summary.points?.length?`<ul class="coach-points">${summary.points.map(point=>`<li>${esc(point)}</li>`).join('')}</ul>`:''}<details class="coach-calculation"><summary>View calculation & assumptions</summary>${context?trainingCalculation(context,details):details.map(text=>`<p>${esc(text)}</p>`).join('')}</details></div>`;
  }
  function renderTrainingReview() {
    $('#training-review').innerHTML = trainingDecisions.length ? trainingDecisions.map((item) => {
      return `<details class="review-item"><summary><strong>${esc(streetName(item.context.street))}</strong> · ${esc(actionWithSize(item.chosenAction,item.chosenSize))}</summary><p>${esc(qualityName(item.quality.label))}${item.quality.evLoss == null ? '' : ` · EV difference ${money(item.quality.evLoss)} chips`}</p>${trainingCalculation(item.context,item.summary?.details||[])}</details>`;
    }).join('') : 'No decisions recorded in this hand.';
  }
  function renderTrainingSession() {
    $('#training-table').innerHTML = window.EssenceUI.trainingTable(trainingSession, cards.state.count);
    const playable = trainingSession && !trainingSession.finished;
    $('#training-actions').classList.toggle('hidden', !playable);
    if (playable) {
      $('#training-legal').textContent = '';
      $('#training-action-buttons').innerHTML = trainingSession.legalActions.map((action) => `<button type="button" data-action="${esc(action)}" ${trainingBusy ? 'disabled' : ''}>${esc(actionName(action))}</button>`).join('');
    const sizeInput = $('#training-size');
      const hasSize = trainingSession.legalActions.some((action) => ['BET', 'RAISE'].includes(action));
      $('.size-field').classList.toggle('hidden', !hasSize);
      sizeInput.min = trainingSession.minSize ?? 1; sizeInput.max = trainingSession.maxSize ?? 1;
      sizeInput.value = trainingSession.minSize ?? 1;
      $('#training-size-help').textContent = hasSize ? `Total this street: ${trainingSession.minSize} to ${trainingSession.maxSize}.` : '';
      const sizes=(trainingSession.sizeCandidates||[]).map(item=>typeof item==='object'?item.size:item).filter(Number.isFinite);
      $('#training-size-presets').innerHTML=hasSize?sizes.map(size=>`<button type="button" class="ghost-button" data-training-size="${esc(size)}" ${trainingBusy?'disabled':''}>${esc(money(size))}</button>`).join(''):'';
    }
    renderTrainingReview();
  }
  function showTrainingFeedback(feedback) {
    const target = $('#training-feedback'); target.classList.remove('hidden');
    const qualityLabel=qualityName(feedback.quality.label);
    target.innerHTML = `<div class="training-feedback-head"><span class="result-label">Your decision · ${esc(streetName(feedback.context.street))}</span><button type="button" class="text-button" id="open-training-details">View calculation</button></div><strong class="feedback-action">${esc(actionWithSize(feedback.chosenAction,feedback.chosenSize))}</strong><p>${esc(qualityLabel)}</p>${feedback.summary?.headline&&feedback.summary.headline!==qualityLabel?`<p class="feedback-conclusion">${esc(feedback.summary.headline)}</p>`:''}`;
    $('#training-details-text').innerHTML=trainingCalculation(feedback.context,feedback.summary?.details||[feedback.note].filter(Boolean));
    $('#open-training-details').onclick=()=>$('#training-details-dialog').showModal();
  }
  function setTrainingBusy(busy) {
    trainingBusy = busy;
    $('#training-clear').disabled = busy;
    $('#training-start').disabled = busy; $('#training-ask').disabled = busy;
    $('#training-size').disabled = busy;
    document.querySelectorAll('#training-action-buttons button,#training-size-presets button').forEach((item) => { item.disabled = busy; });
  }
  async function startTraining() {
    if (trainingBusy) return;
    if (trainingSession && !trainingSession.finished && !window.confirm('The simulated hand is still active. Start another? Recorded decisions remain in history.')) return;
    cancelCoach(); setTrainingBusy(true);
    try {
      const data = await postJson('/api/training/start', { variant: `PLO${cards.state.count}_HIGH`, mode: value('training-mode'), opponentStyle: value('training-style'), targetStreet: value('training-street'), seed: Number(value('training-seed')), startingStack: Number(value('training-stack')) });
      trainingSession = data.session; trainingDecisions = [];
      $('#training-feedback').classList.add('hidden'); $('#training-coach').textContent = '';
      renderTrainingSession(); scheduleSave();
    } catch (error) { $('#training-coach').textContent = error.message; toast(error.message); }
    finally { setTrainingBusy(false); }
  }
  async function actTraining(action) {
    if (!trainingSession || trainingSession.finished || trainingBusy) return;
    cancelCoach(); const sessionId = trainingSession.id; setTrainingBusy(true);
    try {
      const data = await postJson('/api/training/act', { sessionId, revision:trainingSession.revision, action, ...(trainingSession.legalActions.some(candidate=>['BET','RAISE'].includes(candidate)) ? { size: Number(value('training-size')) } : {}) });
      if (trainingSession?.id !== sessionId) return;
      trainingSession = data.session; trainingDecisions.push(data.feedback);
      showTrainingFeedback(data.feedback); renderTrainingSession(); $('#training-coach').textContent = ''; scheduleSave();
    } catch (error) { $('#training-coach').textContent = error.message; }
    finally { setTrainingBusy(false); }
  }
  function cancelCoach() {
    coachGeneration++; coachController?.abort(); coachController=null;
  }
  async function askCoach() {
    const target=$('#training-coach');
    if(!trainingSession||trainingSession.finished){target.textContent='Start an active hand to ask about the current decision.';return;}
    if(trainingBusy)return;
    cancelCoach(); const generation=coachGeneration, controller=coachController=new AbortController();
    const sessionId=trainingSession.id, revision=trainingSession.revision, question=value('training-question'), chosenSize=value('training-size');
    const current=()=>!controller.signal.aborted&&generation===coachGeneration&&trainingSession?.id===sessionId&&trainingSession?.revision===revision&&value('training-question')===question&&value('training-size')===chosenSize;
    setTrainingBusy(true); target.textContent='Calculating verified facts…';
    let local=null;
    try {
      local=await requestJson('/api/training/doubt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,revision,question,responseMode:'LOCAL_FIRST',...(trainingSession.legalActions.some(action=>['BET','RAISE'].includes(action))?{size:Number(chosenSize)}:{})}),signal:controller.signal});
      if(!current())return;
      if(local.status==='LOCKED')target.textContent=local.reason;
      else {renderCoachAnswer(target,local.answer,local.context);$('#coach-provider').textContent='Engine coach · calculated facts';}
    } catch(error) {if(current()&&error.name!=='AbortError')target.textContent=error.message;}
    finally {if(generation===coachGeneration||trainingBusy)setTrainingBusy(false);}
    // Numeric work is done. Optional language selection does not lock actions.
    if(local?.enrichment&&current()) {
      try {
        const extra=await requestJson('/api/coach/enrich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:local.enrichment.ticket}),signal:controller.signal});
        if(current()&&extra.analysisId===local.context.analysisId){renderCoachAnswer(target,extra.answer,extra.context);$('#coach-provider').textContent=extra.answer.provider==='ollama'?'Llama · verified fact selection':'Engine coach · calculated facts';}
      } catch { /* The immediate verified answer stays visible. */ }
    }
    if(coachController===controller)coachController=null;
  }
  async function renderHistory() {
    try {
      const data = await requestJson('/api/training/history'), summary = data.summary;
      $('#history-summary').innerHTML = [['Simulated hands', summary.hands], ['Wins / losses', `${summary.wins} / ${summary.losses}`], ['Recorded questions', summary.doubts], ['EV difference · '+(summary.averageEvLossUnit||'chips')+' · '+(summary.averageEvLossDenominator||0)+' evaluated', summary.averageEvLoss == null ? (summary.evLossCohorts?.length>1?'Separate cohorts':'—') : money(summary.averageEvLoss)]].map(([label, number]) => `<div class="panel">${esc(label)}<strong>${esc(number)}</strong></div>`).join('');
      const allOutcomes=data.outcomeTimeline||[], selectedCohort=allOutcomes.at(-1)?.cohortId;
      const cohortOutcomes=allOutcomes.filter(item=>item.cohortId===selectedCohort),timeline=cohortOutcomes.filter(item=>Number.isFinite(item.net));
      const unknownOutcomes=cohortOutcomes.length-timeline.length,otherCohorts=allOutcomes.length-cohortOutcomes.length;
      let cumulative = 0; const totals = timeline.map((item) => { cumulative += item.net; return cumulative; });
      if (totals.length) {
        const low = Math.min(0, ...totals), high = Math.max(0, ...totals), span = Math.max(1, high - low);
        const points = totals.map((number, index) => `${20 + (totals.length === 1 ? 150 : index * 300 / (totals.length - 1))},${145 - (number - low) * 120 / span}`).join(' ');
        $('#history-outcomes').innerHTML = `<h3>Known simulated results · play chips</h3><svg class="history-svg" viewBox="0 0 340 165" role="img" aria-label="Cumulative results line"><line x1="20" y1="145" x2="320" y2="145" stroke="currentColor" opacity="0.1"/><polyline points="${esc(points)}" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round"/></svg><div class="history-legend">${data.historyScope?.timelineTruncated?"Recent window · ":""}${timeline.length} known result(s) in latest cohort (${esc(cohortOutcomes.at(-1)?.cohort?.variant||"unknown variant")} · build ${esc(cohortOutcomes.at(-1)?.cohort?.engineBuild||"unknown")}) · ${otherCohorts} results from other cohorts excluded · ${unknownOutcomes} unknown, excluded · result ${money(cumulative)}. This is a subtotal of known simulated results, not decision quality or expected profit.</div>`;
      } else $('#history-outcomes').innerHTML = `<h3>Known simulated results · play chips</h3><p class="muted">${allOutcomes.length ? `${unknownOutcomes} unknown result(s) in latest cohort; no values plotted. ${otherCohorts} results from other cohorts excluded.` : 'Complete a simulated hand to start the timeline.'}</p>`;
      $('#history-recent').innerHTML = `<h3>Latest 20 decisions</h3>${data.recent.length ? data.recent.map((item) => `<details class="history-hand"><summary><span class="history-hand-cards">${(item.heroCards || []).map((c) => window.EssenceUI.canonicalCard(c, { small: true })).join('')}</span><span class="history-hand-meta">${esc(item.variant?.replace('_HIGH', '') || 'PLO5')} · ${esc(streetName(item.street))}</span><span class="history-hand-action">${esc(actionWithSize(item.chosenAction,item.chosenSize))}</span></summary><div><p>Your action: <strong>${esc(actionWithSize(item.chosenAction,item.chosenSize))}</strong> · highest calculated EV: <strong>${esc(actionWithSize(item.recommendedAction,item.recommendedSize))}</strong></p><p>${esc(qualityName(item.quality))}${item.evLoss == null ? '' : ` · EV difference ${money(item.evLoss)} chips`}</p><p class="micro">${esc(new Date(item.timestamp).toLocaleString('en-US'))} · ${esc(item.position || 'Position not recorded')}</p></div></details>`).join('') : '<p class="muted">No decisions recorded yet.</p>'}`;
      $('#history-trends').innerHTML = `<h3>Simulator trends</h3>${data.trends.map((item) => `<div class="trend-row"><strong>${esc(({ PASSIVE: 'Passive', AGGRESSIVE: 'Aggressive', MIXED: 'Mixed' })[item.opponentStyle])}</strong><p>Bets ${item.observedBets}/${item.opportunities} · smoothed rate ${percent(item.smoothedBetRate)} · confidence ${esc(item.confidence)}</p></div>`).join('')}<p class="micro">Simulated opponent data, not real players. The sample and model limit conclusions.</p><hr><p class="micro">Next exercise: ${esc(summary.nextExercise?.street || 'waiting for data')}. ${esc(summary.nextExercise?.reason || '')}</p>${summary.nextExercise ? `<button id="practice-suggestion" class="ghost-button" type="button" data-street="${esc(summary.nextExercise.street)}">Practice this street →</button>` : ''}`;
      if(data.observedHands?.length) $('#history-recent').insertAdjacentHTML('afterbegin', '<h3>Tracked hands</h3>'+data.observedHands.map(event=>{
        const hand=event.hand, hero=hand.state.players[hand.state.heroId];
        return `<details class="history-hand"><summary>${esc(new Date(event.timestamp).toLocaleString('en-US'))} · ${esc(hand.config.variant)} · ${hand.config.playerCount} players</summary><p>You: ${esc(hero.position)} · final stack ${money(hero.stack)}. Actions and result entered by the user.</p><pre>${esc(JSON.stringify(hand.events,null,2))}</pre></details>`;
      }).join(''));
    } catch (error) { $('#history-summary').innerHTML = `<div class="panel warning-text">History unavailable: ${esc(error.message)}</div>`; }
  }

  // ---- Workspace persistence belongs to the web service. ----
  function serializeWorkspace() {
    const fields = Object.fromEntries(FIELD_IDS.map((id) => { const el = document.getElementById(id); return [id, el.type === 'checkbox' ? el.checked : el.value]; }));
    return { schemaVersion: 1, keyboard: cards.state.snapshot(), manualText: cards.manualDraft(), fields,
      ui: { felt: document.body.dataset.felt, deck: document.body.dataset.deck, view: activeView, cardDisplayVersion: 2, workflowVersion: 1, sidebarCollapsed: document.body.dataset.sidebar === 'collapsed' },
      handFlow:null, legacyHandFlow, multiway, multiwayYesple, opponentInputs:window.theibsOpponentInputs.snapshot(),
      snapshots: [...snapshots], lastAnalysis, trainingSessionId: trainingSession?.id || null };
  }
  function scheduleSave() {
    if (!loaded || saveBlocked || window.theibsVoiceSessionContext?.().expired) return;
    saveDirty = true; $('#save-status').textContent = 'Pending changes…';
    clearTimeout(saveTimer); saveTimer = setTimeout(() => flushSave(), 300);
  }
  async function flushSave(keepalive = false) {
    clearTimeout(saveTimer);
    if (!loaded || saveBlocked || saveBusy || !saveDirty || window.theibsVoiceSessionContext?.().expired) return;
    saveBusy = true; saveDirty = false; $('#save-status').textContent = 'Saving draft…';
    const session = JSON.stringify(window.theibsVoiceSessionContext?.());
    try {
      const data = await postJson('/api/workspace', { workspace: serializeWorkspace(), expectedRevision: revision }, keepalive);
      revision = data.revision;
      $('#save-status').textContent = `Draft saved · ${new Date(data.updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      if(session!==JSON.stringify(window.theibsVoiceSessionContext?.())||window.theibsVoiceSessionContext?.().expired)return;
      saveDirty = true; $('#save-status').textContent = 'Unsaved draft';
      if (error.status === 409) { saveBlocked = true; toast(error.message); }
      else $('#save-status').title = error.message;
    } finally {
      saveBusy = false;
      if (saveDirty && !saveBlocked) { clearTimeout(saveTimer); saveTimer = setTimeout(() => flushSave(), 2000); }
    }
  }
  async function initialize() {
    try {
      await window.theibsAuth?.ensureSession?.();
      const initialRevision = inputRevision, initialSession = JSON.stringify(window.theibsVoiceSessionContext?.());
      const [saved, currentStatus] = await Promise.all([requestJson('/api/workspace'), requestJson('/api/status').catch(()=>null)]);
      if(initialSession!==JSON.stringify(window.theibsVoiceSessionContext?.())||window.theibsVoiceSessionContext?.().expired)throw Error('A sessão mudou antes de carregar o rascunho. Entre novamente para continuar.');
      engineStatus=currentStatus; renderEngineVersion(); revision = saved.revision;
      const editedBeforeLoad = inputRevision !== initialRevision;
      const workspace = saved.workspace;
      if (workspace && inputRevision === initialRevision) {
        for (const id of FIELD_IDS) {
          const el = document.getElementById(id), savedValue = workspace.fields?.[id];
          if (savedValue === undefined) continue;
          if (el.type === 'checkbox') el.checked = savedValue === true;
          else if (['string', 'number'].includes(typeof savedValue)) el.value = String(savedValue);
        }
        if (!cards.restore(workspace.keyboard)) throw new Error('Invalid card draft. The file was preserved.');
        cards.restoreManualDraft(workspace.manualText);
        for (const item of (workspace.snapshots || []).slice(0, 4)) if (['PREFLOP','FLOP','TURN','RIVER'].includes(item.street) && Number.isFinite(item.equity)) snapshots.push({...item,stale:item.stale||item.schemaVersion!==2||item.engineBuild!==engineStatus?.version});
        // Enable the requested four-suit palette once for existing drafts.
        // Subsequent changes to the deck selector remain the user's choice.
        applyAppearance((workspace.ui?.cardDisplayVersion || 0) < 2 ? 'cores' : workspace.ui?.deck, workspace.ui?.felt);
        window.theibsFocusUI.restore(workspace.ui?.sidebarCollapsed !== false);
        legacyHandFlow=workspace.legacyHandFlow||workspace.handFlow||null;
        if(workspace.multiway?.enabled){multiwayYesple=workspace.multiwayYesple||null;await runMultiway(()=>postJson('/api/multiway/state',{multiway:workspace.multiway}));}
        window.theibsOpponentInputs.restore(workspace.opponentInputs);
        updateTableContext(); updateBoardHelp(); renderStreetCards();
        try {
          snapshotModel.invalidate(snapshots, buildAnalysisPayload(true), engineStatus?.version);
          if (workspace.lastAnalysis?.data?.provenance?.schemaVersion === 2 && workspace.lastAnalysis.data.engineBuild === engineStatus?.version && workspace.lastAnalysis.signature === snapshotModel.stable(buildAnalysisPayload())) {
            lastAnalysis = workspace.lastAnalysis; renderResult(lastAnalysis.data, lastAnalysis.street); quickAction(lastAnalysis.data);
            renderCharts(snapshots.find((item) => item.street === lastAnalysis.street && !item.stale));
          }
        } catch { /* Incomplete drafts intentionally have no current recommendation. */ }
        if (workspace.trainingSessionId) {
          try {
            const reviewed = await postJson('/api/training/review', { sessionId: workspace.trainingSessionId });
            trainingSession = reviewed.session;
            trainingDecisions = reviewed.decisions.map((item) => ({ chosenAction: item.chosenAction, chosenSize:item.chosenSize, recommendedAction: item.recommendedAction, context: item.context, summary:item.summary, quality: item.qualityDetails || { label: item.quality, evLoss: item.evLoss } }));
            if (trainingDecisions.length) showTrainingFeedback(trainingDecisions.at(-1));
          } catch { $('#training-coach').textContent = 'The previous active session ended with the server. Recorded decisions remain in History. Start another hand to train.'; }
        }
        showView(workspace.ui?.view || 'analyze', false);
        $('#save-status').textContent = 'Draft restored';
      } else $('#save-status').textContent = 'Ready to save draft';
      loaded = true;
      if (editedBeforeLoad || (workspace && ((workspace.ui?.cardDisplayVersion || 0) < 2 || !workspace.ui?.workflowVersion))) scheduleSave();
      scheduleAnalysis();
    } catch (error) {
      saveBlocked = true; loaded = true; $('#save-status').textContent = 'Draft unavailable'; toast(error.message);
    }
    priorHero = cards.state.slots.slice(0, cards.state.count).join('|');
    renderMultiway();
    window.theibsCardPicker.close();
    renderTrainingSession();
    try {
      const status = await requestJson('/api/status');
      engineStatus=status;renderEngineVersion();renderEngineDetails();
      $('#engine-status').innerHTML = '<i></i>Web engine';
      $('#coach-provider').textContent = status.llmProvider === 'ollama' ? `Ollama configured · ${status.llmModel || 'model not specified'} · availability checked when asked` : 'Engine explanation · server enrichment optional';
    } catch { $('#engine-status').textContent = 'Engine unavailable'; }
  }

  for(const id of ['training-question','training-size'])document.getElementById(id).addEventListener('input',cancelCoach);
  form.addEventListener('submit', analyze);
  document.addEventListener('theibs:layout-preference', scheduleSave);
  document.addEventListener('theibs:voice-session-changed',()=>{
    multiwayRevision++;clearTimeout(multiwayCardTimer);clearTimeout(saveTimer);
    saveDirty=false;
    analysisController?.abort();cancelCoach();
    if(loaded)invalidateAnalysis();
  });
  form.addEventListener('input', (event) => {
    if(event.target.closest('#opponent-input-panel'))return;
    if (['heroCards','board','paste-cards'].includes(event.target.id)) return;
    invalidateAnalysis(); updateTableContext(); scheduleSave();
  });
  form.addEventListener('change', (event) => {
    if(event.target.closest('#opponent-input-panel'))return;
    if (['heroCards','board','paste-cards'].includes(event.target.id)) return;
    invalidateAnalysis(); updateTableContext(); scheduleSave();
  });
  document.addEventListener('theibs:cards-changed', (event) => {
    if(syncingMultiway)return;
    if(multiwayBusy&&multiwayCardSnapshot){syncingMultiway=true;cards.restore(multiwayCardSnapshot);syncingMultiway=false;renderMultiway();return;}
    if(multiway){
      const board=cards.state.cards().board.map(window.TheibsCards.toCanonical);
      if(JSON.stringify(board)!==JSON.stringify(multiwayState.board))syncMultiwayCards();
      if(cards.state.selected>=cards.state.count)cards.select(cards.state.count-1);
      renderMultiway();
      const privateCards=cards.state.cards().hero.map(window.TheibsCards.toCanonical);
      multiway={...multiway,config:{...multiway.config,heroCards:privateCards.length===cards.state.count?privateCards:[]}};
      multiwayAnalysis={available:false,reasons:[{message:'Updating your cards.'}]};
      invalidateAnalysis();
      clearTimeout(multiwayCardTimer);multiwayRevision++;const requested=multiwayRequestContext();
      multiwayCardTimer=setTimeout(async()=>{try{const data=await postJson('/api/multiway/state',{multiway});if(currentMultiwayRequest(requested)&&multiway)acceptMultiway(data);}catch(error){if(currentMultiwayRequest(requested))toast(error.message);}},180);
      scheduleSave();
      return;
    }
    const hero = cards.state.slots.slice(0, cards.state.count).join('|');
    if (priorHero && hero !== priorHero) snapshots.forEach((item) => { item.stale = true; });
    priorHero = hero;
    if(event.detail.source==='variant')$('#players').value=String(({6:5,5:6})[cards.state.count]||6);
    invalidateAnalysis(); updateTableContext(); renderMultiway();updateBoardHelp(); renderStreetCards();
    if (event.detail.source === 'variant' && !trainingSession) renderTrainingSession();
    scheduleSave();
  });
  document.querySelectorAll('.street-tab').forEach((button) => button.addEventListener('click', () => {
    if(multiway){toast('Reveal the next street using the Multiway control.');return;}
    cards.select(({ PREFLOP: 0, FLOP: cards.state.count, TURN: cards.state.count + 3, RIVER: cards.state.count + 4 })[button.dataset.street]);
    toast(`Selected input: ${streetName(button.dataset.street)}. The analyzed street is defined by the completed board.`);
  }));
  $('#new-hand').addEventListener('click', () => { if (activeView === 'train') startTraining(); else { showView('analyze'); newAnalysisHand(); } });
  $('#clear').addEventListener('click', () => newAnalysisHand());
  // A modifier is to shortcut only on release, if it was never part of to chord.
  const heldHandKeys=new Set();let soloHandShift=null;
  const handShortcutAllowed=target=>loaded&&activeView==='analyze'&&!multiwayBusy&&!document.querySelector('dialog[open]')&&
    !(target instanceof Element&&target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
  const cancelHandShift=()=>{soloHandShift=null;};
  document.addEventListener('keydown',event=>{
    const code=event.code||event.key;
    const solo=event.key==='Shift'&&!event.repeat&&!event.isComposing&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&heldHandKeys.size===0&&handShortcutAllowed(event.target);
    soloHandShift=solo?code:null;heldHandKeys.add(code);
  },true);
  document.addEventListener('keyup',event=>{
    const code=event.code||event.key;heldHandKeys.delete(code);
    if(event.key!=='Shift')return;
    const reset=soloHandShift===code&&heldHandKeys.size===0&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.isComposing&&handShortcutAllowed(event.target)&&handShortcutAllowed(document.activeElement);
    cancelHandShift();
    if(reset){event.preventDefault();cards.cancelPending();void newAnalysisHand(false);}
  },true);
  document.addEventListener('pointerdown',cancelHandShift,true);
  document.addEventListener('focusin',()=>{if(!handShortcutAllowed(document.activeElement))cancelHandShift();});
  window.addEventListener('blur',()=>{cancelHandShift();heldHandKeys.clear();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){cancelHandShift();heldHandKeys.clear();}});
  $('#new-hand').title='New hand · Shift alone in Analyze';
  $('#clear').title='Clear cards · Shift alone in Analyze';
  const shiftKeyHelp=document.createElement('dt');shiftKeyHelp.textContent='Shift alone';
  const shiftHelp=document.createElement('dd');shiftHelp.textContent='New hand in Analyze, without confirmation: clears your cards and board. In Multiway it also clears actions and keeps the table. Combinations such as Shift+letter and Shift+Tab still work normally.';
  $('.shortcut-list').prepend(shiftKeyHelp,shiftHelp);
  document.querySelectorAll('.nav-tab').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  document.querySelectorAll('[data-open-history]').forEach((button) => button.addEventListener('click', () => showView('history')));
  document.querySelectorAll('button[data-deck],button[data-felt]').forEach((button) => button.addEventListener('click', () => { applyAppearance(button.dataset.deck, button.dataset.felt); scheduleSave(); }));
  for (const id of FIELD_IDS.filter((id) => id.startsWith('training-'))) document.getElementById(id).addEventListener('change', scheduleSave);
  $('#training-start').addEventListener('click', startTraining);
  $('#training-clear').addEventListener('click', () => {
    if(trainingBusy)return;
    cancelCoach();
    if(trainingSession&&!trainingSession.finished&&!window.confirm('Clear the cards and end this training hand? Recorded decisions remain in History.'))return;
    trainingSession=null;trainingDecisions=[];
    $('#training-feedback').classList.add('hidden');$('#training-coach').textContent='';$('#training-question').value='';
    renderTrainingSession();scheduleSave();toast('Training cleared. Click New simulated hand to receive new cards.');
  });
  $('#training-action-buttons').addEventListener('click', (event) => { const button = event.target.closest('button[data-action]'); if (button && !button.disabled) actTraining(button.dataset.action); });
  $('#training-ask').addEventListener('click', askCoach);
  $('#training-size').addEventListener('input',()=>{if($('#training-coach').textContent)$('#training-coach').textContent='Size changed. Request to new analysis.';});
  $('#refresh-history').addEventListener('click', renderHistory);
  $('#history-trends').addEventListener('click', (event) => { const button = event.target.closest('#practice-suggestion'); if (button) { $('#training-street').value = button.dataset.street; showView('train'); startTraining(); } });
  $('#import-button').addEventListener('click', async () => {
    const output = $('#import-result'), button = $('#import-button'); button.disabled = true;
    try {
      const hands = JSON.parse(value('import-json'));
      const metadata = { source: value('import-source'), rights: value('import-rights'), rightsConfirmed: $('#import-confirm').checked };
      const data = await postJson('/api/import', { hands, metadata });
      output.textContent = `${data.accepted} hand(s) imported. ${data.rejected.length} rejected. ${data.rejected.map((item) => `#${item.index + 1}: ${item.reason}`).join(' ')}`;
      await renderHistory();
    } catch (error) { output.textContent = `Import not completed: ${error.message}`; }
    finally { button.disabled = false; }
  });
  $('#open-help').addEventListener('click', () => $('#help-dialog').showModal());
  $('#close-help').addEventListener('click', () => $('#help-dialog').close());
  document.addEventListener('keydown', (event) => { if (event.key === 'F1') { event.preventDefault(); if (!$('#help-dialog').open) $('#help-dialog').showModal(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(true); });
  document.addEventListener('theibs:llm-updated', event => {
    engineStatus={...engineStatus,llmProvider:event.detail.provider,llmModel:event.detail.model};renderEngineDetails();
    $('#coach-provider').textContent=event.detail.provider==='ollama'?`Llama · ${event.detail.model} · on demand`:'Engine explanation';
  });
  window.addEventListener('beforeunload', (event) => { if (saveDirty || saveBusy) { event.preventDefault(); event.returnValue = ''; } });
  const setupHost=document.createElement('section');setupHost.id='multiway-setup';$('#settings-dialog .dialog-content').prepend(setupHost);
  const nutsBadge=document.createElement('div');nutsBadge.id='nuts-badge';nutsBadge.className='nuts-badge';nutsBadge.hidden=true;nutsBadge.innerHTML='<span class="nuts-dot" aria-hidden="true"></span><span class="nuts-label">NUTS</span>';nutsBadge.setAttribute('role','status');nutsBadge.setAttribute('aria-label','Nuts: best possible hand on the current board. Ties are possible.');nutsBadge.title='Best possible hand on the current board. Ties are possible; future cards can change the hand.';$('#analyze-workspace .insight-panel').after(nutsBadge);
  const controlsHost=document.createElement('section');controlsHost.id='multiway-controls';$('.quick-decision').before(controlsHost);
  window.theibsMultiwayUI.init({getContext:multiwayContext,handlers:{start:startMultiway,act:event=>stepMultiway({type:'ACT',...event}),markFold:event=>stepMultiway({type:'MARK_FOLD',...event}),board:event=>stepMultiway({type:'BOARD',...event}),undo:()=>runMultiway(()=>postJson('/api/multiway/state',{multiway:{...multiway,events:multiway.events.slice(0,-1)}})),exit:exitMultiway}});
  window.theibsOpponentInputs.init({getContext:()=>({mode:multiway?'MULTIWAY':'SIMPLE',variant:`PLO${cards.state.count}_HIGH`,count:cards.state.count,position:multiway?multiway.config.heroPosition:value('position'),busy:multiwayBusy,players:multiwayState&&multiway?multiwayState.players.filter(p=>!p.hero).map((p,index)=>({seatId:p.id,label:`ADV. ${index+1} · ${p.position}`,folded:p.folded})):Array.from({length:Math.max(1,Number(value('players'))-1)},(_,seatId)=>({seatId,label:`ADV. ${seatId+1}`,folded:false}))}),onChange:()=>{invalidateAnalysis();scheduleSave();}});
  updateTableContext(); renderMultiway();renderStreetCards(); renderCharts(); updateBoardHelp(); renderTrainingSession();
  window.theibsApp = { ready: initialize(), getState: () => ({ activeView, analysisBusy, trainingBusy, lastAnalysis, trainingSession, multiway,multiwayState,multiwayAnalysis,multiwayBusy,snapshots: [...snapshots], saveBusy, saveDirty, saveBlocked }), flushSave, showView, getAnalysisInput: buildAnalysisPayload, getVoiceContext: () => ({ activeView, inputRevision, multiwayRevision, loaded, session: window.theibsVoiceSessionContext?.(), accessVisible: !document.getElementById('app-shell').hidden && !document.getElementById('app-shell').inert }), renderCoachAnswer };
})();
