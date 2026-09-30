(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
  const ACTIONS = {
    FOLD: { label: 'Fold', past: 'folded' }, CHECK: { label: 'Check', past: 'checked' },
    CALL: { label: 'Call', past: 'called' }, BET: { label: 'Bet', past: 'bet' }, RAISE: { label: 'Raise', past: 'raised' }
  };
  const COMMANDS = [
    { id: 'leave', key: ',', code: 'Comma', resolve: state => state?.legal?.actions?.includes('FOLD') ? 'FOLD' : null },
    { id: 'passive', key: '.', code: 'Period', resolve: state => state?.legal?.actions?.includes('CHECK') ? 'CHECK' : state?.legal?.actions?.includes('CALL') ? 'CALL' : null },
    { id: 'aggressive', key: ';', code: 'Semicolon', resolve: state => state?.legal?.actions?.includes('BET') ? 'BET' : state?.legal?.actions?.includes('RAISE') ? 'RAISE' : null }
  ];
  const POSITIONS = { 2: ['SB', 'BB'], 3: ['SB', 'BB', 'BTN'], 4: ['SB', 'BB', 'CO', 'BTN'],
    5: ['SB', 'BB', 'HJ', 'CO', 'BTN'], 6: ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'],
    7: ['SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO', 'BTN'], 8: ['SB', 'BB', 'UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN'],
    9: ['SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN'], 10: ['SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'UTG3', 'LJ', 'HJ', 'CO', 'BTN'] };
  const STREETS = { PREFLOP: 'Preflop', FLOP: 'Flop', TURN: 'Turn', RIVER: 'River' };
  let options = {}, view = { enabled: false, state: null, config: null, busy: false, error: '' };
  let initialized = false, localBusy = false, setupDirty = false, positionPrompted = false, sizeDraft = null, boardDraft = null, selectedPlayer = null;
  let setupHost, controlsHost, boardDialog, seatDialog;
  const busy = () => localBusy || view.busy;
  const context = () => options.getContext?.() || {};
  const player = id => view.state?.players?.find(item => item.id === id);
  const playerName = item => item?.hero ? 'You' : (item?.name || 'Opponent').replace(/^Adv\./i,'Opp.');
  const actor = () => player(view.state?.actor);
  const inAnalysis = () => document.body.dataset.view === 'analyze' && !$('#analyze-workspace')?.classList.contains('hidden');
  const legal = action => view.enabled && view.heroDraftReady !== false && !busy() && view.state?.phase === 'BETTING' && view.state.legal?.actions?.includes(action);
  const resolveCommand = command => view.enabled && view.heroDraftReady !== false && !busy() && view.state?.phase === 'BETTING' ? command.resolve(view.state) : null;
  const activeToken = () => JSON.stringify([view.state?.revisionKey ?? view.state?.revision, view.state?.actor, view.state?.street, view.state?.phase, view.state?.log?.length, view.state?.pot]);

  function dialog(id, title, body) {
    const node = document.createElement('dialog'); node.id = id; node.className = 'multiway-dialog';
    node.innerHTML = `<div class="multiway-dialog-head"><h2>${title}</h2><button type="button" class="text-button" data-mw-close aria-label="Close">×</button></div>${body}<p class="multiway-error" data-mw-error role="alert" hidden></p>`;
    document.body.append(node); node.querySelector('[data-mw-close]').onclick = () => node.close();
    return node;
  }
  function setError(message = '') {
    view.error = String(message || '');
    if (!initialized) return;
    for (const node of document.querySelectorAll('#multiway-error,[data-mw-error],#multiway-setup-error,#mw-quick-error')) {
      node.textContent = view.error; node.hidden = !view.error;
    }
  }
  function setBusy(value) { view.busy = Boolean(value); if (initialized) refresh(); }
  async function invoke(name, payload) {
    if (busy()) return false;
    if (typeof options.handlers?.[name] !== 'function') { setError('This control is not available yet.'); return false; }
    localBusy = true; setError(''); refresh();
    try { await options.handlers[name](payload); return true; }
    catch (error) { setError(error?.message || 'Could not record the action. Check the data and try again.'); return false; }
    finally { localBusy = false; refresh(); options.onSettled?.(); }
  }
  function currentVariant() { const source = view.config || context(); return source.variant || `PLO${$('#variant-select')?.value || 5}_HIGH`; }
  function fillPositions(preferred) {
    const count = Number($('#mw-player-count').value), values = POSITIONS[count] || POSITIONS[5];
    const previous = preferred || $('#mw-hero-position').value;
    $('#mw-hero-position').innerHTML = values.map(position => `<option value="${position}">${count === 2 && position === 'SB' ? 'BTN / SB' : position}</option>`).join('');
    $('#mw-hero-position').value = values.includes(previous) ? previous : count === 2 && previous === 'BTN' ? 'SB' : values.includes('BTN') ? 'BTN' : values[0];
  }
  function fillSetup(force = false) {
    if (!initialized || setupDirty && !force) return;
    const source = { ...context(), ...(view.config || {}) }, variant = currentVariant();
    const count = Number(variant.match(/PLO([456])/i)?.[1] || 5), max = count === 6 ? 5 : count === 5 ? 6 : 10;
    $('#mw-player-count').innerHTML = Array.from({ length: max - 1 }, (_, index) => `<option value="${index + 2}">${index + 2} players</option>`).join('');
    $('#mw-player-count').value = Math.min(max, Math.max(2, Number(source.playerCount || source.players || (count === 6 ? 5 : 6))));
    fillPositions(source.heroPosition || source.position || 'BTN');
    $('#mw-small-blind').value = source.smallBlind ?? .5; $('#mw-big-blind').value = source.bigBlind ?? 1;
    $('#mw-starting-stack').value = source.startingStack ?? source.effectiveStack ?? 100;
    $('#mw-variant-label').textContent = `PLO${count}`;
    $('#mw-start-note').textContent = positionPrompted
      ? 'Starting a new hand clears the current cards, board and action log.'
      : (source.board?.length || view.state?.board?.length)
      ? 'Starting begins a new preflop hand and clears the table. Your cards are kept.'
      : 'Starts preflop with blinds. Record only the actions you observe.';
    setupDirty = false;
  }
  function getDraft() {
    const source = context();
    return { variant: currentVariant(), playerCount: Number($('#mw-player-count').value), heroPosition: $('#mw-hero-position').value,
      smallBlind: parseAmount($('#mw-small-blind').value), bigBlind: parseAmount($('#mw-big-blind').value), startingStack: parseAmount($('#mw-starting-stack').value),
      ...(positionPrompted ? { heroCards: [] } : Array.isArray(source.heroCards) ? { heroCards: source.heroCards.slice() } : {}) };
  }
  function openSetup() {
    if (!initialized) return;
    fillSetup(); const parent = setupHost.closest('dialog'); if (parent && !parent.open) parent.showModal();
    $('#mw-setup-details').open = true; $('#mw-player-count').focus({ preventScroll: true });
  }
  function refreshControls() {
    controlsHost.hidden = !view.enabled;
    controlsHost.dataset.phase = view.state?.phase || '';
    document.body.dataset.multiway = view.enabled ? 'on' : 'off';
    const state = view.state, current = actor(), isHero = current?.id === state?.heroId;
    const heading = !state ? 'Preparing table' : view.heroDraftReady === false ? 'Complete your cards · Hero'
      : state.phase === 'BETTING' ? `${isHero ? 'Your turn' : playerName(current) + "'s turn"} · ${current?.position || ''}`
      : state.phase === 'WAIT_BOARD' ? `Enter ${STREETS[state.nextStreet] || 'next street'} on the table` : state.phase === 'SHOWDOWN' ? 'Showdown · betting complete' : 'Hand complete';
    document.body.dataset.multiwayPhase = state?.phase || '';
    document.body.dataset.multiwayHeroTurn = String(Boolean(view.enabled && view.heroDraftReady !== false && isHero && state?.phase === 'BETTING'));
    document.body.dataset.multiwayCardsReady = String(view.heroDraftReady !== false);
    $('#mw-actor').classList.toggle('is-board-phase', state?.phase === 'WAIT_BOARD');
    $('#mw-actor').textContent = heading; $('#mw-actor').classList.toggle('is-hero-turn', Boolean(isHero && state?.phase === 'BETTING'));
    $('#mw-round').textContent = state ? view.heroDraftReady === false
      ? `${STREETS[state.street] || state.street} · ${playerName(current)} ${current?.position || ''} acts after your cards`
      : `${STREETS[state.street] || state.street} · ${state.activeOpponentCount ?? state.players.filter(item => !item.hero && !item.folded).length} active opponents` : '';
    $('#mw-to-call').textContent = state?.phase === 'BETTING' ? money(state.legal?.toCall ?? 0) : '—';
    for (const command of COMMANDS) {
      const button = $(`[data-mw-command="${command.id}"]`), actionCode = resolveCommand(command);
      button.disabled = !actionCode; button.dataset.mwAction = actionCode || '';
      const fallback = command.id === 'passive' ? 'Check / Call' : command.id === 'aggressive' ? 'Bet / Raise' : 'Fold';
      button.querySelector('span').textContent = actionCode ? ACTIONS[actionCode].label + (actionCode === 'CALL' ? ' ' + money(state.legal.toCall) : '') : fallback;
      button.title = `${actionCode ? ACTIONS[actionCode].label : fallback} · ${command.key === ',' ? 'COMMA' : command.key === '.' ? 'PERIOD' : 'SEMICOLON'}`;
    }
    const boardPrompt = $('#mw-board-prompt');
    boardPrompt.hidden = state?.phase !== 'WAIT_BOARD';
    boardPrompt.textContent = state?.phase === 'WAIT_BOARD'
      ? `${STREETS[state.nextStreet] || 'Next street'} · select the empty board cards, then enter ${state.nextStreet === 'FLOP' ? 'all 3 flop cards' : 'the turn/river card'} with voice or Cards.` : '';
    $('#mw-undo').disabled = busy() || !state || !(view.canUndo ?? (state.log || []).some(event => !['SB', 'BB'].includes(event.action)));
    $('#mw-setup-status').textContent = view.enabled ? 'On' : 'Off';
    $('#mw-exit').hidden = !view.enabled; $('#mw-exit').disabled = busy();
    $('#mw-start').textContent = view.enabled ? 'Start new hand' : 'Start Multiway'; $('#mw-start').disabled = busy();
    $('#mw-toggle').textContent=view.enabled?'Multiway on · Turn off':'Turn on Multiway';
    $('#mw-toggle').setAttribute('aria-pressed',String(view.enabled));
    $('#mw-toggle').disabled=busy();
    controlsHost.setAttribute('aria-busy', String(busy()));
    const potDetail = $('#table-pot-detail');
    potDetail.hidden = !view.enabled || !state || !state.hasSidePots;
    potDetail.textContent = state?.hasSidePots ? `${state.pots.length - 1} side pot${state.pots.length === 2 ? '' : 's'} · main ${money(state.pots[0]?.amount)}` : '';
    const heroSeat = $('#mw-hero-seat'), hero = state?.players?.find(item => item.hero);
    if (heroSeat) {
      if (view.enabled && hero) heroSeat.dataset.multiwayPlayer = String(hero.id);
      else delete heroSeat.dataset.multiwayPlayer;
      heroSeat.disabled = !view.enabled || busy();
      heroSeat.classList.toggle('mw-actor-seat', Boolean(view.enabled && hero && state.actor === hero.id));
      heroSeat.classList.toggle('mw-folded-seat', Boolean(view.enabled && hero?.folded));
      heroSeat.classList.toggle('mw-allin-seat', Boolean(view.enabled && hero?.allIn));
      heroSeat.setAttribute('aria-label', hero ? `You, ${hero.position}, stack ${money(hero.stack)}, ${money(hero.streetPaid)} committed this street. View seat.` : 'Your seat');
    }
    const heroPaid = $('#hero-street-paid');
    if (heroPaid) { heroPaid.hidden = !view.enabled || !hero; heroPaid.textContent = hero ? `In ${money(hero.streetPaid)} this street` : ''; }
    const logs = (state?.log || []).slice(-6);
    $('#mw-history-list').innerHTML = logs.map(event => {
      const name = Number.isInteger(event.actor) ? `${playerName(player(event.actor))} · ${player(event.actor)?.position || ''}` : STREETS[event.street] || '';
      const action = ACTIONS[event.action]?.past || ({ SB: 'small blind', BB: 'big blind', BOARD: 'board dealt', MARK_FOLD: 'observed fold', RETURN: 'returned', SHOWDOWN: 'showdown' })[event.action] || event.action;
      return `<li><span>${esc(name)}</span><span>${esc(action)}${Number.isFinite(event.amount) && event.amount > 0 ? ' ' + money(event.amount) : ''}</span></li>`;
    }).join('');
    $('#mw-history').hidden = !logs.length;
    for (const node of document.querySelectorAll('[data-multiway-player]')) {
      const item = player(Number(node.dataset.multiwayPlayer)); if (!item) continue;
      node.classList.toggle('mw-actor-seat', view.enabled && state.actor === item.id);
      node.classList.toggle('mw-folded-seat', view.enabled && item.folded);
      node.classList.toggle('mw-allin-seat', view.enabled && (item.allIn || item.stack === 0));
      node.classList.toggle('mw-checked-seat', view.enabled && !item.folded && !item.allIn && item.lastAction === 'CHECK');
      if (view.enabled) node.setAttribute('aria-label', `${playerName(item)}, ${item.position}, stack ${money(item.stack)}, ${money(item.streetPaid)} committed this street, ${item.folded ? 'folded' : item.allIn || item.stack === 0 ? 'all-in' : state.actor === item.id ? 'to act' : item.lastAction === 'CHECK' ? 'checked' : 'in hand'}. View seat.`);
    }
    $('#mw-size-confirm').disabled = busy();
    if (boardDialog.open) $('#mw-board-confirm').disabled = busy();
    if (seatDialog.open) refreshSeat();
  }
  function refresh() { if (!initialized) return; refreshControls(); setError(view.error); }
  function render(next = {}) {
    view = { ...view, ...next };
    if (!initialized) return;
    if (!view.enabled) { cancelPendingAmount(); for (const node of [boardDialog, seatDialog]) if (node.open) node.close(); }
    if (sizeDraft && sizeDraft.token !== activeToken()) cancelPendingAmount();
    if (boardDialog.open && boardDraft?.token !== activeToken()) boardDialog.close();
    if (!$('#mw-setup-details').open) fillSetup();
    refresh();
  }
  const parseAmount = raw => /^\d+(?:[.,]\d{1,2})?$/.test(String(raw).trim()) ? Number(String(raw).trim().replace(',', '.')) : null;
  function sizeHelp() {
    if (!sizeDraft) return;
    const raw = $('#mw-size').value.trim(), value = parseAmount(raw), paid = view.state?.legal?.totalThisStreet ?? actor()?.streetPaid ?? 0;
    const cost = value - paid;
    $('#mw-size-cost').textContent = value !== null && cost >= 0
      ? `${playerName(actor())} adds ${money(cost)} ${cost === 1 ? 'chip' : 'chips'} now. Total this street: ${money(value)}.`
      : 'Enter the total committed this street.';
  }
  function cancelPendingAmount() {
    if (!initialized) return false;
    const hadDraft = Boolean(sizeDraft);
    sizeDraft = null;
    $('#mw-inline-size').hidden = true;
    $('#mw-actions').hidden = false;
    controlsHost.classList.remove('mw-sizing');
    $('#mw-size').value = '';
    $('#mw-size-limits').textContent = 'Bet/Raise uses the total committed this street.';
    $('#mw-size-cost').textContent = '';
    return hadDraft;
  }
  function openPendingAmount({ action: actionCode, expectedToken } = {}) {
    if (!inAnalysis() || expectedToken && voiceContext().token !== expectedToken) return false;
    actionCode ||= resolveCommand(COMMANDS.find(item => item.id === 'aggressive'));
    if (!['BET', 'RAISE'].includes(actionCode) || !legal(actionCode)) return false;
    const state = view.state, current = actor();
    if (!current || !Number.isFinite(state.legal.minTo) || !Number.isFinite(state.legal.maxTo)) return false;
    sizeDraft = { action: actionCode, actor: state.actor, token: activeToken() };
    $('#mw-size-label').textContent = `${ACTIONS[actionCode].label} to total`;
    $('#mw-size').value = String(state.legal.minTo);
    $('#mw-size-limits').textContent = `This street · min ${money(state.legal.minTo)} · max ${money(state.legal.maxTo)}`;
    const allInTo = Math.round((current.streetPaid + current.stack) * 100) / 100;
    const potButton = $('#mw-pot-size'), allInButton = $('#mw-allin-size');
    potButton.hidden = !(state.legal.maxTo >= state.legal.minTo && state.legal.maxTo < allInTo - 0.001);
    allInButton.hidden = !(allInTo >= state.legal.minTo - 0.001 && allInTo <= state.legal.maxTo + 0.001);
    $('#mw-actions').hidden = true;
    $('#mw-inline-size').hidden = false;
    controlsHost.classList.add('mw-sizing');
    sizeHelp(); setError('');
    $('#mw-size').focus({ preventScroll: true });
    $('#mw-size').select();
    return { pending: true, action: actionCode };
  }
  async function submitPendingAmount({ to, expectedToken } = {}) {
    if (!sizeDraft || busy() || !inAnalysis() || sizeDraft.token !== activeToken() || expectedToken && voiceContext().token !== expectedToken) {
      setError('The turn changed. Choose the action again.'); cancelPendingAmount(); return false;
    }
    if (to !== undefined) $('#mw-size').value = String(to);
    const input = $('#mw-size'), amount = parseAmount(input.value);
    if (amount === null) {
      setError('Enter a legal total with at most two decimal places.'); input.focus(); return false;
    }
    if (amount < view.state.legal.minTo - 1e-9 || amount > view.state.legal.maxTo + 1e-9) {
      setError(`Use a total between ${money(view.state.legal.minTo)} and ${money(view.state.legal.maxTo)} chips this street.`);
      input.focus(); return false;
    }
    const draft = sizeDraft;
    const confirmed = await invoke('act', { actor: draft.actor, action: draft.action, to: amount });
    if (confirmed) cancelPendingAmount();
    return confirmed;
  }
  async function action(actionCode) {
    if (!inAnalysis() || !legal(actionCode)) return;
    window.theibsCardKeyboard?.cancelPending?.();
    const activeButton = document.querySelector(`[data-mw-action="${actionCode}"]`);
    if (activeButton) {
      activeButton.classList.add('is-key-active');
      setTimeout(() => activeButton.classList.remove('is-key-active'), 90);
    }
    if (actionCode === 'BET' || actionCode === 'RAISE') {
      return openPendingAmount({ action: actionCode });
    }
    return invoke('act', { actor: view.state.actor, action: actionCode });
  }
  function openBoard() {
    if (!view.enabled || busy() || view.state?.phase !== 'WAIT_BOARD') return;
    const state = view.state; boardDraft = { token: activeToken(), previous: [...state.board], nextStreet: state.nextStreet };
    const needed = state.nextStreet === 'FLOP' ? 3 : 1;
    $('#mw-board-title').textContent = `Enter ${STREETS[state.nextStreet]}`;
    $('#mw-board-label').textContent = needed === 3 ? 'Three flop cards' : 'New card';
    $('#mw-board-new').value = ''; $('#mw-board-new').placeholder = needed === 3 ? '2E 3C 4O' : '10P';
    $('#mw-board-existing').textContent = state.board.length ? 'Already on the board: ' + state.board.map(window.TheibsCards.fromCanonical).join(' ') : 'The betting round is complete.';
    setError(''); $('#mw-board-confirm').disabled = false; boardDialog.showModal(); $('#mw-board-new').focus();
  }
  function refreshSeat() {
    const item = player(selectedPlayer); if (!item) { seatDialog.close(); return; }
    $('#mw-seat-title').textContent = `${playerName(item)} · ${item.position}`;
    $('#mw-seat-info').textContent = `${item.folded ? 'Folded' : item.allIn || item.stack === 0 ? 'All-in' : 'In hand'} · stack ${money(item.stack)} · committed ${money(item.streetPaid)} this street`;
    const turnFold = item.id === view.state.actor && view.state.legal?.actions?.includes('FOLD');
    $('#mw-seat-fold').disabled = busy() || !(turnFold || !item.hero && item.canMarkFold);
    $('#mw-seat-fold').textContent = turnFold ? "Record fold · it is this player's turn" : 'Record observed fold';
    $('#mw-seat-note').textContent = item.hero ? 'Your poker position is set for this hand. Use Multiway settings when starting a new hand to change it.'
      : item.folded ? 'Fold recorded. Undo reverses events in order; a recent fold can be undone here.' : item.allIn || item.stack === 0 ? 'An all-in player remains eligible for the pot.' : item.markFoldReason === 'UNMATCHED_CONTRIBUTION' ? 'Record responses to the largest bet first.' : !turnFold && !item.canMarkFold ? "Wait for this player's turn to record another action." : 'Use this only for a fold you observed.';
    const latest=window.theibsApp?.getState().multiway?.events?.at(-1);
    const undoFold=item.folded&&latest?.actor===item.id&&(latest.type==='MARK_FOLD'||latest.type==='ACT'&&latest.action==='FOLD');
    $('#mw-seat-undo').hidden=!undoFold;
    $('#mw-seat-undo').disabled=busy()||!undoFold;
    $('#mw-seat-edit-details').hidden = Boolean(item.hero);
    $('#mw-seat-editor').disabled=busy()||item.folded||item.hero;
    $('#mw-seat-remove').disabled=busy()||item.folded||item.hero||!window.theibsOpponentInputs?.seatEditor(item.id).hasOverride;
    $('#mw-seat-edit-note').textContent=item.folded?'Undo the latest fold to edit this player.':'Optional hand/range and call probability for this seat only.';
  }
  function placeSeatDialog(anchor) {
    if(!anchor)return;
    const rect=anchor.getBoundingClientRect(),width=seatDialog.offsetWidth,height=seatDialog.offsetHeight;
    const left=Math.max(8,Math.min(window.innerWidth-width-8,rect.left+rect.width/2-width/2));
    const top=rect.bottom+10+height<=window.innerHeight-8?rect.bottom+10:Math.max(8,rect.top-height-10);
    seatDialog.style.left=`${left}px`;seatDialog.style.top=`${top}px`;
  }
  function openPlayer(id, anchor = null) {
    if (!view.enabled || !inAnalysis() || busy() || !player(Number(id)) || [...document.querySelectorAll('dialog[open]')].some(node=>node!==seatDialog)) return;
    if(seatDialog.open)seatDialog.close();
    selectedPlayer = Number(id); setError('');
    const editor=player(selectedPlayer).hero ? null : window.theibsOpponentInputs?.seatEditor(selectedPlayer);
    $('#mw-seat-hand').value=editor?.hand||'';
    $('#mw-seat-range').value=editor?.rangeText||'';
    $('#mw-seat-rate').value=editor?.rateText||'';
    $('#mw-seat-edit-error').hidden=true;
    refreshSeat();seatDialog.show();
    placeSeatDialog(anchor||document.querySelector(`[data-multiway-player="${id}"]`));
    const focusTarget=player(selectedPlayer).folded?seatDialog.querySelector('[data-mw-close]'):$('#mw-seat-fold');
    focusTarget.focus({preventScroll:true});
  }
  function keydown(event) {
    if (!view.enabled || !inAnalysis() || busy() || event.defaultPrevented || event.repeat || event.isComposing || document.querySelector('dialog[open]')) return;
    const editing = event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    if (sizeDraft && event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault(); event.stopPropagation(); cancelPendingAmount(); return;
    }
    if (sizeDraft && !editing && !event.ctrlKey && !event.altKey && !event.metaKey && /^[0-9.,]$/.test(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const input = $('#mw-size'); input.focus({ preventScroll: true });
      input.value = (input.value || '') + (event.key === ',' ? '.' : event.key); sizeHelp(); return;
    }
    if (sizeDraft || editing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const command = COMMANDS.find(item => (item.code && item.code === event.code) || (item.key && item.key === event.key.toLowerCase())), actionCode = command && resolveCommand(command);
    if (actionCode) { event.preventDefault(); void action(actionCode); return; }
    const seat = event.target.closest?.('[data-multiway-player]');
    if (seat && seat.tagName !== 'BUTTON' && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openPlayer(Number(seat.dataset.multiwayPlayer)); }
  }
  function init(settings = {}) {
    options = settings;
    if (initialized) { fillSetup(); refresh(); return window.theibsMultiwayUI; }
    setupHost = $(settings.setupSelector || '#multiway-setup'); controlsHost = $(settings.controlsSelector || '#multiway-controls');
    if (!setupHost || !controlsHost) throw Error('Multiway containers are missing.');
    setupHost.innerHTML = `<div class="mw-quick-setup"><label>Players, including you<select id="mw-player-count"></select></label><button id="mw-toggle" type="button" class="ghost-button" aria-pressed="false">Turn on Multiway</button></div><p id="mw-quick-error" class="multiway-error" role="alert" hidden></p><details id="mw-setup-details"><summary><span>Multiway settings <small id="mw-variant-label"></small></span><span id="mw-setup-status" class="mw-chip">Off</span></summary><div class="mw-setup-fields"><div class="mw-config-grid"><label>Your position<select id="mw-hero-position" required></select></label><label>Small blind<input id="mw-small-blind" type="text" inputmode="decimal" autocomplete="off" required></label><label>Big blind<input id="mw-big-blind" type="text" inputmode="decimal" autocomplete="off" required></label><label>Starting stack per player<input id="mw-starting-stack" type="text" inputmode="decimal" autocomplete="off" required></label></div><p id="mw-position-prompt" class="mw-position-prompt" hidden role="status">New hand · choose your seat so the action order matches the table.</p><p id="mw-start-note"></p><div class="mw-setup-actions"><button id="mw-start" type="button" class="primary-button">Start Multiway</button><button id="mw-exit" type="button" class="text-button" hidden>Return to simple mode</button></div><p id="multiway-setup-error" class="multiway-error" role="alert" hidden></p></div></details>`;
    controlsHost.classList.add('multiway-controls'); controlsHost.hidden = true;
    controlsHost.innerHTML = `<div class="mw-control-heading"><div class="mw-turn-context"><strong id="mw-actor"></strong><span id="mw-round"></span></div><span class="mw-call-amount">To call <b id="mw-to-call">—</b></span><button id="mw-undo" type="button" class="text-button" title="Undo the last confirmed event · Ctrl+Z">↶ Undo</button></div><div class="mw-action-stage"><div id="mw-actions" class="mw-action-row">${COMMANDS.map(item => `<button type="button" data-mw-command="${item.id}" data-mw-action="" disabled title="${item.key === ',' ? 'COMMA' : item.key === '.' ? 'PERIOD' : 'SEMICOLON'}"><kbd>${item.key}</kbd><span>${item.id === 'passive' ? 'Check / Call' : item.id === 'aggressive' ? 'Bet / Raise' : 'Fold'}</span></button>`).join('')}</div><div id="mw-inline-size" class="mw-inline-size" hidden><label for="mw-size" id="mw-size-label">Total this street</label><input id="mw-size" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" required><button id="mw-pot-size" type="button" class="ghost-button">Pot</button><button id="mw-allin-size" type="button" class="ghost-button">All-in</button><button id="mw-size-confirm" type="button" class="primary-button">Confirm</button><button id="mw-size-cancel" type="button" class="text-button" aria-label="Cancel amount entry">×</button></div></div><p class="mw-action-hint" id="mw-size-limits">Bet/Raise uses the total committed this street.</p><p class="mw-action-hint" id="mw-size-cost" role="status" aria-live="polite"></p><p id="mw-board-prompt" class="mw-board-prompt" role="status" aria-live="polite" hidden></p><p id="multiway-error" class="multiway-error" role="alert" hidden></p><details id="mw-history"><summary>Recent actions</summary><ol id="mw-history-list"></ol></details>`;
    boardDialog = dialog('multiway-board-dialog', '<span id="mw-board-title">Next street</span>', '<form id="mw-board-form"><p id="mw-board-existing"></p><label><span id="mw-board-label">New cards</span><input id="mw-board-new" autocomplete="off" spellcheck="false" required></label><p class="mw-card-legend">Rank + suit: ♠ E · ♥ C · ♦ O · ♣ P. Ten = D, T or 10.</p><button id="mw-board-confirm" type="submit" class="primary-button">Deal street · Enter</button></form>');
    seatDialog = dialog('multiway-seat-dialog', '<span id="mw-seat-title">Player</span>', '<p id="mw-seat-info"></p><div class="seat-popover-actions"><button id="mw-seat-fold" type="button" class="ghost-button">Record fold</button><button id="mw-seat-undo" type="button" class="text-button" hidden>Undo latest fold</button></div><p id="mw-seat-note"></p><details id="mw-seat-edit-details"><summary>Opponent assumptions</summary><p id="mw-seat-edit-note" class="micro"></p><fieldset id="mw-seat-editor"><label>Known hand<input id="mw-seat-hand" autocomplete="off" placeholder="AE KC QO JP TE"></label><label>Range<textarea id="mw-seat-range" rows="2" placeholder="One hand per line"></textarea></label><label>Call chance (%)<input id="mw-seat-rate" type="number" min="0" max="100" step="0.1" placeholder="Unknown"></label><div class="seat-popover-actions"><button id="mw-seat-apply" type="button" class="primary-button">Apply to seat</button><button id="mw-seat-remove" type="button" class="text-button">Remove assumption</button></div></fieldset><p id="mw-seat-edit-error" class="multiway-error" role="alert" hidden></p></details>');
    seatDialog.classList.add('seat-popover');
    seatDialog.setAttribute('aria-labelledby','mw-seat-title');
    initialized = true; fillSetup(true);
    setupHost.addEventListener('input', () => { setupDirty = true; });
    $('#mw-player-count').addEventListener('change', () => { setupDirty = true; fillPositions(); });
    $('#mw-hero-position').addEventListener('change', () => { setupDirty = true; $('#mw-position-prompt').hidden = Boolean($('#mw-hero-position').value); });
    $('#mw-setup-details>summary').addEventListener('click', () => { if (!$('#mw-setup-details').open) fillSetup(); });
    $('#mw-setup-details').addEventListener('toggle', () => { if ($('#mw-setup-details').open) fillSetup(); });
    $('#mw-start').onclick = async () => {
      for (const input of setupHost.querySelectorAll('input,select')) if (!input.reportValidity()) return;
      const draft = getDraft();
      if (![draft.smallBlind,draft.bigBlind,draft.startingStack].every(value => value !== null && value > 0)) { setError('Enter positive chip amounts with at most two decimal places.'); return; }
      if (draft.smallBlind >= draft.bigBlind) { setError('The small blind must be lower than the big blind.'); return; }
      if (await invoke('start', draft)) { setupDirty = false; positionPrompted = false; $('#mw-position-prompt').hidden = true; $('#mw-setup-details').open = false; }
    };
    $('#mw-exit').onclick = () => invoke('exit'); $('#mw-undo').onclick = () => undoAction();
    $('#mw-toggle').onclick=()=>{
      if(busy())return;
      if(!view.enabled){const invalid=[...setupHost.querySelectorAll('input,select')].find(input=>!input.checkValidity());if(invalid){$('#mw-setup-details').open=true;invalid.reportValidity();invalid.focus();return;}}
      if(view.enabled)void invoke('exit');else $('#mw-start').click();
    };
    controlsHost.addEventListener('click', event => { const button = event.target.closest('[data-mw-command]'); if (button && !button.disabled && button.dataset.mwAction) void action(button.dataset.mwAction); });
    $('#mw-size').addEventListener('input', sizeHelp);
    $('#mw-size-confirm').onclick = () => { void submitPendingAmount(); };
    $('#mw-size').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); void submitPendingAmount(); } });
    $('#mw-size-cancel').onclick = () => { cancelPendingAmount(); $('#mw-actions [data-mw-command=aggressive]').focus({ preventScroll: true }); };
    $('#mw-pot-size').onclick = () => { $('#mw-size').value = String(view.state.legal.maxTo); sizeHelp(); $('#mw-size').focus({ preventScroll: true }); };
    $('#mw-allin-size').onclick = () => { const current = actor(); $('#mw-size').value = String(Math.round((current.streetPaid + current.stack) * 100) / 100); sizeHelp(); $('#mw-size').focus({ preventScroll: true }); };
    $('#mw-board-form').onsubmit = async event => {
      event.preventDefault(); if (!boardDraft || boardDraft.token !== activeToken()) { setError('The street changed. Check the table again.'); return; }
      try {
        const added = window.TheibsCards.parsePortugueseCards($('#mw-board-new').value).map(window.TheibsCards.toCanonical);
        if (added.length !== (boardDraft.nextStreet === 'FLOP' ? 3 : 1)) throw Error(boardDraft.nextStreet === 'FLOP' ? 'Enter exactly three flop cards.' : 'Enter only the new card.');
        const source = context(), visibleHero = source.variant === view.config?.variant && Array.isArray(source.heroCards) ? source.heroCards : view.config?.heroCards || [];
        const cards = [...boardDraft.previous, ...added], known = [...visibleHero, ...cards];
        if (new Set(known).size !== known.length) throw Error('That card is already in the hand or on the board.');
        if (await invoke('board', { cards })) boardDialog.close();
      } catch (error) { setError(error.message); }
    };
    $('#mw-seat-fold').onclick = async () => {
      const item = player(selectedPlayer); if (!item || busy()) return;
      const isTurn = item.id === view.state.actor && view.state.legal?.actions?.includes('FOLD');
      if (!isTurn && (item.hero || !item.canMarkFold)) return;
      if (await invoke(isTurn ? 'act' : 'markFold', { actor: item.id, ...(isTurn ? { action: 'FOLD' } : {}) })) seatDialog.close();
    };
    $('#mw-seat-undo').onclick=async()=>{const item=player(selectedPlayer),latest=window.theibsApp?.getState().multiway?.events?.at(-1);if(item?.folded&&latest?.actor===item.id&&(latest.type==='MARK_FOLD'||latest.type==='ACT'&&latest.action==='FOLD')&&await invoke('undo'))seatDialog.close();};
    $('#mw-seat-apply').onclick=()=>{
      try{window.theibsOpponentInputs.applySeat(selectedPlayer,{hand:$('#mw-seat-hand').value,rangeText:$('#mw-seat-range').value,rateText:$('#mw-seat-rate').value});$('#mw-seat-edit-error').hidden=true;refreshSeat();}
      catch(error){$('#mw-seat-edit-error').textContent=error.message;$('#mw-seat-edit-error').hidden=false;}
    };
    $('#mw-seat-remove').onclick=()=>{window.theibsOpponentInputs.removeSeat(selectedPlayer);$('#mw-seat-hand').value='';$('#mw-seat-range').value='';$('#mw-seat-rate').value='';refreshSeat();};
    document.addEventListener('click', event => { const seat = event.target.closest?.('[data-multiway-player]'); if (seat) openPlayer(Number(seat.dataset.multiwayPlayer),seat); });
    document.addEventListener('pointerdown',event=>{if(seatDialog.open&&!seatDialog.contains(event.target)&&!event.target.closest?.('[data-multiway-player]'))seatDialog.close();});
    document.addEventListener('focusin',event=>{if(seatDialog.open&&!seatDialog.contains(event.target)&&!event.target.closest?.('[data-multiway-player]'))seatDialog.close();});
    window.addEventListener('resize',()=>{if(seatDialog.open)seatDialog.close();});
    document.addEventListener('keydown', keydown, true);
    refresh(); return window.theibsMultiwayUI;
  }
  function voiceContext() {
    const source = context(), state = view.state;
    const needed = Number(currentVariant().match(/PLO([456])/i)?.[1] || 5);
    const pendingAmount = sizeDraft ? { action: sizeDraft.action, actor: sizeDraft.actor,
      minTo: state?.legal?.minTo, maxTo: state?.legal?.maxTo, totalThisStreet: state?.legal?.totalThisStreet } : null;
    const destination = state?.phase === 'WAIT_BOARD' || state?.cardTarget === 'BOARD' ? 'board'
      : view.heroDraftReady === false || state?.cardTarget === 'HERO' || view.enabled && (source.heroCards?.length || 0) < needed ? 'hero' : null;
    return { token: JSON.stringify([activeToken(), pendingAmount, view.config, source, window.theibsApp?.getVoiceContext?.()]),
      stateToken: activeToken(),
      revision: state?.revision, revisionKey: state?.revisionKey,
      enabled: view.enabled, busy: busy(), heroDraftReady: view.heroDraftReady !== false, phase: view.state?.phase, nextStreet: view.state?.nextStreet,
      actor: state?.actor, nextActor: state?.nextPlayerId ?? state?.actor, destination, pendingAmount,
      board: [...(view.state?.board || [])],
      actionState: view.state ? { phase:view.state.phase, actor:view.state.actor, heroId:view.state.heroId,
        currentBet:view.state.currentBet, bigBlind:view.state.bigBlind,
        legal:{...view.state.legal,actions:[...(view.state.legal?.actions||[])]},
        players:view.state.players.map(item=>({id:item.id,hero:item.hero,name:item.name,seatName:item.seatName,position:item.position,folded:item.folded,allIn:item.allIn,streetPaid:item.streetPaid,stack:item.stack})) } : null };
  }
  async function commitVoiceBoard({ addedCards, expectedToken }) {
    const current = voiceContext();
    if (!inAnalysis() || !current.enabled || current.busy || current.phase !== 'WAIT_BOARD' || current.token !== expectedToken) return false;
    if (!Array.isArray(addedCards) || addedCards.length !== (current.nextStreet === 'FLOP' ? 3 : 1) ||
        addedCards.some(card => typeof card !== 'string' || !/^[2-9TJQKA][shdc]$/.test(card))) return false;
    const source = context(), hero = source.heroCards || view.config?.heroCards || [];
    const cards = [...current.board, ...addedCards], known = [...hero, ...cards];
    if (new Set(known).size !== known.length) return false;
    return invoke('board', { cards });
  }
  async function commitKeyboardBoard({ addedCards, expectedStateToken }) {
    const current = voiceContext();
    if (!current.enabled || current.busy || current.phase !== 'WAIT_BOARD' || current.stateToken !== expectedStateToken) return false;
    return commitVoiceBoard({ addedCards, expectedToken: current.token });
  }
  async function undoVoiceBoard({ expectedToken }) {
    const current = voiceContext(), events = window.theibsApp?.getState().multiway?.events;
    if (!inAnalysis() || !current.enabled || current.busy || current.token !== expectedToken || events?.at(-1)?.type !== 'BOARD') return false;
    return invoke('undo');
  }
  async function commitVoiceAction({ command, action: actionCode, to, expectedToken }) {
    const current=voiceContext();
    if(!inAnalysis()||!current.enabled||!current.heroDraftReady||current.busy||current.token!==expectedToken)return false;
    try {
      const requested = command || {type:'action',actor:null,action:actionCode,...(to===undefined?{}:{to})};
      if (['BET', 'RAISE'].includes(requested.action) && requested.to === undefined && requested.by === undefined) {
        // Resolve a legal sample total before opening the draft, so an
        // explicit out-of-turn A1/A2 command cannot focus another seat.
        window.TheibsCardVoice.resolveAction({...requested,to:current.actionState.legal.minTo},current.actionState);
        return openPendingAmount({action:requested.action,expectedToken});
      }
      return await invoke('act',window.TheibsCardVoice.resolveAction(requested,current.actionState));
    }
    catch(error){setError(error.message);return false;}
  }
  async function undoAction({expectedToken} = {}) {
    const current = voiceContext();
    if (!inAnalysis() || !current.enabled || current.busy || expectedToken && current.token !== expectedToken) return false;
    if (!(view.canUndo ?? (view.state?.log || []).some(event => !['SB', 'BB'].includes(event.action)))) return false;
    cancelPendingAmount();
    return invoke('undo');
  }
  async function undoVoiceAction({ expectedToken }) {
    const current=voiceContext(),events=window.theibsApp?.getState().multiway?.events;
    if(!inAnalysis()||!current.enabled||current.busy||current.token!==expectedToken||events?.at(-1)?.type!=='ACT')return false;
    return invoke('undo');
  }
  function requestHeroPosition() {
    if (!initialized || !view.enabled || busy()) return;
    positionPrompted = true;
    fillSetup(); const position = $('#mw-hero-position');
    if (!position.querySelector('option[value=""]')) position.insertAdjacentHTML('afterbegin', '<option value="">Choose your seat…</option>');
    position.value = ''; $('#mw-position-prompt').hidden = false; $('#mw-setup-details').open = true;
    const parent = setupHost.closest('dialog'); if (parent && !parent.open) parent.showModal();
    setupDirty = true; position.focus({ preventScroll: true });
  }
  window.theibsMultiwayUI = { init, render, setBusy, setError, openSetup, requestHeroPosition, openPlayer, openBoard, getDraft, voiceContext, commitVoiceBoard, commitKeyboardBoard, undoVoiceBoard, commitVoiceAction, undoVoiceAction, undoAction, cancelPendingAmount, openPendingAmount, submitPendingAmount,
    getState: () => ({ enabled: view.enabled, state: view.state, config: view.config, heroDraftReady: view.heroDraftReady !== false, busy: busy(), error: view.error }) };
})();
