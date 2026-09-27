(function () {
  'use strict';
  const $=s=>document.querySelector(s), cards=window.theibsCardKeyboard, esc=window.EssenceUI.esc;
  const positions={2:['SB','BB'],3:['SB','BB','BTN'],4:['SB','BB','CO','BTN'],5:['SB','BB','HJ','CO','BTN'],6:['SB','BB','UTG','HJ','CO','BTN'],7:['SB','BB','UTG','LJ','HJ','CO','BTN'],8:['SB','BB','UTG','UTG1','LJ','HJ','CO','BTN'],9:['SB','BB','UTG','UTG1','UTG2','LJ','HJ','CO','BTN'],10:['SB','BB','UTG','UTG1','UTG2','UTG3','LJ','HJ','CO','BTN']};
  const names={FOLD:'folded',CHECK:'check',CALL:'called',BET:'bet',RAISE:'raised',SB:'small blind',BB:'big blind',RETURN:'was refunded',BOARD:'board',SHOWDOWN:'showdown'};
  const money=n=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:2});
  let descriptor=null,state=null,busy=false,syncing=false;
  async function request(path,body) {
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw Error(data.reason||'Could not record the action.');return data;
  }
  const signal=()=>document.dispatchEvent(new CustomEvent('theibs:flow-changed'));
  function note(text,error=false) {$('#flow-note').textContent=text;$('#flow-note').classList.toggle('error-message',error);}
  function render() {
    document.body.dataset.flow=state?'active':'free';
    $('#opponent-seat-label').classList.toggle('hidden',!state);
    for(const id of ['position','players','potBeforeAction','amountToCall','effectiveStack','variant-select'])$('#'+id).disabled=Boolean(state);
    $('#flow-undo').disabled=busy||!descriptor?.events.length||Boolean(descriptor?.archived);
    $('#flow-start').disabled=busy;$('#flow-start').textContent=state?'New hand':'Start hand';
    if(!state) {
      $('#flow-turn').textContent='Follow the hand action by action';
      $('#flow-actions').innerHTML='<button id="flow-start-inline" type="button" class="primary-button">Start tracking</button>';
      $('#flow-start-inline').onclick=openSetup;
      $('#flow-player-list').innerHTML='<p class="micro">Start tracking to record each player turn, stacks and folds.</p>';
      $('#flow-log').innerHTML='<p class="micro">No actions recorded.</p>';note('Blinds, calls, checks and bets update the pot automatically.');return;
    }
    const hero=state.players[state.heroId];
    const selectedOpponent=$('#opponentSeat').value;
    $('#opponentSeat').innerHTML=state.players.filter(p=>!p.hero).map(p=>`<option value="${p.id}">${esc(p.name)} · ${p.position}${p.folded?' · folded':''}</option>`).join('');
    if(selectedOpponent!==''&&state.players.some(p=>!p.hero&&String(p.id)===selectedOpponent))$('#opponentSeat').value=selectedOpponent;
    $('#position').value=hero.position;$('#players').value=Math.max(2,state.activePlayers);
    $('#potBeforeAction').value=state.pot;$('#amountToCall').value=state.heroToCall;$('#effectiveStack').value=hero.stack;
    $('#flow-player-list').innerHTML=state.players.map(p=>`<div class="flow-player ${p.id===state.actor?'is-acting':''} ${p.folded?'is-folded':''}"><span><b>${esc(p.name)}</b><small>${esc(p.position)} · ${p.folded?'Fold':p.stack===0?'All-in':p.id===state.actor?'To act':names[p.lastAction]||'In hand'}</small></span><strong>${money(p.stack)}</strong></div>`).join('');
    $('#flow-log').innerHTML=state.log.slice(-4).map(item=>`<div class="flow-event"><span>${esc(item.street)}</span><b>${esc(eventText(item))}</b></div>`).join('');
    if(state.phase==='BETTING') {
      const actor=state.players[state.actor];$('#flow-turn').textContent=actor.hero?'Your turn':`Record action: ${actor.name} · ${actor.position}`;
      $('#flow-actions').innerHTML=state.legal.actions.map(action=>`<button type="button" data-flow-action="${action}" class="flow-action action-${action.toLowerCase()}" ${busy?'disabled':''}>${({FOLD:'Fold / folded',CHECK:'Check',CALL:`Call ${money(state.legal.toCall)}`,BET:'Bet',RAISE:'Raise'})[action]}${action==='FOLD'&&actor.hero?'<kbd>F</kbd>':''}</button>`).join('');
      note(actor.hero?'F = your Fold. Record other actions using the buttons.':'Enter only the action this opponent took.');
    } else if(state.phase==='WAIT_BOARD') {
      $('#flow-turn').textContent=`Street complete · enter the ${state.nextStreet.toLowerCase()}`;
      $('#flow-actions').innerHTML='<button id="flow-select-board" type="button" class="primary-button">Select the next board card</button>';
      $('#flow-select-board').onclick=()=>{cards.select(cards.state.count+state.board.length);document.querySelector(`[data-slot="${cards.state.selected}"]`).focus();};
      note('Enter cards using rank + suit or the deck below.');
    } else if(state.phase==='SHOWDOWN') {
      $('#flow-turn').textContent='Showdown · enter the winner';$('#flow-actions').innerHTML='<button id="flow-settle" type="button" class="primary-button">Record result</button>';
      $('#flow-settle').onclick=openResult;note(state.pots.length>1?'Side pots have their own eligibility.':'Select more than one winner for to tie.');
    } else {
      $('#flow-turn').textContent='Hand complete';$('#flow-actions').innerHTML=`<button id="flow-save" type="button" class="primary-button" ${descriptor.archived?'disabled':''}>${descriptor.archived?'Hand saved':'Save hand to history'}</button>`;
      $('#flow-save').onclick=()=>archive().catch(error=>note(error.message,true));
      const net=hero.stack-Number(descriptor.config.stacks?.[hero.id]??descriptor.config.startingStack);
      note(`Your result this hand: ${net>0?'+':''}${money(net)} chips. ${state.result.reason==='ALL_FOLDED'?'The other players folded.':'Result entered at showdown.'}`);
    }
  }
  function eventText(item) {
    if(item.action==='BOARD')return item.cards.map(window.TheibsCards.fromCanonical).join(' ');
    if(item.action==='SHOWDOWN')return 'Result recorded';
    const p=state.players[item.actor];return `${p.name} · ${names[item.action]||item.action}${item.amount?' '+money(item.amount):''}${item.allIn?' · all-in':''}`;
  }
  function syncBoard() {
    const hero=cards.state.slots.slice(0,cards.state.count);
    const emptyHero=hero.indexOf(null);
    syncing=true;
    cards.restore({count:cards.state.count,slots:[...hero,...state.board.map(window.TheibsCards.fromCanonical),...Array(5-state.board.length).fill(null)],selected:emptyHero>=0?emptyHero:Math.min(cards.state.count+state.board.length,cards.state.count+4)});
    syncing=false;
  }
  async function change(next,replaceBoard=false) {
    if(busy)return;busy=true;render();
    try {
      const result=await request('/api/hand-flow',next);descriptor=next;state=result.state;
      if(replaceBoard)syncBoard();
      render();signal();
    } finally {busy=false;render();}
  }
  async function record(event) {
    if(!descriptor||busy)return;
    await change({...descriptor,events:[...descriptor.events,event]});
    if(state.phase==='WAIT_BOARD')cards.select(cards.state.count+state.board.length);
  }
  async function archive() {
    if(!descriptor||descriptor.archived||busy)return;
    await request('/api/hand-flow/save',descriptor);descriptor.archived=true;render();signal();
  }
  function updateSetup() {
    const n=Number($('#flow-count').value),old=$('#flow-position').value||$('#position').value;
    $('#flow-position').innerHTML=positions[n].map(pos=>`<option>${pos}</option>`).join('');
    $('#flow-position').value=positions[n].includes(old)?old:positions[n].at(-1);
    $('#flow-stacks').innerHTML=positions[n].map((pos,i)=>`<label>${pos}<input data-flow-stack="${i}" type="number" min="0.01" step="0.01" placeholder="${esc($('#flow-stack').value)}"></label>`).join('');
  }
  function openSetup() {
    $('#flow-count').value=String(descriptor?.config.playerCount||$('#players').value||6);
    $('#flow-stack').value=String(descriptor?.config.startingStack||$('#effectiveStack').value||100);
    updateSetup();$('#flow-setup-error').textContent='';$('#flow-setup-dialog').showModal();
  }
  $('#flow-count').onchange=updateSetup;$('#flow-start').onclick=openSetup;
  $('#flow-confirm-start').onclick=async()=>{
    try {
      if(busy)return;
      if(descriptor&&state.phase!=='FINISHED'&&!window.confirm('Start another hand and discard current tracking?'))return;
      if(descriptor&&state.phase==='FINISHED')await archive();
      if(cards.state.cards().board.length&&!window.confirm('The new hand will keep your hole cards and clear the board. Continue?'))return;
      const hero=cards.state.cards().hero;
      if(hero.length&&hero.length!==cards.state.count)throw Error('Complete or clear the hole cards before starting.');
      const config={id:crypto.randomUUID(),variant:`PLO${cards.state.count}_HIGH`,playerCount:Number($('#flow-count').value),heroPosition:$('#flow-position').value,startingStack:Number($('#flow-stack').value),smallBlind:Number($('#flow-sb').value),bigBlind:Number($('#flow-bb').value),heroCards:hero.map(window.TheibsCards.toCanonical)};
      config.stacks=[...document.querySelectorAll('[data-flow-stack]')].map(input=>input.value===''?config.startingStack:Number(input.value));
      await change({config,events:[]},true);$('#flow-setup-dialog').close();
    } catch(error){$('#flow-setup-error').textContent=error.message;}
  };
  $('#flow-undo').onclick=async()=>{
    if(!descriptor||busy||descriptor.archived)return;
    try{await change({...descriptor,events:descriptor.events.slice(0,-1)},true);}catch(error){note(error.message,true);}
  };
  $('#flow-actions').onclick=async event=>{
    const button=event.target.closest('[data-flow-action]');if(!button||busy)return;
    const action=button.dataset.flowAction;
    if(['BET','RAISE'].includes(action)) {
      $('#flow-size').value=state.legal.minTo;$('#flow-size').min=state.legal.minTo;$('#flow-size').max=state.legal.maxTo;
      $('#flow-size-help').textContent=`Already committed ${money(state.legal.totalThisStreet)}. Allowed total: ${money(state.legal.minTo)} to ${money(state.legal.maxTo)} chips.`;
      $('#flow-size-dialog').dataset.action=action;$('#flow-size-error').textContent='';$('#flow-size-dialog').showModal();return;
    }
    try{await record({type:'ACT',actor:state.actor,action});}catch(error){note(error.message,true);}
  };
  $('#flow-size-min').onclick=()=>$('#flow-size').value=state.legal.minTo;
  $('#flow-size-pot').onclick=()=>$('#flow-size').value=state.legal.maxTo;
  $('#flow-confirm-size').onclick=async()=>{
    try{await record({type:'ACT',actor:state.actor,action:$('#flow-size-dialog').dataset.action,to:Number($('#flow-size').value)});$('#flow-size-dialog').close();}
    catch(error){$('#flow-size-error').textContent=error.message;}
  };
  $('#flow-show-log').onclick=()=>{
    $('#flow-log-dialog .dialog-content').innerHTML=state?state.log.map(item=>`<div class="flow-event"><span>${esc(item.street)}</span><b>${esc(eventText(item))}</b></div>`).join(''):'No actions recorded.';
    $('#flow-log-dialog').showModal();
  };
  function openResult() {
    $('#flow-result-dialog .dialog-content').innerHTML=state.pots.map((pot,i)=>`<fieldset><legend>${i?'Side pot '+i:'Main pot'} · ${money(pot.amount)} chips</legend>${pot.eligible.map(id=>`<label class="checkbox-label"><input type="checkbox" data-pot="${i}" value="${id}">${esc(state.players[id].name)} · ${state.players[id].position}</label>`).join('')}</fieldset>`).join('')+'<label>Rake actually removed from the pot<input id="flow-result-rake" type="number" min="0" step="0.01" value="0"></label><button id="flow-confirm-result" type="button" class="primary-button">Confirm result</button><p id="flow-result-error" class="error-message"></p>';
    $('#flow-confirm-result').onclick=async()=>{
      try{const winners=state.pots.map((_,i)=>[...document.querySelectorAll(`[data-pot="${i}"]:checked`)].map(el=>Number(el.value)));
        await record({type:'SETTLE',winners,rake:Number($('#flow-result-rake').value)});$('#flow-result-dialog').close();}
      catch(error){$('#flow-result-error').textContent=error.message;}
    };$('#flow-result-dialog').showModal();
  }
  document.addEventListener('keydown',event=>{
    if(event.key.toLowerCase()!=='f'||event.repeat||event.ctrlKey||event.altKey||event.metaKey||event.isComposing)return;
    if(!state||busy||state.actor!==state.heroId||state.phase!=='BETTING'||document.body.dataset.view!=='analyze'||document.querySelector('dialog[open]'))return;
    if(event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
    event.preventDefault();cards.cancelPending();record({type:'ACT',actor:state.heroId,action:'FOLD'}).catch(error=>note(error.message,true));
  });
  document.addEventListener('theibs:cards-changed',async()=>{
    if(!descriptor||busy||syncing||descriptor.archived)return;
    try {
      const canonical=cards.canonicalForSubmit(),next={...descriptor,config:{...descriptor.config,heroCards:canonical.heroCards}};
      if(state.phase==='WAIT_BOARD'&&canonical.board.length==={FLOP:3,TURN:4,RIVER:5}[state.nextStreet]) {
        await change({...next,events:[...next.events,{type:'BOARD',cards:canonical.board}]});
      } else if(JSON.stringify(canonical.heroCards)!==JSON.stringify(descriptor.config.heroCards))await change(next);
    } catch(error) { if(cards.state.cards().hero.length===cards.state.count)note(error.message,true); }
  });
  window.TheibsFlow={
    archive,
    getState:()=>state, isBusy:()=>busy, serialize:()=>descriptor,
    async restore(saved){if(!saved)return;const data=await request('/api/hand-flow',saved);descriptor=saved;state=data.state;render();},
    clear(){descriptor=null;state=null;render();signal();},
    analysisContext(payload){
      if(!state)return payload;
      if(busy)throw Error('Recording action.');
      if(state.heroFolded)throw Error('You folded this hand. Continue recording opponents or start another hand.');
      if(state.phase==='FINISHED')throw Error('Hand complete. Start another hand to calculate.');
      if(state.phase!=='BETTING')throw Error(state.phase==='WAIT_BOARD'?`Waiting for ${state.nextStreet.toLowerCase()}.`:'Waiting for showdown result.');
      if(JSON.stringify(payload.board)!==JSON.stringify(state.board))throw Error('The board must match the current street. Finish the actions before dealing new cards.');
      if(state.hasSidePots)throw Error('There are side pots: EV for this decision is not modeled yet. Chip tracking remains available.');
      if((payload.opponentHand||payload.opponentRange)&&state.players[Number($('#opponentSeat').value)]?.folded)throw Error('The opponent for the entered hand/range folded. Remove that input or choose another player in settings.');
      const hero=state.players[state.heroId];
      return {...payload,players:state.activePlayers,potBeforeAction:state.pot,amountToCall:state.heroToCall,effectiveStack:hero.stack,position:hero.position,
        actionHistory:state.log, ...(state.actor===state.heroId?{availableActions:state.legal.actions.filter(action=>action!=='FOLD'||state.heroToCall>0)}:{})};
    }
  };
  render();
})();
