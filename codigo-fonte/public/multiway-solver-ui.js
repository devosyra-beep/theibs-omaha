(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TheibsMultiwaySolverUI = api;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict';
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  const END_PHASES = new Set(['COMPLETE','UNSUPPORTED','FAILED','CANCELLED']);
  const rangeLimit = seats => seats === 2 ? 32 : 3;
  const levelLimit = seats => seats === 2 ? 12 : 8;
  const MAX_SCENARIOS = 3;
  const text = (value, maximum, fallback = '') => typeof value === 'string' ? value.trim().slice(0,maximum) || fallback : fallback;
  const idleComparison = () => ({phase:'IDLE',entries:[],binding:null,error:null,elapsedMs:0,report:null});
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
  let comparisonRunner = null, comparisonView = idleComparison(), comparisonTransport = null, comparisonBinding = null, studyOwner = null;
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
  const configured = value => Boolean(study?.handId && typeof ownerBinding()==='string' && ownerBinding().length && (studyOwner===null || studyOwner===ownerBinding()) && study.handId === handId(value) && study.ranges?.length === value?.multiway?.config?.playerCount);
  const activeScenario = () => study?.scenarios?.find(item=>item.id===study.activeScenarioId) || null;
  const mathematicalStudy = () => study ? {ranges:study.ranges,sizing:study.sizing} : null;
  function studyProvenance() {
    const active=activeScenario();
    return active && configured(context()) ? clone({scenarioId:active.id,name:active.name,treeName:active.treeName,
      rationaleBySeat:active.rationaleBySeat,...(active.rangeOriginsBySeat?{rangeOriginsBySeat:active.rangeOriginsBySeat}:{}),scenarioCount:study.scenarios.length,source:'USER_DECLARED_HYPOTHESIS'}) : null;
  }
  function comparisonCurrent(value) {
    return Boolean(value && comparisonBinding && value.token===comparisonBinding.token && value.handId===handId(context()) &&
      value.revisionKey===context().state?.revisionKey && value.token===binding(context()));
  }
  function cancelComparison() {
    if(!comparisonRunner)return Promise.resolve();
    const stopped=Promise.resolve(comparisonRunner.cancel()).catch(()=>{});
    cancellation=Promise.all([cancellation,stopped]).then(()=>{});
    return stopped;
  }
  function getComparisonState() { return comparisonCurrent(comparisonView.binding) ? clone(comparisonView) : idleComparison(); }
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
    if(studyOwner!==null && studyOwner!==ownerBinding()){
      study=null;studyOwner=null;pendingRestore=false;void cancelComparison();comparisonBinding=null;comparisonView=idleComparison();
    }
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
    if (study && study.handId !== currentHand) {study = null;studyOwner=null;}
    pendingRestore = false;
  }
  function invalidate() {
    void cancelComparison();comparisonBinding=null;comparisonView=idleComparison();
    generation++; clearPoll(); stopRequest();
    if(!clearChangedOwner() && browserOwner)browserClient?.cancelOwner?.(browserOwner);
    const oldJob = view.jobId, oldPhase = view.phase;
    view = blank();viewBinding=null;lastPayload = null; lastBinding = null; lastSignature = null; autoRefined = false; automaticStandard = false;
    synchronizeStudy();
    if (oldJob && !END_PHASES.has(oldPhase)) queueCancel(oldJob);
    emit();
  }
  function getState() {
    clearChangedOwner();
    const now = context();
    if (view.revisionKey && (view.revisionKey !== now.state?.revisionKey || view.handId !== handId(now) || viewBinding!==binding(now))) {
      if(!clearChangedOwner() && view.runtime==='BROWSER' && browserOwner)browserClient?.cancelOwner?.(browserOwner);
      return { ...blank(),configured:configured(now) };
    }
    return { ...clone(view),configured:configured(now),studyProvenance:studyProvenance(),comparisonPhase:getComparisonState().phase };
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
    void cancelComparison();
    let transport,comparisonPolicy;
    try{transport=selectTransport();comparisonPolicy=normalizeComparisonPolicy(configured(now)?study.comparisonPolicy:payload.comparisonPolicy);}catch(error){view.phase='FAILED';view.error=error.message;emit();return getState();}
    synchronizeStudy();
    const signature = JSON.stringify([bound,configured(now) ? mathematicalStudy() : null,feeFromPayload(payload),transport.runtime,comparisonPolicy]);
    if(signature!==lastSignature){comparisonBinding=null;comparisonView=idleComparison();}
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
      comparisonPolicy:currentView.comparisonPolicy,comparisonPolicyKey:currentView.comparisonPolicyKey,policyKey:currentView.policyKey,
      studyProvenance:currentView.studyProvenance});
  }
  function serialize() { clearChangedOwner();return study && (configured(context()) || pendingRestore) ? clone(study) : null; }
  function restore(saved) {
    if (!saved) { study = null;studyOwner=null;pendingRestore=false; return; }
    if(initialized && (typeof ownerBinding()!=='string' || !ownerBinding().length)){study=null;studyOwner=null;pendingRestore=false;return;}
    // Full domain, ledger and blocker checks run in the selected solver runtime.
    if (saved.schemaVersion !== 1 || typeof saved.handId !== 'string' || !['KEYBOARD','CANONICAL'].includes(saved.notation) ||
      !Array.isArray(saved.ranges) || saved.ranges.length < 2 || saved.ranges.length > 3 || !saved.sizing) return;
    if (saved.ranges.some(range => !Number.isInteger(range.seatId) || range.complete !== true || !Array.isArray(range.combos) ||
      range.combos.length < 1 || range.combos.length > rangeLimit(saved.ranges.length) || range.combos.some(combo => !Array.isArray(combo.cards) || combo.cards.length !== 5 || !Number.isFinite(combo.weight) || combo.weight <= 0))) return;
    if (!['MIN_MID_MAX','EXPLICIT_TOTALS','ALL_LEGAL_TOTALS'].includes(saved.sizing.type) || !Number.isInteger(saved.sizing.maxAggressions) || saved.sizing.maxAggressions < 0 || saved.sizing.maxAggressions > 3 ||
      saved.sizing.type === 'EXPLICIT_TOTALS' && (!Array.isArray(saved.sizing.levels) || saved.sizing.levels.length < 1 || saved.sizing.levels.length > levelLimit(saved.ranges.length) || saved.sizing.levels.some(level => !Number.isFinite(level) || level <= 0))) return;
    let comparisonPolicy;try{comparisonPolicy=normalizeComparisonPolicy(saved.comparisonPolicy);}catch{return;}
    let scenarios;
    try { scenarios=normalizeScenarios(saved); } catch { return; }
    const selected=scenarios.find(item=>item.id===saved.activeScenarioId) || scenarios[0];
    study = {schemaVersion:1,handId:saved.handId,notation:saved.notation,comparisonPolicy,scenarios,activeScenarioId:selected.id,
      ranges:clone(selected.ranges),sizing:clone(selected.sizing)};studyOwner=initialized?ownerBinding():null;pendingRestore=true;
  }
  function normalizeScenarios(saved) {
    const values=saved.scenarios===undefined ? [{id:'scenario-1',name:saved.name || 'Scenario 1',treeName:saved.treeName || 'Tree 1',
      rationaleBySeat:saved.rationaleBySeat || {},ranges:saved.ranges,sizing:saved.sizing}] : saved.scenarios;
    if(!Array.isArray(values) || !values.length || values.length>MAX_SCENARIOS)throw Error('Use one to three explicit scenarios.');
    const ids=new Set(),seats=saved.ranges.length;
    const normalized=values.map((item,index)=>{
      const id=text(item?.id,80);
      if(!id || ids.has(id) || !Array.isArray(item.ranges) || item.ranges.length!==seats || !item.sizing)throw Error('Use valid, distinct scenario identifiers.');
      ids.add(id);
      const ranges=item.ranges.map(range=>{
        if(!Number.isInteger(range.seatId) || range.complete!==true || typeof range.source!=='string' || !range.source || range.source.length>120 ||
          !Array.isArray(range.combos) || !range.combos.length || range.combos.length>rangeLimit(seats) || range.combos.some(combo=>
            !Array.isArray(combo.cards) || combo.cards.length!==5 || !Number.isFinite(combo.weight) || combo.weight<=0 || combo.weight>1e12))throw Error('Use complete weighted ranges for every scenario.');
        return {seatId:range.seatId,complete:true,source:range.source,combos:range.combos.map(combo=>({cards:clone(combo.cards),weight:combo.weight}))};
      });
      if(new Set(ranges.map(range=>range.seatId)).size!==seats || !['MIN_MID_MAX','EXPLICIT_TOTALS','ALL_LEGAL_TOTALS'].includes(item.sizing.type) ||
        !Number.isInteger(item.sizing.maxAggressions) || item.sizing.maxAggressions<0 || item.sizing.maxAggressions>3 ||
        item.sizing.type==='EXPLICIT_TOTALS' && (!Array.isArray(item.sizing.levels) || !item.sizing.levels.length || item.sizing.levels.length>levelLimit(seats) || item.sizing.levels.some(value=>!Number.isFinite(value) || value<=0)))throw Error('Use a valid sizing tree for every scenario.');
      const sizing={type:item.sizing.type,maxAggressions:item.sizing.maxAggressions,...(item.sizing.type==='EXPLICIT_TOTALS'?{levels:clone(item.sizing.levels)}:{})};
      const rationaleBySeat={};for(const range of ranges)rationaleBySeat[range.seatId]=text(item.rationaleBySeat?.[range.seatId],500);
      const rangeOriginsBySeat={};
      for(const range of ranges){
        const origin=item.rangeOriginsBySeat?.[range.seatId];if(!origin)continue;
        const validId=value=>typeof value==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
        if(origin.model!=='REVIEWED_DECISION_RANGE_V1' || origin.conditioningScope!=='CONDITIONAL_AT_DECISION' ||
          !validId(origin.playerId) || !validId(origin.sourceHandId) || typeof origin.sourceRevisionKey!=='string' ||
          !origin.sourceRevisionKey || origin.sourceRevisionKey.length>200 || !Array.isArray(origin.sourceBoard) || origin.sourceBoard.length!==5 ||
          origin.sourceBoard.some(card=>typeof card!=='string' || !/^[2-9TJQKA][shdc]$/.test(card)) ||
          !Array.isArray(origin.sourceCombos) || !origin.sourceCombos.length || origin.sourceCombos.length>rangeLimit(seats) ||
          origin.sourceCombos.some(combo=>!Array.isArray(combo.cards) || combo.cards.length!==5 || combo.cards.some(card=>typeof card!=='string' || !/^[2-9TJQKA][shdc]$/.test(card)) ||
            new Set(combo.cards).size!==5 || !Number.isFinite(combo.weight) || combo.weight<=0 || combo.weight>1e12))throw Error('The saved template origin is invalid. Review the range again.');
        rangeOriginsBySeat[range.seatId]={model:origin.model,conditioningScope:origin.conditioningScope,playerId:origin.playerId,
          sourceHandId:origin.sourceHandId,sourceRevisionKey:origin.sourceRevisionKey,sourceScenarioId:text(origin.sourceScenarioId,100),
          sourceBoard:clone(origin.sourceBoard),sourceContextKey:text(origin.sourceContextKey,500),sourceCombos:clone(origin.sourceCombos),
          edited:JSON.stringify(origin.sourceCombos)!==JSON.stringify(range.combos)};
      }
      return {id,name:text(item.name,80,`Scenario ${index+1}`),treeName:text(item.treeName,80,`Tree ${index+1}`),rationaleBySeat,ranges,sizing,
        ...(Object.keys(rangeOriginsBySeat).length?{rangeOriginsBySeat}:{})};
    });
    if(saved.activeScenarioId!==undefined && !ids.has(saved.activeScenarioId))throw Error('Select a saved scenario.');
    return normalized;
  }
  function saveStudy(next, expectedBinding, compute) {
    if(binding(context())!==expectedBinding)throw Error('The hand, decision or session changed. Reopen Solver study for the current table.');
    if(typeof ownerBinding()!=='string' || !ownerBinding().length)throw Error('The session changed. Sign in again before saving a study.');
    const scenarios=normalizeScenarios(next),selected=scenarios.find(item=>item.id===next.activeScenarioId) || scenarios[0];
    const nextStudy={schemaVersion:1,handId:handId(context()),notation:next.notation,comparisonPolicy:normalizeComparisonPolicy(next.comparisonPolicy),
      scenarios,activeScenarioId:selected.id,ranges:clone(selected.ranges),sizing:clone(selected.sizing)};
    const sameMath=JSON.stringify([mathematicalStudy(),study?.comparisonPolicy])===JSON.stringify([{ranges:nextStudy.ranges,sizing:nextStudy.sizing},nextStudy.comparisonPolicy]);
    const sameCompute=!compute || compute===activeTransport?.runtime || compute===computePreference;
    const payload=lastBinding===expectedBinding?clone(lastPayload):null;
    void cancelComparison();comparisonBinding=null;comparisonView=idleComparison();
    if(!sameMath || !sameCompute)invalidate();
    study=nextStudy;studyOwner=ownerBinding();if(compute)computePreference=compute;pendingRestore=false;emit();
    if(payload && (!sameMath || !sameCompute))void evaluate(payload);
    return serialize();
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
  function comparisonAvailability() {
    const job=getState();
    if(context().multiway?.config?.playerCount!==2 || job.runtime!=='BROWSER')return 'Scenario comparison requires two original seats and Browser compute.';
    if(['QUEUED','BUILDING','REFINING'].includes(job.phase))return 'Finish or stop the active study before comparing scenarios.';
    if(!usableResult(job.result) || !lastPayload || lastBinding!==binding(context()))return 'Calculate the active scenario for this decision before comparing.';
    if(!comparisonRunner)return 'Scenario comparison is unavailable. Reload the app to load its comparison modules.';
    if((study?.scenarios?.length || 0)<2)return 'Save an explicit alternative scenario to compare ranges or sizing trees.';
    return null;
  }
  async function runComparison() {
    const unavailable=comparisonAvailability();
    if(unavailable){comparisonView={...idleComparison(),error:unavailable,binding:{handId:handId(context()),revisionKey:context().state?.revisionKey,token:binding(context())}};
      comparisonBinding=comparisonView.binding;emit();refreshDialogComparison();return getComparisonState();}
    await cancelComparison();await startAcknowledgement;await cancellation;
    const now=context(),bound=binding(now),selected=activeScenario();
    if(comparisonAvailability())return getComparisonState();
    comparisonTransport=activeTransport;
    comparisonBinding={handId:handId(now),revisionKey:now.state.revisionKey,token:bound};
    const inputFor=item=>({multiway:clone(lastPayload.multiway),ranges:clone(item.ranges),sizing:clone(item.sizing),
      rake:feeFromPayload(lastPayload),comparisonPolicy:clone(study.comparisonPolicy)});
    return comparisonRunner.run({binding:clone(comparisonBinding),baseline:{id:selected.id,name:selected.name,input:inputFor(selected),
      result:clone(view.result),phase:view.phase,timing:clone(view.timing),cache:clone(view.cache)},
      entries:study.scenarios.filter(item=>item.id!==selected.id).map(item=>({id:item.id,name:item.name,input:inputFor(item)}))});
  }
  function initializeComparisonRunner() {
    if(comparisonRunner)return;
    const create=options.studyRunnerFactory || root.TheibsSolverStudyRunner?.create;
    if(!create)return;
    comparisonRunner=create({
      start:async(input,settings)=>{
        const transport=comparisonTransport;
        if(transport?.runtime!=='BROWSER')throw Error('Scenario comparison requires Browser compute.');
        const job=await transport.request('/api/multiway/solver/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          multiway:input.multiway,ranges:input.ranges,sizing:input.sizing,rake:input.rake,comparisonPolicy:input.comparisonPolicy,
          expectedRevisionKey:settings.revisionKey,budget:'STANDARD',automatic:false})});
        if(job?.jobId)transports.set(job.jobId,transport);
        return job;
      },
      wait:(id,settings)=>{
        const transport=transports.get(id);
        if(!transport)throw Error('Scenario comparison job is unavailable.');
        return transport.request(`/api/multiway/solver/jobs/${encodeURIComponent(id)}?afterVersion=${settings.afterVersion}&waitMs=${settings.waitMs}`,
          {method:'GET',signal:settings.signal});
      },
      cancel:id=>{
        const transport=transports.get(id);
        return transport ? transport.request('/api/multiway/solver/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:id})}) : null;
      },
      isCurrent:comparisonCurrent,
      onUpdate:state=>{
        if(!comparisonCurrent(state.binding))return;
        let report=null;
        try{report=root.TheibsSolverStudyComparison?.compare?.(state.entries);}catch{}
        comparisonView={...clone(state),report:clone(report)};emit();refreshDialogComparison();
      }
    });
  }
  function refreshDialogComparison() {
    const node=dialog?.querySelector('[data-solver-comparison-result]');
    if(!node)return;
    const state=getComparisonState();
    const rows=state.entries.map(entry=>`<li><strong>${esc(entry.name)}</strong>: ${esc(entry.phase || 'Pending')}${entry.error?` · ${esc(entry.error)}`:''}</li>`).join('');
    node.innerHTML=`<p>${state.phase==='RUNNING'?'Comparing sequentially · up to 3s per alternative, 6s total.':state.phase==='COMPLETE'?'Comparison complete.':state.phase==='CANCELLED'?'Comparison stopped; completed values retained.':comparisonAvailability() || 'Ready to compare saved scenarios.'}</p>${state.error?`<p class="multiway-error">${esc(state.error)}</p>`:''}${rows?`<ul>${rows}</ul>`:''}`;
    const run=dialog.querySelector('[data-solver-compare]'),stop=dialog.querySelector('[data-solver-comparison-stop]');
    if(run)run.disabled=state.phase==='RUNNING' || Boolean(comparisonAvailability());
    if(stop)stop.hidden=state.phase!=='RUNNING';
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
    openedHand = handId(now);const openedBinding=binding(now);
    const drafts=matches?clone(study.scenarios):[{id:'scenario-1',name:'Scenario 1',treeName:'Tree 1',rationaleBySeat:{},ranges:[],sizing:{type:'MIN_MID_MAX',maxAggressions:1}}];
    let selectedId=matches?study.activeScenarioId:drafts[0].id;
    if (!dialog) {
      dialog = root.document.createElement('dialog');dialog.id = 'mw-solver-dialog';dialog.className = 'multiway-dialog mw-solver-dialog';
      dialog.setAttribute('aria-labelledby','mw-solver-title');root.document.body.append(dialog);
    }
    const supported = now.multiway.config.variant === 'PLO5_HIGH' && seats.length >= 2 && seats.length <= 3;
    const browserAvailable=browserClient?.supported===true && seats.length===2;
    const selectedCompute=String(computePreference || options.runtime || (browserAvailable?'BROWSER':'SERVER')).toUpperCase()==='SERVER'?'SERVER':browserAvailable?'BROWSER':'SERVER';
    const maxCombos = rangeLimit(seats.length), maxLevels = levelLimit(seats.length);
    const templates=root.TheibsRangeTemplates;
    const templateOwner=root.theibsPlayersUI?.getOwnerKey?.();
    let templateLibrary=null,templateError='';
    if(templates && root.theibsPlayersUI?.ready?.()){
      try{templateLibrary=templates.load(root.localStorage,templateOwner);}
      catch(error){templateError=error.message;}
    }
    const rangeSuggestions=seats.map(seat=>{
      const templateContext=templates?.contextFor(now.state,seat);
      if(!templateContext || !templateLibrary)return null;
      try{return {seat,context:templateContext,candidates:templates.candidates(templateLibrary,{playerId:seat.playerId,context:templateContext,board:now.state.board})};}
      catch{return null;}
    }).filter(item=>item?.candidates.length);
    dialog.innerHTML = `<div class="multiway-dialog-head"><h2 id="mw-solver-title">Solver study</h2><button type="button" class="text-button" data-solver-close aria-label="Close solver study">×</button></div>
      <form data-solver-form><p class="mw-solver-intro">A finite PLO5 river study for two or three seats. Your normal game and approximate EV remain available.</p>
      ${supported ? '' : '<p class="multiway-error">This table is outside the current solver coverage. Use PLO5 with two or three original seats.</p>'}
      <p class="mw-solver-hint">Current decision · ${esc(now.state?.street || 'River study')} · Pot ${esc(now.state?.pot ?? '—')} · Call ${esc(now.state?.legal?.toCall ?? '—')} chips. Ranges are hypotheses at this public decision, not inferred posteriors.</p>
      <div class="mw-solver-scenario-picker"><label>Scenario<select name="scenario"></select></label><div class="mw-solver-actions"><button type="button" class="text-button" data-solver-duplicate>Duplicate</button><button type="button" class="text-button" data-solver-new>New blank</button><button type="button" class="text-button" data-solver-remove>Remove</button></div></div>
      <div class="mw-solver-grid"><label>Scenario name<input name="scenarioName" type="text" maxlength="80" required></label><label>Tree name<input name="treeName" type="text" maxlength="80" required></label></div>
      <label>Compute location<select name="compute"><option value="BROWSER"${selectedCompute==='BROWSER'?' selected':''}${browserAvailable?'':' disabled'}>Browser compute · this device</option><option value="SERVER"${selectedCompute==='SERVER'?' selected':''}>Server compute · sends study ranges</option></select></label>
      <label>Card notation<select name="notation"><option value="KEYBOARD"${notation==='KEYBOARD'?' selected':''}>Keyboard · E / C / O / P</option><option value="CANONICAL"${notation==='CANONICAL'?' selected':''}>Standard · s / h / d / c</option></select></label>
      <p class="mw-solver-hint" data-solver-notation></p>
      <div class="mw-solver-ranges">${seats.map(seat=>`<label><span>${esc(seat.hero?'You':seat.name || seat.seatName || `Seat ${seat.id+1}`)} <small>${esc(seat.position)}${seat.folded?' · folded':''}</small></span><textarea rows="${seats.length===2?5:3}" data-solver-range="${seat.id}" aria-label="${esc(seat.hero?'Your':seat.name || `Seat ${seat.id+1}`)} complete study range" autocomplete="off" autocapitalize="characters" spellcheck="false" required${supported?'':' disabled'}>${esc(rangeText(matches ? study.ranges.find(range=>range.seatId===seat.id) : null,notation))}</textarea></label>`).join('')}</div>
      <details class="mw-solver-limits"><summary>Reviewed opponent ranges${rangeSuggestions.length?' · '+rangeSuggestions.length+' available':''}</summary>
        <p>Saved hypotheses are offered for the same player, river, positions, seat counts and available action set. This is a coarse context match, not mathematical equivalence. Card combinations and weights are unchanged; action rates do not generate a card range. Review the board, public actions, price and stacks before using a draft. Nothing is applied to your normal game.</p>
        ${templateError?`<p class="multiway-error">${esc(templateError)}</p>`:rangeSuggestions.length?rangeSuggestions.map(item=>{const candidate=item.candidates[0],saved=candidate.template;return `<p><strong>${esc(item.seat.name || `Seat ${item.seat.id+1}`)}</strong> · ${esc(saved.name)} · ${saved.range.combos.length} combinations<br><small>Source board: ${esc(saved.board.join(' '))}. ${candidate.boardChanged?'Board differs. ':''}${candidate.blockedCombinations?candidate.blockedCombinations+' combinations conflict with this board; edit them explicitly.':'No board blockers.'}</small><br><button type="button" class="text-button" data-solver-template="${item.seat.id}">Load for review</button></p>`;}).join(''):'<p>No reviewed template matches this player and decision context.</p>'}
        <label class="mw-solver-confirm"><input name="rememberRanges" type="checkbox"${templateLibrary && now.state?.street==='RIVER'?'':' disabled'}><span>Remember the active opponent ranges as reviewed hypotheses on this device.</span></label>
        <p>One template per player/context; a later approval replaces it. These finite study hypotheses are separate from observed actions and are never fed into the heuristic evaluator’s history conditioning.</p></details>
      <p class="mw-solver-hint">One five-card combination per line, up to ${maxCombos} per seat. Add <code>| weight</code> if needed; omitted weights are 1. Weights are relative within each seat; compatible joint assignments are renormalized after card blockers. Include your current cards within your declared range. The declared tree may still exceed the solver's safety limits.</p>
      <details class="mw-solver-limits"><summary>Range source & rationale · optional</summary><p>Record where each hypothesis came from and the context you assumed. These notes are not observations or learned statistics and are not sent to the solver.</p>${seats.map(seat=>`<label>${esc(seat.hero?'You':seat.name || `Seat ${seat.id+1}`)} · source / rationale<textarea rows="2" maxlength="500" data-solver-rationale="${seat.id}" autocomplete="off"></textarea></label>`).join('')}</details>
      <details class="mw-solver-limits"><summary>Range weight checks</summary><p>Check joint blockers and weight concentration, or create an explicit opponent-weight hypothesis. Hero weights and all combinations stay unchanged. These are model sensitivity checks, not learned ranges or confidence intervals. Review and save every scenario before running comparisons.</p><div class="mw-solver-actions"><button type="button" class="text-button" data-range-check>Check support</button><button type="button" class="text-button" data-range-power="0.5">Flatter opponent weights</button><button type="button" class="text-button" data-range-power="2">Sharper opponent weights</button></div><p data-range-report role="status" aria-live="polite"></p></details>
      <div class="mw-solver-grid"><label>Sizing abstraction<select name="sizing"><option value="MIN_MID_MAX">Minimum / middle / maximum</option><option value="EXPLICIT_TOTALS">Specific street totals</option><option value="ALL_LEGAL_TOTALS"${seats.length===2?'':' disabled'}>All legal totals · small HU trees</option></select></label><label>Additional bets / raises<select name="aggressions"><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label></div>
      <label data-solver-levels hidden>Street totals · chips<input name="levels" type="text" inputmode="decimal" placeholder="2, 4, 6" autocomplete="off"></label>
      <p class="mw-solver-hint">Specific sizes are absolute street totals, not pot percentages. All legal totals enumerates every cent-sized option at each included node and refuses the whole tree if any node exceeds 12 sizes. The aggression limit can still omit later actions; qualification checks completeness separately.</p>
      <details class="mw-solver-limits"><summary>Study scope & privacy</summary><p>These are explicitly chosen study ranges, including folded seats. They are not observed cards or learned statistics. Every player knows the declared ranges; a one-combination range reveals that seat’s hand within the study.</p><p>The sizing selection and aggression limit restrict the tree. Convergence applies to this river subgame only, not a full-hand GTO solution. Room fees follow the current calculation basis.</p><label>Near-equivalence threshold · bb<input name="nearEquivalenceBB" type="number" min="0" step="any" value="${normalizeComparisonPolicy(matches?study.comparisonPolicy:undefined).nearEquivalenceBB}" required></label><p>This threshold compares ex-ante commitments across the full supplied prior (FULL_PRIOR_COMMITMENT). It does not imply equal EV for your current hand. It changes the comparison policy, not the game tree or mathematical bounds.</p><p>Browser compute runs the river study on this device and currently covers two original seats. Server compute sends the entered combinations and public hand ledger to the server and covers two or three original seats. No voice transcripts, profile notes or inferred ranges are included. This setup resets with the next hand.</p></details>
      <label class="mw-solver-confirm"><input name="complete" type="checkbox" required><span>I define these as the complete ranges for every saved scenario.</span></label>
      <details class="mw-solver-limits"><summary>Compare saved scenarios</summary><p>Compare the active scenario with up to two explicit alternatives, sequentially in Browser compute. Each alternative has up to 3s; total comparison work has a 6s wall limit. Save edits first. Range hypotheses and sizing changes describe model sensitivity, not uncertainty or a universal best action.</p><div class="mw-solver-actions"><button type="button" class="text-button" data-solver-compare>Run comparison</button><button type="button" class="text-button" data-solver-comparison-stop hidden>Stop comparison</button></div><div data-solver-comparison-result role="status" aria-live="polite"></div></details>
      <p class="multiway-error" data-solver-error role="alert" hidden></p><div class="mw-solver-actions"><button type="button" class="ghost-button" data-solver-clear${matches?'':' hidden'}>Clear study</button><button type="submit" class="primary-button"${supported?'':' disabled'}>Save & use scenario</button></div></form>`;
    const form = dialog.querySelector('form');
    const sizingChanged = () => { const show = form.elements.sizing.value === 'EXPLICIT_TOTALS'; dialog.querySelector('[data-solver-levels]').hidden = !show;form.elements.levels.required=show; };
    const captureDraft=()=>{
      const draft=drafts.find(item=>item.id===selectedId);
      draft.name=form.elements.scenarioName.value;draft.treeName=form.elements.treeName.value;draft._notation=form.elements.notation.value;
      draft._texts={};draft.rationaleBySeat={};
      for(const seat of seats){draft._texts[seat.id]=dialog.querySelector(`[data-solver-range="${seat.id}"]`).value;draft.rationaleBySeat[seat.id]=dialog.querySelector(`[data-solver-rationale="${seat.id}"]`).value;}
      draft.sizing={type:form.elements.sizing.value,maxAggressions:Number(form.elements.aggressions.value)};draft._levels=form.elements.levels.value;
    };
    const fillDraft=()=>{
      const draft=drafts.find(item=>item.id===selectedId);
      form.elements.scenario.innerHTML=drafts.map(item=>`<option value="${esc(item.id)}">${esc(text(item.name,80,'Unnamed scenario'))}${item.id===study?.activeScenarioId?' · active':''}</option>`).join('');
      form.elements.scenario.value=selectedId;form.elements.scenarioName.value=draft.name;form.elements.treeName.value=draft.treeName;
      form.elements.notation.value=draft._notation || notation;
      for(const seat of seats){dialog.querySelector(`[data-solver-range="${seat.id}"]`).value=draft._texts?.[seat.id] ?? rangeText(draft.ranges.find(range=>range.seatId===seat.id),form.elements.notation.value);
        dialog.querySelector(`[data-solver-rationale="${seat.id}"]`).value=draft.rationaleBySeat?.[seat.id] || '';}
      form.elements.sizing.value=draft.sizing.type;form.elements.aggressions.value=String(draft.sizing.maxAggressions);form.elements.levels.value=draft._levels ?? draft.sizing.levels?.join(', ') ?? '';
      form.elements.complete.checked=false;sizingChanged();updateNotation();dialogError('');
      dialog.querySelector('[data-range-report]').textContent='';
      dialog.querySelector('[data-range-check]').disabled=seats.length!==2;
      for(const button of dialog.querySelectorAll('[data-range-power]'))button.disabled=seats.length!==2 || drafts.length>=MAX_SCENARIOS;
      dialog.querySelector('[data-solver-duplicate]').disabled=drafts.length>=MAX_SCENARIOS;dialog.querySelector('[data-solver-new]').disabled=drafts.length>=MAX_SCENARIOS;
      dialog.querySelector('[data-solver-remove]').disabled=drafts.length===1;
    };
    const nextId=()=>`scenario-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const draftRanges=()=>seats.map(seat=>({seatId:seat.id,complete:true,source:drafts.find(item=>item.id===selectedId).ranges.find(range=>range.seatId===seat.id)?.source || 'USER_DEFINED_COMPLETE_STUDY',
      combos:parseRange(dialog.querySelector(`[data-solver-range="${seat.id}"]`).value,form.elements.notation.value,maxCombos)}));
    const supportReport=ranges=>{
      const report=root.TheibsRiverStudyTools.diagnostics(ranges,now.state.board,now.state.heroId,now.multiway.config.heroCards);
      dialog.querySelector('[data-range-report]').textContent=`${report.worlds}/${report.cartesianWorlds} compatible worlds · Hero mass ${(100*report.heroMass).toFixed(2)}% · ${report.seats.map(row=>`Seat ${row.seatId+1}: ${row.combinations} combinations, effective ${row.effectiveCombinations.toFixed(2)}`).join(' · ')}. Effective combinations describes weight concentration only.`;
    };
    dialog.querySelector('[data-range-check]').onclick=()=>{try{if(binding(context())!==openedBinding)throw Error('The decision changed. Reopen Solver study.');supportReport(draftRanges());dialogError('');}catch(error){dialogError(error.message);}};
    for(const button of dialog.querySelectorAll('[data-range-power]'))button.onclick=()=>{
      try{
        if(binding(context())!==openedBinding)throw Error('The decision changed. Reopen Solver study.');
        if(drafts.length>=MAX_SCENARIOS)throw Error('Keep at most three scenarios. Remove an unused alternative first.');
        const ranges=draftRanges();supportReport(ranges);captureDraft();
        const power=Number(button.dataset.rangePower),hypothesis=root.TheibsRiverStudyTools.weightHypothesis(ranges,now.state.heroId,power);
        const draft=clone(drafts.find(item=>item.id===selectedId));draft.id=nextId();draft.name=power===.5?'Flatter opponent weights':'Sharper opponent weights';
        draft.ranges=hypothesis.ranges;delete draft._texts;
        const seat=hypothesis.origin.seatId;draft.rationaleBySeat[seat]=`User weight sensitivity: relative weights raised to power ${power}. Source: ${hypothesis.origin.source}. Combinations and Hero weights unchanged; not learned behavior.`;
        drafts.push(draft);selectedId=draft.id;fillDraft();supportReport(draft.ranges);
      }catch(error){dialogError(error.message);}
    };
    for(const button of dialog.querySelectorAll('[data-solver-template]'))button.onclick=()=>{
      if(binding(context())!==openedBinding){dialogError('The decision or account changed. Reopen Solver study.');return;}
      const suggestion=rangeSuggestions.find(item=>item.seat.id===Number(button.dataset.solverTemplate));
      if(!suggestion)return;
      const saved=suggestion.candidates[0].template;
      captureDraft();
      const draft=drafts.find(item=>item.id===selectedId);draft.rangeOriginsBySeat ||= {};
      draft.rangeOriginsBySeat[suggestion.seat.id]={model:saved.model,conditioningScope:saved.conditioningScope,playerId:saved.playerId,
        sourceHandId:saved.origin.handId,sourceRevisionKey:saved.origin.revisionKey,sourceScenarioId:saved.origin.scenarioId,
        sourceBoard:clone(saved.board),sourceContextKey:templates.contextKey(saved.context),sourceCombos:clone(saved.range.combos)};
      dialog.querySelector(`[data-solver-range="${suggestion.seat.id}"]`).value=rangeText(saved.range,form.elements.notation.value);
      dialog.querySelector(`[data-solver-rationale="${suggestion.seat.id}"]`).value=text(`Reviewed template: ${saved.name}. Source board ${saved.board.join(' ')}; ${saved.origin.rationale || 'user-defined finite hypothesis'}. Review for this decision.`,500);
      form.elements.complete.checked=false;
      dialogError('Draft loaded only. Review all ranges and blockers, then confirm before saving.');
    };
    form.elements.scenario.onchange=()=>{const next=form.elements.scenario.value;captureDraft();selectedId=next;fillDraft();};
    dialog.querySelector('[data-solver-duplicate]').onclick=()=>{if(drafts.length>=MAX_SCENARIOS)return;captureDraft();const draft=clone(drafts.find(item=>item.id===selectedId));draft.id=nextId();draft.name=text(draft.name,70,'Scenario')+' copy';drafts.push(draft);selectedId=draft.id;fillDraft();};
    dialog.querySelector('[data-solver-new]').onclick=()=>{if(drafts.length>=MAX_SCENARIOS)return;captureDraft();const draft={id:nextId(),name:`Scenario ${drafts.length+1}`,treeName:`Tree ${drafts.length+1}`,rationaleBySeat:{},ranges:[],sizing:{type:'MIN_MID_MAX',maxAggressions:1}};drafts.push(draft);selectedId=draft.id;fillDraft();};
    dialog.querySelector('[data-solver-remove]').onclick=()=>{if(drafts.length===1)return;const index=drafts.findIndex(item=>item.id===selectedId);drafts.splice(index,1);selectedId=drafts[Math.max(0,index-1)].id;fillDraft();};
    form.elements.sizing.onchange = sizingChanged;fillDraft();
    form.elements.notation.onchange = () => { updateNotation();dialogError('The notation changed. Review the entered cards before saving.'); };
    form.addEventListener('input',event=>{if(event.target===form.elements.complete)return;dialog.querySelector('[data-range-report]').textContent='';form.elements.complete.checked=false;});
    dialog.querySelector('[data-solver-close]').onclick = () => dialog.close();
    dialog.querySelector('[data-solver-clear]').onclick = () => { study = null; invalidate();dialog.close(); };
    dialog.querySelector('[data-solver-compare]').onclick=()=>void runComparison();
    dialog.querySelector('[data-solver-comparison-stop]').onclick=()=>void cancelComparison();refreshDialogComparison();
    form.onsubmit = event => {
      event.preventDefault();dialogError('');
      if (binding(context()) !== openedBinding) { dialogError('The hand, decision or session changed. Reopen Solver study for the current table.');return; }
      try {
        captureDraft();
        const scenarios=drafts.map(draft=>{
          const ranges=seats.map(seat=>({seatId:seat.id,complete:true,source:draft.ranges.find(range=>range.seatId===seat.id)?.source || 'USER_DEFINED_COMPLETE_STUDY',combos:parseRange(draft._texts?.[seat.id] ?? rangeText(draft.ranges.find(range=>range.seatId===seat.id),draft._notation || notation),draft._notation || notation,maxCombos)}));
          if(ranges.some(range=>range.combos.some(combo=>combo.cards.some(card=>now.state.board?.includes(card)))))throw Error('A study range contains a board blocker. Edit that combination explicitly before saving.');
          const sizing=clone(draft.sizing);
          if(sizing.type==='EXPLICIT_TOTALS'){
            const levels=String(draft._levels ?? sizing.levels?.join(', ') ?? '').split(/[\s,;]+/).filter(Boolean).map(Number);
            if(!levels.length || levels.length>maxLevels || levels.some(value=>!Number.isFinite(value)||value<=0||Math.abs(value*100-Math.round(value*100))>1e-7))throw Error(`Enter one to ${maxLevels} positive street totals with at most two decimals.`);
            sizing.levels=[...new Set(levels)].sort((a,b)=>a-b);
          }
          return {id:draft.id,name:draft.name,treeName:draft.treeName,rationaleBySeat:draft.rationaleBySeat,ranges,sizing,
            ...(draft.rangeOriginsBySeat?{rangeOriginsBySeat:draft.rangeOriginsBySeat}:{})};
        });
        if (!form.elements.complete.checked) throw Error('Confirm complete ranges for every saved scenario.');
        if(!form.elements.nearEquivalenceBB.value.trim())throw Error('Enter a near-equivalence threshold of zero or more bb.');
        const comparisonPolicy=normalizeComparisonPolicy({nearEquivalenceBB:Number(form.elements.nearEquivalenceBB.value)});
        const preparedScenarios=normalizeScenarios({ranges:scenarios[0].ranges,scenarios,activeScenarioId:selectedId});
        const selected=preparedScenarios.find(item=>item.id===selectedId);
        if(form.elements.rememberRanges.checked){
          if(!templateLibrary || !templates || root.theibsPlayersUI.getOwnerKey()!==templateOwner)throw Error('Reopen the study with a verified player library before saving templates.');
          const approved=seats.filter(seat=>!seat.hero && !seat.folded).map(seat=>({playerId:seat.playerId,name:selected.name,
            context:templates.contextFor(now.state,seat),range:selected.ranges.find(range=>range.seatId===seat.id),board:now.state.board,
            handId:openedHand,revisionKey:now.state.revisionKey,scenarioId:selected.id,rationale:selected.rationaleBySeat[seat.id]}));
          approved.forEach(item=>templates.create(item));
          templateLibrary=templates.save(root.localStorage,templateOwner,approved,templateLibrary.revision);
        }
        saveStudy({schemaVersion:1,handId:openedHand,notation:form.elements.notation.value,ranges:selected.ranges,sizing:selected.sizing,
          comparisonPolicy,scenarios:preparedScenarios,activeScenarioId:selectedId},openedBinding,form.elements.compute.value);dialog.close();
      } catch (error) { dialogError(error.message); }
    };
    dialog.showModal();
  }
  async function manualBudget(budget) {
    void cancelComparison();
    if (!configured(context())) { openSetup();return; }
    if (!lastPayload || lastBinding !== binding(context())) { view.error = 'Calculate the current decision before refining this study.';emit();return; }
    await launch(clone(lastPayload),budget,false,true);
  }
  function cancel() {
    void cancelComparison();
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
    if(study && studyOwner===null){const verified=ownerBinding();if(typeof verified==='string' && verified.length)studyOwner=verified;else{study=null;pendingRestore=false;}}
    if(!browserClient)browserClient=options.browserClient || root.TheibsBrowserSolverClient?.create?.(options.browserOptions || {});
    initializeComparisonRunner();
    if (initialized) return api;
    initialized = true;
    root.document?.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-mw-solver-setup],[data-mw-solver-standard],[data-mw-solver-deep],[data-mw-solver-cancel],[data-mw-solver-compare],[data-mw-solver-comparison-stop]');
      if (!button || button.disabled) return;
      event.preventDefault();
      if (button.hasAttribute('data-mw-solver-setup')) openSetup();
      else if (button.hasAttribute('data-mw-solver-standard')) void manualBudget('STANDARD');
      else if (button.hasAttribute('data-mw-solver-deep')) void manualBudget('DEEP');
      else if (button.hasAttribute('data-mw-solver-compare')) void runComparison();
      else if (button.hasAttribute('data-mw-solver-comparison-stop')) void cancelComparison();
      else cancel();
    });
    return api;
  }
  const api = {init,evaluate,invalidate,getState,decisionSnapshot,serialize,restore,openSetup,clearOwner,setRuntime,
    runComparison,getComparisonState,cancelComparison,
    _testing:{parseRange,rangeText,feeFromPayload,binding,usableResult,normalizeComparisonPolicy,cancel,normalizeScenarios,saveStudy,comparisonAvailability}};
  return api;
});
