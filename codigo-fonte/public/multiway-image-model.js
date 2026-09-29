/* Pure image review model. OCR text is evidence to review, never a ledger event. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TheibsImageModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // Starting regions only. Poker clients have multiple themes, sizes and seat layouts.
  const PROFILES = Object.freeze({
    GGPOKER: Object.freeze({ label: 'GGPoker', hero: [0.31, 0.70, 0.69, 0.96], board: [0.27, 0.34, 0.73, 0.66] }),
    POKERSTARS: Object.freeze({ label: 'PokerStars', hero: [0.31, 0.72, 0.69, 0.97], board: [0.27, 0.34, 0.73, 0.65] })
  });
  const suit = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c', E: 's', C: 'h', O: 'd', P: 'c', S: 's', H: 'h', D: 'd', s: 's', h: 'h', d: 'd', c: 'c' };
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function validZone(value) {
    return Array.isArray(value) && value.length === 4 && value.every(n => Number.isFinite(n) && n >= 0 && n <= 1) && value[2] - value[0] >= .04 && value[3] - value[1] >= .04;
  }
  function normalizeZone(value) {
    if (!Array.isArray(value) || value.length !== 4) return null;
    const zone = value.map(n => clamp(Number(n), 0, 1));
    return validZone(zone) ? zone : null;
  }
  function parseCard(token) {
    const cleaned = String(token || '').trim().replace(/^10/i, 'T');
    const match = cleaned.match(/^([2-9TJQKA])([♠♥♦♣ECOPSHDshdc])$/);
    return match ? match[1].toUpperCase() + suit[match[2]] : null;
  }
  function cardCandidates(detections) {
    const results = [];
    for (const item of detections || []) {
      const text = String(typeof item === 'string' ? item : item.text || '').trim();
      // A separated rank and suit can belong to different graphic objects.
      // Accept only adjacent characters in one OCR token, then require review.
      const tokens = text.match(/(?:10|[2-9TJQKA])[♠♥♦♣ECOPSHDshdc](?![a-z])/g) || [];
      for (const token of tokens) {
        const card = parseCard(token);
        if (card) results.push({ card, raw: token, confidence: typeof item.confidence === 'number' && Number.isFinite(item.confidence) ? clamp(item.confidence, 0, 1) : null });
      }
    }
    return results;
  }
  function reviewCards(detections, max) {
    const candidates = cardCandidates(detections), unique = [], seen = new Set();
    for (const item of candidates) if (!seen.has(item.card)) { unique.push(item); seen.add(item.card); }
    const cards = unique.slice(0, max);
    return {
      cards: cards.map(item => item.card), confidence: cards.length && cards.every(item => item.confidence !== null) ? Math.min(...cards.map(item => item.confidence)) : null,
      status: cards.length ? 'REVIEW_REQUIRED' : 'NOT_READ',
      issues: [
        ...(candidates.length !== unique.length ? ['OCR repeated a card; check the image.'] : []),
        ...(unique.length > max ? ['OCR found more cards than this field allows.'] : []),
        ...(!cards.length ? ['No complete rank and suit were read.'] : [])
      ]
    };
  }
  function validateReview({ variant, heroCards, board, existingBoard = [], phase, nextStreet, currentHero = [], scope = 'both' }) {
    const count = Number(String(variant).match(/^PLO([456])_HIGH$/)?.[1]);
    if (!count) return { ok: false, reason: 'Choose PLO4, PLO5 or PLO6.' };
    if (!Array.isArray(heroCards) || heroCards.length !== count || heroCards.some(card => !parseCard(card)))
      return { ok: false, reason: `Confirm all ${count} private cards.` };
    if (scope !== 'hero' && (!Array.isArray(board) || ![0, 3, 4, 5].includes(board.length) || board.some(card => !parseCard(card))))
      return { ok: false, reason: 'Board must contain 0, 3, 4 or 5 complete cards.' };
    if (scope === 'hero') board = existingBoard;
    const all = [...heroCards, ...board];
    if (new Set(all).size !== all.length) return { ok: false, reason: 'A card appears twice in the hand or board.' };
    if (existingBoard.some((card, index) => card !== board[index])) return { ok: false, reason: 'The image conflicts with the board already recorded.' };
    const heroChanged = JSON.stringify(heroCards) !== JSON.stringify(currentHero);
    const boardChanged = board.length > existingBoard.length;
    if (boardChanged && (phase !== 'WAIT_BOARD' || board.length !== existingBoard.length + (nextStreet === 'FLOP' ? 3 : 1)))
      return { ok: false, reason: 'Record the observed actions until the next street is ready; image reading cannot invent them.' };
    return { ok: true, heroChanged, boardChanged, addedBoard: board.slice(existingBoard.length) };
  }
  return { PROFILES, normalizeZone, parseCard, cardCandidates, reviewCards, validateReview };
});
