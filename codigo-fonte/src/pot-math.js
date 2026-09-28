function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative number.`);
  return number;
}

function optionalFiniteNumber(value, label) {
  if (value === undefined || value === null || value === '') return null;
  return finiteNumber(value, label);
}

function calculatePotMath(input) {
  const potBeforeAction = optionalFiniteNumber(input.potBeforeAction ?? input.potBeforeCall, 'potBeforeAction');
  const amountToCall = optionalFiniteNumber(input.amountToCall, 'amountToCall');
  const effectiveStack = optionalFiniteNumber(input.effectiveStack, 'effectiveStack');
  let potAfterCall = potBeforeAction !== null && amountToCall !== null ? potBeforeAction + amountToCall : null;
  let potOdds = amountToCall !== null && amountToCall > 0 && potAfterCall !== null ? amountToCall / potAfterCall
    : amountToCall === 0 && potAfterCall !== null ? 0 : null;
  const spr = potBeforeAction !== null && potBeforeAction > 0 && effectiveStack !== null ? effectiveStack / potBeforeAction : null;
  const equity = input.equity == null ? null : Number(input.equity);
  let evCall = equity == null || amountToCall == null || amountToCall === 0 || potAfterCall === null ? null : equity * potAfterCall - amountToCall;
  const callModel=input.callModel;
  let callMathScope=potBeforeAction !== null && amountToCall !== null ? 'CURRENT_PRICE_NO_FUTURE_CONTRIBUTIONS' : 'CURRENT_PRICE_INCOMPLETE';
  if(callModel){
    evCall=callModel.status==='MODELED'?callModel.ev:null;
    const branches=callModel.scenarioBreakdown?.filter(s=>s.probability>0);
    if(branches){
      callMathScope='CONDITIONAL_RESPONSE_SCENARIOS';
      potAfterCall=branches.length===1?branches[0].potAtShowdown:null;
      const net=branches.length===1?potAfterCall-branches[0].rake:null;
      potOdds=net>0&&amountToCall!==null?amountToCall/net:null;
    }else if(callModel.status==='MODELED'&&amountToCall!==null){
      const net=Number.isFinite(callModel.netPot)?callModel.netPot:(potAfterCall===null?null:potAfterCall-Number(input.rake||0));
      potOdds=amountToCall>0&&net>0?amountToCall/net:amountToCall===0&&net!==null?0:null;
    }
  }
  const heroContribution=Number(input.heroContribution||0);
  const maxRaiseTo = effectiveStack === null || potBeforeAction === null || amountToCall === null ? null
    : heroContribution+(input.potLimit === false ? effectiveStack : Math.min(effectiveStack, potBeforeAction + (2 * amountToCall)));
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
