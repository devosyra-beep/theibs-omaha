'use strict';
// HARNESS: execute the production request and Analyze flow with controlled HTTP
// replies. This verifies retention and lifecycle behavior, not engine speed.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createAnalysisPool, errorCode } = require('../src/analysis-worker');
const snapshots = require('../public/analysis-snapshots');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const requestSource = extract('  async function requestJson(', '\n  const postJson');
const analyzeSource = extract('  async function analyze(event)', '\n  async function newAnalysisHand');
const stoppedDisplaySource = extract('  function retainedPreviewDisplay(', '\n  const recommendationText');
const quickCallSource = extract('function quickCallFold(', '\nfunction renderResult(');
const quickActionSource = extract('  function quickAction(', '\n  const feedbackHost');
const codeError = code => ({ ok: false, status: 400, data: { status: 'ERROR', code, reason: 'Controlled refinement failure.' } });
const reply = data => ({ ok: true, status: 200, data });
function preview() {
  return { status: 'OK', analysisStage: 'PROVISIONAL', analysisId: 'preview-id', engineBuild: 'test',
    observedState: { handId: 'hand-1', revisionKey: 'decision-1' },
    equity: { method: 'MONTE_CARLO', equity: .4, samples: 8, confidenceInterval95: [.1, .8] },
    ev: { candidates: [{ optionId: 'CALL', action: 'CALL', status: 'MODELED', ev: 4.22, confidenceInterval95: [-100, 200] }],
      comparisonComplete: true, globalBestSupported: false, decisionPrecision: { status: 'INCONCLUSIVE', leaderConclusive: false } },
    recommendation: { status: 'INCONCLUSIVE', action: null }, multiwayEvaluation: { samples: 8 } };
}
function harness(responses, onRequest = () => {}, { quickSurface = false } = {}) {
  const rendered = [], charts = [], calls = [], urls=[],events=[],nodes = new Map();
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, children: [], replaceChildren() {} }); return nodes.get(selector); };
  const context = { AbortController, structuredClone, performance, JSON, Promise,
    activeView: 'analyze', inputRevision: 1, inputChangedAt: performance.now(), analysisBusy: false, analysisQueued: false,
    analysisController: null, lastAnalysis: null, snapshots: [], metrics: { analyses: [] }, snapshotModel: snapshots,
    browserMultiwayClient:null,browserMultiwayOwner:null,ownerKey:'b'.repeat(64),capabilityCalls:0,solverCalls:0,
    multiway: { enabled: true, handId: 'hand-1' }, multiwayState: { handId: 'hand-1', revisionKey: 'decision-1' },
    analyzeButton: node('#analyze-button'), emptyState: node('#empty'), result: node('#result'), $: node,
    cards: { announce() {}, isManualInvalid: () => false, state: { count: 4, slots: ['As','Ah','Kd','Qc'] } },
    document: { dispatchEvent() {}, body: { dataset: {} } }, CustomEvent: class {}, requestAnimationFrame: callback => callback(),
    cancelProfileComparison() {}, multiwayDecisionFeedback:null,profileComparison:null, renderResult: data => rendered.push(structuredClone(data)), quickAction() {}, renderMultiway() {},
    renderCharts: snapshot => charts.push(structuredClone(snapshot)), renderEngineDetails() {}, renderStreetCards() {}, scheduleSave() {}, scheduleAnalysis() {},
    buildAnalysisPayload: () => { if (context.invalidInput) throw Error(context.invalidInput); return structuredClone(context.payload); },
    value: id => ({ potBeforeAction: '3.5', amountToCall: '1', players: '3' })[id] || '',
    money: value => Number(value).toFixed(2), esc: value => String(value), renderHandScope() {},
    feedback: require('../public/analyze-feedback'),
    window: { theibsAuth: { ensureSession: async () => {events.push('AUTH');} }, theibsVoiceSessionContext: () => context.session,
      theibsPlayersUI:{getOwnerKey:()=>context.ownerKey},
      TheibsMultiwaySolverUI: { evaluate: async () => {context.solverCalls++;events.push('SOLVER');} }, TheibsContinuationView: require('../public/continuation-view') },
    session: { owner: 'owner-1', epoch:1, expired: false } };
  context.payload = { street: 'PREFLOP', multiway: structuredClone(context.multiway),
    multiwayEvaluation: { assumeNoRake: true, feeBasis: 'BEFORE_FEES', ranges: [] } };
  context.fetch = async (url, options) => {
    urls.push(url);
    if(url==='/api/multiway/capabilities'){
      context.capabilityCalls++;events.push('ACCESS');context.onCapabilities?.();
      const response=context.capabilitiesResponse || reply({status:'OK',ownerKey:context.ownerKey});
      return {ok:response.ok,status:response.status,json:async()=>structuredClone(response.data)};
    }
    const payload = JSON.parse(options.body); calls.push(payload.analysisPhase);
    events.push(payload.analysisPhase);
    onRequest(context, payload, calls.length);
    const response = responses[calls.length - 1];
    if (response instanceof Error) throw response;
    return { ok: response.ok, status: response.status, json: async () => structuredClone(response.data) };
  };
  vm.createContext(context);
  vm.runInContext(`${stoppedDisplaySource}\n${requestSource}\n${analyzeSource}${quickSurface ? '\n'+quickCallSource+'\n'+quickActionSource : ''}`, context, { filename: 'app-analysis-flow.js' });
  return { context, calls, urls,events,rendered, charts, nodes, run: () => context.analyze({ type: 'submit', preventDefault() {} }) };
}

