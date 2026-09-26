'use strict';
const { createHash } = require('node:crypto');
const { replay } = require('./hand-flow');
const { legalDecision } = require('./training-simulator');
const { trainingEvaluationInput } = require('./training-evaluator');
const analyzeInWorker = require('./analysis-worker');

const cache = new WeakMap();
const MAX_SIZES_PER_STATE = 4;

// Validate against the ledger without advancing the actual hidden deal or
// mutating the session. This also rejects fractional cents and illegal all-ins.
function validateChoice(session, action, size) {
  if (!legalDecision(session).actions.includes(action)) throw Error('Ação ilegal para o estado atual.');
  const aggressive = ['BET', 'RAISE'].includes(action);
  replay(session.config, [...session.events, { type: 'ACT', actor: 0, action,
    ...(aggressive ? { to: size } : {}) }]);
}

function comparisonSize(session, supplied) {
  const legal = legalDecision(session), aggression = legal.actions.find(action => ['BET', 'RAISE'].includes(action));
  if (!aggression) return undefined;
  const size = supplied === undefined || supplied === null ? legal.minSize : supplied;
  validateChoice(session, aggression, size);
  return Number(size);
}

async function evaluateSession(session, { size, response } = {}) {
  const chosenSize = comparisonSize(session, size);
  const input = trainingEvaluationInput(session, { samples: 256, chosenSize });
  const key = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  let entries = cache.get(session);
  if (!entries) { entries = new Map(); cache.set(session, entries); }
  if (entries.has(key)) return { analysis: structuredClone(entries.get(key)), cacheHit: true, comparisonSize: chosenSize };
  const analysis = await analyzeInWorker.training(input, response);
  if (analysis?.status !== 'OK') throw Error(analysis?.reason || 'A avaliação do treino não foi concluída.');
  if (!analysis.trainingEvaluation?.candidates?.length) throw Error('A avaliação do treino não trouxe alternativas verificáveis.');
  analysis.trainingEvaluation.evaluationId = key;
  if (entries.size >= MAX_SIZES_PER_STATE) entries.delete(entries.keys().next().value);
  entries.set(key, structuredClone(analysis));
  return { analysis, cacheHit: false, comparisonSize: chosenSize };
}

module.exports = { evaluateSession, comparisonSize, validateChoice };
