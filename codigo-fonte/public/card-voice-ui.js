/* Analyze-only microphone adapter. Final validated commands apply once through
 * the keyboard/ledger boundary. No audio or transcript persistence. */
(function () {
  'use strict';
  if (typeof document === 'undefined' || !window.TheibsCardVoice || !window.theibsCardKeyboard) return;
  const host = document.querySelector('#analyze-workspace .table-column');
  if (!host) return;
  const voice = window.TheibsCardVoice, keyboard = window.theibsCardKeyboard, session = new voice.RecognitionSession();
  const panel = document.createElement('section'); panel.id = 'card-voice'; panel.setAttribute('aria-label', 'Voice input for cards and observed actions');
  panel.innerHTML = `<div class="voice-heading"><strong>Voice input</strong><span id="voice-capture-state" class="voice-badge" aria-live="polite">Voice off</span><span id="voice-mode-badge" class="voice-badge">Automatic entry</span></div>
    <div class="voice-options"><label>Recognition language<select id="voice-language"><option value="pt-BR">Portuguese (Brazil) · PT-BR</option><option value="en-US">English (US) · EN-US</option></select></label>
    <label>Audio processing<select id="voice-processing"><option value="browser">Browser speech service</option><option value="device">On this device only</option></select></label></div>
    <p id="voice-language-description" class="voice-help">Choose the language you will speak. The command guide below follows this selection.</p>
    <label class="voice-consent"><input id="voice-auto-apply" type="checkbox" checked> Apply validated final cards and actions automatically</label>
    <p id="voice-privacy" class="voice-help">Your browser's speech service may send audio to its provider. Processing and retention depend on the provider. THEIBS does not record audio or save transcripts.</p>
    <label class="voice-consent"><input id="voice-consent" type="checkbox"> Enable voice commands</label>
    <div class="voice-actions"><button id="voice-hold" type="button">Hold to speak</button><button id="voice-toggle" type="button" aria-pressed="false" title="Alt+V">Start voice · Alt+V</button><button id="voice-cancel" type="button" disabled>Cancel</button><button id="voice-undo" type="button" disabled>Undo last entry</button></div>
    <p id="voice-status" role="status" aria-live="polite">Select the language you will speak. The card keyboard remains available.</p>
    <div id="voice-review" hidden><p class="voice-help">Review the phrase and destination before applying:</p><output id="voice-transcript"></output><strong id="voice-proposal"></strong><button id="voice-apply" type="button">Apply reviewed batch</button></div>
    <div id="voice-language-guides">
      <section data-voice-language-guide="pt-BR"><p class="voice-help">Speak complete cards in one phrase, for example: “ás copas, dez paus, dama ouros, valete espadas”. In Multiway, the table selects Hero or the next board street. You can name a destination to edit it explicitly.</p>
      <p class="voice-help">When a player is highlighted, say one short observed action: “desistir”, “passar”, “pago”, “aposto vinte”, “aumento vinte e cinco” or “all-in”. The action belongs to that player. “A1 desistir” names a seat explicitly and must match the current turn. A raise amount is the player's total contribution for this street. Say “aumento” alone, then speak the total when the inline field appears. THEIBS never sends a bet to an external table.</p>
      <details><summary>Portuguese commands and numbers</summary><p class="voice-help">Ranks: ás, dois, três, quatro, cinco, seis, sete, oito, nove, dez, valete, dama/rainha, rei. Suits: espadas, copas, ouros, paus. Digits 2–10 also work; “ás/A” and “valete/jota/jack” are accepted variants. “De” is optional between rank and suit.</p><p class="voice-help">Destinations and edits: “minhas cartas”, “flop”, “turn”, “river”, “board”, “selecionar carta três”, “corrigir carta três para dama de ouros”, “remover carta selecionada”, “desfazer”, “cancelar”. Multiway selects the expected cards automatically; in isolated Analysis, the selected slot is used. You can speak board cards one at a time or as the complete street.</p><p class="voice-help">Multiway actions: “desistir”, “passar”, “pagar”, “apostar”, “aumentar”, “all-in”. “Eu”/“herói” or “adversário N” may identify the player explicitly; if spoken, that player must be next. “Minha vez” reports who is next without recording an action. For example, “dois vírgula cinquenta” means 2.50. Whole numbers are supported up to 999999.99. Call uses the table's current price; all-in uses the available stack only when legal. Speak one action per phrase and provide only the requested detail when prompted.</p></details></section>
      <section data-voice-language-guide="en-US" hidden><p class="voice-help">Speak complete cards in one phrase, for example: “ace hearts, ten clubs, queen diamonds, jack spades”. In Multiway, the table selects Hero or the next board street. You can name a destination to edit it explicitly.</p>
      <p class="voice-help">When a player is highlighted, say one short observed action: “fold”, “check”, “call”, “bet twenty”, “raise twenty five” or “all-in”. The action belongs to that player. “A1 fold” names a seat explicitly and must match the current turn. A raise amount is the player's total contribution for this street. Say “raise” alone, then speak the total when the inline field appears. THEIBS never sends a bet to an external table.</p>
      <details><summary>English commands and numbers</summary><p class="voice-help">Ranks: ace, two, three, four, five, six, seven, eight, nine, ten, jack, queen, king. Suits: spades, hearts, diamonds, clubs. “Of” is optional between rank and suit. Digits 2–10 also work; “to”, “for”, “ate”, and “one” are not cards.</p><p class="voice-help">Destinations and edits: “my cards”, “flop”, “turn”, “river”, “board”, “select card three”, “correct card three to queen of diamonds”, “remove selected card”, “undo”, “cancel”. Multiway selects the expected cards automatically; in isolated Analysis, the selected slot is used. You can speak board cards one at a time or as the complete street.</p><p class="voice-help">Multiway actions: “fold”, “check”, “call”, “bet”, “raise”, “all-in”. “Hero”/“I” or “opponent N” may identify the player explicitly; if spoken, that player must be next. “My turn” reports who is next without recording an action. For example, “two point five” means 2.50. Whole numbers are supported up to 999999.99. Call uses the table's current price; all-in uses the available stack only when legal. Speak one action per phrase and provide only the requested detail when prompted.</p></details></section>
    </div>`;
  // The existing deck lives in Settings. Voice needs the visible Analyze
  // canvas, where the normal keyboard path and slot selection remain active.
  const disclosure = document.createElement('details'); disclosure.id = 'card-voice-disclosure';
  const summary = document.createElement('summary');
  const summaryLabel = document.createElement('span'); summaryLabel.textContent = 'Voice input · PT-BR';
  const captureBadge = panel.querySelector('#voice-capture-state');
  summary.append(summaryLabel, captureBadge);
  disclosure.append(summary, panel); host.append(disclosure);
  disclosure.open = false;
  const activation=panel.querySelector('#voice-consent').closest('label'), consent=panel.querySelector('#voice-consent');
  activation.classList.add('voice-activation');
  const activationCopy=document.createElement('span');
  activationCopy.innerHTML='<strong>Enable voice commands</strong><small id="voice-consent-description">Turn on to listen continuously; turn off to stop. Browser speech processing may be remote. THEIBS does not record audio.</small>';
  activation.replaceChildren(consent,activationCopy);
  const actions=panel.querySelector('.voice-actions'), advanced=document.createElement('details'), help=document.createElement('details');
  advanced.className='voice-advanced';advanced.innerHTML='<summary>Recognition language & options</summary><div class="voice-extra-actions"></div>';
  help.className='voice-guide';help.innerHTML='<summary>Voice commands & privacy</summary>';
  advanced.append(panel.querySelector('.voice-options'),panel.querySelector('#voice-language-description'),panel.querySelector('#voice-auto-apply').closest('label'),panel.querySelector('#voice-mode-badge'));
  advanced.querySelector('.voice-extra-actions').append(panel.querySelector('#voice-hold'),panel.querySelector('#voice-toggle'));
  advanced.querySelector('#voice-hold').hidden=true;
  advanced.querySelector('#voice-toggle').hidden=true;
  panel.querySelectorAll(':scope > .voice-help').forEach(item=>help.append(item));
  help.append(panel.querySelector('#voice-language-guides'));
  panel.querySelector('.voice-heading').after(activation,panel.querySelector('#voice-status'),actions,advanced,help);
  panel.querySelector('.voice-heading').remove();
  // Voice controls live inside the analysis form, but changing them must not
  // invalidate the hand while microphone permission is being resolved.
  for (const name of ['input', 'change']) panel.addEventListener(name, event => event.stopPropagation());
  const $ = id => panel.querySelector('#' + id), status = $('voice-status'), review = $('voice-review');
  let run = null, committing = false, monitor = null, restartTimer = null, sample = null, lastLedgerUndo = null;
  let captureHold = false;
  let clarification = null, clarificationTimer = null;
  const nativeCaptures = new Set(), diagnostics = [];
  let wantListening = false, operationEpoch = 0, lastApplied = '', restartContext = null;
  let softRetryCount = 0;
  let feedbackKind = null, feedbackTimer = null, rebindTimer = null, blockedReason = '';
  const autoApply = () => $('voice-auto-apply').checked;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let microphonePermission = 'prompt';
  const availableDevices = new Map();
  let lastAudioEndedAt = null;
  const metrics = []; // Timing only; no text, audio, cards, identities, or persistence.
  function trace(current, event, extra = {}) {
    diagnostics.push({ event, at: performance.now(), capture: current?.id ?? null, ...extra });
    if (diagnostics.length > 300) diagnostics.shift();
  }
  const audioReady = () => Boolean(run?.audioActive && !run.closing && !committing);
  function captureState() {
    if (committing) return 'applying';
    if (run?.closing) return 'finalizing';
    if (audioReady()) return clarification ? 'clarifying' : 'listening';
    if (run?.audioEnded) return 'processing';
    if (run) return 'starting';
    if (session.phase === 'review') return 'review';
    if (wantListening && blockedReason) return 'blocked';
    if (wantListening) return 'restarting';
    return 'idle';
  }
  function say(text, error = false) {
    status.textContent = text; status.classList.toggle('voice-error', error);
    if (error) feedbackKind = 'error';
    else if (feedbackKind === 'error') feedbackKind = null;
    controls();
  }
  function followUpPrompt(request) {
    const portuguese = $('voice-language').value === 'pt-BR';
    const examples = portuguese
      ? { actor:'“eu” or “adversário um”', opponentNumber:'the opponent number shown at the table', action:'“desistir”, “passar”, “pagar”, “apostar” or “aumentar”', raiseBasis:'“para” for a total or “em” for an increment', amount:'an amount in chips or BB', amountTail:'the remaining amount', suit:'“espadas”, “copas”, “ouros” or “paus”', rank:'“ás”, “dois” through “dez”, “valete”, “dama” or “rei”' }
      : { actor:'“hero” or “opponent one”', opponentNumber:'the opponent number shown at the table', action:'“fold”, “check”, “call”, “bet” or “raise”', raiseBasis:'“to” for a total or “by” for an increment', amount:'an amount in chips or BB', amountTail:'the remaining amount', suit:'“spades”, “hearts”, “diamonds” or “clubs”', rank:'“ace”, “two” through “ten”, “jack”, “queen” or “king”' };
    const label = ({ actor:'Who acted?', opponentNumber:'Which opponent?', action:'Which action?', raiseBasis:'Raise to a total or by an increment?', amount:'What is the amount?', amountTail:'Finish the amount.', suit:'Which suit?', rank:'Which card rank?' })[request?.missing] || 'Complete the command.';
    return `${label} Say ${examples[request?.missing] || 'the missing detail'} in the selected recognition language.`;
  }
  function displayError(error) {
    const message = String(error?.message ?? error ?? '');
    if (!message) return 'Voice command not understood. Try again.';
    if (/naipe|suit|carta completa/i.test(message)) return 'Say a complete card with its suit, then try again.';
    if (/duplicad|same card/i.test(message)) return 'The same card appears more than once. Nothing was applied.';
    if (/advers|ator|jogador|opponent|actor/i.test(message)) return 'Check the opponent number and whose turn it is, then try again.';
    if (/valor|aposta|incremento|fichas|stack|blind|amount/i.test(message) && /[À-ÿ]|\b(valor|aposta|incremento|fichas)\b/i.test(message)) return 'Check the bet amount and table limits, then try again.';
    if (/[À-ÿ]|\b(Comando|Diga|Escolha|Frase|Essa|Esse|Não|Use valor|Sem |O idioma|entrada)\b/i.test(message)) return 'Voice command not understood. Check the selected language and command guide, then try again.';
    return message;
  }
  function recognized() {
    clearTimeout(feedbackTimer);
    feedbackKind = 'recognized'; controls();
    feedbackTimer = setTimeout(() => { feedbackKind = null; feedbackTimer = null; controls(); }, 2600);
  }
  function active() {
    return window.isSecureContext && !document.hidden && navigator.onLine !== false &&
      !window.theibsVoiceSessionContext?.().expired &&
      !document.querySelector('#analyze-workspace').classList.contains('hidden') &&
      !document.querySelector('#app-shell')?.hidden && !document.querySelector('#app-shell')?.hasAttribute('inert') &&
      !document.querySelector('dialog[open]') && document.body.dataset.multiwayBusy !== 'true';
  }
  function context() {
    return { revision: keyboard.getRevision(), snapshot: keyboard.state.snapshot(), invalid: keyboard.isManualInvalid(),
      locale: $('voice-language').value, processing: $('voice-processing').value, pace: 'batch', autoApply: autoApply(),
      active: active(), app: window.theibsApp?.getVoiceContext?.() || { activeView: window.theibsApp?.getState?.().activeView },
      multiway: window.theibsMultiwayUI?.voiceContext?.() || null };
  }
  const pending = () => Boolean(run) || wantListening || session.phase === 'review';
  function controls() {
    const listening = Boolean(run) || wantListening;
    const locale = $('voice-language').value;
    summaryLabel.textContent = `Voice input · ${locale.toUpperCase()}`;
    panel.querySelectorAll('[data-voice-language-guide]').forEach(guide => { guide.hidden = guide.dataset.voiceLanguageGuide !== locale; });
    $('voice-mode-badge').textContent = autoApply() ? 'Automatic entry' : 'Review before applying';
    $('voice-toggle').textContent = listening ? 'Stop voice · Alt+V' : 'Start voice · Alt+V';
    $('voice-toggle').setAttribute('aria-pressed', String(listening));
    $('voice-cancel').disabled = !pending() && !committing; panel.classList.toggle('is-listening', audioReady());
    const phase = captureState(); panel.dataset.captureState = phase;
    const badgeState = wantListening && microphonePermission === 'denied' && !audioReady() ? 'permission'
      : feedbackKind === 'error' ? 'error'
      : feedbackKind === 'recognized' && ['idle', 'listening'].includes(phase) ? 'recognized'
      : phase;
    captureBadge.dataset.state = badgeState;
    captureBadge.textContent = badgeState === 'recognized' ? (phase === 'listening' ? '✓ Recognized · listening' : '✓ Command recognized')
      : badgeState === 'error' ? (audioReady() ? 'Error · listening' : 'Voice error')
      : badgeState === 'permission' ? 'Permission denied'
      : ({ idle:!Recognition?'Voice unavailable':'Voice off', starting:'Starting microphone', listening:'● Listening', clarifying:'● Listening for answer', processing:'Processing', finalizing:'Finishing', restarting:'Restarting', blocked:'Paused · waiting', applying:'Applying', review:'Review command' })[phase];
    captureBadge.title = status.textContent || captureBadge.textContent;
    $('voice-hold').disabled = committing || !Recognition || !window.isSecureContext;
    $('voice-toggle').disabled = (committing && !listening) || !Recognition || !window.isSecureContext;
    $('voice-consent').disabled = committing;
    const tableUndo=window.theibsMultiwayUI?.getState?.()?.state?.log?.some(event=>!['SB','BB'].includes(event.action));
    $('voice-undo').disabled = committing || !(tableUndo || keyboard.state.undoStack.length || lastLedgerUndo);
  }
  // Speak a full card or action sequence. Interim speech never closes capture.
  function requestFinal(current, reason) {
    if (run !== current || current.cancelled || current.closing) return;
    current.closing = true; current.stopRequestedAt = performance.now(); current.stopReason = reason; trace(current,'stop-request',{reason}); controls();
    say('Finishing the phrase… waiting for the final result.');
    try { current.recognition.stop(); } catch { if (wantListening) suspend('Could not finish the phrase. Restarting the microphone.', true); else cancel('Microphone stopped after a finalization error.'); }
  }
  function clearTimers() { clearInterval(monitor); monitor = null; clearTimeout(restartTimer); restartTimer = null; restartContext = null; }
  function cancel(message) {
    const old = run; run = null; wantListening = false; captureHold = false; operationEpoch++; session.cancel(); clearTimers(); review.hidden = true;
    clearTimeout(rebindTimer); rebindTimer = null; blockedReason = '';
    clearTimeout(feedbackTimer); feedbackTimer = null; feedbackKind = null;
    $('voice-consent').checked = false;
    clearTimeout(clarificationTimer); clarificationTimer = null; clarification = null;
    $('voice-transcript').textContent = ''; $('voice-proposal').textContent = '';
    if (old) { old.cancelled = true; try { old.recognition?.abort(); } catch {} }
    controls(); if (message) say(message);
  }
  function scheduleRebind(delay = 180) {
    clearTimeout(rebindTimer);
    if (!wantListening || !$('voice-consent').checked || run || session.phase === 'review' || committing) return;
    rebindTimer = setTimeout(() => {
      rebindTimer = null;
      if (!wantListening || !$('voice-consent').checked || run || session.phase === 'review' || committing) return;
      if (microphonePermission === 'denied') { blockedReason = 'Allow microphone access in your browser settings to resume.'; controls(); scheduleRebind(1200); return; }
      if (!Recognition || !window.isSecureContext) { blockedReason = 'Speech recognition is unavailable. Use HTTPS and a compatible browser.'; controls(); return; }
      if (window.theibsVoiceEvaluation?.isActive() || !active() || keyboard.isManualInvalid()) {
        blockedReason = 'Waiting for the table, page, and session to become available.';
        controls(); scheduleRebind(600); return;
      }
      blockedReason = ''; void start({ resume: true });
    }, delay);
  }
  function suspend(message, error = false) {
    if (!wantListening && !$('voice-consent').checked) return;
    const old = run; run = null; wantListening = true; captureHold = false; operationEpoch++;
    session.cancel(); clearTimers(); review.hidden = true;
    clearTimeout(feedbackTimer); feedbackTimer = null; feedbackKind = null;
    clearTimeout(clarificationTimer); clarificationTimer = null; clarification = null;
    $('voice-transcript').textContent = ''; $('voice-proposal').textContent = '';
    if (old) { old.cancelled = true; try { old.recognition?.abort(); } catch {} }
    blockedReason = message;
    controls(); say(message, error); scheduleRebind(error ? Math.min(4000, 500 * 2 ** Math.min(softRetryCount++, 3)) : 180);
  }
  async function waitForNativeRelease() {
    if (!nativeCaptures.size) return;
    let timeout;
    try {
      await Promise.race([Promise.all([...nativeCaptures].map(item => item.released)), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Error('The microphone is still closing. Wait and try again.')), 3000);
      })]);
    } finally { clearTimeout(timeout); }
  }
  async function releaseCaptureForEvaluation() {
    if (committing) throw Error('Wait for the current entry to finish applying.');
    suspend('Table voice input is paused during the voice evaluation.');
    await waitForNativeRelease();
  }
  function parseFinal(text, locale) {
    const multiway=context().multiway;
    if (clarification) {
      if (performance.now() >= clarification.expiresAt || JSON.stringify(context()) !== clarification.contextKey) throw Error('The follow-up request expired. Say the full command again.');
      // A player may repeat the whole card instead of answering only the
      // missing rank or suit. Treat that as a fresh complete command.
      try { return voice.parseContextual(text, locale, multiway); } catch {}
      const result = voice.completeClarification(clarification.request, text, locale);
      if (result.command) return result.command;
      return { type:'clarify', clarification: result.clarification || clarification.request, error: result.error };
    }
    try { return voice.parseContextual(text, locale, multiway); }
    catch (error) {
      const request = voice.getClarification(text, locale);
      if (request) return { type:'clarify', clarification:request };
      throw error;
    }
  }
  function askForComplement(current, captured, proposal) {
    if (!['suit','rank'].includes(proposal.clarification.missing) && !captured.multiway?.enabled) { suspend('Enable Multiway to record observed actions.'); return; }
    if (!wantListening) { suspend(`${followUpPrompt(proposal.clarification)} Say the full command again.`); return; }
    if (!session.take(captured)) { suspend('The entry changed. Say the command again.'); return; }
    const request = proposal.clarification;
    clarification = { request, contextKey:JSON.stringify(captured), expiresAt:performance.now()+15000 };
    clearTimeout(clarificationTimer);
    clarificationTimer = setTimeout(expireClarification, 15000);
    trace(current,'clarification-request',{missing:request.missing});
    if (current && run === current) {
      current.clarified = true;
      if (!session.resume(current.id, captured)) { suspend('Say the full command again.'); return; }
      watchContext();
    } else session.cancel();
    say(`${proposal.error ? displayError(proposal.error)+' ' : ''}${followUpPrompt(request)}${audioReady() ? '' : ' Wait for the Listening indicator.'}`, Boolean(proposal.error)); controls();
    if (!run && wantListening) resumeCapture();
  }
  const expectedContext = () => restartTimer ? restartContext : session.context;
  function watchContext() {
    clearInterval(monitor);
    monitor = setInterval(() => {
      if (!committing && run && JSON.stringify(context()) !== expectedContext()) suspend('The table context changed. Say the command again.');
    }, 150);
  }
  function boardCommand(command, captured) {
    const mw = captured.multiway;
    if (!mw?.enabled) { if(command.type==='action')throw Error('Enable Multiway to record observed actions.'); return null; }
    if(command.type==='context')return {context:true};
    if(command.type==='amount'){
      if(!mw.pendingAmount)throw Error('No bet or raise amount is pending for this player.');
      return {amount:command.to};
    }
    if(command.type==='action')return command.to===undefined&&command.by===undefined&&['BET','RAISE'].includes(command.action)
      ? {actionPending:command} : {action:voice.resolveAction(command,mw.actionState)};
    if(command.type==='cancel'&&mw.pendingAmount)return {cancelPending:true};
    if(command.type==='cards'&&command.target==='selected'&&mw.phase==='BETTING'&&mw.destination!=='hero')
      throw Error('The table is waiting for the highlighted player’s action. Select a card destination explicitly to edit cards.');
    if (command.type === 'undo') {
      const start=captured.snapshot.count+(mw.board?.length||0),needed=mw.nextStreet==='FLOP'?3:1;
      if(mw.phase==='WAIT_BOARD'&&captured.snapshot.slots.slice(start,start+needed).some(Boolean))return {undoPendingBoard:true};
      if(window.theibsApp?.getState?.().multiway?.events?.length)return {undo:true};
      if(keyboard.state.undoStack.length)return null;
      throw Error('No confirmed action or card entry can be undone in this context.');
    }
    const boardTarget = ['flop', 'turn', 'river', 'board'].includes(command.target) ||
      command.type==='cards' && command.target==='selected' && mw.phase==='WAIT_BOARD' && mw.destination==='board' &&
      captured.snapshot.selected>=captured.snapshot.count;
    if (!boardTarget) return null;
    if (mw.phase !== 'WAIT_BOARD') throw Error('The Multiway board accepts the next street only after betting ends.');
    if (command.type !== 'cards') throw Error('For Multiway, say the street together with all of its cards.');
    const target = mw.nextStreet.toLowerCase();
    if (command.target !== target && command.target !== 'board' && command.target !== 'selected') throw Error('The spoken street is not the next street in the action history.');
    const needed=target==='flop'?3:1,start=captured.snapshot.count+(mw.board?.length||0);
    const staged=captured.snapshot.slots.slice(start,start+needed).filter(Boolean).map(window.TheibsCards.toCanonical);
    if(!command.cards.length||command.cards.length>needed-staged.length)
      throw Error(`Speak up to ${needed-staged.length} remaining ${target} card${needed-staged.length===1?'':'s'}.`);
    const hero = captured.snapshot.slots.slice(0, captured.snapshot.count).filter(Boolean).map(window.TheibsCards.toCanonical);
    const known = [...hero, ...(mw.board || []), ...staged, ...command.cards];
    if (new Set(known).size !== known.length) throw Error('A card is duplicated in the hand or board.');
    return command.cards.length<needed-staged.length ? {pendingBoard:command.cards}
      : {addedCards:[...staged,...command.cards]};
  }
  function validate(command, captured) {
    if (!captured.active || captured.invalid) throw Error('Open Analyze and correct the text entry before speaking.');
    if (command.type === 'cancel') return;
    if (boardCommand(command, captured)) return;
    const draft = new window.TheibsCards.CardKeyboardState(captured.snapshot.count); draft.restore(captured.snapshot);
    if (command.type === 'undo') { if (!keyboard.state.undoStack.length) throw Error('Nothing to undo.'); return; }
    if (!draft.applyCommand(command)) throw Error(displayError(draft.error));
    if (captured.multiway?.enabled && JSON.stringify(draft.slots.slice(draft.count)) !== JSON.stringify(captured.snapshot.slots.slice(draft.count)))
      throw Error('In Multiway, name the street explicitly to update the action history.');
  }
  function cardLabel(card) { return card.slice(0,-1).replace('T','10')+({s:'♠',h:'♥',d:'♦',c:'♣'})[card.slice(-1)]; }
  function describe(command, captured) {
    if(command.type==='context'){
      const actor=captured.multiway?.actionState?.players?.find(p=>p.id===captured.multiway.actionState.actor);
      return actor?`${actor.name} · ${actor.position} is next to act`:'The table is waiting for its next entry';
    }
    if(command.type==='amount')return `Total ${command.to} chips this street for the highlighted player`;
    if(command.type==='action'){
      if(command.to===undefined&&command.by===undefined&&['BET','RAISE'].includes(command.action)){
        const actor=captured.multiway.actionState.players.find(p=>p.id===captured.multiway.actionState.actor);
        return `${actor?.name||'Current player'} · ${command.action} · enter the total for this street`;
      }
      const event=voice.resolveAction(command,captured.multiway.actionState),player=captured.multiway.actionState.players.find(p=>p.id===event.actor);
      const chips=n=>n.toLocaleString(captured.locale,{maximumFractionDigits:2});
      const amount=event.to!==undefined?` · ${chips(event.to)} chips total this street · add ${chips(event.to-player.streetPaid)} chips`
        :event.action==='CALL'?` · call ${captured.multiway.actionState.legal.toCall} chips`:'';
      return `${player.name} · ${player.position} → ${event.action}${amount}`;
    }
    const target = command.target === 'selected' || command.target === 'selectedScope'
      ? (captured.snapshot.selected < captured.snapshot.count ? 'hand' : 'board') + ` · slot ${captured.snapshot.selected < captured.snapshot.count ? captured.snapshot.selected + 1 : captured.snapshot.selected - captured.snapshot.count + 1}`
      : ({ hero: 'hand', flop: 'flop', turn: 'turn', river: 'river', board: 'board' })[command.target] || 'current entry';
    return `${target} → ${command.cards?.map(cardLabel).join(' · ') || (command.card && cardLabel(command.card)) || ({ undo: 'undo', remove: 'remove card', select: `select position ${command.index + 1}`, target: 'select destination' })[command.type] || command.type}`;
  }
  function prepareProposal(id,captured,finishing=false) {
    const sequential=captured.multiway?.enabled && captured.multiway.phase==='BETTING';
    if(sequential){
      if(session.readyFinalCount()>1){
        session.reject('Several actions arrived in one speech result. Say one action at a time; nothing was recorded.');
        return null;
      }
      return session.prepareNextFinal(id,captured,parseFinal);
    }
    return finishing?session.finish(id,captured,parseFinal):session.prepareReady(id,captured,parseFinal);
  }
  function applySpeechHints(recognizer, locale) {
    const Phrase = window.SpeechRecognitionPhrase || window.webkitSpeechRecognitionPhrase;
    if (!('phrases' in recognizer) || typeof Phrase !== 'function') return false;
    const english = locale === 'en-US';
    const ranks = english
      ? ['two','three','four','five','six','seven','eight','nine','ten','jack','queen','king','ace']
      : ['dois','três','quatro','cinco','seis','sete','oito','nove','dez','valete','dama','rei','ás'];
    const suits = english ? ['spades','hearts','diamonds','clubs'] : ['espadas','copas','ouros','paus'];
    const connector = english ? 'of' : 'de';
    const hints = new Map();
    const add = (phrase, boost) => hints.set(phrase, Math.max(hints.get(phrase) || 0, boost));
    for (const rank of ranks) for (const suit of suits) add(`${rank} ${connector} ${suit}`, 2.5);
    const rankAliases = english
      ? [['ace',['ace'],4.5],['jack',['jack'],4.5]]
      : [['ás',['ás','as','a','ace'],4.5],['valete',['valete','valet','vale te','jota','jack'],4.5]];
    for (const [, aliases, boost] of rankAliases) for (const alias of aliases) {
      add(alias, 2.5);
      for (const suit of suits) add(`${alias} ${connector} ${suit}`, boost);
    }
    try {
      recognizer.phrases = [...hints].map(([phrase, boost]) => new Phrase(phrase, boost));
      return true;
    } catch {
      return false;
    }
  }
  function timing(current, started) {
    return { locale: $('voice-language').value, mode: $('voice-processing').value,
      recognitionSessionMs: performance.now() - current.startedAt,
      startupMs: current.listenStartedAt ? current.listenStartedAt - current.startedAt : null,
      startToAudioMs: current.audioStartedAt ? current.audioStartedAt-current.startedAt : null,
      pace: 'batch', endReference: current.stopReason || 'FINAL_RESULT',
      firstResultToFinalMs: current.firstResultAt ? started - current.firstResultAt : null,
      stopToFinalMs: current.stopRequestedAt ? started - current.stopRequestedAt : null,
      audioGapMs: current.audioGapMs ?? null,
      speechEndToFinalMs: current.speechEndedAt ? started-current.speechEndedAt : null,
      parserMs: performance.now() - started, finalResultAt: started };
  }
  function resumeCapture({ retry = false, notice = '' } = {}) {
    if (!wantListening || !$('voice-consent').checked) return;
    if (!active()) { suspend('Voice paused until the table and session are available.'); return; }
    // A ledger transaction or a provider end releases the old capture first.
    clearTimeout(restartTimer);
    restartContext = JSON.stringify(context());
    restartTimer = setTimeout(() => {
      const unchanged = JSON.stringify(context()) === restartContext; restartTimer = null; restartContext = null;
      if (wantListening && unchanged) void start({ resume: true });
      else if (wantListening) suspend('The table context changed. Say the command again.');
    }, retry ? Math.min(1000, 250 * 2 ** Math.min(softRetryCount++, 2)) : 80);
    controls(); say(notice ? `${displayError(notice)} Restarting the microphone…` : clarification ? `${followUpPrompt(clarification.request)} Restarting the microphone…` : 'Restarting the microphone… wait for the Listening indicator.');
  }
  function retryCapture(current, message) {
    if (run !== current || current.retryMessage) return;
    if (!wantListening || !$('voice-consent').checked || !active() || current.hold) { suspend(message); return; }
    current.retryMessage = message;
    current.closing = true; session.cancel();
    clearInterval(monitor); monitor = null;
    clearTimeout(clarificationTimer); clarificationTimer = null; clarification = null;
    controls(); say(`${message} Nothing was entered; wait for Listening, then repeat.`);
    try { current.recognition.abort(); } catch { suspend('Could not restart the microphone.', true); }
  }
  function expireClarification() {
    const notice = 'The follow-up was not understood. Say the complete card again.';
    if (run && wantListening) { retryCapture(run, notice); return; }
    if (wantListening && $('voice-consent').checked) {
      clearTimeout(clarificationTimer); clarificationTimer = null; clarification = null;
      session.cancel(); resumeCapture({ retry: true, notice });
    } else suspend(notice);
  }
  function discardOrRetry(current, captured, message) {
    if (session.discardFinal(current.id, captured)) {
      current.firstResultAt = null;
      clearTimeout(clarificationTimer); clarificationTimer = null; clarification = null;
      say(`${displayError(message)} Nothing was entered; you can repeat the command.`, true);
    } else retryCapture(current, message);
  }
  function end(current) {
    if (run !== current || current.cancelled) return;
    run = null; clearTimers();
    if (!session.hasPending() && !session.error) {
      session.cancel(); controls();
      if (wantListening) resumeCapture({ retry: !current.appliedCount, notice: current.appliedCount ? '' : 'The last phrase was not understood.' });
      else cancel(lastApplied || 'Microphone stopped.');
      return;
    }
    const started = performance.now(), captured = context();
    const proposal = prepareProposal(current.id, captured, true);
    sample = timing(current, started); controls();
    if (!proposal) {
      const error = displayError(session.error || 'Incomplete phrase.');
      if (wantListening && $('voice-consent').checked && active()) { session.cancel(); resumeCapture({ retry: true, notice: `${error} Nothing was entered.` }); }
      else suspend(error + ' Say the complete card again.', true);
      return;
    }
    if (proposal.type === 'cancel' && !captured.multiway?.pendingAmount) { suspend('Phrase cancelled. Earlier entries were kept.'); return; }
    if (proposal.type === 'clarify') { askForComplement(null, captured, proposal); return; }
    try { validate(proposal, captured); }
    catch (error) {
      if (wantListening && $('voice-consent').checked && active()) { session.cancel(); resumeCapture({ retry: true, notice: `${displayError(error)} This batch was not applied.` }); }
      else suspend(displayError(error) + ' This batch was not applied.', true);
      return;
    }
    if (current.automatic) { void apply({ automatic: true }); return; }
    // Manual review pauses capture while preserving the user's enabled intent.
    $('voice-transcript').textContent = session.preview(); $('voice-proposal').textContent = describe(proposal, captured);
    $('voice-apply').textContent = proposal.type==='action'?'Record reviewed action':'Apply reviewed batch';
    review.hidden = false; say('Microphone paused. Review the batch, then apply it.'); watchContext(); controls();
    sample.reviewReadyAt = performance.now();
    const accepted = sample;
    requestAnimationFrame(() => requestAnimationFrame(() => { accepted.acceptedFinalToReviewSecondRafMs = performance.now() - started; }));
  }
  async function start({ resume = false, hold = false } = {}) {
    if (run || committing) return;
    if (window.theibsVoiceEvaluation?.isActive()) { suspend('Finish the voice evaluation before speaking to the table.'); return; }
    const requested = resume ? wantListening : true, requestedHold = resume ? captureHold : hold;
    const savedClarification = resume ? clarification : null;
    const optedIn = $('voice-consent').checked;
    cancel();
    $('voice-consent').checked = optedIn;
    if (savedClarification && savedClarification.expiresAt > performance.now() && savedClarification.contextKey === JSON.stringify(context())) {
      clarification = savedClarification;
      clarificationTimer = setTimeout(expireClarification, savedClarification.expiresAt-performance.now());
    }
    if (!resume) { lastAudioEndedAt = null; softRetryCount = 0; }
    if (!requested) return;
    wantListening = true; captureHold = requestedHold;
    if (!Recognition || !window.isSecureContext) { suspend('Speech recognition is unavailable here. Use HTTPS and the card keyboard.', true); return; }
    const captured = context();
    if (!captured.active || captured.invalid) { suspend('Voice is paused until valid Analyze input is available.'); return; }
    if (!$('voice-consent').checked) { cancel(); say('Turn on voice commands before speaking.', true); return; }
    const current = { id: session.begin(captured), startedAt: performance.now(), recognition: null, started: false, audioActive:false, cancelled: false, automatic: captured.autoApply, appliedCount: 0, hold: requestedHold, closing: false, firstResultAt: null, resumed:resume };
    run = current; controls(); say('Starting microphone…'); watchContext();
    trace(current,'start-request');
    try {
      // Keep the first start in the checkbox's user gesture. Mobile browsers
      // may reject microphone activation after an unnecessary async boundary.
      if (nativeCaptures.size) await waitForNativeRelease();
      if (run !== current || current.cancelled) return;
      if (captured.processing === 'device') {
        if (typeof Recognition.available !== 'function' || !('processLocally' in Recognition.prototype)) throw Error('On-device recognition is unavailable. Choose another mode deliberately or use the keyboard.');
        const cached = availableDevices.get(captured.locale), fresh = cached && performance.now()-cached.at < 60000;
        const available = fresh ? 'available' : await Recognition.available({ langs: [captured.locale], processLocally: true });
        if (available === 'available' && !fresh) availableDevices.set(captured.locale,{at:performance.now()});
        if (run !== current || current.cancelled) return;
        if (available !== 'available') throw Error('This language is unavailable on this device. No language package will be installed automatically.');
      }
      if (run !== current || JSON.stringify(context()) !== session.context) { suspend('The table context changed before listening began.'); return; }
      const recognizer = new Recognition(); current.recognition = recognizer;
      recognizer.lang = captured.locale; recognizer.continuous = true; recognizer.interimResults = true; recognizer.maxAlternatives = 1;
      current.contextBiasing = applySpeechHints(recognizer, captured.locale);
      if (captured.processing === 'device') recognizer.processLocally = true;
      else if ('processLocally' in recognizer) recognizer.processLocally = false;
      recognizer.onstart = () => {
        if (run !== current || current.cancelled) { try { recognizer.abort(); } catch {} return; }
        if (JSON.stringify(context()) !== session.context) { suspend('The table context changed while opening the microphone.'); return; }
        current.started = true; current.listenStartedAt = performance.now(); trace(current,'service-start'); controls();
      };
      recognizer.onaudiostart = () => {
        if (run !== current || current.cancelled) return;
        current.audioActive = true; current.audioEnded = false; current.audioStartedAt = performance.now();
        current.audioGapMs = current.resumed && lastAudioEndedAt !== null ? performance.now()-lastAudioEndedAt : null;
        trace(current,'audio-start',{restartGapMs:current.audioGapMs}); controls();
        if (!current.closing) say(clarification ? followUpPrompt(clarification.request) : current.automatic ? '● Listening. Speak each card rank and suit.' : '● Listening. Say the batch, then stop when finished.');
      };
      recognizer.onaudioend = () => { current.audioActive = false; current.audioEnded = true; if (!current.cancelled) lastAudioEndedAt = performance.now(); trace(current,'audio-end'); if (run === current) controls(); };
      recognizer.onresult = event => {
        if (run !== current || current.cancelled || current.retryMessage || committing) return;
        const capturedNow = context();
        if (JSON.stringify(capturedNow) !== session.context) { suspend('The table context changed during speech.'); return; }
        const started = performance.now(); current.firstResultAt ||= started;
        trace(current,'result',{finalCount:Array.from(event.results).filter(r=>r.isFinal).length,segmentCount:event.results.length});
        session.reconcileResultCount(current.id, event.results.length);
        // Results is cumulative. Inspect every index to catch changed final
        // segments and prevent repeated provider events from applying twice.
        for (let i = 0; i < event.results.length; i++) session.accept(current.id, i, event.results[i][0].transcript, event.results[i].isFinal);
        if (session.error) { discardOrRetry(current, capturedNow, session.error); return; }
        if (current.automatic) {
           const proposal = prepareProposal(current.id, capturedNow);
          if (session.error) { discardOrRetry(current, capturedNow, session.error); return; }
           if (proposal?.type === 'cancel' && !capturedNow.multiway?.pendingAmount) { suspend('Phrase cancelled. Earlier entries were kept.'); return; }
          if (proposal?.type === 'clarify') { askForComplement(current, capturedNow, proposal); return; }
          if (proposal) {
            try { validate(proposal, capturedNow); }
            catch (error) { discardOrRetry(current, capturedNow, error.message); return; }
            sample = timing(current, started); void apply({ automatic: true, current }); current.firstResultAt = null;
          }
          else if (session.hasPending() && !current.closing) say('Recognizing the phrase… speak the complete rank and suit.');
        } else say(`Listening: ${session.preview() || '…'} — review the batch when finished.`);
      };
      recognizer.onerror = event => {
        trace(current,'error',{code:['not-allowed','service-not-allowed','audio-capture','no-speech','network','language-not-supported','aborted'].includes(event.error)?event.error:'unknown'});
        if (run !== current || current.retryMessage) return;
        if (event.error === 'no-speech') { retryCapture(current, 'No speech detected.'); return; }
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') microphonePermission = 'denied';
        const errors = { 'not-allowed': 'Microphone permission was denied or revoked.', 'service-not-allowed': 'The speech service was not authorized.',
          'audio-capture': 'Microphone unavailable or in use.', 'no-speech': 'No speech detected.', network: 'Speech recognition lost its network connection.',
          'language-not-supported': 'The recognition service does not support this language.', aborted: 'Recognition was interrupted.' };
        suspend((errors[event.error] || 'Speech recognition failed.') + ' Voice remains enabled and will resume when possible.', true);
      };
      recognizer.onnomatch = () => { if (run === current) retryCapture(current, 'Speech was not understood.'); };
      recognizer.onspeechend = () => {
        current.speechEndedAt = performance.now();
        trace(current,'speech-end');
        // Keep capture open across pauses so the player can dictate the whole sequence.
      };
      recognizer.onspeechstart = () => { trace(current,'speech-start'); current.speechEndedAt = null; };
      current.released = new Promise(resolve => { current.release = resolve; });
      recognizer.onend = () => {
        current.audioActive = false; nativeCaptures.delete(current); current.release(); trace(current,'end');
        if (current.retryMessage && run === current) {
          run = null; clearTimers(); session.cancel(); controls();
          if (wantListening) resumeCapture({ retry: true, notice: current.retryMessage });
          else cancel('Voice off. Earlier entries were kept.');
          return;
        }
        end(current);
      };
      nativeCaptures.add(current);
      try { recognizer.start(); } catch (error) { nativeCaptures.delete(current); current.release(); throw error; }
    } catch (error) { if (run === current) suspend(displayError(error) || 'Could not start speech recognition.', true); }
  }
  function stop() {
    wantListening = false; clearTimeout(restartTimer); restartTimer = null;
    $('voice-consent').checked = false;
    const current = run; if (!current) { cancel('Microphone stopped. Earlier entries were kept.'); return; }
    if (!current.started) { cancel('Stopped before the microphone opened.'); return; }
    current.stoppedAt ||= performance.now(); say('Closing the microphone and waiting for the final phrase…');
    requestFinal(current, 'USER_STOP');
  }
  async function apply({ automatic = false, current = null, explicitCommand = null } = {}) {
    if (committing) return;
    const captured = context(), command = explicitCommand || session.take(captured), epoch = operationEpoch;
    if (!command) { if (wantListening) suspend('The entry changed. Say the command again.'); else cancel('The entry changed. Say the command again.'); return; }
    committing = true; clearTimers(); clearTimeout(rebindTimer); rebindTimer = null; $('voice-apply').disabled = true; controls();
    say(automatic ? 'Applying recognized entry…' : 'Applying reviewed batch…');
    const startAt = performance.now();
    let restart = false;
    try {
      validate(command, captured);
      clearTimeout(clarificationTimer); clarificationTimer = null;
       const board = boardCommand(command, captured), label = describe(command, captured);
       let result;
       if (board) {
        // No speech can queue an action against a ledger that is changing.
        // Resume a fresh recognizer only after the HTTP transaction resolves.
        if (current && run === current) { run = null; try { current.recognition.abort(); } catch {} }
        const mw = window.theibsMultiwayUI;
         const outcome = board.context ? true
           : board.cancelPending ? mw.cancelPendingAmount()
           : board.undo ? await keyboard.undoConfirmedTableEvent({expectedRevisionKey:captured.multiway.revisionKey})
           : board.undoPendingBoard ? keyboard.undoPendingBoard(captured.revision,captured.multiway.stateToken)
           : board.amount ? await mw.submitPendingAmount({to:board.amount,expectedToken:captured.multiway.token})
           : board.action || board.actionPending ? await mw.commitVoiceAction({command,expectedToken:captured.multiway.token})
           : board.pendingBoard ? keyboard.addPendingVoiceBoardCards(board.pendingBoard,captured.revision,captured.multiway.stateToken)
           : await mw.commitVoiceBoard({ addedCards: board.addedCards, expectedToken: captured.multiway.token });
         const pendingAmount = outcome?.pending === true;
         const pendingBoard=outcome?.pendingBoard===true;
         result = { ok: outcome === true || outcome?.ok===true || pendingAmount || pendingBoard, pendingAmount,pendingBoard,
           error: outcome?.error||'The transaction was not applied. Check the table and session before retrying.' };
         if(result.ok && !pendingAmount && !pendingBoard && !board.context && !board.cancelPending && !board.undo)
           lastLedgerUndo = {token:mw.voiceContext().token,kind:board.action||board.amount?'ACT':'BOARD'};
         else if(board.undo || board.undoPendingBoard || board.cancelPending)lastLedgerUndo=null;
      } else result = keyboard.commitCommand(command, captured.revision);
      if (!result.ok) throw Error(result.error);
      if (epoch !== operationEpoch || !active()) return;
      clarification = null; clearTimeout(clarificationTimer); clarificationTimer = null;
      trace(current,'applied');
      if (current) current.appliedCount++;
      const measured = { ...sample, manualReviewMs: automatic ? 0 : sample?.reviewReadyAt ? startAt - sample.reviewReadyAt : null,
        commitMs: performance.now() - startAt, finalToCommitMs: sample?.finalResultAt ? performance.now()-sample.finalResultAt : null, measurementLayer: 'BROWSER_RUNTIME', acousticGate: 'NOT_EXECUTED', automatic };
      const finalAt = measured.finalResultAt;
      delete measured.reviewReadyAt; delete measured.finalResultAt;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        measured.confirmToSecondRafMs = performance.now() - startAt;
        if (automatic && finalAt) measured.finalToAppliedSecondRafMs = performance.now() - finalAt;
        metrics.push(measured); if (metrics.length > 100) metrics.shift();
      }));
       lastApplied = result.pendingAmount ? `${label}. Speak the total amount next, or enter it in the inline field.`
         : result.pendingBoard ? `${label}. Speak the remaining board cards to complete this street.`
         : command.type==='context' ? `${label}. No action was recorded.`
         : board?.cancelPending ? 'Pending amount cancelled. No action was recorded.'
         : board?.undoPendingBoard ? 'Pending board cards cleared. Confirmed actions were kept.'
         : `Applied: ${label}. ${command.type==='action'||command.type==='amount'?'Action recorded at the table.':'Next card position selected.'} Say “${captured.locale === 'pt-BR' ? 'desfazer' : 'undo'}” to correct it.`;
      softRetryCount = 0;
      review.hidden = true; $('voice-transcript').textContent = ''; $('voice-proposal').textContent = '';
      if (automatic && current && run === current && !current.closing && wantListening) {
        if (!session.resume(current.id, context())) throw Error('Could not continue listening. Applied entries were kept.');
        watchContext(); say(lastApplied + (current.closing || !current.audioActive ? ' Wait for the Listening indicator before speaking again.' : ''));
      } else if (wantListening) { session.cancel(); restart = true; say(lastApplied); }
      else cancel(lastApplied);
      recognized();
    } catch (error) { if (wantListening) { suspend(displayError(error), true); restart = true; } else { cancel(); say(displayError(error), true); } }
    finally {
      committing = false; $('voice-apply').disabled = false; controls();
      if (wantListening && !run && session.phase !== 'review') scheduleRebind(restart ? 80 : 180);
    }
  }
  $('voice-hold').addEventListener('pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); void start({hold:true}); });
  $('voice-hold').addEventListener('pointerup', stop);
  $('voice-hold').addEventListener('pointercancel', () => suspend('Hold-to-speak gesture cancelled.'));
  $('voice-hold').addEventListener('keydown', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) void start({hold:true}); } });
  $('voice-hold').addEventListener('keyup', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); stop(); } });
  $('voice-toggle').onclick = () => run || wantListening ? stop() : void start();
  $('voice-cancel').onclick = () => cancel('Voice stopped. Earlier entries were kept.');
  $('voice-apply').onclick = () => void apply();
  $('voice-undo').onclick = () => { if (committing) return; if (wantListening) suspend('Undoing the last entry.'); else cancel(); sample = null; void apply({explicitCommand:{type:'undo'}}); };
  $('voice-consent').addEventListener('change', () => {
    if ($('voice-consent').checked) void start();
    else if (run || wantListening) stop();
    else cancel('Voice off. Earlier entries were kept.');
  });
  for (const id of ['voice-language', 'voice-processing', 'voice-auto-apply']) $(id).addEventListener('change', () => {
    suspend('Voice setting changed. Restarting with the new option.');
    $('voice-consent-description').textContent = $('voice-processing').value === 'device'
      ? 'Turn on to listen continuously; turn off to stop. Processing stays on this device. THEIBS does not record audio.'
      : 'Turn on to listen continuously; turn off to stop. Your browser speech service may process audio remotely. THEIBS does not record audio.';
    $('voice-privacy').textContent = $('voice-processing').value === 'device'
      ? 'Recognition is set to this device. THEIBS does not record audio or save transcripts.'
      : 'Your browser speech service may send audio to its provider. Processing and retention depend on that provider. THEIBS does not record audio or save transcripts.';
    controls();
  });
  document.addEventListener('keydown', event => {
    if (document.querySelector('#billing-dialog[open]')) return;
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyV' && !event.repeat) {
      if (!active() || event.target.closest?.('input,textarea,select,[contenteditable]')) return;
      event.preventDefault(); run || wantListening ? stop() : void start(); return;
    }
    if (!pending() && !committing) return;
    if (event.key === 'Escape' && !context().multiway?.pendingAmount) { event.preventDefault(); suspend('Phrase discarded. Voice remains enabled.'); }
  }, true);
  for (const name of ['theibs:cards-changed', 'theibs:card-selection']) document.addEventListener(name, () => {
    if (run && !committing) suspend('Table or card selection changed. Restarting in the new context.');
    controls();
  });
  document.addEventListener('theibs:voice-session-changed', () => { if (pending() || committing) suspend('Session changed. Voice is waiting for a valid session.'); });
  document.addEventListener('theibs:billing-modal-open', () => { if (pending() || committing) suspend('Voice paused while account and payment are open.'); });
  document.addEventListener('theibs:billing-modal-close', () => { if (wantListening) scheduleRebind(0); });
  // Auth owns storage/session continuity: a healthy token refresh preserves
  // its epoch. Logout, identity changes and failures emit the event above.
  for (const name of ['offline', 'pagehide']) window.addEventListener(name, () => { if (pending()) suspend('Voice paused until the page and connection return.'); });
  window.addEventListener('online', () => { if (wantListening) scheduleRebind(0); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && pending()) suspend('Voice paused while the page is hidden.');
    else if (wantListening) scheduleRebind(0);
  });
  const observer = new MutationObserver(() => { if (!committing && run && JSON.stringify(context()) !== expectedContext()) suspend('Page or session changed. Restarting when available.'); });
  for (const element of [document.querySelector('#analyze-workspace'), document.querySelector('#app-shell'), document.body])
    if (element) observer.observe(element, { attributes: true, attributeFilter: ['class', 'hidden', 'inert', 'data-multiway', 'data-multiway-busy'] });
  window.theibsCardVoice = { cancel, releaseCaptureForEvaluation, getStatus: () => ({ phase: session.phase, listening: Boolean(run) || (wantListening && !blockedReason && session.phase !== 'review'), enabled:wantListening, blocked:Boolean(blockedReason), captureState:captureState(), audioReady:audioReady(), needsClarification:Boolean(clarification), committing, autoApply: autoApply(), pace: 'batch', contextBiasing: Boolean(run?.contextBiasing), finalizing: Boolean(run?.closing), acoustic: 'NOT_EXECUTED' }),
    getDiagnostics: () => diagnostics.map(row => ({...row})),
    getMetrics: () => metrics.map(row => ({ ...row })), capability: () => ({ secureContext: window.isSecureContext, constructorPresent: Boolean(Recognition),
      functionalRecognition: 'NOT_VERIFIED', acoustic: 'NOT_EXECUTED', localAvailabilityCheck: typeof Recognition?.available === 'function' }) };
  controls();
  say(Recognition ? '' : 'Voice is unavailable in this browser. The card keyboard remains available.', !Recognition);
  if (Recognition && navigator.permissions?.query) navigator.permissions.query({name:'microphone'}).then(permission=>{
    const update=()=>{ microphonePermission=permission.state; if (microphonePermission === 'denied' && run) suspend('Microphone permission was revoked. Allow access in your browser to resume.', true); else if (wantListening && microphonePermission === 'granted') scheduleRebind(0); controls(); };
    permission.addEventListener?.('change',update);update();
  }).catch(()=>{});
})();
