const readline = require('node:readline');
const { decide } = require('./decision-engine');
const { appendHandRecord } = require('./history');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

function parseList(value) { return value.split(/[ ,]+/).map((item) => item.trim()).filter(Boolean); }
function parseNumber(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function parseRange(value) { return value.split('|').map((hand) => parseList(hand)).filter((hand) => hand.length > 0); }

async function main() {
  console.log('Manual PLO5 — enter cards in this format: As Ks Qh Jh Tc.');
  const heroCards = parseList(await ask('Hole cards (5): '));
  const board = parseList(await ask('Board (0, 3, 4, or 5): '));
  const opponentText = await ask('Known hand or range (separate hands with |; blank = no assumption): ');
  const position = await ask('Position: ');
  const players = parseNumber(await ask('Number of players: '));
  const potBeforeAction = parseNumber(await ask('Pot before the decision: '));
  const amountToCall = parseNumber(await ask('Amount to call: '));
  const effectiveStack = parseNumber(await ask('Effective stack: '));
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
    console.log('No explicit range: the engine will not invent an equity estimate.');
    const result = decide(input);
    console.log(JSON.stringify(result, null, 2));
    appendHandRecord({ input, result, decisionQuality: 'NOT RUN' });
    rl.close();
    return;
  }
  const result = decide(input);
  console.log(JSON.stringify(result, null, 2));
  const save = await ask('Save to HISTORICO_MAOS.md? (y/N): ');
  if (/^(y(es)?|s(im)?)$/i.test(save.trim())) {
    const playerDecision = await ask('Player decision: ');
    const handResult = await ask('Hand result: ');
    const decisionQuality = await ask('Decision quality (PASS/FAIL/REVIEW/NOT RUN): ');
    appendHandRecord({ input, result, playerDecision, handResult, decisionQuality });
    console.log('Hand saved to history.');
  }
  rl.close();
}

main().catch((error) => { console.error(error.message); rl.close(); process.exitCode = 1; });
