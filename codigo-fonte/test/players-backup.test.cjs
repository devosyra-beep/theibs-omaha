'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const backup = require('../public/players-backup');
const profiles = require('../src/player-profiles');
const session = require('../src/multiway-session');
const job = require('../src/solver/job-worker');
const { riverCallInput } = require('./helpers/solver-reference-fixtures.cjs');
const clone = structuredClone;
const ownerKey = 'a'.repeat(64), date = '2026-10-01T12:00:00.000Z';
const empty = () => ({schemaVersion:1,store:profiles.createStore(),archive:{},decisions:{}});
const code = expected => error => error.code === expected;
let fixture;
function library() {
  if (!fixture) {
    const value = empty(), input = riverCallInput({blockers:true});
    input.multiway.handId = '11111111-1111-4111-8111-111111111111';
    input.multiway.config.players = [{playerId:'hero_a',name:'Hero'},{playerId:'opponent_a',name:'Opponent'}];
    input.multiway.events.forEach((event,index)=>{event.eventId='event.'+index;});
    profiles.beginHand(value.store,input.multiway);
    profiles.syncHand(value.store,input.multiway);
    const hand = value.store.hands[input.multiway.handId];
    hand.forecastOrigin = {version:'THEIBS_FORECAST_ORIGIN_V1',status:'RECONSTRUCTED_AFTER_ACTION',createdAt:hand.profileSnapshot.frozenAt};
    profiles.addNote(value.store,'opponent_a','Observed action; shown cards remain separate.');
    const before = session.envelope(input.multiway), result = job.execute({input,budget:{timeMs:1000,iterations:256}},{compilationReuse:true,now:()=>0}).result;
    assert.ok(result.actions.length >= 2);
    const finished = session.step(before.multiway,{type:'ACT',actor:before.state.actor,action:'FOLD',eventId:'committed-action'});
    profiles.syncHand(value.store,finished.multiway);
    const decision = {handId:before.multiway.handId,revisionKey:before.state.revisionKey,committedEventId:'committed-action',action:'FOLD',to:null,
      recordBefore:before.multiway,evaluationInput:input,solver:{...result,handId:before.multiway.handId,revisionKey:before.state.revisionKey},
      analysis:{status:'OK',analysisStage:'PROVISIONAL',strategyMetadata:{status:'HEURISTIC',version:'THEIBS_LEGACY_CONTEXT_V1'},
        ev:{candidates:[{optionId:'FOLD',action:'FOLD',status:'MODELED',ev:0,evBB:0},{optionId:'CALL',action:'CALL',status:'NOT_MODELED',ev:null,evBB:null}],
          comparisonComplete:false,leaderConclusive:false,decisionPrecision:{status:'INCONCLUSIVE'}},equity:{equity:null,noSamples:true}},
      recordedAt:date,key:JSON.stringify([before.state.revisionKey,'FOLD',null])};
    value.decisions[hand.handId]=[decision];
    const next = session.nextHand(finished.multiway);
    value.archive[hand.handId] = {...next.archivedHand,archivedAt:date,decisions:[clone(decision)]};
    next.multiway.handId = '22222222-2222-4222-8222-222222222222';
    profiles.beginHand(value.store,next.multiway); // An unfinished historical record is valid.
    fixture = JSON.parse(JSON.stringify(value));
  }
  return clone(fixture);
}
function disjoint(prefix='other') {
  const value=empty(), raw={handId:prefix+'-hand',config:{variant:'PLO4_HIGH',playerCount:2,heroPosition:'BB',startingStack:20,smallBlind:.5,bigBlind:1,
    heroCards:[],players:[{playerId:prefix+'-one',name:'One'},{playerId:prefix+'-two',name:'Two'}]},events:[]};
  profiles.beginHand(value.store,raw);raw.events=[{type:'ACT',actor:0,action:'CALL',eventId:'confirmed:one'}];profiles.syncHand(value.store,raw);
  return value;
}
async function exported(value=library()) { return backup.create({ownerKey,library:value,now:date}); }

