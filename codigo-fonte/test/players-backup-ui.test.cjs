'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/players-backup-ui'),'utf8');
const owner='a'.repeat(64),otherOwner='b'.repeat(64),kinds=['players','hands','archive','decisions'];
const clone=structuredClone,counts=number=>Object.fromEntries(kinds.map(kind=>[kind,kind==='players'?number:0]));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const library=()=>({schemaVersion:1,store:{schemaVersion:1,revision:0,players:{},hands:{}},archive:{},decisions:{}});
const incoming=()=>{const value=library();value.store.players.p1={playerId:'p1',nickname:'Private name',notes:[],contexts:{},observations:0};return value;};
const summary=value=>({totals:counts(Object.keys(value.store.players).length),decisionSnapshots:0,notes:0});
function helper(){return {MAX_BYTES:10485760,
  async create({ownerKey,library}){return {text:JSON.stringify({ownerKey,library}),summary:summary(library)};},
  async parse(text,{ownerKey}){const parsed=JSON.parse(text);if(parsed.ownerKey!==ownerKey)throw Object.assign(Error('This backup belongs to another account. Saved data was left untouched.'),{code:'BACKUP_OWNER_MISMATCH'});return {document:{library:parsed.library},summary:summary(parsed.library)};},
  planImport({current,incoming}){
    incoming=incoming.library || incoming.document?.library || incoming;
    let added=0,identical=0;const next=clone(current);
    for(const [id,value]of Object.entries(incoming.store.players)){
      const existing=current.store.players[id];
      if(existing && JSON.stringify(existing)!==JSON.stringify(value))throw Object.assign(Error('Conflicting player.'),{code:'BACKUP_CONFLICT',conflicts:[{kind:'players',id}]});
      if(existing)identical++;else {next.store.players[id]=clone(value);added++;}
    }
    return {library:next,dirty:{players:Object.keys(incoming.store.players),hands:[],archive:[],decisions:[]},summary:{added:counts(added),identical:counts(identical),recordsChanged:added,mode:added?'DISJOINT_ADDITIVE':'IDENTICAL_ONLY'}};
  }};}
class Node {
  constructor(tag='node'){this.tagName=tag;this.listeners={};this.attributes={};this.nodes=new Map();this.disabled=false;this.hidden=false;this.open=false;this.innerHTML='';this.textContent='';this.value='';this.files=[];this.isConnected=true;this.focuses=0;
    this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}
  querySelector(selector){if(!this.nodes.has(selector))this.nodes.set(selector,new Node());return this.nodes.get(selector);}
  addEventListener(name,handler){this.listeners[name]=handler;}
  setAttribute(name,value){this.attributes[name]=value;}
  replaceChildren(){this.innerHTML='';} focus(){this.focuses++;} showModal(){this.open=true;} close(){this.open=false;this.listeners.close?.();}
  click(){if(!this.disabled)return this.listeners.click?.();} remove(){this.isConnected=false;}
}
function harness({initial=library(),backup=helper()}={}){
  let current={ownerKey:owner,library:initial,revision:'r1',session:'session-1'};const dialog=new Node('dialog'),opener=new Node('button'),anchors=[],downloads=[],imports=[],urls=[];
  const document={activeElement:opener,createElement:tag=>{if(tag==='dialog')return dialog;const node=new Node(tag);node.click=()=>downloads.push({download:node.download,href:node.href});anchors.push(node);return node;},body:{append(){}}};
  const contextVM={document,TheibsPlayersBackup:backup,structuredClone,TextEncoder,Blob,
    URL:{createObjectURL:blob=>{urls.push(blob);return 'blob:backup';},revokeObjectURL:url=>urls.push(url)},setTimeout:callback=>callback()};
  vm.runInNewContext(source,contextVM);const api=contextVM.TheibsPlayersBackupUI;
  api.init({getContext:()=>current,onImport:async value=>{imports.push(value);current={...current,library:clone(value.plan.library),revision:'r2'};}});api.open();
  const file=value=>({size:new TextEncoder().encode(value).byteLength,text:async()=>value});
  const select=value=>{dialog.querySelector('[data-backup-file]').files=value?[value]:[];return dialog.querySelector('[data-backup-file]').listeners.change();};
  const click=selector=>dialog.querySelector(selector).click();
  return {api,dialog,opener,anchors,downloads,imports,urls,backup,select,click,file,
    get context(){return current;},set context(value){current=value;},get status(){return dialog.querySelector('[data-backup-status]').textContent;}};
}
const fileText=(value=incoming(),key=owner)=>JSON.stringify({ownerKey:key,library:value});

