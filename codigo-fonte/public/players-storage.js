(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./player-profile-model'));
  else root.TheibsPlayersStorage = factory(root.TheibsPlayerProfiles);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (profileModel) {
  'use strict';
  // Device storage only. Immutable records are staged first; one small head
  // write publishes a complete revision and retains the prior readable one.
  // The stale-writer checks are not a cross-tab atomic compare-and-swap lock.
  const kinds = ['players','hands','archive','decisions'];
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
  const bytes = text => new TextEncoder().encode(text).byteLength;
  const emptyRefs = () => Object.fromEntries(kinds.map(kind => [kind,{}]));
  function conflict() { const error = Error('Player data changed in another tab. Review the latest data before saving.'); error.code='STORAGE_CONFLICT';error.statusCode=409;return error; }
  function validateLibrary(library) {
    if (!object(library) || library.schemaVersion !== 1 || !object(library.store) || library.store.schemaVersion !== 1 ||
        !Number.isSafeInteger(library.store.revision) || library.store.revision < 0 ||
        !object(library.store.players) || !object(library.store.hands) || !object(library.archive) ||
        library.decisions !== undefined && !object(library.decisions)) throw Error('Invalid local player library.');
  }
  function collection(library,kind) { return (kind === 'players' || kind === 'hands' ? library.store[kind] : library[kind]) || {}; }
  function validateValue(kind,id,value) {
    if (!identifier(id) || (kind === 'decisions' ? !Array.isArray(value) : !object(value)) ||
        kind === 'players' && value.playerId !== id || kind === 'hands' && value.handId !== id ||
        kind === 'archive' && value.multiway?.handId !== id) throw Error('Invalid stored player record.');
  }
  function createStorage({storage=globalThis.localStorage,idFactory=()=>globalThis.crypto.randomUUID()}={}) {
    if (!storage || !['getItem','setItem','removeItem'].every(method=>typeof storage[method] === 'function')) throw Error('Device storage is unavailable.');
    let owner=null,prefix=null,headKey=null,legacyKey=null,headText=null,manifest=null,previousManifest=null;
    let recordCache=new Map(),legacyExpected;
    const manifestKey = revision => `${prefix}:manifest:${revision}`;
    const recordKey = (kind,id,revision) => `${prefix}:record:${kind}:${id}:${revision}`;
    function readManifest(revision) {
      if (!identifier(revision)) throw Error('Invalid player storage revision.');
      const value=JSON.parse(storage.getItem(manifestKey(revision)) || 'null');
      if (!object(value) || value.schemaVersion !== 2 || value.revision !== revision ||
          !Number.isSafeInteger(value.storeRevision) || value.storeRevision < 0 || !object(value.refs)) throw Error('Invalid player storage manifest.');
      for (const kind of kinds) {
        if (!object(value.refs[kind])) throw Error('Invalid player storage index.');
        for (const [id,version] of Object.entries(value.refs[kind])) if (!identifier(id) || !identifier(version)) throw Error('Invalid player storage reference.');
      }
      return value;
    }
    function loadRecords(index) {
      const library={schemaVersion:1,store:{schemaVersion:1,revision:index.storeRevision,players:{},hands:{}},archive:{},decisions:{}};
      const cache=new Map();
      for (const kind of kinds) for (const [id,version] of Object.entries(index.refs[kind])) {
        const text=storage.getItem(recordKey(kind,id,version));
        if (text == null) throw Error('A player storage record is missing.');
        const record=JSON.parse(text);
        if (!object(record) || record.kind !== kind || record.id !== id) throw Error('Invalid player storage record.');
        validateValue(kind,id,record.value);
        collection(library,kind)[id]=record.value;cache.set(`${kind}:${id}`,text);
      }
      if(typeof profileModel?.validateStore !== 'function')throw Error('The player model is unavailable.');
      profileModel.validateStore(library.store);
      return {library,cache};
    }
    function open(ownerKey) {
      if (typeof ownerKey !== 'string' || !/^[a-f0-9]{64}$/i.test(ownerKey)) throw Error('A verified account key is required for local player storage.');
      owner=ownerKey;prefix=`theibs.multiway.players.v2:${owner}`;headKey=`${prefix}:head`;legacyKey=`theibs.multiway.players.v1:${owner}`;
      manifest=null;previousManifest=null;recordCache=new Map();legacyExpected=undefined;
      headText=storage.getItem(headKey);
      if (headText != null) {
        let head;
        try { head=JSON.parse(headText); } catch { throw Error('The player storage pointer is invalid. Saved data was left untouched.'); }
        if (!object(head) || head.schemaVersion !== 2 || !identifier(head.current) || head.previous != null && !identifier(head.previous)) throw Error('The player storage pointer is invalid. Saved data was left untouched.');
        let selected=null,recovered=false;
        for (const revision of [...new Set([head.current,head.previous].filter(Boolean))]) {
          try { const index=readManifest(revision),loaded=loadRecords(index);manifest=index;selected=loaded;recovered=revision!==head.current;break; } catch { /* Try the complete prior revision, never merge partial chunks. */ }
        }
        if (!selected) throw Error('Player records could not be recovered. Saved data was left untouched.');
        if (!recovered && head.previous) { try {previousManifest=readManifest(head.previous);} catch {} }
        recordCache=selected.cache;
        return {library:selected.library,revision:head.current,migrated:false,recovered};
      }
      const legacyText=storage.getItem(legacyKey);
      if (legacyText == null) return {library:null,revision:null,migrated:false,recovered:false};
      let library;
      try {
        library=JSON.parse(legacyText);validateLibrary(library);
        if(typeof profileModel?.validateStore !== 'function')throw Error('The player model is unavailable.');
        profileModel.validateStore(library.store);library.decisions ||= {};
      } catch {throw Error('The previous player library is invalid. Saved data was left untouched.');}
      legacyExpected=legacyText;
      try {
        const result=commit(library,{expectedRevision:null});
        // Delete the old single document only after the new complete head exists.
        if (storage.getItem(legacyKey) === legacyText) {try{storage.removeItem(legacyKey);}catch{}}
        return {library,revision:result.revision,migrated:true,recovered:false};
      } finally {legacyExpected=undefined;}
    }
    function currentHeadRevision() {
      if (!headText) return null;
      return JSON.parse(headText).current;
    }
    function unchanged(expectedRevision) {
      if (expectedRevision !== currentHeadRevision() || storage.getItem(headKey) !== headText ||
          legacyExpected !== undefined && storage.getItem(legacyKey) !== legacyExpected) throw conflict();
    }
    function referenced(index) {
      const keys=new Set();
      if (index) for (const kind of kinds) for (const [id,version] of Object.entries(index.refs[kind])) keys.add(recordKey(kind,id,version));
      return keys;
    }
    function removeQuietly(key) {try{storage.removeItem(key);}catch{}}
    function commit(library,{expectedRevision,dirty}={}) {
      if (!owner) throw Error('Open the account player library before saving.');
      validateLibrary(library);unchanged(expectedRevision);
      if (dirty === undefined && manifest) throw Error('Identify the changed player records before saving.');
      if (dirty !== undefined && (!object(dirty) || Object.keys(dirty).some(kind=>!kinds.includes(kind)))) throw Error('Invalid changed-record list.');
      const changed=Object.fromEntries(kinds.map(kind=>{
        const ids=dirty === undefined ? Object.keys(collection(library,kind)) : dirty[kind] || [];
        if (!Array.isArray(ids) || ids.some(id=>!identifier(id))) throw Error('Invalid changed player identity.');
        return [kind,[...new Set(ids)]];
      }));
      const revision=idFactory();
      if (!identifier(revision) || revision === currentHeadRevision()) throw Error('Invalid new player storage revision.');
      const refs=manifest ? Object.fromEntries(kinds.map(kind=>[kind,{...manifest.refs[kind]}])) : emptyRefs();
      const index={schemaVersion:2,revision,storeRevision:library.store.revision,refs};
      const staged=[],cacheUpdates=new Map();let serializedBytes=0,changedChunks=0,deletedRecords=0,published=false;
      try {
        for (const kind of kinds) for (const id of changed[kind]) {
          const records=collection(library,kind),cacheKey=`${kind}:${id}`;
          if (!Object.hasOwn(records,id)) {if(Object.hasOwn(refs[kind],id))deletedRecords++;delete refs[kind][id];cacheUpdates.set(cacheKey,null);continue;}
          const value=records[id];validateValue(kind,id,value);
          const text=JSON.stringify({kind,id,value});
          if (recordCache.get(cacheKey) === text) continue;
          const key=recordKey(kind,id,revision);
          if (storage.getItem(key) != null) throw Error('A player storage record identity was reused.');
          storage.setItem(key,text);staged.push(key);changedChunks++;serializedBytes+=bytes(text);
          refs[kind][id]=revision;cacheUpdates.set(cacheKey,text);
        }
        if (!changedChunks && !deletedRecords && manifest?.storeRevision === library.store.revision) {
          unchanged(expectedRevision);
          return {revision:currentHeadRevision(),changedChunks:0,deletedRecords:0,serializedBytes:0,manifestBytes:0,byteUnit:'UTF8'};
        }
        const indexKey=manifestKey(revision),indexText=JSON.stringify(index);
        if (storage.getItem(indexKey) != null) throw Error('A player storage revision was reused.');
        storage.setItem(indexKey,indexText);staged.push(indexKey);serializedBytes+=bytes(indexText);
        unchanged(expectedRevision);
        const newHead=JSON.stringify({schemaVersion:2,current:revision,previous:manifest?.revision || null});
        storage.setItem(headKey,newHead);published=true;serializedBytes+=bytes(newHead);
        // Recheck publication before any cleanup, since other tabs have no
        // shared synchronous lock. Their completed records are never removed.
        if (storage.getItem(headKey) !== newHead) {staged.length=0;throw conflict();}
        const oldPrevious=previousManifest,oldCurrent=manifest;
        headText=newHead;manifest=index;previousManifest=oldCurrent;
        for(const [key,value] of cacheUpdates) {if(value===null)recordCache.delete(key);else recordCache.set(key,value);}
        if (oldPrevious && oldPrevious.revision !== oldCurrent?.revision) {
          const retained=new Set([...referenced(index),...referenced(oldCurrent)]);
          for(const key of referenced(oldPrevious))if(!retained.has(key))removeQuietly(key);
          removeQuietly(manifestKey(oldPrevious.revision));
        }
        return {revision,changedChunks,deletedRecords,serializedBytes,manifestBytes:bytes(indexText),byteUnit:'UTF8'};
      } catch(error) {
        // Before publication these are private staging keys. The old complete
        // revision remains readable on quota, serialization or conflict errors.
        if(!published)for(const key of staged)removeQuietly(key);
        throw error;
      }
    }
    return {open,commit};
  }
  let defaultStorage;
  const browserStorage=()=>defaultStorage ||= createStorage();
  return {createStorage,open:owner=>browserStorage().open(owner),commit:(library,options)=>browserStorage().commit(library,options)};
});
