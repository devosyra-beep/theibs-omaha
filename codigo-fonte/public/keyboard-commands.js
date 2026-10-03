/* Physical keys -> semantic commands. No DOM and no calculation rules. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TheibsKeyboardCommands = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const common = Object.freeze({
    ArrowLeft: 'PREVIOUS_CARD', ArrowRight: 'NEXT_CARD', ArrowUp: 'PREVIOUS_PLAYER', ArrowDown: 'NEXT_PLAYER',
    Enter: 'CONFIRM', Backspace: 'BACKSPACE', Delete: 'REMOVE_CARD', Escape: 'CANCEL', "'": 'NEW_GAME', F1: 'HELP',
    F: 'FOLD', G: 'MATCH', H: 'AGGRESSIVE'
  });
  // E/C/O/P remain stable in both languages: H is reserved for Bet/Raise,
  // and C never silently changes from hearts to clubs in existing drafts.
  const suits = Object.freeze({ E: 'E', C: 'C', O: 'O', P: 'P' });
  const ranks = Object.freeze(Object.fromEntries([... 'AKQJT98765432'].map(rank => [rank, rank]).concat([['D', 'T']])));
  const BINDINGS = Object.freeze({
    'pt-BR': Object.freeze({ keys: common, ranks, suits, ten: 'D',
      rankNames: Object.freeze({ A: 'Ás', T: 'Dez', J: 'Valete', Q: 'Dama', K: 'Rei' }),
      suitNames: Object.freeze({ E: 'Espadas', C: 'Copas', O: 'Ouros', P: 'Paus' }), newGame: 'Nova mão' }),
    'en-US': Object.freeze({ keys: common, ranks, suits, ten: 'T',
      rankNames: Object.freeze({ A: 'Ace', T: 'Ten', J: 'Jack', Q: 'Queen', K: 'King' }),
      suitNames: Object.freeze({ E: 'Spades', C: 'Hearts', O: 'Diamonds', P: 'Clubs' }), newGame: 'New Game' })
  });
  const locale = language => /^pt/i.test(language || '') ? 'pt-BR' : 'en-US';
  function canHandleKey(event, context = {}) {
    if(context.enabled===false||context.hidden||context.dialog||context.editing||context.nativeControl||event.defaultPrevented||event.isComposing||event.keyCode===229)return false;
    if(event.key==='Enter'&&event.shiftKey)return false;
    if(event.repeat&&!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return false;
    return true;
  }
  function resolveKey(event, language, pending = {}) {
    if (event.isComposing || event.altKey) return null;
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    if (event.ctrlKey || event.metaKey) {
      return ({ Z: { type: 'UNDO_CARDS' }, C: { type: 'COPY_CARDS' }, S: { type: 'EXPORT_CARDS' },
        1: { type: 'SELECT_STREET', street: 'PREFLOP' }, 2: { type: 'SELECT_STREET', street: 'FLOP' },
        3: { type: 'SELECT_STREET', street: 'TURN' }, 4: { type: 'SELECT_STREET', street: 'RIVER' } })[key] || null;
    }
    const config = BINDINGS[locale(language)];
    if (pending.ten && key === '0') return { type: 'CARD_RANK', rank: 'T' };
    if (config.keys[key]) return { type: config.keys[key] };
    if (key === '1') return { type: 'CARD_TEN_PREFIX' };
    if (config.ranks[key]) return { type: 'CARD_RANK', rank: config.ranks[key] };
    if (pending.rank && config.suits[key]) return { type: 'CARD_SUIT', suit: config.suits[key] };
    return null;
  }
  class CommandQueue {
    constructor(onError = () => {}) { this.tail = Promise.resolve(); this.onError = onError; this.size = 0; }
    push(operation) {
      this.size++;
      const task = this.tail.then(operation);
      this.tail = task.catch(this.onError).finally(() => { this.size--; });
      return task;
    }
    idle() { return this.tail; }
  }
  return { BINDINGS, locale, resolveKey, canHandleKey, CommandQueue };
});