test('roundtrip preserves real archived decisions, numeric solver values, HEURISTIC null/zero, notes and frozen origins exactly',async()=>{
  const value=library(), before=clone(value), created=await exported(value), parsed=await backup.parse(created.text,{ownerKey});
  assert.deepEqual(parsed.library,value);assert.deepEqual(value,before);
  assert.equal(parsed.document.scope,'LOCAL_PLAYER_LIBRARY_ONLY');assert.equal(parsed.document.version,backup.VERSION);
  assert.deepEqual(parsed.summary,{totals:{players:2,hands:2,archive:1,decisions:1},decisionSnapshots:1,notes:1});
  assert.equal(parsed.provenance.authenticated,false);assert.equal(parsed.provenance.integrityChecked,true);
  assert.equal(parsed.provenance.label,'Restored backup · file origin not authenticated');
  const row=Object.values(parsed.library.decisions)[0][0];
  assert.equal(row.analysis.ev.candidates[0].ev,0);assert.equal(row.analysis.ev.candidates[1].ev,null);
  assert.equal(row.analysis.equity.equity,null);assert.equal(row.analysis.strategyMetadata.status,'HEURISTIC');
  assert.deepEqual(row.solver,Object.values(value.decisions)[0][0].solver);
  assert.equal('forecastOrigin' in parsed.library.store.hands['22222222-2222-4222-8222-222222222222'],false);
});

test('browser UMD uses WebCrypto SHA-256 without filesystem/network or changing stored data',async()=>{
  const scope={TheibsPlayerProfiles:require('../public/player-profile-model'),crypto:webcrypto,TextEncoder};vm.createContext(scope);
  vm.runInContext(fs.readFileSync(require.resolve('../public/players-backup'),'utf8'),scope);
  const browser=scope.TheibsPlayersBackup, a=await browser.create({ownerKey,library:library(),now:date}), b=await exported();
  assert.equal(a.document.integrity.sha256,b.document.integrity.sha256);assert.equal(a.text,b.text);
  const parsed=await browser.parse(a.text,{ownerKey});assert.equal(JSON.stringify(parsed.library),JSON.stringify(library()));
  assert.equal(scope.fetch,undefined);assert.equal(scope.require,undefined);
});

test('account, version and backup scope checks reject malformed or foreign files before planning',async()=>{
  const created=await exported();
  await assert.rejects(backup.create({ownerKey:'anonymous',library:empty()}),code('BACKUP_INVALID_OWNER'));
  await assert.rejects(backup.parse(created.text,{ownerKey:'b'.repeat(64)}),code('BACKUP_OWNER_MISMATCH'));
  for(const edit of [doc=>{doc.version='FUTURE';},doc=>{doc.schemaVersion=2;},doc=>{doc.format='OTHER';}]) {
    const doc=clone(created.document);edit(doc);await assert.rejects(backup.parse(JSON.stringify(doc),{ownerKey}),code('BACKUP_UNSUPPORTED_VERSION'));
  }
  const doc=clone(created.document);doc.scope='WORKSPACE';await assert.rejects(backup.parse(JSON.stringify(doc),{ownerKey}),code('BACKUP_UNSUPPORTED_SCOPE'));
  for(const field of ['draft','workspace','rangeTemplates']) {const value=library();value[field]={secret:true};await assert.rejects(exported(value),code('BACKUP_UNSUPPORTED_SCOPE'));}
  for(const text of ['', '{', '{} trailing', '[]'])await assert.rejects(backup.parse(text,{ownerKey}));
});

test('checksum catches altered content and ledger revision checks prevent relabeling a mismatched decision',async()=>{
  const created=await exported(), doc=clone(created.document);doc.library.store.players.opponent_a.notes[0].text='Tampered';
  await assert.rejects(backup.parse(JSON.stringify(doc),{ownerKey}),code('BACKUP_INTEGRITY_MISMATCH'));
  const value=library(), row=Object.values(value.decisions)[0][0];row.recordBefore.events[0].eventId='changed-original-event';
  value.archive[row.handId].decisions=[];await assert.rejects(exported(value),code('BACKUP_INVALID_DATA'));
});

test('duplicate decoded JSON keys and prototype names are rejected instead of overwritten',async()=>{
  const created=await exported();
  await assert.rejects(backup.parse(created.text.replace('"format":','"format":"discarded","format":'),{ownerKey}),code('BACKUP_DUPLICATE_KEY'));
  await assert.rejects(backup.parse(created.text.replace('"format":','"\\u0066ormat":"discarded","format":'),{ownerKey}),code('BACKUP_DUPLICATE_KEY'));
  for(const key of ['__proto__','constructor','prototype']) {
    const text=created.text.replace('"library":{','"library":{"'+key+'":{},');await assert.rejects(backup.parse(text,{ownerKey}),code('BACKUP_INVALID_DATA'));
  }
});

