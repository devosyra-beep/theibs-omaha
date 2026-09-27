'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshotForCoach, coachSummary, answerDoubt, composeFactSelection, explanationFacts } = require('../src/coach');
const { describeHand, explainHand, explainHandDetails } = require('../src/hand-insights');

function snapshot(status = 'SEPARATED') {
  return {
    recommendation: 'CALL', legalActions: ['FOLD', 'CALL', 'RAISE'], comparisonComplete: true, missingLegalActions: [],
    amountToCall: 1, potMath: { potAfterCall: 6, potOdds: 1 / 6 }, modeledOpponentCount: 2,
    equity: { value: .5, method: 'MONTE_CARLO', samples: 500, confidenceInterval95: [.45, .55] },
    handInsights: describeHand(['As', 'Kd', 'Ks', 'Qd', 'Th', '8h']),
    leadership: { status },
    ev: {
      FOLD: { status: 'MODELED', ev: 0 },
      CALL: { status: 'MODELED', ev: 2, assumptions: ['No future bets.'] },
      RAISE: { status: 'MODELED', ev: status === 'TIED' ? 2 : 1.9, targetStreetTotal: 4, heroCost: 3, assumptions: ['Entered responses.'] }
    },
    uncertainty: 'Response frequencies were not validated.'
  };
}
const visible = summary => [summary.headline, ...summary.points].join(' ');

test('general summary keeps concrete hand, cost and EV in at most three short points', () => {
  const summary = coachSummary(snapshot());
  assert.match(summary.headline, /^Call/);
  assert.ok(summary.points.length <= 3);
  assert.ok(visible(summary).split(/\s+/).length <= 75, visible(summary));
  assert.match(visible(summary), /a pair of kings/);
  assert.match(visible(summary), /Calling costs 1 chip/);
  assert.match(visible(summary), /EV \+2\.00 chips/);
  assert.doesNotMatch(visible(summary), /MONTE_CARLO|sample interval|group\(s\)/);
  assert.match(summary.details.join(' '), /MONTE_CARLO/);
  assert.match(summary.details.join(' '), /does not prove an optimal strategy/);
});

test('incomplete comparison visibly names the missing action without claiming a best overall action', () => {
  const snap = snapshot(); snap.comparisonComplete = false; snap.missingLegalActions = ['RAISE'];
  snap.ev.RAISE = { status: 'NOT_MODELED', missingInputs: ['Raise response is missing.'] };
  const summary = coachSummary(snap);
  assert.equal(summary.headline, 'Partial comparison: still to evaluate raise');
  assert.doesNotMatch(visible(summary), /is the recommendation|best overall play|optimal/);
  assert.match(summary.details.join(' '), /Raise response is missing/);
  assert.match(coachSummary(snap, 'E aumentar?').points[0], /has not been calculated/);
});

test('ties and missing or overlapping bounds do not turn the point leader into a recommendation', () => {
  for (const status of ['TIED', 'OVERLAPPING', 'MISSING_BOUNDS', 'SINGLE_MODELED_ACTION', 'UNAVAILABLE']) {
    const summary = coachSummary(snapshot(status));
    assert.doesNotMatch(summary.headline, /^Call is the recommendation/);
    assert.match(visible(summary), /tied|No clear advantage/);
    assert.ok(visible(summary).split(/\s+/).length <= 75, status);
    if (status === 'OVERLAPPING') assert.match(visible(summary), /Return ranges overlap/);
    if (status === 'TIED') assert.match(visible(summary), /No option had higher EV/);
  }
});

test('unavailable decision does not expose stale equity or prescribe an action', () => {
  const snap = snapshot(); snap.recommendation = 'NO_DECISION';
  const summary = coachSummary(snap);
  assert.match(summary.headline, /not enough information/);
  assert.doesNotMatch(visible(summary), /EV|50\.0%|is the recommendation/);
  assert.ok(summary.points.length <= 3);
  const selected = composeFactSelection('{"factIds":["decision"]}', explanationFacts(snap), snap);
  assert.doesNotMatch(selected.answer, /EV|50\.0%|is the recommendation/);
});

