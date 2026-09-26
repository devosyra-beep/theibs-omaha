/* Presentation port of the supplied EssenceDeck components. No poker decisions,
   random cards, fake grades, default pots, or implied opponent stacks live here. */
(function () {
  'use strict';
  const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const symbols = { E: '♠', C: '♥', O: '♦', P: '♣' };
  const names = { E: 'Espadas', C: 'Copas', O: 'Ouros', P: 'Paus' };
  function cardMarkup(card, options = {}) {
    const { slot = null, selected = false, small = false, label = 'Carta' } = options;
    const isButton = slot !== null;
    const tag = isButton ? 'button' : 'span';
    const normalized = card ? window.TheibsCards.portugueseCard(card) : null;
    const rank = normalized ? normalized[0] === 'T' ? '10' : normalized[0] : '';
    const suit = normalized?.[1] || '';
    const description = normalized ? `${rank} de ${names[suit]} (${normalized})` : 'vazia';
    return `<${tag} class="playing-card${small ? ' small' : ''}${normalized ? ' suit-' + suit : ' vacant'}${selected ? ' selected' : ''}" ${isButton ? `type="button" data-slot="${slot}" aria-pressed="${selected}"` : 'role="img"'} aria-label="${esc(label)}: ${esc(description)}" title="${esc(description)}">${normalized ? `<span class="face-rank" aria-hidden="true">${rank}</span><span class="corner top"><b>${rank}</b><i>${symbols[suit]}</i></span><span class="pip">${symbols[suit]}</span><span class="corner bottom"><b>${rank}</b><i>${symbols[suit]}</i></span>` : `<span class="vacant-plus">+</span><span class="vacant-label">${esc(options.emptyLabel || '')}</span>`}</${tag}>`;
  }
  function canonicalCard(card, options = {}) { return cardMarkup(card ? window.TheibsCards.fromCanonical(card) : null, options); }
  function money(value) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }
  function hiddenCards(count) {
    return `<span class="opponent-cards" role="img" aria-label="${count} cartas fechadas">${Array.from({length:count},()=>'<i class="card-back" aria-hidden="true"></i>').join('')}</span>`;
  }
  function opponentSeats(count, holeCount) {
    const positions = count === 1 ? [[50,0]] : count === 2 ? [[24,13],[76,13]] : count === 3 ? [[50,0],[12,36],[88,36]] : count === 4 ? [[29,10],[71,10],[10,43],[90,43]] : count === 5 ? [[50,0],[23,16],[77,16],[9,49],[91,49]] : Array.from({length:count},(_,i)=>{const a=Math.PI+(i/(count-1))*Math.PI;return [50+43*Math.cos(a),44+36*Math.sin(a)];});
    return positions.map(([x,y],i)=>`<div class="opponent-place${count>5?' dense':''}" style="--seat-x:${x}%;--seat-y:${y}%" data-opponent="${i+1}" title="Adversário ${i+1}: ${holeCount} cartas desconhecidas. Posição ilustrativa.">${hiddenCards(holeCount)}<span class="opponent-name">ADV. ${i+1}</span></div>`).join('');
  }
  function trainingTable(session, count = 5) {
    if (!session) return `<div class="table-mode-line"><span class="eyebrow">TREINO · 1 ADVERSÁRIO · 2 JOGADORES</span></div><div class="mesa-stage"><div class="poker-table"><div class="table-felt"><div class="table-center"><span class="eyebrow">TREINO LOCAL</span><strong class="table-placeholder">Sua próxima decisão.</strong><span class="table-note">Escolha o exercício e inicie uma mão.</span></div><div class="hero-position"><div class="hero-cards">${Array.from({ length: count }, () => cardMarkup(null)).join('')}</div><div class="seat hero-seat">VOCÊ · —</div></div></div></div></div>`;
    const board = [...session.board, ...Array(5 - session.board.length).fill(null)];
    return `<div class="table-mode-line"><span class="eyebrow">${esc(session.variant?.replace('_HIGH', '') || 'PLO5')} · ${esc(session.street)}</span><span class="training-opponent-count">1 adversário · 2 jogadores</span><span class="status-chip">${session.finished ? 'Mão encerrada' : 'Sua vez'}</span></div><div class="mesa-stage"><div class="poker-table"><div class="table-felt"><div class="seat opponent-seat">${hiddenCards(session.heroCards.length)}<span>OPONENTE · BB</span><b>${money(session.opponentStack)}</b></div><div class="table-center"><span class="eyebrow">POTE · FICHAS</span><strong class="pot-value">${money(session.pot)}</strong><div class="board-cards">${board.map((c, i) => canonicalCard(c, { label: `Board ${i + 1}`, emptyLabel: ['F','F','F','T','R'][i] })).join('')}</div></div><div class="hero-position"><div class="hero-cards">${session.heroCards.map((c) => canonicalCard(c)).join('')}</div><div class="seat hero-seat"><span>VOCÊ · ${esc(session.position)}</span><b>${money(session.heroStack)}</b></div></div></div></div></div><div class="table-meta"><span>Para pagar <b>${money(session.amountToCall)}</b></span><span>${esc(session.mode === 'CHALLENGE' ? 'Desafio · resposta após a ação' : 'Prática guiada')}</span></div>${session.finished ? `<div class="outcome-note"><strong>${esc(({ HERO: 'Você venceu', OPPONENT: 'Oponente venceu', TIE: 'Empate' })[session.outcome.winner] || session.outcome.winner)}</strong><span>Saldo simulado: ${money(session.outcome.heroNet)} fichas. Resultado não prova qualidade da decisão.</span>${session.opponentCards ? `<div class="showdown-cards"><span>Showdown</span>${session.opponentCards.map((c) => canonicalCard(c, { small: true })).join('')}</div>` : '<span>Sem showdown: cartas adversárias continuam ocultas.</span>'}</div>` : ''}`;
  }
  function multiwaySeats(state,holeCount) {
    const hero=state.players.findIndex(p=>p.hero);
    const opponents=Array.from({length:state.players.length-1},(_,i)=>state.players[(hero+i+1)%state.players.length]);
    return opponents.map((p,i)=>{
      const angle=Math.PI+(i+1)/(opponents.length+1)*Math.PI;
      const x=50+45*Math.cos(angle),y=57+53*Math.sin(angle);
      const status=p.folded?'Saiu':p.allIn?'All-in':state.actor===p.id?'Vez de agir':p.lastAction||'';
      return `<button type="button" class="opponent-place multiway-seat${p.folded?' folded':''}${state.actor===p.id?' acting':''}" style="--seat-x:${x}%;--seat-y:${y}%" data-multiway-player="${p.id}" aria-label="Adversário ${p.position}: ${esc(status)}, stack ${money(p.stack)}">${hiddenCards(holeCount)}<span class="opponent-name">${esc(p.position)} · ${money(p.stack)}</span>${status?`<span class="multiway-seat-status">${esc(({CALL:'Pagou',CHECK:'Passou',BET:'Apostou',RAISE:'Aumentou',FOLD:'Saiu'})[status]||status)}</span>`:''}</button>`;
    }).join('');
  }
  window.EssenceUI = { esc, cardMarkup, canonicalCard, money, trainingTable, hiddenCards, opponentSeats, multiwaySeats };
})();
