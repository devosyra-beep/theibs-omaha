'use strict';
// Observed actions only. Replaying the event log is the source of truth for
// order, chips, pot-limit sizing, street changes and side-pot eligibility.
const { normalizeCards, cardCodes } = require('./cards');
const { holeCount } = require('./variants');
const STREETS = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];
const POSITIONS = {
  2:['SB','BB'], 3:['SB','BB','BTN'], 4:['SB','BB','CO','BTN'],
  5:['SB','BB','HJ','CO','BTN'], 6:['SB','BB','UTG','HJ','CO','BTN'],
  7:['SB','BB','UTG','LJ','HJ','CO','BTN'], 8:['SB','BB','UTG','UTG1','LJ','HJ','CO','BTN'],
  9:['SB','BB','UTG','UTG1','UTG2','LJ','HJ','CO','BTN'],
  10:['SB','BB','UTG','UTG1','UTG2','UTG3','LJ','HJ','CO','BTN']
};
function cents(value, label, positive = false) {
  if (value === '' || value == null) throw Error(`${label} is required.`);
  const n = Number(value), rounded = Math.round(n * 100);
  if (!Number.isFinite(n) || n < 0 || n > 10000000 || Math.abs(n * 100 - rounded) > 0.00001 || (positive && !rounded)) throw Error(`${label}: use a ${positive ? 'positive' : 'non-negative'} value with up to two decimal places.`);
  return rounded;
}
const chips = n => n / 100;
const live = s => s.players.filter(p => !p.folded);
const able = s => live(s).filter(p => p.stack > 0);
function pay(s, p, amount) {
  if (amount < 0 || amount > p.stack) throw Error('The contribution exceeds the stack.');
  p.stack -= amount; p.streetPaid += amount; p.totalPaid += amount; s.pot += amount;
}
function nextActor(s, after) {
  for (let step=1; step<=s.players.length; step++) {
    const id = (after + step) % s.players.length;
    if (s.pending.includes(id) && !s.players[id].folded && s.players[id].stack > 0) return id;
  }
  return null;
}
function pots(s) {
  const levels = [...new Set(s.players.map(p => p.totalPaid).filter(Boolean))].sort((a,b)=>a-b);
  let previous = 0;
  const layers = levels.map(level => {
    const contributors = s.players.filter(p => p.totalPaid >= level);
    const pot = { amount: (level - previous) * contributors.length, eligible: contributors.filter(p=>!p.folded).map(p=>p.id) };
    previous = level; return pot;
  });
  return layers.reduce((merged,layer)=>{
    const last=merged.at(-1);
    if(last&&JSON.stringify(last.eligible)===JSON.stringify(layer.eligible))last.amount+=layer.amount;
    else merged.push(layer);
    return merged;
  },[]);
}
function finishRound(s) {
  const ranked = [...s.players].sort((a,b)=>b.streetPaid-a.streetPaid);
  const refund = ranked[0].streetPaid - ranked[1].streetPaid;
  if (refund > 0) {
    const p = ranked[0]; p.stack += refund; p.streetPaid -= refund; p.totalPaid -= refund; s.pot -= refund;
    s.log.push({ street:s.street, actor:p.id, action:'RETURN', amount:chips(refund) });
  }
  s.actor = null; s.pending = [];
  if (s.street === 'RIVER') s.phase = 'SHOWDOWN';
  else { s.phase = 'WAIT_BOARD'; s.nextStreet = STREETS[STREETS.indexOf(s.street)+1]; }
}
function resolveRound(s, previousActor) {
  if (live(s).length === 1) {
    const winner = live(s)[0]; const award = s.pot; winner.stack += award; s.pot = 0;
    s.phase = 'FINISHED'; s.actor = null; s.pending = [];
    s.result = { reason:'ALL_FOLDED', winners:[winner.id], awards:[{player:winner.id,amount:chips(award)}] };
    return;
  }
  s.pending = s.pending.filter(id=>!s.players[id].folded && s.players[id].stack > 0);
  if (able(s).length < 2 && able(s).every(p=>p.streetPaid >= Math.max(0,...live(s).filter(other=>other.id!==p.id).map(other=>other.streetPaid)))) s.pending = [];
  if (!s.pending.length) finishRound(s);
  else s.actor = nextActor(s, previousActor);
}
function create(config) {
  if (!config || typeof config !== 'object') throw Error('Hand configuration is missing.');
  const n = Number(config.playerCount), count = holeCount(config.variant);
  if (!POSITIONS[n] || count * n + 5 > 52) throw Error('Player count is incompatible with this variant’s deck.');
  const positions = POSITIONS[n];
  const heroPosition = n === 2 && config.heroPosition === 'BTN' ? 'SB' : config.heroPosition;
  const heroId = positions.indexOf(heroPosition);
  if (heroId < 0) throw Error('Select an available position at this table.');
  const sb = cents(config.smallBlind, 'Small blind', true), bb = cents(config.bigBlind, 'Big blind', true);
  if (sb >= bb) throw Error('Small blind must be lower than big blind.');
  if (config.heroCards?.length && normalizeCards(config.heroCards).length !== count) throw Error('Complete your hole cards before starting.');
  const players = positions.map((position,id) => ({ id, position, hero:id===heroId,
    // A1 is the first physical seat after Hero, independently of poker position.
    name:id===heroId?'You':`A${(id-heroId+n)%n}`, seatName:id===heroId?'You':`A${(id-heroId+n)%n}`,
    startingStack:cents(config.stacks?.[id] ?? config.startingStack, 'Stack', true), folded:false,
    stack:cents(config.stacks?.[id] ?? config.startingStack, 'Stack', true), streetPaid:0,totalPaid:0,lastActedBet:null,raiseThreshold:bb,lastAction:null }));
  const s = { schema:'THEIBS_OBSERVED_HAND_V1', variant:config.variant, heroId, heroPosition:config.heroPosition,
    initialPlayerCount:n, buttonId:n===2?0:n-1, players, street:'PREFLOP', board:[], phase:'BETTING', pot:0,
    currentBet:bb, lastFullRaise:bb, bigBlind:bb, pending:[], actor:null, log:[], totalChips:players.reduce((a,p)=>a+p.stack,0), result:null, rake:0 };
  pay(s,players[0],Math.min(sb,players[0].stack)); pay(s,players[1],Math.min(bb,players[1].stack));
  s.log.push({street:'PREFLOP',actor:0,action:'SB',amount:chips(players[0].streetPaid)}, {street:'PREFLOP',actor:1,action:'BB',amount:chips(players[1].streetPaid)});
  s.pending = able(s).map(p=>p.id);
  resolveRound(s,n===2?n-1:1);
  return s;
}
function legal(s, id = s.actor) {
  if (s.phase !== 'BETTING' || id == null || id !== s.actor) return {actions:[]};
  const p = s.players[id], owed = Math.max(0,s.currentBet-p.streetPaid), call = Math.min(p.stack,owed);
  const reopened = p.lastActedBet === null || p.lastAction === 'CHECK' || s.currentBet-p.lastActedBet >= p.raiseThreshold;
  const maxTo = p.streetPaid + Math.min(p.stack, s.pot + 2 * owed);
  const minTo = s.currentBet ? s.currentBet+s.lastFullRaise : s.bigBlind;
  const canRaise = reopened && able(s).some(other=>other.id!==id) && maxTo>s.currentBet && (maxTo>=minTo || maxTo===p.streetPaid+p.stack);
  return { actions:['FOLD',owed?'CALL':'CHECK',...(canRaise?[s.currentBet?'RAISE':'BET']:[])],
    toCall:chips(call), owed:chips(owed), minTo:chips(Math.min(minTo,maxTo)), maxTo:chips(maxTo), totalThisStreet:chips(p.streetPaid), allInCall:call===p.stack };
}
function markFoldReason(s, id) {
  const player = Number.isInteger(id) ? s.players[id] : null;
  if (!player) return 'INVALID_SEAT';
  if (s.phase !== 'BETTING') return 'ROUND_CLOSED';
  if (id === s.heroId) return 'HERO_USE_ACTION';
  if (player.folded) return 'ALREADY_FOLDED';
  if (player.stack === 0) return 'ALL_IN_CANNOT_FOLD';
  if (!s.pending.includes(id)) return 'NO_PENDING_RESPONSE';
  // An observed out-of-turn exit cannot silently decide ownership of an
  // unmatched upper pot. Record the responses first, or use the normal turn.
  const remaining = live(s).filter(other => other.id !== id);
  if (remaining.length > 1 && pots(s).some(pot => !pot.eligible.some(eligible => eligible !== id))) return 'UNMATCHED_CONTRIBUTION';
  return null;
}
function apply(s, event, config) {
  if (!event || typeof event !== 'object') throw Error('Invalid event.');
  if (event.type === 'MARK_FOLD') {
    const reason = markFoldReason(s, event.actor);
    if (reason) {
      const error = Error(`Cannot mark this seat as folded: ${reason}.`);
      error.code = reason; throw error;
    }
    const previousActor = s.actor, player = s.players[event.actor];
    player.folded = true; player.lastAction = 'FOLD';
    s.pending = s.pending.filter(id => id !== player.id);
    s.log.push({ street:s.street, actor:player.id, action:'FOLD', source:'OBSERVED_EXIT',
      outOfTurn:player.id !== previousActor, amount:0, to:chips(player.streetPaid) });
    // Removing a future seat must not move the action past the current actor.
    const after = player.id === previousActor ? player.id : (previousActor+s.players.length-1)%s.players.length;
    resolveRound(s, after); return;
  }
  if (event.type === 'BOARD') {
    if (s.phase !== 'WAIT_BOARD') throw Error('Complete this street’s actions before dealing more cards.');
    const board = normalizeCards(event.cards || []), expected = {FLOP:3,TURN:4,RIVER:5}[s.nextStreet];
    if (board.length !== expected || !s.board.every((c,i)=>board[i].code===c)) throw Error(`Enter ${expected} board cards, keeping the previous ones.`);
    normalizeCards([...(config.heroCards||[]),...board]);
    s.board = cardCodes(board); s.street = s.nextStreet; s.nextStreet = null;
    s.currentBet = 0; s.lastFullRaise = s.bigBlind;
    for (const p of s.players) { p.streetPaid=0;p.lastActedBet=null;p.raiseThreshold=s.bigBlind;p.lastAction=null; }
    s.log.push({street:s.street,action:'BOARD',cards:s.board.slice()});
    s.phase='BETTING';s.pending=able(s).map(p=>p.id);
    resolveRound(s,s.players.length===2?0:s.players.length-1); return;
  }
  if (event.type === 'SETTLE') {
    if (s.phase !== 'SHOWDOWN') throw Error('The result can only be entered at showdown.');
    const layers = pots(s);
    if (!Array.isArray(event.winners) || event.winners.length!==layers.length) throw Error('Enter the winners of each pot.');
    const rake = cents(event.rake ?? 0,'Rake');
    if (rake>s.pot) throw Error('Rake cannot exceed the pot.');
    let remainingRake=rake;const awards=new Map();
    for (let i=0;i<layers.length;i++) {
      const layer=layers[i], ids=event.winners[i];
      if (!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!layer.eligible.includes(id))) throw Error('Invalid winner or winner ineligible for this pot.');
      const deduction=Math.min(layer.amount,remainingRake);remainingRake-=deduction;
      const amount=layer.amount-deduction, share=Math.floor(amount/ids.length);let extra=amount%ids.length;
      // Seat order begins left of the button; it also breaks odd-chip ties.
      for (const id of [...ids].sort((a,b)=>s.players.length===2?b-a:a-b)) awards.set(id,(awards.get(id)||0)+share+(extra-->0?1:0));
    }
    for (const [id,amount] of awards) s.players[id].stack+=amount;
    s.rake=rake;s.pot=0;s.phase='FINISHED';s.actor=null;
    s.result={reason:'REPORTED_SHOWDOWN',winners:[...awards.keys()],awards:[...awards].map(([player,amount])=>({player,amount:chips(amount)}))};
    s.log.push({street:s.street,action:'SHOWDOWN',winners:event.winners,rake:chips(rake)});return;
  }
  if (event.type !== 'ACT' || event.actor !== s.actor || s.phase !== 'BETTING') throw Error('Action out of turn or betting round ended.');
  const p = s.players[s.actor], options=legal(s), action=String(event.action||'').toUpperCase();
  if (!options.actions.includes(action)) throw Error('Illegal action: use the available buttons.');
  let amount=0, to=p.streetPaid;
  if (action==='FOLD') p.folded=true;
  else if (action==='CALL') { amount=cents(options.toCall,'Call');pay(s,p,amount);to=p.streetPaid; }
  else if (action==='BET'||action==='RAISE') {
    to=cents(event.to,'Bet total',true);
    if (to<cents(options.minTo,'Minimum')||to>cents(options.maxTo,'Maximum')) throw Error(`The bet total must be between ${options.minTo} and ${options.maxTo} chips this street.`);
    const increase=to-s.currentBet;amount=to-p.streetPaid;pay(s,p,amount);
    if(increase>=s.lastFullRaise) s.lastFullRaise=increase;
    s.currentBet=to;
    s.pending=able(s).filter(other=>other.id!==p.id && (s.pending.includes(other.id)||other.streetPaid<s.currentBet)).map(other=>other.id);
  }
  p.lastActedBet=s.currentBet;p.raiseThreshold=s.lastFullRaise;p.lastAction=action;
  s.pending=s.pending.filter(id=>id!==p.id);
  s.log.push({street:s.street,actor:p.id,action,amount:chips(amount),to:chips(to),allIn:p.stack===0});
  resolveRound(s,p.id);
}
function publicState(s, config) {
  const hero=s.players[s.heroId], active=live(s), opponents=active.filter(player=>player.id!==s.heroId);
  const sidePots=pots(s),hasSidePots=sidePots.length>1&&active.some(player=>player.stack===0);
  const hasLiveAllIn=active.some(player=>player.stack===0),owed=Math.max(0,s.currentBet-hero.streetPaid);
  const reasonCodes=[];
  if(s.phase==='FINISHED')reasonCodes.push('HAND_FINISHED');
  else if(s.phase==='WAIT_BOARD')reasonCodes.push('WAIT_BOARD');
  else if(s.phase==='SHOWDOWN')reasonCodes.push('SHOWDOWN_REQUIRED');
  if(hero.folded)reasonCodes.push('HERO_FOLDED');
  if(hero.stack===0)reasonCodes.push('HERO_ALL_IN');
  if(s.phase==='BETTING'&&s.actor!==s.heroId)reasonCodes.push('OPPONENT_TO_ACT');
  if(hasLiveAllIn)reasonCodes.push('LIVE_ALL_IN_UNMODELED');
  if(hasSidePots)reasonCodes.push('SIDE_POTS_UNMODELED');
  if(s.phase==='BETTING'&&s.actor===s.heroId&&owed>0&&hero.stack<=owed)reasonCodes.push('CALL_REACHES_ALL_IN');
  if((config.heroCards||[]).length!==holeCount(s.variant))reasonCodes.push('HERO_CARDS_INCOMPLETE');
  const analysisReadiness={status:s.phase==='WAIT_BOARD'?'WAIT_BOARD':reasonCodes.length?'BLOCKED':'READY',reasonCodes};
  return {...s, pot:chips(s.pot),bigBlind:chips(s.bigBlind),currentBet:chips(s.currentBet),lastFullRaise:chips(s.lastFullRaise),totalChips:chips(s.totalChips),rake:chips(s.rake),
    players:s.players.map(p=>({...p,stack:chips(p.stack),startingStack:chips(p.startingStack),streetPaid:chips(p.streetPaid),totalPaid:chips(p.totalPaid),
      allIn:s.phase!=='FINISHED'&&!p.folded&&p.stack===0,canMarkFold:markFoldReason(s,p.id)===null,markFoldReason:markFoldReason(s,p.id)})),
    legal:legal(s),pots:sidePots.map(p=>({...p,amount:chips(p.amount)})),
    nextPlayerId:s.phase==='BETTING'?s.actor:null,
    cardTarget:s.phase==='FINISHED'?null:(config.heroCards||[]).length!==holeCount(s.variant)?'HERO':s.phase==='WAIT_BOARD'?'BOARD':null,
    cardsExpected:s.phase==='FINISHED'?0:(config.heroCards||[]).length!==holeCount(s.variant)?holeCount(s.variant):s.phase==='WAIT_BOARD'?({FLOP:3,TURN:1,RIVER:1}[s.nextStreet]||0):0,
    pendingValue:null,
    heroToCall:chips(Math.min(hero.stack,Math.max(0,s.currentBet-hero.streetPaid))),heroFolded:hero.folded,
    activePlayers:active.length,activeOpponentIds:opponents.map(player=>player.id),activeOpponentCount:opponents.length,
    hasSidePots,analysisReadiness,
    modelLimits:{hasLiveAllIn,hasSidePots,pendingOpponentIds:s.pending.filter(id=>id!==s.heroId),
      unmatchedOpponentIds:opponents.filter(player=>player.streetPaid<s.currentBet).map(player=>player.id),
      heroCanCoverCall:hero.stack>=owed,
      heroCostToCoverAll:chips(Math.max(0,...opponents.map(player=>player.stack+player.streetPaid-hero.streetPaid))),
      minimumOpponentCover:opponents.length?chips(Math.max(0,Math.min(...opponents.map(player=>player.stack+player.streetPaid))-hero.streetPaid)):0},
    observation:{hasOutOfTurnExits:s.log.some(event=>event.source==='OBSERVED_EXIT'&&event.outOfTurn),
      actionsInferred:false,positionBasis:'ORIGINAL_PHYSICAL_SEATS'}
  };
}
function assertInvariants(s) {
  const amounts=[s.pot,s.rake,...s.players.flatMap(player=>[player.stack,player.streetPaid,player.totalPaid])];
  if(amounts.some(amount=>!Number.isSafeInteger(amount)||amount<0))throw Error('Invalid integer chip amounts.');
  if(s.players.some(player=>player.streetPaid>player.totalPaid))throw Error('Street contribution exceeds total invested.');
  if(s.players.reduce((sum,player)=>sum+player.stack,0)+s.pot+s.rake!==s.totalChips)throw Error('Chip conservation failed.');
  if(s.phase!=='FINISHED'&&s.players.reduce((sum,player)=>sum+player.totalPaid,0)!==s.pot)throw Error('Pot differs from contributions.');
  if(new Set(s.pending).size!==s.pending.length||s.pending.some(id=>!s.players[id]||s.players[id].folded||s.players[id].stack===0))throw Error('Invalid action queue.');
  if(s.phase==='BETTING'?!s.pending.includes(s.actor):s.actor!==null)throw Error('Actor does not match the hand phase.');
  if(s.players.filter(player=>player.hero).length!==1||!s.players[s.heroId]?.hero)throw Error('Invalid hero identity.');
}
function replay(config, events=[]) {
  if (!Array.isArray(events)||events.length>500) throw Error('Limit of 500 events per hand.');
  const s=create(config);
  assertInvariants(s);
  for (const event of events) {
    apply(s,event,config);
    assertInvariants(s);
  }
  return publicState(s,config);
}
module.exports={replay,POSITIONS};