test('FINAL time exhaustion retains only this invocation\'s valid preview and its exact uncertainty', async () => {
  for (const code of ['TIME_BUDGET', 'WORKER_TIMEOUT']) {
    const original = preview(), h = harness([reply(original), codeError(code)]);
    await h.run();
    const kept = h.context.lastAnalysis.data;
    assert.deepEqual(h.calls, ['PREVIEW', 'FINAL']);
    assert.equal(kept.status, 'OK'); assert.equal(kept.analysisStage, 'PROVISIONAL');
    assert.equal(kept.analysisId, original.analysisId);
    assert.deepEqual(kept.ev, original.ev); assert.deepEqual(kept.equity, original.equity);
    assert.deepEqual(kept.recommendation, original.recommendation);
    assert.equal(kept.refinement.status, 'TIME_BUDGET'); assert.match(kept.refinement.reason, /preliminary estimates remain available/);
    assert.equal(h.charts.at(-1).analysisStage, 'PROVISIONAL');
    assert.equal(h.context.snapshots.length, 0, 'a retained preview is not archived as a final decision');
    assert.equal(h.context.analysisBusy, false); assert.equal(h.context.analyzeButton.disabled, false);
  }
});

test('explicit computation failures preserve preliminary data without converting failure to a timeout', async () => {
  for (const code of ['WORKER_FAILED', 'ENGINE_BUSY']) {
    const h = harness([reply(preview()), codeError(code)]); await h.run();
    assert.equal(h.context.lastAnalysis.data.refinement.status, 'FAILED');
    assert.equal(h.context.lastAnalysis.data.analysisStage, 'PROVISIONAL');
  }
});

test('retained previews stop every auxiliary running message whether feedback or a CALL assessment supplied the view', async () => {
  for (const assessment of [null, { status: 'PROVISIONAL' }]) {
    const original = { ...preview(), continuationAssessment: assessment };
    const h = harness([reply(original), codeError('TIME_BUDGET')], () => {}, { quickSurface: true });
    await h.run();
    assert.equal(h.context.lastAnalysis.data.analysisStage, 'PROVISIONAL');
    assert.equal(h.nodes.get('#analysis-next-title').textContent, 'Preliminary estimates retained');
    assert.match(h.nodes.get('#analysis-next-detail').textContent, /time budget/);
    assert.match(h.nodes.get('#analysis-next-detail').textContent, /does not supply a recommended action/);
    assert.equal(h.nodes.get('#analysis-next-action').hidden, true);
    for (const selector of ['#ev-state', '#analysis-next-title', '#analysis-next-detail'])
      assert.doesNotMatch(h.nodes.get(selector).textContent, /calculating|awaiting|still running|refining/i);
    const callView = h.context.quickCallFold(h.context.lastAnalysis.data, { ready: true });
    assert.equal(callView.label, '—'); assert.doesNotMatch(callView.detail, /calculating|still running/i);
  }
});

