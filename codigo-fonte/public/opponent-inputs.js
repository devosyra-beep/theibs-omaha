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
    for (const id of rows.keys()) if (!players.some(p => p.seatId === id)) { rows.delete(id); accepted = false; changed = true; }
    for (const id of drafts.keys()) if (!players.some(p => p.seatId === id)) drafts.delete(id);
    const nextBindings = JSON.stringify(players.map(p => [p.seatId, p.label]));
    if (nextBindings !== bindings || changed) {
      bindings = nextBindings;
      $('#opponent-seat').replaceChildren(...players.map(p => new Option(p.label, String(p.seatId))));
      if (!players.some(p => String(p.seatId) === selected)) selected = String(players[0]?.seatId ?? '');
      $('#opponent-seat').value = selected; fillEditor();
    }
    $('#opponent-study-accepted').checked = accepted;
    $('#opponent-apply').disabled = !players.length || Boolean(c.busy);
    $('#opponent-seat').disabled = !players.length || Boolean(c.busy);
    $('#opponent-input-summary').textContent = rows.size ? `Adversários (opcional) · ${rows.size} com hipótese manual` : 'Adversários (opcional) · sem hipóteses de comportamento';
    const unknown = players.filter(p => rows.get(p.seatId)?.callProbability == null);
    $('#opponent-input-scope').textContent = rows.size
      ? `${rows.size} adversário(s) com informação manual. ${unknown.length} sem taxa de resposta: nenhuma taxa foi presumida. ${unknown.length ? 'Equity continua disponível; BET/RAISE podem ficar sem modelo completo.' : 'Taxas informadas são hipóteses, não frequências verificadas.'}`
      : 'Equity usa mãos legais aleatórias para todos. Não é necessário preencher este painel. A ferramenta não observa nem deduz perfis dos adversários.';
    $('#opponent-input-list').replaceChildren(...players.filter(p => rows.has(p.seatId)).map(p => {
      const node = document.createElement('li'), row = rows.get(p.seatId);
      node.textContent = `${p.label}: ${row.range ? 'range manual' : 'cartas desconhecidas'}; ${row.callProbability == null ? 'resposta desconhecida' : `call ${Number((row.callProbability * 100).toFixed(2))}% (hipótese)`}`;
      return node;
    }));
  }
  function parseRange() {
    const hand = $('#opponentHand').value.trim(), text = $('#opponentRange').value.trim(), c = context();
    if (hand && text) throw Error('Preencha uma mão conhecida ou um range, não os dois.');
    if (!hand && !text) return null;
    const lines = (hand || text).split(/\n|\|/).map(s => s.trim()).filter(Boolean);
    if (lines.length > 100) throw Error('Use até 100 mãos no range deste cenário.');
    const hands = lines.map(line => TheibsCards.parsePortugueseCards(line).map(TheibsCards.toCanonical));
    if (hands.some(h => h.length !== c.count)) throw Error(`Cada mão precisa de ${c.count} cartas. Use E/C/O/P para os naipes.`);
    return { hands };
  }
  function apply() {
    try {
      refresh();
      const c = context(), seatId = Number(selected);
      if (c.busy || !active(c).some(p => p.seatId === seatId)) throw Error('O adversário não está disponível neste contexto.');
      const range = parseRange(), raw = $('#opponent-call-probability').value.trim(), rate = raw === '' ? null : Number(raw) / 100;
      if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 1)) throw Error('A chance de call deve estar entre 0 e 100%.');
      if (!range && rate === null) throw Error('Informe uma variável ou remova a hipótese deste adversário.');
      rows.set(seatId, { seatId, enabled: true, ...(range ? { range } : {}), ...(rate === null ? {} : { callProbability: rate }) });
      drafts.delete(seatId);
      accepted = false; refresh(); fillEditor();
      message('Hipótese aplicada somente ao adversário selecionado. Os demais não foram alterados.'); options.onChange();
    } catch (error) { message(error.message, true); }
  }
  function reset() { rows.clear(); drafts.clear(); accepted = false; editorKey = ''; refresh(); fillEditor(); message(''); }
  function snapshot() { refresh(); return { schemaVersion: 1, binding: editorKey, opponents: clone([...rows.values()]), studyAccepted: accepted }; }
  function restore(saved) {
    reset();
    if (saved?.schemaVersion !== 1 || saved.binding !== editorKey || !Array.isArray(saved.opponents)) return false;
    const c = context(), ids = active(c).map(p => p.seatId);
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
    panel.innerHTML = '<summary id="opponent-input-summary">Adversários (opcional)</summary><p id="opponent-input-scope" class="micro"></p><label>Aplicar somente a<select id="opponent-seat"></select></label><div id="opponent-card-inputs" class="form-grid"></div><label>Chance de call contra o tamanho proposto (%)<input id="opponent-call-probability" type="number" min="0" max="100" step="0.1" placeholder="Desconhecida"></label><p class="micro">Uma mão por linha, usando E = espadas, C = copas, O = ouros, P = paus. Preencher um campo não aplica nada antes de clicar em Aplicar.</p><div class="opponent-input-actions"><button id="opponent-apply" type="button" class="primary-button">Aplicar a este adversário</button><button id="opponent-remove" type="button" class="ghost-button">Remover hipótese</button></div><ul id="opponent-input-list"></ul><label class="checkbox-label"><input id="opponent-study-accepted" type="checkbox"> Usar as taxas no estudo independente de call/fold, sem reaumentos ou apostas futuras. Exige taxas explícitas para todos os ativos e contribuições válidas.</label><p id="opponent-input-message" class="micro" role="status"></p>';
    legacy.before(panel);
    for (const id of ['opponentHand', 'opponentRange']) $('#opponent-card-inputs').append($('#' + id).closest('label'));
    legacy.hidden = true;
    for (const id of ['opponentHand', 'opponentRange', 'opponent-call-probability']) $('#' + id).addEventListener('input', () => {
      drafts.set(Number(selected), { hand: $('#opponentHand').value, range: $('#opponentRange').value, rate: $('#opponent-call-probability').value });
    });
    $('#opponent-seat').onchange = () => { selected = $('#opponent-seat').value; fillEditor(); message(''); };
    $('#opponent-apply').onclick = apply;
    $('#opponent-remove').onclick = () => { rows.delete(Number(selected)); drafts.delete(Number(selected)); accepted = false; refresh(); fillEditor(); message('Removido. Este adversário voltou ao modelo de cartas desconhecidas.'); options.onChange(); };
    $('#opponent-study-accepted').onchange = () => { accepted = $('#opponent-study-accepted').checked; options.onChange(); };
    const button = document.createElement('button'); button.type = 'button'; button.id = 'open-opponent-inputs'; button.className = 'text-button'; button.textContent = 'Adversários · opcional';
    button.onclick = () => { refresh(); const dialog = $('#settings-dialog'); if (!dialog.open) dialog.showModal(); panel.open = true; panel.scrollIntoView({ block: 'start' }); $('#opponent-seat').focus(); };
    $('#opponent-count').closest('label')?.after(button);
    refresh();
  }
  window.theibsOpponentInputs = { init, refresh, reset, snapshot, restore, payload: () => { refresh(); return { opponentOverrides: clone([...rows.values()]), opponentStudyAccepted: accepted }; } };
})();
