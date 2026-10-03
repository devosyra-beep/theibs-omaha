'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createStorage}=require('../public/players-storage');
const owner='a'.repeat(64),prefix=`theibs.multiway.players.v2:${owner}`,legacy=`theibs.multiway.players.v1:${owner}`;
class Storage {
  constructor(){this.data=new Map();this.log=[];this.beforeSet=null;}
  getItem(key){this.log.push(['get',key]);return this.data.get(key)??null;}
  setItem(key,value){this.log.push(['set',key,value.length]);this.beforeSet?.(key,value);this.data.set(key,String(value));}
  removeItem(key){this.log.push(['remove',key]);this.data.delete(key);}
}
let sequence=0;
const adapter=storage=>createStorage({storage,idFactory:()=>`revision-${++sequence}`});
const library=()=>({schemaVersion:1,store:{schemaVersion:1,revision:1,players:{p1:{playerId:'p1',nickname:'One',notes:[],contexts:{},observations:0}},
  hands:{h1:{handId:'h1',playerIds:['p1'],observations:[]}}},archive:{old1:{multiway:{handId:'old1'},history:'x'.repeat(50000)}},decisions:{h1:[]}});
function seed(storage=new Storage()){const api=adapter(storage);assert.equal(api.open(owner).library,null);const current=library(),result=api.commit(current,{expectedRevision:null});return {storage,api,current,result};}

test('backup origin receipt survives reload without rewriting original hand bodies and remains idempotent',()=>{
  const {storage,api,current,result}=seed(),next=structuredClone(current);
  next.backupOrigins={schemaVersion:1,handIds:['h1','old1']};storage.log=[];
  const saved=api.commit(next,{expectedRevision:result.revision,dirty:{}});
  assert.notEqual(saved.revision,result.revision);assert.equal(saved.changedChunks,0);
  assert.equal(storage.log.some(([action,key])=>action==='set'&&key.includes(':record:')),false);
  assert.deepEqual(adapter(storage).open(owner).library,next);
  storage.log=[];assert.equal(api.commit(next,{expectedRevision:saved.revision,dirty:{}}).revision,saved.revision);
  assert.equal(storage.log.some(([action])=>action==='set'),false);
});

test('invalid or quota-failed provenance receipts cannot overwrite either complete recovery revision',()=>{
  const {storage,api,current,result}=seed(),next=structuredClone(current);
  next.backupOrigins={schemaVersion:1,handIds:['h1','h1']};
  assert.throws(()=>api.commit(next,{expectedRevision:result.revision,dirty:{}}),/origin/);
  next.backupOrigins.handIds=['h1'];const before=[...storage.data];
  storage.beforeSet=key=>{if(key.endsWith(':head'))throw Error('Quota exceeded');};
  assert.throws(()=>api.commit(next,{expectedRevision:result.revision,dirty:{}}),/Quota/);
  storage.beforeSet=null;assert.deepEqual([...storage.data],before);
  assert.deepEqual(adapter(storage).open(owner).library,current);
});
const nextPlayer=current=>{const next=structuredClone(current);next.store.revision++;next.store.players.p1.nickname='Two';return next;};

test('first write and reopen preserve every record with an account-specific namespace',()=>{
  const {storage,current,result}=seed();assert.equal(result.changedChunks,4);
  assert.deepEqual(adapter(storage).open(owner).library,current);
  assert.equal(adapter(storage).open('b'.repeat(64)).library,null);
  assert.ok([...storage.data.keys()].every(key=>key.startsWith(prefix+':')));
});

test('a player update does not reread or rewrite historical bodies and serializes only dirty records',()=>{
  const {storage,api,current,result}=seed(),next=nextPlayer(current);
  Object.defineProperty(next.archive.old1,'toJSON',{value:()=>{throw Error('Historical archive was serialized during a player update.');}});
  storage.log=[];const changed=api.commit(next,{expectedRevision:result.revision,dirty:{players:['p1']}});
  assert.equal(changed.changedChunks,1);assert.ok(changed.serializedBytes<3000);
  assert.equal(storage.log.filter(([action,key])=>action==='set'&&key.includes(':record:')).length,1);
  assert.equal(storage.log.some(([action,key])=>action==='get'&&/:record:(archive|decisions|hands):/.test(key)),false);
  assert.deepEqual(adapter(storage).open(owner).library.store.players.p1.nickname,'Two');
  assert.equal(adapter(storage).open(owner).library.archive.old1.history.length,50000);
});

