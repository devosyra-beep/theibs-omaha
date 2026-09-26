'use strict';
const { calculateEquity } = require('./equity-engine');

// Explicit study model: fold/call independent of private cards, no re-raise,
// equal coverage of the proposed size. It is not a learned opponent policy.
function studySettings(input,rangeModel) {
  const raw=input.aggressionStudy;
  if(!raw?.enabled)return null;
  if(raw.assumptionsAccepted!==true)throw Error('Confirme as premissas do cenário de bet/raise.');
  if(rangeModel.ranges.some(r=>r.kind!=='UNIFORM'))throw Error('O cenário simples de bet/raise exige mãos aleatórias para todos. Ranges de continuação específicos precisam de cenários avançados.');
  const n=rangeModel.ranges.length,H=Number(raw.heroContribution),C=Number(input.amountToCall),P=Number(input.potBeforeAction);
  if(raw.heroContribution==null||raw.heroContribution===''||!Number.isFinite(H)||H<0)throw Error('Informe sua contribuição atual na rodada.');
  if(H>0&&C===0)throw Error('A opção de aumentar sem valor para pagar (como no big blind) ainda exige um modelo de ações específico. Este cenário aceita bet somente sem contribuição anterior nesta rodada.');
  if(!Array.isArray(raw.opponents)||raw.opponents.length!==n)throw Error('Informe contribuição e chance de call de cada adversário ativo.');
  if(raw.opponents.some(o=>o.callProbability==null||o.callProbability===''||o.contribution==null||o.contribution===''))throw Error('Preencha contribuição e chance de call de todos os adversários ativos.');
  const opponents=raw.opponents.map((o,i)=>({id:`opponent-${i+1}`,contribution:Number(o.contribution),callProbability:Number(o.callProbability),stackRemaining:Number(input.effectiveStack)}));
  if(opponents.some(o=>!Number.isFinite(o.contribution)||o.contribution<0||o.contribution>H+C+1e-8||!Number.isFinite(o.callProbability)||o.callProbability<0||o.callProbability>1))throw Error('Contribuições devem estar entre zero e a aposta atual; chances de call entre 0% e 100%.');
  if(Math.abs(Math.max(H,...opponents.map(o=>o.contribution))-H-C)>1e-8)throw Error('A maior contribuição adversária precisa corresponder ao valor para pagar mais sua contribuição.');
  if(H+opponents.reduce((s,o)=>s+o.contribution,0)>P+1e-8)throw Error('As contribuições desta rodada não podem ultrapassar o pote atual.');
  const action=C>0?'RAISE':'BET',R=Number(C>0?input.raiseTo:input.betSize);
  if(!Number.isFinite(R)||R<=H+C)throw Error('Informe o total proposto de bet/raise na rodada.');
  const heroCost=R-H,maximum=Math.min(Number(input.effectiveStack),C>0?P+2*C:P);
  if(heroCost>maximum+1e-8)throw Error(`O custo adicional excede o pot-limit/stack (${maximum.toFixed(2)} fichas).`);
  const min=raw.minRaiseTo===undefined||raw.minRaiseTo===''?2*(H+C):Number(raw.minRaiseTo);
  if(C>0&&(!Number.isFinite(min)||min<=H+C||R<min))throw Error(`Raise abaixo do mínimo informado/conservador (${min.toFixed(2)} no total).`);
  const minBet=Number(raw.minBet);
  if(C===0&&(!Number.isFinite(minBet)||minBet<=0||heroCost<minBet))throw Error('Informe o mínimo legal de bet; a aposta proposta deve atingir esse mínimo.');
  // stackRemaining is a declared covering-stack hypothesis; cover opponent
  // costs as well even when their current contribution is lower than hero's.
  for(const o of opponents)o.stackRemaining=Math.max(Number(input.effectiveStack),R-o.contribution);
  const sampleCap=input.samplingMode==='ADAPTIVE'?5000:50000;
  return {n,H,C,P,R,action,opponents,minBet:C===0?minBet:undefined,minRaiseTo:C>0?min:undefined,samplesPerCount:Math.floor(Math.max(256,Math.min(sampleCap,Number(input.samples)||5000)))};
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
  const common={type:'SCENARIO_SHOWDOWN_ONLY',source:'HEURISTIC_PRESET',heroContribution:H,opponents:opponents.map(({callProbability,...o})=>o)};
  const aggressive={...common,action,targetStreetTotal:R,scenarios:branches.map(attach)};
  const models={...input.actionResponseModels,[action]:aggressive};
  if(C>0)models.CALL={...common,action:'CALL',targetStreetTotal:H+C,scenarios:[attach({id:'all-complete-current-price',probability:1,callers:opponents.map(o=>({id:o.id,additional:H+C-o.contribution}))})]};
  return {
    input:{...input,heroContribution:H,minBet:settings.minBet,minRaiseTo:settings.minRaiseTo,actionResponseModels:models},
    summary:{source:'EXPLICIT_INDEPENDENT_UNIFORM_HYPOTHESIS',action,targetStreetTotal:R,heroAdditional:R-H,branchCount:branches.length,samplesPerCount,totalSamples:[...equities.values()].reduce((s,e)=>s+e.samples,0),additionalCalculationMs:performance.now()-started,equitiesByCallerCount:[...equities].sort((a,b)=>a[0]-b[0]).map(([count,e])=>({callers:count,equity:e.equity,samples:e.samples,interval:e.confidenceInterval95})),assumptions:['Mãos aleatórias; decisão de pagar independente das cartas e dos outros adversários.','No call, quem ainda deve fichas completa o preço atual; ninguém reaumenta.','No bet/raise, probabilidades de call informadas; quem não paga desiste.','Todos cobrem o tamanho proposto; sem potes laterais, reaumentos ou apostas futuras.','Probabilidades são hipóteses de estudo, não frequências aprendidas ou GTO.']}
  };
}
module.exports={studySettings,buildStudyModels};
