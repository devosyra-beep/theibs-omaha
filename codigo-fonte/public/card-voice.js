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
  function parseAction(text,locale) {
    const en=locale==='en-US';
    // Preserve decimal punctuation before normalizing card-list separators.
    let input=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/,(?!\d)|(?<!\d),/g,' ').replace(/[;:!?]/g,' ').replace(/\s+/g,' ').trim().replace(/\.$/,'');
    const actorMatch=input.match(en?/^(hero|i|opponent\s+\S+)\s+(.+)$/:/^(eu|heroi|(?:adversario|oponente)\s+\S+)\s+(.+)$/);
    if(!actorMatch)return null;
    let actor;
    if((en?['hero','i']:['eu','heroi']).includes(actorMatch[1]))actor={kind:'hero'};
    else{
      const ordinal=actorMatch[1].split(' ').at(-1), values=en?NUMBER_EN:NUMBER_PT;
      const number=/^[1-9]$/.test(ordinal)?Number(ordinal):values[ordinal];
      if(!Number.isInteger(number)||number<1||number>9)throw Error('Identifique o adversário pelo número mostrado em ADV.');
      actor={kind:'opponent',number};
    }
    const phrase=actorMatch[2];
    const names=en?{fold:'FOLD',folds:'FOLD',check:'CHECK',checks:'CHECK',call:'CALL',calls:'CALL',bet:'BET',bets:'BET',raise:'RAISE',raises:'RAISE'}
      :{fold:'FOLD',desistir:'FOLD',desisto:'FOLD',desiste:'FOLD',desistiu:'FOLD',check:'CHECK',passar:'CHECK',passo:'CHECK',passa:'CHECK',passou:'CHECK',call:'CALL',pagar:'CALL',pago:'CALL',paga:'CALL',pagou:'CALL',bet:'BET',apostar:'BET',aposto:'BET',aposta:'BET',apostou:'BET',raise:'RAISE',aumentar:'RAISE',aumento:'RAISE',aumenta:'RAISE',aumentou:'RAISE'};
    const first=phrase.split(' ')[0],action=names[first];if(!action)throw Error('Diga uma ação: fold, check, call, bet ou raise.');
    let rest=phrase.slice(first.length).trim();
    if(['FOLD','CHECK','CALL'].includes(action)){
      if(rest)throw Error(action==='CALL'?(en?'Say call without a value; the amount comes from the table.':'Diga pagar/call sem valor; o preço vem da mesa.'):'Fold/check não aceitam valor ou outra ação na mesma frase.');
      return {type:'action',actor,action};
    }
    const to=en?'to ':'para ';
    if(action==='RAISE'&&!rest.startsWith(to))throw Error(en?'Say raise to the total, not an increment.':'Diga aumenta para o total, não o incremento.');
    if(rest.startsWith(to))rest=rest.slice(to.length);
    rest=rest.replace(en?/ chips?$/:/ fichas?$/,'');
    if(!rest)throw Error('Diga o valor da aposta.');
    return {type:'action',actor,action,to:parseChips(rest,locale)};
  }
  function resolveAction(command,state) {
    if(command?.type!=='action'||!state||state.phase!=='BETTING')throw Error('Ações por voz exigem uma rodada de apostas ativa no Multiway.');
    const players=state.players||[];
    const player=command.actor?.kind==='hero'?players.find(p=>p.id===state.heroId)
      :command.actor?.kind==='opponent'&&Number.isInteger(command.actor.number)?players.filter(p=>!p.hero)[command.actor.number-1]:null;
    if(!player)throw Error('Esse jogador não existe nesta mesa.');
    if(player.folded||player.allIn)throw Error('Esse jogador não pode agir neste estado.');
    if(player.id!==state.actor)throw Error('Não é a vez desse jogador. Nada foi registrado.');
    if(!state.legal?.actions?.includes(command.action))throw Error('A ação não é legal neste estado da mesa.');
    if(['BET','RAISE'].includes(command.action)){
      if(!Number.isFinite(state.legal.minTo)||!Number.isFinite(state.legal.maxTo))throw Error('Limites legais da aposta indisponíveis.');
      if(!Number.isFinite(command.to)||command.to<state.legal.minTo-1e-9||command.to>state.legal.maxTo+1e-9)throw Error(`Use total entre ${state.legal.minTo} e ${state.legal.maxTo}.`);
      if(Math.abs(command.to*100-Math.round(command.to*100))>1e-7)throw Error('Use no máximo duas casas decimais.');
    } else if(command.to!==undefined)throw Error('Essa ação não aceita valor.');
    return {actor:player.id,action:command.action,...(['BET','RAISE'].includes(command.action)?{to:command.to}:{})};
  }
  function cardsFrom(text, locale) {
    const english = locale === 'en-US', ranks = english ? EN_RANKS : RANKS, suits = english ? EN_SUITS : SUITS;
    const words = text.split(' '), cards = [];
    let i = 0;
    while (i < words.length) {
      if (cards.length && words[i] === (english ? 'and' : 'e')) i++;
      const rank = ranks[words[i++]];
      if (!rank) throw Error('Valor da carta não reconhecido. Diga, por exemplo, ás de espadas.');
      if (words[i] === (english ? 'of' : 'de')) i++;
      const suit = suits[words[i++]];
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
  const token = context => JSON.stringify(context);
  class RecognitionSession {
    constructor() { this.generation = 0; this.cancel(); }
    begin(context) {
      this.generation++; this.id = this.generation; this.context = token(context);
      this.segments = new Map(); this.phase = 'listening'; this.proposal = null; this.error = '';
      return this.id;
    }
    accept(id, index, text, final) {
      if (id !== this.id || this.phase !== 'listening' || !Number.isInteger(index) || index < 0 || index > 100) return false;
      const old = this.segments.get(index);
      if (old?.final) {
        if (old.text !== text) { this.error = 'O reconhecedor alterou um segmento final. Dite novamente.'; }
        return false;
      }
      this.segments.set(index, { text: String(text), final: Boolean(final) }); return true;
    }
    reconcileResultCount(id, count) {
      if (id !== this.id || this.phase !== 'listening' || !Number.isInteger(count) || count < 0 || count > 101) return false;
      // SpeechRecognitionEvent.results is a snapshot: a provider can merge or
      // remove provisional results. Final segments must never disappear.
      for (const [index, segment] of this.segments) if (index >= count) {
        if (segment.final) { this.error = 'O reconhecedor removeu um segmento final. Dite novamente.'; return false; }
        this.segments.delete(index);
      }
      return true;
    }
    preview() { return [...this.segments].sort((a, b) => a[0] - b[0]).map(([, s]) => s.text).join(', '); }
    finish(id, context) {
      if (id !== this.id || this.phase !== 'listening') return null;
      this.phase = 'rejected';
      if (token(context) !== this.context) { this.error = 'O contexto mudou. Nenhuma carta aplicada.'; return null; }
      if (this.error) return null;
      const segments = [...this.segments].sort((a, b) => a[0] - b[0]);
      if (!segments.length || segments.some(([, s]) => !s.final)) { this.error = 'A fala ficou incompleta. Dite novamente.'; return null; }
      if (segments.some(([, s]) => !s.text.trim())) { this.error = 'O serviço do navegador devolveu texto vazio. Confira idioma, microfone e disponibilidade do serviço; nenhum lote foi aplicado.'; return null; }
      if (segments.some(([index], i) => index !== i)) { this.error = 'Faltou um segmento da frase. Dite novamente.'; return null; }
      try { this.proposal = parse(this.preview(), context.locale); this.phase = 'review'; return this.proposal; }
      catch (error) { this.error = error.message; return null; }
    }
    take(context) {
      if (this.phase !== 'review' || token(context) !== this.context) { this.cancel(); return null; }
      this.phase = 'consumed'; return this.proposal;
    }
    cancel() { this.id = null; this.phase = 'cancelled'; this.segments = new Map(); this.proposal = null; }
  }
  return { RANKS, SUITS, EN_RANKS, EN_SUITS, normalize, parse, parseChips, resolveAction, RecognitionSession, qualityGate: Object.freeze({ acoustic: 'NOT_EXECUTED', autoApply: false }) };
});
