const fs = require('node:fs');
const path = require('node:path');

function appendHandRecord(record, outputPath = path.join(__dirname, '..', 'HISTORICO_MAOS.md')) {
  const input = record.input || {};
  const result = record.result || {};
  const equity = result.equity || {};
  const section = `\n### Mão ID: ${record.handId || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 15)}\n\n- Data/hora: ${record.timestamp || new Date().toISOString()}\n- Ambiente: \`SIMULAÇÃO\`\n- Formato: \`${input.variant || 'PLO5_HIGH'}\`\n- Número de jogadores: ${input.players ?? ''}\n- Posição: ${input.position || ''}\n- Blinds/antes: ${JSON.stringify(input.blinds || {})}\n- Stack efetivo: ${input.effectiveStack ?? ''}\n- Cartas do jogador: ${JSON.stringify(input.heroCards || [])}\n- Ação pré-flop observada: ${JSON.stringify(input.previousAction || {})}\n- Board no momento da decisão: ${JSON.stringify(input.board || [])}\n- Ação disponível: ${JSON.stringify(result.legalActions || [])}\n- Recomendação do assistente: \`${result.recommendedAction || 'NO_DECISION'}\`\n- Justificativa apresentada: ${result.reason || ''}\n- Confiança: ${result.confidence || ''}\n- Equity: ${equity.equity == null ? '' : (equity.equity * 100).toFixed(2) + '%'}\n- Método: ${equity.method || ''}\n- Amostras: ${equity.samples ?? ''}\n- Seed: ${equity.seed ?? ''}\n- Decisão tomada pelo jogador: ${record.playerDecision || ''}\n- Resultado da mão: ${record.handResult || ''}\n- Qualidade da decisão: \`${record.decisionQuality || 'NÃO EXECUTADO'}\`\n- Resultado financeiro: ${record.financialResult || ''}\n- Avaliação posterior: ${record.review || ''}\n- Erro ou oportunidade identificada: ${record.opportunity || ''}\n`;
  fs.appendFileSync(outputPath, section, 'utf8');
  return outputPath;
}

module.exports = { appendHandRecord };
