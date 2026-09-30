'use strict';
const {parentPort}=require('node:worker_threads');
const {buildPloRiverGame}=require('./plo-river-game');
const core=require('./extensive-solver');
const {qualify,THRESHOLD_BB}=require('./solution-status');
const {solverDecisionPrecision}=require('../decision-precision');
parentPort.on('message',({input,budget,checkpoint,cancel})=>{
  const started=performance.now(),flag=new Int32Array(cancel);let best=null,last=null;
  const cancelled=()=>Atomics.load(flag,0)!==0;
  try{
    const built=buildPloRiverGame(input);
    if(built.status!=='READY'){parentPort.postMessage({type:'done',result:{status:'NOT_SOLVED',reasons:built.reasons,actions:[],method:'CFR_PLUS',qualification:{gto:false},metrics:built.metrics},workerMs:performance.now()-started});return;}
    const game=built.game,firstIteration=checkpoint?.iterations||0;
    const limits={maxNodes:12000,maxInformationSets:12000,maxWorkingBytes:64*1024*1024,maxDepth:256};
    while(!cancelled()&&performance.now()-started<budget.timeMs&&(!checkpoint||checkpoint.iterations-firstIteration<budget.iterations)){
      const remaining=budget.timeMs-(performance.now()-started);
      if(remaining<30)break;
      const solved=core.solve(game,{...limits,checkpoint,iterations:Math.min(50,budget.iterations-((checkpoint?.iterations||0)-firstIteration)),timeBudgetMs:Math.min(300,remaining),targetNashConv:THRESHOLD_BB,checkEvery:10,shouldCancel:cancelled});
      if(!solved.strategy||!solved.checkpoint)break;
      checkpoint=solved.checkpoint;
      if(cancelled())break;
      const conditional=core.actionValues(game,solved.strategy,game.meta.heroSeat,game.meta.heroInformationSet,limits);
      const thresholdMet=solved.convergence.exact&&Number.isFinite(solved.convergence.nashConv)&&solved.convergence.nashConv<=THRESHOLD_BB;
      const result={...qualify(game.meta,solved,{coverage:built.coverage}),source:'REFERENCE_SUBGAME_STRATEGY',method:solved.method,
        solverVersion:solved.solverVersion,scope:'DECLARED_FINITE_RIVER_SUBGAME',strategyScope:'CURRENT_HAND_COMBINATION',
        actions:game.meta.rootActions.map(action=>{const value=conditional.actions.find(item=>item.id===action.id);return {...action,frequency:value?.frequency??null,evBB:value?.ev??null};}),
        convergence:{...solved.convergence,unit:'BB',thresholdBB:THRESHOLD_BB,thresholdMet},iterations:solved.iterations,
        abstraction:game.meta,termination:solved.termination,
        metrics:{...built.metrics,...solved.metrics,workerMs:performance.now()-started,heapUsedBytes:process.memoryUsage().heapUsed,cacheHit:false},
        limitations:[...game.meta.limitations,'CFR+ has no general multiplayer Nash-convergence guarantee. Exact unilateral-deviation evaluation measures this returned profile.',
          'Independent PLO reference validation is pending. This release never labels a poker result GTO.']};
      result.decisionPrecision=solverDecisionPrecision(result);
      last=result;
      if(solved.convergence.exact&&(!best||solved.convergence.nashConv<best.convergence.nashConv))best=result;
      parentPort.postMessage({type:'progress',result,checkpoint,workerMs:performance.now()-started});
      if(thresholdMet||solved.additionalIterations===0)break;
    }
    parentPort.postMessage({type:'done',paused:cancelled(),checkpoint,result:best||last||{status:'NOT_SOLVED',actions:[],qualification:{gto:false},reasons:[{code:'BUDGET_BEFORE_FIRST_STRATEGY',message:'Budget ended before a strategy could be evaluated.'}]},workerMs:performance.now()-started});
  }catch(error){parentPort.postMessage({type:'error',error:error.message});}
});
