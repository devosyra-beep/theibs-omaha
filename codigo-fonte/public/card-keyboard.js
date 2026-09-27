/* DOM adapter. Physical keys, clicks and paste all write to CardKeyboardState. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('./card-model') : window.TheibsCards;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;
  const { CardKeyboardState, CARD_RANKS, CARD_SUITS, parsePortugueseCards, normalizeKeyboardRank } = api;
  const state = new CardKeyboardState(5);
  const $ = (selector) => document.querySelector(selector);
  const heroInput = $('#heroCards'), boardInput = $('#board');
  const heroSlots = $('#hero-slots'), boardSlots = $('#board-slots');
  const grid = $('#card-grid'), status = $('#keyboard-status');
  let pendingRank = '', pendingTen = false, manualInvalid = false, message = '';

  function isEditing(target) {
    if (!(target instanceof Element)) return false;
    const control = target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    // Checkboxes and buttons do not receive text. Keeping focus on them must
    // not silently disable card entry after changing a table option.
    return Boolean(control && !(control.tagName === 'INPUT' && ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(control.type)));
  }
  function active() { return document.body.dataset.multiwayBusy!=='true' && !$('#analyze-workspace').classList.contains('hidden') && !document.querySelector('dialog[open]'); }
  function announce(text, error = false) {
    message = text; status.textContent = text; status.classList.toggle('error', error);
  }
  function render() {
    const focus = document.activeElement;
    const focusedSlot = focus?.dataset?.slot, focusedCard = focus?.dataset?.card;
    const slot = (index) => window.EssenceUI.cardMarkup(state.slots[index], {
      slot: index, selected: state.selected === index,
      label: index < state.count ? `Hole card ${index + 1}` : `Community card ${index - state.count + 1}`,
      emptyLabel: index < state.count ? String(index + 1) : ['F', 'F', 'F', 'T', 'R'][index - state.count]
    });
    heroSlots.innerHTML = Array.from({ length: state.count }, (_, i) => slot(i)).join('');
    boardSlots.innerHTML = Array.from({ length: 5 }, (_, i) => slot(i + state.count)).join('');
    if(document.body.dataset.multiway==='on')boardSlots.querySelectorAll('button').forEach(button=>{button.disabled=true;button.title='Use Revelar board no Multiway.';});
    grid.innerHTML = CARD_SUITS.map((suit) => `<div class="card-row"><div class="card-suit${['C', 'O'].includes(suit.code) ? ' red' : ''}" data-suit="${suit.code}" aria-hidden="true">${suit.symbol}<small>${suit.code}</small></div><div class="card-ranks">${[...CARD_RANKS].map((rank) => {
      const card = rank + suit.code;
      const used = state.slots.some((c, i) => c === card && i !== state.selected);
      return `<button type="button" class="card-key${['C', 'O'].includes(suit.code) ? ' red' : ''}${used ? ' used' : ''}${state.slots[state.selected] === card ? ' active' : ''}" data-card="${card}" data-suit="${suit.code}" aria-label="${rank === 'T' ? '10' : rank} de ${suit.name}" ${used || manualInvalid ? 'disabled' : ''}>${rank === 'T' ? '10' : rank}<small>${suit.code}</small></button>`;
    }).join('')}</div></div>`).join('');
    $('#undo-card').disabled = !state.undoStack.length;
    $('#remove-card').disabled = !state.slots[state.selected];
    $('#variant-select').value = String(state.count);
    $('#analysis-variant').textContent = `PLO${state.count} HIGH`;
    $('#variant-warning').className='micro variant-status';
    $('#variant-warning').textContent=`PLO${state.count} ativo · regras e equity habilitadas.`;
    $('#hero-help').textContent = `${state.count} cards · C = hearts, P = clubs.`;
    const cards = state.cards();
    $('#table-card-count').textContent = `${cards.hero.length}/${state.count} hole · ${cards.board.length}/5 board`;
    const target = state.selected < state.count ? `your card ${state.selected + 1}` : `board ${state.selected - state.count + 1}`;
    const selectedCard = state.slots[state.selected];
    const selectedSuit = selectedCard && CARD_SUITS.find((suit) => suit.code === selectedCard[1]);
    $('#selected-card-label').textContent = selectedCard
      ? `Selected: ${selectedCard[0] === 'T' ? '10' : selectedCard[0]} of ${selectedSuit.name.toLowerCase()} ${selectedSuit.symbol} · ${target}`
      : `Next card: ${target} · type rank + suit`;
    if (!message) announce(manualInvalid ? 'Fix the text entry before continuing.' : pendingTen ? '10: type 0, then the suit.' : pendingRank ? `${pendingRank === 'T' ? '10' : pendingRank} → choose E, C, O or P.` : `Selected: ${target}.`, manualInvalid);
    if (focusedSlot !== undefined) document.querySelector(`[data-slot="${state.selected}"]`)?.focus({ preventScroll: true });
    else if (focusedCard !== undefined) document.querySelector(`[data-card="${focusedCard}"]:not(:disabled)`)?.focus({ preventScroll: true });
  }
  function changed(source = 'keyboard') {
    document.dispatchEvent(new CustomEvent('theibs:cards-changed', { detail: { ...state.cards(), snapshot: state.snapshot(), valid: !manualInvalid, source } }));
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
  function select(index) { if(document.body.dataset.multiway==='on')index=Math.min(index,state.count-1);if (state.select(index)) { clearPending(); render(); } }
  function assign(card) {
    if (manualInvalid) { announce('Fix the cards in the text field before using the deck.', true); return; }
    if (state.assign(card)) writeInputs('keyboard'); else announce(state.error, true);
  }
  function paste(text) {
    if (manualInvalid) { announce('Fix the text entry before pasting.', true); return false; }
    if (!state.paste(text)) { announce(state.error, true); return false; }
    writeInputs('paste'); return true;
  }
  function undo() {
    if (pendingRank || pendingTen) { clearPending(); render(); return; }
    if (state.undo()) writeInputs('undo');
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
  $('#remove-card').addEventListener('click', () => { if (state.removeSelected()) writeInputs('remove'); });
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
    cancelPending() { clearPending(); render(); },
    manualDraft() { return manualInvalid ? { hero: heroInput.value, board: boardInput.value, invalid: true } : null; },
    restoreManualDraft(draft) {
      if (!draft || draft.invalid !== true || typeof draft.hero !== 'string' || typeof draft.board !== 'string') return;
      heroInput.value = draft.hero; boardInput.value = draft.board; manualInvalid = true; clearPending();
      announce('Text draft restored. Fix invalid cards before analyzing.', true); render(); changed('manual-restore');
    },
    reset() { state.reset(); writeInputs('reset'); },
    restore(snapshot) { if (!state.restore(snapshot)) return false; state.undoStack = []; writeInputs('restore'); return true; },
    cardsForSubmit() { return manualInvalid || !state.validation().valid ? null : state.cards(); },
    canonicalForSubmit() { if (manualInvalid) throw new Error('Fix the cards in the text field.'); return state.canonicalCards(); },
    isManualInvalid() { return manualInvalid; },
    error() { return manualInvalid ? status.textContent : state.validation().reason; },
    announce
  };
  render();
})();
