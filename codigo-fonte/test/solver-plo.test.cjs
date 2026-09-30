'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPloRiverGame, coverage, _testing } = require('../src/solver/plo-river-game');
const mw = require('../src/multiway-session');
const { replay } = require('../src/hand-flow');
const { evaluateOmaha } = require('../src/evaluator');

const HERO = ['As','Ah','Qd','Jc','Tc'];
const VILLAIN = ['Ks','Kh','6d','7c','8h'];
const THIRD = ['Qs','Qh','6c','7d','8d'];
const BOARD = ['2s','3h','4d','8c','9s'];
const act = (actor, action, to) => ({ type: 'ACT', actor, action, ...(to == null ? {} : { to }) });
function river(options = {}) {
  const n = options.playerCount || 2, heroPosition = options.heroPosition || (n === 2 ? 'BB' : 'SB');
  let current = mw.start({ variant: 'PLO5_HIGH', playerCount: n, heroPosition, startingStack: 20, smallBlind: .5, bigBlind: 1,
    heroCards: options.heroCards || HERO, ...(options.stacks ? { stacks: options.stacks } : {}) });
  while (current.state.street !== 'RIVER') {
    if (current.state.phase === 'WAIT_BOARD') current = mw.step(current.multiway, { type: 'BOARD', cards: (options.board || BOARD).slice(0, { FLOP: 3, TURN: 4, RIVER: 5 }[current.state.nextStreet]) });
    else current = mw.step(current.multiway, act(current.state.actor, current.state.legal.toCall ? 'CALL' : 'CHECK'));
  }
  return current;
}
function request(current = river(), hands) {
  hands ||= current.state.players.map(player => player.hero ? HERO : player.id === 1 && current.state.players.length === 3 ? VILLAIN : current.state.players.length === 3 ? THIRD : VILLAIN);
  return { multiway: current.multiway,
    ranges: hands.map((cards, seatId) => ({ seatId, complete: true, source: 'SYNTHETIC_STUDY', combos: [{ cards, weight: 1 }] })),
    sizing: { type: 'MIN_MID_MAX', maxAggressions: 1 }, rake: { type: 'NONE' } };
}
function ready(input) { const result = buildPloRiverGame(input); assert.equal(result.status, 'READY', JSON.stringify(result)); return result; }
function path(node, ids) {
  if (node.type === 'chance') node = node.outcomes[0].node;
  for (const id of ids) { assert.equal(node.type, 'decision'); node = node.actions.find(action => action.id === id)?.node; assert.ok(node, `Missing action ${id}`); }
  return node;
}
function walk(node, fn) { fn(node); if (node.type === 'chance') node.outcomes.forEach(outcome => walk(outcome.node, fn)); else if (node.type === 'decision') node.actions.forEach(action => walk(action.node, fn)); }

test('river solver reuses exact Omaha two-hole/three-board ranking and incremental accounting', () => {
  const input = request(), snapshot = JSON.stringify(input), result = ready(input), root = result.game.root;
  assert.equal(result.game.meta.payoffUnit, 'BB');
  assert.deepEqual(path(root, ['CHECK','CHECK']).payoffs, [0, 2]);
  assert.deepEqual(path(root, ['BET:1.00','CALL']).payoffs, [-1, 3]);
  assert.deepEqual(path(root, ['FOLD']).payoffs, [2, 0]);
  assert.deepEqual(path(root, ['BET:2.00','FOLD']).payoffs, [0, 2]);
  walk(root, node => { if (node.type === 'terminal') assert.ok(Math.abs(node.payoffs.reduce((sum, value) => sum + value, 0) - 2) < 1e-8); });
  assert.equal(JSON.stringify(input), snapshot);
  // A five-card royal board is not the player's royal flush in Omaha.
  const board = ['As','Ks','Qs','Js','Ts'], cards = ['2s','3s','4d','5d','6h'];
  assert.equal(evaluateOmaha(cards, board).category, 'FLUSH');
  assert.notEqual(evaluateOmaha(cards, board).category, 'STRAIGHT_FLUSH');
});

test('all-in call settles main and side pots jointly without heads-up substitution', () => {
  let current = river({ playerCount: 3, stacks: [5,10,10], board: ['Ad','Ac','Kh','2d','3s'] });
  for (const event of [act(0,'BET',3),act(1,'RAISE',9),act(2,'CALL')]) current = mw.step(current.multiway,event);
  assert.equal(current.state.actor,0); assert.equal(current.state.legal.toCall,1);
  const input = request(current,[HERO,['Ks','Kd','9d','8c','7h'],['Qs','Qh','8d','7s','6h']]);
  const result = ready(input), call = path(result.game.root,['CALL']);
  assert.deepEqual(call.payoffs,[14,10,0]);
  assert.equal(call.payoffs.reduce((sum,value)=>sum+value,0),24);
  assert.equal(result.game.playerCount,3);
  input.rake = { type:'PERCENT_CAPPED',rate:.1,cap:100,noFlopNoDrop:false,rounding:'NEAREST_CENT',source:'USER_PROVIDED',version:'1' };
  assert.deepEqual(path(ready(input).game.root,['CALL']).payoffs,[11.5,10,0]);
});

