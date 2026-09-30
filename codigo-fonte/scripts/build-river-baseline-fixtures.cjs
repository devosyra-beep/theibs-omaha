'use strict';
// Synthetic, explicit studies. No user data or account credentials enter fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {terminalCallInput}=require('./benchmark-hu-precision.cjs');
const {riverMixedInput}=require('../test/helpers/solver-reference-fixtures.cjs');
const session=require('../src/multiway-session');
const adapter=require('../src/solver/plo-river-game');
const clone=value=>structuredClone(value);
const permutations=['hdcs','dchs','cshd','shcd','hcsd'];
function permute(input,order){
  const output=clone(input),suits=Object.fromEntries([... 'shdc'].map((suit,index)=>[suit,order[index]]));
  assert.equal(new Set(Object.values(suits)).size,4);
  const card=value=>value.slice(0,-1)+suits[value.slice(-1)];
  output.multiway.config.heroCards=output.multiway.config.heroCards.map(card);
  output.multiway.events.forEach(event=>{if(event.cards)event.cards=event.cards.map(card);});
  output.ranges.forEach(range=>range.combos.forEach(combo=>{combo.cards=combo.cards.map(card);}));
  return output;
}
function variant(id,input){
  input=clone(input);const hex=crypto.createHash('sha256').update(`baseline-0149-${id}`).digest('hex').slice(0,32);
  input.multiway.handId=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  const observed=session.envelope(input.multiway);
  const coverage=adapter.coverage(input);
  assert.equal(coverage.status,'READY',JSON.stringify(coverage));
  return {id,input,expectedRevisionKey:observed.state.revisionKey};
}
const cases=[
  {id:'separated_terminal_call',label:'Separated call',input:terminalCallInput(false),expectation:{comparisonStatus:'CONCLUSIVE',bestActionId:'CALL',actionValues:{FOLD:0,CALL:3},globalStatus:'SOLVED'}},
  {id:'overlapping_terminal_call',label:'Overlapping call/fold',input:terminalCallInput(true),expectation:{comparisonStatus:'INCONCLUSIVE',requireOverlap:true,actionValues:{FOLD:0,CALL:0},globalStatus:'SOLVED'}},
  {id:'four_world_five_actions',label:'Four worlds / five actions',input:riverMixedInput(),expectation:{comparisonStatus:'CONCLUSIVE',bestActionId:'CHECK',actionValues:{FOLD:.75,CHECK:1.25,'BET:1.00':1,'BET:1.50':.875,'BET:2.00':.75},globalStatus:'APPROXIMATE'}}
].map(({input,...item})=>({...item,variants:permutations.map((order,index)=>variant(`${item.id}-${index+1}`,permute(input,order)))}));
const base=variant('invalidation-base',riverMixedInput());
function change(id,mutate){const input=clone(base.input);mutate(input);return {id,base,changed:variant(`invalidation-${id}`,input),expected:'CACHE_MISS'};}
const invalidation=[
  change('ranges-weights',input=>{input.ranges[1].combos[0].weight=2;}),
  change('ranges-combinations',input=>{input.ranges[1].combos[0].cards[0]='Kc';}),
  change('board',input=>{input.multiway.events.filter(event=>event.type==='BOARD').at(-1).cards[4]='9h';}),
  change('rake',input=>{input.rake={type:'FIXED',amount:.1};}),
  change('fee-basis',input=>{input.rake={type:'NONE',basis:'NO_FEES'};}),
  change('stacks',input=>{input.multiway.config.startingStack=21;}),
  change('sizings',input=>{input.sizing={type:'EXPLICIT_TOTALS',levels:[1,2],maxAggressions:1};}),
  change('aggression-abstraction',input=>{input.sizing.maxAggressions=2;}),
  change('public-action-state',input=>{const event=input.multiway.events.at(-1);assert.equal(event.type,'ACT');event.action='BET';event.to=1;})
];
const heavy=riverMixedInput();heavy.sizing.maxAggressions=3;
heavy.ranges[0].combos.push({cards:['Ts','Th','Qd','Jc','Tc'],weight:1});
heavy.ranges[1].combos.push({cards:['Qs','Qh','6d','7c','8h'],weight:1});
// Current coverage is unchanged: two players, three combinations per seat.
const obsolete=variant('cancellation-obsolete',permute(heavy,'dsch'));
// The obsolete study is intentionally heavy enough to observe cancellation.
// Its replacement is a supported small decision, so resource exhaustion of a
// second heavy tree cannot be confused with failure to cancel the first job.
const replacementInput=permute(terminalCallInput(false),'cshd');replacementInput.rake={type:'FIXED',amount:.02};
const replacement=variant('cancellation-replacement',replacementInput);
const output={schemaVersion:1,baselineCommit:'1c9a91fd1555297b50c3db5e092868516436b60e',version:'0.14.9',generatedAt:new Date().toISOString(),
  methodology:'Cold candidates are five bijective suit permutations per scenario. A consistent suit bijection preserves rank ordering, flushes, blockers and utilities. No canonicalization is added. Report actual cache hit/miss; an existing hit is not a cold sample.',
  reference:'Terminal values use exact ledger/showdown arithmetic; four-world commitment values independently verified by sequence-form LP. Tolerance1e-7 is for comparing the numeric reference, never for declaring dominance.',
  versionUtilityBoundary:'Utility semantics, rules and solver versions are fixed server contracts. Version invalidation is tested at the local module/cache boundary, not by spoofing an API version field.',
  cases,invalidation,cancellation:{obsolete,replacement}};
const target=path.resolve(__dirname,'../public/solver-validation-fixtures.json');
fs.writeFileSync(target,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({output:target,cases:cases.length,variants:cases.reduce((n,item)=>n+item.variants.length,0),invalidations:invalidation.length,cancellationCoverage:adapter.coverage(obsolete.input).status}));
