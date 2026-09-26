(function () {
  'use strict';
  const $=s=>document.querySelector(s), form=$('#analysis-form');
  $('#samples').prepend(new Option('Adaptativo · alvo de até 3 s','adaptive'));
  const opponentsBar=document.createElement('div');opponentsBar.className='analysis-context-bar';
  opponentsBar.innerHTML='<label for="opponent-count">Adversários na mão <select id="opponent-count"></select></label><span id="opponent-total" class="sr-only"></span>';
  $('#analyze-workspace .table-column').prepend(opponentsBar);
  for(const event of ['input','change'])$('#opponent-count').addEventListener(event,()=>{$('#players').value=Number($('#opponent-count').value)+1;});
  document.body.dataset.view='analyze';
  function dialog(id,title) {
    const el=document.createElement('dialog');el.id=id;el.className='dashboard-dialog';
    el.innerHTML=`<div class="dialog-head"><h2>${title}</h2><button type="button" class="ghost-button" data-close-dialog>Fechar</button></div><div class="dialog-content"></div>`;
    form.append(el);el.querySelector('[data-close-dialog]').onclick=()=>el.close();return el;
  }
  const settings=dialog('settings-dialog','Mesa e premissas do cálculo');
  // Keep rules in Help; the main rail contains only the variant selection.
  $('#help-dialog').append($('#variant-help'));
  $('#selected-card-label').classList.add('sr-only');
  $('.table-meta').classList.add('sr-only');
  const appearance=$('.appearance-section');
  for(const [id,label] of [['deck-options','Baralho'],['felt-options','Feltro']]) {
    const heading=appearance.querySelector('.eyebrow'),controls=appearance.querySelector('.segmented');
    const disclosure=document.createElement('details');disclosure.id=id;disclosure.className='appearance-options';
    const summary=document.createElement('summary');summary.textContent=label;disclosure.append(summary,controls);heading.remove();appearance.append(disclosure);
  }
  $('#analysis-form .context-rail').querySelectorAll('.controls-panel,.form-actions').forEach(el=>settings.querySelector('.dialog-content').append(el));
  const entry=dialog('entry-dialog','Colar ou editar as cartas');entry.querySelector('.dialog-content').append($('.raw-entry'));$('.raw-entry').open=true;
  const result=dialog('analysis-dialog','Cálculo e histórico por rodada');
  for(const el of [$('#empty-state'),$('#result'),$('.timeline-card')])result.querySelector('.dialog-content').append(el);
  const bar=document.createElement('div');bar.className='dashboard-tools';
  bar.innerHTML='<button id="open-settings" type="button" class="ghost-button">Configurar mesa</button><button id="open-analysis" type="button" class="ghost-button">Ver cálculo</button><button id="open-engine" type="button" class="ghost-button">Assistente</button>';
  $('.top-actions').prepend(bar);$('#open-settings').onclick=()=>settings.showModal();$('#open-analysis').onclick=()=>result.showModal();
  const engine=dialog('engine-dialog','Assistente da mão');document.body.append(engine);
  engine.querySelector('.dialog-content').innerHTML=`<section id="llama-controls" aria-label="Assistente e modelo local">
    <p id="llama-status" role="status">Consultando o assistente local…</p>
    <details id="llama-setup"><summary>Modelo e conexão</summary>
      <div class="llama-model-row"><label for="llama-model">Modelo local<select id="llama-model"><option value="">Consultar modelos disponíveis</option></select></label><button id="llama-refresh" type="button" class="ghost-button">Atualizar</button><button id="llama-connect" type="button" class="primary-button">Conectar</button></div>
      <details class="llama-advanced"><summary>Endereço do Ollama</summary><label for="llama-url">Servidor local<input id="llama-url" type="url" value="http://127.0.0.1:11434" autocomplete="off" spellcheck="false"></label></details>
      <p id="llama-config-message" class="micro" role="status"></p>
    </details>
    <label class="analysis-ai-question-label" for="analysis-ai-question">Sobre esta mão<textarea id="analysis-ai-question" rows="2" placeholder="Pergunte sobre o cálculo ou descreva um cenário para estudar."></textarea></label>
    <div class="analysis-ai-actions"><button id="analysis-ai-explain" type="button" class="primary-button">Explicar mão</button><button id="analysis-ai-prepare" type="button" class="ghost-button">Montar cenário</button></div>
    <div id="analysis-ai-response" role="status" aria-live="polite"></div>
    <section id="analysis-ai-proposal" hidden aria-label="Revisar cenário proposto"><h3>Cenário proposto</h3><div id="analysis-ai-proposal-fields"></div><button id="analysis-ai-apply" type="button" class="primary-button">Aplicar cenário</button></section>
  </section><details id="engine-performance-details"><summary>Desempenho e aprendizagem</summary><div id="engine-details"></div></details>`;
  $('#open-engine').onclick=()=>engine.showModal();
  $('#analysis-seats').setAttribute('aria-label','Adversários ativos com cartas fechadas; posições ilustrativas');
  const seatHint=document.createElement('span');seatHint.className='seat-map-note';seatHint.textContent='Posições ilustrativas · cartas fechadas';$('#analysis-seats').after(seatHint);
  const textButton=document.createElement('button');textButton.id='open-entry';textButton.type='button';textButton.className='text-button';textButton.textContent='Colar texto';
  $('.keyboard-heading').append(textButton);textButton.onclick=()=>entry.showModal();
  const ev=document.createElement('section');ev.className='panel ev-summary';ev.id='ev-summary';
  ev.innerHTML='<div class="ev-topline"><span id="ev-label">EV esperado</span><span id="ev-state" class="sr-only">Aguardando cartas</span></div><strong id="ev-value">—</strong><span id="ev-unit">fichas · equilíbrio em 0</span><p id="ev-critical-warning" class="ev-critical-warning" role="status" aria-live="polite" hidden></p><div class="ev-alternatives" id="ev-alternatives"></div><details id="ev-premises" class="compact-disclosure"><summary>Premissas e precisão</summary><p id="ev-assumption">Complete a mão para calcular.</p></details>';
  $('.context-rail').prepend(ev);
  const facts=document.createElement('details');facts.id='hand-facts';facts.className='panel hand-facts compact-disclosure';
  facts.innerHTML='<summary>Leitura da mão</summary><div id="hand-facts-content">Complete suas cartas para ver a estrutura da mão e os draws.</div>';
  $('.context-rail').append(facts);
  const modelLabel=document.createElement('label');modelLabel.innerHTML='Mãos adversárias desconhecidas<select id="opponentModel"><option value="UNIFORM">Modelo-base: mãos aleatórias</option><option value="EXPLICIT">Usar somente mão / range informado</option></select><small>A estimativa aleatória usa todos os adversários ainda na mão.</small>';
  $('#opponentHand').closest('.controls-panel').querySelector('.form-grid').before(modelLabel);
  const auto=document.createElement('label');auto.className='checkbox-label';auto.innerHTML='<input id="auto-analysis" type="checkbox" checked> Calcular automaticamente ao completar as cartas';
  settings.querySelector('.dialog-content').prepend(auto);
  $('#assumeNoRake').checked=true;
  const scenarios=document.createElement('details');scenarios.className='panel controls-panel';scenarios.id='raise-model-panel';
  scenarios.innerHTML=`<summary><span>Comparar bet / raise</span></summary>
    <p>Simule as respostas dos adversários sem registrar a mão ação por ação.</p>
    <label>Modelo de respostas<select id="study-mode"><option value="OFF">Desativado · comparação parcial</option><option value="UNIFORM">Cenário de estudo · mãos aleatórias</option></select></label>
    <p class="micro">Escolha hipóteses para comparar. Não são frequências aprendidas, ranges GTO ou leituras dos adversários.</p>
    <p class="micro">Amostras: o número selecionado vale para cada quantidade de pagadores. No modo adaptativo, este estudo usa 5 mil por quantidade; selecione Profundo para 50 mil por quantidade.</p>
    <div class="form-grid"><label>Você já colocou nesta rodada<input id="study-hero-contribution" type="number" min="0" step="0.01" value="0"></label><label>Mínimo legal de raise (total)<input id="study-min-raise" type="number" min="0" step="0.01" placeholder="Opcional · limite conservador"></label></div>
    <div id="study-sizes" class="form-grid"></div>
    <label>Mínimo legal de bet (blind da mesa)<input id="study-min-bet" type="number" min="0.01" step="0.01" value="1"></label>
    <button id="study-example" type="button" class="ghost-button">Preencher hipótese inicial de 50% de call</button>
    <p class="micro">O preenchimento coloca a aposta atual no ADV. 1 e zero nos demais. Ajuste para representar o cenário. Chance de call refere-se ao bet/raise proposto.</p>
    <div class="study-opponent-heading"><span>Adversário ativo</span><span>Já colocou na rodada</span><span>Call contra seu aumento (%)</span></div>
    ${Array.from({length:9},(_,i)=>`<div class="study-opponent-row" data-study-opponent="${i}"><strong>ADV. ${i+1}</strong><label class="sr-only" for="study-contribution-${i}">Contribuição ADV. ${i+1}</label><input id="study-contribution-${i}" type="number" min="0" step="0.01" value="0"><label class="sr-only" for="study-probability-${i}">Chance de call ADV. ${i+1}</label><input id="study-probability-${i}" type="number" min="0" max="100" step="1" placeholder="0–100"></div>`).join('')}
    <label class="checkbox-label"><input id="study-accept" type="checkbox"> Usar estas hipóteses: no call todos completam o preço; no aumento pagam conforme as chances acima. Todos cobrem a aposta, sem reaumento ou apostas futuras.</label>
    <p class="micro">Equity recalculada para cada quantidade de pagadores. As chances de pagar são independentes das cartas. Este modo exige mãos aleatórias para todos. Bet/raise são totais da rodada; o motor desconta o que você já colocou. A opção do big blind sem valor para pagar ainda não está modelada.</p>`;
  settings.querySelector('.dialog-content').append(scenarios);
  for(const id of ['betSize','raiseTo'])$('#study-sizes').append($('#'+id).closest('label'));
  $('#betSize').closest('label').firstChild.textContent='Bet total nesta rodada';
  $('#raiseTo').closest('label').firstChild.textContent='Raise total nesta rodada';
  $('#study-example').onclick=()=>{
    const current=Number($('#study-hero-contribution').value)+Number($('#amountToCall').value);
    for(let i=0;i<9;i++){$('#study-contribution-'+i).value=i===0?current:0;$('#study-probability-'+i).value=50;}
    const h=Number($('#study-hero-contribution').value),c=Number($('#amountToCall').value),p=Number($('#potBeforeAction').value),stack=Number($('#effectiveStack').value);
    if(c>0)$('#raiseTo').value=Math.round((h+Math.min(stack,p+2*c))*100)/100;else $('#betSize').value=Math.round((h+Math.min(stack,p))*100)/100;
    $('#study-mode').value='UNIFORM';$('#study-mode').dispatchEvent(new Event('change',{bubbles:true}));
  };
  const modelButton=document.createElement('button');modelButton.type='button';modelButton.id='open-raise-model';modelButton.className='text-button';modelButton.textContent='Comparar bet / raise';ev.append(modelButton);
  modelButton.onclick=()=>{settings.showModal();scenarios.open=true;scenarios.scrollIntoView({block:'start'});};
  $('#rake').closest('label').firstChild.textContent='Rake total retirado do pote';
  $('#rake').closest('.controls-panel').querySelector('p.micro').textContent='Rake vale para a comparação inteira. Os campos de fold/equity de continuação acima são do modelo simples heads-up. Para vários adversários, use Comparar bet / raise.';
  $('#opponentHand').closest('.controls-panel').querySelector('p.micro').textContent='Opcional: informe uma mão ou range para refinar a estimativa. Perfil comportamental não substitui um range.';
  $('#empty-state p').textContent='Complete suas cartas. A estimativa usa o modelo adversário escolhido nas configurações.';
  $('#open-help').title='F1: teclado, naipes e ações';
  const clear=$('#clear'); clear.textContent='Limpar cartas'; clear.className='ghost-button';
  $('.keyboard-heading').append(clear);
  const keyboard=$('.card-keyboard'), keyboardHeading=$('.keyboard-heading');
  const picker=document.createElement('details');picker.id='card-picker';picker.className='card-picker';
  picker.innerHTML='<summary>Baralho de cartas</summary><p class="micro picker-help">Digite valor + naipe. Dez = D, T ou 10.</p>';
  keyboardHeading.after(picker);
  keyboardHeading.querySelector('div:first-child').remove();
  picker.append($('.suit-legend'),$('#card-grid'));
  const pickerTools=document.createElement('div');pickerTools.className='picker-tools';
  pickerTools.append(textButton,$('#copy-cards'),$('#export-cards'));picker.append(pickerTools);
  const pickerButton=document.createElement('button');pickerButton.id='open-card-picker';pickerButton.type='button';pickerButton.className='ghost-button';
  pickerButton.textContent='Cartas';pickerButton.setAttribute('aria-controls','card-picker');pickerButton.setAttribute('aria-expanded','false');
  keyboardHeading.prepend(pickerButton);
  keyboardHeading.append($('#remove-card'),$('#undo-card'),clear);
  $('.keyboard-actions').remove();
  const setPickerOpen=open=>{picker.open=open;pickerButton.setAttribute('aria-expanded',String(open));keyboard.classList.toggle('picker-open',open);};
  pickerButton.onclick=()=>setPickerOpen(!picker.open);
  picker.addEventListener('toggle',()=>setPickerOpen(picker.open));
  const selectedSlot=event=>{if(document.body.dataset.view==='analyze'&&event.target.closest('[data-slot]'))setPickerOpen(true);};
  document.addEventListener('click',selectedSlot,true);document.addEventListener('focusin',selectedSlot);
  document.addEventListener('click',event=>{if(document.body.dataset.view==='analyze'&&event.target.closest('.street-tab'))setPickerOpen(true);});
  document.addEventListener('keydown',event=>{
    if(document.body.dataset.view!=='analyze'||document.querySelector('dialog[open]')||event.target.closest('input,textarea,select,[contenteditable]'))return;
    const step=!event.ctrlKey&&!event.metaKey&&!event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key);
    const street=(event.ctrlKey||event.metaKey)&&!event.altKey&&/^[1-4]$/.test(event.key);
    if(step||street)setPickerOpen(true);
  });
  window.theibsCardPicker={open:()=>setPickerOpen(true),close:()=>setPickerOpen(false)};
  const trainingSettings=dialog('training-settings-dialog','Configurar exercício');
  document.body.append(trainingSettings);
  const trainingSetup=$('.training-setup'),trainingStart=$('#training-start');
  trainingSetup.open=true;trainingSettings.querySelector('.dialog-content').append(trainingSetup);
  const trainingBar=document.createElement('div');trainingBar.className='training-toolbar';
  trainingBar.innerHTML='<button id="open-training-settings" type="button" class="ghost-button">Configurar treino</button><button id="training-clear" type="button" class="ghost-button">Limpar treino</button>';
  trainingStart.textContent='Nova mão simulada';trainingBar.append(trainingStart);
  $('#training-table').before(trainingBar);
  $('#open-training-settings').onclick=()=>trainingSettings.showModal();
  const feedbackDetails=dialog('training-details-dialog','Cálculos e premissas do treino');
  document.body.append(feedbackDetails);
  feedbackDetails.querySelector('.dialog-content').innerHTML='<div id="training-details-text"></div>';
  const presets=document.createElement('div');presets.id='training-size-presets';presets.className='size-presets';presets.setAttribute('aria-label','Tamanhos para comparar');
  $('#training-size-help').after(presets);
  presets.addEventListener('click',event=>{const button=event.target.closest('[data-training-size]');if(button){$('#training-size').value=button.dataset.trainingSize;$('#training-size').dispatchEvent(new Event('input',{bubbles:true}));}});
  $('#train-workspace .context-rail').lastElementChild.classList.add('training-memory');
  $('#training-review').closest('.panel').classList.add('training-review-panel');
  const trainingMemory=$('#train-workspace .training-memory');
  $('.training-review-panel').append(trainingMemory.querySelector('[data-open-history]'));
  trainingSettings.querySelector('.dialog-content').append(trainingMemory);
  $('#train-workspace .coach-panel').after($('#training-feedback'));
})();
