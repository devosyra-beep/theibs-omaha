'use strict';
const session = require('../../src/multiway-session');
const terminal = (value, constant = 0) => ({ type: 'terminal', payoffs: [value, constant - value] });
const decision = (player, informationSet, actions) => ({ type: 'decision', player, informationSet,
  actions: Object.entries(actions).map(([id, node]) => ({ id, node })) });
const chance = outcomes => ({ type: 'chance', outcomes: outcomes.map(([probability, node]) => ({ probability, node })) });
function matrixGame(matrix, id = 'independent-matrix', constant = 0) {
  return { id, playerCount: 2, root: decision(0, 'row', Object.fromEntries(matrix.map((values, row) =>
    [`R${row}`, decision(1, 'column', Object.fromEntries(values.map((value, column) => [`C${column}`, terminal(value, constant)])))]))) };
}
function kuhnGame() {
  function node(cards, history = '') {
    const winner = cards[0] > cards[1] ? 1 : -1;
    if (history === 'cc') return terminal(winner);
    if (history === 'bf') return terminal(1);
    if (history === 'cbf') return terminal(-1);
    if (history === 'bk' || history === 'cbk') return terminal(2 * winner);
    const player = history === '' || history === 'cb' ? 0 : 1;
    return decision(player, `${cards[player]}:${history || 'root'}`, history === 'b' || history === 'cb'
      ? { FOLD: node(cards, history + 'f'), CALL: node(cards, history + 'k') }
      : { CHECK: node(cards, history + 'c'), BET: node(cards, history + 'b') });
  }
  const worlds = [];
  for (let first = 0; first < 3; first++) for (let second = 0; second < 3; second++) if (first !== second) worlds.push([1 / 6, node([first, second])]);
  return { id: 'independent-lp-kuhn', playerCount: 2, root: chance(worlds) };
}
function privateTypeGame() {
  const branch = type => decision(0, `TYPE${type}`, {
    A: decision(1, 'HIDDEN', { L: terminal(type === 0 ? 1 : -1), R: terminal(type === 0 ? -1 : 1) }),
    B: decision(1, 'HIDDEN', { L: terminal(type === 0 ? 1 : -1), R: terminal(type === 0 ? -1 : 1) })
  });
  return { id: 'nonunique-conditional-private-type', playerCount: 2, root: chance([[.5, branch(0)], [.5, branch(1)]]) };
}
const act = (actor, action, to) => ({ type: 'ACT', actor, action, ...(to == null ? {} : { to }) });
const board = ['2s', '3h', '4d', '8c', '9s'];
const heroCards = ['As', 'Ah', 'Kd', 'Qc', 'Tc'];
const weak = ['Ks', 'Kh', 'Jd', 'Qh', '6c'];
const strong = ['2c', '2h', 'Qd', 'Jh', '7c'];
const range = (seatId, rows) => ({ seatId, complete: true, source: 'INDEPENDENT_LP_REFERENCE', combos: rows.map(([cards, weight]) => ({ cards, weight })) });
function riverCallInput({ fee = 0, blockers = false } = {}) {
  const initial = session.start({ variant: 'PLO5_HIGH', playerCount: 2, heroPosition: 'SB', startingStack: 100, smallBlind: .5, bigBlind: 1, heroCards });
  const events = [act(0, 'CALL'), act(1, 'CHECK'), { type: 'BOARD', cards: board.slice(0, 3) },
    act(1, 'BET', 2), act(0, 'RAISE', 6), act(1, 'CALL'), { type: 'BOARD', cards: board.slice(0, 4) },
    act(1, 'BET', 3), act(0, 'CALL'), { type: 'BOARD', cards: board }, act(1, 'BET', 10)];
  return { multiway: { ...initial.multiway, events }, ranges: [range(0, blockers ? [[heroCards, 1], [['Ks', '5s', '6s', '7h', 'Th'], 2]] : [[heroCards, 1]]),
    range(1, [[weak, .3], [strong, .7]])], sizing: { type: 'MIN_MID_MAX', maxAggressions: 0 },
    rake: fee ? { type: 'FIXED', amount: fee } : { type: 'NONE', basis: 'BEFORE_FEES' } };
}
function riverMixedInput() {
  const hand = ['As', 'Ah', 'Qd', 'Jc', 'Tc'];
  let current = session.start({ variant: 'PLO5_HIGH', playerCount: 2, heroPosition: 'SB', startingStack: 20, smallBlind: .5, bigBlind: 1, heroCards: hand });
  while (current.state.street !== 'RIVER' || current.state.actor !== current.state.heroId) current = session.step(current.multiway,
    current.state.phase === 'WAIT_BOARD' ? { type: 'BOARD', cards: board.slice(0, { FLOP: 3, TURN: 4, RIVER: 5 }[current.state.nextStreet]) }
      : act(current.state.actor, current.state.legal.toCall ? 'CALL' : 'CHECK'));
  return { multiway: current.multiway, ranges: [range(0, [[hand, 1], [['5s', '6s', 'Qd', 'Jc', 'Tc'], 1]]),
    range(1, [[['Ks', 'Kh', '6d', '7c', '8h'], 1], [['5h', '6h', 'Kd', '7c', '8h'], 1]])],
    sizing: { type: 'MIN_MID_MAX', maxAggressions: 1 }, rake: { type: 'NONE', basis: 'BEFORE_FEES' } };
}
function combinations(values, n, start = 0, prefix = []) {
  if (prefix.length === n) return [prefix];
  return values.flatMap((value, index) => index < start ? [] : combinations(values, n, index + 1, [...prefix, value]));
}
function rankFive(cards) {
  const ranks = cards.map(card => '23456789TJQKA'.indexOf(card[0]) + 2).sort((a, b) => b - a);
  const groups = [...new Set(ranks)].map(rank => [ranks.filter(value => value === rank).length, rank]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const flush = cards.every(card => card[1] === cards[0][1]);
  const unique = [...new Set(ranks)];
  const straight = unique.length === 5 && (unique[0] - unique[4] === 4 ? unique[0] : unique.join(',') === '14,5,4,3,2' ? 5 : 0);
  if (flush && straight) return [8, straight];
  if (groups[0][0] === 4) return [7, groups[0][1], groups[1][1]];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, groups[0][1], groups[1][1]];
  if (flush) return [5, ...ranks];
  if (straight) return [4, straight];
  if (groups[0][0] === 3) return [3, ...groups.map(group => group[1])];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, ...groups.map(group => group[1])];
  if (groups[0][0] === 2) return [1, ...groups.map(group => group[1])];
  return [0, ...ranks];
}
const compareRanks = (left, right) => { for (let i = 0; i < Math.max(left.length, right.length); i++) if ((left[i] || 0) !== (right[i] || 0)) return Math.sign((left[i] || 0) - (right[i] || 0)); return 0; };
function omahaRank(hand, publicCards) {
  return combinations(hand, 2).flatMap(hole => combinations(publicCards, 3).map(community => rankFive([...hole, ...community])))
    .sort(compareRanks).at(-1);
}
module.exports = { terminal, decision, chance, matrixGame, kuhnGame, privateTypeGame, riverCallInput, riverMixedInput,
  board, heroCards, weak, strong, range, omahaRank, compareRanks };
