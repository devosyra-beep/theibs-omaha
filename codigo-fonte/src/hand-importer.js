const { normalizeGameState } = require('./game-state');
const { legalActions } = require('./action-validator');
const { normalizeCards } = require('./cards');

const { VARIANTS, holeCount } = require('./variants');

const RIGHTS = new Set(['USER_OWNED', 'CC0', 'MIT', 'EXPLICIT_PERMISSION']);

function importHands(records, metadata = {}, existingIds = new Set()) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 100) throw new Error('Provide 1 to 100 hands in canonical JSON format.');
  const source = String(metadata.source || '').trim();
  const rights = String(metadata.rights || '').toUpperCase();
  if (!source || source.length > 200) throw new Error('Data source is required.');
  if (!RIGHTS.has(rights) || metadata.rightsConfirmed !== true) throw new Error('Confirm your rights to use the data before importing.');
  const seen = new Set(existingIds);
  const accepted = [];
  const rejected = [];
  records.forEach((raw, index) => {
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Hand must be an object.');
      const id = String(raw.id || '').trim();
      if (!id || id.length > 100 || seen.has(id)) throw new Error('Missing or duplicate ID.');
      if (!Object.hasOwn(VARIANTS, raw.variant)) throw new Error('Specify PLO4_HIGH, PLO5_HIGH, or PLO6_HIGH explicitly.');
      const state = normalizeGameState(raw);
      if (!state.valid) throw new Error(state.errors.join(' '));
      if (state.state.position === null || state.state.players === null || state.state.effectiveStack === null) throw new Error('Position, players, and stack are required.');
      if (!state.state.knownInformation.pot || !state.state.knownInformation.amountToCall) throw new Error('Pot and call amount are required.');
      const action = raw.chosenAction == null ? null : String(raw.chosenAction).toUpperCase();
      if (action && !legalActions(state.normalizedInput).includes(action)) throw new Error('Chosen action is incompatible with the current state.');
      if (raw.opponentCards) {
        const opponent = normalizeCards(raw.opponentCards, 'opponentCards');
        if (opponent.length !== holeCount(raw.variant)) throw new Error('Opponent card count is incompatible with the variant.');
        normalizeCards([...state.state.heroCards, ...state.state.board, ...opponent.map((card) => card.code)], 'all cards');
      }
      seen.add(id);
      accepted.push({ id, variant: raw.variant, source, rights, state: state.state, chosenAction: action,
        opponentCards: raw.opponentCards || null, decisionQuality: 'UNVERIFIED', importedAt: new Date().toISOString() });
    } catch (error) {
      rejected.push({ index, id: raw?.id || null, reason: error.message });
    }
  });
  return { accepted, rejected };
}

module.exports = { importHands };