test('questions about the hand do not append a generic decision or numeric disclaimers', () => {
  const snap = snapshot();
  const summary = coachSummary(snap, 'Quais pares e naipes tenho?');
  assert.equal(summary.points.length, 1);
  assert.match(summary.points[0], /a pair of kings/);
  assert.match(summary.points[0], /2 hearts and 2 diamonds/);
  assert.doesNotMatch(visible(summary), /EV|Call|Monte|confidence|stronger|strong/);
  assert.doesNotMatch(summary.details.join(' '), /EV|sample interval/);
});

test('hand wording describes triplets and suits naturally without calling three cards usable', () => {
  const facts = describeHand(['As', 'Ah', 'Ad', '2d', 'Kd', '9s']);
  const explanation = explainHand(facts, 'made');
  assert.match(explanation, /three aces/);
  assert.match(explanation, /3 diamonds/);
  assert.match(explanation, /only two hole cards/);
  assert.doesNotMatch(explanation, /made trips|cards of aces|group\(s\)/);
});

test('draw explanation keeps clean-out qualification and moves the long card list into details', () => {
  const facts = {
    made: { label: 'high card' },
    nextCard: { flushCards: ['2s', '3s'], straightCards: [], drawCards: ['2s', '3s'], drawProbability: .05,
      improvementCards: ['2s', '3s', '4s'], improvementProbability: .075, unseenCards: 40 }
  };
  const snap = snapshot(); snap.handInsights = facts;
  const summary = coachSummary(snap, 'Quais outs tenho?');
  assert.match(visible(summary), /2 available cards complete a flush/);
  assert.match(visible(summary), /5\.0%/);
  assert.match(visible(summary), /Improving does not guarantee a win/);
  assert.doesNotMatch(visible(summary), /2 of spades|Call|EV/);
  assert.match(summary.details.join(' '), /2 of spades/);
  assert.match(summary.details.join(' '), /not win chances or clean outs/);
  assert.equal(explainHandDetails(null).length, 0);
});

test('training summary preserves the chosen size, candidate EV and future-action model', () => {
  const snap = snapshot(); snap.heroContribution = 1;
  snap.trainingEvaluation = {
    model: 'POLICY_ROLLOUT', recommendedOptionId: 'RAISE:4.00', chosenOptionId: 'RAISE:6.00', leadership: { status: 'SEPARATED' },
    candidates: [
      { optionId: 'RAISE:4.00', action: 'RAISE', size: 4, ev: 5, confidenceInterval95: [4, 6], samples: 500 },
      { optionId: 'RAISE:6.00', action: 'RAISE', size: 6, ev: 1, confidenceInterval95: [0, 2], samples: 500 },
      { optionId: 'CALL', action: 'CALL', size: null, ev: 0, confidenceInterval95: [-1, 1], samples: 500 }
    ]
  };
  snap.recommendation = 'RAISE';
  for (const item of Object.values(snap.ev)) item.assumptions = [];
  const summary = coachSummary(snap);
  assert.equal(summary.headline, 'Raise to 4 had the highest return in this exercise');
  assert.match(visible(summary), /Your choice: Raise to 6 \(5 more now\): EV \+1\.00/);
  assert.match(visible(summary), /Highest calculated return: Raise to 4 \(3 more now\): EV \+5\.00/);
  assert.doesNotMatch(visible(summary), /break-even equity/i);
  assert.doesNotMatch(summary.details.join(' '), /no future bets/i);
  assert.match(summary.details.join(' '), /through the end of the hand/);
  assert.match(summary.details.join(' '), /additional cost now: 5/);
  assert.match(coachSummary(snap, 'Por que meu aumento?').points[0], /Your size: Raise to 6 \(5 more now\): EV \+1\.00/);
  snap.trainingEvaluation.leadership.status = 'OVERLAPPING';
  assert.match(coachSummary(snap).headline, /No clear advantage/);
});

