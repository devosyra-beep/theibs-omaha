'use strict';

const { expandedRiverInput, heroKickers, opponentKickers } = require('./solver-river-growth-fixtures.cjs');

// Preserve the published first twelve hands. Additional hands use two cards
// from each seat's existing disjoint private pool, so the full Cartesian
// product is compatible with the board and the opposite seat. These are
// explicit synthetic study ranges, not inferred population ranges.
function capacityRiverInput({ combos = 24, sizings = 2, maxAggressions = 1 } = {}) {
  if (!Number.isInteger(combos) || combos < 1 || combos > 48) throw Error('QA capacity fixture needs one to 48 combinations.');
  const input = expandedRiverInput({ combos: Math.min(combos, 12), sizings: Math.max(2, sizings), maxAggressions });
  for (const range of input.ranges) {
    const kickers = range.seatId ? opponentKickers : heroKickers;
    const anchors = range.combos[0].cards.slice(0, 3);
    for (let first = 0; first < kickers.length && range.combos.length < combos; first++) {
      for (let second = first + 1; second < kickers.length && range.combos.length < combos; second++) {
        range.combos.push({ cards: [...anchors, kickers[first], kickers[second]], weight: range.combos.length + 1 });
      }
    }
  }
  if (sizings === 1) input.sizing.levels = [1];
  return input;
}

module.exports = { capacityRiverInput };
