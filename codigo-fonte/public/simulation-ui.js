(function () {
  'use strict';
  const E=window.EssenceUI, T=window.TheibsSimulationTools, esc=E.esc, money=E.money;
  const positions={2:['SB','BB'],3:['BTN','SB','BB'],4:['CO','BTN','SB','BB'],5:['HJ','CO','BTN','SB','BB'],6:['UTG','HJ','CO','BTN','SB','BB']};
  let host,request,getOwner,owner=null,session=null,analysis=null,active=false,busy=false,controller=null,client=null,generation=0;
  let reports=[],decisions=[],error='',timing=null,startedAt=0,restored=false,connection='CONNECTED',pendingIntent=null,chosenSize=null,recoveryId=null;
  let progress=T.practiceProgress();
  let validation=null,batchScope='CURRENT',batchWorlds=128;
  let evaluationFootprint=0,layoutHand=null,retainedFocus=null,shortcutMessage='',restoringSession=false;
  let keyboardObservations=[];
  async function keyboardFlush(){
    if(!active||!session||busy||restoringSession||pendingIntent||connection!=='CONNECTED')return;
    keyboardObservations=keyboardObservations.filter(item=>item.id===session.id);
    if(!keyboardObservations.length)return;
    for(let n=0;n<100&&!busy&&session&&!session.finished;n++){
      const item=keyboardObservations.find(item=>!item.error&&item.actor===session.state.actor&&item.street===session.state.street);
      if(!item||session.state.phase!=='BETTING')break;
      const before=session.revision,actions=session.state.legal.actions;
      const action=item.kind==='FOLD'?'FOLD':item.kind==='MATCH'?(actions.includes('CHECK')?'CHECK':'CALL'):(actions.includes('BET')?'BET':'RAISE');
      await perform('ACT',{actor:item.actor,action,...(item.actor!==session.state.heroId?{manualOpponents:true}:{}),...(item.to==null?{}:{to:item.to})});
      if(session?.revision!==before)keyboardObservations=keyboardObservations.filter(entry=>entry!==item);
      else {item.error=error||'Review this action.';break;}
    }
    render();
  }
  function keyboardCapture(kind,actor,to){
    const player=session?.state.players.find(player=>player.id===actor);
    if(!player||session.finished||player.folded||player.allIn||actor!==session.state.actor||session.state.phase!=='BETTING'||busy||pendingIntent)return false;
    const item={id:session.id,actor,kind,to,street:session.state.phase==='WAIT_BOARD'?session.state.nextStreet:session.state.street};
    keyboardObservations=keyboardObservations.filter(entry=>entry.actor!==actor||entry.street!==item.street);keyboardObservations.push(item);
    save();window.theibsKeyboard.queue.push(keyboardFlush);return true;
  }
  async function keyboardAction(kind,to,expected={}){
    if(!active||!session||busy||restoringSession||pendingIntent||connection!=='CONNECTED')return false;
    if(expected.id&&expected.id!==session.id||expected.street&&expected.street!==session.state.street||session.state.phase!=='BETTING')return false;
    const before=session.revision,id=session.id,actor=session.state.actor,actions=session.state.legal.actions;
    const action=kind==='FOLD'?'FOLD':kind==='MATCH'?(actions.includes('CHECK')?'CHECK':'CALL'):(actions.includes('BET')?'BET':'RAISE');
    if(!actions.includes(action)){shortcutMessage='Action unavailable for this turn.';render();return false;}
    await perform('ACT',{actor,action,...(actor!==session.state.heroId?{manualOpponents:true}:{}),...(to==null?{}:{to})});
    return session?.id===id&&session.revision!==before;
  }
  async function keyboardCommand(type,expected=null){
    if(type==='CONFIRM'&&(!active||busy||restoringSession||pendingIntent||connection!=='CONNECTED'))return;
    for(let n=0;(busy||restoringSession)&&n<1200;n++)await new Promise(resolve=>setTimeout(resolve,16));
    if(!active)return;
    if(expected&&(session?.id!==expected.id||session?.revision!==expected.revision))return;
    if(type==='NEW_GAME'){configure();return;}
    if(type==='RESET_HAND'){if(session)await perform('RESTART');else configure();keyboardObservations=[];return;}
    if(type==='BACKSPACE')return;
    if(type==='CONFIRM'){
      const next=enterAction();
      if(next)await perform(next.operation,next.extra||{});
      else {shortcutMessage='Choose F, G or H for this turn.';render();}
      focusPlayArea();
    }
  }
  const key=()=>`theibs.simulation.v1.${owner}`;
  const snapshot=()=>session?{id:session.id,revision:session.revision,owner,generation}:null;
  const current=stamp=>active && stamp && stamp.id===session?.id && stamp.revision===session?.revision && stamp.owner===owner && stamp.generation===generation;
  const button=(label,op,primary=false,extra='')=>`<button type="button" class="${primary?'primary-button':'ghost-button'}" data-sim-op="${op}"${busy||restoringSession||(pendingIntent&&!['RETRY','EXPORT','BANKROLL'].includes(op))||(connection==='OFFLINE'&&!['RETRY','REFRESH','EXPORT','CONFIG','BANKROLL'].includes(op))?' disabled':''} ${extra}>${label}</button>`;
  const label=row=>({FOLD:'Fold',CALL:'Call',CHECK:'Check',BET:'Bet',RAISE:'Raise'}[row.action]||row.action)+(row.size==null?'':` to ${money(row.size)}`);
  const signed=value=>Number.isFinite(value)?`${value>0?'+':''}${money(value)}`:'—';
  const heroTurn=()=>!session?.finished && session?.state.phase==='BETTING' && session.state.actor===session.state.heroId;
  const userTurn=()=>!session?.finished&&session?.state.phase==='BETTING'&&(heroTurn()||session.manualOpponents);
  const canContinue=()=>session?.state.players[session.state.heroId].stack>0&&session.state.players.filter(player=>player.stack>0).length>=2;
  const validationIdle=()=>active&&!!owner&&!restoringSession&&!busy&&!controller&&!pendingIntent&&!document.hidden&&connection==='CONNECTED'&&!document.querySelector('dialog[open]');
  function captureValidation(size=chosenSize){
    if(!validation||!active||!owner||!heroTurn()||session.replayed)return;
    const record=window.TheibsSimulationValidation.publicInput(session.multiway,size).multiway;
    validation.enqueue([{record,chosenSize:size,replayed:false,label:`${session.multiway.config.variant.replace('_HIGH','')} · ${session.state.street} · hand ${session.id.slice(-6)} · revision ${session.revision} · frozen decision`}]);
  }
  function enterAction(){
    if(!session)return null;
    if(heroTurn())return null;
    if(session.finished)return {operation:!session.abandoned&&canContinue()?'NEXT':'RESTART'};
    if(session.state.phase==='WAIT_BOARD')return {operation:'DEAL'};
    if(session.state.phase==='SHOWDOWN')return {operation:'SETTLE'};
    if(session.state.phase==='BETTING'&&!userTurn())return {operation:'ADVANCE'};
    return null;
  }
  function focusPlayArea(){host?.querySelector('.sim-actions')?.focus({preventScroll:true});}
  function cancel(){validation?.setAvailable(false);generation++;controller?.abort();controller=null;}
  function save(){
    if(!owner)return;
    try{reports=T.boundedHistory(reports);localStorage.setItem(key(),JSON.stringify({sessionId:session?.id||recoveryId||null,session,reports,decisions,pendingIntent,progress,keyboardObservations}));}
    catch{error='Local simulation history could not be saved. Download the report before leaving.';}
  }
  function archive(value=session){
    if(!value?.finished)return;
    const item={id:value.id,endedAt:new Date().toISOString(),source:'SIMULATION_ONLY',policy:value.policy,deal:value.deal,
      outcome:value.outcome,abandoned:value.abandoned,audit:value.audit,shownHands:value.shownHands,validation:value.validation,replayed:value.replayed,
      publicRecord:value.multiway,decisions:structuredClone(decisions)};
    const index=reports.findIndex(report=>report.id===item.id);
    if(index>=0)reports[index]=item;else reports.push(item);
    T.recordProgress(progress,item);
    reports=T.boundedHistory(reports);save();
  }
  const cash=chips=>new Intl.NumberFormat('en-US',{style:'currency',currency:progress.settings.currency,maximumFractionDigits:2}).format(chips*progress.settings.chipValue);
  function progressChart(result){
    const model=T.progressChartModel(result.points),width=1000,height=160;
    const x=hand=>(hand-model.xDomain[0])/(model.xDomain[1]-model.xDomain[0])*width;
    const y=value=>(model.yDomain[1]-value)/(model.yDomain[1]-model.yDomain[0])*height;
    const coordinate=value=>value.toFixed(3);
    const tick=value=>new Intl.NumberFormat('en-US',{notation:Math.abs(value)>=10000?'compact':'standard',maximumFractionDigits:Math.abs(value)>=10000?2:model.tickPrecision}).format(value);
    const yTicks=result.hands?model.yTicks:[0],xTicks=result.hands?model.xTicks:[0];
    const zero=coordinate(y(0)),line=model.points.map(point=>`${coordinate(x(point.hand))},${coordinate(y(point.netChips))}`).join(' ');
    const description=result.hands?model.description:'No settled hands yet. Complete a fresh hand to start tracking cumulative net profit.';
    return `<figure class="sim-progress-figure" aria-labelledby="sim-progress-title"><figcaption class="sim-progress-heading"><strong id="sim-progress-title">Cumulative net profit <span>· chips</span></strong><div class="sim-progress-current"><strong class="${result.netChips<0?'sim-loss':'sim-gain'}">${signed(result.netChips)} chips</strong><span>${result.hands?`Hand ${result.hands}`:'No settled hands'}</span></div></figcaption>
      <div class="sim-progress-plot"><div class="sim-progress-y" aria-hidden="true">${yTicks.map(value=>`<span${value===0?' class="sim-progress-zero-label"':''} style="top:${coordinate(y(value)/height*100)}%">${esc(tick(value))}</span>`).join('')}</div><div class="sim-progress-drawing">
        <svg class="sim-progress-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(description)}"><title>${esc(description)}</title><defs><clipPath id="sim-progress-below-zero"><rect x="-4" y="${zero}" width="${width+8}" height="${coordinate(height-y(0)+4)}"/></clipPath></defs>
          ${yTicks.map(value=>`<line x1="0" y1="${coordinate(y(value))}" x2="${width}" y2="${coordinate(y(value))}" class="${value===0?'sim-progress-zero':'sim-progress-grid'}"/>`).join('')}${xTicks.map(hand=>`<line x1="${coordinate(x(hand))}" y1="0" x2="${coordinate(x(hand))}" y2="${height}" class="sim-progress-grid sim-progress-grid-x"/>`).join('')}
          ${result.hands?`<polyline class="sim-progress-line" points="${line}"/>${model.minChips<0?`<polyline class="sim-progress-line sim-progress-line-loss" points="${line}" clip-path="url(#sim-progress-below-zero)"/>`:''}`:''}
        </svg>${result.hands?`<span class="sim-progress-endpoint${result.netChips<0?' sim-progress-endpoint-loss':''}" style="left:${coordinate(x(model.lastPoint.hand)/width*100)}%;top:${coordinate(y(model.lastPoint.netChips)/height*100)}%" aria-hidden="true"></span>`:'<p class="sim-progress-empty">Complete a fresh hand to start your chart.</p>'}
      </div><div class="sim-progress-x" aria-hidden="true">${xTicks.map((hand,index)=>`<span class="${index===0?'sim-progress-tick-first':index===xTicks.length-1?'sim-progress-tick-last':''}" style="left:${coordinate(x(hand)/width*100)}%">${hand}</span>`).join('')}</div><div class="sim-progress-x-title">Settled hands</div></div></figure>`;
  }
  function bankroll(){
    const result=T.progressSummary(progress);
    return `<details class="sim-bankroll" aria-label="Simulated bankroll"><summary><span>Practice bankroll</span><strong class="${result.full||result.netChips<0?'sim-loss':'sim-gain'}">${result.full?'Storage full':`${signed(result.netChips)} chips`}</strong></summary><div class="sim-bankroll-content"><div class="sim-bankroll-heading"><h2>Practice bankroll <span>Simulated money</span></h2>${button('Bankroll settings','BANKROLL')}</div><dl class="sim-bankroll-metrics"><div><dt>Settled balance</dt><dd>${esc(cash(result.balanceChips))}<small>${money(result.balanceChips)} chips</small></dd></div><div><dt>Profit / loss</dt><dd class="${result.netChips<0?'sim-loss':'sim-gain'}">${signed(result.netChips)} chips<small>${esc(cash(result.netChips))}</small></dd></div><div><dt>Settled hands</dt><dd>${result.hands}<small>${result.lastNetChips===null?'No results yet':`Last hand ${signed(result.lastNetChips)} chips`}</small></dd></div></dl><details class="sim-progress-details"><summary>Progress & accounting</summary>${progressChart(result)}<details class="sim-progress-accounting"><summary>Accounting details</summary><p>Starting funds ${money(progress.settings.initialChips)} chips · 1 chip = ${esc(cash(1))}. Only settled hand profit changes this balance. Chips committed during a hand remain on the table; refilling stacks is not profit.</p><p>${result.replays} replays and ${result.unsettled} hands without a payout excluded. This device stores up to 2,000 progress records separately from detailed history. No real money or player statistics are updated.</p></details></details>${result.full?'<p class="sim-error" role="status">Progress storage is full. Download your report, then reset progress in Bankroll settings to track a new period.</p>':''}</div></details>`;
  }
  function guidance(decision=null){
    if(!heroTurn()||analysis?.status!=='OK'||analysis.observedState?.revisionKey!==session.state.revisionKey||
      analysis.observedState?.handId&&analysis.observedState.handId!==session.multiway.handId)return null;
    const guide=T.actionGuidance(decision||window.theibsMultiwayUI.describeDecisionEV(session.state,analysis,{analysisBusy:!!controller,heroDraftReady:true}),session.state);
    if(guide&&['BET','RAISE'].includes(guide.row.action)&&Math.abs(guide.row.size*100-Math.round(guide.row.size*100))>1e-7)return null;
    return guide;
  }
  function decisionPanel(){
    if(!heroTurn())return `<section class="sim-result sim-result-waiting"><div class="sim-result-heading"><h2>Decision EV</h2><span class="status-chip">${session?.finished?'Hand complete':'On your turn'}</span></div><p class="sim-result-message">${session?.finished?'Review your saved decisions in Simulation history.':'Your action estimates appear here when the turn returns to you.'}</p></section>`;
    const decision=window.theibsMultiwayUI.describeDecisionEV(session.state,analysis,{analysisBusy:!!controller,heroDraftReady:true});
    const rows=decision?.rows||[];
    const guide=guidance(decision),leader=guide?.row;
    const eq=analysis?.equity?.equity;
    const precision=decision?.precision;
    const confidence=guide?.conclusive?'CONCLUSIVE IN MODEL':'INCONCLUSIVE';
    const cards=rows.map(row=>`<div class="sim-ev-option${leader?.optionId===row.optionId?' sim-leader-row':''}" role="listitem"><strong title="${esc(label(row))}">${esc(label(row))}</strong><b>${signed(row.evBB)} <small>bb</small></b><span>${row.status==='MODELED'?decision.stage==='PROVISIONAL'?'Provisional':'':row.status==='PENDING'?'Calculating':'Unavailable'}</span></div>`).join('');
    return `<section class="sim-result" aria-label="Current decision evaluation"><div class="sim-result-heading"><h2>Decision EV</h2><span class="status-chip">${analysis?.status==='OK'?`HEURISTIC · ${confidence}`:controller?'Calculating':'Unavailable'}</span>${analysis?.status==='UNAVAILABLE'||analysis?.refinement?.status==='FAILED'?button('Retry EV','EVALUATE'):''}</div><div class="sim-ev-options" role="list" aria-label="Estimated action EV in big blinds">${cards}</div><div class="sim-equity"><span>Showdown equity</span><strong>${Number.isFinite(eq)?`${money(100*eq)}%`:'—'}</strong></div>${!rows.length?`<p class="sim-result-message" role="status">${esc(controller?'Comparing actions… You can act without waiting.':analysis?.reason || 'No estimate is available for this decision.')}</p>`:''}<details class="sim-methods"><summary>Methods & limits</summary><div class="sim-methods-content"><p class="sim-context">Pot ${money(session.state.pot)} · Call ${money(session.state.legal.toCall)} · 1 bb = ${money(session.state.bigBlind)} chips</p>
      ${guide?`<div class="sim-guidance" role="status"><span>${esc(guide.heading)}</span><strong>${esc(label(leader))}</strong><div>Expected value <b>${signed(leader.evBB)} bb</b></div><p>${guide.conclusive?'CONCLUSIVE within this model and sizing grid.':`INCONCLUSIVE · ${esc(guide.reason)}`}${Number.isFinite(decision.gapBestSecondBB)?`<br>ΔEV · top two ${money(decision.gapBestSecondBB)} bb`:''}</p></div>`:controller?'<p class="sim-limits" role="status">Comparing actions… You can act without waiting.</p>':'<p class="sim-limits">No comparable action leader is available. Choose any legal action below the table.</p>'}
      <table class="sim-ev-table"><thead><tr><th>Action</th><th>EV · bb</th><th>EV shortfall · bb</th></tr></thead><tbody>${rows.map(row=>`<tr${leader?.optionId===row.optionId?' class="sim-leader-row"':''}><th scope="row">${esc(label(row))}<small>${row.status==='MODELED'?decision.stage==='PROVISIONAL'?'Provisional':'Modeled':row.status==='PENDING'?'Calculating':'Unavailable'}</small></th><td>${signed(row.evBB)}</td><td>${signed(row.differenceBB)}</td></tr>`).join('')}</tbody></table>
      ${pendingIntent&&!busy&&connection==='OFFLINE'?'<p class="sim-limits">Last confirmed decision · waiting for request acknowledgement.</p>':''}
      ${!guide&&precision?.status==='INCONCLUSIVE'?`<p class="sim-limits">INCONCLUSIVE · ${esc(precision.reason || String(precision.reasonCode||'Defensible error bounds unavailable.').replaceAll('_',' ').toLowerCase())}</p>`:''}
      ${analysis?.status && analysis.status!=='OK'?`<p role="status">${esc(analysis.reason || 'No estimate is available for this decision.')}</p>`:''}
      ${analysis?.refinement?.status==='TIME_BUDGET'?'<p class="sim-limits">Refinement reached its budget. The available estimate is retained.</p>':''}
      ${session.manualOpponentActions?'<p class="sim-limits">Scenario EV: entered opponent actions are interpreted under the reference policy. Manual choices are not calibrated observations.</p>':''}
      <p>EV estimates average additional chips from this decision, expressed in big blinds. A positive EV can still trail another action. EV shortfall is how far an alternative trails the current leader; zero identifies the leader. It is not a second profit estimate. ΔEV compares the top two estimates. None of these values is your actual hand profit.</p><p>Contextual continuation policy, not GTO. Uniform card priors are conditioned on public actions. Actual hidden cards and future board cards are excluded. Random full ranges do not become explicit solver ranges.</p><p>Zero rake · finite legal sizing grid · ${esc(session.policy.version)}. Sampling bounds measure numerical uncertainty within this fixed policy, not uncertainty about human opponents.</p>${timing?`<p>First estimate: ${money(timing.firstMs)} ms · final attempt: ${money(timing.totalMs)} ms · ${esc(timing.runtime)} · cache ${esc(timing.cache || 'not reported')}.</p>`:''}${decision?.assumptions?.map(text=>`<p>${esc(text)}</p>`).join('')||''}</div></details></section>`;
  }
  function table(){
    const state=session.state,hero=state.players[state.heroId],count=session.multiway.config.heroCards.length;
    const pot=state.phase==='FINISHED'?(state.result?.pots||state.result?.awards||[]).reduce((sum,item)=>sum+item.amount,0):state.pot;
    const seats=E.multiwaySeats(state,count).replaceAll('data-multiway-player','data-sim-seat');
    return `<div class="sim-table-wrap"><div class="mesa-stage"><div class="poker-table"><div class="table-felt"><div class="analysis-seats">${seats}</div>
      <div class="table-center"><div class="table-pot-summary"><span class="eyebrow">${state.phase==='FINISHED'?'SETTLED':'TOTAL'} POT · CHIPS</span><strong class="pot-value">${money(pot)}</strong></div><div class="board-cards" aria-label="Community cards">${Array.from({length:5},(_,index)=>E.canonicalCard(state.board[index],{label:`Board ${index+1}`,emptyLabel:state.board[index]?'':['F','F','F','T','R'][index]})).join('')}</div></div>
      <div class="hero-position"><div class="hero-cards" aria-label="Your cards">${session.multiway.config.heroCards.map(card=>E.canonicalCard(card)).join('')}</div><button type="button" class="seat hero-seat${heroTurn()?' acting':''}" data-sim-seat="${hero.id}" aria-haspopup="dialog"><span>YOU · ${esc(hero.position)}</span><span class="sim-hero-balance"><span><small>Stack</small><b>${money(hero.stack)}</b></span><span><small>In</small><b>${money(hero.streetPaid)}</b></span></span></button></div>
      </div></div></div><div class="sim-street">${esc(state.street.toLowerCase())} · ${esc(session.multiway.config.variant.replace('_HIGH',''))} · ${state.players.length} players</div></div>`;
  }
  function controls(){
    const state=session.state;
    const contextual=(text,op)=>button(`${text}<small>Enter</small>`,op,true,'data-sim-enter');
    let actions='';
    if(session.finished)actions=`${!session.abandoned&&canContinue()?contextual('Next hand','NEXT')+button('New deal','RESTART'):contextual('New deal · fresh stacks','RESTART')}${button('Replay this deal','REPLAY')}${!session.audit?.hands?button('Reveal & audit','REVEAL'):''}`;
    else if(userTurn()){
      const guide=guidance();
      actions=state.legal.actions.filter(action=>action!=='FOLD'||state.legal.toCall>0).map(action=>{
        const selected=guide?.row.action===action,key=action==='FOLD'?'F':['BET','RAISE'].includes(action)?'H':'G';
        const name=action==='CALL'?`Call ${money(state.legal.toCall)}`:action==='CHECK'?'Check':action==='BET'?'Bet':action==='RAISE'?'Raise':'Fold';
        return button(`<kbd>${key}</kbd><span>${name}</span>`,['BET','RAISE'].includes(action)?'SIZE':'ACT',false,`data-action="${action}" data-estimate-leader="${selected}"`);
      }).join('');
    } else if(state.phase==='WAIT_BOARD')actions=contextual(`Deal ${state.nextStreet.toLowerCase()}`,'DEAL');
    else if(state.phase==='SHOWDOWN')actions=contextual('Showdown','SETTLE');
    else if(state.phase==='BETTING')actions=contextual(session.paused?'Next opponent action':'Play opponents','ADVANCE');
    const status=busy&&['NEXT','RESTART'].includes(pendingIntent?.operation)?'Starting next hand\u2026':busy&&pendingIntent?.operation==='ACT'?'Recording action\u2026':session.abandoned?'Hand ended · no payout recorded':session.finished?`Hand complete · ${signed(session.outcome.heroNet)} chips`:heroTurn()?'Your turn':state.phase==='BETTING'?`${state.players[state.actor].seatName||state.players[state.actor].name} · ${state.players[state.actor].position} to act`:state.phase==='WAIT_BOARD'?'Betting round complete':'Ready for showdown';
    const mode=session.manualOpponents?'MANUAL':session.paused?'STEP':'AUTO';
    const shortcut=enterAction(),hint=heroTurn()?shortcutMessage||'Choose F, G or H. Enter returns to your decision.':shortcut?.operation==='RESTART'?'Enter deals fresh cards with refilled table stacks.':shortcut?'Enter advances the next step.':'Choose an opponent action with F, G or H.';
    return `<section class="sim-actions" aria-label="Simulation actions" tabindex="-1"><div class="sim-turn" role="status">${esc(status)}</div><div class="sim-action-buttons sim-primary-actions">${actions}</div><div class="sim-shortcut-hint sim-enter-hint" role="status">${esc(hint)}</div><p id="simulation-keyboard-target" class="sim-shortcut-hint" aria-live="polite">Selected player</p>${keyboardObservations.length?`<p class="sim-shortcut-hint sim-pending-observations">${keyboardObservations.map(item=>`${esc(session.state.players.find(player=>player.id===item.actor)?.name)} · ${esc(item.kind)}${item.to==null?'':' '+item.to} · ${esc(item.error||'pending flow')}`).join(' · ')}</p>`:''}${!session.finished?`<details class="sim-control-options"><summary>Table options</summary><div class="sim-control-options-content"><div class="sim-pace"><label>Opponents<select id="sim-control"${busy||pendingIntent?' disabled':''}><option value="AUTO"${mode==='AUTO'?' selected':''}>Automatic</option><option value="STEP"${mode==='STEP'?' selected':''}>One action at a time</option><option value="MANUAL"${mode==='MANUAL'?' selected':''}>Choose every action</option></select></label>${button('New deal','RESTART')}</div><details class="sim-hand-tools"><summary>Hand options</summary><div class="sim-action-buttons">${button('Finish with reference policy','FINISH')}${button('End without payout','END')}</div></details></div></details>`:!canContinue()&&!session.abandoned?'<p class="sim-limits">Start a new deal to refill stacks.</p>':''}</section>`;
  }
  function history(){
    const check=T.summary(reports);
    return `<details class="sim-history"><summary>Simulation history · ${reports.length} completed or ended hands</summary><div class="sim-history-tools">${button('Download report','EXPORT')}${button('Clear local history','CLEAR')}</div><p>Up to 100 hands within this device's storage budget. Decision snapshots preserve only the information available before each action. Replay is informed practice.</p><details class="sim-validation"><summary>EV validation data · ${check.count} comparable outcomes</summary><p>A fresh deal finished with the reference policy can provide a held-out outcome for its last evaluated Hero action. Manual opponents, replay and abandoned hands are excluded. One payout is a noisy outcome, not the true EV of an action.</p><p>${check.count?`Mean observed minus predicted: ${signed(check.meanResidualBB)} bb · outcome RMSE: ${money(check.rmseBB)} bb.`:'Choose an action, then use Hand options → Finish with reference policy to collect a comparable outcome.'}</p><p>These descriptive, user-selected samples do not certify accuracy, human behavior or GTO. Export supports independent regression checks; no engine weights or real player statistics are updated.</p></details>${reports.slice().reverse().map(report=>`<details><summary>${esc(report.publicRecord.config.variant.replace('_HIGH',''))} · ${report.abandoned?'Ended without payout':`${signed(report.outcome?.heroNet)} chips`} · ${report.decisions.length} decisions${report.replayed?' · Replay':''}</summary>${report.decisions.map(item=>`<div class="sim-history-decision"><strong>${esc(item.street)} · ${esc(label(item.chosen))}</strong><span>Equity ${Number.isFinite(item.evaluation?.equity?.equity)?money(100*item.evaluation.equity.equity)+'%':'unavailable'} · ${item.evaluation?.analysisStage || 'No estimate at action time'}</span><table class="sim-ev-table"><thead><tr><th>Action</th><th>EV · bb</th></tr></thead><tbody>${(item.presentation?.rows||[]).map(row=>`<tr><th>${esc(label(row))}</th><td>${signed(row.evBB)}</td></tr>`).join('')}</tbody></table></div>`).join('')||'<p>No Hero decisions were recorded.</p>'}</details>`).join('')}</details>`;
  }
  function audit(){
    const revealed=session.audit?.hands;
    return `<details class="sim-audit"><summary>Deal, opponents & audit</summary><p>Unfiltered random deal, committed before the first action. Bots follow the declared contextual reference policy using their own cards and the public board. This tests a modeled simulation, not real opponent accuracy or universal GTO.</p><p>Simulation never updates Players, real hand history, or Train. Sessions live for two hours in server memory and can expire on service restart.</p><p>Commitment <code>${esc(session.deal.commitment)}</code></p>${session.audit?`<p>Completed deal seed <code>${esc(session.audit.seed)}</code></p>`:'<p>The seed and hidden cards remain on the server until this hand ends.</p>'}${revealed?`<div class="sim-reveals">${session.state.players.map(player=>`<div><strong>${esc(player.name)} · ${esc(player.position)}</strong><div>${revealed[player.id].map(card=>E.canonicalCard(card,{small:true})).join('')}</div></div>`).join('')}<div><strong>Fixed runout</strong><div>${session.audit.runout.map(card=>E.canonicalCard(card,{small:true})).join('')}</div></div></div>`:''}${session.shownHands&&!revealed?`<div class="sim-reveals">${Object.entries(session.shownHands).map(([id,cards])=>`<div><strong>${esc(session.state.players[id].name)} · showdown</strong><div>${cards.map(card=>E.canonicalCard(card,{small:true})).join('')}</div></div>`).join('')}</div>`:''}<p>Shuffle: ${esc(session.deal.version)}. Export includes the seed, commitment and decision-time inputs for independent review.</p></details>`;
  }
  function validationContexts(){
    const items=[];
    if(batchScope==='SAVED'){
      for(const report of reports.filter(item=>!item.replayed))for(const item of report.decisions||[])items.push({record:item.publicInput,chosenSize:item.chosen?.size,label:`${item.publicInput?.config?.variant?.replace('_HIGH','')||'Omaha'} · ${item.street} · saved decision`});
      if(!session?.replayed)for(const item of decisions)items.push({record:item.publicInput,chosenSize:item.chosen?.size,label:`${item.street} · saved decision`});
    }
    if(heroTurn()&&!session.replayed)items.push({record:session.multiway,chosenSize,label:`${session.multiway.config.variant.replace('_HIGH','')} · ${session.state.street} · hand ${session.id.slice(-6)} · revision ${session.revision} · frozen decision`});
    return items;
  }
  function renderValidation(){
    const section=host?.querySelector('.sim-batches');if(!section){render();return;}
    const next=document.createElement('div');next.innerHTML=batchPanel();
    if(next.firstElementChild)T.patchDOM(section,next.firstElementChild);
    const setting=host.querySelector('#sim-validation-auto');if(setting)setting.checked=!!validation.automatic;
  }
  function validationStatus(batch,scheduler){
    if(!validation.supported)return 'Unavailable on this browser';
    if(scheduler.manualPaused)return 'Paused by you';
    if(batch?.status==='RUNNING')return `Checking · ${batch.contexts[batch.index]?.result?.count||0}/${batch.worlds} worlds`;
    if(batch?.status==='ERROR')return 'Check interrupted';
    if(!validation.automatic)return 'Automatic off';
    if(scheduler.queued)return `Waiting · ${scheduler.queued} queued`;
    if(batch?.status==='COMPLETE')return 'Compared · see results';
    return 'Automatic on · waiting for a decision';
  }
  function validationRows(batch){return (batch?.contexts||[]).flatMap((item,index)=>(item.result?.summary?.rows||[]).map(row=>({context:index+1,...row})));}
  function validationTable(rows){
    return rows.length?`<div class="sim-batch-table-wrap"><table class="sim-ev-table sim-batch-table"><thead><tr><th>Decision / action</th><th>Recomputed EV · bb</th><th>Validation mean · bb</th><th>Difference · bb</th></tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${row.context} · ${esc(label(row))}<small>${row.comparison==='EXACT_REFERENCE'?'Exact fold reference':row.comparison==='REVIEW_DIFFERENCE'?'Difference needs review':row.comparison==='UNAVAILABLE'?'Forecast unavailable':'Overlapping bounds'}</small></th><td>${signed(row.estimateBB)}</td><td>${signed(row.meanBB)}</td><td>${signed(row.differenceBB)}</td></tr>`).join('')}</tbody></table></div>`:'';
  }
  function validationSource(batch){return `${batch.mode==='AUTOMATIC'?'Automatic frozen decision':'Manual frozen batch'} · build ${batch.buildFingerprint||'pending'}`;}
  function recentValidation(){
    const recent=validation.history||[];
    return recent.length?`<details class="sim-validation-recent"><summary>Recent frozen checks · ${recent.length}</summary>${recent.slice().reverse().map(batch=>`<details><summary>${esc(batch.mode==='AUTOMATIC'?'Automatic':'Manual')} · ${esc(batch.contexts[0]?.label||'Frozen decision')} · ${esc(batch.status.toLowerCase())}</summary><p class="sim-limits">${esc(validationSource(batch))}</p>${batch.reason?`<p class="sim-limits">${esc(batch.reason)}</p>`:''}${batch.contexts.map((item,index)=>`<p class="sim-context">${index+1}. ${esc(item.label)}</p>`).join('')}${validationTable(validationRows(batch))}</details>`).join('')}</details>`:'';
  }
  function batchPanel(){
    if(!validation)return '';
    const batch=validation.state,running=batch?.status==='RUNNING',idle=validationIdle(),scheduler=validation.diagnostics||{};
    const op=(name,label,disabled=false)=>`<button type="button" class="ghost-button" data-batch-op="${name}"${disabled?' disabled':''}>${label}</button>`;
    const rows=validationRows(batch),completed=batch?.contexts.filter(item=>item.result&&item.result.status!=='RUNNING').length||0;
    const currentBatch=batch?.contexts[batch.index]?.result,diagnostic=window.TheibsSimulationValidation.metrics(batch);
    const interval=value=>value?`${signed(value[0])} to ${signed(value[1])}`:'—';
    const currentCapture=session?.replayed?'Replay decisions are excluded.':heroTurn()?validation.hasDecision?.(session.multiway,chosenSize)?'Current Hero decision and selected sizing are captured for checking.':'Waiting to capture the current Hero decision and selected sizing.':'Checks describe frozen decisions; they do not recommend an action for the current hand.';
    return `<details class="sim-batches"><summary><span>EV validation</span><span class="sim-validation-status">${esc(validationStatus(batch,scheduler))}</span></summary>
      <label class="sim-auto-setting"><input id="sim-validation-auto" type="checkbox"${validation.automatic?' checked':''}${validation.supported?'':' disabled'}><span>Run automatically for fresh Hero decisions</span></label>
      <p class="sim-limits sim-validation-capture">${esc(currentCapture)}${scheduler.queued?` ${scheduler.queued} queued.`:''}</p>
      ${scheduler.dropped?`<p class="sim-limits">Queue capacity was reached; ${scheduler.dropped} frozen checks were dropped. Those checks are not included in the results.</p>`:''}
      <div class="sim-validation-controls">${running?op('PAUSE','Pause'):scheduler.manualPaused||batch&&['PAUSED','ERROR'].includes(batch.status)?op('RESUME','Resume',!idle):''}${batch?op('STOP','Stop',!running&&batch.status!=='PAUSED')+op('DOWNLOAD','Download checks'):''}</div>
      <p class="sim-limits">Up to 512 independent worlds and 30 seconds per frozen decision. Gameplay and normal EV take priority. Reference policy, not GTO.</p>
      <details class="sim-manual-batch"><summary>Manual batch</summary><div class="sim-batch-toolbar"><label>Decisions<select id="sim-batch-scope"${running?' disabled':''}><option value="CURRENT"${batchScope==='CURRENT'?' selected':''}>Current decision</option><option value="SAVED"${batchScope==='SAVED'?' selected':''}>Saved + current · up to 5</option></select></label><label>Worlds per decision<select id="sim-batch-worlds"${running?' disabled':''}>${[32,64,128,256,512].map(n=>`<option${batchWorlds===n?' selected':''}>${n}</option>`).join('')}</select></label>${op('START','Start batch',running||!idle||!validation.supported)}</div><p class="sim-limits">Check the current decision or up to five saved public decisions with these settings. Start batch replaces the latest check; download first to keep its results.</p></details>
      ${batch?`<div class="sim-batch-progress" role="status"><strong>${esc(batch.status.replaceAll('_',' '))}</strong><span>${completed}/${batch.contexts.length} decisions checked${currentBatch?` · ${currentBatch.count}/${batch.worlds} worlds`:''}</span>${batch.reason?`<span>${esc(batch.reason)}</span>`:''}</div>${batch.storageWarning?`<p class="sim-error">${esc(batch.storageWarning)}</p>`:''}
        ${batch.contexts.map((item,index)=>`<p class="sim-context">${index+1}. ${esc(item.label)}${item.result?` · ${item.result.count} worlds · effective ${money(item.result.summary?.effectiveSamples||0)} · ${money(item.result.computeMs)} ms compute · ${item.result.leaderChanges} checkpoint leader changes${item.result.status==='PARTIAL_BUDGET'?' · Partial budget':''}`:''}</p>`).join('')}${validationTable(rows)}
        <details class="sim-batch-bounds"><summary>Uncertainty, stability & method</summary><p>${esc(validationSource(batch))}</p><p>${scheduler.captured||0} automatically captured. Completed checks ${scheduler.completed||0} · partial ${scheduler.partial||0} · interrupted ${scheduler.errors||0} · dropped from queue ${scheduler.dropped||0}.</p>${diagnostic.comparedActions?`<p>Across ${diagnostic.comparedActions} non-fold action means: mean absolute difference ${money(diagnostic.meanAbsoluteDifferenceBB)} bb · RMSE ${money(diagnostic.rmseBB)} bb. Descriptive diagnostics, not a precision certificate.</p>`:''}
          <p>${diagnostic.cancelledSlices} in-flight slices cancelled; discarded work is excluded from completed-world compute time.</p><p>Difference = validation mean minus recomputed EV. The forecast reruns on the same frozen public decision, so it can differ from the estimate saved when you acted. Both are incremental from that captured decision; past contributions are not charged twice. No unavailable estimate is treated as zero. Each validation world evaluates every action with the same compatible cards.</p>
          <p>Validation uses a separate seed and exact Omaha showdown enumeration. Public-action likelihood weights match the fixed reference policy. Bounds describe numerical sampling uncertainty only. The forecast and validation each have 95% model-conditional bounds; their difference interval has at least 90% coverage per decision by the union bound. Overlap is inconclusive, not a pass.</p>
          ${batch.contexts.map((item,index)=>item.result?.summary?`<p>${index+1}. Frozen check leader: ${esc(item.result.summary.leader||'Unavailable')} · ${item.result.summary.leaderCertified?'Separated within the reference model':'INCONCLUSIVE'} · forecast ${money(item.result.predictionMs)} ms · ${item.result.prediction.samples} forecast worlds.</p>`:'').join('')}${rows.map(row=>`<p>${row.context} · ${esc(label(row))}: forecast bounds [${interval(row.predictionBoundsBB)}], validation bounds [${interval(row.boundsBB)}], difference bounds [${interval(row.differenceBoundsBB)}] bb.</p>`).join('')}
          <p>Uniform priors · zero rake · ${esc(batch.contexts.find(item=>item.result)?.result.model||'MULTIWAY_CONTEXT_POLICY_V2')}. Both runs share this response model, so agreement does not establish human-opponent accuracy or equilibrium. Checks retain their captured public information. No solver strategy, player statistics, hand history or bankroll is updated. This account retains up to five recent checks and five queued decisions on this device. Download before replacing manual results.</p>
        </details>`:'<p class="sim-limits">Automatic checks run when foreground EV and gameplay are idle. Hidden cards, future runouts and replay decisions are excluded. The latest results stay here between hands.</p>'}${recentValidation()}
      </details>`;
  }
  function downloadBatch(){
    const value=validation?.export();if(!value)return;
    const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='theibs-validation-batch.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function render(){
    if(!host)return;
    validation?.setAvailable(validationIdle());
    const sameHand=layoutHand===session?.id;
    const compactDesktop=typeof window.matchMedia==='function'&&window.matchMedia('(min-width: 900px)').matches;
    const before=host.querySelector('.sim-evaluation');
    const footprint=node=>node.getBoundingClientRect().height-[...node.querySelectorAll('details[open]')].reduce((sum,details)=>sum+details.getBoundingClientRect().height-details.querySelector('summary').getBoundingClientRect().height,0);
    if(!compactDesktop&&sameHand&&before)evaluationFootprint=Math.max(evaluationFootprint,footprint(before));
    else {evaluationFootprint=0;layoutHand=session?.id;}
    const scroll={x:window.scrollX,y:window.scrollY};
    const focused=document.activeElement;
    if(focused&&host.contains?.(focused))retainedFocus=focused;
    else if(focused&&focused!==document.body&&focused!==document.documentElement)retainedFocus=null;
    const markup=`<div class="sim-heading" data-sim-key="heading"><div><h1 id="simulation-title">Simulation</h1><span class="sim-mode">${session?.replayed?'Replay · previously revealed deal':session?'Random Multiway · isolated practice':'Multiway practice with a fair, hidden deal'}</span></div>${button(session?'Table setup':'Set up table','CONFIG')}</div>${bankroll()}${session?`<div class="sim-layout" data-sim-key="layout"><div class="sim-game">${table()}${controls()}</div><aside class="sim-evaluation">${decisionPanel()}</aside></div>`:'<div class="sim-empty"><p>Play a complete hand against simulated opponents. Deal each street when ready and see equity and modeled action EV on your turn.</p>'+button('Start simulation','CONFIG',true)+'</div>'}<div class="sim-recovery" data-sim-key="recovery">${connection==='RECONNECTING'?'<p class="sim-connection" role="status">Reconnecting to the server… Your hand is retained.</p>':''}<p class="sim-error" role="alert"${error?'':' hidden'}>${esc(error)}</p>${!busy&&pendingIntent?button('Retry last request','RETRY',true):!busy&&connection==='OFFLINE'?button('Reconnect','REFRESH',true):''}</div>${session?audit():''}${batchPanel()}${history()}`;
    if(host.childNodes?.length){
      const next=document.createElement('div');next.innerHTML=markup;T.patchDOM(host,next);
    }else host.innerHTML=markup;
    const autoSetting=host.querySelector('#sim-validation-auto');if(autoSetting)autoSetting.checked=!!validation.automatic;
    const evaluation=host.querySelector('.sim-evaluation');
    if(evaluation&&!compactDesktop){
      evaluationFootprint=Math.max(evaluationFootprint,footprint(evaluation));
      // Hold the measured footprint through transient states of the same hand.
      // Content remains unconstrained: errors and expanded details are not clipped.
      evaluation.style.minHeight=`${evaluationFootprint}px`;
    }
    else if(evaluation) evaluation.style.removeProperty('min-height');
    if(retainedFocus?.isConnected&&!retainedFocus.disabled&&document.activeElement===document.body)retainedFocus.focus({preventScroll:true});
    if(window.theibsKeyboard)document.dispatchEvent(new CustomEvent('theibs:simulation-render'));
    if(sameHand&&Number.isFinite(scroll.y)&&window.scrollTo)window.scrollTo({left:scroll.x,top:scroll.y,behavior:'instant'});
  }
  async function evaluate(size=chosenSize){
    chosenSize=size;
    cancel();analysis=null;timing=null;
    if(!active||!heroTurn()){render();return;}
    const stamp=snapshot(),abort=new AbortController();controller=abort;startedAt=performance.now();render();
    captureValidation(size);
    try{
      const browser=client?.supported;
      const input=T.evaluationInput(session,size);
      for(const phase of ['PREVIEW','FINAL']){
        let result;
        try{
          result=browser?await client.analyze(input,{phase,signal:abort.signal,owner}):await request('/api/simulation/analyze',{method:'POST',body:JSON.stringify({id:stamp.id,revision:stamp.revision,analysisPhase:phase,chosenSize:size}),signal:abort.signal});
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
        render();updateSizing();
      }
    }catch(failure){if(current(stamp)&&!abort.signal.aborted){analysis={status:'UNAVAILABLE',reason:failure.message};}}
    finally{if(current(stamp)){controller=null;render();updateSizing();save();}}
  }
  async function perform(operation,extra={},retry=null){
    if(busy||!session||restoringSession&&!retry||(pendingIntent&&!retry)||(connection==='OFFLINE'&&!retry))return;
    busy=true;validation?.setAvailable(false,'Paused for foreground gameplay.');
    if(operation==='ACT'&&heroTurn()&&!retry)captureValidation(extra.to??chosenSize);
    shortcutMessage='';
    const previous=session,own=owner,stamp=snapshot();
    const pending=retry?.decision??(operation==='ACT'&&heroTurn()?{street:previous.state.street,chosen:{action:extra.action,size:extra.to??null},recordedAt:new Date().toISOString(),publicInput:structuredClone(previous.multiway),
      heroId:previous.state.heroId,heroStack:previous.state.players[previous.state.heroId].stack,bigBlind:previous.state.bigBlind,
      revisionKey:previous.state.revisionKey,evaluation:T.compactEvaluation(analysis),timing:timing?{...timing}:null,
      presentation:window.theibsMultiwayUI.describeDecisionEV(previous.state,analysis,{analysisBusy:!!controller,heroDraftReady:true})}:null);
    const route=operation==='NEXT'?'next':operation==='REPLAY'?'replay':operation==='RESTART'?'restart':'step';
    const intent=retry||{operation,body:{id:previous.id,revision:previous.revision,requestId:crypto.randomUUID(),operation,...extra},decision:pending};
    pendingIntent=intent;save();
    error='';cancel();render();
    try{
      const result=await request('/api/simulation/'+route,{method:'POST',body:JSON.stringify(intent.body)});
      if(owner!==own || session?.id!==previous.id)return;
      if(pending)decisions.push(pending);
      pendingIntent=null;connection='CONNECTED';
      if(result.previous){archive(result.previous);decisions=[];}
      session=result.session;recoveryId=null;analysis=null;chosenSize=null;if(session.finished)archive();save();
    }catch(failure){if(owner===own&&session?.id===previous.id){error=failure.message;
      if(failure.retryable){connection='OFFLINE';}
      else {pendingIntent=null;
        if(failure.status===404){archive({...previous,finished:true,abandoned:true});session=null;recoveryId=null;decisions=[];connection='CONNECTED';}
        if(failure.status===409){connection='OFFLINE';}
      }save();
    }}finally{busy=false;if(owner===stamp.owner){if(active&&!restoringSession&&!pendingIntent&&connection==='CONNECTED')evaluate();else render();}}
  }
  const setup=document.createElement('dialog');setup.className='sim-dialog';setup.setAttribute('aria-labelledby','sim-setup-title');
  const confirmation=document.createElement('dialog');confirmation.className='sim-dialog';confirmation.setAttribute('aria-labelledby','sim-confirm-title');
  const funds=document.createElement('dialog');funds.className='sim-dialog';funds.setAttribute('aria-labelledby','sim-funds-title');
  function confirmAction(message){
    if(confirmation.open)return Promise.resolve(false);
    validation?.setAvailable(false,'Paused while confirmation is open.');
    confirmation.innerHTML=`<form method="dialog"><h2 id="sim-confirm-title">Confirm simulation change</h2><p>${esc(message)}</p><div class="sim-action-buttons"><button class="ghost-button" value="cancel">Cancel</button><button class="primary-button" value="confirm">Confirm</button></div></form>`;
    confirmation.returnValue='';confirmation.showModal();
    return new Promise(resolve=>confirmation.addEventListener('close',()=>resolve(confirmation.returnValue==='confirm'),{once:true}));
  }
  async function startTable(config,retry=null){
    if(busy)return;
    const own=owner,previous=session,fromSetup=setup.open;
    const intent=retry||{operation:'START',body:{config,requestId:crypto.randomUUID(),...(previous?{id:previous.id,revision:previous.revision}:{})}};
    pendingIntent=intent;busy=true;cancel();save();
    const submit=setup.querySelector('[type=submit]');if(submit)submit.disabled=true;
    try{
      const result=await request('/api/simulation/'+(intent.body.id?'restart':'start'),{method:'POST',body:JSON.stringify(intent.body)});
      if(owner!==own)return;
      pendingIntent=null;connection='CONNECTED';if(result.previous)archive(result.previous);
      session=result.session;recoveryId=null;analysis=null;chosenSize=null;decisions=[];error='';save();if(setup.open)setup.close();
    }catch(failure){if(owner===own){error=failure.message;if(!failure.retryable)pendingIntent=null;else connection='OFFLINE';
      const message=setup.querySelector('#sim-setup-error');if(message)message.textContent=error;save();}}
    finally{if(owner===own){busy=false;if(submit)submit.disabled=false;if(active&&!restoringSession&&!pendingIntent)evaluate();else render();if(fromSetup&&!setup.open&&active&&session)focusPlayArea();}}
  }
  function configure(){
    if(busy)return;
    validation?.setAvailable(false,'Paused while table setup is open.');
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
      const options=Object.fromEntries(new FormData(form));for(const name of ['playerCount','startingStack','smallBlind','bigBlind'])options[name]=Number(options[name]);
      startTable(options,pendingIntent?.operation==='START'?pendingIntent:null);
    };
    setup.showModal();
  }
  function configureBankroll(){
    validation?.setAvailable(false,'Paused while bankroll settings are open.');
    const settings=progress.settings;
    funds.innerHTML=`<form><div class="sim-dialog-heading"><h2 id="sim-funds-title">Practice bankroll</h2><button type="button" class="ghost-button" data-sim-close aria-label="Close bankroll settings">×</button></div><div class="sim-setup-grid"><label>Starting funds · chips<input name="initialChips" type="number" min="0" max="1000000000" step="0.01" value="${settings.initialChips}" required></label><label>Money per chip<input name="chipValue" type="number" min="0.000001" max="1000000" step="any" value="${settings.chipValue}" required></label><label>Display currency<select name="currency">${['BRL','USD','EUR','GBP'].map(value=>`<option${value===settings.currency?' selected':''}>${value}</option>`).join('')}</select></label></div><p>Fictitious funds for tracking settled results, not table stakes. Changing these display settings preserves your hand, chips and recorded profit. Results persist on this device, separately for each account.</p><div class="sim-action-buttons"><button type="submit" class="primary-button">Save settings</button><button type="button" class="ghost-button" data-reset-progress>Reset progress</button></div></form>`;
    funds.querySelector('[data-sim-close]').onclick=()=>funds.close();
    funds.querySelector('form').onsubmit=event=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.target));progress.settings=T.practiceProgress({settings:{initialChips:Number(values.initialChips),chipValue:Number(values.chipValue),currency:values.currency}}).settings;save();funds.close();render();};
    funds.querySelector('[data-reset-progress]').onclick=async()=>{
      if(!await confirmAction('Reset the local bankroll progress to its starting funds? Download your report first to keep this tracking period. Your current hand and detailed history stay intact.'))return;
      progress=T.practiceProgress({settings:progress.settings});
      // A finished hand on screen belongs to the old period, even if revealed
      // or archived again. An active hand will count when it settles.
      if(session?.finished)progress.entries.push({id:session.id,kind:'BASELINE',netCents:null});
      save();funds.close();render();
    };
    funds.showModal();
  }
  const editor=document.createElement('dialog');editor.className='sim-dialog';editor.setAttribute('aria-labelledby','sim-editor-title');
  function updateSizing(){
    const text=editor.querySelector('#sim-size-result'),input=editor.querySelector('input[name=to]');if(!text||!input)return;
    const row=analysis?.ev?.candidates?.find(item=>['BET','RAISE'].includes(item.action)&&Math.abs(item.size-Number(input.value))<1e-8);
    text.textContent=row?.status==='MODELED'?`This sizing: ${signed(row.ev/session.state.bigBlind)} bb · ${analysis.analysisStage||'available estimate'} · ${row.method}.`:controller?'Evaluating sizing… You may apply the action without waiting.':'This sizing has no available estimate. You may still apply the legal action.';
  }
  function sizing(action,preferredSize=null){
    if(!userTurn()||busy||pendingIntent)return;
    validation?.setAvailable(false,'Paused while you choose an action.');
    const stamp=snapshot(),actor=session.state.actor;
    const legal=session.state.legal;
    const initial=Number.isFinite(preferredSize)&&preferredSize>=legal.minTo&&preferredSize<=legal.maxTo?preferredSize:legal.minTo;
    editor.innerHTML=`<form><div class="sim-dialog-heading"><h2 id="sim-editor-title">${action==='BET'?'Bet':'Raise'} to</h2><button type="button" class="ghost-button" data-sim-close aria-label="Close sizing">×</button></div><label>Total committed this street<input name="to" type="number" min="${legal.minTo}" max="${legal.maxTo}" step="0.01" value="${legal.minTo}" required autofocus></label><p>Legal total ${money(legal.minTo)}–${money(legal.maxTo)} chips. Any legal total is accepted, including an all-in below the usual minimum when allowed.</p><p id="sim-size-result" role="status"></p><div class="sim-action-buttons"><button type="button" class="ghost-button" data-max>Maximum ${money(legal.maxTo)}</button>${heroTurn()?'<button type="button" class="ghost-button" data-evaluate>Evaluate sizing</button>':''}<button type="submit" class="primary-button">Apply ${action.toLowerCase()}</button></div></form>`;
    editor.querySelector('input[name=to]').value=initial;
    editor.querySelector('[data-sim-close]').onclick=()=>editor.close();editor.querySelector('[data-max]').onclick=()=>{editor.querySelector('input').value=legal.maxTo;updateSizing();};
    const sizingInput=editor.querySelector('input');sizingInput.oninput=updateSizing;
    const preview=editor.querySelector('[data-evaluate]');if(preview)preview.onclick=()=>{if(editor.querySelector('form').reportValidity()&&session?.id===stamp.id&&session?.revision===stamp.revision&&session.state.actor===actor)evaluate(Number(sizingInput.value));};
    editor.querySelector('form').onsubmit=event=>{event.preventDefault();const to=Number(sizingInput.value);if(session?.id!==stamp.id||session?.revision!==stamp.revision||session.state.actor!==actor)return;editor.close();perform('ACT',{action,to,actor});};editor.showModal();updateSizing();
  }
  function inspect(id){
    validation?.setAvailable(false,'Paused while seat details are open.');
    const player=session?.state.players.find(item=>item.id===id);if(!player)return;
    editor.innerHTML=`<div class="sim-dialog-heading"><h2 id="sim-editor-title">${esc(player.name)} · ${esc(player.position)}</h2><button type="button" class="ghost-button" data-sim-close aria-label="Close seat details">×</button></div><p>Stack ${money(player.stack)} · committed this street ${money(player.streetPaid)}</p><p>${player.folded?'Folded':player.allIn?'All-in':'Active'}${player.lastAction?' · '+esc(player.lastAction.toLowerCase()):''}</p><div class="sim-reveals">${(session.audit?.hands?.[id] || session.shownHands?.[id] || (player.hero?session.multiway.config.heroCards:[])).map(card=>E.canonicalCard(card,{small:true})).join('')}</div>`;
    editor.querySelector('[data-sim-close]').onclick=()=>editor.close();editor.showModal();
  }
  function download(){archive();const blob=new Blob([JSON.stringify({schema:'THEIBS_SIMULATION_REPORT_V2',source:'SIMULATION_ONLY',exportedAt:new Date().toISOString(),progress:{...progress,summary:T.progressSummary(progress)},validation:T.summary(reports),reports,active:session?{public:session,decisions}:null},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='theibs-simulation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function reconnect(){
    const id=session?.id||recoveryId;if(busy||!id)return;busy=true;const own=owner;
    try{const result=await request('/api/simulation/state',{method:'POST',body:JSON.stringify({id})});if(owner===own&&(session?.id||recoveryId)===id){session=result.session;recoveryId=null;connection='CONNECTED';error='';if(session.finished)archive();save();}}
    catch(failure){if(owner===own){error=failure.message;connection='OFFLINE';if(failure.status===404){if(session)archive({...session,finished:true,abandoned:true});session=null;recoveryId=null;decisions=[];pendingIntent=null;connection='CONNECTED';save();}}}
    finally{if(owner===own){busy=false;if(active&&connection==='CONNECTED')evaluate();else render();}}
  }
  async function enter(){
    active=true;restoringSession=true;const selected=getOwner();if(!selected){restoringSession=false;error='Account verification is required to start a simulation.';render();return;}
    if(owner!==selected){clearOwner();active=true;restoringSession=true;owner=selected;restored=false;validation?.load(owner);}
    if(!client)client=window.TheibsBrowserMultiwayClient?.create();
    if(!restored){restored=true;const restoring=generation,own=owner;try{const saved=JSON.parse(localStorage.getItem(key())||'null');reports=Array.isArray(saved?.reports)?T.boundedHistory(saved.reports.filter(item=>item?.publicRecord?.config?.variant&&Array.isArray(item.decisions))):[];decisions=Array.isArray(saved?.decisions)?saved.decisions:[];
      progress=T.practiceProgress(saved?.progress);if(saved?.progress?.schema!=='SIMULATION_PROGRESS_V1')for(const report of reports)T.recordProgress(progress,report);
      recoveryId=saved?.sessionId||null;if(saved?.session?.id===saved?.sessionId)session=saved.session;
      keyboardObservations=Array.isArray(saved?.keyboardObservations)?saved.keyboardObservations.filter(item=>item.id===saved.sessionId&&Number.isInteger(item.actor)&&['FOLD','MATCH','AGGRESSIVE'].includes(item.kind)&&['PREFLOP','FLOP','TURN','RIVER'].includes(item.street)).map(item=>({...item,error:'Older entry retained for review. Use F / G / H on the current turn.'})):[];
      pendingIntent=saved?.pendingIntent||null;
      if(pendingIntent){if(pendingIntent.operation==='START')await startTable(pendingIntent.body.config,pendingIntent);else if(session)await perform(pendingIntent.operation,{},pendingIntent);}
      else if(saved?.sessionId){const data=await request('/api/simulation/state',{method:'POST',body:JSON.stringify({id:saved.sessionId})});if(own===owner&&generation===restoring){session=data.session;recoveryId=null;if(session.finished)archive();}}
    }catch(failure){if(own===owner&&generation===restoring){
      if(failure.status===404){if(session)archive({...session,finished:true,abandoned:true});session=null;recoveryId=null;decisions=[];error='The server session expired. Your saved decisions remain in Simulation history; start a new deal.';save();}
      else {error=failure.message;connection='OFFLINE';}
    }}}
    save();restoringSession=false;if(active&&!pendingIntent&&connection==='CONNECTED')evaluate();else render();
  }
  function leave(){active=false;cancel();if(setup.open)setup.close();if(editor.open)editor.close();if(funds.open)funds.close();if(confirmation.open)confirmation.close('cancel');save();}
  function clearOwner(){keyboardObservations=[];leave();validation?.clearOwner();client?.close();client=null;owner=null;session=null;analysis=null;reports=[];decisions=[];progress=T.practiceProgress();error='';restored=false;restoringSession=false;shortcutMessage='';busy=false;connection='CONNECTED';pendingIntent=null;chosenSize=null;recoveryId=null;render();}
  function init(options){request=(url,settings={})=>{const own=owner;return T.createTransport((endpoint,settings)=>options.request(endpoint,{...settings,headers:{'Content-Type':'application/json',...settings.headers}}),{onState:state=>{if(owner===own&&(state!=='CONNECTED'||connection==='RECONNECTING')){connection=state;if(active)render();}}})(url,settings);};getOwner=options.getOwner;host=document.getElementById('simulation-workspace');document.body.append(setup,editor,confirmation,funds);
    validation=window.TheibsSimulationValidation?.create({onChange:()=>renderValidation()});
    for(const dialog of [setup,editor,confirmation,funds])dialog.addEventListener('close',()=>{if(active)render();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)validation?.setAvailable(false,'Paused while this page is hidden.');else render();});
    host.addEventListener('click',async event=>{
      const batchButton=event.target.closest('[data-batch-op]');if(batchButton){if(batchButton.disabled)return;const op=batchButton.dataset.batchOp;
        try{if(op==='START'){if(validation?.state&&!await confirmAction('Replace the latest local validation batch? Download it first to retain its results.'))return;validation.start(validationContexts(),{worlds:batchWorlds});}
          else if(op==='PAUSE')validation.pause();else if(op==='RESUME')validation.resume();else if(op==='STOP')validation.stop();else if(op==='DOWNLOAD')downloadBatch();
        }catch(failure){error=failure.message;render();}return;
      }
      const seat=event.target.closest('[data-sim-seat]');if(seat){inspect(Number(seat.dataset.simSeat));return;}
      const target=event.target.closest('[data-sim-op]');if(!target)return;const op=target.dataset.simOp;
      if(op==='CONFIG')configure();else if(op==='BANKROLL')configureBankroll();else if(op==='SIZE')sizing(target.dataset.action,target.dataset.to==null?null:Number(target.dataset.to));else if(op==='EXPORT')download();
      else if(op==='RETRY'){if(pendingIntent?.operation==='START')return startTable(pendingIntent.body.config,pendingIntent);else if(pendingIntent)return perform(pendingIntent.operation,{},pendingIntent);}
      else if(op==='REFRESH')return reconnect();
      else if(op==='EVALUATE')return evaluate();
      else if(op==='RESTART'){if(session?.finished||await confirmAction('Archive this hand without a payout and deal fresh cards with reset stacks?'))perform(op);}
      else if(op==='FINISH'){if(await confirmAction('Play all remaining actions and streets with the reference policy, including your future actions? The completed outcome is for model checks, not a guarantee about EV.'))perform(op);}
      else if(op==='CLEAR'){if(await confirmAction('Clear completed simulation history on this device?')){reports=[];save();render();}}
      else if(op==='END'){if(await confirmAction('End this hand without recording a payout?'))perform(op);}
      else return perform(op,op==='ACT'?{action:target.dataset.action}:{});
    });
    host.addEventListener('change',event=>{if(event.target.id==='sim-control')perform('PACE',{paused:event.target.value==='STEP',manualOpponents:event.target.value==='MANUAL'});else if(event.target.id==='sim-validation-auto')validation?.setAutomatic(event.target.checked);else if(event.target.id==='sim-batch-scope')batchScope=event.target.value;else if(event.target.id==='sim-batch-worlds')batchWorlds=Number(event.target.value);});
    render();
  }
  window.TheibsSimulationUI={init,enter,leave,clearOwner,configure,keyboardCommand,keyboardAction,keyboardCapture,keyboardFlush,getKeyboardState:()=>({session,active,busy,restoringSession,pendingIntent,connection,observations:keyboardObservations.map(item=>({...item}))})};
})();
