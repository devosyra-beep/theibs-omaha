/* Voluntary voice evaluation: immutable prompts, isolated card-state scoring,
 * and aggregate exports. No microphone, persistence, transcript, or audio here. */
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const api = factory(node ? require('./card-voice') : root.TheibsCardVoice,
    node ? require('./card-model') : root.TheibsCards);
  if (node) module.exports = api; else root.TheibsVoiceEvaluation = api;
})(typeof window !== 'undefined' ? window : globalThis, function (voice, cards) {
  'use strict';
  const SCHEMA = 'THEIBS_VOICE_EVALUATION_AGGREGATE_V1';
  const ptRanks = ['ás','dois','três','quatro','cinco','seis','sete','oito','nove','dez','valete','dama','rei'];
  const enRanks = ['ace','two','three','four','five','six','seven','eight','nine','ten','jack','queen','king'];
  const ranks = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
  const suits = ['s','h','d','c'], ptSuits = ['espadas','copas','ouros','paus'], enSuits = ['spades','hearts','diamonds','clubs'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  function corpus({ locale = 'pt-BR', count = 5, split = 'development' } = {}) {
    if (!['pt-BR','en-US'].includes(locale) || ![4,5,6].includes(count) || !['development','evaluation','practice'].includes(split)) throw Error('Invalid evaluation configuration.');
    const en = locale === 'en-US', list = [], suffix = `${locale}-plo${count}`;
    const add = (id, phrase, expected, kind, partition, extra = {}) => list.push(freeze({ id: `${suffix}-${id}`, locale, count,
      split: partition, phrase, expected, kind, ...extra }));
    for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) {
      const canonical = ranks[r] + suits[s], partition = (r + s) % 4 === 0 ? 'development' : 'evaluation';
      // A fixed partition prevents moving troublesome examples into training
      // after inspecting their evaluation result. Every card exists once.
      add(`card-${canonical}`, `${en ? enRanks[r] : ptRanks[r]} ${en ? 'of' : 'de'} ${en ? enSuits[s] : ptSuits[s]}`,
        { type: 'cards', target: 'selected', cards: [canonical] }, 'single', partition);
    }
    add('sequence-hand', en ? 'my cards, ace of spades, ten of hearts, eight of clubs' : 'minhas cartas, ás de espadas, dez de copas, oito de paus',
      { type: 'cards', target: 'hero', cards: ['As','Th','8c'] }, 'sequence', 'development');
    add('sequence-flop', en ? 'flop, king of diamonds, seven of clubs, three of hearts' : 'flop, rei de ouros, sete de paus, três de copas',
      { type: 'cards', target: 'flop', cards: ['Kd','7c','3h'] }, 'sequence', 'evaluation');
    add('short-card', en ? 'eight clubs' : 'oito paus', { type: 'cards', target: 'selected', cards: ['8c'] }, 'short', 'development');
    add('short-queen', en ? 'queen diamonds' : 'dama ouros', { type: 'cards', target: 'selected', cards: ['Qd'] }, 'short', 'evaluation');
    for (const [id, pt, english, expected, partition] of [
      ['call','eu pago','I call',{type:'action',actor:{kind:'hero'},action:'CALL'},'development'],
      ['bet','eu aposto vinte','I bet twenty',{type:'action',actor:{kind:'hero'},action:'BET',to:20},'development'],
      ['raise','adversário dois aumenta para cinquenta','opponent two raises to fifty',{type:'action',actor:{kind:'opponent',number:2},action:'RAISE',to:50},'evaluation'],
      ['decimal','eu aposto dois vírgula cinquenta','I bet two point five',{type:'action',actor:{kind:'hero'},action:'BET',to:2.5},'evaluation'],
      ['fold','adversário um desiste','opponent one folds',{type:'action',actor:{kind:'opponent',number:1},action:'FOLD'},'evaluation'],
      ['check','eu passo','I check',{type:'action',actor:{kind:'hero'},action:'CHECK'},'evaluation'],
      ['all-in','eu all-in','I all-in',{type:'action',actor:{kind:'hero'},action:'ALL_IN'},'evaluation'],
      ['raise-by','adversário dois aumenta em dez','opponent two raises by ten',{type:'action',actor:{kind:'opponent',number:2},action:'RAISE',by:10},'evaluation'],
      ['big-blinds','eu aposto três big blinds','I bet three big blinds',{type:'action',actor:{kind:'hero'},action:'BET',to:3,unit:'bb'},'evaluation']
    ]) add(id, en ? english : pt, expected, 'action', partition);
    add('incomplete', en ? 'eight of' : 'oito de', null, 'reject', 'development');
    add('unknown', en ? 'the weather is pleasant today' : 'o dia está agradável hoje', null, 'reject', 'evaluation');
    add('ambiguous-number', en ? 'one of clubs' : 'um de paus', null, 'reject', 'evaluation');
    add('duplicate', en ? 'ace of spades, ace of spades' : 'ás de espadas, ás de espadas', null, 'reject', 'evaluation');
    if (split === 'practice') {
      // A separate checklist exercises supported command types. Its results
      // stay in practice; some visible prompts also occur in the fixed
      // benchmark, so later evaluation is not blind to a practiced speaker.
      const practice = (id, pt, english, expected, kind, extra = {}) =>
        add(id, en ? english : pt, expected, kind, 'practice', extra);
      practice('destination-hero','minhas cartas','my cards',{type:'target',target:'hero'},'destination');
      practice('destination-board','board','board',{type:'target',target:'board'},'destination');
      practice('cards-turn','turn, dama de ouros','turn, queen of diamonds',
        {type:'cards',target:'turn',cards:['Qd']},'sequence',
        {initial:{board:['As','2h','3c']}});
      practice('cards-river','river, valete de paus','river, jack of clubs',
        {type:'cards',target:'river',cards:['Jc']},'sequence',
        {initial:{board:['As','2h','3c','Qd']}});
      practice('cards-board','board, dois de espadas, cinco de copas, nove de ouros',
        'board, two of spades, five of hearts, nine of diamonds',
        {type:'cards',target:'board',cards:['2s','5h','9d']},'sequence');
      practice('select-hand','selecionar carta três da mão','select card three in hand',
        {type:'select',target:'hero',index:2},'edit',{initial:{hero:['As','Kh','2c'],selected:0}});
      practice('select-board','selecionar carta dois da mesa','select card two on board',
        {type:'select',target:'board',index:1},'edit',{initial:{board:['As','Kh','2c'],selected:0}});
      practice('correct-hand','corrigir carta três da mão para dama de ouros','correct card three in hand to queen of diamonds',
        {type:'correct',target:'hero',index:2,card:'Qd'},'edit',{initial:{hero:['As','Kh','2c'],selected:0}});
      practice('correct-board','corrigir carta dois da mesa para dama de ouros','correct card two on board to queen of diamonds',
        {type:'correct',target:'board',index:1,card:'Qd'},'edit',{initial:{board:['As','Kh','2c'],selected:0}});
      practice('remove-card','remover carta selecionada','remove selected card',
        {type:'remove',target:'selected'},'edit',{initial:{hero:['As','Kh','2c'],selected:2}});
      practice('undo-entry','desfazer','undo',{type:'undo'},'edit',
        {initial:{hero:['As'],selected:0,seedUndo:true}});
      practice('cancel-entry','cancelar','cancel',{type:'cancel'},'edit');
      practice('next-actor','minha vez','my turn',{type:'context'},'context',
        {context:{enabled:true,phase:'BETTING'}});
      for (const [id, pt, english, action, actor] of [
        ['short-fold','desistir','fold','FOLD','hero'],
        ['short-check','passar','check','CHECK','hero'],
        ['short-call','pago','call','CALL','hero'],
        ['short-all-in','all-in','all-in','ALL_IN','hero']
      ]) practice(id,pt,english,{type:'action',actor:null,action},'action',
        {context:{enabled:true,phase:'BETTING'},actionActor:actor});
      practice('short-bet','aposto vinte','bet twenty',
        {type:'action',actor:null,action:'BET',to:20},'action',
        {context:{enabled:true,phase:'BETTING'},actionActor:'hero'});
      practice('short-raise','aumento vinte e cinco','raise twenty five',
        {type:'action',actor:null,action:'RAISE',to:25},'action',
        {context:{enabled:true,phase:'BETTING'},actionActor:'hero'});
      practice('pending-total','vinte e cinco','twenty five',{type:'amount',to:25},'action',
        {context:{enabled:true,phase:'BETTING',pendingAmount:{action:'RAISE'}},actionActor:'hero'});
      practice('wrong-seat','A2 desiste','A2 folds',null,'reject',
        {context:{enabled:true,phase:'BETTING'},actionActor:'hero'});
      return list.map(item => freeze({ ...item, id:`${item.id}-practice`, split:'practice' }));
    }
    return list.filter(item => item.split === split);
  }
  function actionState(command, trial) {
    const players = [{ id:'hero', hero:true, name:'Hero', position:'BTN', streetPaid:0, stack:100 },
      { id:'v1', hero:false, seatName:'A1', name:'ADV.1', position:'SB', streetPaid:0, stack:100 },
      { id:'v2', hero:false, seatName:'A2', name:'ADV.2', position:'BB', streetPaid:0, stack:100 }];
    const unopened = ['BET','CHECK'].includes(command.action);
    const actor = trial?.actionActor || (command.actor?.kind === 'opponent' ? `v${command.actor.number}` : 'hero');
    return { phase:'BETTING', players, heroId:'hero', actor,
      currentBet:unopened ? 0 : 4, bigBlind:2,
      legal:{ actions:unopened ? ['CHECK','BET'] : ['FOLD','CALL','RAISE'], minTo:unopened ? 2 : 8, maxTo:100, toCall:unopened ? 0 : 4 } };
  }
  function simulate(command, trial) {
    if (command.type === 'action') {
      // The fixture actor comes from the expected prompt, never from ASR.
      const expected = trial.expected?.type === 'action' ? trial.expected : { actor:{kind:'hero'} };
      return { event:voice.resolveAction(command, actionState(expected,trial)) };
    }
    if (command.type === 'amount') {
      if (!trial.context?.pendingAmount || !Number.isFinite(command.to)) throw Error('No pending amount.');
      const action = trial.context.pendingAmount.action;
      return { event:voice.resolveAction({type:'action',actor:null,action,to:command.to},
        actionState({actor:null,action},trial)) };
    }
    if (command.type === 'context') {
      if (!trial.context?.enabled) throw Error('No table context.');
      return { nextActor:actionState({actor:null,action:'CALL'},trial).actor };
    }
    const state = new cards.CardKeyboardState(trial.count);
    if (trial.initial) {
      if (!state.setCards(trial.initial.hero || [],trial.initial.board || [],Boolean(trial.initial.seedUndo)))
        throw Error(state.error);
      if (Number.isInteger(trial.initial.selected) && !state.select(trial.initial.selected))
        throw Error('Invalid initial selection.');
    }
    if (!state.applyCommand(command)) throw Error(state.error);
    return { snapshot:state.snapshot() };
  }
  function equal(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
    return ak.length === bk.length && ak.every((k,i) => k === bk[i] && equal(a[k],b[k]));
  }
  function score(trial, text, { outcome = 'final', finalRevisions = 0 } = {}) {
    let command = null, simulated = null, rejected = false;
    if (outcome === 'final') {
      try { command = trial.context ? voice.parseContextual(text, trial.locale,trial.context)
        : voice.parse(text, trial.locale); simulated = simulate(command, trial); }
      catch { rejected = true; }
    }
    const expectedRejected = trial.expected === null;
    const appliedCount = simulated ? 1 : 0;
    const expectedState = expectedRejected ? null : simulate(trial.expected, trial);
    const clarification = Boolean(rejected && voice.getClarification?.(text,trial.locale));
    const exact = outcome === 'final' && finalRevisions === 0 && (expectedRejected ? rejected
      : equal(command, trial.expected) && equal(simulated, expectedState) && appliedCount === 1);
    return { exact, outcome, expectedRejected, appliedCount, rejected,
      wrongApplication: Boolean(simulated && !exact), falseAcceptance: Boolean(expectedRejected && simulated),
      clarification, refusal:Boolean(rejected && !clarification), lost: outcome !== 'final' || (!expectedRejected && appliedCount === 0),
      finalRevisions, scope:'RECOGNITION_AND_ISOLATED_STATE_ONLY' };
  }
  function wilson(success, total) {
    if (!total) return null;
    const z = 1.959963984540054, p = success / total, d = 1 + z*z/total;
    const center = (p + z*z/(2*total))/d, half = z*Math.sqrt(p*(1-p)/total + z*z/(4*total*total))/d;
    return { low:Math.max(0,center-half), high:Math.min(1,center+half), method:'Wilson 95%', independence:'NOT_ESTABLISHED' };
  }
  function percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a,b) => a-b);
    return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];
  }
  const timingKeys = ['startupMs','firstResultMs','speechEndEventToFinalMs','finalToScoreMs','totalMs'];
  function summarize(records) {
    const exact = records.filter(r => r.exact).length;
    return { attempts:records.length, exact, accuracy:records.length ? exact/records.length : null,
      interval:wilson(exact, records.length),
      lost:records.filter(r=>r.lost).length, wrongApplications:records.filter(r=>r.wrongApplication).length,
      falseAcceptances:records.filter(r=>r.falseAcceptance).length, clarifications:records.filter(r=>r.clarification).length,
      refusals:records.filter(r=>r.refusal).length,
      startFailures:records.filter(r=>r.outcome === 'start_failure').length,
      timeouts:records.filter(r=>r.outcome === 'timeout').length, cancellations:records.filter(r=>r.outcome === 'cancelled').length,
      conflictingFinals:records.filter(r=>r.finalRevisions > 0).length,
      timing:Object.fromEntries(timingKeys.map(key => { const values = records.map(r=>r.timing[key]).filter(x=>Number.isFinite(x)&&x>=0);
        return [key,{ n:values.length, missing:records.length-values.length, p50:percentile(values,.5), p95:percentile(values,.95) }]; })) };
  }
  function record(trial, result, timing, { condition='clean', processing='browser', version='unknown' } = {}) {
    if (!['clean','moderate-noise'].includes(condition) || !['browser','device'].includes(processing)) throw Error('Invalid evaluation condition.');
    return freeze({ locale:trial.locale, count:trial.count, split:trial.split, kind:trial.kind, condition, processing,
      version:String(version).slice(0,30), ...Object.fromEntries(['exact','outcome','expectedRejected','appliedCount','rejected',
        'wrongApplication','falseAcceptance','clarification','refusal','lost','finalRevisions','scope'].map(key=>[key,copy(result[key])])), timing:Object.fromEntries(timingKeys.map(key => [key,
        Number.isFinite(timing?.[key]) && timing[key]>=0 ? Math.round(timing[key]*100)/100 : null])) });
  }
  function aggregate(records) {
    const cells = new Map();
    for (const r of records) {
      const dimensions = { locale:r.locale, count:r.count, split:r.split, kind:r.kind, condition:r.condition, processing:r.processing, version:r.version };
      const key = JSON.stringify(dimensions);
      if (!cells.has(key)) cells.set(key,{ dimensions, records:[] });
      cells.get(key).records.push(r);
    }
    return { schema:SCHEMA, source:'VOLUNTARY_LIVE_SPEECH_SELF_REPORTED', scope:'RECOGNITION_AND_ISOLATED_STATE_ONLY',
      acousticEndReference:'PROVIDER_SPEECHEND_EVENT_NOT_WAVEFORM', productionCardLatency:'NOT_MEASURED',
      externalHumanValidation:'NOT_ESTABLISHED', independentSpeakers:'NOT_COLLECTED',
      privacy:{ audioStored:false, transcriptsStored:false, personalIdentifiers:false, upload:false },
      total:summarize(records), cells:[...cells.values()].map(cell => ({...cell.dimensions,...summarize(cell.records)})) };
  }
  return { SCHEMA, corpus, score, record, aggregate, wilson, percentile };
});
