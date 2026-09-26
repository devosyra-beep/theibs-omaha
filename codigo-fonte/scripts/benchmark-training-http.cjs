'use strict';
// Isolated HTTP measurement of the training tree, never a showdown throughput
// benchmark. No user history/configuration is read or written; no Llama calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-training-benchmark-'));
Object.assign(process.env, { THEIBS_DATA_PATH: path.join(temp, 'events.jsonl'),
  THEIBS_WORKSPACE_PATH: path.join(temp, 'workspace.json'), THEIBS_LLM_CONFIG_PATH: path.join(temp, 'llm.json'), THEIBS_LLM_PROVIDER: 'none' });
const { server } = require('../server');
const pool = require('../src/analysis-worker');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, payload) => {
    const start = performance.now();
    const response = await fetch(origin + '/api/training/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json(), elapsedMs = performance.now() - start;
    assert.equal(response.status, 200, result.reason);
    assert.equal(result.status, 'OK', result.reason);
    return { result, elapsedMs };
  };
  const rows = [];
  for (const variant of ['PLO5_HIGH', 'PLO6_HIGH']) for (const targetStreet of ['PREFLOP', 'FLOP']) {
    for (let repeat = 0; repeat < 3; repeat++) {
      const { result: { session } } = await post('start', { variant, targetStreet, seed: 42 + repeat });
      const size = Math.round((session.minSize + (session.maxSize - session.minSize) * .37) * 100) / 100;
      const payload = { sessionId: session.id, revision: session.revision, size, question: 'Qual o EV das apostas?' };
      const first = await post('doubt', payload), cached = await post('doubt', payload);
      const evaluation = first.result.context.trainingEvaluation;
      assert.deepEqual(cached.result.context.trainingEvaluation, evaluation);
      assert.equal(cached.result.context.evaluationPerformance.cacheHit, true);
      assert.ok(evaluation.candidates.every(candidate => Number.isFinite(candidate.ev)));
      const row = { variant, targetStreet, repeat: repeat + 1, seed: 42 + repeat, customSize: size,
        httpMs: first.elapsedMs, cachedHttpMs: cached.elapsedMs,
        samplesPerOption: evaluation.samplesPerOption, totalRollouts: evaluation.totalRollouts,
        optionCount: evaluation.candidates.length, performance: first.result.context.evaluationPerformance,
        leadership: evaluation.leadership.status, evaluationId: evaluation.evaluationId };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
  const cases = [...new Set(rows.map(row => row.variant + '/' + row.targetStreet))].map(key => {
    const runs = rows.filter(row => row.variant + '/' + row.targetStreet === key);
    return { case: key, repeats: runs.length, medianHttpMs: median(runs.map(row => row.httpMs)),
      maxHttpMs: Math.max(...runs.map(row => row.httpMs)), minHttpMs: Math.min(...runs.map(row => row.httpMs)),
      medianCachedHttpMs: median(runs.map(row => row.cachedHttpMs)), allObservedUnder3s: runs.every(row => row.httpMs < 3000) };
  });
  const report = { at: new Date().toISOString(), version: require('../package.json').version,
    scope: 'LOCAL_NODE_HTTP_TRAINING_WITH_FULL_POLICY_ROLLOUTS_AND_LOCAL_SUMMARY',
    runtime: process.version, cpu: os.cpus()[0].model, logicalCPUs: os.cpus().length,
    totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(), samplesPerOption: 256,
    targetHttpMs: 3000, cases, rows,
    limits: ['Three different dealt states per case; not a p95 or sustained latency guarantee.',
      'Llama excluded: its optional explanation latency is separate.',
      'Tree rollouts include future actions and must not be compared with the 100k showdown-simulations/s target.',
      'Observed load and temperature of the user computer were uncontrolled.'] };
  const file = path.resolve(__dirname, '../../validacao/training-http-' + report.at.replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: file, cases }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await pool.close(); await new Promise(resolve => server.close(resolve)); });
