(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TheibsAnalyzeFeedback = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Presentation only: never fills assumptions, requests samples or chooses an action.
  function inputProgress({ count = 5, slots = [], manualInvalid = false } = {}) {
    if (manualInvalid) return { ready: false, title: 'Fix card entry', detail: 'Correct the invalid or duplicate cards in the text field.', target: 'entry' };
    const hero = slots.slice(0, count), board = slots.slice(count, count + 5);
    const heroMissing = count - hero.filter(Boolean).length;
    if (heroMissing > 0) return { ready: false, title: 'Complete your hand', detail: `Add ${heroMissing} hole card${heroMissing === 1 ? '' : 's'} for PLO${count}.`, remaining: heroMissing, target: 'cards' };
    const present = board.filter(Boolean).length;
    // A selected flop/turn slot alone does not change a valid preflop hand.
    if (!present) return { ready: true, street: 'PREFLOP', title: 'Preflop ready' };
    const last = board.reduce((index, card, i) => card ? i : index, -1);
    const required = Math.max(3, last + 1), remaining = required - present;
    const street = required === 3 ? 'FLOP' : required === 4 ? 'TURN' : 'RIVER';
    if (remaining) return { ready: false, street, title: `Complete ${street.toLowerCase()}`, detail: `Add ${remaining} board card${remaining === 1 ? '' : 's'} to complete the ${required}-card ${street.toLowerCase()}.`, remaining, target: 'cards' };
    return { ready: true, street, title: `${street[0]}${street.slice(1).toLowerCase()} ready` };
  }

  function costLabel(data) {
    const supplied = data?.provenance?.rake;
    const cost = supplied?.mode === 'SCENARIO_SPECIFIC' ? supplied.base : supplied;
    if (cost?.mode === 'PERCENT_CAPPED_SCHEDULE') return `Costs: ${(cost.schedule.rate * 100).toFixed(2)}%, cap ${Number(cost.schedule.cap).toFixed(2)} chips${cost.schedule.noFlopNoDrop ? ', no flop no drop' : ''}.`;
    if (Number.isFinite(cost?.amount)) return cost.amount === 0 ? 'Costs: zero rake assumed.' : `Costs: ${cost.amount.toFixed(2)} chips of fixed rake.`;
    return 'Costs: see the assumptions for each action.';
  }

  function summary({ data, action = 'CALL', progress = { ready: true }, busy = false, auto = true, multiway = false, note = '' } = {}) {
    if (!progress.ready) return { tone: 'pending', state: 'Waiting for cards', title: progress.title,
      detail: progress.detail + (progress.target === 'cards' ? (auto ? ' Calculation starts when the cards are complete.' : ' Then select Analyze hand.') : ''), target: progress.target, label: progress.target === 'entry' ? 'Edit card text' : 'Enter cards' };
    if (!data) return { tone: 'pending', state: busy ? 'Calculating…' : 'Ready to analyze', title: busy ? 'Calculating this hand' : progress.title,
      detail: busy ? 'The selected calculation budget is running. You can keep editing the cards.' : note || (auto ? 'Waiting for the calculation to start.' : 'Select Analyze hand to calculate.'), target: null };
    if (data.status !== 'OK') return { tone: 'pending', state: 'Not calculated', title: 'Calculation unavailable', detail: data.reason || note || 'Review the entered state.', target: 'calculation', label: 'View details' };
    const model = data.ev?.actions?.[action];
    const modeled = model?.status === 'MODELED' && Number.isFinite(model.ev);
    const bounds = model?.conditionalEvEnvelope || model?.confidenceInterval95;
    const hasBounds = Array.isArray(bounds) && bounds.length === 2 && bounds.every(Number.isFinite);
    const uncertain = modeled && hasBounds && bounds[0] <= 0 && bounds[1] >= 0 && bounds[0] !== bounds[1];
    const tone = !modeled ? 'pending' : uncertain ? 'neutral' : model.ev > .005 ? 'positive' : model.ev < -.005 ? 'negative' : 'neutral';
    const state = !modeled ? 'Not calculated' : uncertain ? `${model.ev > 0 ? 'Positive' : model.ev < 0 ? 'Negative' : 'Zero'} estimate · sign uncertain` : tone === 'positive' ? 'Positive under assumptions' : tone === 'negative' ? 'Negative under assumptions' : 'Near break-even';
    const base = { tone, state, uncertain, title: `${action} EV: ${state.toLowerCase()}`, detail: costLabel(data), target: null };
    if (data.analysisStage === 'PROVISIONAL') return { ...base, title: 'Provisional estimate: refining', detail: 'The full selected sample budget is still running. This preview does not supply a recommended action.', target: null };
    if (data.analysisDiagnostics?.reasonCodes?.includes('MISSING_OPPONENTS')) return { ...base, title: 'Some opponents are missing from the model', detail: 'Complete the opponent model before interpreting this as the whole-table result.', target: 'opponents', label: 'Review opponents' };
    const allMissing = Object.values(data.ev?.actions || {}).flatMap(item => item?.legal ? item.missingInputs || [] : []);
    if (allMissing.some(field => /rake/i.test(field))) return { ...base, title: 'Enter the cost assumption', detail: 'Equity is available. To calculate net EV, enter the table rake or explicitly choose zero rake.', target: 'costs', label: 'Set costs' };
    const missingActions = data.ev?.missingLegalActions || [];
    if (missingActions.length) return { ...base, title: `Partial comparison: ${missingActions.join(' / ')} missing`, detail: `${modeled ? `${action} EV is calculated. ` : ''}${multiway ? 'These legal actions need response models for the tracked seats; this mode does not provide them yet.' : 'Enter a legal bet/raise size and opponent-response assumptions to compare all legal actions.'} More samples do not supply those assumptions. ${costLabel(data)}`, target: multiway ? 'calculation' : 'responses', label: multiway ? 'View modeled actions' : 'Review response model' };
    if (data.recommendation?.status !== 'CONDITIONAL' && uncertain) return { ...base, title: 'The EV sign is still uncertain', detail: `The interval includes zero. A larger sample budget can reduce sampling uncertainty; it cannot validate the opponent model. ${costLabel(data)}`, target: 'precision', label: 'Review precision' };
    if (data.recommendation?.status !== 'CONDITIONAL') return { ...base, title: 'No supported preference between actions', detail: `Review the action intervals and decision-support conditions in the calculation. ${costLabel(data)}`, target: 'calculation', label: 'Compare action intervals' };
    return { ...base, detail: `The supported choice is ${data.recommendation.action}. ${costLabel(data)}`, target: 'calculation', label: 'View action comparison' };
  }
  return { inputProgress, summary, costLabel };
});
