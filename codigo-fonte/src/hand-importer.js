const { normalizeGameState } = require('./game-state');
const { legalActions } = require('./action-validator');
const { normalizeCards } = require('./cards');

const { VARIANTS, holeCount } = require('./variants');

const RIGHTS = new Set(['USER_OWNED', 'CC0', 'MIT', 'EXPLICIT_PERMISSION']);

function importHands(records, metadata = {}, existingIds = new Set()) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 100) throw new Error('Envie entre 1 e 100 mãos em formato JSON canônico.');
  const source = String(metadata.source || '').trim();
  const rights = String(metadata.rights || '').toUpperCase();
  if (!source || source.length > 200) throw new Error('Origem dos dados é obrigatória.');
  if (!RIGHTS.has(rights) || metadata.rightsConfirmed !== true) throw new Error('Confirme os direitos de uso dos dados antes da importação.');
  const seen = new Set(existingIds);
  const accepted = [];
  const rejected = [];
  records.forEach((raw, index) => {
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Mão deve ser objeto.');
      const id = String(raw.id || '').trim();
      if (!id || id.length > 100 || seen.has(id)) throw new Error('ID ausente ou duplicado.');
      if (!Object.hasOwn(VARIANTS, raw.variant)) throw new Error('Declare PLO4_HIGH, PLO5_HIGH ou PLO6_HIGH explicitamente.');
      const state = normalizeGameState(raw);
      if (!state.valid) throw new Error(state.errors.join(' '));
      if (state.state.position === null || state.state.players === null || state.state.effectiveStack === null) throw new Error('Posição, jogadores e stack são obrigatórios.');
      if (!state.state.knownInformation.pot || !state.state.knownInformation.amountToCall) throw new Error('Pote e valor para pagar são obrigatórios.');
      const action = raw.chosenAction == null ? null : String(raw.chosenAction).toUpperCase();
      if (action && !legalActions(state.normalizedInput).includes(action)) throw new Error('Ação escolhida incompatível com o estado.');
      if (raw.opponentCards) {
        const opponent = normalizeCards(raw.opponentCards, 'opponentCards');
        if (opponent.length !== holeCount(raw.variant)) throw new Error('Número de cartas do oponente incompatível com a variante.');
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
