/* Analyze-only microphone adapter. Final validated commands apply once through
 * the keyboard/ledger boundary. No audio or transcript persistence. */
(function () {
  'use strict';
  if (typeof document === 'undefined' || !window.TheibsCardVoice || !window.TheibsCardVoiceFast || !window.theibsCardKeyboard) return;
  const host = document.querySelector('#analyze-workspace .table-column');
  if (!host) return;
  const voice = window.TheibsCardVoice, fast = window.TheibsCardVoiceFast, keyboard = window.theibsCardKeyboard, session = new voice.RecognitionSession();
  const panel = document.createElement('section'); panel.id = 'card-voice'; panel.setAttribute('aria-label', 'Cartas e ações observadas por voz');
  panel.innerHTML = `<div class="voice-heading"><strong>Cartas e ações por voz</strong><span id="voice-mode-badge" class="voice-badge">Aplicação automática</span></div>
    <div class="voice-options"><label>Idioma / Language<select id="voice-language"><option value="pt-BR">Português (Brasil)</option><option value="en-US">English (US)</option></select></label>
    <label>Reconhecimento<select id="voice-processing"><option value="browser">Serviço do navegador</option><option value="device">Somente neste dispositivo</option></select></label>
    <label>Ritmo da fala<select id="voice-pace"><option value="fast">Rápido · uma carta por vez</option><option value="batch">Frase completa · cartas em sequência</option></select></label></div>
    <label class="voice-consent"><input id="voice-auto-apply" type="checkbox" checked> Aplicar ao reconhecer e avançar para a próxima carta</label>
    <p id="voice-privacy" class="voice-help">O serviço de voz do navegador pode enviar áudio ao provedor do navegador. Destino e retenção dependem dele. O THEIBS não grava áudio nem salva transcrições.</p>
    <label class="voice-consent"><input id="voice-consent" type="checkbox"> Permito o serviço de voz do navegador para esta página, inclusive processamento remoto.</label>
    <div class="voice-actions"><button id="voice-hold" type="button">Segure para falar</button><button id="voice-toggle" type="button" aria-pressed="false" title="Alt+V">Iniciar fala · Alt+V</button><button id="voice-cancel" type="button" disabled>Cancelar</button></div>
    <p id="voice-status" role="status" aria-live="polite">Escolha o idioma. Diga valor e naipe; o teclado continua disponível.</p>
    <div id="voice-review" hidden><p class="voice-help">Confira a frase e o destino antes de aplicar:</p><output id="voice-transcript"></output><strong id="voice-proposal"></strong><button id="voice-apply" type="button">Aplicar lote conferido</button></div>
    <p class="voice-help">No modo rápido, diga uma carta e aguarde ela entrar antes da próxima. Pode abreviar: “oito paus” / “eight clubs”. Para ditar várias cartas sem interrupção, escolha Frase completa. Apostas sempre aguardam a frase inteira; diga “desfazer” para corrigir. Desmarque a aplicação automática se preferir conferir cada lote. Ex.: “minhas cartas, ás de espadas, dez de copas” / “my cards, ace of spades, ten of hearts”.</p>
    <p class="voice-help">No Multiway, registre uma ação observada por vez: “eu pago”, “adversário um aumenta para seis”, “hero call”, “opponent one raises to six”. O ator precisa estar na vez. Raise é o total na street; nenhuma aposta é enviada a uma mesa externa.</p>
    <details><summary>Comandos e números</summary><p class="voice-help">PT: ás, dois, três, quatro, cinco, seis, sete, oito, nove, dez, valete, dama/rainha, rei + espadas/copas/ouros/paus. EN: ace, two, three, four, five, six, seven, eight, nine, ten, jack, queen, king + spades/hearts/diamonds/clubs. Números 2–10 também são aceitos; “to”, “for”, “ate” e um/one não são cartas.</p><p class="voice-help">Destinos: minhas cartas/my cards, flop, turn, river, board. Selecionar carta três/select card three; corrigir carta três para dama de ouros/correct card three to queen of diamonds; remover carta selecionada/remove selected card; desfazer/undo; cancelar/cancel. Sem destino, use o slot selecionado; um lote não atravessa sua street.</p><p class="voice-help">Ações Multiway: eu/herói ou adversário/oponente N; em inglês hero/I ou opponent N (N é o número ADV. da mesa). Desistir/fold; passar/check; pagar/call sem valor (o preço vem da mesa); apostar/bet com valor; aumentar para/raise to com total. Valores sem separador de milhar: 2,50 ou dois vírgula cinquenta em PT; 2.50 ou two point five em EN. Aceita números por extenso até 999999,99; não interpreta incrementos, all-in ou várias ações na mesma frase.</p></details>`;
  // The existing deck lives in Settings. Voice needs the visible Analyze
  // canvas, where the normal keyboard path and slot selection remain active.
  const disclosure = document.createElement('details'); disclosure.id = 'card-voice-disclosure';
  const summary = document.createElement('summary'); summary.textContent = 'Entrada por voz · PT / EN';
  disclosure.append(summary, panel); host.append(disclosure);
  const $ = id => panel.querySelector('#' + id), status = $('voice-status'), review = $('voice-review');
  let run = null, committing = false, timer = null, monitor = null, restartTimer = null, sample = null, lastLedgerUndo = null;
  let captureHold = false;
  let wantListening = false, operationEpoch = 0, lastApplied = '', restartContext = null;
  const autoApply = () => $('voice-auto-apply').checked;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const availableDevices = new Map();
  let lastAudioEndedAt = null;
  const metrics = []; // Timing only; no text, audio, cards, identities, or persistence.
  function say(text, error = false) { status.textContent = text; status.classList.toggle('voice-error', error); }
  function active() {
    return window.isSecureContext && !document.hidden && navigator.onLine !== false &&
      !window.theibsVoiceSessionContext?.().expired &&
      !document.querySelector('#analyze-workspace').classList.contains('hidden') &&
      !document.querySelector('#app-shell')?.hidden && !document.querySelector('#app-shell')?.hasAttribute('inert') &&
      !document.querySelector('dialog[open]') && document.body.dataset.multiwayBusy !== 'true';
  }
  function context() {
    return { revision: keyboard.getRevision(), snapshot: keyboard.state.snapshot(), invalid: keyboard.isManualInvalid(),
      locale: $('voice-language').value, processing: $('voice-processing').value, pace: $('voice-pace').value, autoApply: autoApply(),
      active: active(), app: window.theibsApp?.getVoiceContext?.() || { activeView: window.theibsApp?.getState?.().activeView },
      multiway: window.theibsMultiwayUI?.voiceContext?.() || null };
  }
  const pending = () => Boolean(run) || wantListening || session.phase === 'review';
  function controls() {
    const listening = Boolean(run) || wantListening;
    $('voice-mode-badge').textContent = autoApply() ? 'Aplicação automática' : 'Revisão do lote';
    $('voice-toggle').textContent = listening ? 'Parar fala · Alt+V' : 'Iniciar fala · Alt+V';
    $('voice-toggle').setAttribute('aria-pressed', String(listening));
    $('voice-cancel').disabled = !pending() && !committing; panel.classList.toggle('is-listening', listening);
    $('voice-hold').disabled = committing || !Recognition || !window.isSecureContext;
    $('voice-toggle').disabled = (committing && !listening) || !Recognition || !window.isSecureContext;
  }
  // An interim may request a final result, but it never mutates the table.
  const endpoint = new fast.FastEndpoint({ delayMs: 220, onReady: ({key, contextKey}) => {
    const current = run;
    if (!current || current.closing || current.hold || committing || !wantListening ||
      !current.automatic || $('voice-pace').value !== 'fast' || current.resultKey !== key ||
      JSON.stringify(context()) !== contextKey || contextKey !== session.context) return;
    const command = fast.candidate(session.pendingPreview(), $('voice-language').value);
    try { if (!command) return; validate(command, context()); }
    catch { return; }
    requestFinal(current, 'VALID_CARD_STABLE');
  }});
  function requestFinal(current, reason) {
    if (run !== current || current.cancelled || current.closing) return;
    endpoint.clear(); current.closing = true; current.stopRequestedAt = performance.now(); current.stopReason = reason;
    if (reason === 'VALID_CARD_STABLE') say('Concluindo a carta… aguarde ela entrar antes de falar a próxima.');
    try { current.recognition.stop(); } catch { cancel('Não foi possível concluir a fala. Tente novamente.'); }
  }
  function updateEndpoint(current) {
    let command = null;
    if (current.automatic && !current.hold && !current.closing && $('voice-pace').value === 'fast' && wantListening) {
      command = fast.candidate(session.pendingPreview(), $('voice-language').value);
      try { if (command) validate(command, context()); } catch { command = null; }
    }
    if (command) current.firstValidCardAt ||= performance.now();
    endpoint.update({key:current.resultKey, eligible:Boolean(command), contextKey:session.context});
  }
  function clearTimers() { endpoint.clear(); clearTimeout(timer); timer = null; clearInterval(monitor); monitor = null; clearTimeout(restartTimer); restartTimer = null; restartContext = null; }
  function armIdleTimer() { clearTimeout(timer); timer = setTimeout(() => cancel('Microfone encerrado após uma pausa. As entradas já aplicadas foram mantidas.'), 20000); }
  function cancel(message) {
    const old = run; run = null; wantListening = false; captureHold = false; operationEpoch++; session.cancel(); clearTimers(); review.hidden = true;
    $('voice-transcript').textContent = ''; $('voice-proposal').textContent = '';
    if (old) { old.cancelled = true; try { old.recognition?.abort(); } catch {} }
    controls(); if (message) say(message);
  }
  const expectedContext = () => restartTimer ? restartContext : session.context;
  function watchContext() {
    clearInterval(monitor);
    monitor = setInterval(() => {
      if (!committing && pending() && JSON.stringify(context()) !== expectedContext()) cancel('Contexto alterado. Dite novamente.');
    }, 150);
  }
  function boardCommand(command, captured) {
    const mw = captured.multiway;
    if (!mw?.enabled) { if(command.type==='action')throw Error('Ative o Multiway para registrar ações observadas.'); return null; }
    if(command.type==='action')return {action:voice.resolveAction(command,mw.actionState)};
    if (command.type === 'undo') {
      if (lastLedgerUndo && mw.token === lastLedgerUndo.token) return { undo: true, kind:lastLedgerUndo.kind };
      const prior = keyboard.state.undoStack.at(-1);
      if (prior && prior.count === captured.snapshot.count &&
        JSON.stringify(prior.slots.slice(prior.count)) === JSON.stringify(captured.snapshot.slots.slice(prior.count))) return null;
      throw Error('Não há lote de cartas para desfazer neste contexto. Use Undo do Multiway para revisar o ledger.');
    }
    const boardTarget = ['flop', 'turn', 'river', 'board'].includes(command.target);
    if (!boardTarget) return null;
    if (mw.phase !== 'WAIT_BOARD') throw Error('O board Multiway só aceita a próxima street quando a rodada termina.');
    if (command.type !== 'cards') throw Error('No Multiway, diga a street junto com todas as suas cartas.');
    const target = mw.nextStreet.toLowerCase();
    if (command.target !== target && command.target !== 'board') throw Error('A street ditada não é a próxima street do ledger.');
    if (command.cards.length !== (target === 'flop' ? 3 : 1)) throw Error('Dite a street inteira: três cartas no flop ou uma no turn/river.');
    const hero = captured.snapshot.slots.slice(0, captured.snapshot.count).filter(Boolean).map(window.TheibsCards.toCanonical);
    const known = [...hero, ...(mw.board || []), ...command.cards];
    if (new Set(known).size !== known.length) throw Error('Carta duplicada na mão ou board.');
    return { addedCards: command.cards };
  }
  function validate(command, captured) {
    if (!captured.active || captured.invalid) throw Error('Abra o Analyze e corrija a entrada de texto antes de ditar.');
    if (command.type === 'cancel') return;
    if (boardCommand(command, captured)) return;
    const draft = new window.TheibsCards.CardKeyboardState(captured.snapshot.count); draft.restore(captured.snapshot);
    if (command.type === 'undo') { if (!keyboard.state.undoStack.length) throw Error('Nada para desfazer.'); return; }
    if (!draft.applyCommand(command)) throw Error(draft.error);
    if (captured.multiway?.enabled && JSON.stringify(draft.slots.slice(draft.count)) !== JSON.stringify(captured.snapshot.slots.slice(draft.count)))
      throw Error('No Multiway, diga a street explicitamente para atualizar o ledger.');
  }
  function cardLabel(card) { return card.slice(0,-1).replace('T','10')+({s:'♠',h:'♥',d:'♦',c:'♣'})[card.slice(-1)]; }
  function describe(command, captured) {
    if(command.type==='action'){
      const event=voice.resolveAction(command,captured.multiway.actionState),player=captured.multiway.actionState.players.find(p=>p.id===event.actor);
      const chips=n=>n.toLocaleString(captured.locale,{maximumFractionDigits:2});
      const amount=event.to!==undefined?` · total ${chips(event.to)} fichas na street · adicionar ${chips(event.to-player.streetPaid)} fichas`
        :event.action==='CALL'?` · pagar ${captured.multiway.actionState.legal.toCall} fichas`:'';
      return `${player.name} · ${player.position} → ${event.action}${amount}`;
    }
    const target = command.target === 'selected' || command.target === 'selectedScope'
      ? (captured.snapshot.selected < captured.snapshot.count ? 'mão' : 'board') + ` · slot ${captured.snapshot.selected < captured.snapshot.count ? captured.snapshot.selected + 1 : captured.snapshot.selected - captured.snapshot.count + 1}`
      : ({ hero: 'mão', flop: 'flop', turn: 'turn', river: 'river', board: 'board' })[command.target] || 'entrada atual';
    return `${target} → ${command.cards?.map(cardLabel).join(' · ') || (command.card && cardLabel(command.card)) || ({ undo: 'desfazer', remove: 'remover carta', select: `selecionar posição ${command.index + 1}`, target: 'selecionar destino' })[command.type] || command.type}`;
  }
  function timing(current, started) {
    return { locale: $('voice-language').value, mode: $('voice-processing').value,
      recognitionSessionMs: performance.now() - current.startedAt,
      startupMs: current.listenStartedAt ? current.listenStartedAt - current.startedAt : null,
      pace: $('voice-pace').value, endReference: current.stopReason || 'FINAL_RESULT',
      firstResultToFinalMs: current.firstResultAt ? started - current.firstResultAt : null,
      firstValidCardToFinalMs: current.firstValidCardAt ? started - current.firstValidCardAt : null,
      stopToFinalMs: current.stopRequestedAt ? started - current.stopRequestedAt : null,
      audioGapMs: current.audioGapMs ?? null,
      speechEndToFinalMs: current.speechEndedAt ? started-current.speechEndedAt : null,
      parserMs: performance.now() - started, finalResultAt: started };
  }
  function resumeCapture() {
    if (!wantListening || !autoApply() || !active()) { wantListening = false; controls(); return; }
    // A ledger transaction or a provider end releases the old capture first.
    restartContext = JSON.stringify(context());
    restartTimer = setTimeout(() => {
      const unchanged = JSON.stringify(context()) === restartContext; restartTimer = null; restartContext = null;
      if (wantListening && unchanged) void start({ resume: true });
      else if (wantListening) cancel('Contexto alterado. Dite novamente.');
    }, $('voice-pace').value === 'fast' ? 0 : 80);
    controls();
  }
  function end(current) {
    if (run !== current || current.cancelled) return;
    run = null; clearTimers();
    if (current.automatic && !session.hasPending() && !session.error) {
      if (!current.appliedCount) { cancel('Nenhuma frase concluída foi recebida. Tente falar novamente.'); return; }
      session.cancel(); controls();
      if (wantListening) resumeCapture(); else say(lastApplied || 'Microfone encerrado.');
      return;
    }
    const started = performance.now(), captured = context();
    const proposal = session.finish(current.id, captured);
    sample = timing(current, started); controls();
    if (!proposal) { const error = session.error; cancel(); say(error || 'Fala incompleta. Diga valor e naipe novamente.', true); return; }
    if (proposal.type === 'cancel') { cancel('Fala cancelada. Entradas anteriores mantidas.'); return; }
    try { validate(proposal, captured); }
    catch (error) { cancel(); say(error.message + ' Este lote não foi aplicado.', true); return; }
    if (current.automatic) { void apply({ automatic: true }); return; }
    wantListening = false;
    $('voice-transcript').textContent = session.preview(); $('voice-proposal').textContent = describe(proposal, captured);
    $('voice-apply').textContent = proposal.type==='action'?'Registrar ação conferida':'Aplicar lote conferido';
    review.hidden = false; say('Microfone encerrado. Confira o lote e aplique.'); watchContext(); controls();
    sample.reviewReadyAt = performance.now();
    const accepted = sample;
    requestAnimationFrame(() => requestAnimationFrame(() => { accepted.acceptedFinalToReviewSecondRafMs = performance.now() - started; }));
  }
  async function start({ resume = false, hold = false } = {}) {
    if (run || committing) return;
    const requested = resume ? wantListening : true, requestedHold = resume ? captureHold : hold;
    disclosure.open = true;
    cancel();
    if (!requested) return;
    wantListening = true; captureHold = requestedHold;
    if (!Recognition || !window.isSecureContext) { cancel(); say('Reconhecimento indisponível neste navegador ou contexto. Use HTTPS e o teclado.', true); return; }
    const captured = context();
    if (!captured.active || captured.invalid) { cancel(); say('A voz está disponível na entrada válida de cartas do Analyze.', true); return; }
    if (captured.processing === 'browser' && !$('voice-consent').checked) { cancel(); say('Autorize o serviço do navegador acima antes de falar.', true); return; }
    const current = { id: session.begin(captured), startedAt: performance.now(), recognition: null, started: false, cancelled: false, automatic: captured.autoApply, appliedCount: 0, hold: requestedHold, closing: false, resultKey: '', firstResultAt: null, firstValidCardAt: null };
    run = current; controls(); say('Preparando microfone…'); watchContext();
    armIdleTimer();
    try {
      if (captured.processing === 'device') {
        if (typeof Recognition.available !== 'function' || !('processLocally' in Recognition.prototype)) throw Error('Reconhecimento no dispositivo não está disponível. Escolha conscientemente outro modo ou use o teclado.');
        const cached = availableDevices.get(captured.locale), fresh = cached && performance.now()-cached.at < 60000;
        const available = fresh ? 'available' : await Recognition.available({ langs: [captured.locale], processLocally: true });
        if (available === 'available' && !fresh) availableDevices.set(captured.locale,{at:performance.now()});
        if (run !== current || current.cancelled) return;
        if (available !== 'available') throw Error('O idioma não está disponível neste dispositivo. Nenhum pacote será instalado automaticamente.');
      }
      if (run !== current || JSON.stringify(context()) !== session.context) { cancel('Contexto alterado antes de iniciar.'); return; }
      const recognizer = new Recognition(); current.recognition = recognizer;
      recognizer.lang = captured.locale; recognizer.continuous = true; recognizer.interimResults = true; recognizer.maxAlternatives = 1;
      if (captured.processing === 'device') recognizer.processLocally = true;
      else if ('processLocally' in recognizer) recognizer.processLocally = false;
      recognizer.onstart = () => {
        if (run !== current || current.cancelled || JSON.stringify(context()) !== session.context) { try { recognizer.abort(); } catch {} return; }
        current.started = true; current.listenStartedAt = performance.now(); say(current.automatic ? '● Microfone ativo. Fale valor e naipe; a carta entra ao concluir a frase.' : '● Microfone ativo. Fale as cartas ou a ação e pare ao terminar.');
      };
      recognizer.onaudiostart = () => { if (run === current) { current.audioGapMs = lastAudioEndedAt ? performance.now()-lastAudioEndedAt : null; } };
      recognizer.onaudioend = () => { if (!current.cancelled) lastAudioEndedAt = performance.now(); };
      recognizer.onresult = event => {
        if (run !== current || current.cancelled || committing) return;
        const capturedNow = context();
        if (JSON.stringify(capturedNow) !== session.context) { cancel('Contexto alterado durante a fala.'); return; }
        const started = performance.now(); current.firstResultAt ||= started;
        current.resultKey = JSON.stringify(Array.from(event.results, r => [r[0].transcript, r.isFinal]));
        session.reconcileResultCount(current.id, event.results.length);
        // Results is cumulative. Inspect every index to catch changed final
        // segments and prevent repeated provider events from applying twice.
        for (let i = 0; i < event.results.length; i++) session.accept(current.id, i, event.results[i][0].transcript, event.results[i].isFinal);
        if (session.error) { const error = session.error; cancel(); say(error + ' Entradas anteriores mantidas.', true); return; }
        if (current.automatic) {
          const proposal = session.prepareReady(current.id, capturedNow);
          if (session.error) { const error = session.error; cancel(); say(error + ' Este lote não foi aplicado.', true); return; }
          if (proposal?.type === 'cancel') { cancel('Fala cancelada. Entradas anteriores mantidas.'); return; }
          if (proposal) { endpoint.clear(); sample = timing(current, started); void apply({ automatic: true, current }); current.firstResultAt = null; current.firstValidCardAt = null; }
          else { updateEndpoint(current); if (session.hasPending() && !current.closing) say('Reconhecendo… diga o valor e o naipe.'); }
        } else say(`Ouvindo: ${session.preview() || '…'} — confira o lote ao terminar.`);
      };
      recognizer.onerror = event => {
        if (run !== current) return;
        const errors = { 'not-allowed': 'Permissão de microfone negada ou revogada.', 'service-not-allowed': 'Serviço de reconhecimento não autorizado.',
          'audio-capture': 'Microfone não encontrado ou ocupado.', 'no-speech': 'Nenhuma fala detectada.', network: 'Falha de rede no reconhecimento.',
          'language-not-supported': 'Idioma indisponível no reconhecedor.', aborted: 'Reconhecimento cancelado.' };
        cancel(); say((errors[event.error] || 'Falha no reconhecimento de voz.') + ' Use o teclado ou tente novamente.', true);
      };
      recognizer.onnomatch = () => { if (run === current) { cancel(); say('A fala não foi reconhecida com clareza. Entradas anteriores mantidas.', true); } };
      recognizer.onspeechend = () => {
        current.speechEndedAt = performance.now();
        // Some providers retain an interim until capture is stopped. Flush at
        // their speech boundary; never promote interim text to a final result.
        if (current.automatic && !current.hold && run === current && !committing) requestFinal(current, 'PROVIDER_SPEECHEND');
      };
      recognizer.onend = () => end(current);
      recognizer.start();
    } catch (error) { if (run === current) { cancel(); say(error.message || 'Não foi possível iniciar o reconhecimento.', true); } }
  }
  function stop() {
    wantListening = false; clearTimeout(restartTimer); restartTimer = null;
    const current = run; if (!current) { cancel('Microfone encerrado. Entradas anteriores mantidas.'); return; }
    if (!current.started) { cancel('Cancelado antes de abrir o microfone.'); return; }
    current.stoppedAt ||= performance.now(); say('Encerrando microfone e aguardando a frase final…');
    requestFinal(current, 'USER_STOP');
  }
  async function apply({ automatic = false, current = null } = {}) {
    if (committing) return;
    const captured = context(), command = session.take(captured), epoch = operationEpoch;
    if (!command) { cancel('A entrada mudou. Dite novamente.'); return; }
    committing = true; clearTimers(); $('voice-apply').disabled = true; controls();
    say(automatic ? 'Aplicando a entrada reconhecida…' : 'Aplicando o lote conferido…');
    const startAt = performance.now();
    let restart = false;
    try {
      validate(command, captured);
      const board = boardCommand(command, captured), label = describe(command, captured);
      let result;
      if (board) {
        // No speech can queue an action against a ledger that is changing.
        // Resume a fresh recognizer only after the HTTP transaction resolves.
        if (current && run === current) { run = null; try { current.recognition.abort(); } catch {} }
        const mw = window.theibsMultiwayUI;
        const ok = board.undo ? await (board.kind==='ACT'?mw.undoVoiceAction:mw.undoVoiceBoard)({ expectedToken: captured.multiway.token })
          : board.action ? await mw.commitVoiceAction({command,expectedToken:captured.multiway.token})
          : await mw.commitVoiceBoard({ addedCards: board.addedCards, expectedToken: captured.multiway.token });
        result = { ok, error: 'A transação não foi aplicada. Confira a mesa e a sessão antes de tentar novamente.' };
        lastLedgerUndo = ok && !board.undo ? {token:mw.voiceContext().token,kind:board.action?'ACT':'BOARD'} : null;
      } else result = keyboard.commitCommand(command, captured.revision);
      if (!result.ok) throw Error(result.error);
      if (epoch !== operationEpoch || !active()) return;
      if (current) current.appliedCount++;
      const measured = { ...sample, manualReviewMs: automatic ? 0 : sample?.reviewReadyAt ? startAt - sample.reviewReadyAt : null,
        commitMs: performance.now() - startAt, measurementLayer: 'BROWSER_RUNTIME', acousticGate: 'NOT_EXECUTED', automatic };
      const finalAt = measured.finalResultAt;
      delete measured.reviewReadyAt; delete measured.finalResultAt;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        measured.confirmToSecondRafMs = performance.now() - startAt;
        if (automatic && finalAt) measured.finalToAppliedSecondRafMs = performance.now() - finalAt;
        metrics.push(measured); if (metrics.length > 100) metrics.shift();
      }));
      lastApplied = `Aplicado: ${label}. ${command.type==='action'?'Ação registrada na mesa.':'Próxima posição selecionada.'} Diga “desfazer” para corrigir.`;
      review.hidden = true; $('voice-transcript').textContent = ''; $('voice-proposal').textContent = '';
      if (automatic && current && run === current) {
        if (!session.resume(current.id, context())) throw Error('Não foi possível continuar a escuta. As entradas aplicadas foram mantidas.');
        watchContext(); armIdleTimer(); say(lastApplied);
      } else if (automatic && wantListening) { session.cancel(); restart = true; say(lastApplied); }
      else cancel(lastApplied);
    } catch (error) { cancel(); say(error.message, true); }
    finally {
      committing = false; $('voice-apply').disabled = false; controls();
      if (restart && epoch === operationEpoch) resumeCapture();
    }
  }
  $('voice-hold').addEventListener('pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); void start({hold:true}); });
  $('voice-hold').addEventListener('pointerup', stop);
  $('voice-hold').addEventListener('pointercancel', () => cancel('Gesto cancelado.'));
  $('voice-hold').addEventListener('keydown', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) void start({hold:true}); } });
  $('voice-hold').addEventListener('keyup', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); stop(); } });
  $('voice-toggle').onclick = () => run || wantListening ? stop() : void start();
  $('voice-cancel').onclick = () => cancel('Fala cancelada. Entradas anteriores mantidas.');
  $('voice-apply').onclick = () => void apply();
  for (const id of ['voice-language', 'voice-processing', 'voice-consent', 'voice-auto-apply', 'voice-pace']) $(id).addEventListener('change', () => {
    cancel('Configuração alterada. Dite novamente.');
    $('voice-consent').parentElement.hidden = $('voice-processing').value === 'device';
    $('voice-privacy').textContent = $('voice-processing').value === 'device'
      ? 'O reconhecimento foi configurado para este dispositivo. O THEIBS não grava áudio nem salva transcrições.'
      : 'O serviço de voz do navegador pode enviar áudio ao provedor do navegador. Destino e retenção dependem dele. O THEIBS não grava áudio nem salva transcrições.';
  });
  disclosure.addEventListener('toggle', () => { if (!disclosure.open && pending()) cancel('Entrada por voz fechada. Microfone encerrado.'); });
  document.addEventListener('keydown', event => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyV' && !event.repeat) {
      if (!active() || event.target.closest?.('input,textarea,select,[contenteditable]')) return;
      event.preventDefault(); run || wantListening ? stop() : void start(); return;
    }
    if (!pending() && !committing) return;
    if (event.key === 'Escape') { event.preventDefault(); cancel('Cancelado.'); }
    else if (!committing && !['Tab', 'Alt', 'Control', 'Meta'].includes(event.key) &&
      !(panel.contains(event.target) && [' ', 'Enter'].includes(event.key))) cancel('Teclado utilizado. Fala cancelada para preservar a entrada.');
  }, true);
  for (const name of ['theibs:cards-changed', 'theibs:card-selection']) document.addEventListener(name, () => {
    if (pending() && !committing) cancel('A mesa ou seleção mudou. Dite novamente.');
  });
  document.addEventListener('theibs:voice-session-changed', () => { if (pending() || committing) cancel('Sessão expirada ou alterada. Voz cancelada.'); });
  for (const name of ['input', 'change', 'click']) document.addEventListener(name, event => {
    if (pending() && !committing && !panel.contains(event.target)) cancel('O contexto foi alterado. Nenhuma fala pendente será aplicada.');
  }, true);
  // Auth owns storage/session continuity: a healthy token refresh preserves
  // its epoch. Logout, identity changes and failures emit the event above.
  for (const name of ['blur', 'offline', 'pagehide']) window.addEventListener(name, () => { if (pending()) cancel('Voz cancelada ao interromper a página ou sessão.'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && pending()) cancel('Voz cancelada ao sair da página.'); });
  const observer = new MutationObserver(() => { if (!committing && pending() && JSON.stringify(context()) !== expectedContext()) cancel('Tela ou sessão alterada. Voz cancelada.'); });
  for (const element of [document.querySelector('#analyze-workspace'), document.querySelector('#app-shell'), document.body])
    if (element) observer.observe(element, { attributes: true, attributeFilter: ['class', 'hidden', 'inert', 'data-multiway', 'data-multiway-busy'] });
  window.theibsCardVoice = { cancel, getStatus: () => ({ phase: session.phase, listening: Boolean(run) || wantListening, committing, autoApply: autoApply(), pace: $('voice-pace').value, finalizing: Boolean(run?.closing), acoustic: 'NOT_EXECUTED' }),
    getMetrics: () => metrics.map(row => ({ ...row })), capability: () => ({ secureContext: window.isSecureContext, constructorPresent: Boolean(Recognition),
      functionalRecognition: 'NOT_VERIFIED', acoustic: 'NOT_EXECUTED', localAvailabilityCheck: typeof Recognition?.available === 'function' }) };
  controls();
  if (!Recognition) say('Voz indisponível neste navegador. O teclado permanece disponível.', true);
})();
