(function () {
  'use strict';
  const model = window.TheibsPlayerProfiles;
  const storage = window.TheibsPlayersStorage;
  const host = document.querySelector('#players-workspace');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let ownerKey = null, library = null, savedRevision = null, selectedId = null, error = '', request = null;
  let revealDraft = null, revealBusy = false, historyView = false;
  const empty = () => ({schemaVersion:1, store:model.createStore(), archive:{}, decisions:{}});
  const ready = () => Boolean(ownerKey && library);
  function requireReady() { if (!ready()) throw Error(error || 'The player library is not available for this account.'); }
  function commit(next, dirty) {
    requireReady();
    model.validateStore(next.store);
    try { savedRevision = storage.commit(next,{expectedRevision:savedRevision,dirty}).revision; }
    catch(cause) {
      if(cause.code==='STORAGE_CONFLICT') {
        const key=ownerKey;library=null;init(key);
        throw Error('Player data changed in another tab. The latest data was loaded; review and try again.');
      }
      throw cause;
    }
    library = next; error = ''; render();
    document.dispatchEvent(new CustomEvent('theibs:players-changed'));
  }
  function cloneChanged(dirty) {
    const next={...library,store:{...library.store,players:{...library.store.players},hands:{...library.store.hands}},archive:{...library.archive},decisions:{...library.decisions}};
    for(const kind of ['players','hands','archive','decisions']) {
      const map=['players','hands'].includes(kind)?next.store[kind]:next[kind];
      for(const id of dirty[kind] || [])if(map[id]!==undefined)map[id]=structuredClone(map[id]);
    }
    return next;
  }
  function update(change, dirty) {
    requireReady();
    const next = cloneChanged(dirty);
    const result = change(next);
    commit(next,dirty);
    return result;
  }
  function init(key) {
    if (!/^[a-f0-9]{64}$/i.test(String(key))) throw Error('A verified account key is required for local player storage.');
    if (ownerKey === key && ready()) return;
    clearRevealEditor();
    ownerKey = key; selectedId = null;historyView=false;
    try {
      const opened = storage.open(key);
      const parsed = opened.library || empty();
      if (parsed.schemaVersion !== 1 || !parsed.store || !parsed.archive || Array.isArray(parsed.archive)) throw Error('Invalid local player library.');
      model.validateStore(parsed.store);
      parsed.decisions ||= {};
      savedRevision = opened.revision;
      if (!opened.library) savedRevision=storage.commit(parsed,{expectedRevision:savedRevision}).revision;
      library = parsed; error = opened.recovered ? 'Recovered the previous saved library because the latest copy was incomplete. Review your most recent changes.' : ''; 
    } catch (cause) {
      library = null; error = 'The local player library could not be opened. Your saved data was left untouched.';
    }
    render();
  }
  function clearOwner() {
    clearRevealEditor();ownerKey=null;library=null;savedRevision=null;selectedId=null;historyView=false;error='';
    if(host)host.replaceChildren();render();
  }
  const list = () => ready() ? model.listPlayers(library.store).filter(item => !item.playerId.startsWith('hero_')) : [];
  const byId = id => ready() ? structuredClone(library.store.players[id] || null) : null;
  const nameFor = id => ready() ? library.store.players[id]?.nickname || null : null;
  const heroId = () => { requireReady(); return 'hero_' + ownerKey.slice(0, 32); };
  const freshId = () => crypto.randomUUID();
  function beginHand(record) {
    requireReady();
    const dirty={hands:[record.handId],players:record.config.players.map(player=>player.playerId)};
    const next = cloneChanged(dirty), before = next.store.revision;
    const result = model.beginHand(next.store, record);
    if (next.store.revision !== before) commit(next,dirty);
    return result.profileSnapshot;
  }
  function syncObservations(payload) {
    requireReady();
    const confirmed=structuredClone(payload);
    const result=update(next => model.applyObservations(next.store, confirmed),{hands:[confirmed.handId],players:confirmed.playerIds || confirmed.config.players.map(player=>player.playerId)});
    return {profileSnapshot:result.profileSnapshot,observationsAdded:result.observationsAdded,observationsRemoved:result.observationsRemoved};
  }
  function profileSnapshot(record) {
    if (!ready() || !record?.handId) return null;
    return beginHand(record);
  }
  function archiveHand(archivedHand) {
    requireReady();
    const handId = archivedHand?.multiway?.handId;
    if (!handId) throw Error('The completed hand has no history identity.');
    update(next => {
      const decisions = (next.decisions?.[handId] || []).filter(item => matchesDecision(item, archivedHand.multiway));
      next.archive[handId] = {...structuredClone(archivedHand),archivedAt:next.archive[handId]?.archivedAt || new Date().toISOString(),decisions};
    },{archive:[handId]});
  }
  function matchesDecision(item, record) {
    const before = item.recordBefore?.events;
    if (!Array.isArray(before)) return false;
    const event = record.events?.[before.length];
    if (item.committedEventId ? event?.eventId !== item.committedEventId :
      JSON.stringify(item.recordBefore.config) !== JSON.stringify(record.config) ||
      (item.recordBefore.editEpoch || 0) !== (record.editEpoch || 0)) return false;
    return event?.type === 'ACT' && event.action === item.action &&
      (item.to == null || Number(event.to) === Number(item.to)) &&
      JSON.stringify(record.events.slice(0,before.length)) === JSON.stringify(before);
  }
  function recordDecision(handId, snapshot) {
    requireReady();
    if (snapshot?.handId !== handId || !snapshot.revisionKey || !Array.isArray(snapshot.recordBefore?.events)) throw Error('The decision snapshot is incomplete.');
    const key = JSON.stringify([snapshot.revisionKey,snapshot.action,snapshot.to ?? null]);
    if ((library.decisions?.[handId] || []).some(item => item.key === key)) return;
    // Retain original inputs and numerical results, avoiding repeated per-action
    // copies of the same lengthy model assumptions in device storage.
    const source = snapshot.analysis, ev = source?.ev;
    const analysis = source && {analysisId:source.analysisId,engineBuild:source.engineBuild,
      status:source.status,analysisStage:source.analysisStage,state:source.state,
      warnings:source.warnings,ev:ev && {candidates:ev.candidates || Object.values(ev.actions || {}).filter(item=>item.legal),
        bestModeledOptionId:ev.bestModeledOptionId,bestModeledAction:ev.bestModeledAction,
        comparisonScope:ev.comparisonScope,comparisonStatus:ev.comparisonStatus,
        comparisonComplete:ev.comparisonComplete,globalBestSupported:ev.globalBestSupported,
        leaderConclusive:ev.leaderConclusive,assumptions:ev.assumptions,bigBlind:ev.bigBlind,feeBasis:ev.feeBasis},
      equity:source.equity,provenance:source.provenance};
    update(next => {
      next.decisions ||= {}; next.decisions[handId] ||= [];
      next.decisions[handId].push(structuredClone({...snapshot,analysis,key,recordedAt:new Date().toISOString()}));
    },{decisions:[handId]});
  }
  const getArchivedHand = handId => ready() ? structuredClone(library.archive[handId] || null) : null;
  const archivedHands = () => ready() ? structuredClone(Object.values(library.archive).reverse()) : [];
  function playerHistory(id) {
    return archivedHands().filter(hand => hand.multiway?.config?.players?.some(item => item.playerId === id));
  }
  const amount = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US',{maximumFractionDigits:2}) : '—';
  const probability = value => typeof value === 'number' && Number.isFinite(value) ? (100*value).toFixed(1)+'%' : '—';
  function playerLabel(record,seat) {
    const player=record.config?.players?.[seat],name=player?.name || `Seat ${seat+1}`;
    return player?.playerId && record.config.players.filter(item=>item.name===name).length>1
      ? name+' · '+player.playerId.slice(-6).toUpperCase() : name;
  }
  function renderDecision(item) {
    const analysis = item.analysis, bigBlind = item.feedback?.bigBlind || item.recordBefore?.config?.bigBlind;
    const candidates = analysis?.ev?.candidates || [];
    const rows = candidates.map(candidate => `<tr><th scope="row">${esc(candidate.action)}${candidate.size == null ? '' : ' to '+esc(amount(candidate.size))}</th><td>${candidate.status === 'MODELED' ? esc(amount(candidate.evBB ?? (Number.isFinite(candidate.ev) && bigBlind > 0 ? candidate.ev/bigBlind : null))) : 'Not modeled'}</td><td>${esc(amount(candidate.differenceToBestModeledBB))}</td></tr>`).join('');
    const before = item.recordBefore;
    const board = before?.events?.filter(event=>event.type==='BOARD').at(-1)?.cards || [];
    return `<details class="players-section"><summary>${esc(item.action)}${item.to == null ? '' : ' to '+esc(amount(item.to))} · original decision</summary><p class="micro">Cards: ${esc(before?.config?.heroCards?.join(' ') || 'Unknown')} · Board: ${esc(board.join(' ') || 'Preflop')}</p>${rows ? `<table class="mw-ev-table"><thead><tr><th>Action</th><th>EV · bb</th><th>Gap · bb</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="micro">No evaluation was available when this action was recorded.</p>'}<p class="micro">${esc(analysis?.ev?.leaderConclusive ? 'Comparison is conditional on the recorded model.' : 'Differences were inconclusive at the recorded precision.')} Later shown cards are excluded.</p>${analysis?.ev?.assumptions?.length ? `<details><summary>Original assumptions</summary><ul>${analysis.ev.assumptions.map(text=>`<li>${esc(text)}</li>`).join('')}</ul></details>` : ''}</details>`;
  }
  function renderArchivedHand(hand, playerId, allPlayers = false) {
    const record = hand.multiway, state = hand.state, seat = record.config.players.findIndex(player=>player.playerId===playerId);
    const shown = state?.players?.[seat]?.shownCards || [];
    const log = (state?.log || []).map(event=>`<tr><td>${esc(event.street || '')}</td><td>${event.actor == null ? '—' : esc(playerLabel(record,event.actor))}</td><td>${esc(event.action)}${event.cards?.length ? ' · '+esc(event.cards.join(' ')) : ''}</td><td>${esc(amount(event.to ?? event.amount))}</td></tr>`).join('');
    const result = state?.result;
    const outcome = result?.status === 'PENDING' ? 'Result pending' : result?.reason === 'ALL_FOLDED' ? 'Uncontested pot' : 'Reported showdown';
    const savedTime=hand.archivedAt ? new Date(hand.archivedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Earlier hand';
    const awards = result?.pots?.map((pot,index)=>`<li>${index ? 'Side pot '+index : 'Main pot'} · ${esc(amount(pot.amount))} chips${pot.awards?.length ? ' · '+pot.awards.map(award=>esc(playerLabel(record,award.player))+' '+esc(amount(award.amount))).join(', ') : ' · pending'}</li>`).join('') || '';
    return `<li><details data-player-detail="hand-${esc(record.handId)}"><summary><strong>${esc(record.config.variant.replace('_HIGH',''))} · ${record.config.playerCount} players</strong> · ${outcome}<small class="players-hand-time">${esc(savedTime)}</small></summary><ul class="players-pot-results">${awards}</ul>${hand.reconciliation?.rakeObserved === false && hand.reconciliation.source !== 'USER_CONFIRMED_STACKS' ? '<p class="micro">Balances before unrecorded rake.</p>' : ''}${allPlayers ? state.players.map(player => `<p class="micro">${esc(playerLabel(record,player.id))}: ${esc((player.shownCards || []).join(' ') || 'No shown cards')} <button type="button" class="text-button" data-archive-reveal="${esc(record.handId)}" data-archive-seat="${player.id}">Edit shown cards</button></p>`).join('') : `<p class="micro">Shown cards: ${esc(shown.join(' ') || 'Not recorded')}</p><button type="button" class="ghost-button" data-archive-reveal="${esc(record.handId)}" data-archive-seat="${seat}">Record shown cards</button>`}<details class="players-section"><summary>Confirmed actions · ${record.events.length}</summary><table class="players-log-table"><thead><tr><th>Street</th><th>Player</th><th>Action</th><th>Chips</th></tr></thead><tbody>${log}</tbody></table></details>${(hand.decisions || []).length ? `<details class="players-section"><summary>Decision review · ${hand.decisions.length}</summary>${hand.decisions.map(renderDecision).join('')}</details>` : ''}</details></li>`;
  }
  function render() {
    if (!host) return;
    if(host.classList.contains('hidden') || host.hidden)return;
    if (!ready()) {
      host.innerHTML = '<div class="players-heading"><p class="eyebrow">TABLE LIBRARY</p><h1 id="players-title">Players</h1></div><p class="players-error" role="alert">' + esc(error || 'Checking your player library…') + '</p>';
      return;
    }
    const openDetails = new Set([...host.querySelectorAll('details[open][data-player-detail]')].map(node=>node.dataset.playerDetail));
    const players = list();
    if (!byId(selectedId)) selectedId = players[0]?.playerId || null;
    const selected = selectedId ? model.summarizePlayer(library.store, selectedId) : null;
    const notes = selected?.notes || [];
    const contexts = selected?.contexts || [];
    const history = selected ? playerHistory(selected.playerId) : [];
    const allHands=Object.values(library.archive).reverse();
    const contextRows = contexts.map(item => {
      const context = item.context;
      const estimates = Object.entries(item.estimates || {}).map(([action, estimate]) => `<tr><th scope="row">${esc(action)}</th><td>${estimate.observed}/${estimate.opportunities}</td><td>${probability(estimate.mean)}</td><td>${estimate.credibleInterval95.map(probability).join('–')}</td></tr>`).join('');
      return `<li><details><summary>${esc(context.variant.replace('_HIGH',''))} · ${esc(context.street)} · ${esc(context.position)} · ${item.sampleSize} observed</summary><p class="micro">${esc(context.tableFormat.replaceAll('_',' ').toLowerCase())} · ${esc(context.participants.replaceAll('_',' ').toLowerCase())} · ${esc(context.priceBand.replaceAll('_',' ').toLowerCase())}</p><table class="players-observations-table"><thead><tr><th>Action</th><th>Observed</th><th>Estimate</th><th>95% interval</th></tr></thead><tbody>${estimates}</tbody></table><p class="micro">Dirichlet reference prior; conservative marginal posterior intervals. These estimates describe recorded opportunities, not strategy frequencies or GTO.</p></details></li>`;
    }).join('');
    host.innerHTML = `<header class="players-heading"><div><p class="eyebrow">TABLE LIBRARY</p><h1 id="players-title">Players</h1><p>Saved on this device for this account.</p></div><button type="button" class="ghost-button" id="players-all-hands" aria-pressed="${historyView}">Recorded hands · ${allHands.length}</button></header>
      <div class="players-layout"><section class="players-directory" aria-label="Player directory"><form id="players-create"><label for="players-new-name">Add player</label><div class="players-inline"><input id="players-new-name" maxlength="80" autocomplete="off" placeholder="Nickname" required><button class="primary-button" type="submit">Add</button></div></form>
      <div class="players-list" role="group" aria-label="Saved players">${players.length ? players.map(item => `<button type="button" class="${item.playerId === selectedId ? 'selected' : ''}" data-player-select="${esc(item.playerId)}"><strong>${esc(item.nickname)}</strong><small>${esc(item.playerId.slice(-6).toUpperCase())} · ${item.observations} actions · ${item.handCount} ${item.handCount === 1 ? 'hand' : 'hands'}</small></button>`).join('') : '<p class="micro">No players saved yet. Unknown seats get separate identities when a table starts.</p>'}</div></section>
      <section class="players-detail" aria-label="Selected player">${selected ? `<div class="players-detail-head"><div><p class="eyebrow">PLAYER</p><h2>${esc(selected.nickname)}</h2><small>Player ${esc(selected.playerId.slice(-6).toUpperCase())}</small></div></div>
        <form id="players-rename"><label for="players-rename-name">Nickname</label><div class="players-inline"><input id="players-rename-name" maxlength="80" value="${esc(selected.nickname)}" required><button type="submit" class="ghost-button">Save name</button></div></form>
        <details class="players-section" open><summary>Notes <span>· manual</span></summary><form id="players-add-note"><label for="players-note-text" class="sr-only">New note</label><textarea id="players-note-text" rows="3" maxlength="2000" placeholder="Your own observation or reminder" required></textarea><button class="ghost-button" type="submit">Add note</button></form><ul class="players-notes">${notes.map(note => `<li><p>${esc(note.text)}</p><small>${esc(new Date(note.createdAt).toLocaleDateString('en-US'))} · your note</small><button type="button" data-note-remove="${esc(note.id)}" aria-label="Remove note" class="text-button">Remove</button></li>`).join('') || '<li class="micro">No notes yet.</li>'}</ul></details>
        <details class="players-section"><summary>Observed actions <span>· ${selected.observations}</span></summary><p class="micro">Only confirmed actions count. Rates include a reference prior; intervals may be broad with little data.</p><ul class="players-contexts">${contextRows || '<li class="micro">No confirmed actions yet.</li>'}</ul></details>
        <details class="players-section" data-player-detail="history"><summary>Recorded hands <span>· ${history.length}</span></summary><ul class="players-hand-list">${history.map(hand => renderArchivedHand(hand,selected.playerId)).join('') || '<li class="micro">No archived hands yet.</li>'}</ul></details>
        <details class="players-section players-danger"><summary>Manage player data</summary><button id="players-reset" type="button" class="ghost-button">Reset observations</button><button id="players-delete" type="button" class="text-button">Delete player</button></details>` : '<p class="micro">Choose a player to view notes, observations and recorded hands.</p>'}</section></div><p id="players-message" class="players-error" role="status" ${error ? '' : 'hidden'}>${esc(error)}</p>`;
    if(historyView) {
      const detail=host.querySelector('.players-detail');
      detail.innerHTML='<h2>Recorded hands</h2><ul class="players-hand-list">'+(allHands.map(hand=>renderArchivedHand(hand,hand.multiway.config.players[hand.state.heroId]?.playerId,true)).join('') || '<li class="micro">No archived hands yet.</li>')+'</ul>';
    }
    for (const node of host.querySelectorAll('details[data-player-detail]')) if (openDetails.has(node.dataset.playerDetail)) node.open = true;
  }
  function message(text) { const node = host?.querySelector('#players-message'); if(node){node.textContent=text;node.hidden=false;} }
  const revealDialog = document.createElement('dialog');
  revealDialog.id = 'players-reveal-dialog'; revealDialog.className = 'multiway-dialog';
  revealDialog.innerHTML = '<div class="multiway-dialog-head"><h2>Shown cards</h2><button type="button" class="text-button" data-reveal-close aria-label="Close">×</button></div><form id="players-reveal-form"><p id="players-reveal-player"></p><label for="players-reveal-cards">Cards · E spades, C hearts, O diamonds, P clubs</label><input id="players-reveal-cards" autocomplete="off" spellcheck="false" placeholder="AE KO" aria-describedby="players-reveal-help"><p id="players-reveal-help" class="micro">Partial cards are allowed. Review before saving; the original decision stays unchanged.</p><div class="players-inline"><button type="button" class="ghost-button" id="players-reveal-voice" aria-pressed="false">Voice off</button><button type="submit" class="primary-button">Save shown cards</button></div><p id="players-reveal-error" class="players-error" role="alert" hidden></p></form>';
  document.body.append(revealDialog);
  const revealInput = revealDialog.querySelector('#players-reveal-cards');
  let voiceTimer = null;
  function clearRevealEditor() {
    clearInterval(voiceTimer);voiceTimer=null;revealDraft=null;
    if(revealDialog.open)revealDialog.close();
    revealInput.value='';revealDialog.querySelector('#players-reveal-player').textContent='';revealError('');
  }
  function revealError(text) { const node = revealDialog.querySelector('#players-reveal-error');node.textContent=text;node.hidden=!text; }
  function updateVoiceButton() {
    const state = window.theibsCardVoice?.getStatus?.(), button = revealDialog.querySelector('#players-reveal-voice');
    button.textContent = state?.enabled ? state.blocked ? 'Voice waiting' : state.audioReady ? 'Listening' : 'Voice on' : 'Voice off';
    button.setAttribute('aria-pressed',String(Boolean(state?.enabled)));
  }
  function openArchivedReveal(handId, actor) {
    requireReady(); const hand = getArchivedHand(handId);
    if (!hand?.state?.players?.[actor] || !['FINISHED','SHOWDOWN'].includes(hand.state.phase)) throw Error('Choose a completed hand and its player.');
    revealDraft = {handId,actor,ownerKey,revisionKey:hand.state.revisionKey,token:`archive:${handId}:${hand.state.revisionKey}:${actor}`,seen:new Set()};
    revealInput.value = (hand.state.players[actor].shownCards || []).map(window.TheibsCards.fromCanonical).join(' ');
    revealDialog.querySelector('#players-reveal-player').textContent = playerLabel(hand.multiway,actor);
    revealError('');revealDialog.showModal();revealInput.focus({preventScroll:true});updateVoiceButton();
    clearInterval(voiceTimer); voiceTimer=setInterval(updateVoiceButton,250);
  }
  function validateShownCards(cards) {
    if (!revealDraft || !Array.isArray(cards)) throw Error('Open a shown-card editor first.');
    const hand=getArchivedHand(revealDraft.handId),player=hand?.state?.players?.[revealDraft.actor];
    if (!player || hand.state.revisionKey!==revealDraft.revisionKey || revealDraft.ownerKey!==ownerKey) throw Error('The recorded hand changed. Open its card editor again.');
    const canonical=cards.map(card=>window.TheibsCards.toCanonical(window.TheibsCards.fromCanonical(card)));
    const count=Number(hand.multiway.config.variant.match(/PLO([456])/)[1]);
    if (canonical.length>count) throw Error(`Use at most ${count} shown cards.`);
    const hero=hand.multiway.config.heroCards || [];
    if (player.hero && hero.length && canonical.some(card=>!hero.includes(card))) throw Error('Shown cards must match the recorded Hero hand.');
    const other=hand.state.players.filter(item=>item.id!==player.id).flatMap(item=>item.hero ? [...new Set([...hero,...(item.shownCards||[])])] : item.shownCards||[]);
    const known=[...(hand.state.board||[]),...other,...canonical];
    if (new Set(known).size!==known.length) throw Error('A shown card duplicates a known card in this hand.');
    return canonical;
  }
  function voiceRevealContext() {
    if (!revealDialog.open || !revealDraft || revealBusy || !ready() || revealDraft.ownerKey!==ownerKey) return null;
    const hand=getArchivedHand(revealDraft.handId),player=hand?.state?.players?.[revealDraft.actor];
    if (!player) return null;
    let cards=[];try{cards=window.TheibsCards.parsePortugueseCards(revealInput.value).map(window.TheibsCards.toCanonical);}catch{}
    return {enabled:true,archive:true,token:revealDraft.token,revisionKey:revealDraft.revisionKey,phase:'FINISHED',destination:'shown',shownTarget:{actor:revealDraft.actor,playerId:player.playerId,cards}};
  }
  function commitVoiceReveal({cards,expectedToken,originEventId}) {
    if (voiceRevealContext()?.token!==expectedToken) return {ok:false};
    try {
      if (originEventId && revealDraft.seen.has(originEventId)) return {ok:true,reviewRequired:true};
      const existing=window.TheibsCards.parsePortugueseCards(revealInput.value).map(window.TheibsCards.toCanonical);
      const canonical=validateShownCards([...existing,...cards]);revealInput.value=canonical.map(window.TheibsCards.fromCanonical).join(' ');
      if(originEventId)revealDraft.seen.add(originEventId);revealError('');return {ok:true,reviewRequired:true};
    } catch(cause) {revealError(cause.message);return {ok:false};}
  }
  revealDialog.querySelector('[data-reveal-close]').onclick=()=>revealDialog.close();
  revealDialog.addEventListener('close',()=>{if(!revealDialog.open){clearInterval(voiceTimer);voiceTimer=null;revealDraft=null;}});
  revealDialog.querySelector('#players-reveal-voice').onclick=()=>{window.theibsCardVoice?.toggle?.();updateVoiceButton();};
  revealDialog.querySelector('form').addEventListener('submit',async event=>{
    event.preventDefault();if(revealBusy||!revealDraft)return;
    const captured={...revealDraft};
    try {
      if(typeof request!=='function')throw Error('The hand validator is unavailable. Try again after the page has loaded.');
      const cards=validateShownCards(window.TheibsCards.parsePortugueseCards(revealInput.value).map(window.TheibsCards.toCanonical));
      const hand=getArchivedHand(captured.handId);revealBusy=true;revealError('');
      revealDialog.querySelector('[type="submit"]').disabled=true;
      const data=await request('/api/multiway/step',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({multiway:hand.multiway,expectedRevisionKey:captured.revisionKey,event:{type:'REVEAL',actor:captured.actor,cards,eventId:crypto.randomUUID()}})});
      if(ownerKey!==captured.ownerKey||getArchivedHand(captured.handId)?.state?.revisionKey!==captured.revisionKey)throw Error('The account or hand changed. No local record was overwritten.');
      update(next=>{next.archive[captured.handId]={...next.archive[captured.handId],multiway:data.multiway,state:data.state};},{archive:[captured.handId]});
      revealDialog.close();message('Shown cards saved. Original decision estimates are unchanged.');
    } catch(cause) {if(ownerKey===captured.ownerKey&&revealDraft?.token===captured.token)revealError(cause.message);}
    finally {revealBusy=false;revealDialog.querySelector('[type="submit"]').disabled=false;}
  });
  host?.addEventListener('click', event => {
    if(event.target.closest('#players-all-hands')){historyView=!historyView;render();return;}
    const select = event.target.closest('[data-player-select]');
    if (select) { historyView=false;selectedId = select.dataset.playerSelect; render(); return; }
    const reveal = event.target.closest('[data-archive-reveal]');
    if (reveal) { try {openArchivedReveal(reveal.dataset.archiveReveal,Number(reveal.dataset.archiveSeat));} catch(cause){message(cause.message);} return; }
    if (!selectedId || !ready()) return;
    try {
      const remove = event.target.closest('[data-note-remove]');
      if (remove) { update(next => model.removeNote(next.store, selectedId, remove.dataset.noteRemove),{players:[selectedId]}); return; }
      if (event.target.closest('#players-reset')) {
        if (confirm('Reset confirmed observations for this player? Notes and recorded hands remain.')) update(next => model.resetPlayer(next.store, selectedId),{players:[selectedId],hands:Object.keys(library.store.hands)});
      }
      if (event.target.closest('#players-delete')) {
        if (confirm('Remove this player and their notes from the current library? Recorded hands and one local recovery snapshot remain.')) {
          update(next => model.deletePlayer(next.store, selectedId),{players:[selectedId],hands:Object.keys(library.store.hands)}); selectedId = null; render();
        }
      }
    } catch (cause) { message(cause.message); }
  });
  host?.addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (event.target.id === 'players-create') {
        const playerId=freshId();
        selectedId = update(next => model.createPlayer(next.store, {playerId,nickname:host.querySelector('#players-new-name').value}),{players:[playerId]}).playerId;
        render();
      } else if (event.target.id === 'players-rename') {
        update(next => model.renamePlayer(next.store, selectedId, host.querySelector('#players-rename-name').value),{players:[selectedId]});
      } else if (event.target.id === 'players-add-note') {
        update(next => model.addNote(next.store, selectedId, host.querySelector('#players-note-text').value),{players:[selectedId]});
      }
    } catch (cause) { message(cause.message); }
  });
  render();
  window.theibsPlayersUI = { init, clearOwner, getOwnerKey:()=>ownerKey, ready, list, byId, nameFor, heroId, freshId, beginHand, syncObservations,
    profileSnapshot, archiveHand, recordDecision, getArchivedHand, archivedHands, getStore: () => ready() ? structuredClone(library.store) : null,
    configure: options => {request=options?.request || request;},voiceRevealContext,commitVoiceReveal,openArchivedReveal,
    select: id => { historyView=false;selectedId = id; render(); }, render };
})();
