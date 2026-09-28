'use strict';
// --prepare freezes the protocol and implementation digests before --run.
// Separate invocations make changes after seeing results visible, never silent.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const {monteCarloEquity}=require('../src/equity-engine');
const oracle=require('./lib/numeric-oracle.cjs');
const {lowerBound,upperTail}=require('./lib/binomial-coverage.cjs');
const root=path.resolve(__dirname,'..'),arg=process.argv.indexOf('--out-dir');
const out=arg>=0?path.resolve(process.argv[arg+1]):path.resolve(root,'../validacao/execucao-2026-09-27/math');
const files=['src/equity-engine.js','src/joint-range-sampler.js','src/range-engine.js','src/fast-evaluator.js','src/evaluator.js','scripts/validate-equity-statistics.cjs','scripts/lib/numeric-oracle.cjs','scripts/lib/binomial-coverage.cjs'];
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const hashes=()=>Object.fromEntries(files.map(file=>[file,digest(fs.readFileSync(path.join(root,file)))]));
const protocolPath=path.join(out,'equity-statistics-protocol.json');
function seedFor(label){return crypto.createHash('sha256').update(label).digest().readUInt32LE(0);}
function shuffled(label){
  const deck=oracle.deck.slice();let counter=0;
  for(let i=deck.length-1;i>0;i--){const random=seedFor(`${label}/${counter++}`)/2**32,j=Math.floor(random*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  return deck;
}
function makeFixture(n,opponents,street) {
  const deck=shuffled(`THEIBS_STATS_V1/fixture/${n}/${opponents}/${street}`),heroCards=deck.splice(0,n),board=deck.splice(0,street);
  const opponentRanges=Array.from({length:opponents},(_,index)=>({hands:[deck.splice(0,n),deck.splice(0,n)],weights:index?[.4,.6]:[.7,.3]}));
  if(opponents>1)opponentRanges[1].hands[1][0]=opponentRanges[0].hands[0][0];
  return {variant:`PLO${n}_HIGH`,heroCards,board,opponentRanges};
}
if(process.argv.includes('--prepare')) {
  fs.mkdirSync(out,{recursive:true});
  const protocol={id:'THEIBS_EQUITY_STATISTICS_V2_CONFIRMATION',preparedAt:new Date().toISOString(),evidence:'LOCAL_EXECUTED',
    independentOracle:'Separate internal raw-card implementation; no external evaluator or solver certification.',
    codeHashes:hashes(),node:process.version,
    strata:[4,5,6].flatMap(n=>[1,2].flatMap(opponents=>['FIXED','ADAPTIVE'].map(mode=>({variant:n,opponents,mode})))),
    trialsPerStratum:600,streetCycle:[3,4,5],fixtureAllocation:'INDEPENDENT_SHA256_UNIFORM_OVER_THREE_FIXED_FIXTURES',fixedSamples:1000,adaptiveBudget:{maxSamples:12288,timeBudgetMs:2000},
    adaptiveThresholdCycle:[.02,.5,.98],seedNamespace:'THEIBS_STATS_V2/confirmation-unseen',
    gates:{familyAlpha:.025,coverageNoninferiorityMargin:.02,minimumCoverageLowerBound:.93,absoluteBiasMax:.012,rmseMax:.035},
    amendment:'V1 is a pilot, preserved with original FAIL gate: two 99/100 cells had lower bound .9261, below .93; insufficient precision is INCONCLUSIVE about undercoverage, not proof of a motor defect. No engine, fixture, error tolerance or coverage floor changed to obtain approval. This sole independent confirmation increases trial count, changes seeds, randomizes allocation among the same three fixtures for binomial mixture inference, and tightens alpha. For any combined two-attempt coverage claim allocate .025 per attempt (.05 total); V1 also fails under this stricter allocation. No further reattempt is authorized by this protocol.',
    justification:'Nominal coverage .95; tolerate at most .02 absolute degradation for this regression screen, using Bonferroni one-sided exact binomial bounds across 12 strata and two attempts. Engineering gates remain fixed. Power is reported at .95 and .99 coverage before execution; this is a finite-fixture regression screen, not universal calibration or profitability validation.',
    limitations:['Trials draw uniformly among three fixed scenarios per stratum; coverage pertains to that declared scenario mixture.','PRNG seeds are deterministic SHA256-derived probes, not a proof of IID randomness.','Adaptive coverage uses a capped 12288-sample policy; separate default-budget probes cover stopping reasons, not population coverage.','No preflop exact oracle or real-player range/strategy quality is certified.']};
  const alpha=protocol.gates.familyAlpha/protocol.strata.length,n=protocol.trialsPerStratum;
  let minimumSuccesses=n+1;for(let hits=1;hits<=n;hits++)if(lowerBound(hits,n,alpha)>=protocol.gates.minimumCoverageLowerBound){minimumSuccesses=hits;break;}
  protocol.coveragePower={minimumSuccesses,trials:n,atNominal95:minimumSuccesses<=n?upperTail(minimumSuccesses,n,.95):0,atConservative99:minimumSuccesses<=n?upperTail(minimumSuccesses,n,.99):0,scope:'Binomial planning approximation; fixed fixture mixture and deterministic PRNG assumptions remain explicit.'};
  fs.writeFileSync(protocolPath,JSON.stringify(protocol,null,2),{flag:'wx'});console.log('Protocol frozen:',protocolPath);console.log('Coverage power:',JSON.stringify(protocol.coveragePower));process.exit(0);
}
if(!process.argv.includes('--run'))throw Error('Use --prepare, then --run.');
const protocol=JSON.parse(fs.readFileSync(protocolPath,'utf8'));
if(JSON.stringify(protocol.codeHashes)!==JSON.stringify(hashes()))throw Error('Code changed after protocol freeze. Preserve this protocol and prepare a new output directory.');
const started=performance.now(),report={protocolId:protocol.id,protocolHash:digest(fs.readFileSync(protocolPath)),startedAt:new Date().toISOString(),version:require('../package.json').version,node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model,codeHashes:hashes(),evidence:'LOCAL_EXECUTED',status:'RUNNING',strata:[],defaultBudgetProbes:[],limitations:protocol.limitations};
const output=path.join(out,`equity-statistics-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
try {
  const fixtures=new Map();
  for(const {variant:n,opponents} of protocol.strata){
    const key=`${n}/${opponents}`;if(fixtures.has(key))continue;
    fixtures.set(key,protocol.streetCycle.map(street=>{const input=makeFixture(n,opponents,street);return {input,oracle:oracle.weightedEquity(input)};}));
  }
  for(const stratum of protocol.strata){
    const cases=fixtures.get(`${stratum.variant}/${stratum.opponents}`),trials=[];
    for(let i=0;i<protocol.trialsPerStratum;i++){
      const fixtureIndex=Math.floor(seedFor(`${protocol.seedNamespace}/allocation/${stratum.variant}/${stratum.opponents}/${stratum.mode}/${i}`)/2**32*cases.length);
      const fixture=cases[fixtureIndex],threshold=protocol.adaptiveThresholdCycle[fixtureIndex];
      const seed=seedFor(`${protocol.seedNamespace}/${stratum.variant}/${stratum.opponents}/${stratum.mode}/${i}`);
      const result=monteCarloEquity({...fixture.input,samples:protocol.fixedSamples,samplingMode:stratum.mode,adaptiveBudget:protocol.adaptiveBudget,seed,amountToCall:1,potBeforeAction:1/threshold-1,assumeNoRake:true});
      const [low,high]=result.confidenceInterval95,error=result.equity-fixture.oracle.equity;
      trials.push({seed,street:fixture.input.board.length,truth:fixture.oracle.equity,estimate:result.equity,error,interval:[low,high],width:high-low,covered:low<=fixture.oracle.equity+1e-12&&high>=fixture.oracle.equity-1e-12,samples:result.samples,stopReason:result.stopReason??'FIXED_N',elapsedMs:result.elapsedMs});
    }
    const count=trials.length,hits=trials.filter(t=>t.covered).length,bias=trials.reduce((s,t)=>s+t.error,0)/count,rmse=Math.sqrt(trials.reduce((s,t)=>s+t.error*t.error,0)/count),lower=lowerBound(hits,count,protocol.gates.familyAlpha/protocol.strata.length);
    const sorted=trials.map(t=>Math.abs(t.error)).sort((a,b)=>a-b),widths=trials.map(t=>t.width).sort((a,b)=>a-b);
    const gates={coverage:lower>=protocol.gates.minimumCoverageLowerBound,bias:Math.abs(bias)<=protocol.gates.absoluteBiasMax,rmse:rmse<=protocol.gates.rmseMax};
    const result={...stratum,status:Object.values(gates).every(Boolean)?'PASS':'FAIL',gates,trials:count,coverage:hits/count,coverageLowerSimultaneous95:lower,bias,rmse,errorP95:sorted[Math.ceil(.95*count)-1],errorP99:sorted[Math.ceil(.99*count)-1],meanWidth:widths.reduce((s,w)=>s+w,0)/count,widthP95:widths[Math.ceil(.95*count)-1],stopReasons:trials.reduce((a,t)=>(a[t.stopReason]=(a[t.stopReason]||0)+1,a),{}),fixtures:cases,details:trials};
    report.strata.push(result);console.log(`${result.status} PLO${stratum.variant}/${stratum.opponents} opponents/${stratum.mode}: coverage=${result.coverage}, lower=${lower.toFixed(4)}, RMSE=${rmse.toFixed(5)}`);
  }
  const deterministic={variant:'PLO4_HIGH',heroCards:['As','Ks','2c','3c'],board:['Qs','Js','Ts','8h','9d'],opponentRanges:[{hands:[['2h','3h','4c','5c']]}],samplingMode:'ADAPTIVE',seed:98345};
  for(const probe of [{name:'default_precision',input:deterministic,expected:'PRECISION'},{name:'wall_budget',input:{...deterministic,adaptiveBudget:{timeBudgetMs:1}},expected:'TIME_BUDGET'}]){
    const result=monteCarloEquity(probe.input);report.defaultBudgetProbes.push({name:probe.name,status:result.stopReason===probe.expected?'PASS':'FAIL',samples:result.samples,stopReason:result.stopReason,elapsedMs:result.elapsedMs,interval:result.confidenceInterval95});
  }
  report.status=[...report.strata,...report.defaultBudgetProbes].every(s=>s.status==='PASS')?'PASS':'FAIL';
  if(report.status!=='PASS')process.exitCode=1;
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;}
finally{report.elapsedMs=performance.now()-started;fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});console.log('Report:',output);}
