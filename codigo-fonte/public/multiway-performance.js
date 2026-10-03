(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TheibsMultiwayPerformance = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const integer = value => finite(value) && Math.abs(value * 100 - Math.round(value * 100)) < .00001 ? Math.round(value * 100) : null;
  const money = value => finite(value) ? (value / 100).toLocaleString('en-US', {maximumFractionDigits:2}) : '—';
  const signed = value => finite(value) ? `${value > 0 ? '+' : ''}${money(value)}` : 'Unknown';
  const dateLabel = value => Number.isFinite(value) ? new Date(value).toLocaleString('en-US', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Date unknown';
  const STATUS = {win:'Win',tie:'Tie',loss:'Loss',incomplete:'Incomplete',interrupted:'Interrupted',unknown:'Result unclear'};

  function normalize(hand) {
    const record = hand?.multiway, state = hand?.state;
    if (!record?.handId || !state) return null;
    const hero = state.players?.find(player => player.id === state.heroId || player.hero);
    const result = state.result, reconciliation = hand.reconciliation || {};
    const interrupted = Boolean(reconciliation.status === 'INTERRUPTED' || reconciliation.interrupted || hand.interrupted || /RESTART|INTERRUPT/.test(String(reconciliation.source || '')));
    const settled = !interrupted && state.phase === 'FINISHED' && result?.status === 'RECONCILED' && result.reason !== 'UNKNOWN' && reconciliation.resultPending !== true;
    const received = (result?.awards || []).filter(item => item.player === hero?.id);
    const pots = result?.pots || [];
    const won = pots.filter(pot => pot.winners?.includes(hero?.id));
    const prizes = received.map(item => integer(item.amount));
    const contribution = integer(hero?.totalPaid);
    const net = settled && hero && contribution !== null && Array.isArray(result?.awards) && prizes.every(value => value !== null)
      ? prizes.reduce((sum,value) => sum + value, 0) - contribution : null;
    let outcome = interrupted ? 'interrupted' : !settled ? 'incomplete' : 'unknown';
    if (settled && hero && pots.length && pots.every(pot => Array.isArray(pot.winners) && pot.winners.length)) {
      outcome = won.some(pot => pot.winners.length === 1) ? 'win' : won.length ? 'tie' : 'loss';
    }
    const unit = record.config?.currency || record.config?.chipUnit || 'chips';
    const rawDate = hand.archivedAt || record.endedAt || record.createdAt;
    const time = rawDate ? Date.parse(rawDate) : NaN;
    return {id:record.handId,number:record.handNumber ?? record.session?.handNumber ?? null,
      sessionId:record.sessionId ?? record.session?.id ?? null,time,unit:String(unit),outcome,settled,net,
      estimated:Boolean(record.config?.stackEstimates?.some(Boolean)),
      rakeUnknown:settled && reconciliation.rakeObserved === false,
      partial:net === null || Boolean(record.config?.stackEstimates?.some(Boolean)) || (settled && reconciliation.rakeObserved === false),
      playerCount:record.config?.players?.length || state.players?.length || 0,
      source:reconciliation.source || null,hand};
  }

  function summarize(records, filter = {}) {
    const unique = new Map();
    for (const hand of records || []) { const item = normalize(hand); if (item) unique.set(item.id,item); }
    const all = [...unique.values()].sort((a,b) => (Number.isFinite(a.time)?a.time:Infinity) - (Number.isFinite(b.time)?b.time:Infinity) || a.id.localeCompare(b.id));
    const now = new Date(filter.now ?? Date.now()), today = new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
    let start = -Infinity, end = Infinity;
    if (filter.period === 'today') start = today;
    if (filter.period === '7d' || filter.period === '30d') { const d = new Date(today);d.setDate(d.getDate()-(filter.period === '7d'?6:29));start=d.getTime(); }
    if (filter.period === 'custom') {
      start = filter.from ? new Date(`${filter.from}T00:00:00`).getTime() : -Infinity;
      if (filter.to) { const d = new Date(`${filter.to}T00:00:00`);d.setDate(d.getDate()+1);end=d.getTime(); }
    }
    const invalidRange = Number.isNaN(start) || Number.isNaN(end) || start >= end;
    const sessionMissing = filter.period === 'session' && !filter.sessionId;
    const periodItems = invalidRange || sessionMissing ? [] : all.filter(item => {
      if (filter.period === 'session') return item.sessionId === filter.sessionId;
      if (!filter.period || filter.period === 'all') return true;
      return Number.isFinite(item.time) && item.time >= start && item.time < end;
    });
    const units = [...new Set(periodItems.map(item => item.unit))].sort();
    const unit = units.includes(filter.unit) ? filter.unit : units[0] || filter.unit || 'chips';
    const items = periodItems.filter(item => item.unit === unit);
    const counts = {win:0,tie:0,loss:0,incomplete:0,interrupted:0,unknown:0,settled:0};
    let cumulative = 0, known = 0;
    const points = [{index:0,net:0,cumulative:0,id:null,time:items[0]?.time}];
    items.forEach((item,index) => {
      counts[item.outcome]++;if(item.settled)counts.settled++;
      if(item.net !== null){cumulative+=item.net;known++;points.push({...item,index:index+1,cumulative});}
      else points.push({...item,index:index+1,cumulative:null});
    });
    return {items,points,counts,unit,units,total:known?cumulative:null,known,
      partial:items.some(item=>item.partial),invalidRange,sessionMissing,
      unrecordedRake:items.some(item=>item.rakeUnknown),estimated:items.some(item=>item.estimated)};
  }

  let options = {}, sessionId = null, initialized = false, error = '';
  const instances = [], receipts = new Map();
  const filter = {period:'session',from:'',to:'',unit:'chips'};
  function records() { return options.getArchivedHands?.() || root.theibsPlayersUI?.archivedHands?.() || []; }
  function currentSession() { return options.getSessionId?.() || sessionId; }
  function chart(summary) {
    if (!summary.items.length) return '<p class="mw-performance-empty">No saved hands in this interval.</p>';
    if (!summary.known) return '<p class="mw-performance-empty">Results are unresolved. No profit values are plotted.</p>';
    const w=660,h=188,left=58,right=16,top=18,bottom=32,values=summary.points.filter(point=>point.cumulative!==null).map(point=>point.cumulative);
    let low=Math.min(0,...values),high=Math.max(0,...values);if(low===high){low-=100;high+=100;}
    const pad=(high-low)*.1;low-=pad;high+=pad;
    const x=index=>left+index/Math.max(1,summary.items.length)*(w-left-right);
    const y=value=>top+(high-value)/(high-low)*(h-top-bottom);
    const grid=[high,(high+low)/2,low].map(value=>`<line x1="${left}" y1="${y(value)}" x2="${w-right}" y2="${y(value)}"/><text x="${left-8}" y="${y(value)+4}" text-anchor="end">${esc(money(value))}</text>`).join('');
    let path='',pen=false;
    for(const point of summary.points){if(point.cumulative===null){pen=false;continue;}path+=`${pen?' L':' M'}${x(point.index).toFixed(1)},${y(point.cumulative).toFixed(1)}`;pen=true;}
    const dots=summary.points.filter(point=>point.id&&point.cumulative!==null).map(point=>{
      const tip=`${dateLabel(point.time)} · Hand ${point.number ?? point.id.slice(0,8)} · ${signed(point.net)} ${summary.unit} · Running ${signed(point.cumulative)} ${summary.unit}`;
      return `<circle cx="${x(point.index)}" cy="${y(point.cumulative)}" r="3.5" tabindex="0" role="img" aria-label="${esc(tip)}"><title>${esc(tip)}</title></circle>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Hero cumulative recorded net in ${esc(summary.unit)} by saved hand; starts at zero in this interval${summary.partial?'; partial history':''}"><g class="mw-performance-grid">${grid}<text x="${left}" y="${h-8}">0</text><text x="${w-right}" y="${h-8}" text-anchor="end">${summary.items.length} saved hands</text></g><line class="mw-performance-zero" x1="${left}" y1="${y(0)}" x2="${w-right}" y2="${y(0)}"/><path class="mw-performance-line" d="${path.trim()}"/>${dots}</svg>`;
  }
  function rows(summary) {
    return summary.items.slice().reverse().map(item=>{
      const saved=receipts.get(item.id),messages=saved?[...saved.values()]:[];
      const states=[item.estimated?'Estimated opening stacks':null,item.rakeUnknown?'Before unrecorded rake':null].filter(Boolean);
      const actions=(item.hand.state.log||[]).map(event=>`<li>${esc(event.street || '')} · ${esc(item.hand.state.players?.find(player=>player.id===event.actor)?.name || (event.actor===undefined?'Table':`Seat ${event.actor+1}`))} · ${esc(event.action)}${finite(event.amount)?' '+esc(money(integer(event.amount))):''}</li>`).join('');
      return `<li><details data-performance-record="${esc(item.id)}"><summary><span class="mw-performance-hand">Hand ${esc(item.number ?? item.id.slice(0,8))}<small>${esc(dateLabel(item.time))}</small></span><span class="mw-performance-outcome" data-outcome="${item.outcome}">${STATUS[item.outcome]}</span><b>${esc(signed(item.net))}</b></summary><p>Saved ${esc(dateLabel(item.time))} · ${item.playerCount} players preserved${states.length?' · '+esc(states.join(' · ')):''}.</p>${item.net===null?'<p>Unresolved result; excluded from recorded profit.</p>':''}${messages.length?`<ul>${messages.map(message=>`<li>${esc(message)}</li>`).join('')}</ul>`:''}${options.onReview?`<button type="button" class="text-button" data-performance-hand="${esc(item.id)}">Review saved hand</button>`:''}${actions?`<details class="mw-performance-actions"><summary>Recorded actions</summary><ul>${actions}</ul></details>`:''}</details></li>`;
    }).join('');
  }
  function refresh() {
    if (!initialized) return;
    let summary;
    try { summary = summarize(records(),{...filter,sessionId:currentSession()}); }
    catch(cause){error=cause.message || 'Saved hands could not be read.';summary=summarize([],filter);}
    filter.unit=summary.unit;
    const countText=`${summary.counts.win} W · ${summary.counts.tie} T · ${summary.counts.loss} L`;
    for (const instance of instances) {
      const node=instance.node;
      node.querySelector('[data-performance-total]').textContent=`${summary.known?signed(summary.total):'—'} ${summary.unit} · ${countText}`;
      node.querySelector('[data-performance-period]').value=filter.period;
      node.querySelector('[data-performance-custom]').hidden=filter.period!=='custom';
      for(const key of ['from','to']){
        const field=node.querySelector(`[data-performance-${key}]`);
        if(field!==root.document.activeElement)field.value=filter[key];
      }
      const unit=node.querySelector('[data-performance-unit]');
      const unitKey=JSON.stringify(summary.units);
      if(unit.dataset.units!==unitKey){unit.innerHTML=(summary.units.length?summary.units:[summary.unit]).map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');unit.dataset.units=unitKey;}
      unit.value=summary.unit;unit.parentElement.hidden=summary.units.length<2;
      const note=error || (summary.invalidRange?'Choose a valid date interval.':summary.sessionMissing?'Start a continuous table to filter this session.':summary.partial?'Partial recorded net · unresolved hands are gaps; opening estimates and unrecorded rake are identified below.':'Recorded net · prizes minus contributions, excluding stack corrections and rebuys.');
      const status=node.querySelector('[data-performance-status]');status.textContent=note;status.classList.toggle('is-error',Boolean(error || summary.invalidRange));
      const active=root.document.activeElement;
      if(!node.querySelector('[data-performance-chart]').contains(active)&&!node.querySelector('[data-performance-list]').contains(active)){
        node.querySelector('[data-performance-counts]').innerHTML=Object.entries(summary.counts).filter(([name])=>name!=='unknown'||summary.counts.unknown).map(([name,value])=>`<span><b>${value}</b> ${esc(name==='settled'?'Settled':STATUS[name] || name)}</span>`).join('');
        node.querySelector('[data-performance-chart]').innerHTML=chart(summary);
        const opened=new Set([...node.querySelectorAll('[data-performance-record][open]')].map(item=>item.dataset.performanceRecord));
        node.querySelector('[data-performance-list]').innerHTML=rows(summary);
        for(const record of node.querySelectorAll('[data-performance-record]'))record.open=opened.has(record.dataset.performanceRecord);
      }
      node.querySelector('[data-performance-axis]').textContent=`Hero recorded net · ${summary.unit}`;
    }
    return summary;
  }
  function mount(host,id,compact=false) {
    if(!host)return;
    const node=root.document.createElement('details');node.id=id;node.className='mw-performance';node.dataset.compact=String(compact);
    node.innerHTML=`<summary><span>Performance &amp; hands</span><small data-performance-total>—</small></summary><section class="mw-performance-content" aria-label="Saved Multiway performance"><div class="mw-performance-filters"><label>Interval<select data-performance-period aria-label="Performance interval"><option value="session">Session</option><option value="today">Today</option><option value="7d">7 days</option><option value="30d">30 days</option><option value="all">All</option><option value="custom">Custom</option></select></label><label hidden>Unit<select data-performance-unit aria-label="Performance unit"></select></label><div data-performance-custom hidden><label>From<input type="date" data-performance-from aria-label="Performance start date"></label><label>To<input type="date" data-performance-to aria-label="Performance end date"></label></div></div><div class="mw-performance-counts" data-performance-counts></div><p class="mw-performance-status" data-performance-status role="status"></p><div class="mw-performance-axis" data-performance-axis></div><div class="mw-performance-chart" data-performance-chart></div><ol class="mw-performance-list" data-performance-list></ol></section>`;
    node.querySelector('[data-performance-period]').addEventListener('change',event=>{filter.period=event.target.value;refresh();});
    node.querySelector('[data-performance-unit]').addEventListener('change',event=>{filter.unit=event.target.value;refresh();});
    for(const key of ['from','to'])node.querySelector(`[data-performance-${key}]`).addEventListener('change',event=>{filter[key]=event.target.value;refresh();});
    node.addEventListener('click',event=>{const button=event.target.closest('[data-performance-hand]');if(button)options.onReview?.(button.dataset.performanceHand);});
    node.addEventListener('keydown',event=>event.stopPropagation());
    node.addEventListener('focusout',()=>root.queueMicrotask(()=>{
      const active=root.document.activeElement;
      if(!node.querySelector('[data-performance-chart]').contains(active)&&!node.querySelector('[data-performance-list]').contains(active))refresh();
    }));
    host.append(node);instances.push({node,host});
  }
  function init(settings={}) {
    options={...options,...settings};
    if(initialized){refresh();return api;}
    if(!root.document)return api;
    initialized=true;
    const history=settings.host || root.document.querySelector('#history-workspace');
    mount(history,'multiway-performance');
    if(history){const node=instances.at(-1)?.node;const heading=history.querySelector('.view-heading');if(node&&heading)heading.after(node);else if(node)history.prepend(node);}
    mount(settings.secondaryHost || root.document.querySelector('#analyze-workspace .context-rail'),'multiway-performance-table',true);
    root.document.addEventListener('theibs:players-changed',refresh);
    root.document.addEventListener('theibs:players-backup-restored',refresh);
    refresh();return api;
  }
  function notifySaved({handId,message,key}={}) {
    if(!handId||!message||!key)return false;
    if(!records().some(hand=>hand.multiway?.handId===handId))return false;
    if(!receipts.has(handId))receipts.set(handId,new Map());
    const entries=receipts.get(handId);if(entries.has(key))return false;
    entries.set(key,message);error='';refresh();return true;
  }
  function notifyError(message) {error=String(message||'Saving failed. Your hand remains available.');refresh();}
  function setSession(id) {sessionId=id||null;return refresh();}
  function setFilter(value) {Object.assign(filter,value);return refresh();}
  const api={init,refresh,setSession,setFilter,notifySaved,notifyError,normalize,summarize};
  return api;
});
