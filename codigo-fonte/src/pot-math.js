function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative number.`);
  return number;
}

function calculatePotMath(input) {
  const potBeforeAction = finiteNumber(input.potBeforeAction ?? input.potBeforeCall, 'potBeforeAction');
  const amountToCall = finiteNumber(input.amountToCall || 0, 'amountToCall');
  const effectiveStack = finiteNumber(input.effectiveStack, 'effectiveStack');
  let potAfterCall = potBeforeAction + amountToCall;
  let potOdds = amountToCall > 0 ? amountToCall / potAfterCall : 0;
  const spr = potBeforeAction > 0 ? effectiveStack / potBeforeAction : null;
  const equity = input.equity == null ? null : Number(input.equity);
  let evCall = equity == null || amountToCall === 0 ? null : equity * potAfterCall - amountToCall;
  const callModel=input.callModel;
  let callMathScope='CURRENT_PRICE_NO_FUTURE_CONTRIBUTIONS';
  if(callModel){
    evCall=callModel.status==='MODELED'?callModel.ev:null;
    const branches=callModel.scenarioBreakdown?.filter(s=>s.probability>0);
    if(branches){
      callMathScope='CONDITIONAL_RESPONSE_SCENARIOS';
      // A single price threshold cannot represent different conditional
      // equities/pots. The deterministic study CALL has exactly one branch.
      potAfterCall=branches.length===1?branches[0].potAtShowdown:null;
      const net=branches.length===1?potAfterCall-branches[0].rake:null;
      potOdds=net>0?amountToCall/net:null;
    }else if(callModel.status==='MODELED'){
      const net=potAfterCall-Number(input.rake||0);
      potOdds=amountToCall>0&&net>0?amountToCall/net:0;
    }
  }
  const heroContribution=Number(input.heroContribution||0);
  const maxRaiseTo = heroContribution+(input.potLimit === false ? effectiveStack : Math.min(effectiveStack, potBeforeAction + (2 * amountToCall)));
  return {
    potBeforeAction,
    amountToCall,
    potAfterCall,
    potOdds,
    callMathScope,
    spr,
    evCall,
    evFold: 0,
    maxRaiseTo
  };
}

module.exports = { calculatePotMath };
