'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const session=require('../../src/multiway-session');
const {capacityRiverInput}=require('./river-hu-capacity-fixtures.cjs');
const manifest=require('../../public/browser-multiway-manifest.json');
const root=path.resolve(__dirname,'../..');
const fix=record=>({...record,handId:'11111111-1111-4111-8111-111111111111',editEpoch:0,
  config:{...record.config,players:record.config.players.map((player,index)=>({playerId:'qa-seat-'+index,name:'QA '+index}))},
  events:record.events.map(({eventId,originEventId,...event})=>event)});
let table=session.start({variant:'PLO5_HIGH',playerCount:6,heroPosition:'BTN',startingStack:100,smallBlind:.5,bigBlind:1,heroCards:['As','Ks','Qh','Jh','Td']});
while(table.state.actor!==table.state.heroId)table=session.step(table.multiway,{type:'ACT',actor:table.state.actor,action:'CALL'});
const normal={multiway:fix(table.multiway),multiwayEvaluation:{assumeNoRake:true,feeBasis:'BEFORE_FEES'}};
const context=vm.createContext({TextEncoder,TextDecoder,structuredClone,crypto:crypto.webcrypto,performance:{now:()=>0}});
vm.runInContext(fs.readFileSync(path.join(root,'public/browser-multiway-worker.js'),'utf8'),context);
const expected=context.TheibsBrowserMultiway.execute(normal,{phase:'FINAL'});
const solver=[
  {id:'HU12_TWO_SIZES',combos:12,maxAggressions:1},
  {id:'HU24_TWO_SIZES',combos:24,maxAggressions:1},
  {id:'HU24_NO_ADDITIONAL_AGGRESSION',combos:24,maxAggressions:0},
  {id:'HU32_NO_ADDITIONAL_AGGRESSION',combos:32,maxAggressions:0},
  {id:'HU32_TWO_SIZES_REFUSED',combos:32,maxAggressions:1,expectedRefusal:'MEMORY_BUDGET'},
  {id:'HU48_RANGE_REFUSED',combos:48,maxAggressions:0,expectedRefusal:'RANGE_BUDGET'},
].map(fixture=>{const input=capacityRiverInput({combos:fixture.combos,sizings:2,maxAggressions:fixture.maxAggressions});input.multiway=fix(input.multiway);return {...fixture,input,revisionKey:session.envelope(input.multiway).state.revisionKey};});
const output={schemaVersion:1,sourceFingerprint:manifest.buildFingerprint,normal,expected:{samples:128,model:expected.strategyMetadata.status,fingerprint:expected.multiwayEvaluation.fingerprint,
  equity:expected.equity.equity,candidates:expected.ev.candidates.map(({optionId,evBB})=>({optionId,evBB})),revisionKey:expected.observedState.revisionKey},solver};
fs.writeFileSync(path.join(root,'public/browser-multiway-fixtures.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({status:'BUILT',samples:128,riverCap:require('../../src/solver/plo-river-game').HU_SUPPORT.maxCombosPerSeat}));