test('a successful FINAL replaces the preview and carries no stopped-refinement metadata', async () => {
  const final = { ...preview(), analysisId: 'final-id', analysisStage: 'FINAL' };
  const h = harness([reply(preview()), reply(final)]); await h.run();
  assert.equal(h.context.lastAnalysis.data.analysisId, 'final-id');
  assert.equal(h.context.lastAnalysis.data.refinement, undefined); assert.equal(h.context.snapshots.length, 1);
});

test('an initial computation failure cannot recover an estimate from a previous invocation', async () => {
  const h = harness([codeError('TIME_BUDGET'),codeError('TIME_BUDGET')]); h.context.lastAnalysis = { data: preview(), input: h.context.payload };
  await h.run(); assert.deepEqual(h.calls, ['PREVIEW','FINAL']);
  assert.equal(h.context.lastAnalysis.data.status, 'ERROR'); assert.equal(h.context.lastAnalysis.data.refinement, undefined);
});

test('a transient cold PREVIEW gets exactly one contextual FINAL attempt, including the quick surface', async () => {
  for(const code of ['TIME_BUDGET','WORKER_TIMEOUT','WORKER_FAILED','ENGINE_BUSY']){
    const final={...preview(),analysisId:'recovered-final',analysisStage:'FINAL'};
    const h=harness([codeError(code),reply(final)],()=>{},{quickSurface:true});await h.run();
    assert.deepEqual(h.calls,['PREVIEW','FINAL']);assert.equal(h.rendered.length,1);assert.equal(h.context.lastAnalysis.data.analysisId,'recovered-final');
    assert.equal(h.context.lastAnalysis.data.refinement,undefined);assert.equal(h.context.snapshots.length,1);assert.equal(h.context.analysisBusy,false);
  }
  const h=harness([reply({status:'ERROR',code:'TIME_BUDGET',reason:'Preview expired.'}),reply({...preview(),analysisStage:'FINAL'})]);await h.run();
  assert.deepEqual(h.calls,['PREVIEW','FINAL']);assert.equal(h.rendered.length,1);assert.equal(h.context.lastAnalysis.data.status,'OK');
});

test('a hard PREVIEW failure never retries auth, invalid inputs or a network error as FINAL',async()=>{
  for(const response of [codeError('AUTH_REQUIRED'),codeError('INVALID_RANGE'),new TypeError('Network unavailable.'),
    {...codeError('TIME_BUDGET'),status:401},{...codeError('WORKER_TIMEOUT'),status:403},{...codeError('ENGINE_BUSY'),status:409}]){
    const h=harness([response]);await h.run();assert.deepEqual(h.calls,['PREVIEW']);assert.equal(h.context.lastAnalysis.data.status,'ERROR');
  }
});

test('a failed PREVIEW cannot schedule FINAL after hand, revision, owner, view, exact inputs or cancellation changes',async()=>{
  for(const mutate of [c=>c.inputRevision++,c=>{c.multiway.handId='hand-2';},c=>{c.multiwayState.revisionKey='decision-2';},
    c=>{c.session.owner='owner-2';},c=>{c.session.expired=true;},c=>{c.activeView='train';},
    c=>{c.payload.multiwayEvaluation.feeBasis='DECLARED_FEES';},c=>c.analysisController.abort()]){
    const h=harness([codeError('TIME_BUDGET')],mutate);await h.run();assert.deepEqual(h.calls,['PREVIEW']);assert.equal(h.rendered.length,0);
    assert.equal(h.context.lastAnalysis,null);assert.equal(h.context.analysisBusy,false);
  }
});

function zeroWorldPreview(){
  const rows=[{optionId:'FOLD',action:'FOLD',status:'MODELED',ev:0,evBB:0,samples:0,method:'DECISION_REFERENCE',confidenceInterval95:[0,0]},
    ...['CALL','RAISE'].map(action=>({optionId:action,action,status:'NOT_MODELED',ev:null,evBB:null,samples:0,confidenceInterval95:null}))];
  return {...preview(),equity:{method:'MONTE_CARLO',equity:null,winRate:null,tieRate:null,samples:0,effectiveSamples:0,confidenceInterval95:null},
    ev:{bigBlind:2,candidates:rows,actions:Object.fromEntries(rows.map(row=>[row.action,row])),comparisonComplete:false,globalBestSupported:false,
      decisionPrecision:{status:'INCONCLUSIVE',leaderConclusive:false,bestActionId:null,deltaEVBB:null}},
    multiwayEvaluation:{samples:0,effectiveSamples:0,stopReason:'TIME_BUDGET'},
    refinement:{status:'TIME_BUDGET',reasonEnglish:'The time budget ended before any complete joint world was evaluated. Fold remains the exact zero reference; other action EV and equity are unavailable.'}};
}

