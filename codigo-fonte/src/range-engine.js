const { normalizeCards, cardCodes } = require('./cards');

const { holeCount } = require('./variants');

const RANGE_VERSION = '0.1.0';
const RANGE_SOURCE = 'THEIBS_STARTER_HEURISTIC';
const POSITIONS = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const ACTIONS = ['OPEN', 'DEFEND', '3BET', 'CALL', 'KNOWN_HAND'];

// These are explicit seed hands, not a solved PLO5 chart. They provide a
// reproducible starting point until a larger database or solver export exists.
const EARLY_OPEN = [
  ['As', 'Ah', 'Kd', 'Qd', 'Jc'],
  ['Ks', 'Kh', 'Qd', 'Jd', 'Tc'],
  ['As', 'Kd', 'Qd', 'Jc', 'Tc'],
  ['Ah', 'Ad', 'Kc', 'Qh', 'Jc']
];

const MIDDLE_OPEN = [
  ...EARLY_OPEN,
  ['As', 'Qs', 'Jd', 'Tc', '9c'],
  ['Kc', 'Qc', 'Jd', 'Td', '9h']
];

const LATE_OPEN = [
  ...MIDDLE_OPEN,
  ['9s', '8s', '7d', '6d', '5c'],
  ['As', '9s', '8d', '7d', '6c'],
  ['Ah', 'Qh', 'Jh', 'Td', '9c'],
  ['Ac', 'Kc', 'Jd', 'Td', '8h'],
  ['7s', '6s', '5d', '4d', '3c']
];

const SMALL_BLIND_DEFEND = [
  ...EARLY_OPEN,
  ['As', 'Qs', 'Jd', 'Tc', '9c'],
  ['Kc', 'Qc', 'Jd', 'Td', '9h']
];

const BIG_BLIND_DEFEND = [
  ...LATE_OPEN,
  ['Jh', 'Th', '9c', '8c', '7d'],
  ['6s', '5s', '4d', '3d', '2c']
];

const OPEN_BY_POSITION = {
  UTG: EARLY_OPEN,
  UTG1: EARLY_OPEN,
  UTG2: EARLY_OPEN,
  LJ: MIDDLE_OPEN,
  HJ: MIDDLE_OPEN,
  CO: LATE_OPEN,
  BTN: LATE_OPEN,
  SB: MIDDLE_OPEN,
  BB: EARLY_OPEN
};

const DEFEND_BY_POSITION = {
  UTG: EARLY_OPEN,
  UTG1: EARLY_OPEN,
  UTG2: EARLY_OPEN,
  LJ: MIDDLE_OPEN,
  HJ: MIDDLE_OPEN,
  CO: LATE_OPEN,
  BTN: LATE_OPEN,
  SB: SMALL_BLIND_DEFEND,
  BB: BIG_BLIND_DEFEND
};

function normalizeProfileValue(value, allowed, field) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!allowed.includes(normalized)) throw new Error(`Invalid ${field}: ${value}.`);
  return normalized;
}

function normalizeWeight(value, index) {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) throw new Error(`Invalid weight at index ${index}.`);
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight < 0) throw new Error(`Invalid weight at index ${index}.`);
  return weight;
}

function normalizeRange(range, index = 0, count = 5) {
  if (!range || typeof range !== 'object' || Array.isArray(range)) {
    throw new Error(`Range ${index + 1} must be an object.`);
  }
  if (range.kind === 'UNIFORM') return {
    kind:'UNIFORM', id:String(range.id || `unknown-${index+1}`), version:'1', source:'UNIFORM_UNKNOWN',
    position:null, action:null, note:'All legal hands are equally likely; the baseline model does not infer behavior.',
    hands:[], weights:[], normalizedWeights:[], totalWeight:1, handCount:null, holeCount:count
  };
  if (!Array.isArray(range.hands) || range.hands.length === 0) {
    throw new Error(`Range ${index + 1} must contain at least one hand.`);
  }
  const hands = range.hands.map((hand) => {
    const normalized = normalizeCards(hand, 'range hand');
    if (normalized.length !== count) throw new Error(`Each hand in a PLO${count} range must contain ${count} cards.`);
    return normalized;
  });
  if (range.weights !== undefined && !Array.isArray(range.weights)) throw new Error('weights must be an array.');
  const weights = range.weights === undefined
    ? hands.map(() => 1)
    : range.weights.map((weight, weightIndex) => normalizeWeight(weight, weightIndex));
  if (weights.length !== hands.length) throw new Error('weights must have the same length as hands.');
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) throw new Error('The range weight total must be finite and greater than zero.');
  const position = range.position == null ? null : normalizeProfileValue(range.position, POSITIONS, 'range position');
  const action = range.action == null ? null : normalizeProfileValue(range.action, ACTIONS, 'range action');
  const normalizedWeights = weights.map((weight) => weight / totalWeight);
  if (weights.some((weight, i) => weight > 0 && normalizedWeights[i] === 0)) throw new Error('Weights exceed numeric precision; rescale or simplify the range.');
  return {
    id: String(range.id || `range-${index + 1}`),
    version: String(range.version || RANGE_VERSION),
    source: String(range.source || 'USER_PROVIDED'),
    position,
    action,
    note: range.note == null ? null : String(range.note),
    hands,
    weights,
    normalizedWeights,
    totalWeight,
    handCount: hands.length
  };
}

