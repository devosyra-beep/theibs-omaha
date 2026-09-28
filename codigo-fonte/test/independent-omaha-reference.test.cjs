'use strict';
// Independent brute-force reference; no production evaluator or combination
// generator is imported. Slow by design, restricted to exact turn/river cases.
const test=require('node:test'),assert=require('node:assert/strict');
const {calculateEquity}=require('../src/equity-engine');
function choose(a,k){if(!k)return [[]];return a.flatMap((x,i)=>choose(a.slice(i+1),k-1).map(t=>[x,...t]));}
function score5(cards){const values=cards.map(c=>'23456789TJQKA'.indexOf(c[0])+2).sort((a,b)=>b-a);const counts=new Map();for(const n of values)counts.set(n,(counts.get(n)||0)+1);const groups=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);const unique=[...counts.keys()].sort((a,b)=>b-a);const flush=cards.every(c=>c[1]===cards[0][1]);let straight=unique.length===5&&unique[0]-unique[4]===4?unique[0]:unique.join()==='14,5,4,3,2'?5:0;let tuple;
 if(flush&&straight)tuple=[8,straight];else if(groups[0][1]===4)tuple=[7,groups[0][0],groups[1][0]];else if(groups[0][1]===3&&groups[1][1]===2)tuple=[6,groups[0][0],groups[1][0]];else if(flush)tuple=[5,...values];else if(straight)tuple=[4,straight];else if(groups[0][1]===3)tuple=[3,...groups.map(g=>g[0])];else if(groups[0][1]===2&&groups[1][1]===2)tuple=[2,...groups.map(g=>g[0])];else if(groups[0][1]===2)tuple=[1,...groups.map(g=>g[0])];else tuple=[0,...values];while(tuple.length<6)tuple.push(0);return tuple.reduce((a,b)=>a*15+b,0);}
function omaha(hand,board){let best=-1;for(const h of choose(hand,2))for(const b of choose(board,3))best=Math.max(best,score5([...h,...b]));return best;}
const deck=[...'23456789TJQKA'].flatMap(r=>[...'cdhs'].map(s=>r+s));
for(const n of [4,5,6])test(`PLO${n}: exact equity, split share and dead-card blockers match independent reference`,()=>{
 const hero=['As','Ks','Qh','Jh','Tc','9d'].slice(0,n),opponent=['Ah','Ad','Kc','Kd','8c','7d'].slice(0,n),board=['Ts','9s','2c','3d'],dead=['4s'];
 const unseen=deck.filter(c=>![...hero,...opponent,...board,...dead].includes(c));let share=0,wins=0,ties=0;
 for(const card of unseen){const a=omaha(hero,[...board,card]),b=omaha(opponent,[...board,card]);if(a>b){wins++;share++;}else if(a===b){ties++;share+=.5;}}
 const result=calculateEquity({variant:`PLO${n}_HIGH`,heroCards:hero,opponentHands:[opponent],board,deadCards:dead});assert.equal(result.samples,unseen.length);assert.equal(result.equity,share/unseen.length);assert.equal(result.outrightWinRate,wins/unseen.length);assert.equal(result.tieRate,ties/unseen.length);
});
test('a royal flush entirely on the board cannot be played without two private cards',()=>{
 const board=['As','Ks','Qs','Js','Ts'],weak=['2c','3d','4h','5c'],other=['Ac','Ad','Kh','Kd'];
 assert.ok(omaha(weak,board)<omaha(other,board));
 const r=calculateEquity({variant:'PLO4_HIGH',heroCards:weak,opponentHands:[other],board});assert.equal(r.equity,0);
});
