(function () {
  'use strict';
  const $=selector=>document.querySelector(selector);
  const paths={
    panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-11-3 3 3 3"/>',
    expand:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m4-11 3 3-3 3"/>',
    cards:'<rect x="8" y="5" width="12" height="16" rx="2"/><path d="m5 18-3-14 11-2m1 8v6m-3-3h6"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    history:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-3v5l3 2"/>',
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

  for(const [id,icon,label]of [['open-settings','settings','Configure table'],['open-analysis','calculation','View calculation'],['open-engine','assistant','Assistant'],['new-hand','plus','New hand']])iconButton($('#'+id),icon,label);
  iconButton($('#clear'),'trash','Clear cards');
  $('#open-card-picker').insertAdjacentHTML('afterbegin',svg('cards'));

  const rail=$('.primary-rail');rail.id='primary-rail';
  const header=document.createElement('div');header.className='rail-header';
  const toggle=document.createElement('button');toggle.id='sidebar-toggle';toggle.type='button';toggle.className='ghost-button';toggle.setAttribute('aria-controls','primary-rail');
  header.append($('.brand'),toggle);rail.prepend(header);
  for(const [view,icon,label]of [['analyze','cards','Analyze'],['train','target','Train'],['history','history','History']]){
    const button=$(`.nav-tab[data-view="${view}"]`);button.innerHTML=svg(icon)+`<span class="nav-label">${label}</span>`;button.title=label;button.setAttribute('aria-label',label);
  }
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
  const reflectNote=()=>{actionInfo.title=$('#quick-action-note').textContent;actionInfo.setAttribute('aria-label','View calculation: '+actionInfo.title);$('#quick-action').title='Highest-EV action among calculated options. Review the assumptions in the calculation.';};
  new MutationObserver(reflectNote).observe($('#quick-action-note'),{childList:true,subtree:true,characterData:true});reflectNote();
  // Coverage mismatches keep a visible signal instead of silently hiding them.
  const warning=$('#ev-critical-warning'),coverage=document.createElement('button');coverage.id='ev-coverage-info';coverage.type='button';iconButton(coverage,'info','Check calculated opponents');coverage.hidden=true;$('#ev-summary .ev-topline').append(coverage);overview.append(warning);
  const reflectWarning=()=>{coverage.hidden=warning.hidden;coverage.title=warning.textContent;coverage.setAttribute('aria-label',warning.textContent||'Check calculated opponents');};
  new MutationObserver(reflectWarning).observe(warning,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});reflectWarning();
  coverage.onclick=openCalculation;
  window.theibsFocusUI={restore};restore();
})();
