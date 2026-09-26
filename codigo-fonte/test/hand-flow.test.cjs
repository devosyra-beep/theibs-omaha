'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {replay}=require('../src/hand-flow');
const {decide}=require('../src/decision-engine');
const {calculateActionEV}=require('../src/action-ev-engine');
const {calculateEquity}=require('../src/equity-engine');
const config={id:'test',variant:'PLO5_HIGH',playerCount:3,heroPosition:'BTN',smallBlind:.5,bigBlind:1,startingStack:100};
const act=(actor,action,to)=>({type:'ACT',actor,action,...(to==null?{}:{to})});
const board=cards=>({type:'BOARD',cards});
test('natural action order, blinds, checks, streets, payout and chip conservation',()=>{
  const events=[];let s=replay(config,events);assert.equal(s.actor,2);assert.equal(s.pot,1.5);
  events.push(act(2,'CALL'),act(0,'CALL'),act(1,'CHECK'));s=replay(config,events);
  assert.equal(s.phase,'WAIT_BOARD');assert.equal(s.pot,3);
  const cards=['2s','3h','4d','5c','9s'];
  for(const n of [3,4,5]) {events.push(board(cards.slice(0,n)));s=replay(config,events);assert.equal(s.actor,0);events.push(act(0,'CHECK'),act(1,'CHECK'),act(2,'CHECK'));}
  s=replay(config,events);assert.equal(s.phase,'SHOWDOWN');
  events.push({type:'SETTLE',winners:[[2]],rake:.1});s=replay(config,events);
  assert.equal(s.phase,'FINISHED');assert.equal(s.players[2].stack,101.9);
  assert.equal(s.players.reduce((sum,p)=>sum+p.stack,0)+s.rake,300);
});
test('illegal actions and out-of-turn or premature board changes cannot alter state',()=>{
  for(const event of [act(0,'CALL'),act(2,'CHECK'),act(2,'RAISE',4),board(['2s','3h','4d'])])assert.throws(()=>replay(config,[event]));
  assert.equal(replay(config).pot,1.5);
});
test('pot-limit raise totals and full raises reopen prior callers',()=>{
  const s=replay(config);assert.equal(s.legal.minTo,2);assert.equal(s.legal.maxTo,3.5);
  const raised=replay(config,[act(2,'CALL'),act(0,'RAISE',3),act(1,'CALL')]);
  assert.equal(raised.actor,2);assert.equal(raised.heroToCall,2);assert.ok(raised.legal.actions.includes('RAISE'));
});
test('short all-in raises require a response but do not reopen a completed raise',()=>{
  const s=replay({...config,stacks:[100,3,100]},[act(2,'RAISE',2.5),act(0,'CALL'),act(1,'RAISE',3)]);
  assert.equal(s.actor,2);assert.equal(s.legal.toCall,.5);assert.ok(!s.legal.actions.includes('RAISE'));
});
test('all-ins, uncalled excess, side pots and different winners conserve chips',()=>{
  const c={...config,stacks:[10,20,30]};
  const events=[act(2,'RAISE',3.5),act(0,'RAISE',10),act(1,'RAISE',20),act(2,'CALL')];
  let s=replay(c,events);assert.equal(s.pot,50);assert.equal(s.players[2].stack,10);assert.equal(s.phase,'WAIT_BOARD');
  assert.deepEqual(s.pots,[{amount:30,eligible:[0,1,2]},{amount:20,eligible:[1,2]}]);
  for(const n of [3,4,5])events.push(board(['2s','3h','4d','5c','9s'].slice(0,n)));
  assert.throws(()=>replay(c,[...events,{type:'SETTLE',winners:[[0],[0]]}]));
  events.push({type:'SETTLE',winners:[[0],[1]]});s=replay(c,events);
  assert.deepEqual(s.players.map(p=>p.stack),[30,20,10]);
  const refunded=replay({...config,playerCount:2,stacks:[100,1.5]},[act(0,'RAISE',3),act(1,'CALL')]);
  assert.equal(refunded.pot,3);assert.equal(refunded.players[0].stack,98.5);
  assert.equal(refunded.log.at(-1).action,'RETURN');assert.equal(refunded.log.at(-1).amount,1.5);
});
test('heads-up button acts first preflop and last postflop',()=>{
  const c={...config,playerCount:2};assert.equal(replay(c).heroId,0);assert.equal(replay(c).actor,0);
  const s=replay(c,[act(0,'CALL'),act(1,'CHECK'),board(['2s','3h','4d'])]);assert.equal(s.actor,1);
});
test('folds remove opponents and last player receives the pot',()=>{
  const s=replay(config,[act(2,'FOLD'),act(0,'FOLD')]);assert.equal(s.phase,'FINISHED');assert.equal(s.players[1].stack,100.5);
  assert.throws(()=>replay(config,[act(2,'FOLD'),act(0,'FOLD'),act(1,'CHECK')]));
});
test('rake is removed from the prize before weighting by equity',()=>{
  const ev=calculateActionEV({equity:.25,potBeforeAction:12,amountToCall:4,rake:2,legalActions:['CALL','FOLD']});
  assert.equal(ev.actions.CALL.ev,-.5);
  for(const [equity,sign] of [[.5,1],[.25,0],[.1,-1]]){
    const e=calculateActionEV({equity,potBeforeAction:12,amountToCall:4,assumeNoRake:true,legalActions:['CALL']});
    assert.equal(Math.sign(e.actions.CALL.ev),sign);
  }
});
test('unknown opponents are modeled at the requested count with deterministic samples',()=>{
  const input={variant:'PLO4_HIGH',heroCards:['As','Ah','Kd','Qd'],board:['2s','3h','4d','5c','9s'],position:'BTN',players:4,potBeforeAction:10,amountToCall:2,effectiveStack:50,samples:40,seed:42,unknownOpponentModel:'UNIFORM',assumeNoRake:true};
  const a=decide(input),b=decide(input);assert.equal(a.status,'OK');assert.equal(a.equity.opponents,3);
  // Wall-clock performance varies; seed, samples, probabilities and intervals must not.
  const {elapsedMs:elapsedA,simulationsPerSecond:rateA,...numericA}=a.equity;
  const {elapsedMs:elapsedB,simulationsPerSecond:rateB,...numericB}=b.equity;
  assert.deepEqual(numericA,numericB);
  assert.ok(elapsedA>0&&elapsedB>0&&rateA>0&&rateB>0);
  assert.ok(a.equity.equity>=0&&a.equity.equity<=1);assert.equal(a.ranges.length,3);
  assert.equal(decide({...input,unknownOpponentModel:undefined}).status,'NO_DECISION');
});
test('known hands plus unknown opponents never silently become heads-up',()=>{
  const s=decide({variant:'PLO4_HIGH',heroCards:['As','Ah','Kd','Qd'],board:['2s','3h','4d','5c','9s'],opponentHands:[['Ks','Kh','Jd','Td']],position:'BTN',players:3,potBeforeAction:10,amountToCall:2,effectiveStack:50,samples:20,seed:2,unknownOpponentModel:'UNIFORM',assumeNoRake:true});
  assert.equal(s.status,'OK');assert.equal(s.equity.opponents,2);assert.equal(s.equity.method,'MONTE_CARLO');
});
test('known unbeatable Omaha hand, split pots and blockers are evaluated correctly',()=>{
  const e=calculateEquity({variant:'PLO4_HIGH',heroCards:['As','Ks','2d','3d'],board:['Qs','Js','Ts','4c','5h'],opponentHands:[['Ah','Kh','9c','9d']]});assert.equal(e.equity,1);
  const tie=calculateEquity({variant:'PLO4_HIGH',heroCards:['As','Kd','8s','7s'],board:['Qs','Jh','Tc','4c','5h'],opponentHands:[['Ah','Kc','9c','9d']]});assert.equal(tie.equity,.5);
  assert.throws(()=>calculateEquity({variant:'PLO4_HIGH',heroCards:['As','Ks','2d','3d'],board:['Qs','Js','Ts','4c','5h'],opponentHands:[['As','Kh','9c','9d']]}));
});
