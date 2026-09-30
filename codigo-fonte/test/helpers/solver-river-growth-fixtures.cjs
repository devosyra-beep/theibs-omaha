'use strict';
const {riverMixedInput}=require('./solver-reference-fixtures.cjs');
const board=['2s','3h','4d','8c','9s'];
const heroAnchors=['As','Ah','Qd','Jc'],opponentAnchors=['Ks','Kh','6d','7c'];
const excluded=new Set([...board,...heroAnchors,...opponentAnchors,'Tc','8h']);
const deck=[...'23456789TJQKA'].flatMap(rank=>[...'cdhs'].map(suit=>rank+suit)).filter(card=>!excluded.has(card));
const heroKickers=['Tc',...deck.slice(0,11)],opponentKickers=['8h',...deck.slice(11,22)];

function expandedRiverInput({combos=4,sizings=5,maxAggressions=1,fee=0,blocked=false}={}){
  const input=riverMixedInput();
  input.ranges=[heroAnchors,opponentAnchors].map((anchors,seatId)=>({seatId,complete:true,source:'EXPLICIT_RIVER_GROWTH_QA',
    combos:(seatId?opponentKickers:heroKickers).slice(0,combos).map((card,index)=>({cards:[...anchors,card],weight:index+1}))}));
  if(blocked&&combos>1)input.ranges[0].combos.at(-1).cards=[...heroAnchors,'Ks'];
  input.sizing={type:'EXPLICIT_TOTALS',levels:Array.from({length:sizings},(_,index)=>Math.round((1+index/(sizings-1))*100)/100),maxAggressions};
  input.rake=fee?{type:'FIXED',amount:fee}:{type:'NONE',basis:'BEFORE_FEES'};
  return input;
}
module.exports={expandedRiverInput,heroKickers,opponentKickers};
