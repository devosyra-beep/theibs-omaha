/* Destination controls reuse the existing keyboard transaction and cancel any
 * pending voice command BEFORE changing its destination. No ASR guessing. */
(function () {
  'use strict';
  const keyboard = window.theibsCardKeyboard, voice = window.theibsCardVoice;
  const panel = document.getElementById('card-voice');
  if (!panel || !keyboard || !voice) return;
  const names = { hero:'Mão', flop:'Flop', turn:'Turn', river:'River' };
  const host = document.createElement('div'); host.className = 'voice-destination';
  host.innerHTML = '<strong id="voice-destination-label" role="status" aria-live="polite"></strong><div role="group" aria-label="Destino das próximas cartas por voz"></div><p class="voice-help">Selecione o destino antes de falar. Sem prefixo reconhecido, vale a posição indicada aqui; nenhuma palavra perdida é adivinhada.</p>';
  panel.querySelector('.voice-options').after(host);
  const group = host.querySelector('[role="group"]');
  const buttons = Object.fromEntries(Object.entries(names).map(([target, name]) => {
    const button = document.createElement('button'); button.type = 'button';
    button.dataset.voiceTarget = target; button.textContent = name;
    button.addEventListener('click', () => {
      if (voice.getStatus().committing || window.theibsVoiceEvaluation?.isActive()) return;
      voice.cancel('Destino alterado. A fala pendente foi cancelada. Inicie a voz para continuar.');
      const count = keyboard.state.count, ranges = {hero:[0,count],flop:[count,count+3],turn:[count+3,count+4],river:[count+4,count+5]};
      const [from,to] = ranges[target];
      let index = keyboard.state.slots.findIndex((card,i) => i >= from && i < to && !card);
      if (index < 0) index = from;
      keyboard.select(index); render();
    });
    group.append(button); return [target,button];
  }));
  function render() {
    const count=keyboard.state.count, index=keyboard.state.selected;
    const target=index<count?'hero':index<count+3?'flop':index===count+3?'turn':'river';
    const occupied=Boolean(keyboard.state.slots[index]);
    const multiway=document.body.dataset.multiway==='on';
    host.querySelector('#voice-destination-label').textContent = `Destino ativo: ${names[target]} · posição ${index<count?index+1:index-count+1}${occupied?' · carta preenchida':''}`;
    for (const [key,button] of Object.entries(buttons)) {
      button.setAttribute('aria-pressed',String(key===target));
      button.disabled=voice.getStatus().committing || Boolean(window.theibsVoiceEvaluation?.isActive()) || (multiway&&key!=='hero');
      button.title=multiway&&key!=='hero'?'No Multiway, diga a próxima street inteira para atualizar o ledger.':'';
    }
  }
  // Continuous phrases avoid deliberately stopping after every card. The user
  // can still choose single-card/hold modes; no timers or final-only rules change.
  const pace=document.getElementById('voice-pace');
  pace.value='batch'; pace.dispatchEvent(new Event('change',{bubbles:true}));
  document.getElementById('selected-card-label')?.classList.remove('sr-only');
  for (const event of ['theibs:cards-changed','theibs:card-selection','theibs:voice-session-changed']) document.addEventListener(event,render);
  new MutationObserver(render).observe(panel,{attributes:true,attributeFilter:['data-capture-state']});
  new MutationObserver(render).observe(document.body,{attributes:true,attributeFilter:['data-multiway','data-multiway-busy']});
  render();
})();
