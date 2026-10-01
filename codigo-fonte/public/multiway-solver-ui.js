(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TheibsMultiwaySolverUI = api;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict';
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  const END_PHASES = new Set(['COMPLETE','UNSUPPORTED','FAILED','CANCELLED']);
  const rangeLimit = seats => seats === 2 ? 24 : 3;
  const levelLimit = seats => seats === 2 ? 12 : 8;
  function normalizeComparisonPolicy(value) {
    if(root.TheibsBrowserSolverClient?.normalizeComparisonPolicy)return root.TheibsBrowserSolverClient.normalizeComparisonPolicy(clone(value));
    if(value!==undefined && (!value || typeof value!=='object' || Array.isArray(value)))throw Error('Use a valid comparison policy.');
    const nearEquivalenceBB=value?.nearEquivalenceBB===undefined?.01:value.nearEquivalenceBB;
    if(!Number.isFinite(nearEquivalenceBB) || nearEquivalenceBB<0 || value?.version!==undefined && value.version!=='THEIBS_COMPARISON_POLICY_V1' ||
      value?.unit!==undefined && value.unit!=='BB' || value?.scope!==undefined && value.scope!=='FULL_PRIOR_COMMITMENT')throw Error('Use a nonnegative finite near-equivalence threshold in bb for range commitments.');
    return {version:'THEIBS_COMPARISON_POLICY_V1',nearEquivalenceBB:nearEquivalenceBB===0?0:nearEquivalenceBB,unit:'BB',scope:'FULL_PRIOR_COMMITMENT'};
  }
  const blank = () => ({ phase:'IDLE',result:null,jobId:null,revisionKey:null,handId:null,budget:null,cache:null,timing:null,error:null,configured:false,updateVersion:null,
    runtime:null,runtimeLabel:null,runtimeReason:null,runtimeBudget:null,buildFingerprint:null,comparisonPolicy:null,comparisonPolicyKey:null,policyKey:null });
  let options = {}, initialized = false, study = null, view = blank(), generation = 0, pollTimer = null, pending = null;
  let lastPayload = null, lastBinding = null, lastSignature = null, dialog = null, openedHand = null, autoRefined = false,
    cancellation = Promise.resolve(), startAcknowledgement = Promise.resolve(), pendingRestore = false, automaticStandard = false;
  const automaticDeepAttempts = new Set();
  const transports = new Map();
  const isolatedOwner = `solver-page-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let browserClient = null, browserOwner = null, activeTransport = null, viewBinding = null, computePreference = null;
  function reserveAutomaticDeep(signature) {
    if (!signature || automaticDeepAttempts.has(signature)) return false;
    automaticDeepAttempts.add(signature);
    if (automaticDeepAttempts.size > 128) automaticDeepAttempts.delete(automaticDeepAttempts.values().next().value);
    return true;
  }
  const context = () => options.getContext?.() || {};
  const handId = value => value?.multiway?.handId || value?.state?.handId || null;
  const ownerBinding = () => typeof options.getOwner === 'function' ? options.getOwner() : isolatedOwner;
  const binding = value => JSON.stringify([handId(value),value?.state?.revisionKey || null,ownerBinding()]);
  const configured = value => Boolean(study?.handId && study.handId === handId(value) && study.ranges?.length === value?.multiway?.config?.playerCount);
  function current(mine, bound) { return mine === generation && binding(context()) === bound; }
  function emit() { view.configured = configured(context()); options.onChange?.(getState()); }
  function clearPoll() { if (pollTimer != null) root.clearTimeout(pollTimer); pollTimer = null; }
  function browserTransport(owner) {
    return {runtime:'BROWSER',runtimeLabel:'Browser compute',runtimeReason:null,request:async(url,init={})=>{
      if(init.signal?.aborted)throw Object.assign(Error('Solver request cancelled.'),{name:'AbortError'});
      const body=init.body ? JSON.parse(init.body) : {};
      if(url==='/api/multiway/solver/start')return browserClient.start(owner,{multiway:body.multiway,ranges:body.ranges,sizing:body.sizing,rake:body.rake,comparisonPolicy:body.comparisonPolicy},
        {budget:body.budget,revisionKey:body.expectedRevisionKey,handId:body.multiway?.handId,automatic:body.automatic===true});
      if(url==='/api/multiway/solver/cancel')return browserClient.cancel(owner,body.jobId);
      const match=url.match(/^\/api\/multiway\/solver\/jobs\/([^?]+)(?:\?(.*))?$/);
      if(!match)throw Error('Browser solver operation is unavailable.');
      const id=decodeURIComponent(match[1]),version=match[2]?.match(/(?:^|&)afterVersion=(\d+)/),wait=match[2]?.match(/(?:^|&)waitMs=(\d+)/);
      return version ? browserClient.wait(owner,id,{afterVersion:Number(version[1]),waitMs:wait?Number(wait[1]):1000,signal:init.signal}) : browserClient.get(owner,id);
    }};
  }
  function clearChangedOwner() {
    if(!browserOwner || browserOwner===ownerBinding())return false;
    browserClient?.clearOwner?.(browserOwner);browserOwner=null;computePreference=null;return true;
  }
  function selectTransport() {
    clearChangedOwner();
    const preference=String(computePreference || options.runtime || 'AUTO').toUpperCase();
    const browserCoverage=context().multiway?.config?.playerCount===2;
    if(preference==='BROWSER' && !browserCoverage)throw Error('Browser compute covers two original seats. Choose Server compute for this table.');
    if(preference!=='SERVER' && browserClient?.supported && browserCoverage){
      const owner=ownerBinding();
      if(typeof owner!=='string' || !owner.length)throw Error('The session changed. Sign in again before starting Browser compute.');
      if(browserOwner && browserOwner!==owner)browserClient.clearOwner(browserOwner);
      browserOwner=owner;
      return browserTransport(owner);
    }
    if(preference==='BROWSER')throw Error('Browser compute is unavailable in this browser. Choose Server compute.');
    if(typeof options.request!=='function')throw Error('Server compute is unavailable.');
    return {runtime:'SERVER',runtimeLabel:'Server compute',runtimeReason:preference==='SERVER'?null:browserClient?.supported && !browserCoverage
      ? 'Browser compute covers two original seats; using Server compute.' : 'Browser compute is unavailable; using Server compute.',request:options.request};
  }
  async function cancelRemote(jobId) {
    const transport=transports.get(jobId) || activeTransport;
    if (!jobId || !transport) return;
    const controller = new AbortController(),timer = root.setTimeout(()=>controller.abort(),3000);
    try { await transport.request('/api/multiway/solver/cancel', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId}),signal:controller.signal }); } catch {}
    finally { root.clearTimeout(timer); }
  }
  function queueCancel(jobId) { cancellation = Promise.all([cancellation,cancelRemote(jobId)]).then(()=>{}); }
  function stopRequest() { if (pending && !pending.solverStart) pending.abort(); pending = null; }
  function synchronizeStudy() {
    const currentHand = handId(context());
    if (!currentHand && pendingRestore) return;
    if (study && study.handId !== currentHand) study = null;
    pendingRestore = false;
  }
  function invalidate() {
    generation++; clearPoll(); stopRequest();
    if(!clearChangedOwner() && browserOwner)browserClient?.cancelOwner?.(browserOwner);
    const oldJob = view.jobId, oldPhase = view.phase;
    view = blank();viewBinding=null;lastPayload = null; lastBinding = null; lastSignature = null; autoRefined = false; automaticStandard = false;
    synchronizeStudy();
    if (oldJob && !END_PHASES.has(oldPhase)) queueCancel(oldJob);
    emit();
  }
  function getState() {
    const now = context();
    if (view.revisionKey && (view.revisionKey !== now.state?.revisionKey || view.handId !== handId(now) || viewBinding!==binding(now))) {
      if(!clearChangedOwner() && view.runtime==='BROWSER' && browserOwner)browserClient?.cancelOwner?.(browserOwner);
      return { ...blank(),configured:configured(now) };
    }
    return { ...clone(view),configured:configured(now) };
  }
  function failure(message, mine, bound) {
    if (!current(mine,bound)) return;
    view.phase = 'FAILED'; view.error = message || 'Solver unavailable.'; emit();
  }
  const timeoutMessage = operation => `Solver ${operation} timed out.${usableResult(view.result)?' Latest completed estimate retained.':''}`;
  async function request(url, init, mine, bound, selected = null) {
    const controller = new AbortController(); pending = controller;
    controller.solverStart = url === '/api/multiway/solver/start';
    const timer = root.setTimeout(() => controller.abort(), 10000);
    try {
      const transport=selected || transports.get(view.jobId) || activeTransport || selectTransport();
      const result = await transport.request(url,{...init,signal:controller.signal});
      if(controller.solverStart && result?.jobId){transports.set(result.jobId,transport);while(transports.size>64)transports.delete(transports.keys().next().value);}
      if (!current(mine,bound)) {
        // An HTTP abort cannot cancel a worker created before its acknowledgement
        // arrived. Capture that old job identity and stop it, without rendering.
        if (controller.solverStart && result?.jobId) queueCancel(result.jobId);
        return null;
      }
      return result ? {...result,runtime:result.runtime || transport.runtime,runtimeLabel:result.runtimeLabel || transport.runtimeLabel,runtimeReason:transport.runtimeReason} : null;
    } finally { root.clearTimeout(timer); if (pending === controller) pending = null; }
  }
  function accept(data, mine, bound) {
    if (!data || !current(mine,bound)) return false;
    const now = context();
    if (data.handId !== handId(now) || data.revisionKey !== now.state?.revisionKey || typeof data.jobId !== 'string') throw Error('Solver response does not match this decision.');
    for(const policy of [data.comparisonPolicy,data.result?.decisionOutcome?.policy])if(policy && JSON.stringify(normalizeComparisonPolicy(policy))!==JSON.stringify(view.comparisonPolicy))throw Error('Solver response comparison policy does not match this study.');
    const returnedPolicyKey=data.comparisonPolicyKey || data.policyKey || data.result?.comparisonPolicyKey;
    if(returnedPolicyKey && data.result?.decisionOutcome?.policyKey && returnedPolicyKey!==data.result.decisionOutcome.policyKey)throw Error('Solver comparison outcome does not match its policy.');
    view = { ...view,phase:data.phase,result:data.result || view.result,jobId:data.jobId,revisionKey:data.revisionKey,handId:data.handId,
      budget:data.budget,cache:data.cache || null,timing:data.timing || null,error:data.reason || null,
      runtime:data.runtime || view.runtime,runtimeLabel:data.runtimeLabel || view.runtimeLabel,runtimeReason:data.runtimeReason || null,
      runtimeBudget:data.runtimeBudget || null,buildFingerprint:data.buildFingerprint || null,
      comparisonPolicy:data.comparisonPolicy || view.comparisonPolicy,comparisonPolicyKey:data.comparisonPolicyKey || data.result?.comparisonPolicyKey || data.policyKey || view.comparisonPolicyKey,
      policyKey:data.comparisonPolicyKey || data.result?.comparisonPolicyKey || data.policyKey || view.policyKey,
      updateVersion:Number.isSafeInteger(data.updateVersion) && data.updateVersion >= 0 ? data.updateVersion : null };
    emit();
    return true;
  }
  function nextPoll(mine,bound) { clearPoll(); pollTimer = root.setTimeout(() => { pollTimer = null; void poll(mine,bound); },Number.isSafeInteger(view.updateVersion) ? 0 : 350); }
  async function completed(mine,bound) {
    if (!current(mine,bound)) return;
    const coveredBudgetStop = view.phase === 'UNSUPPORTED' && view.result?.reasons?.some(reason=>reason.code==='BUDGET_BEFORE_FIRST_STRATEGY');
    const needsRefinement = view.result?.adaptation
      ? view.result.adaptation.refinementRecommended === true
      : view.result?.convergence?.thresholdMet !== true;
    if ((view.phase === 'COMPLETE' && view.result?.actions?.length || coveredBudgetStop) && view.budget === 'FAST' && configured(context()) && !autoRefined && (coveredBudgetStop || needsRefinement)) {
      autoRefined = true;
      // Refinement has its own background job. Ordinary calculations and voice
      // have already completed their immediate work before evaluate is called.
      const payload = clone(lastPayload);
      await launch(payload,'STANDARD',true);
    } else if (view.runtime!=='BROWSER' && view.phase === 'COMPLETE' && view.budget === 'STANDARD' && automaticStandard &&
      context().multiway?.config?.playerCount === 2 && usableResult(view.result) &&
      ['TIME_RESOURCE_CEILING','ITERATION_RESOURCE_CEILING'].includes(view.result?.adaptation?.stopReason) &&
      view.result?.adaptation?.refinementRecommended === true && configured(context()) &&
      reserveAutomaticDeep(lastSignature)) {
      // One bounded continuation for this exact hand, revision and study. Keep
      // the STANDARD result visible while DEEP starts; a stale binding cannot
      // publish the later result or schedule another continuation.
      autoRefined = true;
      const payload = clone(lastPayload);
      await launch(payload,'DEEP',true,false,true);
    }
  }
  async function poll(mine,bound) {
    if (!current(mine,bound) || !view.jobId) return;
    try {
      const version = view.updateVersion;
      const suffix = Number.isSafeInteger(version) ? `?afterVersion=${version}&waitMs=1000` : '';
      const data = await request(`/api/multiway/solver/jobs/${encodeURIComponent(view.jobId)}${suffix}`,{method:'GET'},mine,bound);
      if (!accept(data,mine,bound)) return;
      if (END_PHASES.has(view.phase)) await completed(mine,bound); else nextPoll(mine,bound);
    } catch (error) { failure(error.name === 'AbortError' ? timeoutMessage('status') : error.message,mine,bound); }
  }
  function feeFromPayload(payload) {
    const model = payload?.multiwayEvaluation || {};
    if (model.rakeSchedule) return clone(model.rakeSchedule);
    if (typeof model.rake === 'number' && Number.isFinite(model.rake)) return {type:'FIXED',amount:model.rake};
    if (model.assumeNoRake === true) return {type:'NONE',basis:model.feeBasis === 'BEFORE_FEES' ? 'BEFORE_FEES' : 'NO_FEES'};
    return null;
  }
  async function launch(payload,budget,refinement = false,force = false,automatic = false) {
    const now = context(), bound = binding(now);
    if (!initialized || !now.multiway?.enabled || !now.state?.revisionKey) return getState();
    if (!payload?.multiway || JSON.stringify(payload.multiway) !== JSON.stringify(now.multiway)) return getState();
    if (!['FAST','STANDARD','DEEP'].includes(budget)) throw Error('Choose FAST, STANDARD or DEEP.');
    let transport,comparisonPolicy;
    try{transport=selectTransport();comparisonPolicy=normalizeComparisonPolicy(configured(now)?study.comparisonPolicy:payload.comparisonPolicy);}catch(error){view.phase='FAILED';view.error=error.message;emit();return getState();}
    synchronizeStudy();
    const signature = JSON.stringify([bound,configured(now) ? study : null,feeFromPayload(payload),transport.runtime,comparisonPolicy]);
    if (!force && signature === lastSignature && (budget === view.budget || budget === 'FAST' || automatic && budget === 'STANDARD' && view.budget === 'DEEP') && !['IDLE','FAILED','CANCELLED'].includes(view.phase)) return getState();
    const samePreviousContext=signature===lastSignature && viewBinding===bound;
    lastSignature = signature;
    automaticStandard = automatic === true && budget === 'STANDARD' && !refinement;
    const oldJob = view.jobId, oldPhase = view.phase;
    generation++; clearPoll(); stopRequest();
    if (oldJob && !END_PHASES.has(oldPhase)) queueCancel(oldJob);
    const mine = generation;
    if (!refinement) autoRefined = false;
    // Keep only the declared fee basis and ledger. Profiles, transcripts and
    // private notes never enter the reference solver request.
    lastPayload = {multiway:clone(payload.multiway),comparisonPolicy:clone(comparisonPolicy),multiwayEvaluation:{
      ...(payload.multiwayEvaluation?.rakeSchedule ? {rakeSchedule:clone(payload.multiwayEvaluation.rakeSchedule)} : {}),
      ...(payload.multiwayEvaluation?.rake !== undefined ? {rake:payload.multiwayEvaluation.rake} : {}),
      ...(payload.multiwayEvaluation?.assumeNoRake === true ? {assumeNoRake:true} : {}),
      ...(payload.multiwayEvaluation?.feeBasis ? {feeBasis:payload.multiwayEvaluation.feeBasis} : {})}};
    lastBinding = bound;
    const previous = samePreviousContext && view.revisionKey === now.state.revisionKey && view.handId === handId(now) ? view.result : null;
    viewBinding=bound;activeTransport=transport;
    view = {...blank(),phase:'QUEUED',result:previous,revisionKey:now.state.revisionKey,handId:handId(now),budget,
      runtime:transport.runtime,runtimeLabel:transport.runtimeLabel,runtimeReason:transport.runtimeReason,comparisonPolicy}; emit();
    try {
      // Finish cancellation before starting an identical cache-key job; an
      // outstanding cancel must never stop a newly deduplicated request.
      await startAcknowledgement;
      await cancellation;
      if (!current(mine,bound)) return getState();
      const declared = configured(now);
      const acknowledgement = request('/api/multiway/solver/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        multiway:lastPayload.multiway,expectedRevisionKey:now.state.revisionKey,ranges:declared ? clone(study.ranges) : [],
        sizing:declared ? clone(study.sizing) : null,rake:feeFromPayload(lastPayload),comparisonPolicy,budget,automatic
      })},mine,bound,transport);
      startAcknowledgement = acknowledgement.then(()=>{},()=>{});
      const data = await acknowledgement;
      if (!accept(data,mine,bound)) return getState();
      if (END_PHASES.has(view.phase)) await completed(mine,bound); else nextPoll(mine,bound);
    } catch (error) { failure(error.name === 'AbortError' ? timeoutMessage('request') : error.message,mine,bound); }
    return getState();
  }
  async function evaluate(payload,settings = {}) {
    const budget=settings.budget === undefined ? 'STANDARD' : settings.budget;
    const automatic=settings.automatic === true || settings.automatic === undefined && settings.budget === undefined;
    return launch(payload,budget,false,false,automatic);
  }
  function usableResult(result) {
    if (!result || !['SOLVED','APPROXIMATE','REFINING'].includes(result.status) ||
      result.status === 'SOLVED' && result.qualification?.solvedSubgame !== true || typeof result.method !== 'string' || !result.method) return false;
    const actions = result.actions, expected = result.abstraction?.rootActions;
    if (!Array.isArray(actions) || !actions.length || !Array.isArray(expected) || actions.length !== expected.length) return false;
    const ids = new Set();
    for (const action of actions) {
      const declared = expected.find(item=>item.id===action.id);
      if (!declared || ids.has(action.id) || declared.action !== action.action || declared.size !== action.size ||
        !['FOLD','CHECK','CALL','BET','RAISE'].includes(action.action) || !Number.isFinite(action.frequency) || action.frequency < 0 || action.frequency > 1 || !Number.isFinite(action.evBB)) return false;
      ids.add(action.id);
    }
    return Math.abs(actions.reduce((sum,action)=>sum+action.frequency,0)-1) <= 1e-6;
  }
  function decisionSnapshot() {
    const currentView = getState();
    if (!usableResult(currentView.result)) return null;
    return clone({handId:currentView.handId,revisionKey:currentView.revisionKey,budget:currentView.budget,phase:currentView.phase,
      ...currentView.result,cache:currentView.cache,timing:currentView.timing,runtime:currentView.runtime,runtimeLabel:currentView.runtimeLabel,
      runtimeReason:currentView.runtimeReason,runtimeBudget:currentView.runtimeBudget,buildFingerprint:currentView.buildFingerprint,
      comparisonPolicy:currentView.comparisonPolicy,comparisonPolicyKey:currentView.comparisonPolicyKey,policyKey:currentView.policyKey});
  }
  function serialize() { return study && (configured(context()) || pendingRestore) ? clone(study) : null; }
  function restore(saved) {
    if (!saved) { study = null;pendingRestore=false; return; }
    // Full domain, ledger and blocker checks run in the selected solver runtime.
    if (saved.schemaVersion !== 1 || typeof saved.handId !== 'string' || !['KEYBOARD','CANONICAL'].includes(saved.notation) ||
      !Array.isArray(saved.ranges) || saved.ranges.length < 2 || saved.ranges.length > 3 || !saved.sizing) return;
    if (saved.ranges.some(range => !Number.isInteger(range.seatId) || range.complete !== true || !Array.isArray(range.combos) ||
      range.combos.length < 1 || range.combos.length > rangeLimit(saved.ranges.length) || range.combos.some(combo => !Array.isArray(combo.cards) || combo.cards.length !== 5 || !Number.isFinite(combo.weight) || combo.weight <= 0))) return;
    if (!['MIN_MID_MAX','EXPLICIT_TOTALS'].includes(saved.sizing.type) || !Number.isInteger(saved.sizing.maxAggressions) || saved.sizing.maxAggressions < 0 || saved.sizing.maxAggressions > 3 ||
      saved.sizing.type === 'EXPLICIT_TOTALS' && (!Array.isArray(saved.sizing.levels) || saved.sizing.levels.length < 1 || saved.sizing.levels.length > levelLimit(saved.ranges.length) || saved.sizing.levels.some(level => !Number.isFinite(level) || level <= 0))) return;
    let comparisonPolicy;try{comparisonPolicy=normalizeComparisonPolicy(saved.comparisonPolicy);}catch{return;}
    study = {...clone(saved),comparisonPolicy};pendingRestore=true;
  }
  function parseRange(text,notation,maxCombos = 3) {
    const lines = String(text || '').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    if (!lines.length || lines.length > maxCombos) throw Error(`Enter one to ${maxCombos} complete combinations for each seat.`);
    const seen = new Set();
    return lines.map((line,index) => {
      const parts = line.split('|');
      if (parts.length > 2) throw Error(`Line ${index+1}: use one optional weight after |.`);
      const weight = parts.length === 1 ? 1 : Number(parts[1].trim());
      if (!Number.isFinite(weight) || weight <= 0 || weight > 1e12) throw Error(`Line ${index+1}: use a positive weight.`);
      const compact = parts[0].replace(/[\s,]+/g,'').toUpperCase();
      const expression = notation === 'CANONICAL' ? /(10|[AKQJTD2-9])([SHDC])/g : /(10|[AKQJTD2-9])([ECOP])/g;
      const matches = [...compact.matchAll(expression)];
      if (matches.map(match=>match[0]).join('') !== compact || matches.length !== 5) throw Error(`Line ${index+1}: enter exactly five cards using the selected notation.`);
      const suits = notation === 'CANONICAL' ? {S:'s',H:'h',D:'d',C:'c'} : {E:'s',C:'h',O:'d',P:'c'};
      const cards = matches.map(match => `${['10','D'].includes(match[1])?'T':match[1]}${suits[match[2]]}`);
      if (new Set(cards).size !== 5) throw Error(`Line ${index+1}: a card appears twice.`);
      const key = [...cards].sort().join(',');
      if (seen.has(key)) throw Error(`Line ${index+1}: this combination already appears in the range.`);
      seen.add(key); return {cards,weight};
    });
  }
  function rangeText(range,notation) {
    const suits = notation === 'CANONICAL' ? {s:'s',h:'h',d:'d',c:'c'} : {s:'E',h:'C',d:'O',c:'P'};
    return (range?.combos || []).map(combo=>`${combo.cards.map(card=>card.slice(0,-1)+suits[card.slice(-1)]).join(' ')}${combo.weight === 1 ? '' : ` | ${combo.weight}`}`).join('\n');
  }
  function dialogError(message) {
    const node = dialog?.querySelector('[data-solver-error]');
    if (node) { node.textContent = message || ''; node.hidden = !message; }
  }
  function updateNotation() {
    const notation = dialog.querySelector('[name=notation]').value;
    dialog.querySelector('[data-solver-notation]').textContent = notation === 'KEYBOARD' ? 'E = spades · C = hearts · O = diamonds · P = clubs' : 's = spades · h = hearts · d = diamonds · c = clubs';
    for (const area of dialog.querySelectorAll('[data-solver-range]')) area.placeholder = notation === 'KEYBOARD' ? 'AE KC QO JP 9E | 1' : 'As Kh Qd Jc 9s | 1';
  }
  function openSetup() {
    if (!root.document) return;
    const now = context();
    if (!now.multiway?.enabled) return;
    if (dialog?.open) { dialog.focus(); return; }
    const seats = now.state?.players || [], matches = configured(now), notation = matches ? study.notation : 'KEYBOARD';
    openedHand = handId(now);
    if (!dialog) {
      dialog = root.document.createElement('dialog');dialog.id = 'mw-solver-dialog';dialog.className = 'multiway-dialog mw-solver-dialog';
      dialog.setAttribute('aria-labelledby','mw-solver-title');root.document.body.append(dialog);
    }
    const supported = now.multiway.config.variant === 'PLO5_HIGH' && seats.length >= 2 && seats.length <= 3;
    const browserAvailable=browserClient?.supported===true && seats.length===2;
    const selectedCompute=String(computePreference || options.runtime || (browserAvailable?'BROWSER':'SERVER')).toUpperCase()==='SERVER'?'SERVER':browserAvailable?'BROWSER':'SERVER';
    const maxCombos = rangeLimit(seats.length), maxLevels = levelLimit(seats.length);
    dialog.innerHTML = `<div class="multiway-dialog-head"><h2 id="mw-solver-title">Solver study</h2><button type="button" class="text-button" data-solver-close aria-label="Close solver study">×</button></div>
      <form data-solver-form><p class="mw-solver-intro">A finite PLO5 river study for two or three seats. Your normal game and approximate EV remain available.</p>
      ${supported ? '' : '<p class="multiway-error">This table is outside the current solver coverage. Use PLO5 with two or three original seats.</p>'}
      <label>Compute location<select name="compute"><option value="BROWSER"${selectedCompute==='BROWSER'?' selected':''}${browserAvailable?'':' disabled'}>Browser compute · this device</option><option value="SERVER"${selectedCompute==='SERVER'?' selected':''}>Server compute · sends study ranges</option></select></label>
      <label>Card notation<select name="notation"><option value="KEYBOARD"${notation==='KEYBOARD'?' selected':''}>Keyboard · E / C / O / P</option><option value="CANONICAL"${notation==='CANONICAL'?' selected':''}>Standard · s / h / d / c</option></select></label>
      <p class="mw-solver-hint" data-solver-notation></p>
      <div class="mw-solver-ranges">${seats.map(seat=>`<label><span>${esc(seat.hero?'You':seat.name || seat.seatName || `Seat ${seat.id+1}`)} <small>${esc(seat.position)}${seat.folded?' · folded':''}</small></span><textarea rows="${seats.length===2?5:3}" data-solver-range="${seat.id}" aria-label="${esc(seat.hero?'Your':seat.name || `Seat ${seat.id+1}`)} complete study range" autocomplete="off" autocapitalize="characters" spellcheck="false" required${supported?'':' disabled'}>${esc(rangeText(matches ? study.ranges.find(range=>range.seatId===seat.id) : null,notation))}</textarea></label>`).join('')}</div>
      <p class="mw-solver-hint">One five-card combination per line, up to ${maxCombos} per seat. Add <code>| weight</code> if needed; omitted weights are 1. Include your current cards within your declared range. The declared tree may still exceed the solver's safety limits.</p>
      <div class="mw-solver-grid"><label>Sizing abstraction<select name="sizing"><option value="MIN_MID_MAX">Minimum / middle / maximum</option><option value="EXPLICIT_TOTALS">Specific street totals</option></select></label><label>Additional bets / raises<select name="aggressions"><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label></div>
      <label data-solver-levels hidden>Street totals · chips<input name="levels" type="text" inputmode="decimal" placeholder="2, 4, 6" autocomplete="off"></label>
      <details class="mw-solver-limits"><summary>Study scope & privacy</summary><p>These are explicitly chosen study ranges, including folded seats. They are not observed cards or learned statistics. Every player knows the declared ranges; a one-combination range reveals that seat’s hand within the study.</p><p>The sizing selection and aggression limit restrict the tree. Convergence applies to this river subgame only, not a full-hand GTO solution. Room fees follow the current calculation basis.</p><label>Near-equivalence threshold · bb<input name="nearEquivalenceBB" type="number" min="0" step="any" value="${normalizeComparisonPolicy(matches?study.comparisonPolicy:undefined).nearEquivalenceBB}" required></label><p>This threshold compares ex-ante commitments across the full supplied prior (FULL_PRIOR_COMMITMENT). It does not imply equal EV for your current hand. It changes the comparison policy, not the game tree or mathematical bounds.</p><p>Browser compute runs the river study on this device and currently covers two original seats. Server compute sends the entered combinations and public hand ledger to the server and covers two or three original seats. No voice transcripts, profile notes or inferred ranges are included. This setup resets with the next hand.</p></details>
      <label class="mw-solver-confirm"><input name="complete" type="checkbox" required><span>I define these as the complete ranges for this study.</span></label>
      <p class="multiway-error" data-solver-error role="alert" hidden></p><div class="mw-solver-actions"><button type="button" class="ghost-button" data-solver-clear${matches?'':' hidden'}>Clear study</button><button type="submit" class="primary-button"${supported?'':' disabled'}>Save study</button></div></form>`;
    const form = dialog.querySelector('form');
    form.elements.sizing.value = matches ? study.sizing.type : 'MIN_MID_MAX';
    form.elements.aggressions.value = String(matches ? study.sizing.maxAggressions : 1);
    form.elements.levels.value = matches && study.sizing.levels ? study.sizing.levels.join(', ') : '';
    const sizingChanged = () => { const show = form.elements.sizing.value === 'EXPLICIT_TOTALS'; dialog.querySelector('[data-solver-levels]').hidden = !show;form.elements.levels.required=show; };
    form.elements.sizing.onchange = sizingChanged;sizingChanged();updateNotation();
    form.elements.notation.onchange = () => { updateNotation();dialogError('The notation changed. Review the entered cards before saving.'); };
    dialog.querySelector('[data-solver-close]').onclick = () => dialog.close();
    dialog.querySelector('[data-solver-clear]').onclick = () => { study = null; invalidate();dialog.close(); };
    form.onsubmit = event => {
      event.preventDefault();dialogError('');
      if (handId(context()) !== openedHand) { dialogError('The hand changed. Reopen Solver study for the current table.');return; }
      try {
        const ranges = seats.map(seat=>({seatId:seat.id,complete:true,source:'USER_DEFINED_COMPLETE_STUDY',combos:parseRange(dialog.querySelector(`[data-solver-range="${seat.id}"]`).value,form.elements.notation.value,maxCombos)}));
        const sizing = {type:form.elements.sizing.value,maxAggressions:Number(form.elements.aggressions.value)};
        if (sizing.type === 'EXPLICIT_TOTALS') {
          const levels = form.elements.levels.value.split(/[\s,;]+/).filter(Boolean).map(Number);
          if (!levels.length || levels.length>maxLevels || levels.some(value=>!Number.isFinite(value)||value<=0||Math.abs(value*100-Math.round(value*100))>1e-7)) throw Error(`Enter one to ${maxLevels} positive street totals with at most two decimals.`);
          sizing.levels = [...new Set(levels)].sort((a,b)=>a-b);
        }
        if (!form.elements.complete.checked) throw Error('Confirm that these are the complete ranges for this study.');
        if(!form.elements.nearEquivalenceBB.value.trim())throw Error('Enter a near-equivalence threshold of zero or more bb.');
        const comparisonPolicy=normalizeComparisonPolicy({nearEquivalenceBB:Number(form.elements.nearEquivalenceBB.value)});
        const payload = lastBinding === binding(context()) ? clone(lastPayload) : null;
        invalidate();computePreference=form.elements.compute.value;study = {schemaVersion:1,handId:openedHand,notation:form.elements.notation.value,ranges,sizing,comparisonPolicy};emit();dialog.close();
        if (payload) void evaluate(payload);
      } catch (error) { dialogError(error.message); }
    };
    dialog.showModal();
  }
  async function manualBudget(budget) {
    if (!configured(context())) { openSetup();return; }
    if (!lastPayload || lastBinding !== binding(context())) { view.error = 'Calculate the current decision before refining this study.';emit();return; }
    await launch(clone(lastPayload),budget,false,true);
  }
  function cancel() {
    const id = view.jobId;generation++;clearPoll();stopRequest();
    if (automaticStandard) reserveAutomaticDeep(lastSignature);
    automaticStandard=false;
    view.phase='CANCELLED';view.error=null;autoRefined=true;emit();queueCancel(id);
    if(browserOwner)browserClient?.cancelOwner?.(browserOwner);
  }
  function clearOwner() {if(browserOwner)browserClient?.clearOwner?.(browserOwner);browserOwner=null;computePreference=null;transports.clear();activeTransport=null;invalidate();}
  function setRuntime(runtime) {if(!['BROWSER','SERVER','AUTO'].includes(String(runtime).toUpperCase()))throw Error('Choose Browser compute or Server compute.');invalidate();computePreference=String(runtime).toUpperCase();}
  function init(next = {}) {
    options = {...options,...next};
    if(!browserClient)browserClient=options.browserClient || root.TheibsBrowserSolverClient?.create?.(options.browserOptions || {});
    if (initialized) return api;
    initialized = true;
    root.document?.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-mw-solver-setup],[data-mw-solver-standard],[data-mw-solver-deep],[data-mw-solver-cancel]');
      if (!button || button.disabled) return;
      event.preventDefault();
      if (button.hasAttribute('data-mw-solver-setup')) openSetup();
      else if (button.hasAttribute('data-mw-solver-standard')) void manualBudget('STANDARD');
      else if (button.hasAttribute('data-mw-solver-deep')) void manualBudget('DEEP');
      else cancel();
    });
    return api;
  }
  const api = {init,evaluate,invalidate,getState,decisionSnapshot,serialize,restore,openSetup,clearOwner,setRuntime,
    _testing:{parseRange,rangeText,feeFromPayload,binding,usableResult,normalizeComparisonPolicy,cancel}};
  return api;
});
