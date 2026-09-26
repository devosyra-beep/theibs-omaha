'use strict';
const {randomUUID}=require('node:crypto');
const {makeDeck,cardCodes}=require('./cards');
const {evaluateOmaha,compareHands}=require('./evaluator');
const {Lcg}=require('./equity-engine');
const {holeCount}=require('./variants');
const {replay}=require('./hand-flow');
const {chooseOpponent}=require('./opponent-policy');
const {sizeCandidates}=require('./training-evaluator');
const STREETS=['PREFLOP','FLOP','TURN','RIVER'];
function shuffle(seed){const deck=cardCodes(makeDeck()),rng=new Lcg(seed);for(let i=deck.length-1;i>0;i--){const j=Math.floor(rng.next()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}return deck;}
function sync(s){
 const state=replay(s.config,s.events);s.state=state;s.street=state.street;s.board=state.board;
 s.pot=state.pot;s.heroStack=state.players[0].stack;s.villainStack=state.players[1].stack;
 s.heroContribution=state.players[0].streetPaid;s.villainContribution=state.players[1].streetPaid;s.amountToCall=state.heroToCall;
 s.history=state.log.map(e=>({...e,actor:e.actor===0?'HERO':e.actor===1?'OPPONENT':undefined,size:e.to??e.amount,...(STREETS.indexOf(e.street)<STREETS.indexOf(s.targetStreet)?{setup:true}:{})}));
 s.finished=state.phase==='FINISHED';
 if(s.finished){s.outcome={winner:state.result.reason==='ALL_FOLDED'?(state.result.winners[0]===0?'HERO':'OPPONENT'):s.showdownWinner,heroNet:Math.round((s.heroStack-s.startingStack)*100)/100};s.amountToCall=0;}
 return state;
}
function push(s,event){const events=[...s.events,event];replay(s.config,events);s.events=events;return sync(s);}
function settle(s){
 const cmp=compareHands(evaluateOmaha(s.heroCards,s.board),evaluateOmaha(s.villainCards,s.board));
 const winners=cmp>0?[0]:cmp<0?[1]:[0,1];s.showdownOccurred=true;s.showdownWinner=cmp>0?'HERO':cmp<0?'OPPONENT':'TIE';
 push(s,{type:'SETTLE',winners:s.state.pots.map(p=>winners.filter(id=>p.eligible.includes(id))),rake:0});
}
function advanceToHero(s,{setup=false}={}){
 for(let step=0;step<100;step++){
  const state=s.state;
  if(state.phase==='FINISHED')return;
  if(state.phase==='WAIT_BOARD'){push(s,{type:'BOARD',cards:s.boardAll.slice(0,{FLOP:3,TURN:4,RIVER:5}[state.nextStreet])});continue;}
  if(state.phase==='SHOWDOWN'){settle(s);return;}
  if(state.actor===0)return;
  const legal=state.legal,rng=new Lcg(s.seed+7919*s.events.length+31);
  const action=setup?{action:legal.toCall?'CALL':'CHECK'}:chooseOpponent({cards:s.villainCards,board:s.board,legal,pot:s.pot,style:s.opponentStyle,streetRaises:s.history.filter(e=>e.street===s.street&&e.actor==='OPPONENT'&&e.action==='RAISE').length,random:()=>rng.next()});
  push(s,{type:'ACT',actor:1,...action});
 }
 throw Error('Treino excedeu o limite de ações automáticas.');
}
function createSession(options={}){
 const seed=Number(options.seed??42),startingStack=Number(options.startingStack??100),style=String(options.opponentStyle||'MIXED').toUpperCase(),mode=String(options.mode||'GUIDED').toUpperCase(),target=String(options.targetStreet||'PREFLOP').toUpperCase();
 if(!Number.isInteger(seed)||!Number.isFinite(seed))throw Error('Seed inválida.');
 if(!Number.isInteger(startingStack)||startingStack<20||startingStack>10000)throw Error('Stack inicial deve ser inteiro entre 20 e 10000.');
 if(!['PASSIVE','AGGRESSIVE','MIXED'].includes(style)||!['GUIDED','CHALLENGE'].includes(mode)||!STREETS.includes(target))throw Error('Configuração de treino inválida.');
 const variant=options.variant||'PLO5_HIGH',count=holeCount(variant),deck=shuffle(seed);
 const s={id:randomUUID(),targetStreet:target,seed,startingStack,opponentStyle:style,mode,variant,heroCards:deck.slice(0,count),villainCards:deck.slice(count,count*2),boardAll:deck.slice(count*2,count*2+5),events:[],decisions:[],showdownOccurred:false,outcome:null,startedAt:new Date().toISOString(),policyVersion:'HEURISTIC_OPPONENT_V2'};
 s.config={variant,playerCount:2,heroPosition:'BTN',startingStack,smallBlind:1,bigBlind:2,heroCards:s.heroCards};sync(s);
 while(s.street!==target&&!s.finished){push(s,{type:'ACT',actor:0,action:s.state.legal.toCall?'CALL':'CHECK'});advanceToHero(s,{setup:true});}
 s.setupEventCount=s.events.length;sync(s);
 s.history=s.history.map(e=>({...e,...(STREETS.indexOf(e.street)<STREETS.indexOf(target)?{setup:true}:{})}));
 // Target-street exercises arrive after a scripted check, not a hidden bet.
 return s;
}
function legalDecision(s){const x=s.state.legal;if(s.finished||s.state.actor!==0)return {actions:[],minSize:null,maxSize:null};return {actions:x.actions.filter(a=>a!=='FOLD'||x.toCall>0),minSize:x.minTo??null,maxSize:x.maxTo??null};}
function publicSession(s){const l=legalDecision(s);return {id:s.id,revision:s.events.length,variant:s.variant,mode:s.mode,opponentStyle:s.opponentStyle,street:s.street,heroCards:s.heroCards,board:s.board,position:'BTN',pot:s.pot,heroStack:s.heroStack,opponentStack:s.villainStack,amountToCall:s.amountToCall,legalActions:l.actions,minSize:l.minSize,maxSize:l.maxSize,sizeCandidates:s.finished?[]:sizeCandidates(s.state),history:s.history,finished:s.finished,outcome:s.outcome,policyVersion:s.policyVersion,...(s.showdownOccurred?{opponentCards:s.villainCards}:{})};}
function applyAction(s,actionInput,sizeInput){
 const action=String(actionInput||'').toUpperCase();if(!legalDecision(s).actions.includes(action))throw Error('Ação ilegal para o estado atual.');
 const event={type:'ACT',actor:0,action,...(['BET','RAISE'].includes(action)?{to:Number(sizeInput)}:{})};
 push(s,event);advanceToHero(s);return publicSession(s);
}
function trainingInput(s){return {variant:s.variant,heroCards:s.heroCards,board:s.board,position:'BTN',players:2,potBeforeAction:s.pot,amountToCall:s.amountToCall,effectiveStack:Math.min(s.heroStack,s.villainStack+s.amountToCall),unknownOpponentModel:'UNIFORM',assumeNoRake:true,futureStreetModel:{type:'SHOWDOWN_ONLY'},samples:1000,seed:s.seed+STREETS.indexOf(s.street),availableActions:legalDecision(s).actions,actionHistory:s.history};}
module.exports={createSession,publicSession,legalDecision,applyAction,trainingInput};
