const { performance } = require('node:perf_hooks');
const { createSession, trainingInput } = require('../src/training-simulator');
const { decide } = require('../src/decision-engine');
const { snapshotForCoach, answerDoubt } = require('../src/coach');

function percentile(sorted, fraction) {
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

async function main() {
  const decisionMs = [];
  const coachMs = [];
  for (let index = 0; index < 20; index += 1) {
    const session = createSession({ seed: 100 + index, opponentStyle: 'MIXED' });
    const started = performance.now();
    const decision = decide(trainingInput(session));
    decisionMs.push(performance.now() - started);
    if (decision.status !== 'OK') throw new Error(`NO_DECISION no caso ${index}: ${decision.reason}`);
    const snapshot = snapshotForCoach(decision, session);
    const coachStarted = performance.now();
    const reply = await answerDoubt(snapshot, 'Por que esta ação?', { THEIBS_LLM_PROVIDER: 'none' });
    coachMs.push(performance.now() - coachStarted);
    if (!reply.answer) throw new Error(`Treinador sem resposta no caso ${index}.`);
  }
  const summarize = (samples) => {
    const sorted = [...samples].sort((a, b) => a - b);
    return { count: sorted.length, p50Ms: Number(percentile(sorted, 0.5).toFixed(1)), p95Ms: Number(percentile(sorted, 0.95).toFixed(1)), maxMs: Number(sorted.at(-1).toFixed(1)) };
  };
  console.log(JSON.stringify({ environment: 'LOCAL_NODE_DIRECT', street: 'PREFLOP', samplesPerDecision: 300,
    decision: summarize(decisionMs), coachFallback: summarize(coachMs),
    note: 'Sem rede, HTTP, Llama ou referência de solver; inclui criação do contrato/range na decisão.' }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
