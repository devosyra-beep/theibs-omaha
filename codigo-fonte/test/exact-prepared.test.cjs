'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { exactEquity } = require('../src/equity-engine');
const oracle = require('../scripts/lib/numeric-oracle.cjs');
const { combinations } = require('../src/cards');

test('prepared exact path preserves independent Omaha 2+3 outcomes, ties and every turn runout', () => {
  for (const count of [4, 5, 6]) for (const opponents of [1, 2]) {
    const heroCards = ['As','Ks','Qh','Jh','Td','9d'].slice(0,count);
    const opponentHands = [['Ac','Kc','Qs','Js','Tc','9c'].slice(0,count),['Ad','Kd','Qc','Jc','Th','9h'].slice(0,count)].slice(0,opponents);
    for (const board of [['2s','3h','4d','8c'],['2s','3h','4d','8c','7s']]) {
      const blocked = new Set([...heroCards,...opponentHands.flat(),...board]);
      const runouts = combinations(oracle.deck.filter(c=>!blocked.has(c)),5-board.length);
      const shares = runouts.map(r=>oracle.share(heroCards,opponentHands,[...board,...r]));
      const actual = exactEquity({variant:`PLO${count}_HIGH`,heroCards,opponentHands,board});
      assert.equal(actual.samples,runouts.length); assert.equal(actual.method,'EXACT'); assert.equal(actual.confidenceInterval95,null);
      assert.equal(actual.equity,shares.reduce((a,b)=>a+b,0)/shares.length);
      assert.equal(actual.tieRate,shares.filter(s=>s>0&&s<1).length/shares.length);
      assert.equal(actual.winRate,shares.filter(s=>s>0).length/shares.length);
    }
  }
});
