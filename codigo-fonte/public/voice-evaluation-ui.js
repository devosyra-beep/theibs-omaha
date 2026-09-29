/* Opt-in, one-prompt microphone evaluation. It never calls the live table's
 * commit boundary. The recognizer's transcript exists only during a trial. */
(function () {
  'use strict';
  if (typeof document === 'undefined' || !window.TheibsVoiceEvaluation || !window.theibsCardVoice) return;
  const host = document.querySelector('#card-voice .voice-guide') || document.querySelector('#card-voice');
  if (!host) return;
  const api = window.TheibsVoiceEvaluation, Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const panel = document.createElement('details'); panel.id = 'voice-evaluation';
  panel.innerHTML = `<summary>Teste voluntário da sua voz</summary>
    <p class="voice-help">Teste frases curtas sem alterar sua mão. O microfone só abre ao clicar em “Testar esta frase”. Não gravamos áudio, não salvamos transcrições e não enviamos resultados. Os resultados ficam na memória desta página até você limpar ou sair.</p>
    <div class="voice-options">
      <label>Idioma do teste<select id="voice-eval-language"><option value="pt-BR">Português (Brasil)</option><option value="en-US">English (US)</option></select></label>
      <label>Reconhecimento do teste<select id="voice-eval-processing"><option value="browser">Serviço do navegador</option><option value="device">Somente neste dispositivo</option></select></label>
      <label>Variante do teste<select id="voice-eval-count"><option value="4">PLO4</option><option value="5" selected>PLO5</option><option value="6">PLO6</option></select></label>
      <label>Condição do ambiente<select id="voice-eval-condition"><option value="clean">Ambiente silencioso</option><option value="moderate-noise">Ruído moderado</option></select></label>
      <label>Conjunto de frases<select id="voice-eval-split"><option value="development">Prática e ajuste</option><option value="evaluation">Avaliação reservada</option></select></label>
    </div>
    <p class="voice-help">Na avaliação reservada, leia cada frase uma vez e mantenha também os erros. O ruído é informado por você, sem medição de volume. Para comparar versões com os mesmos áudios, siga o protocolo técnico de avaliação.</p>
    <label class="voice-consent"><input id="voice-eval-consent" type="checkbox"> Quero participar voluntariamente e vou ler as frases com minha própria voz.</label>
    <label class="voice-consent" id="voice-eval-remote-label"><input id="voice-eval-remote" type="checkbox"> Permito o serviço do navegador neste teste. Ele pode enviar áudio ao provedor do navegador, cuja retenção depende do provedor.</label>
    <p class="voice-help" id="voice-eval-progress"></p><p><strong id="voice-eval-prompt"></strong></p>
    <div class="voice-actions"><button id="voice-eval-start" type="button">Testar esta frase</button><button id="voice-eval-stop" type="button" disabled>Encerrar fala</button><button id="voice-eval-cancel" type="button" disabled>Cancelar teste</button><button id="voice-eval-next" type="button">Próxima frase</button></div>
    <p id="voice-eval-status" role="status" aria-live="polite" class="voice-help">Leia a frase quando aparecer “Ouvindo”. Sua mesa permanece intacta.</p>
    <p id="voice-eval-summary" class="voice-help">Nenhum teste humano executado nesta página.</p>
    <p class="voice-help">A exatidão inclui interpretação e destino em uma mesa simulada. O tempo “fim detectado → resultado final” usa o evento do navegador; não mede o fim acústico real nem a atualização da sua mesa. Uma pessoa e poucos exemplos não validam precisão para todos os jogadores.</p>
    <div class="voice-actions"><button id="voice-eval-export" type="button" disabled>Baixar resultados agregados</button><button id="voice-eval-clear" type="button" disabled>Limpar resultados</button></div>`;
  host.append(panel);
  const $ = id => panel.querySelector('#voice-eval-' + id);
  let list = [], position = 0, current = null, records = [], lastTested = false;
  const now = () => performance.now();
  const eligible = () => window.isSecureContext && !document.hidden && navigator.onLine !== false &&
    !window.theibsVoiceSessionContext?.().expired && !document.querySelector('#analyze-workspace')?.classList.contains('hidden') &&
    !document.querySelector('#app-shell')?.hidden && !document.querySelector('#app-shell')?.hasAttribute('inert') && !document.querySelector('dialog[open]');
  function say(text) { $('status').textContent = text; }
  function controls() {
    const busy = Boolean(current);
    $('start').disabled = busy || !Recognition || !window.isSecureContext || !list[position];
    $('stop').disabled = !current?.started || current.closing;
    $('cancel').disabled = !busy || current.cancelled;
    $('next').disabled = busy || position >= list.length - 1;
    $('export').disabled = !records.length || busy; $('clear').disabled = !records.length || busy;
    for (const id of ['language','processing','count','condition','split']) $(id).disabled = busy;
    $('remote-label').hidden = $('processing').value === 'device';
  }
  function prompt() {
    $('progress').textContent = `Frase ${position + 1} de ${list.length} · ${$('split').value === 'evaluation' ? 'avaliação reservada' : 'prática e ajuste'}${lastTested ? ' · já testada; repetições também contam' : ''}`;
    $('prompt').textContent = list[position]?.phrase || 'Conjunto concluído.';
    controls();
  }
  function configure() {
    cancel('Configuração alterada. O teste em andamento foi cancelado.');
    list = api.corpus({locale:$('language').value,count:Number($('count').value),split:$('split').value});
    position = 0; lastTested = false; prompt();
  }
  function summary() {
    if (!records.length) { $('summary').textContent = 'Nenhum teste humano executado nesta página.'; controls(); return; }
    const total = api.aggregate(records).total, pct = n => `${(n*100).toFixed(1)}%`, interval = total.interval;
    $('summary').textContent = `${total.exact}/${total.attempts} respostas exatas (${pct(total.accuracy)}; intervalo ilustrativo de 95%: ${pct(interval.low)}–${pct(interval.high)}). ` +
      `${total.lost} não aplicadas, ${total.wrongApplications} aplicações incorretas na simulação, ${total.falseAcceptances} aceitações indevidas, ${total.clarifications} pedidos de esclarecimento e ${total.refusals} recusas. ` +
      `Inclui ${total.startFailures} falhas de início, ${total.timeouts} tempos esgotados e ${total.cancellations} cancelamentos. Amostras da mesma pessoa não são independentes.`;
    controls();
  }
  function closeRecord(run, outcome) {
    if (run.recorded) return;
    run.recorded = true;
    const text = [...run.finals.entries()].sort((a,b)=>a[0]-b[0]).map(([,value])=>value).join(' ');
    const result = api.score(run.trial, text, {outcome,finalRevisions:run.finalRevisions});
    const scored = now(), timing = {startupMs:run.readyAt == null ? null : run.readyAt-run.beganAt,
      firstResultMs:run.firstResultAt == null ? null : run.firstResultAt-run.beganAt,
      speechEndEventToFinalMs:run.speechEndedAt != null && run.finalAt != null && run.finalAt>=run.speechEndedAt ? run.finalAt-run.speechEndedAt : null,
      finalToScoreMs:run.finalAt == null ? null : scored-run.finalAt, totalMs:scored-run.beganAt};
    run.finals.clear();
    records.push(api.record(run.trial,result,timing,run.config));
    lastTested = true;
    const latency = timing.speechEndEventToFinalMs == null ? '' : ` Fim detectado → final: ${Math.round(timing.speechEndEventToFinalMs)} ms.`;
    if (outcome === 'final') say((result.exact ? (result.expectedRejected ? 'Recusa correta: a frase não gerou comando válido.' : 'Correto: comando e destino conferem na simulação.')
      : result.wrongApplication ? 'O reconhecimento produziria uma entrada incorreta. A mesa real não foi alterada.' : 'A frase não foi reconhecida por completo. O resultado foi mantido como falha.') + latency);
    else say(({start_failure:'Não foi possível iniciar. A falha entrou no resultado.',timeout:'O tempo terminou sem conclusão. A tentativa entrou no resultado.',cancelled:'Teste cancelado. A tentativa entrou no resultado.',no_final:'Nenhuma frase final recebida. A tentativa entrou no resultado.',recognizer_error:'O serviço de voz falhou. A tentativa entrou no resultado.'})[outcome] || 'Tentativa encerrada.');
    summary(); prompt();
  }
  function release(run) {
    clearTimeout(run.timer); clearTimeout(run.releaseTimer); clearInterval(run.monitor);
    run.finals.clear();
    if (current === run) current = null;
    controls();
  }
  function abort(run, outcome) {
    if (current !== run || run.cancelled) return;
    run.cancelled = true; run.closing = true; closeRecord(run,outcome); clearTimeout(run.timer);
    if (!run.recognition || !run.startCalled) { release(run); return; }
    try { run.recognition.abort(); } catch {}
    // Keep the ownership lock until the native end acknowledges microphone
    // release. A timeout must not allow a second recognizer to open the mic.
    if (current === run) run.releaseTimer = setTimeout(() => {
      if (current === run) say('O navegador ainda não confirmou o encerramento do microfone. Recarregue a página antes de iniciar outra captura.');
    },3000);
    controls();
  }
  function cancel(message) {
    if (!current) return;
    abort(current,'cancelled'); if (message) say(message);
  }
  async function start() {
    if (current) return;
    if (!eligible() || !Recognition) { say('Abra o Analyze em um navegador compatível e seguro para testar.'); return; }
    if (!$('consent').checked || ($('processing').value === 'browser' && !$('remote').checked)) { say('Marque o consentimento do teste e, se escolhido, o do serviço do navegador.'); return; }
    const run = {trial:list[position], beganAt:now(), readyAt:null, firstResultAt:null, speechEndedAt:null, finalAt:null,
      finals:new Map(), invalidFinals:new Set(), finalRevisions:0, started:false, startCalled:false, closing:false, cancelled:false, recorded:false, recognition:null,
      config:{condition:$('condition').value,processing:$('processing').value,version:document.title.match(/\b\d+\.\d+\.\d+\b/)?.[0] || 'unknown'}};
    current = run; controls(); say('Preparando o teste… aguarde “Ouvindo”.');
    run.timer = setTimeout(() => abort(run,'timeout'),15000);
    run.monitor = setInterval(() => { if (!eligible()) cancel('Tela ou sessão alterada. Teste cancelado.'); },150);
    try {
      if (typeof window.theibsCardVoice.releaseCaptureForEvaluation !== 'function') throw Error('Recarregue a página para usar a avaliação com exclusão de microfone.');
      await window.theibsCardVoice.releaseCaptureForEvaluation();
      if (current !== run || run.cancelled) return;
      if (run.config.processing === 'device') {
        if (typeof Recognition.available !== 'function' || !('processLocally' in Recognition.prototype)) throw Error('Reconhecimento local indisponível. Nenhum serviço alternativo foi iniciado.');
        const available = await Recognition.available({langs:[run.trial.locale],processLocally:true});
        if (current !== run || run.cancelled) return;
        if (available !== 'available') throw Error('Idioma local indisponível. Nenhum pacote foi instalado.');
      }
      if (!eligible() || current !== run || run.cancelled) { cancel('O contexto mudou antes da captura.'); return; }
      const rec = new Recognition(); run.recognition = rec;
      rec.lang = run.trial.locale; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 1;
      if (run.config.processing === 'device') rec.processLocally = true;
      rec.onstart = () => { if (current !== run || run.cancelled) return; run.started = true; say('Serviço iniciado. Preparando a captura de áudio…'); controls(); };
      rec.onaudiostart = () => { if (current !== run || run.cancelled) return; run.readyAt = now(); say('Ouvindo. Leia a frase acima.'); };
      rec.onaudioend = () => { if (current === run && !run.cancelled) say('Áudio encerrado. Processando a frase…'); };
      rec.onspeechend = () => { if (current === run && !run.cancelled) run.speechEndedAt = now(); };
      rec.onresult = event => {
        if (current !== run || run.cancelled || !eligible()) { if (current === run && !run.cancelled) cancel('O contexto mudou. Teste cancelado.'); return; }
        run.firstResultAt ??= now();
        for (const [i,text] of run.finals) {
          if (!run.invalidFinals.has(i) && (!event.results[i]?.isFinal || String(event.results[i][0]?.transcript || '') !== text)) {
            run.invalidFinals.add(i); run.finalRevisions++;
          }
        }
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i]; if (!result.isFinal) continue;
          const text = String(result[0]?.transcript || '');
          if (run.finals.has(i)) continue;
          run.finals.set(i,text); run.finalAt = now();
        }
        say(run.finals.size ? 'Resultado recebido. Encerrando a captura…' : 'Ouvindo…');
      };
      rec.onerror = event => { if (current !== run || run.cancelled) return; abort(run,run.started ? 'recognizer_error' : 'start_failure');
        if (['not-allowed','service-not-allowed'].includes(event.error)) say('Permissão de microfone recusada. A tentativa foi registrada como falha de início.'); };
      rec.onend = () => { if (current !== run) return; if (!run.recorded) closeRecord(run,!eligible() ? 'cancelled' : run.finals.size ? 'final' : 'no_final'); release(run); };
      run.startCalled = true; rec.start();
    } catch (error) {
      if (current !== run || run.cancelled) return;
      closeRecord(run,'start_failure');
      // A synchronous start() throw never established a native capture.
      run.startCalled = false; release(run); say(error.message + ' A falha entrou no resultado.');
    }
  }
  $('start').onclick = () => void start();
  $('stop').onclick = () => { const run = current; if (!run?.started || run.closing) return;
    run.closing = true; controls(); say('Concluindo a frase…'); try { run.recognition.stop(); } catch { abort(run,'recognizer_error'); } };
  $('cancel').onclick = () => cancel();
  $('next').onclick = () => { if (current || position >= list.length-1) return; position++; lastTested = false; prompt(); say('Leia a próxima frase ao iniciar o teste.'); };
  $('clear').onclick = () => { if (current) return; records = []; summary(); say('Resultados apagados da memória desta página.'); };
  $('export').onclick = () => {
    if (current || !records.length) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(api.aggregate(records),null,2)],{type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'theibs-avaliacao-voz-agregada.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  for (const id of ['language','processing','count','condition','split']) $(id).addEventListener('change',configure);
  for (const id of ['consent','remote']) $(id).addEventListener('change',()=> { if (!$(id).checked) cancel('Consentimento retirado. Captura encerrada.'); });
  for (const id of ['voice-language','voice-processing','voice-consent','voice-auto-apply']) document.getElementById(id)?.addEventListener('change',()=>cancel('Configuração de voz alterada. Teste cancelado.'));
  panel.addEventListener('toggle',()=> { if (!panel.open) cancel('Teste fechado. Captura encerrada.'); });
  document.querySelector('#card-voice-disclosure')?.addEventListener('toggle',()=> { if (!document.querySelector('#card-voice-disclosure').open) cancel('Entrada por voz fechada. Teste cancelado.'); });
  document.addEventListener('theibs:voice-session-changed',()=>cancel('Sessão alterada. Teste cancelado.'));
  for (const name of ['blur','offline','pagehide']) window.addEventListener(name,()=>cancel('Página ou conexão interrompida. Teste cancelado.'));
  document.addEventListener('visibilitychange',()=> { if (document.hidden) cancel('Página oculta. Teste cancelado.'); });
  document.addEventListener('keydown',event=> { if (event.key === 'Escape' && current) { event.preventDefault(); cancel('Teste cancelado.'); } },true);
  window.theibsVoiceEvaluation = { isActive:()=>Boolean(current), cancel, getSummary:()=>api.aggregate(records) };
  $('language').value = document.getElementById('voice-language')?.value || 'pt-BR';
  $('processing').value = document.getElementById('voice-processing')?.value || 'browser';
  configure();
})();
