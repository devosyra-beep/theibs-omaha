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
    { id: 'leave', key: 'm', code: 'KeyM', resolve: state => state?.legal?.actions?.includes('CHECK') ? 'CHECK' : state?.legal?.actions?.includes('FOLD') ? 'FOLD' : null },
    { id: 'call', key: ',', code: 'Comma', resolve: state => state?.legal?.actions?.includes('CALL') ? 'CALL' : null },
    { id: 'aggressive', key: ';', code: 'Semicolon', resolve: state => state?.legal?.actions?.includes('BET') ? 'BET' : state?.legal?.actions?.includes('RAISE') ? 'RAISE' : null }
  ];
  const POSITIONS = { 2: ['SB', 'BB'], 3: ['SB', 'BB', 'BTN'], 4: ['SB', 'BB', 'CO', 'BTN'],
    5: ['SB', 'BB', 'HJ', 'CO', 'BTN'], 6: ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'],
    7: ['SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO', 'BTN'], 8: ['SB', 'BB', 'UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN'],
    9: ['SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN'], 10: ['SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'UTG3', 'LJ', 'HJ', 'CO', 'BTN'] };
  const STREETS = { PREFLOP: 'Preflop', FLOP: 'Flop', TURN: 'Turn', RIVER: 'River' };
  let options = {}, view = { enabled: false, state: null, config: null, busy: false, error: '' };
  let initialized = false, localBusy = false, setupDirty = false, sizeDraft = null, boardDraft = null, selectedPlayer = null;
  let setupHost, controlsHost, sizeDialog, boardDialog, seatDialog;
  const busy = () => localBusy || view.busy;
  const context = () => options.getContext?.() || {};
  const player = id => view.state?.players?.find(item => item.id === id);
  const playerName = item => item?.hero ? 'You' : item?.name || 'Opponent';
  const actor = () => player(view.state?.actor);
  const inAnalysis = () => document.body.dataset.view === 'analyze' && !$('#analyze-workspace')?.classList.contains('hidden');
  const legal = action => view.enabled && !busy() && view.state?.phase === 'BETTING' && view.state.legal?.actions?.includes(action);
  const resolveCommand = command => view.enabled && !busy() && view.state?.phase === 'BETTING' ? command.resolve(view.state) : null;
  const activeToken = () => JSON.stringify([view.state?.actor, view.state?.street, view.state?.phase, view.state?.log?.length, view.state?.pot]);

  function dialog(id, title, body) {
    const node = document.createElement('dialog'); node.id = id; node.className = 'multiway-dialog';
    node.innerHTML = `<div class="multiway-dialog-head"><h2>${title}</h2><button type="button" class="text-button" data-mw-close aria-label="Close">×</button></div>${body}<p class="multiway-error" data-mw-error role="alert" hidden></p>`;
    document.body.append(node); node.querySelector('[data-mw-close]').onclick = () => node.close();
    return node;
  }
  function setError(message = '') {
    view.error = String(message || '');
    if (!initialized) return;
    for (const node of document.querySelectorAll('#multiway-error,[data-mw-error],#multiway-setup-error')) {
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
    $('#mw-start-note').textContent = (source.board?.length || view.state?.board?.length)
      ? 'Starting begins a new preflop hand and clears the table. Your cards are kept.'
      : 'Starts preflop with blinds. Record only the actions you observe.';
    setupDirty = false;
  }
  function getDraft() {
    const source = context();
    return { variant: currentVariant(), playerCount: Number($('#mw-player-count').value), heroPosition: $('#mw-hero-position').value,
      smallBlind: Number($('#mw-small-blind').value), bigBlind: Number($('#mw-big-blind').value), startingStack: Number($('#mw-starting-stack').value),
      ...(Array.isArray(source.heroCards) ? { heroCards: source.heroCards.slice() } : {}) };
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
    const heading = !state ? 'Preparing table' : state.phase === 'BETTING' ? `${isHero ? 'Your turn' : playerName(current) + "'s turn"} · ${current?.position || ''}`
      : state.phase === 'WAIT_BOARD' ? `Enter ${STREETS[state.nextStreet] || 'next street'} on the table` : state.phase === 'SHOWDOWN' ? 'Showdown · betting complete' : 'Hand complete';
    document.body.dataset.multiwayPhase = state?.phase || '';
    $('#mw-actor').textContent = heading; $('#mw-actor').classList.toggle('is-hero-turn', Boolean(isHero && state?.phase === 'BETTING'));
    $('#mw-round').textContent = state ? `${STREETS[state.street] || state.street} · ${state.activeOpponentCount ?? state.players.filter(item => !item.hero && !item.folded).length} active opponents` : '';
    for (const command of COMMANDS) {
      const button = $(`[data-mw-command="${command.id}"]`), actionCode = resolveCommand(command);
      button.disabled = !actionCode; button.dataset.mwAction = actionCode || '';
      const fallback = command.id === 'call' ? 'Call' : command.id === 'aggressive' ? 'Raise' : 'Fold';
      button.querySelector('span').textContent = actionCode ? ACTIONS[actionCode].label + (actionCode === 'CALL' ? ' ' + money(state.legal.toCall) : '') : fallback;
      button.title = `${actionCode ? ACTIONS[actionCode].label : fallback} · ${command.key.toUpperCase()}`;
    }
    const boardPrompt = $('#mw-board-prompt');
    boardPrompt.hidden = state?.phase !== 'WAIT_BOARD';
    boardPrompt.textContent = state?.phase === 'WAIT_BOARD'
      ? `Choose the next empty board card above. Enter all ${state.nextStreet === 'FLOP' ? '3 flop cards' : '1 card'} with the card keyboard or voice.` : '';
    $('#mw-undo').disabled = busy() || !state || !(view.canUndo ?? (state.log || []).some(event => !['SB', 'BB'].includes(event.action)));
    $('#mw-setup-status').textContent = view.enabled ? 'On' : 'Off';
    $('#mw-exit').hidden = !view.enabled; $('#mw-exit').disabled = busy();
    $('#mw-start').textContent = view.enabled ? 'Start new hand' : 'Start Multiway'; $('#mw-start').disabled = busy();
    controlsHost.setAttribute('aria-busy', String(busy()));
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
      if (view.enabled) { node.setAttribute('role', 'button'); node.tabIndex = 0; node.setAttribute('aria-label', `${playerName(item)}, ${item.position}, ${item.folded ? 'folded' : item.allIn || item.stack === 0 ? 'all-in' : 'stack ' + money(item.stack)}. View player.`); }
    }
    if (sizeDialog.open) $('#mw-size-confirm').disabled = busy();
    if (boardDialog.open) $('#mw-board-confirm').disabled = busy();
    if (seatDialog.open) refreshSeat();
  }
  function refresh() { if (!initialized) return; refreshControls(); setError(view.error); }
  function render(next = {}) {
    view = { ...view, ...next };
    if (!initialized) return;
    if (!view.enabled) for (const node of [sizeDialog, boardDialog, seatDialog]) if (node.open) node.close();
    if (sizeDialog.open && sizeDraft?.token !== activeToken()) sizeDialog.close();
    if (boardDialog.open && boardDraft?.token !== activeToken()) boardDialog.close();
    if (!$('#mw-setup-details').open) fillSetup();
    refresh();
  }
  function sizeHelp() {
    const value = Number($('#mw-size').value), paid = view.state?.legal?.totalThisStreet ?? actor()?.streetPaid ?? 0;
    const cost = value - paid;
    $('#mw-size-cost').textContent = Number.isFinite(value) && cost >= 0 ? `${playerName(actor())} adds ${money(cost)} ${cost === 1 ? 'chip' : 'chips'} now.` : 'Enter the total committed this street.';
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
      const state = view.state; sizeDraft = { action: actionCode, actor: state.actor, token: activeToken() };
      $('#mw-size-title').textContent = `${ACTIONS[actionCode].label} · ${playerName(actor())} ${actor().position}`;
      $('#mw-size').min = state.legal.minTo; $('#mw-size').max = state.legal.maxTo; $('#mw-size').value = state.legal.minTo;
      $('#mw-size-limits').textContent = `Minimum ${money(state.legal.minTo)} · maximum ${money(state.legal.maxTo)}`;
      setError(''); sizeHelp(); $('#mw-size-confirm').disabled = false; sizeDialog.showModal(); $('#mw-size').focus(); $('#mw-size').select(); return;
    }
    await invoke('act', { actor: view.state.actor, action: actionCode });
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
    $('#mw-seat-fold').disabled = busy() || !(turnFold || item.canMarkFold);
    $('#mw-seat-fold').textContent = turnFold ? "Record fold · it is this player's turn" : 'Record observed fold';
    $('#mw-seat-note').textContent = item.folded ? 'The fold is already recorded.' : item.allIn || item.stack === 0 ? 'An all-in player remains eligible for the pot.' : item.markFoldReason === 'UNMATCHED_CONTRIBUTION' ? 'Record responses to the largest bet first.' : !turnFold && !item.canMarkFold ? "Wait for this player's turn to record another action." : 'Use this only for a fold you observed.';
  }
  function openPlayer(id) {
    if (!view.enabled || !inAnalysis() || busy() || !player(Number(id)) || document.querySelector('dialog[open]')) return;
    selectedPlayer = Number(id); setError(''); refreshSeat(); seatDialog.showModal();
  }
  function keydown(event) {
    if (!view.enabled || !inAnalysis() || busy() || event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || document.querySelector('dialog[open]')) return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    const command = COMMANDS.find(item => item.code === event.code || item.key === event.key.toLowerCase()), actionCode = command && resolveCommand(command);
    if (actionCode) { event.preventDefault(); void action(actionCode); return; }
    const seat = event.target.closest?.('[data-multiway-player]');
    if (seat && seat.tagName !== 'BUTTON' && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openPlayer(Number(seat.dataset.multiwayPlayer)); }
  }
  function init(settings = {}) {
    options = settings;
    if (initialized) { fillSetup(); refresh(); return window.theibsMultiwayUI; }
    setupHost = $(settings.setupSelector || '#multiway-setup'); controlsHost = $(settings.controlsSelector || '#multiway-controls');
    if (!setupHost || !controlsHost) throw Error('Multiway containers are missing.');
    setupHost.innerHTML = `<details id="mw-setup-details"><summary><span>Multiway <small id="mw-variant-label"></small></span><span id="mw-setup-status" class="mw-chip">Off</span></summary><div class="mw-setup-fields"><div class="mw-config-grid"><label>Players, including you<select id="mw-player-count"></select></label><label>Your position<select id="mw-hero-position"></select></label><label>Small blind<input id="mw-small-blind" type="number" min="0.01" step="0.01" required></label><label>Big blind<input id="mw-big-blind" type="number" min="0.01" step="0.01" required></label><label>Starting stack per player<input id="mw-starting-stack" type="number" min="0.01" step="0.01" required></label></div><p id="mw-start-note"></p><div class="mw-setup-actions"><button id="mw-start" type="button" class="primary-button">Start Multiway</button><button id="mw-exit" type="button" class="text-button" hidden>Return to simple mode</button></div><p id="multiway-setup-error" class="multiway-error" role="alert" hidden></p></div></details>`;
    controlsHost.classList.add('multiway-controls'); controlsHost.hidden = true;
    controlsHost.innerHTML = `<div class="mw-control-heading"><strong id="mw-actor"></strong><span id="mw-round"></span><button id="mw-undo" type="button" class="text-button" title="Undo the last observed action">↶ Undo</button></div><div class="mw-action-row">${COMMANDS.map(item => `<button type="button" data-mw-command="${item.id}" data-mw-action="" disabled title="${item.key.toUpperCase()}"><kbd>${item.key.toUpperCase()}</kbd><span>${item.id === 'call' ? 'Call' : item.id === 'aggressive' ? 'Raise' : 'Fold'}</span></button>`).join('')}</div><p id="mw-board-prompt" class="mw-board-prompt" role="status" aria-live="polite" hidden></p><p id="multiway-error" class="multiway-error" role="alert" hidden></p><details id="mw-history"><summary>Recent actions</summary><ol id="mw-history-list"></ol></details>`;
    setupHost.querySelector('.mw-setup-fields').append(controlsHost.querySelector('.mw-control-heading'), controlsHost.querySelector('#mw-history'));
    sizeDialog = dialog('multiway-size-dialog', '<span id="mw-size-title">Bet amount</span>', '<form id="mw-size-form"><label>Total this street<input id="mw-size" type="number" step="0.01" inputmode="decimal" required></label><p id="mw-size-limits"></p><p id="mw-size-cost"></p><button id="mw-size-confirm" type="submit" class="primary-button">Confirm total · Enter</button></form>');
    boardDialog = dialog('multiway-board-dialog', '<span id="mw-board-title">Next street</span>', '<form id="mw-board-form"><p id="mw-board-existing"></p><label><span id="mw-board-label">New cards</span><input id="mw-board-new" autocomplete="off" spellcheck="false" required></label><p class="mw-card-legend">Rank + suit: ♠ E · ♥ C · ♦ O · ♣ P. Ten = D, T or 10.</p><button id="mw-board-confirm" type="submit" class="primary-button">Deal street · Enter</button></form>');
    seatDialog = dialog('multiway-seat-dialog', '<span id="mw-seat-title">Player</span>', '<p id="mw-seat-info"></p><p id="mw-seat-note"></p><button id="mw-seat-fold" type="button" class="ghost-button">Record fold</button>');
    initialized = true; fillSetup(true);
    setupHost.addEventListener('input', () => { setupDirty = true; });
    $('#mw-player-count').addEventListener('change', () => { setupDirty = true; fillPositions(); });
    $('#mw-setup-details>summary').addEventListener('click', () => { if (!$('#mw-setup-details').open) fillSetup(); });
    $('#mw-setup-details').addEventListener('toggle', () => { if ($('#mw-setup-details').open) fillSetup(); });
    $('#mw-start').onclick = async () => {
      for (const input of setupHost.querySelectorAll('input,select')) if (!input.reportValidity()) return;
      const draft = getDraft(); if (draft.smallBlind >= draft.bigBlind) { setError('The small blind must be lower than the big blind.'); return; }
      if (await invoke('start', draft)) { setupDirty = false; $('#mw-setup-details').open = false; }
    };
    $('#mw-exit').onclick = () => invoke('exit'); $('#mw-undo').onclick = () => invoke('undo');
    controlsHost.addEventListener('click', event => { const button = event.target.closest('[data-mw-command]'); if (button && !button.disabled && button.dataset.mwAction) void action(button.dataset.mwAction); });
    $('#mw-size').addEventListener('input', sizeHelp);
    $('#mw-size-form').onsubmit = async event => {
      event.preventDefault(); if (!sizeDraft || sizeDraft.token !== activeToken()) { setError('The turn changed. Choose the action again.'); return; }
      if (!$('#mw-size').reportValidity()) return;
      if (await invoke('act', { actor: sizeDraft.actor, action: sizeDraft.action, to: Number($('#mw-size').value) })) sizeDialog.close();
    };
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
      if (!isTurn && !item.canMarkFold) return;
      if (await invoke(isTurn ? 'act' : 'markFold', { actor: item.id, ...(isTurn ? { action: 'FOLD' } : {}) })) seatDialog.close();
    };
    document.addEventListener('click', event => { const seat = event.target.closest?.('[data-multiway-player]'); if (seat) openPlayer(Number(seat.dataset.multiwayPlayer)); });
    document.addEventListener('keydown', keydown);
    refresh(); return window.theibsMultiwayUI;
  }
  function voiceContext() {
    return { token: JSON.stringify([activeToken(), view.config, context(), window.theibsApp?.getVoiceContext?.()]),
      stateToken: activeToken(),
      enabled: view.enabled, busy: busy(), phase: view.state?.phase, nextStreet: view.state?.nextStreet,
      board: [...(view.state?.board || [])],
      actionState: view.state ? { phase:view.state.phase, actor:view.state.actor, heroId:view.state.heroId,
        currentBet:view.state.currentBet, bigBlind:view.state.bigBlind,
        legal:{...view.state.legal,actions:[...(view.state.legal?.actions||[])]},
        players:view.state.players.map(item=>({id:item.id,hero:item.hero,name:item.name,position:item.position,folded:item.folded,allIn:item.allIn,streetPaid:item.streetPaid,stack:item.stack})) } : null };
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
  async function commitVoiceAction({ command, expectedToken }) {
    const current=voiceContext();
    if(!inAnalysis()||!current.enabled||current.busy||current.token!==expectedToken)return false;
    try{return await invoke('act',window.TheibsCardVoice.resolveAction(command,current.actionState));}
    catch(error){setError(error.message);return false;}
  }
  async function undoVoiceAction({ expectedToken }) {
    const current=voiceContext(),events=window.theibsApp?.getState().multiway?.events;
    if(!inAnalysis()||!current.enabled||current.busy||current.token!==expectedToken||events?.at(-1)?.type!=='ACT')return false;
    return invoke('undo');
  }
  window.theibsMultiwayUI = { init, render, setBusy, setError, openSetup, openPlayer, openBoard, getDraft, voiceContext, commitVoiceBoard, commitKeyboardBoard, undoVoiceBoard, commitVoiceAction, undoVoiceAction,
    getState: () => ({ enabled: view.enabled, state: view.state, config: view.config, busy: busy(), error: view.error }) };
})();
