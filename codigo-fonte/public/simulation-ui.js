(function () {
  'use strict';
  const E=window.EssenceUI, esc=E.esc, money=E.money;
  const positions={2:['SB','BB'],3:['BTN','SB','BB'],4:['CO','BTN','SB','BB'],5:['HJ','CO','BTN','SB','BB'],6:['UTG','HJ','CO','BTN','SB','BB']};
  let host,request,getOwner,owner=null,session=null,analysis=null,active=false,busy=false,controller=null,client=null,generation=0;
  let reports=[],decisions=[],error='',timing=null,startedAt=0,restored=false;
  const key=()=>`theibs.simulation.v1.${owner}`;
  const snapshot=()=>session?{id:session.id,revision:session.revision,owner,generation}:null;
  const current=stamp=>active && stamp && stamp.id===session?.id && stamp.revision===session?.revision && stamp.owner===owner && stamp.generation===generation;
  const button=(label,op,primary=false,extra='')=>`<button type="button" class="${primary?'primary-button':'ghost-button'}" data-sim-op="${op}"${busy?' disabled':''} ${extra}>${label}</button>`;
  const label=row=>({FOLD:'Fold',CALL:'Call',CHECK:'Check',BET:'Bet',RAISE:'Raise'}[row.action]||row.action)+(row.size==null?'':` to ${money(row.size)}`);
  const signed=value=>Number.isFinite(value)?`${value>0?'+':''}${money(value)}`:'—';
  const heroTurn=()=>!session?.finished && session?.state.phase==='BETTING' && session.state.actor===session.state.heroId;
  function cancel(){generation++;controller?.abort();controller=null;}
  function save(){
    if(!owner)return;
    try{localStorage.setItem(key(),JSON.stringify({sessionId:session?.id||null,reports:reports.slice(-30),decisions}));}
    catch{error='Local simulation history could not be saved. Download the report before leaving.';}
  }
  function archive(value=session){
    if(!value?.finished)return;
    const item={id:value.id,endedAt:new Date().toISOString(),source:'SIMULATION_ONLY',policy:value.policy,deal:value.deal,
      outcome:value.outcome,abandoned:value.abandoned,audit:value.audit,shownHands:value.shownHands,
      publicRecord:value.multiway,decisions:structuredClone(decisions)};
    const index=reports.findIndex(report=>report.id===item.id);
    if(index>=0)reports[index]=item;else reports.push(item);
    reports=reports.slice(-30);save();
  }
  function decisionPanel(){
    if(!heroTurn())return `<section class="sim-result"><h2>Decision EV</h2><p>${session?.finished?'Review your decision snapshots below.':'Available when it is your turn.'}</p></section>`;
    const decision=window.theibsMultiwayUI.describeDecisionEV(session.state,analysis,{analysisBusy:!!controller,heroDraftReady:true});
    const rows=decision?.rows||[];
    const leader=rows.find(row=>row.optionId===decision?.precision?.bestActionId);
    const eq=analysis?.equity?.equity;
    const precision=decision?.precision;
    return `<section class="sim-result" aria-label="Current decision evaluation"><div class="sim-result-heading"><h2>Decision EV</h2><span class="status-chip">${analysis?.status==='OK'?'HEURISTIC':controller?'Calculating':'Unavailable'}</span></div>
      <p class="sim-context">Pot ${money(session.state.pot)} · Call ${money(session.state.legal.toCall)} · 1 bb = ${money(session.state.bigBlind)} chips</p>
      <table class="sim-ev-table"><thead><tr><th>Action</th><th>EV · bb</th><th>Below leader · bb</th></tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${esc(label(row))}<small>${row.status==='MODELED'?decision.stage==='PROVISIONAL'?'Provisional':'Modeled':row.status==='PENDING'?'Calculating':'Unavailable'}</small></th><td>${signed(row.evBB)}</td><td>${signed(row.differenceBB)}</td></tr>`).join('')}</tbody></table>
      ${leader?`<p class="sim-leader">${decision.leaderConclusive?'Highest modeled EV':'Current EV leader'}: ${esc(label(leader))}${Number.isFinite(decision.gapBestSecondBB)?` · ΔEV ${money(decision.gapBestSecondBB)} bb`:''}</p>`:''}
      ${precision?.status==='INCONCLUSIVE'?`<p class="sim-limits">INCONCLUSIVE · ${esc(precision.reason || String(precision.reasonCode||'Defensible error bounds unavailable.').replaceAll('_',' ').toLowerCase())}</p>`:''}
      ${analysis?.status && analysis.status!=='OK'?`<p role="status">${esc(analysis.reason || 'No estimate is available for this decision.')}</p>`:''}
      ${analysis?.refinement?.status==='TIME_BUDGET'?'<p class="sim-limits">Refinement reached its budget. The available estimate is retained.</p>':''}
      <div class="sim-equity"><span>Showdown equity</span><strong>${Number.isFinite(eq)?`${money(100*eq)}%`:'—'}</strong></div>
      <details><summary>Methods & limits</summary><p>EV is incremental from this decision. Below leader is the EV difference within the modeled alternatives; zero means the current leader, not a guaranteed best play.</p><p>Contextual continuation policy, not GTO. Uniform card priors are conditioned on public actions. Actual hidden cards and future board cards are excluded. Random full ranges do not become explicit solver ranges.</p><p>Zero rake · finite legal sizing grid · ${esc(session.policy.version)}. Sampling bounds measure numerical uncertainty within this fixed policy, not uncertainty about human opponents.</p>${timing?`<p>First estimate: ${money(timing.firstMs)} ms · final attempt: ${money(timing.totalMs)} ms · ${esc(timing.runtime)} · cache ${esc(timing.cache || 'not reported')}.</p>`:''}${decision?.assumptions?.map(text=>`<p>${esc(text)}</p>`).join('')||''}</details></section>`;
  }
  function table(){
    const state=session.state,hero=state.players[state.heroId],count=session.multiway.config.heroCards.length;
    const pot=state.phase==='FINISHED'?(state.result?.pots||state.result?.awards||[]).reduce((sum,item)=>sum+item.amount,0):state.pot;
    const seats=E.multiwaySeats(state,count).replaceAll('data-multiway-player','data-sim-seat');
    return `<div class="sim-table-wrap"><div class="mesa-stage"><div class="poker-table"><div class="table-felt"><div class="analysis-seats">${seats}</div>
      <div class="table-center"><div class="table-pot-summary"><span class="eyebrow">${state.phase==='FINISHED'?'SETTLED':'TOTAL'} POT · CHIPS</span><strong class="pot-value">${money(pot)}</strong></div><div class="board-cards" aria-label="Community cards">${Array.from({length:5},(_,index)=>E.canonicalCard(state.board[index],{label:`Board ${index+1}`,emptyLabel:state.board[index]?'':['F','F','F','T','R'][index]})).join('')}</div></div>
      <div class="hero-position"><div class="hero-cards" aria-label="Your cards">${session.multiway.config.heroCards.map(card=>E.canonicalCard(card)).join('')}</div><button type="button" class="seat hero-seat${heroTurn()?' acting':''}" data-sim-seat="${hero.id}" aria-haspopup="dialog"><span>YOU · ${esc(hero.position)}</span><span>Stack <b>${money(hero.stack)}</b></span><small>In ${money(hero.streetPaid)} this street</small></button></div>
      </div></div></div><div class="sim-street">${esc(state.street.toLowerCase())} · ${esc(session.multiway.config.variant.replace('_HIGH',''))} · ${state.players.length} players</div></div>`;
  }
  function controls(){
    const state=session.state;
    let actions='';
    if(session.finished)actions=`${!session.abandoned?button('Next hand','NEXT',true):''}${button('Replay this deal','REPLAY')}${!session.audit?.hands?button('Reveal & audit','REVEAL'):''}${button('New table','CONFIG')}`;
    else if(heroTurn()){
      actions=state.legal.actions.filter(action=>action!=='FOLD'||state.legal.toCall>0).map(action=>['BET','RAISE'].includes(action)?button(action==='BET'?'Bet':'Raise','SIZE',false,`data-action="${action}"`):button(action==='CALL'?`Call ${money(state.legal.toCall)}`:action==='CHECK'?'Check':'Fold','ACT',action!=='FOLD',`data-action="${action}"`)).join('');
    } else if(state.phase==='WAIT_BOARD')actions=button(`Deal ${state.nextStreet.toLowerCase()}`,'DEAL',true);
    else if(state.phase==='SHOWDOWN')actions=button('Showdown','SETTLE',true);
    else if(state.phase==='BETTING')actions=button(session.paused?'Next opponent action':'Play opponents','ADVANCE',true);
    const status=session.abandoned?'Hand ended · no payout recorded':session.finished?`Hand complete · ${signed(session.outcome.heroNet)} chips`:heroTurn()?'Your turn':state.phase==='BETTING'?`${state.players[state.actor].name} to act`:state.phase==='WAIT_BOARD'?'Betting round complete':'Ready for showdown';
    return `<section class="sim-actions" aria-label="Simulation actions"><div class="sim-turn" role="status">${esc(status)}</div><div class="sim-action-buttons">${actions}</div>${!session.finished?`<div class="sim-pace"><label><input type="checkbox" id="sim-paused"${session.paused?' checked':''}${busy?' disabled':''}> Pause after each opponent action</label>${button('End hand','END')}</div>`:''}</section>`;
  }
  function history(){
    return `<details class="sim-history"><summary>Simulation history · ${reports.length} completed or ended hands</summary><div class="sim-history-tools">${button('Download report','EXPORT')}${button('Clear local history','CLEAR')}</div><p>Last 30 hands on this device. Decision snapshots retain the information available before each action; later reveals never replace them. Replayed deals are practice with previously revealed information.</p>${reports.slice().reverse().map(report=>`<details><summary>${esc(report.publicRecord.config.variant.replace('_HIGH',''))} · ${report.abandoned?'Ended without payout':`${signed(report.outcome?.heroNet)} chips`} · ${report.decisions.length} decisions</summary>${report.decisions.map(item=>`<div class="sim-history-decision"><strong>${esc(item.street)} · ${esc(label(item.chosen))}</strong><span>Equity ${Number.isFinite(item.evaluation?.equity?.equity)?money(100*item.evaluation.equity.equity)+'%':'unavailable'} · ${item.evaluation?.analysisStage || 'No estimate at action time'}</span><table class="sim-ev-table"><thead><tr><th>Action</th><th>EV · bb</th></tr></thead><tbody>${(item.presentation?.rows||[]).map(row=>`<tr><th>${esc(label(row))}</th><td>${signed(row.evBB)}</td></tr>`).join('')}</tbody></table></div>`).join('')||'<p>No Hero decisions were recorded.</p>'}</details>`).join('')}</details>`;
  }
  function audit(){
    const revealed=session.audit?.hands;
    return `<details class="sim-audit"><summary>Deal, opponents & audit</summary><p>Unfiltered random deal, committed before the first action. Bots follow the declared contextual reference policy using their own cards and the public board. This tests a modeled simulation, not real opponent accuracy or universal GTO.</p><p>Simulation never updates Players, real hand history, or Train. Sessions live for two hours in server memory and can expire on service restart.</p><p>Commitment <code>${esc(session.deal.commitment)}</code></p>${session.audit?`<p>Completed deal seed <code>${esc(session.audit.seed)}</code></p>`:'<p>The seed and hidden cards remain on the server until this hand ends.</p>'}${revealed?`<div class="sim-reveals">${session.state.players.map(player=>`<div><strong>${esc(player.name)} · ${esc(player.position)}</strong><div>${revealed[player.id].map(card=>E.canonicalCard(card,{small:true})).join('')}</div></div>`).join('')}<div><strong>Fixed runout</strong><div>${session.audit.runout.map(card=>E.canonicalCard(card,{small:true})).join('')}</div></div></div>`:''}${session.shownHands&&!revealed?`<div class="sim-reveals">${Object.entries(session.shownHands).map(([id,cards])=>`<div><strong>${esc(session.state.players[id].name)} · showdown</strong><div>${cards.map(card=>E.canonicalCard(card,{small:true})).join('')}</div></div>`).join('')}</div>`:''}<p>Shuffle: ${esc(session.deal.version)}. Export includes the seed, commitment and decision-time inputs for independent review.</p></details>`;
  }
  function render(){
    if(!host)return;
    const openDetails=[...host.querySelectorAll('details[open]')].map(node=>node.className);
    host.innerHTML=`<div class="sim-heading"><div><h1 id="simulation-title">Simulation</h1><span class="sim-mode">${session?'Random Multiway · isolated practice':'Multiway practice with a fair, hidden deal'}</span></div>${button(session?'New table':'Set up table','CONFIG')}</div><p class="sim-error" role="alert"${error?'':' hidden'}>${esc(error)}</p>${session?`<div class="sim-layout"><div class="sim-game">${table()}${controls()}</div><aside class="sim-evaluation">${decisionPanel()}</aside></div>${audit()}`:'<div class="sim-empty"><p>Play a complete hand against simulated opponents. Deal each street when ready and see equity and modeled action EV on your turn.</p>'+button('Start simulation','CONFIG',true)+'</div>'}${history()}`;
    for(const node of host.querySelectorAll('details'))if(openDetails.includes(node.className)&&node.className)node.open=true;
  }
  async function evaluate(){
    cancel();analysis=null;timing=null;
    if(!active||!heroTurn()){render();return;}
    const stamp=snapshot(),abort=new AbortController();controller=abort;startedAt=performance.now();render();
    try{
      const prepared=await request('/api/simulation/input',{method:'POST',body:JSON.stringify({id:stamp.id,revision:stamp.revision}),signal:abort.signal});
      if(!current(stamp))return;
      const browser=client?.supported;
      for(const phase of ['PREVIEW','FINAL']){
        let result;
        try{
          result=browser?await client.analyze(prepared.input,{phase,signal:abort.signal,owner}):await request('/api/simulation/analyze',{method:'POST',body:JSON.stringify({id:stamp.id,revision:stamp.revision,analysisPhase:phase}),signal:abort.signal});
        }catch(failure){
          if(abort.signal.aborted||!current(stamp))return;
          if(!analysis)throw failure;
          analysis={...analysis,refinement:{status:'FAILED',reason:failure.message}};error='The first estimate is retained; refinement was unavailable.';break;
        }
        if(!current(stamp))return;
        if(result.status==='OK' && result.observedState?.revisionKey===session.state.revisionKey){
          analysis=result;
          const elapsed=performance.now()-startedAt;
          timing={firstMs:timing?.firstMs ?? elapsed,totalMs:elapsed,runtime:browser?'Browser worker':'Server fallback',cache:typeof result.performance?.cacheHit==='boolean'?(result.performance.cacheHit?'hit':'miss'):null};
        }else if(!analysis)analysis=result;
        render();
      }
    }catch(failure){if(current(stamp)&&!abort.signal.aborted){analysis={status:'UNAVAILABLE',reason:failure.message};}}
    finally{if(current(stamp)){controller=null;render();save();}}
  }
  async function perform(operation,extra={}){
    if(busy||!session)return;
    const previous=session,own=owner,stamp=snapshot();
    const pending=operation==='ACT'?{street:previous.state.street,chosen:{action:extra.action,size:extra.to??null},recordedAt:new Date().toISOString(),publicInput:structuredClone(previous.multiway),
      revisionKey:previous.state.revisionKey,evaluation:analysis?structuredClone(analysis):null,timing:timing?{...timing}:null,
      presentation:window.theibsMultiwayUI.describeDecisionEV(previous.state,analysis,{analysisBusy:!!controller,heroDraftReady:true})}:null;
    busy=true;error='';cancel();render();
    try{
      const route=operation==='NEXT'?'next':operation==='REPLAY'?'replay':'step';
      const result=await request('/api/simulation/'+route,{method:'POST',body:JSON.stringify({id:previous.id,revision:previous.revision,requestId:crypto.randomUUID(),operation,...extra})});
      if(owner!==own || session?.id!==previous.id)return;
      if(pending)decisions.push(pending);
      if(result.previous){archive(result.previous);decisions=[];}
      session=result.session;analysis=null;if(session.finished)archive();save();
    }catch(failure){if(owner===own&&session?.id===previous.id){error=failure.message;
      if(failure.status===404){archive({...previous,finished:true,abandoned:true});session=null;decisions=[];}
    }}finally{busy=false;if(owner===stamp.owner){render();if(active)evaluate();}}
  }
  const setup=document.createElement('dialog');setup.className='sim-dialog';setup.setAttribute('aria-labelledby','sim-setup-title');
  const confirmation=document.createElement('dialog');confirmation.className='sim-dialog';confirmation.setAttribute('aria-labelledby','sim-confirm-title');
  function confirmAction(message){
    if(confirmation.open)return Promise.resolve(false);
    confirmation.innerHTML=`<form method="dialog"><h2 id="sim-confirm-title">Confirm simulation change</h2><p>${esc(message)}</p><div class="sim-action-buttons"><button class="ghost-button" value="cancel">Cancel</button><button class="primary-button" value="confirm">Confirm</button></div></form>`;
    confirmation.returnValue='';confirmation.showModal();
    return new Promise(resolve=>confirmation.addEventListener('close',()=>resolve(confirmation.returnValue==='confirm'),{once:true}));
  }
  function configure(){
    if(busy)return;
    const config=session?.multiway.config||{variant:'PLO5_HIGH',playerCount:6,heroPosition:'BTN',startingStack:100,smallBlind:.5,bigBlind:1};
    setup.innerHTML=`<form id="sim-setup-form"><div class="sim-dialog-heading"><h2 id="sim-setup-title">Simulation table</h2><button type="button" class="ghost-button" data-sim-close aria-label="Close simulation setup">×</button></div><div class="sim-setup-grid"><label>Variant<select name="variant"><option value="PLO4_HIGH">PLO4</option><option value="PLO5_HIGH">PLO5</option><option value="PLO6_HIGH">PLO6</option></select></label><label>Total players<select name="playerCount"></select></label><label>Your position<select name="heroPosition"></select></label><label>Starting stack<input name="startingStack" type="number" min="0.01" step="0.01" value="${money(config.startingStack).replaceAll(',','')}" required></label><label>Small blind<input name="smallBlind" type="number" min="0.01" step="0.01" value="${config.smallBlind}" required></label><label>Big blind<input name="bigBlind" type="number" min="0.01" step="0.01" value="${config.bigBlind}" required></label></div><p class="sim-limits">Random deals · reference-policy bots · zero rake. New table starts fresh stacks; Next hand carries settled stacks.</p><p id="sim-setup-error" role="alert"></p><button type="submit" class="primary-button">Deal a random hand</button></form>`;
    const form=setup.querySelector('form'),variant=form.elements.variant,count=form.elements.playerCount,position=form.elements.heroPosition;
    variant.value=config.variant;
    function updateCount(){const n=Number(count.value)||config.playerCount,max=variant.value==='PLO6_HIGH'?5:6;count.innerHTML=Array.from({length:max-1},(_,i)=>`<option>${i+2}</option>`).join('');count.value=Math.min(n,max);updatePosition();}
    function updatePosition(){const selected=position.value||config.heroPosition;position.innerHTML=positions[count.value].map(name=>`<option>${name}</option>`).join('');position.value=positions[count.value].includes(selected)?selected:positions[count.value][0];}
    variant.onchange=updateCount;count.onchange=updatePosition;updateCount();
    setup.querySelector('[data-sim-close]').onclick=()=>setup.close();
    form.onsubmit=async event=>{
      event.preventDefault();if(busy)return;
      if(session&&!session.finished&&!await confirmAction('End the current simulated hand and start a new table?'))return;
      const own=owner;busy=true;form.querySelector('[type=submit]').disabled=true;
      try{
        if(session&&!session.finished){const result=await request('/api/simulation/step',{method:'POST',body:JSON.stringify({id:session.id,revision:session.revision,requestId:crypto.randomUUID(),operation:'END'})});session=result.session;archive();}
        const previousId=session?.id;
        const options=Object.fromEntries(new FormData(form));for(const name of ['playerCount','startingStack','smallBlind','bigBlind'])options[name]=Number(options[name]);
        const result=await request('/api/simulation/start',{method:'POST',body:JSON.stringify({config:options})});
        if(owner!==own)return;cancel();session=result.session;analysis=null;decisions=[];error='';save();setup.close();
        if(previousId)request('/api/simulation/release',{method:'POST',body:JSON.stringify({id:previousId})}).catch(()=>{});
      }catch(failure){setup.querySelector('#sim-setup-error').textContent=failure.message;}
      finally{busy=false;form.querySelector('[type=submit]').disabled=false;render();if(active)evaluate();}
    };
    setup.showModal();
  }
  const editor=document.createElement('dialog');editor.className='sim-dialog';editor.setAttribute('aria-labelledby','sim-editor-title');
  function sizing(action){
    if(!heroTurn()||busy)return;
    const legal=session.state.legal;
    editor.innerHTML=`<form><div class="sim-dialog-heading"><h2 id="sim-editor-title">${action==='BET'?'Bet':'Raise'} to</h2><button type="button" class="ghost-button" data-sim-close aria-label="Close sizing">×</button></div><label>Total committed this street<input name="to" type="number" min="${legal.minTo}" max="${legal.maxTo}" step="0.01" value="${legal.minTo}" required autofocus></label><p>Legal total ${money(legal.minTo)}–${money(legal.maxTo)} chips.</p><div class="sim-action-buttons"><button type="button" class="ghost-button" data-max>Maximum ${money(legal.maxTo)}</button><button type="submit" class="primary-button">Confirm ${action.toLowerCase()}</button></div></form>`;
    editor.querySelector('[data-sim-close]').onclick=()=>editor.close();editor.querySelector('[data-max]').onclick=()=>{editor.querySelector('input').value=legal.maxTo;};
    editor.querySelector('form').onsubmit=event=>{event.preventDefault();const to=Number(editor.querySelector('input').value);editor.close();perform('ACT',{action,to});};editor.showModal();
  }
  function inspect(id){
    const player=session?.state.players.find(item=>item.id===id);if(!player)return;
    editor.innerHTML=`<div class="sim-dialog-heading"><h2 id="sim-editor-title">${esc(player.name)} · ${esc(player.position)}</h2><button type="button" class="ghost-button" data-sim-close aria-label="Close seat details">×</button></div><p>Stack ${money(player.stack)} · committed this street ${money(player.streetPaid)}</p><p>${player.folded?'Folded':player.allIn?'All-in':'Active'}${player.lastAction?' · '+esc(player.lastAction.toLowerCase()):''}</p><div class="sim-reveals">${(session.audit?.hands?.[id] || session.shownHands?.[id] || (player.hero?session.multiway.config.heroCards:[])).map(card=>E.canonicalCard(card,{small:true})).join('')}</div>`;
    editor.querySelector('[data-sim-close]').onclick=()=>editor.close();editor.showModal();
  }
  function download(){archive();const blob=new Blob([JSON.stringify({schema:'THEIBS_SIMULATION_REPORT_V1',source:'SIMULATION_ONLY',exportedAt:new Date().toISOString(),reports,active:session?{public:session,decisions}:null},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='theibs-simulation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function enter(){
    active=true;const selected=getOwner();if(!selected){error='Account verification is required to start a simulation.';render();return;}
    if(owner!==selected){clearOwner();active=true;owner=selected;restored=false;}
    if(!client)client=window.TheibsBrowserMultiwayClient?.create();
    if(!restored){restored=true;const restoring=generation;try{const saved=JSON.parse(localStorage.getItem(key())||'null');reports=Array.isArray(saved?.reports)?saved.reports.filter(item=>item?.publicRecord?.config?.variant&&Array.isArray(item.decisions)).slice(-30):[];decisions=Array.isArray(saved?.decisions)?saved.decisions:[];
      if(saved?.sessionId){const own=owner,data=await request('/api/simulation/state',{method:'POST',body:JSON.stringify({id:saved.sessionId})});if(own===owner&&generation===restoring)session=data.session;}
    }catch(failure){error='The previous simulation is no longer available. Saved completed hands remain in Simulation history.';decisions=[];save();}}
    render();if(active)evaluate();
  }
  function leave(){active=false;cancel();if(setup.open)setup.close();if(editor.open)editor.close();if(confirmation.open)confirmation.close('cancel');save();}
  function clearOwner(){leave();client?.close();client=null;owner=null;session=null;analysis=null;reports=[];decisions=[];error='';restored=false;render();}
  function init(options){request=(url,settings={})=>options.request(url,{...settings,headers:{'Content-Type':'application/json',...settings.headers}});getOwner=options.getOwner;host=document.getElementById('simulation-workspace');document.body.append(setup,editor,confirmation);
    host.addEventListener('click',async event=>{
      const seat=event.target.closest('[data-sim-seat]');if(seat){inspect(Number(seat.dataset.simSeat));return;}
      const target=event.target.closest('[data-sim-op]');if(!target)return;const op=target.dataset.simOp;
      if(op==='CONFIG')configure();else if(op==='SIZE')sizing(target.dataset.action);else if(op==='EXPORT')download();
      else if(op==='CLEAR'){if(await confirmAction('Clear completed simulation history on this device?')){reports=[];save();render();}}
      else if(op==='END'){if(await confirmAction('End this hand without recording a payout?'))perform(op);}
      else perform(op,op==='ACT'?{action:target.dataset.action}:{});
    });
    host.addEventListener('change',event=>{if(event.target.id==='sim-paused')perform('PACE',{paused:event.target.checked});});
    document.addEventListener('keydown',event=>{
      if(!active||busy||event.repeat||event.ctrlKey||event.altKey||event.metaKey||document.querySelector('dialog[open]')||event.target.closest('input,textarea,select,[contenteditable=true]'))return;
      if(event.key==='Shift'&&session?.finished&&!session.abandoned){event.preventDefault();perform('NEXT');}
      if(!heroTurn())return;
      const actions=session.state.legal.actions;if(event.key===',' && (actions.includes('CALL')||actions.includes('CHECK'))){event.preventDefault();perform('ACT',{action:actions.includes('CALL')?'CALL':'CHECK'});}
      else if(event.key==='.'&&session.state.legal.toCall>0){event.preventDefault();perform('ACT',{action:'FOLD'});}
      else if(event.key===';'&&(actions.includes('BET')||actions.includes('RAISE'))){event.preventDefault();sizing(actions.includes('BET')?'BET':'RAISE');}
    });render();
  }
  window.TheibsSimulationUI={init,enter,leave,clearOwner,configure};
})();
