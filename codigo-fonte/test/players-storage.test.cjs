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