test('unchanged dirty records need no chunk or head writes, and deleted IDs are removed from the new revision',()=>{
  const {storage,api,current,result}=seed();storage.log=[];
  const identical=api.commit(current,{expectedRevision:result.revision,dirty:{players:['p1'],hands:['h1']}});
  assert.equal(identical.revision,result.revision);assert.equal(identical.serializedBytes,0);assert.equal(storage.log.some(([action])=>action==='set'),false);
  const next=structuredClone(current);delete next.store.players.p1;next.store.revision++;
  const removed=api.commit(next,{expectedRevision:result.revision,dirty:{players:['p1']}});
  assert.equal(removed.deletedRecords,1);assert.equal(removed.changedChunks,0);
  assert.deepEqual(adapter(storage).open(owner).library.store.players,{});
});

test('quota failure at every publication step leaves the previous complete revision readable',()=>{
  for(const at of [':record:',':manifest:',':head']){
    const {storage,api,current,result}=seed(),before=[...storage.data];
    storage.beforeSet=key=>{if(key.includes(at))throw Error('Quota exceeded');};
    assert.throws(()=>api.commit(nextPlayer(current),{expectedRevision:result.revision,dirty:{players:['p1']}}),/Quota/);
    storage.beforeSet=null;
    assert.deepEqual([...storage.data],before);assert.deepEqual(adapter(storage).open(owner).library,current);
  }
});

test('native quota errors remain short, keep the original cause and preserve complete saved revisions',()=>{
  const {storage,api,current,result}=seed(),next=nextPlayer(current);
  const saved=api.commit(next,{expectedRevision:result.revision,dirty:{players:['p1']}}),before=[...storage.data];
  const original=new DOMException(`Setting the value of '${prefix}:record:hands:h1:${saved.revision}' exceeded quota.`,'QuotaExceededError');
  storage.beforeSet=key=>{if(key.includes(':record:hands:'))throw original;};
  const pending=structuredClone(next);pending.store.revision++;pending.store.hands.h1.fingerprint='new observation';
  assert.throws(()=>api.commit(pending,{expectedRevision:saved.revision,dirty:{hands:['h1']}}),error=>{
    assert.equal(error.code,'STORAGE_QUOTA');assert.equal(error.cause,original);
    assert.ok(error.message.length<100);assert.equal(error.message.includes(prefix),false);return true;
  });
  storage.beforeSet=null;assert.deepEqual([...storage.data],before);
  assert.deepEqual(adapter(storage).open(owner).library,next);
});

test('compressed records round-trip Unicode and dictionary resets; corrupt current chunks recover the prior revision',()=>{
  const {storage,api,current,result}=seed();let random=17,text='';
  for(let i=0;i<160000;i++){random=(Math.imul(random,1664525)+1013904223)>>>0;text+=String.fromCharCode(65+(random>>>24)%32);}
  const next=structuredClone(current);next.archive.old1.history={text,unicode:'Árvores 中文 😀 Ω '+String.fromCharCode(0xd800),numbers:[1.25,-0.5,null,true,false]};
  const saved=api.commit(next,{expectedRevision:result.revision,dirty:{archive:['old1']}});
  const key=`${prefix}:record:archive:old1:${saved.revision}`,encoded=storage.getItem(key);
  assert.ok(encoded.startsWith('~THEIBS_LZW1:'));assert.ok(encoded.length<JSON.stringify({kind:'archive',id:'old1',value:next.archive.old1}).length);
  assert.ok(encoded.split(String.fromCharCode(288)).length>2,'The fixture must reset the full compression dictionary.');
  assert.deepEqual(adapter(storage).open(owner).library,next);
  storage.setItem(key,encoded.slice(0,-1)+'x');
  const recovered=adapter(storage).open(owner);assert.equal(recovered.recovered,true);assert.deepEqual(recovered.library,current);
});

