/* Three separate readouts of the SAME engine response. No numerical engine,
 * hidden opponent assumptions or AI-generated probabilities in the browser. */
(function () {
  'use strict';
  const $=id=>document.getElementById(id), panel=document.querySelector('#analyze-workspace .insight-panel');
  if(!panel)return;
  const note=document.createElement('p');note.id='statistics-model';note.className='micro';
  const precision=document.createElement('p');precision.id='statistics-precision';precision.className='micro';
  const split=document.createElement('p');split.id='statistics-split';split.className='micro';
  panel.append(note,precision,split);
  const percent=n=>Number.isFinite(n)?(100*n).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%':'—';
  function clear(){note.textContent='Modelo: adversários com cartas aleatórias, salvo hipóteses manuais aplicadas.';precision.textContent='Aguardando cálculo; custos não são necessários para equity.';split.textContent='';}
  function render(data){
    const stats=data?.statistics;if(!stats){clear();return;}
    note.textContent=stats.model.statement;
    precision.textContent=`${stats.equity.method==='EXACT'?'Enumeração exata':'Simulação Monte Carlo'} · ${stats.equity.samples} resultados${stats.equity.bounds?' · '+stats.equity.bounds.map(percent).join(' a '):''}. ${stats.model.modelWarning}`;
    split.textContent=`Vitória sem empate: ${percent(stats.outcomes.outrightWin)} · Empate: ${percent(stats.outcomes.tie)} · Derrota: ${percent(stats.outcomes.loss)}. Equity inclui divisão do pote.`;
    if(data.analysisScope==='STATISTICS_ONLY'){$('quick-action').textContent='Estatística disponível';$('quick-action-note').textContent='Informe o preço e os custos apenas para avaliar o CALL.';}
    // The old alternatives table contains point estimates, not interval-based
    // signals. Leave those numbers neutral instead of manufacturing green EV.
    for(const element of document.querySelectorAll('#ev-alternatives .positive,#ev-alternatives .negative,#result .ev-number.positive'))element.classList.remove('positive','negative');
  }
  document.addEventListener('theibs:analysis-painted',event=>{
    if(event.detail?.phase!=='FINAL'){clear();return;}
    render(window.theibsApp?.getState()?.lastAnalysis?.data);
  });
  document.addEventListener('theibs:analysis-invalidated',clear);
  window.theibsApp?.ready?.then(()=>render(window.theibsApp.getState().lastAnalysis?.data));
  clear();
})();
