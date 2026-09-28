'use strict';
// Real Edge + local HTTP. The second rAF is a paint OPPORTUNITY proxy, not a
// compositor/display timestamp. --keyboard replaces only that static JS asset
// so a baseline source snapshot can isolate the keyboard-renderer A/B change.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(arg('root') || path.resolve(__dirname, '..'));
const keyboard = path.resolve(arg('keyboard') || path.join(root, 'public/card-keyboard.js'));
const out = path.resolve(arg('out') || path.resolve(__dirname, '../../validacao/keyboard-performance'));
const label = arg('label') || 'current', delay = Number(arg('delay') ?? 20), targetEvents = Number(arg('events') ?? 1100);
assert.match(label, /^[a-z0-9_-]+$/i); assert.ok(Number.isInteger(targetEvents) && targetEvents >= 20);
assert.ok(Number.isFinite(delay) && delay >= 0 && delay <= 1000);
const workerLoad = process.argv.includes('--worker-load'), headed = process.argv.includes('--headed');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-keyboard-bench-'));
Object.assign(process.env, { THEIBS_DATA_PATH: path.join(temp, 'events.jsonl'), THEIBS_WORKSPACE_PATH: path.join(temp, 'workspace.json'),
  THEIBS_LLM_CONFIG_PATH: path.join(temp, 'llm.json'), THEIBS_LLM_PROVIDER: 'none' });
fs.mkdirSync(out, { recursive: true });
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const quantile = (values, p) => values[Math.max(0, Math.ceil(values.length * p) - 1)];
function summarize(rows, key) {
  const sorted = rows.map(row => row[key]).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0 };
  // Resample complete typed hands, preserving dependence between keys in one
  // hand. This does not estimate across-machine/day variability.
  const clusters = [...new Set(rows.map(row => row.hand))].map(hand => rows.filter(row => row.hand === hand).map(row => row[key]).filter(Number.isFinite));
  let seed = 84721; const rand = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const bootstrap = { p95: [], p99: [] };
  for (let rep = 0; rep < 400; rep++) {
    const sample = Array.from({ length: clusters.length }, () => clusters[Math.floor(rand() * clusters.length)]).flat().sort((a, b) => a - b);
    bootstrap.p95.push(quantile(sample, .95)); bootstrap.p99.push(quantile(sample, .99));
  }
  const ci = name => { const a = bootstrap[name].sort((a, b) => a - b); return [quantile(a, .025), quantile(a, .975)]; };
  return { count: sorted.length, p50: quantile(sorted, .5), p95: quantile(sorted, .95), p99: quantile(sorted, .99), max: sorted.at(-1),
    p95Bootstrap95: ci('p95'), p99Bootstrap95: ci('p99'), p99Evidence: sorted.length >= 1000 ? 'ESTIMATE_WITH_WITHIN_RUN_CLUSTER_BOOTSTRAP' : 'INSUFFICIENT_FOR_P99_GATE' };
}
const report = { evidence: 'LOCAL_EXECUTED', at: new Date().toISOString(), label, sourceRoot: root, keyboardAsset: keyboard,
  version: require(path.join(root, 'package.json')).version, hashes: { keyboard: sha(keyboard), app: sha(path.join(root, 'public/app.js')) },
  environment: { node: process.version, os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length,
    memoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(), headed, workerLoad, viewport: { width: 1366, height: 768 }, power: 'NOT_MEASURED', temperature: 'NOT_MEASURED' },
  cadenceMs: delay, requestedEventsPerVariant: targetEvents, target: { proxyP95Ms: 50, proxyP99Ms: 100 }, groups: [], errors: [], status: 'RUNNING',
  limitations: ['Second rAF approximates a paint opportunity; it does not measure physical display latency or prove INP.',
    'Keys from Playwright are trusted browser events; this is not a human or physical ABNT2/US keyboard study.',
    'Variant/reset/disabled auto-analysis are programmatic benchmark setup. Functional UI paths are a separate E2E.',
    'Each variant has a warm-up hand; startup and cold rendering are not part of the warmed input percentiles.',
    'Quantile intervals use 400 bootstrap resamples clustered by hand within one run; load/temperature/day variability remain uncontrolled.',
    'The main computation is disabled unless --worker-load is specified; background workers do not validate progressive numerical-response latency.'] };
