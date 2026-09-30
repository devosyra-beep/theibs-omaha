'use strict';
const {parentPort}=require('node:worker_threads');
const {createHash}=require('node:crypto');
const {buildPloRiverGame}=require('./plo-river-game');
const core=require('./extensive-solver');
const actionConditioned=require('./action-conditioned');
const {qualify,THRESHOLD_BB}=require('./solution-status');
const {solverDecisionPrecision}=require('../decision-precision');

const {ADAPTIVE_VERSION:VERSION}=require('./versions');
const LIMITS=Object.freeze({maxNodes:12000,maxInformationSets:12000,maxWorkingBytes:64*1024*1024,maxDepth:256});
const clone=value=>value==null?value:structuredClone(value);
const finite=Number.isFinite;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const workIterations=checkpoint=>Number.isSafeInteger(checkpoint?.workIterations)?checkpoint.workIterations:Number.isSafeInteger(checkpoint?.iterations)?checkpoint.iterations:0;
function emptyCosts(){return {buildMs:0,globalSolveMs:0,globalEvaluationMs:0,actionSolveMs:0,totalComputeMs:0};}
function validBounds(row){return row?.certified===true&&finite(row.lowerBB)&&finite(row.upperBB)&&row.lowerBB<=row.upperBB;}

// Extra certificate work only: the original game and strategy retain every action.
function focusActions(ids,rows){
  const found=new Map(rows.map(row=>[row.id,row])),certified=ids.map(id=>found.get(id)).filter(validBounds);
  const toleranceBB=16*Number.EPSILON*Math.max(1,...certified.flatMap(row=>[Math.abs(row.lowerBB),Math.abs(row.upperBB)]));
  const leader=certified.slice().sort((a,b)=>b.lowerBB-a.lowerBB||ids.indexOf(a.id)-ids.indexOf(b.id))[0];
  const dominatedActions=[],survivingActionIds=[];
  for(const id of ids){const row=found.get(id);
    if(leader&&id!==leader.id&&validBounds(row)&&row.upperBB+toleranceBB<leader.lowerBB)
      dominatedActions.push({id,dominatedBy:leader.id,upperBB:row.upperBB,leaderLowerBB:leader.lowerBB,toleranceBB});
    else survivingActionIds.push(id);
  }
  const allCertified=certified.length===ids.length;
  return {survivingActionIds,dominatedActions,allCertified,leaderActionId:leader?.id||null,toleranceBB,
    separated:ids.length>1&&allCertified&&survivingActionIds.length===1,
    policy:'CERTIFIED_DOMINATION_ONLY_GLOBAL_TREE_UNCHANGED'};
}
function chooseFocus(ids,rows,attempts={}){
  const focus=focusActions(ids,rows),found=new Map(rows.map(row=>[row.id,row]));
  const candidates=focus.survivingActionIds.map(id=>({id,row:found.get(id),attempts:attempts[id]||0}));
  // Optimistic compatible bounds prioritize contenders. A two-batch maximum
  // lead keeps a difficult/wide candidate from starving another contender.
  // Original-profile point EV and strategy frequency never exclude an action.
  const leastAttempts=Math.min(...candidates.map(candidate=>candidate.attempts));
  const eligible=candidates.filter(candidate=>candidate.attempts<=leastAttempts+1);
  eligible.sort((a,b)=>{
    const aKnown=validBounds(a.row),bKnown=validBounds(b.row);
    if(aKnown!==bKnown)return aKnown?1:-1;
    if(!aKnown)return a.attempts-b.attempts||ids.indexOf(a.id)-ids.indexOf(b.id);
    return b.row.upperBB-a.row.upperBB||(b.row.upperBB-b.row.lowerBB)-(a.row.upperBB-a.row.lowerBB)||a.attempts-b.attempts||ids.indexOf(a.id)-ids.indexOf(b.id);
  });
  return {focus,id:eligible[0]?.id||null};
}

