(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—';
  const ACTIONS = [
    { action: 'FOLD', key: 'b', label: 'Sair', past: 'saiu' },
    { action: 'CHECK', key: 'n', label: 'Passar', past: 'passou' },
    { action: 'CALL', key: 'm', label: 'Pagar', past: 'pagou' },
    { action: 'BET', key: ',', label: 'Apostar', past: 'apostou' },
    { action: 'RAISE', key: '.', label: 'Aumentar', past: 'aumentou' }
  ];
  const POSITIONS = { 2: ['SB', 'BB'], 3: ['SB', 'BB', 'BTN'], 4: ['SB', 'BB', 'CO', 'BTN'],
    5: ['SB', 'BB', 'HJ', 'CO', 'BTN'], 6: ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'],
    7: ['SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO', 'BTN'], 8: ['SB', 'BB', 'UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN'],
    9: ['SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN'], 10: ['SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'UTG3', 'LJ', 'HJ', 'CO', 'BTN'] };
  const STREETS = { PREFLOP: 'Pré-flop', FLOP: 'Flop', TURN: 'Turn', RIVER: 'River' };
  let options = {}, view = { enabled: false, state: null, config: null, busy: false, error: '' };
  let initialized = false, localBusy = false, setupDirty = false, sizeDraft = null, boardDraft = null, selectedPlayer = null;
  let setupHost, controlsHost, sizeDialog, boardDialog, seatDialog;
  const busy = () => localBusy || view.busy;
  const context = () => options.getContext?.() || {};
  const player = id => view.state?.players?.find(item => item.id === id);
  const playerName = item => item?.hero ? 'Você' : item?.name || 'Adversário';
  const actor = () => player(view.state?.actor);
  const inAnalysis = () => document.body.dataset.view === 'analyze' && !$('#analyze-workspace')?.classList.contains('hidden');
  const legal = action => view.enabled && !busy() && view.state?.phase === 'BETTING' && view.state.legal?.actions?.includes(action);
  const activeToken = () => JSON.stringify([view.state?.actor, view.state?.street, view.state?.phase, view.state?.log?.length, view.state?.pot]);

  function dialog(id, title, body) {
    const node = document.createElement('dialog'); node.id = id; node.className = 'multiway-dialog';
    node.innerHTML = `<div class="multiway-dialog-head"><h2>${title}</h2><button type="button" class="text-button" data-mw-close aria-label="Fechar">×</button></div>${body}<p class="multiway-error" data-mw-error role="alert" hidden></p>`;
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
    if (typeof options.handlers?.[name] !== 'function') { setError('Este controle ainda não está disponível.'); return false; }
    localBusy = true; setError(''); refresh();
    try { await options.handlers[name](payload); return true; }
    catch (error) { setError(error?.message || 'Não foi possível registrar. Confira os dados e tente novamente.'); return false; }
    finally { localBusy = false; refresh(); }
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
    $('#mw-player-count').innerHTML = Array.from({ length: max - 1 }, (_, index) => `<option value="${index + 2}">${index + 2} jogadores</option>`).join('');
    $('#mw-player-count').value = Math.min(max, Math.max(2, Number(source.playerCount || source.players || (count === 6 ? 5 : 6))));
    fillPositions(source.heroPosition || source.position || 'BTN');
    $('#mw-small-blind').value = source.smallBlind ?? .5; $('#mw-big-blind').value = source.bigBlind ?? 1;
    $('#mw-starting-stack').value = source.startingStack ?? source.effectiveStack ?? 100;
    $('#mw-variant-label').textContent = `PLO${count}`;
    $('#mw-start-note').textContent = (source.board?.length || view.state?.board?.length)
      ? 'Começar inicia outra mão no pré-flop e limpa a mesa. Suas cartas são mantidas.'
      : 'Começa no pré-flop, com blinds. Registre somente as ações que observar.';
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
    document.body.dataset.multiway = view.enabled ? 'on' : 'off';
    const state = view.state, current = actor(), isHero = current?.id === state?.heroId;
    const heading = !state ? 'Preparando mesa' : state.phase === 'BETTING' ? `${isHero ? 'Sua vez' : 'Vez de ' + playerName(current)} · ${current?.position || ''}`
      : state.phase === 'WAIT_BOARD' ? `Abrir ${STREETS[state.nextStreet] || 'próxima rodada'}` : state.phase === 'SHOWDOWN' ? 'Confronto final · ações encerradas' : 'Mão encerrada';
    $('#mw-actor').textContent = heading; $('#mw-actor').classList.toggle('is-hero-turn', Boolean(isHero && state?.phase === 'BETTING'));
    $('#mw-round').textContent = state ? `${STREETS[state.street] || state.street} · ${state.activeOpponentCount ?? state.players.filter(item => !item.hero && !item.folded).length} adversários ativos` : '';
    for (const action of ACTIONS) {
      const button = $(`[data-mw-action="${action.action}"]`); button.disabled = !legal(action.action);
      button.querySelector('span').textContent = action.label + (action.action === 'CALL' && legal('CALL') ? ' ' + money(state.legal.toCall) : '');
    }
    $('#mw-next-board').hidden = state?.phase !== 'WAIT_BOARD'; $('#mw-next-board').disabled = busy();
    $('#mw-next-board').textContent = `Informar ${STREETS[state?.nextStreet] || 'cartas'}`;
    $('#mw-undo').disabled = busy() || !state || !(view.canUndo ?? (state.log || []).some(event => !['SB', 'BB'].includes(event.action)));
    $('#mw-setup-status').textContent = view.enabled ? 'Ativo' : 'Desligado';
    $('#mw-exit').hidden = !view.enabled; $('#mw-exit').disabled = busy();
    $('#mw-start').textContent = view.enabled ? 'Começar nova mão' : 'Começar Multiway'; $('#mw-start').disabled = busy();
    controlsHost.setAttribute('aria-busy', String(busy()));
    const logs = (state?.log || []).slice(-6);
    $('#mw-history-list').innerHTML = logs.map(event => {
      const name = Number.isInteger(event.actor) ? `${playerName(player(event.actor))} · ${player(event.actor)?.position || ''}` : STREETS[event.street] || '';
      const action = ACTIONS.find(item => item.action === event.action)?.past || ({ SB: 'small blind', BB: 'big blind', BOARD: 'cartas abertas', MARK_FOLD: 'saída observada', RETURN: 'devolução', SHOWDOWN: 'confronto final' })[event.action] || event.action;
      return `<li><span>${esc(name)}</span><span>${esc(action)}${Number.isFinite(event.amount) && event.amount > 0 ? ' ' + money(event.amount) : ''}</span></li>`;
    }).join('');
    $('#mw-history').hidden = !logs.length;
    for (const node of document.querySelectorAll('[data-multiway-player]')) {
      const item = player(Number(node.dataset.multiwayPlayer)); if (!item) continue;
      node.classList.toggle('mw-actor-seat', view.enabled && state.actor === item.id);
      node.classList.toggle('mw-folded-seat', view.enabled && item.folded);
      node.classList.toggle('mw-allin-seat', view.enabled && (item.allIn || item.stack === 0));
      if (view.enabled) { node.setAttribute('role', 'button'); node.tabIndex = 0; node.setAttribute('aria-label', `${playerName(item)}, ${item.position}, ${item.folded ? 'saiu' : item.allIn || item.stack === 0 ? 'all-in' : 'stack ' + money(item.stack)}. Ver jogador.`); }
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
    $('#mw-size-cost').textContent = Number.isFinite(value) && cost >= 0 ? `${playerName(actor())} adiciona ${money(cost)} ${cost === 1 ? 'ficha' : 'fichas'} agora.` : 'Informe o total colocado nesta rodada.';
  }
  async function action(actionCode) {
    if (!inAnalysis() || !legal(actionCode)) return;
    window.theibsCardKeyboard?.cancelPending?.();
    if (actionCode === 'BET' || actionCode === 'RAISE') {
      const state = view.state; sizeDraft = { action: actionCode, actor: state.actor, token: activeToken() };
      $('#mw-size-title').textContent = `${ACTIONS.find(item => item.action === actionCode).label} · ${playerName(actor())} ${actor().position}`;
      $('#mw-size').min = state.legal.minTo; $('#mw-size').max = state.legal.maxTo; $('#mw-size').value = state.legal.minTo;
      $('#mw-size-limits').textContent = `Mínimo ${money(state.legal.minTo)} · máximo ${money(state.legal.maxTo)}`;
      setError(''); sizeHelp(); $('#mw-size-confirm').disabled = false; sizeDialog.showModal(); $('#mw-size').focus(); $('#mw-size').select(); return;
    }
    await invoke('act', { actor: view.state.actor, action: actionCode });
  }
  function openBoard() {
    if (!view.enabled || busy() || view.state?.phase !== 'WAIT_BOARD') return;
    const state = view.state; boardDraft = { token: activeToken(), previous: [...state.board], nextStreet: state.nextStreet };
    const needed = state.nextStreet === 'FLOP' ? 3 : 1;
    $('#mw-board-title').textContent = `Informar ${STREETS[state.nextStreet]}`;
    $('#mw-board-label').textContent = needed === 3 ? 'Três cartas do flop' : 'Nova carta';
    $('#mw-board-new').value = ''; $('#mw-board-new').placeholder = needed === 3 ? '2E 3C 4O' : '10P';
    $('#mw-board-existing').textContent = state.board.length ? 'Já na mesa: ' + state.board.map(window.TheibsCards.fromCanonical).join(' ') : 'A rodada de apostas foi concluída.';
    setError(''); $('#mw-board-confirm').disabled = false; boardDialog.showModal(); $('#mw-board-new').focus();
  }
  function refreshSeat() {
    const item = player(selectedPlayer); if (!item) { seatDialog.close(); return; }
    $('#mw-seat-title').textContent = `${playerName(item)} · ${item.position}`;
    $('#mw-seat-info').textContent = `${item.folded ? 'Saiu da mão' : item.allIn || item.stack === 0 ? 'All-in' : 'Na mão'} · stack ${money(item.stack)} · colocou ${money(item.streetPaid)} nesta rodada`;
    const turnFold = item.id === view.state.actor && view.state.legal?.actions?.includes('FOLD');
    $('#mw-seat-fold').disabled = busy() || !(turnFold || item.canMarkFold);
    $('#mw-seat-fold').textContent = turnFold ? 'Registrar saída · é a vez deste jogador' : 'Registrar saída observada';
    $('#mw-seat-note').textContent = item.folded ? 'A saída já está registrada.' : item.allIn || item.stack === 0 ? 'Jogador all-in permanece elegível ao pote.' : item.markFoldReason === 'UNMATCHED_CONTRIBUTION' ? 'Registre primeiro as respostas à maior aposta.' : !turnFold && !item.canMarkFold ? 'Aguarde a vez deste jogador para registrar outra ação.' : 'Use somente para uma saída que você observou.';
  }
  function openPlayer(id) {
    if (!view.enabled || !inAnalysis() || busy() || !player(Number(id)) || document.querySelector('dialog[open]')) return;
    selectedPlayer = Number(id); setError(''); refreshSeat(); seatDialog.showModal();
  }
  function keydown(event) {
    if (!view.enabled || !inAnalysis() || busy() || event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || document.querySelector('dialog[open]')) return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    const command = ACTIONS.find(item => item.key === event.key.toLowerCase());
    if (command && legal(command.action)) { event.preventDefault(); void action(command.action); return; }
    const seat = event.target.closest?.('[data-multiway-player]');
    if (seat && seat.tagName !== 'BUTTON' && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openPlayer(Number(seat.dataset.multiwayPlayer)); }
  }
  function init(settings = {}) {
    options = settings;
    if (initialized) { fillSetup(); refresh(); return window.theibsMultiwayUI; }
    setupHost = $(settings.setupSelector || '#multiway-setup'); controlsHost = $(settings.controlsSelector || '#multiway-controls');
    if (!setupHost || !controlsHost) throw Error('Contêineres Multiway ausentes.');
    setupHost.innerHTML = `<details id="mw-setup-details"><summary><span>Multiway <small id="mw-variant-label"></small></span><span id="mw-setup-status" class="mw-chip">Desligado</span></summary><div class="mw-setup-fields"><div class="mw-config-grid"><label>Jogadores, incluindo você<select id="mw-player-count"></select></label><label>Sua posição<select id="mw-hero-position"></select></label><label>Small blind<input id="mw-small-blind" type="number" min="0.01" step="0.01" required></label><label>Big blind<input id="mw-big-blind" type="number" min="0.01" step="0.01" required></label><label>Stack inicial de cada jogador<input id="mw-starting-stack" type="number" min="0.01" step="0.01" required></label></div><p id="mw-start-note"></p><div class="mw-setup-actions"><button id="mw-start" type="button" class="primary-button">Começar Multiway</button><button id="mw-exit" type="button" class="text-button" hidden>Voltar ao modo simples</button></div><p id="multiway-setup-error" class="multiway-error" role="alert" hidden></p></div></details>`;
    controlsHost.classList.add('multiway-controls'); controlsHost.hidden = true;
    controlsHost.innerHTML = `<div class="mw-control-heading"><strong id="mw-actor"></strong><span id="mw-round"></span><button id="mw-undo" type="button" class="text-button" title="Desfazer a última ação observada">↶ Desfazer</button></div><div class="mw-action-row">${ACTIONS.map(item => `<button type="button" data-mw-action="${item.action}" disabled title="${item.label} · ${item.key.toUpperCase()}"><kbd>${item.key.toUpperCase()}</kbd><span>${item.label}</span></button>`).join('')}<button id="mw-next-board" type="button" class="primary-button" hidden>Informar cartas</button></div><p id="multiway-error" class="multiway-error" role="alert" hidden></p><details id="mw-history"><summary>Últimas ações</summary><ol id="mw-history-list"></ol></details>`;
    sizeDialog = dialog('multiway-size-dialog', '<span id="mw-size-title">Valor da aposta</span>', '<form id="mw-size-form"><label>Total nesta rodada<input id="mw-size" type="number" step="0.01" inputmode="decimal" required></label><p id="mw-size-limits"></p><p id="mw-size-cost"></p><button id="mw-size-confirm" type="submit" class="primary-button">Confirmar total · Enter</button></form>');
    boardDialog = dialog('multiway-board-dialog', '<span id="mw-board-title">Próxima rodada</span>', '<form id="mw-board-form"><p id="mw-board-existing"></p><label><span id="mw-board-label">Novas cartas</span><input id="mw-board-new" autocomplete="off" spellcheck="false" required></label><p class="mw-card-legend">Valor + naipe: ♠ E · ♥ C · ♦ O · ♣ P. Dez = D, T ou 10.</p><button id="mw-board-confirm" type="submit" class="primary-button">Abrir rodada · Enter</button></form>');
    seatDialog = dialog('multiway-seat-dialog', '<span id="mw-seat-title">Jogador</span>', '<p id="mw-seat-info"></p><p id="mw-seat-note"></p><button id="mw-seat-fold" type="button" class="ghost-button">Registrar saída</button>');
    initialized = true; fillSetup(true);
    setupHost.addEventListener('input', () => { setupDirty = true; });
    $('#mw-player-count').addEventListener('change', () => { setupDirty = true; fillPositions(); });
    $('#mw-setup-details>summary').addEventListener('click', () => { if (!$('#mw-setup-details').open) fillSetup(); });
    $('#mw-setup-details').addEventListener('toggle', () => { if ($('#mw-setup-details').open) fillSetup(); });
    $('#mw-start').onclick = async () => {
      for (const input of setupHost.querySelectorAll('input,select')) if (!input.reportValidity()) return;
      const draft = getDraft(); if (draft.smallBlind >= draft.bigBlind) { setError('O small blind precisa ser menor que o big blind.'); return; }
      if (await invoke('start', draft)) { setupDirty = false; $('#mw-setup-details').open = false; }
    };
    $('#mw-exit').onclick = () => invoke('exit'); $('#mw-undo').onclick = () => invoke('undo'); $('#mw-next-board').onclick = openBoard;
    controlsHost.addEventListener('click', event => { const button = event.target.closest('[data-mw-action]'); if (button && !button.disabled) void action(button.dataset.mwAction); });
    $('#mw-size').addEventListener('input', sizeHelp);
    $('#mw-size-form').onsubmit = async event => {
      event.preventDefault(); if (!sizeDraft || sizeDraft.token !== activeToken()) { setError('A vez mudou. Escolha a ação novamente.'); return; }
      if (!$('#mw-size').reportValidity()) return;
      if (await invoke('act', { actor: sizeDraft.actor, action: sizeDraft.action, to: Number($('#mw-size').value) })) sizeDialog.close();
    };
    $('#mw-board-form').onsubmit = async event => {
      event.preventDefault(); if (!boardDraft || boardDraft.token !== activeToken()) { setError('A rodada mudou. Confira a mesa novamente.'); return; }
      try {
        const added = window.TheibsCards.parsePortugueseCards($('#mw-board-new').value).map(window.TheibsCards.toCanonical);
        if (added.length !== (boardDraft.nextStreet === 'FLOP' ? 3 : 1)) throw Error(boardDraft.nextStreet === 'FLOP' ? 'Informe exatamente três cartas do flop.' : 'Informe somente a nova carta.');
        const source = context(), visibleHero = source.variant === view.config?.variant && Array.isArray(source.heroCards) ? source.heroCards : view.config?.heroCards || [];
        const cards = [...boardDraft.previous, ...added], known = [...visibleHero, ...cards];
        if (new Set(known).size !== known.length) throw Error('Essa carta já está na mão ou na mesa.');
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
  window.theibsMultiwayUI = { init, render, setBusy, setError, openSetup, openPlayer, openBoard, getDraft,
    getState: () => ({ enabled: view.enabled, state: view.state, config: view.config, busy: busy(), error: view.error }) };
})();