test('zero-world PREVIEW remains pending until FINAL; a terminal provisional response never archives a final decision',async()=>{
  const original=zeroWorldPreview(),h=harness([reply(original),reply(original)],()=>{},{quickSurface:true});await h.run();
  assert.deepEqual(h.calls,['PREVIEW','FINAL']);assert.equal(h.rendered[0].clientTiming.refinementPending,true);
  const kept=h.context.lastAnalysis.data;assert.equal(kept.clientTiming.refinementPending,false);assert.equal(kept.analysisStage,'PROVISIONAL');
  assert.deepEqual(kept.ev,original.ev);assert.equal(kept.equity.equity,null);assert.equal(h.charts.at(-1).equity,null);assert.equal(h.context.snapshots.length,0);
  assert.equal(kept.refinement.reason,original.refinement.reasonEnglish);assert.doesNotMatch(h.nodes.get('#analysis-next-detail').textContent,/undefined|calculating|still running/i);
  assert.equal(h.nodes.get('#analysis-next-title').textContent,'No sampled action EV estimate');assert.doesNotMatch(h.nodes.get('#analysis-next-title').textContent,/retained/i);
});

test('a stopped provisional response with no EV reports absent estimates instead of retained values',async()=>{
  const noEV={...zeroWorldPreview(),ev:{actions:{},candidates:[]}},h=harness([reply(noEV),codeError('TIME_BUDGET')],()=>{},{quickSurface:true});await h.run();
  assert.equal(h.nodes.get('#analysis-next-title').textContent,'No sampled action EV estimate');assert.match(h.nodes.get('#analysis-next-detail').textContent,/No sampled action EV estimate is available/);
  assert.equal(h.context.lastAnalysis.data.equity.equity,null);assert.equal(h.context.snapshots.length,0);
});

test('null equity and win rates remain missing in production chart labels and never create a timeline point',()=>{
  const nodes=new Map(),node=selector=>{if(!nodes.has(selector))nodes.set(selector,{style:{},setAttribute(){}});return nodes.get(selector);};
  const chart=extract('function renderCharts(', '\nfunction renderEvTable');
  const percentSource=extract('  const percent = ', '\n  const quickEquityPrecision');
  const data=zeroWorldPreview(),snapshot=snapshots.create(data,{street:'PREFLOP'}),context={document:{querySelector:node},activeView:'analyze',multiway:{},
    snapshotModel:snapshots,snapshots:[snapshot],streetName:street=>street};
  vm.createContext(context);vm.runInContext(percentSource+'\n'+chart,context);context.renderCharts(snapshot);
  for(const selector of ['#hero-equity','#win-percent','#loss-percent'])assert.equal(node(selector).textContent,'—');
  assert.equal(node('#timeline-range').textContent,'—');assert.equal(node('#chart-points').innerHTML,'');assert.equal(snapshot.equity,null);
});

test('context changes during display frames discard this invocation and cannot archive a stale final snapshot',async()=>{
  for(const changedPhase of ['PREVIEW','FINAL']){
    const h=harness([reply(preview()),reply({...preview(),analysisStage:'FINAL'})]);let frames=0;
    h.context.requestAnimationFrame=callback=>{frames++;if(frames===(changedPhase==='PREVIEW'?1:3))h.context.payload.multiwayEvaluation.feeBasis='DECLARED_FEES';callback();};
    await h.run();assert.deepEqual(h.calls,changedPhase==='PREVIEW'?['PREVIEW']:['PREVIEW','FINAL']);assert.equal(h.context.lastAnalysis,null);
    assert.equal(h.context.snapshots.length,0);assert.equal(h.context.analysisBusy,false);assert.equal(h.charts.at(-1),undefined);
  }
});