test('fixed and scheduled fees use terminal eligible pot after uncalled returns exactly once', () => {
  const input=request(); input.rake={type:'FIXED',amount:.5};
  let result=ready(input);
  assert.deepEqual(path(result.game.root,['BET:2.00','FOLD']).payoffs,[0,1.5]);
  assert.deepEqual(path(result.game.root,['BET:1.00','CALL']).payoffs,[-1,2.5]);
  input.rake={type:'PERCENT_CAPPED',rate:.1,cap:1,noFlopNoDrop:false,rounding:'NEAREST_CENT',source:'USER_PROVIDED',version:'1'};
  result=ready(input);assert.equal(result.game.meta.constantSum,false);
  assert.deepEqual(path(result.game.root,['BET:2.00','FOLD']).payoffs,[0,1.8]);
  assert.deepEqual(path(result.game.root,['BET:1.00','CALL']).payoffs,[-1,2.6]);
  input.rake={type:'FIXED',amount:20};assert.equal(buildPloRiverGame(input).reasons[0].code,'FEE_EXCEEDS_POT');
});

test('ties and odd chips follow the authoritative settlement seat order', () => {
  const hero=['As','Kd','4c','5c','6d'], villain=['Ah','Kc','6c','7c','7d'], board=['Qs','Jh','Tc','9d','2h'];
  const input=request(river({heroCards:hero,board}),[villain,hero]);input.rake={type:'FIXED',amount:.01};
  assert.deepEqual(path(ready(input).game.root,['CHECK','CHECK']).payoffs,[.99,1]);
});

test('a short all-in raise does not reopen a player who already made a full bet', () => {
  let current=river({playerCount:3,stacks:[20,20,4]});
  for(const event of [act(0,'BET',2),act(1,'CALL'),act(2,'RAISE',3)])current=mw.step(current.multiway,event);
  assert.deepEqual(current.state.legal.actions,['FOLD','CALL']);
  const result=ready(request(current,[HERO,VILLAIN,THIRD]));
  assert.deepEqual(result.game.meta.rootActions.map(action=>action.id),['FOLD','CALL']);
  assert.deepEqual(path(result.game.root,['CALL']).actions.map(action=>action.id),['FOLD','CALL']);
  assert.deepEqual(path(result.game.root,['CALL','CALL']).payoffs,[11,-1,0]);
  assert.equal(result.game.meta.fullLegalSizingCoverage,true);
});

test('joint chance weights condition simultaneously on blockers including folded seats', () => {
  const input=request();
  input.ranges[0].combos.push({cards:['Ac','Ad','6d','7c','8h'],weight:3});
  input.ranges[1].combos.push({cards:['Ac','Qh','Jd','Ts','9c'],weight:2});
  const result=ready(input);
  assert.equal(result.game.root.outcomes.length,3);
  result.game.root.outcomes.map(outcome=>outcome.probability).sort((a,b)=>a-b).forEach((value,index)=>assert.ok(Math.abs(value-(index+1)/6)<1e-12));
  assert.equal(result.game.meta.excludedJointAssignments,1);
  assert.ok(Math.abs(result.game.meta.heroWorldProbability-4/6)<1e-9);
  // The Hero infoset is shared across worlds with the same own cards.
  const own=new Map();
  for (const outcome of result.game.root.outcomes) own.set(outcome.node.informationSet,(own.get(outcome.node.informationSet)||0)+1);
  assert.ok([...own.values()].some(count=>count===2));
  const opponentNodes=result.game.root.outcomes.map(outcome=>path(outcome.node,['CHECK']));
  assert.equal(new Set(opponentNodes.map(node=>node.informationSet)).size,2);
  assert.ok(opponentNodes.some((node,index)=>opponentNodes.some((other,j)=>index!==j&&node.informationSet===other.informationSet)));
});

test('a folded third seat remains in joint blockers and is never reduced to a heads-up range', () => {
  let current=river({playerCount:3,heroPosition:'BB'});
  // River begins with SB; its fold leaves Hero to act.
  current=mw.step(current.multiway,act(0,'FOLD'));
  const input=request(current,[VILLAIN,HERO,THIRD]);
  const result=ready(input);
  assert.equal(result.game.playerCount,3);assert.equal(result.game.meta.activeSeats,2);
  input.ranges[0].combos=[{cards:HERO,weight:1}];
  assert.equal(buildPloRiverGame(input).reasons[0].code,'NO_COMPATIBLE_WORLD');
  input.ranges=input.ranges.slice(1);assert.equal(buildPloRiverGame(input).reasons[0].code,'COMPLETE_RANGES_REQUIRED');
});