test('host objects, getters, nonfinite EV, sparse arrays and cycles fail before serialization can alter them',async()=>{
  let reads=0;
  for(const poison of [value=>Object.defineProperty(value.store.players,'accessor',{enumerable:true,get(){reads++;return {};}}),
    value=>{value.extra=new Date();},value=>{value.store.players.opponent_a.toJSON=()=>({});},
    value=>{value.store.players.opponent_a.bad=NaN;},value=>{value.store.players.opponent_a.bad=Infinity;},
    value=>{value.store.players.opponent_a.bad=[undefined];},value=>{value.store.players.opponent_a.bad=Array(2);},
    value=>{value.store.players.opponent_a.bad=value;}]) {
    const value=library();poison(value);await assert.rejects(exported(value));
  }
  assert.equal(reads,0);
  const value=library(), proto=Object.create(null);Object.defineProperty(proto,'constructor',{get(){reads++;return Object;}});
  value.store.players.opponent_a.bad=Object.create(proto);await assert.rejects(exported(value));assert.equal(reads,0);
  const sparse=library();sparse.store.players.opponent_a.notes.foo='hidden';await assert.rejects(exported(sparse));
});

test('10 MiB cap counts UTF-8 bytes and depth is bounded before loading',async()=>{
  await assert.rejects(backup.parse(' '.repeat(backup.MAX_BYTES+1),{ownerKey}),code('BACKUP_TOO_LARGE'));
  await assert.rejects(backup.parse('"'+'é'.repeat(backup.MAX_BYTES/2)+'"',{ownerKey}),code('BACKUP_TOO_LARGE'));
  await assert.rejects(backup.parse('['.repeat(66)+'0'+']'.repeat(66),{ownerKey}),code('BACKUP_STRUCTURE_LIMIT'));
  const value=empty();value.store.extra='x'.repeat(backup.MAX_BYTES);await assert.rejects(exported(value));
});

test('empty restoration copies original records and aggregate counts without summing snapshots or decisions',async()=>{
  const incoming=await backup.parse((await exported()).text,{ownerKey}), current=empty(), before=clone(incoming.library);
  const plan=backup.planImport({current,incoming});
  assert.equal(plan.summary.mode,'EMPTY_RESTORE');assert.deepEqual(plan.summary.added,{players:2,hands:2,archive:1,decisions:1});
  assert.equal(plan.summary.statsRecomputed,false);assert.equal(plan.summary.recordsChanged,6);
  assert.equal(plan.library.store.revision,before.store.revision+1);
  assert.deepEqual(plan.library.store.players,before.store.players);assert.deepEqual(plan.library.store.hands,before.store.hands);
  assert.deepEqual(plan.library.archive,before.archive);assert.deepEqual(plan.library.decisions,before.decisions);
  assert.deepEqual(plan.library.backupOrigins.handIds,Object.keys(before.store.hands).sort());assert.deepEqual(plan.provenance,incoming.provenance);
  assert.deepEqual(incoming.library,before);assert.deepEqual(current,empty());
});

test('same file repeated is a no-op and optional restored-origin union is idempotent',async()=>{
  const incoming=await exported(), first=backup.planImport({current:empty(),incoming});
  const second=backup.planImport({current:first.library,incoming}), third=backup.planImport({current:second.library,incoming});
  assert.deepEqual(second.library,first.library);assert.deepEqual(third.library,first.library);
  assert.deepEqual(second.dirty,{players:[],hands:[],archive:[],decisions:[]});assert.equal(second.summary.recordsChanged,0);
  assert.equal(second.summary.provenanceChanged,false);assert.equal(second.summary.mode,'IDENTICAL_ONLY');
  const value=library();value.backupOrigins={schemaVersion:1,handIds:[Object.keys(value.store.hands)[0]]};
  const parsed=await backup.parse((await exported(value)).text,{ownerKey});assert.deepEqual(parsed.library,value);
  const receiptOnly=backup.planImport({current:library(),incoming:parsed});assert.equal(receiptOnly.summary.recordsChanged,0);
  assert.equal(receiptOnly.summary.provenanceChanged,true);assert.deepEqual(receiptOnly.dirty,{players:[],hands:[],archive:[],decisions:[]});
  assert.deepEqual(backup.planImport({current:receiptOnly.library,incoming:parsed}).library,receiptOnly.library);
});

