'use strict';
// HARNESS: real browser, local API, poker ledger and solver worker. The speech
// recognizer emits synthetic final events; no acoustic accuracy is claimed.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'theibs-solver-browser-'));
Object.assign(process.env, { THEIBS_AUTH_REQUIRED: 'false', THEIBS_MULTIWAY_LLM_PROVIDER: 'none', THEIBS_LLM_PROVIDER: 'none',
  THEIBS_DATA_PATH: path.join(temp, 'events.jsonl'), THEIBS_WORKSPACE_PATH: path.join(temp, 'workspace.json'),
  THEIBS_SOLVER_CACHE_PATH: path.join(temp, 'solver-cache'), THEIBS_LLM_CONFIG_PATH: path.join(temp, 'llm.json') });
const { server } = require('../server'), mw = require('../src/multiway-session'), { CardKeyboardState, fromCanonical } = require('../public/card-model');
const out = path.resolve(__dirname, '../../validacao/solver-integrated-browser'); fs.mkdirSync(out, { recursive: true });
const report = { classification: 'HARNESS_REAL_BROWSER_API_SOLVER_SYNTHETIC_SPEECH', checks: [], errors: [], screenshots: [],
  responses: [], requests: [], interactionTimings: [], generatedAt: new Date().toISOString(), microphone: 'NOT_EXECUTED' };
const board = ['2s', '3h', '4d', '8c', '9s'];
const hero = ['As', 'Ah', 'Qd', 'Jc', 'Tc'];
const act = (actor, action, to) => ({ type: 'ACT', actor, action, ...(to == null ? {} : { to }) });
function fixture(players, terminalCall = false) {
  let current = mw.start({ variant: 'PLO5_HIGH', playerCount: players, heroPosition: 'SB', startingStack: terminalCall ? 2 : 20,
    smallBlind: .5, bigBlind: 1, heroCards: hero });
  while (current.state.street !== 'RIVER') current = mw.step(current.multiway, current.state.phase === 'WAIT_BOARD'
    ? { type: 'BOARD', cards: board.slice(0, { FLOP: 3, TURN: 4, RIVER: 5 }[current.state.nextStreet]) }
    : act(current.state.actor, current.state.legal.toCall ? 'CALL' : 'CHECK'));
  if (terminalCall) current = mw.step(current.multiway, act(1, 'BET', 1));
  else while (current.state.actor !== current.state.heroId) current = mw.step(current.multiway, act(current.state.actor, 'CHECK'));
  const combinations = terminalCall ? [[hero], [['Ks', 'Kh', '6d', '7c', '8h']]] : [
    [hero, ['5s', '6s', 'Qd', 'Jc', 'Tc']],
    [['Ks', 'Kh', '6d', '7c', '8h'], ['5h', '6h', 'Kd', '7c', '8h']],
    [['Qs', 'Qh', '6c', '7d', '8d'], ['5c', '6c', 'Qc', '7d', '8d']]
  ];
  return { current, combinations };
}
let browser, context, page, origin;
async function api(route, payload) {
  const response = await fetch(origin + route, payload == null ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json(); assert.equal(response.ok, true, `${route}: ${JSON.stringify(data)}`); return data;
}
async function loadHand(example) {
  if (page) { await page.evaluate(() => window.theibsApp?.flushSave()).catch(() => {}); await page.goto('about:blank'); }
  const keyboard = new CardKeyboardState(5); assert.equal(keyboard.setCards(hero.map(fromCanonical), board.map(fromCanonical)), true);
  const stored = await api('/api/workspace');
  await api('/api/workspace', { expectedRevision: stored.revision, workspace: { schemaVersion: 1, keyboard: keyboard.snapshot(), fields: { 'variant': 'PLO5_HIGH' },
    ui: { felt: 'roxo', deck: 'cores', view: 'analyze', cardDisplayVersion: 2, workflowVersion: 1,
      sidebarCollapsed: true, multiwayPreferences: { rakeChoice: { mode: 'GROSS' } } },
    multiway: example.current.multiway, snapshots: [], lastAnalysis: null, manualText: '' } });
  await page.goto(origin + '/app?login=1'); await page.waitForFunction(() => Boolean(window.theibsApp)); await page.evaluate(() => theibsApp.ready);
  await page.waitForFunction(id => theibsApp.getState().multiway?.handId === id && !theibsApp.getState().multiwayBusy, example.current.multiway.handId);
  await page.waitForFunction(() => !theibsApp.getState().analysisBusy && theibsApp.getState().lastAnalysis?.data?.analysisStage === 'FINAL', null, { timeout: 25000 });
}
async function shot(name, width = 1366) {
  await page.setViewportSize({ width, height: width < 600 ? 852 : 900 });
  const modal = await page.locator('#mw-solver-dialog[open]').count();
  if (modal) {
    await page.locator('#mw-solver-dialog').evaluate(node => { node.scrollTop = 0; });
    assert.equal(await page.locator('#mw-solver-dialog').evaluate(node => node.scrollWidth > node.clientWidth), false, name + ': dialog horizontal overflow');
    const box = await page.locator('#mw-solver-dialog').boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= (width < 600 ? 852 : 900) + 1, name + ': dialog must fit viewport');
  }
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: !modal }); report.screenshots.push(name + '.png');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ': horizontal overflow');
}
async function collapseMethods() {
  if (await page.locator('#mw-decision-ev > details').getAttribute('open') !== null) await page.locator('#mw-decision-ev > details > summary').click();
}
async function declareStudy(example, aggressions) {
  const before = await page.evaluate(() => theibsApp.getState().multiway.events.length);
  if (await page.locator('#mw-decision-ev > details').getAttribute('open') === null) await page.locator('#mw-decision-ev > details > summary').click();
  await page.locator('[data-mw-solver-setup]').first().click();
  await page.locator('#mw-solver-dialog [name=notation]').selectOption('CANONICAL');
  for (let seat = 0; seat < example.combinations.length; seat++) await page.locator(`[data-solver-range="${seat}"]`).fill(example.combinations[seat].map(cards => cards.join(' ')).join('\n'));
  await page.locator('#mw-solver-dialog [name=aggressions]').selectOption(String(aggressions));
  await page.locator('#mw-solver-dialog [name=complete]').check();
  assert.equal(await page.evaluate(() => theibsApp.getState().multiway.events.length), before, 'typing explicit ranges must not invoke card/action shortcuts');
  await shot(`study-${example.combinations.length}-seat-dialog-desktop`); await shot(`study-${example.combinations.length}-seat-dialog-mobile`, 393);
  await page.locator('#mw-solver-dialog button[type=submit]').click();
  await page.locator('#mw-solver-dialog').waitFor({ state: 'hidden' });
}
async function solverResult(predicate = null) {
  await page.waitForFunction(() => {
    const state = TheibsMultiwaySolverUI.getState(); return Boolean(state.result?.actions?.length) && ['COMPLETE', 'UNSUPPORTED', 'FAILED'].includes(state.phase);
  }, null, { timeout: 25000 });
  const state = await page.evaluate(() => TheibsMultiwaySolverUI.getState());
  assert.equal(state.phase, 'COMPLETE', JSON.stringify(state));
  if (predicate) predicate(state); return state;
}

