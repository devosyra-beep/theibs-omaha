(function () {
  'use strict';
  const host = document.createElement('details');
  host.id = 'analyze-economics'; host.className = 'panel economic-panel';
  host.innerHTML = '<summary>Retorno por 100 mãos <span>Experimento de estratégia</span></summary><div class="economic-content"><p>Resultados de simulação da política completa. São separados da equity e do EV da mão atual.</p><p id="economic-status" role="status">Abra para consultar a evidência disponível.</p><div id="economic-report" hidden><label>Cenário avaliado<select id="economic-scenario"></select></label><p id="economic-scope"></p><p id="economic-provenance" class="micro"></p><div id="economic-metrics" class="economic-metrics"></div><div id="economic-distribution"></div><details><summary>Cobertura, comparação e limites</summary><div id="economic-details"></div></details></div></div>';
  document.querySelector('#analyze-workspace .table-column').append(host);
  const $ = id => document.getElementById(id);
  const number = (n, digits = 2) => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: digits }) : 'Indisponível';
  const percent = n => typeof n === 'number' && Number.isFinite(n) ? number(n * 100, 1) + '%' : 'Indisponível';
  const interval = (value, unit = '') => value && Number.isFinite(value.lower) && Number.isFinite(value.upper)
    ? `${number(value.lower)} a ${number(value.upper)}${unit} · ${number((value.level ?? value.coverage) * 100, 3) + '%'}` : 'Intervalo indisponível';
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
    if (!policy) { $('economic-status').textContent = 'Este cenário ainda não tem resultado da política candidata.'; return; }
    $('economic-status').textContent = `${evidence.stale ? 'Evidência de outra versão · ' : ''}Exploratório · ${policy.claim || 'INCONCLUSIVE'} · não é uma previsão para a mão atual.`;
    $('economic-scope').textContent = `${scenario.label || scenario.id} · ${scenario.variant || 'PLO5'}, ${scenario.seats || 2} jogadores, ${scenario.depthBB || 50} BB, BTN/BB alternados · ${scenario.nBlocks} blocos de ${scenario.handsPerBlock} mãos · ${scenario.nHands} mãos por política · ${evidence.report.settings?.samples ?? '—'} amostras por cálculo (${evidence.report.settings?.samplingMode || '—'}). Reposição de stack a cada mão, com financiamento ilimitado no benchmark.`;
    $('economic-provenance').textContent = `Simulação · ${evidence.report.execution} · candidata ${evidence.report.candidateVersion} / baseline ${evidence.report.baselineVersion} · protocolo ${evidence.report.protocolId} · ${evidence.report.createdAt}`;
    metric('Retorno médio líquido', `${number(policy.meanBB100)} bb/100`, `IC da média: ${interval(policy.meanCI, ' bb/100')}. Inclui blinds, folds e custos do cenário.`);
    metric(`Percentual sobre ${number(evidence.report.referenceCapitalBB)} BB`, `${number(policy.referenceCapitalPercent)}%`, `Capital de referência, sem juros compostos. IC: ${interval(policy.referenceCapitalPercentCI, '%')}.`);
    metric('Bloco de 100 mãos positivo', percent(policy.pPositive), `IC da probabilidade: ${policy.pPositiveCI ? percent(policy.pPositiveCI.lower) + ' a ' + percent(policy.pPositiveCI.upper) + ' · nível ' + number(policy.pPositiveCI.level * 100, 3) + '%' : 'indisponível'}. Não é equity ou taxa de mãos ganhas.`);
    metric('Diferença versus baseline', `${number(policy.deltaBB100)} bb/100`, `IC pareado: ${interval(policy.deltaCI, ' bb/100')}. Uma melhora pode continuar negativa.`);
    paragraph($('economic-distribution'), `Resultados dos blocos: positivos ${percent(policy.pPositive)}, iguais a zero ${percent(policy.pZero)}, negativos ${percent(policy.pNegative)}.`);
    const q = policy.quantiles100;
    paragraph($('economic-distribution'), `Distribuição observada de 100 mãos: P5 ${number(q?.p05)} BB · mediana ${number(q?.p50)} BB · P95 ${number(q?.p95)} BB. Quantis descritivos da amostra, não limites garantidos.`);
    paragraph($('economic-distribution'), `Intervalo preditivo para outro bloco: ${interval(policy.predictive100, ' BB')}. ${policy.predictive100?.status || 'Indisponível'}. Diferente do intervalo da média.`);
    const c = policy.coverage || {};
    paragraph($('economic-details'), `Recomendações suportadas: ${number(c.supported, 0)}/${number(c.decisions, 0)} decisões. Abstenções: ${number(c.abstentions, 0)}; erros: ${number(c.errors, 0)}; timeouts: ${number(c.timeouts, 0)}. Todas entram no resultado pela política de fallback.`);
    for (const [reason, count] of Object.entries(c.reasonCounts || {})) paragraph($('economic-details'), `${reason}: ${number(count, 0)} decisões.`, 'micro');
    paragraph($('economic-details'), `Maior drawdown observado: ${number(policy.maxDrawdownBB)} BB. Não estima risco de ruína de uma banca finita.`);
    const cost = scenario.cost;
    const costText = cost?.type === 'PERCENT_CAPPED'
      ? `${percent(cost.rate)} do pote elegível, limite ${number(cost.cap)} fichas; ${cost.noFlopNoDrop ? 'sem cobrança quando a mão termina antes do flop' : 'cobrança também antes do flop'}; arredondamento ${cost.rounding === 'FLOOR_CENT' ? 'para baixo ao centavo' : cost.rounding}.`
      : 'Zero explicitamente declarado neste controle.';
    const opponentName = ({CALL_STATION:'paga sempre e nunca aumenta',PRESSURE:'pressão seletiva por cartas próprias e preço'})[scenario.opponentFamily] || scenario.opponentFamily;
    paragraph($('economic-details'), `Custos: ${costText} Adversário sintético: ${opponentName}; não adapta seu estilo entre mãos.`);
    const settings = evidence.report.settings;
    if (settings) paragraph($('economic-details'), `Hipóteses do herói: range uniforme, ${percent(settings.callProbability)} de call, aposta/raise de ${percent(settings.sizeFraction)} do pote dentro dos limites. O modelo de cada ação supõe continuação até showdown sem novas apostas; a política medida reconsulta o motor em cada decisão. A resposta real do adversário simulado pode contrariar essas hipóteses.`);
    if (settings) paragraph($('economic-details'), `Sem recomendação suportada: ${settings.fallback === 'CHECK_FOLD' ? 'check quando possível; fold ao enfrentar aposta' : settings.fallback}. Prazo do motor: ${number(settings.deadlineMs)} ms. Todas as mãos, inclusive essas decisões, entram no retorno.`);
    paragraph($('economic-details'), 'As hipóteses deste cenário não são aplicadas à mesa aberta. Os intervalos da média e da comparação controlam múltiplas estimativas; intervalos amplos podem impedir uma conclusão, mesmo com média positiva.');
    const power = policy.powerPlan;
    if (power?.relative && power?.absolute) paragraph($('economic-details'), `Dimensionamento aproximado: ${number(power.relative.requiredHands, 0)} mãos para detectar ganho relativo de 3 bb/100 contra a meta de 1; ${number(power.absolute.requiredHands, 0)} para retorno absoluto de 3 bb/100 contra zero. Poder planejado de 80%, baseado em variância piloto incerta e aproximação normal; não é poder atingido nem autorização para parar ao obter lucro. Amostra deste cenário: ${number(scenario.nHands, 0)} mãos por política.`);
    for (const limitation of evidence.report.limitations || []) paragraph($('economic-details'), limitation, 'micro');
    paragraph($('economic-details'), `Hash do protocolo: ${evidence.report.protocolHash}`, 'economic-hash');
  }
  host.addEventListener('toggle', async () => {
    if (!host.open || evidence || loading) return;
    loading = true; $('economic-status').textContent = 'Consultando resultados…';
    try {
      const response = await fetch('/api/analysis/experiments'); const data = await response.json();
      if (!response.ok) throw Error('Não foi possível consultar a evidência.');
      if (!data.report) { $('economic-status').textContent = 'Experimento ainda não executado nesta versão. Nenhuma estimativa de lucro disponível.'; return; }
      evidence = data;
      $('economic-scenario').replaceChildren(...data.report.scenarios.map((s, i) => new Option(s.label || s.id, String(i))));
      $('economic-report').hidden = false; render();
    } catch (error) { $('economic-status').textContent = error.message; }
    finally { loading = false; }
  });
  $('economic-scenario').addEventListener('change', render);
})();
