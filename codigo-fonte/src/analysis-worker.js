'use strict';
const { Worker, isMainThread, parentPort } = require('node:worker_threads');

if (!isMainThread) {
  // Tables and optimized code survive between requests. Calculations are
  // synchronous here; cancellation terminates only the affected worker.
  const { decide } = require('./decision-engine');
  parentPort.on('message', ({ id, input, kind }) => {
    const started = performance.now();
    try {
      const result = kind === 'TRAINING'
        ? require('./training-evaluator').evaluateTraining(input)
        : decide(input);
      parentPort.postMessage({ id, result, workerExecutionMs: performance.now() - started });
    } catch (error) {
      parentPort.postMessage({ id, error: error.message, workerExecutionMs: performance.now() - started });
    }
  });
} else {
  function createAnalysisPool({ maxWorkers = 2, workerFile = __filename, fixedTimeoutMs = 90000, adaptiveTimeoutMs = 3000, trainingTimeoutMs = 8000 } = {}) {
    const slots = new Set(), terminations = new Set();
    let sequence = 0, closed = false;

    function retire(slot) {
      if (slot.retired) return;
      slot.retired = true;
      slots.delete(slot);
      const stopping = slot.worker.terminate().catch(() => {});
      terminations.add(stopping);
      stopping.finally(() => terminations.delete(stopping));
    }

    function finish(slot, error, message, shouldRetire = false) {
      const job = slot.job;
      if (!job) { if (shouldRetire) retire(slot); return; }
      slot.job = null;
      clearTimeout(job.timer);
      job.response?.removeListener?.('close', job.cancel);
      if (shouldRetire) retire(slot);
      else { slot.completedJobs++; slot.worker.unref(); }
      if (error) return job.reject(error);
      const result = message.result, requestElapsedMs = performance.now() - job.started;
      if (result && typeof result === 'object') {
        const monteCarloSamples = job.kind !== 'TRAINING' && result.equity?.method === 'MONTE_CARLO'
          ? (result.scenarioSummary?.totalSamples ?? result.equity.samples) : null;
        result.performance = {
          workerExecutionMs: message.workerExecutionMs,
          requestElapsedMs,
          workerReused: job.workerReused,
          monteCarloSamples,
          simulationsPerSecond: monteCarloSamples === null ? null : monteCarloSamples * 1000 / requestElapsedMs,
          measurementScope: job.kind === 'TRAINING' ? 'TRAINING_WORKER_REQUEST_WALL_TIME' : 'ANALYSIS_WORKER_REQUEST_WALL_TIME'
        };
      }
      job.resolve(result);
    }

    function createSlot() {
      const slot = { worker: new Worker(workerFile), job: null, completedJobs: 0, retired: false };
      slots.add(slot);
      slot.worker.on('message', message => {
        if (slot.retired || !slot.job || message.id !== slot.job.id) return;
        finish(slot, message.error ? Error(message.error) : null, message);
      });
      slot.worker.on('error', error => { if (!slot.retired) finish(slot, error, null, true); });
      slot.worker.on('exit', code => {
        if (!slot.retired) finish(slot, Error(`Motor encerrou antes do resultado (${code}).`), null, true);
      });
      slot.worker.unref();
      return slot;
    }

    function analyze(input, response, kind = 'ANALYSIS') {
      if (closed) return Promise.reject(Error('Motor encerrado.'));
      if (response?.destroyed && !response.writableEnded) return Promise.reject(Error('Cálculo cancelado.'));
      let slot = [...slots].find(candidate => !candidate.job && !candidate.retired);
      if (!slot && slots.size >= maxWorkers) return Promise.reject(Error('Motor ocupado. Aguarde o cálculo em andamento.'));
      const started = performance.now();
      try { if (!slot) slot = createSlot(); }
      catch (error) { return Promise.reject(error); }
      return new Promise((resolve, reject) => {
        const job = { id: ++sequence, started, resolve, reject, response, kind, workerReused: slot.completedJobs > 0 };
        slot.job = job;
        slot.worker.ref();
        job.cancel = () => { if (!response.writableEnded) finish(slot, Error('Cálculo cancelado.'), null, true); };
        job.timer = setTimeout(() => finish(slot, Error('O cálculo excedeu o limite de tempo; não foi concluído. Tente menos amostras ou simplifique os ranges.'), null, true), kind === 'TRAINING' ? trainingTimeoutMs : input?.samplingMode === 'ADAPTIVE' ? adaptiveTimeoutMs : fixedTimeoutMs);
        response?.on?.('close', job.cancel);
        try { slot.worker.postMessage({ id: job.id, input, kind }); }
        catch (error) { finish(slot, error, null, true); }
      });
    }

    // Idle workers never keep CLI/tests/server shutdown alive. Owners may also
    // close explicitly for deterministic teardown; new requests are then rejected.
    analyze.close = async () => {
      closed = true;
      for (const slot of [...slots]) finish(slot, Error('Motor encerrado.'), null, true);
      await Promise.all([...terminations]);
    };
    analyze.stats = () => ({ workers: slots.size, busy: [...slots].filter(slot => slot.job).length, closed });
    analyze.training = (input, response) => analyze(input, response, 'TRAINING');
    return analyze;
  }

  module.exports = createAnalysisPool();
  module.exports.createAnalysisPool = createAnalysisPool;
}
