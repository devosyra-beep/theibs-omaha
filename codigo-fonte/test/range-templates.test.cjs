'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const templates=require('../public/range-templates');
const owner='a'.repeat(64),otherOwner='b'.repeat(64);
const context={variant:'PLO5_HIGH',street:'RIVER',position:'BB',heroPosition:'SB',originalSeats:2,activeSeats:2,facingBet:false,legalActions:['BET','CHECK','FOLD'],scope:'CURRENT_PUBLIC_DECISION'};
const range={complete:true,combos:[{cards:['As','Kh','Qd','Jc','9s'],weight:2},{cards:['Ah','Kd','Qc','Js','9h'],weight:.25}]};
const input=()=>({playerId:'player-1',name:'Reviewed finite prior',context,range,board:['2s','3h','4d','5c','6s'],handId:'source-hand',revisionKey:'r1',rationale:'Manual study hypothesis.'});
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
test('templates retain full support and exact relative weights without creating action observations',()=>{
 const item=templates.create(input());assert.deepEqual(item.range.combos,range.combos);assert.equal(item.statisticalObservation,false);assert.equal(item.conditioningScope,'CONDITIONAL_AT_DECISION');
 item.range.combos[0].weight=500;assert.equal(range.combos[0].weight,2);
 for(const bad of [{...input(),range:{...range,complete:false}},{...input(),range:{complete:true,combos:[...range.combos,range.combos[0]]}},{...input(),range:{complete:true,combos:[{cards:range.combos[0].cards,weight:0}]}},{...input(),board:['As','3h','4d','5c','6s']}])assert.throws(()=>templates.create(bad));
});
test('suggestions match stable identity and public context only, always require review and never prune blockers',()=>{
 const s=storage(),data=templates.save(s,owner,[input()],0);
 const candidate=templates.candidates(data,{playerId:'player-1',context,board:['As','3h','4d','5c','6s']})[0];
 assert.equal(candidate.requiresReview,true);assert.equal(candidate.boardChanged,true);assert.equal(candidate.blockedCombinations,1);assert.deepEqual(candidate.template.range.combos,range.combos);
 for(const variation of [{playerId:'different',context},{playerId:'player-1',context:{...context,position:'SB'}},{playerId:'player-1',context:{...context,facingBet:true}},{playerId:'player-1',context:{...context,originalSeats:3}}])assert.equal(templates.candidates(data,{...variation,board:input().board}).length,0);
 assert.throws(()=>templates.contextKey({...context,variant:'PLO4_HIGH'}));assert.throws(()=>templates.contextKey({...context,street:'TURN'}));
});
test('owner-scoped templates survive reload; conflicts and quota preserve last accepted data',()=>{
 const s=storage();templates.save(s,owner,[input()],0);assert.equal(templates.load(s,otherOwner).templates.length,0);
 assert.throws(()=>templates.save(s,owner,[input()],0),/another tab/);assert.equal(templates.load(s,owner).revision,1);
 const failing={...s,setItem(){throw Error('Quota');}};assert.throws(()=>templates.save(failing,owner,[{...input(),name:'New'}],1),/Quota/);assert.equal(templates.load(s,owner).templates[0].name,'Reviewed finite prior');
 templates.removePlayer(s,owner,'player-1');assert.equal(templates.load(s,owner).templates.length,0);
});
test('approving a later hypothesis replaces only the same player/context and never truncates support',()=>{
 const s=storage(),first=templates.save(s,owner,[input()],0);
 const next=templates.save(s,owner,[{...input(),name:'Second',range:{complete:true,combos:[range.combos[1]]}}],first.revision);
 assert.equal(next.templates.length,1);assert.equal(next.templates[0].name,'Second');assert.equal(next.templates[0].range.combos.length,1);
 assert.throws(()=>templates.create({...input(),range:{complete:true,combos:Array.from({length:33},()=>range.combos[0])}}));
 assert.throws(()=>templates.load(s,'not-verified'));
});
test('template contexts describe the Hero public decision without pretending to be an opponent action context',()=>{
 const seat={playerId:'player-1',position:'BB',hero:false},hero={position:'SB',hero:true};
 const result=templates.contextFor({phase:'BETTING',variant:'PLO5_HIGH',street:'RIVER',players:[hero,seat],initialPlayerCount:2,activePlayers:2,legal:{toCall:1,actions:['FOLD','CALL','RAISE']}},seat);
 assert.equal(result.scope,'CURRENT_PUBLIC_DECISION');assert.deepEqual(result.legalActions,['CALL','FOLD','RAISE']);assert.equal(result.heroPosition,'SB');assert.equal(result.facingBet,true);
 assert.equal(templates.contextFor({phase:'WAIT_BOARD'},seat),null);assert.equal(templates.contextFor({},hero),null);
});
