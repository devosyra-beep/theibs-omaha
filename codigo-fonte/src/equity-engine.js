const { makeDeck, normalizeCards, removeCards, combinations } = require('./cards');
const fast = require('./fast-evaluator');
const { holeCount } = require('./variants');
const { normalizeRanges, serializeRange } = require('./range-engine');

class Lcg {
  constructor(seed = 123456789) { this.state = Number(seed) >>> 0; }
  next() {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  pick(items) { return items[Math.floor(this.next() * items.length)]; }
}

function normalizedOpponentHands(opponentHands, count = 5) {
  if (!Array.isArray(opponentHands) || opponentHands.length === 0) throw new Error('opponentHands must contain at least one hand.');
  return opponentHands.map((hand) => {
    const normalized = normalizeCards(hand, 'opponent hand');
    if (normalized.length !== count) throw new Error(`Each PLO${count} opponent hand must contain ${count} cards.`);
    return normalized;
  });
}

function compareShowdown(hero, opponents, board) {
  return fast.showdown(hero,opponents,board);
}

function exactEquity(input) {
  fast.initialize();
  const hero = normalizeCards(input.heroCards, 'hero cards');
  const board = normalizeCards(input.board || [], 'board');
  const opponents = normalizedOpponentHands(input.opponentHands, holeCount(input.variant));
  const known = normalizeCards([...hero, ...opponents.flat(), ...board], 'all known cards');
  if (hero.length !== holeCount(input.variant)) throw new Error('Hero card count does not match variant.');
  const remaining = removeCards(makeDeck(), known);
  const need = 5 - board.length;
  if (need < 0 || need > remaining.length) throw new Error('Invalid board or card state.');
  const runouts = combinations(remaining, need);
  let wins = 0;
  let ties = 0;
  let equitySum = 0;
  for (const runout of runouts) {
    const result = compareShowdown(hero, opponents, [...board, ...runout]);
    if (result.heroWon) wins += 1;
    if (result.tie) ties += 1;
    equitySum += result.share;
  }
  return {
    method: 'EXACT',
    samples: runouts.length,
    seed: null,
    winRate: wins / runouts.length,
    tieRate: ties / runouts.length,
    equity: equitySum / runouts.length,
    confidenceInterval95: null,
    opponents: opponents.length
  };
}

function prepareRangeIds(range, blocked) {
  const valid=[];let totalWeight=0;
  for(let i=0;i<range.hands.length;i++) {
    const weight=range.normalizedWeights[i],hand=Uint8Array.from(range.hands[i],fast.cardId);
    if(weight>0&&hand.every(id=>!blocked[id])){valid.push({hand,weight});totalWeight+=weight;}
  }
  if(!valid.length)throw Error('No valid opponent range hand remains after blockers.');
  return {valid,totalWeight};
}
function sampleRangeIds(range,rng) {
  let target=rng.next()*range.totalWeight;
  for(let i=0;i<range.valid.length;i++) {
    target-=range.valid[i].weight;if(target<=0)return range.valid[i].hand;
  }
  return range.valid[range.valid.length-1].hand;
}

function monteCarloEquity(input) {
  const started=performance.now();
  const adaptive=input.samplingMode==='ADAPTIVE';
  fast.initialize();
  const hero = normalizeCards(input.heroCards, 'hero cards');
  const board = normalizeCards(input.board || [], 'board');
  normalizeCards([...hero, ...board], 'hero and board');
  if (hero.length !== holeCount(input.variant)) throw new Error('Hero card count does not match variant.');
  const ranges = normalizeRanges(input.opponentRanges, holeCount(input.variant));
  let samples = Number(input.samples ?? 5000);
  const requestedSamples=adaptive?500000:samples;
  if (!Number.isInteger(samples) || samples < 1 || samples > 50000) throw new Error('samples must be an integer between 1 and 50000.');
  if(adaptive)samples=requestedSamples;
  let completed=0,stopReason='SAMPLE_LIMIT',sequentialMargin=1;
  const call=Number(input.amountToCall),pot=Number(input.potBeforeAction);
  const rake=input.rake!==undefined&&input.rake!==null&&input.rake!==''?Number(input.rake):input.assumeNoRake===true?0:NaN;
  const threshold=call>0&&Number.isFinite(pot)&&Number.isFinite(rake)&&pot+call-rake>0?call/(pot+call-rake):null;
  if (![0, 3, 4, 5].includes(board.length)) throw new Error('Invalid board length.');
  if (52 - hero.length - ranges.length * holeCount(input.variant) < 5) throw new Error('Too many opponents for this deck.');
  const seed = Number(input.seed ?? 123456789);
  const rng = new Lcg(seed);
  const count=holeCount(input.variant),heroIds=Uint8Array.from(hero,fast.cardId),boardIds=new Uint8Array(5);
  boardIds.set(board.map(fast.cardId));
  const baseBlocked=new Uint8Array(52),blocked=new Uint8Array(52);
  for(const card of [...hero,...board])baseBlocked[fast.cardId(card)]=1;
  const explicit=ranges.filter(range=>range.kind!=='UNIFORM').map(range=>prepareRangeIds(range,baseBlocked));
  const uniformCount=ranges.length-explicit.length,opponents=Array.from({length:ranges.length},()=>new Uint8Array(count));
  const baseDeck=Uint8Array.from(Array.from({length:52},(_,id)=>id).filter(id=>!baseBlocked[id]));
  const remaining=new Uint8Array(52);let remainingCount=0;
  // Ordered deletion deliberately matches the old splice sampler and RNG stream.
  // A swap-delete is faster on some runtimes but would change seed reproducibility.
  const draw=()=>{const index=Math.floor(rng.next()*remainingCount),id=remaining[index];remaining.copyWithin(index,index+1,remainingCount);remainingCount--;return id;};
  const heroPairs=fast.preparePairsIds(heroIds),boardBuffer=fast.createBoardBuffer();
  let knownHeroScore;
  if(board.length===5){fast.prepareBoardIds(boardIds,boardBuffer);knownHeroScore=fast.scorePreparedPairs(heroPairs,boardBuffer);}
  let wins = 0;
  let ties = 0;
  let equitySum = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    let accepted=explicit.length===0;
    // Independent weighted draws with collision rejection preserve the joint
    // distribution. Drawing unknown hands first could consume known cards.
    for(let attempt=0;attempt<2000&&!accepted;attempt++) {
      blocked.set(baseBlocked);let collision=false;
      // Always draw every range before retrying: preserve independent joint draws,
      // conditional on no shared cards, rather than biasing later opponents.
      for(let r=0;r<explicit.length;r++) {
        const hand=sampleRangeIds(explicit[r],rng);opponents[r]=hand;
        for(let c=0;c<hand.length;c++){if(blocked[hand[c]])collision=true;blocked[hand[c]]=1;}
      }
      accepted=!collision;
    }
    if(!accepted) throw Error('Ranges incompatíveis entre si; nenhum sorteio conjunto válido foi encontrado.');
    if(explicit.length){remainingCount=0;for(let i=0;i<baseDeck.length;i++)if(!blocked[baseDeck[i]])remaining[remainingCount++]=baseDeck[i];}
    else {remaining.set(baseDeck);remainingCount=baseDeck.length;}
    for(let r=0;r<uniformCount;r++)for(let c=0;c<count;c++)opponents[explicit.length+r][c]=draw();
    for(let c=board.length;c<5;c++)boardIds[c]=draw();
    if(board.length!==5)fast.prepareBoardIds(boardIds,boardBuffer);
    const share=fast.showdownShareIds(heroPairs,opponents,boardBuffer,knownHeroScore);
    if(share>0)wins++;
    if(share>0&&share<1)ties++;
    equitySum+=share;
    completed++;
    if(adaptive&&(completed%256===0||completed===requestedSamples)){
      // Hoeffding at scheduled looks; alpha_k=.05/(k*(k+1)) sums to .05.
      // Unlike repeatedly checking a fixed-N normal interval, this permits
      // data-dependent stopping (under the model's IID sampling assumption).
      const look=Math.ceil(completed/256);
      sequentialMargin=Math.sqrt(Math.log(2*look*(look+1)/.05)/(2*completed));
      if(completed>=2048&&sequentialMargin<=.01){stopReason='PRECISION';break;}
      if(completed>=2048&&threshold!==null&&sequentialMargin<=.025&&Math.abs(equitySum/completed-threshold)>sequentialMargin){stopReason='CALL_EV_SIGN';break;}
      if(performance.now()-started>=2000){stopReason='TIME_BUDGET';break;}
    }
  }
  samples=completed;
  const estimate = equitySum / samples;
  // Shares include split pots (not only Bernoulli outcomes). Hoeffding applies
  // directly to independent bounded shares and cannot claim certainty at 0/1.
  const margin = adaptive?sequentialMargin:Math.sqrt(Math.log(40)/(2*samples));
  const publicRanges=ranges.map(serializeRange),elapsedMs=performance.now()-started;
  return {
    method: 'MONTE_CARLO',
    samples,
    seed,
    winRate: wins / samples,
    tieRate: ties / samples,
    equity: estimate,
    confidenceInterval95: [Math.max(0, estimate - margin), Math.min(1, estimate + margin)],
    intervalMethod:adaptive?'HOEFFDING_ALPHA_SPENDING':'HOEFFDING_FIXED_N',
    samplingMode:adaptive?'ADAPTIVE':'FIXED',
    elapsedMs,
    simulationsPerSecond:samples*1000/elapsedMs,
    measurementScope:'MONTE_CARLO_ENGINE_WALL_TIME',
    opponents: ranges.length,
    ranges: publicRanges
    ,...(adaptive?{requestedSamples,stopReason,targetMargin:.01,timeBudgetMs:2000}: {})
  };
}

function calculateEquity(input) {
  if (Array.isArray(input.opponentHands) && input.opponentHands.length > 0) {
    const boardLength = Array.isArray(input.board) ? input.board.length : 0;
    // Pré-flop has too many exact runouts for a responsive live workflow.
    if (boardLength < 3) {
      return monteCarloEquity({
        ...input,
        opponentRanges: input.opponentHands.map((hand) => ({ hands: [hand] })),
        samples: input.samples ?? 5000
      });
    }
    return exactEquity(input);
  }
  if (Array.isArray(input.opponentRanges) && input.opponentRanges.length > 0) return monteCarloEquity(input);
  throw new Error('Provide opponentHands or opponentRanges; equity without an assumption is not valid.');
}

module.exports = { calculateEquity, exactEquity, monteCarloEquity, Lcg };
