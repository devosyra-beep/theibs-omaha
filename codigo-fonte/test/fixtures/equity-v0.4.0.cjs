const { makeDeck, normalizeCards, removeCards, combinations } = require('../../src/cards');
const { evaluateOmaha, compareHands } = require('../../src/evaluator');
const { holeCount } = require('../../src/variants');
const { normalizeRanges, serializeRange } = require('../../src/range-engine');

class Lcg {
  constructor(seed = 123456789) { this.state = Number(seed) >>> 0; }
  next() {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  pick(items) { return items[Math.floor(this.next() * items.length)]; }
}

function normalizedOpponentHands(opponentHands, count = 5) {
  if (!Array.isArray(opponentHands) || opponentHands.length === 0) throw new Error('opponentHands must contain at least one hand.');
  return opponentHands.map((hand) => {
    const normalized = normalizeCards(hand, 'opponent hand');
    if (normalized.length !== count) throw new Error(`Each PLO${count} opponent hand must contain ${count} cards.`);
    return normalized;
  });
}

function compareShowdown(hero, opponents, board) {
  const heroHand = evaluateOmaha(hero, board);
  const opponentHands = opponents.map((opponent) => evaluateOmaha(opponent, board));
  const all = [heroHand, ...opponentHands];
  const best = all.reduce((current, hand) => !current || compareHands(hand, current) > 0 ? hand : current, null);
  const winners = all.filter((hand) => compareHands(hand, best) === 0);
  const heroWon = compareHands(heroHand, best) === 0;
  return { heroWon, tie: heroWon && winners.length > 1, share: heroWon ? 1 / winners.length : 0 };
}

function exactEquity(input) {
  const hero = normalizeCards(input.heroCards, 'hero cards');
  const board = normalizeCards(input.board || [], 'board');
  const opponents = normalizedOpponentHands(input.opponentHands, holeCount(input.variant));
  const known = normalizeCards([...hero, ...opponents.flat(), ...board], 'all known cards');
  if (hero.length !== holeCount(input.variant)) throw new Error('Hero card count does not match variant.');
  const remaining = removeCards(makeDeck(), known);
  const need = 5 - board.length;
  if (need < 0 || need > remaining.length) throw new Error('Invalid board or card state.');
  const runouts = combinations(remaining, need);
  let wins = 0;
  let ties = 0;
  let equitySum = 0;
  for (const runout of runouts) {
    const result = compareShowdown(hero, opponents, [...board, ...runout]);
    if (result.heroWon) wins += 1;
    if (result.tie) ties += 1;
    equitySum += result.share;
  }
  return {
    method: 'EXACT',
    samples: runouts.length,
    seed: null,
    winRate: wins / runouts.length,
    tieRate: ties / runouts.length,
    equity: equitySum / runouts.length,
    confidenceInterval95: null,
    opponents: opponents.length
  };
}

function sampleRangeHands(range, blocked, rng) {
  const valid = range.hands.map((hand, index) => ({ hand, weight: range.normalizedWeights[index] }))
    .filter(({ hand, weight }) => {
      const codes = hand.map((card) => card.code);
      return weight > 0 && codes.every((code) => !blocked.has(code));
    });
  if (valid.length === 0) throw new Error('No valid opponent range hand remains after blockers.');
  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
  let target = rng.next() * totalWeight;
  for (const item of valid) {
    target -= item.weight;
    if (target <= 0) return item.hand;
  }
  return valid[valid.length - 1].hand;
}

function monteCarloEquity(input) {
  const hero = normalizeCards(input.heroCards, 'hero cards');
  const board = normalizeCards(input.board || [], 'board');
  normalizeCards([...hero, ...board], 'hero and board');
  if (hero.length !== holeCount(input.variant)) throw new Error('Hero card count does not match variant.');
  const ranges = normalizeRanges(input.opponentRanges, holeCount(input.variant));
  const samples = Number(input.samples ?? 5000);
  if (!Number.isInteger(samples) || samples < 1 || samples > 50000) throw new Error('samples must be an integer between 1 and 50000.');
  if (![0, 3, 4, 5].includes(board.length)) throw new Error('Invalid board length.');
  if (52 - hero.length - ranges.length * holeCount(input.variant) < 5) throw new Error('Too many opponents for this deck.');
  const seed = Number(input.seed ?? 123456789);
  const rng = new Lcg(seed);
  const deck = makeDeck();
  let wins = 0;
  let ties = 0;
  let equitySum = 0;
  let equitySquareSum = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const blockedCards = [...hero, ...board];
    const opponents = [];
    const blocked = new Set(blockedCards.map((card) => card.code));
    const explicit = ranges.filter(range=>range.kind!=='UNIFORM');
    let accepted=false;
    // Independent weighted draws with collision rejection preserve the joint
    // distribution. Drawing unknown hands first could consume known cards.
    for(let attempt=0;attempt<2000&&!accepted;attempt++) {
      const hands=explicit.map(range=>sampleRangeHands(range,blocked,rng));
      const codes=hands.flat().map(c=>c.code);
      if(new Set(codes).size===codes.length) {opponents.push(...hands);codes.forEach(c=>blocked.add(c));accepted=true;}
    }
    if(!accepted) throw Error('Ranges incompatíveis entre si; nenhum sorteio conjunto válido foi encontrado.');
    const remaining = deck.filter(card=>!blocked.has(card.code));
    const draw = () => remaining.splice(Math.floor(rng.next()*remaining.length),1)[0];
    for(const range of ranges.filter(range=>range.kind==='UNIFORM')) opponents.push(Array.from({length:holeCount(input.variant)},draw));
    const need = 5 - board.length;
    const runout = [];
    for (let index = 0; index < need; index += 1) {
      runout.push(draw());
    }
    const result = compareShowdown(hero, opponents, [...board, ...runout]);
    if (result.heroWon) wins += 1;
    if (result.tie) ties += 1;
    equitySum += result.share;
    equitySquareSum += result.share * result.share;
  }
  const estimate = equitySum / samples;
  const variance = Math.max(0, equitySquareSum / samples - estimate * estimate);
  const margin = 1.96 * Math.sqrt(variance / samples);
  return {
    method: 'MONTE_CARLO',
    samples,
    seed,
    winRate: wins / samples,
    tieRate: ties / samples,
    equity: estimate,
    confidenceInterval95: [Math.max(0, estimate - margin), Math.min(1, estimate + margin)],
    opponents: ranges.length,
    ranges: ranges.map(serializeRange)
  };
}

function calculateEquity(input) {
  if (Array.isArray(input.opponentHands) && input.opponentHands.length > 0) {
    const boardLength = Array.isArray(input.board) ? input.board.length : 0;
    // Pré-flop has too many exact runouts for a responsive live workflow.
    if (boardLength < 3) {
      return monteCarloEquity({
        ...input,
        opponentRanges: input.opponentHands.map((hand) => ({ hands: [hand] })),
        samples: input.samples ?? 5000
      });
    }
    return exactEquity(input);
  }
  if (Array.isArray(input.opponentRanges) && input.opponentRanges.length > 0) return monteCarloEquity(input);
  throw new Error('Provide opponentHands or opponentRanges; equity without an assumption is not valid.');
}

module.exports = { calculateEquity, exactEquity, monteCarloEquity, Lcg };
