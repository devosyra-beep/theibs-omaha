'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const stats=require('../src/economic-statistics');
const env=require('../src/analyze-experiment-env');
const {buildAnalyzeInput}=require('../src/analyze-policy');
const {replay}=require('../src/hand-flow');
const schedule={type:'PERCENT_CAPPED',rate:.05,cap:2,noFlopNoDrop:false,rounding:'FLOOR_CENT',source:'SYNTHETIC_STUDY',version:'1'};
test('positive expectation need not mean most positive blocks, and the converse fails',()=>{
  const jackpot=stats.describeDistribution([{value:20,probability:.1},{value:-1,probability:.9}]);assert.ok(jackpot.expectation>0);assert.ok(jackpot.pPositive<.5);
  const crash=stats.describeDistribution([{value:1,probability:.99},{value:-200,probability:.01}]);assert.ok(crash.expectation<0);assert.ok(crash.pPositive>.5);
});
test('bounded mean intervals respect support and do not claim certainty from identical observations',()=>{
  const ci=stats.boundedMeanCI(Array(100).fill(5),{lower:-50,upper:50,alpha:.001});assert.ok(ci.lower<=5&&ci.upper>=5);assert.ok(ci.upper>ci.lower);assert.ok(ci.lower>=-50&&ci.upper<=50);
  assert.throws(()=>stats.boundedMeanCI([51],{lower:-50,upper:50,alpha:.05}));
});
test('binomial exact intervals remain uncertain at zero/all successes and match known n=1 value',()=>{
  const zero=stats.probabilityCI(0,1),one=stats.probabilityCI(1,1);assert.equal(zero.lower,0);assert.ok(Math.abs(zero.upper-.975)<1e-12);assert.ok(Math.abs(one.lower-.025)<1e-12);assert.equal(one.upper,1);
  assert.ok(stats.probabilityCI(10,10).lower<.8);assert.throws(()=>stats.probabilityCI(11,10));
});
test('prediction interval is for next block, not a confidence interval of the mean',()=>{
  const short=stats.predictiveInterval([1,2,3],{lower:-5000,upper:5000});assert.equal(short.status,'UNINFORMATIVE');assert.equal(short.lower,-5000);
  const sufficient=stats.predictiveInterval(Array.from({length:19},(_,i)=>i-9),{lower:-5000,upper:5000});assert.equal(sufficient.lower,-9);assert.equal(sufficient.upper,9);assert.equal(sufficient.coverage,.9);
});
test('power plan distinguishes target threshold from larger alternative and does not infer achieved power',()=>{
  const p=stats.planPower({sdBB100:100,alpha:.025,nullBB100:1,alternativeBB100:3});assert.ok(p.requiredHands>1000000);assert.equal(p.method,'NORMAL_APPROXIMATION_PLANNING_ONLY');assert.throws(()=>stats.planPower({sdBB100:1,alpha:.05,nullBB100:1,alternativeBB100:1}));
});
test('deal generator is reproducible without duplicate cards and hashes actual bytes',()=>{
  assert.deepEqual(env.deal('same'),env.deal('same'));assert.notDeepEqual(env.deal('same'),env.deal('other'));const w=env.deal('same');assert.equal(new Set([...w.holes.flat(),...w.board]).size,15);
  assert.equal(env.hash(Buffer.from('abc')),crypto.createHash('sha256').update('abc').digest('hex'));
});
test('public observation and canonical input exclude world seed, rival cards and future board',()=>{
  const world=env.deal('secret'),state=replay({variant:'PLO5_HIGH',playerCount:2,heroPosition:'BTN',startingStack:100,smallBlind:1,bigBlind:2,heroCards:world.holes[0]});
  const obs=env.observation(state,world.holes[0],null),input=buildAnalyzeInput({...obs,world,seed:'secret',opponentFamily:'PRESSURE'},{assumeNoRake:true,study:true,callProbability:.5,sizeFraction:.5});
  assert.equal(input.players,2);assert.deepEqual(input.board,[]);assert.ok(!('world'in input));assert.ok(!('opponentFamily'in input));assert.notEqual(input.seed,'secret');assert.ok(!JSON.stringify(input).includes(JSON.stringify(world.holes[1][0])));
});
test('public effective stack preserves cent-valued all-in calls after subtraction',()=>{
  const world=env.deal('rounding'),state={heroId:0,players:[{id:0,position:'SB',stack:7.52,streetPaid:72.68,totalPaid:92.48,folded:false},{id:1,position:'BB',stack:0,streetPaid:80.2,totalPaid:100,folded:false}],pot:192.48,heroToCall:7.52,board:world.board.slice(0,3),bigBlind:2,legal:{actions:['FOLD','CALL'],minTo:80.2,maxTo:80.2,toCall:7.52},log:[]};
  assert.ok(80.2-72.68<7.52);
  const obs=env.observation(state,world.holes[0],null),input=buildAnalyzeInput(obs,{assumeNoRake:true});
  assert.equal(obs.effectiveStack,7.52);assert.equal(input.effectiveStack,input.amountToCall);
});
test('heads-up seats alter actual turn order and fold fees exclude unmatched blind',async()=>{
  const seen=[];
  const btn=await env.playHand({seed:'seat',heroSeat:0,opponentFamily:'CALL_STATION',rakeSchedule:schedule,policy:o=>{seen.push(o);return {action:'FOLD'};}});
  assert.equal(btn.netBB,-.5);assert.equal(btn.foldAccounting.uncalledReturn,1);assert.equal(btn.foldAccounting.contestedPot,2);assert.equal(btn.rakeChips,.1);assert.ok(Math.abs(btn.netChips+btn.opponentNetChips+btn.rakeChips)<1e-8);assert.equal(seen[0].heroSeat,0);
  const bb=await env.playHand({seed:'seat',heroSeat:1,opponentFamily:'CALL_STATION',rakeSchedule:null,policy:o=>{seen.push(o);return {action:o.legal.actions.includes('CHECK')?'CHECK':'CALL'};}});
  const firstBB=seen.find(o=>o.heroSeat===1);assert.equal(firstBB.amountToCall,0);assert.equal(firstBB.actionHistory[2].actor,0);assert.equal(firstBB.actionHistory[2].action,'CALL');assert.equal(bb.showdown,true);assert.ok(bb.events.filter(e=>e.type==='BOARD').length===3);
});
test('complete hands preserve conservation, positive and negative financing, all streets and explicit rake',async()=>{
  for(const heroSeat of [0,1]){
    const hand=await env.playHand({seed:'conservation',heroSeat,opponentFamily:'CALL_STATION',rakeSchedule:schedule,policy:o=>{const aggressive=o.legal.actions.find(a=>a==='RAISE'||a==='BET');return aggressive?{action:aggressive,to:o.legal.maxTo}:{action:o.legal.actions.includes('CHECK')?'CHECK':'CALL'};}});
    assert.equal(hand.finalStacks.reduce((a,b)=>a+b,0)+hand.rakeChips,200);assert.equal(hand.funding.externalWithdrawalChips-hand.funding.externalTopupChips,hand.netChips);assert.equal(hand.showdown,true);assert.equal(hand.rakeChips,2);assert.ok(hand.netBB>=-50&&hand.netBB<=50);
  }
});
test('summary keeps bb/100, fixed capital percent, paired delta and probability as distinct quantities',()=>{
  const {summarize}=require('../scripts/evaluate-analyze.cjs'),records=[];
  for(let block=0;block<20;block++)for(let hand=0;hand<100;hand++)for(const policy of ['baseline','candidate']){
    const netBB=policy==='baseline'?-1:2;
    records.push({scenario:'CELL',block,hand,heroSeat:hand%2,policy,netBB,decisions:[],rakeChips:0,funding:{externalTopupChips:Math.max(0,-2*netBB),externalWithdrawalChips:Math.max(0,2*netBB)}});
  }
  const protocol={stage:'holdout',id:'TEST',baselineVersion:'0.13.0',candidateVersion:'test',referenceCapitalBB:1000,funding:'UNLIMITED_TOPUP_RESET_EACH_HAND',settings:{samples:500},alphaFamily:.05,meanFamilySize:12,probabilityFamilySize:8,blocks:20,handsPerBlock:100,policies:['baseline','candidate'],scenarios:[{id:'CELL',opponentFamily:'CALL_STATION',rakeSchedule:null}],limitations:[]};
  const candidate=summarize(protocol,records,'test').scenarios[0].policies[1];
  assert.equal(candidate.meanBB100,200);assert.equal(candidate.deltaBB100,300);assert.equal(candidate.referenceCapitalPercent,20);assert.equal(candidate.pPositive,1);assert.ok(candidate.pPositiveCI.lower<1);
  assert.equal(candidate.quantiles100.p50,200);assert.equal(candidate.referenceCapitalPercentCI.lower,candidate.meanCI.lower*.1);
  assert.deepEqual(candidate.referenceCapitalPercentCI.support,[-500,500]);
});
