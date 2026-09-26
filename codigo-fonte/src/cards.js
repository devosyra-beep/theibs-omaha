const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['c', 'd', 'h', 's'];
const SUIT_ALIASES = { c: 'c', d: 'd', h: 'h', s: 's', e: 's', p: 'c', o: 'd', E: 's', P: 'c', C: 'h', O: 'd' };
const RANK_VALUE = Object.fromEntries(RANKS.map((rank, index) => [rank, index + 2]));

function parseCard(value) {
  if (typeof value !== 'string') throw new Error('Card must be a string.');
  const token = value.trim().replace(/^10/i, 'T');
  if (!/^(?:[2-9TJQKA])[cdhspeo]$/i.test(token)) {
    throw new Error(`Invalid card: ${value}`);
  }
  const rank = token[0].toUpperCase();
  const suit = SUIT_ALIASES[token[1]] || SUIT_ALIASES[token[1].toLowerCase()];
  return { rank, suit, value: RANK_VALUE[rank], code: `${rank}${suit}` };
}

function normalizeCards(values, label = 'cards') {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array.`);
  const cards = values.map((value) => {
    if (typeof value === 'string') return parseCard(value);
    if (value && typeof value.code === 'string') return parseCard(value.code);
    throw new Error('Card must be a string or a parsed card object.');
  });
  const seen = new Set();
  for (const card of cards) {
    if (seen.has(card.code)) throw new Error(`Duplicate card: ${card.code}`);
    seen.add(card.code);
  }
  return cards;
}

function makeDeck() {
  return RANKS.flatMap((rank) => SUITS.map((suit) => parseCard(`${rank}${suit}`)));
}

function removeCards(deck, cards) {
  const blocked = new Set(cards.map((card) => typeof card === 'string' ? parseCard(card).code : card.code));
  return deck.filter((card) => !blocked.has(card.code));
}

function combinations(items, choose) {
  if (!Number.isInteger(choose) || choose < 0 || choose > items.length) return [];
  const result = [];
  function visit(start, current) {
    if (current.length === choose) {
      result.push(current.slice());
      return;
    }
    const need = choose - current.length;
    for (let index = start; index <= items.length - need; index += 1) {
      current.push(items[index]);
      visit(index + 1, current);
      current.pop();
    }
  }
  visit(0, []);
  return result;
}

function cardCodes(cards) {
  return cards.map((card) => typeof card === 'string' ? parseCard(card).code : card.code);
}

module.exports = {
  RANKS,
  SUITS,
  SUIT_ALIASES,
  RANK_VALUE,
  parseCard,
  normalizeCards,
  makeDeck,
  removeCards,
  combinations,
  cardCodes
};
