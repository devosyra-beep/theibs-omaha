(function () {
  'use strict';
  const $=s=>document.querySelector(s), form=$('#analysis-form');
  $('#samples').prepend(new Option('Adaptive · target up to 3s','adaptive'));
  const opponentsBar=document.createElement('div');opponentsBar.className='analysis-context-bar';
  opponentsBar.innerHTML='<label for="opponent-count">Opponents in hand <select id="opponent-count"></select></label><span id="opponent-total" class="sr-only"></span>';
  $('#analyze-workspace .table-column').prepend(opponentsBar);
  for(const event of ['input','change'])$('#opponent-count').addEventListener(event,()=>{$('#players').value=Number($('#opponent-count').value)+1;});
  document.body.dataset.view='analyze';
  function closeDialog(el) {
    if (!el?.open) return;
    el.close();
    requestAnimationFrame(()=>{
      if (el.open) el.removeAttribute('open');
      if (document.activeElement?.closest?.('dialog')===el) document.activeElement.blur();
    });
  }
  function openDialog(el) {
    if (!el || el.open) return;
    try { el.showModal(); }
    catch (error) { console.error('THEIBS dialog open failed', el.id, error); }
  }
  document.addEventListener('click',event=>{
    const close=event.target.closest?.('[data-close-dialog]');
    if(close){event.preventDefault();event.stopImmediatePropagation();closeDialog(close.closest('dialog'));return;}
    const opener=event.target.closest?.('[data-dialog-target]');
    if(opener){event.preventDefault();openDialog($(opener.dataset.dialogTarget));}
  },true);
  function dialog(id,title) {
    const el=document.createElement('dialog');el.id=id;el.className='dashboard-dialog';
    el.innerHTML=`<div class="dialog-head"><h2>${title}</h2><button type="button" class="ghost-button" data-close-dialog commandfor="${id}" command="close" aria-label="Close ${title}">Close</button></div><div class="dialog-content"></div>`;
    form.append(el);
    el.querySelector('[data-close-dialog]').addEventListener('click',event=>{event.preventDefault();event.stopPropagation();closeDialog(el);});
    el.addEventListener('cancel',event=>{event.preventDefault();closeDialog(el);});
    el.addEventListener('click',event=>{if(event.target===el)closeDialog(el);});
    return el;
  }
  const settings=dialog('settings-dialog','Table & calculation assumptions');
  // Keep rules in Help; the main rail contains only the variant selection.
  $('#help-dialog').append($('#variant-help'));
  $('#selected-card-label').classList.add('sr-only');
  $('.table-meta').classList.add('sr-only');
  const appearance=$('.appearance-section');
  for(const [id,label] of [['deck-options','Deck'],['felt-options','Felt']]) {
    const heading=appearance.querySelector('.eyebrow'),controls=appearance.querySelector('.segmented');
    const disclosure=document.createElement('details');disclosure.id=id;disclosure.className='appearance-options';
    const summary=document.createElement('summary');summary.textContent=label;disclosure.append(summary,controls);heading.remove();appearance.append(disclosure);
  }
  const visualSettings=document.createElement('section');visualSettings.className='settings-visuals';
  const visualTitle=document.createElement('h3');visualTitle.textContent='Game & appearance';
  visualSettings.append(visualTitle,$('.variant-section'),appearance,$('#open-help'));
  settings.querySelector('.dialog-content').append(visualSettings);
  $('#analysis-form .context-rail').querySelectorAll('.controls-panel,.form-actions').forEach(el=>settings.querySelector('.dialog-content').append(el));
  const entry=dialog('entry-dialog','Paste or edit cards');entry.querySelector('.dialog-content').append($('.raw-entry'));$('.raw-entry').open=true;
  const result=dialog('analysis-dialog','Calculation & street history');
  for(const el of [$('#empty-state'),$('#result'),$('.timeline-card')])result.querySelector('.dialog-content').append(el);
  const bar=document.createElement('div');bar.className='dashboard-tools';
  bar.innerHTML='<button id="open-settings" type="button" class="ghost-button" data-dialog-target="#settings-dialog" commandfor="settings-dialog" command="show-modal">Configure table</button><button id="open-analysis" type="button" class="ghost-button" data-dialog-target="#analysis-dialog" commandfor="analysis-dialog" command="show-modal">View calculation</button><button id="open-engine" type="button" class="ghost-button" data-dialog-target="#engine-dialog" commandfor="engine-dialog" command="show-modal">Assistant</button>';
  $('.top-actions').prepend(bar);
  $('#open-settings').addEventListener('click',()=>openDialog(settings));
  $('#open-analysis').addEventListener('click',()=>openDialog(result));
  const engine=dialog('engine-dialog','Hand assistant');document.body.append(engine);
  $('#open-engine').addEventListener('click',()=>openDialog(engine));
  engine.querySelector('.dialog-content').innerHTML=`<section id="llama-controls" aria-label="Assistant & local model">
    <p id="llama-status" role="status">Checking the local assistant…</p>
    <details id="llama-setup"><summary>Model & connection</summary>
      <div class="llama-model-row"><label for="llama-model">Local model<select id="llama-model"><option value="">Check available models</option></select></label><button id="llama-refresh" type="button" class="ghost-button">Refresh</button><button id="llama-connect" type="button" class="primary-button">Connect</button></div>
      <details class="llama-advanced"><summary>Ollama address</summary><label for="llama-url">Local server<input id="llama-url" type="url" value="http://127.0.0.1:11434" autocomplete="off" spellcheck="false"></label></details>
      <p id="llama-config-message" class="micro" role="status"></p>
    </details>
    <label class="analysis-ai-question-label" for="analysis-ai-question">About this hand<textarea id="analysis-ai-question" rows="2" placeholder="Ask about the calculation or describe a scenario to study."></textarea></label>
    <div class="analysis-ai-actions"><button id="analysis-ai-explain" type="button" class="primary-button">Explain hand</button><button id="analysis-ai-prepare" type="button" class="ghost-button">Build scenario</button></div>
    <div id="analysis-ai-response" role="status" aria-live="polite"></div>
    <section id="analysis-ai-proposal" hidden aria-label="Review proposed scenario"><h3>Proposed scenario</h3><div id="analysis-ai-proposal-fields"></div><button id="analysis-ai-apply" type="button" class="primary-button">Apply scenario</button></section>
  </section><details id="engine-performance-details"><summary>Performance & learning</summary><div id="engine-details"></div></details>`;
  $('#analysis-seats').setAttribute('aria-label','Active opponents with face-down cards; illustrative positions');
  const seatHint=document.createElement('span');seatHint.className='seat-map-note';seatHint.textContent='Illustrative positions · face-down cards';$('#analysis-seats').after(seatHint);
  const textButton=document.createElement('button');textButton.id='open-entry';textButton.type='button';textButton.className='text-button';textButton.textContent='Paste text';textButton.dataset.dialogTarget='#entry-dialog';
  $('.keyboard-heading').append(textButton);
  textButton.addEventListener('click',()=>openDialog(entry));
  const ev=document.createElement('section');ev.className='panel ev-summary';ev.id='ev-summary';
  ev.innerHTML='<div class="ev-topline"><span id="ev-label">Expected EV</span><span id="ev-state" class="sr-only">Waiting for cards</span></div><strong id="ev-value">—</strong><span id="ev-unit">chips · break-even at 0</span><p id="ev-critical-warning" class="ev-critical-warning" role="status" aria-live="polite" hidden></p><div class="ev-alternatives" id="ev-alternatives"></div><details id="ev-premises" class="compact-disclosure"><summary>Assumptions & precision</summary><p id="ev-assumption">Complete the hand to calculate.</p></details>';
  $('.context-rail').prepend(ev);
  const facts=document.createElement('details');facts.id='hand-facts';facts.className='panel hand-facts compact-disclosure';
  facts.innerHTML='<summary>Hand insights</summary><div id="hand-facts-content">Complete your cards to see hand structure and draws.</div>';
  $('.context-rail').append(facts);
  const modelLabel=document.createElement('label');modelLabel.innerHTML='Unknown opponent hands<select id="opponentModel"><option value="UNIFORM">Baseline: random hands</option><option value="EXPLICIT">Use only the entered hand / range</option></select><small>The random estimate includes every opponent still in the hand.</small>';
  $('#opponentHand').closest('.controls-panel').querySelector('.form-grid').before(modelLabel);
  const auto=document.createElement('label');auto.className='checkbox-label';auto.innerHTML='<input id="auto-analysis" type="checkbox" checked> Calculate automatically when cards are complete';
  settings.querySelector('.dialog-content').prepend(auto);
  $('#assumeNoRake').checked=true;
  const scenarios=document.createElement('details');scenarios.className='panel controls-panel';scenarios.id='raise-model-panel';
  scenarios.innerHTML=`<summary><span>Compare bet / raise</span></summary>
    <p>Simulate opponent responses without recording the hand action by action.</p>
    <label>Response model<select id="study-mode"><option value="OFF">Off · partial comparison</option><option value="UNIFORM">Study scenario · random hands</option></select></label>
    <p class="micro">Choose assumptions to compare. They are not learned frequencies, GTO ranges or opponent reads.</p>
    <p class="micro">Samples: the selected count applies to each number of callers. Adaptive mode uses 5K per count; select Deep for 50K per count.</p>
    <div class="form-grid"><label>You already committed this street<input id="study-hero-contribution" type="number" min="0" step="0.01" value="0"></label><label>Minimum legal raise (total)<input id="study-min-raise" type="number" min="0" step="0.01" placeholder="Optional · conservative limit"></label></div>
    <div id="study-sizes" class="form-grid"></div>
    <label>Minimum legal bet (table blind)<input id="study-min-bet" type="number" min="0.01" step="0.01" value="1"></label>
    <button id="study-example" type="button" class="ghost-button">Fill initial 50% call assumption</button>
    <p class="micro">This puts the current bet on OPP. 1 and zero on the others. Adjust it to match the scenario. Call probability refers to the proposed bet/raise.</p>
    <div class="study-opponent-heading"><span>Active opponent</span><span>Committed this street</span><span>Call vs. your raise (%)</span></div>
    ${Array.from({length:9},(_,i)=>`<div class="study-opponent-row" data-study-opponent="${i}"><strong>ADV. ${i+1}</strong><label class="sr-only" for="study-contribution-${i}">OPP. contribution ${i+1}</label><input id="study-contribution-${i}" type="number" min="0" step="0.01" value="0"><label class="sr-only" for="study-probability-${i}">OPP. call probability ${i+1}</label><input id="study-probability-${i}" type="number" min="0" max="100" step="1" placeholder="0–100"></div>`).join('')}
    <label class="checkbox-label"><input id="study-accept" type="checkbox"> Use these assumptions: on a call, everyone completes the price; on a raise, they call according to the probabilities above. Everyone covers the bet, with no re-raise or future betting.</label>
    <p class="micro">Equity is recalculated for each caller count. Call probabilities are independent of cards. This mode requires random hands for everyone. Bet/raise amounts are street totals; the engine subtracts what you already committed. The big blind free-option raise is not modeled yet.</p>`;
  settings.querySelector('.dialog-content').append(scenarios);
  for(const id of ['betSize','raiseTo'])$('#study-sizes').append($('#'+id).closest('label'));
  $('#betSize').closest('label').firstChild.textContent='Bet total this street';
  $('#raiseTo').closest('label').firstChild.textContent='Raise total this street';
  $('#study-example').onclick=()=>{
    const current=Number($('#study-hero-contribution').value)+Number($('#amountToCall').value);
    for(let i=0;i<9;i++){$('#study-contribution-'+i).value=i===0?current:0;$('#study-probability-'+i).value=50;}
    const h=Number($('#study-hero-contribution').value),c=Number($('#amountToCall').value),p=Number($('#potBeforeAction').value),stack=Number($('#effectiveStack').value);
    if(c>0)$('#raiseTo').value=Math.round((h+Math.min(stack,p+2*c))*100)/100;else $('#betSize').value=Math.round((h+Math.min(stack,p))*100)/100;
    $('#study-mode').value='UNIFORM';$('#study-mode').dispatchEvent(new Event('change',{bubbles:true}));
  };
  const modelButton=document.createElement('button');modelButton.type='button';modelButton.id='open-raise-model';modelButton.className='text-button';modelButton.textContent='Compare bet / raise';ev.append(modelButton);
  modelButton.onclick=()=>{settings.showModal();scenarios.open=true;scenarios.scrollIntoView({block:'start'});};
  $('#rake').closest('label').firstChild.textContent='Total rake removed from the pot';
  $('#rake').closest('.controls-panel').querySelector('p.micro').textContent='Rake applies to the whole comparison. The fold/continuation-equity fields above belong to the simple heads-up model. For multiple opponents, use Compare bet / raise.';
  $('#opponentHand').closest('.controls-panel').querySelector('p.micro').textContent='Optional: enter a hand or range to refine the estimate. A behavioral profile does not replace a range.';
  $('#empty-state p').textContent='Complete your cards. The estimate uses the opponent model selected in settings.';
  $('#open-help').title='F1: keyboard, suits and actions';
  const clear=$('#clear'); clear.textContent='Clear cards'; clear.className='ghost-button';
  $('.keyboard-heading').append(clear);
  const keyboard=$('.card-keyboard'), keyboardHeading=$('.keyboard-heading');
  const picker=document.createElement('details');picker.id='card-picker';picker.className='card-picker';
  picker.innerHTML='<summary>Card deck</summary><p class="micro picker-help">Type rank + suit. Ten = D, T or 10.</p>';
  keyboardHeading.after(picker);
  keyboardHeading.querySelector('div:first-child').remove();
  picker.append($('.suit-legend'),$('#card-grid'));
  const pickerTools=document.createElement('div');pickerTools.className='picker-tools';
  pickerTools.append(textButton,$('#copy-cards'),$('#export-cards'));picker.append(pickerTools);
  const pickerButton=document.createElement('button');pickerButton.id='open-card-picker';pickerButton.type='button';pickerButton.className='ghost-button';
  pickerButton.textContent='Cards';pickerButton.setAttribute('aria-controls','card-picker');pickerButton.setAttribute('aria-expanded','false');
  keyboardHeading.prepend(pickerButton);
  keyboardHeading.append($('#remove-card'),$('#undo-card'),clear);
  $('.keyboard-actions').remove();
  const setPickerOpen=open=>{picker.open=open;pickerButton.setAttribute('aria-expanded',String(open));keyboard.classList.toggle('picker-open',open);};
  pickerButton.onclick=()=>setPickerOpen(!picker.open);
  picker.addEventListener('toggle',()=>setPickerOpen(picker.open));
  document.addEventListener('keydown',event=>{
    if(document.body.dataset.view!=='analyze'||document.querySelector('dialog[open]')||event.target.closest('input,textarea,select,[contenteditable]'))return;
    const step=!event.ctrlKey&&!event.metaKey&&!event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key);
    const street=(event.ctrlKey||event.metaKey)&&!event.altKey&&/^[1-4]$/.test(event.key);
    if(step||street)setPickerOpen(true);
  });
  settings.querySelector('.dialog-content').insertBefore(keyboard,settings.querySelector('.controls-panel'));
  window.theibsCardPicker={open:()=>setPickerOpen(true),close:()=>setPickerOpen(false)};
  const trainingSettings=dialog('training-settings-dialog','Configure exercise');
  document.body.append(trainingSettings);
  const trainingSetup=$('.training-setup'),trainingStart=$('#training-start');
  trainingSetup.open=true;trainingSettings.querySelector('.dialog-content').append(trainingSetup);
  const trainingBar=document.createElement('div');trainingBar.className='training-toolbar';
  trainingBar.innerHTML='<button id="open-training-settings" type="button" class="ghost-button" data-dialog-target="#training-settings-dialog" commandfor="training-settings-dialog" command="show-modal">Configure training</button><button id="training-clear" type="button" class="ghost-button">Clear training</button>';
  trainingStart.textContent='New simulated hand';trainingBar.append(trainingStart);
  $('#training-table').before(trainingBar);
  $('#open-training-settings').addEventListener('click',()=>openDialog(trainingSettings));
  const feedbackDetails=dialog('training-details-dialog','Training calculations & assumptions');
  document.body.append(feedbackDetails);
  feedbackDetails.querySelector('.dialog-content').innerHTML='<div id="training-details-text"></div>';
  const presets=document.createElement('div');presets.id='training-size-presets';presets.className='size-presets';presets.setAttribute('aria-label','Sizes to compare');
  $('#training-size-help').after(presets);
  presets.addEventListener('click',event=>{const button=event.target.closest('[data-training-size]');if(button){$('#training-size').value=button.dataset.trainingSize;$('#training-size').dispatchEvent(new Event('input',{bubbles:true}));}});
  $('#train-workspace .context-rail').lastElementChild.classList.add('training-memory');
  $('#training-review').closest('.panel').classList.add('training-review-panel');
  const trainingMemory=$('#train-workspace .training-memory');
  $('.training-review-panel').append(trainingMemory.querySelector('[data-open-history]'));
  trainingSettings.querySelector('.dialog-content').append(trainingMemory);
  $('#train-workspace .coach-panel').after($('#training-feedback'));
})();
