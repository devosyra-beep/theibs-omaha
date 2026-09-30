'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildPloRiverGame,coverage,HU_SUPPORT,THREE_SEAT_SUPPORT}=require('../src/solver/plo-river-game');
const solver=require('../src/solver/extensive-solver');
const session=require('../src/multiway-session');
const {replay}=require('../src/hand-flow');
const {expandedRiverInput}=require('./helpers/solver-river-growth-fixtures.cjs');
const {omahaRank,compareRanks}=require('./helpers/solver-reference-fixtures.cjs');

function ready(input){const result=buildPloRiverGame(input);assert.equal(result.status,'READY',JSON.stringify(result));return result;}
function walk(node,fn){fn(node);if(node.type==='chance')for(const item of node.outcomes)walk(item.node,fn);else if(node.type==='decision')for(const action of node.actions)walk(action.node,fn);}

test('12-by-12 explicit HU ranges and 12 sizings retain all 144 worlds within existing memory reservation',()=>{
  const input=expandedRiverInput({combos:12,sizings:12}),copy=structuredClone(input),built=ready(input);
  assert.equal(built.game.meta.productWorlds,144);assert.equal(built.game.meta.compatibleWorlds,144);
  assert.equal(built.game.meta.rootActions.length,14);assert.equal(built.coverage,'PARTIAL');
  assert.equal(built.metrics.nodes,1+144*built.metrics.publicNodes);
  assert.ok(built.metrics.reservedMemoryBytes<=48*1024*1024);
  assert.equal(built.metrics.handRankEvaluations,24);
  assert.equal(built.metrics.handRankCacheHits,264);
  assert.equal(built.metrics.publicLedgerTransitions,built.metrics.publicNodes-1);
  assert.ok(built.metrics.settlementCacheHits>built.metrics.settlementReplays);
  assert.deepEqual(input,copy);
  const identities=new Set();walk(built.game.root,node=>{assert.ok(!identities.has(node),'private-world nodes must never become a shared DAG');identities.add(node);});
  const validated=solver.validateGame(built.game);assert.equal(validated.perfectRecall,true);assert.equal(validated.constantSum,2);
});

test('larger blocker support is conditioned jointly without dropping a positive compatible assignment',()=>{
  const input=expandedRiverInput({combos:8,sizings:5,blocked:true}),built=ready(input);
  assert.equal(built.game.meta.productWorlds,64);assert.equal(built.game.meta.compatibleWorlds,56);
  assert.equal(built.game.meta.excludedJointAssignments,8);
  assert.ok(Math.abs(built.game.root.outcomes.reduce((sum,row)=>sum+row.probability,0)-1)<1e-12);
  const rootInfosets=new Set(built.game.root.outcomes.map(row=>row.node.informationSet));assert.equal(rootInfosets.size,7);
  const oneHand=built.game.root.outcomes.filter(row=>row.node.informationSet===built.game.meta.heroInformationSet);
  assert.equal(oneHand.length,8,'same Hero hand retains every compatible opponent combination');
});

test('memoized winners match independent Omaha ranking and the authoritative cent settlement for every expanded world and size',()=>{
  const input=expandedRiverInput({combos:6,sizings:8,fee:.01}),built=ready(input),context=session.envelope(input.multiway).state;
  const ranges=built.game.meta.ranges;
  let worldIndex=0;
  for(const hero of ranges[0].combos)for(const opponent of ranges[1].combos){
    const root=built.game.root.outcomes[worldIndex++].node;
    const comparison=compareRanks(omahaRank(hero.cards,context.board),omahaRank(opponent.cards,context.board));
    const winners=comparison===0?[0,1]:[comparison>0?0:1];
    for(const row of root.actions){
      if(!row.id.startsWith('BET:'))continue;
      const amount=Number(row.id.split(':')[1]);
      const events=[...input.multiway.events,{type:'ACT',actor:0,action:'BET',to:amount},{type:'ACT',actor:1,action:'CALL'}];
      const before=replay(input.multiway.config,events),after=replay(input.multiway.config,[...events,{type:'SETTLE',winners:before.pots.map(()=>winners),rake:.01}]);
      const expected=after.players.map((player,index)=>Math.round((player.stack-context.players[index].stack)*100)/100/context.bigBlind);
      assert.deepEqual(row.node.actions.find(action=>action.id==='CALL').node.payoffs,expected);
    }
  }
});

test('new bounds reject oversized declarations and deep expensive trees atomically',()=>{
  const many=expandedRiverInput({combos:12,sizings:12});
  many.ranges[0].combos.push({cards:['Ac','Ad','Qs','Jh','Th'],weight:1});
  assert.equal(coverage(many).reasons[0].code,'RANGE_BUDGET');
  const sizes=expandedRiverInput({combos:2,sizings:12});sizes.sizing.levels.push(1.99);
  assert.equal(coverage(sizes).reasons[0].code,'INVALID_SIZING');
  const stress=expandedRiverInput({combos:12,sizings:12,maxAggressions:3});
  stress.sizing.levels=[1,1.5,2,2.5,3,4,5,6,8,10,12,16];
  const rejected=buildPloRiverGame(stress);assert.equal(rejected.status,'NOT_SOLVED');assert.equal(rejected.game,null);
  assert.ok(['MEMORY_BUDGET','NODE_BUDGET','BUILD_TIME_BUDGET'].includes(rejected.reasons[0].code));
  assert.equal(HU_SUPPORT.maxCombosPerSeat,12);assert.equal(THREE_SEAT_SUPPORT.maxCombosPerSeat,3);
  assert.equal(THREE_SEAT_SUPPORT.maxWorlds,27);assert.equal(THREE_SEAT_SUPPORT.maxSizingLevels,8);
});

test('larger range weights and any declared sizing invalidate the mathematical context',()=>{
  const first=expandedRiverInput({combos:12,sizings:12}),original=coverage(first);assert.equal(original.status,'READY');
  const weight=structuredClone(first);weight.ranges[1].combos.at(-1).weight+=.01;
  assert.notEqual(coverage(weight).key,original.key);
  const size=structuredClone(first);size.sizing.levels[1]+=.01;assert.notEqual(coverage(size).key,original.key);
  const source=structuredClone(first);source.ranges[0].source='DIFFERENT_DECLARATION';assert.notEqual(coverage(source).key,original.key);
});