function normalizeRanges(ranges, count = 5) {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    throw new Error('opponentRanges must contain at least one range.');
  }
  return ranges.map((range, index) => normalizeRange(range, index, count));
}

function serializeRange(range) {
  return {
    ...(range.kind === 'UNIFORM' ? {kind:'UNIFORM'} : {}),
    id: range.id,
    version: range.version,
    source: range.source,
    position: range.position,
    action: range.action,
    note: range.note,
    hands: range.hands.map((hand) => cardCodes(hand)),
    weights: [...range.weights],
    normalizedWeights: [...range.normalizedWeights],
    totalWeight: range.totalWeight,
    handCount: range.handCount
  };
}

function rangeHandsForProfile(position, action) {
  const catalog = action === 'DEFEND' ? DEFEND_BY_POSITION : OPEN_BY_POSITION;
  const hands = catalog[position];
  if (!hands) throw new Error(`No starter range exists for ${position}/${action}.`);
  return hands.map((hand) => [...hand]);
}

function getDefaultRange(profile = {}) {
  const profileObject = typeof profile === 'string' ? { position: profile } : profile;
  const position = normalizeProfileValue(profileObject.position, POSITIONS, 'range position');
  const action = normalizeProfileValue(profileObject.action || 'OPEN', ['OPEN', 'DEFEND'], 'range action');
  const hands = rangeHandsForProfile(position, action);
  const weights = hands.map((_, index) => Math.max(0.5, 1 - index * 0.05));
  return {
    id: `starter-${position.toLowerCase()}-${action.toLowerCase()}`,
    version: RANGE_VERSION,
    source: RANGE_SOURCE,
    position,
    action,
    note: 'Heuristic starter range for study; it is not a GTO solution.',
    hands,
    weights
  };
}

function listDefaultRangeProfiles() {
  return POSITIONS.flatMap((position) => ['OPEN', 'DEFEND'].map((action) => {
    const range = normalizeRange(getDefaultRange({ position, action }));
    return serializeRange(range);
  }));
}

function resolveProvidedRanges(input = {}) {
  const count = holeCount(input.variant || 'PLO5_HIGH');
  if (Array.isArray(input.opponentHands) && input.opponentHands.length > 0) {
    const ranges = input.opponentHands.map((hand, index) => normalizeRange({
      id: `known-hand-${index + 1}`,
      source: 'KNOWN_HAND',
      action: 'KNOWN_HAND',
      hands: [hand]
    }, index, count));
    return {
      mode: 'KNOWN_HAND',
      ranges,
      publicRanges: ranges.map(serializeRange),
      warnings: [],
      assumptions: ['Opponent hand(s) entered manually.']
    };
  }
  if (Array.isArray(input.opponentRanges) && input.opponentRanges.length > 0) {
    const ranges = normalizeRanges(input.opponentRanges, count);
    return {
      mode: 'EXPLICIT_RANGE',
      ranges,
      publicRanges: ranges.map(serializeRange),
      warnings: [],
      assumptions: ['Opponent range(s) entered manually; weights normalized.']
    };
  }
  if (input.opponentRangeProfile) {
    if (count !== 5) throw new Error('The starter catalog is available only for PLO5; enter an explicit hand or range for the selected variant.');
    const ranges = [normalizeRange(getDefaultRange(input.opponentRangeProfile))];
    return {
      mode: 'DEFAULT_PROFILE',
      ranges,
      publicRanges: ranges.map(serializeRange),
      warnings: ['Heuristic starter range: it is not a GTO solution and should be refined with table data.'],
      assumptions: [`Starter range ${ranges[0].position}/${ranges[0].action} used as an explicit assumption.`]
    };
  }
  throw new Error('Provide opponentHands, opponentRanges or opponentRangeProfile.');
}

function resolveOpponentRanges(input = {}) {
  const provided = input.opponentHands?.length || input.opponentRanges?.length || input.opponentRangeProfile;
  if (input.unknownOpponentModel !== 'UNIFORM') return resolveProvidedRanges(input);
  const count=holeCount(input.variant), opponents=Number(input.players)-1;
  if (!Number.isInteger(opponents)||opponents<1||(opponents+1)*count+5>52) throw Error('Invalid opponent count for this variant.');
  const model=provided ? resolveProvidedRanges(input) : {ranges:[],warnings:[],assumptions:[]};
  if(model.ranges.length>opponents) throw Error('More ranges were entered than opponents in the hand.');
  const ranges=[...model.ranges];
  while(ranges.length<opponents) ranges.push(normalizeRange({kind:'UNIFORM'},ranges.length,count));
  const unknown=ranges.filter(r=>r.kind==='UNIFORM').length;
  return { mode:unknown?'EXPLICIT_RANGE':model.mode,ranges,publicRanges:ranges.map(serializeRange),
    warnings:[...model.warnings,...(unknown?['Estimate against random hands; observed actions do not automatically calibrate ranges.']:[])],
    assumptions:[...model.assumptions,...(unknown?[`${unknown} unknown opponent(s) modeled with all legal hands equally likely.`]:[])] };
}

module.exports = {
  RANGE_VERSION,
  RANGE_SOURCE,
  POSITIONS,
  ACTIONS,
  normalizeRange,
  normalizeRanges,
  serializeRange,
  resolveOpponentRanges,
  getDefaultRange,
  listDefaultRangeProfiles
};
