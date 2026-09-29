'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateQuickEquity } = require('../src/quick-equity');

const cards = ['As','Kh','Qd','Jc','Ts','9h'];
for (const count of [4,5,6]) test(`equity-only PLO${count} works without a pot or call price`, () => {
  const result = calculateQuickEquity({variant:`PLO${count}_HIGH`,heroCards:cards.slice(0,count),board:[],
    players:2,unknownOpponentModel:'UNIFORM',samples:50,seed:42});
  assert.equal(result.status,'OK');
  assert.equal(result.scope,'EQUITY_ONLY');
  assert.equal(result.equity.opponents,1);
  assert.ok(result.equity.equity >= 0 && result.equity.equity <= 1);
  assert.equal(result.equity.confidenceInterval95.length,2);
  assert.deepEqual(result.warnings,[]);
  assert.match(result.assumptions.join(' '),/mãos legais equiprováveis/);
  assert.equal('ev' in result,false);
  assert.equal('recommendation' in result,false);
});

test('equity-only reports incomplete opponent coverage', () => {
  const result = calculateQuickEquity({variant:'PLO4_HIGH',heroCards:cards.slice(0,4),board:[],
    position:'BTN',players:3,effectiveStack:100,opponentHands:[['2s','3h','4d','5c']],samples:50,seed:42});
  assert.equal(result.status,'OK');
  assert.equal(result.equity.opponents,1);
  assert.match(result.warnings.join(' '),/cobertura parcial/);
});

test('adaptive quick equity exposes a wider interval when its time budget ends', () => {
  const result = calculateQuickEquity({variant:'PLO6_HIGH',heroCards:cards,board:[],
    players:5,unknownOpponentModel:'UNIFORM',samplingMode:'ADAPTIVE',
    adaptiveBudget:{timeBudgetMs:1},seed:42});
  assert.equal(result.status,'OK');
  assert.equal(result.equity.stopReason,'TIME_BUDGET');
  assert.ok(result.equity.confidenceInterval95[1]-result.equity.confidenceInterval95[0]>.02);
});
