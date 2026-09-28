'use strict';
const {normalizeRange,serializeRange}=require('./range-engine');
const {holeCount}=require('./variants');
const {studySettings}=require('./aggression-scenarios');

const SOURCE='USER_SUPPLIED_HYPOTHESIS';
const hasOverrides=input=>Object.hasOwn(input,'opponentOverrides');
const key=value=>String(value);
const present=value=>value!==undefined&&value!==null&&value!=='';

// This is a stateless adapter. Every request states its active seat identities;
// no observed action creates a range or a response probability automatically.
function prepareOpponentOverrides(input,{seats=null,observed=false}={}) {
  if(!hasOverrides(input))return input;
  if(!Array.isArray(input.opponentOverrides))throw Error('opponentOverrides deve ser uma lista de hipóteses por assento.');
  const count=holeCount(input.variant||'PLO5_HIGH'),n=Number(input.players)-1;
  if(!Number.isInteger(n)||n<1||n+1>Math.min(10,Math.floor(47/count)))throw Error('Quantidade de adversários inválida para esta variante.');
  const active=seats||Array.from({length:n},(_,seatId)=>({seatId}));
  if(active.length!==n||new Set(active.map(s=>key(s.seatId))).size!==n)throw Error('Os assentos ativos não correspondem à mesa informada.');
  const byId=new Map(active.map(s=>[key(s.seatId),s])),overrides=new Map();
  for(const raw of input.opponentOverrides){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Hipótese adversária inválida.');
    if(!['string','number'].includes(typeof raw.seatId)||!byId.has(key(raw.seatId)))throw Error(`Assento adversário não ativo: ${raw.seatId}.`);
    if(overrides.has(key(raw.seatId)))throw Error(`Hipótese duplicada para o assento ${raw.seatId}.`);
    if(raw.enabled!==true&&raw.enabled!==false)throw Error('Ative explicitamente a hipótese do assento.');
    const item={seatId:byId.get(key(raw.seatId)).seatId,enabled:raw.enabled};
    if(raw.enabled){
      if(raw.range!==undefined){
        if(!raw.range||!Array.isArray(raw.range.hands)||!raw.range.hands.length||raw.range.hands.length>100)throw Error(`Informe de 1 a 100 mãos completas no range do assento ${raw.seatId}.`);
        item.range=serializeRange(normalizeRange({hands:raw.range.hands,id:`seat-${item.seatId}`,source:SOURCE,version:'1'},0,count));
      }
      if(raw.callProbability!==undefined){
        if(typeof raw.callProbability!=='number'||!Number.isFinite(raw.callProbability)||raw.callProbability<0||raw.callProbability>1)throw Error(`Chance de call inválida no assento ${raw.seatId}; use um número entre 0 e 1.`);
        item.callProbability=raw.callProbability;
      }
    }
    overrides.set(key(raw.seatId),item);
  }
  const selected=active.map(seat=>overrides.get(key(seat.seatId))).filter(item=>item?.enabled);
  const result={...input,unknownOpponentModel:'UNIFORM',opponentSeatIds:active.map(s=>s.seatId),
    opponentRanges:active.map(seat=>overrides.get(key(seat.seatId))?.range||{kind:'UNIFORM',id:`seat-${seat.seatId}`})};
  // Presence of the new API, including [], opts out of all unscoped legacy
  // hypotheses. Legacy callers without this field keep their existing behavior.
  for(const field of['opponentHands','opponentRangeProfile','opponentProfile','opponentProfileSource','opponentTendencies','opponentResponseModel','foldEquity','continuationEquity','actionResponseModels','aggressionStudy'])delete result[field];
  const scope={mode:'PER_SEAT_OPT_IN',source:SOURCE,automaticallyObserved:false,externallyCalibrated:false,
    seats:active.map(seat=>{const item=overrides.get(key(seat.seatId));return{seatId:seat.seatId,cardsModel:item?.range?'USER_RANGE':'UNIFORM',cardsSource:item?.range?SOURCE:'UNIFORM_UNKNOWN',responseModel:item?.enabled&&item.callProbability!==undefined?'USER_CALL_PROBABILITY':'UNKNOWN',...(item?.enabled&&item.callProbability!==undefined?{callProbability:item.callProbability,responseSource:SOURCE}:{})};}),
    unknownCardSeatIds:active.filter(seat=>!overrides.get(key(seat.seatId))?.range).map(s=>s.seatId),
    unknownResponseSeatIds:active.filter(seat=>!overrides.get(key(seat.seatId))?.enabled||overrides.get(key(seat.seatId)).callProbability===undefined).map(s=>s.seatId),
    aggression:{status:'NOT_MODELED',reasonCode:null,reason:null}};
  const unavailable=(reasonCode,reason)=>{scope.aggression={status:'NOT_MODELED',reasonCode,reason};result.opponentModelScope=scope;return result;};
  if(scope.unknownResponseSeatIds.length)return unavailable('MISSING_SEAT_CALL_PROBABILITIES','Faltam chances de call explícitas para os assentos '+scope.unknownResponseSeatIds.join(', ')+'. Equity e CALL disponíveis mantêm seu cálculo.');
  if(input.opponentStudyAccepted!==true)return unavailable('INDEPENDENT_STUDY_NOT_ACCEPTED','Confirme o estudo de respostas independentes, sem reaumentos, apostas futuras ou potes laterais.');
  if(selected.some(item=>item.range))return unavailable('SPECIFIC_RANGE_CONTINUATION_UNSUPPORTED','A agressão com ranges específicos exige um modelo de continuação que preserve os blockers de cada assento. A equity e o CALL usam os ranges escolhidos.');
  const contributions=input.opponentContributions??input.aggressionStudy?.opponents??[];
  if(!observed&&(!Array.isArray(contributions)||contributions.some(item=>!item||!byId.has(key(item.seatId)))||new Set(contributions.map(item=>key(item.seatId))).size!==contributions.length))return unavailable('INVALID_SEAT_CONTRIBUTIONS','Associe cada contribuição ao assento ativo correto.');
  const contributionById=new Map((Array.isArray(contributions)?contributions:[]).map(item=>[key(item.seatId),item.contribution]));
  const H=input.heroContribution??input.aggressionStudy?.heroContribution;
  const raw={enabled:true,assumptionsAccepted:true,source:SOURCE,heroContribution:H,
    minRaiseTo:input.minRaiseTo??input.aggressionStudy?.minRaiseTo,minBet:input.minBet??input.aggressionStudy?.minBet,
    opponents:active.map(seat=>({seatId:seat.seatId,contribution:observed?seat.contribution:contributionById.get(key(seat.seatId)),callProbability:overrides.get(key(seat.seatId)).callProbability}))};
  if(!present(H)||raw.opponents.some(item=>!present(item.contribution)))return unavailable('MISSING_SEAT_CONTRIBUTIONS','Informe sua contribuição e a contribuição de cada adversário; nenhuma foi presumida.');
  const raise=Number(H)+Number(input.amountToCall)>0;
  if(!present(raise?raw.minRaiseTo:raw.minBet))return unavailable('MISSING_LEGAL_MINIMUM','Informe o mínimo legal da aposta ou do raise para modelar a agressão.');
  try{
    studySettings({...result,aggressionStudy:raw},{ranges:result.opponentRanges});
    const target=Number(raise?result.raiseTo:result.betSize);
    if(observed&&active.some(seat=>target-seat.contribution>seat.stackRemaining+1e-8))return unavailable('SIDE_POT_CONTINUATION_UNSUPPORTED','O tamanho proposto excede o stack de um adversário; o modelo simplificado não cobre potes laterais.');
  }catch(error){return unavailable('INCOMPLETE_AGGRESSION_INPUT',error.message);}
  result.aggressionStudy=raw;scope.aggression={status:'READY',source:SOURCE,reasonCode:null,reason:null};result.opponentModelScope=scope;
  return result;
}
module.exports={SOURCE,hasOverrides,prepareOpponentOverrides};