let browser, server, page;
(async () => {
  try {
    ({ server } = require(path.join(root, 'server')));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'msedge', headless: !headed });
    report.environment.browser = browser.version();
    page = await browser.newPage({ viewport: report.environment.viewport, serviceWorkers: 'block' });
    await page.route('**/card-keyboard.js', route => route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(keyboard, 'utf8') }));
    page.on('pageerror', error => report.errors.push(error.message));
    const start = performance.now();
    await page.goto(`http://127.0.0.1:${server.address().port}/app`);
    await page.evaluate(() => theibsApp.ready);
    report.startupThroughAppReadyMs = performance.now() - start;
    await page.evaluate(() => {
      document.querySelector('#auto-analysis').checked = false;
      const probe = window.keyboardProbe = { active: false, rows: [], events: [], longTasks: [], pending: 0, hand: 0, removedDeckButtons: 0, workerResults: [] };
      const pending = new WeakMap();
      window.addEventListener('keydown', event => {
        if (!probe.active || !event.isTrusted || event.repeat || event.isComposing) return;
        const entered = performance.now();
        const row = { hand: probe.hand, key: event.key, started: event.timeStamp, inputDelayMs: entered - event.timeStamp,
          workerRequestInFlight: probe.workerRequestInFlight === true, visibilityState: document.visibilityState };
        pending.set(event, { entered, row, node: document.activeElement });
      }, true);
      window.addEventListener('keydown', event => {
        const item = pending.get(event); if (!item) return;
        item.row.handlerMs = performance.now() - item.entered;
        item.row.focusNodeRetained = item.node.isConnected;
        probe.pending++;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          item.row.keyToSecondRafMs = performance.now() - item.row.started;
          probe.rows.push(item.row); probe.pending--;
        }));
      });
      new MutationObserver(records => {
        if (!probe.active) return;
        for (const record of records) for (const node of record.removedNodes) if (node.nodeType === 1)
          probe.removedDeckButtons += (node.matches('[data-card]') ? 1 : 0) + node.querySelectorAll('[data-card]').length;
      }).observe(document.querySelector('#card-grid'), { childList: true, subtree: true });
      if (PerformanceObserver.supportedEntryTypes.includes('event')) new PerformanceObserver(list => {
        if (probe.active) probe.events.push(...list.getEntries().filter(e => e.name === 'keydown').map(e => ({ name: e.name, duration: e.duration, processingStart: e.processingStart, startTime: e.startTime, interactionId: e.interactionId })));
      }).observe({ type: 'event', durationThreshold: 16 });
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => {
        if (probe.active) probe.longTasks.push(...list.getEntries().map(e => ({ startTime: e.startTime, duration: e.duration })));
      }).observe({ type: 'longtask' });
    });
    if (workerLoad) await page.evaluate(() => {
      keyboardProbe.workerRunning = true;
      keyboardProbe.workerPromise = (async () => {
        while (keyboardProbe.workerRunning) {
          const start = performance.now();
          keyboardProbe.workerRequestInFlight = true;
          const seed = 219 + keyboardProbe.workerResults.length;
          const response = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variant: 'PLO6_HIGH', heroCards: ['As','Ks','Qh','Jh','Td','9d'], board: [], position: 'BTN', players: 5, potBeforeAction: 12, amountToCall: 4, effectiveStack: 100, unknownOpponentModel: 'UNIFORM', samples: 50000, seed, assumeNoRake: true }) });
          const result = await response.json();
          keyboardProbe.workerRequestInFlight = false;
          keyboardProbe.workerResults.push({ status: result.status, seed, elapsedMs: performance.now() - start, samples: result.equity?.samples,
            cacheHit: result.performance?.cacheHit === true, workerExecutionMs: result.performance?.workerExecutionMs });
          if (result.status !== 'OK') break;
        }
      })();
    });
    for (const count of [4, 5, 6]) {
      const tokens = ['ae','kc','qo','jp','te','9c','8o','7p','6e','5c','4o'].slice(0, count + 5);
      const reset = async () => page.evaluate(count => {
        theibsCardKeyboard.state.setCount(count, true); theibsCardKeyboard.reset();
        document.querySelector('[data-slot="0"]').focus({ preventScroll: true });
      }, count);
      await reset(); await page.keyboard.type(tokens.join(''), { delay });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => { Object.assign(keyboardProbe, { active: true, rows: [], events: [], longTasks: [], removedDeckButtons: 0 }); });
      const hands = Math.ceil(targetEvents / (tokens.length * 2));
      for (let hand = 0; hand < hands; hand++) {
        await reset(); await page.evaluate(hand => { keyboardProbe.hand = hand; }, hand);
        await page.keyboard.type(tokens.join(''), { delay });
        assert.deepEqual(await page.evaluate(() => theibsCardKeyboard.state.slots), tokens.map(card => card.toUpperCase()), `PLO${count}, hand ${hand}: dropped or wrong card`);
      }
      await page.waitForFunction(() => keyboardProbe.pending === 0);
      const measurements = await page.evaluate(() => { keyboardProbe.active = false; return { rows: keyboardProbe.rows, eventTiming: keyboardProbe.events, longTasks: keyboardProbe.longTasks, removedDeckButtons: keyboardProbe.removedDeckButtons }; });
      const metrics = Object.fromEntries(['inputDelayMs', 'handlerMs', 'keyToSecondRafMs'].map(key => [key, summarize(measurements.rows, key)]));
      const group = { variant: `PLO${count}`, hands, eventCount: measurements.rows.length, metrics, removedDeckButtons: measurements.removedDeckButtons,
        handlerByKeyPhase: Object.fromEntries(['rank', 'suit'].map(phase => [phase, summarize(measurements.rows.filter(row => ('ecop'.includes(row.key.toLowerCase()) ? 'suit' : 'rank') === phase), 'handlerMs')])),
        focusNodesRetained: measurements.rows.filter(row => row.focusNodeRetained).length, functionalCardsPassed: true,
        eventsWithWorkerRequestInFlight: measurements.rows.filter(row => row.workerRequestInFlight).length,
        proxyTargetPassed: metrics.keyToSecondRafMs.p95 <= 50 && metrics.keyToSecondRafMs.p99 <= 100, raw: measurements };
      report.groups.push(group); console.log(JSON.stringify({ variant: group.variant, metrics, removedDeckButtons: group.removedDeckButtons, proxyTargetPassed: group.proxyTargetPassed }));
    }
    if (workerLoad) await page.evaluate(async () => { keyboardProbe.workerRunning = false; await keyboardProbe.workerPromise; });
    report.workerRequests = await page.evaluate(() => keyboardProbe.workerResults);
    assert.deepEqual(report.errors, []);
    if (workerLoad) assert.ok(report.workerRequests.length && report.workerRequests.every(row => row.status === 'OK' && row.samples === 50000 && !row.cacheHit && row.workerExecutionMs > 0), 'Worker load must complete the specified sample budget without cache hits.');
    if (process.argv.includes('--expect-stable')) for (const group of report.groups) {
      assert.equal(group.removedDeckButtons, 0); assert.equal(group.focusNodesRetained, group.eventCount);
    }
    report.status = report.groups.every(group => group.proxyTargetPassed) ? 'PASS_FUNCTIONAL_AND_PROXY_TARGETS' : 'FAIL_PROXY_TARGETS';
    if (report.status.startsWith('FAIL')) process.exitCode = 1;
    await page.screenshot({ path: path.join(out, `${label}.png`) });
  } catch (error) { report.status = 'FAIL'; report.failure = error.stack; process.exitCode = 1; }
  finally {
    if (browser) await browser.close();
    if (server) { await require(path.join(root, 'src/analysis-worker')).close(); await new Promise(resolve => server.close(resolve)); }
    fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ report: path.join(out, `${label}.json`), status: report.status, failure: report.failure }));
  }
})();
