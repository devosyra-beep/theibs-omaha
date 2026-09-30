/* Opt-in, one-prompt microphone evaluation. It never calls the live table's
 * commit boundary. The recognizer's transcript exists only during a trial. */
(function () {
  'use strict';
  if (typeof document === 'undefined' || !window.TheibsVoiceEvaluation || !window.theibsCardVoice) return;
  const host = document.querySelector('#voice-settings-dialog .dialog-content') || document.querySelector('#card-voice');
  if (!host) return;
  const api = window.TheibsVoiceEvaluation, Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const panel = document.createElement('details'); panel.id = 'voice-evaluation';
  panel.innerHTML = `<summary>Phrase practice</summary>
    <p class="voice-help">Check cards and commands without changing your hand. This checks recognition; it does not train the speech engine.</p>
    <details class="voice-eval-setup"><summary>Practice setup <small id="voice-eval-config"></small></summary><div class="voice-options">
      <label>Practice language<select id="voice-eval-language"><option value="pt-BR">Portuguese (Brazil) · PT-BR</option><option value="en-US">English (US) · EN-US</option></select></label>
      <label>Audio processing<select id="voice-eval-processing"><option value="device">This device only</option><option value="browser">Browser speech service</option></select></label>
      <label>Omaha variant<select id="voice-eval-count"><option value="4">PLO4</option><option value="5" selected>PLO5</option><option value="6">PLO6</option></select></label>
      <label>Phrase set<select id="voice-eval-split"><option value="practice">All command types</option><option value="development">Development benchmark</option><option value="evaluation">Fixed evaluation benchmark</option></select></label>
    </div></details>
    <label class="voice-consent"><input id="voice-eval-consent" type="checkbox"> Enable microphone tests</label>
    <label class="voice-consent" id="voice-eval-remote-label"><input id="voice-eval-remote" type="checkbox"> Allow the browser speech service to process test audio, potentially on its provider's servers.</label>
    <label class="voice-phrase-select">Choose a phrase<select id="voice-eval-phrase"></select></label>
    <p class="voice-help" id="voice-eval-progress"></p><p class="voice-prompt"><strong id="voice-eval-prompt"></strong></p><p class="voice-help" id="voice-eval-context" hidden></p>
    <div class="voice-actions"><button id="voice-eval-previous" type="button">Previous</button><button id="voice-eval-start" type="button">Test phrase</button><button id="voice-eval-stop" type="button" disabled>Finish speaking</button><button id="voice-eval-cancel" type="button" disabled>Cancel test</button><button id="voice-eval-next" type="button">Next</button></div>
    <label class="voice-consent"><input id="voice-eval-advance" type="checkbox" checked> Show the next phrase after each attempt</label>
    <p id="voice-eval-status" role="status" aria-live="polite" class="voice-help">Start a test, then speak when Listening appears.</p>
    <details class="voice-eval-results"><summary>Results & test details</summary>
      <p id="voice-eval-summary" class="voice-help">No microphone tests yet.</p>
      <div class="voice-actions"><button id="voice-eval-export" type="button" disabled>Download results</button><button id="voice-eval-clear" type="button" disabled>Clear results</button></div>
      <label>Environment<select id="voice-eval-condition"><option value="clean">Quiet</option><option value="moderate-noise">Moderate noise</option></select></label>
      <p class="voice-help">The microphone opens only for an explicit test. THEIBS does not record audio or save transcripts. Results stay in this page's memory. Browser speech processing may send audio to its provider when you select and allow it.</p>
      <p class="voice-help">The checklist covers all 52 cards and supported command types, not every possible wording. Results are separate for each set. Read each benchmark phrase once and retain mistakes. Practiced phrases are no longer an unseen evaluation for that speaker.</p>
      <p class="voice-help">Results include interpretation at a simulated table. Timing uses the browser speech-end event, not acoustic measurements. Environment is self-reported; one speaker's results do not establish accuracy for everyone.</p>
    </details>`;
  const guide = host.querySelector('.voice-guide');
  if (guide) guide.before(panel); else host.append(panel);
  const $ = id => panel.querySelector('#voice-eval-' + id);
  let list = [], position = 0, current = null, records = [], completed = new Set();
  const customized = new Set();
  const trialKey = (trial, processing = $('processing').value) => `${trial.id}|${processing}`;
  const currentRecords = () => records.filter(item => item.locale === $('language').value && item.count === Number($('count').value) && item.split === $('split').value && item.processing === $('processing').value);
  const now = () => performance.now();
  const eligible = () => window.isSecureContext && !document.hidden && navigator.onLine !== false &&
    !window.theibsVoiceSessionContext?.().expired && !document.querySelector('#analyze-workspace')?.classList.contains('hidden') &&
    !document.querySelector('#app-shell')?.hidden && !document.querySelector('#app-shell')?.hasAttribute('inert') && !document.querySelector('dialog[open]:not(#voice-settings-dialog)');
  function say(text) { $('status').textContent = text; }
  function controls() {
    const busy = Boolean(current);
    $('start').disabled = busy || !Recognition || !window.isSecureContext || !list[position];
    $('stop').disabled = !current?.started || current.closing;
    $('cancel').disabled = !busy || current.cancelled;
    $('next').disabled = busy || position >= list.length - 1;
    $('previous').disabled = busy || position <= 0;
    $('phrase').disabled = busy; $('advance').disabled = busy;
    $('export').disabled = !currentRecords().length || busy; $('clear').disabled = !records.length || busy;
    for (const id of ['language','processing','count','condition','split']) $(id).disabled = busy;
    $('remote-label').hidden = $('processing').value === 'device';
  }
  function prompt() {
    const done = list.filter(item => completed.has(trialKey(item))).length;
    $('progress').textContent = `${done} of ${list.length} attempted${list[position] ? ` · Phrase ${position + 1}${completed.has(trialKey(list[position])) ? ' · attempted' : ''}` : ' · End of set'}`;
    $('prompt').textContent = list[position]?.phrase || 'End of set. Choose any phrase to continue.';
    const trial = list[position];
    $('context').textContent = trial?.expected === null ? 'Rejection check: this phrase should leave the simulated hand unchanged.'
      : trial?.context?.pendingAmount ? 'Simulated Hero turn: a raise is waiting for its total amount.'
      : trial?.actionActor ? 'Simulated Hero turn: record the action for the highlighted player.'
      : trial?.initial ? 'The simulation supplies the cards needed for this edit.' : '';
    $('context').hidden = !$('context').textContent;
    $('phrase').value = list[position] ? String(position) : '';
    $('config').textContent = `${$('language').value.toUpperCase()} · PLO${$('count').value} · ${$('processing').value === 'device' ? 'This device only' : 'Browser service'}${$('split').value === 'practice' ? '' : ' · Benchmark'}`;
    controls();
  }
  function configure() {
    cancel('Settings changed. The active test was cancelled.');
    list = api.corpus({locale:$('language').value,count:Number($('count').value),split:$('split').value});
    const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    $('phrase').innerHTML = list.map((item,index) => `<option value="${index}">${index+1}. ${escape(item.phrase)}</option>`).join('');
    position = 0; prompt(); summary();
  }
  function summary() {
    const selectedRecords = currentRecords();
    if (!selectedRecords.length) { $('summary').textContent = 'No microphone tests for this selection yet.'; controls(); return; }
    const total = api.aggregate(selectedRecords).total, pct = n => `${(n*100).toFixed(1)}%`, interval = total.interval;
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
    completed.add(trialKey(run.trial,run.config.processing));
    const latency = timing.speechEndEventToFinalMs == null ? '' : ` Detected speech end → final: ${Math.round(timing.speechEndEventToFinalMs)} ms.`;
    if (outcome === 'final') say((result.exact ? (result.expectedRejected ? 'Correct refusal: the phrase produced no valid command.' : 'Correct: command and destination match in the simulation.')
      : result.wrongApplication ? 'Recognition would produce an incorrect entry. The real table was not changed.' : 'The phrase was not fully recognized. This attempt remains a failure.') + latency);
    else say(({start_failure:'Could not start. This attempt was recorded as a failure.',timeout:'The test timed out. This attempt was recorded.',cancelled:'Test cancelled. This attempt was recorded.',no_final:'No final phrase was received. This attempt was recorded.',recognizer_error:'The speech service failed. This attempt was recorded.'})[outcome] || 'Attempt ended.');
    if ($('advance').checked && !['start_failure','cancelled'].includes(outcome)) {
      position = Math.min(position + 1, list.length);
      say('Previous phrase: ' + $('status').textContent);
    }
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
  $('next').onclick = () => { if (current || position >= list.length-1) return; position++; prompt(); say('Read the next phrase when you start the test.'); };
  $('previous').onclick = () => { if (current || position <= 0) return; position--; prompt(); };
  $('phrase').addEventListener('change', () => { if (current) return; const next = Number($('phrase').value); if (Number.isInteger(next) && list[next]) { position=next; prompt(); } });
  $('clear').onclick = () => { if (current) return; records = []; completed.clear(); prompt(); summary(); say('Results were cleared from this page memory.'); };
  $('export').onclick = () => {
    if (current || !currentRecords().length) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(api.aggregate(currentRecords()),null,2)],{type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'theibs-voice-evaluation-aggregate.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  for (const id of ['language','processing','count','condition','split']) $(id).addEventListener('change',()=>{ customized.add(id); configure(); });
  for (const id of ['consent','remote']) $(id).addEventListener('change',()=> { if (!$(id).checked) cancel('Consent withdrawn. Capture ended.'); });
  for (const id of ['voice-language','voice-processing','voice-consent','voice-auto-apply']) document.getElementById(id)?.addEventListener('change',()=>{
    cancel('Voice setting changed. Test cancelled.');
    const local = id.slice('voice-'.length);
    if (['language','processing'].includes(local) && !customized.has(local)) { $(local).value = document.getElementById(id).value; configure(); }
  });
  // A one-phrase test must not keep a hidden microphone capture. The table's
  // separate enabled preference remains intact and resumes after release.
  document.getElementById('voice-settings-dialog')?.addEventListener('close',()=>cancel('Voice options closed. Test cancelled.'));
  document.addEventListener('theibs:voice-session-changed',()=>cancel('Session changed. Test cancelled.'));
  for (const name of ['blur','offline','pagehide']) window.addEventListener(name,()=>cancel('Page or connection interrupted. Test cancelled.'));
  document.addEventListener('visibilitychange',()=> { if (document.hidden) cancel('Page hidden. Test cancelled.'); });
  document.addEventListener('keydown',event=> { if (event.key === 'Escape' && current && !document.querySelector('#voice-settings-dialog[open]')) { event.preventDefault(); cancel('Test cancelled.'); } },true);
  window.theibsVoiceEvaluation = { isActive:()=>Boolean(current), cancel, getSummary:()=>api.aggregate(records) };
  $('language').value = document.getElementById('voice-language')?.value || 'pt-BR';
  $('processing').value = document.getElementById('voice-processing')?.value || 'device';
  $('count').value = document.getElementById('variant-select')?.value || '5';
  $('advance').checked = true;
  configure();
})();