test('full legacy JSON chunks are compacted without dropping hands, then the pending update is saved',()=>{
  const {storage,api,current,result}=seed(),next=nextPlayer(current);
  const saved=api.commit(next,{expectedRevision:result.revision,dirty:{players:['p1']}});
  // An older release stored plain JSON. Fill the quota around both complete
  // revisions; unrelated origin data is never removed or rewritten.
  for(const [key,value] of storage.data)if(value.startsWith('~THEIBS_LZW1:')) {
    const body=key.includes(':record:archive:')?JSON.stringify({kind:'archive',id:'old1',value:current.archive.old1}):null;
    if(body)storage.setItem(key,body);
  }
  storage.setItem('unrelated-origin-record','retained');
  const used=()=>[...storage.data].reduce((sum,[key,value])=>sum+key.length+value.length,0),limit=used()+20;
  storage.beforeSet=(key,value)=>{if(used()-(storage.data.get(key)?.length || 0)+(storage.data.has(key)?0:key.length)+value.length>limit)throw new DOMException('Storage quota exceeded','QuotaExceededError');};
  const pending=structuredClone(next);pending.store.revision++;pending.store.hands.h1.fingerprint='accepted new observation';
  const committed=api.commit(pending,{expectedRevision:saved.revision,dirty:{hands:['h1']}});
  assert.equal(committed.compacted,true);assert.ok(used()<limit/2);
  assert.equal(storage.getItem('unrelated-origin-record'),'retained');
  assert.deepEqual(adapter(storage).open(owner).library,pending);
  assert.equal(adapter(storage).open('b'.repeat(64)).library,null);
});

test('a failed retry after partial quota compaction preserves the complete logical library',()=>{
  const {storage,api,current,result}=seed();
  const archiveKey=[...storage.data.keys()].find(key=>key.includes(':record:archive:'));
  storage.setItem(archiveKey,JSON.stringify({kind:'archive',id:'old1',value:current.archive.old1}));
  const unrelated='other account data';storage.setItem('unrelated-origin-record',unrelated);
  storage.beforeSet=key=>{if(key.endsWith(':head'))throw new DOMException('Storage quota exceeded','QuotaExceededError');};
  assert.throws(()=>api.commit(nextPlayer(current),{expectedRevision:result.revision,dirty:{players:['p1']}}),error=>error.code==='STORAGE_QUOTA');
  storage.beforeSet=null;assert.ok(storage.getItem(archiveKey).startsWith('~THEIBS_LZW1:'));
  assert.deepEqual(adapter(storage).open(owner).library,current);
  assert.equal(storage.getItem('unrelated-origin-record'),unrelated);
  assert.equal([...storage.data.keys()].some(key=>key.includes(':manifest:')&&!key.endsWith(result.revision)),false);
});

test('a competing publication during compaction preserves the winning complete library',()=>{
  const {storage,api,current,result}=seed(),other=adapter(storage);other.open(owner);
  const archiveKey=[...storage.data.keys()].find(key=>key.includes(':record:archive:'));
  storage.setItem(archiveKey,JSON.stringify({kind:'archive',id:'old1',value:current.archive.old1}));
  let quota=true,competing=true;
  const winner=nextPlayer(current);winner.store.players.p1.nickname='Winning tab';
  storage.beforeSet=key=>{
    if(quota&&key.includes(':record:players:')){quota=false;throw new DOMException('Storage quota exceeded','QuotaExceededError');}
    if(competing&&key===archiveKey){competing=false;other.commit(winner,{expectedRevision:result.revision,dirty:{players:['p1']}});}
  };
  assert.throws(()=>api.commit(nextPlayer(current),{expectedRevision:result.revision,dirty:{players:['p1']}}),error=>error.code==='STORAGE_CONFLICT');
  storage.beforeSet=null;assert.deepEqual(adapter(storage).open(owner).library,winner);
});

test('legacy migration preserves content, and a failed migration leaves the original document untouched',()=>{
  const storage=new Storage(),original=JSON.stringify(library());storage.setItem(legacy,original);
  storage.beforeSet=key=>{if(key.endsWith(':head'))throw Error('Quota during migration');};
  assert.throws(()=>adapter(storage).open(owner),/Quota/);
  assert.deepEqual([...storage.data],[[legacy,original]]);
  storage.beforeSet=null;const loaded=adapter(storage).open(owner);
  assert.equal(loaded.migrated,true);assert.deepEqual(loaded.library,library());assert.equal(storage.getItem(legacy),null);
  assert.deepEqual(adapter(storage).open(owner).library,library());
});

