'use strict';
// Heuristic opponent, not a calibrated range or GTO policy. It sees its own
// cards, public board, price and history only; never the hero's private cards.
const {bestCurrent}=require('./hand-insights');
const {normalizeCards}=require('./cards');
function policyStrength(cards,board) {
 const hand=normalizeCards(cards),community=normalizeCards(board);
 const made=bestCurrent(hand,community);
 const suits={};for(const c of hand)suits[c.suit]=(suits[c.suit]||0)+1;
 if(made){
  const flushDraw=Object.entries(suits).some(([s,n])=>n>=2&&community.filter(c=>c.suit===s).length===2);
  return Math.min(.99,[.13,.30,.47,.61,.71,.80,.90,.96,.99][made.categoryRank]+(flushDraw&&community.length<5?.10:0));
 }
 const ranks={};for(const c of hand)ranks[c.rank]=(ranks[c.rank]||0)+1;
 const pairs=Object.values(ranks).filter(n=>n>=2).length;
 const high=hand.filter(c=>c.value>=11).length/hand.length;
 const doubleSuited=Object.values(suits).filter(n=>n>=2).length;
 return Math.min(.86,.22+pairs*.13+(ranks.A>=2?.20:ranks.A?.07:0)+high*.13+doubleSuited*.065);
}
function chooseOpponent({cards,board,legal,pot,style,streetRaises=0,random}) {
 const strength=policyStrength(cards,board),pressure=legal.toCall/Math.max(.01,pot+legal.toCall);
 const aggressive=style==='AGGRESSIVE'?1.35:style==='PASSIVE'?.55:1;
 const canRaise=legal.actions.includes('RAISE')&&streetRaises<3;
 if(legal.toCall>0){
  const fold=Math.max(.02,Math.min(.88,(.52-strength)*1.2+pressure*.9+(style==='PASSIVE'?.06:-.03)));
  const raise=canRaise?Math.max(.015,Math.min(.60,(strength-.40)*aggressive*.9+(style==='AGGRESSIVE'?.10:.02))):0;
  const roll=random();
  if(roll<fold)return {action:'FOLD'};
  if(roll<fold+raise&&canRaise)return {action:'RAISE',to:size(legal,random,aggressive)};
  return {action:'CALL'};
 }
 const betChance=Math.max(.05,Math.min(.92,(.18+strength*.65)*aggressive));
 if(legal.actions.includes('BET')&&random()<betChance)return {action:'BET',to:size(legal,random,aggressive)};
 return {action:'CHECK'};
}
function size(legal,random,aggression){
 const fraction=aggression>1?.65:aggression<1?.30:.48;
 const value=legal.minTo+(legal.maxTo-legal.minTo)*Math.min(.9,fraction+random()*.15);
 return Math.max(legal.minTo,Math.min(legal.maxTo,Math.round(value*100)/100));
}
module.exports={policyStrength,chooseOpponent};
