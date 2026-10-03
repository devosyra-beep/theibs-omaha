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
  // Storage strings use 15-bit LZW codes, above the control-character range and
  // below UTF-16 surrogates. The byte length and checksum detect broken chunks.
  // Plain JSON remains readable; compression never changes the logical record.
  const encodedPrefix = '~THEIBS_LZW1:', clearCode = 256, firstCode = 257, maxCode = 32767;
  const maxEncodedBytes = 64 * 1024 * 1024;
  function checksum(data) {
    let value=2166136261;
    for(const byte of data)value=Math.imul(value^byte,16777619);
    return (value>>>0).toString(16);
  }
  function decodeText(text) {
    if(!text.startsWith(encodedPrefix))return text;
    const separator=text.indexOf(':',encodedPrefix.length),end=text.indexOf(':',separator+1);
    const length=Number(text.slice(encodedPrefix.length,separator)),hash=text.slice(separator+1,end);
    if(separator<0 || end<0 || !Number.isSafeInteger(length) || length<1 || length>maxEncodedBytes || !/^[a-f0-9]{1,8}$/.test(hash))throw Error('Invalid compressed player record.');
    const output=new Uint8Array(length),prefixes=new Uint16Array(maxCode+1),suffixes=new Uint8Array(maxCode+1),stack=new Uint8Array(maxCode+1);
    let next=firstCode,previous=-1,cursor=0;
    const invalid=()=>{throw Error('Invalid compressed player record.');};
    if(text.charCodeAt(end+1)-32!==clearCode)invalid();
    for(let i=end+1;i<text.length;i++) {
      const code=text.charCodeAt(i)-32;
      if(code===clearCode){next=firstCode;previous=-1;continue;}
      if(code<0 || code>maxCode || code>next || code===next && previous<0)invalid();
      const special=code===next;let current=special?previous:code,count=0;
      while(current>=firstCode) {
        if(current>=next || count>=stack.length)invalid();
        stack[count++]=suffixes[current];current=prefixes[current];
      }
      if(current>255 || current<0)invalid();
      stack[count++]=current;const first=current;
      if(count+(special?1:0)>output.length-cursor)invalid();
      while(count)output[cursor++]=stack[--count];
      if(special)output[cursor++]=first;
      if(previous>=0 && next<=maxCode){prefixes[next]=previous;suffixes[next]=first;next++;}
      previous=code;
    }
    if(cursor!==length || checksum(output)!==hash)invalid();
    return new TextDecoder('utf-8',{fatal:true}).decode(output);
  }
  function encodeText(text) {
    if(text.length<512)return text;
    const data=new TextEncoder().encode(text);
    if(!data.length || data.length>maxEncodedBytes)return text;
    const dictionary=new Map(),codes=[String.fromCharCode(clearCode+32)];let next=firstCode,prefix=data[0];
    for(let i=1;i<data.length;i++) {
      const byte=data[i],key=prefix*256+byte,known=dictionary.get(key);
      if(known!==undefined){prefix=known;continue;}
      codes.push(String.fromCharCode(prefix+32));
      if(next<=maxCode)dictionary.set(key,next++);
      else {codes.push(String.fromCharCode(clearCode+32));dictionary.clear();next=firstCode;}
      prefix=byte;
    }
    codes.push(String.fromCharCode(prefix+32));
    const encoded=encodedPrefix+data.length+':'+checksum(data)+':'+codes.join('');
    // A verified round trip precedes every change of an existing saved body.
    if(encoded.length>=text.length)return text;
    if(decodeText(encoded)!==text)throw Error('The player storage encoding could not be verified.');
    return encoded;
  }
  function conflict() { const error = Error('Player data changed in another tab. Review the latest data before saving.'); error.code='STORAGE_CONFLICT';error.statusCode=409;return error; }
  function quotaError(cause) {
    return cause?.name === 'QuotaExceededError' || cause?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      cause?.code === 22 || cause?.code === 1014 || /quota/i.test(String(cause?.message || ''));
  }
  function storageFailure(cause) {
    if (!quotaError(cause)) return cause;
    // Native browser errors include the complete account/chunk key. Keep that
    // diagnostic as the cause instead of rendering it into the table controls.
    const error = Error('Quota exceeded in local player storage. Existing saved data is preserved.', {cause});
    error.code = 'STORAGE_QUOTA';
    if (typeof document !== 'undefined') globalThis.console?.warn?.('Local player storage quota exceeded.', cause);
    return error;
  }
  function validateOrigins(value) {
    if (value === undefined) return;
    if (!object(value) || value.schemaVersion !== 1 || Object.keys(value).some(key=>!['schemaVersion','handIds'].includes(key)) ||
        !Array.isArray(value.handIds) || value.handIds.some(id=>!identifier(id)) || new Set(value.handIds).size !== value.handIds.length)
      throw Error('Invalid backup origin metadata.');
  }
  function validateLibrary(library) {
    if (!object(library) || library.schemaVersion !== 1 || !object(library.store) || library.store.schemaVersion !== 1 ||
        !Number.isSafeInteger(library.store.revision) || library.store.revision < 0 ||
        !object(library.store.players) || !object(library.store.hands) || !object(library.archive) ||
        library.decisions !== undefined && !object(library.decisions)) throw Error('Invalid local player library.');
    validateOrigins(library.backupOrigins);
  }
  function collection(library,kind) { return (kind === 'players' || kind === 'hands' ? library.store[kind] : library[kind]) || {}; }
  function validateValue(kind,id,value) {
    if (!identifier(id) || (kind === 'decisions' ? !Array.isArray(value) : !object(value)) ||
        kind === 'players' && value.playerId !== id || kind === 'hands' && value.handId !== id ||
        kind === 'archive' && value.multiway?.handId !== id) throw Error('Invalid stored player record.');
  }
  function createStorage({storage=globalThis.localStorage,indexedDB=globalThis.indexedDB,idFactory=()=>globalThis.crypto.randomUUID()}={}) {
    if (!storage || !['getItem','setItem','removeItem'].every(method=>typeof storage[method] === 'function')) throw Error('Device storage is unavailable.');
    let owner=null,prefix=null,headKey=null,legacyKey=null,headText=null,manifest=null,previousManifest=null;
    let recordCache=new Map(),legacyExpected;
    const manifestKey = revision => `${prefix}:manifest:${revision}`;
    const recordKey = (kind,id,revision) => `${prefix}:record:${kind}:${id}:${revision}`;
    function parseManifest(text,revision) {
      if (!identifier(revision)) throw Error('Invalid player storage revision.');
      const value=JSON.parse(decodeText(text || 'null'));
      if (!object(value) || value.schemaVersion !== 2 || value.revision !== revision ||
          !Number.isSafeInteger(value.storeRevision) || value.storeRevision < 0 || !object(value.refs)) throw Error('Invalid player storage manifest.');
      for (const kind of kinds) {
        if (!object(value.refs[kind])) throw Error('Invalid player storage index.');
        for (const [id,version] of Object.entries(value.refs[kind])) if (!identifier(id) || !identifier(version)) throw Error('Invalid player storage reference.');
      }
      validateOrigins(value.backupOrigins);
      return value;
    }
    function readManifest(revision) {return parseManifest(storage.getItem(manifestKey(revision)),revision);}
    function loadRecords(index) {
      const library={schemaVersion:1,store:{schemaVersion:1,revision:index.storeRevision,players:{},hands:{}},archive:{},decisions:{}};
      if(index.backupOrigins)library.backupOrigins=structuredClone(index.backupOrigins);
      const cache=new Map();
      for (const kind of kinds) for (const [id,version] of Object.entries(index.refs[kind])) {
        const saved=storage.getItem(recordKey(kind,id,version));
        if (saved == null) throw Error('A player storage record is missing.');
        const text=decodeText(saved);
        const record=JSON.parse(text);
        if (!object(record) || record.kind !== kind || record.id !== id) throw Error('Invalid player storage record.');
        validateValue(kind,id,record.value);
        collection(library,kind)[id]=record.value;cache.set(`${kind}:${id}`,text);
      }
      if(typeof profileModel?.validateStore !== 'function')throw Error('The player model is unavailable.');
      profileModel.validateStore(library.store);
      return {library,cache};
    }
    function open(ownerKey,{readOnly=false}={}) {
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
      if(readOnly)return {library,revision:null,migrated:false,recovered:false};
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
    function compactReferenced(expectedRevision) {
      unchanged(expectedRevision);
      const pending=new Map();
      for(const index of [manifest,previousManifest].filter(Boolean)) {
        for(const kind of kinds)for(const [id,version] of Object.entries(index.refs[kind]))pending.set(recordKey(kind,id,version),{kind,id});
        pending.set(manifestKey(index.revision),{index});
      }
      let saved=0;
      for(const [key,descriptor] of pending) {
        unchanged(expectedRevision);
        const original=storage.getItem(key);
        if(original==null)continue;
        try {
          const text=decodeText(original),value=JSON.parse(text);
          if(descriptor.index){if(JSON.stringify(value)!==JSON.stringify(descriptor.index))continue;}
          else {if(value?.kind!==descriptor.kind || value?.id!==descriptor.id)continue;validateValue(descriptor.kind,descriptor.id,value.value);}
          const encoded=encodeText(text);
          if(encoded.length>=original.length)continue;
          unchanged(expectedRevision);
          if(storage.getItem(key)!==original)throw conflict();
          // setItem replaces this one value atomically, including on quota.
          storage.setItem(key,encoded);saved+=original.length-encoded.length;
        } catch(error) {if(error.code==='STORAGE_CONFLICT')throw error;/* An unreadable recovery body is preserved verbatim. */}
      }
      return saved;
    }
    function commit(library,options={}) {
      try {return writeCommit(library,options);}
      catch(error) {
        if(quotaError(error) && compactReferenced(options.expectedRevision)>0) {
          try {return {...writeCommit(library,options),compacted:true};}catch(retry){throw storageFailure(retry);}
        }
        throw storageFailure(error);
      }
    }
    function writeCommit(library,{expectedRevision,dirty}={}) {
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
      if(library.backupOrigins)index.backupOrigins=structuredClone(library.backupOrigins);
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
          const encoded=encodeText(text);
          storage.setItem(key,encoded);staged.push(key);changedChunks++;serializedBytes+=bytes(encoded);
          refs[kind][id]=revision;cacheUpdates.set(cacheKey,text);
        }
        if (!changedChunks && !deletedRecords && manifest?.storeRevision === library.store.revision &&
            JSON.stringify(manifest?.backupOrigins) === JSON.stringify(index.backupOrigins)) {
          unchanged(expectedRevision);
          return {revision:currentHeadRevision(),changedChunks:0,deletedRecords:0,serializedBytes:0,manifestBytes:0,byteUnit:'UTF8'};
        }
        const indexKey=manifestKey(revision),indexText=JSON.stringify(index);
        if (storage.getItem(indexKey) != null) throw Error('A player storage revision was reused.');
        const encodedIndex=encodeText(indexText);
        storage.setItem(indexKey,encodedIndex);staged.push(indexKey);serializedBytes+=bytes(encodedIndex);
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
    // IndexedDB has its own transactional pointer and dirty chunks. The old
    // localStorage document is only read during migration and is never deleted.
    const dbName='theibs-player-library-v1',dbStores=['heads','manifests','records'];
    let databasePromise=null,asyncGeneration=0,backend=null,activeOwner=null,activeHead=null,activeManifest=null,activePrevious=null,activeCache=new Map();
    const requestResult=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error || Error('Player storage request failed.'));});
    function database() {
      if(!indexedDB || typeof indexedDB.open!=='function')return Promise.reject(Error('IndexedDB is unavailable.'));
      if(!databasePromise)databasePromise=new Promise((resolve,reject)=>{
        const request=indexedDB.open(dbName,1);
        request.onupgradeneeded=()=>{for(const name of dbStores)if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
        request.onerror=()=>reject(request.error || Error('IndexedDB could not be opened.'));
        request.onblocked=()=>reject(Error('Close older app tabs, then reload to open player storage.'));
        request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();databasePromise=null;};resolve(db);};
      });
      return databasePromise;
    }
    function transaction(db,mode,operation) {
      return new Promise((resolve,reject)=>{
        let tx,result,failure;
        try {tx=mode==='readwrite'?db.transaction(dbStores,mode,{durability:'strict'}):db.transaction(dbStores,mode);}
        catch(error){if(error instanceof TypeError)tx=db.transaction(dbStores,mode);else {reject(error);return;}}
        tx.oncomplete=()=>resolve(result);
        tx.onabort=()=>reject(failure || tx.error || Error('Player data was not saved. The storage transaction was interrupted.'));
        try {Promise.resolve(operation(tx)).then(value=>{result=value;},error=>{failure=error;try{tx.abort();}catch{reject(error);}});}
        catch(error){failure=error;try{tx.abort();}catch{reject(error);}}
      });
    }
    const idbRecordKey=(key,kind,id,revision)=>[key,kind,id,revision];
    function legacySource(key) {
      const base=`theibs.multiway.players.v2:${key}`,head=storage.getItem(base+':head');
      const old=head==null?storage.getItem(`theibs.multiway.players.v1:${key}`):null;
      return {head,legacy:old==null?null:`${old.length}:${checksum(new TextEncoder().encode(old))}`};
    }
    function requireLegacySource(key,source) {
      if(source && JSON.stringify(legacySource(key))!==JSON.stringify(source)) {
        const error=conflict();error.message='Player data changed in an older app tab. Both saved copies were preserved. Close older tabs and review the library.';throw error;
      }
    }
    function validHead(value) {
      if(!object(value) || value.schemaVersion!==1 || !identifier(value.current) || value.previous!=null&&!identifier(value.previous))throw Error('Invalid durable player storage pointer. Saved copies were preserved.');
      return value;
    }
    async function idbLoad(tx,key,revision) {
      const index=parseManifest(await requestResult(tx.objectStore('manifests').get([key,revision])),revision);
      const library={schemaVersion:1,store:{schemaVersion:1,revision:index.storeRevision,players:{},hands:{}},archive:{},decisions:{}},cache=new Map();
      if(index.backupOrigins)library.backupOrigins=structuredClone(index.backupOrigins);
      await Promise.all(kinds.flatMap(kind=>Object.entries(index.refs[kind]).map(async([id,version])=>{
        const saved=await requestResult(tx.objectStore('records').get(idbRecordKey(key,kind,id,version)));
        if(typeof saved!=='string')throw Error('A durable player storage record is missing.');
        const text=decodeText(saved),record=JSON.parse(text);
        if(record?.kind!==kind || record?.id!==id)throw Error('Invalid durable player storage record.');
        validateValue(kind,id,record.value);collection(library,kind)[id]=record.value;cache.set(`${kind}:${id}`,text);
      })));
      profileModel.validateStore(library.store);return {library,index,cache};
    }
    async function idbRead(db,key) {
      return transaction(db,'readonly',async tx=>{
        const raw=await requestResult(tx.objectStore('heads').get(key));
        if(raw==null)return null;
        const head=validHead(raw);let selected,recovered=false;
        try {selected=await idbLoad(tx,key,head.current);}
        catch(error){if(!head.previous)throw error;selected=await idbLoad(tx,key,head.previous);recovered=true;}
        let previous=null;
        if(!recovered && head.previous){try{previous=parseManifest(await requestResult(tx.objectStore('manifests').get([key,head.previous])),head.previous);}catch{}}
        return {head,...selected,previous,recovered};
      });
    }
    function newRevision() {const revision=idFactory();if(!identifier(revision))throw Error('Invalid new player storage revision.');return revision;}
    function fullSnapshot(library) {
      validateLibrary(library);profileModel.validateStore(library.store);
      const revision=newRevision(),index={schemaVersion:2,revision,storeRevision:library.store.revision,refs:emptyRefs()},chunks=[];
      if(library.backupOrigins)index.backupOrigins=structuredClone(library.backupOrigins);
      for(const kind of kinds)for(const [id,value] of Object.entries(collection(library,kind))) {
        validateValue(kind,id,value);index.refs[kind][id]=revision;
        chunks.push({kind,id,revision,text:encodeText(JSON.stringify({kind,id,value}))});
      }
      return {index,text:encodeText(JSON.stringify(index)),chunks};
    }
    async function migrate(db,key) {
      const source=legacySource(key),legacy=open(key,{readOnly:true});
      if(!legacy.library)return null;
      const current=fullSnapshot(legacy.library);let prior=null;
      if(previousManifest){try{prior=fullSnapshot(loadRecords(previousManifest).library);}catch{/* Preserve the unreadable raw recovery copy. */}}
      if(prior?.index.revision===current.index.revision)throw Error('A player storage revision was reused.');
      await transaction(db,'readwrite',async tx=>{
        const existing=await requestResult(tx.objectStore('heads').get(key));if(existing)return;
        requireLegacySource(key,source);
        for(const snapshot of [current,prior].filter(Boolean)) {
          for(const chunk of snapshot.chunks)tx.objectStore('records').add(chunk.text,idbRecordKey(key,chunk.kind,chunk.id,chunk.revision));
          tx.objectStore('manifests').add(snapshot.text,[key,snapshot.index.revision]);
        }
        tx.objectStore('heads').put({schemaVersion:1,current:current.index.revision,previous:prior?.index.revision || null,legacySource:source},key);
      });
      return idbRead(db,key);
    }
    async function openAsync(key) {
      if(typeof key!=='string' || !/^[a-f0-9]{64}$/i.test(key))throw Error('A verified account key is required for local player storage.');
      const generation=++asyncGeneration;let db;
      try {db=await database();}
      catch(cause) {
        // If the API exists but opening fails, a durable library may already
        // contain newer hands. Never silently reopen its stale legacy copy.
        if(indexedDB && typeof indexedDB.open==='function')throw Object.assign(Error('Durable player storage could not be opened. Existing saved copies were preserved. Enable device storage and reload.',{cause}),{code:'STORAGE_UNAVAILABLE'});
        // Browsers without the API retain the explicit compatibility backend.
        if(generation!==asyncGeneration)throw Object.assign(Error('The player account changed before storage opened.'),{code:'STORAGE_CONTEXT'});
        const opened=open(key),result={...opened,backend:'localStorage',fallbackReason:'Durable player storage is unavailable; this browser is using limited local storage.'};
        if(generation===asyncGeneration){backend='localStorage';activeOwner=key;activeHead=null;activeManifest=null;activePrevious=null;activeCache=new Map();}
        return result;
      }
      let loaded=await idbRead(db,key),migrated=false;
      if(!loaded){loaded=await migrate(db,key);migrated=Boolean(loaded);}
      if(loaded)requireLegacySource(key,loaded.head.legacySource);
      const result={library:loaded?.library || null,revision:loaded?.head.current || null,migrated,recovered:loaded?.recovered || false,backend:'indexeddb'};
      if(generation===asyncGeneration){backend='indexeddb';activeOwner=key;activeHead=loaded?.head || null;activeManifest=loaded?.index || null;activePrevious=loaded?.previous || null;activeCache=loaded?.cache || new Map();}
      return result;
    }
    async function commitAsync(library,{expectedRevision,dirty}={}) {
      if(!activeOwner || !backend)throw Error('Open the account player library before saving.');
      if(backend==='localStorage') {
        if(owner!==activeOwner)throw Object.assign(Error('The player account changed before saving.'),{code:'STORAGE_CONTEXT'});
        return {...commit(library,{expectedRevision,dirty}),backend:'localStorage'};
      }
      const key=activeOwner,head=activeHead,index=activeManifest,prior=activePrevious,cache=activeCache;
      validateLibrary(library);profileModel.validateStore(library.store);
      if(expectedRevision!==(head?.current || null))throw conflict();
      if(dirty===undefined && index)throw Error('Identify the changed player records before saving.');
      if(dirty!==undefined && (!object(dirty)||Object.keys(dirty).some(kind=>!kinds.includes(kind))))throw Error('Invalid changed-record list.');
      const revision=newRevision(),refs=index?Object.fromEntries(kinds.map(kind=>[kind,{...index.refs[kind]}])):emptyRefs(),chunks=[],updates=new Map();let deletedRecords=0;
      if(revision===head?.current)throw Error('A player storage revision was reused.');
      for(const kind of kinds) {
        const ids=dirty===undefined?Object.keys(collection(library,kind)):dirty[kind] || [];
        if(!Array.isArray(ids)||ids.some(id=>!identifier(id)))throw Error('Invalid changed player identity.');
        for(const id of new Set(ids)) {
          const records=collection(library,kind),cacheKey=`${kind}:${id}`;
          if(!Object.hasOwn(records,id)){if(Object.hasOwn(refs[kind],id))deletedRecords++;delete refs[kind][id];updates.set(cacheKey,null);continue;}
          validateValue(kind,id,records[id]);const text=JSON.stringify({kind,id,value:records[id]});if(cache.get(cacheKey)===text)continue;
          chunks.push({kind,id,text:encodeText(text)});updates.set(cacheKey,text);refs[kind][id]=revision;
        }
      }
      const next={schemaVersion:2,revision,storeRevision:library.store.revision,refs};if(library.backupOrigins)next.backupOrigins=structuredClone(library.backupOrigins);
      const changed=chunks.length || deletedRecords || index?.storeRevision!==library.store.revision || JSON.stringify(index?.backupOrigins)!==JSON.stringify(next.backupOrigins);
      const encodedIndex=encodeText(JSON.stringify(next)),source=head?.legacySource || legacySource(key),db=await database();
      const newHead={schemaVersion:1,current:revision,previous:index?.revision || null,legacySource:source};
      try {
        await transaction(db,'readwrite',async tx=>{
          const live=await requestResult(tx.objectStore('heads').get(key));
          if((live?.current || null)!==expectedRevision)throw conflict();requireLegacySource(key,source);
          if(!changed)return;
          for(const chunk of chunks)tx.objectStore('records').add(chunk.text,idbRecordKey(key,chunk.kind,chunk.id,revision));
          tx.objectStore('manifests').add(encodedIndex,[key,revision]);tx.objectStore('heads').put(newHead,key);
          if(prior && prior.revision!==index?.revision) {
            for(const kind of kinds)for(const [id,version] of Object.entries(prior.refs[kind]))if(refs[kind][id]!==version && index?.refs[kind]?.[id]!==version)tx.objectStore('records').delete(idbRecordKey(key,kind,id,version));
            tx.objectStore('manifests').delete([key,prior.revision]);
          }
        });
      } catch(error) {
        if(quotaError(error)){const failure=Error('Durable player storage is full. Existing saved data is preserved.',{cause:error});failure.code='STORAGE_QUOTA';throw failure;}
        throw error;
      }
      if(changed && activeOwner===key && activeHead===head){activeHead=newHead;activePrevious=index;activeManifest=next;activeCache=new Map(cache);for(const [id,value] of updates)if(value==null)activeCache.delete(id);else activeCache.set(id,value);}
      return {revision:changed?revision:expectedRevision,changedChunks:chunks.length,deletedRecords,serializedBytes:changed?chunks.reduce((sum,chunk)=>sum+bytes(chunk.text),bytes(encodedIndex)):0,manifestBytes:changed?bytes(encodedIndex):0,byteUnit:'UTF8',backend:'indexeddb'};
    }
    return {open,commit,openAsync,commitAsync};
  }
  let defaultStorage;
  const browserStorage=()=>defaultStorage ||= createStorage();
  return {createStorage,open:owner=>browserStorage().open(owner),commit:(library,options)=>browserStorage().commit(library,options),
    openAsync:owner=>browserStorage().openAsync(owner),commitAsync:(library,options)=>browserStorage().commitAsync(library,options)};
});
