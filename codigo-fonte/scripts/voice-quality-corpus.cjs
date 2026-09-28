'use strict';
// Immutable case definitions shared by controlled-event and synthetic native QA.
// Expected outcomes are explicit and do not come from the parser under test.
const ranks=['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
const words={
 'pt-BR':{ranks:['ás','dois','três','quatro','cinco','seis','sete','oito','nove','dez','valete','dama','rei'],suits:['espadas','copas','ouros','paus'],join:'de'},
 'en-US':{ranks:['ace','two','three','four','five','six','seven','eight','nine','ten','jack','queen','king'],suits:['spades','hearts','diamonds','clubs'],join:'of'}
};
const suits=['s','h','d','c'],nativeSuits=['E','C','O','P'];
function cards(locale){const w=words[locale];return ranks.flatMap((rank,r)=>suits.map((suit,s)=>({canonical:rank+suit,native:rank+nativeSuits[s],full:`${w.ranks[r]} ${w.join} ${w.suits[s]}`,short:`${w.ranks[r]} ${w.suits[s]}`})));}
function nativeCases(){return ['pt-BR','en-US'].flatMap(locale=>{const en=locale==='en-US',c=cards(locale),phrase=code=>c.find(x=>x.canonical===code).full,one=(id,code,more={})=>({id,locale,kind:'cards',pace:'fast',variant:5,segments:[{text:phrase(code),pauseAfterMs:0}],expected:{cards:[code],target:0,commits:1},...more}),seq=(id,pace,pause)=>({id,locale,kind:'cards',pace,variant:5,segments:['As','Th','8c'].map(code=>({text:phrase(code),pauseAfterMs:pause})),expected:{cards:['As','Th','8c'],target:0,minCommits:1,maxCommits:3}});
 return [one('single-eight','8c'),one('single-short','8c',{segments:[{text:c.find(x=>x.canonical==='8c').short,pauseAfterMs:0}]}),one('single-ten-slow','Th',{rate:-2}),one('single-ace-fast','As',{rate:2}),one('single-queen-noise','Qd',{noiseSnrDb:15}),
 seq('sequence-batch-short','batch',150),seq('sequence-batch-long','batch',650),seq('sequence-fast-short','fast',150),seq('sequence-fast-long','fast',650),
 {id:'flop-destination',locale,kind:'cards',pace:'batch',variant:4,segments:[{text:`flop ${phrase('As')}, ${phrase('Th')}, ${phrase('8c')}`,pauseAfterMs:0}],expected:{cards:['As','Th','8c'],target:4,commits:1}},
 {id:'turn-destination',locale,kind:'cards',pace:'fast',variant:6,segments:[{text:`turn ${phrase('Jd')}`,pauseAfterMs:0}],expected:{cards:['Jd'],target:9,commits:1}},
 {id:'correction',locale,kind:'correction',pace:'batch',variant:5,initial:['As','Kh','Qd'],segments:[{text:en?'correct card three to eight of clubs':'corrigir carta três para oito de paus',pauseAfterMs:0}],expected:{cards:['As','Kh','8c'],target:0,commits:1}},
 {id:'raise-decimal',locale,kind:'action',pace:'fast',variant:5,stack:100,segments:[{text:en?'hero raises to two point five':'eu aumento para dois vírgula cinco',pauseAfterMs:0}],expected:{event:{type:'ACT',actor:0,action:'RAISE',to:2.5},commits:1}},
 {id:'call',locale,kind:'action',pace:'fast',variant:5,stack:100,segments:[{text:en?'hero call':'eu pago',pauseAfterMs:0}],expected:{event:{type:'ACT',actor:0,action:'CALL'},commits:1}},
 {id:'fold',locale,kind:'action',pace:'fast',variant:5,stack:100,segments:[{text:en?'hero fold':'eu desisto',pauseAfterMs:0}],expected:{event:{type:'ACT',actor:0,action:'FOLD'},commits:1}},
 {id:'incomplete-rank',locale,kind:'reject',pace:'batch',variant:5,segments:[{text:en?'king':'rei',pauseAfterMs:0}],expected:{cards:[],target:0,commits:0}}
 ].map(item=>({...item,id:`${locale}-${item.id}`}));});}
module.exports={cards,nativeCases};
