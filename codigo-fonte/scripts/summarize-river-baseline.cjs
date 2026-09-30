'use strict';
// Aggregates recorded observations only; does not manufacture missing timings.
const fs=require('node:fs');
const file=process.argv[2];
if(!file)throw Error('Usage: node scripts/summarize-river-baseline.cjs report.json');
const report=JSON.parse(fs.readFileSync(file,'utf8'));
const finite=Number.isFinite;
function distribution(values){values=values.filter(finite).sort((a,b)=>a-b);const at=p=>values.length?values[Math.max(0,Math.ceil(p*values.length)-1)]:null;return {n:values.length,p50:at(.5),p95:at(.95),max:values.at(-1)??null};}
const summary={environment:report.environment,status:report.status,startedAt:report.startedAt,completedAt:report.completedAt,
  baselineComparison:report.baselineCommit,percentileMethod:'nearest rank; 5 samples per scenario; descriptive, not a load-test SLA',
  checks:report.checks.reduce((out,item)=>(out[item.outcome]=(out[item.outcome]||0)+1,out),{}),scenarios:[]};
for(const scenario of report.scenarios){
  const cold=scenario.variants.filter(item=>item.fast.cacheHit===false),warm=scenario.variants.map(item=>item.warm).filter(Boolean);
  const final=item=>item.standard||item.fast;
  summary.scenarios.push({id:scenario.id,coldMisses:cold.length,unexpectedInitialHits:scenario.variants.length-cold.length,warmHits:warm.filter(item=>item.cacheHit).length,
    // Fast acknowledgement is the first HTTP response. The first strategy can arrive later.
    firstHttpResponseMs:distribution(cold.map(item=>item.fast.ackWallMs)),
    firstObservedStrategyMs:distribution(cold.map(item=>item.fast.firstObservedMs)),
    serverFirstStrategyMs:distribution(cold.map(item=>item.fast.serverFirstValueMs)),
    certifiedResolutionObservedMs:distribution(cold.map(item=>item.fast.elapsedMs+(item.standard?.elapsedMs||0))),
    serverFastCompletionMs:distribution(cold.map(item=>item.fast.serverCompletionMs)),
    serverResolutionMs:distribution(cold.map(item=>finite(item.fast.serverCompletionMs)&&(!item.standard||finite(item.standard.serverCompletionMs))?item.fast.serverCompletionMs+(item.standard?.serverCompletionMs||0):null)),
    cumulativeDecisionComputeMs:distribution(cold.map(item=>final(item).decisionComputeMs)),
    actionBoundsComputeMs:distribution(cold.map(item=>final(item).result?.resourceUse?.costs?.actionSolveMs)),
    globalSolveComputeMs:distribution(cold.map(item=>final(item).result?.resourceUse?.costs?.globalSolveMs)),
    warmHttpMs:distribution(warm.filter(item=>item.cacheHit).map(item=>item.elapsedMs)),
    warmWorkerMs:distribution(warm.filter(item=>item.cacheHit).map(item=>item.workerMs)),
    heapUsedBytes:distribution(cold.map(item=>final(item).result?.resourceUse?.heapUsedBytes)),
    nashConv:distribution(cold.map(item=>final(item).result?.convergence?.nashConv)),
    statuses:[...new Set(cold.map(item=>final(item).result?.status))],
    comparisonStatuses:[...new Set(cold.map(item=>final(item).result?.comparison?.status))]});
}
summary.invalidation={total:report.invalidation.length,misses:report.invalidation.filter(item=>item.cacheHit===false).length};
summary.cancellation=report.cancellation;
console.log(JSON.stringify(summary,null,2));
