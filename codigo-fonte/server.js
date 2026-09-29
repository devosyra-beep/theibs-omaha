const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSession, publicSession, applyAction } = require('./src/training-simulator');
const { evaluateSession, validateChoice } = require('./src/training-analysis');
const { snapshotForCoach, answerDoubt, localCoachAnswer, enrichCoachAnswer, prepareScenario, coachSummary } = require('./src/coach');
const llama = require('./src/llama-config');
const { appendEvent, appendEvents, readEvents, decisionQuality, summarize, similarDecisions, opponentTendencies, outcomeTimeline, readEventPage } = require('./src/training-store');
const { historyOverview, closeHistoryService } = require('./src/history-service');
const { fingerprint, attachAnalysisContract } = require('./src/analysis-contract');
const { importHands } = require('./src/hand-importer');
const { readWorkspace, saveWorkspace } = require('./src/workspace-store');
const analyzeInWorker = require('./src/analysis-worker');
const multiway = require('./src/multiway-session');
const authService = require('./src/supabase-service');
const billing = require('./src/abacatepay');
const { publicOrigin, runtimeConfig, validateDeployment } = require('./src/hosting-config');
const { experimentReport } = require('./src/analysis-experiment-report');
const { prepareOpponentOverrides } = require('./src/opponent-overrides');

const root = __dirname;
const publicDir = path.join(root, 'public');
const port = runtimeConfig().port;
const sessions = new Map();
const sessionOwners = new Map();
const sessionBusy = new WeakSet();
const manualCache = new Map(), coachTickets = new Map();
const CACHE_TTL_MS = 60000, TICKET_TTL_MS = 120000;
function putBounded(map, key, value, limit = 100) {
  const now = Date.now();
  for (const [id, item] of map) if (item.expires <= now) map.delete(id);
  map.delete(key);
  while (map.size >= limit) map.delete(map.keys().next().value);
  map.set(key, value);
}
function localFirstAnswer(context, question, similarCases, auth, session) {
  let enabled = false;
  try { enabled = llama.readConfig().config.provider === 'ollama'; } catch { /* Local facts remain available with a broken optional config. */ }
  const answer = localCoachAnswer(context, question, { languageModelConfigured: enabled, similarCases });
  if (!enabled) return { answer, enrichment: null };
  const ticket = crypto.randomUUID(), expires = Date.now() + TICKET_TTL_MS;
  putBounded(coachTickets, ticket, { owner: auth.user.id, context: structuredClone(context), question,
    similarCases: structuredClone(similarCases), expires, sessionId: session?.id, revision: session?.events.length });
  return { answer, enrichment: { ticket, expiresAt: new Date(expires).toISOString(), analysisId: context.analysisId || null } };
}

function allowedRequestHost(host) {
  const currentPort = server.address()?.port;
  const local = new Set([`127.0.0.1:${currentPort}`, `localhost:${currentPort}`, `[::1]:${currentPort}`]);
  const remote = publicOrigin();
  if (remote) local.add(new URL(remote).host);
  return local.has(host);
}

function allowedRequestOrigin(origin, host) {
  if (!origin) return true;
  if (origin === `http://${host}` || origin === `https://${host}`) return true;
  return origin === publicOrigin();
}

function userStoragePath(auth, name) {
  if (!authService.settings().required || auth?.local) return undefined;
  const rootPath = process.env.THEIBS_USER_DATA_ROOT || path.join(root, '.theibs-users');
  const userFolder = crypto.createHash('sha256').update(String(auth.user.id)).digest('hex');
  return path.join(rootPath, userFolder, name);
}

function ownerMatches(auth, sessionId) {
  if (!authService.settings().required || auth?.local) return true;
  return sessionOwners.get(String(sessionId || '')) === auth.user.id;
}

function json(response, status, data) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}

function parseCards(text) {
  if (Array.isArray(text)) return text.map((card) => typeof card === 'string' ? card : '').filter(Boolean);
  return String(text || '').split(/[ ,\n]+/).map((item) => item.trim()).filter(Boolean);
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  return Number(value);
}