function useBrowser(h,responses,onAnalyze=()=>{}){
  const calls=[],cleared=[];let creations=0;
  const client={supported:true,analyze:async(payload,settings)=>{
    calls.push({payload:structuredClone(payload),...settings});h.events.push('BROWSER_'+settings.phase);onAnalyze(h.context,payload,settings,calls.length);
    const response=responses[calls.length-1];if(response instanceof Error)throw response;return structuredClone(response);
  },clearOwner:owner=>cleared.push(owner),close(){}};
  h.context.window.TheibsBrowserMultiwayClient={create:()=>{creations++;return client;}};
  return {client,calls,cleared,get creations(){return creations;}};
}

test('contextual Browser compute preserves both phases, verified owner, frozen profiles and metadata while deferring the river study',async()=>{
  const final={...preview(),analysisStage:'FINAL',performance:{workerExecutionMs:12,origin:'BROWSER_WEB_WORKER'}},h=harness([]),browser=useBrowser(h,[preview(),final]);
  h.context.payload.multiwayEvaluation.profileSnapshot={schemaVersion:1,handId:'hand-1',source:'PRE_HAND_OBSERVATIONS',players:{opponent:{playerId:'opponent',contexts:{},observations:3}}};
  await h.run();assert.equal(h.context.capabilityCalls,1);assert.deepEqual(h.calls,[]);assert.deepEqual(browser.calls.map(call=>call.phase),['PREVIEW','FINAL']);
  assert.equal(browser.creations,1);assert.ok(browser.calls.every(call=>call.owner===JSON.stringify([h.context.ownerKey,1])));
  assert.equal(browser.calls[0].signal,browser.calls[1].signal);assert.equal(browser.calls[0].signal.aborted,false);
  assert.deepEqual(browser.calls[0].payload.multiwayEvaluation.profileSnapshot,h.context.payload.multiwayEvaluation.profileSnapshot);
  assert.deepEqual(browser.calls[1].payload,browser.calls[0].payload);assert.equal(h.context.solverCalls,1);
  assert.ok(browser.calls.every(call=>call.payload.multiwayEvaluation.revisionKey==='decision-1'));assert.equal(h.context.payload.multiwayEvaluation.revisionKey,undefined);
  assert.equal(h.context.lastAnalysis.input.multiwayEvaluation.revisionKey,undefined);assert.equal(h.context.lastAnalysis.signature,snapshots.stable(h.context.payload));
  assert.ok(h.events.indexOf('ACCESS')<h.events.indexOf('BROWSER_PREVIEW'));assert.ok(h.events.indexOf('SOLVER')>h.events.indexOf('BROWSER_FINAL'));
  const kept=h.context.lastAnalysis.data;assert.deepEqual(kept.ev,final.ev);assert.equal(kept.performance.workerExecutionMs,12);
  assert.equal(kept.performance.runtimeLabel,'Browser compute');assert.equal(kept.performance.origin,'BROWSER_WEB_WORKER');
  assert.equal(kept.clientTiming.httpElapsedMs,null);assert.equal(kept.clientTiming.scope,'BROWSER_WORKER_ROUND_TRIP_AND_SECOND_FRAME_PROXY');
  assert.ok(Number.isFinite(kept.clientTiming.computeElapsedMs));
});

test('active Browser river study is preempted before contextual EV and restarts only after FINAL',async()=>{
  for(const phase of ['QUEUED','BUILDING','REFINING']){
    const h=harness([]),browser=useBrowser(h,[preview(),{...preview(),analysisStage:'FINAL'}]);let invalidations=0;
    const originalHand=structuredClone(h.context.multiway);
    const state={runtime:'BROWSER',phase};h.context.window.TheibsMultiwaySolverUI.getState=()=>state;
    h.context.window.TheibsMultiwaySolverUI.invalidate=()=>{invalidations++;state.phase='IDLE';h.events.push('STUDY_PAUSED');};
    await h.run();assert.equal(invalidations,1);assert.deepEqual(browser.calls.map(call=>call.phase),['PREVIEW','FINAL']);
    assert.ok(h.events.indexOf('ACCESS')<h.events.indexOf('STUDY_PAUSED'));assert.ok(h.events.indexOf('STUDY_PAUSED')<h.events.indexOf('BROWSER_PREVIEW'));
    assert.ok(h.events.indexOf('BROWSER_FINAL')<h.events.indexOf('SOLVER'));assert.equal(h.context.solverCalls,1);
    assert.deepEqual(h.context.multiway,originalHand);
  }
  for(const {runtime,phase,supported} of [{runtime:'BROWSER',phase:'COMPLETE',supported:true},{runtime:'SERVER',phase:'REFINING',supported:true},{runtime:'BROWSER',phase:'REFINING',supported:false}]){
    const h=harness([reply(preview()),reply({...preview(),analysisStage:'FINAL'})]),browser=useBrowser(h,[preview(),{...preview(),analysisStage:'FINAL'}]);let invalidations=0;
    browser.client.supported=supported;h.context.window.TheibsMultiwaySolverUI.getState=()=>({runtime,phase});
    h.context.window.TheibsMultiwaySolverUI.invalidate=()=>{invalidations++;};await h.run();assert.equal(invalidations,0);assert.equal(h.context.solverCalls,1);
  }
});

