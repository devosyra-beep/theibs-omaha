/* Theibs controller. All analysis and simulated actions go to the original local
   Theibs API. EssenceDeck supplies presentation only; no demo engine is loaded. */
(function () {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const form = $('#analysis-form'), result = $('#result'), emptyState = $('#empty-state');
  const analyzeButton = $('#analyze-button');
  const cards = window.theibsCardKeyboard;
  const snapshots = [];
  const value = (id) => document.getElementById(id).value.trim();
  const percent = (number) => number == null || !Number.isFinite(Number(number)) ? '—' : `${(Number(number) * 100).toFixed(1)}%`;
  const money = (number) => number == null || !Number.isFinite(Number(number)) ? '—' : Number(number).toFixed(2);
  const esc = window.EssenceUI.esc;
  const streetName = (street) => ({ PREFLOP: 'Preflop', FLOP: 'Flop', TURN: 'Turn', RIVER: 'River' })[street] || street;
  const qualityName = (quality) => ({ INCONCLUSIVE_COMPARISON: 'Sem vantagem clara entre as opções', INCOMPLETE_COMPARISON: 'Comparação limitada', MATCHED_HEURISTIC: 'Coincide com a heurística antiga', DIFFERENT_HEURISTIC: 'Difere da heurística antiga', MATCHED_MODELED: 'Escolha favorecida neste exercício', DIFFERENT_MODELED: 'Outra opção teve EV maior', UNVERIFIED: 'Ainda sem avaliação' })[quality] || quality;
  const actionName = action => ({FOLD:'Desistir',CALL:'Pagar',CHECK:'Passar',BET:'Apostar',RAISE:'Aumentar',NO_DECISION:'Sem indicação'})[action] || action || '—';
  const actionWithSize = (action,size) => actionName(action)+(['BET','RAISE'].includes(action)&&Number.isFinite(size)?' para '+money(size):'');
  const comparisonLabel = data => !data.ev?.comparisonComplete ? 'Líder parcial' : data.strategy?.baseline?.leadership?.status === 'SEPARATED' ? 'Maior EV do cenário' : 'Comparação inconclusiva';
  const numberLabel = n => Number.isFinite(n) ? Math.round(n).toLocaleString('pt-BR') : '—';
  const FIELD_IDS = ['position','players','potBeforeAction','amountToCall','effectiveStack','samples','seed',
    'opponentHand','opponentRange','opponentProfile','opponentProfileSource','observedFoldToBet','observedCallFrequency','observedRaiseFrequency','observedBluffFrequency',
    'betSize','raiseTo','foldEquity','continuationEquity','rake','assumeNoRake','opponentModel','auto-analysis','training-mode','training-style','training-street','training-seed','training-stack'];
  FIELD_IDS.push('study-mode','study-hero-contribution','study-min-raise','study-min-bet','study-accept',...Array.from({length:9},(_,i)=>['study-contribution-'+i,'study-probability-'+i]).flat());
  let activeView = 'analyze', inputRevision = 0, analysisBusy = false, trainingBusy = false;
  let lastAnalysis = null, trainingSession = null, trainingDecisions = [];
  let loaded = false, revision = 0, saveTimer = null, saveBusy = false, saveDirty = false, saveBlocked = false;
  let legacyHandFlow = null;
  let toastTimer = null, priorHero = '';
  let analysisTimer=null,analysisController=null,analysisQueued=false;
  let engineStatus = null;
  let multiway = null, multiwayState = null, multiwayAnalysis = null, multiwaySimple = null;
  let multiwayBusy = false, syncingMultiway = false, multiwayCardTimer = null, multiwayCardSnapshot = null, multiwayRevision = 0;
  const multiwayLocked = ['variant-select','players','opponent-count','position','potBeforeAction','amountToCall','effectiveStack','opponentHand','opponentRange','study-mode'];
  const multiwayManualModels = ['opponentProfile','opponentProfileSource','observedFoldToBet','observedCallFrequency','observedRaiseFrequency','observedBluffFrequency','betSize','raiseTo','foldEquity','continuationEquity','study-hero-contribution','study-min-raise','study-min-bet','study-accept',...Array.from({length:9},(_,i)=>['study-contribution-'+i,'study-probability-'+i]).flat()];
  function multiwayContext() {
    const hand=cards.state.cards();
    return {variant:`PLO${cards.state.count}_HIGH`,players:Number(value('players')),position:value('position'),effectiveStack:Number(value('effectiveStack')),heroCards:hand.hero.map(window.TheibsCards.toCanonical),board:hand.board.map(window.TheibsCards.toCanonical)};
  }
  function renderMultiway() {
    document.body.dataset.multiwayBusy=String(multiwayBusy);
    for(const id of ['hero-slots','card-grid'])document.getElementById(id).inert=multiwayBusy;
    window.theibsMultiwayUI.render({enabled:!!multiway,state:multiwayState,config:multiway?.config,busy:multiwayBusy});
    $('#analysis-seats').setAttribute('aria-label',multiway?'Assentos da mesa; clique no adversário para registrar sua saída.':'Adversários com cartas fechadas; posições ilustrativas.');
    for(const id of multiwayLocked) { const el=document.getElementById(id);el.disabled=!!multiway;el.title=multiway?'Definido pelo registro Multiway. Saia do modo para editar livremente.':''; }
    for(const id of multiwayManualModels){const el=document.getElementById(id);el.disabled=!!multiway;el.title=multiway?'Premissas livres do modo simples. Modelos Multiway precisam identificar cada assento.':'';}
    // Board changes belong to a street event; existing card entry edits only the private hand.
    if(multiway)document.querySelectorAll('#board-slots [data-slot]').forEach(el=>{el.disabled=true;el.title='Use Revelar board no Multiway.';});
  }
  function syncMultiwayCards() {
    if(!multiwayState)return;
    const snapshot=cards.state.snapshot();
    snapshot.count=Number(multiway.config.variant.match(/\d/)[0]);
    const hero=snapshot.slots.slice(0,snapshot.count);
    snapshot.slots=[...hero,...multiwayState.board.map(window.TheibsCards.fromCanonical),...Array(5-multiwayState.board.length).fill(null)];
    snapshot.selected=Math.min(snapshot.selected,snapshot.count-1);
    syncingMultiway=true;cards.restore(snapshot);syncingMultiway=false;
  }
  function acceptMultiway(data) {
    multiway=data.multiway;multiwayState=data.state;multiwayAnalysis=data.analysis;
    syncMultiwayCards();updateTableContext();renderMultiway();updateBoardHelp();
    snapshots.forEach(item=>item.stale=true);invalidateAnalysis();renderStreetCards();scheduleSave();
  }
  async function runMultiway(operation) {
    if(multiwayBusy)return;
    multiwayRevision++;
    clearTimeout(multiwayCardTimer);
    multiwayCardSnapshot=cards.state.snapshot();multiwayBusy=true;invalidateAnalysis();renderMultiway();
    try { const data=await operation();if(data)acceptMultiway(data); }
    catch(error){window.theibsMultiwayUI.setError(error.message);throw error;}
    finally{multiwayBusy=false;multiwayCardSnapshot=null;renderMultiway();scheduleAnalysis();}
  }
  async function startMultiway(config) {
    return runMultiway(async()=>{
      const data=await postJson('/api/multiway/start',{config});
      if(!multiwaySimple)multiwaySimple={keyboard:cards.state.snapshot(),fields:Object.fromEntries(FIELD_IDS.map(id=>{const el=document.getElementById(id);return[id,el.type==='checkbox'?el.checked:el.value];}))};
      syncingMultiway=true;
      const count=Number(config.variant.match(/\d/)[0]);
      cards.restore({count,slots:[...(config.heroCards||[]).map(window.TheibsCards.fromCanonical),...Array(count-(config.heroCards?.length||0)+5).fill(null)],selected:0});
      syncingMultiway=false;snapshots.splice(0);$('#settings-dialog').close();window.theibsCardPicker.close();return data;
    });
  }
  async function stepMultiway(event) {
    return runMultiway(()=>postJson('/api/multiway/step',{multiway,event}));
  }
  async function exitMultiway() {
    if(multiwayBusy)return;
    multiwayRevision++;
    clearTimeout(multiwayCardTimer);
    multiway=null;multiwayState=null;multiwayAnalysis=null;
    if(multiwaySimple){
      for(const [id,saved] of Object.entries(multiwaySimple.fields||{})){const el=document.getElementById(id);if(!el||!FIELD_IDS.includes(id))continue;if(el.type==='checkbox')el.checked=saved===true;else el.value=String(saved);}
      syncingMultiway=true;cards.restore(multiwaySimple.keyboard);syncingMultiway=false;
    }
    multiwaySimple=null;snapshots.splice(0);cards.render();renderMultiway();updateTableContext();updateBoardHelp();invalidateAnalysis();scheduleSave();
  }

  function renderEngineDetails() {
    const data=lastAnalysis?.data, perf=data?.performance, q=data?.equity;
    const samples=perf?.monteCarloSamples ?? (q?.method==='MONTE_CARLO'?q.samples:null);
    const uiMs=data?.clientTiming?.elapsedMs;
    const rate=samples>0&&uiMs>0?samples*1000/uiMs:null;
    const llm=!engineStatus ? 'Configuração da IA ainda não consultada ou indisponível.' : engineStatus.llmProvider==='ollama' ? `Ollama configurado: ${engineStatus.llmModel||'modelo não definido'}. O modelo responde sob demanda no Assistente e no treino.` : 'Explicador local ativo. Ollama não configurado nesta execução.';
    $('#engine-details').innerHTML=`<section class="engine-card"><span class="eyebrow">ÚLTIMA ANÁLISE · META 100 MIL/S</span><h3>${rate===null?'Aguardando medição':numberLabel(rate)+' simulações/s'}</h3><p>${rate===null?'Complete a mão e analise para medir nesta máquina.':rate>=100000?'A meta foi atingida nesta análise.':'Esta análise ficou abaixo da meta de 100 mil/s.'} O valor varia por cenário, tamanho da amostra e carga da máquina.</p><dl class="engine-metrics"><div><dt>Formato analisado</dt><dd>${data?.status==='OK'?esc(data.state?.variant||'Omaha')+' · '+q.opponents+' adversário(s)':'—'}</dd></div><div><dt>Simulações completas</dt><dd>${numberLabel(samples)}</dd></div><div><dt>Resposta até a interface</dt><dd>${Number.isFinite(uiMs)?(uiMs/1000).toFixed(3)+' s':'—'}</dd></div><div><dt>Pedido ao worker</dt><dd>${Number.isFinite(perf?.requestElapsedMs)?(perf.requestElapsedMs/1000).toFixed(3)+' s':'—'}</dd></div><div><dt>Núcleo de equity</dt><dd>${numberLabel(q?.simulationsPerSecond)} simulações/s</dd></div><div><dt>Reuso do worker</dt><dd>${perf?perf.workerReused?'Sim':'Primeiro uso':'—'}</dd></div></dl><p class="micro">Uma simulação completa sorteia o restante do board e as mãos adversárias e compara todos os jogadores. No estudo de bet/raise, a contagem soma as simulações feitas para cada quantidade de pagadores. A taxa principal inclui a ida e volta da requisição; o núcleo mede só a etapa de equity. Enumeração exata não conta como Monte Carlo.</p></section><section class="engine-card"><h3>O que a IA faz hoje</h3><p>${esc(llm)}</p><p>O treinador explica os fatos calculados e pode consultar decisões semelhantes do seu histórico. O Llama seleciona os fatos relevantes para sua pergunta. Os textos e números exibidos vêm do motor; o modelo não calcula equity, não altera EV e não acelera o Monte Carlo.</p></section><section class="engine-card"><h3>O que aprende com o uso</h3><p>Seu histórico, dúvidas e estatísticas ficam salvos e ajudam a escolher revisões. Não há treinamento automático de pesos, alteração dos ranges ou aprendizado de uma estratégia ótima.</p><p>O próximo avanço depende de referências confiáveis para as jogadas, dados separados para avaliação e calibração dos modelos de resposta. Mais simulações reduzem o ruído amostral; não corrigem premissas erradas.</p></section>`;
  }

  function toast(text) {
    $('#toast').textContent = text; $('#toast').classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 5500);
  }
  async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    let data; try { data = await response.json(); } catch { throw new Error(`Resposta inválida do motor local (HTTP ${response.status}).`); }
    if (!response.ok) { const error = new Error(data.reason || `HTTP ${response.status}`); error.status = response.status; throw error; }
    return data;
  }
  const postJson = (url, payload, keepalive = false) => requestJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive });
  function currentStreet() {
    const n = cards.state.cards().board.length;
    return n === 0 ? 'PREFLOP' : n <= 3 ? 'FLOP' : n === 4 ? 'TURN' : 'RIVER';
  }
  function updateBoardHelp() {
    const street = currentStreet();
    document.querySelectorAll('.street-tab').forEach((b) => { b.classList.toggle('active', b.dataset.street === street); b.setAttribute('aria-pressed', String(b.dataset.street === street)); });
    $('#board-help').textContent = street === 'PREFLOP' ? 'Deixe vazio para analisar apenas o preflop.' : `Informe ${{ FLOP: 3, TURN: 4, RIVER: 5 }[street]} cartas no board para esta street.`;
  }
  function renderStreetCards() {
    const byStreet = new Map(snapshots.map((item) => [item.street, item]));
    $('#street-cards').innerHTML = ['PREFLOP','FLOP','TURN','RIVER'].map((street) => {
      const item = byStreet.get(street);
      return `<div class="street-card${currentStreet() === street ? ' current' : ''}"><div class="street-name">${streetName(street)}</div><div class="street-meta"><span>${item ? item.stale ? 'Reanalisar' : 'Analisado' : 'Aguardando'}</span><span class="street-equity">${item && !item.stale ? percent(item.equity) : '—'}</span></div></div>`;
    }).join('');
    const valid = snapshots.filter((item) => item.equity != null && !item.stale);
    $('#session-count').textContent = valid.length;
    $('#session-average').textContent = valid.length ? percent(valid.reduce((sum, item) => sum + item.equity, 0) / valid.length) : '—';
    $('#session-action').textContent = valid.at(-1)?.action || '—';
  }

