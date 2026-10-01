'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/multiway-ui.js'), 'utf8');
const window = {};
vm.runInNewContext(source, { window, document: { querySelector: () => null } }, { filename: 'multiway-ui.js' });
const describe = window.theibsMultiwayUI.describeDecisionEV;

function state() {
  return {
    phase: 'BETTING', actor: 1, heroId: 1, revisionKey: 'hand-1:4',
    street: 'TURN', bigBlind: 2, pot: 30,
    players: [{ id: 0, hero: false }, { id: 1, hero: true }],
    legal: { actions: ['FOLD', 'CALL', 'RAISE'], toCall: 6 }
  };
}

test('missing Hero cards and idle calculations are not presented as running EV', () => {
  const waiting = describe(state(), null, {heroDraftReady:false, analysisBusy:false});
  assert.equal(waiting.stage, 'WAITING_CARDS');
  assert.ok(waiting.rows.every(row => row.evBB === null && row.status === 'NOT_MODELED'));
  assert.equal(describe(state(), null, {heroDraftReady:true, analysisBusy:false}).stage, 'IDLE');
  assert.equal(describe(state(), null, {heroDraftReady:true, analysisBusy:true}).stage, 'PENDING');
});

test('EV display keeps uncovered legal actions unknown and does not promote a partial leader', () => {
  const analysis = { status: 'OK', analysisStage: 'FINAL', observedState: { revisionKey: 'hand-1:4' }, ev: {
    bigBlind: 2, potBeforeDecision: 30, bestModeledAction: 'CALL', comparisonComplete: false,
    globalBestSupported: false, leaderConclusive: false, gapBestSecondBB: 1.2,
    missingLegalActions: ['RAISE'], actions: {
      FOLD: { status: 'MODELED', ev: 0, evBB: 0, differenceToBestModeledBB: 1.2 },
      CALL: { status: 'MODELED', ev: 2.4, evBB: 1.2, differenceToBestModeledBB: 0 },
      RAISE: { status: 'NOT_MODELED', ev: null, evBB: null, differenceToBestModeledBB: null }
    }
  } };
  const decision = describe(state(), analysis);
  assert.equal(decision.stage, 'PARTIAL');
  assert.equal(decision.bestModeledAction, 'CALL');
  assert.equal(decision.globalBestSupported, false);
  assert.equal(decision.leaderConclusive, false);
  assert.equal(decision.toCall, 6);
  assert.equal(decision.potBeforeDecision, 30);
  assert.equal(decision.rows.find(row => row.action === 'FOLD').evBB, 0);
  const raise = decision.rows.find(row => row.action === 'RAISE');
  assert.equal(raise.status, 'NOT_MODELED');
  assert.equal(raise.evBB, null);
  assert.equal(raise.differenceBB, null);
});

test('current revision, hero turn and finite EV are required before display', () => {
  const current = state();
  const stale = { status: 'OK', analysisStage: 'FINAL', observedState: { revisionKey: 'old-hand' }, ev: {
    actions: { CALL: { status: 'MODELED', ev: 999 } }, bestModeledAction: 'CALL'
  } };
  const pending = describe(current, stale);
  assert.equal(pending.stage, 'PENDING');
  assert.equal(pending.bestModeledAction, null);
  assert.ok(pending.rows.every(row => row.evBB === null));
  const provisional = { ...stale, analysisStage: 'PROVISIONAL', observedState: { revisionKey: current.revisionKey } };
  const firstPass = describe(current, provisional);
  assert.equal(firstPass.stage, 'PROVISIONAL');
  assert.equal(firstPass.bestModeledAction, null);
  assert.equal(firstPass.globalBestSupported, false);
  assert.equal(firstPass.leaderConclusive, false);
  assert.equal(firstPass.gapBestSecondBB, null);
  assert.ok(firstPass.rows.every(row => row.differenceBB === null));
  assert.equal(firstPass.rows.find(row => row.action === 'CALL').evBB, 499.5);
  assert.equal(describe({ ...current, actor: 0 }, stale), null);
  assert.equal(describe({ ...current, phase: 'WAIT_BOARD' }, stale), null);
  const unavailable = describe(current, { status: 'NO_DECISION', reason: 'Hero cards incomplete.' });
  assert.equal(unavailable.stage, 'NO_DECISION');
  assert.equal(unavailable.reason, 'Hero cards incomplete.');
  const failed = describe(current, { status: 'ERROR', reason: 'Calculation unavailable.' });
  assert.equal(failed.stage, 'UNAVAILABLE');
  assert.equal(failed.reason, 'Calculation unavailable.');
  assert.ok(failed.rows.every(row => row.evBB === null && row.differenceBB === null));
});

