(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TheibsSolverStudyRunner = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const VERSION = 'THEIBS_STUDY_RUNNER_V1';
  const END = new Set(['COMPLETE', 'UNSUPPORTED', 'FAILED', 'CANCELLED']);
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  function create(options = {}) {
    const now = options.now || (() => performance.now());
    const setTimer = options.setTimeout || setTimeout, clearTimer = options.clearTimeout || clearTimeout;
    const scenarioMs = Math.min(3000, Math.max(1, options.perScenarioMs || 3000));
    const totalMs = Math.min(6000, Math.max(1, options.totalMs || 6000));
    let generation = 0, active = null;
    let state = { version: VERSION, phase: 'IDLE', entries: [], binding: null, elapsedMs: 0, error: null };
    const acknowledgements = new Set(), cancellations = new Set();
    const getState = () => clone(state);
    const emit = () => options.onUpdate?.(getState());
    const valid = (mine, binding) => mine === generation && options.isCurrent?.(binding) !== false;
    function cancelJob(id) {
      if (!id) return Promise.resolve(null);
      const task = Promise.resolve().then(() => options.cancel(id)).catch(() => null);
      cancellations.add(task); task.finally(() => cancellations.delete(task)); return task;
    }
    async function withinWorkflow(task, startedAt) {
      const remaining = totalMs - (now() - startedAt);
      if (remaining <= 0) return null;
      let timer;
      try { return await Promise.race([task, new Promise(resolve => { timer = setTimer(() => resolve(null), remaining); })]); }
      finally { clearTimer(timer); }
    }
    async function cancel(reason = 'Comparison stopped.') {
      generation++;
      const previous = active;
      if (previous) { previous.controller.abort(); previous.wake(); }
      if (previous?.jobId) cancelJob(previous.jobId);
      active = null;
      if (state.phase === 'RUNNING') {
        state.phase = 'CANCELLED'; state.error = reason;
        state.elapsedMs = Math.max(0, now() - state.startedAt); emit();
      }
      // A late start acknowledgement still creates a job. Drain it before a
      // new foreground request can deduplicate against that job identity.
      while (acknowledgements.size || cancellations.size) {
        await Promise.allSettled([...acknowledgements, ...cancellations]);
      }
      return getState();
    }
    function accept(entry, job, binding) {
      if (!job || typeof job.jobId !== 'string' || job.handId !== binding.handId || job.revisionKey !== binding.revisionKey) {
        throw Error('Study response does not match this decision.');
      }
      entry.phase = job.phase; entry.jobId = job.jobId;
      entry.result = clone(job.result || entry.result || null);
      entry.timing = clone(job.timing || entry.timing || null);
      entry.cache = clone(job.cache || entry.cache || null);
      entry.buildFingerprint = job.buildFingerprint || entry.buildFingerprint || null;
      entry.error = job.reason || null;
      return job;
    }
    async function run({ entries, baseline, binding } = {}) {
      if (!Array.isArray(entries) || entries.length < 1 || entries.length > 2 || !baseline?.input ||
        !binding || typeof binding.handId !== 'string' || typeof binding.revisionKey !== 'string' || typeof binding.token !== 'string' ||
        [baseline, ...entries].some(item => !item || typeof item.id !== 'string' || !item.input || item.input.multiway?.handId !== binding.handId) ||
        new Set([baseline, ...entries].map(item => item.id)).size !== entries.length + 1) {
        throw Error('Choose one or two distinct studies for this decision.');
      }
      if (typeof options.start !== 'function' || typeof options.wait !== 'function' || typeof options.cancel !== 'function') {
        throw Error('Study comparison compute is unavailable.');
      }
      const models = clone(entries), frozenBase = clone(baseline), frozenBinding = clone(binding);
      await cancel();
      const mine = ++generation, startedAt = now();
      if (!valid(mine, frozenBinding)) return getState();
      state = { version: VERSION, phase: 'RUNNING', binding: frozenBinding, startedAt, elapsedMs: 0,
        perScenarioMs: scenarioMs, totalMs, error: null, entries: [frozenBase, ...models.map(item => ({ ...item, phase: 'PENDING', result: null }))] };
      emit();
      for (let index = 0; index < models.length; index++) {
        if (!valid(mine, frozenBinding)) break;
        const remaining = totalMs - (now() - startedAt);
        if (remaining <= 0) {
          state.entries[index + 1].phase = 'CANCELLED';
          state.entries[index + 1].error = 'Comparison time budget reached.'; break;
        }
        const entry = state.entries[index + 1], began = now(), controller = new AbortController();
        let wake, job = null, expired = false;
        const stopped = new Promise(resolve => { wake = () => resolve(null); });
        const current = active = { controller, wake, jobId: null };
        const timer = setTimer(() => { expired = true; controller.abort(); wake(); }, Math.min(scenarioMs, remaining));
        const awaitStep = promise => Promise.race([promise, stopped]);
        try {
          entry.phase = 'QUEUED'; emit();
          const acknowledgement = Promise.resolve().then(() => options.start(clone(entry.input), {
            budget: 'STANDARD', handId: frozenBinding.handId, revisionKey: frozenBinding.revisionKey, automatic: false, signal: controller.signal
          })).then(async data => {
            if (!valid(mine, frozenBinding) || expired || controller.signal.aborted) {
              await cancelJob(data?.jobId); return null;
            }
            current.jobId = data?.jobId;
            return data;
          });
          acknowledgements.add(acknowledgement);
          acknowledgement.then(() => acknowledgements.delete(acknowledgement), () => acknowledgements.delete(acknowledgement));
          job = await awaitStep(acknowledgement);
          if (job && valid(mine, frozenBinding)) { accept(entry, job, frozenBinding); emit(); }
          while (job && !END.has(job.phase) && valid(mine, frozenBinding) && !expired && !controller.signal.aborted) {
            const update = await awaitStep(Promise.resolve(options.wait(job.jobId, {
              afterVersion: Number.isSafeInteger(job.updateVersion) ? job.updateVersion : 0,
              waitMs: Math.min(1000, Math.max(0, scenarioMs - (now() - began))), signal: controller.signal
            })));
            if (!update || !valid(mine, frozenBinding)) break;
            job = accept(entry, update, frozenBinding); emit();
          }
          if (expired || controller.signal.aborted || !valid(mine, frozenBinding)) {
            const last = await withinWorkflow(cancelJob(current.jobId), startedAt);
            if (valid(mine, frozenBinding)) {
              if (last) accept(entry, last, frozenBinding);
              entry.phase = 'CANCELLED'; entry.error = expired ? 'Study time budget reached; latest estimate retained.' : 'Comparison stopped.';
            }
          }
        } catch (error) {
          await withinWorkflow(cancelJob(current.jobId), startedAt);
          if (valid(mine, frozenBinding)) { entry.phase = expired ? 'CANCELLED' : 'FAILED'; entry.error = expired ? 'Study time budget reached; latest estimate retained.' : error.message; }
        } finally {
          clearTimer(timer); controller.abort();
          if (active === current) active = null;
          if (valid(mine, frozenBinding)) { entry.elapsedMs = Math.max(0, now() - began); state.elapsedMs = Math.max(0, now() - startedAt); emit(); }
        }
        // A timed-out start must finish cancelling before the next study can
        // supersede it on this same client/owner. Never create parallel workers.
        if (acknowledgements.size || cancellations.size) {
          const drained = await withinWorkflow(Promise.allSettled([...acknowledgements, ...cancellations]), startedAt);
          if (drained === null) { state.error = 'Comparison time budget reached; pending acknowledgement will be cancelled.'; break; }
        }
      }
      if (mine !== generation) return getState();
      if (!valid(mine, frozenBinding)) {
        state = { ...state, phase: 'CANCELLED', entries: [], error: 'Decision changed; comparison discarded.' };
      } else {
        state.phase = 'COMPLETE'; state.elapsedMs = Math.max(0, now() - startedAt);
        for (const entry of state.entries) if (entry.phase === 'PENDING') { entry.phase = 'CANCELLED'; entry.error = 'Comparison time budget reached.'; }
      }
      emit(); return getState();
    }
    return { run, cancel, getState, version: VERSION };
  }
  return { create, VERSION };
});
