(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TheibsRangeTemplates = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION='REVIEWED_DECISION_RANGE_V1', MAX_TEMPLATES=64;
  const copy=value=>JSON.parse(JSON.stringify(value));
  const id=value=>typeof value==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
  const card=value=>typeof value==='string' && /^[2-9TJQKA][shdc]$/.test(value);
  function contextFor(state, seat) {
    if(!state || state.phase!=='BETTING' || !state.legal || !seat || seat.hero || !id(seat.playerId))return null;
    const hero=state.players?.find(player=>player.hero);
    return {variant:state.variant,street:state.street,position:seat.position,heroPosition:hero?.position,
      originalSeats:state.initialPlayerCount || state.players.length,activeSeats:state.activePlayers,
      facingBet:state.legal.toCall>0,legalActions:[...state.legal.actions].sort(),scope:'CURRENT_PUBLIC_DECISION'};
  }
  function contextKey(context) {
    if(!context || context.scope!=='CURRENT_PUBLIC_DECISION' || context.variant!=='PLO5_HIGH' || context.street!=='RIVER' ||
      typeof context.position!=='string' || typeof context.heroPosition!=='string' || !Number.isInteger(context.originalSeats) ||
      context.originalSeats<2 || context.originalSeats>3 || !Number.isInteger(context.activeSeats) || context.activeSeats<2 ||
      context.activeSeats>context.originalSeats || typeof context.facingBet!=='boolean' || !Array.isArray(context.legalActions) ||
      !context.legalActions.length || new Set(context.legalActions).size!==context.legalActions.length ||
      context.legalActions.some(action=>!['FOLD','CHECK','CALL','BET','RAISE'].includes(action)))throw Error('Use a supported, explicit river decision context.');
    return JSON.stringify([context.variant,context.street,context.position,context.heroPosition,context.originalSeats,
      context.activeSeats,context.facingBet,[...context.legalActions].sort(),context.scope]);
  }
  function validateRange(range, maximum=32) {
    if(!range || range.complete!==true || !Array.isArray(range.combos) || range.combos.length<1 || range.combos.length>maximum)throw Error('Use a complete finite study range.');
    const seen=new Set();
    for(const combo of range.combos){
      if(!Array.isArray(combo.cards) || combo.cards.length!==5 || combo.cards.some(value=>!card(value)) ||
        new Set(combo.cards).size!==5 || !Number.isFinite(combo.weight) || combo.weight<=0 || combo.weight>1e12)throw Error('Use valid five-card combinations and positive weights.');
      const key=[...combo.cards].sort().join(',');if(seen.has(key))throw Error('Remove duplicate range combinations.');seen.add(key);
    }
    return range;
  }
  function create(input) {
    if(!id(input?.playerId) || typeof input.name!=='string' || !input.name.trim() || input.name.length>80 ||
      !Array.isArray(input.board) || input.board.length!==5 || input.board.some(value=>!card(value)) || new Set(input.board).size!==5 ||
      !id(input.handId) || typeof input.revisionKey!=='string' || !input.revisionKey.length)throw Error('A reviewed range needs its player, board and source decision.');
    contextKey(input.context);validateRange(input.range,input.context.originalSeats===2?32:3);
    if(input.range.combos.some(combo=>combo.cards.some(value=>input.board.includes(value))))throw Error('The reviewed range contains a board blocker.');
    return {schemaVersion:1,model:VERSION,playerId:input.playerId,name:input.name.trim(),context:copy(input.context),
      range:{complete:true,source:'USER_REVIEWED_DECISION_TEMPLATE',combos:copy(input.range.combos)},
      board:copy(input.board),conditioningScope:'CONDITIONAL_AT_DECISION',statisticalObservation:false,
      origin:{handId:input.handId,revisionKey:input.revisionKey,scenarioId:String(input.scenarioId || '').slice(0,100),
        rationale:String(input.rationale || '').slice(0,500),approvedAt:input.approvedAt || new Date().toISOString()}};
  }
  function keyFor(owner){if(typeof owner!=='string' || !/^[a-f0-9]{64}$/.test(owner))throw Error('A verified account is required for range templates.');return 'theibs:reviewed-range-templates:v1:'+owner;}
  function load(storage,owner) {
    const raw=storage.getItem(keyFor(owner));if(!raw)return {schemaVersion:1,revision:0,templates:[]};
    let data;try{data=JSON.parse(raw);}catch{throw Error('Saved range templates cannot be read. No data was replaced.');}
    if(data?.schemaVersion!==1 || !Number.isSafeInteger(data.revision) || data.revision<0 || !Array.isArray(data.templates) || data.templates.length>MAX_TEMPLATES)throw Error('Saved range templates are invalid. No data was replaced.');
    for(const item of data.templates){
      if(item?.model!==VERSION || item.conditioningScope!=='CONDITIONAL_AT_DECISION' || item.statisticalObservation!==false || !id(item.playerId) ||
        typeof item.name!=='string' || !item.name.trim() || item.name.length>80 || !item.origin || !id(item.origin.handId) ||
        typeof item.origin.revisionKey!=='string' || !item.origin.revisionKey || !Array.isArray(item.board) || item.board.length!==5 ||
        item.board.some(value=>!card(value)) || new Set(item.board).size!==5)throw Error('Saved range templates are invalid. No data was replaced.');
      contextKey(item.context);validateRange(item.range,item.context.originalSeats===2?32:3);
    }
    return data;
  }
  function save(storage,owner,templates,expectedRevision) {
    const previous=load(storage,owner);
    if(previous.revision!==expectedRevision)throw Error('Range templates changed in another tab. Reopen the study before saving.');
    const next={schemaVersion:1,revision:previous.revision+1,templates:copy(previous.templates)};
    for(const raw of templates){
      const item=create(raw),key=contextKey(item.context),index=next.templates.findIndex(value=>value.playerId===item.playerId && contextKey(value.context)===key);
      if(index===-1){if(next.templates.length>=MAX_TEMPLATES)throw Error('The local range template limit is reached.');next.templates.push(item);}else next.templates[index]=item;
    }
    storage.setItem(keyFor(owner),JSON.stringify(next));return next;
  }
  function candidates(data,input) {
    const key=contextKey(input.context);
    if(!id(input.playerId) || !Array.isArray(input.board) || input.board.length!==5 || input.board.some(value=>!card(value)))return [];
    return data.templates.filter(item=>item.playerId===input.playerId && contextKey(item.context)===key).map(item=>({
      template:copy(item),requiresReview:true,blockedCombinations:item.range.combos.filter(combo=>combo.cards.some(value=>input.board.includes(value))).length,
      boardChanged:JSON.stringify([...item.board].sort())!==JSON.stringify([...input.board].sort()),
      source:'USER_REVIEWED_DECISION_TEMPLATE',conditioningScope:'CONDITIONAL_AT_DECISION'}));
  }
  function removePlayer(storage,owner,playerId) {
    const data=load(storage,owner),next=data.templates.filter(item=>item.playerId!==playerId);
    if(next.length===data.templates.length)return;
    storage.setItem(keyFor(owner),JSON.stringify({...data,revision:data.revision+1,templates:next}));
  }
  return {VERSION,MAX_TEMPLATES,contextFor,contextKey,validateRange,create,load,save,candidates,removePlayer};
});
