'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { DEFAULT_PATH } = require('./training-store');

if (!isMainThread && workerData?.kind === 'THEIBS_HISTORY') {
  const { readEvents, summarize, opponentTendencies, outcomeTimeline } = require('./training-store');
  parentPort.on('message', ({ id, filePath, recentLimit, timelineLimit }) => {
    const started = performance.now();
    try {
      const events = readEvents(filePath), timeline = outcomeTimeline(events);
      const recent = events.filter(event => event.type === 'DECISION').slice(-recentLimit).reverse().map(event => ({
        timestamp: event.timestamp, street: event.street, decisionId: event.decisionId || null,
        replayable: Boolean(event.decisionId && event.replayPlan), chosenAction: event.chosenAction,
        recommendedAction: event.recommendedAction, quality: event.quality, evLoss: event.evLoss,
        qualityDetails: event.qualityDetails || null, chosenSize: event.chosenSize ?? null,
        recommendedSize: event.recommendedSize ?? null, summary: event.summary || null,
        trainingEvaluation: event.context?.trainingEvaluation || null,
        analysisId: event.context?.analysisId || null, provenance: event.context?.provenance || null,
        heroCards: event.context?.heroCards || [], board: event.context?.board || [],
        position: event.context?.position || null, variant: event.context?.variant || null,
        potBeforeDecision: event.context?.pot ?? null, bigBlind: event.context?.bigBlind ?? null
      }));
      parentPort.postMessage({ id, value: { summary: summarize(events), recent,
        observedHands: events.filter(event => event.type === 'OBSERVED_HAND').slice(-10).reverse(),
        trends: ['PASSIVE', 'AGGRESSIVE', 'MIXED'].map(style => opponentTendencies(events, style)),
        outcomeTimeline: timeline.slice(-timelineLimit),
        historyScope: { aggregation: 'ALL_RECORDS', eventCount: events.length, recentLimit,
          timelineTotal: timeline.length, timelineReturned: Math.min(timelineLimit, timeline.length),
          timelineTruncated: timeline.length > timelineLimit,
          timelineScope: timeline.length > timelineLimit ? 'RECENT_HANDS_WINDOW' : 'ALL_COMPLETED_HANDS',
          storageRead: 'WORKER_THREAD', workerElapsedMs: performance.now() - started } } });
    } catch (error) { parentPort.postMessage({ id, error: { message: error.message, code: error.code || 'HISTORY_READ_FAILED' } }); }
  });
} else {
  let worker = null, nextId = 0;
  const pending = new Map(), cache = new Map();
  const MAX_CACHE_ENTRIES = 8, MAX_PENDING = 8;
  function ensureWorker() {
    if (worker) return worker;
    const instance = new Worker(__filename, { workerData: { kind: 'THEIBS_HISTORY' } });
    worker = instance;
    instance.on('message', message => {
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id);
      if (message.error) { const error = Error(message.error.message); error.code = message.error.code; task.reject(error); }
      else task.resolve(message.value);
      if (!pending.size) instance.unref();
    });
    const fail = error => {
      if (worker !== instance) return;
      worker = null;
      for (const task of pending.values()) task.reject(error);
      pending.clear(); cache.clear();
    };
    instance.on('error', fail);
    instance.on('exit', code => { if (worker === instance) fail(Error(`History worker exited (${code}).`)); });
    instance.unref();
    return instance;
  }
  function compute(filePath, options) {
    if (pending.size >= MAX_PENDING) { const error = Error('History is busy; retry shortly.'); error.statusCode = 503; return Promise.reject(error); }
    const instance = ensureWorker(), id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject }); instance.ref();
      instance.postMessage({ id, filePath, ...options });
    });
  }
  async function fileVersion(filePath) {
    try { const stat = await fs.promises.stat(filePath); return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`; }
    catch (error) { if (error.code === 'ENOENT') return 'MISSING'; throw error; }
  }
  function waitWithSignal(promise, signal) {
    if (!signal) return promise;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  async function historyOverview(filePath = DEFAULT_PATH, { signal, recentLimit = 20, timelineLimit = 1000 } = {}) {
    if (typeof filePath !== 'string' || !filePath) throw Error('A history path is required.');
    if (!Number.isInteger(recentLimit) || recentLimit < 1 || recentLimit > 100 ||
      !Number.isInteger(timelineLimit) || timelineLimit < 1 || timelineLimit > 10000) throw Error('Invalid history overview limit.');
    signal?.throwIfAborted();
    filePath = path.resolve(filePath);
    for (let attempt = 0; attempt < 2; attempt++) {
      const version = await fileVersion(filePath), key = JSON.stringify([filePath, version, recentLimit, timelineLimit]);
      let entry = cache.get(key);
      const cacheHit = Boolean(entry);
      if (!entry) {
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        entry = { promise: compute(filePath, { recentLimit, timelineLimit }) };
        cache.set(key, entry);
        entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
      }
      const value = await waitWithSignal(entry.promise, signal);
      signal?.throwIfAborted();
      const currentVersion = await fileVersion(filePath);
      signal?.throwIfAborted();
      if (currentVersion !== version) { cache.delete(key); continue; }
      // Cached responses must not be mutated by another caller/user response.
      const result = structuredClone(value);
      result.historyScope.cacheHit = cacheHit;
      result.historyScope.fileVersion = version;
      return result;
    }
    const error = Error('History changed during reading; refresh to get a consistent snapshot.');
    error.statusCode = 409; throw error;
  }
  async function closeHistoryService() {
    cache.clear();
    const active = worker; worker = null;
    for (const task of pending.values()) task.reject(Error('History service closed.'));
    pending.clear();
    if (active) await active.terminate();
  }
  module.exports = { historyOverview, closeHistoryService };
}