test('complete action EV uses contracted bb and sizing rather than inferring missing deltas', () => {
  const analysis = { status: 'OK', analysisStage: 'FINAL', observedState: { revisionKey: 'hand-1:4' }, ev: {
    bigBlind: 2, potBeforeDecision: 30, bestModeledAction: 'RAISE', comparisonComplete: true,
    globalBestSupported: true, leaderConclusive: true, gapBestSecondBB: 0.4,
    decisionPrecision:{status:'CONCLUSIVE',leaderConclusive:true,bestActionId:'RAISE',secondActionId:'CALL',deltaEVBB:0.4,reasonCode:'SEPARATED_UNDER_FIXED_POLICY'},
    missingLegalActions: [], actions: {
      FOLD: { status: 'MODELED', ev: 0, evBB: 0, differenceToBestModeledBB: 2.1 },
      CALL: { status: 'MODELED', ev: 3.4, evBB: 1.7, differenceToBestModeledBB: 0.4 },
      RAISE: { status: 'MODELED', size: 14, ev: 4.2, evBB: 2.1, differenceToBestModeledBB: 0, model: 'SCENARIO_SHOWDOWN_ONLY' }
    }
  } };
  const decision = describe(state(), analysis);
  assert.equal(decision.stage, 'COMPLETE');
  assert.equal(decision.gapBestSecondBB, 0.4);
  assert.equal(decision.rows.find(row => row.action === 'RAISE').size, 14);
  assert.equal(decision.rows.find(row => row.action === 'CALL').differenceBB, 0.4);
  assert.equal(decision.rows.find(row => row.action === 'RAISE').method, 'SCENARIO_SHOWDOWN_ONLY');
  analysis.ev.globalBestSupported = false;
  analysis.ev.leaderConclusive = false;
  analysis.ev.decisionPrecision = {...analysis.ev.decisionPrecision,status:'INCONCLUSIVE',leaderConclusive:false,reasonCode:'BEST_SECOND_INTERVALS_OVERLAP'};
  assert.equal(describe(state(), analysis).stage, 'INCONCLUSIVE', 'full action coverage is not mislabeled as partial when precision cannot separate alternatives');
  analysis.ev.comparisonStatus = 'INCOMPARABLE_ASSUMPTIONS';
  analysis.ev.bestModeledAction = null;
  analysis.ev.gapBestSecondBB = null;
  assert.equal(describe(state(), analysis).stage, 'INCOMPARABLE');
  assert.equal(describe(state(), analysis).bestModeledAction, null);
});

test('finite sizing grid displays every candidate and compares the top two sizes without claiming a solved strategy', () => {
  const candidates = [
    {action:'FOLD',optionId:'FOLD',size:null,status:'MODELED',ev:0,evBB:0,differenceToBestModeledBB:2,confidenceInterval95:[0,0],samples:0},
    {action:'CALL',optionId:'CALL',size:null,status:'MODELED',ev:2,evBB:1,differenceToBestModeledBB:1,confidenceInterval95:[-2,6],samples:96},
    {action:'RAISE',optionId:'RAISE:14',size:14,status:'MODELED',ev:4,evBB:2,differenceToBestModeledBB:0,confidenceInterval95:[-1,9],samples:96},
    {action:'RAISE',optionId:'RAISE:30',size:30,status:'MODELED',ev:3.8,evBB:1.9,differenceToBestModeledBB:.1,confidenceInterval95:[-3,11],samples:96}
  ];
  const result=describe(state(),{status:'OK',analysisStage:'FINAL',observedState:{revisionKey:'hand-1:4'},ev:{candidates,
    bestModeledAction:'RAISE',bestModeledOptionId:'RAISE:14',bigBlind:2,comparisonComplete:true,globalBestSupported:false,leaderConclusive:false,
    decisionPrecision:{status:'INCONCLUSIVE',leaderConclusive:false,bestActionId:'RAISE:14',secondActionId:'RAISE:30',deltaEVBB:.1,reasonCode:'BEST_SECOND_INTERVALS_OVERLAP'},
    gapBestSecondBB:1,gapBestSecondCandidateBB:.1}});
  assert.equal(result.rows.length,4);
  assert.deepEqual(Array.from(result.rows.filter(item=>item.action==='RAISE'),item=>item.size),[14,30]);
  assert.equal(result.bestModeledSize,14);
  assert.equal(result.gapBestSecondBB,.1);
  assert.equal(result.finiteSizeGrid,true);
  assert.equal(result.stage,'INCONCLUSIVE');
  assert.equal(result.rows[3].samples,96);
  assert.deepEqual(Array.from(result.rows[3].numericalBounds),[-3,11]);
});

