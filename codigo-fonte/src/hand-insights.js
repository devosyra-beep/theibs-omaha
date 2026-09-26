'use strict';
const {normalizeCards,makeDeck,combinations}=require('./cards');
const {evaluateFive,compareScores}=require('./evaluator');
const NAMES=['carta alta','um par','dois pares','trinca','sequência','flush','full house','quadra','straight flush'];
const SUITS={s:'espadas',h:'copas',d:'ouros',c:'paus'};
const cardName=code=>`${code[0]==='T'?'10':code[0]} de ${SUITS[code[1]]}`;
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
function describeHand(heroInput,boardInput=[]) {
 const hero=normalizeCards(heroInput),board=normalizeCards(boardInput);normalizeCards([...hero,...board]);
 if(![4,5,6].includes(hero.length)||![0,3,4,5].includes(board.length))throw Error('Cartas insuficientes para descrever a mão.');
 const unseen=makeDeck().filter(c=>![...hero,...board].some(k=>k.code===c.code));
 const made=bestCurrent(hero,board),ranks={};for(const c of hero)ranks[c.rank]=(ranks[c.rank]||0)+1;
 const suited=Object.keys(SUITS).map(s=>({suit:s,name:SUITS[s],cards:hero.filter(c=>c.suit===s).map(c=>c.code)})).filter(s=>s.cards.length>=2);
 const blockers=hero.filter(c=>c.rank==='A'&&board.filter(b=>b.suit===c.suit).length>=2).map(c=>({card:c.code,suit:SUITS[c.suit],canMakeFlush:hero.filter(h=>h.suit===c.suit).length>=2,detail:`${cardName(c.code)} retira esse ás das mãos possíveis do oponente. ${hero.filter(h=>h.suit===c.suit).length>=2?'Você tem duas cartas desse naipe.':'Com apenas uma carta desse naipe na mão, você não pode formar esse flush em Omaha.'}`}));
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
  nuts={unbeaten:stronger===0,strongerPrivatePairs:stronger,tiedPrivatePairs:tied,scope:board.length===5?'river':'board atual, sem prever as próximas cartas'};
 }
 const drawSet=[...new Set([...flushCards,...straightCards])];
 return {version:'HAND_INSIGHTS_V1',made,privatePairs:Object.entries(ranks).filter(([,n])=>n>=2).map(([rank,count])=>({rank,count})),suited,blockers,nuts,
  nextCard:board.length===3||board.length===4?{unseenCards:unseen.length,improvementCards:improvements,improvementProbability:improvements.length/unseen.length,flushCards,straightCards,drawCards:drawSet,drawProbability:drawSet.length/unseen.length}:null,
  limitations:['As cartas de melhora não são outs limpos: o adversário também pode melhorar.','Probabilidades da próxima carta usam somente as cartas públicas e suas privadas; não são probabilidade de vitória.','Blocker não prova blefe e nuts no flop/turn não garantem vitória no river.']};
}
const RANK_PLURALS={A:'ases',K:'reis',Q:'damas',J:'valetes',T:'dez'};
const naturalList=values=>values.length<2?values.join(''):values.slice(0,-1).join(', ')+' e '+values.at(-1);
const percentage=value=>(value*100).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
function explainHand(facts,topic='all') {
 if(!facts)return 'Complete suas cartas para ler a mão.';
 if(topic==='all')return ['made','nuts','draws','blockers'].map(key=>explainHand(facts,key)).join(' ');
 if(topic==='made'){
  if(facts.made)return `Você tem ${facts.made.label}. A combinação usa duas cartas da sua mão e três da mesa.`;
  const pairs=(facts.privatePairs||[]).map(({rank,count})=>count===2?`um par de ${RANK_PLURALS[rank]||rank}`:`${count===3?'três':'quatro'} ${RANK_PLURALS[rank]||'cartas de valor '+rank}`);
  const suits=(facts.suited||[]).map(({name,cards})=>`${cards.length} cartas de ${name}`);
  return `Pré-flop: ${pairs.length?naturalList(pairs):'nenhum par nas suas cartas'}; ${suits.length?naturalList(suits):'nenhum naipe repetido'}. Você usará apenas duas cartas da mão.`;
 }
 if(topic==='nuts')return !facts.nuts?'Pré-flop: ainda não há uma mesa para identificar a melhor combinação.'
  :facts.nuts.unbeaten?`Você tem a melhor combinação possível na mesa atual${facts.nuts.tiedPrivatePairs?', mas pode empatar':''}.${facts.nextCard?' Isso pode mudar na próxima carta.':''}`
   :'Outra mão pode superar a sua na mesa atual.';
 if(topic==='blockers')return (facts.blockers||[]).length
  ?facts.blockers.map(item=>`${cardName(item.card)} retira esse ás das mãos adversárias.${item.canMakeFlush?'':' Ele sozinho não permite formar um flush em Omaha.'}`).join(' ')
  :'Nenhum bloqueador de ás de flush foi identificado nesta mesa.';
 if(topic==='draws'){
  const next=facts.nextCard;
  if(!next)return facts.made?'No river não há próxima carta para completar a mão.':'As chances de completar sequência ou flush aparecem a partir do flop.';
  if(!next.drawCards.length)return 'Nenhuma carta completa sequência ou flush na próxima carta. Outras melhorias podem existir.';
  const kind=next.flushCards.length&&next.straightCards.length?'sequência ou flush':next.flushCards.length?'flush':'sequência';
  return `${next.drawCards.length} ${next.drawCards.length===1?'carta disponível completa':'cartas disponíveis completam'} ${kind} na próxima carta (${percentage(next.drawProbability)}). Melhorar não garante vencer.`;
 }
 return '';
}
function explainHandDetails(facts,topic='all') {
 if(!facts)return [];
 const details=[];
 if((topic==='all'||topic==='made')&&facts.made)details.push(`Cartas usadas: ${facts.made.usedHeroCards.map(cardName).join(' + ')} da sua mão; ${facts.made.usedBoardCards.map(cardName).join(' + ')} da mesa.`);
 if((topic==='all'||topic==='nuts')&&facts.nuts)details.push(`${facts.nuts.strongerPrivatePairs} duplas privadas possíveis superam sua combinação e ${facts.nuts.tiedPrivatePairs} empatam, considerando ${facts.nuts.scope}. Isso não informa com que frequência um adversário tem essas cartas.`);
 if(topic==='all'||topic==='blockers')details.push('A leitura de bloqueadores cobre ases de flush; não classifica todos os bloqueios de sequência ou full house. Um bloqueador não prova um blefe.');
 if((topic==='all'||topic==='draws')&&facts.nextCard){
  const next=facts.nextCard;
  if(next.drawCards.length)details.push(`Cartas que completam sequência ou flush: ${next.drawCards.map(cardName).join(', ')}. Uma carta que serve para os dois conta uma única vez.`);
  details.push(`${next.improvementCards.length} ${next.improvementCards.length===1?'carta eleva':'cartas elevam'} a categoria da mão (${percentage(next.improvementProbability)}). As probabilidades usam ${next.unseenCards} cartas não vistas; não são chance de vitória nem outs limpos.`);
 }
 return details;
}
module.exports={describeHand,bestCurrent,explainHand,explainHandDetails,cardName};
