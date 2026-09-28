'use strict';
// Separate reference implementation. No production card, evaluator, range or
// sampler imports. This is an internal oracle, NOT external solver evidence.
const deck = [...'23456789TJQKA'].flatMap(r => [...'cdhs'].map(s => r + s));
function five(cards) {
  const hist=Array(15).fill(0);for(const c of cards)hist['23456789TJQKA'.indexOf(c[0])+2]++;
  const ranks=[];for(let r=14;r>=2;r--)if(hist[r])ranks.push(r);
  const sameSuit=cards.every(c=>c[1]===cards[0][1]);
  let run=0;for(let high=14;high>=5;high--)if(Array.from({length:5},(_,i)=>high-i===1?14:high-i).every(r=>hist[r])){run=high;break;}
  const quads=ranks.filter(r=>hist[r]===4),trips=ranks.filter(r=>hist[r]===3),pairs=ranks.filter(r=>hist[r]===2),single=ranks.filter(r=>hist[r]===1);
  if(sameSuit&&run)return [8,run];if(quads.length)return [7,...quads,...single];if(trips.length&&pairs.length)return [6,...trips,...pairs];
  if(sameSuit)return [5,...ranks];if(run)return [4,run];if(trips.length)return [3,...trips,...single];if(pairs.length===2)return [2,...pairs,...single];if(pairs.length)return [1,...pairs,...single];return [0,...ranks];
}
const code=score=>score.reduce((a,n)=>a*15+n,0)*15**(6-score.length);
function omahaScore(hand,board) {
  let best=-Infinity;
  for(let a=0;a<hand.length;a++)for(let b=a+1;b<hand.length;b++)
    for(let x=0;x<3;x++)for(let y=x+1;y<4;y++)for(let z=y+1;z<5;z++)
      best=Math.max(best,code(five([hand[a],hand[b],board[x],board[y],board[z]])));
  return best;
}
function share(hero,opponents,board) {
  const scores=[hero,...opponents].map(hand=>omahaScore(hand,board)),best=Math.max(...scores);
  return scores[0]===best?1/scores.filter(score=>score===best).length:0;
}
function choose(items,n) {
  const result=[];
  function visit(start,picked){if(!n||picked.length===n){result.push(picked.slice());return;}for(let i=start;i<=items.length-(n-picked.length);i++){picked.push(items[i]);visit(i+1,picked);picked.pop();}}
  visit(0,[]);return result;
}
function weightedEquity(input) {
  const occupied=new Set([...input.heroCards,...input.board]),joints=[];
  function visit(index,hands,weight) {
    if(index===input.opponentRanges.length){joints.push({hands:hands.map(h=>h.slice()),weight});return;}
    const range=input.opponentRanges[index];
    range.hands.forEach((hand,i)=>{
      const w=range.weights?.[i]??1;if(w<=0||hand.some(card=>occupied.has(card)))return;
      hand.forEach(card=>occupied.add(card));hands.push(hand);visit(index+1,hands,weight*w);hands.pop();hand.forEach(card=>occupied.delete(card));
    });
  }
  visit(0,[],1);
  const mass=joints.reduce((sum,j)=>sum+j.weight,0);if(!mass)throw Error('Oracle: no compatible joint hands.');
  let equity=0,worlds=0;
  for(const joint of joints){
    const blocked=new Set([...input.heroCards,...input.board,...joint.hands.flat()]);
    const runouts=choose(deck.filter(c=>!blocked.has(c)),5-input.board.length);let subtotal=0;
    for(const runout of runouts){subtotal+=share(input.heroCards,joint.hands,[...input.board,...runout]);worlds++;}
    equity+=joint.weight/mass*subtotal/runouts.length;
  }
  return {equity,worlds,compatibleJoints:joints.length};
}
module.exports={deck,five,code,omahaScore,share,weightedEquity};
