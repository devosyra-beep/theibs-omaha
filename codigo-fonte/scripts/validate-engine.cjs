'use strict';
// Independent oracle: deliberately does not import evaluator helpers or cards.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {evaluateFive,evaluateOmaha}=require('../src/evaluator');
const {exactEquity,monteCarloEquity,Lcg}=require('../src/equity-engine');
const {createSession,applyAction,publicSession}=require('../src/training-simulator');
const {lowerBound}=require('./lib/binomial-coverage.cjs');
const deck=[...'23456789TJQKA'].flatMap(r=>[...'cdhs'].map(s=>r+s));
function oracle5(cards){
 const hist=Array(15).fill(0);for(const c of cards)hist['23456789TJQKA'.indexOf(c[0])+2]++;
 const ranks=[];for(let r=14;r>=2;r--)if(hist[r])ranks.push(r);
 const sameSuit=cards.map(c=>c[1]).every(s=>s===cards[0][1]);
 let run=0;for(let high=14;high>=5;high--){if(Array.from({length:5},(_,i)=>high-i===1?14:high-i).every(r=>hist[r])){run=high;break;}}
 const quads=ranks.filter(r=>hist[r]===4),trips=ranks.filter(r=>hist[r]===3),pairs=ranks.filter(r=>hist[r]===2),single=ranks.filter(r=>hist[r]===1);
 if(sameSuit&&run)return [8,run];if(quads.length)return [7,...quads,...single];if(trips.length&&pairs.length)return [6,...trips,...pairs];
 if(sameSuit)return [5,...ranks];if(run)return [4,run];if(trips.length)return [3,...trips,...single];if(pairs.length===2)return [2,...pairs,...single];if(pairs.length)return [1,...pairs,...single];return [0,...ranks];
}
const code=score=>score.reduce((a,n)=>a*15+n,0)*15**(6-score.length);
function oracleOmaha(h,b){let best=null;for(let a=0;a<h.length;a++)for(let c=a+1;c<h.length;c++)for(let x=0;x<3;x++)for(let y=x+1;y<4;y++)for(let z=y+1;z<5;z++){const s=oracle5([h[a],h[c],b[x],b[y],b[z]]);if(!best||code(s)>code(best))best=s;}return best;}
function deal(rng){const d=[...deck];for(let i=51;i>0;i--){const j=Math.floor(rng.next()*(i+1));[d[i],d[j]]=[d[j],d[i]];}return d;}
const report={version:require('../package.json').version,startedAt:new Date().toISOString(),checks:[],status:'RUNNING',limitations:['Numeric correctness is separate from strategic quality.','No solver/GTO benchmark or real-player range calibration is included.','The independent oracle is separately implemented here, not an external certified library.']};
const outputArg=process.argv.indexOf('--output');
const output=outputArg>=0?path.resolve(process.argv[outputArg+1]):path.resolve(__dirname,`../../validacao/engine-method-report-${new Date().toISOString().replace(/[:.]/g,'-')}.json`),begin=Date.now();
if(fs.existsSync(output))throw Error('Refusing to overwrite prior validation evidence: '+output);
report.evidence='LOCAL_EXECUTED';report.node=process.version;
try{
 const rng=new Lcg(927531);
 for(let i=0;i<10000;i++){const h=deal(rng).slice(0,5);assert.deepEqual(evaluateFive(h).score,oracle5(h));}
 report.checks.push({name:'Independent five-card oracle',cases:10000,status:'PASS'});console.log('PASS 10,000 independent five-card comparisons');
 for(const count of [4,5,6])for(let i=0;i<300;i++){
  const d=deal(rng),hero=d.slice(0,count),board=d.slice(count,count+5),expected=oracleOmaha(hero,board);assert.deepEqual(evaluateOmaha(hero,board).score,expected);
  assert.deepEqual(evaluateOmaha([...hero].reverse(),[...board].reverse()).score,expected);
  const rotate=c=>c[0]+'dhsc'['cdhs'.indexOf(c[1])];assert.deepEqual(evaluateOmaha(hero.map(rotate),board.map(rotate)).score,expected);
 }
 report.checks.push({name:'Omaha 4/5/6 oracle plus order and suit invariance',cases:900,assertions:2700,status:'PASS'});console.log('PASS 900 Omaha comparisons and invariants');
 const hist={},variants={};
 for(const n of [4,5,6])for(const style of ['PASSIVE','MIXED','AGGRESSIVE'])for(let seed=101;seed<=200;seed++){
  const s=createSession({variant:`PLO${n}_HIGH`,opponentStyle:style,seed});let steps=0;
  while(!s.finished&&steps++<60){const p=publicSession(s),can=p.legalActions,raise=can.find(a=>a==='RAISE'||a==='BET');const action=raise&&steps%3!==0?raise:can.includes('CALL')?'CALL':'CHECK';applyAction(s,action,action===raise?p.maxSize:undefined);assert.ok(Math.abs(s.heroStack+s.villainStack+s.pot-200)<1e-8);assert.ok(s.heroStack>=0&&s.villainStack>=0);}
  assert.ok(s.finished);variants[n]=(variants[n]||0)+1;for(const e of s.history.filter(e=>e.actor==='OPPONENT'))hist[e.action]=(hist[e.action]||0)+1;
 }
 for(const a of ['BET','CHECK','CALL','RAISE','FOLD'])assert.ok(hist[a]>0);
 report.checks.push({name:'Complete simulated hands / chip conservation',cases:900,variants,opponentActions:hist,status:'PASS'});console.log('PASS 900 complete training hands');
 const errors=[],calibration=[];let covered=0;
 for(const n of [4,5,6])for(let i=0;i<30;i++){
  const d=deal(rng),heroCards=d.slice(0,n),opponent=d.slice(n,n*2),board=d.slice(n*2,n*2+4),base={variant:`PLO${n}_HIGH`,heroCards,board};
  const exact=exactEquity({...base,opponentHands:[opponent]}),mc=monteCarloEquity({...base,opponentRanges:[{hands:[opponent]}],samples:1000,seed:71933+i*131+n});
  const error=mc.equity-exact.equity;errors.push(error);const hit=mc.confidenceInterval95[0]<=exact.equity+1e-12&&mc.confidenceInterval95[1]>=exact.equity-1e-12;if(hit)covered++;
  calibration.push({variant:n,exact:exact.equity,estimate:mc.equity,error,covered:hit});
 }
 const bias=errors.reduce((a,b)=>a+b,0)/errors.length,rmse=Math.sqrt(errors.reduce((a,b)=>a+b*b,0)/errors.length),coverage=covered/errors.length;
 const coverageLower95=lowerBound(covered,errors.length,.05);
 assert.ok(Math.abs(bias)<.025);assert.ok(rmse<.035);assert.ok(coverageLower95>=.93);
 report.checks.push({name:'Monte Carlo vs exact turn enumeration (regression screen)',cases:90,samplesPerCase:1000,bias,rmse,coverage95:coverage,coverageLower95,thresholds:{absoluteBiasBelow:.025,rmseBelow:.035,minCoverageLower95:.93},scope:'One-sided binomial noninferiority screen with .02 coverage tolerance; stratified fixed/adaptive protocol is scripts/validate-equity-statistics.cjs.',status:'PASS',details:calibration});console.log(`PASS 90 exact/Monte Carlo comparisons; RMSE ${(rmse*100).toFixed(2)} pp; coverage ${(coverage*100).toFixed(1)}%`);
 if(process.argv.includes('--exhaustive-five')){
  const counts=Array(9).fill(0);let cases=0;
  for(let a=0;a<48;a++)for(let b=a+1;b<49;b++)for(let c=b+1;c<50;c++)for(let d=c+1;d<51;d++)for(let e=d+1;e<52;e++){const hand=[deck[a],deck[b],deck[c],deck[d],deck[e]];counts[evaluateFive(hand).categoryRank]++;cases++;}
  assert.deepEqual(counts,[1302540,1098240,123552,54912,10200,5108,3744,624,40]);assert.equal(cases,2598960);
  report.checks.push({name:'Exhaustive five-card category frequencies',cases,counts,status:'PASS'});console.log('PASS all 2,598,960 five-card combinations');
 }
 report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.stack;process.exitCode=1;console.error(error);}
finally{report.elapsedMs=Date.now()-begin;fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});console.log('Report:',output);}
