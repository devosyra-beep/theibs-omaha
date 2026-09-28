'use strict';
// Read-only projection of one engine result. No simulation, behavioral
// assumptions, invented scores or action recommendations belong here.
function statisticalSummary(data) {
  const q = data.equity;
  if (data.status !== 'OK' || !Number.isFinite(q?.equity)) return null;
  const ranges = data.ranges || [];
  const random = ranges.filter(range => range.kind === 'UNIFORM').length;
  const manual = q.opponents - random;
  const bounds = q.method === 'EXACT' ? [q.equity, q.equity] : q.confidenceInterval95 || null;
  return {
    schemaVersion:1,
    stage: data.analysisStage === 'PROVISIONAL' ? 'PROVISIONAL' : 'FINAL',
    model: {
      kind: manual === 0 ? 'UNIFORM_LEGAL_HANDS' : random > 0 ? 'MIXED_EXPLICIT_AND_UNIFORM' : 'MANUAL_CARDS',
      statement: manual === 0 ? 'Modelo: adversários com cartas aleatórias.' : `Modelo: ${manual} adversário(s) com cartas/ranges manuais; ${random} com cartas aleatórias.`,
      activeOpponents:q.opponents, randomOpponents:random, manualOpponents:manual,
      modelUncertainty:'NOT_QUANTIFIED',
      modelWarning:'O intervalo amostral não mede se adversários reais seguem este modelo.'
    },
    equity: { share:q.equity, includesSplitPots:true, method:q.method, samples:q.samples, bounds,
      intervalMethod:q.intervalMethod || (q.method === 'EXACT' ? 'EXACT_ENUMERATION' : null),
      precisionScope:q.method === 'EXACT' ? 'EXACT_WITHIN_MODEL' : 'SAMPLING_ONLY',
      stopReason:q.stopReason || (q.method === 'EXACT' ? 'ENUMERATION_COMPLETE' : 'SAMPLE_LIMIT') },
    outcomes: { outrightWin:q.outrightWinRate ?? null, tie:q.tieRate ?? null, loss:q.lossRate ?? null,
      note:'Equity é a participação média no pote; um empate não é uma vitória integral.' },
    reference: { share:1/(q.opponents+1), scope:'SYMMETRIC_SHARE_REFERENCE_ONLY',
      note:'Referência simétrica, não um limiar para pagar, uma nota da mão ou uma promessa de lucro.' },
    hand: data.handInsights || null
  };
}
module.exports = { statisticalSummary };
