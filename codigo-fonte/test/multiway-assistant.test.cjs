'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const assistant=require('../src/multiway-assistant'),multiway=require('../src/multiway-session');
const config={variant:'PLO4_HIGH',playerCount:3,heroPosition:'BB',startingStack:100,smallBlind:.5,bigBlind:1,heroCards:[]};
const settings={provider:'ollama',model:'fixture',baseUrl:'http://127.0.0.1:11434',timeoutMs:3000};
const request=(r,text,id='test:event:0001')=>({multiway:r.multiway,revisionKey:r.state.revisionKey,text,originEventId:id,locale:'en-US'});
const fake=command=>async()=>({ok:true,json:async()=>({message:{content:JSON.stringify({command})}})});
test('direct commands need no model; proposals preserve the ledger and origin',async()=>{
 const r=multiway.start(config),result=await assistant.interpret(request(r,'call'),{fetchImpl:()=>{throw Error('LLM forbidden');}});
 assert.equal(result.method,'DIRECT_PARSER');assert.equal(result.event.type,'ACT');assert.equal(result.event.action,'CALL');assert.equal(result.revisionKey,r.state.revisionKey);assert.equal(r.multiway.events.length,0);
});
test('schema, legal amount and original units are checked before proposing',async()=>{
 const r=multiway.start(config),base={config:settings,allowUnvalidated:true};
 const good=await assistant.interpret(request(r,'He makes it a total of three big blinds this street.','test:units:1'),{...base,fetchImpl:fake('raise to 3 bb')});
 assert.equal(good.event.to,3);assert.equal(good.confirmationRequired,true);
 const pt=await assistant.interpret({...request(r,'O jogador da vez aumentou para um total de três big blinds.','test:units:pt'),locale:'pt-BR'},{...base,fetchImpl:fake('raise to 3 bb')});
 assert.equal(pt.event.to,3);
 await assert.rejects(assistant.interpret(request(r,'He makes it a total of three big blinds this street.','test:units:2'),{...base,fetchImpl:fake('raise to 3 chips')}),/unit/);
 await assert.rejects(assistant.interpret(request(r,'He makes it a total of three big blinds this street.','test:units:3'),{...base,fetchImpl:fake('raise to 4 bb')}),/amount/);
 await assert.rejects(assistant.interpret(request(r,'He makes it a total of three big blinds this street.','test:units:4'),{...base,fetchImpl:async()=>({ok:true,json:async()=>({message:{content:'{"command":"call","extra":"execute"}'}})})}),/schema/);
});
test('ambiguity, wrong Hero, stale hand and unsupported models never apply',async()=>{
 const r=multiway.start(config);
 const ambiguous=await assistant.interpret(request(r,'He may fold or call.'),{fetchImpl:()=>{throw Error('No model');}});assert.equal(ambiguous.status,'CLARIFY');
 await assert.rejects(assistant.interpret(request(r,'Hero lets his cards go.')),/not next/);
 await assert.rejects(assistant.interpret({...request(r,'call'),revisionKey:'stale'}),/changed/);
 assert.equal((await assistant.interpret(request(r,'The current player gives up.'),{config:settings})).status,'UNAVAILABLE');
});
test('duplicate source IDs are coalesced, and content collisions rejected',async()=>{
 const r=multiway.start(config);let calls=0;
 const opts={config:settings,allowUnvalidated:true,fetchImpl:async(...args)=>{calls++;return fake('fold')(...args);}};
 const p=request(r,'The current player throws his cards away.','test:dedupe:1');
 const [a,b]=await Promise.all([assistant.interpret(p,opts),assistant.interpret(p,opts)]);assert.deepEqual(a,b);assert.equal(calls,1);
 await assert.rejects(assistant.interpret({...p,text:'He calls.'},opts),/already used/);
});
test('table input preempts local interpretation, and busy engine skips the model',async()=>{
 const r=multiway.start(config);let begun;
 const ready=new Promise(resolve=>begun=resolve);
 const pending=assistant.interpret(request(r,'The current player gives up.','test:priority:1'),{config:settings,allowUnvalidated:true,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>{begun();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})});
 await ready;const release=assistant.prioritize();await assert.rejects(pending);
 assert.equal((await assistant.interpret(request(r,'He throws his cards away.','test:priority:2'),{config:settings,allowUnvalidated:true})).status,'BUSY');release();
});
test('duplicate names require selection; explicit ranges preserve variant and weights',()=>{
 const players=[{playerId:'p1',nickname:'Alex'},{playerId:'p2',nickname:'Alex'}];assert.equal(assistant.findPlayers(players,'Alex').status,'SELECT_PLAYER');
 assert.throws(()=>assistant.proposeRange({variant:'PLO4_HIGH',playerId:'p1',position:'BTN',action:'OPEN',sourceText:'BTN open'}),/PLO5/);
 assert.throws(()=>assistant.proposeRange({variant:'PLO4_HIGH',playerId:'p1',hands:[['As','Ah','Ks','Kh']],weights:[-1],sourceText:'explicit cards'}),/weight/);
 const p=assistant.proposeRange({variant:'PLO4_HIGH',playerId:'p1',hands:[['As','Ah','Ks','Kh']],weights:[1],sourceText:'explicit cards'});assert.equal(p.confirmationRequired,true);assert.equal(p.notGTO,true);
});