test('only an unsupported or explicitly unavailable browser runtime falls back visibly to Server compute',async()=>{
  for(const mode of ['UNSUPPORTED','UNAVAILABLE','CREATION_UNAVAILABLE']){
    const h=harness([reply(preview()),reply({...preview(),analysisStage:'FINAL'})]),browser=useBrowser(h,[Object.assign(Error('No runtime.'),{code:'BROWSER_RUNTIME_UNAVAILABLE'})]);
    if(mode==='UNSUPPORTED')browser.client.supported=false;
    if(mode==='CREATION_UNAVAILABLE')h.context.window.TheibsBrowserMultiwayClient.create=()=>{throw Object.assign(Error('No worker API.'),{code:'BROWSER_RUNTIME_UNAVAILABLE'});};
    await h.run();assert.deepEqual(h.calls,['PREVIEW','FINAL']);
    assert.equal(browser.calls.length,mode==='UNAVAILABLE'?1:0);assert.equal(h.context.lastAnalysis.data.performance.runtimeLabel,'Server compute');
    assert.match(h.context.lastAnalysis.data.performance.runtimeReason,/using Server compute/);assert.equal(h.context.capabilityCalls,1);assert.equal(h.context.solverCalls,1);
  }
});

test('browser computation errors retain useful current data and never route calculations to the server',async()=>{
  const h=harness([]),browser=useBrowser(h,[preview(),Object.assign(Error('Worker stopped.'),{code:'WORKER_FAILED'})]);await h.run();
  assert.deepEqual(h.calls,[]);assert.equal(browser.calls.length,2);assert.equal(h.context.lastAnalysis.data.refinement.status,'FAILED');
  assert.equal(h.context.lastAnalysis.data.performance.runtimeLabel,'Browser compute');assert.equal(h.context.solverCalls,1);
  const cold=harness([]),coldBrowser=useBrowser(cold,[Object.assign(Error('Cold budget.'),{code:'TIME_BUDGET'}),{...preview(),analysisStage:'FINAL'}]);
  await cold.run();assert.deepEqual(cold.calls,[]);assert.deepEqual(coldBrowser.calls.map(call=>call.phase),['PREVIEW','FINAL']);assert.equal(cold.context.lastAnalysis.data.analysisStage,'FINAL');
});

test('browser malformed results, auth failures and stale results cannot trigger server fallback',async()=>{
  for(const response of [{...preview(),observedState:{handId:'stale',revisionKey:'decision-1'}},null,
    Object.assign(Error('Session rejected.'),{code:'AUTH_REQUIRED'}),Object.assign(Error('Invalid inputs.'),{code:'INVALID_RANGE'})]){
    const h=harness([]),browser=useBrowser(h,[response]);await h.run();assert.deepEqual(h.calls,[]);assert.equal(browser.calls.length,1);
    assert.equal(h.context.lastAnalysis.data.status,'ERROR');assert.equal(h.context.solverCalls,0);
  }
  const malformed=harness([]);malformed.context.window.TheibsBrowserMultiwayClient={create:()=>({})};await malformed.run();
  assert.deepEqual(malformed.calls,[]);assert.equal(malformed.context.lastAnalysis.data.status,'ERROR');assert.equal(malformed.context.solverCalls,0);
});

