'use strict';
// Public synthetic inputs only; no account, profile library or captured hand.
const fs=require('node:fs'),path=require('node:path');
const session=require('../src/multiway-session');
const HERO=['As','Ah','Qd','Jc','Tc'],OPP=['Ks','Kh','6d','7c','8h'],BOARD=['2s','3h','4d','8c','9s'];
let current=session.start({variant:'PLO5_HIGH',playerCount:2,heroPosition:'SB',startingStack:.53,smallBlind:.1,bigBlind:.25,heroCards:HERO});
while(current.state.street!=='RIVER' || current.state.actor!==current.state.heroId){
  current=current.state.phase==='WAIT_BOARD'?session.step(current.multiway,{type:'BOARD',cards:BOARD.slice(0,{FLOP:3,TURN:4,RIVER:5}[current.state.nextStreet])}):
    session.step(current.multiway,{type:'ACT',actor:current.state.actor,action:current.state.legal.toCall?'CALL':'CHECK'});
}
const cells=[];
for(const prior of ['A','B'])for(const tree of ['A','B']){
  const weights=prior==='A'?[[3,1],[1,4]]:[[.001,5],[4,1]];
  const ranges=[{seatId:0,complete:true,source:'PUBLIC_SYNTHETIC_PRIOR_'+prior,combos:[{cards:HERO,weight:weights[0][0]},{cards:['Ac','Ad','Qh','Js','Ts'],weight:weights[0][1]}]},
    {seatId:1,complete:true,source:'PUBLIC_SYNTHETIC_PRIOR_'+prior,combos:[{cards:OPP,weight:weights[1][0]},{cards:['Kc','Kd','6h','7d','8s'],weight:weights[1][1]}]}];
  cells.push({id:`prior${prior}-tree${tree}`,name:`Explicit prior ${prior} / ${tree==='A'?'all legal cent totals':'two-total abstraction'}`,
    revisionKey:current.state.revisionKey,input:{multiway:current.multiway,ranges,rake:{type:'NONE'},
      sizing:tree==='A'?{type:'ALL_LEGAL_TOTALS',maxAggressions:3}:{type:'EXPLICIT_TOTALS',levels:[.25,.28],maxAggressions:3}}});
}
fs.writeFileSync(path.join(__dirname,'../public/ev-coverage-fixtures.json'),JSON.stringify({schemaVersion:1,classification:'PUBLIC_SYNTHETIC_RIVER_HU_PACKAGE_QA',cells},null,2)+'\n');
