'use strict';
// The dealer owns hidden cards. Only the public ledger is an evaluation input.
// Simulation sessions never call player learning, workspace or training storage.
const crypto = require('node:crypto');
const multiway = require('./multiway-session');
const {makeDeck,cardCodes} = require('./cards');
const {holeCount} = require('./variants');
const {evaluateOmaha,compareHands} = require('./evaluator');
const {policyDistribution,MODEL} = require('./multiway-evaluator');
const DEAL_VERSION = 'HMAC_SHA256_REJECTION_FISHER_YATES_V1';
const TTL = 2 * 60 * 60 * 1000;
const fail = (message, statusCode=400) => Object.assign(Error(message),{statusCode});
function stream(seed, domain) {
  let counter=0, bytes=Buffer.alloc(0), offset=0;
  function uint() {
    if(offset+4>bytes.length){bytes=crypto.createHmac('sha256',Buffer.from(seed,'hex')).update(domain+'|'+counter++).digest();offset=0;}
    const value=bytes.readUInt32BE(offset);offset+=4;return value;
  }
  return {next:()=>uint()/0x100000000, int:n=>{const limit=Math.floor(0x100000000/n)*n;let value;do{value=uint();}while(value>=limit);return value%n;}};
}
function shuffled(seed) {
  const deck=cardCodes(makeDeck()),rng=stream(seed,'DECK');
  for(let i=deck.length-1;i>0;i--){const j=rng.int(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}
  return deck;
}
function deal(record, seed) {
  const count=holeCount(record.config.variant),deck=shuffled(seed),hands=record.config.players.map(()=>[]);
  for(let round=0;round<count;round++)for(let seat=0;seat<hands.length;seat++)hands[seat].push(deck[round*hands.length+seat]);
  const heroId=multiway.envelope(record).state.heroId;
  const publicRecord={...record,config:{...record.config,heroCards:hands[heroId]}};
  const commitment=crypto.createHash('sha256').update(DEAL_VERSION+'\n'+seed+'\n'+deck.join(' ')).digest('hex');
  return {record:publicRecord,seed,hands,boardAll:deck.slice(count*hands.length,count*hands.length+5),commitment};
}
function fresh(options={}) {
  const variant=options.variant || 'PLO5_HIGH',playerCount=Number(options.playerCount ?? 6);
  // Presentation supports up to six seats, within each existing variant limit.
  if(playerCount>6)throw fail('Simulation supports up to six players.');
  const base=multiway.start({variant,playerCount,heroPosition:options.heroPosition || (playerCount===2?'SB':'BTN'),
    startingStack:options.startingStack ?? 100,smallBlind:options.smallBlind ?? .5,bigBlind:options.bigBlind ?? 1,heroCards:[]}).multiway;
  const heroId=multiway.envelope(base).state.heroId;
  base.config.players=base.config.players.map((_,seat)=>({playerId:'sim_'+crypto.randomUUID().replaceAll('-',''),name:seat===heroId?'You':`Bot ${seat+1}`}));
  return base;
}
function chooseBot(session,state) {
  const semanticEvents=session.record.events.map(event=>Object.fromEntries(['type','actor','action','to','cards'].filter(key=>event[key]!==undefined).map(key=>[key,event[key]])));
  const rng=stream(session.seed,'ACTION|'+JSON.stringify(semanticEvents));
  const probabilities=policyDistribution({state,cards:session.hands[state.actor],profile:null}).probabilities;
  let roll=rng.next(),action=Object.keys(probabilities).at(-1);
  for(const [name,probability] of Object.entries(probabilities)){roll-=probability;if(roll<=0){action=name;break;}}
  // Exactly the unchanged no-evidence sizing fallback of the declared policy.
  const to=['BET','RAISE'].includes(action)?Math.round((state.legal.minTo+(state.legal.maxTo-state.legal.minTo)*rng.next())*100)/100:undefined;
  return {type:'ACT',actor:state.actor,action,...(to===undefined?{}:{to})};
}
function append(session,event) {
  session.record=multiway.step(session.record,event,undefined,multiway.envelope(session.record).state.revisionKey).multiway;
}
function advance(session,all) {
  for(let step=0;step<160;step++){
    const state=multiway.envelope(session.record).state;
    if(state.phase!=='BETTING'||state.actor===state.heroId)return;
    append(session,chooseBot(session,state));
    if(!all)return;
  }
  throw fail('Simulation reached its action safety limit.');
}
function settle(session) {
  const state=multiway.envelope(session.record).state;
  if(state.phase!=='SHOWDOWN')throw fail('Finish the betting rounds before showdown.');
  const evaluated=state.players.filter(player=>!player.folded).map(player=>({id:player.id,hand:evaluateOmaha(session.hands[player.id],state.board)}));
  const winners=state.pots.map(pot=>{
    const eligible=evaluated.filter(item=>pot.eligible.includes(item.id));
    let best=eligible[0].hand;for(const item of eligible)if(compareHands(item.hand,best)>0)best=item.hand;
    return eligible.filter(item=>compareHands(item.hand,best)===0).map(item=>item.id);
  });
  append(session,{type:'SETTLE',winners,rake:0});
  session.showdown=true;
}
function publicSession(session) {
  const observed=multiway.envelope(session.record),state=observed.state,finished=state.phase==='FINISHED';
  const safe={id:session.id,revision:session.revision,createdAt:session.createdAt,expiresAt:new Date(session.expires).toISOString(),
    ...observed,source:'SIMULATED_ACTIONS',policy:{version:MODEL,origin:'DECLARED_REFERENCE_WITHOUT_PLAYER_OBSERVATIONS',quality:'HEURISTIC'},
    deal:{version:DEAL_VERSION,commitment:session.commitment,selection:'UNFILTERED_CRYPTOGRAPHIC_SEED',lockedBeforeFirstAction:true},
    paused:session.paused,abandoned:session.abandoned===true,finished:finished||session.abandoned===true,
    outcome:finished?{heroNet:Math.round((state.players[state.heroId].stack-state.players[state.heroId].startingStack)*100)/100,
      reason:state.result.reason,stacks:state.players.map(player=>({id:player.id,stack:player.stack})),rake:0}:null};
  if(session.showdown)safe.shownHands=Object.fromEntries(state.players.filter(player=>!player.folded).map(player=>[player.id,[...session.hands[player.id]]]));
  // Audit data is unavailable before completion/explicit abandonment. Revealing
  // it never modifies the public record or past decision evaluation inputs.
  if(safe.finished)safe.audit={seed:session.seed,commitment:session.commitment,version:DEAL_VERSION,
    ...(session.revealed?{hands:structuredClone(session.hands),runout:[...session.boardAll]}:{})};
  return safe;
}
function evaluationPayload(session, chosenSize) {
  if(session.abandoned)throw fail('This simulation was ended. Start a new hand.');
  const state=multiway.envelope(session.record).state;
  if(state.phase!=='BETTING'||state.actor!==state.heroId)throw fail('EV is available on your pending decision only.');
  // Strict projection. Neither shuffle/action seed nor hidden/future cards can
  // reach the calculation, even if a caller appends extra session fields.
  const record=structuredClone(session.record);
  return {multiway:record,multiwayEvaluation:{assumeNoRake:true,revisionKey:state.revisionKey,
    ...(chosenSize==null||chosenSize===''?{}:{chosenSize:Number(chosenSize)})}};
}
function createService({now=Date.now,maxSessions=128}={}) {
  const sessions=new Map();
  function get(owner,id) {
    for(const [key,value] of sessions)if(value.expires<=now())sessions.delete(key);
    const value=sessions.get(id);if(!value||value.owner!==owner)throw fail('Simulation expired or is unavailable for this account. Start a new hand.',404);
    return value;
  }
  function register(owner,record,seed=crypto.randomBytes(32).toString('hex'),paused=false) {
    for(const [key,value] of sessions)if(value.expires<=now())sessions.delete(key);
    const owned=[...sessions.values()].filter(value=>value.owner===owner);
    if(owned.length>=8)throw fail('Eight simulation hands are open. Finish or end one before starting another.',429);
    if(sessions.size>=maxSessions)throw fail('The simulator is busy. Try again shortly.',503);
    const dealt=deal(record,seed),value={...dealt,id:crypto.randomUUID(),owner,revision:0,createdAt:new Date(now()).toISOString(),expires:now()+TTL,
      paused:paused===true,receipts:new Map()};
    sessions.set(value.id,value);return publicSession(value);
  }
  function mutate(owner,payload) {
    const value=get(owner,payload.id),operation=String(payload.operation||'');
    if(typeof payload.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(payload.requestId))throw fail('A simulation operation identity is required.');
    const content=JSON.stringify({operation,revision:payload.revision,action:payload.action,to:payload.to,paused:payload.paused});
    const receipt=value.receipts.get(payload.requestId);
    if(receipt){if(receipt.content!==content)throw fail('This request identity was used for a different operation.',409);return structuredClone(receipt.result);}
    if(payload.revision!==value.revision)throw fail('The simulation changed. Refresh this hand before acting.',409);
    if(value.abandoned&&operation!=='REVEAL')throw fail('This hand was ended.');
    const next={...value,record:structuredClone(value.record)},state=multiway.envelope(next.record).state;
    if(operation==='ACT'){
      if(state.phase!=='BETTING'||state.actor!==state.heroId)throw fail('Wait for your turn.');
      const action=String(payload.action||'').toUpperCase();
      if(action==='FOLD'&&state.legal.toCall===0)throw fail('Check is available; a free fold is not a decision option.');
      append(next,{type:'ACT',actor:state.heroId,action,...(['BET','RAISE'].includes(action)?{to:Number(payload.to)}:{})});
      if(!next.paused)advance(next,true);
    } else if(operation==='ADVANCE') {
      if(state.phase!=='BETTING'||state.actor===state.heroId)throw fail('Choose your action or deal the next street.');
      advance(next,!next.paused);
    } else if(operation==='DEAL') {
      if(state.phase!=='WAIT_BOARD')throw fail('Finish the current betting round before dealing.');
      append(next,{type:'BOARD',cards:next.boardAll.slice(0,{FLOP:3,TURN:4,RIVER:5}[state.nextStreet])});
      if(!next.paused)advance(next,true);
    } else if(operation==='SETTLE')settle(next);
    else if(operation==='PACE')next.paused=payload.paused===true;
    else if(operation==='REVEAL'){
      if(state.phase!=='FINISHED'&&!next.abandoned)throw fail('Hidden cards can be revealed only after the hand ends.');
      next.revealed=true;
    } else if(operation==='END')next.abandoned=true;
    else throw fail('Unknown simulation operation.');
    next.revision++;next.expires=now()+TTL;
    const result=publicSession(next);
    next.receipts=new Map(value.receipts);next.receipts.set(payload.requestId,{content,result:structuredClone(result)});
    while(next.receipts.size>12)next.receipts.delete(next.receipts.keys().next().value);
    sessions.set(next.id,next);return result;
  }
  function next(owner,payload,replaying=false) {
    const previous=get(owner,payload.id),state=multiway.envelope(previous.record).state;
    if(payload.revision!==previous.revision)throw fail('The simulation changed.',409);
    if(replaying ? state.phase!=='FINISHED'&&!previous.abandoned : state.phase!=='FINISHED')throw fail(replaying?'Finish or end this hand first.':'Finish this hand before continuing its stacks.');
    const oldResult=publicSession(previous);
    const record=replaying?multiway.start({...previous.record.config,heroCards:[]}).multiway:
      multiway.nextHand(previous.record,{},state.revisionKey).multiway;
    // The finished receipt is already held by the UI; releasing it keeps server
    // memory bounded. No real library data is read or written.
    const result=register(owner,record,replaying?previous.seed:undefined,previous.paused);
    sessions.delete(previous.id);return {session:result,previous:oldResult};
  }
  return {start:(owner,options)=>register(owner,fresh(options),undefined,options?.paused),read:(owner,id)=>publicSession(get(owner,id)),
    mutate,next:(owner,payload)=>next(owner,payload),replay:(owner,payload)=>next(owner,payload,true),
    evaluation:(owner,id,revision,chosenSize)=>{const value=get(owner,id);if(revision!==value.revision)throw fail('The simulation changed.',409);return evaluationPayload(value,chosenSize);},
    release:(owner,id)=>{get(owner,id);sessions.delete(id);},close:()=>sessions.clear(),
    _testing:{get,size:()=>sessions.size,register}};
}
module.exports={createService,publicSession,evaluationPayload,shuffled,stream,DEAL_VERSION};
