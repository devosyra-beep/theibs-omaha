'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {describeHand}=require('../src/hand-insights');
const {createSession,applyAction,publicSession,trainingInput}=require('../src/training-simulator');
const {chooseOpponent}=require('../src/opponent-policy');
const {decide}=require('../src/decision-engine');
const {snapshotForCoach,answerDoubt}=require('../src/coach');
test('Omaha descriptions use exactly 2+3 and recognize current nuts',()=>{
 const x=describeHand(['As','Ks','2c','3c','4d'],['Qs','Js','Ts','8h','9d']);
 assert.equal(x.made.category,'STRAIGHT_FLUSH');assert.equal(x.nuts.unbeaten,true);assert.equal(x.nextCard,null);
 assert.equal(x.made.usedHeroCards.length,2);assert.equal(x.made.usedBoardCards.length,3);
});
test('a single suited ace blocks a nut flush but cannot form a flush',()=>{
 const x=describeHand(['As','Kd','2c','3h'],['Qs','8s','4s']);
 assert.notEqual(x.made.category,'FLUSH');assert.equal(x.blockers[0].canMakeFlush,false);assert.equal(x.nextCard.flushCards.length,0);
});
test('flush draw counts unseen cards once and labels them as improvement, not clean outs',()=>{
 const x=describeHand(['As','Ks','2c','3d'],['Qs','8s','4h']);
 assert.equal(x.nextCard.flushCards.length,9);assert.equal(x.nextCard.unseenCards,45);
 assert.equal(x.nextCard.drawCards.length,new Set(x.nextCard.drawCards).size);assert.ok(x.limitations[0].includes('not clean outs'));
});
test('public training never reveals the opponent hand before showdown',()=>{
 const s=createSession({seed:123});assert.equal(publicSession(s).opponentCards,undefined);
 const payload=trainingInput(s);assert.equal(payload.opponentHands,undefined);assert.equal(payload.opponentRanges,undefined);assert.equal(payload.unknownOpponentModel,'UNIFORM');
});
test('illegal sizes and illegal actions leave training state unchanged',()=>{
 const s=createSession({seed:42});const before=JSON.stringify(s);assert.throws(()=>applyAction(s,'RAISE',99999));assert.equal(JSON.stringify(s),before);
 assert.throws(()=>applyAction(s,'CHECK'));assert.equal(JSON.stringify(s),before);
});
test('opponent responds with fold, call and raise using legal limits',()=>{
 const context={cards:['As','Ks','Qh','Jh','Tc'],board:['Qs','Js','Ts'],legal:{actions:['FOLD','CALL','RAISE'],toCall:5,minTo:10,maxTo:30},pot:15,style:'AGGRESSIVE'};
 assert.equal(chooseOpponent({...context,random:()=>0}).action,'FOLD');
 assert.equal(chooseOpponent({...context,random:()=>.25}).action,'RAISE');
 assert.equal(chooseOpponent({...context,random:()=>.99}).action,'CALL');
});
test('coach specifically answers blockers and draws; check EV shares analysis premises',async()=>{
 const s=createSession({targetStreet:'FLOP',seed:42});const result=decide(trainingInput(s));
 assert.equal(result.status,'OK');assert.equal(result.ev.actions.CHECK.status,'MODELED');
 const snap=snapshotForCoach(result,s),block=await answerDoubt(snap,'Quais blockers tenho?',{}),draw=await answerDoubt(snap,'Quais outs tenho?',{});
 assert.match(block.answer,/blocker|removes that ace/);assert.match(draw.answer,/next card/);assert.notEqual(block.answer,draw.answer);assert.equal(block.provider,'none');
 assert.match((await answerDoubt(snap,'Qual seu filme favorito?',{})).answer,/do not have a specific analysis/);
});
test('deterministic policies preserve chips, action order, and terminate all variants',()=>{
 const seen=new Set();let raises=0;
 for(const count of [4,5,6])for(const style of ['PASSIVE','MIXED','AGGRESSIVE'])for(let seed=1;seed<=35;seed++){
  const s=createSession({variant:`PLO${count}_HIGH`,opponentStyle:style,seed});
  for(let i=0;i<60&&!s.finished;i++){
   const p=publicSession(s),aggression=p.legalActions.find(a=>a==='BET'||a==='RAISE');
   const action=aggression&&i%3!==2?aggression:p.legalActions.includes('CALL')?'CALL':'CHECK';
   applyAction(s,action,aggression===action?p.minSize:undefined);
   assert.ok(Math.abs(s.heroStack+s.villainStack+s.pot-200)<1e-8);assert.ok(s.heroStack>=0&&s.villainStack>=0);
   if(!s.finished)assert.equal(s.state.actor,0);
  }
  assert.equal(s.finished,true);
  for(const e of s.history.filter(e=>e.actor==='OPPONENT')){seen.add(e.action);if(e.action==='RAISE')raises++;}
 }
 for(const action of ['FOLD','CALL','RAISE','BET','CHECK'])assert.ok(seen.has(action),action);assert.ok(raises>0);
});
test('opponent tendencies do not mix policy generations',()=>{
 const {opponentTendencies}=require('../src/training-store');
 const events=[{type:'HAND_COMPLETE',opponentStyle:'MIXED',opponentActions:[{action:'BET'}]},
  {type:'HAND_COMPLETE',opponentStyle:'MIXED',policyVersion:'HEURISTIC_OPPONENT_V2',opponentActions:[{action:'CHECK'},{action:'FOLD'}]}];
 const x=opponentTendencies(events,'MIXED');assert.equal(x.observedBets,0);assert.equal(x.opportunities,1);assert.equal(x.observedResponses.FOLD,1);
});
test('unconfigured Llama falls back to computed facts without an external endpoint',async()=>{
 const s=createSession({seed:13});const d=decide(trainingInput(s));
 const answer=await answerDoubt(snapshotForCoach(d,s),'Qual mão tenho?',{THEIBS_LLM_PROVIDER:'ollama',THEIBS_LLM_MODEL:'example',THEIBS_LLM_URL:'https://invalid.example'});
 assert.equal(answer.provider,'none');assert.equal(answer.fallback,true);assert.match(answer.answer,/Preflop/);
});