function execute({input,budget,checkpoint,shouldCancel=()=>false,onProgress=()=>{}},dependencies={}){
  const engine=dependencies.core||core,certifier=dependencies.actionConditioned||actionConditioned;
  const build=dependencies.build||buildPloRiverGame,qualification=dependencies.qualify||qualify,now=dependencies.now||(()=>performance.now());
  const started=now(),runCosts=emptyCosts();let last=null,solved=null,diagnostics=null,stopReason=null;
  const built=build(input);runCosts.buildMs=now()-started;
  if(built.status!=='READY')return {result:{status:'NOT_SOLVED',reasons:built.reasons,actions:[],method:'CFR_PLUS',qualification:{gto:false},metrics:built.metrics},workerMs:now()-started,paused:shouldCancel()};
  const game=built.game,meta=game.meta,ids=meta.rootActions.map(action=>action.id);
  const baseContextKey=hash([meta.key,meta.heroInformationSet,engine.VERSION,certifier.VERSION]);
  const compatible=checkpoint?.version===VERSION&&checkpoint.baseContextKey===baseContextKey&&checkpoint.solverVersion===engine.VERSION&&checkpoint.certificateVersion===certifier.VERSION;
  let globalCheckpoint=compatible?checkpoint.global:checkpoint?.version===engine.VERSION?checkpoint:null;
  const actionCheckpoints=compatible?clone(checkpoint.actionCheckpoints||{}):{};
  const actionCertificates=compatible?clone(checkpoint.actionCertificates||{}):{};
  const actionCosts=compatible?clone(checkpoint.actionCosts||{}):{};
  const attempts=compatible?clone(checkpoint.attempts||{}):{};
  const cumulativeCosts=compatible?clone(checkpoint.costs||emptyCosts()):emptyCosts();
  const stabilityHistory=compatible?clone(checkpoint.stabilityHistory||[]):[];
  let previousDiagnostics=compatible?clone(checkpoint.lastDiagnostics):null;
  let totalWork=compatible?workIterations(checkpoint):workIterations(globalCheckpoint),initialWork=totalWork;
  let baseGameHash=compatible?checkpoint.baseGameHash:null,verifiedClass=compatible?checkpoint.supportedGameClass:null;
  const actionEligible=game.playerCount===2&&meta.originalSeats===2&&meta.constantSum===true&&meta.treeComplete===true&&meta.chanceSupportComplete===true;
  const utility={unit:'BB',basis:'INCREMENTAL_TERMINAL_PAYOFF_FROM_ORIGINAL_DECISION',scope:'FULL_PRIOR_EX_ANTE'};
  const sharedCertificate={version:certifier.VERSION,target:certifier.TARGET,origin:certifier.ORIGIN,solverVersion:engine.VERSION,
    player:meta.heroSeat,informationSet:meta.heroInformationSet,utility,fullPriorPreserved:true,originalHandActionEV:false};
  function certificateIdentity(row){return row?.version===certifier.VERSION&&row.target===certifier.TARGET&&row.origin===certifier.ORIGIN&&
    row.solverVersion===engine.VERSION&&row.player===meta.heroSeat&&row.informationSet===meta.heroInformationSet&&
    row.baseGameHash===baseGameHash&&row.fullPriorPreserved===true&&row.originalHandActionEV===false&&
    row.utility?.unit===utility.unit&&row.utility?.basis===utility.basis&&row.utility?.scope===utility.scope;}
  const remainingMs=()=>budget.timeMs-(now()-started),remainingIterations=()=>budget.iterations-(totalWork-initialWork);
  const ceilingReached=()=>remainingMs()<=0||remainingIterations()<=0;
  const globalMet=()=>solved?.convergence?.exact===true&&finite(solved.convergence.nashConv)&&solved.convergence.nashConv<=THRESHOLD_BB;
  const originalReady=()=>Boolean(solved?.strategy&&globalCheckpoint&&diagnostics&&
    Number.isSafeInteger(solved.iterations)&&solved.iterations>0&&globalCheckpoint.iterations===solved.iterations&&
    typeof baseGameHash==='string'&&solved.gameHash===baseGameHash);
  function compatibleCertificate(row){return certificateIdentity(row)&&row.baseContextKey===baseContextKey&&ids.includes(row.id);}
  function certificateRows(){return ids.map(id=>{
    const row=actionCertificates[id];
    return compatibleCertificate(row)?clone(row):{...sharedCertificate,id,estimateBB:null,lowerBB:null,upperBB:null,boundsBB:null,certified:false,
      baseGameHash,baseContextKey,origin:certifier.ORIGIN,solverVersion:engine.VERSION,version:certifier.VERSION,
      gameHash:null,conditionedHash:null,iterations:0,elapsedMs:0};
  });}
  function costs(){return Object.fromEntries(Object.keys(emptyCosts()).map(key=>[key,(cumulativeCosts[key]||0)+(runCosts[key]||0)]));}
  function saved(){return {version:VERSION,solverVersion:engine.VERSION,certificateVersion:certifier.VERSION,baseContextKey,baseGameHash,
    global:globalCheckpoint,actionCheckpoints:clone(actionCheckpoints),actionCertificates:clone(actionCertificates),actionCosts:clone(actionCosts),
    attempts:{...attempts},supportedGameClass:verifiedClass,iterations:globalCheckpoint?.iterations||0,workIterations:totalWork,
    costs:costs(),stabilityHistory:clone(stabilityHistory),lastDiagnostics:clone(previousDiagnostics)};}
  function render(refining){
    if(!solved?.strategy||!solved.checkpoint||!(solved.iterations>0))return null;
    const rows=certificateRows(),focus=focusActions(ids,rows),converged=globalMet();
    const precisionSupported=actionEligible&&verifiedClass==='TWO_PLAYER_CONSTANT_SUM_PERFECT_RECALL';
    const result={...qualification(meta,solved,{coverage:built.coverage}),source:'REFERENCE_SUBGAME_STRATEGY',method:solved.method,
      solverVersion:solved.solverVersion,gameHash:solved.gameHash,scope:'DECLARED_FINITE_RIVER_SUBGAME',strategyScope:'CURRENT_HAND_COMBINATION',
      actions:meta.rootActions.map(action=>{const value=diagnostics?.actions?.find(item=>item.id===action.id);return {...action,frequency:value?.frequency??null,evBB:value?.ev??null};}),
      convergence:{...solved.convergence,unit:'BB',thresholdBB:THRESHOLD_BB,thresholdMet:converged},iterations:solved.iterations,
      abstraction:meta,termination:solved.termination,
      actionPrecision:{...sharedCertificate,
        baseGameHash,baseContextKey,player:meta.heroSeat,informationSet:meta.heroInformationSet,
        supportedGameClass:precisionSupported,gameClass:precisionSupported?verifiedClass:null,status:precisionSupported?'SUPPORTED':actionEligible?'PENDING':'UNSUPPORTED',
        treeComplete:meta.treeComplete,chanceSupportComplete:meta.chanceSupportComplete,actions:rows,focus,
        scope:'EX_ANTE_VALUE_OF_ORIGINAL_PRIOR_WITH_PRIVATE_INFORMATION_SET_COMMITMENT',
        originalConditionalProfileEVUnchanged:true,originalStrategyTreeUnchanged:true},
      adaptation:{version:VERSION,phase:refining?'REFINING':stopReason==='FOREGROUND_PRIORITY_PAUSE'?'PAUSED':'STOPPED',stopReason:refining?null:stopReason,
        // Interrupting execution does not establish mathematical completion.
        // The service owns resume/cancel and cumulative resource ceilings.
        refinementRecommended:stopReason!=='FIXED_CONTINUATIONS_FULLY_EVALUATED'&&(!converged||actionEligible&&!focus.separated),
        resourceCeiling:{timeMs:budget.timeMs,iterations:budget.iterations},workIterations:totalWork,
        globalIterations:solved.iterations,actionIterations:Object.values(actionCheckpoints).reduce((sum,item)=>sum+(item?.iterations||0),0),
        sizingRefinement:{mode:'FIXED_DECLARED_TREE_ADAPTIVE_CERTIFICATES',scope:'DECLARED_LEGAL_CANDIDATES_ONLY',
          treeKey:meta.key,gameHash:baseGameHash,baseContextKey,allDeclaredActionsRetained:true,
          allLegalSizesRepresented:meta.fullLegalSizingCoverage===true,
          sizingActionIds:meta.rootActions.filter(action=>finite(action.size)).map(action=>action.id),
          selectionPolicy:'UNCERTIFIED_FIRST_THEN_OPTIMISTIC_BOUND_WITH_TWO_BATCH_FAIRNESS',
          candidates:ids.map(id=>({id,attempts:attempts[id]||0,
            state:focus.dominatedActions.some(row=>row.id===id)?'CERTIFIED_DOMINATED':
              validBounds(rows.find(row=>row.id===id))?'CERTIFIED_CONTENDER':attempts[id]?'AWAITING_CERTIFICATE':'NOT_EVALUATED'}))}},
      rootDiagnostics:diagnostics?{profileRegretBB:diagnostics.oneStepRegret??null,counterfactualOneStepRegret:diagnostics.counterfactualOneStepRegret??null,
        profileValue:diagnostics.profileValue??null,stability:diagnostics.stability||null,
        scope:'CONDITIONAL_RETURNED_PROFILE_DIAGNOSTICS_NOT_CONVERGENCE_PROOF'}:null,
      stability:diagnostics?.stability?{...diagnostics.stability,maxActionEVChangeBB:diagnostics.stability.maxActionEVChange??null}:null,
      metrics:{...built.metrics,...solved.metrics,workerMs:now()-started,heapUsedBytes:process.memoryUsage().heapUsed,cacheHit:false,
        costs:costs(),runCosts:{...runCosts},actionCosts:clone(actionCosts),stabilityCheckpoints:clone(stabilityHistory)},
      limitations:[...meta.limitations,'CFR+ has no general multiplayer Nash-convergence guarantee. Exact unilateral-deviation evaluation measures the returned profile.',
        'Action certificate intervals concern the ex-ante value of the original game with one private-information-set commitment, not the EV of that hand in the original equilibrium.',
        'Global strategy frequencies and conditional profile EV are kept separate from commitment-value certificates.',
        'Independent linear-programming checks cover selected small heads-up PLO5 river test cases. LP is not run for each request. This release does not label poker results GTO.']};
    result.decisionPrecision=solverDecisionPrecision(result);
    return result;
  }
  function publish(){runCosts.totalComputeMs=now()-started;const result=render(true);if(result){last=result;onProgress({type:'progress',result,checkpoint:saved(),workerMs:now()-started});}}
  function globalBatch(){
    const start=now(),before=globalCheckpoint?.iterations||0;
    const next=engine.solve(game,{...LIMITS,checkpoint:globalCheckpoint,iterations:Math.min(50,Math.max(0,remainingIterations())),
      timeBudgetMs:Math.max(0,Math.min(last?220:160,remainingMs())),targetNashConv:THRESHOLD_BB,checkEvery:10,shouldCancel});
    runCosts.globalSolveMs+=now()-start;
    if(!next?.strategy||!next.checkpoint)return false;
    if(shouldCancel())return false;
    const readStarted=now();
    const nextDiagnostics=engine.rootDiagnostics?engine.rootDiagnostics(game,next.strategy,meta.heroSeat,meta.heroInformationSet,{...LIMITS,previous:previousDiagnostics}):
      engine.actionValues(game,next.strategy,meta.heroSeat,meta.heroInformationSet,LIMITS);
    runCosts.globalEvaluationMs+=now()-readStarted;
    // Commit the strategy, checkpoint and diagnostics atomically. A foreground
    // interruption must never pair a newer strategy with an older EV table.
    if(shouldCancel())return false;
    solved=next;globalCheckpoint=next.checkpoint;baseGameHash=next.gameHash;diagnostics=nextDiagnostics;
    totalWork+=Math.max(0,(next.iterations||0)-before);
    if(diagnostics){
      stabilityHistory.push({iterations:solved.iterations,workIterations:totalWork,nashConv:solved.convergence?.exact?solved.convergence.nashConv:null,
        oneStepRegret:diagnostics.oneStepRegret??null,stability:diagnostics.stability||null});
      while(stabilityHistory.length>12)stabilityHistory.shift();previousDiagnostics=clone(diagnostics);
    }
    publish();return next.additionalIterations>0;
  }
  function actionBatch(){
    const selected=chooseFocus(ids,certificateRows(),attempts).id;if(!selected)return false;
    const start=now(),before=actionCheckpoints[selected]?.iterations||0;
    attempts[selected]=(attempts[selected]||0)+1;
    const response=certifier.solveActionConditioned(game,{...LIMITS,player:meta.heroSeat,informationSet:meta.heroInformationSet,actionIds:[selected],
      checkpoints:actionCheckpoints,iterations:Math.min(50,Math.max(0,remainingIterations())),timeBudgetMs:Math.max(0,Math.min(250,remainingMs())),shouldCancel});
    const elapsed=now()-start;runCosts.actionSolveMs+=elapsed;
    actionCosts[selected]??={elapsedMs:0,iterations:0,batches:0};actionCosts[selected].elapsedMs+=elapsed;actionCosts[selected].batches++;
    if(!response.baseGameHash&&['CANCELLED','TIME_BUDGET'].includes(response.termination))return false;
    if(response.baseGameHash!==baseGameHash||response.player!==meta.heroSeat||response.informationSet!==meta.heroInformationSet||response.version!==certifier.VERSION)
      throw Error('The action-certificate context does not match the original game.');
    if(response.supportedGameClass==='TWO_PLAYER_CONSTANT_SUM_PERFECT_RECALL')verifiedClass=response.supportedGameClass;
    const row=response.actions?.find(item=>item.id===selected);if(!row)return false;
    if(row.checkpoint){actionCheckpoints[selected]=row.checkpoint;const advanced=Math.max(0,(row.checkpoint.iterations||0)-before);totalWork+=advanced;actionCosts[selected].iterations+=advanced;}
    const old=actionCertificates[selected];
    if(row.certified===true){
      if(!certificateIdentity(row)||typeof row.gameHash!=='string'||!validBounds(row))throw Error('Invalid action certificate.');
      const {checkpoint:privateCheckpoint,...publicRow}=row;
      const canIntersect=compatibleCertificate(old)&&old.gameHash===row.gameHash&&validBounds(old);
      const lowerBB=canIntersect?Math.max(old.lowerBB,row.lowerBB):row.lowerBB;
      const upperBB=canIntersect?Math.min(old.upperBB,row.upperBB):row.upperBB;
      if(lowerBB>upperBB)throw Error('Compatible saddle certificates have disjoint intervals.');
      actionCertificates[selected]={...publicRow,baseGameHash,baseContextKey,conditionedHash:row.gameHash,
        lowerBB,upperBB,boundsBB:[lowerBB,upperBB],elapsedMs:actionCosts[selected].elapsedMs,
        estimateBB:lowerBB/2+upperBB/2,widthBB:upperBB-lowerBB,
        estimateMethod:'SADDLE_INTERVAL_MIDPOINT',
        intervalMethod:canIntersect?'INTERSECTION_OF_COMPATIBLE_SADDLE_CERTIFICATES':'OUTWARD_ROUNDED_SADDLE_CERTIFICATE'};
    }else if(!validBounds(old)){
      const {checkpoint:privateCheckpoint,...publicRow}=row;
      actionCertificates[selected]={...publicRow,id:selected,version:certifier.VERSION,baseGameHash,baseContextKey,origin:certifier.ORIGIN,
        solverVersion:engine.VERSION,conditionedHash:row.gameHash||null,lowerBB:null,upperBB:null,boundsBB:null,certified:false,elapsedMs:actionCosts[selected].elapsedMs};
    }
    publish();return (row.additionalIterations||0)>0||row.certified===true;
  }
  globalBatch();
  while(!shouldCancel()&&!ceilingReached()){
    const focused=focusActions(ids,certificateRows());
    if(globalMet()&&(!actionEligible||focused.separated)){stopReason=actionEligible?'GLOBAL_CONVERGENCE_AND_CERTIFIED_SEPARATION':'GLOBAL_CONVERGENCE_ACTION_CERTIFICATES_NOT_COVERED';break;}
    if(globalMet()&&actionEligible&&focused.allCertified&&focused.survivingActionIds.every(id=>actionCertificates[id]?.strategicDecisionCount===0)){
      // These entire conditioned games contain only chance and forced actions.
      // More CFR iterations cannot improve their already evaluated profiles;
      // overlapping rounding bounds still leave the comparison inconclusive.
      stopReason='FIXED_CONTINUATIONS_FULLY_EVALUATED';break;
    }
    if(remainingMs()<8){stopReason='TIME_RESOURCE_CEILING';break;}
    let progressed=false;
    if(!globalMet())progressed=globalBatch()||progressed;
    // A time-limited global batch may return no complete strategy. Certificates
    // must wait for its coherent profile, diagnostics and game identity.
    if(!shouldCancel()&&!ceilingReached()&&actionEligible&&originalReady())progressed=actionBatch()||progressed;
    if(!progressed&&(!actionEligible||!originalReady())){stopReason='NO_COMPLETE_REFINEMENT_WITHIN_REMAINING_BUDGET';break;}
  }
  if(shouldCancel())stopReason='FOREGROUND_PRIORITY_PAUSE';
  else if(!stopReason)stopReason=remainingIterations()<=0?'ITERATION_RESOURCE_CEILING':'TIME_RESOURCE_CEILING';
  runCosts.totalComputeMs=now()-started;
  const final=render(false)||last||{status:'NOT_SOLVED',actions:[],qualification:{gto:false},reasons:[{code:'BUDGET_BEFORE_FIRST_STRATEGY',message:'Budget ended before a strategy could be evaluated.'}],
    adaptation:{version:VERSION,phase:shouldCancel()?'PAUSED':'STOPPED',stopReason,refinementRecommended:true,resourceCeiling:{timeMs:budget.timeMs,iterations:budget.iterations}}};
  return {result:final,checkpoint:saved(),workerMs:now()-started,paused:shouldCancel()};
}

if(parentPort)parentPort.on('message',({input,budget,checkpoint,cancel})=>{
  const flag=new Int32Array(cancel),started=performance.now();
  try{const finished=execute({input,budget,checkpoint,shouldCancel:()=>Atomics.load(flag,0)!==0,onProgress:message=>parentPort.postMessage(message)});parentPort.postMessage({type:'done',...finished});}
  catch(error){parentPort.postMessage({type:'error',error:error.message,workerMs:performance.now()-started});}
});
module.exports={VERSION,LIMITS,execute,focusActions,chooseFocus,workIterations};