test('disjoint restoration is additive while conflicts in any record kind block the entire plan',()=>{
  const current=library(), incoming=disjoint(), before=clone([current,incoming]);
  const plan=backup.planImport({current,incoming});assert.equal(plan.summary.mode,'DISJOINT_ADDITIVE');
  assert.deepEqual(plan.library.store.players.opponent_a,current.store.players.opponent_a);
  assert.deepEqual(plan.library.store.players['other-one'],incoming.store.players['other-one']);assert.deepEqual([current,incoming],before);
  for(const kind of ['players','hands','archive','decisions']) {
    const conflicting=library();
    if(kind==='players')conflicting.store.players.opponent_a.nickname='Changed';
    if(kind==='hands')Object.values(conflicting.store.hands)[0].fingerprint='different historical fingerprint';
    if(kind==='archive')Object.values(conflicting.archive)[0].archivedAt='2026-09-01T12:00:00.000Z';
    if(kind==='decisions'){Object.values(conflicting.decisions)[0][0].recordedAt='2026-09-01T12:00:00.000Z';Object.values(conflicting.archive)[0].decisions=clone(Object.values(conflicting.decisions)[0]);}
    const original=clone([current,conflicting]);assert.throws(()=>backup.planImport({current,incoming:conflicting}),error=>error.code==='BACKUP_CONFLICT' && error.conflicts.some(row=>row.kind===kind));assert.deepEqual([current,conflicting],original);
  }
});

test('new hand touching an identical existing player is blocked even when its counts are zero',()=>{
  const current=empty(), incoming=empty(), raw={handId:'first',config:{variant:'PLO4_HIGH',playerCount:2,players:[{playerId:'common',name:'Common'},{playerId:'another',name:'Another'}]},events:[]};
  profiles.beginHand(current.store,raw);profiles.beginHand(incoming.store,{...raw,handId:'second'});
  incoming.store.players=clone(current.store.players); // Exact aggregates still do not identify whether new observations were counted.
  const before=clone([current,incoming]);assert.throws(()=>backup.planImport({current,incoming}),code('BACKUP_OVERLAPPING_PLAYER'));assert.deepEqual([current,incoming],before);
});

test('historical deleted identities and reset tombstones cannot be resurrected by an apparently disjoint import',()=>{
  const current=disjoint('local');profiles.deletePlayer(current.store,'local-one');
  const incoming=empty(), raw={handId:'new-hand',config:{variant:'PLO4_HIGH',playerCount:2,heroPosition:'BB',startingStack:20,smallBlind:.5,bigBlind:1,
    heroCards:[],players:[{playerId:'local-one',name:'Removed player'},{playerId:'incoming-two',name:'New player'}]},events:[]};
  profiles.beginHand(incoming.store,raw);raw.events=[{type:'ACT',actor:0,action:'CALL',eventId:'new-action'}];profiles.syncHand(incoming.store,raw);
  const before=clone([current,incoming]);
  assert.throws(()=>backup.planImport({current,incoming}),error=>error.code==='BACKUP_OVERLAPPING_PLAYER' && error.conflicts.some(row=>row.kind==='players' && row.id==='local-one'));
  assert.deepEqual([current,incoming],before);
  const playerOnly=empty();playerOnly.store.players['local-one']={...clone(incoming.store.players['local-one']),contexts:{},observations:0};
  assert.throws(()=>backup.planImport({current,incoming:playerOnly}),code('BACKUP_OVERLAPPING_PLAYER'));
  // resetPlayerIds can appear on hands whose physical roster never contained
  // the reset player; these tombstones must still reserve the deleted identity.
  const unrelated=disjoint('unrelated');unrelated.store.hands['unrelated-hand'].resetPlayerIds=['local-one'];
  assert.throws(()=>backup.planImport({current:unrelated,incoming:playerOnly}),code('BACKUP_OVERLAPPING_PLAYER'));
  const restored=backup.planImport({current:empty(),incoming});assert.equal(restored.library.store.players['local-one'].observations,1);
});

