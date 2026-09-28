/* Deterministic Portuguese/English grammar and recognition-session state. No audio,
 * DOM, hidden poker information, network, or ASR confidence assumptions. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TheibsCardVoice = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const RANKS = Object.freeze({ as: 'A', rei: 'K', dama: 'Q', rainha: 'Q', valete: 'J', dez: 'T', '10': 'T',
    nove: '9', '9': '9', oito: '8', '8': '8', sete: '7', '7': '7', seis: '6', '6': '6', cinco: '5', '5': '5',
    quatro: '4', '4': '4', tres: '3', '3': '3', dois: '2', duas: '2', '2': '2' });
  const SUITS = Object.freeze({ espada: 's', espadas: 's', copa: 'h', copas: 'h', ouro: 'd', ouros: 'd', pau: 'c', paus: 'c' });
  const EN_RANKS = Object.freeze({ ace: 'A', king: 'K', queen: 'Q', jack: 'J', ten: 'T', '10': 'T', nine: '9', '9': '9',
    eight: '8', '8': '8', seven: '7', '7': '7', six: '6', '6': '6', five: '5', '5': '5', four: '4', '4': '4',
    three: '3', '3': '3', two: '2', '2': '2' });
  const EN_SUITS = Object.freeze({ spade: 's', spades: 's', heart: 'h', hearts: 'h', diamond: 'd', diamonds: 'd', club: 'c', clubs: 'c' });
  const EN_ORDINALS = { one: 0, first: 0, '1': 0, two: 1, second: 1, '2': 1, three: 2, third: 2, '3': 2,
    four: 3, fourth: 3, '4': 3, five: 4, fifth: 4, '5': 4, six: 5, sixth: 5, '6': 5 };
  const ORDINALS = { um: 0, uma: 0, primeira: 0, primeiro: 0, '1': 0, dois: 1, duas: 1, segunda: 1, segundo: 1, '2': 1,
    tres: 2, terceira: 2, terceiro: 2, '3': 2, quatro: 3, quarta: 3, quarto: 3, '4': 3,
    cinco: 4, quinta: 4, quinto: 4, '5': 4, seis: 5, sexta: 5, sexto: 5, '6': 5 };
  const TARGETS = { 'minhas cartas': 'hero', 'minha mao': 'hero', mao: 'hero', board: 'board', mesa: 'board', flop: 'flop', turn: 'turn', river: 'river' };
  const EN_TARGETS = { 'my cards': 'hero', 'my hand': 'hero', hand: 'hero', board: 'board', flop: 'flop', turn: 'turn', river: 'river' };
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim();
  const NUMBER_PT = { zero:0,um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,catorze:14,quatorze:14,quinze:15,dezesseis:16,dezasseis:16,dezessete:17,dezassete:17,dezoito:18,dezenove:19,vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90 };
  const NUMBER_EN = { zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90 };
  const HUNDREDS_PT = { cem:100,cento:100,duzentos:200,trezentos:300,quatrocentos:400,quinhentos:500,seiscentos:600,setecentos:700,oitocentos:800,novecentos:900 };
  function spokenInteger(text, locale) {
    const en=locale==='en-US', values=en?NUMBER_EN:NUMBER_PT, joiner=en?'and':'e';
    const small = words => {
      if(words.length===1 && Object.hasOwn(values,words[0]))return values[words[0]];
      if(words.length===3 && words[1]===joiner)words=[words[0],words[2]];
      if(words.length===2 && values[words[0]]>=20 && values[words[0]]%10===0 && values[words[1]]>=1 && values[words[1]]<=9)return values[words[0]]+values[words[1]];
      throw Error('Número ambíguo. Diga o valor completo, sem arredondar ou juntar números.');
    };
    const chunk = words => {
      if(!words.length)return 0;
      let hundreds=0;
      if(en && words[1]==='hundred' && values[words[0]]>=1 && values[words[0]]<=9){hundreds=100*values[words[0]];words=words.slice(2);}
      else if(!en && Object.hasOwn(HUNDREDS_PT,words[0])){
        const prefix=words[0];hundreds=HUNDREDS_PT[prefix];words=words.slice(1);
        if(prefix==='cem' && words.length)throw Error('Use cento e... para valores acima de cem.');
        if(prefix==='cento' && !words.length)throw Error('Complete o valor depois de cento.');
      }
      if(hundreds && words[0]===joiner){words=words.slice(1);if(!words.length)throw Error('Valor incompleto depois da conjunção.');}
      return hundreds+(words.length?small(words):0);
    };
    const parts=text.split(' '), scale=en?'thousand':'mil', at=parts.indexOf(scale);
    if(at<0)return chunk(parts);
    if(parts.lastIndexOf(scale)!==at)throw Error('Escala numérica repetida.');
    const thousands=at===0&&!en?1:chunk(parts.slice(0,at));
    if(thousands<1||thousands>999)throw Error('Valor fora do intervalo de entrada.');
    const rest=parts.slice(at+1);if(rest[0]===joiner){rest.shift();if(!rest.length)throw Error('Valor incompleto depois da conjunção.');}
    return thousands*1000+chunk(rest);
  }
  function parseChips(text, locale = 'pt-BR') {
    if(!['pt-BR','en-US'].includes(locale))throw Error('Escolha Português ou English.');
    const input=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/(?<=[a-z])-(?=[a-z])/g,' ').replace(/\s+/g,' ').trim();
    const en=locale==='en-US', separator=en?'.':',';
    if(new RegExp(`^\\d{1,6}(?:\\${separator}\\d{1,2})?$`).test(input))return Number(input.replace(',','.'));
    if(/[\d.,]/.test(input))throw Error(en?'Use an ungrouped value with at most two decimal places.':'Use valor sem separador de milhar e no máximo duas casas decimais.');
    const parts=input.split(en?' point ':' virgula ');if(parts.length>2)throw Error('Separador decimal repetido.');
    const whole=spokenInteger(parts[0],locale);let cents=0;
    if(parts.length===2){
      const words=parts[1].split(' '),values=en?NUMBER_EN:NUMBER_PT;
      if(words.length<=2&&words.every(w=>Object.hasOwn(values,w)&&values[w]<10))cents=Number(words.map(w=>values[w]).join('').padEnd(2,'0'));
      else {cents=spokenInteger(parts[1],locale);if(cents<10||cents>99)throw Error('Diga um ou dois dígitos decimais.');}
    }
    if(!Number.isInteger(whole)||whole<0||whole>999999)throw Error('Valor fora do intervalo de entrada.');
    return (whole*100+cents)/100;
  }
  const actionText = text => String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/,(?!\d)|(?<!\d),/g,' ').replace(/[;:!?]/g,' ').replace(/\s+/g,' ').trim().replace(/\.$/,'');
  const actionNames = en => en ? {fold:'FOLD',folds:'FOLD',check:'CHECK',checks:'CHECK',call:'CALL',calls:'CALL',bet:'BET',bets:'BET',raise:'RAISE',raises:'RAISE'}
    : {fold:'FOLD',desistir:'FOLD',desisto:'FOLD',desiste:'FOLD',desistiu:'FOLD',check:'CHECK',passar:'CHECK',passo:'CHECK',passa:'CHECK',passou:'CHECK',call:'CALL',pagar:'CALL',pago:'CALL',paga:'CALL',pagou:'CALL',bet:'BET',apostar:'BET',aposto:'BET',aposta:'BET',apostou:'BET',raise:'RAISE',aumentar:'RAISE',aumento:'RAISE',aumenta:'RAISE',aumentou:'RAISE'};
  const allInPhrase = (text,en) => (en ? /^(?:(?:go|goes|am|is) )?all[ -]in$/ : /^(?:(?:vou|vai|foi)(?: de)? )?all[ -]in$/).test(text);
  function opponentNumber(word,locale) {
    const value=/^[1-9]$/.test(word)?Number(word):(locale==='en-US'?NUMBER_EN:NUMBER_PT)[word];
    return Number.isInteger(value)&&value>=1&&value<=9?value:null;
  }
  function readAction(text,locale) {
    const en=locale==='en-US',input=actionText(text),names=actionNames(en);
    let actor=null,actorText='',opponentMissing=false,phrase=input;
    const hero=input.match(en?/^(hero|i)(?:\s+|$)/:/^(eu|heroi)(?:\s+|$)/);
    const opponent=input.match(en?/^(opponent)(?:\s+|$)/:/^(adversario|oponente)(?:\s+|$)/);
    if(hero){actor={kind:'hero'};actorText=hero[1];phrase=input.slice(hero[0].length);}
    else if(opponent){
      const rest=input.slice(opponent[0].length),word=rest.split(' ')[0],number=opponentNumber(word,locale);
      if(number!==null){actor={kind:'opponent',number};actorText=opponent[1]+' '+word;phrase=rest.slice(word.length).trim();}
      else if(!rest||Object.hasOwn(names,word)||allInPhrase(rest,en)){opponentMissing=true;actorText=opponent[1];phrase=rest;}
      else throw Error('Identifique o adversário pelo número mostrado em ADV.');
    }
    if(!hero&&!opponent&&!Object.hasOwn(names,phrase.split(' ')[0])&&!allInPhrase(phrase,en))return null;
    const draft={actor,actorText,opponentMissing,action:null,actionWord:'',basis:null,rawValue:'',unitText:'',unit:'chips'};
    if(!phrase)return draft;
    if(allInPhrase(phrase,en))return {...draft,action:'ALL_IN',actionWord:phrase};
    const first=phrase.split(' ')[0],action=Object.hasOwn(names,first)?names[first]:null;
    if(!action)throw Error('Diga uma ação: fold, check, call, bet, raise ou all-in.');
    let rest=phrase.slice(first.length).trim();Object.assign(draft,{action,actionWord:first});
    if(['FOLD','CHECK','CALL'].includes(action)){
      if(rest)throw Error(action==='CALL'?(en?'Say call without a value; the amount comes from the table.':'Diga pagar/call sem valor; o preço vem da mesa.'):'Fold/check não aceitam valor ou outra ação na mesma frase.');
      return draft;
    }
    const basis=rest.match(en?/^(to|by)(?:\s+|$)/:/^(para|em)(?:\s+|$)/);
    if(basis){draft.basis=['to','para'].includes(basis[1])?'to':'by';rest=rest.slice(basis[0].length);}
    if(action==='BET'&&draft.basis==='by')throw Error('Bet aceita um valor total; incremento exige raise/aumentar em.');
    if(action==='BET')draft.basis='to';
    const unit=rest.match(/(?:^|\s)(chips?|fichas?|bbs?|big blinds?)$/);
    if(unit){draft.unitText=unit[1];draft.unit=/^(?:bb|big blind)/.test(unit[1])?'bb':'chips';rest=rest.slice(0,unit.index).trim();}
    draft.rawValue=rest;
    if(rest){
      try{draft.value=parseChips(rest,locale);}
      catch(error){
        const words=rest.split(' '),known=en?{...NUMBER_EN,and:0,hundred:0,thousand:0,point:0}:{...NUMBER_PT,...HUNDREDS_PT,e:0,mil:0,virgula:0};
        if(words.every(word=>Object.hasOwn(known,word))&&(en?/\b(?:and|point)$/.test(rest):/\b(?:e|virgula|cento)$/.test(rest)))draft.amountTail=true;
        else throw error;
      }
    }
    return draft;
  }
  function missingActionField(draft) {
    if(draft.opponentMissing)return 'opponentNumber';
    if(!draft.actor)return 'actor';
    if(!draft.action)return 'action';
    if(draft.action==='RAISE'&&!draft.basis)return 'raiseBasis';
    if(['BET','RAISE'].includes(draft.action)&&draft.value===undefined)return draft.amountTail?'amountTail':'amount';
    return null;
  }
  function parseAction(text,locale) {
    const draft=readAction(text,locale);if(!draft)return null;
    const missing=missingActionField(draft);
    if(missing)throw Error(clarificationPrompt(missing,locale));
    const command={type:'action',actor:draft.actor,action:draft.action};
    if(['BET','RAISE'].includes(draft.action)){
      command[draft.basis==='by'?'by':'to']=draft.value;
      if(draft.unit==='bb')command.unit='bb';
    }
    return command;
  }
  function resolveAction(command,state) {
    if(command?.type!=='action'||!state||state.phase!=='BETTING')throw Error('Ações por voz exigem uma rodada de apostas ativa no Multiway.');
    const players=state.players||[];
    const player=command.actor?.kind==='hero'?players.find(p=>p.id===state.heroId)
      :command.actor?.kind==='opponent'&&Number.isInteger(command.actor.number)?players.filter(p=>!p.hero)[command.actor.number-1]:null;
    if(!player)throw Error('Esse jogador não existe nesta mesa.');
    if(player.folded||player.allIn)throw Error('Esse jogador não pode agir neste estado.');
    if(player.id!==state.actor)throw Error('Não é a vez desse jogador. Nada foi registrado.');
    const money=value=>Number.isFinite(value)&&value>=0&&Math.abs(value*100-Math.round(value*100))<=1e-7;
    let action=command.action,to=command.to;
    if(action==='ALL_IN'){
      if(command.to!==undefined||command.by!==undefined||command.unit!==undefined)throw Error('All-in usa somente o stack observado, sem valor ou unidade adicional.');
      if(!money(player.stack)||player.stack<=0||!money(player.streetPaid))throw Error('Stack/contribuição do jogador indisponíveis para all-in.');
      if(state.legal?.actions?.includes('CALL')&&money(state.legal.toCall)&&Math.abs(state.legal.toCall-player.stack)<1e-9)action='CALL';
      else{
        if(!money(state.currentBet))throw Error('Aposta atual indisponível para all-in.');
        action=state.currentBet>0?'RAISE':'BET';to=Math.round((player.streetPaid+player.stack)*100)/100;
      }
    } else if(command.by!==undefined){
      if(action!=='RAISE'||command.to!==undefined||!money(state.currentBet)||!money(command.by)||command.by<=0)throw Error('Incremento inválido ou aposta atual indisponível.');
      to=command.by;
    }
    if(command.unit!==undefined&&!['chips','bb'].includes(command.unit))throw Error('Unidade inválida: use fichas/chips ou BB.');
    if(command.unit==='bb'){
      if(!['BET','RAISE'].includes(action)||!money(state.bigBlind)||state.bigBlind<=0||!money(to))throw Error('Big blind ou valor indisponível para conversão.');
      to*=state.bigBlind;
    }
    if(command.by!==undefined)to+=state.currentBet;
    if(!state.legal?.actions?.includes(action))throw Error('A ação não é legal neste estado da mesa.');
    if(['BET','RAISE'].includes(action)){
      if(!Number.isFinite(state.legal.minTo)||!Number.isFinite(state.legal.maxTo))throw Error('Limites legais da aposta indisponíveis.');
      if(!Number.isFinite(to)||to<state.legal.minTo-1e-9||to>state.legal.maxTo+1e-9)throw Error(`Use total entre ${state.legal.minTo} e ${state.legal.maxTo} fichas nesta street.`);
      if(!money(to))throw Error('Use no máximo duas casas decimais de fichas.');
      to=Math.round(to*100)/100;
    } else if(command.to!==undefined||command.by!==undefined||command.unit!==undefined)throw Error('Essa ação não aceita valor ou unidade.');
    return {actor:player.id,action,...(['BET','RAISE'].includes(action)?{to}:{})};
  }
  function cardsFrom(text, locale) {
    const english = locale === 'en-US', ranks = english ? EN_RANKS : RANKS, suits = english ? EN_SUITS : SUITS;
    const words = text.split(' '), cards = [];
    let i = 0;
    while (i < words.length) {
      if (cards.length && words[i] === (english ? 'and' : 'e')) i++;
      const rankWord = words[i++], rank = Object.hasOwn(ranks,rankWord) ? ranks[rankWord] : null;
      if (!rank) throw Error('Valor da carta não reconhecido. Diga, por exemplo, ás de espadas.');
      if (words[i] === (english ? 'of' : 'de')) i++;
      const suitWord = words[i++], suit = Object.hasOwn(suits,suitWord) ? suits[suitWord] : null;
      if (!suit) throw Error('Naipe ausente ou ambíguo. Use espadas, copas, ouros ou paus.');
      cards.push(rank + suit);
    }
    if (!cards.length) throw Error('Diga pelo menos uma carta completa.');
    if (new Set(cards).size !== cards.length) throw Error('A frase contém a mesma carta duas vezes.');
    return cards;
  }
  function parse(text, locale = 'pt-BR') {
    if (!['pt-BR', 'en-US'].includes(locale)) throw Error('Escolha Português ou English.');
    if(String(text||'').length>800)throw Error('Frase longa demais. Dite uma entrada por vez.');
    const action=parseAction(text,locale);if(action)return action;
    const input = normalize(text);
    if (!input || input.length > 800) throw Error('Frase vazia ou longa demais. Dite um lote de cartas.');
    const english = locale === 'en-US', targets = english ? EN_TARGETS : TARGETS;
    if (input === (english ? 'cancel' : 'cancelar')) return { type: 'cancel' };
    if (input === (english ? 'undo' : 'desfazer')) return { type: 'undo' };
    if (input === (english ? 'remove selected card' : 'remover carta selecionada')) return { type: 'remove', target: 'selected' };
    let match = input.match(english ? /^(select|correct) card (\S+)(?: (?:in|on) (hand|board))?(?: to (.+))?$/
      : /^(selecionar|corrigir) carta (\S+)(?: (?:da|do) (mao|board|mesa))?(?: para (.+))?$/);
    if (match) {
      const index = (english ? EN_ORDINALS : ORDINALS)[match[2]];
      if (index === undefined) throw Error('Use posições de um a seis.');
      const target = match[3] ? targets[match[3]] : 'selectedScope';
      if (match[1] === (english ? 'select' : 'selecionar') && !match[4]) return { type: 'select', target, index };
      if (match[1] === (english ? 'correct' : 'corrigir') && match[4]) {
        const cards = cardsFrom(match[4], locale);
        if (cards.length !== 1) throw Error('Uma correção aceita exatamente uma carta.');
        return { type: 'correct', target, index, card: cards[0] };
      }
      throw Error('Use selecionar carta três ou corrigir carta três para dama de ouros.');
    }
    for (const name of Object.keys(targets)) {
      if (input === name) return { type: 'target', target: targets[name] };
      if (input.startsWith(name + ' ')) return { type: 'cards', target: targets[name], cards: cardsFrom(input.slice(name.length + 1), locale) };
    }
    return { type: 'cards', target: 'selected', cards: cardsFrom(input, locale) };
  }
  function clarificationPrompt(missing,locale) {
    const prompts=locale==='en-US'?{
      actor:'Who acted? Say hero or opponent and its ADV number.',opponentNumber:'Which opponent? Say its ADV number.',
      action:'Which action: fold, check, call, bet, raise or all-in?',raiseBasis:'Raise to a total or by an increment? Say to or by, then the value if missing.',
      amount:'What is the amount? Use chips or explicit BB.',amountTail:'Finish the amount after the words already spoken.',
      suit:'Which suit: spades, hearts, diamonds or clubs?',rank:'Which card rank: ace, two through ten, jack, queen or king?'
    }:{
      actor:'Quem agiu? Diga eu ou adversário e o número ADV.',opponentNumber:'Qual adversário? Diga o número ADV.',
      action:'Qual ação: fold, check, call, bet, raise ou all-in?',raiseBasis:'Aumentar para o total ou em um incremento? Diga para ou em e o valor, se faltar.',
      amount:'Qual o valor? Use fichas ou BB explícito.',amountTail:'Complete o valor depois das palavras já ditas.',
      suit:'Qual o naipe: espadas, copas, ouros ou paus?',rank:'Qual o valor da carta: ás, dois a dez, valete, dama ou rei?'
    };
    return prompts[missing];
  }
  function cardGap(text,locale) {
    const en=locale==='en-US',ranks=en?EN_RANKS:RANKS,suits=en?EN_SUITS:SUITS,targets=en?EN_TARGETS:TARGETS;
    let body=normalize(text),prefix='';
    for(const name of Object.keys(targets))if(body.startsWith(name+' ')){prefix=name;body=body.slice(name.length+1);break;}
    const connector=en?'of':'de',suitOnly=body.startsWith(connector+' ')?body.slice(connector.length+1):body;
    if(Object.hasOwn(suits,suitOnly))return {missing:'rank',prefix,suit:suitOnly};
    const words=body.split(' ');let i=0,count=0;
    while(i<words.length){
      if(count&&words[i]===(en?'and':'e'))i++;
      if(!Object.hasOwn(ranks,words[i++]))return null;
      if(words[i]===connector)i++;
      if(i===words.length)return {missing:'suit'};
      if(!Object.hasOwn(suits,words[i++]))return null;
      count++;
    }
    return null;
  }
  // A clarification contains only its explicit source and the missing field.
  // Its lifetime/context and one-time application remain the caller's job.
  function getClarification(text,locale='pt-BR') {
    if(!['pt-BR','en-US'].includes(locale)||typeof text!=='string'||!text.trim()||text.length>800)return null;
    try{parse(text,locale);return null;}catch{}
    try{
      const draft=readAction(text,locale),missing=draft?missingActionField(draft):cardGap(text,locale)?.missing;
      return missing?Object.freeze({kind:'voice-clarification',version:1,locale,missing,prompt:clarificationPrompt(missing,locale),source:text.trim()}):null;
    }catch{return null;}
  }
  function completeClarification(pending,text,locale=pending?.locale) {
    const failure=message=>({command:null,clarification:pending||null,error:message});
    if(!pending||pending.kind!=='voice-clarification'||pending.version!==1||typeof pending.source!=='string')return failure('Esclarecimento inválido. Dite o comando novamente.');
    if(locale!==pending.locale)return failure('O idioma mudou. Dite o comando novamente.');
    const verified=getClarification(pending.source,locale);
    if(!verified||verified.missing!==pending.missing)return failure('Esclarecimento inválido ou já completo. Dite o comando novamente.');
    if(typeof text!=='string'||!text.trim()||text.length>800)return failure(clarificationPrompt(pending.missing,locale));
    const en=locale==='en-US',reply=actionText(text);
    if(reply===(en?'cancel':'cancelar'))return {command:{type:'cancel'},clarification:null,error:null};
    try{
      const draft=readAction(pending.source,locale);let combined;
      const actorPrefix=draft?`${draft.actorText} ${draft.actionWord}`.trim():'';
      const basisWord=draft?.basis?(en?draft.basis:draft.basis==='to'?'para':'em'):'';
      if(pending.missing==='actor'){
        const actor=readAction(reply,locale);
        if(!actor?.actor||actor.action||actor.opponentMissing)throw Error(clarificationPrompt('actor',locale));
        combined=reply+' '+pending.source;
      }else if(pending.missing==='opponentNumber'){
        if(opponentNumber(reply,locale)===null)throw Error(clarificationPrompt('opponentNumber',locale));
        combined=pending.source.replace(en?/^opponent\b/i:/^(?:advers[aá]rio|oponente)\b/i,match=>match+' '+reply);
      }else if(pending.missing==='action')combined=pending.source+' '+reply;
      else if(pending.missing==='raiseBasis'){
        const basis=reply.match(en?/^(to|by)(?:\s+|$)/:/^(para|em)(?:\s+|$)/);
        if(!basis)throw Error(clarificationPrompt('raiseBasis',locale));
        if(draft.rawValue&&reply.slice(basis[0].length).trim())throw Error(en?'The value is already known; say only to or by.':'O valor já foi informado; diga somente para ou em.');
        combined=[actorPrefix,reply,draft.rawValue,draft.unitText].filter(Boolean).join(' ');
      }else if(pending.missing==='amount'||pending.missing==='amountTail'){
        combined=[actorPrefix,basisWord,pending.missing==='amountTail'?draft.rawValue:'',reply,draft.unitText].filter(Boolean).join(' ');
      }else if(pending.missing==='suit'){
        const suit=normalize(text).replace(en?/^of /:/^de /,'');
        if(!Object.hasOwn(en?EN_SUITS:SUITS,suit))throw Error(clarificationPrompt('suit',locale));
        combined=pending.source+' '+suit;
      }else if(pending.missing==='rank'){
        const rank=normalize(text),gap=cardGap(pending.source,locale);
        if(!Object.hasOwn(en?EN_RANKS:RANKS,rank))throw Error(clarificationPrompt('rank',locale));
        combined=[gap.prefix,rank,en?'of':'de',gap.suit].filter(Boolean).join(' ');
      }else throw Error('Esclarecimento inválido.');
      try{return {command:parse(combined,locale),clarification:null,error:null};}
      catch(error){
        const clarification=getClarification(combined,locale);
        return clarification?{command:null,clarification,error:null}:failure(error.message);
      }
    }catch(error){return failure(error.message);}
  }
  const token = context => JSON.stringify(context);
  class RecognitionSession {
    constructor() { this.generation = 0; this.cancel(); }
    begin(context) {
      this.generation++; this.id = this.generation; this.context = token(context);
      this.segments = new Map(); this.phase = 'listening'; this.proposal = null; this.error = '';
      this.cursor = 0; this.proposalEnd = null; this.resultCount = null;
      return this.id;
    }
    reject(message) { this.error = message; this.phase = 'rejected'; this.proposal = null; this.proposalEnd = null; }
    accept(id, index, text, final) {
      if (id !== this.id || this.phase !== 'listening') return false;
      if (!Number.isInteger(index) || index < 0 || index > 100 || (this.resultCount !== null && index >= this.resultCount)) { this.reject('Segmento de voz fora do intervalo. Dite novamente.'); return false; }
      text = String(text);
      const old = this.segments.get(index);
      if (old?.final) {
        if (old.text !== text || !final) this.reject('O reconhecedor alterou um segmento final. Dite novamente.');
        return false;
      }
      this.segments.set(index, { text, final: Boolean(final) }); return true;
    }
    reconcileResultCount(id, count) {
      if (id !== this.id || this.phase !== 'listening') return false;
      if (!Number.isInteger(count) || count < 0 || count > 101) { this.reject('Quantidade de segmentos de voz inválida. Dite novamente.'); return false; }
      // SpeechRecognitionEvent.results is a snapshot: a provider can merge or
      // remove provisional results. Final segments must never disappear.
      for (const [index, segment] of this.segments) if (index >= count) {
        if (segment.final) { this.reject('O reconhecedor removeu um segmento final. Dite novamente.'); return false; }
        this.segments.delete(index);
      }
      this.resultCount = count;
      return true;
    }
    preview() { return [...this.segments].sort((a, b) => a[0] - b[0]).map(([, s]) => s.text).join(', '); }
    hasPending() { return [...this.segments.keys()].some(index => index >= this.cursor); }
    pendingPreview() { return [...this.segments].filter(([index]) => index >= this.cursor).sort((a, b) => a[0] - b[0]).map(([, s]) => s.text).join(', '); }
    prepareReady(id, context, parseCommand = parse) { return this.prepare(id, context, false, parseCommand); }
    finish(id, context, parseCommand = parse) { return this.prepare(id, context, true, parseCommand); }
    prepare(id, context, finishing, parseCommand = parse) {
      if (id !== this.id || this.phase !== 'listening') return null;
      if (token(context) !== this.context) { this.reject('O contexto mudou. Nenhuma entrada pendente foi aplicada.'); return null; }
      if (this.error) return null;
      const segments = [...this.segments].sort((a, b) => a[0] - b[0]);
      if (segments.some(([, s]) => !s.final)) {
        if (finishing) this.reject('A fala ficou incompleta. Dite novamente.');
        return null;
      }
      if ((this.resultCount !== null && segments.length !== this.resultCount) || segments.some(([index], i) => index !== i)) { this.reject('Faltou um segmento da frase. Dite novamente.'); return null; }
      if (!this.hasPending()) {
        if (finishing) {
          if (this.cursor) this.phase = 'finished';
          else this.reject('A fala ficou incompleta. Dite novamente.');
        }
        return null;
      }
      const pending = segments.slice(this.cursor);
      if (pending.some(([, s]) => !s.text.trim())) { this.reject('O serviço do navegador devolveu texto vazio. Confira idioma, microfone e disponibilidade do serviço; nenhum lote foi aplicado.'); return null; }
      try {
        this.proposal = parseCommand(pending.map(([, s]) => s.text).join(', '), context.locale);
        this.proposalEnd = segments.length; this.phase = 'review'; return this.proposal;
      } catch (error) { this.reject(error.message); return null; }
    }
    take(context) {
      if (this.phase !== 'review' || token(context) !== this.context) { this.cancel(); return null; }
      this.cursor = this.proposalEnd; this.phase = 'consumed'; return this.proposal;
    }
    // The caller must confirm that the typed command committed successfully
    // before rebasing. Failed/async commits must cancel instead of queueing audio.
    resume(id, context) {
      if (id !== this.id || this.phase !== 'consumed' || !this.proposal || this.error) return false;
      this.context = token(context); this.proposal = null; this.proposalEnd = null; this.phase = 'listening'; return true;
    }
    cancel() { this.id = null; this.phase = 'cancelled'; this.segments = new Map(); this.proposal = null; this.cursor = 0; this.proposalEnd = null; this.resultCount = null; }
  }
  return { RANKS, SUITS, EN_RANKS, EN_SUITS, normalize, parse, parseChips, resolveAction, getClarification, completeClarification, RecognitionSession, qualityGate: Object.freeze({ acoustic: 'NOT_EXECUTED', autoApply: true, rule: 'FINAL_VALIDATED_ONLY' }) };
});
