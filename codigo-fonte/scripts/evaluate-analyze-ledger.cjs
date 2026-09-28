'use strict';
// Post-run accounting audit. All rows are checked; independent card oracle is
// applied to the first eight showdowns in each policy/scenario, fixed by order.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {hash}=require('../src/analyze-experiment-env');
const oracle=require('./lib/numeric-oracle.cjs');
const folder=path.resolve(process.argv[2]||'');
const protocol=JSON.parse(fs.readFileSync(path.join(folder,'protocol.json'),'utf8'));
const {deal}=require(path.join(protocol.candidateRoot,'src/analyze-experiment-env'));
const {replay}=require(path.join(protocol.candidateRoot,'src/hand-flow'));
const {calculateRake}=require(path.join(protocol.candidateRoot,'src/rake-model'));
const rows=fs.readFileSync(path.join(folder,'hands.jsonl'),'utf8').trim().split('\n').map(JSON.parse),groups=new Map(),worlds=new Map(),oracleCounts=new Map();
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
let checkedDecisions=0,independentShowdowns=0;
for(const row of rows){
  const world=deal(row.seed),scenario=protocol.scenarios.find(s=>s.id===row.scenario),key=`${row.scenario}:${row.policy}:${row.block}`;
  assert.equal(hash(world),row.worldHash);assert.equal(row.heroSeat,row.hand%2);
  const cluster=`${row.scenario}:${row.block}:${row.hand}`;if(worlds.has(cluster))assert.equal(worlds.get(cluster),row.worldHash);else worlds.set(cluster,row.worldHash);
  const group=groups.get(key)||new Set();assert.ok(!group.has(row.hand));group.add(row.hand);groups.set(key,group);
  near(row.netChips,row.finalStacks[row.heroSeat]-100);near(row.netBB,row.netChips/2);near(row.netChips+row.opponentNetChips+row.rakeChips,0);near(row.finalStacks[0]+row.finalStacks[1]+row.rakeChips,200);
  near(row.funding.externalWithdrawalChips-row.funding.externalTopupChips,row.netChips);
  const config={variant:'PLO5_HIGH',playerCount:2,heroPosition:row.heroSeat===0?'BTN':'BB',startingStack:100,smallBlind:1,bigBlind:2,heroCards:world.holes[row.heroSeat]};
  const final=replay(config,row.events);assert.equal(final.phase,'FINISHED');
  if(row.foldAccounting){const f=row.foldAccounting;near(f.contestedPot,f.grossPot-f.uncalledReturn);near(f.rake,scenario.rakeSchedule?calculateRake({pot:f.contestedPot,boardCount:final.board.length},scenario.rakeSchedule):0);final.players[f.winner].stack-=f.rake;}
  for(let i=0;i<2;i++)near(final.players[i].stack,row.finalStacks[i]);
  for(const d of row.decisions){checkedDecisions++;assert.deepEqual(d.observation.heroCards,world.holes[row.heroSeat]);assert.deepEqual(d.observation.board,world.board.slice(0,d.observation.board.length));assert.equal(d.observation.heroSeat,row.heroSeat);assert.ok(!('world'in d.observation));assert.ok(!('seed'in d.observation));assert.ok(!('opponentFamily'in d.observation));assert.ok(d.observation.legal.actions.includes(d.action));if(d.to!=null)assert.ok(d.to>=d.observation.legal.minTo-1e-8&&d.to<=d.observation.legal.maxTo+1e-8);}
  const oracleKey=`${row.scenario}:${row.policy}`,count=oracleCounts.get(oracleKey)||0;
  if(row.showdown&&count<8){const scores=world.holes.map(hand=>oracle.omahaScore(hand,world.board)),best=Math.max(...scores),winners=[0,1].filter(i=>scores[i]===best),settle=row.events.find(e=>e.type==='SETTLE');for(const actual of settle.winners)assert.deepEqual([...actual].sort(),winners);oracleCounts.set(oracleKey,count+1);independentShowdowns++;}
}
assert.equal(rows.length,protocol.scenarios.length*protocol.policies.length*protocol.blocks*protocol.handsPerBlock);
for(const group of groups.values())assert.equal(group.size,protocol.handsPerBlock);
assert.equal(groups.size,protocol.scenarios.length*protocol.policies.length*protocol.blocks);
const report={status:'PASS',at:new Date().toISOString(),evidenceOrigin:'LOCAL_LEDGER_AUDIT',hands:rows.length,pairedDeals:worlds.size,completePolicyBlocks:groups.size,checkedDecisions,independentShowdowns,oracleScope:'Independent internal raw-card evaluator; first 8 showdowns per policy/scenario; not external solver validation.',protocolHash:hash(fs.readFileSync(path.join(folder,'protocol.json'))),ledgerHash:hash(fs.readFileSync(path.join(folder,'hands.jsonl')))};
fs.writeFileSync(path.join(folder,'ledger-audit.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
