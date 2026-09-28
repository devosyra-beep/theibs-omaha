'use strict';
// Post-hoc sensitivity only. Does not retrofit a rake-aware decision policy.
function outcomeCost(state, boardLength, cost, bigBlind) {
  const awards=state.result.awards||[],grossAwards=awards.reduce((n,a)=>n+a.amount,0);
  const heroAward=awards.find(a=>a.player===0)?.amount||0;
  const contributions=state.players.map(player=>player.totalPaid).sort((a,b)=>b-a);
  const uncalled=state.result.reason==='ALL_FOLDED'?Math.max(0,contributions[0]-(contributions[1]||0)):0;
  const contestedPot=Math.max(0,grossAwards-uncalled);
  const heroContestedAward=Math.max(0,heroAward-(state.result.winners.includes(0)?uncalled:0));
  const totalFee=cost.noFlopNoDrop&&boardLength<3?0:Math.min(contestedPot*cost.rate,cost.capBB*bigBlind);
  return {grossAwards,uncalled,contestedPot,totalFee,
    heroFeeChips:contestedPot?Math.round(totalFee*heroContestedAward/contestedPot*100)/100:0};
}
module.exports={outcomeCost};
