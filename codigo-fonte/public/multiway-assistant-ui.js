/* A local confirmation barrier preserves speech order. Optional interpretation
 * is separately gated; poker and direct speech never depend on a text model. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TheibsMultiwayAssistantUI = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const binding = context => JSON.stringify([context?.handId, context?.revisionKey, context?.token, context?.contextKey]);
  const gated = capability => capability?.enabled === true && capability.validatedUses?.includes('ACTION_PROPOSAL') &&
    ['REMOTE_TEXT_ONLY', 'LOCAL_SERVER_TEXT_ONLY'].includes(capability.processing);
  const validOrigin = id => /^[a-zA-Z0-9:._-]{8,128}$/.test(id || '');
  const usable = context => context?.enabled === true && context.active === true && Boolean(context.handId && context.revisionKey && context.token && context.multiway);
  const canModel = context => usable(context) && context.phase === 'BETTING' && !context.pendingAmount && Number.isInteger(context.actor);

  function createController({ request, getContext, resolve, commit, onChange = () => {}, storage = null, timeoutMs = 9000,
    interval = setInterval, clearInterval: stopInterval = clearInterval, later = setTimeout, clearTimeout: stopTimeout = clearTimeout }) {
    let capability = null, optedIn = false, epoch = 0, capabilityEpoch = 0, current = null, timer = null, job = null;
    let queue = [], overflow = 0, view = { phase: 'idle' }, circuit = null, overlappedCalculation = false;
    const seen = new Set(), maxWaiting = 6;
    const circuitKey = () => `theibs.text-assistant.circuit.v1:${capability?.provider || 'none'}:${capability?.model || 'none'}`;
    function emit(next = view) {
      view = next;
      onChange({ ...view, waiting: queue.length, overflow, available: Boolean(gated(capability)), optedIn, capability,
        circuitReason: circuit?.blocked ? 'Turned off after repeated delays or failures. You can opt in again.' : '',
        canDiscard: Boolean(current) && current.phase !== 'applying' });
    }
    function abortInterpretation() { epoch++; job?.abort(); job = null; }
    function stopWatching() { if (timer !== null) stopInterval(timer); timer = null; }
    function watch() { if (timer === null) timer = interval(checkContext, 100); }
    function remember(id) { seen.add(id); if (seen.size > 800) seen.delete(seen.values().next().value); }
    function renderCurrent(message) {
      if (!current) return;
      emit({ phase: current.phase, message: message || current.label || 'Resolve current action',
        method: current.phase === 'proposed' ? (current.fromModel ? 'Text interpretation · confirm to record' : 'Review for the player shown · confirm to record') : '',
        phrase: current.text || '' });
    }
    function clear(reason = 'Pending phrases cleared. Repeat any action that still needs recording.') {
      const count = (current ? 1 : 0) + queue.length + overflow;
      abortInterpretation(); stopWatching(); current = null; queue = []; overflow = 0;
      emit(count ? { phase: 'notice', message: `${count} pending phrase${count === 1 ? '' : 's'} cleared. ${reason}` } : { phase: 'idle' });
    }
    function persistCircuit() { try { storage?.setItem(circuitKey(), JSON.stringify(circuit)); } catch {} }
    function noteAttempt(kind) {
      circuit ||= { blocked: false, outcomes: [], timeouts: 0, slowCalculations: 0 };
      circuit.outcomes = [...circuit.outcomes, kind].slice(-5);
      circuit.timeouts = kind === 'timeout' ? circuit.timeouts + 1 : 0;
      if (circuit.timeouts >= 2 || circuit.outcomes.filter(item => item !== 'ok').length >= 3) circuit.blocked = true;
      if (circuit.blocked) optedIn = false;
      persistCircuit();
    }
    function noteCalculation(elapsedMs) {
      if (!overlappedCalculation) return;
      overlappedCalculation = false;
      if (!Number.isFinite(elapsedMs) || elapsedMs <= 3000) return;
      circuit ||= { blocked: false, outcomes: [], timeouts: 0, slowCalculations: 0 };
      circuit.slowCalculations++;
      if (circuit.slowCalculations >= 2) { circuit.blocked = true; optedIn = false; abortInterpretation(); }
      persistCircuit(); emit();
    }
    function prioritizeCalculation() {
      if (!job) return;
      overlappedCalculation = true;
      abortInterpretation();
      if (current?.phase === 'loading') { current.phase = 'unresolved'; renderCurrent('Calculation has priority. Choose the current action at the table.'); }
    }
    function newSpeech() {
      if (!job && !current?.fromModel) return;
      abortInterpretation();
      if (current?.phase === 'loading' || current?.fromModel) {
        current.phase = 'unresolved'; current.fromModel = false; current.resolved = null; current.label = null;
        renderCurrent('Resolve current action. Following phrases will wait.');
      }
    }
    function setOptIn(value) {
      optedIn = value === true && Boolean(gated(capability));
      if (optedIn) { circuit = { blocked: false, outcomes: [], timeouts: 0, slowCalculations: 0 }; persistCircuit(); }
      else newSpeech();
      emit();
    }
    function resetConsent() { optedIn = false; clear('Session changed. Nothing pending was recorded.'); }
    async function refreshCapabilities() {
      const mine = ++capabilityEpoch;
      try {
        const result = await request('/api/multiway/capabilities', { method: 'GET' });
        if (mine !== capabilityEpoch) return;
        const previous = JSON.stringify([capability?.provider, capability?.model, capability?.processing]);
        capability = result.assistant || null;
        if (!gated(capability) || previous !== JSON.stringify([capability?.provider, capability?.model, capability?.processing])) {
          optedIn = false; newSpeech();
          try { circuit = JSON.parse(storage?.getItem(circuitKey()) || 'null'); } catch { circuit = null; }
        }
        emit();
      } catch { if (mine === capabilityEpoch) { capability = null; optedIn = false; newSpeech(); emit(); } }
    }
    function canInterpret() { return optedIn && !circuit?.blocked && Boolean(gated(capability)) && canModel(getContext()); }
    function resolveCurrent() {
      try {
        const result = resolve(current, current.captured);
        if (!result?.command) throw Error('No complete command.');
        current.resolved = result; current.phase = 'proposed'; current.label = result.label;
      } catch (error) {
        current.resolved = null; current.phase = 'unresolved';
        current.label = current.command ? `Review this entry. ${error.message || 'The current turn does not accept it.'}` : null;
      }
      renderCurrent();
    }
    function present(packet, { allowModel = false } = {}) {
      const captured = clone(getContext());
      current = { ...packet, sourceHandId: packet.sourceHandId || captured.handId,
        sourceRevisionKey: packet.sourceRevisionKey || captured.revisionKey,
        captured, binding: binding(captured), phase: 'unresolved' };
      watch(); resolveCurrent();
      if (allowModel && current.phase === 'unresolved' && !packet.command && packet.allowInterpret !== false && canInterpret()) void interpretCurrent();
    }
    function acceptFinal(packet) {
      if (!validOrigin(packet?.originEventId) || seen.has(packet.originEventId) || !['en-US', 'pt-BR'].includes(packet.locale)) return false;
      if (!packet.command && (typeof packet.text !== 'string' || !packet.text.trim() || packet.text.length > 800)) return false;
      const captured = getContext();
      if (!captured?.handId) return false;
      remember(packet.originEventId);
      const entry = { ...packet, sourceHandId: captured.handId, sourceRevisionKey: captured.revisionKey };
      if (current) {
        newSpeech();
        if (queue.length < maxWaiting && !overflow) queue.push(entry);
        else overflow++;
        renderCurrent(overflow ? `Waiting list full. ${overflow} further phrase${overflow === 1 ? ' was' : 's were'} not kept; repeat after review.` : undefined);
      } else present(entry, { allowModel: true });
      return true;
    }
    function next(message) {
      abortInterpretation(); current = null;
      if (queue.length) {
        const packet = queue.shift(), context = getContext();
        if (packet.sourceHandId !== context?.handId) { clear('The hand changed. Repeat the pending phrases.'); return; }
        present(packet); // Never send queued speech to a model automatically.
        if (message && current.phase !== 'proposed') renderCurrent(message);
      } else {
        stopWatching();
        const dropped = overflow; overflow = 0;
        emit(dropped ? { phase: 'notice', message: `${dropped} extra phrase${dropped === 1 ? ' was' : 's were'} not kept. Repeat before continuing.` } : { phase: 'idle' });
      }
    }
    function discard() { if (current?.phase === 'applying') return; if (current) next(); else emit({ phase: 'idle' }); }
    function checkContext() {
      if (!current || current.phase === 'applying') return;
      const context = getContext();
      if (context?.analysisBusy) prioritizeCalculation();
      if (context?.handId !== current.captured.handId) { clear('The hand changed. Nothing pending was recorded.'); return; }
      if (!context?.enabled) { clear('Voice is off. Nothing pending was recorded.'); return; }
      if (!usable(context)) { newSpeech(); return; }
      if (binding(context) === current.binding) return;
      const before = current.captured.multiway.events || [], after = context.multiway.events || [];
      const completed = after.length === before.length + 1 && after.at(-1)?.type === 'ACT' && after.at(-1)?.actor === current.captured.actor &&
        JSON.stringify(after.slice(0, before.length)) === JSON.stringify(before);
      if (completed) { next('The action was recorded at the table. Review the next phrase.'); return; }
      if (context.revisionKey === current.captured.revisionKey) {
        abortInterpretation(); current.captured = clone(context); current.binding = binding(context); current.fromModel = false;
        resolveCurrent(); return;
      }
      clear('The table was revised. Review and repeat the pending phrases.');
    }
    async function interpretCurrent() {
      const entry = current;
      if (!entry || entry.phase !== 'unresolved' || !canInterpret() || entry.text?.length > 500) return false;
      const mine = ++epoch, controller = new AbortController(); job = controller; entry.phase = 'loading';
      renderCurrent('Interpreting the current action… Following phrases will wait.');
      let timeout, timedOut = false;
      try {
        const remote = capability.processing === 'REMOTE_TEXT_ONLY';
        const result = await Promise.race([
          request('/api/multiway/assistant/interpret', { method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...(remote ? { 'X-Theibs-Remote-Text-Consent': 'true' } : {}) },
            body: JSON.stringify({ multiway: entry.captured.multiway, revisionKey: entry.captured.revisionKey, originEventId: entry.originEventId,
              text: entry.text, locale: entry.locale, ...(remote ? { remoteTextConsent: true } : {}) }) }),
          new Promise((_, reject) => { timeout = later(() => { timedOut = true; controller.abort(); reject(Error('timeout')); }, timeoutMs); })
        ]);
        if (mine !== epoch || current !== entry) return false;
        if (!usable(getContext()) || binding(getContext()) !== entry.binding) { checkContext(); return false; }
        const event = result?.event;
        if (result?.status !== 'PROPOSED') {
          if (result?.status !== 'CLARIFY' && result?.status !== 'BUSY') noteAttempt('failure');
          entry.phase = 'unresolved'; renderCurrent('Choose the current action at the table, or discard this phrase.'); return false;
        }
        if (result.confirmationRequired !== true || result.originEventId !== entry.originEventId || result.revisionKey !== entry.captured.revisionKey ||
          result.handId !== undefined && result.handId !== entry.captured.handId || event?.type !== 'ACT' || event.actor !== entry.captured.actor ||
          !['FOLD','CHECK','CALL','BET','RAISE'].includes(event.action)) throw Error('Invalid proposal binding.');
        const command = { type: 'action', actor: null, action: event.action, ...(event.to === undefined ? {} : { to: event.to }) };
        const resolved = resolve({ command }, entry.captured);
        if (!resolved?.command) throw Error('Invalid proposed command.');
        noteAttempt('ok'); entry.resolved = resolved; entry.phase = 'proposed'; entry.label = resolved.label; entry.fromModel = true;
        renderCurrent(); return true;
      } catch (error) {
        if (mine !== epoch || current !== entry) return false;
        noteAttempt(timedOut ? 'timeout' : 'failure');
        entry.phase = 'unresolved'; renderCurrent('Interpretation unavailable. Choose the current action at the table.'); return false;
      } finally { if (timeout !== undefined) stopTimeout(timeout); if (mine === epoch) job = null; }
    }
    async function confirm() {
      const entry = current;
      if (!entry || entry.phase !== 'proposed' || !usable(getContext()) || binding(getContext()) !== entry.binding) { checkContext(); return false; }
      abortInterpretation(); entry.phase = 'applying'; renderCurrent('Recording reviewed entry…');
      try {
        const result = await commit({ ...entry.resolved, expectedToken: entry.captured.token, revisionKey: entry.captured.revisionKey, originEventId: entry.originEventId });
        if (current !== entry) return false;
        if (!(result === true || result?.ok === true)) throw Error('Not recorded.');
        next(); return true;
      } catch {
        if (current === entry) { entry.phase = 'unresolved'; renderCurrent('Entry was not recorded. Check the current turn and use the table controls.'); }
        return false;
      }
    }
    return { refreshCapabilities, setOptIn, resetConsent, canInterpret, acceptFinal, confirm, discard, clear, cancel: clear, checkContext,
      newSpeech, prioritizeCalculation, noteCalculation, hasBarrier: () => Boolean(current),
      getState: () => ({ ...view, waiting: queue.length, overflow, available: Boolean(gated(capability)), optedIn, currentOrigin: current?.originEventId }),
      dispose: () => { capabilityEpoch++; abortInterpretation(); stopWatching(); current = null; queue = []; } };
  }

  function mount({ panel, settingsContent, getContext, resolve, commit, request }) {
    const doc = panel.ownerDocument;
    const options = doc.createElement('details'); options.className = 'voice-assistant-options'; options.hidden = true;
    options.innerHTML = '<summary>Optional text interpretation</summary><label class="voice-consent"><input id="voice-assistant-consent" type="checkbox"><span>Allow interpretation of unrecognized action phrases for this session</span></label><p class="voice-help" id="voice-assistant-privacy"></p><p class="voice-help" id="voice-assistant-circuit"></p>';
    settingsContent.append(options);
    const inline = doc.createElement('div'); inline.id = 'voice-assistant-review'; inline.className = 'voice-assistant-inline'; inline.hidden = true;
    inline.innerHTML = '<div class="voice-assistant-message" role="status" aria-live="polite"><strong></strong><span></span><details><summary>Pending phrase</summary><p></p></details></div><div class="voice-assistant-actions"><button type="button" id="voice-assistant-confirm">Record reviewed entry</button><button type="button" id="voice-assistant-dismiss">Discard phrase</button><button type="button" id="voice-assistant-clear">Clear waiting list</button></div>';
    panel.insertBefore(inline, panel.querySelector('dialog'));
    const consent = options.querySelector('input'), privacy = options.querySelector('#voice-assistant-privacy');
    const confirm = inline.querySelector('#voice-assistant-confirm'), dismiss = inline.querySelector('#voice-assistant-dismiss'), clear = inline.querySelector('#voice-assistant-clear');
    let storage; try { storage = doc.defaultView.localStorage; } catch {}
    const controller = createController({ request, getContext, resolve, commit, storage, onChange(state) {
      options.hidden = !state.available; consent.checked = state.optedIn;
      const provider = state.capability?.provider === 'cloudflare' ? 'Cloudflare' : 'the configured model server';
      privacy.textContent = state.capability?.processing === 'REMOTE_TEXT_ONLY'
        ? `Only unresolved action text is sent to ${provider}. Audio processing stays unchanged. Every proposal needs confirmation. Permission ends when you leave this page or change account.`
        : 'Unresolved text is interpreted on the app’s model server, which may be another device. Audio processing stays unchanged. Every proposal needs confirmation.';
      options.querySelector('#voice-assistant-circuit').textContent = state.circuitReason || '';
      inline.hidden = state.phase === 'idle'; inline.dataset.state = state.phase;
      inline.querySelector('strong').textContent = state.message || '';
      inline.querySelector('.voice-assistant-message > span').textContent = [state.waiting ? `${state.waiting} waiting` : '', state.method].filter(Boolean).join(' · ');
      inline.querySelector('details').hidden = !state.phrase;
      inline.querySelector('details p').textContent = state.phrase || '';
      confirm.hidden = state.phase !== 'proposed'; confirm.disabled = state.phase !== 'proposed';
      dismiss.disabled = state.phase === 'applying'; dismiss.textContent = state.canDiscard ? 'Discard phrase' : 'Dismiss';
      clear.hidden = !state.waiting && !state.overflow; clear.disabled = state.phase === 'applying';
    } });
    consent.addEventListener('change', () => controller.setOptIn(consent.checked));
    confirm.addEventListener('click', () => { void controller.confirm(); });
    dismiss.addEventListener('click', controller.discard);
    clear.addEventListener('click', () => controller.clear('Nothing pending was recorded.'));
    return controller;
  }
  return { createController, mount };
});