test('the action abstraction and aggression cap disclose every omitted legal sizing', () => {
  const input=request();input.sizing={type:'EXPLICIT_TOTALS',levels:[1.37],maxAggressions:1};
  const result=ready(input);
  assert.deepEqual(result.game.meta.rootActions.map(action=>action.id),['FOLD','CHECK','BET:1.37']);
  assert.equal(result.coverage,'PARTIAL');assert.equal(result.game.meta.fullLegalSizingCoverage,false);
  assert.ok(result.metrics.aggressionCapNodes>0);assert.ok(result.metrics.omittedLegalSizeCount>0);
  assert.equal(result.game.meta.fullHandEquilibriumSupported,false);assert.equal(result.game.meta.safeResolving,false);
  assert.deepEqual(path(result.game.root,['BET:1.37']).actions.map(action=>action.id),['FOLD','CALL']);
});

test('range provenance, explicit completeness, and unsupported states never synthesize a game', () => {
  for(const mutate of [input=>delete input.ranges,input=>delete input.ranges[0].complete,input=>delete input.ranges[0].source,
    input=>delete input.rake,input=>delete input.sizing,input=>{input.ranges[1].combos=[{cards:THIRD,weight:1}];},
    input=>{input.ranges[0].combos[0].weight=0;},input=>{input.ranges[0].combos.push({...input.ranges[0].combos[0]});}]) {
    const input=request();mutate(input);const result=buildPloRiverGame(input);assert.equal(result.status,'NOT_SOLVED');assert.equal(result.game,null);
  }
  const input=request();input.multiway=mw.start({...input.multiway.config}).multiway;
  assert.equal(coverage(input).reasons[0].code,'STREET_NOT_COVERED');
});

test('node/world/memory/time budgets fail atomically instead of truncating the mathematical game', () => {
  for(const [budget,code] of [[{maxNodes:1},'NODE_BUDGET'],[{maxMemoryBytes:1},'MEMORY_BUDGET']]) {
    const result=buildPloRiverGame({...request(),budget});assert.equal(result.status,'NOT_SOLVED');assert.equal(result.reasons[0].code,code);assert.equal(result.game,null);
  }
  const input=request();input.ranges[0].combos.push({cards:THIRD,weight:1});input.budget={maxWorlds:1};
  assert.equal(buildPloRiverGame(input).reasons[0].code,'WORLD_BUDGET');
  input.budget={maxBuildMs:0};assert.equal(buildPloRiverGame(input).reasons[0].code,'INVALID_BUDGET');
});

test('game keys are deterministic and change for rules-relevant fees, ranges or sizings', () => {
  const input=request(), first=ready(input), again=ready(structuredClone(input));
  assert.equal(first.game.id,again.game.id);assert.deepEqual(first.game.root,again.game.root);
  input.rake={type:'FIXED',amount:.1};assert.notEqual(ready(input).game.id,first.game.id);
  input.rake={type:'NONE'};input.sizing.maxAggressions=0;assert.notEqual(ready(input).game.id,first.game.id);
});

test('cache identity ignores transport identities but Hero hand selection remains explicit', () => {
  const input=request();input.ranges[1].combos.push({cards:['Ac','Ad','Qh','Jh','Td'],weight:1});
  const before=coverage(input);assert.equal(before.status,'READY');
  const changed=structuredClone(input);
  changed.multiway.handId='a1111111-1111-4111-a111-111111111111';
  changed.multiway.editEpoch=999;
  changed.multiway.events.forEach((event,index)=>{event.eventId=`replacement-${index}`;delete event.originEventId;});
  changed.multiway.config.players.forEach(player=>{player.playerId=`new_${player.playerId}`;player.name='New display name';});
  assert.equal(coverage(changed).key,before.key);
  changed.multiway.config.heroCards=['Ac','Ad','Qh','Jh','Td'];
  const selected=coverage(changed);assert.equal(selected.key,before.key);assert.notEqual(selected.heroInformationSet,before.heroInformationSet);
});

test('positive range support is never silently erased by floating-point underflow', () => {
  const input=request();input.ranges[0].combos.push({cards:THIRD,weight:1e12});
  input.ranges[0].combos[0].weight=Number.MIN_VALUE;
  assert.equal(buildPloRiverGame(input).reasons[0].code,'WEIGHT_PRECISION');
});

test('the generic solver validates perfect recall and solves the declared constant-sum river tree', () => {
  const solver=require('../src/solver/extensive-solver'),result=ready(request());
  const validated=solver.validateGame(result.game);assert.equal(validated.perfectRecall,true);assert.equal(validated.constantSum,2);
  const solved=solver.solve(result.game,{iterations:400,targetNashConv:.01,checkEvery:25});
  assert.equal(solved.convergence.exact,true);assert.ok(solved.convergence.nashConv<.01);
  const values=solver.actionValues(result.game,solved.strategy,result.game.meta.heroSeat,result.game.meta.heroInformationSet);
  assert.ok(Math.abs(values.actions.reduce((sum,action)=>sum+action.frequency,0)-1)<1e-12);
  assert.equal(values.actions.find(action=>action.id==='FOLD').ev,0);
  assert.ok(Math.abs(solved.values[1]-2)<.01);
});
