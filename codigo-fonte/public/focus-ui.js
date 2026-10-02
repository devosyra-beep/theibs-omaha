(function () {
  'use strict';
  const $=selector=>document.querySelector(selector);
  const paths={
    panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-11-3 3 3 3"/>',
    expand:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m4-11 3 3-3 3"/>',
    cards:'<rect x="8" y="5" width="12" height="16" rx="2"/><path d="m5 18-3-14 11-2m1 8v6m-3-3h6"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    history:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-3v5l3 2"/>',
    players:'<circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2M4 5h3m10 0h3"/>',
    simulation:'<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m10 8 6 4-6 4z"/>',
    settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--background)"/><circle cx="15" cy="17" r="3" fill="var(--background)"/>',
    calculation:'<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 4h1m6 0h1"/>',
    assistant:'<path d="M20 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2v4l5-4h2m4-5v8m-4-4h8"/>',
    plus:'<path d="M12 4v16M4 12h16"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 3m0 3h.01"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    trash:'<path d="M3 6h18M9 6V3h6v3m-10 0 1 15h12l1-15M10 10v7m4-7v7"/>'
  };
  const svg=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
  function iconButton(button,icon,label){button.classList.add('icon-button');button.innerHTML=svg(icon);button.title=label;button.setAttribute('aria-label',label);}

  for(const [id,icon,label]of [['open-settings','settings','Configure table'],['open-analysis','calculation','View calculation'],['open-engine','assistant','Assistant'],['open-support','help','Help and support'],['open-license','info','License and access'],['new-hand','plus','New hand']]){
    const button=$('#'+id);if(button)iconButton(button,icon,label);
  }
  iconButton($('#clear'),'trash','Clear cards');
  $('#open-card-picker').insertAdjacentHTML('afterbegin',svg('cards'));

  const rail=$('.primary-rail');rail.id='primary-rail';
  const header=document.createElement('div');header.className='rail-header';
  const toggle=document.createElement('button');toggle.id='sidebar-toggle';toggle.type='button';toggle.className='ghost-button';toggle.setAttribute('aria-controls','primary-rail');
  const mobileNavToggle=document.createElement('button');
  mobileNavToggle.id='mobile-nav-toggle';mobileNavToggle.type='button';mobileNavToggle.className='ghost-button';
  mobileNavToggle.innerHTML=svg('menu')+'<span>Details</span>';mobileNavToggle.setAttribute('aria-controls','main-nav app-topbar');
  const mainNav=$('.main-nav');mainNav.id='main-nav';
  $('.topbar').id='app-topbar';
  function setMobileNav(open){
    document.body.dataset.mobileNav=open?'open':'closed';
    mobileNavToggle.setAttribute('aria-expanded',String(open));
    mobileNavToggle.setAttribute('aria-label',open?'Close details':'Open details');
    mobileNavToggle.title=open?'Close details':'Open details';
    mobileNavToggle.querySelector('span').textContent=open?'Close':'Details';
  }
  setMobileNav(false);
  mobileNavToggle.addEventListener('click',()=>setMobileNav(document.body.dataset.mobileNav!=='open'));
  mainNav.addEventListener('click',event=>{
    if(event.target.closest('.nav-tab') && window.matchMedia('(max-width:700px)').matches){
      setMobileNav(false);mobileNavToggle.focus();
    }
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && document.body.dataset.mobileNav==='open' && window.matchMedia('(max-width:700px)').matches){
      setMobileNav(false);mobileNavToggle.focus();
    }
  });
  header.append($('.brand'),mobileNavToggle,toggle);rail.prepend(header);
  for(const [view,icon,label]of [['analyze','cards','Analyze'],['train','target','Train'],['history','history','History'],['players','players','Players'],['simulation','simulation','Simulation']]){
    const button=$(`.nav-tab[data-view="${view}"]`);button.innerHTML=svg(icon)+`<span class="nav-label">${label}</span>`;button.title=label;button.setAttribute('aria-label',label);
  }
  const railWidth=$('#analysis-rail-width'), secondary=$('#analysis-secondary-expanded');
  const layoutKey='theibs.analysis.layout.v1';
  const supportingDetails=()=>document.querySelectorAll('#mw-history,.mw-ev-details,#calculation-timeline,#ev-premises,#hand-facts,#study-notes,#ev-scope-details,#equity-breakdown');
  function applyAnalysisLayout(width='balanced',expanded=false,save=false){
    const selected=['balanced','compact','wide'].includes(width)?width:'balanced';
    document.body.dataset.analysisRailWidth=selected;
    document.body.dataset.analysisSecondary=expanded?'expanded':'collapsed';
    railWidth.value=selected;secondary.checked=expanded;
    for(const detail of supportingDetails())detail.open=expanded;
    if(save){
      try{localStorage.setItem(layoutKey,JSON.stringify({width:selected,expanded}));}catch{/* Layout remains usable without local storage. */}
    }
  }
  railWidth.addEventListener('change',()=>applyAnalysisLayout(railWidth.value,secondary.checked,true));
  secondary.addEventListener('change',()=>applyAnalysisLayout(railWidth.value,secondary.checked,true));
  $('#restore-analysis-layout').addEventListener('click',()=>applyAnalysisLayout('balanced',false,true));
  function restore(collapsed=true){
    document.body.dataset.sidebar=collapsed===false?'expanded':'collapsed';
    iconButton(toggle,collapsed===false?'panel':'expand',collapsed===false?'Collapse menu':'Expand menu');toggle.setAttribute('aria-expanded',String(collapsed===false));
  }
  function change(collapsed){restore(collapsed);document.dispatchEvent(new CustomEvent('theibs:layout-preference'));}
  toggle.onclick=()=>change(document.body.dataset.sidebar!=='collapsed');
  const topActions=$('.top-actions'), desktopTools=$('.dashboard-tools'), account=$('#open-auth'), signout=$('#header-signout'), newHand=$('#new-hand');
  const mobileTools=document.createElement('details');mobileTools.id='mobile-tools';mobileTools.className='mobile-tools';
  mobileTools.innerHTML=`<summary>${svg('menu')}<span>Menu</span></summary><div class="mobile-tools-panel"></div>`;
  topActions.prepend(mobileTools);
  const mobilePanel=mobileTools.querySelector('.mobile-tools-panel');
  const mobileWidth=window.matchMedia('(max-width:700px)');
  function placeTools(){
    if(mobileWidth.matches) mobilePanel.append(desktopTools,account,signout);
    else { topActions.insertBefore(desktopTools,mobileTools);topActions.insertBefore(account,newHand);topActions.insertBefore(signout,newHand);mobileTools.open=false; }
  }
  mobileWidth.addEventListener('change',placeTools);placeTools();
  mobilePanel.addEventListener('click',event=>{if(event.target.closest('button'))mobileTools.open=false;});
  const help=$('#open-help');help.innerHTML=svg('help')+'<span class="nav-label">Keyboard & help</span>';help.title='Keyboard & help · F1';help.setAttribute('aria-label',help.title);
  const localNote=$('.rail-bottom>.micro:not(#save-status)');$('#help-dialog').append(localNote);
  const saveIndicator=document.createElement('span');saveIndicator.className='save-indicator';saveIndicator.setAttribute('role','img');$('#save-status').before(saveIndicator);
  const reflectSave=()=>{const text=$('#save-status').textContent;saveIndicator.title=text;saveIndicator.setAttribute('aria-label',text);saveIndicator.dataset.state=/unsaved|unavailable/.test(text)?'error':/pending|Saving/.test(text)?'pending':'saved';};
  new MutationObserver(reflectSave).observe($('#save-status'),{childList:true,characterData:true,subtree:true});reflectSave();

  // The main canvas holds metrics; explanations remain in the existing dialog.
  const calculation=$('#analysis-dialog .dialog-content');
  const overview=document.createElement('section');overview.className='calculation-overview';overview.innerHTML='<h3>About this calculation</h3>';
  overview.append($('#quick-action-note'),$('#ev-unit'),$('#hero-method'));calculation.prepend(overview);
  overview.after($('#ev-premises'),$('#hand-facts'));
  $('#ev-premises').append($('#ev-alternatives'));$('#ev-alternatives').hidden=true; // Full action table already exists in the result.
  $('#hand-facts').after($('#open-raise-model'));
  const timeline=document.createElement('details');timeline.id='calculation-timeline';timeline.innerHTML='<summary>Equity by street</summary>';$('.timeline-card').before(timeline);timeline.append($('.timeline-card'));
  const openCalculation=()=>{const dialog=$('#analysis-dialog');dialog.showModal();dialog.scrollTop=0;};$('#open-analysis').onclick=openCalculation;
  const compare=$('#open-raise-model');compare.addEventListener('click',()=>$('#analysis-dialog').close(),true);
  const actionInfo=document.createElement('button');actionInfo.id='action-info';actionInfo.type='button';iconButton(actionInfo,'info','About the comparison');$('#quick-action').after(actionInfo);
  actionInfo.onclick=openCalculation;
  const reflectNote=()=>{actionInfo.title=$('#quick-action-note').textContent;actionInfo.setAttribute('aria-label','View calculation: '+actionInfo.title);$('#quick-action').title='Current decision reading; review the assumptions in the calculation.';};
  new MutationObserver(reflectNote).observe($('#quick-action-note'),{childList:true,subtree:true,characterData:true});reflectNote();
  // Coverage mismatches keep a visible signal instead of silently hiding them.
  const warning=$('#ev-critical-warning'),coverage=document.createElement('button');coverage.id='ev-coverage-info';coverage.type='button';iconButton(coverage,'info','Check calculated opponents');coverage.hidden=true;$('#ev-summary .ev-topline').append(coverage);overview.append(warning);
  const reflectWarning=()=>{coverage.hidden=warning.hidden;coverage.title=warning.textContent;coverage.setAttribute('aria-label',warning.textContent||'Check calculated opponents');};
  new MutationObserver(reflectWarning).observe(warning,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});reflectWarning();
  coverage.onclick=openCalculation;
  // Keep the equity next to the table on small screens. The actual price fields
  // move with it, so there is only one source of truth for analysis inputs.
  const tableColumn=$('#analyze-workspace .table-column'),contextRail=$('#analysis-form .context-rail');
  const equityPanel=$('#analyze-workspace .insight-panel'),quickDecision=$('.quick-decision');
  const equityEmpty=document.createElement('span');equityEmpty.id='equity-empty-status';equityEmpty.className='micro';equityEmpty.hidden=true;
  equityPanel.querySelector('#hero-equity').after(equityEmpty);
  const breakdown=document.createElement('details');breakdown.id='equity-breakdown';breakdown.className='compact-disclosure';
  breakdown.innerHTML='<summary>Showdown breakdown</summary>';
  breakdown.append(equityPanel.querySelector('.win-chart'));equityPanel.append(breakdown);
  const quickPrice=document.createElement('details');quickPrice.id='quick-price';quickPrice.className='quick-price';
  quickPrice.innerHTML='<summary>Call price <span>optional</span></summary><div class="quick-price-fields"></div>';
  quickDecision.before(quickPrice);
  const potLabel=$('#potBeforeAction').closest('label'),callLabel=$('#amountToCall').closest('label');
  potLabel.firstChild.textContent='Current pot ';
  callLabel.firstChild.textContent='To call ';
  const priceFields=quickPrice.querySelector('.quick-price-fields'),stackLabel=$('#effectiveStack').closest('label');
  function placeQuickAnalysis(){
    const compact=mobileWidth.matches&&document.body.dataset.multiway!=='on';
    quickPrice.hidden=!compact;
    if(compact){tableColumn.insertBefore(equityPanel,quickPrice);priceFields.append(potLabel,callLabel);}
    else{contextRail.append(equityPanel);stackLabel.before(potLabel,callLabel);quickPrice.open=false;}
    const nutsBadge=$('#nuts-badge');if(nutsBadge)equityPanel.after(nutsBadge);
  }
  mobileWidth.addEventListener('change',placeQuickAnalysis);
  new MutationObserver(placeQuickAnalysis).observe(document.body,{attributes:true,attributeFilter:['data-multiway']});
  placeQuickAnalysis();
  const reflectEquity=()=>{
    const value=$('#hero-equity').textContent.trim();
    const pending=/calculando|calculating|analyzing/i.test($('#equity-range').textContent+' '+$('#quick-analyze').textContent);
    equityPanel.dataset.equityState=pending?'loading':value&&value!=='—'?'ready':'empty';
    const scope=$('#equity-scope');
    scope.hidden=equityPanel.dataset.equityState!=='ready'&&scope.textContent.trim()==='Waiting for cards to identify the hand.';
    const hero=window.theibsCardKeyboard?.state?.cards()?.hero || [];
    equityEmpty.hidden=document.body.dataset.multiway!=='on'||equityPanel.dataset.equityState==='ready';
    equityEmpty.textContent=pending?'Calculating equity…':hero.length===window.theibsCardKeyboard?.state?.count?'Equity not calculated.':'Add your cards to calculate equity.';
    breakdown.hidden=equityPanel.dataset.equityState!=='ready';
  };
  for(const node of [$('#hero-equity'),$('#equity-range'),$('#equity-scope'),$('#quick-analyze')])new MutationObserver(reflectEquity).observe(node,{childList:true,characterData:true,subtree:true});
  new MutationObserver(reflectEquity).observe(document.body,{attributes:true,attributeFilter:['data-multiway']});
  reflectEquity();
  // The controller is created by the last page script. Reparent its stable node
  // beside the table on small screens without rebuilding its listeners.
  document.addEventListener('DOMContentLoaded',()=>{
    const voice=$('#card-voice');if(!voice)return;
    function placeVoice(){
      if(voice.querySelector('dialog[open]'))return;
      if(mobileWidth.matches){tableColumn.querySelector('.table-surface').before(voice);}
      else if(voice.parentElement!==tableColumn||voice!==tableColumn.lastElementChild)tableColumn.append(voice);
    }
    mobileWidth.addEventListener('change',placeVoice);
    voice.querySelector('#voice-settings-dialog')?.addEventListener('close',placeVoice);
    placeVoice();
  },{once:true});
  let savedLayout=null;
  try{savedLayout=JSON.parse(localStorage.getItem(layoutKey)||'null');}catch{/* Use defaults. */}
  window.theibsFocusUI={restore};restore();applyAnalysisLayout(savedLayout?.width,savedLayout?.expanded===true);
})();