test('contextual capabilities revalidation rejects payment, auth, changed owner and changed session before local compute',async()=>{
  for(const changed of ['PAYMENT','AUTH','OWNER','SESSION']){
    const h=harness([]),browser=useBrowser(h,[preview()]);
    if(changed==='PAYMENT'||changed==='AUTH')h.context.capabilitiesResponse={ok:false,status:changed==='PAYMENT'?402:401,data:{reason:'Access denied.'}};
    if(changed==='OWNER')h.context.capabilitiesResponse=reply({status:'OK',ownerKey:'c'.repeat(64)});
    if(changed==='SESSION')h.context.onCapabilities=()=>{h.context.session.epoch++;};
    await h.run();assert.equal(browser.calls.length,0);assert.deepEqual(h.calls,[]);assert.equal(h.context.solverCalls,0);assert.equal(h.context.capabilityCalls,1);
  }
});

test('owner changes and cancellation between browser phases cannot publish or start a second phase',async()=>{
  for(const mutation of [c=>{c.ownerKey='c'.repeat(64);},c=>c.analysisController.abort(),c=>{c.multiwayState.revisionKey='new';}]){
    const h=harness([]),browser=useBrowser(h,[preview()],mutation);await h.run();assert.equal(browser.calls.length,1);assert.equal(h.context.lastAnalysis,null);
    assert.deepEqual(h.calls,[]);assert.equal(h.context.solverCalls,0);
  }
});

test('simple Analyze remains the one existing equity request without browser compute, access probe or river study',async()=>{
  const h=harness([reply(preview())]),browser=useBrowser(h,[]);h.context.multiway=null;h.context.payload={street:'PREFLOP',seed:'42'};
  h.context.buildQuickEquityPayload=()=>structuredClone(h.context.payload);h.context.percent=value=>String(value);
  h.context.quickEquityPrecision=()=>({preliminary:true,range:'controlled range'});h.context.streetName=street=>street;
  await h.run();assert.deepEqual(h.urls,['/api/equity']);assert.equal(browser.creations,0);assert.equal(browser.calls.length,0);
  assert.equal(h.context.capabilityCalls,0);assert.equal(h.context.solverCalls,0);
});

test('session change clears the previous browser owner and aborts contextual work before clearing Players',async()=>{
  const h=harness([]),browser=useBrowser(h,[preview(),{...preview(),analysisStage:'FINAL'}]);await h.run();
  const owner=h.context.browserMultiwayOwner,controller=new AbortController();h.context.analysisController=controller;
  let onChange;h.context.document.addEventListener=(_name,handler)=>{onChange=handler;};h.context.clearTimeout=clearTimeout;h.context.multiwayRevision=0;
  h.context.multiwayCardTimer=null;h.context.saveTimer=null;h.context.loaded=false;h.context.cancelCoach=()=>{};
  h.context.window.theibsPlayersUI.clearOwner=()=>{assert.deepEqual(browser.cleared,[owner]);h.context.ownerKey=null;};
  vm.runInContext(extract("  document.addEventListener('theibs:voice-session-changed'", "\n  form.addEventListener('input'"),h.context);onChange();
  assert.equal(controller.signal.aborted,true);assert.equal(h.context.browserMultiwayOwner,null);assert.deepEqual(browser.cleared,[owner]);
});

test('runtime labels are visible in the existing contextual result and timing labels distinguish worker from HTTP',()=>{
  const nodes=new Map(),node=selector=>{if(!nodes.has(selector))nodes.set(selector,{classList:{add(){},remove(){}}});return nodes.get(selector);};
  for(const runtime of ['BROWSER','SERVER']){
    const data={...preview(),analysisStage:'FINAL',performance:{runtimeLabel:runtime==='BROWSER'?'Browser compute':'Server compute',runtimeReason:runtime==='SERVER'?'Using Server compute.':null},
      clientTiming:{runtime,computeElapsedMs:10,httpElapsedMs:runtime==='BROWSER'?null:20}};
    const context={lastAnalysis:{data},$:node,emptyState:node('#empty'),result:node('#result'),esc:String,streetName:String,numberLabel:String,comparisonLabel:()=>''};
    vm.createContext(context);vm.runInContext(extract('function renderResult(', '\n  function updateTableContext')+'\n'+extract('  function renderEngineDetails()', '\n  function toast'),context);
    context.renderResult(data,'PREFLOP');context.renderEngineDetails();assert.match(context.result.innerHTML,new RegExp(data.performance.runtimeLabel));
    assert.match(node('#engine-details').innerHTML,new RegExp(runtime==='BROWSER'?'Worker round trip':'HTTP round trip'));
  }
});

