'use strict';
const crypto=require('node:crypto');
const {replay}=require('./hand-flow');
const {makeDeck,normalizeCards}=require('./cards');
const fast=require('./fast-evaluator');
const {calculateRake}=require('./rake-model');
function hash(value){return crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');}
function rng(seed){let counter=0;return ()=>crypto.createHash('sha256').update(`${seed}:${counter++}`).digest().readUInt32BE(0)/4294967296;}
function deal(seed){const cards=makeDeck().map(c=>c.code),random=rng(`deal:${seed}`);for(let i=cards.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[cards[i],cards[j]]=[cards[j],cards[i]];}return {holes:[cards.slice(0,5),cards.slice(5,10)],board:cards.slice(10,15)};}
function observation(state,heroCards,rakeSchedule){
  const hero=state.players[state.heroId],opponents=state.players.filter(p=>p.id!==state.heroId&&!p.folded);
  return {variant:'PLO5_HIGH',heroSeat:state.heroId,heroCards:[...heroCards],board:[...state.board],position:state.heroId===0?'BTN':'BB',
    players:2,publicSeats:state.players.map(p=>({id:p.id,position:p.position,stackRemaining:p.stack,contribution:p.streetPaid,totalContribution:p.totalPaid,folded:p.folded})),
    potBeforeAction:state.pot,amountToCall:state.heroToCall,effectiveStack:Math.round(Math.min(hero.stack,...opponents.map(p=>p.stack+p.streetPaid-hero.streetPaid))*100)/100,heroContribution:hero.streetPaid,
    opponents:opponents.map(p=>({id:p.id,contribution:p.streetPaid,stackRemaining:p.stack})),legal:structuredClone(state.legal),actionHistory:structuredClone(state.log),bigBlind:state.bigBlind,rakeSchedule};
}
// These policies are deliberately independent of the evaluator, its ranges,
// production opponent-policy, and hero's cards. They are synthetic adversaries,
// not an external human benchmark. Only their OWN hole cards and public state
// reach this routine. Style is never passed into the hero observation.
function opponentAction(state,ownCards,family,seed){
  const l=state.legal,raise=l.actions.find(a=>a==='BET'||a==='RAISE');
  if(family==='CALL_STATION')return {action:l.actions.includes('CHECK')?'CHECK':'CALL'};
  if(family!=='PRESSURE')throw Error(`Unknown opponent family: ${family}`);
  const random=rng(`${seed}:${hash({street:state.street,log:state.log})}`),ranks=ownCards.map(c=>c[0]),boardRanks=state.board.map(c=>c[0]);
  const pairs=ranks.length-new Set(ranks).size,aces=ranks.filter(r=>r==='A').length,matched=ranks.filter(r=>boardRanks.includes(r)).length;
  const strong=state.board.length?matched>=2||pairs>=2:aces>=1||pairs>=2;
  if(raise&&random()<(strong?.75:.18)){const to=Math.round((l.minTo+(l.maxTo-l.minTo)*.65)*100)/100;return {action:raise,to};}
  if(l.actions.includes('CHECK'))return {action:'CHECK'};
  const price=l.toCall/(state.pot+l.toCall);
  return {action:strong||price<.15||random()<.22?'CALL':'FOLD'};
}
function assertConservation(state,total=200){const sum=state.players.reduce((s,p)=>s+p.stack,0)+state.rake+state.pot;if(Math.abs(sum-total)>.000001)throw Error(`Economic ledger not conserved: ${sum} != ${total}`);}
async function playHand({seed,heroSeat,opponentFamily,rakeSchedule,policy,world:providedWorld}) {
  if(![0,1].includes(heroSeat)||typeof policy!=='function')throw Error('Invalid Analyze hand settings.');
  const world=providedWorld||deal(seed),heroCards=world.holes[heroSeat],config={variant:'PLO5_HIGH',playerCount:2,heroPosition:heroSeat===0?'BTN':'BB',startingStack:100,smallBlind:1,bigBlind:2,heroCards};
  const events=[],decisions=[];let state=replay(config,events),foldAccounting=null;
  for(let step=0;state.phase!=='FINISHED';step++){
    if(step>=160)throw Error('Hand action limit; preserve as technical failure, never drop from a completed sample.');
    if(state.phase==='WAIT_BOARD'){events.push({type:'BOARD',cards:world.board.slice(0,{FLOP:3,TURN:4,RIVER:5}[state.nextStreet])});state=replay(config,events);continue;}
    if(state.phase==='SHOWDOWN'){
      fast.initialize();const board=normalizeCards(state.board),scores=world.holes.map(hand=>fast.omahaScore(normalizeCards(hand),board));
      const winners=state.pots.map(p=>{const max=Math.max(...p.eligible.map(id=>scores[id]));return p.eligible.filter(id=>scores[id]===max);});
      events.push({type:'SETTLE',winners,rake:rakeSchedule?calculateRake({pot:state.pot,boardCount:state.board.length},rakeSchedule):0});state=replay(config,events);continue;
    }
    const actor=state.actor,prior=state;
    let selected;
    if(actor===heroSeat){const obs=observation(state,heroCards,rakeSchedule);selected=await policy(obs,decisions.length);decisions.push({street:state.street,position:obs.position,observation:obs,...selected});}
    else selected=opponentAction(state,world.holes[actor],opponentFamily,seed);
    events.push({type:'ACT',actor,action:selected.action,...(selected.to==null?{}:{to:selected.to})});state=replay(config,events);
    if(state.phase==='FINISHED'&&state.result.reason==='ALL_FOLDED'){
      const unmatched=Math.abs(prior.players[0].totalPaid-prior.players[1].totalPaid),contestedPot=Math.round((prior.pot-unmatched)*100)/100;
      const fee=rakeSchedule?calculateRake({pot:contestedPot,boardCount:state.board.length},rakeSchedule):0,winner=state.result.winners[0];
      state.players[winner].stack=Math.round((state.players[winner].stack-fee)*100)/100;state.rake=fee;
      state.result.awards[0].amount=Math.round((state.result.awards[0].amount-fee)*100)/100;
      foldAccounting={grossPot:prior.pot,uncalledReturn:unmatched,contestedPot,rake:fee,winner};
    }
  }
  assertConservation(state);
  const net=state.players.map(p=>Math.round((p.stack-100)*100)/100),netBB=net[heroSeat]/2;
  return {seed,heroSeat,opponentFamily,netBB,netChips:net[heroSeat],opponentNetChips:net[1-heroSeat],rakeChips:state.rake,finalStacks:state.players.map(p=>p.stack),
    funding:{model:'UNLIMITED_TOPUP_RESET_EACH_HAND',startingStackChips:100,externalTopupChips:Math.max(0,-net[heroSeat]),externalWithdrawalChips:Math.max(0,net[heroSeat])},
    foldAccounting,showdown:state.result.reason==='REPORTED_SHOWDOWN',events,decisions,worldHash:hash(world)};
}
module.exports={hash,rng,deal,observation,opponentAction,assertConservation,playHand};