test('snapshot copies only public candidate metadata and preserves the evaluation identity', () => {
  const d = { status: 'OK', recommendedAction: 'CALL', legalActions: ['CALL'], ev: { actions: { CALL: { status: 'MODELED', ev: 1 } } },
    trainingEvaluation: { model: 'POLICY_ROLLOUT', evaluationId: 'evaluation-42', recommendedOptionId: 'CALL', chosenOptionId: 'CALL',
      candidates: [{ optionId: 'CALL', action: 'CALL', size: null, ev: 1, samples: 500, hiddenHand: ['As', 'Ks'] }] } };
  const snap = snapshotForCoach(d, { heroContribution: 1 });
  assert.equal(snap.trainingEvaluation.evaluationId, 'evaluation-42');
  assert.equal(snap.heroContribution, 1);
  assert.equal(snap.trainingEvaluation.candidates[0].hiddenHand, undefined);
});

test('fallback and canonical Llama selections share the structured response without accepting free text', async () => {
  const snap = snapshot(), reply = await answerDoubt(snap, 'Qual mão tenho?', {});
  assert.deepEqual(reply.summary, coachSummary(snap, 'Qual mão tenho?'));
  assert.equal(reply.answer, [reply.summary.headline, ...reply.summary.points].join('\n'));
  assert.doesNotMatch(reply.answer, /MONTE_CARLO/);
  const facts = explanationFacts(snap);
  const selected = composeFactSelection('{"factIds":["made"]}', facts, snap, 'Qual mão tenho?');
  assert.deepEqual(selected.summary.points, [facts.made]);
  assert.throws(() => composeFactSelection('{"factIds":["made"],"answer":"Lucro garantido"}', facts, snap));
});

test('how-to-play questions always include both the hand and decision even if Llama selects only one fact', () => {
  const snap = snapshot(), facts = explanationFacts(snap);
  for (const question of ['Como jogar esta mão?', 'O que fazer com minha mão?', 'Qual a melhor jogada?']) {
    for (const summary of [coachSummary(snap, question), composeFactSelection('{"factIds":["made"]}', facts, snap, question).summary]) {
      assert.match(summary.points.join(' '), /a pair of kings/);
      assert.match(summary.points.join(' '), /Call: EV \+2\.00/);
      assert.ok(summary.points.length <= 3);
    }
  }
  assert.doesNotMatch(visible(coachSummary(snap, 'Que mão tenho?')), /EV|Call/);
});

test('valid canonical IDs for an unrelated subject are rejected for a specific question', () => {
  const snap = snapshot(), facts = explanationFacts(snap);
  for (const [question, selections] of [
    ['Quais draws tenho?', ['["ev_raise"]', '["draws","ev_call"]']],
    ['Qual minha equity?', ['["made"]', '["limitations"]']],
    ['Quais pares tenho?', ['["made","decision"]']]
  ]) for (const ids of selections) assert.throws(() => composeFactSelection('{"factIds":' + ids + '}', facts, snap, question), /outside the question topic/);
  assert.doesNotThrow(() => composeFactSelection('{"factIds":["equity","limitations"]}', facts, snap, 'Qual minha equity?'));
});

test('an action question explains the sign of expected profit without promising a result', () => {
  const snap = snapshot();
  assert.match(visible(coachSummary(snap, 'E o aumento?')), /average profit.*does not guarantee winning/);
  snap.ev.RAISE.ev = -.29;
  assert.match(visible(coachSummary(snap, 'E o aumento?')), /EV -0\.29/);
  assert.match(visible(coachSummary(snap, 'E o aumento?')), /average loss/);
  assert.match(visible(coachSummary(snap, 'O que significa desistir?')), /Zero is break-even from this decision/);
});

