'use strict';
// Usage: node scripts/evaluate-analyze.cjs --prepare --stage pilot --out DIR --baseline DIR
// Then: node scripts/evaluate-analyze.cjs --run --out DIR
// Prepare refuses overwrite. Run verifies the frozen code/protocol before
// generating any outcomes and never repeats a completed or interrupted trial.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const APP=path.resolve(__dirname,'..');
const {playHand,hash}=require('../src/analyze-experiment-env');
let stats=require('../src/economic-statistics');
const {buildAnalyzeInput,decideAnalyzePolicy}=require('../src/analyze-policy');
const argv=process.argv.slice(2),arg=(k,d)=>{const i=argv.indexOf(k);return i<0?d:argv[i+1];};
const out=path.resolve(arg('--out',path.join(APP,'../validacao/analyze-online-2026-09-27/economics/development')));
const protocolPath=path.join(out,'protocol.json');
function sourceHashes(root){const result={};function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(/\.(?:js|cjs|json)$/.test(entry.name))result[path.relative(root,full).replaceAll('\\','/')]=hash(fs.readFileSync(full));}}walk(path.join(root,'src'));for(const file of ['package.json','scripts/evaluate-analyze.cjs'])if(fs.existsSync(path.join(root,file)))result[file]=hash(fs.readFileSync(path.join(root,file)));return result;}
const rake={type:'PERCENT_CAPPED',rate:.05,cap:2,noFlopNoDrop:true,rounding:'FLOOR_CENT',source:'SYNTHETIC_STUDY',version:'1'};
function prepare(){
  if(fs.existsSync(out)&&fs.readdirSync(out).length)throw Error('Experiment directory must be empty; never overwrite prior evidence.');
  const stage=arg('--stage','development');if(!['development','pilot','holdout'].includes(stage))throw Error('Invalid stage.');
  const baseline=path.resolve(arg('--baseline',path.join(APP,'../validacao/analyze-online-2026-09-27/economics/baseline-0.13.0')));
  if(!fs.existsSync(path.join(baseline,'src/decision-engine.js')))throw Error('Supply extracted frozen baseline directory.');
  const blocks=Number(arg('--blocks',stage==='holdout'?20:1)),handsPerBlock=stage==='development'?12:100;
  if(!Number.isInteger(blocks)||blocks<1||blocks>10000)throw Error('Invalid fixed block count.');
  const protocol={schemaVersion:1,id:`ANALYZE_${stage.toUpperCase()}_${new Date().toISOString().replaceAll(':','-')}`,createdAt:new Date().toISOString(),stage,
    scope:'LOCAL_DIRECT_ANALYZE_COMPLETE_HANDS',inference:stage==='holdout'?'EXPLORATORY_FIXED_N':'DEVELOPMENT_OR_VARIANCE_PILOT_NOT_CONFIRMATORY',
    baselineRoot:baseline,candidateRoot:path.join(out,'frozen-candidate'),baselineVersion:JSON.parse(fs.readFileSync(path.join(baseline,'package.json'),'utf8')).version,candidateVersion:require('../package.json').version,
    baselineHashes:sourceHashes(baseline),candidateHashes:sourceHashes(APP),
    seedNamespace:arg('--seed-namespace',`analyze-${stage}-2026-09-27-independent-v1`),blocks,handsPerBlock,referenceCapitalBB:1000,
    funding:'UNLIMITED_TOPUP_RESET_EACH_HAND',startingStackChips:100,bigBlind:2,smallBlind:1,variant:'PLO5',heroSeatOrder:'ALTERNATE_BTN_BB_50_EACH_PER_100',
    settings:{samples:500,samplingMode:'FIXED',productPreset:'FAST_500',study:true,callProbability:.5,sizeFraction:.5,practicalEquivalenceBB:.1,deadlineMs:3000,fallback:'CHECK_FOLD'},
    policies:stage==='development'?['baseline','candidate','candidate_marginal','candidate_point']:['baseline','candidate'],
    scenarios:['CALL_STATION','PRESSURE'].flatMap(opponentFamily=>[{id:`${opponentFamily}_ZERO`,opponentFamily,rakeSchedule:null},{id:`${opponentFamily}_RAKE`,opponentFamily,rakeSchedule:rake}]),
    alphaFamily:.05,meanFamilySize:12,probabilityFamilySize:8,
    methods:{mean:'Equal seat-stratified fixed-N empirical Bernstein with alpha/2 per seat and support [-50,50] BB per hand.',difference:'Same deal/seat paired differences, seat stratification, support [-100,100] BB, no assumption pairing improves interval.',probability:'Two-sided exact Clopper-Pearson over independent 100-hand blocks. Bonferroni 8 positive-probability estimates.',prediction:'Exchangeable order statistics for next 100-hand block, central 90% requested; physical [-5000,5000] BB if insufficient blocks.',power:'Pilot IID per-seat hand variances induce variance of a balanced independent 100-hand block; normal approximation only; relative H0<=1 vs alternative3 bb/100, absolute H0<=0 vs alternative3, family adjusted alpha, power80%.'},
    references:{meanBound:'https://arxiv.org/abs/0907.3740 (Maurer-Pontil theorem 4; two sides, then seat/family union bounds)'},
    gates:{relativeLowerBoundGreaterThan:1,absoluteLowerBoundGreaterThan:0,combinedRequiresBoth:true,smallSampleClassification:'INCONCLUSIVE_UNLESS_BOTH_FIXED_GATES_PASS_IN_DECLARED_ENVIRONMENT'},
    resourceBudget:{maxWallMinutes:40,onLimit:'ABORT_AND_PRESERVE_ALL_PARTIAL_OUTCOMES; NO_CLAIM; DO_NOT_REPEAT_SAME_PROTOCOL'},
    opponentDisclosure:'Independent hand-written synthetic policies; do not import hero model or production opponent-policy. True family/cards never supplied to hero. No human/external benchmark.',
    baselineCostHandling:'Frozen 0.13.0 models fixed zero rake in choice; same synthetic fee charged in environment. Candidate gets schedule before choice. This combined comparison cannot isolate inference from cost changes.',
    analysisSeeds:'Analysis RNG namespace is disjoint from deal RNG, shared across policies at same decision ordinal; never derives the visible deck from seed supplied to hero.',
    limitations:['SHOWDOWN_ONLY action EV differs from complete reconsulted policy continuation.','Uniform ranges not conditioned on opponent actions; structural model risk remains.','Unlimited financing; no finite bankroll ruin estimate.','Direct synchronous deadline excludes HTTP queue/network.','Hosted deployment and provider ASR not evaluated here.'],
    pilotSummary:arg('--pilot')?path.resolve(arg('--pilot')):null};
  if(protocol.pilotSummary){
    protocol.pilotSummaryHash=hash(fs.readFileSync(protocol.pilotSummary));protocol.pilotInformedDesign=true;
    protocol.pilotLedgerHash=hash(fs.readFileSync(path.join(path.dirname(protocol.pilotSummary),'hands.jsonl')));
    const pilotProtocol=JSON.parse(fs.readFileSync(path.join(path.dirname(protocol.pilotSummary),'protocol.json'),'utf8'));
    if(protocol.seedNamespace===pilotProtocol.seedNamespace)throw Error('Pilot and final sample must use distinct seed namespaces.');
  }
  protocol.seedNamespacePolicy='Reusing a namespace repeats the same deals; new independent experiments require an explicitly new --seed-namespace.';
  protocol.meanFamilySize=protocol.scenarios.length*(2*protocol.policies.length-1);
  protocol.probabilityFamilySize=protocol.scenarios.length*protocol.policies.length;
  fs.mkdirSync(out,{recursive:true});fs.mkdirSync(protocol.candidateRoot);fs.cpSync(path.join(APP,'src'),path.join(protocol.candidateRoot,'src'),{recursive:true});fs.mkdirSync(path.join(protocol.candidateRoot,'scripts'));fs.copyFileSync(path.join(APP,'package.json'),path.join(protocol.candidateRoot,'package.json'));fs.copyFileSync(__filename,path.join(protocol.candidateRoot,'scripts/evaluate-analyze.cjs'));
  if(JSON.stringify(sourceHashes(protocol.candidateRoot))!==JSON.stringify(protocol.candidateHashes))throw Error('Source changed while freezing; preserve directory and prepare a new one.');
  const serialized=JSON.stringify(protocol,null,2)+'\n';fs.writeFileSync(protocolPath,serialized,{flag:'wx'});fs.writeFileSync(path.join(out,'protocol.sha256'),hash(serialized)+'\n',{flag:'wx'});
  console.log(JSON.stringify({prepared:protocol.id,protocolHash:hash(serialized),blocks,handsPerBlock,policies:protocol.policies}));
}
function scaleCI(ci,k){return {...ci,lower:ci.lower*k,upper:ci.upper*k,...(Array.isArray(ci.support)?{support:ci.support.map(x=>x*k)}:{})};}
function seatCI(records,field,support,alpha){const cis=[0,1].map(seat=>stats.boundedMeanCI(records.filter(r=>r.heroSeat===seat).map(r=>r[field]),{lower:-support,upper:support,alpha:alpha/2}));return {lower:50*(cis[0].lower+cis[1].lower),upper:50*(cis[0].upper+cis[1].upper),level:1-alpha,method:'SEAT_STRATIFIED_FIXED_N_EMPIRICAL_BERNSTEIN',support:[-support*100,support*100]};}
function coverage(records){const c={decisions:0,supported:0,abstentions:0,errors:0,timeouts:0,reasonCounts:{},byStreetPosition:{},observedSamples:[]},samples=new Set();for(const r of records)for(const d of r.decisions){c.decisions++;const key=`${d.street}:${d.position}`,s=c.byStreetPosition[key]||(c.byStreetPosition[key]={decisions:0,supported:0,abstentions:0});s.decisions++;if(d.source==='SUPPORTED_CONDITIONAL'){c.supported++;s.supported++;}else{c.abstentions++;s.abstentions++;}if(d.error)c.errors++;if(d.timedOut)c.timeouts++;if(d.samples!=null)samples.add(d.samples);for(const reason of d.reasonCodes||[])c.reasonCounts[reason]=(c.reasonCounts[reason]||0)+1;}c.observedSamples=[...samples].sort((a,b)=>a-b);return c;}
function blockValues(records){const blocks=new Map();for(const r of records)blocks.set(r.block,(blocks.get(r.block)||0)+r.netBB);return [...blocks.values()];}
function maxDrawdown(records){let max=0;for(const block of new Set(records.map(r=>r.block))){let sum=0,peak=0;for(const r of records.filter(r=>r.block===block)){sum+=r.netBB;peak=Math.max(peak,sum);max=Math.max(max,peak-sum);}}return max;}
function sdBalanced(records,field){return Math.sqrt([0,1].map(seat=>50*(stats.variance(records.filter(r=>r.heroSeat===seat).map(r=>r[field]))||0)).reduce((a,b)=>a+b,0));}
function summarize(protocol,records,protocolHash,pilot){
  const alpha=protocol.alphaFamily/protocol.meanFamilySize,pAlpha=protocol.alphaFamily/protocol.probabilityFamilySize;
  return {schemaVersion:1,evidenceOrigin:'SIMULATION',execution:'LOCAL_EXECUTED',status:protocol.stage==='holdout'?'EXPLORATORY_INCONCLUSIVE':protocol.stage.toUpperCase(),protocolId:protocol.id,protocolHash,createdAt:new Date().toISOString(),baselineVersion:protocol.baselineVersion,candidateVersion:protocol.candidateVersion,referenceCapitalBB:protocol.referenceCapitalBB,funding:protocol.funding,settings:protocol.settings,
    uncertainty:{familyAlpha:protocol.alphaFamily,meanFamilySize:protocol.meanFamilySize,positiveProbabilityFamilySize:protocol.probabilityFamilySize,meanIntervals:'simultaneously adjusted within economic mean family',probabilityIntervals:'separate descriptive probability family, not an additional profitability gate'},
    scenarios:protocol.scenarios.map(s=>{const baseline=records.filter(r=>r.scenario===s.id&&r.policy==='baseline');return {id:s.id,label:`PLO5 HU 50 BB · ${s.opponentFamily} · ${s.rakeSchedule?'rake sintético 5% cap 1 BB':'custo zero'}`,variant:'PLO5',seats:2,depthBB:50,opponentFamily:s.opponentFamily,cost:s.rakeSchedule||{type:'ZERO_CONTROL'},nBlocks:protocol.blocks,handsPerBlock:protocol.handsPerBlock,nHands:protocol.blocks*protocol.handsPerBlock,
      policies:protocol.policies.map(id=>{const rows=records.filter(r=>r.scenario===s.id&&r.policy===id),blocks=blockValues(rows),paired=rows.map((r,i)=>({...r,delta:r.netBB-baseline[i].netBB})),meanBB100=100*stats.mean(rows.map(r=>r.netBB)),meanCI=seatCI(rows,'netBB',50,alpha),deltaCI=id==='baseline'?null:seatCI(paired,'delta',100,alpha),positives=blocks.filter(x=>x>1e-8).length,zeros=blocks.filter(x=>Math.abs(x)<=1e-8).length;
        const planningRows=pilot?.records?.filter(r=>r.scenario===s.id&&r.policy===id),planningBase=pilot?.records?.filter(r=>r.scenario===s.id&&r.policy==='baseline');
        const planning=planningRows?.length?planningRows:rows,planningDiff=planning.map((r,i)=>({...r,delta:r.netBB-(planningBase||baseline)[i].netBB}));
        const absolutePlan=stats.planPower({sdBB100:sdBalanced(planning,'netBB'),alpha:alpha/2,nullBB100:0,alternativeBB100:3}),relativePlan=id==='baseline'?null:stats.planPower({sdBB100:sdBalanced(planningDiff,'delta'),alpha:alpha/2,nullBB100:1,alternativeBB100:3});
        const predictive=protocol.handsPerBlock===100?stats.predictiveInterval(blocks,{lower:-5000,upper:5000,alpha:.1}):{lower:null,upper:null,status:'NOT_100_HAND_BLOCKS'};
        return {id,version:id==='baseline'?protocol.baselineVersion:protocol.candidateVersion,meanBB100,meanCI,deltaBB100:id==='baseline'?null:100*stats.mean(paired.map(r=>r.delta)),deltaCI,
          referenceCapitalPercent:100*meanBB100/protocol.referenceCapitalBB,referenceCapitalPercentCI:scaleCI(meanCI,100/protocol.referenceCapitalBB),
          pPositive:protocol.handsPerBlock===100?positives/blocks.length:null,pPositiveCI:protocol.handsPerBlock===100?stats.probabilityCI(positives,blocks.length,pAlpha):null,pZero:protocol.handsPerBlock===100?zeros/blocks.length:null,pNegative:protocol.handsPerBlock===100?(blocks.length-positives-zeros)/blocks.length:null,
          probabilityMonteCarloSE:protocol.handsPerBlock===100&&positives>0&&positives<blocks.length?Math.sqrt((positives/blocks.length)*(1-positives/blocks.length)/blocks.length):null,probabilityMonteCarloSEMethod:'PLUGIN_BINOMIAL_DESCRIPTIVE; UNAVAILABLE_AT_BOUNDARY; USE_EXACT_CI_FOR_UNCERTAINTY',
          quantiles100:protocol.handsPerBlock===100?{p05:stats.quantile(blocks,.05),p50:stats.quantile(blocks,.5),p95:stats.quantile(blocks,.95),kind:'DESCRIPTIVE_NOT_CONFIDENCE_OR_PREDICTION_INTERVAL'}:null,predictive100:predictive,
          coverage:coverage(rows),maxDrawdownBB:maxDrawdown(rows),totalRakeChips:rows.reduce((a,r)=>a+r.rakeChips,0),fundingLedger:{externalTopupChips:rows.reduce((a,r)=>a+r.funding.externalTopupChips,0),externalWithdrawalChips:rows.reduce((a,r)=>a+r.funding.externalWithdrawalChips,0),initialStackChips:100,interpretation:'External withdrawals minus topups equals net profit; deposits are not profit. No finite bankroll stopping.'},
          powerPlan:{source:pilot?'INDEPENDENT_PILOT':'CURRENT_STAGE_DESCRIPTIVE_ONLY',absolute:absolutePlan,relative:relativePlan,availableIndependentBlocks:protocol.blocks},
          claim:protocol.stage==='holdout'&&id==='candidate'&&meanCI.lower>0&&deltaCI.lower>1?'SUPPORTED_IN_SYNTHETIC_ENVIRONMENT_ONLY':'INCONCLUSIVE'};})};}),limitations:protocol.limitations};
}
async function run(){
  if(fs.existsSync(path.join(out,'WITHDRAWN-BEFORE-OUTCOMES.md')))throw Error('Withdrawn protocol cannot execute. Preserve it and prepare a new protocol.');
  const raw=fs.readFileSync(protocolPath,'utf8'),protocol=JSON.parse(raw),protocolHash=hash(raw);
  if(fs.readFileSync(path.join(out,'protocol.sha256'),'utf8').trim()!==protocolHash)throw Error('Protocol hash mismatch.');
  if(JSON.stringify(sourceHashes(protocol.candidateRoot))!==JSON.stringify(protocol.candidateHashes)||JSON.stringify(sourceHashes(protocol.baselineRoot))!==JSON.stringify(protocol.baselineHashes)||hash(fs.readFileSync(__filename))!==protocol.candidateHashes['scripts/evaluate-analyze.cjs'])throw Error('Frozen source/runner hashes changed. Prepare a NEW protocol before outcomes; preserve old protocol.');
  if(protocol.pilotSummary&&hash(fs.readFileSync(protocol.pilotSummary))!==protocol.pilotSummaryHash)throw Error('Pilot summary changed.');
  if(protocol.pilotSummary&&hash(fs.readFileSync(path.join(path.dirname(protocol.pilotSummary),'hands.jsonl')))!==protocol.pilotLedgerHash)throw Error('Pilot ledger changed.');
  for(const name of ['started.json','hands.jsonl','summary.json'])if(fs.existsSync(path.join(out,name)))throw Error('Trial already started: no repeat/overwrite.');
  fs.writeFileSync(path.join(out,'started.json'),JSON.stringify({startedAt:new Date().toISOString(),protocolHash,node:process.version},null,2),{flag:'wx'});
  const started=Date.now(),records=[],baselineDecide=require(path.join(protocol.baselineRoot,'src/decision-engine')).decide;
  const frozenPlayHand=require(path.join(protocol.candidateRoot,'src/analyze-experiment-env')).playHand;
  const frozenAdapter=require(path.join(protocol.candidateRoot,'src/analyze-policy'));
  stats=require(path.join(protocol.candidateRoot,'src/economic-statistics'));
  let ledgerFD=fs.openSync(path.join(out,'hands.jsonl'),'wx');
  try{
    for(const scenario of protocol.scenarios)for(let block=0;block<protocol.blocks;block++){
      for(let hand=0;hand<protocol.handsPerBlock;hand++)for(const policy of protocol.policies){
        if(Date.now()-started>protocol.resourceBudget.maxWallMinutes*60000)throw Error('Preregistered resource limit exceeded. Partial evidence preserved; no completed estimates.');
        const seed=`${protocol.seedNamespace}:${scenario.id}:${block}:${hand}`,heroSeat=hand%2;
        const result=await frozenPlayHand({seed,heroSeat,opponentFamily:scenario.opponentFamily,rakeSchedule:scenario.rakeSchedule,policy:(obs,decision)=>{
          const settings={...protocol.settings,assumeNoRake:!scenario.rakeSchedule,equitySeed:parseInt(hash(`analysis:${protocol.seedNamespace}:${scenario.id}:${block}:${hand}:${decision}`).slice(0,8),16),selectionInference:policy==='candidate_marginal'?'MARGINAL':'SHARED_EQUITY_PAIRED'};
          let input=frozenAdapter.buildAnalyzeInput(obs,settings);
          if(policy==='baseline'){delete input.rakeSchedule;input.rake=0;input.assumeNoRake=true;delete input.selectionInference;delete input.practicalEquivalenceBB;}
          return frozenAdapter.decideAnalyzePolicy(input,{decideFn:policy==='baseline'?baselineDecide:undefined,selection:policy==='candidate_point'?'POINT_LEADER':'SUPPORTED',fallback:protocol.settings.fallback,deadlineMs:protocol.settings.deadlineMs});
        }});
        const record={scenario:scenario.id,block,hand,policy,...result};records.push(record);fs.writeSync(ledgerFD,JSON.stringify(record)+'\n');
      }
      console.log(JSON.stringify({scenario:scenario.id,completedBlocks:block+1,totalBlocks:protocol.blocks,elapsedSeconds:Math.round((Date.now()-started)/1000)}));
    }
    fs.closeSync(ledgerFD);ledgerFD=null;
    let pilot=null;if(protocol.pilotSummary){const dir=path.dirname(protocol.pilotSummary);pilot={records:fs.readFileSync(path.join(dir,'hands.jsonl'),'utf8').trim().split('\n').map(JSON.parse)};}
    const summary=summarize(protocol,records,protocolHash,pilot);summary.elapsedSeconds=(Date.now()-started)/1000;fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});fs.writeFileSync(path.join(out,'completed.json'),JSON.stringify({at:new Date().toISOString(),hands:records.length,protocolHash,summaryHash:hash(fs.readFileSync(path.join(out,'summary.json'))),ledgerHash:hash(fs.readFileSync(path.join(out,'hands.jsonl')))},null,2),{flag:'wx'});
    console.log(JSON.stringify({complete:true,hands:records.length,elapsedSeconds:summary.elapsedSeconds}));
  }catch(error){if(ledgerFD!==null)fs.closeSync(ledgerFD);fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({at:new Date().toISOString(),error:error.stack,completedHands:records.length,status:'INCOMPLETE_NOT_ECONOMIC_APPROVAL'},null,2),{flag:'wx'});throw error;}
}
if(require.main===module){Promise.resolve().then(()=>argv.includes('--prepare')?prepare():argv.includes('--run')?run():console.log('Use --prepare --stage development|pilot|holdout --out DIR --baseline DIR, then --run --out DIR.')).catch(e=>{console.error(e.stack);process.exitCode=1;});}
module.exports={seatCI,coverage,summarize,sourceHashes};