function renderCharts(latest) {
  const equity = latest?.equity;
  document.querySelector('#hero-equity').textContent = equity == null ? '—' : percent(equity);
  document.querySelector('#hero-method').textContent = latest ? `${latest.method} · ${latest.samples} amostras` : 'Aguardando mão';
  document.querySelector('#chart-total').textContent = latest ? streetName(latest.street) : '—';
  document.querySelector('#win-percent').textContent = latest ? percent(latest.winRate) : '—';
  document.querySelector('#loss-percent').textContent = latest ? percent(1 - latest.winRate) : '—';
  document.querySelector('#win-fill').style.width = latest ? `${Math.max(0, Math.min(100, latest.winRate * 100))}%` : '0%';
  document.querySelector('#timeline-range').textContent = snapshots.length ? `${snapshots.length} ponto${snapshots.length === 1 ? '' : 's'}` : '—';
  document.querySelector('#timeline-empty').style.display = snapshots.length ? 'none' : 'block';
  const points = snapshots.filter((item) => item.equity != null && !item.stale);
  if (!points.length) {
    document.querySelector('#chart-line').setAttribute('points', '');
    document.querySelector('#chart-area').setAttribute('d', '');
    document.querySelector('#chart-points').innerHTML = '';
    return;
  }
  const width = 300; const left = 15; const top = 15; const bottom = 145; const height = bottom - top;
  const coords = points.map((item, index) => {
    const x = points.length === 1 ? left + width / 2 : left + (index / (points.length - 1)) * width;
    const y = bottom - item.equity * height;
    return { x, y, item };
  });
  const line = coords.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  document.querySelector('#chart-line').setAttribute('points', line);
  document.querySelector('#chart-area').setAttribute('d', `M ${coords[0].x} ${bottom} L ${coords.map((point) => `${point.x} ${point.y}`).join(' L ')} L ${coords.at(-1).x} ${bottom} Z`);
  document.querySelector('#chart-points').innerHTML = coords.map(({ x, y, item }) => `<circle cx="${x}" cy="${y}" r="4" fill="#e3b866" stroke="#111719" stroke-width="2"><title>${streetName(item.street)} · ${percent(item.equity)}</title></circle>`).join('');
}