test('general decision keeps a calculated raise visible when call or fold has the greatest EV', () => {
  for (const leader of ['CALL', 'FOLD']) {
    const snap = snapshot('OVERLAPPING'); snap.recommendation = leader;
    snap.ev.CALL.ev = leader === 'CALL' ? 1 : -.2; snap.ev.RAISE.ev = -2;
    const summary = coachSummary(snap, 'Como jogar esta mão?');
    assert.match(visible(summary), /Raise to 4.*EV -2\.00/);
    assert.match(visible(summary), /Return ranges overlap/);
    assert.ok(summary.points.length <= 3);
    assert.ok(visible(summary).split(/\s+/).length <= 85);
    const selected = composeFactSelection('{"factIds":["made"]}', explanationFacts(snap), snap, 'Como jogar esta mão?');
    assert.match(selected.answer, /Raise to 4.*EV -2\.00/);
  }
});

test('training shows the best tested aggression or the chosen aggression alongside a passive point leader', () => {
  for (const leader of ['CALL', 'FOLD']) for (const chosenOptionId of [null, 'CALL', 'FOLD', 'RAISE:6.00']) {
    const snap = snapshot('OVERLAPPING'); snap.heroContribution = 1; snap.recommendation = leader;
    snap.trainingEvaluation = { recommendedOptionId: leader, chosenOptionId, leadership: { status: 'OVERLAPPING' }, candidates: [
      { optionId: 'CALL', action: 'CALL', size: null, ev: leader === 'CALL' ? 1 : -.2 },
      { optionId: 'FOLD', action: 'FOLD', size: null, ev: 0 },
      { optionId: 'RAISE:4.00', action: 'RAISE', size: 4, ev: -2 },
      { optionId: 'RAISE:6.00', action: 'RAISE', size: 6, ev: -5 }
    ] };
    const summary = coachSummary(snap, 'Como jogar esta mão?'), text = visible(summary);
    assert.match(text, chosenOptionId === 'RAISE:6.00' ? /Raise to 6.*EV -5\.00/ : /Raise to 4.*EV -2\.00/);
    if (chosenOptionId && chosenOptionId !== leader) assert.match(text, /Your choice:/);
    assert.match(text, /Return ranges overlap/);
    assert.ok(summary.points.length <= 3);
    assert.ok(text.split(/\s+/).length <= 85, text);
  }
});

test('shared action premises appear once while action-specific premises and missing inputs survive', () => {
  const snap = snapshot();
  const common = ['Uniform range in the current state.', 'Continuation by fixed policy.', 'Future bets included.', 'No rake.', 'Finite size grid.'];
  for (const action of snap.legalActions) snap.ev[action].assumptions = [...common];
  snap.ev.RAISE.assumptions.push('Raise to a total of 4 this street.');
  let details = coachSummary(snap).details;
  for (const premise of common) {
    assert.equal(details.filter(detail => detail.includes(premise)).length, 1);
    assert.ok(details.includes('Shared assumption: ' + premise));
  }
  assert.ok(details.includes('Raise: Raise to a total of 4 this street.'));
  assert.equal(details.some(detail => /^(Fold|Call|Raise): $/.test(detail)), false);
  snap.ev.RAISE = { status: 'NOT_MODELED', missingInputs: ['Size not entered.'] };
  snap.comparisonComplete = false; snap.missingLegalActions = ['RAISE'];
  details = coachSummary(snap).details;
  assert.ok(details.includes('Raise: Size not entered.'));
  assert.equal(details.filter(detail => detail.includes(common[0])).length, 1);
});

test('general Llama explanation replaces unrelated third facts with the price of the decision', () => {
  const snap = snapshot(), facts = explanationFacts(snap);
  for (const irrelevant of ['history', 'tendency', 'limitations', 'opponents']) {
    const selected = composeFactSelection(JSON.stringify({ factIds: ['made', 'decision', irrelevant] }), facts, snap, 'Como jogar esta mão?');
    assert.deepEqual(selected.summary.points, [facts.made, facts.decision, facts.price]);
    assert.doesNotMatch(selected.answer, /saving hands|programmed policy|profile label|Face-down cards/);
    assert.ok(selected.summary.points.length <= 3);
  }
  const relevant = composeFactSelection('{"factIds":["made","decision","equity"]}', facts, snap, 'Como jogar esta mão?');
  assert.equal(relevant.summary.points[2], facts.equity);
});