test('stale writer and a competing commit during staging fail with STORAGE_CONFLICT without losing the winner',()=>{
  const {storage,api,current,result}=seed(),other=adapter(storage),opened=other.open(owner),next=nextPlayer(current);
  api.commit(next,{expectedRevision:result.revision,dirty:{players:['p1']}});
  assert.throws(()=>other.commit(current,{expectedRevision:opened.revision,dirty:{players:['p1']}}),error=>error.code==='STORAGE_CONFLICT'&&error.statusCode===409);
  const fresh=other.open(owner),competitor=adapter(storage),base=competitor.open(owner);let once=true;
  storage.beforeSet=key=>{
    if(once&&key.includes(':record:')){once=false;const winning=structuredClone(base.library);winning.store.revision++;winning.store.players.p1.nickname='Competing tab';competitor.commit(winning,{expectedRevision:base.revision,dirty:{players:['p1']}});}
  };
  const losing=structuredClone(fresh.library);losing.store.revision++;losing.store.players.p1.nickname='Stale staged update';
  assert.throws(()=>other.commit(losing,{expectedRevision:fresh.revision,dirty:{players:['p1']}}),error=>error.code==='STORAGE_CONFLICT');
  storage.beforeSet=null;
  assert.equal(adapter(storage).open(owner).library.store.players.p1.nickname,'Competing tab');
});

test('a missing current chunk recovers the complete previous revision and permits a new guarded write',()=>{
  const {storage,api,current,result}=seed(),next=nextPlayer(current);
  const changed=api.commit(next,{expectedRevision:result.revision,dirty:{players:['p1']}});
  storage.removeItem(`${prefix}:record:players:p1:${changed.revision}`);
  const recovery=adapter(storage),loaded=recovery.open(owner);
  assert.equal(loaded.recovered,true);assert.equal(loaded.revision,changed.revision);assert.deepEqual(loaded.library,current);
  const repaired=nextPlayer(loaded.library);repaired.store.players.p1.nickname='After recovery';
  recovery.commit(repaired,{expectedRevision:loaded.revision,dirty:{players:['p1']}});
  assert.equal(adapter(storage).open(owner).library.store.players.p1.nickname,'After recovery');
});

test('repeated updates retain only the current and previous versions while preserving untouched history',()=>{
  const {storage,api,current,result}=seed();let value=current,revision=result.revision;
  for(let i=0;i<20;i++){value=structuredClone(value);value.store.revision++;value.store.players.p1.nickname=`Player ${i}`;revision=api.commit(value,{expectedRevision:revision,dirty:{players:['p1']}}).revision;}
  assert.ok(storage.data.size<=8,`Unbounded storage keys: ${storage.data.size}`);
  assert.equal(adapter(storage).open(owner).library.archive.old1.history.length,50000);
});

test('invalid identities, missing dirty lists and corrupt documents never overwrite existing data',()=>{
  const {storage,api,current,result}=seed(),before=[...storage.data];
  assert.throws(()=>api.commit(current,{expectedRevision:result.revision}),/changed/);
  assert.throws(()=>api.commit(current,{expectedRevision:result.revision,dirty:{players:['__proto__']}}),/identity/);
  assert.throws(()=>api.open('../account'),/account/);
  assert.deepEqual([...storage.data],before);
  const broken=new Storage();broken.setItem(legacy,'{broken');
  assert.throws(()=>adapter(broken).open(owner),/untouched/);assert.equal(broken.getItem(legacy),'{broken');
  const invalid=library();invalid.store.players.p1.observations=4;
  const invalidText=JSON.stringify(invalid);broken.setItem(legacy,invalidText);
  assert.throws(()=>adapter(broken).open(owner),/untouched/);assert.deepEqual([...broken.data],[[legacy,invalidText]]);
});

