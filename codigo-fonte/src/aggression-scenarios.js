'use strict';
const { calculateEquity } = require('./equity-engine');

// Explicit study model: fold/call independent of private cards, no re-raise,
// equal coverage of the proposed size. It is not a learned opponent policy.
function studySettings(input,rangeModel) {
  const raw=input.aggressionStudy;
  if(!raw?.enabled)return null;
  if(raw.assumptionsAccepted!==true)throw Error('Confirm the bet/raise scenario assumptions.');
  if(rangeModel.ranges.some(r=>r.kind!=='UNIFORM'))throw Error('The simple bet/raise scenario requires random hands for everyone. Specific continuation ranges need advanced scenarios.');
  const n=rangeModel.ranges.length,H=Number(raw.heroContribution),C=Number(input.amountToCall),P=Number(input.potBeforeAction);
  if(raw.heroContribution==null||raw.heroContribution===''||!Number.isFinite(H)||H<0)throw Error('Enter your current street contribution.');
  if(!Array.isArray(raw.opponents)||raw.opponents.length!==n)throw Error('Enter the contribution and call chance of each active opponent.');
  if(raw.opponents.some(o=>o.callProbability==null||o.callProbability===''||o.contribution==null||o.contribution===''))throw Error('Fill in the contribution and call chance for all active opponents.');
  const opponents=raw.opponents.map((o,i)=>({id:raw.source==='USER_SUPPLIED_HYPOTHESIS'?`seat-${o.seatId}`:`opponent-${i+1}`,contribution:Number(o.contribution),callProbability:Number(o.callProbability),stackRemaining:Number(input.effectiveStack)}));
  if(opponents.some(o=>!Number.isFinite(o.contribution)||o.contribution<0||o.contribution>H+C+1e-8||!Number.isFinite(o.callProbability)||o.callProbability<0||o.callProbability>1))throw Error('Contributions must be between zero and the current bet; call chances between 0% and 100%.');
  if(Math.abs(Math.max(H,...opponents.map(o=>o.contribution))-H-C)>1e-8)throw Error('The highest opponent contribution must equal your contribution plus the amount to call.');
  if(H+opponents.reduce((s,o)=>s+o.contribution,0)>P+1e-8)throw Error('This street’s contributions cannot exceed the current pot.');
  const isRaise=H+C>0,action=isRaise?'RAISE':'BET',R=Number(isRaise?input.raiseTo:input.betSize);
  if(!Number.isFinite(R)||R<=H+C)throw Error('Enter the proposed street total for bet/raise.');
  const heroCost=R-H,maximum=Math.min(Number(input.effectiveStack),isRaise?P+2*C:P);
  if(heroCost>maximum+1e-8)throw Error(`The additional cost exceeds the pot limit or stack (${maximum.toFixed(2)} chips).`);
  const min=raw.minRaiseTo===undefined||raw.minRaiseTo===''?2*(H+C):Number(raw.minRaiseTo);
  if(isRaise&&(!Number.isFinite(min)||min<=H+C||R<min))throw Error(`Raise is below the entered or conservative minimum (${min.toFixed(2)} total).`);
  const minBet=Number(raw.minBet);
  if(!isRaise&&(!Number.isFinite(minBet)||minBet<=0||heroCost<minBet))throw Error('Enter the legal minimum bet; the proposed bet must reach it.');
  // stackRemaining is a declared covering-stack hypothesis; cover opponent
  // costs as well even when their current contribution is lower than hero's.
  for(const o of opponents)o.stackRemaining=Math.max(Number(input.effectiveStack),R-o.contribution);
  const sampleCap=input.samplingMode==='ADAPTIVE'?5000:50000;
  return {n,H,C,P,R,action,opponents,...(raw.source==='USER_SUPPLIED_HYPOTHESIS'?{hypothesisSource:raw.source}:{}),minBet:!isRaise?minBet:undefined,minRaiseTo:isRaise?min:undefined,samplesPerCount:Math.floor(Math.max(256,Math.min(sampleCap,Number(input.samples)||5000)))};
}

function buildStudyModels(input,settings,baseEquity) {
  if(!settings)return {input,summary:null};
  const {n,H,C,R,action,opponents,samplesPerCount}=settings,started=performance.now();
  const equities=new Map([[n,baseEquity]]);
  const sizes=new Set([n]);
  const branches=[];
  for(let mask=0;mask<2**n;mask++){
    let probability=1;const callers=[];
    opponents.forEach((o,i)=>{const calls=Boolean(mask&(1<<i));probability*=calls?o.callProbability:1-o.callProbability;if(calls)callers.push({id:o.id,additional:R-o.contribution});});
    if(probability>0){branches.push({id:`response-${mask}`,probability,callers});if(callers.length)sizes.add(callers.length);}
  }
  for(const count of sizes)if(!equities.has(count))equities.set(count,calculateEquity({variant:input.variant,heroCards:input.heroCards,board:input.board,opponentRanges:Array.from({length:count},()=>({kind:'UNIFORM'})),samples:samplesPerCount,samplingMode:'FIXED',seed:(Number(input.seed)||42)+count*104729}));
  const attach=branch=>{
    if(!branch.callers.length)return branch;
    const e=equities.get(branch.callers.length);
    return {...branch,equity:e.equity,equityOpponentIds:branch.callers.map(c=>c.id),equitySource:'CALCULATED_CONDITIONAL',...(e.confidenceInterval95?{equityInterval:e.confidenceInterval95,equityIntervalLevel:.95}:{})};
  };
  const common={type:'SCENARIO_SHOWDOWN_ONLY',source:settings.hypothesisSource||'HEURISTIC_PRESET',heroContribution:H,opponents:opponents.map(({callProbability,...o})=>o)};
  const aggressive={...common,action,targetStreetTotal:R,scenarios:branches.map(attach)};
  const models={...input.actionResponseModels,[action]:aggressive};
  const callAdditional=opponent=>{
    const amount=H+C-opponent.contribution;
    // Contributions were validated with this same 1e-8 tolerance above.
    // Decimal chip values can leave a negative ULP at a matched contribution
    // (35.60 + 46.19 - 81.79). Normalize only that near-zero negative residue;
    // a genuinely negative amount still reaches the strict scenario validator.
    return amount<0&&amount>=-1e-8?0:amount;
  };
  if(C>0)models.CALL={...common,action:'CALL',targetStreetTotal:H+C,scenarios:[attach({id:'all-complete-current-price',probability:1,callers:opponents.map(o=>({id:o.id,additional:callAdditional(o)}))})]};
  return {
    input:{...input,heroContribution:H,minBet:settings.minBet,minRaiseTo:settings.minRaiseTo,actionResponseModels:models},
    summary:{source:settings.hypothesisSource||'EXPLICIT_INDEPENDENT_UNIFORM_HYPOTHESIS',action,targetStreetTotal:R,heroAdditional:R-H,branchCount:branches.length,samplesPerCount,totalSamples:[...equities.values()].reduce((s,e)=>s+e.samples,0),additionalCalculationMs:performance.now()-started,equitiesByCallerCount:[...equities].sort((a,b)=>a[0]-b[0]).map(([count,e])=>({callers:count,equity:e.equity,samples:e.samples,interval:e.confidenceInterval95})),assumptions:['Random hands; the decision to call is independent of cards and other opponents.','For CALL, players who still owe chips match the current price; nobody reraises.','For BET/RAISE, entered call probabilities apply; players who do not call fold.','Everyone covers the proposed size; no side pots, reraises or future bets.','Probabilities are study assumptions, not learned frequencies or GTO.']}
  };
}
module.exports={studySettings,buildStudyModels};
