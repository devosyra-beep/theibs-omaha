/* One keyboard owner for Analyze, observed hands and simulated hands.
   Selection is synchronous. Observations are serialized independently of focus. */
(function () {
  'use strict';
  if (window.theibsKeyboard) return;
  const { BINDINGS, locale, resolveKey, canHandleKey, CommandQueue } = window.TheibsKeyboardCommands;
  const $ = s => document.querySelector(s), cards = window.theibsCardKeyboard, esc = window.EssenceUI.esc;
  const app = () => window.theibsApp, mw = () => window.theibsMultiwayUI.getState();
  let language = locale(document.documentElement.lang), selectedPlayer = null, context = 'cards', scope = 'hero';
  let rank = '', ten = false, cursor = 0, generation = 0;
  let observations = [], opponentCards = new Map(), stagedBoard = Array(5).fill(null), amountDraft = null;
  let boardCorrections=new Set(), wasEnabled=mw().enabled, pendingHeroSelection=false, trackingStarting=false;
  let simFlushScheduled=false,flushScheduled = false, feedbackTimer, shiftCandidate = false, typingUntil = 0, resetting = false;
  const held = new Set(), symbols = { E:'♠', C:'♥', O:'♦', P:'♣' };
  const text = (pt, en) => language === 'pt-BR' ? pt : en;
  const queue = new CommandQueue(error => feedback(error.message, true));
  const toolbar = document.createElement('div'); toolbar.className = 'keyboard-context';
  toolbar.innerHTML = '<div><span id="keyboard-mode" class="keyboard-eyebrow"></span><strong id="keyboard-target"></strong></div><label class="keyboard-language"><span>Idioma / Language</span><select id="keyboard-language" aria-label="Idioma / Language"><option value="en-US">EN</option><option value="pt-BR">PT-BR</option></select></label>';
  const keyboard = $('.card-keyboard'); keyboard.prepend(toolbar);
  const slots = document.createElement('div'); slots.id = 'keyboard-context-slots'; slots.className='keyboard-context-slots'; slots.hidden=true;
  toolbar.after(slots);
  const legend = document.createElement('div'); legend.className='keyboard-command-legend'; keyboard.append(legend);
  const pendingList=document.createElement('div');pendingList.id='keyboard-observations';pendingList.className='keyboard-observations';keyboard.append(pendingList);
  const live=document.createElement('p');live.id='keyboard-feedback';live.setAttribute('role','status');live.setAttribute('aria-live','polite');keyboard.append(live);
  const amount=document.createElement('dialog');amount.id='keyboard-amount-dialog';amount.className='keyboard-amount-dialog';
  amount.innerHTML='<form id="keyboard-amount-form"><div class="dialog-head"><h2 id="keyboard-amount-title"></h2><button type="button" id="keyboard-amount-close" class="ghost-button" aria-label="Cancel">×</button></div><label><span id="keyboard-amount-label"></span><input id="keyboard-amount" type="number" step="0.01" min="0.01" inputmode="decimal" required autocomplete="off"></label><p id="keyboard-amount-help"></p><button type="submit" class="primary-button" id="keyboard-amount-confirm"></button></form>';
  document.body.append(amount);
  const trainingHint=document.createElement('div');trainingHint.className='training-keyboard-hint';$('#training-table').before(trainingHint);

  function protectedInput(target) {
    const el=target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    return Boolean(el && !(el.tagName==='INPUT' && ['checkbox','radio','button','submit','reset'].includes(el.type)));
  }
  function allowed() {
    const state=app()?.getState();
    return !!state && app().getVoiceContext().loaded && ['analyze','train','simulation'].includes(state.activeView) &&
      !$('#app-shell').hidden && !$('#app-shell').inert;
  }
  const sim=()=>window.TheibsSimulationUI.getKeyboardState();
  function players() {
    if(app()?.getState().activeView==='simulation'&&sim().session)return sim().session.state.players;
    if(mw().enabled && mw().state) return mw().state.players;
    return window.theibsMultiwayUI.keyboardPlayers();
  }
  const heroId=()=>players().find(p=>p.hero)?.id;
  const currentPlayer=()=>players().find(p=>p.id===selectedPlayer)||players().find(p=>p.hero);
  const playerName=p=>p?.hero?text('Você','You'):p?.name||text('Adversário','Opponent');
  function clearRank() {rank='';ten=false;}
  function setContext(value) {context=value;document.body.dataset.keyboardContext=value;}
  function selectPlayer(id, manual=true) {
    if(!players().some(p=>p.id===id)) return;
    selectedPlayer=id;scope=id===heroId()?'hero':'opponent';cursor=id===heroId()?Math.min(cards.state.selected,cards.state.count-1):0;
    clearRank();setContext('players');paint();
  }
  function nextPlayer(delta, eligible=false, manual=true) {
    const list=players(), from=list.findIndex(p=>p.id===currentPlayer()?.id);
    for(let n=1;n<=list.length;n++) {
      const p=list[(from+delta*n+list.length*2)%list.length];
      if(eligible && (p.folded||p.allIn||observations.some(item=>item.actor===p.id&&item.kind==='FOLD'))) continue;
      selectPlayer(p.id,manual);return;
    }
  }
  function feedback(message, error=false) {
    clearTimeout(feedbackTimer);live.textContent=message;live.classList.toggle('error',error);
    feedbackTimer=setTimeout(()=>{live.textContent='';live.classList.remove('error');},error?6000:2200);
  }
  function flash(command) {
    const nodes = command.type==='CARD_RANK' ? keyboard.querySelectorAll(`[data-card^="${command.rank}"]`) : command.type==='CARD_SUIT' ? keyboard.querySelectorAll(`[data-suit="${command.suit}"]`) : document.querySelectorAll(`[data-keyboard-command="${command.type}"]`);
    for(const node of nodes){node.classList.add('is-key-active');setTimeout(()=>node.classList.remove('is-key-active'),130);}
  }
  function cardDescription(card) {
    if(!card)return text('Vazia','Empty');const config=BINDINGS[language];
    return `${config.rankNames[card[0]]||card[0]} ${text('de','of')} ${config.suitNames[card[1]]} ${symbols[card[1]]}`;
  }
  function values() {
    if(scope==='board')return stagedBoard;
    if(scope==='opponent'){
      if(!opponentCards.has(currentPlayer().id))opponentCards.set(currentPlayer().id,Array(cards.state.count).fill(null));
      return opponentCards.get(currentPlayer().id);
    }
    return cards.state.slots;
  }
  function paint() {
    if(!app())return;
    if(selectedPlayer==null)selectedPlayer=heroId();
    const p=currentPlayer();
    if(app().getState().activeView==='simulation'){
      for(const node of document.querySelectorAll('[data-sim-seat]'))node.classList.toggle('keyboard-selected-player',Number(node.dataset.simSeat)===p?.id);
      const label=$('#simulation-keyboard-target');if(label)label.textContent=text('Selecionado: ','Selected: ')+playerName(p)+(p?.folded?' · Folded':'')+' · ↑ ↓ · F / G / H';return;
    }
    $('#keyboard-mode').textContent=context==='players'?text('AÇÃO SELECIONADA','SELECTED ACTION'):text('ENTRADA DE CARTAS','CARD ENTRY');
    const boardPending=scope==='board'&&stagedBoard.some((card,i)=>card!==(mw().state?.board[i]?window.TheibsCards.fromCanonical(mw().state.board[i]):null));
    const target=scope==='board'?(boardPending?text('Board · rascunho','Board · draft'):'Board'):playerName(p);
    const foldPending=observations.some(item=>item.actor===p?.id&&item.kind==='FOLD');
    const suffix=context==='players'?(p?.folded?text(' · Fold registrado',' · Folded'):foldPending?text(' · Fold pendente',' · Fold pending'):p?.allIn?' · All-in':''):` · ${text('carta','card')} ${(scope==='hero'?cards.state.selected:cursor)+1}`;
    $('#keyboard-target').textContent=target+(scope!=='board'&&p?.position?' · '+p.position:'')+suffix+(rank?` · ${BINDINGS[language].rankNames[rank]||rank} → ${text('naipe','suit')}`:ten?' · 10 → 0':'');
    if(!mw().enabled){const opponents=players().filter(p=>!p.hero);for(const [i,node]of [...document.querySelectorAll('.opponent-place')].entries()){if(!opponents[i])continue;node.dataset.keyboardPlayer=opponents[i].id;node.classList.toggle('keyboard-selected-player',opponents[i].id===p?.id);node.setAttribute('role','button');node.tabIndex=0;node.setAttribute('aria-pressed',String(opponents[i].id===p?.id));}}
    for(const node of document.querySelectorAll('[data-multiway-player]')){
      const selected=Number(node.dataset.multiwayPlayer)===p?.id;
      node.classList.toggle('keyboard-selected-player',selected);node.setAttribute('aria-pressed',String(selected));
    }
    $('.hero-seat')?.classList.toggle('keyboard-selected-player',p?.hero && context==='players');
    $('.table-surface')?.classList.toggle('keyboard-player-context',context==='players');
    const selectedCard=scope==='hero'?cards.state.slots[cards.state.selected]:values()[cursor];
    const used=new Set([...cards.state.slots,...stagedBoard,...[...opponentCards.values()].flat()].filter(Boolean));
    for(const button of keyboard.querySelectorAll('[data-card]')){
      const current=button.dataset.card===selectedCard,taken=used.has(button.dataset.card)&&!current;
      button.classList.toggle('active',current);button.classList.toggle('used',taken);button.disabled=taken||cards.isManualInvalid();
    }
    $('#remove-card').disabled=!selectedCard;
    $('#undo-card').disabled=context==='players'?!observations.length&&!app().getState().multiway?.events.length:scope==='hero'?!cards.state.undoStack.length:!values().some(Boolean);
    for(const node of document.querySelectorAll('[data-slot]')){const index=Number(node.dataset.slot);node.setAttribute('aria-label',(index<cards.state.count?text('Sua carta','Your card')+' '+(index+1):text('Board','Board')+' '+(index-cards.state.count+1))+': '+cardDescription(cards.state.slots[index]));}
    slots.hidden=scope==='hero';
    if(!slots.hidden){
      const entries=values(), focused=slots.contains(document.activeElement);
      if(slots.children.length!==entries.length)slots.replaceChildren(...entries.map((_,i)=>{
        const button=document.createElement('button');button.type='button';button.dataset.keyboardSlot=i;button.className='keyboard-slot';return button;
      }));
      entries.forEach((card,i)=>{
        const button=slots.children[i];button.classList.toggle('selected',i===cursor);button.setAttribute('aria-pressed',String(i===cursor));
        button.setAttribute('aria-label',text('Carta','Card')+' '+(i+1)+': '+cardDescription(card));
        const label=card?(card[0]==='T'?'10':card[0])+symbols[card[1]]:String(i+1);if(button.textContent!==label)button.textContent=label;
      });
      if(focused&&context==='cards'&&document.activeElement!==slots.children[cursor])slots.children[cursor]?.focus({preventScroll:true});
    }
    const pendingNodes=new Map([...pendingList.children].map(node=>[node.dataset.observation,node]));
    observations.forEach((item,i)=>{
      const button=pendingNodes.get(item.id)||document.createElement('button');button.type='button';button.dataset.observation=item.id;
      button.className='keyboard-observation'+(item.error?' error':'');button.title=item.error||text('Enter para revisar; Backspace no jogador para remover','Enter to review; Backspace on player to remove');
      const label=playerName(players().find(p=>p.id===item.actor))+' · '+(item.kind==='FOLD'?'Fold':item.kind==='MATCH'?'Check / Call':'Bet / Raise '+item.to)+' · '+(item.error||text('aguardando fluxo','pending flow'));
      if(button.textContent!==label)button.textContent=label;
      if(pendingList.children[i]!==button)pendingList.insertBefore(button,pendingList.children[i]||null);
      pendingNodes.delete(item.id);
    });
    for(const node of pendingNodes.values())node.remove();
    const state=mw().state;
    for(const button of document.querySelectorAll('[data-mw-command]')){
      const command=button.dataset.mwCommand,owed=Math.max(0,(state?.currentBet||0)-(p?.streetPaid||0));
      const label=command==='leave'?'Fold':command==='call'?(owed?'Call '+Math.min(p?.stack||0,owed):'Check'):state?.currentBet?'Raise':'Bet';
      button.querySelector('span').textContent=label;button.disabled=!mw().enabled||p?.folded||p?.allIn||['FINISHED','SHOWDOWN'].includes(state?.phase);
      button.title=label+' · '+(command==='leave'?'F':command==='call'?'G':'H')+' · '+playerName(p);
    }
    for(const button of document.querySelectorAll('#training-action-buttons [data-action]')){
      const action=button.dataset.action,key=action==='FOLD'?'F':['CHECK','CALL'].includes(action)?'G':'H';
      button.dataset.keyboardCommand=action==='FOLD'?'FOLD':['CHECK','CALL'].includes(action)?'MATCH':'AGGRESSIVE';
      if(!button.querySelector('kbd'))button.insertAdjacentHTML('beforeend',` <kbd>${key}</kbd>`);
    }
  }
  function translate() {
    $('#keyboard-language').value=language;document.documentElement.lang=language;
    const config=BINDINGS[language];
    $('#open-card-picker').lastChild.textContent=text('Cartas','Cards');
    $('#new-hand').textContent=config.newGame;$('#new-hand').title=config.newGame+" · '";
    $('#clear').title=text('Reset da mão · Shift','Reset hand · Shift');$('#clear').setAttribute('aria-label',$('#clear').title);
    $('#remove-card').textContent=text('Remover','Remove');$('#undo-card').textContent=text('Desfazer','Undo');$('#copy-cards').textContent=text('Copiar','Copy');$('#open-entry').textContent=text('Colar texto','Paste text');$('#training-start').textContent=text('Nova mão simulada','New simulated hand');
    $('.picker-help').textContent=text('Valor + naipe. Dez = D, T ou 10.','Rank + suit. Ten = T, D or 10.');
    legend.innerHTML=`<span><kbd>← →</kbd> ${text('Cartas','Cards')}</span><span><kbd>↑ ↓</kbd> ${text('Jogadores','Players')}</span><span><kbd data-keyboard-command="FOLD">F</kbd> Fold</span><span><kbd data-keyboard-command="MATCH">G</kbd> Check / Call</span><span><kbd data-keyboard-command="AGGRESSIVE">H</kbd> Bet / Raise</span><span><kbd>↵</kbd> ${text('Próximo','Next')}</span><span><kbd>⌫</kbd> ${text('Corrigir','Correct')}</span><span><kbd>Shift</kbd> Reset</span><span><kbd>'</kbd> ${config.newGame}</span>`;
    trainingHint.innerHTML=`<kbd>F</kbd> Fold · <kbd>G</kbd> Check / Call · <kbd>H</kbd> Bet / Raise · <kbd>'</kbd> ${config.newGame} · Tab / Enter`;
    for(const button of keyboard.querySelectorAll('[data-card]')){
      const card=button.dataset.card;button.title=cardDescription(card)+` · ${card[0]==='T'?config.ten:card[0]} ${card[1]}`;button.setAttribute('aria-label',button.title);
      if(card[0]==='T'){let hint=button.querySelector('.ten-shortcut');if(!hint){hint=document.createElement('span');hint.className='ten-shortcut';hint.setAttribute('aria-hidden','true');button.append(hint);}hint.textContent=config.ten;}
    }
    for(const node of keyboard.querySelectorAll('.card-suit')){node.title=config.suitNames[node.dataset.suit];node.setAttribute('aria-label',node.title);node.removeAttribute('aria-hidden');}
    const help=$('#help-dialog');
    if(!$('#keyboard-help')){const node=document.createElement('section');node.id='keyboard-help';help.querySelector('.dialog-head').after(node);}
    $('#keyboard-help').innerHTML=`<h3>${text('Entrada rápida','Quick entry')}</h3><p>${text('Valor + naipe, sem Enter e com o painel aberto ou fechado.','Rank + suit, without Enter, with the panel open or closed.')} ${config.ten} = ${config.rankNames.T}. ${Object.entries(config.suitNames).map(([s,n])=>`${symbols[s]} ${s} ${n}`).join(' · ')}.</p><p>F = Fold · G = Check / Call · H = Bet / Raise. ${text('H abre o valor; digite e confirme com Enter. ↑/↓ selecionam qualquer jogador; ←/→ voltam às cartas. Ações antecipadas ficam visíveis até poderem entrar no fluxo.','H opens the amount; type and confirm with Enter. ↑/↓ select any player; ←/→ return to cards. Early observations stay visible until they can enter the flow.')}</p><p>${text('Tab/Shift+Tab e Enter acessam todos os controles, inclusive configurações e simulação. Ctrl+1/2/3/4 selecionam mão/flop/turn/river. Shift sozinho reseta; apóstrofo inicia nova mão.','Tab/Shift+Tab and Enter access every control, including settings and simulation. Ctrl+1/2/3/4 select hand/flop/turn/river. Shift alone resets; apostrophe starts a new game.')}</p>`;
    // Replace stale help that described a different action keyboard.
    for(const node of [...help.children])if(node!==$('#keyboard-help')&&node.matches('p,.help-suits,.shortcut-list'))node.hidden=true;
    paint();
  }
  function selectCard(index) {
    clearRank();setContext('cards');
    if(scope==='hero'){
      if(mw().enabled && index>=cards.state.count){scope='board';cursor=Math.min(4,index-cards.state.count);}
      else cards.select(Math.max(0,Math.min(cards.state.slots.length-1,index)));
    }else cursor=Math.max(0,Math.min(values().length-1,index));
    paint();
  }
  function moveCard(delta) {
    if(scope==='board' && cursor===0 && delta<0){scope='hero';selectCard(cards.state.count-1);return;}
    selectCard((scope==='hero'?cards.state.selected:cursor)+delta);
  }
  function duplicate(card) {
    const position=scope==='hero'?cards.state.selected:cursor;
    if(cards.state.slots.some((v,i)=>v===card&&!(scope==='hero'&&i===position)&&!(scope==='board'&&i===cards.state.count+position)))return true;
    if(stagedBoard.some((v,i)=>v===card&&!(scope==='board'&&i===position)))return true;
    for(const [id,entries] of opponentCards)if(entries.some((v,i)=>v===card&&!(scope==='opponent'&&id===currentPlayer().id&&i===position)))return true;
    const selectedSeat=scope==='opponent'?(mw().enabled?currentPlayer().id:currentPlayer().id>heroId()?currentPlayer().id-1:currentPlayer().id):null;
    for(const row of window.theibsOpponentInputs.payload().opponentOverrides)if(row.seatId!==selectedSeat&&row.range?.hands.length===1&&row.range.hands[0].includes(window.TheibsCards.toCanonical(card)))return true;
    for(const token of ($('#deadCards')?.value||'').trim().split(/[\s,;]+/)){try{if(window.TheibsCards.fromCanonical(token)===card)return true;}catch{/* Invalid text retains its existing validation path. */}}
    return false;
  }
  function syncOpponent() {
    const p=currentPlayer();if(p.hero||scope!=='opponent')return;
    const seat=mw().enabled?p.id:p.id>heroId()?p.id-1:p.id;
    window.theibsOpponentInputs.setKnownHand(seat,values().filter(Boolean));
  }
  function assign(suit) {
    const card=rank+suit;if(!rank)return;
    if(duplicate(card)){feedback(text('Carta duplicada. Escolha outro valor ou naipe.','Duplicate card. Choose another rank or suit.'),true);return;}
    setContext('cards');
    if(scope==='hero'){cards.assign(card);if(cards.state.error){feedback(cards.state.error,true);return;}if((mw().enabled||trackingStarting) && cards.state.slots.slice(0,cards.state.count).every(Boolean)){scope='board';cursor=Math.max(0,stagedBoard.findIndex(v=>!v));}}
    else {const position=cursor,entries=values();entries[cursor]=card;const next=entries.findIndex((v,i)=>!v&&i>cursor);cursor=next>=0?next:entries.findIndex(v=>!v)>=0?entries.findIndex(v=>!v):cursor;if(scope==='opponent')syncOpponent();else if(position<(mw().state?.board.length||0)){boardCorrections.add(position);const token=generation;queue.push(async()=>{await waitReady();if(token===generation){await app().keyboard.editBoard(position,window.TheibsCards.toCanonical(card));boardCorrections.delete(position);}});}else scheduleFlush();}
    clearRank();feedback(cardDescription(card));paint();app().keyboard.changed();
  }
  function correct(remove=false) {
    if(rank||ten){clearRank();paint();return;}
    if(context==='players'&&!remove){
      const item=[...observations].reverse().find(entry=>entry.actor===currentPlayer().id);
      if(item){observations=observations.filter(entry=>entry!==item);feedback(text('Observação removida.','Observation removed.'));paint();app().keyboard.changed();return;}
      queue.push(async()=>{await waitReady();if(mw().enabled && mw().state.log.filter(e=>!['SB','BB'].includes(e.action)).at(-1)?.actor===currentPlayer().id){await window.theibsMultiwayUI.keyboardUndo();}else feedback(text('Nenhuma ação deste jogador para desfazer.','No action for this player to undo.'),true);paint();});return;
    }
    if(scope==='hero'){
      if(cards.state.slots[cards.state.selected]){cards.state.removeSelected();cards.restore(cards.state.snapshot(),{preserveUndo:true});}
      else if(!remove)cards.undo();
    }else{const entries=values();if(scope==='board'&&cursor<(mw().state?.board.length||0))boardCorrections.add(cursor);if(!entries[cursor]&&!remove)cursor=Math.max(0,cursor-1);entries[cursor]=null;if(scope==='opponent')syncOpponent();}
    paint();app().keyboard.changed();
  }
  async function waitReady() {
    for(let n=0;mw().busy||app().getState().trainingBusy;n++){
      if(n>1200)throw Error(text('O registro demorou. A entrada continua pendente.','Recording timed out. The input remains pending.'));
      await new Promise(resolve=>setTimeout(resolve,16));
    }
  }
  function makeObservation(kind,to) {
    const state=mw().state,p=currentPlayer();
    if(p.folded||p.allIn){feedback(text('Jogador fora da ação. Use as setas para continuar.','Player cannot act. Use the arrows to continue.'),true);return;}
    if(state?.phase==='FINISHED'||state?.phase==='SHOWDOWN'){feedback(text('Rodada encerrada. Inicie uma nova mão.','Round complete. Start a new game.'),true);return;}
    const item={id:crypto.randomUUID(),actor:p.id,kind,...(to==null?{}:{to}),street:state?.phase==='WAIT_BOARD'?state.nextStreet:state?.street||'PREFLOP',generation};
    // A correction replaces an uncommitted observation for the same seat/street.
    observations=observations.filter(entry=>entry.actor!==item.actor||entry.street!==item.street);observations.push(item);
    nextPlayer(1,true,false);setContext('players');
    if(state?.actor===item.actor&&state.pending?.length===1&&kind!=='AGGRESSIVE'&&state.street!=='RIVER'&&state.players.filter(p=>!p.folded).length-(kind==='FOLD'?1:0)>=2){selectedPlayer=state.heroId;scope='board';cursor=state.board.length;setContext('cards');}
    paint();
    feedback(text('Ação registrada para o jogador selecionado.','Action captured for the selected player.'));
    scheduleFlush();app().keyboard.changed();
  }
  async function ensureTracking() {
    if(mw().enabled)return;
    trackingStarting=true;
    cards.state.slots.slice(cards.state.count).forEach((card,i)=>{if(card&&!stagedBoard[i])stagedBoard[i]=card;});
    if(cards.state.selected>=cards.state.count){scope='board';cursor=cards.state.selected-cards.state.count;}
    const draft=window.theibsMultiwayUI.getDraft();
    draft.startingStack=Number(draft.startingStack)>0?Number(draft.startingStack):100;
    draft.heroCards=cards.state.cards().hero.length===cards.state.count?cards.state.cards().hero.map(window.TheibsCards.toCanonical):[];
    try{await app().keyboard.startTracking(draft);}finally{trackingStarting=false;}
    feedback(text(`Mesa iniciada · ${draft.playerCount} jogadores · blinds ${draft.smallBlind}/${draft.bigBlind} · stack ${draft.startingStack}`,`Table started · ${draft.playerCount} players · blinds ${draft.smallBlind}/${draft.bigBlind} · stack ${draft.startingStack}`));
  }
  function scheduleFlush() {
    if(flushScheduled)return;flushScheduled=true;
    queue.push(async()=>{try{await flush();}finally{flushScheduled=false;}});
  }
  async function flush() {
    const token=generation;
    await waitReady();if(token!==generation||app().getState().activeView!=='analyze')return;
    if(observations.length)await ensureTracking();
    for(let attempts=0;attempts<100&&token===generation;attempts++){
      const state=mw().state;if(!state||!mw().enabled)return;
      const expected={FLOP:3,TURN:4,RIVER:5}[state.nextStreet];
      if(state.phase==='WAIT_BOARD'&&stagedBoard.slice(0,expected).every(Boolean)){
        const board=stagedBoard.slice(0,expected).map(window.TheibsCards.toCanonical);
        if(await window.theibsMultiwayUI.keyboardBoard(board))continue;
        feedback(mw().error,true);break;
      }
      const item=observations.find(entry=>!entry.error&&entry.street===state.street&&entry.actor===state.actor)||
        observations.find(entry=>!entry.error&&entry.street===state.street&&entry.kind==='FOLD'&&state.players.find(p=>p.id===entry.actor)?.canMarkFold);
      if(!item)break;
      const p=state.players.find(p=>p.id===item.actor);
      if(p.folded||p.allIn){item.error=text('Jogador fora da ação','Player cannot act');continue;}
      const observed=item.actor!==state.actor;
      const action=item.kind==='FOLD'?'FOLD':item.kind==='MATCH'?(state.legal.actions.includes('CHECK')?'CHECK':'CALL'):(state.currentBet?'RAISE':'BET');
      const ok=await window.theibsMultiwayUI.keyboardAction({actor:item.actor,...(observed?{}:{action}),...(item.to==null?{}:{to:item.to})},observed);
      if(token!==generation)return;
      if(ok)observations=observations.filter(entry=>entry!==item);else item.error=mw().error||text('Revise o valor','Review the amount');
      paint();app().keyboard.changed();
    }
    // Automatic selection happens at capture time, never on a delayed HTTP response.
    paint();
  }
  function openAmount() {
    const state=app().getState(),p=currentPlayer();clearRank();
    if(state.activeView==='simulation'){
      if(!sim().session||sim().session.finished||p?.folded||p?.allIn)return;
      amountDraft={mode:'simulation',generation,actor:p.id,session:sim().session.id};
      $('#keyboard-amount').min=.01;$('#keyboard-amount').removeAttribute('max');
      $('#keyboard-amount-help').textContent=text('Total nesta street. Ação pendente até o jogador entrar no fluxo.','Total this street. Pending until this player enters the flow.');
    }else if(state.activeView==='train'){
      const session=state.trainingSession;
      if(!session||session.finished){feedback(text('Inicie a simulação com apóstrofo.','Start the simulation with apostrophe.'),true);return;}
      if(!session.legalActions.some(a=>['BET','RAISE'].includes(a))&&!state.trainingBusy){feedback(text('Aposta indisponível nesta decisão.','Bet unavailable for this decision.'),true);return;}
      amountDraft={mode:'train',generation,session:session.id,revision:session.revision,afterPending:state.trainingBusy||queue.size>0};
      $('#keyboard-amount-help').textContent=text(`Total nesta street: ${session.minSize} a ${session.maxSize}.`,`Total this street: ${session.minSize} to ${session.maxSize}.`);
      $('#keyboard-amount').min=amountDraft.afterPending ? .01 : (session.minSize || .01);$('#keyboard-amount').max=amountDraft.afterPending?'':session.maxSize||'';
    }else{
      if(p.folded||p.allIn){feedback(text('Jogador fora da ação.','Player cannot act.'),true);return;}
      amountDraft={mode:'analyze',actor:p.id,generation,street:mw().state?.street};
      $('#keyboard-amount').min=.01;$('#keyboard-amount').removeAttribute('max');
      $('#keyboard-amount-help').textContent=text('Total comprometido nesta street. O valor será validado ao entrar no fluxo.','Total committed this street. The amount is validated when it enters the flow.');
    }
    $('#keyboard-amount-title').textContent='Bet / Raise · '+playerName(p);
    $('#keyboard-amount-label').textContent=text('Total nesta street','Total this street');$('#keyboard-amount-confirm').textContent=text('Confirmar · Enter','Confirm · Enter');
    $('#keyboard-amount').value='';amount.showModal();$('#keyboard-amount').focus({preventScroll:true});
  }
  $('#keyboard-amount-close').onclick=()=>amount.close();
  amount.addEventListener('close',()=>{amountDraft=null;const surface=app().getState().activeView==='simulation'?$('.sim-actions'):app().getState().activeView==='train'?$('#training-table'):$('.table-surface');surface.tabIndex=0;surface.focus({preventScroll:true});});
  $('#keyboard-amount-form').onsubmit=event=>{
    event.preventDefault();if(!amountDraft||!$('#keyboard-amount').reportValidity())return;
    const draft={...amountDraft},to=Number($('#keyboard-amount').value);amount.close();
    if(draft.generation!==generation)return;
    if(draft.mode==='simulation'){if(sim().session?.id===draft.session&&window.TheibsSimulationUI.keyboardCapture('AGGRESSIVE',draft.actor,to))nextPlayer(1,true);paint();}
    else if(draft.mode==='train')queue.push(async()=>{
      await waitReady();const session=app().getState().trainingSession;
      if(draft.generation!==generation||session?.id!==draft.session||(!draft.afterPending&&session.revision!==draft.revision))throw Error(text('A simulação mudou. Repita a ação.','Simulation changed. Repeat the action.'));
      const action=session.legalActions.find(a=>['BET','RAISE'].includes(a));if(!action)throw Error(text('Aposta indisponível.','Bet is unavailable.'));
      if(!await app().keyboard.actTraining(action,to))throw Error($('#training-coach').textContent);paint();
    });
    else {selectedPlayer=draft.actor;makeObservation('AGGRESSIVE',to);}
  };
  function trainingAction(kind) {
    const token=generation;
    queue.push(async()=>{
      await waitReady();if(token!==generation||app().getState().activeView!=='train')return;const session=app().getState().trainingSession;
      if(!session||session.finished)throw Error(text('Inicie uma simulação com apóstrofo.','Start a simulation with apostrophe.'));
      const action=kind==='FOLD'?'FOLD':session.legalActions.includes('CHECK')?'CHECK':'CALL';
      if(!session.legalActions.includes(action))throw Error(text('Ação indisponível nesta decisão.','Action unavailable for this decision.'));
      if(!await app().keyboard.actTraining(action))throw Error($('#training-coach').textContent);paint();
    });
  }
  function reset(newGame) {
    resetting=mw().enabled && app().getState().activeView==='analyze';
    generation++;observations=[];opponentCards.clear();stagedBoard=Array(5).fill(null);boardCorrections.clear();clearRank();selectedPlayer=heroId();scope='hero';cursor=0;setContext('cards');
    const state=app().getState();
    if(state.activeView==='train')queue.push(async()=>{await waitReady();if(newGame)await app().keyboard.newHand();else app().keyboard.resetTraining();paint();});
    else{
      if($('#deadCards'))$('#deadCards').value='';
      cards.reset();
      if(mw().enabled){const config={...mw().config,heroCards:[]};queue.push(async()=>{await waitReady();try{await app().keyboard.startTracking(config);}finally{resetting=false;document.dispatchEvent(new CustomEvent('theibs:cards-changed',{detail:{source:'keyboard-reset-complete'}}));}paint();});}
      else void app().keyboard.newHand();
    }
    paint();feedback(text(newGame?'Nova mão.':'Mão resetada.',newGame?'New Game.':'Hand reset.'));app().keyboard.changed();
  }
  function dispatch(command) {
    if(['CARD_RANK','CARD_SUIT','CARD_TEN_PREFIX','FOLD','MATCH'].includes(command.type))typingUntil=performance.now()+2000;
    flash(command);
    if(app().getState().activeView==='simulation'){
      if(command.type==='PREVIOUS_PLAYER')nextPlayer(-1);
      else if(command.type==='NEXT_PLAYER')nextPlayer(1);
      else if(['FOLD','MATCH'].includes(command.type)){if(window.TheibsSimulationUI.keyboardCapture(command.type,currentPlayer()?.id))nextPlayer(1,true);}
      else if(command.type==='AGGRESSIVE')openAmount();
      else if(['CONFIRM','RESET_HAND','NEW_GAME','BACKSPACE'].includes(command.type))queue.push(()=>window.TheibsSimulationUI.keyboardCommand(command.type));
      else if(command.type==='HELP'){if(!$('#help-dialog').open)$('#help-dialog').showModal();}
      paint();return;
    }
    switch(command.type){
      case 'CARD_RANK': if(app().getState().activeView==='train')return;rank=command.rank;ten=false;setContext('cards');paint();break;
      case 'CARD_TEN_PREFIX':if(app().getState().activeView==='train')return;rank='';ten=true;paint();break;
      case 'CARD_SUIT':assign(command.suit);break;
      case 'PREVIOUS_PLAYER':nextPlayer(-1);break;
      case 'NEXT_PLAYER':nextPlayer(1);break;
      case 'PREVIOUS_CARD':moveCard(-1);break;
      case 'NEXT_CARD':moveCard(1);break;
      case 'FOLD':case 'MATCH':clearRank();if(app().getState().activeView==='train')trainingAction(command.type);else makeObservation(command.type);break;
      case 'AGGRESSIVE':openAmount();break;
      case 'CONFIRM':if(rank||ten)feedback(text('Escolha o naipe: E, C, O ou P.','Choose the suit: E, C, O or P.'));else if(app().getState().activeView==='train')trainingAction('MATCH');else {nextPlayer(1,true);scheduleFlush();}break;
      case 'BACKSPACE':correct();break;
      case 'REMOVE_CARD':correct(true);break;
      case 'UNDO_CARDS':if(context==='players'||scope!=='hero')correct();else {cards.undo();paint();}break;
      case 'COPY_CARDS':void cards.copy();break;
      case 'EXPORT_CARDS':cards.exportDraft();break;
      case 'CANCEL':clearRank();paint();break;
      case 'NEW_GAME':reset(true);break;
      case 'RESET_HAND':reset(false);break;
      case 'HELP':if(!$('#help-dialog').open)$('#help-dialog').showModal();break;
      case 'SELECT_STREET':
        selectedPlayer=heroId();scope=mw().enabled&&command.street!=='PREFLOP'?'board':'hero';
        const index=({PREFLOP:0,FLOP:cards.state.count,TURN:cards.state.count+3,RIVER:cards.state.count+4})[command.street];
        if(scope==='board')selectCard(index-cards.state.count);else selectCard(index);break;
    }
  }
  document.addEventListener('keydown',event=>{
    const code=event.code||event.key;
    const available=allowed()&&!document.querySelector('dialog[open]')&&!protectedInput(event.target);
    if(event.key==='Shift'){shiftCandidate=available&&!event.repeat&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&held.size===0;held.add(code);return;}
    shiftCandidate=false;held.add(code);
    if(!canHandleKey(event,{enabled:available,hidden:document.hidden}))return;
    if(event.key==='Tab')typingUntil=0;
    if(event.key===' ' && performance.now()<typingUntil){event.preventDefault();event.stopImmediatePropagation();return;}
    const focusedPlayer=event.target?.closest?.('[data-keyboard-player],[data-multiway-player]');
    if(focusedPlayer&&['Enter',' '].includes(event.key)&&Number(focusedPlayer.dataset.multiwayPlayer??focusedPlayer.dataset.keyboardPlayer)===selectedPlayer){event.preventDefault();event.stopImmediatePropagation();if(mw().enabled)window.theibsMultiwayUI.openPlayer(selectedPlayer);else {setContext('cards');paint();}return;}
    // Native buttons, summaries and links retain Enter/Space activation.
    if(event.key==='Enter'&&event.target?.closest?.('button,summary,a[href]')&&!event.target.closest('[data-slot],[data-card],[data-multiway-player],[data-keyboard-slot]'))return;
    const command=resolveKey(event,language,{rank,ten});if(!command)return;
    if(event.repeat&&!['PREVIOUS_CARD','NEXT_CARD','PREVIOUS_PLAYER','NEXT_PLAYER'].includes(command.type))return;
    event.preventDefault();event.stopImmediatePropagation();dispatch(command);
  },true);
  document.addEventListener('keyup',event=>{
    held.delete(event.code||event.key);
    if(event.key!=='Shift')return;
    const resetAllowed=shiftCandidate&&held.size===0&&!event.shiftKey&&!event.isComposing&&allowed()&&!document.querySelector('dialog[open]')&&!protectedInput(document.activeElement);
    shiftCandidate=false;if(resetAllowed){event.preventDefault();dispatch({type:'RESET_HAND'});}
  },true);
  window.addEventListener('blur',()=>{held.clear();shiftCandidate=false;clearRank();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){held.clear();shiftCandidate=false;clearRank();}});
  document.addEventListener('pointerdown',()=>{shiftCandidate=false;},true);
  document.addEventListener('focusin',event=>{
    if(protectedInput(event.target)){shiftCandidate=false;clearRank();paint();}
    const player=event.target.closest?.('[data-keyboard-player],[data-multiway-player]');if(player&&!document.querySelector('dialog[open]'))selectPlayer(Number(player.dataset.multiwayPlayer??player.dataset.keyboardPlayer));
    const slot=event.target.closest?.('[data-slot]');
    if(slot && !document.querySelector('dialog[open]')){clearRank();selectedPlayer=heroId();scope='hero';setContext('cards');paint();}
  });
  document.addEventListener('click',event=>{const player=event.target.closest?.('[data-keyboard-player]');if(player)selectPlayer(Number(player.dataset.keyboardPlayer));});
  slots.onclick=event=>{const button=event.target.closest('[data-keyboard-slot]');if(button)selectCard(Number(button.dataset.keyboardSlot));};
  pendingList.onclick=event=>{
    const button=event.target.closest('[data-observation]'),item=observations.find(entry=>entry.id===button?.dataset.observation);if(!item)return;
    selectPlayer(item.actor);if(item.kind==='AGGRESSIVE')openAmount();else {item.error='';scheduleFlush();paint();}
  };
  $('#keyboard-language').onchange=event=>{language=locale(event.target.value);clearRank();translate();app().keyboard.changed();};
  document.addEventListener('theibs:multiway-render',()=>{
    const state=mw().state;
    if(wasEnabled&&!mw().enabled){generation++;observations=[];opponentCards.clear();boardCorrections.clear();stagedBoard=Array(5).fill(null);selectedPlayer=null;scope='hero';}
    wasEnabled=mw().enabled;
    if(pendingHeroSelection&&!mw().busy){pendingHeroSelection=false;selectedPlayer=heroId();scope='hero';}
    if(state && !resetting)state.board.forEach((card,i)=>{if(!boardCorrections.has(i))stagedBoard[i]=window.TheibsCards.fromCanonical(card);});
    paint();if(!mw().busy&&!flushScheduled&&(observations.length||stagedBoard.some(Boolean)))scheduleFlush();
  });
  document.addEventListener('theibs:cards-changed',event=>{if(['voice','manual','paste'].includes(event.detail?.source))clearRank();if(event.detail?.source==='variant'){observations=[];opponentCards.clear();stagedBoard=Array(5).fill(null);selectedPlayer=null;scope='hero';clearRank();}if(!rank)paint();});
  document.addEventListener('theibs:hand-started',event=>{if(!event.detail?.keyboard){generation++;observations=[];opponentCards.clear();stagedBoard=Array(5).fill(null);boardCorrections.clear();selectedPlayer=null;scope='hero';pendingHeroSelection=true;clearRank();}});
  document.addEventListener('theibs:simulation-render',()=>{
    if(app().getState().activeView!=='simulation')return;paint();const state=sim();
    if(!simFlushScheduled&&!state.busy&&!state.restoringSession&&state.observations.some(item=>!item.error&&item.actor===state.session?.state.actor)){simFlushScheduled=true;queue.push(async()=>{try{await window.TheibsSimulationUI.keyboardFlush();}finally{simFlushScheduled=false;}});}
  });
  document.addEventListener('theibs:view-changed',()=>{clearRank();paint();if(app().getState().activeView==='analyze')scheduleFlush();});
  new MutationObserver(paint).observe($('#training-action-buttons'),{childList:true});
  window.theibsKeyboard={dispatch,queue,selectPlayer,cancelPending(){clearRank();paint();},isResetting:()=>resetting,enterCard(card){rank=card[0];assign(card[1]);},getLocale:()=>language,
    getState:()=>({selectedPlayer,context,scope,cursor,rank,ten,observations:observations.map(item=>({...item})),stagedBoard:[...stagedBoard]}),
    snapshot:()=>({version:1,selectedPlayer,context,scope,cursor,observations:observations.map(({generation:_,...item})=>item),opponentCards:[...opponentCards],stagedBoard:[...stagedBoard]}),
    restore(saved,lang){
      if(lang)language=locale(lang);
      if(saved?.version===1){
        selectedPlayer=players().some(p=>p.id===saved.selectedPlayer)?saved.selectedPlayer:heroId();
        scope=saved.scope==='board'&&mw().enabled?'board':selectedPlayer===heroId()?'hero':'opponent';setContext(saved.context==='players'?'players':'cards');cursor=Number.isInteger(saved.cursor)?Math.max(0,Math.min(scope==='board'?4:cards.state.count-1,saved.cursor)):0;
        observations=Array.isArray(saved.observations)?saved.observations.filter(item=>players().some(p=>p.id===item.actor)&&['FOLD','MATCH','AGGRESSIVE'].includes(item.kind)&&['PREFLOP','FLOP','TURN','RIVER'].includes(item.street)&&(item.kind!=='AGGRESSIVE'||Number.isFinite(item.to)&&item.to>0)).map(item=>({...item,generation})):[];
        if(Array.isArray(saved.opponentCards))for(const [id,entries] of saved.opponentCards)if(players().some(p=>p.id===id)&&Array.isArray(entries)&&entries.length===cards.state.count&&entries.every(c=>c===null||/^[AKQJT2-9][ECOP]$/.test(c)))opponentCards.set(id,entries);
        if(Array.isArray(saved.stagedBoard)&&saved.stagedBoard.length===5&&saved.stagedBoard.every(c=>c===null||/^[AKQJT2-9][ECOP]$/.test(c)))stagedBoard=saved.stagedBoard;
      }
      translate();if(observations.length)scheduleFlush();
    }
  };
  translate();
  void app().ready.then(paint);
})();
