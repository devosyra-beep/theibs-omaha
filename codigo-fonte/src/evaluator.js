const { normalizeCards, combinations } = require('./cards');

const CATEGORY_NAMES = [
  'HIGH_CARD',
  'PAIR',
  'TWO_PAIR',
  'THREE_OF_A_KIND',
  'STRAIGHT',
  'FLUSH',
  'FULL_HOUSE',
  'FOUR_OF_A_KIND',
  'STRAIGHT_FLUSH'
];

function compareScores(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] || 0;
    const b = right[index] || 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

function straightHigh(values) {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let index = 0; index <= unique.length - 5; index += 1) {
    const window = unique.slice(index, index + 5);
    if (window[0] - window[4] === 4 && new Set(window).size === 5) return window[0];
  }
  return null;
}

function evaluateFive(input) {
  const cards = normalizeCards(input, 'five-card hand');
  if (cards.length !== 5) throw new Error('A five-card hand must contain exactly five cards.');
  const values = cards.map((card) => card.value);
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straight = straightHigh(values);
  let score;
  if (flush && straight) score = [8, straight];
  else if (groups[0][1] === 4) score = [7, groups[0][0], groups[1][0]];
  else if (groups[0][1] === 3 && groups[1][1] === 2) score = [6, groups[0][0], groups[1][0]];
  else if (flush) score = [5, ...values.sort((a, b) => b - a)];
  else if (straight) score = [4, straight];
  else if (groups[0][1] === 3) score = [3, groups[0][0], ...groups.slice(1).map((group) => group[0]).sort((a, b) => b - a)];
  else if (groups[0][1] === 2 && groups[1][1] === 2) score = [2, Math.max(groups[0][0], groups[1][0]), Math.min(groups[0][0], groups[1][0]), groups[2][0]];
  else if (groups[0][1] === 2) score = [1, groups[0][0], ...groups.slice(1).map((group) => group[0]).sort((a, b) => b - a)];
  else score = [0, ...values.sort((a, b) => b - a)];
  return {
    category: CATEGORY_NAMES[score[0]],
    categoryRank: score[0],
    score,
    cards: cards.map((card) => card.code)
  };
}

function evaluateOmaha(inputHero, inputBoard) {
  const hero = normalizeCards(inputHero, 'hero cards');
  const board = normalizeCards(inputBoard, 'board');
  if (![4, 5, 6].includes(hero.length)) throw new Error('Omaha requires four, five or six hero cards.');
  normalizeCards([...hero, ...board], 'all known cards');
  if (board.length !== 5) throw new Error('A final Omaha hand requires exactly five board cards.');
  let best = null;
  for (const holePair of combinations(hero, 2)) {
    for (const boardTriple of combinations(board, 3)) {
      const evaluated = evaluateFive([...holePair, ...boardTriple]);
      const candidate = {
        ...evaluated,
        usedHeroCards: holePair.map((card) => card.code),
        usedBoardCards: boardTriple.map((card) => card.code)
      };
      if (!best || compareScores(candidate.score, best.score) > 0) best = candidate;
    }
  }
  return best;
}

function compareHands(left, right) {
  return compareScores(left.score, right.score);
}

module.exports = { CATEGORY_NAMES, compareScores, compareHands, evaluateFive, evaluateOmaha };