test('old leadership flags cannot establish precision without the new uncertainty contract',()=>{
  const ev={bigBlind:2,comparisonComplete:true,globalBestSupported:true,leaderConclusive:true,bestModeledAction:'CALL',gapBestSecondBB:99,
    actions:{FOLD:{status:'MODELED',ev:0,evBB:0},CALL:{status:'MODELED',ev:198,evBB:99}}};
  const analysis={status:'OK',analysisStage:'FINAL',observedState:{revisionKey:'hand-1:4'},ev};
  const result=describe(state(),analysis);
  assert.equal(result.leaderConclusive,false);
  assert.equal(result.gapBestSecondBB,null);
  ev.decisionPrecision={status:'INCONCLUSIVE',leaderConclusive:false,bestActionId:null,deltaEVBB:null,reasonCode:'INCOMPATIBLE_ORIGINS'};
  const incompatible=describe(state(),analysis);
  assert.equal(incompatible.bestModeledAction,null);
  assert.ok(incompatible.rows.every(row=>row.differenceBB===null));
  assert.equal(incompatible.precision.reasonCode,'INCOMPATIBLE_ORIGINS');
});

test('retained previews report refinement stops without creating a ranked decision', () => {
  const current = state();
  const preview = { status: 'OK', analysisStage: 'PROVISIONAL', observedState: { revisionKey: current.revisionKey },
    refinement: { status: 'TIME_BUDGET', reason: 'Refinement reached its time budget.' },
    ev: { bigBlind: 2, bestModeledAction: 'CALL', comparisonComplete: true, globalBestSupported: true,
      decisionPrecision: { status: 'CONCLUSIVE', leaderConclusive: true, bestActionId: 'CALL', deltaEVBB: 1.2 },
      actions: { FOLD: { status: 'MODELED', ev: 0, evBB: 0, differenceToBestModeledBB: 1.2 },
        CALL: { status: 'MODELED', ev: 2.4, evBB: 1.2, differenceToBestModeledBB: 0 } } } };
  for (const status of ['TIME_BUDGET', 'FAILED']) {
    preview.refinement.status = status;
    const retained = describe(current, preview, { heroDraftReady: true, analysisBusy: false });
    assert.equal(retained.stage, 'PROVISIONAL');
    assert.equal(retained.refinement.status, status);
    assert.equal(retained.rows.find(row => row.action === 'CALL').evBB, 1.2);
    assert.equal(retained.bestModeledAction, null);
    assert.equal(retained.leaderConclusive, false);
    assert.equal(retained.globalBestSupported, false);
    assert.equal(retained.precision, null);
    assert.equal(retained.gapBestSecondBB, null);
    assert.ok(retained.rows.every(row => row.differenceBB === null));
  }
  assert.equal(describe(current, preview, { heroDraftReady: false, analysisBusy: false }).refinement, null);
  preview.observedState.revisionKey = 'stale-hand:1';
  const stale = describe(current, preview, { heroDraftReady: true, analysisBusy: false });
  assert.equal(stale.refinement, null);
  assert.ok(stale.rows.every(row => row.evBB === null));
});

function renderDecision(analysis, solverSnapshot = null) {
  const host = { innerHTML: '', querySelector: () => null };
  const renderWindow = { TheibsMultiwaySolverUI: { decisionSnapshot: () => solverSnapshot, getState: () => null } };
  const document = { querySelector: selector => selector === '#mw-decision-ev' ? host : null, body: { dataset: {} } };
  vm.runInNewContext(source.replace('function refreshDecisionEV() {', 'window.__refreshDecisionEV = function refreshDecisionEV() {'),
    { window: renderWindow, document, clearTimeout }, { filename: 'multiway-ui.js' });
  renderWindow.theibsMultiwayUI.render({ enabled: true, state: state(), analysis, heroDraftReady: true, analysisBusy: false });
  renderWindow.__refreshDecisionEV();
  return host.innerHTML;
}