function renderEvTable(ev) {
  if (!ev || !ev.actions) return '';
  const order = ['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE'];
  const rows = order.map((action) => {
    const item = ev.actions[action];
    if (!item) return '';
    const evValue = item.ev == null ? '—' : `${item.ev > 0 ? '+' : ''}${money(item.ev)}`;
    const status = ({MODELED:'Calculado',NOT_MODELED:'Premissas pendentes',NOT_LEGAL:'Não disponível'})[item.status]||item.status;
    const detail = item.missingInputs?.length ? `Falta: ${item.missingInputs.join(', ')}` : (item.assumptions || []).join(' · ');
    return `<tr><td>${esc(action)}</td><td class="ev-number ${item.ev > 0 && item.status === 'MODELED' ? 'positive' : ''}">${esc(evValue)}</td><td><span class="ev-status ${String(item.status).toLowerCase()}">${esc(status)}</span></td><td>${esc(detail || '—')}</td></tr>`;
  }).join('');
  const summary = ev.bestModeledAction ? `${ev.comparisonComplete?'Maior EV entre as ações/tamanhos avaliados':'Comparação parcial · maior EV calculado'}: ${ev.bestModeledAction}` : 'Nenhuma ação com EV modelado.';
  const breakdown=Object.values(ev.actions).filter(a=>a.scenarioBreakdown?.length).map(a=>{
    const groups=new Map();for(const s of a.scenarioBreakdown){const n=s.callers.length,g=groups.get(n)||{n,probability:0,weightedEv:0};g.probability+=s.probability;g.weightedEv+=s.weightedEv;groups.set(n,g);}
    return `<details><summary>Cenários de ${esc(a.action)} · ${a.scenarioBreakdown.length} respostas possíveis</summary><p class="micro">Probabilidades informadas como hipóteses. Sem reaumento nem apostas futuras.</p><table class="ev-table"><thead><tr><th>Pagadores</th><th>Chance</th><th>Parcela do EV</th></tr></thead><tbody>${[...groups.values()].sort((a,b)=>a.n-b.n).map(g=>`<tr><td>${g.n}</td><td>${percent(g.probability)}</td><td>${money(g.weightedEv)}</td></tr>`).join('')}</tbody></table>${a.conditionalEvEnvelope?`<p>Faixa condicional: ${money(a.conditionalEvEnvelope[0])} a ${money(a.conditionalEvEnvelope[1])} fichas. Propaga intervalos por cenário; não é garantia conjunta de 95%.</p>`:''}</details>`;
  }).join('');
  return `<section class="ev-block"><div class="ev-heading"><span>EV por ação</span><span>${esc(summary)}</span></div><div class="ev-table-wrap"><table class="ev-table"><thead><tr><th>Ação</th><th>EV</th><th>Status</th><th>Premissas / ausências</th></tr></thead><tbody>${rows}</tbody></table></div>${breakdown}${(ev.warnings || []).map((warning) => `<div class="result-warning">${esc(warning)}</div>`).join('')}</section>`;
}

function renderStrategyPanel(strategy) {
  if (!strategy) return '';
  const baseline = strategy.baseline || {};
  const exploit = strategy.exploit || {};
  const changed = exploit.finalSource === 'EXPLOIT_ADJUSTMENT';
  const adjustments = (exploit.adjustments || []).map((item) => `${item.field}: ${item.adjusted == null ? 'ajuste estratégico' : Number(item.adjusted).toFixed(2)}`).join(' · ');
  return `<section class="strategy-block"><div class="ev-heading"><span>Strategy / exploit</span><span>${esc(exploit.profile || 'UNKNOWN')}</span></div><div class="strategy-grid"><div><small>Base</small><strong>${esc(baseline.action || '—')}</strong></div><div><small>Final</small><strong class="${changed ? 'strategy-changed' : ''}">${esc(strategy.finalAction || '—')}</strong></div><div><small>Fonte</small><strong>${esc(strategy.finalSource || '—')}</strong></div><div><small>Confiança</small><strong>${esc(strategy.confidence || '—')}</strong></div></div>${changed ? `<div class="strategy-adjustment">Ação alterada pela hipótese exploitativa. ${esc(adjustments || 'Sem ajuste quantitativo informado.')}</div>` : ''}${(exploit.warnings || []).map((warning) => `<div class="result-warning">${esc(warning)}</div>`).join('')}</section>`;
}

