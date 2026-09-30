/* Optional, hand-scoped opponent hypotheses. Nothing is inferred from actions. */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  let options, panel, editorKey = '', selected = '', bindings = [], rows = new Map(), drafts = new Map(), accepted = false;
  const clone = value => JSON.parse(JSON.stringify(value));
  function context() { return options.getContext(); }
  function shape(c) { return JSON.stringify([c.mode, c.variant, c.position, c.players.map(p => p.seatId)]); }
  function active(c) { return c.players.filter(p => !p.folded); }
  function message(text, error = false) { $('#opponent-input-message').textContent = text; $('#opponent-input-message').classList.toggle('warning-text', error); }
  function fillEditor() {
    const item = rows.get(Number(selected)), draft = drafts.get(Number(selected));
    $('#opponentHand').value = draft?.hand ?? '';
    $('#opponentRange').value = draft?.range ?? (item?.range?.hands || []).map(hand => hand.map(TheibsCards.fromCanonical).join(' ')).join('\n');
    $('#opponent-call-probability').value = draft?.rate ?? (item?.callProbability == null ? '' : String(item.callProbability * 100));
    $('#opponent-remove').disabled = !item;
  }
  function refresh() {
    if (!options) return;
    const c = context(), key = shape(c), players = active(c);
    let changed = false;
    if (editorKey !== key) { rows.clear(); drafts.clear(); accepted = false; selected = ''; editorKey = key; changed = true; }
    // Keep a folded seat's manual hypothesis so Undo can restore it. Only
    // active seats are sent to analysis; removed seats are discarded.
    for (const id of rows.keys()) if (!c.players.some(p => p.seatId === id)) { rows.delete(id); accepted = false; changed = true; }
    for (const id of drafts.keys()) if (!c.players.some(p => p.seatId === id)) drafts.delete(id);
    const nextBindings = JSON.stringify(players.map(p => [p.seatId, p.label]));
    if (nextBindings !== bindings || changed) {
      if(nextBindings!==bindings) accepted=false;
      bindings = nextBindings;
      $('#opponent-seat').replaceChildren(...players.map(p => new Option(p.label, String(p.seatId))));
      if (!players.some(p => String(p.seatId) === selected)) selected = String(players[0]?.seatId ?? '');
      $('#opponent-seat').value = selected; fillEditor();
    }
    $('#opponent-study-accepted').checked = accepted;
    $('#opponent-apply').disabled = !players.length || Boolean(c.busy);
    $('#opponent-seat').disabled = !players.length || Boolean(c.busy);
    const activeRows = players.filter(p => rows.has(p.seatId)).length;
    $('#opponent-input-summary').textContent = activeRows ? `Opponents (optional) · ${activeRows} with manual assumptions` : 'Opponents (optional) · no active assumptions';
    const unknown = players.filter(p => rows.get(p.seatId)?.callProbability == null);
    $('#opponent-input-scope').textContent = activeRows
      ? `${activeRows} active opponent(s) with manual information. ${unknown.length} without a response rate; none was assumed. ${unknown.length ? 'Equity remains available; BET/RAISE may lack a complete model.' : 'Entered rates are assumptions, not verified frequencies.'}`
      : 'Equity uses random legal hands for everyone. This panel is optional. THEIBS does not observe or infer opponent profiles.';
    $('#opponent-input-list').replaceChildren(...players.filter(p => rows.has(p.seatId)).map(p => {
      const node = document.createElement('li'), row = rows.get(p.seatId);
      node.textContent = `${p.label}: ${row.range ? 'manual range' : 'unknown cards'}; ${row.callProbability == null ? 'unknown response' : `call ${Number((row.callProbability * 100).toFixed(2))}% (assumption)`}`;
      return node;
    }));
  }
  function parseRange(handText, rangeText) {
    const hand = handText.trim(), text = rangeText.trim(), c = context();
    if (hand && text) throw Error('Enter either a known hand or a range, not both.');
    if (!hand && !text) return null;
    const lines = (hand || text).split(/\n|\|/).map(s => s.trim()).filter(Boolean);
    if (lines.length > 100) throw Error('Use at most 100 hands in this range.');
    const hands = lines.map(line => TheibsCards.parsePortugueseCards(line).map(TheibsCards.toCanonical));
    if (hands.some(h => h.length !== c.count)) throw Error(`Each hand needs ${c.count} cards. Use E/C/O/P for suits.`);
    return { hands };
  }
  function applySeat(seatId, {hand = '', rangeText = '', rateText = ''} = {}) {
      refresh();
      const c = context();
      if (c.busy || !active(c).some(p => p.seatId === seatId)) throw Error('This opponent is unavailable in the current context.');
      const range = parseRange(hand, rangeText), raw = String(rateText).trim(), rate = raw === '' ? null : Number(raw) / 100;
      if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 1)) throw Error('Call chance must be between 0 and 100%.');
      if (!range && rate === null) throw Error('Enter a hand, range or call chance, or remove this assumption.');
      rows.set(seatId, { seatId, enabled: true, ...(range ? { range } : {}), ...(rate === null ? {} : { callProbability: rate }) });
      drafts.delete(seatId);
      accepted = false; refresh(); fillEditor();
      message('Assumption applied only to this opponent. Other seats were unchanged.'); options.onChange();
  }
  function apply() {
    try { applySeat(Number(selected), {hand:$('#opponentHand').value,rangeText:$('#opponentRange').value,rateText:$('#opponent-call-probability').value}); }
    catch (error) { message(error.message, true); }
  }
  function removeSeat(seatId) {
    rows.delete(seatId); drafts.delete(seatId); accepted = false; refresh(); fillEditor();
    message('Assumption removed. This opponent uses unknown cards again.'); options.onChange();
  }
  function seatEditor(seatId) {
    refresh();
    const item = rows.get(seatId), draft = drafts.get(seatId);
    return {hand:draft?.hand ?? '',rangeText:draft?.range ?? (item?.range?.hands || []).map(hand => hand.map(TheibsCards.fromCanonical).join(' ')).join('\n'),rateText:draft?.rate ?? (item?.callProbability == null ? '' : String(item.callProbability * 100)),hasOverride:!!item};
  }
  function reset() { rows.clear(); drafts.clear(); accepted = false; editorKey = ''; refresh(); fillEditor(); message(''); }
  function snapshot() { refresh(); return { schemaVersion: 1, binding: editorKey, opponents: clone([...rows.values()]), studyAccepted: accepted }; }
  function restore(saved) {
    reset();
    if (saved?.schemaVersion !== 1 || saved.binding !== editorKey || !Array.isArray(saved.opponents)) return false;
    const c = context(), ids = c.players.map(p => p.seatId);
    for (const row of saved.opponents) {
      if (!Number.isInteger(row?.seatId) || !ids.includes(row.seatId) || row.enabled !== true || rows.has(row.seatId)) continue;
      if (row.callProbability != null && (typeof row.callProbability !== 'number' || !Number.isFinite(row.callProbability) || row.callProbability < 0 || row.callProbability > 1)) continue;
      if (row.range && (!Array.isArray(row.range.hands) || !row.range.hands.length || row.range.hands.length > 100)) continue;
      try {
        if (row.range?.hands.some(h => !Array.isArray(h) || h.length !== c.count || new Set(h).size !== h.length || h.some(card => !/^[2-9TJQKA][shdc]$/.test(card)))) continue;
        rows.set(row.seatId, clone(row));
      } catch { /* A malformed draft never becomes an active hypothesis. */ }
    }
    accepted = saved.studyAccepted === true; refresh(); fillEditor(); return true;
  }
  function init(next) {
    options = next;
    const legacy = $('#opponentHand').closest('.controls-panel');
    panel = document.createElement('details'); panel.id = 'opponent-input-panel'; panel.className = 'panel controls-panel';
    panel.innerHTML = '<summary id="opponent-input-summary">Opponents (optional)</summary><p id="opponent-input-scope" class="micro"></p><label>Apply only to<select id="opponent-seat"></select></label><div id="opponent-card-inputs" class="form-grid"></div><label>Call chance against the proposed size (%)<input id="opponent-call-probability" type="number" min="0" max="100" step="0.1" placeholder="Unknown"></label><p class="micro">One hand per line. Suit keys: E = spades, C = hearts, O = diamonds, P = clubs. Editing a field changes nothing until you apply it.</p><div class="opponent-input-actions"><button id="opponent-apply" type="button" class="primary-button">Apply to this opponent</button><button id="opponent-remove" type="button" class="ghost-button">Remove assumption</button></div><ul id="opponent-input-list"></ul><label class="checkbox-label"><input id="opponent-study-accepted" type="checkbox"> Use these rates in the independent call/fold study, without reraises or future bets. Explicit rates and valid contributions are required for every active opponent.</label><p id="opponent-input-message" class="micro" role="status"></p>';
    legacy.before(panel);
    for (const id of ['opponentHand', 'opponentRange']) $('#opponent-card-inputs').append($('#' + id).closest('label'));
    legacy.hidden = true;
    for (const id of ['opponentHand', 'opponentRange', 'opponent-call-probability']) $('#' + id).addEventListener('input', () => {
      drafts.set(Number(selected), { hand: $('#opponentHand').value, range: $('#opponentRange').value, rate: $('#opponent-call-probability').value });
    });
    $('#opponent-seat').onchange = () => { selected = $('#opponent-seat').value; fillEditor(); message(''); };
    $('#opponent-apply').onclick = apply;
    $('#opponent-remove').onclick = () => removeSeat(Number(selected));
    $('#opponent-study-accepted').onchange = () => { accepted = $('#opponent-study-accepted').checked; options.onChange(); };
    const button = document.createElement('button'); button.type = 'button'; button.id = 'open-opponent-inputs'; button.className = 'text-button'; button.textContent = 'Opponents · optional';
    button.onclick = () => { refresh(); const dialog = $('#settings-dialog'); if (!dialog.open) dialog.showModal(); panel.open = true; panel.scrollIntoView({ block: 'start' }); $('#opponent-seat').focus(); };
    $('#opponent-count').closest('label')?.after(button);
    refresh();
  }
  function payload() {
    refresh();
    const c=context(), activeSeats=active(c);
    const compact=new Map(activeSeats.map((seat,index)=>[seat.seatId,index]));
    return { opponentOverrides:clone([...rows.values()].filter(row=>compact.has(row.seatId)).map(row=>({...row,seatId:c.mode==='SIMPLE'?compact.get(row.seatId):row.seatId}))), opponentStudyAccepted:accepted };
  }
  window.theibsOpponentInputs = { init, refresh, reset, snapshot, restore, payload, seatEditor, applySeat, removeSeat };
})();