function buildInput(payload) {
  const input = {
    variant: payload.variant || 'PLO5_HIGH',
    ...(payload.street ? { street: payload.street } : {}),
    heroCards: parseCards(payload.heroCards),
    board: parseCards(payload.board),
    position: payload.position,
    players: parseOptionalNumber(payload.players),
    potBeforeAction: parseOptionalNumber(payload.potBeforeAction),
    amountToCall: parseOptionalNumber(payload.amountToCall),
    effectiveStack: parseOptionalNumber(payload.effectiveStack),
    betSize: parseOptionalNumber(payload.betSize),
    raiseTo: parseOptionalNumber(payload.raiseTo),
    foldEquity: parseOptionalNumber(payload.foldEquity),
    continuationEquity: parseOptionalNumber(payload.continuationEquity),
    rake: parseOptionalNumber(payload.rake),
    rakeSchedule: payload.rakeSchedule,
    selectionInference: payload.selectionInference,
    practicalEquivalenceBB: parseOptionalNumber(payload.practicalEquivalenceBB),
    bigBlind: parseOptionalNumber(payload.bigBlind),
    assumeNoRake: payload.assumeNoRake === true,
    futureStreetModel: payload.futureStreetModel,
    opponentProfile: payload.opponentProfile,
    opponentProfileSource: payload.opponentProfileSource,
    opponentTendencies: payload.opponentTendencies,
    opponentResponseModel: payload.opponentResponseModel,
    opponentSeatIds: payload.opponentSeatIds,
    actionResponseModels: payload.actionResponseModels,
    aggressionStudy: payload.aggressionStudy,
    heroContribution: parseOptionalNumber(payload.heroContribution ?? payload.aggressionStudy?.heroContribution),
    minRaiseTo: parseOptionalNumber(payload.minRaiseTo),
    minBet: parseOptionalNumber(payload.minBet),
    maxRaiseTo: parseOptionalNumber(payload.maxRaiseTo),
    sidePots: payload.sidePots,
    samples: Number(payload.samples ?? 5000),
    samplingMode: payload.samplingMode==='ADAPTIVE'?'ADAPTIVE':'FIXED',
    seed: Number(payload.seed ?? 42),
    unknownOpponentModel: payload.unknownOpponentModel,
    actionHistory: payload.actionHistory,
    availableActions: Number(payload.amountToCall || 0)
      ? ['FOLD', 'CALL', 'RAISE']
      : Number(payload.heroContribution ?? payload.aggressionStudy?.heroContribution ?? 0) > 0 ? ['CHECK', 'RAISE'] : ['CHECK', 'BET']
  };
  if (Array.isArray(payload.availableActions)) input.availableActions = input.availableActions.filter(action=>['FOLD','CALL','CHECK','BET','RAISE'].includes(action) && payload.availableActions.includes(action));
  if (Object.hasOwn(payload,'opponentOverrides')) {
    input.opponentOverrides=payload.opponentOverrides;
    input.opponentStudyAccepted=payload.opponentStudyAccepted===true;
    input.opponentContributions=payload.opponentContributions;
  }
  const opponentHand = parseCards(payload.opponentHand);
  const rangeHands = String(payload.opponentRange || '')
    .split(/\n|\|/)
    .map(parseCards)
    .filter((hand) => hand.length > 0);
  if (Array.isArray(payload.opponentRanges) && payload.opponentRanges.length > 0) input.opponentRanges = payload.opponentRanges;
  else if (opponentHand.length > 0) input.opponentHands = [opponentHand];
  else if (rangeHands.length > 0) input.opponentRanges = [{ hands: rangeHands }];
  if (payload.opponentRangeProfilePosition || payload.opponentRangeProfileAction) {
    input.opponentRangeProfile = {
      position: payload.opponentRangeProfilePosition,
      action: payload.opponentRangeProfileAction || 'OPEN'
    };
  }
  return input;
}