function renderResult(data, street) {
  emptyState.classList.add('hidden');
  result.classList.remove('hidden');
  if (data.status !== 'OK') {
    result.innerHTML = `<div class="result-action">NO_DECISION</div><div class="result-warning">${esc(data.reason || 'Dados insuficientes.')}<br>${[...(data.errors || []), ...(data.warnings || [])].map(esc).join('<br>')}</div>`;
    return;
  }
  const equity = data.equity || {}; const math = data.potMath || {};
  const modeledCall = data.ev?.actions?.CALL?.status === 'MODELED' ? data.ev.actions.CALL.ev : null;
  result.innerHTML = `<div class="result-top"><div><div class="result-label">${comparisonLabel(data)} · ${streetName(street)}</div><div class="result-action">${esc(data.recommendedAction)}</div></div></div>
    <details class="result-disclosure"><summary>Por quê? Ver cálculos e premissas</summary><div><p class="result-reason">${esc(data.reason)}</p><span class="confidence">${esc(data.confidence)}</span><div class="result-metrics"><div class="mini-metric"><small>Equity</small><strong>${percent(equity.equity)}</strong></div><div class="mini-metric"><small>Pot odds</small><strong>${percent(math.potOdds)}</strong></div><div class="mini-metric"><small>EV call</small><strong>${money(modeledCall)}</strong></div><div class="mini-metric"><small>SPR</small><strong>${math.spr == null ? '—' : Number(math.spr).toFixed(1)}</strong></div></div>${renderEvTable(data.ev)}${renderStrategyPanel(data.strategy)}<div class="result-detail">${esc(equity.method)} · ${esc(equity.samples)} amostras · ${esc(equity.opponents)} oponente(s) · legais: ${(data.legalActions || []).map(esc).join(' / ')}<br>${(data.assumptions || []).map(esc).join(' · ')}${equity.confidenceInterval95 ? `<br>IC 95% Monte Carlo: ${percent(equity.confidenceInterval95[0])}–${percent(equity.confidenceInterval95[1])} (não inclui incerteza do range)` : ''}</div>${(data.warnings || []).map((warning) => `<div class="result-warning">${esc(warning)}</div>`).join('')}</div></details>`;
}


  function updateTableContext() {
    if(multiwayState){
      const hero=multiwayState.players.find(p=>p.hero),opponents=multiwayState.players.filter(p=>!p.hero&&!p.folded);
      for(const [id,n] of Object.entries({players:multiwayState.activePlayers,position:hero.position,potBeforeAction:multiwayState.pot,amountToCall:multiwayState.heroToCall,effectiveStack:hero.stack}))document.getElementById(id).value=String(n);
      $('#table-pot').textContent=window.EssenceUI.money(multiwayState.pot);$('#table-call').textContent=window.EssenceUI.money(multiwayState.heroToCall);$('#table-stack').textContent=window.EssenceUI.money(hero.stack);$('#table-position').textContent=`VOCÊ · ${hero.position}`;
      $('#opponent-count').innerHTML=`<option value="${opponents.length}">${opponents.length}</option>`;
      $('#opponent-total').textContent=`${opponents.length} adversários ativos`;
      $('#table-position').textContent=`VOCÊ · ${hero.position}${hero.folded?' · Saiu':hero.allIn?' · All-in':''}`;
      $('#analysis-seats').innerHTML=window.EssenceUI.multiwaySeats(multiwayState,cards.state.count);return;
    }
    $('#table-pot').textContent = value('potBeforeAction') === '' ? '—' : window.EssenceUI.money(value('potBeforeAction'));
    $('#table-call').textContent = value('amountToCall') === '' ? '—' : window.EssenceUI.money(value('amountToCall'));
    $('#table-stack').textContent = value('effectiveStack') === '' ? '—' : window.EssenceUI.money(value('effectiveStack'));
    $('#table-position').textContent = `VOCÊ · ${value('position') || '—'}`;
    const maxPlayers=({6:5,5:6})[cards.state.count]||Math.min(10,Math.floor(47/cards.state.count));
    $('#players').max=String(maxPlayers);
    if(Number(value('players'))>maxPlayers){$('#players').value=String(maxPlayers);toast(`PLO${cards.state.count}: mesa ajustada para você + ${maxPlayers-1} adversários.`);}
    const players = Number(value('players'));
    const opponents = Number.isInteger(players) && players >= 2 && players <= 10 ? players - 1 : 0;
    document.querySelectorAll('[data-study-opponent]').forEach(row=>row.hidden=Number(row.dataset.studyOpponent)>=opponents);
    const maxOpponents=maxPlayers-1;
    const opponentSelect=$('#opponent-count');
    opponentSelect.innerHTML=Array.from({length:maxOpponents},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
    if(opponents>maxOpponents)opponentSelect.add(new Option(`${opponents} · excede o baralho`,String(opponents)));
    opponentSelect.value=String(opponents);
    $('#opponent-total').title='As posições dos adversários são ilustrativas; as cartas permanecem desconhecidas.';
    $('#opponent-total').textContent=opponents?`Você + ${opponents} adversário${opponents===1?'':'s'} = ${players} jogadores`:'Informe os adversários';
    $('#analysis-seats').innerHTML = window.EssenceUI.opponentSeats(opponents,cards.state.count);
  }
  function quickAction(data, note) {
    const facts=data?.handInsights;
    $('#nuts-badge').hidden=!(data?.status==='OK'&&facts?.made&&facts?.nuts?.unbeaten===true);
    $('#hand-facts-content').innerHTML=facts?`<p><strong>${esc(facts.made?.label||'Pré-flop')}</strong>${facts.made?`<br>Suas cartas usadas: ${facts.made.usedHeroCards.map(esc).join(' + ')}`:`<br>${facts.privatePairs.length} grupo(s) pareado(s) · ${facts.suited.length} naipe(s) com duas cartas ou mais`}</p>${facts.nuts?`<p>${facts.nuts.unbeaten?'Nuts no board atual; pode empatar.':'Sua mão pode ser superada no board atual.'}</p>`:''}${facts.nextCard?`<p>Próxima carta: <b>${facts.nextCard.flushCards.length}</b> completam flush · <b>${facts.nextCard.straightCards.length}</b> completam sequência.</p><p class="micro">Melhorar não é garantia de vitória; não são outs limpos.</p>`:''}${facts.blockers.map(b=>`<p>${esc(b.detail)}</p>`).join('')}`:'Complete as cartas para ver mão formada, draws e blockers. Não é preciso registrar ações.';
    $('#quick-action').textContent = data?.status === 'OK' ? data.recommendedAction : data ? 'NO_DECISION' : '—';
    $('#quick-action-note').textContent = note || (data?.status === 'OK' ? data.ev?.comparisonComplete?comparisonLabel(data):'Parcial · falta '+(data.ev?.missingLegalActions||[]).join(', ') : data?.reason || 'Complete suas cartas.');
    const action=Number(value('amountToCall'))>0?'CALL':'CHECK';
    const model=data?.status==='OK'?data.ev?.actions?.[action]:null;
    const ev=model?.status==='MODELED'?model.ev:null;
    const interval=model?.confidenceInterval95;
    const envelope=model?.conditionalEvEnvelope;
    const bounds=envelope||interval;
    const uncertain=bounds&&bounds[0]<0&&bounds[1]>0;
    const tone=ev==null?'pending':uncertain?'neutral':ev>0.005?'positive':ev<-.005?'negative':'neutral';
    $('#ev-summary').dataset.tone=tone;
    $('#ev-label').textContent=`EV do ${action==='CALL'?'call':'check'}`;
    $('#ev-value').textContent=ev==null?'—':`${ev>0?'+':''}${money(Math.abs(ev)<.005?0:ev)}`;
    $('#ev-state').textContent=({positive:'Positivo',negative:'Negativo',neutral:'Equilíbrio',pending:analysisBusy&&!data?'Calculando…':'Não calculado'})[tone];
    if(uncertain)$('#ev-state').textContent='Sinal incerto';
    $('#ev-state').classList.toggle('sr-only',!uncertain);
    const random=data?.ranges?.some(range=>range.kind==='UNIFORM');
    $('#ev-assumption').textContent=data?.status==='OK'
      ? `${random?'Mãos aleatórias':'Modelo informado'} · ${data.equity.opponents} adversário(s) · sem apostas futuras${$('#assumeNoRake').checked?' · rake zero':''}${ev==null?' · EV depende das premissas indicadas no cálculo':''}.`
      : note||data?.reason||'Complete as cartas para calcular.';
    if(interval)$('#ev-assumption').textContent+=` Faixa amostral 95%: ${money(interval[0])} a ${money(interval[1])} fichas${uncertain?' · atravessa zero':''}. Não cobre erro do range.`;
    if(envelope)$('#ev-assumption').textContent+=` Faixa condicional: ${money(envelope[0])} a ${money(envelope[1])} fichas. Depende das hipóteses de resposta.`;
    if(data?.scenarioSummary)$('#ev-assumption').textContent+=` Cenário ativo · ${data.scenarioSummary.totalSamples.toLocaleString('pt-BR')} simulações no total. No call, todos completam o preço.`;
    if(data?.status==='OK' && data.equity.opponents !== Number(value('players'))-1)$('#ev-assumption').textContent=`ATENÇÃO: calculado contra ${data.equity.opponents} dos ${Number(value('players'))-1} adversários da mesa. Faltam modelos dos demais. `+$('#ev-assumption').textContent;
    if($('#ev-critical-warning')) {
      const mismatch=data?.status==='OK'&&data.equity.opponents!==Number(value('players'))-1;
      $('#ev-critical-warning').textContent=mismatch?`Cálculo cobre só ${data.equity.opponents} de ${Number(value('players'))-1} adversários.`:'';
      $('#ev-critical-warning').hidden=!mismatch;
    }
    if(data?.equity?.samplingMode==='ADAPTIVE')$('#ev-assumption').textContent+=` ${data.equity.samples.toLocaleString('pt-BR')} simulações · ${(data.equity.elapsedMs/1000).toFixed(2)} s · ${({PRECISION:'precisão atingida',CALL_EV_SIGN:'sinal do EV call separado de zero',TIME_BUDGET:'limite de tempo',SAMPLE_LIMIT:'limite de amostras'})[data.equity.stopReason]}.`;
    $('#ev-alternatives').innerHTML=data?.status==='OK'?['FOLD','CALL','CHECK','BET','RAISE'].filter(a=>data.ev?.actions?.[a]?.legal).map(a=>{const item=data.ev.actions[a],n=item.status==='MODELED'?item.ev:null;return `<span>${a}<b class="${n>0?'positive':n<0?'negative':''}">${n==null?'—':(n>0?'+':'')+money(n)}</b></span>`;}).join(''):'';
  }
  function scheduleAnalysis() {
    clearTimeout(analysisTimer);
    if(!loaded||activeView!=='analyze'||!$('#auto-analysis').checked)return;
    analysisTimer=setTimeout(()=>{
      if(analysisBusy){analysisQueued=true;return;}
      try{buildAnalysisPayload();}catch(error){quickAction(null,error.message);return;}
      analyze();
    },350);
  }
  function invalidateAnalysis() {
    inputRevision += 1; lastAnalysis = null;
    document.dispatchEvent(new CustomEvent('theibs:analysis-invalidated'));
    renderEngineDetails();
    result.classList.add('hidden'); emptyState.classList.remove('hidden');
    quickAction(null, 'Atualize a análise.'); renderCharts();
    analysisController?.abort(); scheduleAnalysis();
  }
  function applyAppearance(deck, felt) {
    if (['classico', 'cores'].includes(deck)) document.body.dataset.deck = deck;
    if (['roxo', 'verde', 'azul', 'preto'].includes(felt)) document.body.dataset.felt = felt;
    for (const key of ['deck', 'felt']) document.querySelectorAll(`button[data-${key}]`).forEach((button) => {
      const selected = button.dataset[key] === document.body.dataset[key];
      button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
    });
  }
  function buildAnalysisPayload() {
    if(multiway){
      if(multiwayBusy)throw Error('Atualizando a rodada.');
      const canonical=cards.canonicalForSubmit();
      if(JSON.stringify(canonical.heroCards)!==JSON.stringify(multiway.config.heroCards))throw Error('Confirme suas cartas antes de analisar.');
      if(!multiwayAnalysis?.available)throw Error(multiwayAnalysis?.reasons?.map(r=>r.message).join(' ')||'Aguardando sua vez.');
      const adaptive=value('samples')==='adaptive';
      return {...canonical,multiway,unknownOpponentModel:value('opponentModel'),samples:adaptive?50000:value('samples'),...(adaptive?{samplingMode:'ADAPTIVE'}:{}),seed:value('seed')||'42',rake:value('rake'),assumeNoRake:$('#assumeNoRake').checked,futureStreetModel:{type:'SHOWDOWN_ONLY'}};
    }
    const canonical = cards.canonicalForSubmit();
    const parse = (text) => window.TheibsCards.parsePortugueseCards(text).map(window.TheibsCards.toCanonical);
    const opponentHand = parse(value('opponentHand'));
    if (opponentHand.length && opponentHand.length !== cards.state.count) throw new Error(`A mão adversária precisa de ${cards.state.count} cartas.`);
    if (opponentHand.length && new Set([...canonical.heroCards, ...canonical.board, ...opponentHand]).size !== canonical.heroCards.length + canonical.board.length + opponentHand.length) throw new Error('Carta adversária duplicada entre a mão, o board e o oponente.');
    const ranges = value('opponentRange').split(/\n|\|/).map((line) => line.trim()).filter(Boolean).map(parse);
    if (ranges.some((hand) => hand.length !== cards.state.count)) throw new Error(`Cada linha do range deve conter ${cards.state.count} cartas.`);
    const payload = { ...canonical,
      position: value('position'), players: value('players'), potBeforeAction: value('potBeforeAction'), amountToCall: value('amountToCall'), effectiveStack: value('effectiveStack'), samples: value('samples'), seed: value('seed') || '42',
      opponentHand: opponentHand.join(' '), opponentRange: ranges.map((h) => h.join(' ')).join('\n'),
      unknownOpponentModel: value('opponentModel'), futureStreetModel:{type:'SHOWDOWN_ONLY'},
      betSize: value('betSize'), raiseTo: value('raiseTo'), foldEquity: value('foldEquity'), continuationEquity: value('continuationEquity'), rake: value('rake'), assumeNoRake: $('#assumeNoRake').checked,
      opponentProfile: value('opponentProfile'), opponentProfileSource: value('opponentProfileSource'),
      opponentTendencies: { foldToBet: value('observedFoldToBet') || undefined, callFrequency: value('observedCallFrequency') || undefined, raiseFrequency: value('observedRaiseFrequency') || undefined, bluffFrequency: value('observedBluffFrequency') || undefined }
    };
    if(payload.samples==='adaptive'){payload.samples=50000;payload.samplingMode='ADAPTIVE';}
    if(value('study-mode')==='UNIFORM'){
      const n=Number(value('players'))-1;
      if(Array.from({length:n},(_,i)=>value('study-probability-'+i)).some(v=>v===''))throw Error('Preencha a chance de call de cada adversário nas premissas de raise.');
      payload.aggressionStudy={enabled:true,assumptionsAccepted:$('#study-accept').checked,heroContribution:value('study-hero-contribution'),minRaiseTo:value('study-min-raise'),minBet:value('study-min-bet'),opponents:Array.from({length:n},(_,i)=>({contribution:value('study-contribution-'+i),callProbability:Number(value('study-probability-'+i))/100}))};
    }
    return payload;
  }
  async function analyze(event) {
    event?.preventDefault(); if (analysisBusy) {analysisQueued=true;return;}
    let payload;
    try { payload = buildAnalysisPayload(); }
    catch (error) { const data = { status: 'NO_DECISION', reason: error.message }; renderResult(data, currentStreet()); quickAction(data); cards.announce(error.message, true); return; }
    const requestedRevision = inputRevision;
    analysisBusy = true; analysisController=new AbortController(); analyzeButton.disabled = true; $('#quick-analyze').disabled = true;
    analyzeButton.textContent = 'Calculando…'; $('#quick-analyze').textContent = 'Calculando…';
    quickAction(null, 'O motor está calculando esta mão…');
    try {
      const requestStarted=performance.now();
      const data = await requestJson('/api/analyze', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:analysisController.signal});
      data.clientTiming={elapsedMs:performance.now()-requestStarted,scope:'HTTP_RESPONSE_TO_UI'};
      if (requestedRevision !== inputRevision) { return; }
      renderResult(data, payload.street); quickAction(data);
      lastAnalysis = { signature: JSON.stringify(payload), data, street: payload.street };
      renderEngineDetails();
      if (data.status === 'OK') {
        const snapshot = { street: payload.street, equity: data.equity.equity, winRate: data.equity.winRate, method: data.equity.method, samples: data.equity.samples, action: data.recommendedAction, stale: false };
        const index = snapshots.findIndex((item) => item.street === payload.street);
        if (index >= 0) snapshots.splice(index, 1, snapshot); else snapshots.push(snapshot);
        renderStreetCards(); renderCharts(snapshot);
      } else renderCharts();
      scheduleSave();
    } catch (error) {
      if(error.name==='AbortError')return;
      if (requestedRevision === inputRevision) { const data = { status: 'ERROR', reason: `Não foi possível conectar ao motor local: ${error.message}` }; renderResult(data, payload.street); quickAction(data); }
    } finally {
      analysisBusy = false; analysisController=null; analyzeButton.disabled = false; $('#quick-analyze').disabled = false;
      analyzeButton.innerHTML = 'Analisar street <span>↗</span>'; $('#quick-analyze').innerHTML = 'Analisar mão <span>↗</span>';
      if(analysisQueued){analysisQueued=false;scheduleAnalysis();}
    }
  }
  async function newAnalysisHand(confirm = true) {
    if(multiwayBusy){toast('Aguarde o registro da ação antes de limpar a mão.');return;}
    if (confirm && (cards.state.slots.some(Boolean) || cards.isManualInvalid() || multiway?.events.length) && !window.confirm(multiway?'Começar outra mão Multiway e limpar as cartas e ações desta mão? A configuração da mesa será mantida.':'Limpar as cartas e análises da mão atual? O histórico salvo e as configurações serão preservados.')) return;
    if(multiway){try{await startMultiway({...multiway.config,heroCards:[]});}catch(error){toast(error.message);}return;}
    snapshots.splice(0); cards.reset(); invalidateAnalysis(); updateBoardHelp(); renderStreetCards(); renderCharts();
    quickAction(null); scheduleSave();
  }
  function showView(view, save = true) {
    if (!['analyze', 'train', 'history'].includes(view)) return;
    activeView = view;
    document.body.dataset.view=view;
    $('.analysis-rail').classList.toggle('hidden', view !== 'analyze');
    ['analyze', 'train', 'history'].forEach((name) => document.getElementById(`${name}-workspace`).classList.toggle('hidden', name !== view));
    document.querySelectorAll('.nav-tab').forEach((button) => {
      const selected = button.dataset.view === view; button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    $('#view-title').textContent = { analyze: 'Análise da mão', train: 'Prática e revisão', history: 'Histórico de treino' }[view];
    if (view === 'history') renderHistory();
    if (view === 'train') renderTrainingSession();
    if (save) scheduleSave();
  }

  // ---- Same guided/challenge, coaching, legal-action and review flows as Theibs. ----
  function trainingCalculation(context = {}, notes = []) {
    const candidates=context.trainingEvaluation?.candidates;
    const rows=Array.isArray(candidates)&&candidates.length?candidates:Object.entries(context.ev||{}).filter(([action])=>(context.legalActions||[]).includes(action)).map(([action,item])=>({...item,action}));
    const rowsHtml=rows.map(item=>{const amount=item.targetStreetTotal??item.size,ev=item.ev,bounds=item.confidenceInterval95||item.conditionalEvEnvelope;return `<tr><td>${esc(actionWithSize(item.action,amount))}</td><td class="${ev>0?'positive':ev<0?'negative':''}">${ev==null?'—':(ev>0?'+':'')+money(ev)}</td><td>${bounds?esc(bounds.map(money).join(' a ')):'—'}</td></tr>`;}).join('');
    const details=[...new Set([...notes,...(context.assumptions||[]),...(context.warnings||[])])].filter(Boolean);
    return `<div class="training-calculation"><div class="training-calculation-metrics"><span>Equity <strong>${percent(context.equity?.value)}</strong></span><span>Para pagar <strong>${money(context.amountToCall)}</strong></span></div><table class="ev-table"><thead><tr><th>Opção avaliada</th><th>EV · fichas</th><th>Faixa estimada</th></tr></thead><tbody>${rowsHtml}</tbody></table><details><summary>Como foi calculado</summary>${details.map(text=>`<p>${esc(text)}</p>`).join('')}${context.equity?`<p>${esc(context.equity.samples)} simulações · equity ${percent(context.equity.value)}${context.equity.confidenceInterval95?' · faixa '+context.equity.confidenceInterval95.map(percent).join(' a '):''}.</p>`:''}</details></div>`;
  }
  function renderCoachAnswer(target, answer, context) {
    const summary=answer?.summary;
    if(!summary){target.textContent=answer?.answer||'Não foi possível explicar esta mão.';return;}
    const details=[...(summary.details||[]),...(answer.warning?[answer.warning]:[])];
    target.innerHTML=`<div class="coach-summary"><strong class="coach-headline">${esc(summary.headline||'Sua mão')}</strong>${summary.points?.length?`<ul class="coach-points">${summary.points.map(point=>`<li>${esc(point)}</li>`).join('')}</ul>`:''}<details class="coach-calculation"><summary>Ver cálculo e premissas</summary>${context?trainingCalculation(context,details):details.map(text=>`<p>${esc(text)}</p>`).join('')}</details></div>`;
  }
  function renderTrainingReview() {
    $('#training-review').innerHTML = trainingDecisions.length ? trainingDecisions.map((item) => {
      return `<details class="review-item"><summary><strong>${esc(streetName(item.context.street))}</strong> · ${esc(actionWithSize(item.chosenAction,item.chosenSize))}</summary><p>${esc(qualityName(item.quality.label))}${item.quality.evLoss == null ? '' : ` · diferença de EV ${money(item.quality.evLoss)} fichas`}</p>${trainingCalculation(item.context,item.summary?.details||[])}</details>`;
    }).join('') : 'Nenhuma decisão registrada nesta mão.';
  }
  function renderTrainingSession() {
    $('#training-table').innerHTML = window.EssenceUI.trainingTable(trainingSession, cards.state.count);
    const playable = trainingSession && !trainingSession.finished;
    $('#training-actions').classList.toggle('hidden', !playable);
    if (playable) {
      $('#training-legal').textContent = '';
      $('#training-action-buttons').innerHTML = trainingSession.legalActions.map((action) => `<button type="button" data-action="${esc(action)}" ${trainingBusy ? 'disabled' : ''}>${esc(actionName(action))}</button>`).join('');
    const sizeInput = $('#training-size');
      const hasSize = trainingSession.legalActions.some((action) => ['BET', 'RAISE'].includes(action));
      $('.size-field').classList.toggle('hidden', !hasSize);
      sizeInput.min = trainingSession.minSize ?? 1; sizeInput.max = trainingSession.maxSize ?? 1;
      sizeInput.value = trainingSession.minSize ?? 1;
      $('#training-size-help').textContent = hasSize ? `Total nesta rodada: ${trainingSession.minSize} a ${trainingSession.maxSize}.` : '';
      const sizes=(trainingSession.sizeCandidates||[]).map(item=>typeof item==='object'?item.size:item).filter(Number.isFinite);
      $('#training-size-presets').innerHTML=hasSize?sizes.map(size=>`<button type="button" class="ghost-button" data-training-size="${esc(size)}" ${trainingBusy?'disabled':''}>${esc(money(size))}</button>`).join(''):'';
    }
    renderTrainingReview();
  }
  function showTrainingFeedback(feedback) {
    const target = $('#training-feedback'); target.classList.remove('hidden');
    const qualityLabel=qualityName(feedback.quality.label);
    target.innerHTML = `<div class="training-feedback-head"><span class="result-label">Sua decisão · ${esc(streetName(feedback.context.street))}</span><button type="button" class="text-button" id="open-training-details">Ver cálculo</button></div><strong class="feedback-action">${esc(actionWithSize(feedback.chosenAction,feedback.chosenSize))}</strong><p>${esc(qualityLabel)}</p>${feedback.summary?.headline&&feedback.summary.headline!==qualityLabel?`<p class="feedback-conclusion">${esc(feedback.summary.headline)}</p>`:''}`;
    $('#training-details-text').innerHTML=trainingCalculation(feedback.context,feedback.summary?.details||[feedback.note].filter(Boolean));
    $('#open-training-details').onclick=()=>$('#training-details-dialog').showModal();
  }
  function setTrainingBusy(busy) {
    trainingBusy = busy;
    $('#training-clear').disabled = busy;
    $('#training-start').disabled = busy; $('#training-ask').disabled = busy;
    $('#training-size').disabled = busy;
    document.querySelectorAll('#training-action-buttons button,#training-size-presets button').forEach((item) => { item.disabled = busy; });
  }
  async function startTraining() {
    if (trainingBusy) return;
    if (trainingSession && !trainingSession.finished && !window.confirm('A mão simulada ainda está ativa. Iniciar outra? Decisões já registradas continuam no histórico.')) return;
    setTrainingBusy(true);
    try {
      const data = await postJson('/api/training/start', { variant: `PLO${cards.state.count}_HIGH`, mode: value('training-mode'), opponentStyle: value('training-style'), targetStreet: value('training-street'), seed: Number(value('training-seed')), startingStack: Number(value('training-stack')) });
      trainingSession = data.session; trainingDecisions = [];
      $('#training-feedback').classList.add('hidden'); $('#training-coach').textContent = '';
      renderTrainingSession(); scheduleSave();
    } catch (error) { $('#training-coach').textContent = error.message; toast(error.message); }
    finally { setTrainingBusy(false); }
  }
  async function actTraining(action) {
    if (!trainingSession || trainingSession.finished || trainingBusy) return;
    const sessionId = trainingSession.id; setTrainingBusy(true);
    try {
      const data = await postJson('/api/training/act', { sessionId, revision:trainingSession.revision, action, ...(trainingSession.legalActions.some(candidate=>['BET','RAISE'].includes(candidate)) ? { size: Number(value('training-size')) } : {}) });
      if (trainingSession?.id !== sessionId) return;
      trainingSession = data.session; trainingDecisions.push(data.feedback);
      showTrainingFeedback(data.feedback); renderTrainingSession(); $('#training-coach').textContent = ''; scheduleSave();
    } catch (error) { $('#training-coach').textContent = error.message; }
    finally { setTrainingBusy(false); }
  }
  async function askCoach() {
    const target = $('#training-coach');
    if (!trainingSession || trainingSession.finished) { target.textContent = 'Inicie uma mão ativa para perguntar sobre a decisão atual.'; return; }
    if (trainingBusy) return;
    setTrainingBusy(true); target.textContent = 'Analisando a dúvida…';
    try {
      const data = await postJson('/api/training/doubt', { sessionId: trainingSession.id, revision:trainingSession.revision, question: value('training-question'),...(trainingSession.legalActions.some(action=>['BET','RAISE'].includes(action))?{size:Number(value('training-size'))}:{}) });
      if(data.status==='LOCKED')target.textContent=data.reason;else renderCoachAnswer(target,data.answer,data.context);
      if (data.answer) $('#coach-provider').textContent = data.answer.provider === 'ollama' ? 'Llama · fatos calculados' : 'Treinador local';
    } catch (error) { target.textContent = error.message; }
    finally { setTrainingBusy(false); }
  }
  async function renderHistory() {
    try {
      const data = await requestJson('/api/training/history'), summary = data.summary;
      $('#history-summary').innerHTML = [['Mãos simuladas', summary.hands], ['Vitórias / derrotas', `${summary.wins} / ${summary.losses}`], ['Dúvidas registradas', summary.doubts], ['Diferença média de EV', summary.averageEvLoss == null ? '—' : money(summary.averageEvLoss)]].map(([label, number]) => `<div class="panel">${esc(label)}<strong>${esc(number)}</strong></div>`).join('');
      const timeline = data.outcomeTimeline || [];
      let cumulative = 0; const totals = timeline.map((item) => { cumulative += Number(item.net) || 0; return cumulative; });
      if (totals.length) {
        const low = Math.min(0, ...totals), high = Math.max(0, ...totals), span = Math.max(1, high - low);
        const points = totals.map((number, index) => `${20 + (totals.length === 1 ? 150 : index * 300 / (totals.length - 1))},${145 - (number - low) * 120 / span}`).join(' ');
        $('#history-outcomes').innerHTML = `<h3>Resultado acumulado · fichas fictícias</h3><svg class="history-svg" viewBox="0 0 340 165" role="img" aria-label="Linha de resultados acumulados"><line x1="20" y1="145" x2="320" y2="145" stroke="currentColor" opacity="0.1"/><polyline points="${esc(points)}" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round"/></svg><div class="history-legend">${timeline.length} mão(s) · saldo ${money(cumulative)}. Esta linha não mede qualidade de decisão.</div>`;
      } else $('#history-outcomes').innerHTML = '<h3>Resultado acumulado</h3><p class="muted">Conclua uma mão simulada para iniciar a linha do tempo.</p>';
      $('#history-recent').innerHTML = `<h3>Últimas 20 decisões</h3>${data.recent.length ? data.recent.map((item) => `<details class="history-hand"><summary><span class="history-hand-cards">${(item.heroCards || []).map((c) => window.EssenceUI.canonicalCard(c, { small: true })).join('')}</span><span class="history-hand-meta">${esc(item.variant?.replace('_HIGH', '') || 'PLO5')} · ${esc(streetName(item.street))}</span><span class="history-hand-action">${esc(actionWithSize(item.chosenAction,item.chosenSize))}</span></summary><div><p>Sua ação: <strong>${esc(actionWithSize(item.chosenAction,item.chosenSize))}</strong> · maior EV calculado: <strong>${esc(actionWithSize(item.recommendedAction,item.recommendedSize))}</strong></p><p>${esc(qualityName(item.quality))}${item.evLoss == null ? '' : ` · diferença de EV ${money(item.evLoss)} fichas`}</p><p class="micro">${esc(new Date(item.timestamp).toLocaleString('pt-BR'))} · ${esc(item.position || 'Posição não registrada')}</p></div></details>`).join('') : '<p class="muted">Ainda não há decisões registradas.</p>'}`;
      $('#history-trends').innerHTML = `<h3>Tendências do simulador</h3>${data.trends.map((item) => `<div class="trend-row"><strong>${esc(({ PASSIVE: 'Passivo', AGGRESSIVE: 'Agressivo', MIXED: 'Misto' })[item.opponentStyle])}</strong><p>Apostas ${item.observedBets}/${item.opportunities} · taxa suavizada ${percent(item.smoothedBetRate)} · confiança ${esc(item.confidence)}</p></div>`).join('')}<p class="micro">Dados do oponente simulado, não de jogadores reais. A amostra e o modelo limitam as conclusões.</p><hr><p class="micro">Próximo exercício: ${esc(summary.nextExercise?.street || 'aguardando dados')}. ${esc(summary.nextExercise?.reason || '')}</p>${summary.nextExercise ? `<button id="practice-suggestion" class="ghost-button" type="button" data-street="${esc(summary.nextExercise.street)}">Praticar esta street →</button>` : ''}`;
      if(data.observedHands?.length) $('#history-recent').insertAdjacentHTML('afterbegin', '<h3>Mãos acompanhadas</h3>'+data.observedHands.map(event=>{
        const hand=event.hand, hero=hand.state.players[hand.state.heroId];
        return `<details class="history-hand"><summary>${esc(new Date(event.timestamp).toLocaleString('pt-BR'))} · ${esc(hand.config.variant)} · ${hand.config.playerCount} jogadores</summary><p>Você: ${esc(hero.position)} · stack final ${money(hero.stack)}. Ações e resultado informados pelo usuário.</p><pre>${esc(JSON.stringify(hand.events,null,2))}</pre></details>`;
      }).join(''));
    } catch (error) { $('#history-summary').innerHTML = `<div class="panel warning-text">Histórico indisponível: ${esc(error.message)}</div>`; }
  }

  // ---- Persistent workspace is server-side: a random desktop port cannot lose it. ----
  function serializeWorkspace() {
    const fields = Object.fromEntries(FIELD_IDS.map((id) => { const el = document.getElementById(id); return [id, el.type === 'checkbox' ? el.checked : el.value]; }));
    return { schemaVersion: 1, keyboard: cards.state.snapshot(), manualText: cards.manualDraft(), fields,
      ui: { felt: document.body.dataset.felt, deck: document.body.dataset.deck, view: activeView, cardDisplayVersion: 2, workflowVersion: 1, sidebarCollapsed: document.body.dataset.sidebar === 'collapsed' },
      handFlow:null, legacyHandFlow, multiway, multiwaySimple,
      snapshots: [...snapshots], lastAnalysis, trainingSessionId: trainingSession?.id || null };
  }
  function scheduleSave() {
    if (!loaded || saveBlocked) return;
    saveDirty = true; $('#save-status').textContent = 'Alterações pendentes…';
    clearTimeout(saveTimer); saveTimer = setTimeout(() => flushSave(), 300);
  }
  async function flushSave(keepalive = false) {
    clearTimeout(saveTimer);
    if (!loaded || saveBlocked || saveBusy || !saveDirty) return;
    saveBusy = true; saveDirty = false; $('#save-status').textContent = 'Salvando localmente…';
    try {
      const data = await postJson('/api/workspace', { workspace: serializeWorkspace(), expectedRevision: revision }, keepalive);
      revision = data.revision;
      $('#save-status').textContent = `Salvo localmente · ${new Date(data.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      saveDirty = true; $('#save-status').textContent = 'Rascunho não salvo';
      if (error.status === 409) { saveBlocked = true; toast(error.message); }
      else $('#save-status').title = error.message;
    } finally {
      saveBusy = false;
      if (saveDirty && !saveBlocked) { clearTimeout(saveTimer); saveTimer = setTimeout(() => flushSave(), 2000); }
    }
  }
  async function initialize() {
    const initialRevision = inputRevision;
    try {
      const saved = await requestJson('/api/workspace'); revision = saved.revision;
      const editedBeforeLoad = inputRevision !== initialRevision;
      const workspace = saved.workspace;
      if (workspace && inputRevision === initialRevision) {
        for (const id of FIELD_IDS) {
          const el = document.getElementById(id), savedValue = workspace.fields?.[id];
          if (savedValue === undefined) continue;
          if (el.type === 'checkbox') el.checked = savedValue === true;
          else if (['string', 'number'].includes(typeof savedValue)) el.value = String(savedValue);
        }
        if (!cards.restore(workspace.keyboard)) throw new Error('Rascunho de cartas inválido. O arquivo foi preservado.');
        cards.restoreManualDraft(workspace.manualText);
        for (const item of (workspace.snapshots || []).slice(0, 4)) if (['PREFLOP','FLOP','TURN','RIVER'].includes(item.street) && Number.isFinite(item.equity)) snapshots.push(item);
        // Enable the requested four-suit palette once for existing drafts.
        // Subsequent changes to the deck selector remain the user's choice.
        applyAppearance((workspace.ui?.cardDisplayVersion || 0) < 2 ? 'cores' : workspace.ui?.deck, workspace.ui?.felt);
        window.theibsFocusUI.restore(workspace.ui?.sidebarCollapsed !== false);
        if(!workspace.ui?.workflowVersion&&!workspace.fields?.rake) $('#assumeNoRake').checked=true;
        legacyHandFlow=workspace.legacyHandFlow||workspace.handFlow||null;
        if(workspace.multiway?.enabled){multiwaySimple=workspace.multiwaySimple||null;await runMultiway(()=>postJson('/api/multiway/state',{multiway:workspace.multiway}));}
        updateTableContext(); updateBoardHelp(); renderStreetCards();
        try {
          if (workspace.lastAnalysis?.data?.engineBuild === '0.10.0' && workspace.lastAnalysis.signature === JSON.stringify(buildAnalysisPayload())) {
            lastAnalysis = workspace.lastAnalysis; renderResult(lastAnalysis.data, lastAnalysis.street); quickAction(lastAnalysis.data);
            renderCharts(snapshots.find((item) => item.street === lastAnalysis.street && !item.stale));
          }
        } catch { /* Incomplete drafts intentionally have no current recommendation. */ }
        if (workspace.trainingSessionId) {
          try {
            const reviewed = await postJson('/api/training/review', { sessionId: workspace.trainingSessionId });
            trainingSession = reviewed.session;
            trainingDecisions = reviewed.decisions.map((item) => ({ chosenAction: item.chosenAction, chosenSize:item.chosenSize, recommendedAction: item.recommendedAction, context: item.context, summary:item.summary, quality: item.qualityDetails || { label: item.quality, evLoss: item.evLoss } }));
            if (trainingDecisions.length) showTrainingFeedback(trainingDecisions.at(-1));
          } catch { $('#training-coach').textContent = 'A sessão ativa anterior terminou com o servidor. As decisões registradas continuam no Histórico. Inicie outra mão para treinar.'; }
        }
        showView(workspace.ui?.view || 'analyze', false);
        $('#save-status').textContent = 'Rascunho restaurado';
      } else $('#save-status').textContent = 'Pronto para salvar localmente';
      loaded = true;
      if (editedBeforeLoad || (workspace && ((workspace.ui?.cardDisplayVersion || 0) < 2 || !workspace.ui?.workflowVersion))) scheduleSave();
      scheduleAnalysis();
    } catch (error) {
      saveBlocked = true; loaded = true; $('#save-status').textContent = 'Rascunho indisponível'; toast(error.message);
    }
    priorHero = cards.state.slots.slice(0, cards.state.count).join('|');
    renderMultiway();
    window.theibsCardPicker.close();
    renderTrainingSession();
    try {
      const status = await requestJson('/api/status');
      engineStatus=status;renderEngineDetails();
      $('#engine-status').innerHTML = '<i></i>Motor local';
      $('#coach-provider').textContent = status.llmProvider === 'ollama' ? `Ollama configurado · ${status.llmModel || 'modelo não definido'} · disponibilidade verificada ao perguntar` : 'Explicação local · Ollama opcional';
    } catch { $('#engine-status').textContent = 'Motor indisponível'; }
  }

  form.addEventListener('submit', analyze);
  document.addEventListener('theibs:layout-preference', scheduleSave);
  form.addEventListener('input', (event) => {
    if (['heroCards','board','paste-cards'].includes(event.target.id)) return;
    invalidateAnalysis(); updateTableContext(); scheduleSave();
  });
  form.addEventListener('change', (event) => {
    if (['heroCards','board','paste-cards'].includes(event.target.id)) return;
    invalidateAnalysis(); updateTableContext(); scheduleSave();
  });
  document.addEventListener('theibs:cards-changed', (event) => {
    if(syncingMultiway)return;
    if(multiwayBusy&&multiwayCardSnapshot){syncingMultiway=true;cards.restore(multiwayCardSnapshot);syncingMultiway=false;renderMultiway();return;}
    if(multiway){
      const board=cards.state.cards().board.map(window.TheibsCards.toCanonical);
      if(JSON.stringify(board)!==JSON.stringify(multiwayState.board))syncMultiwayCards();
      if(cards.state.selected>=cards.state.count)cards.select(cards.state.count-1);
      renderMultiway();
      const privateCards=cards.state.cards().hero.map(window.TheibsCards.toCanonical);
      multiway={...multiway,config:{...multiway.config,heroCards:privateCards.length===cards.state.count?privateCards:[]}};
      multiwayAnalysis={available:false,reasons:[{message:'Atualizando suas cartas.'}]};
      invalidateAnalysis();
      clearTimeout(multiwayCardTimer);const requested=++multiwayRevision;
      multiwayCardTimer=setTimeout(async()=>{try{const data=await postJson('/api/multiway/state',{multiway});if(requested===multiwayRevision&&multiway)acceptMultiway(data);}catch(error){if(requested===multiwayRevision)toast(error.message);}},180);
      scheduleSave();
      return;
    }
    const hero = cards.state.slots.slice(0, cards.state.count).join('|');
    if (priorHero && hero !== priorHero) snapshots.forEach((item) => { item.stale = true; });
    priorHero = hero;
    if(event.detail.source==='variant')$('#players').value=String(({6:5,5:6})[cards.state.count]||6);
    invalidateAnalysis(); updateTableContext(); renderMultiway();updateBoardHelp(); renderStreetCards();
    if (event.detail.source === 'variant' && !trainingSession) renderTrainingSession();
    scheduleSave();
  });
  document.querySelectorAll('.street-tab').forEach((button) => button.addEventListener('click', () => {
    if(multiway){toast('Revele a próxima rodada pelo controle Multiway.');return;}
    cards.select(({ PREFLOP: 0, FLOP: cards.state.count, TURN: cards.state.count + 3, RIVER: cards.state.count + 4 })[button.dataset.street]);
    toast(`Entrada selecionada: ${streetName(button.dataset.street)}. A street analisada é definida pelo board preenchido.`);
  }));
  $('#new-hand').addEventListener('click', () => { if (activeView === 'train') startTraining(); else { showView('analyze'); newAnalysisHand(); } });
  $('#clear').addEventListener('click', () => newAnalysisHand());
  // A modifier is a shortcut only on release, if it was never part of a chord.
  const heldHandKeys=new Set();let soloHandShift=null;
  const handShortcutAllowed=target=>loaded&&activeView==='analyze'&&!multiwayBusy&&!document.querySelector('dialog[open]')&&
    !(target instanceof Element&&target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
  const cancelHandShift=()=>{soloHandShift=null;};
  document.addEventListener('keydown',event=>{
    const code=event.code||event.key;
    const solo=event.key==='Shift'&&!event.repeat&&!event.isComposing&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&heldHandKeys.size===0&&handShortcutAllowed(event.target);
    soloHandShift=solo?code:null;heldHandKeys.add(code);
  },true);
  document.addEventListener('keyup',event=>{
    const code=event.code||event.key;heldHandKeys.delete(code);
    if(event.key!=='Shift')return;
    const reset=soloHandShift===code&&heldHandKeys.size===0&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.isComposing&&handShortcutAllowed(event.target)&&handShortcutAllowed(document.activeElement);
    cancelHandShift();
    if(reset){event.preventDefault();cards.cancelPending();void newAnalysisHand(false);}
  },true);
  document.addEventListener('pointerdown',cancelHandShift,true);
  document.addEventListener('focusin',()=>{if(!handShortcutAllowed(document.activeElement))cancelHandShift();});
  window.addEventListener('blur',()=>{cancelHandShift();heldHandKeys.clear();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){cancelHandShift();heldHandKeys.clear();}});
  $('#new-hand').title='Nova mão · Shift sozinho em Analisar';
  $('#clear').title='Limpar cartas · Shift sozinho em Analisar';
  const shiftKeyHelp=document.createElement('dt');shiftKeyHelp.textContent='Shift sozinho';
  const shiftHelp=document.createElement('dd');shiftHelp.textContent='Nova mão em Analisar, sem confirmação: limpa suas cartas e o board. No Multiway, zera também as ações e mantém a mesa. Combinações como Shift+letra e Shift+Tab continuam normais.';
  $('.shortcut-list').prepend(shiftKeyHelp,shiftHelp);
  document.querySelectorAll('.nav-tab').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  document.querySelectorAll('[data-open-history]').forEach((button) => button.addEventListener('click', () => showView('history')));
  document.querySelectorAll('button[data-deck],button[data-felt]').forEach((button) => button.addEventListener('click', () => { applyAppearance(button.dataset.deck, button.dataset.felt); scheduleSave(); }));
  for (const id of FIELD_IDS.filter((id) => id.startsWith('training-'))) document.getElementById(id).addEventListener('change', scheduleSave);
  $('#training-start').addEventListener('click', startTraining);
  $('#training-clear').addEventListener('click', () => {
    if(trainingBusy)return;
    if(trainingSession&&!trainingSession.finished&&!window.confirm('Limpar as cartas e encerrar este treino? As decisões já registradas continuam no Histórico.'))return;
    trainingSession=null;trainingDecisions=[];
    $('#training-feedback').classList.add('hidden');$('#training-coach').textContent='';$('#training-question').value='';
    renderTrainingSession();scheduleSave();toast('Treino limpo. Clique em Nova mão simulada para receber outras cartas.');
  });
  $('#training-action-buttons').addEventListener('click', (event) => { const button = event.target.closest('button[data-action]'); if (button && !button.disabled) actTraining(button.dataset.action); });
  $('#training-ask').addEventListener('click', askCoach);
  $('#training-size').addEventListener('input',()=>{if($('#training-coach').textContent)$('#training-coach').textContent='Tamanho alterado. Peça uma nova análise.';});
  $('#refresh-history').addEventListener('click', renderHistory);
  $('#history-trends').addEventListener('click', (event) => { const button = event.target.closest('#practice-suggestion'); if (button) { $('#training-street').value = button.dataset.street; showView('train'); startTraining(); } });
  $('#import-button').addEventListener('click', async () => {
    const output = $('#import-result'), button = $('#import-button'); button.disabled = true;
    try {
      const hands = JSON.parse(value('import-json'));
      const metadata = { source: value('import-source'), rights: value('import-rights'), rightsConfirmed: $('#import-confirm').checked };
      const data = await postJson('/api/import', { hands, metadata });
      output.textContent = `${data.accepted} mão(s) importada(s). ${data.rejected.length} rejeitada(s). ${data.rejected.map((item) => `#${item.index + 1}: ${item.reason}`).join(' ')}`;
      await renderHistory();
    } catch (error) { output.textContent = `Importação não concluída: ${error.message}`; }
    finally { button.disabled = false; }
  });
  $('#open-help').addEventListener('click', () => $('#help-dialog').showModal());
  $('#close-help').addEventListener('click', () => $('#help-dialog').close());
  document.addEventListener('keydown', (event) => { if (event.key === 'F1') { event.preventDefault(); if (!$('#help-dialog').open) $('#help-dialog').showModal(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(true); });
  document.addEventListener('theibs:llm-updated', event => {
    engineStatus={...engineStatus,llmProvider:event.detail.provider,llmModel:event.detail.model};renderEngineDetails();
    $('#coach-provider').textContent=event.detail.provider==='ollama'?`Llama · ${event.detail.model} · sob demanda`:'Explicação local';
  });
  window.addEventListener('beforeunload', (event) => { if (saveDirty || saveBusy) { event.preventDefault(); event.returnValue = ''; } });
  const setupHost=document.createElement('section');setupHost.id='multiway-setup';$('#settings-dialog .dialog-content').prepend(setupHost);
  const nutsBadge=document.createElement('div');nutsBadge.id='nuts-badge';nutsBadge.className='nuts-badge';nutsBadge.hidden=true;nutsBadge.innerHTML='<span class="nuts-dot" aria-hidden="true"></span><span class="nuts-label">NUTS</span>';nutsBadge.setAttribute('role','status');nutsBadge.setAttribute('aria-label','Nuts: melhor mão possível no board atual. Pode empatar.');nutsBadge.title='Melhor mão possível no board atual. Pode empatar; próximas cartas podem mudar a mão.';$('#analyze-workspace .insight-panel').after(nutsBadge);
  const controlsHost=document.createElement('section');controlsHost.id='multiway-controls';$('.quick-decision').before(controlsHost);
  window.theibsMultiwayUI.init({getContext:multiwayContext,handlers:{start:startMultiway,act:event=>stepMultiway({type:'ACT',...event}),markFold:event=>stepMultiway({type:'MARK_FOLD',...event}),board:event=>stepMultiway({type:'BOARD',...event}),undo:()=>runMultiway(()=>postJson('/api/multiway/state',{multiway:{...multiway,events:multiway.events.slice(0,-1)}})),exit:exitMultiway}});
  updateTableContext(); renderMultiway();renderStreetCards(); renderCharts(); updateBoardHelp(); renderTrainingSession();
  window.theibsApp = { ready: initialize(), getState: () => ({ activeView, analysisBusy, trainingBusy, lastAnalysis, trainingSession, multiway,multiwayState,multiwayAnalysis,multiwayBusy,snapshots: [...snapshots], saveBusy, saveDirty, saveBlocked }), flushSave, showView, getAnalysisInput: buildAnalysisPayload, renderCoachAnswer };
})();
