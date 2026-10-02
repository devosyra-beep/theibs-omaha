(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory();
  else root.TheibsRiverStudyTools=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const VERSION='RIVER_HU_RANGE_HYPOTHESES_V1';
  const copy=value=>JSON.parse(JSON.stringify(value));
  function checked(ranges){
    if(!Array.isArray(ranges) || ranges.length!==2 || new Set(ranges.map(r=>r.seatId)).size!==2)throw Error('Range checks require two distinct river seats.');
    for(const range of ranges){
      if(![0,1].includes(range.seatId) || !Array.isArray(range.combos) || !range.combos.length || range.combos.length>32)throw Error('Use one to 32 explicit combinations per seat.');
      const seen=new Set();
      for(const combo of range.combos){
        if(!Array.isArray(combo.cards) || combo.cards.length!==5 || new Set(combo.cards).size!==5 || combo.cards.some(c=>typeof c!=='string' || !/^[2-9TJQKA][cdhs]$/.test(c)) ||
          !Number.isFinite(combo.weight) || combo.weight<=0 || combo.weight>1e12)throw Error('Use complete five-card combinations with positive finite weights.');
        const key=[...combo.cards].sort().join(',');if(seen.has(key))throw Error('Merge duplicate combinations explicitly.');seen.add(key);
      }
    }
    return ranges;
  }
  function diagnostics(ranges,board,heroSeat,heroCards){
    checked(ranges);
    if(!Array.isArray(board) || board.length!==5 || new Set(board).size!==5 || board.some(c=>!(/^[2-9TJQKA][cdhs]$/).test(c)) ||
      ![0,1].includes(heroSeat) || !Array.isArray(heroCards) || heroCards.length!==5)throw Error('Range checks need the current river board and Hero cards.');
    const blocked=new Set(board),ordered=[...ranges].sort((a,b)=>a.seatId-b.seatId);
    if(ranges.some(r=>r.combos.some(c=>c.cards.some(card=>blocked.has(card)))))throw Error('A range conflicts with the board. Edit the combination explicitly.');
    const normalized=ordered.map(r=>{const total=r.combos.reduce((sum,c)=>sum+c.weight,0);return r.combos.map(c=>({...c,weight:c.weight/total}));});
    const key=[...heroCards].sort().join(',');
    if(!normalized[heroSeat].some(c=>[...c.cards].sort().join(',')===key))throw Error('Include the current Hero cards in the declared range.');
    let compatible=0,mass=0,heroMass=0;
    for(const a of normalized[0])for(const b of normalized[1]){
      if(a.cards.some(c=>b.cards.includes(c)))continue;
      const weight=a.weight*b.weight;if(!(weight>0))throw Error('Joint weights underflow numeric precision.');
      compatible++;mass+=weight;
      const hand=heroSeat===0?a:b;if([...hand.cards].sort().join(',')===key)heroMass+=weight;
    }
    if(!(mass>0) || !(heroMass>0))throw Error('No compatible joint support for the current Hero cards.');
    return {version:VERSION,scope:'DECLARED_RANGE_DIAGNOSTIC_NOT_CALIBRATION',worlds:compatible,cartesianWorlds:normalized[0].length*normalized[1].length,
      compatiblePriorMass:mass,heroMass:heroMass/mass,seats:ordered.map((r,index)=>({seatId:r.seatId,combinations:r.combos.length,
        effectiveCombinations:1/normalized[index].reduce((sum,c)=>sum+c.weight*c.weight,0)}))};
  }
  function weightHypothesis(ranges,heroSeat,power){
    checked(ranges);
    if(![0,1].includes(heroSeat) || ![.5,2].includes(power))throw Error('Choose an explicit flatter or sharper opponent-weight hypothesis.');
    const result=copy(ranges),opponent=result.find(r=>r.seatId!==heroSeat);
    const logs=opponent.combos.map(c=>power*Math.log(c.weight)),maximum=Math.max(...logs);
    const weights=logs.map(value=>Math.exp(value-maximum));
    if(weights.some(value=>!(value>0)))throw Error('The weight hypothesis underflows; no combination was removed.');
    opponent.combos.forEach((combo,index)=>{combo.weight=weights[index];});
    opponent.source=`USER_WEIGHT_HYPOTHESIS_POWER_${power}`;
    return {version:VERSION,ranges:result,origin:{type:'USER_REVIEWED_WEIGHT_SENSITIVITY',power,seatId:opponent.seatId,
      source: ranges.find(r=>r.seatId!==heroSeat).source,sourceCombos:copy(ranges.find(r=>r.seatId!==heroSeat).combos)},
      learned:false,uncertaintyInterval:false};
  }
  return Object.freeze({VERSION,diagnostics,weightHypothesis});
});