test('inconsistent counts, duplicate observations and orphan archive/decision references cannot be repaired on import',async()=>{
  for(const poison of [value=>{value.store.players.opponent_a.observations++;},
    value=>{const hand=Object.values(value.store.hands)[0];hand.observations.push(clone(hand.observations[0]));},
    value=>{delete value.store.hands[Object.keys(value.archive)[0]];},
    value=>{value.decisions.orphan=[];},
    value=>{const player=value.store.players.opponent_a,cell=Object.values(player.contexts)[0];cell.counts.CHECK=(cell.counts.CHECK||0)+1;player.observations++;}]) {
    const value=library();poison(value);await assert.rejects(exported(value),code('BACKUP_INVALID_DATA'));
  }
});

test('reset and deletion retain historical roster/snapshot references without recreating observations or missing origin fields',async()=>{
  const value=library(), original=clone(value.store.hands);profiles.deletePlayer(value.store,'opponent_a');
  delete value.store.players.hero_a.createdAt;delete value.store.hands[Object.keys(value.store.hands)[0]].forecastOrigin;
  const parsed=await backup.parse((await exported(value)).text,{ownerKey});assert.deepEqual(parsed.library,value);
  assert.equal(parsed.library.store.players.opponent_a,undefined);
  for(const hand of Object.values(parsed.library.store.hands)) {
    assert.ok(hand.playerIds.includes('opponent_a'));assert.ok(hand.profileSnapshot.players.opponent_a);
    assert.ok(hand.resetPlayerIds.includes('opponent_a'));assert.ok(hand.observations.every(row=>row.playerId!=='opponent_a'));
    assert.deepEqual(hand.profileSnapshot,original[hand.handId].profileSnapshot);
  }
  assert.equal('createdAt' in parsed.library.store.players.hero_a,false);
});

test('later archive-only shown cards and numeric-string config preserve earlier observation fingerprints and decision prefix revisions',async()=>{
  const value=library(), key=Object.keys(value.archive)[0], archive=value.archive[key], before=clone(value.store.hands[key]);
  const shown=session.step(archive.multiway,{type:'REVEAL',actor:1,cards:['Ks','Kh','Jd','Qh','6c'],eventId:'shown-later'});
  archive.multiway=shown.multiway;archive.state=shown.state;
  assert.notEqual(archive.state.revisionKey,value.decisions[key][0].revisionKey);
  const parsed=await backup.parse((await exported(value)).text,{ownerKey});assert.deepEqual(parsed.library.store.hands[key],before);
  assert.deepEqual(parsed.library.archive[key].state.players[1].shownCards,['Ks','Kh','Jd','Qh','6c']);
  const raw=session.start({variant:'PLO4_HIGH',playerCount:2,heroPosition:'BB',startingStack:'20',smallBlind:'0.5',bigBlind:'1',heroCards:[],players:[{playerId:'one',name:'One'},{playerId:'two',name:'Two'}]});
  const strings=empty();profiles.beginHand(strings.store,raw.multiway);const finished=session.step(raw.multiway,{type:'ACT',actor:0,action:'FOLD'});profiles.syncHand(strings.store,finished.multiway);
  strings.archive[raw.multiway.handId]={...session.nextHand(finished.multiway).archivedHand,decisions:[]};
  const result=await backup.parse((await exported(strings)).text,{ownerKey});assert.equal(Object.values(result.library.archive)[0].multiway.config.startingStack,'20');
});

test('decision crosslinks, incomplete strategy and inverted commitment bounds are rejected without changing saved qualification',async()=>{
  for(const poison of [row=>{row.solver.revisionKey='b'.repeat(64);},row=>{row.solver.actions[0].evBB='0';},
    row=>{row.solver.actions[0].frequency=2;},row=>{row.solver.status='SOLVED';row.solver.quality={};},
    row=>{const bound=row.solver.actionPrecision.actions.find(action=>action.certified);assert.ok(bound);bound.upperBB=bound.lowerBB-1;}]) {
    const value=library(), key=Object.keys(value.decisions)[0];poison(value.decisions[key][0]);value.archive[key].decisions=clone(value.decisions[key]);
    await assert.rejects(exported(value),code('BACKUP_INVALID_DATA'));
  }
  const value=library(), archive=Object.values(value.archive)[0];archive.decisions.push(clone(archive.decisions[0]));await assert.rejects(exported(value),code('BACKUP_INVALID_DATA'));
});