test('rendered comparison gaps are positive shortfalls and remain separate from top-two uncertainty', () => {
  const analysis = { status: 'OK', analysisStage: 'FINAL', observedState: { revisionKey: 'hand-1:4' }, ev: {
    bigBlind: 2, bestModeledAction: 'CALL', comparisonComplete: true, globalBestSupported: false,
    decisionPrecision: { status: 'INCONCLUSIVE', leaderConclusive: false, bestActionId: 'CALL', deltaEVBB: 1.2 },
    actions: { FOLD: { status: 'MODELED', ev: 0, evBB: 0, differenceToBestModeledBB: 1.2 },
      CALL: { status: 'MODELED', ev: 2.4, evBB: 1.2, differenceToBestModeledBB: 0 } } } };
  const html = renderDecision(analysis);
  assert.match(html, /Below leader · bb/);
  assert.match(html, /Fold<\/span><small>Modeled<\/small><\/th><td>0\.0<\/td><td>1\.2<\/td>/);
  assert.match(html, /Call<\/span><small>Modeled<\/small><\/th><td>\+1\.2<\/td><td>0\.0<\/td>/);
  assert.match(html, /ΔEV · top two: 1\.2 bb/);
  assert.match(html, /Current EV leader: Call/);
  assert.doesNotMatch(html, /Best modeled action/);
  assert.match(html, /Below leader = leader EV − action EV/);

  const solver = { revisionKey: 'hand-1:4', status: 'PARTIAL', actions: [
    { id: 'FOLD', action: 'FOLD', evBB: 0, frequency: 0 }, { id: 'CALL', action: 'CALL', evBB: 1.2, frequency: 1 } ],
    decisionPrecision: { status: 'INCONCLUSIVE', leaderConclusive: false, bestActionId: 'CALL', deltaEVBB: 1.2 } };
  const solvedHtml = renderDecision(null, solver);
  assert.match(solvedHtml, /Below leader · bb/);
  assert.match(solvedHtml, /Fold<\/th><td><span>0<\/span><\/td><td>0%<\/td><td><span>1\.2<\/span><\/td>/);
  assert.match(solvedHtml, /Current EV leader: Call/);
});

test('rendered timeout keeps preliminary values visible and generic errors are unavailable', () => {
  const preview = { status: 'OK', analysisStage: 'PROVISIONAL', observedState: { revisionKey: 'hand-1:4' },
    refinement: { status: 'TIME_BUDGET', reason: 'Refinement reached its time budget.' },
    ev: { bigBlind: 2, actions: { CALL: { status: 'MODELED', ev: 2.4, evBB: 1.2 } } } };
  const html = renderDecision(preview);
  assert.match(html, /HEURISTIC · preliminary/);
  assert.match(html, /Latest estimate retained\. Refinement reached its time budget\. Analyze hand to retry\./);
  assert.match(html, /\+1\.2/);
  assert.doesNotMatch(html, /refinement in progress|HEURISTIC · refining|Current EV leader|Best modeled action|ΔEV · top two|CONCLUSIVE/);
  const errorHtml = renderDecision({ status: 'ERROR', reason: 'Calculation unavailable: network error.' });
  assert.match(errorHtml, /data-status="unavailable">Calculation unavailable/);
  assert.doesNotMatch(errorHtml, />No decision</);
  const noDecisionHtml = renderDecision({ status: 'NO_DECISION', reason: 'Hero cards incomplete.' });
  assert.match(noDecisionHtml, /data-status="no_decision">No decision/);
});