function serveStatic(request, response) {
  let requested;
  try { requested = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
  catch { response.writeHead(400); response.end('Invalid URL'); return; }
  if (requested === '/') requested = '/landing.html';
  if (requested === '/app' || requested === '/app/') requested = '/index.html';
  const filePath = path.resolve(publicDir, `.${requested}`);
  if (!filePath.startsWith(publicDir + path.sep)) {
    response.writeHead(403); response.end('Forbidden'); return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) { response.writeHead(404); response.end('Not found'); return; }
    const extension = path.extname(filePath).toLowerCase();
    const contentType = ({
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.webmanifest': 'application/manifest+json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon'
    })[extension] || 'text/html; charset=utf-8';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(data);
  });
}

async function analyzeManual(payload, response, owner = 'local') {
  const started = performance.now(), input = buildInput(payload);
  const preview = payload.analysisPhase === 'PREVIEW';
  const prepared = payload.multiway?.enabled === true ? multiway.prepareAnalysis(payload.multiway, input) : null;
  if (prepared && !prepared.available) return attachAnalysisContract(multiway.blockedResult(prepared), { ...prepared.input, multiway: payload.multiway });
  const computeInput = { ...(prepared?.input || prepareOpponentOverrides(input)) };
  if (preview) {
    if(!Number.isInteger(computeInput.samples)||computeInput.samples<1||computeInput.samples>50000)throw Error('samples must be an integer between 1 and 50000.');
    computeInput.samplingMode = 'FIXED';
    computeInput.samples = Math.min(512, Number.isInteger(computeInput.samples) && computeInput.samples > 0 ? computeInput.samples : 512);
    // Preserve the complete study model; its own budget remains authoritative.
  }
  const key = fingerprint({ owner, build: require('./package.json').version, input: computeInput, multiway: payload.multiway, preview });
  const cached = manualCache.get(key);
  if (cached && cached.expires > Date.now()) {
    const result = structuredClone(cached.result);
    result.performance = { ...result.performance, cacheHit: true, cacheAgeMs: Date.now() - cached.createdAt,
      cachedCalculationMs: result.performance?.requestElapsedMs ?? null,
      requestElapsedMs: performance.now() - started, monteCarloSamples: 0, simulationsPerSecond: null };
    return result;
  }
  let result = await analyzeInWorker(computeInput, response);
  if (prepared) result = multiway.guardResult(result, prepared);
  result.analysisStage = preview ? 'PROVISIONAL' : 'FINAL';
  // Build the public assessment only after street guards and the final/preview
  // stage are known; an unguarded worker result cannot supply a green signal.
  result = attachAnalysisContract(result, prepared ? { ...computeInput, multiway: payload.multiway } : computeInput);
  result.performance = { ...result.performance, cacheHit: false };
  if (result.status === 'OK' && !response.destroyed) putBounded(manualCache, key, { result: structuredClone(result), createdAt: Date.now(), expires: Date.now() + CACHE_TTL_MS });
  return result;
}

function collectBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 512000) { const error = new Error('Request too large.'); error.statusCode = 413; reject(error); return; }
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const host = request.headers.host || '';
  let requestUrl;
  try { requestUrl = new URL(request.url, `http://${host || '127.0.0.1'}`); }
  catch { return json(response, 400, { status: 'ERROR', reason: 'URL inválida.' }); }
  const route = requestUrl.pathname;
  if (!allowedRequestHost(host)) return json(response, 403, { status: 'ERROR', reason: 'Host não permitido.' });
  if (!allowedRequestOrigin(request.headers.origin, host)) return json(response, 403, { status: 'ERROR', reason: 'Origem não permitida.' });
  if (request.method === 'GET' && route === '/healthz') return json(response, 200, { status: 'OK' });
  if (request.method === 'POST' && !(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return json(response, 415, { status: 'ERROR', reason: 'Use application/json.' });
  if (request.method === 'GET' && route === '/api/public-config') {
    try { return json(response, 200, { status: 'OK', auth: authService.publicConfig() }); }
    catch (error) { return json(response, 503, { status: 'ERROR', reason: error.message }); }
  }
  if (request.method === 'POST' && route === '/api/billing/webhook') {
    try {
      const rawBody = await collectBody(request);
      const verified = billing.verifyWebhook(rawBody, request.headers['x-webhook-signature'], {
        ...process.env, __webhookSecretFromRequest: requestUrl.searchParams.get('webhookSecret') || ''
      });
      if (!verified) return json(response, 401, { status: 'ERROR', reason: 'Webhook inválido.' });
      const event = JSON.parse(rawBody);
      if (!event?.id || !event?.event || !event?.data) return json(response, 400, { status: 'ERROR', reason: 'Evento inválido.' });
      await authService.insertPaymentEvent(event);
      const entitlement = billing.entitlementFromEvent(event);
      if (entitlement) await authService.upsertEntitlement(entitlement);
      return json(response, 200, { status: 'OK' });
    } catch (error) { return json(response, error.statusCode || 400, { status: 'ERROR', reason: error.message }); }
  }
  if (request.method === 'GET' && route === '/api/status') {
    let modelState;
    try { modelState = llama.publicState(); } catch (error) { modelState = { config: { provider: 'none', model: '' }, availability: { state: 'UNAVAILABLE', reason: error.message } }; }
    return json(response, 200, {
      status: 'OK', version: require('./package.json').version,
      variants: ['PLO4_HIGH', 'PLO5_HIGH', 'PLO6_HIGH'],
      llmProvider: modelState.config.provider,
      llmModel: modelState.config.model || null,
      llmAvailability: modelState.availability.state,
      llm: modelState,
      learning: { automaticTraining: false, historyRetrieval: true, parameterUpdates: false },
      calculation: { engine: 'NUMERICAL', llmAccelerated: false, targetCompleteSimulationsPerSecond: 100000 }
    });
  }

  let auth = null;
  let access = null;
  if (route.startsWith('/api/')) {
    try {
      auth = await authService.authenticateRequest(request);
      access = await authService.accessFor(auth);
      if (request.method === 'GET' && route === '/api/access') return json(response, 200, { status: 'OK', access });
      if (request.method === 'POST' && route === '/api/billing/checkout') {
        const checkout = await billing.createPaymentCheckout(auth.user);
        return json(response, 200, { status: 'OK', checkout });
      }
      if (!access.allowed) return json(response, 402, { status: 'PAYMENT_REQUIRED', access });
    } catch (error) { return json(response, error.statusCode || 503, { status: 'ERROR', reason: error.message }); }
  }

  if (request.method === 'GET' && route === '/api/analysis/experiments') {
    try { return json(response, 200, experimentReport()); }
    catch { return json(response, 500, { status: 'ERROR', reason: 'Economic evidence unavailable.' }); }
  }

  if (request.method === 'GET' && route === '/api/llm/config') {
    try { return json(response, 200, { status: 'OK', ...llama.publicState() }); }
    catch (error) { return json(response, 400, { status: 'ERROR', reason: error.message }); }
  }
  if (request.method === 'GET' && route === '/api/workspace') {
    try { return json(response, 200, { status: 'OK', ...readWorkspace(userStoragePath(auth, 'workspace.json')) }); }
    catch (error) { return json(response, 500, { status: 'ERROR', reason: `Não foi possível ler o rascunho: ${error.message}` }); }
  }

  if (request.method === 'POST' && route.startsWith('/api/')) {
    try {
      const payload = JSON.parse(await collectBody(request));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Envie um objeto JSON.');
      if (authService.settings().required && ['/api/llm/config', '/api/llm/start'].includes(route)) {
        return json(response, 403, { status: 'ERROR', reason: 'Configuração do assistente disponível somente no servidor.' });
      }
      if (route === '/api/llm/config') return json(response, 200, { status: 'OK', ...llama.publicState(llama.saveConfig(payload.config || payload)) });
      if (route === '/api/llm/check') return json(response, 200, { status: 'OK', ...await llama.checkAvailability() });
      if (route === '/api/llm/start') return json(response, 200, { status: 'OK', ...await llama.startLocalServer() });
      if (route === '/api/analysis/prepare') return json(response, 200, await prepareScenario(payload.question, payload.context || payload.input || {}));
      if (route === '/api/coach/enrich') {
        const ticket = coachTickets.get(String(payload.ticket || ''));
        if (!ticket || ticket.expires <= Date.now() || ticket.owner !== auth.user.id) return json(response, 410, { status: 'ERROR', reason: 'This explanation expired. Ask again.' });
        const current = () => !ticket.sessionId || (sessions.get(ticket.sessionId)?.events.length === ticket.revision && ownerMatches(auth, ticket.sessionId));
        if (!current()) return json(response, 409, { status: 'ERROR', reason: 'The hand changed. Ask about the current decision.' });
        coachTickets.delete(String(payload.ticket));
        const controller = new AbortController();
        const cancel = () => { if (!response.writableEnded) controller.abort(); };
        response.once('close', cancel);
        try {
          const answer = await enrichCoachAnswer(ticket.context, ticket.question, process.env, ticket.similarCases, { signal: controller.signal });
          if (!current()) return json(response, 409, { status: 'ERROR', reason: 'The hand changed while explaining it.' });
          return json(response, 200, { status: 'OK', answer, context: ticket.context, analysisId: ticket.context.analysisId || null });
        } finally { response.removeListener('close', cancel); }
      }
      if (route === '/api/analysis/doubt') {
        const analysis = await analyzeManual({ ...payload.input, analysisPhase: 'FINAL' }, response, auth.user.id);
        if (analysis.status !== 'OK') return json(response, 200, analysis);
        const context = snapshotForCoach(analysis);
        if (analysis.observedState) { context.observedState = analysis.observedState; context.observedSource = analysis.observedSource; }
        const question = String(payload.question || 'Explain this hand.').slice(0, 500);
        const historyPath = userStoragePath(auth, 'training-events.jsonl');
        const recentPage = await readEventPage({filePath:historyPath,limit:100,types:['DECISION'],maxScannedBytes:1048576});
        const similarCases = similarDecisions(recentPage.events, context).map(item=>({...item,retrievalScope:'UP_TO_100_RECENT_DECISIONS_WITHIN_1MIB',scanLimited:recentPage.scanLimited===true}));
        const local = payload.responseMode === 'LOCAL_FIRST' ? localFirstAnswer(context, question, similarCases, auth) : null;
        const answer = local?.answer || await answerDoubt(context, question, process.env, similarCases);
        if (response.destroyed) return;
        appendEvent({ type: 'DOUBT', source: 'MANUAL_ANALYSIS', street: context.street, question, context,
          answer: answer.answer, provider: answer.provider, model: answer.model || null, similarCases }, historyPath);
        return json(response, 200, { status: 'OK', answer, context, similarCases, enrichment: local?.enrichment || null });
      }
      if (route === '/api/workspace') return json(response, 200, { status: 'OK', ...saveWorkspace(payload.workspace, payload.expectedRevision, userStoragePath(auth, 'workspace.json')) });
      if (route === '/api/analyze') return json(response, 200, await analyzeManual(payload, response, auth.user.id));
      if (route === '/api/equity') return json(response, 200, await analyzeInWorker.equity(prepareOpponentOverrides(buildInput(payload)), response));
      if (route === '/api/multiway/start') return json(response, 200, multiway.start(payload.config));
      if (route === '/api/multiway/state') return json(response, 200, multiway.envelope(payload.multiway));
      if (route === '/api/multiway/step') return json(response, 200, multiway.step(payload.multiway, payload.event, payload.expectedRevision));
      if (route === '/api/training/start') {
        const session = createSession(payload);
        if (sessions.size >= 100) {
          const oldest = sessions.keys().next().value;
          sessions.delete(oldest); sessionOwners.delete(oldest);
        }
        sessions.set(session.id, session);
        sessionOwners.set(session.id, auth.user.id);
        return json(response, 200, { status: 'OK', session: publicSession(session) });
      }
      if (route === '/api/training/act' || route === '/api/training/doubt' || route === '/api/training/review') {
        const session = sessions.get(String(payload.sessionId || ''));
        if (!session || !ownerMatches(auth, payload.sessionId)) return json(response, 404, { status: 'ERROR', reason: 'Session not found. Start a new training hand.' });
        if (route === '/api/training/review') {
          return json(response, 200, { status: 'OK', session: publicSession(session), decisions: session.decisions });
        }
        if (session.finished) return json(response, 400, { status: 'ERROR', reason: 'This hand has ended. Start another hand.' });
        if (route === '/api/training/doubt' && session.mode === 'CHALLENGE') {
          return json(response, 200, { status: 'LOCKED', reason: 'In challenge mode, the explanation appears after your decision.' });
        }
        if (payload.revision !== undefined && (!Number.isInteger(payload.revision) || payload.revision !== session.events.length)) {
          return json(response, 409, { status: 'ERROR', reason: 'The hand changed. Refresh the decision before acting.', session: publicSession(session) });
        }
        if (sessionBusy.has(session)) return json(response, 409, { status: 'ERROR', reason: 'This decision is already being analyzed. Wait for the result.' });
        sessionBusy.add(session);
        try {
          const isAction = route === '/api/training/act';
          const chosenAction = isAction ? String(payload.action || '').toUpperCase() : null;
          if (isAction) validateChoice(session, chosenAction, payload.size);
          const evaluated = await evaluateSession(session, { size: payload.size, response });
          const { analysis, cacheHit } = evaluated;
          if (response.destroyed) return;
          if (sessions.get(session.id) !== session) return json(response, 409, { status: 'ERROR', reason: 'The session changed during analysis. Open the current training hand.' });
          const quality = isAction ? decisionQuality(analysis, chosenAction, payload.size) : null;
          if (quality) analysis.trainingEvaluation.chosenOptionId = quality.chosenOptionId || null;
          const snapshot = snapshotForCoach(analysis, session);
          snapshot.trainingEvaluation = analysis.trainingEvaluation;
          snapshot.evaluationPerformance = { ...analysis.performance, cacheHit };
          if (!isAction) {
            const question = String(payload.question || 'Why this action?').slice(0, 500);
            const historyPath = userStoragePath(auth, 'training-events.jsonl');
            const recentPage = await readEventPage({filePath:historyPath,limit:100,types:['DECISION'],maxScannedBytes:1048576});
            const similarCases = similarDecisions(recentPage.events, snapshot).map(item=>({...item,retrievalScope:'UP_TO_100_RECENT_DECISIONS_WITHIN_1MIB',scanLimited:recentPage.scanLimited===true}));
            const local = payload.responseMode === 'LOCAL_FIRST' ? localFirstAnswer(snapshot, question, similarCases, auth, session) : null;
            const answer = local?.answer || await answerDoubt(snapshot, question, process.env, similarCases);
            if (response.destroyed) return;
            appendEvent({ type: 'DOUBT', sessionId: session.id, street: snapshot.street, revision: session.events.length, question,
              context: snapshot, answer: answer.answer, summary: answer.summary, provider: answer.provider, model: answer.model || null, similarCases }, historyPath);
            return json(response, 200, { status: 'OK', answer, context: snapshot, similarCases, enrichment: local?.enrichment || null });
          }
          // Commit a complete successor only after the evaluation succeeds.
          // Hidden future cards remain exclusively inside the game simulator.
          const nextSession = structuredClone(session);
          applyAction(nextSession, chosenAction, payload.size);
          const chosenSize = ['BET', 'RAISE'].includes(chosenAction) ? Number(payload.size) : null;
          const summary = coachSummary(snapshot);
          const event = { type: 'DECISION', sessionId: session.id, street: session.street, revision: session.events.length,
            context: snapshot, chosenAction, chosenSize, chosenOptionId: quality.chosenOptionId || null,
            recommendedAction: snapshot.recommendation, recommendedSize: quality.recommendedSize ?? null, summary,
            quality: quality.label, evLoss: quality.evLoss, qualityDetails: quality,
            engineVersion: analysis.contractVersion || null, engineBuild: analysis.engineBuild || null, rangeSource: snapshot.rangeSource,
            rangeVersion: snapshot.ranges[0]?.version || null, source: 'TRAINING_POLICY_ROLLOUT', opponentPolicyVersion: session.policyVersion };
          nextSession.decisions.push(event);
          const events = [event];
          if (nextSession.finished) events.push({ type: 'HAND_COMPLETE', sessionId: session.id,
            opponentStyle: nextSession.opponentStyle, policyVersion: nextSession.policyVersion, opponentActions: nextSession.history.filter((item) => item.actor === 'OPPONENT'), outcome: nextSession.outcome });
          appendEvents(events, userStoragePath(auth, 'training-events.jsonl'));
          sessions.set(session.id, nextSession);
          return json(response, 200, { status: 'OK', session: publicSession(nextSession), feedback: {
            chosenAction, chosenSize, chosenOptionId: quality.chosenOptionId || null,
            recommendedAction: snapshot.recommendation, recommendedSize: quality.recommendedSize ?? null, quality, summary,
            note: 'Comparison of tested sizes under the exercise policies; no external optimal-strategy reference.',
            context: snapshot
          } });
        } finally { sessionBusy.delete(session); }
      }
      if (route === '/api/import') {
        const historyPath = userStoragePath(auth, 'training-events.jsonl');
        const existingIds = new Set(readEvents(historyPath).filter((item) => item.type === 'IMPORT').map((item) => item.hand.id));
        const imported = importHands(payload.hands, payload.metadata, existingIds);
        imported.accepted.forEach((hand) => appendEvent({ type: 'IMPORT', hand }, historyPath));
        return json(response, 200, { status: 'OK', accepted: imported.accepted.length, rejected: imported.rejected,
          note: 'Importação canônica JSON; nenhuma mão importada vira rótulo de ação ótima automaticamente.' });
      }
      return json(response, 404, { status: 'ERROR', reason: 'Endpoint não encontrado.' });
    } catch (error) {
      return json(response, error.statusCode || 400, { status: 'ERROR', reason: error.message });
    }
  }
  if (request.method === 'GET' && route === '/api/training/history') {
    const controller=new AbortController(),cancel=()=>{if(!response.writableEnded)controller.abort();};
    response.once('close',cancel);
    try {
      const overview=await historyOverview(userStoragePath(auth,'training-events.jsonl'),{signal:controller.signal,recentLimit:20,timelineLimit:1000});
      return json(response,200,{status:'OK',...overview});
    } catch(error){return json(response,error.statusCode||500,{status:'ERROR',reason:`History unavailable: ${error.message}`});}
    finally{response.removeListener('close',cancel);}
  }
  if (request.method === 'GET') return serveStatic(request, response);
  response.writeHead(405); response.end('Method not allowed');
});

if (require.main === module) server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `A porta ${port} já está em uso. Feche a outra instância ou configure THEIBS_PORT.` : error.message);
  process.exitCode = 1;
});
if (require.main === module) {
  try {
    const runtime = validateDeployment();
    if (runtime.origin) process.env.THEIBS_PUBLIC_ORIGIN = runtime.origin;
    server.listen(runtime.port, runtime.host, () => {
      console.log(`THEIBS disponível em ${runtime.origin || `http://127.0.0.1:${runtime.port}`}`);
    });
  } catch (error) {
    console.error(`THEIBS startup blocked: ${error.message}`);
    process.exitCode = 1;
  }
}

server.on('close',()=>{manualCache.clear();coachTickets.clear();closeHistoryService().catch(()=>{});});
module.exports = { server, buildInput, userStoragePath };
