const fs = require('node:fs');
const path = require('node:path');

function appendHandRecord(record, outputPath = path.join(__dirname, '..', 'HISTORICO_MAOS.md')) {
  const input = record.input || {};
  const result = record.result || {};
  const equity = result.equity || {};
  const section = `\n### Hand ID: ${record.handId || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 15)}\n\n- Date/time: ${record.timestamp || new Date().toISOString()}\n- Environment: \`SIMULATION\`\n- Format: \`${input.variant || 'PLO5_HIGH'}\`\n- Number of players: ${input.players ?? ''}\n- Position: ${input.position || ''}\n- Blinds/antes: ${JSON.stringify(input.blinds || {})}\n- Effective stack: ${input.effectiveStack ?? ''}\n- Player cards: ${JSON.stringify(input.heroCards || [])}\n- Observed preflop action: ${JSON.stringify(input.previousAction || {})}\n- Board at decision: ${JSON.stringify(input.board || [])}\n- Available actions: ${JSON.stringify(result.legalActions || [])}\n- Assistant recommendation: \`${result.recommendedAction || 'NO_DECISION'}\`\n- Rationale: ${result.reason || ''}\n- Confidence: ${result.confidence || ''}\n- Equity: ${equity.equity == null ? '' : (equity.equity * 100).toFixed(2) + '%'}\n- Method: ${equity.method || ''}\n- Samples: ${equity.samples ?? ''}\n- Seed: ${equity.seed ?? ''}\n- Player decision: ${record.playerDecision || ''}\n- Hand result: ${record.handResult || ''}\n- Decision quality: \`${record.decisionQuality || 'NOT RUN'}\`\n- Financial result: ${record.financialResult || ''}\n- Later review: ${record.review || ''}\n- Identified error or opportunity: ${record.opportunity || ''}\n`;
  fs.appendFileSync(outputPath, section, 'utf8');
  return outputPath;
}

module.exports = { appendHandRecord };