function outcomeSnapshot(status='NEAR_EQUIVALENT') {
  const policy={version:'THEIBS_COMPARISON_POLICY_V1',nearEquivalenceBB:.01,unit:'BB',scope:'FULL_PRIOR_COMMITMENT'},key='a'.repeat(64),base='b'.repeat(64),hash='c'.repeat(64);
  const utility={unit:'BB',basis:'INCREMENTAL_TERMINAL_PAYOFF_FROM_ORIGINAL_DECISION',scope:'FULL_PRIOR_EX_ANTE'},target='PRIVATE_INFORMATION_SET_COMMITMENT_VALUE';
  const rows=[{id:'FOLD',action:'FOLD',size:null,frequency:0,evBB:0},{id:'CALL',action:'CALL',size:null,frequency:1,evBB:.001}];
  const bounds=rows.map(row=>({...row,certified:true,estimateBB:row.evBB,lowerBB:row.evBB-.001,upperBB:row.evBB+.001,baseGameHash:hash,baseContextKey:base,
    gameHash:row.id+'-conditioned',conditionedHash:row.id+'-conditioned',target,utility,origin:'SOURCE',version:'CERT_V1',solverVersion:'SOLVER_V1'}));
  return {revisionKey:'hand-1:4',phase:'COMPLETE',status:'SOLVED',solverVersion:'SOLVER_V1',gameHash:hash,actions:rows,
    comparisonPolicy:policy,comparisonPolicyKey:key,convergence:{exact:true,thresholdMet:true,nashConv:0,thresholdBB:.001},
    decisionPrecision:{status:status==='CERTIFIED'?'CONCLUSIVE':'INCONCLUSIVE',leaderConclusive:status==='CERTIFIED',bestActionId:'CALL',target,contextKey:base,deltaEVBB:.001},
    actionPrecision:{target,baseContextKey:base,supportedGameClass:true,fullPriorPreserved:true,originalHandActionEV:false,utility,origin:'SOURCE',version:'CERT_V1',actions:bounds},
    decisionOutcome:{version:'THEIBS_DECISION_OUTCOME_V1',status,target,scope:'FULL_PRIOR_COMMITMENT',actualHandEVEquivalence:false,policy,policyKey:key,globalConverged:true,
      actionIds:['FOLD','CALL'],strictLeaderActionId:status==='CERTIFIED'?'CALL':null,nearGroupActionIds:status==='NEAR_EQUIVALENT'?['FOLD','CALL']:[],robustWorstDifferenceBB:.003,diagnostics:{pointLeaderActionId:'CALL'}}};
}

test('near-equivalent commitments form a scoped group without an arbitrary winner or current-hand equivalence',()=>{
  const html=renderDecision(null,outcomeSnapshot());assert.match(html,/Near-equivalent commitments: Fold, Call/);assert.match(html,/Solver · SOLVED/);
  assert.match(html,/NEAR_EQUIVALENT/);assert.match(html,/FULL_PRIOR_COMMITMENT/);assert.match(html,/does not imply equal EV for your current hand/);
  assert.doesNotMatch(html,/Best action:|Current EV leader:|Current commitment estimate leader/);
});

test('malformed near or certified proof cannot claim an outcome without global convergence and matching bounds',()=>{
  for(const status of ['NEAR_EQUIVALENT','CERTIFIED'])for(const mutation of [
    value=>{value.decisionOutcome.globalConverged=false;},value=>{value.convergence.thresholdMet=false;},value=>{value.convergence.nashConv=-.001;},
    value=>{value.convergence.nashConv=.02;},value=>{value.convergence.thresholdBB=NaN;},value=>{value.actionPrecision.actions[0].baseGameHash='OTHER';},
    value=>{value.actionPrecision.actions[0].utility={...value.actionPrecision.actions[0].utility,scope:'CURRENT_HAND'};},value=>{value.comparisonPolicyKey='d'.repeat(64);}]){
    const value=outcomeSnapshot(status);mutation(value);const html=renderDecision(null,value);assert.match(html,/Commitment comparison unavailable/);assert.doesNotMatch(html,/Near-equivalent commitments:|Best action:/);
  }
});

test('estimating keeps certified point estimates provisional and never substitutes original-hand EV for missing bounds',()=>{
  const value=outcomeSnapshot('ESTIMATING');value.phase='REFINING';value.decisionOutcome.globalConverged=false;
  const html=renderDecision(null,value);assert.match(html,/Current commitment estimate leader · provisional: Call/);assert.doesNotMatch(html,/Best action:/);
  value.actionPrecision.actions.forEach(row=>{row.certified=false;});assert.match(renderDecision(null,value),/Commitment bounds pending/);
});
