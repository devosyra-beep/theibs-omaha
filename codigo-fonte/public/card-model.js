/* OmahaKeys behavior port. Pure state, no DOM, engine, or demonstration logic. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TheibsCards = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const CARD_RANKS = 'AKQJT98765432';
  const CARD_SUITS = Object.freeze([
    { code: 'E', name: 'Spades', symbol: '♠', canonical: 's' },
    { code: 'C', name: 'Hearts', symbol: '♥', canonical: 'h' },
    { code: 'O', name: 'Diamonds', symbol: '♦', canonical: 'd' },
    { code: 'P', name: 'Clubs', symbol: '♣', canonical: 'c' }
  ]);
  const PT_TO_ENGINE = { E: 's', C: 'h', O: 'd', P: 'c' };
  const ENGINE_TO_PT = { s: 'E', h: 'C', d: 'O', c: 'P' };
  const SYMBOL_TO_PT = { '♠': 'E', '♥': 'C', '♦': 'O', '♣': 'P' };

  function normalizeKeyboardRank(value) {
    const rank = String(value || '').trim().toUpperCase();
    if (rank === 'D' || rank === '10') return 'T';
    return rank.length === 1 && CARD_RANKS.includes(rank) ? rank : null;
  }

  // Compatibility with the original keyboard helper. Lowercase c is Portuguese
  // copas here, NEVER feed canonical engine strings through this function.
  function normalizeKeyboardCard(token) {
    const text = String(token || '').trim().replace(/^10|^D/i, 'T');
    if (!/^[2-9TJQKA][ECOPshd]$/i.test(text)) return null;
    const suit = text[1].toUpperCase();
    return text[0].toUpperCase() + ({ S: 'E', H: 'C', D: 'O' }[suit] || suit);
  }
  function portugueseCard(token) {
    const text = String(token || '').trim().replace(/^10|^D/i, 'T').replace(/[♠♥♦♣]/g, (s) => SYMBOL_TO_PT[s]).toUpperCase();
    if (!/^[2-9TJQKA][ECOP]$/.test(text)) throw new Error(`Invalid card: ${token}. Use rank + E, C, O or P.`);
    return text;
  }
  function parsePortugueseCards(text) {
    const compact = String(text || '').replace(/[\s,;|/]+/g, '');
    const result = [];
    let i = 0;
    while (i < compact.length) {
      const length = compact.slice(i, i + 2) === '10' ? 3 : 2;
      result.push(portugueseCard(compact.slice(i, i + length)));
      i += length;
    }
    if (new Set(result).size !== result.length) throw new Error('Duplicate card in the entered text.');
    return result;
  }
  function toCanonical(token) {
    const card = portugueseCard(token);
    return card[0] + PT_TO_ENGINE[card[1]];
  }
  function fromCanonical(token) {
    const card = String(token || '').replace(/^10/, 'T');
    if (!/^[2-9TJQKA][shdc]$/i.test(card)) throw new Error(`Invalid canonical card: ${token}.`);
    return card[0].toUpperCase() + ENGINE_TO_PT[card[1].toLowerCase()];
  }
  function validCount(count) { return Number.isInteger(count) && [4, 5, 6].includes(count); }
  function normalizedCompat(token) {
    try { return portugueseCard(token); } catch { return normalizeKeyboardCard(token); }
  }

  class CardKeyboardState {
    constructor(count = 5) {
      if (!validCount(count)) throw new Error('Omaha accepts 4, 5 or 6 hole cards.');
      this.count = count;
      this.slots = Array(count + 5).fill(null);
      this.selected = 0;
      this.undoStack = [];
      this.error = '';
    }
    snapshot() { return { count: this.count, slots: [...this.slots], selected: this.selected }; }
    remember() {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > 160) this.undoStack.shift();
    }
    fail(message) { this.error = message; return false; }
    restore(snapshot) {
      if (!snapshot || !validCount(snapshot.count) || !Array.isArray(snapshot.slots) || snapshot.slots.length !== snapshot.count + 5) return this.fail('Invalid card draft.');
      const cards = snapshot.slots.map((c) => c === null ? null : normalizedCompat(c));
      if (cards.some((c, i) => snapshot.slots[i] !== null && !c) || new Set(cards.filter(Boolean)).size !== cards.filter(Boolean).length) return this.fail('Draft contains invalid or duplicate cards.');
      if (!Number.isInteger(snapshot.selected) || snapshot.selected < 0 || snapshot.selected >= cards.length) return this.fail('Invalid position in draft.');
      this.count = snapshot.count; this.slots = cards; this.selected = snapshot.selected; this.error = '';
      return true;
    }
    setCards(hero, board, remember = false) {
      if (!Array.isArray(hero) || !Array.isArray(board) || hero.length > this.count || board.length > 5) return this.fail(`Use up to ${this.count} hole cards and 5 community cards.`);
      const cards = [...hero, ...board].map(normalizedCompat);
      if (cards.some((c) => !c) || new Set(cards).size !== cards.length) return this.fail('Invalid or duplicate card between hand and board.');
      if (remember) this.remember();
      this.slots = [...cards.slice(0, hero.length), ...Array(this.count - hero.length).fill(null), ...cards.slice(hero.length), ...Array(5 - board.length).fill(null)];
      this.selected = this.slots.indexOf(null);
      if (this.selected < 0) this.selected = this.slots.length - 1;
      this.error = '';
      return true;
    }
    select(index) {
      if (!Number.isInteger(index) || index < 0 || index >= this.slots.length) return false;
      this.selected = index; this.error = ''; return true;
    }
    setCount(count, allowDiscard = false) {
      if (!validCount(count)) return this.fail('Invalid card count.');
      if (count === this.count) return true;
      if (count < this.count && this.slots.slice(count, this.count).some(Boolean) && !allowDiscard) return this.fail('The reduction would remove hole cards. Confirm before continuing.');
      this.remember();
      const hero = this.slots.slice(0, Math.min(count, this.count));
      const board = this.slots.slice(this.count);
      this.slots = [...hero, ...Array(count - hero.length).fill(null), ...board];
      const selected = this.selected >= this.count ? count + this.selected - this.count : Math.min(this.selected, count - 1);
      this.count = count; this.selected = selected; this.error = '';
      return true;
    }
    assign(token, remember = true) {
      const card = normalizedCompat(token);
      if (!card) return this.fail('Invalid card. Use rank and E/C/O/P suit notation.');
      if (this.slots.some((c, i) => c === card && i !== this.selected)) return this.fail(`${card} is already used in another position.`);
      if (this.slots[this.selected] !== card && remember) this.remember();
      this.slots[this.selected] = card;
      const next = this.slots.findIndex((c, i) => c === null && i > this.selected);
      const first = this.slots.indexOf(null);
      if (next >= 0) this.selected = next;
      else if (first >= 0) this.selected = first;
      this.error = '';
      return true;
    }
    paste(text) {
      let cards;
      try { cards = parsePortugueseCards(text); } catch (error) { return this.fail(error.message); }
      if (!cards.length) return this.fail('No cards to paste.');
      const available = this.slots.filter((c) => !c).length + (this.slots[this.selected] ? 1 : 0);
      if (cards.length > available) return this.fail('The text has more cards than the available slots. Nothing changed.');
      const candidate = new CardKeyboardState(this.count);
      candidate.restore(this.snapshot());
      for (const card of cards) if (!candidate.assign(card, false)) return this.fail(candidate.error + ' Nothing changed.');
      this.remember(); this.restore(candidate.snapshot()); return true;
    }
    removeSelected() {
      if (!this.slots[this.selected]) return false;
      this.remember(); this.slots[this.selected] = null; this.error = ''; return true;
    }
    undo() {
      const prior = this.undoStack.pop();
      return prior ? this.restore(prior) : false;
    }
    reset() {
      if (this.slots.some(Boolean)) this.remember();
      this.slots = Array(this.count + 5).fill(null); this.selected = 0; this.error = '';
    }
    cards() { return { hero: this.slots.slice(0, this.count).filter(Boolean), board: this.slots.slice(this.count).filter(Boolean) }; }
    validation() {
      const hero = this.slots.slice(0, this.count), board = this.slots.slice(this.count);
      if (hero.some((c) => !c)) return { valid: false, reason: `Complete all ${this.count} hole cards.` };
      const n = board.filter(Boolean).length;
      if (board.slice(0, n).some((c) => !c) || board.slice(n).some(Boolean)) return { valid: false, reason: 'There is a gap on the board. Fill the empty position without shifting the other cards.' };
      if (![0, 3, 4, 5].includes(n)) return { valid: false, reason: 'Complete the flop: the board must have 0, 3, 4 or 5 cards.' };
      return { valid: true, street: ({ 0: 'PREFLOP', 3: 'FLOP', 4: 'TURN', 5: 'RIVER' })[n] };
    }
    canonicalCards() {
      const valid = this.validation();
      if (!valid.valid) throw new Error(valid.reason);
      const { hero, board } = this.cards();
      return { variant: `PLO${this.count}_HIGH`, heroCards: hero.map(toCanonical), board: board.map(toCanonical), street: valid.street };
    }
    compactText() {
      const valid = this.validation(); if (!valid.valid) throw new Error(valid.reason);
      const { hero, board } = this.cards();
      return [hero.join(' '), board.slice(0, 3).join(' '), board[3], board[4]].filter(Boolean).join(' | ');
    }
    exportDraft() {
      return { schema: 'THEIBS_HAND_DRAFT_V1', variant: `PLO${this.count}_HIGH`, notation: 'canonical-s-h-d-c',
        heroCards: this.slots.slice(0, this.count).map((c) => c ? toCanonical(c) : null),
        board: this.slots.slice(this.count).map((c) => c ? toCanonical(c) : null),
        completeForAnalysis: this.validation().valid };
    }
  }
  return { CARD_RANKS, CARD_SUITS, CardKeyboardState, normalizeKeyboardRank, normalizeKeyboardCard, portugueseCard, parsePortugueseCards, toCanonical, fromCanonical };
});
