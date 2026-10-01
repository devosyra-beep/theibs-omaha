(() => {
  'use strict';
  const $ = id => document.getElementById(id), clone = value => structuredClone(value);
  const terminal = new Set(['COMPLETE', 'FAILED', 'UNSUPPORTED', 'CANCELLED']);
  const owner = 'THEIBS_PUBLIC_SYNTHETIC_BROWSER_QA';
  const buttons = ['pair', 'group', 'self-test', 'parity', 'cache', 'stale'];
  const activeClients = new Set(), rawWorkers = new Set();
  let fixtures, growth, reference, manifest, scenarios = [], report, running = false, stopped = false, token = 0;
  let taps = 0, inputEvents = 0, runInteractions = null;
  const finite = Number.isFinite, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key] ?? null]));
  function mathematical(result, checkpoint) {
    return { ...pick(result, ['status', 'method', 'solverVersion', 'gameHash', 'scope', 'strategyScope', 'iterations']),
      actions: (result.actions || []).map(row => pick(row, ['id', 'action', 'size', 'frequency', 'evBB'])),
      convergence: pick(result.convergence, ['metric', 'exact', 'nashConv', 'maxUnilateralGain', 'unilateralGains', 'bestResponseValues', 'scope', 'thresholdMet', 'thresholdBB']),
      qualification: pick(result.qualification, ['gto', 'fullHandEquilibrium', 'solvedSubgame', 'strategyFrequenciesSupported']),
      actionPrecision: { ...pick(result.actionPrecision, ['version', 'target', 'origin', 'solverVersion', 'baseGameHash', 'baseContextKey', 'scope', 'utility', 'supportedGameClass', 'fullPriorPreserved', 'originalHandActionEV']),
        actions: (result.actionPrecision?.actions || []).map(row => pick(row, ['id', 'certified', 'estimateBB', 'lowerBB', 'upperBB', 'baseGameHash', 'baseContextKey', 'gameHash', 'conditionedHash', 'rootActionFixed', 'target', 'utility', 'iterations', 'strategicDecisionCount'])) },
      decisionPrecision: pick(result.decisionPrecision, ['status', 'target', 'bestActionId', 'secondActionId', 'leaderConclusive', 'globalBestSupported', 'reasonCode', 'separationToleranceBB', 'uncertaintyMethod', 'uncertaintyScope', 'confidenceLevel']),
      adaptation: pick(result.adaptation, ['stopReason', 'workIterations', 'globalIterations', 'actionIterations']),
      checkpoint: pick(checkpoint, ['version', 'solverVersion', 'certificateVersion', 'baseContextKey', 'baseGameHash', 'iterations', 'workIterations']) };
  }
  function differences(actual, expected, path = 'result', issues = []) {
    if (typeof actual === 'number' && typeof expected === 'number') {
      if (!finite(actual) || !finite(expected) || Math.abs(actual - expected) > 1e-10) issues.push(path + ': numerical mismatch');
    } else if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
      const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
      for (const key of keys) differences(actual[key], expected[key], path + '.' + key, issues);
    } else if (actual !== expected) issues.push(path + ': identity mismatch');
    return issues;
  }
  function assertions(result, expected = {}) {
    const issues = [], actions = result?.actions || [], roots = result?.abstraction?.rootActions || [];
    const certificate = result?.actionPrecision, cert = certificate?.actions || [], precision = result?.decisionPrecision;
    if (!actions.length || actions.some(row => !finite(row.frequency) || row.frequency < 0 || row.frequency > 1 || !finite(row.evBB)) || Math.abs(actions.reduce((sum, row) => sum + row.frequency, 0) - 1) > 1e-8) issues.push('Invalid complete profile action table.');
    if (new Set(actions.map(row => row.id)).size !== actions.length || roots.length !== actions.length || roots.some(root => !actions.some(row => row.id === root.id && row.action === root.action && row.size === root.size))) issues.push('Legal root action identities changed.');
    if (result?.qualification?.gto !== false || result?.qualification?.fullHandEquilibrium !== false) issues.push('Unsupported full-hand or GTO claim.');
    if (certificate?.utility?.scope !== 'FULL_PRIOR_EX_ANTE' || certificate?.originalHandActionEV !== false || certificate?.fullPriorPreserved !== true || certificate?.originalConditionalProfileEVUnchanged !== true) issues.push('Commitment/current-hand scopes changed.');
    if (cert.length !== actions.length || new Set(cert.map(row => row.id)).size !== cert.length) issues.push('Certificate does not retain every alternative.');
    for (const row of cert) if (row.certified) {
      if (!finite(row.lowerBB) || !finite(row.estimateBB) || !finite(row.upperBB) || row.lowerBB > row.estimateBB || row.estimateBB > row.upperBB) issues.push(row.id + ': invalid interval.');
      if (row.baseGameHash !== result.gameHash || row.baseContextKey !== certificate.baseContextKey || row.target !== certificate.target || row.utility?.scope !== 'FULL_PRIOR_EX_ANTE' || row.rootActionFixed !== row.id || row.conditionedHash !== row.gameHash) issues.push(row.id + ': incompatible certificate context.');
    }
    if (precision?.status === 'CONCLUSIVE') {
      const leader = cert.find(row => row.id === precision.bestActionId), tolerance = precision.separationToleranceBB || 0;
      if (!leader?.certified || cert.some(row => !row.certified || row.id !== leader.id && !(leader.lowerBB > row.upperBB + tolerance))) issues.push('Conclusive leader does not strictly dominate every alternative.');
      if (precision.leaderConclusive !== true || precision.globalBestSupported !== false || precision.confidenceLevel !== null) issues.push('Comparison makes an unsupported global or confidence claim.');
    }
    const tolerance = expected.referenceToleranceBB ?? 1e-7;
    for (const [id, value] of Object.entries(expected.actionValues || {})) {
      const row = cert.find(item => item.id === id);
      if (!row?.certified || value < row.lowerBB - tolerance || value > row.upperBB + tolerance) issues.push(id + ': independent value outside certified interval.');
    }
    if (expected.comparisonStatus && precision?.status !== expected.comparisonStatus) issues.push('Unexpected comparison status.');
    if (expected.bestActionId && precision?.bestActionId !== expected.bestActionId) issues.push('Unexpected commitment leader.');
    if (expected.globalStatus && result?.status !== expected.globalStatus) issues.push('Unexpected global solver qualification.');
    if (expected.requireOverlap && (precision?.status !== 'INCONCLUSIVE' || cert.length < 2 || precision.leaderConclusive)) issues.push('True tie/overlap was falsely resolved.');
    if (expected.requireNonTiedPointEstimates && (!(precision?.deltaEVBB > 0) || precision?.reasonCode !== 'BEST_SECOND_INTERVALS_OVERLAP' || cert.some(row => !row.certified))) issues.push('Required non-tied certified overlap was not observed.');
    return issues;
  }
  function interactionSnapshot() { return { text: $('responsiveness-text').value, taps, inputEvents }; }
  function mathematicalMetrics(result) {
    const metrics = result?.metrics || {}, adaptation = result?.adaptation || {}, certificate = result?.actionPrecision || {};
    return {
      ...pick(result, ['status', 'method', 'solverVersion', 'gameHash', 'scope', 'strategyScope', 'iterations']),
      decisionPrecision: pick(result?.decisionPrecision, ['status', 'target', 'reasonCode', 'bestActionId', 'secondActionId', 'deltaEVBB', 'differenceBoundsBB', 'leaderConclusive', 'globalBestSupported', 'separationToleranceBB']),
      convergence: pick(result?.convergence, ['metric', 'exact', 'nashConv', 'maxUnilateralGain', 'thresholdMet', 'thresholdBB', 'scope', 'convergenceGuarantee']),
      stopReason: adaptation.stopReason ?? null,
      workIterations: adaptation.workIterations ?? null,
      globalIterations: adaptation.globalIterations ?? null,
      actionIterations: adaptation.actionIterations ?? null,
      tree: { ...pick(metrics, ['nodes', 'edges', 'terminalCount', 'informationSets', 'maxDepth', 'worlds', 'publicNodes', 'publicDecisionNodes', 'publicTerminals', 'reservedMemoryBytes']), compatibleWorlds: result?.abstraction?.compatibleWorlds ?? null, productWorlds: result?.abstraction?.productWorlds ?? null, originalTreeUnchanged: certificate.originalStrategyTreeUnchanged ?? null },
      memory: { estimatedWorkingBytes: metrics.estimatedWorkingBytes ?? null, reservedTreeBytes: metrics.reservedMemoryBytes ?? null, workerHeapUsedBytes: metrics.heapUsedBytes ?? null, actualWorkerHeapMeasurement: 'NOT_AVAILABLE_IN_WEB_WORKER', estimateSource: 'Original solver allocation/reservation formulas; not browser process or peak heap measurements.' },
      costs: pick(metrics.costs, ['buildMs', 'globalSolveMs', 'globalEvaluationMs', 'actionSolveMs', 'totalComputeMs']),
      runCosts: pick(metrics.runCosts, ['buildMs', 'globalSolveMs', 'globalEvaluationMs', 'actionSolveMs', 'totalComputeMs']),
      actionCosts: clone(metrics.actionCosts || {}),
      profileActions: (result?.actions || []).map(row => pick(row, ['id', 'action', 'size', 'frequency', 'evBB'])),
      commitment: { ...pick(certificate, ['target', 'scope', 'utility', 'baseGameHash', 'baseContextKey', 'fullPriorPreserved', 'originalHandActionEV']),
        intervals: (certificate.actions || []).map(row => ({ ...pick(row, ['id', 'certified', 'estimateBB', 'lowerBB', 'upperBB', 'iterations', 'elapsedMs', 'strategicDecisionCount', 'gameHash', 'conditionedHash']), widthBB: finite(row.lowerBB) && finite(row.upperBB) ? row.upperBB - row.lowerBB : null })) }
    };
  }
  function compactMath(metrics) { return metrics ? { status: metrics.status, decisionStatus: metrics.decisionPrecision.status, nashConv: metrics.convergence.nashConv, stopReason: metrics.stopReason, nodes: metrics.tree.nodes, workIterations: metrics.workIterations, actionIterations: metrics.actionIterations, boundsCostMs: metrics.costs.actionSolveMs, estimatedWorkingBytes: metrics.memory.estimatedWorkingBytes, actualWorkerHeapMeasurement: metrics.memory.actualWorkerHeapMeasurement } : null; }
  function render() {
    if (!report) return;
    report.interactions = interactionSnapshot();
    report.summary = { passed: report.checks.filter(row => row.pass).length, failed: report.checks.filter(row => !row.pass).length, runs: report.runs.length };
    $('qa-summary').textContent = JSON.stringify({ classification: report.classification, buildFingerprint: manifest.buildFingerprint, ...report.summary,
      latest: report.runs.slice(-3).map(row => row.kind === 'COLD_WARM_PAIR' ? { kind: row.kind, scenario: row.scenario, variant: row.variant, budgetMs: row.requestedBudgetMs, coldWallMs: row.cold.wallMs, firstValueMs: row.cold.firstObservedMs, workerMs: row.cold.timing?.workerMs, computeMs: row.cold.timing?.decisionComputeMs, warmWallMs: row.warm.wallMs, coldHit: row.cold.cacheHit, warmHit: row.warm.cacheHit, phase: row.cold.phase, mathematicalMetrics: compactMath(row.cold.mathematicalMetrics), mathIssues: row.mathIssues }
        : { kind: row.kind, id: row.id, dimension: row.dimension, phase: row.phase, wallMs: row.wallMs, workerMs: row.workerMs, browserWorkIterations: row.browserWorkIterations, parityIssues: row.parityIssues, mathIssues: row.mathIssues }),
      latestBenchmarkGroup: report.benchmarkGroups.at(-1) || null, interactions: report.interactions, uiResponsiveness: report.uiResponsiveness.at(-1) || null }, null, 2);
    $('report').textContent = JSON.stringify(report, null, 2);
    $('checks').replaceChildren(...report.checks.map(row => { const li = document.createElement('li'); li.className = row.pass ? 'pass' : 'fail'; li.textContent = (row.pass ? 'PASS · ' : 'FAIL · ') + row.name + (row.detail ? ' · ' + row.detail : ''); return li; }));
    $('export').disabled = false;
  }
  function check(name, pass, detail = '') { report.checks.push({ name, pass: Boolean(pass), detail }); render(); }
  function show(result) {
    $('actions').replaceChildren(...(result?.actions || []).map(row => {
      const tr = document.createElement('tr'), bound = result.actionPrecision?.actions?.find(item => item.id === row.id);
      const values = [row.id, finite(row.evBB) ? row.evBB.toFixed(6) : 'Unavailable', bound?.certified ? '[' + bound.lowerBB.toFixed(6) + ', ' + bound.upperBB.toFixed(6) + ']' : 'Pending / unsupported', finite(row.frequency) ? (100 * row.frequency).toFixed(2) + '%' : 'Unavailable'];
      for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); } return tr;
    }));
    $('summary').textContent = result ? (result.status + ' · Commitment comparison: ' + (result.decisionPrecision?.status || 'Unavailable') + ' · ' + (result.adaptation?.stopReason || 'No complete strategy')) : 'No result yet.';
    $('convergence').textContent = 'Global returned-profile NashConv: ' + (finite(result?.convergence?.nashConv) ? result.convergence.nashConv.toPrecision(6) + ' BB' : 'Unavailable') + '. This measurement is not an action-EV confidence interval.';
  }
  function client(timeMs) {
    const api = window.TheibsBrowserSolverClient;
    if (!api?.create) throw Error('Browser solver client is unavailable.');
    const service = api.create({ manifest, buildFingerprint: manifest.buildFingerprint, budgetProfiles: { STANDARD: { timeMs, iterations: 20000 }, FAST: { timeMs: 500, iterations: 50 } }, adaptiveCeilingMs: 5000 });
    activeClients.add(service); return service;
  }
  async function complete(service, variant, budget = 'STANDARD', chosenOwner = owner) {
    const started = performance.now(), currentToken = token;
    let envelope = await service.start(chosenOwner, clone(variant.input), { budget, automatic: false, revisionKey: variant.expectedRevisionKey, handId: variant.input.multiway.handId });
    const acknowledgement = clone(envelope), ackWallMs = performance.now() - started;
    let firstObservedMs = envelope.result?.actions?.length ? ackWallMs : null, observations = 1;
    while (!terminal.has(envelope.phase)) {
      if (stopped || token !== currentToken) { service.cancel(chosenOwner, envelope.jobId); throw Error('Validation stopped.'); }
      if (performance.now() - started > 12000) { service.cancel(chosenOwner, envelope.jobId); throw Error('The bounded browser check exceeded its wait ceiling.'); }
      envelope = await service.wait(chosenOwner, envelope.jobId, { afterVersion: envelope.updateVersion, waitMs: 1000 }); observations++;
      if (firstObservedMs === null && envelope.result?.actions?.length) firstObservedMs = performance.now() - started;
      if (envelope.result) show(envelope.result);
    }
    if (envelope.revisionKey !== variant.expectedRevisionKey || envelope.handId !== variant.input.multiway.handId || envelope.buildFingerprint !== manifest.buildFingerprint) throw Error('Response context differs from the current fixture.');
    return { data: envelope, acknowledgement, measurements: { wallMs: performance.now() - started, ackWallMs, firstObservedMs, observations, timing: envelope.timing, runtimeBudget: envelope.runtimeBudget, phase: envelope.phase, cacheHit: acknowledgement.cache?.hit === true, mathematicalMetrics: mathematicalMetrics(envelope.result) } };
  }
  async function digest(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join(''); }
  async function pair(scenario, variant, timeMs) {
    $('status').textContent = scenario.label + ' · ' + variant.id + ' · ' + timeMs + ' ms cold budget';
    const service = client(timeMs); service.clearOwner(owner);
    const before = service.stats(), cold = await complete(service, variant), coldDigest = await digest(cold.data.result);
    const warm = await complete(service, variant, 'FAST'), warmDigest = await digest(warm.data.result);
    const issues = assertions(cold.data.result, scenario.expectation || {});
    report.runs.push({ kind: 'COLD_WARM_PAIR', scenario: scenario.id, variant: variant.id, requestedBudgetMs: timeMs, cold: cold.measurements, warm: warm.measurements, coldResultSha256: coldDigest, warmResultSha256: warmDigest, mathIssues: issues, stats: service.stats() });
    check(variant.id + ': real cold miss', before.entries === 0 && cold.acknowledgement.cache?.hit === false && cold.data.runtime === 'BROWSER');
    check(variant.id + ': complete result and mathematical contract', cold.data.phase === 'COMPLETE' && issues.length === 0, issues.join(' '));
    check(variant.id + ': warm snapshot hit', warm.acknowledgement.cache?.hit === true && warm.data.phase === 'COMPLETE' && coldDigest === warmDigest, 'FAST reads the identical completed ' + timeMs + ' ms-budget snapshot.');
    check(variant.id + ': no automatic continuation', cold.data.runtimeBudget?.automatic === false && cold.data.runtimeBudget?.continuations === 0);
    show(warm.data.result); service.close(); activeClients.delete(service); render();
  }
  function rawSolve(variant, budget) {
    const jobId = crypto.randomUUID(), generation = ++token, started = performance.now();
    return new Promise((resolve, reject) => {
      const worker = new Worker('/browser-solver-worker.js'); rawWorkers.add(worker);
      const cleanup = () => { clearTimeout(timer); worker.terminate(); rawWorkers.delete(worker); };
      const timer = setTimeout(() => { cleanup(); reject(Error('Fixed-work Worker check exceeded 7 seconds.')); }, 7000);
      worker.onerror = event => { cleanup(); reject(Error(event.message || 'Worker failed.')); };
      worker.onmessage = event => {
        const data = event.data;
        if (data?.type === 'ready') {
          if (data.buildFingerprint !== manifest.buildFingerprint || data.schemaVersion !== 1) { cleanup(); reject(Error('Worker build identity changed.')); return; }
          worker.postMessage({ type: 'solve', jobId, generation, input: clone(variant.input), budget, expectedRevisionKey: variant.expectedRevisionKey, expectedBuildFingerprint: manifest.buildFingerprint }); return;
        }
        if (data?.jobId !== jobId || data.generation !== generation || data.buildFingerprint !== manifest.buildFingerprint) { cleanup(); reject(Error('Raw Worker job identity changed.')); return; }
        if (data.type === 'error') { cleanup(); reject(Error(data.error)); return; }
        if (data.type === 'done') { cleanup(); resolve({ ...data, observedWallMs: performance.now() - started }); }
      };
    });
  }
  async function fixedParity() {
    for (const expected of reference.cases) {
      if (stopped) throw Error('Validation stopped.');
      const scenario = scenarios.find(row => row.id === expected.id), variant = expected.input ? { id: expected.variantId, input: expected.input, expectedRevisionKey: expected.expectedRevisionKey } : scenario.variants.find(row => row.id === expected.variantId);
      $('status').textContent = 'Fixed parity · ' + expected.id;
      const output = await rawSolve(variant, expected.budget), actual = mathematical(output.result, output.checkpoint), issues = differences(actual, expected.mathematical);
      const mathIssues = assertions(output.result, expected.independentExpectation);
      report.runs.push({ kind: 'FIXED_WORK_NODE_BROWSER_PARITY', id: expected.id, budget: expected.budget, wallMs: output.observedWallMs, workerMs: output.workerMs, sourceGameHash: expected.mathematical.gameHash, browserGameHash: output.result.gameHash, sourceWorkIterations: expected.mathematical.adaptation.workIterations, browserWorkIterations: output.result.adaptation?.workIterations, parityIssues: issues, mathIssues, mathematical: actual, mathematicalMetrics: mathematicalMetrics(output.result) });
      check(expected.id + ': exact context and fixed-work parity', issues.length === 0, issues.slice(0, 12).join(' '));
      check(expected.id + ': mathematical scope and reference checks', mathIssues.length === 0, mathIssues.join(' '));
      check(expected.id + ': fixed run avoided time ceiling', output.result.adaptation?.stopReason !== 'TIME_RESOURCE_CEILING');
      show(output.result);
    }
  }
  async function selfTest() {
    const selected = fixtures.cases.filter(row => row.id !== 'four_world_five_actions');
    for (const scenario of selected) await pair(scenario, scenario.variants[0], 3000);
    const tie = reference.cases.find(row => row.id === 'overlapping_terminal_call');
    check('True tie reference is inconclusive', tie.mathematical.decisionPrecision.status === 'INCONCLUSIVE' && Object.values(tie.independentExpectation.actionValues).every(value => value === 0));
    const overlap = reference.cases.find(row => row.id === 'non_tied_overlapping_4x4');
    const overlapOutput = await rawSolve({ input: overlap.input, expectedRevisionKey: overlap.expectedRevisionKey }, overlap.budget);
    const overlapIssues = assertions(overlapOutput.result, overlap.independentExpectation);
    report.runs.push({ kind: 'NON_TIED_CERTIFIED_OVERLAP', wallMs: overlapOutput.observedWallMs, workerMs: overlapOutput.workerMs, precision: overlapOutput.result.decisionPrecision, mathIssues: overlapIssues });
    check('Non-tied point estimates retain overlapping certified bounds', overlapIssues.length === 0, overlapIssues.join(' '));
    show(overlapOutput.result);
    const input = clone(fixtures.cases[0].variants[0].input); delete input.rake;
    const service = client(3000), variant = { ...fixtures.cases[0].variants[0], id: 'missing-fee-model', input };
    const unsupported = await complete(service, variant);
    report.runs.push({ kind: 'UNSUPPORTED_FEE_MODEL', phase: unsupported.data.phase, result: unsupported.data.result, measurements: unsupported.measurements });
    check('Missing fee model is not solved', unsupported.data.phase === 'UNSUPPORTED' && unsupported.data.result?.status === 'NOT_SOLVED' && !unsupported.data.result?.actions?.length && unsupported.data.result?.decisionPrecision?.status !== 'CONCLUSIVE');
    service.close(); activeClients.delete(service);
    show(overlapOutput.result);
  }
  async function cacheChecks() {
    const service = client(3000), base = fixtures.invalidation[0].base;
    service.clearOwner(owner); const initial = await complete(service, base);
    check('Cache baseline completed', initial.data.phase === 'COMPLETE');
    for (const item of fixtures.invalidation) {
      if (stopped) throw Error('Validation stopped.');
      $('status').textContent = 'Cache safety · ' + item.id;
      const changed = await complete(service, item.changed, 'FAST');
      report.runs.push({ kind: 'CACHE_INVALIDATION', dimension: item.id, phase: changed.data.phase, cacheHit: changed.acknowledgement.cache?.hit === true, gameHash: changed.data.result?.gameHash, sourceGameHash: initial.data.result?.gameHash, measurements: changed.measurements });
      check(item.id + ': old result/checkpoint not reused', changed.acknowledgement.cache?.hit === false);
    }
    const baselineWarm = await complete(service, base, 'FAST');
    check('Original cache snapshot remains reusable', baselineWarm.acknowledgement.cache?.hit === true && await digest(baselineWarm.data.result) === await digest(initial.data.result));
    const otherOwner = owner + '_OTHER', isolated = await complete(service, base, 'FAST', otherOwner);
    check('Owner isolation blocks cross-owner cache reuse', isolated.acknowledgement.cache?.hit === false);
    report.runs.push({ kind: 'CACHE_OWNER_ISOLATION', phase: isolated.data.phase, cacheHit: isolated.acknowledgement.cache?.hit === true, stats: service.stats() });
    service.close(); activeClients.delete(service);
  }
  async function cancellation() {
    const service = client(5000), obsolete = growth.cancellation.obsolete, replacement = fixtures.cases[0].variants[0];
    service.clearOwner(owner); const before = await service.start(owner, clone(obsolete.input), { budget: 'STANDARD', automatic: false, handId: obsolete.input.multiway.handId, revisionKey: obsolete.expectedRevisionKey });
    await pause(40); const cancelStarted = performance.now(), cancelled = service.cancel(owner, before.jobId), cancellationWallMs = performance.now() - cancelStarted;
    check('Active obsolete job cancelled', !terminal.has(before.phase) && cancelled.phase === 'CANCELLED');
    const versionAfterCancel = cancelled.updateVersion, latest = await complete(service, replacement);
    await pause(600); const after = service.get(owner, before.jobId);
    check('Cancelled result cannot complete later', after.phase === 'CANCELLED' && after.updateVersion === versionAfterCancel);
    check('Replacement belongs to current hand/revision', latest.data.phase === 'COMPLETE' && latest.data.handId === replacement.input.multiway.handId && latest.data.revisionKey === replacement.expectedRevisionKey);
    report.runs.push({ kind: 'CANCEL_AND_REPLACEMENT', obsoletePhase: before.phase, cancellationWallMs, cancelledPhase: cancelled.phase, cancelledUpdateVersion: versionAfterCancel, observedFinalObsoletePhase: after.phase, observedFinalObsoleteUpdateVersion: after.updateVersion, replacement: latest.measurements, stats: service.stats() });
    show(latest.data.result); service.close(); activeClients.delete(service);
  }
  async function run(label, work) {
    if (running) return;
    running = true; stopped = false; token++; const start = performance.now();
    runInteractions = { before: interactionSnapshot(), startedAt: new Date().toISOString(), heartbeatSamples: 0, maxHeartbeatGapMs: 0 };
    let previousBeat = performance.now(); const heartbeat = setInterval(() => { const now = performance.now(); runInteractions.heartbeatSamples++; runInteractions.maxHeartbeatGapMs = Math.max(runInteractions.maxHeartbeatGapMs, now - previousBeat); previousBeat = now; }, 50);
    for (const id of buttons) $(id).disabled = true;
    for (const id of ['scenario', 'variant', 'budget']) $(id).disabled = true;
    $('stop').disabled = false;
    try { await work(); $('status').textContent = label + ' completed. Read the assertions and report.'; }
    catch (error) { check(label + ': execution', false, error.message); $('status').textContent = error.message; }
    finally {
      clearInterval(heartbeat); runInteractions.after = interactionSnapshot(); runInteractions.wallMs = performance.now() - start; report.uiResponsiveness.push(runInteractions);
      for (const service of activeClients) service.close(); activeClients.clear(); for (const worker of rawWorkers) worker.terminate(); rawWorkers.clear();
      running = false; for (const id of buttons) $(id).disabled = false; for (const id of ['scenario', 'variant', 'budget']) $(id).disabled = false; $('stop').disabled = true; render();
    }
  }
  function selected() { return scenarios.find(row => row.id === $('scenario').value); }
  function variants() { const scenario = selected(); $('variant').replaceChildren(...scenario.variants.map((variant, index) => { const option = document.createElement('option'); option.value = variant.id; option.textContent = 'Variant ' + (index + 1); return option; })); }
  $('scenario').addEventListener('change', variants);
  $('pair').addEventListener('click', () => run('Cold + warm pair', () => pair(selected(), selected().variants.find(row => row.id === $('variant').value), Number($('budget').value))));
  $('group').addEventListener('click', () => run('Three variants', async () => {
    const scenario = selected(), budget = Number($('budget').value), from = report.runs.length;
    for (const variant of scenario.variants.slice(0, 3)) { if (stopped) throw Error('Validation stopped.'); await pair(scenario, variant, budget); }
    const rows = report.runs.slice(from).filter(row => row.kind === 'COLD_WARM_PAIR');
    const stats = numbers => { const sorted = numbers.filter(finite).sort((a, b) => a - b); return { count: sorted.length, p50Ms: sorted[Math.ceil(sorted.length * .5) - 1] ?? null, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, minMs: sorted[0] ?? null, maxMs: sorted.at(-1) ?? null }; };
    report.benchmarkGroups.push({ scenario: scenario.id, budgetMs: budget, sampleCount: rows.length, coldWall: stats(rows.map(row => row.cold.wallMs)), firstValue: stats(rows.map(row => row.cold.firstObservedMs)), warmWall: stats(rows.map(row => row.warm.wallMs)), allColdMisses: rows.every(row => !row.cold.cacheHit), allWarmHits: rows.every(row => row.warm.cacheHit), allSnapshotDigestsEqual: rows.every(row => row.coldResultSha256 === row.warmResultSha256), percentileNote: 'Small synthetic sample; these percentiles do not estimate population latency.' });
  }));
  $('self-test').addEventListener('click', () => run('Self-test', selfTest));
  $('parity').addEventListener('click', () => run('Fixed parity', fixedParity));
  $('cache').addEventListener('click', () => run('Cache checks', cacheChecks));
  $('stale').addEventListener('click', () => run('Cancel + replacement', cancellation));
  $('stop').addEventListener('click', () => { stopped = true; token++; for (const service of activeClients) service.close(); for (const worker of rawWorkers) worker.terminate(); $('status').textContent = 'Stopping validation…'; });
  $('pulse').addEventListener('click', () => { taps++; $('pulse-count').textContent = taps + ' taps'; render(); });
  $('responsiveness-text').addEventListener('input', () => { inputEvents++; render(); });
  $('export').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'theibs-browser-solver-qa-' + Date.now() + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  window.addEventListener('pagehide', () => { for (const service of activeClients) service.close(); for (const worker of rawWorkers) worker.terminate(); });
  async function load(url) { const response = await fetch(url, { cache: 'no-store', credentials: 'omit' }); if (!response.ok) throw Error('Could not load ' + url); return response.json(); }
  Promise.all(['/solver-validation-fixtures.json', '/solver-validation-growth-fixtures.json', '/browser-solver-reference.json', '/browser-solver-manifest.json'].map(load)).then(values => {
    [fixtures, growth, reference, manifest] = values;
    scenarios = [...fixtures.cases, ...growth.cases, ...reference.cases.filter(row => row.id === 'lp_rich_4x4_5_sizes').map(row => ({ id: row.id, label: 'LP rich 4×4 · 5 sizes', expectation: row.independentExpectation, variants: [{ id: row.variantId, input: row.input, expectedRevisionKey: row.expectedRevisionKey }] }))];
    $('scenario').replaceChildren(...scenarios.map(row => { const option = document.createElement('option'); option.value = row.id; option.textContent = row.label || row.id; return option; })); variants();
    report = { classification: 'BROWSER_WORKER_QA', startedAt: new Date().toISOString(), releaseVersion: reference.releaseVersion, runtime: { buildFingerprint: manifest.buildFingerprint, versions: manifest.versions }, environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency ?? null, deviceMemoryGB: navigator.deviceMemory ?? null }, methodology: 'Independent visible stopwatch; exact build and fixture context. Cold clears actual client memory, warm FAST returns the same completed cached snapshot. Fixed parity compares matching stopped work against Node. LP residual tolerance is for containment only, never for dominance. Timed point values are not expected to be identical across stopping times.', checks: [], runs: [], benchmarkGroups: [], uiResponsiveness: [], notExecuted: ['Authenticated account flows', 'Private workspace/history mutation', 'Hosted solver performance', 'Provider cancellation gate', 'Oracle persistence/data migration', 'Physical phone performance', 'Human speech recognition'] };
    $('runtime').textContent = 'Worker build ' + manifest.buildFingerprint + ' · fixture-only QA owner';
    $('status').textContent = 'Ready. Select a scenario and budget, or run self-test / fixed parity.';
    for (const id of buttons) $(id).disabled = false; render();
  }).catch(error => { $('status').textContent = error.message; });
})();