// Run the durable backend checks with fake-indexeddb installed outside this
// checkout: THEIBS_IDB_TEST_MODULE=<absolute module path> node --test this-file.
let idbTestModule;
try{idbTestModule=require(process.env.THEIBS_IDB_TEST_MODULE || 'fake-indexeddb');}catch{}
const durableTest=(name,fn)=>test(name,{skip:!idbTestModule},fn);
const durableAdapter=(storage,indexedDB)=>createStorage({storage,indexedDB,idFactory:()=>`durable-${++sequence}`});
durableTest('IndexedDB migrates both complete revisions from full localStorage and commits only after transaction completion',async()=>{
  const {storage,api,current,result}=seed(),next=nextPlayer(current);
  api.commit(next,{expectedRevision:result.revision,dirty:{players:['p1']}});const untouched=[...storage.data];
  storage.beforeSet=()=>{throw new DOMException('Storage quota exceeded','QuotaExceededError');};
  const indexedDB=new idbTestModule.IDBFactory(),durable=durableAdapter(storage,indexedDB),opened=await durable.openAsync(owner);
  assert.equal(opened.backend,'indexeddb');assert.equal(opened.migrated,true);assert.deepEqual(opened.library,next);
  assert.deepEqual([...storage.data],untouched);
  const pending=structuredClone(next);pending.store.revision++;pending.store.hands.h1.fingerprint='durable observation';
  const saved=await durable.commitAsync(pending,{expectedRevision:opened.revision,dirty:{hands:['h1']}});
  assert.equal(saved.backend,'indexeddb');assert.equal(saved.changedChunks,1);assert.deepEqual([...storage.data],untouched);
  assert.deepEqual((await durableAdapter(storage,indexedDB).openAsync(owner)).library,pending);
});

durableTest('IndexedDB reads a full v1 legacy document without requiring any localStorage write',async()=>{
  const storage=new Storage(),current=library();storage.setItem(legacy,JSON.stringify(current));const untouched=[...storage.data];
  storage.beforeSet=()=>{throw new DOMException('Storage quota exceeded','QuotaExceededError');};
  const indexedDB=new idbTestModule.IDBFactory(),durable=durableAdapter(storage,indexedDB),opened=await durable.openAsync(owner);
  assert.equal(opened.backend,'indexeddb');assert.deepEqual(opened.library,current);assert.deepEqual([...storage.data],untouched);
  const changed=nextPlayer(current);await durable.commitAsync(changed,{expectedRevision:opened.revision,dirty:{players:['p1']}});
  assert.deepEqual((await durableAdapter(storage,indexedDB).openAsync(owner)).library,changed);assert.deepEqual([...storage.data],untouched);
});

