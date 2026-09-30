(function () {
  'use strict';
  const host = document.createElement('details');
  host.id = 'analyze-economics'; host.className = 'panel economic-panel';
  host.innerHTML = '<summary>Return per 100 hands <span>Strategy experiment</span></summary><div class="economic-content"><p>Simulation results for the complete policy, separate from the current hand’s equity and EV.</p><p id="economic-status" role="status">Open to view available evidence.</p><div id="economic-report" hidden><label>Evaluated scenario<select id="economic-scenario"></select></label><p id="economic-scope"></p><p id="economic-provenance" class="micro"></p><div id="economic-metrics" class="economic-metrics"></div><div id="economic-distribution"></div><details><summary>Coverage, comparison and limits</summary><div id="economic-details"></div></details></div></div>';
  document.querySelector('#analyze-workspace .table-column').append(host);
  const $ = id => document.getElementById(id);
  const number = (n, digits = 2) => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : 'Unavailable';
  const percent = n => typeof n === 'number' && Number.isFinite(n) ? number(n * 100, 1) + '%' : 'Unavailable';
  const interval = (value, unit = '') => value && Number.isFinite(value.lower) && Number.isFinite(value.upper)
    ? `${number(value.lower)} to ${number(value.upper)}${unit} · ${number((value.level ?? value.coverage) * 100, 3) + '%'}` : 'Interval unavailable';
  let evidence = null, loading = false;
  function paragraph(parent, content, className) {
    const p = document.createElement('p'); p.textContent = content; if (className) p.className = className; parent.append(p);
  }
  function metric(title, value, note) {
    const node = document.createElement('section'), h = document.createElement('h3'), strong = document.createElement('strong');
    h.textContent = title; strong.textContent = value; node.append(h, strong); paragraph(node, note, 'micro'); $('economic-metrics').append(node);
  }
  function render() {
    const scenario = evidence.report.scenarios[Number($('economic-scenario').value)];
    const policy = scenario?.policies?.find(p => p.id.toLowerCase() === 'candidate') || scenario?.policies?.find(p => p.version === evidence.report.candidateVersion);
    $('economic-metrics').replaceChildren(); $('economic-details').replaceChildren(); $('economic-distribution').replaceChildren();
    if (!policy) { $('economic-status').textContent = 'This scenario has no candidate policy result yet.'; return; }
    $('economic-status').textContent = `${evidence.stale ? 'Evidence from another version · ' : ''}Exploratory · ${policy.claim || 'INCONCLUSIVE'} · not a forecast for the current hand.`;
    $('economic-scope').textContent = `${scenario.label || scenario.id} · ${scenario.variant || 'PLO5'}, ${scenario.seats || 2} players, ${scenario.depthBB || 50} BB, BTN/BB alternate · ${scenario.nBlocks} blocks of ${scenario.handsPerBlock} hands · ${scenario.nHands} hands per policy · ${evidence.report.settings?.samples ?? '—'} samples per calculation (${evidence.report.settings?.samplingMode || '—'}). Stacks reset each hand, with unlimited financing in this benchmark.`;
    $('economic-provenance').textContent = `Simulation · ${evidence.report.execution} · candidate ${evidence.report.candidateVersion} / baseline ${evidence.report.baselineVersion} · protocol ${evidence.report.protocolId} · ${evidence.report.createdAt}`;
    metric('Mean net return', `${number(policy.meanBB100)} bb/100`, `Mean CI: ${interval(policy.meanCI, ' bb/100')}. Includes blinds, folds and scenario costs.`);
    metric(`Percent of ${number(evidence.report.referenceCapitalBB)} BB`, `${number(policy.referenceCapitalPercent)}%`, `Reference capital, without compounding. CI: ${interval(policy.referenceCapitalPercentCI, '%')}.`);
    metric('Positive 100-hand block', percent(policy.pPositive), `Probability CI: ${policy.pPositiveCI ? percent(policy.pPositiveCI.lower) + ' to ' + percent(policy.pPositiveCI.upper) + ' · level ' + number(policy.pPositiveCI.level * 100, 3) + '%' : 'unavailable'}. This is not equity or the share of hands won.`);
    metric('Difference vs. baseline', `${number(policy.deltaBB100)} bb/100`, `Paired CI: ${interval(policy.deltaCI, ' bb/100')}. An improvement can still be negative.`);
    paragraph($('economic-distribution'), `Block results: positive ${percent(policy.pPositive)}, zero ${percent(policy.pZero)}, negative ${percent(policy.pNegative)}.`);
    const q = policy.quantiles100;
    paragraph($('economic-distribution'), `Observed 100-hand distribution: P5 ${number(q?.p05)} BB · median ${number(q?.p50)} BB · P95 ${number(q?.p95)} BB. Descriptive sample quantiles, not guaranteed bounds.`);
    paragraph($('economic-distribution'), `Predictive interval for another block: ${interval(policy.predictive100, ' BB')}. ${policy.predictive100?.status || 'Unavailable'}. Distinct from the mean interval.`);
    const c = policy.coverage || {};
    paragraph($('economic-details'), `Supported recommendations: ${number(c.supported, 0)}/${number(c.decisions, 0)} decisions. Abstentions: ${number(c.abstentions, 0)}; errors: ${number(c.errors, 0)}; timeouts: ${number(c.timeouts, 0)}. All contribute to the result through the fallback policy.`);
    for (const [reason, count] of Object.entries(c.reasonCounts || {})) paragraph($('economic-details'), `${reason}: ${number(count, 0)} decisions.`, 'micro');
    paragraph($('economic-details'), `Largest observed drawdown: ${number(policy.maxDrawdownBB)} BB. This does not estimate ruin risk for a finite bankroll.`);
    const cost = scenario.cost;
    const costText = cost?.type === 'PERCENT_CAPPED'
      ? `${percent(cost.rate)} of eligible pot, capped at ${number(cost.cap)} chips; ${cost.noFlopNoDrop ? 'no charge when the hand ends before the flop' : 'also charged before the flop'}; ${cost.rounding === 'FLOOR_CENT' ? 'rounded down to the cent' : `rounding ${cost.rounding}`}.`
      : 'Zero explicitly declared in this control.';
    const opponentName = ({CALL_STATION:'always calls and never raises',PRESSURE:'selective pressure based on own cards and price'})[scenario.opponentFamily] || scenario.opponentFamily;
    paragraph($('economic-details'), `Costs: ${costText} Synthetic opponent: ${opponentName}; does not adapt style between hands.`);
    const settings = evidence.report.settings;
    if (settings) paragraph($('economic-details'), `Hero assumptions: uniform range, ${percent(settings.callProbability)} call probability, bet/raise size ${percent(settings.sizeFraction)} of the pot within limits. Each action model assumes continuation to showdown without further bets; the measured policy queries the engine at each decision. The simulated opponent’s actual response may differ from these assumptions.`);
    if (settings) paragraph($('economic-details'), `Without a supported recommendation: ${settings.fallback === 'CHECK_FOLD' ? 'check when possible; fold when facing a bet' : settings.fallback}. Engine deadline: ${number(settings.deadlineMs)} ms. All hands, including these decisions, count toward the return.`);
    paragraph($('economic-details'), 'Scenario assumptions are not applied to the open table. Mean and comparison intervals account for multiple estimates; wide intervals may prevent a conclusion even when the mean is positive.');
    const power = policy.powerPlan;
    if (power?.relative && power?.absolute) paragraph($('economic-details'), `Approximate sample size: ${number(power.relative.requiredHands, 0)} hands to detect a relative gain of 3 bb/100 against a target of 1; ${number(power.absolute.requiredHands, 0)} for an absolute return of 3 bb/100 against zero. Planned 80% power based on uncertain pilot variance and a normal approximation; this is neither achieved power nor permission to stop when ahead. This scenario has ${number(scenario.nHands, 0)} hands per policy.`);
    for (const limitation of evidence.report.limitations || []) paragraph($('economic-details'), limitation, 'micro');
    paragraph($('economic-details'), `Protocol hash: ${evidence.report.protocolHash}`, 'economic-hash');
  }
  host.addEventListener('toggle', async () => {
    if (!host.open || evidence || loading) return;
    loading = true; $('economic-status').textContent = 'Loading results…';
    try {
      const response = await fetch('/api/analysis/experiments'); const data = await response.json();
      if (!response.ok) throw Error('Could not load the evidence.');
      if (!data.report) { $('economic-status').textContent = 'Experiment not run for this version yet. No profit estimate is available.'; return; }
      evidence = data;
      $('economic-scenario').replaceChildren(...data.report.scenarios.map((s, i) => new Option(s.label || s.id, String(i))));
      $('economic-report').hidden = false; render();
    } catch (error) { $('economic-status').textContent = error.message; }
    finally { loading = false; }
  });
  $('economic-scenario').addEventListener('change', render);
})();
