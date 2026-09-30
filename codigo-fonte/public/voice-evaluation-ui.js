/* Opt-in, one-prompt microphone evaluation. It never calls the live table's
 * commit boundary. The recognizer's transcript exists only during a trial. */
(function () {
  'use strict';
  if (typeof document === 'undefined' || !window.TheibsVoiceEvaluation || !window.theibsCardVoice) return;
  const host = document.querySelector('#card-voice .voice-guide') || document.querySelector('#card-voice');
  if (!host) return;
  const api = window.TheibsVoiceEvaluation, Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const panel = document.createElement('details'); panel.id = 'voice-evaluation';
  panel.innerHTML = `<summary>Optional voice evaluation</summary>
    <p class="voice-help">Test short phrases without changing your hand. The microphone opens only when you choose “Test this phrase”. THEIBS does not record audio, save transcripts, or send test results. Results stay in this page's memory until you clear them or leave.</p>
    <div class="voice-options">
      <label>Evaluation language<select id="voice-eval-language"><option value="pt-BR">Portuguese (Brazil) · PT-BR</option><option value="en-US">English (US) · EN-US</option></select></label>
      <label>Speech processing<select id="voice-eval-processing"><option value="browser">Browser speech service</option><option value="device">On this device only</option></select></label>
      <label>Omaha variant<select id="voice-eval-count"><option value="4">PLO4</option><option value="5" selected>PLO5</option><option value="6">PLO6</option></select></label>
      <label>Environment<select id="voice-eval-condition"><option value="clean">Quiet</option><option value="moderate-noise">Moderate noise</option></select></label>
      <label>Phrase set<select id="voice-eval-split"><option value="development">Practice and tuning</option><option value="evaluation">Held-out evaluation</option></select></label>
    </div>
    <p class="voice-help">For the held-out evaluation, read each phrase once and keep mistakes in the results. You report noise yourself; this test does not measure volume. Follow the technical evaluation protocol when comparing versions with the same audio.</p>
    <label class="voice-consent"><input id="voice-eval-consent" type="checkbox"> I choose to participate and will read the phrases aloud myself.</label>
    <label class="voice-consent" id="voice-eval-remote-label"><input id="voice-eval-remote" type="checkbox"> I allow the browser speech service for this test. It may send audio to its provider, whose retention policy depends on that provider.</label>
    <p class="voice-help" id="voice-eval-progress"></p><p><strong id="voice-eval-prompt"></strong></p>
    <div class="voice-actions"><button id="voice-eval-start" type="button">Test this phrase</button><button id="voice-eval-stop" type="button" disabled>Finish speaking</button><button id="voice-eval-cancel" type="button" disabled>Cancel test</button><button id="voice-eval-next" type="button">Next phrase</button></div>
    <p id="voice-eval-status" role="status" aria-live="polite" class="voice-help">Read the phrase when Listening appears. Your table remains unchanged.</p>
    <p id="voice-eval-summary" class="voice-help">No human voice tests have run on this page.</p>
    <p class="voice-help">Accuracy includes interpretation and destination at a simulated table. “Detected speech end → final result” uses a browser event; it does not measure actual acoustic end or updates to your table. One speaker and a few examples cannot establish accuracy for all players.</p>
    <div class="voice-actions"><button id="voice-eval-export" type="button" disabled>Download aggregate results</button><button id="voice-eval-clear" type="button" disabled>Clear results</button></div>`;
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
    $('progress').textContent = `Phrase ${position + 1} of ${list.length} · ${$('split').value === 'evaluation' ? 'held-out evaluation' : 'practice and tuning'}${lastTested ? ' · already tested; repeats also count' : ''}`;
    $('prompt').textContent = list[position]?.phrase || 'Phrase set complete.';
    controls();
  }
  function configure() {
    cancel('Settings changed. The active test was cancelled.');
    list = api.corpus({locale:$('language').value,count:Number($('count').value),split:$('split').value});
    position = 0; lastTested = false; prompt();
  }
  function summary() {
    if (!records.length) { $('summary').textContent = 'No human voice tests have run on this page.'; controls(); return; }
    const total = api.aggregate(records).total, pct = n => `${(n*100).toFixed(1)}%`, interval = total.interval;
    $('summary').textContent = `${total.exact}/${total.attempts} exact answers (${pct(total.accuracy)}; illustrative 95% interval: ${pct(interval.low)}–${pct(interval.high)}). ` +
      `${total.lost} not applied, ${total.wrongApplications} wrong applications in the simulation, ${total.falseAcceptances} false acceptances, ${total.clarifications} clarification requests, and ${total.refusals} refusals. ` +
      `Includes ${total.startFailures} start failures, ${total.timeouts} timeouts, and ${total.cancellations} cancellations. Samples from one speaker are not independent.`;
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
    const latency = timing.speechEndEventToFinalMs == null ? '' : ` Detected speech end → final: ${Math.round(timing.speechEndEventToFinalMs)} ms.`;
    if (outcome === 'final') say((result.exact ? (result.expectedRejected ? 'Correct refusal: the phrase produced no valid command.' : 'Correct: command and destination match in the simulation.')
      : result.wrongApplication ? 'Recognition would produce an incorrect entry. The real table was not changed.' : 'The phrase was not fully recognized. This attempt remains a failure.') + latency);
    else say(({start_failure:'Could not start. This attempt was recorded as a failure.',timeout:'The test timed out. This attempt was recorded.',cancelled:'Test cancelled. This attempt was recorded.',no_final:'No final phrase was received. This attempt was recorded.',recognizer_error:'The speech service failed. This attempt was recorded.'})[outcome] || 'Attempt ended.');
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
      if (current === run) say('The browser has not confirmed that the microphone closed. Reload the page before starting another capture.');
    },3000);
    controls();
  }
  function cancel(message) {
    if (!current) return;
    abort(current,'cancelled'); if (message) say(message);
  }
  async function start() {
    if (current) return;
    if (!eligible() || !Recognition) { say('Open Analyze in a secure, compatible browser to run this test.'); return; }
    if (!$('consent').checked || ($('processing').value === 'browser' && !$('remote').checked)) { say('Confirm your test consent and, if selected, browser service consent.'); return; }
    const run = {trial:list[position], beganAt:now(), readyAt:null, firstResultAt:null, speechEndedAt:null, finalAt:null,
      finals:new Map(), invalidFinals:new Set(), finalRevisions:0, started:false, startCalled:false, closing:false, cancelled:false, recorded:false, recognition:null,
      config:{condition:$('condition').value,processing:$('processing').value,version:document.title.match(/\b\d+\.\d+\.\d+\b/)?.[0] || 'unknown'}};
    current = run; controls(); say('Preparing the test… wait for Listening.');
    run.timer = setTimeout(() => abort(run,'timeout'),15000);
    run.monitor = setInterval(() => { if (!eligible()) cancel('Page or session changed. Test cancelled.'); },150);
    try {
      if (typeof window.theibsCardVoice.releaseCaptureForEvaluation !== 'function') throw Error('Reload the page to run the evaluation with exclusive microphone access.');
      await window.theibsCardVoice.releaseCaptureForEvaluation();
      if (current !== run || run.cancelled) return;
      if (run.config.processing === 'device') {
        if (typeof Recognition.available !== 'function' || !('processLocally' in Recognition.prototype)) throw Error('On-device recognition is unavailable. No alternate service was started.');
        const available = await Recognition.available({langs:[run.trial.locale],processLocally:true});
        if (current !== run || run.cancelled) return;
        if (available !== 'available') throw Error('The selected language is unavailable on this device. No language package was installed.');
      }
      if (!eligible() || current !== run || run.cancelled) { cancel('The page context changed before capture.'); return; }
      const rec = new Recognition(); run.recognition = rec;
      rec.lang = run.trial.locale; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 1;
      if (run.config.processing === 'device') rec.processLocally = true;
      rec.onstart = () => { if (current !== run || run.cancelled) return; run.started = true; say('Speech service started. Preparing audio capture…'); controls(); };
      rec.onaudiostart = () => { if (current !== run || run.cancelled) return; run.readyAt = now(); say('Listening. Read the phrase above.'); };
      rec.onaudioend = () => { if (current === run && !run.cancelled) say('Audio capture ended. Processing the phrase…'); };
      rec.onspeechend = () => { if (current === run && !run.cancelled) run.speechEndedAt = now(); };
      rec.onresult = event => {
        if (current !== run || run.cancelled || !eligible()) { if (current === run && !run.cancelled) cancel('The page context changed. Test cancelled.'); return; }
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
        say(run.finals.size ? 'Result received. Closing capture…' : 'Listening…');
      };
      rec.onerror = event => { if (current !== run || run.cancelled) return; abort(run,run.started ? 'recognizer_error' : 'start_failure');
        if (['not-allowed','service-not-allowed'].includes(event.error)) say('Microphone permission denied. This attempt was recorded as a start failure.'); };
      rec.onend = () => { if (current !== run) return; if (!run.recorded) closeRecord(run,!eligible() ? 'cancelled' : run.finals.size ? 'final' : 'no_final'); release(run); };
      run.startCalled = true; rec.start();
    } catch (error) {
      if (current !== run || run.cancelled) return;
      closeRecord(run,'start_failure');
      // A synchronous start() throw never established a native capture.
      run.startCalled = false; release(run); say(error.message + ' This failure was included in the results.');
    }
  }
  $('start').onclick = () => void start();
  $('stop').onclick = () => { const run = current; if (!run?.started || run.closing) return;
    run.closing = true; controls(); say('Finishing the phrase…'); try { run.recognition.stop(); } catch { abort(run,'recognizer_error'); } };
  $('cancel').onclick = () => cancel();
  $('next').onclick = () => { if (current || position >= list.length-1) return; position++; lastTested = false; prompt(); say('Read the next phrase when you start the test.'); };
  $('clear').onclick = () => { if (current) return; records = []; summary(); say('Results were cleared from this page memory.'); };
  $('export').onclick = () => {
    if (current || !records.length) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(api.aggregate(records),null,2)],{type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'theibs-voice-evaluation-aggregate.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  for (const id of ['language','processing','count','condition','split']) $(id).addEventListener('change',configure);
  for (const id of ['consent','remote']) $(id).addEventListener('change',()=> { if (!$(id).checked) cancel('Consent withdrawn. Capture ended.'); });
  for (const id of ['voice-language','voice-processing','voice-consent','voice-auto-apply']) document.getElementById(id)?.addEventListener('change',()=>cancel('Voice setting changed. Test cancelled.'));
  panel.addEventListener('toggle',()=> { if (!panel.open) cancel('Test closed. Capture ended.'); });
  document.querySelector('#card-voice-disclosure')?.addEventListener('toggle',()=> { if (!document.querySelector('#card-voice-disclosure').open) cancel('Voice settings closed. Test cancelled.'); });
  document.addEventListener('theibs:voice-session-changed',()=>cancel('Session changed. Test cancelled.'));
  for (const name of ['blur','offline','pagehide']) window.addEventListener(name,()=>cancel('Page or connection interrupted. Test cancelled.'));
  document.addEventListener('visibilitychange',()=> { if (document.hidden) cancel('Page hidden. Test cancelled.'); });
  document.addEventListener('keydown',event=> { if (event.key === 'Escape' && current) { event.preventDefault(); cancel('Test cancelled.'); } },true);
  window.theibsVoiceEvaluation = { isActive:()=>Boolean(current), cancel, getSummary:()=>api.aggregate(records) };
  $('language').value = document.getElementById('voice-language')?.value || 'pt-BR';
  $('processing').value = document.getElementById('voice-processing')?.value || 'browser';
  configure();
})();