durableTest('IndexedDB concurrent commits have one winner and owner migrations stay isolated',async()=>{
  const {storage,current}=seed(),indexedDB=new idbTestModule.IDBFactory(),first=durableAdapter(storage,indexedDB),second=durableAdapter(storage,indexedDB);
  const [a,b]=await Promise.all([first.openAsync(owner),second.openAsync(owner)]);assert.equal(a.revision,b.revision);
  const one=nextPlayer(current),two=nextPlayer(current);one.store.players.p1.nickname='First';two.store.players.p1.nickname='Second';
  const results=await Promise.allSettled([first.commitAsync(one,{expectedRevision:a.revision,dirty:{players:['p1']}}),second.commitAsync(two,{expectedRevision:b.revision,dirty:{players:['p1']}})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'STORAGE_CONFLICT');
  const winner=results[0].status==='fulfilled'?one:two;
  assert.deepEqual((await durableAdapter(storage,indexedDB).openAsync(owner)).library,winner);
  assert.equal((await durableAdapter(storage,indexedDB).openAsync('b'.repeat(64))).library,null);
});

durableTest('IndexedDB aborted transactions roll back new chunks and never fall back to localStorage',async()=>{
  const {storage,current}=seed(),indexedDB=new idbTestModule.IDBFactory(),durable=durableAdapter(storage,indexedDB),opened=await durable.openAsync(owner),untouched=[...storage.data];
  const prototype=idbTestModule.IDBObjectStore.prototype,original=prototype.put;
  prototype.put=function(...args){if(this.name==='heads')throw new DOMException('Storage quota exceeded','QuotaExceededError');return original.apply(this,args);};
  try{await assert.rejects(durable.commitAsync(nextPlayer(current),{expectedRevision:opened.revision,dirty:{players:['p1']}}),error=>error.code==='STORAGE_QUOTA');}
  finally{prototype.put=original;}
  assert.deepEqual((await durableAdapter(storage,indexedDB).openAsync(owner)).library,current);assert.deepEqual([...storage.data],untouched);
  const saved=await durable.commitAsync(nextPlayer(current),{expectedRevision:opened.revision,dirty:{players:['p1']}});assert.equal(saved.backend,'indexeddb');
});

durableTest('IndexedDB corruption recovers the complete prior migration snapshot; oversized headers cannot allocate',async()=>{
  const {storage,api,current,result}=seed();const next=nextPlayer(current);api.commit(next,{expectedRevision:result.revision,dirty:{players:['p1']}});
  const indexedDB=new idbTestModule.IDBFactory(),durable=durableAdapter(storage,indexedDB),opened=await durable.openAsync(owner);
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('theibs-player-library-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['records'],'readwrite');tx.objectStore('records').put('~THEIBS_LZW1:999999999:1:x',[owner,'players','p1',opened.revision]);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
  const recovered=await durableAdapter(storage,indexedDB).openAsync(owner);assert.equal(recovered.recovered,true);assert.deepEqual(recovered.library,current);
});

durableTest('an older localStorage writer is detected without overwriting either durable or legacy data',async()=>{
  const {storage,current}=seed(),indexedDB=new idbTestModule.IDBFactory(),durable=durableAdapter(storage,indexedDB),opened=await durable.openAsync(owner);
  const old=adapter(storage),loaded=old.open(owner);old.commit(nextPlayer(current),{expectedRevision:loaded.revision,dirty:{players:['p1']}});const unchanged=[...storage.data];
  await assert.rejects(durable.commitAsync(nextPlayer(current),{expectedRevision:opened.revision,dirty:{players:['p1']}}),error=>error.code==='STORAGE_CONFLICT');
  assert.deepEqual([...storage.data],unchanged);
});

durableTest('overlapping account opens activate only the latest owner and preserve both migrated histories',async()=>{
  const {storage,current}=seed(),otherOwner='b'.repeat(64),other=library();other.store.players.p1.nickname='Other owner';
  storage.setItem(`theibs.multiway.players.v1:${otherOwner}`,JSON.stringify(other));
  const indexedDB=new idbTestModule.IDBFactory(),durable=durableAdapter(storage,indexedDB);
  const [first,latest]=await Promise.all([durable.openAsync(owner),durable.openAsync(otherOwner)]);
  assert.deepEqual(first.library,current);assert.deepEqual(latest.library,other);
  const changed=nextPlayer(other);changed.store.players.p1.nickname='Latest owner update';
  await durable.commitAsync(changed,{expectedRevision:latest.revision,dirty:{players:['p1']}});
  assert.deepEqual((await durableAdapter(storage,indexedDB).openAsync(otherOwner)).library,changed);
  assert.deepEqual((await durableAdapter(storage,indexedDB).openAsync(owner)).library,current);
});

test('an IndexedDB open failure never presents stale localStorage as the current durable library',async()=>{
  const {storage}=seed(),untouched=[...storage.data];
  const durable=createStorage({storage,indexedDB:{open(){throw new DOMException('IndexedDB is blocked','SecurityError');}}});
  await assert.rejects(durable.openAsync(owner),error=>error.code==='STORAGE_UNAVAILABLE'&&error.cause.name==='SecurityError');
  assert.deepEqual([...storage.data],untouched);
});

test('async storage exposes its explicit localStorage fallback when IndexedDB is unavailable',async()=>{
  const {storage,current}=seed(),durable=createStorage({storage,indexedDB:null,idFactory:()=>`fallback-${++sequence}`});
  const opened=await durable.openAsync(owner);assert.equal(opened.backend,'localStorage');assert.ok(opened.fallbackReason);assert.deepEqual(opened.library,current);
  assert.equal((await durable.commitAsync(nextPlayer(current),{expectedRevision:opened.revision,dirty:{players:['p1']}})).backend,'localStorage');
});
