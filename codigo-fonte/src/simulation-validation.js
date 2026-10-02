'use strict';
// A held-out numerical check, not another strategic engine. The response
// distribution is deliberately shared; sampling, continuation traversal and
// showdown evaluation are independent of evaluateMultiway's implementation.
const {createHash} = require('node:crypto');
const {prepare} = require('./multiway-compute-request');
const {evaluateContinuation} = require('./continuation-strategy');
const {replay} = require('./hand-flow');
const {makeDeck, cardCodes, normalizeCards} = require('./cards');
const {evaluateOmaha, compareScores} = require('./evaluator');
const {policyDistribution, MODEL} = require('./multiway-evaluator');
const VERSION = 'SIMULATION_VALIDATION_V1';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const round = n => Math.round(n * 100) / 100;
function random(seed, index) {
  let counter = 0, words = [], cursor = 0;
  return () => {
    if (cursor === words.length) {
      const hex = hash([VERSION, 'HELD_OUT_WORLD', seed, index, counter++]);
      words = Array.from({length:8}, (_, i) => parseInt(hex.slice(i * 8, i * 8 + 8), 16)); cursor = 0;
    }
    return words[cursor++] / 0x100000000;
  };
}
function context(payload, options = {}) {
  // This release checks the existing Simulation reference: uniform priors,
  // no learned profiles and no fees. Other assumptions must not be silently
  // compared against this reference.
  const raw = payload?.multiwayEvaluation;
  if (!raw || raw.assumeNoRake !== true || raw.rake != null || raw.rakeSchedule != null ||
      raw.profileSnapshot != null || raw.ranges?.length) throw Error('Batch validation currently supports Simulation uniform priors, reference responses and zero rake only.');
  const prepared = prepare(payload, 'FINAL');
  if (prepared.blocked) throw Error('Capture a complete pending Hero decision for batch validation.');
  const input = prepared.input.multiwayEvaluation, config = input.config, events = input.events;
  const state = replay(config, events);
  if (state.actor !== state.heroId || state.phase !== 'BETTING') throw Error('A pending Hero decision is required.');
  normalizeCards([...config.heroCards, ...state.board]);
  const worlds = Number(options.worlds ?? 128), budgetMs = Number(options.budgetMs ?? 30000), seed = options.seed;
  if (!Number.isInteger(worlds) || worlds < 32 || worlds > 512) throw Error('Choose 32 to 512 validation worlds per decision.');
  if (!Number.isFinite(budgetMs) || budgetMs < 1000 || budgetMs > 60000) throw Error('Choose a validation compute budget from 1 to 60 seconds.');
  if (typeof seed !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(seed)) throw Error('A separate validation seed is required.');
  const candidates = state.legal.actions.filter(a => a !== 'FOLD' || state.legal.toCall > 0)
    .filter(a => a !== 'BET' && a !== 'RAISE').map(action => ({action, size:null, optionId:action}));
  const aggression = state.legal.actions.find(a => a === 'BET' || a === 'RAISE');
  if (aggression) {
    const sizes = [state.legal.minTo, round((state.legal.minTo + state.legal.maxTo) / 2), state.legal.maxTo];
    if (input.chosenSize != null && input.chosenSize !== '') sizes.push(Number(input.chosenSize));
    for (const size of new Set(sizes)) candidates.push({action:aggression, size, optionId:`${aggression}:${size.toFixed(2)}`});
  }
  for (const row of candidates) replay(config, [...events, {type:'ACT', actor:state.heroId, action:row.action, ...(row.size == null ? {} : {to:row.size})}]);
  return {input:prepared.input, editEpoch:prepared.observed.multiway.editEpoch, config, events, state, candidates, worlds, budgetMs, seed,
    lower:-state.players[state.heroId].stack,
    upper:state.pot + state.players.filter(p => !p.hero).reduce((n,p) => n + p.stack, 0),
    observed:events.map((event,i) => event.type === 'ACT' && event.actor !== state.heroId ? {event,state:replay(config,events.slice(0,i))} : null).filter(Boolean),
    fingerprint:hash({version:VERSION, model:MODEL, input:prepared.input})};
}
function draw(ctx, index) {
  const next = random(ctx.seed, index), known = new Set([...ctx.config.heroCards, ...ctx.state.board]);
  const deck = cardCodes(makeDeck()).filter(card => !known.has(card));
  // Full Fisher-Yates, independent of the forecast's LCG and drawWorld.
  for (let i = deck.length - 1; i > 0; i--) {const j = Math.floor(next() * (i + 1)); [deck[i],deck[j]] = [deck[j],deck[i]];}
  const hands = {[ctx.state.heroId]:ctx.config.heroCards}; let cursor = 0;
  for (const player of ctx.state.players) if (!player.hero) {hands[player.id] = deck.slice(cursor, cursor + ctx.config.heroCards.length); cursor += ctx.config.heroCards.length;}
  const board = [...ctx.state.board, ...deck.slice(cursor, cursor + 5 - ctx.state.board.length)];
  let weight = 1;
  for (const observed of ctx.observed) weight *= policyDistribution({state:observed.state,cards:hands[observed.event.actor],profile:null}).probabilities[observed.event.action];
  if (!(weight > 0 && weight <= 1)) throw Error('The reference policy cannot represent this recorded history.');
  return {hands,board,weight};
}
function simulate(ctx, candidate, world, index, response) {
  const events = ctx.events.slice(), hero = ctx.state.heroId, stack = ctx.state.players[hero].stack;
  // Common random streams across alternatives reduce variance without
  // selecting favorable deals. Every completed world contains every action.
  const next = random(ctx.seed + '-continuation', index);
  const advance = event => {events.push(event); return replay(ctx.config, events);};
  let state = advance({type:'ACT',actor:hero,action:candidate.action,...(candidate.size == null ? {} : {to:candidate.size})});
  for (let step = 0; step < 160; step++) {
    if (state.phase === 'FINISHED' || state.players[hero].folded) return round(state.players[hero].stack - stack);
    if (state.phase === 'WAIT_BOARD') {
      state = advance({type:'BOARD',cards:world.board.slice(0,{FLOP:3,TURN:4,RIVER:5}[state.nextStreet])}); continue;
    }
    if (state.phase === 'SHOWDOWN') {
      // Independent, exact 2-hole + 3-board enumeration. Never use the
      // forecast's lookup-table scores to judge a validation payout.
      const scores = Object.fromEntries(state.players.filter(p => !p.folded).map(p => [p.id,evaluateOmaha(world.hands[p.id],world.board).score]));
      const winners = state.pots.map(pot => {
        let best = scores[pot.eligible[0]];
        for (const id of pot.eligible) if (compareScores(scores[id],best) > 0) best = scores[id];
        return pot.eligible.filter(id => compareScores(scores[id],best) === 0);
      });
      state = advance({type:'SETTLE',winners,rake:0}); continue;
    }
    let choice;
    if (response) choice = response(state, world);
    else {
      const probabilities = policyDistribution({state,cards:world.hands[state.actor],profile:null}).probabilities;
      let roll = next(), action = Object.keys(probabilities).at(-1);
      for (const [name,p] of Object.entries(probabilities)) {roll -= p; if (roll <= 0) {action = name; break;}}
      choice = {action, ...(['BET','RAISE'].includes(action) ? {to:round(state.legal.minTo + next() * (state.legal.maxTo - state.legal.minTo))} : {})};
    }
    state = advance({type:'ACT',actor:state.actor,...choice});
  }
  throw Error('A validation continuation exceeded its action limit; its incomplete world was discarded.');
}
function begin(payload, options) {
  const ctx = context(payload, options), start = performance.now();
  require('./fast-evaluator').initialize();
  const prediction = evaluateContinuation(ctx.input);
  const predicted = prediction.ev?.candidates || [];
  if (predicted.length !== ctx.candidates.length || ctx.candidates.some((r,i) => r.optionId !== predicted[i].optionId)) throw Error('Forecast and validation sizing grids differ.');
  return {schema:VERSION, model:MODEL, mathematicalStatus:'HEURISTIC', source:'SIMULATION_ONLY',
    fingerprint:ctx.fingerprint, publicInput:ctx.input, editEpoch:ctx.editEpoch, seed:ctx.seed, requestedWorlds:ctx.worlds, budgetMs:ctx.budgetMs,
    computeMs:performance.now() - start, predictionMs:performance.now() - start,
    prediction:{fingerprint:prediction.multiwayEvaluation?.fingerprint, samples:prediction.multiwayEvaluation?.samples || 0,
      stopReason:prediction.multiwayEvaluation?.stopReason, candidates:predicted.map(r => ({...r})), precision:prediction.ev?.decisionPrecision || null},
    count:0, sumWeight:0, sumWeightSquared:0, sums:ctx.candidates.map(() => 0),
    status:'RUNNING', checkpoints:[], lastLeader:null, leaderChanges:0};
}
function bounds(ctx, batch, i) {
  if (ctx.candidates[i].action === 'FOLD') return [0,0];
  if (!batch.count || !(batch.sumWeight > 0)) return null;
  const denominator = batch.sumWeight / batch.count;
  const numerator = (batch.sums[i] - ctx.lower * batch.sumWeight) / (ctx.upper - ctx.lower) / batch.count;
  // A simultaneous bounded numerator/denominator bound, with a union over
  // all actions, both independent estimates and every allowed stopping count.
  // This is model-conditional Monte Carlo uncertainty, not NashConv or GTO.
  const radius = Math.sqrt(Math.log(8 * (ctx.candidates.length + 1) * ctx.worlds * 8 / .05) / (2 * batch.count));
  return [ctx.lower + Math.max(0,(numerator-radius)/(denominator+radius)) * (ctx.upper-ctx.lower),
    ctx.lower + (denominator > radius ? Math.min(1,(numerator+radius)/(denominator-radius)) : 1) * (ctx.upper-ctx.lower)];
}
function result(ctx, batch) {
  const bb = ctx.state.bigBlind;
  const rows = ctx.candidates.map((candidate,i) => {
    const forecast = batch.prediction.candidates[i], estimateBB = forecast.status === 'MODELED' && Number.isFinite(forecast.ev) ? forecast.ev/bb : null;
    const predictionBoundsBB = estimateBB == null ? null : forecast.confidenceInterval95?.map(n => n/bb) || null;
    const meanBB = batch.count && batch.sumWeight > 0 ? batch.sums[i]/batch.sumWeight/bb : null, boundsBB = bounds(ctx,batch,i)?.map(n => n/bb) || null;
    const differenceBB = meanBB == null || estimateBB == null ? null : meanBB - estimateBB;
    const differenceBoundsBB = boundsBB && predictionBoundsBB ? [boundsBB[0]-predictionBoundsBB[1],boundsBB[1]-predictionBoundsBB[0]] : null;
    return {...candidate,estimateBB,predictionBoundsBB,meanBB,boundsBB,differenceBB,differenceBoundsBB,
      comparison:!differenceBoundsBB ? 'UNAVAILABLE' : candidate.action === 'FOLD' ? 'EXACT_REFERENCE' : differenceBoundsBB[0] > 0 || differenceBoundsBB[1] < 0 ? 'REVIEW_DIFFERENCE' : 'OVERLAPPING_BOUNDS'};
  });
  const ranked = rows.filter(row => Number.isFinite(row.meanBB)).sort((a,b) => b.meanBB-a.meanBB), leader = ranked[0];
  const certified = !!leader && rows.length > 1 && rows.every(row => row.optionId === leader.optionId || row.boundsBB && leader.boundsBB && leader.boundsBB[0] > row.boundsBB[1]);
  return {rows, leader:leader?.optionId || null, leaderCertified:certified,
    effectiveSamples:batch.sumWeight ? batch.sumWeight**2/batch.sumWeightSquared : 0,
    state:{variant:ctx.config.variant,street:ctx.state.street,playerCount:ctx.state.players.length,pot:ctx.state.pot,bigBlind:bb,revisionKey:ctx.input.multiwayEvaluation.revisionKey},
    scope:'FIXED_REFERENCE_POLICY_UNIFORM_PRIORS_ZERO_RAKE_INCREMENTAL_UTILITY',
    boundMethod:'SIMULTANEOUS_BOUNDED_WEIGHTED_RATIO', confidenceLevel:.95, differenceConfidenceAtLeast:.90};
}
function step(batch, maxWorlds = 4, sliceMs = 120) {
  const ctx = context({multiway:{enabled:true,schemaVersion:1,editEpoch:batch.editEpoch,handId:batch.publicInput.multiwayEvaluation.handId,
    config:batch.publicInput.multiwayEvaluation.config,events:batch.publicInput.multiwayEvaluation.events},multiwayEvaluation:{assumeNoRake:true,chosenSize:batch.publicInput.multiwayEvaluation.chosenSize}},
    {worlds:batch.requestedWorlds,budgetMs:batch.budgetMs,seed:batch.seed});
  if (batch.fingerprint !== ctx.fingerprint) throw Error('The validation state or model changed; start a new batch.');
  if (!Number.isInteger(maxWorlds) || maxWorlds < 1 || maxWorlds > 8) throw Error('Invalid validation slice.');
  if (batch.status !== 'RUNNING') return batch;
  const start = performance.now();
  for (let i = 0; i < maxWorlds && batch.count < ctx.worlds; i++) {
    if (batch.computeMs + performance.now()-start >= ctx.budgetMs) break;
    const world = draw(ctx,batch.count);
    const values = ctx.candidates.map(row => row.action === 'FOLD' ? 0 : simulate(ctx,row,world,batch.count));
    batch.count++; batch.sumWeight += world.weight; batch.sumWeightSquared += world.weight**2;
    values.forEach((value,index) => {batch.sums[index] += world.weight * value;});
    if (performance.now()-start >= sliceMs) break;
  }
  batch.computeMs += performance.now()-start;
  batch.status = batch.count === ctx.worlds ? 'COMPLETE' : batch.computeMs >= ctx.budgetMs ? 'PARTIAL_BUDGET' : 'RUNNING';
  batch.summary = result(ctx,batch);
  if (batch.lastLeader && batch.summary.leader !== batch.lastLeader) batch.leaderChanges++;
  batch.lastLeader = batch.summary.leader;
  batch.checkpoints.push({worlds:batch.count,computeMs:batch.computeMs,leader:batch.lastLeader,certified:batch.summary.leaderCertified,
    evBB:batch.summary.rows.map(row => row.meanBB)});
  batch.checkpoints = batch.checkpoints.slice(-128);
  return batch;
}
module.exports = {VERSION,MODEL,begin,step,_testing:{context,draw,simulate,result,bounds,random}};
