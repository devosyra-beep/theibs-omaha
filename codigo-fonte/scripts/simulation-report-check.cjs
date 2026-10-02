'use strict';
// Completed private deals are verification evidence, never decision inputs.
const fs=require('node:fs'),crypto=require('node:crypto');
const {shuffled,DEAL_VERSION}=require('../src/multiway-simulation');
const multiway=require('../src/multiway-session');
const {holeCount}=require('../src/variants');
const {evaluateOmaha,compareHands}=require('../src/evaluator');
const tools=require('../public/simulation-tools');
function checkReport(report){
  if(!report.audit?.seed)return {id:report.id,status:'NOT_VERIFIABLE',reason:'Completed seed unavailable.'};
  if(report.audit.version!==DEAL_VERSION)return {id:report.id,status:'NOT_VERIFIABLE',reason:'Unknown deal version.'};
  const state=multiway.envelope(report.publicRecord).state,count=holeCount(report.publicRecord.config.variant),deck=shuffled(report.audit.seed);
  const commitment=crypto.createHash('sha256').update(DEAL_VERSION+'\n'+report.audit.seed+'\n'+deck.join(' ')).digest('hex');
  if(commitment!==report.deal.commitment)throw Error('Deal commitment mismatch: '+report.id);
  const hands=state.players.map(()=>[]);
  for(let round=0;round<count;round++)for(let seat=0;seat<hands.length;seat++)hands[seat].push(deck[round*hands.length+seat]);
  if(JSON.stringify(hands[state.heroId])!==JSON.stringify(report.publicRecord.config.heroCards))throw Error('Hero deal mismatch: '+report.id);
  const runout=deck.slice(count*hands.length,count*hands.length+5);
  if(JSON.stringify(runout.slice(0,state.board.length))!==JSON.stringify(state.board))throw Error('Board prefix mismatch: '+report.id);
  if(report.abandoned)return {id:report.id,status:'DEAL_VERIFIED',settlement:'UNKNOWN_NO_PAYOUT'};
  if(state.phase!=='FINISHED')throw Error('An incomplete hand was reported settled: '+report.id);
  const total=state.players.reduce((sum,p)=>sum+p.stack,0);
  if(Math.abs(total-state.totalChips)>.011)throw Error('Chip conservation mismatch: '+report.id);
  const stacks=state.players.map(p=>({id:p.id,stack:p.stack}));
  if(JSON.stringify(stacks)!==JSON.stringify(report.outcome?.stacks))throw Error('Reported stacks mismatch: '+report.id);
  const net=Math.round((state.players[state.heroId].stack-state.players[state.heroId].startingStack)*100)/100;
  if(report.outcome.heroNet!==net)throw Error('Reported profit mismatch: '+report.id);
  if(state.result.reason==='REPORTED_SHOWDOWN')for(const pot of state.result.pots){
    const eligible=pot.eligible.map(id=>({id,hand:evaluateOmaha(hands[id],state.board)}));
    let best=eligible[0].hand;for(const item of eligible)if(compareHands(item.hand,best)>0)best=item.hand;
    const winners=eligible.filter(item=>compareHands(item.hand,best)===0).map(item=>item.id).sort((a,b)=>a-b);
    if(JSON.stringify(winners)!==JSON.stringify([...pot.winners].sort((a,b)=>a-b)))throw Error('Exact Omaha winner mismatch: '+report.id);
  }
  return {id:report.id,status:'DEAL_AND_SETTLEMENT_VERIFIED',replayed:report.replayed===true,measurements:tools.measurements(report)};
}
function checkDataset(dataset){
  if(!['THEIBS_SIMULATION_REPORT_V1','THEIBS_SIMULATION_REPORT_V2'].includes(dataset.schema)||dataset.source!=='SIMULATION_ONLY'||!Array.isArray(dataset.reports))throw Error('Use an exported THEIBS Simulation report.');
  return {checks:dataset.reports.map(checkReport),descriptiveValidation:tools.summary(dataset.reports),
    scope:'DEAL_AND_ACCOUNTING_REGRESSION_PLUS_NOISY_REFERENCE_OUTCOMES_NOT_HUMAN_OR_GTO_ACCURACY'};
}
if(require.main===module){try{if(!process.argv[2])throw Error('Pass the path to a Simulation JSON export.');console.log(JSON.stringify(checkDataset(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={checkReport,checkDataset};
