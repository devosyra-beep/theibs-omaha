'use strict';
// Internal hot path: callers validate cards once, before sampling. The public
// evaluator remains the readable reference and supplies the compact tables.
const { evaluateFive } = require('./evaluator');
const primes=[2,3,5,7,11,13,17,19,23,29,31,37,41];
const ranks='23456789TJQKA', suits='cdhs';
const rankScores=new Map(), flushScores=new Map();
// Compact open-addressed table: 256 KiB, not millions of five-card objects.
// Prime products are exact integers; hashing is only for finding their slot.
const rankKeys=new Uint32Array(32768),rankValues=new Uint32Array(32768);
function rankSlot(product){return Math.imul(product,0x9e3779b1)>>>17;}
function numericRankScore(product){
  let slot=rankSlot(product);
  while(rankKeys[slot]!==product){if(rankKeys[slot]===0)return undefined;slot=(slot+1)&32767;}
  return rankValues[slot];
}
let initialized=false;
function packScore(score) {
  let result=0;
  for(let i=0;i<6;i++)result=result*16+(score[i]||0);
  return result;
}
function initialize() {
  if(initialized)return;
  const selected=[];
  function visit(start){
    if(selected.length===5){
      const counts=Array(13).fill(0),cards=[];let product=1;
      for(const r of selected){if(counts[r]===4)return;cards.push(ranks[r]+suits[counts[r]++]);product*=primes[r];}
      // Five different ranks initially all get clubs; make this table nonflush.
      if(new Set(selected).size===5){cards[0]=ranks[selected[0]]+'d';flushScores.set(product,packScore(evaluateFive(selected.map(r=>ranks[r]+'c')).score));}
      const packed=packScore(evaluateFive(cards).score);rankScores.set(product,packed);
      let slot=rankSlot(product);while(rankKeys[slot]&&rankKeys[slot]!==product)slot=(slot+1)&32767;
      rankKeys[slot]=product;rankValues[slot]=packed;return;
    }
    for(let r=start;r<13;r++){selected.push(r);visit(r);selected.pop();}
  }
  visit(0);initialized=true;
}
function fiveScore(a,b,c,d,e) {
  const product=primes[a.value-2]*primes[b.value-2]*primes[c.value-2]*primes[d.value-2]*primes[e.value-2];
  const flush=a.suit===b.suit&&a.suit===c.suit&&a.suit===d.suit&&a.suit===e.suit;
  return (flush?flushScores:rankScores).get(product);
}
function omahaScore(hero,board) {
  let best=-1;
  for(let a=0;a<hero.length-1;a++)for(let b=a+1;b<hero.length;b++)
    for(let x=0;x<board.length-2;x++)for(let y=x+1;y<board.length-1;y++)for(let z=y+1;z<board.length;z++){
      const score=fiveScore(hero[a],hero[b],board[x],board[y],board[z]);
      if(score>best)best=score;
    }
  return best;
}
function showdown(hero,opponents,board) {
  const heroScore=omahaScore(hero,board);let winners=1;
  for(const hand of opponents){const score=omahaScore(hand,board);if(score>heroScore)return {heroWon:false,tie:false,share:0};if(score===heroScore)winners++;}
  return {heroWon:true,tie:winners>1,share:1/winners};
}
// IDs follow makeDeck(): rank * 4 + suit (clubs, diamonds, hearts, spades).
// Public parsing/validation stays outside this allocation-free sampling path.
const cardPrimes=Uint8Array.from({length:52},(_,id)=>primes[id>>>2]);
function cardId(card) { return (card.value-2)*4+suits.indexOf(card.suit); }
function createBoardBuffer() { return {products:new Uint32Array(10),suits:new Uint8Array(10),length:0}; }
function prepareBoardIds(board,target=createBoardBuffer()) {
  const products=target.products,tripleSuits=target.suits;
  let i=0,seenRanks=0,paired=false;
  for(let c=0;c<board.length;c++){const bit=1<<(board[c]>>>2);if(seenRanks&bit)paired=true;seenRanks|=bit;}
  for(let a=0;a<board.length-2;a++)for(let b=a+1;b<board.length-1;b++)for(let c=b+1;c<board.length;c++) {
    const x=board[a],y=board[b],z=board[c];
    const product=cardPrimes[x]*cardPrimes[y]*cardPrimes[z],suit=(x&3)===(y&3)&&(x&3)===(z&3)?x&3:4;
    // Equivalent rank triples may repeat on paired boards. Suit possibilities
    // stay distinct, so no legal flush/straight-flush candidate is removed.
    let duplicate=false;
    if(paired)for(let t=0;t<i;t++)if(products[t]===product&&tripleSuits[t]===suit){duplicate=true;break;}
    if(!duplicate){products[i]=product;tripleSuits[i]=suit;i++;}
  }
  target.length=i;return target;
}
function preparePairsIds(hand) {
  const length=hand.length*(hand.length-1)/2,products=new Uint16Array(length),pairSuits=new Uint8Array(length);let i=0;
  for(let a=0;a<hand.length-1;a++)for(let b=a+1;b<hand.length;b++){
    products[i]=cardPrimes[hand[a]]*cardPrimes[hand[b]];
    pairSuits[i]=(hand[a]&3)===(hand[b]&3)?hand[a]&3:5;i++;
  }
  return {products,suits:pairSuits,length};
}
function scorePreparedPairs(pairs,board) {
  const pairProducts=pairs.products,pairSuits=pairs.suits,boardProducts=board.products,boardSuits=board.suits,boardLength=board.length;
  let best=-1;
  for(let p=0;p<pairs.length;p++){
    const pairProduct=pairProducts[p],pairSuit=pairSuits[p];
    for(let t=0;t<boardLength;t++) {
      const product=pairProduct*boardProducts[t];
      const score=pairSuit===boardSuits[t]?flushScores.get(product):numericRankScore(product);
      if(score>best)best=score;
    }
  }
  return best;
}
function scoreHandIds(hand,board,stopAbove=Infinity) {
  const boardProducts=board.products,boardSuits=board.suits,boardLength=board.length,handLength=hand.length;
  let best=-1;
  for(let a=0;a<handLength-1;a++){
    const firstPrime=cardPrimes[hand[a]],firstSuit=hand[a]&3;
    for(let b=a+1;b<handLength;b++) {
      const product=firstPrime*cardPrimes[hand[b]],suit=firstSuit===(hand[b]&3)?firstSuit:5;
      for(let t=0;t<boardLength;t++) {
        const combined=product*boardProducts[t];
        const score=suit===boardSuits[t]?flushScores.get(combined):numericRankScore(combined);
        // Any legal winning 2+3 combination already proves zero hero pot share.
        // Further opponent combinations cannot reverse that exact conclusion.
        if(score>stopAbove)return score;
        if(score>best)best=score;
      }
    }
  }
  return best;
}
function showdownShareIds(heroPairs,opponents,board,knownHeroScore) {
  const heroScore=knownHeroScore??scorePreparedPairs(heroPairs,board);let winners=1;
  for(let i=0;i<opponents.length;i++) {
    const score=scoreHandIds(opponents[i],board,heroScore);
    if(score>heroScore)return 0;
    if(score===heroScore)winners++;
  }
  return 1/winners;
}
module.exports={initialize,packScore,fiveScore,omahaScore,showdown,cardId,createBoardBuffer,prepareBoardIds,preparePairsIds,scorePreparedPairs,scoreHandIds,showdownShareIds};
