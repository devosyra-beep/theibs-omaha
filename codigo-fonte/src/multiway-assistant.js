'use strict';
// Optional text interpretation only. The event ledger and numerical engine are
// the only authorities. No audio, transcript, or player library is persisted.
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const llama = require('./multiway-llm-provider');
const multiway = require('./multiway-session');
const voice = require('../public/card-voice');
const ranges = require('./range-engine');
const active = new Set();
let priorityJobs = 0;
const requests = new Map();
const normalized = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const actionSchema = { type:'object', additionalProperties:false, properties:{command:{type:'string'}}, required:['command'] };
const actionPrompt = `Convert ONE observed poker action into a short canonical command. Never give advice. If uncertain, conflicting, or not an observed action, return command "UNKNOWN". Do not guess the player or any number. Use current player implicitly. Allowed commands: fold, check, call, all in, raise to N chips, raise to N bb, bet N chips, bet N bb. No explanation. Examples:
"The current player throws his cards away." -> {"command":"fold"}
"Ele completa o valor para continuar na mão." -> {"command":"call"}
"He makes it a total of five big blinds this street." -> {"command":"raise to 5 bb"}
"He knocks on the table without betting." -> {"command":"check"}
"Talvez ele tenha aumentado, não tenho certeza." -> {"command":"UNKNOWN"}`;
function audit() {
  try { return require('./multiway-assistant-validation.json'); }
  catch { return { models:{}, rule:'UNVALIDATED_USES_DISABLED' }; }
}
let contractHash;
function contractFingerprint() {
  return contractHash ||= digest(['multiway-assistant.js','multiway-llm-provider.js','multiway-session.js','hand-flow.js','../public/card-voice.js']
    .map(file=>fs.readFileSync(path.join(__dirname,file),'utf8').replace(/\r\n/g,'\n')));
}
function validatedModel(settings) {
  const found = audit().models[`${settings.provider}:${settings.model}`];
  return found?.contractHash === contractFingerprint() && found.passed === true ? found : null;
}
function capabilities() {
  let state;
  try { state = llama.publicState(); } catch { state = { config:{provider:'none',model:''} }; }
  const validated = validatedModel(state.config);
  return { provider:state.config.provider, model:state.config.model || null, processing:state.config.provider==='cloudflare'?'REMOTE_TEXT_ONLY':'LOCAL_SERVER_TEXT_ONLY',
    audio:false, speechSynthesis:false, automaticExecution:false,
    validatedUses:validated?.uses || [], enabled:['ollama','cloudflare'].includes(state.config.provider) && state.configured!==false && Boolean(validated?.uses?.length),
    busy:priorityJobs>0 || active.size>0, availability:state.availability, validation:validated || null,
    reason:state.reason || (!validated?'This model has not passed the interpretation gate.':null),
    remoteTextConsentRequired:state.config.provider==='cloudflare' };
}
function prioritize() {
  priorityJobs++;
  for (const controller of active) controller.abort(Error('Table input or calculation has priority.'));
  let released=false;
  return () => { if(!released){released=true;priorityJobs=Math.max(0,priorityJobs-1);} };
}
function textInput(raw) {
  const value=String(raw || '').trim();
  if(!value || value.length>500)throw Error('Use one phrase with at most 500 characters.');
  return value;
}
function originId(value) {
  if(typeof value!=='string'||!/^[a-zA-Z0-9:._-]{8,128}$/.test(value))throw Error('A final speech event identifier is required.');
  return value;
}
function currentContext(record, revisionKey) {
  const envelope=multiway.envelope(record);
  if(envelope.state.revisionKey!==revisionKey)throw Error('The hand changed. Repeat the phrase for the current state.');
  return {...envelope,revisionKey:envelope.state.revisionKey,revision:envelope.state.revision};
}
function ambiguous(text) {
  return /\b(maybe|perhaps|might|not|never|either|or|talvez|acho|parece|ou|nao|nunca|should|deveria)\b/.test(normalized(text));
}
function explicitActor(text,state) {
  const value=normalized(text),matches=new Set();
  if(/\b(hero|heroi|nosso jogador)\b/.test(value)||/\b(i|eu)\s+(call|fold|check|raise|bet|pago|passo|desisto|aumento|aposto)\b/.test(value))matches.add(state.heroId);
  const positionAliases={SB:['sb','small blind'],BB:['bb','big blind'],BTN:['btn','button','botao'],
    CO:['co','cutoff','cut off'],HJ:['hj','hijack'],LJ:['lj','lojack'],UTG:['utg','under the gun']};
  const positions=player=>String(player.position||'').split('/').flatMap(position=>positionAliases[position.toUpperCase()]||[normalized(position)]);
  const allPositions=new Set(state.players.flatMap(positions));
  const subjectPosition=label=>{
    const safe=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    // A position names the subject at the start of a clause or following an
    // article. A numeric quantity followed by BB names a unit, not a player.
    return new RegExp(`(?:^|[.;!?]\\s*|\\b(?:the|o|a)\\s+)${safe}(?=\\s|[,;:.!?]|$)`,'i').test(value);
  };
  for(const p of state.players){
    const labels=[p.seatName,p.name,p.playerId].filter(Boolean).map(normalized).filter(label=>!allPositions.has(label));
    if(labels.some(label=>label.length>1 && (` ${value.replace(/[.,;:!?]/g,' ')} `).includes(` ${label} `)))matches.add(p.id);
    if(positions(p).some(subjectPosition))matches.add(p.id);
  }
  const refs=value.match(/\ba\d+\b/g)||[];
  if(refs.some(ref=>!state.players.some(p=>normalized(p.seatName)===ref)))throw Error('That seat is not at this table.');
  if(matches.size>1)throw Error('More than one player matches. Select a player first.');
  if(matches.size===1 && [...matches][0]!==state.actor)throw Error('That player is not next to act.');
}
function sourceAmounts(text) {
  const numberWord=/^(?:\d+(?:[.,]\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|mil)$/;
  // "um total de" is an article, not a second amount.
  const tokens=normalized(text).replace(/\bum total\b/g,'total').replace(/[!?;]/g,' ').split(/\s+/),spans=[];
  for(let i=0;i<tokens.length;i++)if(numberWord.test(tokens[i])){
    const words=[tokens[i]];
    while(i+1<tokens.length&&(numberWord.test(tokens[i+1])||/^(and|e|point|ponto|virgula)$/.test(tokens[i+1])&&numberWord.test(tokens[i+2]||'')))words.push(tokens[++i]);
    const parsed=[];
    for(const locale of ['pt-BR','en-US'])try{const n=voice.parseChips(words.join(' '),locale);if(Number.isFinite(n))parsed.push(n);}catch{}
    spans.push([...new Set(parsed)]);
  }
  return spans;
}
function validateAction(command,text,state) {
  if(!command || typeof command!=='object' || command.type!=='action')throw Error('No complete observed action was identified. Use the action buttons or a short command.');
  if(ambiguous(text))throw Error('The action is uncertain. Choose the observed action.');
  explicitActor(text,state);
  if(command.action==='ALL_IN'&&sourceAmounts(text).length)throw Error('All-in uses the current stack. Confirm the stack or say all in without another amount.');
  if(['BET','RAISE'].includes(command.action) && command.to===undefined && command.by===undefined)throw Error('Enter the amount and its unit.');
  if(['BET','RAISE'].includes(command.action)) {
    const source=normalized(text);
    if(!/\b(chips?|fichas?|bb|big blinds?|blinds? grandes?)\b/.test(source))throw Error('Specify chips or big blinds.');
    const sourceUnit=/\b(bb|big blinds?|blinds? grandes?)\b/.test(source)?'bb':'chips';
    if((command.unit||'chips')!==sourceUnit)throw Error('The interpreted unit does not match the phrase.');
    if(command.action==='BET'&&!/\b(bet|bets|wager|wagers|aposto|apostou|aposta)\b/.test(source))throw Error('Choose Bet or Raise and enter the total.');
    if(command.action==='RAISE'&&!/\b(raise|raises|raised|aumento|aumentou|sobe|subiu|makes it|make it)\b/.test(source))throw Error('Specify the observed raise and total amount.');
    if(/\b(by|mais|em)\s+(\d|one|two|three|four|five|six|seven|eight|nine|ten|um|dois|tres)/.test(source))throw Error('Specify the total committed this street.');
    // The model may translate numbers but cannot invent a number absent from
    // the utterance. Validate source numbers using the same numeric parser.
    const quantities=sourceAmounts(text);
    if(quantities.length!==1||quantities[0].length!==1)throw Error('Use one unambiguous total amount for this street.');
    const values=quantities[0];
    const supplied=command.to??command.by;
    if(!values.some(value=>Math.abs(value-supplied)<1e-8))throw Error('The interpreted amount does not match the phrase. Enter it directly.');
  }
  const event=voice.resolveAction(command,state);
  // Replay performs the complete domain validation, including reopening,
  // pot-limit, stack and all-in rules; the model never supplies these values.
  return {type:'ACT',...event};
}
async function interpret(payload,{owner='local',signal,config,fetchImpl,allowUnvalidated=false}={}) {
  const text=textInput(payload.text),id=originId(payload.originEventId),context=currentContext(payload.multiway,payload.revisionKey);
  const state=context.state;
  if(state.phase!=='BETTING'||state.actor==null)throw Error('The table is not waiting for a betting action.');
  explicitActor(text,state);
  if(ambiguous(text))return {status:'CLARIFY',reason:'Choose one observed action. Nothing was recorded.',originEventId:id,revisionKey:context.revisionKey};
  const binding=digest({owner,hand:payload.multiway.handId,id}),signature=digest({text,revisionKey:context.revisionKey});
  const previous=requests.get(binding);
  if(previous && previous.expires>Date.now()){
    if(previous.signature!==signature)throw Error('This source event was already used for a different phrase or hand state.');
    return previous.promise;
  }
  let direct;
  try { direct=voice.parseContextual(text,payload.locale||'en-US',{enabled:true,phase:state.phase}); } catch{}
  if(direct?.type==='action'){
    const event=validateAction(direct,text,state);
    multiway.step(payload.multiway,{...event,originEventId:id},context.revision,context.revisionKey);
    return {status:'PROPOSED',method:'DIRECT_PARSER',command:direct,event,originEventId:id,revisionKey:context.revisionKey,confirmationRequired:true};
  }
  const settings=config||llama.runtimeConfig(),gate=validatedModel(settings);
  if(!allowUnvalidated && !gate?.uses?.includes('ACTION_PROPOSAL'))return {status:'UNAVAILABLE',reason:'This model has not passed the interpretation gate. Use the action buttons or a short voice command.'};
  if(priorityJobs>0)return {status:'BUSY',reason:'Calculation has priority. Use the action buttons or a short voice command.'};
  const task=(async()=>{
    const controller=new AbortController();active.add(controller);
    const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    try {
      const result=await llama.chat({...settings,timeoutMs:Math.min(settings.timeoutMs||8000,8000)},[{role:'system',content:actionPrompt},{role:'user',content:text}],{format:actionSchema,maxTokens:48,signal:combined,fetchImpl,owner,remoteTextConsent:payload.remoteTextConsent===true});
      combined.throwIfAborted();
      let value;try{value=JSON.parse(result.text);}catch{throw Error('The model did not return a complete structured proposal.');}
      if(!value||Array.isArray(value)||Object.keys(value).length!==1||typeof value.command!=='string'||value.command.length>100)throw Error('Invalid interpretation schema.');
      if(value.command==='UNKNOWN')return {status:'CLARIFY',reason:'Choose the observed action. Nothing was recorded.',originEventId:id,revisionKey:context.revisionKey};
      const command=voice.parseContextual(value.command,'en-US',{enabled:true,phase:state.phase}),event=validateAction(command,text,state);
      multiway.step(payload.multiway,{...event,originEventId:id},context.revision,context.revisionKey);
      return {status:'PROPOSED',method:settings.provider==='cloudflare'?'REMOTE_LLM_INTERPRETATION':'LOCAL_LLM_INTERPRETATION',provider:settings.provider,model:settings.model,command,event,originEventId:id,
        revisionKey:context.revisionKey,handId:payload.multiway.handId,elapsedMs:result.inference.elapsedMs,confirmationRequired:true};
    } finally { active.delete(controller); }
  })();
  for(const [key,entry] of requests)if(entry.expires<Date.now())requests.delete(key);
  while(requests.size>=100)requests.delete(requests.keys().next().value);
  requests.set(binding,{signature,promise:task,expires:Date.now()+30000});
  return task;
}
function findPlayers(players,query) {
  const needle=normalized(textInput(query));
  const exact=players.filter(p=>normalized(p.nickname||p.name)===needle||p.playerId===query);
  const found=exact.length?exact:players.filter(p=>normalized(p.nickname||p.name).includes(needle));
  return {status:found.length===1?'MATCH':found.length?'SELECT_PLAYER':'NOT_FOUND',players:found.map(p=>({playerId:p.playerId,nickname:p.nickname||p.name}))};
}
function proposeRange({variant,playerId,position,action,hands,weights,sourceText}) {
  if(!playerId)throw Error('Select the player for this range.');
  const count=require('./variants').holeCount(variant);
  let value;
  if(hands)value=ranges.normalizeRange({hands,weights,source:'USER_EXPLICIT_RESTRICTION'},0,count);
  else {
    if(count!==5)throw Error('The existing starter profiles apply only to PLO5.');
    value=ranges.normalizeRange(ranges.getDefaultRange({position,action}),0,count);
  }
  return {status:'PROPOSED',playerId,range:ranges.serializeRange(value),source:'USER_CONFIRMED_ASSUMPTION',
    sourceText:textInput(sourceText),confirmationRequired:true,scope:{variant,position,action},notGTO:true};
}
module.exports={capabilities,prioritize,interpret,validateAction,findPlayers,proposeRange,actionPrompt,actionSchema,contractFingerprint};