(async () => { try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  report.origin = origin;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(() => {
    const fake = { instances: [], starts: 0, aborts: 0, maxActive: 0, duplicateStarts: 0 }; window.__solverVoice = fake;
    class Recognition {
      static async available() { return 'available'; }
      constructor() { this.processLocally = false; this.results = []; fake.instances.push(this); }
      start() { if (this.active) fake.duplicateStarts++; this.active = true; fake.starts++;
        fake.maxActive = Math.max(fake.maxActive, fake.instances.filter(item => item.active).length);
        queueMicrotask(() => { this.onstart?.(); this.onaudiostart?.(); }); }
      stop() { this.active = false; queueMicrotask(() => { this.onaudioend?.(); this.onend?.(); }); }
      abort() { fake.aborts++; this.stop(); }
      emit(text) { const row = Object.assign([{ transcript: text }], { isFinal: true }); this.results.push(row); this.onresult?.({ results: this.results, resultIndex: this.results.length - 1 }); }
    }
    Recognition.prototype.processLocally = false; window.SpeechRecognition = Recognition; window.webkitSpeechRecognition = Recognition;
  });
  page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => { if (/\/api\/multiway\/solver\/start$/.test(request.url())) report.requests.push(request.postDataJSON()); });
  page.on('response', async response => { if (/\/api\/multiway\/solver\/(start|jobs\/)/.test(response.url())) try {
    const data = await response.json(); report.responses.push({ http: response.status(), phase: data.phase, budget: data.budget, status: data.result?.status,
      source: data.result?.source, nashConv: data.result?.convergence?.nashConv, revisionKey: data.revisionKey, jobId: data.jobId,
      iterations: data.result?.iterations, cacheHit: data.cache?.hit });
  } catch {} });

  const headsUp = fixture(2, true); await loadHand(headsUp);
  assert.match(await page.locator('#mw-decision-ev').innerText(), /Heuristic/i);
  assert.doesNotMatch(await page.locator('#mw-decision-ev').innerText(), /Highest modeled EV|Highest EV in this model/);
  assert.equal(await page.evaluate(() => theibsApp.getState().lastAnalysis.data.ev.candidates.every(item => item.status === 'MODELED')), true);
  report.checks.push('Without explicit solver ranges the existing EV is labeled Heuristic, remains usable before fees, and is not relabeled GTO.');
  await declareStudy(headsUp, 3);
  const hu = await solverResult(); assert.equal(hu.result.status, 'SOLVED'); assert.equal(hu.result.qualification.gto, false);
  assert.equal(hu.result.source, 'REFERENCE_SUBGAME_STRATEGY'); assert.ok(hu.result.convergence.nashConv <= .01);
  assert.ok(Math.abs(hu.result.actions.reduce((sum, item) => sum + item.frequency, 0) - 1) < 1e-10);
  assert.equal(hu.result.decisionPrecision.status, 'INCONCLUSIVE');
  assert.equal(hu.result.decisionPrecision.reasonCode, 'EQUILIBRIUM_ACTION_VALUE_UNCERTAINTY_UNAVAILABLE');
  assert.equal(hu.result.decisionPrecision.leaderConclusive, false);
  assert.ok(Math.abs(hu.result.decisionPrecision.deltaEVBB - 3) < 1e-12);
  const huText = await page.locator('#mw-decision-ev').innerText(); assert.match(huText, /Frequency|Mix/i); assert.match(huText, /Solved/i);
  assert.doesNotMatch(huText.split('Methods')[0], /Heuristic/i);
  assert.match(huText, /Current EV leader: Call/); assert.match(huText, /ΔEV · top two: 3 bb/); assert.match(huText, /INCONCLUSIVE/);
  assert.doesNotMatch(huText.split('Methods')[0], /Best modeled action/);
  await shot('solved-hu-methods-desktop'); await collapseMethods();
  assert.match(await page.locator('#equity-origin').innerText(), /separate from river study/i);
  await shot('solved-hu-desktop'); await shot('solved-hu-mobile', 393);
  report.checks.push('Real PLO5 all-in river worker replaces heuristic rows with a qualified SOLVED subgame strategy, measured NashConv and actual frequencies. GTO/full-hand claims stay disabled.');
  report.checks.push('Even a SOLVED subgame with a 3 bb point gap shows Current EV leader and INCONCLUSIVE because NashConv is not an action EV error bound. The measured ΔEV remains visible.');
  report.headsUp = { status: hu.result.status, actions: hu.result.actions, convergence: hu.result.convergence, precision: hu.result.decisionPrecision, timing: hu.timing };

  const originalJobId = hu.jobId, beforeCalls = report.requests.length;
  await page.evaluate(() => TheibsMultiwaySolverUI.evaluate(theibsApp.getAnalysisInput(), { budget: 'FAST' }));
  const duplicate = await solverResult(); assert.equal(duplicate.jobId, originalJobId);
  assert.equal(report.requests.length, beforeCalls, 'Repeated identical evaluation must not start another worker.');
  const cached = await api('/api/multiway/solver/start', report.requests.at(-1));
  assert.equal(cached.cache.hit, true); assert.notEqual(cached.jobId, originalJobId);
  assert.deepEqual(cached.result.convergence, hu.result.convergence);
  report.checks.push('Identical UI evaluations are deduplicated; a separate compatible FAST API request reuses the exact cached strategy and convergence metric.');

  const beforeDecision = await page.evaluate(() => ({ record: theibsApp.getState().multiway, solver: TheibsMultiwaySolverUI.decisionSnapshot() }));
  await page.locator('#mw-actions [data-mw-action="CALL"]').click();
  await page.waitForFunction(() => !theibsApp.getState().multiwayBusy && theibsApp.getState().multiwayState.phase === 'SHOWDOWN');
  const recorded = await page.evaluate(handId => TheibsPlayersStorage.createStorage().open(theibsPlayersUI.getOwnerKey()).library.decisions[handId], beforeDecision.record.handId);
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0].recordBefore, beforeDecision.record);
  assert.deepEqual(recorded[0].solver, beforeDecision.solver);
  assert.equal(recorded[0].revisionKey, hu.revisionKey);
  assert.equal(recorded[0].feedback.source, 'REFERENCE_SUBGAME_STRATEGY');
  assert.equal(recorded[0].feedback.coverage, 'SOLVED');
  assert.equal(recorded[0].feedback.analysisId, null, 'Legacy analysis cannot supply the chosen solver feedback.');
  assert.equal(recorded[0].feedback.lossBB, null, 'A global loss must not be invented for a bounded river study.');
  assert.equal(await page.evaluate(() => TheibsMultiwaySolverUI.decisionSnapshot()), null);
  report.decisionHistory = { handId: recorded[0].handId, revisionKey: recorded[0].revisionKey, feedback: recorded[0].feedback,
    solverStatus: recorded[0].solver.status, actions: recorded[0].solver.actions };
  report.checks.push('The real Hero Call stores exactly the solver snapshot shown before the action, its original ledger/revision and solver-only feedback source. No legacy loss or future-state result is substituted.');

  const three = fixture(3); await loadHand(three); await declareStudy(three, 1);
  const multiway = await solverResult(); assert.equal(multiway.result.status, 'APPROXIMATE'); assert.equal(multiway.result.qualification.gto, false);
  assert.equal(multiway.result.abstraction.originalSeats, 3); assert.equal(multiway.result.abstraction.compatibleWorlds, 8);
  assert.ok(multiway.result.actions.some(action => action.size != null));
  assert.equal(multiway.result.convergence.unilateralGains.length, 3);
  assert.equal(multiway.result.source, 'REFERENCE_SUBGAME_STRATEGY');
  assert.equal(multiway.result.decisionPrecision.status, 'INCONCLUSIVE');
  assert.match(await page.locator('#mw-decision-ev .mw-ev-conclusion').innerText(), /Current EV leader:[\s\S]*ΔEV · top two:[\s\S]*INCONCLUSIVE/);
  await shot('approximate-three-player-methods-desktop'); await collapseMethods();
  await shot('approximate-three-player-desktop'); await shot('approximate-three-player-mobile', 393);
  report.checks.push('Three-player finite river study retains joint worlds, measured gains for all seats and action frequencies; partial betting coverage remains Approximate.');
  report.multiway = { status: multiway.result.status, actions: multiway.result.actions, convergence: multiway.result.convergence, precision: multiway.result.decisionPrecision, timing: multiway.timing };

  await page.locator('#voice-options-open').click(); await page.locator('#voice-language').selectOption('en-US');
  assert.equal(await page.locator('#voice-processing').inputValue(), 'device');
  await page.locator('#voice-settings-dialog [data-close-dialog]').click(); await page.locator('#voice-consent').check();
  await page.waitForFunction(() => theibsCardVoice.getStatus().audioReady);
  const eventsBefore = await page.evaluate(() => theibsApp.getState().multiway.events.length);
  // Launch against an uncached compatible abstraction. Public table/voice stay
  // live while the genuine worker builds/refines it, then a card edit cancels it.
  if (await page.locator('#mw-decision-ev > details').getAttribute('open') === null) await page.locator('#mw-decision-ev > details > summary').click();
  await page.locator('[data-mw-solver-setup]').first().click();
  await page.locator('#mw-solver-dialog [name=aggressions]').selectOption('2');
  await page.locator('#mw-solver-dialog [name=sizing]').selectOption('EXPLICIT_TOTALS');
  await page.locator('#mw-solver-dialog [name=levels]').fill('1,2,4');
  await page.locator('#mw-solver-dialog [name=complete]').check();
  await page.locator('#mw-solver-dialog button[type=submit]').click();
  await page.evaluate(() => TheibsMultiwaySolverUI.evaluate(theibsApp.getAnalysisInput(), { budget: 'DEEP' }));
  const interaction = await page.evaluate(async () => {
    const phase = TheibsMultiwaySolverUI.getState().phase, before = performance.now(), starts = __solverVoice.starts;
    __solverVoice.instances.at(-1).emit('my turn');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { phaseAtSpeech: phase, twoFramesMs: performance.now() - before, startsBefore: starts,
      startsAfter: __solverVoice.starts, audioReady: theibsCardVoice.getStatus().audioReady,
      maxActiveRecognizers: __solverVoice.maxActive, duplicateStarts: __solverVoice.duplicateStarts,
      voiceEnabled: theibsCardVoice.getStatus().enabled, resultPhase: TheibsMultiwaySolverUI.getState().phase };
  });
  assert.equal(interaction.voiceEnabled, true); assert.equal(interaction.maxActiveRecognizers, 1); assert.equal(interaction.duplicateStarts, 0);
  assert.ok(['QUEUED', 'BUILDING', 'REFINING'].includes(interaction.phaseAtSpeech), JSON.stringify(interaction));
  assert.equal(await page.evaluate(() => theibsApp.getState().multiway.events.length), eventsBefore);
  const oldSolver = await page.evaluate(() => TheibsMultiwaySolverUI.getState());
  const oldRevision = await page.evaluate(() => theibsApp.getState().multiwayState.revisionKey);
  const keyStarted = performance.now();
  await page.locator('#hero-slots button').first().focus(); await page.keyboard.type('ap');
  await page.waitForFunction(revision => theibsApp.getState().multiwayState.revisionKey !== revision && !theibsApp.getState().multiwayBusy, oldRevision);
  interaction.cardRevisionMs = performance.now() - keyStarted; report.interactionTimings.push(interaction);
  assert.equal(await page.evaluate(() => theibsApp.getState().multiway.config.heroCards[0]), 'Ac');
  assert.equal(await page.evaluate(() => theibsCardVoice.getStatus().enabled), true);
  await page.waitForFunction(revision => TheibsMultiwaySolverUI.getState().result == null || TheibsMultiwaySolverUI.getState().revisionKey !== revision, oldRevision);
  if (oldSolver.jobId) {
    const remote = await api('/api/multiway/solver/jobs/' + oldSolver.jobId);
    assert.ok(['CANCELLED', 'COMPLETE', 'UNSUPPORTED'].includes(remote.phase), remote.phase);
    report.cancelledJob = { phase: remote.phase, previousRevision: remote.revisionKey, displayedRevision: await page.evaluate(() => theibsApp.getState().multiwayState.revisionKey) };
  }
  report.checks.push('During a real DEEP worker, synthetic voice command and browser animation frames remain responsive. Hardware card input commits a new revision and prevents old solver output from rendering. Voice stays enabled.');
  await page.waitForFunction(() => !theibsApp.getState().analysisBusy, null, { timeout: 25000 });
  await shot('edited-state-mobile', 393);

  await page.locator('#mw-actions [data-mw-action="CHECK"]').click();
  await page.waitForFunction(n => theibsApp.getState().multiway.events.length === n + 1 && !theibsApp.getState().multiwayBusy, eventsBefore);
  assert.equal(await page.evaluate(() => theibsApp.getState().multiway.events.at(-1).action), 'CHECK');
  assert.equal(await page.evaluate(() => TheibsMultiwaySolverUI.getState().result), null);
  assert.equal(await page.evaluate(() => theibsCardVoice.getStatus().enabled), true);
  report.checks.push('Recording the next legal action remains independent of solver availability, invalidates the old strategy and preserves microphone activation.');
  assert.ok(report.requests.every(request => !request.profileSnapshot && !request.profiles && !request.transcript));
  await page.locator('#voice-consent').uncheck();
  assert.equal(await page.evaluate(() => theibsCardVoice.getStatus().enabled), false);
} catch (error) {
  report.errors.push(error.stack || String(error));
  if (page) { await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
    report.debug = await page.evaluate(() => ({ app: window.theibsApp?.getState(), solver: window.TheibsMultiwaySolverUI?.getState(),
      decisionText: document.querySelector('#mw-decision-ev')?.innerText, dialog: document.querySelector('#mw-solver-dialog')?.innerText,
      voice: window.theibsCardVoice?.getStatus() })).catch(() => null); }
} finally {
  report.pass = report.errors.length === 0; fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks, errors: report.errors, screenshots: report.screenshots,
    interactionTimings: report.interactionTimings }, null, 2));
  await browser?.close(); await new Promise(resolve => server.close(resolve)); if (!report.pass) process.exitCode = 1;
} })();