test('auth, invalid-model, uncoded and network failures do not retain a preview', async () => {
  for (const response of [codeError('AUTH_REQUIRED'), codeError('INVALID_RANGE'), codeError('UNKNOWN_PRIVATE_CODE'),
    { ...codeError('TIME_BUDGET'), status: 401 }, { ...codeError('WORKER_TIMEOUT'), status: 403 }, { ...codeError('ENGINE_BUSY'), status: 409 },
    { ok: false, status: 400, data: { reason: 'Invalid range.' } }, new TypeError('Network unavailable.')]) {
    const h = harness([reply(preview()), response]); await h.run();
    assert.equal(h.context.lastAnalysis.data.status, 'ERROR'); assert.equal(h.context.lastAnalysis.data.refinement, undefined);
  }
});

test('revision, hand, session, current inputs, version errors and cancellation cannot revive a preview', async () => {
  const mutations = [
    c => { c.inputRevision++; c.lastAnalysis = null; },
    c => { c.activeView = 'train'; c.lastAnalysis = null; },
    c => { c.multiway.handId = 'hand-2'; c.lastAnalysis = null; },
    c => { c.multiwayState.revisionKey = 'decision-2'; c.lastAnalysis = null; },
    c => { c.session.owner = 'owner-2'; c.lastAnalysis = null; },
    c => { c.session.expired = true; c.lastAnalysis = null; },
    c => { c.payload.multiwayEvaluation.ranges = [{ seatId: 1, range: { kind: 'UNIFORM' } }]; },
    c => { c.payload.multiwayEvaluation.feeBasis = 'DECLARED_FEES'; },
    c => { c.invalidInput = 'Version mismatch: reload the page.'; },
    c => { c.analysisController.abort(); c.lastAnalysis = null; }
  ];
  for (const mutate of mutations) {
    const h = harness([reply(preview()), codeError('TIME_BUDGET')], (context, payload, count) => { if (count === 2) mutate(context); });
    await h.run();
    assert.notEqual(h.context.lastAnalysis?.data?.status, 'OK');
    assert.equal(h.context.lastAnalysis?.data?.refinement, undefined);
  }
});

test('a misbound preview cannot be retained after a later timeout', async () => {
  for (const changed of [{ handId: 'another-hand', revisionKey: 'decision-1' }, { handId: 'hand-1', revisionKey: 'another-decision' }]) {
    const h = harness([reply({ ...preview(), observedState: changed }), codeError('TIME_BUDGET')]); await h.run();
    assert.equal(h.context.lastAnalysis.data.status, 'ERROR');
  }
});

test('worker computation codes are allowlisted and the watchdog keeps its own typed timeout', async t => {
  for (const code of ['TIME_BUDGET', 'WORKER_TIMEOUT', 'WORKER_FAILED', 'ENGINE_BUSY']) assert.equal(errorCode(code), code);
  for (const code of ['AUTH_REQUIRED', 'PRIVATE_TOKEN', null, {}, '__proto__']) assert.equal(errorCode(code), null);
  const pool = createAnalysisPool({ workerFile: path.join(__dirname, 'fixtures/pool-worker.cjs'), adaptiveTimeoutMs: 100 });
  t.after(() => pool.close());
  await assert.rejects(pool({ multiwayEvaluation: {}, delay: 1000 }), error => error.code === 'WORKER_TIMEOUT');
  assert.equal(pool.stats().workers, 0);
});

test('the production worker preserves TIME_BUDGET through its error message but drops arbitrary codes', async t => {
  const pool = createAnalysisPool({ workerFile: path.join(__dirname, 'fixtures/refinement-worker.cjs') });
  t.after(() => pool.close());
  await assert.rejects(pool({ controlledError: 'TIME_BUDGET' }), error => error.code === 'TIME_BUDGET' && /Controlled worker/.test(error.message));
  await assert.rejects(pool({ controlledError: 'PRIVATE_PROVIDER_VALUE' }), error => error.code === undefined && /Controlled worker/.test(error.message));
  assert.equal(pool.stats().workers, 1, 'a computation error leaves the worker reusable');
});
