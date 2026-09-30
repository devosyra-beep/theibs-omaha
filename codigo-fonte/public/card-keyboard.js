/* DOM adapter. Physical keys, clicks and paste all write to CardKeyboardState. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('./card-model') : window.TheibsCards;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;
  const { CardKeyboardState, CARD_RANKS, CARD_SUITS, parsePortugueseCards, normalizeKeyboardRank } = api;
  const suitEnglish = {C:'hearts',O:'diamonds',E:'spades',P:'clubs'};
  const state = new CardKeyboardState(5);
  const $ = (selector) => document.querySelector(selector);
  const heroInput = $('#heroCards'), boardInput = $('#board');
  const heroSlots = $('#hero-slots'), boardSlots = $('#board-slots');
  const grid = $('#card-grid'), status = $('#keyboard-status');
  let pendingRank = '', pendingTen = false, manualInvalid = false, message = '';
  let revision = 0;
  let renderedCount = null, slotElements = [], renderedCards = [], deckButtons = [];
  let renderedDeckState = null;
  let multiwayBoardDraft = null;
  const cardTemplate = document.createElement('template');
  const setText = (selector, text) => {
    const element = $(selector);
    if (element.textContent !== text) element.textContent = text;
  };
  const setDisabled = (element, disabled) => { if (element.disabled !== disabled) element.disabled = disabled; };
  function multiwayContext() {
    if (document.body.dataset.multiway !== 'on') return null;
    return window.theibsMultiwayUI?.voiceContext?.() || null;
  }
  function multiwayBoardRange(context = multiwayContext()) {
    if (!context?.enabled || context.phase !== 'WAIT_BOARD') return null;
    const start = state.count + (context.board?.length || 0);
    const needed = context.nextStreet === 'FLOP' ? 3 : 1;
    return { context, start, end: start + needed, needed, street: context.nextStreet };
  }
  function copyUndoStack() { return state.undoStack.map(entry => ({ ...entry, slots: [...entry.slots] })); }
  function rememberMultiwayBoardDraft(range) {
    if (multiwayBoardDraft?.stateToken === range.context.stateToken) return multiwayBoardDraft;
    multiwayBoardDraft = { stateToken: range.context.stateToken, snapshot: state.snapshot(), undoStack: copyUndoStack(), range: { ...range } };
    return multiwayBoardDraft;
  }
  function restoreMultiwayBoardDraft(draft, notice) {
    if (draft && multiwayBoardDraft === draft) {
      state.restore(draft.snapshot); state.undoStack = draft.undoStack.map(entry => ({ ...entry, slots: [...entry.slots] }));
      multiwayBoardDraft = null; message = ''; render(); announce(notice, true);
    }
  }
  function isMultiwayBoardSlot(index, range = multiwayBoardRange()) {
    return Boolean(range && index >= range.start && index < range.end);
  }
  function finishMultiwayBoardEdit(range) {
    const draft = rememberMultiwayBoardDraft(range);
    const board = state.slots.slice(range.start, range.end);
    const entered = board.filter(Boolean).length;
    if (entered < range.needed) {
      render();
      announce(`${range.street === 'FLOP' ? 'Flop' : range.street}: ${entered}/${range.needed}. Continue on the board above.`);
      return;
    }
    let addedCards;
    try { addedCards = board.map(window.TheibsCards.toCanonical); }
    catch (error) { restoreMultiwayBoardDraft(draft, error.message); return; }
    const commit = window.theibsMultiwayUI?.commitKeyboardBoard;
    if (typeof commit !== 'function') { restoreMultiwayBoardDraft(draft, 'Multiway board entry is unavailable.'); return; }
    message = ''; render(); announce(`Adding ${range.street === 'FLOP' ? 'flop' : range.street.toLowerCase()} to Multiway…`);
    Promise.resolve(commit({ addedCards, expectedStateToken: range.context.stateToken })).then(ok => {
      if (!ok) restoreMultiwayBoardDraft(draft, 'Board was not added. Check the table and enter the cards again.');
      else if (multiwayBoardDraft === draft) { multiwayBoardDraft = null; message = ''; render(); }
    }).catch(error => restoreMultiwayBoardDraft(draft, error?.message || 'Board was not added. Enter the cards again.'));
  }
  function editMultiwayBoard(range, before) {
    if (before && !multiwayBoardDraft) {
      multiwayBoardDraft = { stateToken: range.context.stateToken, snapshot: before.snapshot, undoStack: before.undoStack, range: { ...range } };
    }
    finishMultiwayBoardEdit(range);
  }

  function isEditing(target) {
    if (!(target instanceof Element)) return false;
    const control = target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    // Checkboxes and buttons do not receive text. Keeping focus on them must
    // not silently disable card entry after changing a table option.
    return Boolean(control && !(control.tagName === 'INPUT' && ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(control.type)));
  }
  function active() { return document.body.dataset.multiwayBusy!=='true' && !$('#analyze-workspace').classList.contains('hidden') && !document.querySelector('dialog[open]'); }
  function announce(text, error = false) {
    message = text;
    if (status.textContent !== text) status.textContent = text;
    status.classList.toggle('error', error);
  }
  function render() {
    const focus = document.activeElement;
    const focusedSlot = focus?.dataset?.slot, focusedCard = focus?.dataset?.card;
    const tableContext = multiwayContext(), boardRange = multiwayBoardRange(tableContext);
    if (multiwayBoardDraft && (!tableContext?.enabled || tableContext.phase !== 'WAIT_BOARD' || tableContext.stateToken !== multiwayBoardDraft.stateToken))
      multiwayBoardDraft = null;
    const slot = (index) => window.EssenceUI.cardMarkup(state.slots[index], {
      slot: index, selected: state.selected === index,
      label: index < state.count ? `Hole card ${index + 1}` : `Community card ${index - state.count + 1}`,
      emptyLabel: index < state.count ? String(index + 1) : ['F', 'F', 'F', 'T', 'R'][index - state.count]
    });
    // Keep focused buttons and the 52-card deck alive. Pending rank keys do not
    // change cards, and must not rebuild the table before the suit arrives.
    if (renderedCount !== state.count) {
      heroSlots.innerHTML = Array.from({ length: state.count }, (_, i) => slot(i)).join('');
      boardSlots.innerHTML = Array.from({ length: 5 }, (_, i) => slot(i + state.count)).join('');
      slotElements = [...heroSlots.children, ...boardSlots.children];
      renderedCards = [...state.slots];
      renderedCount = state.count;
    }
    const multiway = document.body.dataset.multiway === 'on';
    slotElements.forEach((element, index) => {
      if (renderedCards[index] !== state.slots[index]) {
        cardTemplate.innerHTML = slot(index);
        const next = cardTemplate.content.firstElementChild;
        element.className = next.className;
        element.setAttribute('aria-label', next.getAttribute('aria-label'));
        element.title = next.title;
        element.replaceChildren(...next.childNodes);
        renderedCards[index] = state.slots[index];
      }
      const selected = state.selected === index;
      element.classList.toggle('selected', selected);
      if (element.getAttribute('aria-pressed') !== String(selected)) element.setAttribute('aria-pressed', String(selected));
      const editableBoardSlot = Boolean(boardRange && !tableContext.busy && index >= boardRange.start && index < boardRange.end);
      setDisabled(element, multiway && index >= state.count && !editableBoardSlot);
      if (multiway && index >= state.count && !editableBoardSlot) element.title = 'Board cards are available here when the betting round is complete.';
      else if (multiway && editableBoardSlot) element.title = `Enter ${boardRange.street === 'FLOP' ? 'flop' : boardRange.street.toLowerCase()} card ${index - boardRange.start + 1} of ${boardRange.needed}.`;
      else if (element.title === 'Board cards are available here when the betting round is complete.' || element.title.startsWith('Enter ') && index >= state.count) {
        cardTemplate.innerHTML = slot(index);
        element.title = cardTemplate.content.firstElementChild.title;
      }
    });
    if (!deckButtons.length) {
      grid.innerHTML = CARD_SUITS.map((suit) => `<div class="card-row"><div class="card-suit${['C', 'O'].includes(suit.code) ? ' red' : ''}" data-suit="${suit.code}" aria-hidden="true">${suit.symbol}<small>${suit.code}</small></div><div class="card-ranks">${[...CARD_RANKS].map((rank) => `<button type="button" class="card-key${['C', 'O'].includes(suit.code) ? ' red' : ''}" data-card="${rank + suit.code}" data-suit="${suit.code}" aria-label="${rank === 'T' ? '10' : rank} of ${suitEnglish[suit.code]}">${rank === 'T' ? '10' : rank}<small>${suit.code}</small></button>`).join('')}</div></div>`).join('');
      deckButtons = [...grid.querySelectorAll('[data-card]')];
    }
    const deckState = `${state.selected}:${manualInvalid}:${state.slots.join('|')}`;
    if (deckState !== renderedDeckState) {
      const usedCards = new Set(state.slots.filter((card, index) => card && index !== state.selected));
      for (const button of deckButtons) {
        const used = usedCards.has(button.dataset.card);
        button.classList.toggle('used', used);
        button.classList.toggle('active', state.slots[state.selected] === button.dataset.card);
        setDisabled(button, used || manualInvalid);
      }
      renderedDeckState = deckState;
    }
    const canUndoBoardDraft = Boolean(boardRange && state.selected >= boardRange.start && multiwayBoardDraft?.stateToken === boardRange.context.stateToken && state.undoStack.length > multiwayBoardDraft.undoStack.length);
    setDisabled($('#undo-card'), boardRange && state.selected >= state.count ? !canUndoBoardDraft : !state.undoStack.length);
    setDisabled($('#remove-card'), !state.slots[state.selected]);
    $('#variant-select').value = String(state.count);
    setText('#analysis-variant', `PLO${state.count} HIGH`);
    $('#variant-warning').className='micro variant-status';
    setText('#variant-warning', `PLO${state.count} ativo · regras e equity habilitadas.`);
    setText('#hero-help', `${state.count} cards · C = hearts, P = clubs.`);
    const cards = state.cards();
    setText('#table-card-count', `${cards.hero.length}/${state.count} hole · ${cards.board.length}/5 board`);
    const target = state.selected < state.count ? `your card ${state.selected + 1}` : `board ${state.selected - state.count + 1}`;
    const selectedCard = state.slots[state.selected];
    const selectedSuit = selectedCard && CARD_SUITS.find((suit) => suit.code === selectedCard[1]);
    setText('#selected-card-label', selectedCard
      ? `Selected: ${selectedCard[0] === 'T' ? '10' : selectedCard[0]} of ${selectedSuit.name.toLowerCase()} ${selectedSuit.symbol} · ${target}`
      : `Next card: ${target} · type rank + suit`);
    if (!message) announce(manualInvalid ? 'Fix the text entry before continuing.' : pendingTen ? '10: type 0, then the suit.' : pendingRank ? `${pendingRank === 'T' ? '10' : pendingRank} → choose E, C, O or P.` : `Selected: ${target}.`, manualInvalid);
    if (focusedSlot !== undefined) document.querySelector(`[data-slot="${state.selected}"]`)?.focus({ preventScroll: true });
    else if (focusedCard !== undefined) document.querySelector(`[data-card="${focusedCard}"]:not(:disabled)`)?.focus({ preventScroll: true });
  }
  function changed(source = 'keyboard') {
    revision += 1;
    document.dispatchEvent(new CustomEvent('theibs:cards-changed', { detail: { ...state.cards(), snapshot: state.snapshot(), valid: !manualInvalid, source, revision } }));
  }
  function clearPending() { pendingRank = ''; pendingTen = false; message = ''; }
  function writeInputs(source) {
    const { hero, board } = state.cards();
    heroInput.value = hero.join(' '); boardInput.value = board.join(' ');
    manualInvalid = false; clearPending(); render(); changed(source);
  }
  function syncManual() {
    clearPending();
    try {
      const hero = parsePortugueseCards(heroInput.value), board = parsePortugueseCards(boardInput.value);
      if (!state.setCards(hero, board, true)) throw new Error(state.error);
      manualInvalid = false;
    } catch (error) { manualInvalid = true; announce(error.message, true); }
    render(); changed('manual');
  }
  function select(index) {
    if (document.body.dataset.multiway === 'on') {
      const range = multiwayBoardRange();
      if (range && index >= state.count) index = Math.max(range.start, Math.min(range.end - 1, index));
      else if (index >= state.count) index = state.count - 1;
    }
    if (state.select(index)) { revision += 1; clearPending(); render(); document.dispatchEvent(new CustomEvent('theibs:card-selection', { detail: { selected: state.selected, revision } })); }
  }
  function assign(card) {
    if (manualInvalid) { announce('Fix the cards in the text field before using the deck.', true); return; }
    const range = multiwayBoardRange();
    const onMultiwayBoard = isMultiwayBoardSlot(state.selected, range);
    const before = onMultiwayBoard && !multiwayBoardDraft ? { snapshot: state.snapshot(), undoStack: copyUndoStack() } : null;
    if (state.assign(card)) {
      if (onMultiwayBoard) editMultiwayBoard(range, before);
      else writeInputs('keyboard');
    } else announce(state.error, true);
  }
  function paste(text) {
    if (manualInvalid) { announce('Fix the text entry before pasting.', true); return false; }
    const range = multiwayBoardRange(), onMultiwayBoard = isMultiwayBoardSlot(state.selected, range);
    let before = null;
    if (onMultiwayBoard) {
      let parsed;
      try { parsed = parsePortugueseCards(text); } catch (error) { announce(error.message, true); return false; }
      if (parsed.length > range.end - state.selected) { announce(`Enter only the remaining ${range.street === 'FLOP' ? 'flop' : range.street.toLowerCase()} cards.`, true); return false; }
      if (!multiwayBoardDraft) before = { snapshot: state.snapshot(), undoStack: copyUndoStack() };
    }
    if (!state.paste(text)) { announce(state.error, true); return false; }
    if (onMultiwayBoard) editMultiwayBoard(range, before); else writeInputs('paste');
    return true;
  }
  function undo() {
    if (pendingRank || pendingTen) { clearPending(); render(); return; }
    const range = multiwayBoardRange();
    if (range && state.selected >= state.count) {
      if (multiwayBoardDraft?.stateToken === range.context.stateToken && state.undoStack.length > multiwayBoardDraft.undoStack.length && state.undo()) {
        render(); announce('Board card removed from the pending entry.');
      } else announce('No pending board card to undo.', true);
      return;
    }
    if (state.undo()) writeInputs('undo');
  }
  function removeSelected() {
    const range = multiwayBoardRange();
    if (range && isMultiwayBoardSlot(state.selected, range)) {
      if (state.removeSelected()) { render(); announce('Board card removed from the pending entry.'); }
      return;
    }
    if (state.removeSelected()) writeInputs('remove');
  }
  async function copy() {
    try { if (manualInvalid) throw new Error('Fix the text before copying.'); const text = state.compactText(); await navigator.clipboard.writeText(text); announce('E/C/O/P sequence copied.'); }
    catch (error) { announce(error.message || 'Could not copy. Use the text fields.', true); }
  }
  function exportDraft() {
    if (manualInvalid) { announce('Fix the text before exporting. The invalid draft remains saved locally.', true); return; }
    const blob = new Blob([JSON.stringify(state.exportDraft(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `THEIBS-PLO${state.count}-entrada.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('JSON exported. It contains card input, not decision history.');
  }
  for (const root of [heroSlots, boardSlots]) root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-slot]'); if (target) select(Number(target.dataset.slot));
  });
  grid.addEventListener('click', (event) => { const button = event.target.closest('[data-card]'); if (button && !button.disabled) assign(button.dataset.card); });
  $('#remove-card').addEventListener('click', removeSelected);
  $('#undo-card').addEventListener('click', undo);
  $('#copy-cards').addEventListener('click', copy);
  $('#export-cards').addEventListener('click', exportDraft);
  $('#paste-apply').addEventListener('click', () => { if (paste($('#paste-cards').value)) $('#paste-cards').value = ''; });
  for (const input of [heroInput, boardInput]) {
    input.addEventListener('input', syncManual);
    input.addEventListener('blur', () => { if (!manualInvalid) { const cards = state.cards(); heroInput.value = cards.hero.join(' '); boardInput.value = cards.board.join(' '); } });
  }
  $('#variant-select').addEventListener('change', (event) => {
    const count = Number(event.target.value);
    if (manualInvalid && !window.confirm('There is invalid text that has not been applied. Changing the variant will discard it and keep the previous valid cards. Continue?')) { event.target.value = String(state.count); return; }
    if (!state.setCount(count)) {
      if (state.error.includes('reduction') && window.confirm('This change will remove excess hole cards. The board will be preserved and you can undo. Continue?')) state.setCount(count, true);
      else { event.target.value = String(state.count); announce(state.error, true); return; }
    }
    writeInputs('variant');
  });
  document.addEventListener('focusin', (event) => {
    if (!active()) return;
    const slot = event.target.closest('[data-slot]');
    // Tab navigation and mouse selection must target the same card position.
    if (slot && Number(slot.dataset.slot) !== state.selected) select(Number(slot.dataset.slot));
    else if (isEditing(event.target) && (pendingRank || pendingTen)) { clearPending(); render(); }
  });
  document.addEventListener('paste', (event) => {
    if (!active() || isEditing(event.target)) return;
    event.preventDefault(); paste(event.clipboardData?.getData('text/plain') || '');
  });
  document.addEventListener('keydown', (event) => {
    if (!active() || isEditing(event.target) || event.isComposing || event.repeat) return;
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === 'z') { event.preventDefault(); undo(); }
      else if (key === 'c') { event.preventDefault(); copy(); }
      else if (key === 's') { event.preventDefault(); exportDraft(); }
      else if (/^[1-4]$/.test(key)) { event.preventDefault(); select(({ 1: 0, 2: state.count, 3: state.count + 3, 4: state.count + 4 })[key]); }
      return;
    }
    if (event.altKey) return;
    if (event.key === 'Delete') { event.preventDefault(); if (state.removeSelected()) writeInputs('remove'); return; }
    if (event.key === 'Backspace') { event.preventDefault(); undo(); return; }
    if (event.key === 'Escape') { clearPending(); render(); return; }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); select(Math.max(0, Math.min(state.slots.length - 1, state.selected + (event.key === 'ArrowLeft' ? -1 : 1)))); return; }
    const key = event.key.toUpperCase();
    if (pendingTen && key === '0') { event.preventDefault(); pendingRank = 'T'; pendingTen = false; message = ''; render(); return; }
    if (key === '1') { event.preventDefault(); pendingTen = true; pendingRank = ''; message = ''; render(); return; }
    const rank = normalizeKeyboardRank(key);
    if (rank) { event.preventDefault(); pendingRank = rank; pendingTen = false; message = ''; render(); return; }
    if (key.length === 1 && 'ECOP'.includes(key) && pendingRank) { event.preventDefault(); assign(pendingRank + key); }
  });
  window.theibsCardKeyboard = {
    state, render, select, paste,
    getRevision: () => revision,
    applyReviewedHero(heroCards, expectedRevision) {
      if (document.body.dataset.multiway !== 'on' || document.body.dataset.multiwayBusy === 'true' ||
          $('#analyze-workspace').classList.contains('hidden') || manualInvalid || expectedRevision !== revision)
        return { ok: false, error: 'The hand changed. Check the image and try again.' };
      if (!Array.isArray(heroCards) || heroCards.length !== state.count)
        return { ok: false, error: `Confirm all ${state.count} hole cards.` };
      let hero;
      try { hero = heroCards.map(api.fromCanonical); }
      catch (error) { return { ok: false, error: error.message }; }
      const board = state.cards().board;
      if (!state.setCards(hero, board, true)) return { ok: false, error: state.error };
      writeInputs('image-review');
      return { ok: true, revision };
    },
    commitCommand(command, expectedRevision) {
      if (!active() || manualInvalid || expectedRevision !== revision) return { ok: false, error: 'A entrada mudou. Dite novamente no destino desejado.' };
      const priorCards = JSON.stringify([state.count, state.slots]);
      if (document.body.dataset.multiway === 'on') {
        // The simple card state must never override the multiway ledger.
        const draft = new CardKeyboardState(state.count); draft.restore(state.snapshot());
        draft.undoStack = state.undoStack.map(entry => ({ ...entry, slots: [...entry.slots] }));
        if (!draft.applyCommand(command) || (command.type !== 'cards' && draft.selected >= state.count) ||
            JSON.stringify(draft.slots.slice(state.count)) !== JSON.stringify(state.slots.slice(state.count))) {
          return { ok: false, error: 'In Multiway, use the street command and board transaction.' };
        }
      }
      if (!state.applyCommand(command)) return { ok: false, error: state.error };
      if (document.body.dataset.multiway === 'on') state.selected = Math.min(state.selected, state.count - 1);
      if (priorCards === JSON.stringify([state.count, state.slots])) {
        revision += 1; clearPending(); render();
        document.dispatchEvent(new CustomEvent('theibs:card-selection', { detail: { selected: state.selected, revision, source: 'voice' } }));
      } else writeInputs('voice');
      return { ok: true, revision, snapshot: state.snapshot() };
    },
    cancelPending() { clearPending(); render(); },
    manualDraft() { return manualInvalid ? { hero: heroInput.value, board: boardInput.value, invalid: true } : null; },
    restoreManualDraft(draft) {
      if (!draft || draft.invalid !== true || typeof draft.hero !== 'string' || typeof draft.board !== 'string') return;
      heroInput.value = draft.hero; boardInput.value = draft.board; manualInvalid = true; clearPending();
      announce('Text draft restored. Fix invalid cards before analyzing.', true); render(); changed('manual-restore');
    },
    reset() { state.reset(); writeInputs('reset'); },
    restore(snapshot, options = {}) {
      // A server acknowledgement of the same cards must not erase a phrase's
      // undo. New hands, variants, actual board changes and ordinary restores
      // retain the prior behavior of dropping the local card history.
      const preserveUndo = options.preserveUndo === true && snapshot?.count === state.count &&
        JSON.stringify(snapshot?.slots) === JSON.stringify(state.slots);
      if (!state.restore(snapshot)) return false;
      if (!preserveUndo) state.undoStack = [];
      writeInputs('restore'); return true;
    },
    cardsForSubmit() { return manualInvalid || !state.validation().valid ? null : state.cards(); },
    canonicalForSubmit() { if (manualInvalid) throw new Error('Fix the cards in the text field.'); return state.canonicalCards(); },
    isManualInvalid() { return manualInvalid; },
    error() { return manualInvalid ? status.textContent : state.validation().reason; },
    announce
  };
  render();
})();