test('standalone modal uses explicit context callbacks, accessible English controls and a review-only file picker',async()=>{
  const h=harness();assert.equal(h.dialog.attributes['aria-labelledby'],'players-backup-title');assert.equal(h.api.getState().open,true);
  assert.match(h.dialog.innerHTML,/Player library backup/);assert.match(h.dialog.innerHTML,/Integrity checks file consistency, not the origin or mathematical validity/);
  assert.match(h.dialog.innerHTML,/current table session, settings and range templates are excluded/);
  assert.equal(h.dialog.querySelector('[data-backup-restore]').disabled,true);
  await h.select(h.file(fileText()));assert.equal(h.imports.length,0);assert.equal(h.api.getState().phase,'REVIEW');assert.equal(h.api.getState().canRestore,true);
  assert.match(h.dialog.querySelector('[data-backup-preview]').innerHTML,/Already present/);assert.match(h.status,/choose Restore/);
  assert.doesNotMatch(source,/fetch\s*\(|XMLHttpRequest|localStorage|theibsApp|theibsCardVoice/);
});

test('Restore submits only the preflight plan and captured owner/revision through the registered handler',async()=>{
  const h=harness();await h.select(h.file(fileText()));await h.click('[data-backup-restore]');
  assert.equal(h.imports.length,1);assert.equal(h.imports[0].capturedOwner,owner);assert.equal(h.imports[0].capturedRevision,'r1');
  assert.equal(h.imports[0].capturedSession,'session-1');
  assert.deepEqual(Object.keys(h.imports[0]).sort(),['capturedOwner','capturedRevision','capturedSession','incoming','plan']);
  assert.deepEqual(h.imports[0].incoming.library,incoming());
  assert.equal(h.context.library.store.players.p1.nickname,'Private name');assert.equal(h.api.getState().phase,'COMPLETE');assert.equal(h.api.getState().canRestore,false);
});

test('a duplicate backup needs no restore and conflicts block all imported changes',async()=>{
  const duplicate=harness({initial:incoming()});await duplicate.select(duplicate.file(fileText()));
  assert.equal(duplicate.api.getState().summary.identical.players,1);assert.equal(duplicate.api.getState().canRestore,false);
  await duplicate.click('[data-backup-restore]');assert.equal(duplicate.imports.length,0);assert.match(duplicate.status,/Nothing to restore/);
  const conflict=harness({initial:incoming()}),changed=incoming();changed.store.players.p1.nickname='Changed';changed.store.players.p2={...changed.store.players.p1,playerId:'p2'};
  await conflict.select(conflict.file(fileText(changed)));assert.equal(conflict.api.getState().canRestore,false);assert.equal(conflict.imports.length,0);
  assert.match(conflict.dialog.querySelector('[data-backup-preview]').innerHTML,/Restore blocked/);assert.match(conflict.status,/not overwritten/);
  assert.equal(conflict.context.library.store.players.p1.nickname,'Private name');assert.equal(conflict.context.library.store.players.p2,undefined);
});

test('size limit is checked before reading, and oversized decoded text cannot bypass it',async()=>{
  const h=harness();let reads=0;
  await h.select({size:h.backup.MAX_BYTES+1,text:async()=>{reads++;return fileText();}});assert.equal(reads,0);assert.equal(h.api.getState().canRestore,false);
  assert.match(h.status,/10 MiB/);
  const smallCap=harness();smallCap.backup.MAX_BYTES=20;await smallCap.select({size:10,text:async()=>'é'.repeat(11)});
  assert.equal(smallCap.api.getState().phase,'ERROR');assert.match(smallCap.status,/size limit/);assert.equal(smallCap.imports.length,0);
});

test('owner, revision and session changes during file reads reject pending results',async()=>{
  for(const mutation of [{ownerKey:otherOwner},{revision:'r-new'},{session:'session-2'}]){
    const h=harness(),read=deferred(),pending=h.select({size:100,text:()=>read.promise});
    assert.equal(h.api.getState().phase,'READING');assert.equal(h.dialog.attributes['aria-busy'],'true');
    h.context={...h.context,...mutation};read.resolve(fileText());await pending;
    assert.equal(h.api.getState().canRestore,false);assert.equal(h.imports.length,0);assert.match(h.status,/changed/);
  }
});

test('a revision change during asynchronous integrity checks is revalidated before preflight',async()=>{
  const backup=helper(),checked=deferred();let plans=0;const parse=backup.parse,plan=backup.planImport;
  backup.parse=async(...args)=>{const result=await parse(...args);await checked.promise;return result;};backup.planImport=(...args)=>{plans++;return plan(...args);};
  const h=harness({backup}),pending=h.select(h.file(fileText()));await Promise.resolve();await Promise.resolve();
  h.context={...h.context,revision:'r-new'};checked.resolve();await pending;
  assert.equal(plans,0);assert.equal(h.api.getState().canRestore,false);assert.equal(h.imports.length,0);
});

test('Restore rechecks owner/revision/session even after a valid preview',async()=>{
  for(const mutation of [{ownerKey:otherOwner},{revision:'r-new'},{session:'session-2'}]){
    const h=harness();await h.select(h.file(fileText()));h.context={...h.context,...mutation};
    await h.click('[data-backup-restore]');assert.equal(h.imports.length,0);assert.equal(h.api.getState().canRestore,false);assert.match(h.status,/changed/);
  }
});

test('Cancel and Escape discard in-flight files, reviewed plans and private context without importing',async()=>{
  const h=harness(),read=deferred(),pending=h.select({size:100,text:()=>read.promise});
  h.click('[data-backup-cancel]');assert.equal(h.api.getState().open,false);assert.equal(h.opener.focuses,1);
  read.resolve(fileText());await pending;assert.equal(h.api.getState().phase,'IDLE');assert.equal(h.api.getState().summary,null);assert.equal(h.imports.length,0);
  h.api.open();await h.select(h.file(fileText()));let prevented=false;h.dialog.listeners.cancel({preventDefault:()=>{prevented=true;}});
  assert.equal(prevented,true);assert.equal(h.api.getState().canRestore,false);assert.equal(h.dialog.querySelector('[data-backup-file]').value,'');
  assert.equal(h.api.getState().summary,null);assert.equal(h.imports.length,0);
});

test('a later file selection wins over an older pending read and empty selection clears restore eligibility',async()=>{
  const h=harness(),read=deferred(),pending=h.select({size:100,text:()=>read.promise});
  await h.select(h.file(fileText()));const reviewed=h.api.getState().summary;read.resolve('{corrupt old file');await pending;
  assert.equal(h.api.getState().phase,'REVIEW');assert.deepEqual(h.api.getState().summary,reviewed);assert.equal(h.api.getState().canRestore,true);
  await h.select(null);assert.equal(h.api.getState().canRestore,false);assert.equal(h.api.getState().summary,null);
});

test('downloads use a generic safe filename, local Blob URL and immediate resource cleanup',async()=>{
  const h=harness();await h.click('[data-backup-download]');assert.equal(h.downloads.length,1);
  assert.match(h.downloads[0].download,/^theibs-player-library-\d{4}-\d{2}-\d{2}\.json$/);assert.doesNotMatch(h.downloads[0].download,/Private|aaaa/);
  assert.equal(h.urls[0] instanceof Blob,true);assert.equal(h.urls[1],'blob:backup');assert.equal(h.anchors[0].isConnected,false);assert.equal(h.imports.length,0);
});

test('cancel or changed owner during backup creation cannot download the old account file',async()=>{
  for(const cancel of [false,true]){
    const backup=helper(),prepared=deferred();backup.create=()=>prepared.promise;const h=harness({backup});
    const pending=h.click('[data-backup-download]');if(cancel)h.api.close();else h.context={...h.context,ownerKey:otherOwner};
    prepared.resolve({text:fileText()});await pending;assert.equal(h.downloads.length,0);assert.equal(h.urls.length,0);
  }
});

test('corrupt/wrong-owner files and persistence errors never automatically retry or invoke another writer',async()=>{
  const h=harness();await h.select(h.file('invalid JSON'));assert.equal(h.imports.length,0);assert.match(h.status,/Saved data was left untouched/);
  await h.select(h.file(fileText(incoming(),otherOwner)));assert.equal(h.imports.length,0);assert.match(h.status,/another account/);
  let calls=0;h.api.init({getContext:()=>h.context,onImport:()=>{calls++;throw Object.assign(Error('Storage changed; no write occurred.'),{code:'STORAGE_CONFLICT'});}});h.api.open();
  await h.select(h.file(fileText()));await h.click('[data-backup-restore]');assert.equal(calls,1);assert.equal(h.api.getState().canRestore,false);
  await h.click('[data-backup-restore]');assert.equal(calls,1);
});

test('metadata-only origin receipt has explicit review and preserves a detached raw session object',async()=>{
  const backup=helper(),plan=backup.planImport;backup.planImport=options=>{const value=plan(options);value.summary.provenanceChanged=true;return value;};
  const h=harness({initial:incoming(),backup});h.api.close();const session={epoch:2,required:true,expired:false};
  h.context={...h.context,session};h.api.open();await h.select(h.file(fileText()));
  assert.equal(h.api.getState().canRestore,true);assert.match(h.status,/only the backup-origin receipt/);
  await h.click('[data-backup-restore]');assert.equal(h.imports.length,1);assert.deepEqual(h.imports[0].capturedSession,session);
  assert.notEqual(h.imports[0].capturedSession,session);assert.match(h.status,/Backup-origin receipt added/);
});

test('reopening after Cancel rejects the previous read and ignores a delayed native close event',async()=>{
  const h=harness(),read=deferred(),pending=h.select({size:100,text:()=>read.promise});
  h.api.close();h.api.open();await h.select(h.file(fileText()));h.dialog.listeners.close();
  read.resolve('{old corrupt backup');await pending;
  assert.equal(h.api.getState().open,true);assert.equal(h.api.getState().phase,'REVIEW');assert.equal(h.api.getState().canRestore,true);
  await h.click('[data-backup-restore]');assert.equal(h.imports.length,1);
});

test('real helper file review and original-document restore keep unrelated local hands out of backup provenance',async()=>{
  const backup=require('../public/players-backup'),profiles=require('../public/player-profile-model');
  const make=prefix=>{
    const value=library(),players=[{playerId:prefix+'-one',name:'One'},{playerId:prefix+'-two',name:'Two'}];
    profiles.beginHand(value.store,{handId:prefix+'-hand',config:{playerCount:2,players},events:[]});return value;
  };
  const original=make('local'),restored=make('restored'),created=await backup.create({ownerKey:owner,library:restored});
  const h=harness({initial:original,backup});let received;
  h.api.init({getContext:()=>h.context,onImport:args=>{
    received=args;const checked=backup.planImport({current:h.context.library,incoming:args.incoming});
    h.context={...h.context,library:checked.library,revision:'real-restored'};
  }});h.api.open();
  await h.select(new File([created.text],'backup.json',{type:'application/json'}));
  assert.equal(h.api.getState().canRestore,true);assert.equal(h.imports.length,0);await h.click('[data-backup-restore]');
  assert.deepEqual(Object.keys(received.incoming.library.store.hands),['restored-hand']);
  assert.deepEqual(Object.keys(received.plan.library.store.hands).sort(),['local-hand','restored-hand']);
  assert.deepEqual(h.context.library.backupOrigins.handIds,['restored-hand']);
  assert.deepEqual(h.context.library.store.hands['local-hand'],original.store.hands['local-hand']);
  await h.select(new File([created.text],'backup.json',{type:'application/json'}));
  assert.equal(h.api.getState().canRestore,false);assert.match(h.status,/Nothing to restore/);
  const before=clone(h.context.library),corrupt=JSON.parse(created.text);corrupt.library.store.players['restored-one'].nickname='Altered';
  await h.select(new File([JSON.stringify(corrupt)],'broken.json'));assert.equal(h.api.getState().canRestore,false);
  assert.deepEqual(h.context.library,before);assert.match(h.status,/checksum/);
});
