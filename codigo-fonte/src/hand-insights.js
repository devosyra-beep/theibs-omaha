'use strict';
const {normalizeCards,makeDeck,combinations}=require('./cards');
const {evaluateFive,compareScores}=require('./evaluator');
const NAMES=['high card','one pair','two pair','three of a kind','straight','flush','full house','four of a kind','straight flush'];
const SUITS={s:'spades',h:'hearts',d:'diamonds',c:'clubs'};
const cardName=code=>`${code[0]==='T'?'10':code[0]} of ${SUITS[code[1]]}`;
// Works on flop/turn as well: exactly two private cards and three board cards.
function bestCurrent(hero,board) {
 if(board.length<3)return null;
 let best=null;
 for(const pair of combinations(hero,2))for(const triple of combinations(board,3)){
  const hand=evaluateFive([...pair,...triple]);
  if(!best||compareScores(hand.score,best.score)>0)best={...hand,label:NAMES[hand.categoryRank],usedHeroCards:pair.map(c=>c.code||c),usedBoardCards:triple.map(c=>c.code||c)};
 }
 return best;
}
function computeHand(heroInput,boardInput=[],options={}) {
 const hero=normalizeCards(heroInput),board=normalizeCards(boardInput),dead=normalizeCards(options.deadCards||[]);normalizeCards([...hero,...board,...dead]);
 if(![4,5,6].includes(hero.length)||![0,3,4,5].includes(board.length))throw Error('Not enough cards to describe the hand.');
 const unseen=makeDeck().filter(c=>![...hero,...board,...dead].some(k=>k.code===c.code));
 const made=bestCurrent(hero,board),ranks={};for(const c of hero)ranks[c.rank]=(ranks[c.rank]||0)+1;
 const suited=Object.keys(SUITS).map(s=>({suit:s,name:SUITS[s],cards:hero.filter(c=>c.suit===s).map(c=>c.code)})).filter(s=>s.cards.length>=2);
 const blockers=hero.filter(c=>c.rank==='A'&&board.filter(b=>b.suit===c.suit).length>=2).map(c=>({card:c.code,suit:SUITS[c.suit],canMakeFlush:hero.filter(h=>h.suit===c.suit).length>=2,detail:`${cardName(c.code)} removes that ace from possible opponent hands. ${hero.filter(h=>h.suit===c.suit).length>=2?'You hold two cards of that suit.':'With only one card of that suit in your hand, you cannot make that flush in Omaha.'}`}));
 const improvements=[],flushCards=[],straightCards=[];
 if(board.length===3||board.length===4)for(const card of unseen){
  const next=bestCurrent(hero,[...board,card]);
  if(next.categoryRank>made.categoryRank)improvements.push(card.code);
  if(made.categoryRank<5&&[5,8].includes(next.categoryRank))flushCards.push(card.code);
  if(made.categoryRank<4&&[4,8].includes(next.categoryRank))straightCards.push(card.code);
 }
 let nuts=null;
 if(made){let stronger=0,tied=0;
  for(const pair of combinations(unseen,2)){const other=bestCurrent(pair,board),cmp=compareScores(other.score,made.score);if(cmp>0)stronger++;else if(cmp===0)tied++;}
  nuts={unbeaten:stronger===0,strongerPrivatePairs:stronger,tiedPrivatePairs:tied,scope:board.length===5?'river':'current board, without predicting future cards'};
 }
 const drawSet=[...new Set([...flushCards,...straightCards])];
 return {version:'HAND_INSIGHTS_V1',made,privatePairs:Object.entries(ranks).filter(([,n])=>n>=2).map(([rank,count])=>({rank,count})),suited,blockers,nuts,
  nextCard:board.length===3||board.length===4?{unseenCards:unseen.length,improvementCards:improvements,improvementProbability:options.probabilitiesApplicable===false?null:improvements.length/unseen.length,flushCards,straightCards,drawCards:drawSet,drawProbability:options.probabilitiesApplicable===false?null:drawSet.length/unseen.length,probabilityScope:options.probabilitiesApplicable===false?'NOT_CALCULATED_FOR_MANUAL_RANGES':'UNIFORM_REMAINING_CARDS_WITH_DECLARED_DEAD_CARDS'}:null,
  limitations:['Improvement cards are not clean outs: opponents can improve too.','Next-card probabilities use hero/board/dead-card blockers and uniform unknown hands; with manual ranges they are not calculated. They are not win probabilities.','A blocker does not prove a bluff, and the nuts on the flop or turn do not guarantee a river win.']};
}
// Small per-worker LRU: immutable hand facts do not change with pot or price.
// Return copies so coach/UI consumers cannot corrupt the cached result.
const handCache=new Map();
function describeHand(hero,board=[],options={}) {
 const key=JSON.stringify([hero,board,options.deadCards||[],options.probabilitiesApplicable!==false]);
 if(handCache.has(key)){const facts=handCache.get(key);handCache.delete(key);handCache.set(key,facts);return structuredClone(facts);}
 const facts=computeHand(hero,board,options);handCache.set(key,facts);
 while(handCache.size>32)handCache.delete(handCache.keys().next().value);
 return structuredClone(facts);
}
const RANK_PLURALS={A:'aces',K:'kings',Q:'queens',J:'jacks',T:'tens'};
const naturalList=values=>values.length<2?values.join(''):values.slice(0,-1).join(', ')+' and '+values.at(-1);
const percentage=value=>(value*100).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
function explainHand(facts,topic='all') {
 if(!facts)return 'Complete your cards to read the hand.';
 if(topic==='all')return ['made','nuts','draws','blockers'].map(key=>explainHand(facts,key)).join(' ');
 if(topic==='made'){
  if(facts.made)return `You have ${facts.made.label}. The combination uses two hole cards and three board cards.`;
  const pairs=(facts.privatePairs||[]).map(({rank,count})=>count===2?`a pair of ${RANK_PLURALS[rank]||rank}`:`${count===3?'three':'four'} ${RANK_PLURALS[rank]||'cards ranked '+rank}`);
  const suits=(facts.suited||[]).map(({name,cards})=>`${cards.length} ${name}`);
  return `Preflop: ${pairs.length?naturalList(pairs):'no paired ranks in your cards'}; ${suits.length?naturalList(suits):'no repeated suit'}. You will use only two hole cards.`;
 }
 if(topic==='nuts')return !facts.nuts?'Preflop: there is no board yet to identify the best possible combination.'
  :facts.nuts.unbeaten?`You have the best possible combination on the current board${facts.nuts.tiedPrivatePairs?', but ties are possible':''}.${facts.nextCard?' This can change on the next card.':''}`
   :'Another hand can beat yours on the current board.';
 if(topic==='blockers')return (facts.blockers||[]).length
  ?facts.blockers.map(item=>`${cardName(item.card)} removes that ace from opponent hands.${item.canMakeFlush?'':' By itself, it cannot make a flush in Omaha.'}`).join(' ')
  :'No ace flush blocker was identified on this board.';
 if(topic==='draws'){
  const next=facts.nextCard;
  if(!next)return facts.made?'There is no next card on the river to complete the hand.':'Straight and flush completion chances appear from the flop onward.';
  if(!next.drawCards.length)return 'No next card completes a straight or flush. Other improvements may exist.';
  const kind=next.flushCards.length&&next.straightCards.length?'a straight or flush':next.flushCards.length?'a flush':'a straight';
  return `${next.drawCards.length} available ${next.drawCards.length===1?'card completes':'cards complete'} ${kind} on the next card${next.drawProbability===null?' (probability not calculated for the manual ranges)':` (${percentage(next.drawProbability)})`}. Improving does not guarantee a win.`;
 }
 return '';
}
function explainHandDetails(facts,topic='all') {
 if(!facts)return [];
 const details=[];
 if((topic==='all'||topic==='made')&&facts.made)details.push(`Cards used: ${facts.made.usedHeroCards.map(cardName).join(' + ')} from your hand; ${facts.made.usedBoardCards.map(cardName).join(' + ')} from the board.`);
 if((topic==='all'||topic==='nuts')&&facts.nuts)details.push(`${facts.nuts.strongerPrivatePairs} possible private pairs beat your combination and ${facts.nuts.tiedPrivatePairs} tie, considering the ${facts.nuts.scope}. This does not say how often an opponent holds those cards.`);
 if(topic==='all'||topic==='blockers')details.push('The blocker reading covers flush aces; it does not classify every straight or full-house blocker. A blocker does not prove a bluff.');
 if((topic==='all'||topic==='draws')&&facts.nextCard){
  const next=facts.nextCard;
  if(next.drawCards.length)details.push(`Cards that complete a straight or flush: ${next.drawCards.map(cardName).join(', ')}. A card that serves both counts once.`);
  details.push(`${next.improvementCards.length} ${next.improvementCards.length===1?'card raises':'cards raise'} the hand category${next.improvementProbability===null?' (probability not calculated for the manual ranges)':` (${percentage(next.improvementProbability)})`}. There are ${next.unseenCards} candidate unseen cards. These are not win chances or clean outs.`);
 }
 return details;
}
module.exports={describeHand,bestCurrent,explainHand,explainHandDetails,cardName};
