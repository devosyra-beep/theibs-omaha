/* Presentation port of the supplied EssenceDeck components. No poker decisions,
   random cards, fake grades, default pots, or implied opponent stacks live here. */
(function () {
  'use strict';
  const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const symbols = { E: '♠', C: '♥', O: '♦', P: '♣' };
  const names = { E: 'Spades', C: 'Hearts', O: 'Diamonds', P: 'Clubs' };
  function cardMarkup(card, options = {}) {
    const { slot = null, selected = false, small = false, label = 'Card' } = options;
    const isButton = slot !== null;
    const tag = isButton ? 'button' : 'span';
    const normalized = card ? window.TheibsCards.portugueseCard(card) : null;
    const rank = normalized ? normalized[0] === 'T' ? '10' : normalized[0] : '';
    const suit = normalized?.[1] || '';
    const description = normalized ? `${rank} of ${names[suit]} (${normalized})` : 'empty';
    return `<${tag} class="playing-card${small ? ' small' : ''}${normalized ? ' suit-' + suit : ' vacant'}${selected ? ' selected' : ''}" ${isButton ? `type="button" data-slot="${slot}" aria-pressed="${selected}"` : 'role="img"'} aria-label="${esc(label)}: ${esc(description)}" title="${esc(description)}">${normalized ? `<span class="face-rank" aria-hidden="true">${rank}</span><span class="corner top"><b>${rank}</b><i>${symbols[suit]}</i></span><span class="pip">${symbols[suit]}</span><span class="corner bottom"><b>${rank}</b><i>${symbols[suit]}</i></span>` : `<span class="vacant-plus">+</span><span class="vacant-label">${esc(options.emptyLabel || '')}</span>`}</${tag}>`;
  }
  function canonicalCard(card, options = {}) { return cardMarkup(card ? window.TheibsCards.fromCanonical(card) : null, options); }
  function money(value) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function hiddenCards(count) {
    return `<span class="opponent-cards" role="img" aria-label="${count} face-down cards">${Array.from({length:count},()=>'<i class="card-back" aria-hidden="true"></i>').join('')}</span>`;
  }
  function opponentSeats(count, holeCount, foldedSeats = new Set()) {
    const positions = count === 1 ? [[50,0]] : count === 2 ? [[24,13],[76,13]] : count === 3 ? [[50,0],[12,36],[88,36]] : count === 4 ? [[29,10],[71,10],[10,43],[90,43]] : count === 5 ? [[50,0],[23,16],[77,16],[9,49],[91,49]] : Array.from({length:count},(_,i)=>{const a=Math.PI+(i/(count-1))*Math.PI;return [50+43*Math.cos(a),44+36*Math.sin(a)];});
    return positions.map(([x,y],i)=>{
      const folded=foldedSeats.has(i);
      return `<button type="button" class="opponent-place simple-seat${count>5?' dense':''}${folded?' folded':''}" style="--seat-x:${x}%;--seat-y:${y}%" data-opponent="${i+1}" data-simple-seat="${i}" aria-haspopup="dialog" aria-label="Opponent ${i+1}, ${folded?'folded':'active'}. Edit seat." title="Opponent ${i+1} · ${folded?'folded':'active'}">${hiddenCards(holeCount)}<span class="opponent-name">OPP. ${i+1}</span><span class="simple-seat-status">${folded?'Folded':'Active'}</span></button>`;
    }).join('');
  }
  function trainingTable(session, count = 5) {
    if (!session) return `<div class="table-mode-line"><span class="eyebrow">TRAINING · 1 OPPONENT · 2 PLAYERS</span></div><div class="mesa-stage"><div class="poker-table"><div class="table-felt"><div class="table-center"><span class="eyebrow">LOCAL TRAINING</span><strong class="table-placeholder">Your next decision.</strong><span class="table-note">Choose an exercise and start a hand.</span></div><div class="hero-position"><div class="hero-cards">${Array.from({ length: count }, () => cardMarkup(null)).join('')}</div><div class="seat hero-seat">YOU · —</div></div></div></div></div>`;
    const board = [...session.board, ...Array(5 - session.board.length).fill(null)];
    return `<div class="table-mode-line"><span class="eyebrow">${esc(session.variant?.replace('_HIGH', '') || 'PLO5')} · ${esc(session.street)}</span><span class="training-opponent-count">1 opponent · 2 players</span><span class="status-chip">${session.finished ? 'Hand complete' : 'Your turn'}</span></div><div class="mesa-stage"><div class="poker-table"><div class="table-felt"><div class="seat opponent-seat">${hiddenCards(session.heroCards.length)}<span>OPPONENT · BB</span><b>${money(session.opponentStack)}</b></div><div class="table-center"><span class="eyebrow">POT · CHIPS</span><strong class="pot-value">${money(session.pot)}</strong><div class="board-cards">${board.map((c, i) => canonicalCard(c, { label: `Board ${i + 1}`, emptyLabel: ['F','F','F','T','R'][i] })).join('')}</div></div><div class="hero-position"><div class="hero-cards">${session.heroCards.map((c) => canonicalCard(c)).join('')}</div><div class="seat hero-seat"><span>YOU · ${esc(session.position)}</span><b>${money(session.heroStack)}</b></div></div></div></div></div><div class="table-meta"><span>To call <b>${money(session.amountToCall)}</b></span><span>${esc(session.mode === 'CHALLENGE' ? 'Challenge · answer after action' : 'Guided practice')}</span></div>${session.finished ? `<div class="outcome-note"><strong>${esc(({ HERO: 'You won', OPPONENT: 'Opponent won', TIE: 'Tie' })[session.outcome.winner] || session.outcome.winner)}</strong><span>Simulated result: ${money(session.outcome.heroNet)} chips. Results do not prove decision quality.</span>${session.opponentCards ? `<div class="showdown-cards"><span>Showdown</span>${session.opponentCards.map((c) => canonicalCard(c, { small: true })).join('')}</div>` : '<span>No showdown: opponent cards remain hidden.</span>'}</div>` : ''}`;
  }
  function multiwaySeats(state,holeCount) {
    const hero=state.players.findIndex(p=>p.hero);
    const opponents=Array.from({length:state.players.length-1},(_,i)=>state.players[(hero+i+1)%state.players.length]);
    return opponents.map((p,i)=>{
      // A1 starts left of Hero. Seats continue around the far edge of the
      // table, independently of poker position and without moving on folds.
      const count=opponents.length, arc=count===1?0:Math.PI*i/(count-1);
      const x=count===1?9:50-42*Math.cos(arc), y=count===1?54:54-66*Math.sin(arc);
      const mobileX=count===1?6:50-44*Math.cos(arc), mobileY=count===1?42:42-42*Math.sin(arc);
      const status=p.folded?'Folded':p.allIn?'All-in':state.actor===p.id?'To act':p.lastAction||'';
      const checked=!p.folded&&!p.allIn&&state.actor!==p.id&&p.lastAction==='CHECK';
      const name=(p.seatName||p.name||`A${i+1}`).replace(/^Adv\./i,'Opp.');
      return `<button type="button" class="opponent-place multiway-seat${p.folded?' folded':''}${state.actor===p.id?' acting to-act':''}${checked?' checked':''}" style="--seat-x:${x.toFixed(2)}%;--seat-y:${y.toFixed(2)}%;--seat-x-mobile:${mobileX.toFixed(2)}%;--seat-y-mobile:${mobileY.toFixed(2)}%" data-multiway-player="${p.id}" data-seat-count="${count}" data-seat-index="${i+1}" aria-haspopup="dialog" aria-label="${esc(name)}, ${esc(p.position)}, stack ${money(p.stack)}, ${money(p.streetPaid)} committed this street${status?', '+esc(status):''}. View seat.">${hiddenCards(holeCount)}<span class="opponent-name"><b>${esc(name)}</b><span>${esc(p.position)}</span></span><span class="mw-seat-stack">Stack <b>${money(p.stack)}</b></span><span class="mw-seat-paid">In <b>${money(p.streetPaid)}</b></span>${status?`<span class="multiway-seat-status">${esc(({CALL:'Called',CHECK:'Checked',BET:'Bet',RAISE:'Raised',FOLD:'Folded','To act':'TO ACT'})[status]||status)}</span>`:''}</button>`;
    }).join('');
  }
  window.EssenceUI = { esc, cardMarkup, canonicalCard, money, trainingTable, hiddenCards, opponentSeats, multiwaySeats };
})();
