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
      FOLD: { status: 'MODELED', ev: 0, evBB: 0, differenceToBestModeledBB: -1.2 },
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
});

test('complete action EV uses contracted bb and sizing rather than inferring missing deltas', () => {
  const analysis = { status: 'OK', analysisStage: 'FINAL', observedState: { revisionKey: 'hand-1:4' }, ev: {
    bigBlind: 2, potBeforeDecision: 30, bestModeledAction: 'RAISE', comparisonComplete: true,
    globalBestSupported: true, leaderConclusive: true, gapBestSecondBB: 0.4,
    decisionPrecision:{status:'CONCLUSIVE',leaderConclusive:true,bestActionId:'RAISE',secondActionId:'CALL',deltaEVBB:0.4,reasonCode:'SEPARATED_UNDER_FIXED_POLICY'},
    missingLegalActions: [], actions: {
      FOLD: { status: 'MODELED', ev: 0, evBB: 0, differenceToBestModeledBB: -2.1 },
      CALL: { status: 'MODELED', ev: 3.4, evBB: 1.7, differenceToBestModeledBB: -0.4 },
      RAISE: { status: 'MODELED', size: 14, ev: 4.2, evBB: 2.1, differenceToBestModeledBB: 0, model: 'SCENARIO_SHOWDOWN_ONLY' }
    }
  } };
  const decision = describe(state(), analysis);
  assert.equal(decision.stage, 'COMPLETE');
  assert.equal(decision.gapBestSecondBB, 0.4);
  assert.equal(decision.rows.find(row => row.action === 'RAISE').size, 14);
  assert.equal(decision.rows.find(row => row.action === 'CALL').differenceBB, -0.4);
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
