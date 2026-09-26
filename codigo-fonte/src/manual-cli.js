const readline = require('node:readline');
const { decide } = require('./decision-engine');
const { appendHandRecord } = require('./history');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

function parseList(value) { return value.split(/[ ,]+/).map((item) => item.trim()).filter(Boolean); }
function parseNumber(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function parseRange(value) { return value.split('|').map((hand) => parseList(hand)).filter((hand) => hand.length > 0); }

async function main() {
  console.log('PLO5 manual — informe cartas no formato As Ks Qh Jh Tc.');
  const heroCards = parseList(await ask('Cartas fechadas (5): '));
  const board = parseList(await ask('Board (0, 3, 4 ou 5): '));
  const opponentText = await ask('Mão conhecida ou range (separe mãos por |; vazio = sem premissa): ');
  const position = await ask('Posição: ');
  const players = parseNumber(await ask('Número de jogadores: '));
  const potBeforeAction = parseNumber(await ask('Pote antes da decisão: '));
  const amountToCall = parseNumber(await ask('Valor para pagar: '));
  const effectiveStack = parseNumber(await ask('Stack efetivo: '));
  const input = {
    variant: 'PLO5_HIGH', heroCards, board, position, players,
    potBeforeAction, amountToCall, effectiveStack,
    availableActions: amountToCall > 0 ? ['FOLD', 'CALL', 'RAISE'] : ['CHECK', 'BET']
  };
  if (opponentText.trim()) {
    const hands = parseRange(opponentText);
    if (hands.length === 1) input.opponentHands = hands;
    else input.opponentRanges = [{ hands }];
  }
  else {
    console.log('Sem range explícito: o motor não inventará uma equity.');
    const result = decide(input);
    console.log(JSON.stringify(result, null, 2));
    appendHandRecord({ input, result, decisionQuality: 'NÃO EXECUTADO' });
    rl.close();
    return;
  }
  const result = decide(input);
  console.log(JSON.stringify(result, null, 2));
  const save = await ask('Registrar no HISTORICO_MAOS.md? (s/N): ');
  if (/^s(im)?$/i.test(save.trim())) {
    const playerDecision = await ask('Decisão tomada pelo jogador: ');
    const handResult = await ask('Resultado da mão: ');
    const decisionQuality = await ask('Qualidade (PASS/FAIL/REVISAR/NÃO EXECUTADO): ');
    appendHandRecord({ input, result, playerDecision, handResult, decisionQuality });
    console.log('Mão registrada no histórico.');
  }
  rl.close();
}

main().catch((error) => { console.error(error.message); rl.close(); process.exitCode = 1; });
