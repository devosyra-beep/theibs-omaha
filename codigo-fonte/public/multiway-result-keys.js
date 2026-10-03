/* Result-only numeric shortcuts. No poker actions, accounting or Enter owner. */
(function (root, factory) {
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TheibsMultiwayResultKeys=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function keyForPlayer(player,state){
    const players=state?.players||[],heroIndex=players.findIndex(item=>item.hero||item.id===state?.heroId);
    const playerIndex=players.findIndex(item=>item.id===player?.id);
    if(heroIndex<0||playerIndex<0)return null;
    const relative=(playerIndex-heroIndex+players.length)%players.length;
    return relative<=9?String(relative):null;
  }
  function playerForKey(key,state){
    if(!/^[0-9]$/.test(String(key)))return null;
    return state?.players?.find(player=>keyForPlayer(player,state)===String(key))||null;
  }
  function resolveWinnerKey(event,{state,potIndex=0,editing=false,enabled=true,busy=false}={}){
    if(!enabled||busy||editing||event.defaultPrevented||event.repeat||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.getModifierState?.('AltGraph'))return null;
    if(!/^[0-9]$/.test(event.key||''))return null;
    const player=playerForKey(event.key,state),pot=state?.pots?.[potIndex];
    if(!player)return {type:'REJECT_WINNER',key:event.key,potIndex,message:`No player is assigned to ${event.key}.`};
    if(!pot||!Number.isInteger(potIndex))return {type:'REJECT_WINNER',key:event.key,potIndex,message:'Select a pot before choosing its winner.'};
    const label=event.key==='0'?'You':`A${event.key}`;
    if(!pot.eligible?.includes(player.id))return {type:'REJECT_WINNER',key:event.key,potIndex,playerId:player.id,message:`${label} is not eligible for ${potIndex===0?'the main pot':`side pot ${potIndex}`}.`};
    return {type:'TOGGLE_WINNER',key:event.key,potIndex,playerId:player.id};
  }
  function isEditing(target){
    const node=target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    return Boolean(node&&!(node.tagName==='INPUT'&&['checkbox','radio','button','submit','reset'].includes(node.type)));
  }
  const bindings=new WeakMap();
  function bind({dialog,getState,isBusy=()=>false,onError=()=>{},onChange=()=>{},onBack=()=>{}}){
    if(!dialog||typeof getState!=='function')throw Error('A result dialog and its current state are required.');
    bindings.get(dialog)?.();
    let activePot=0,handId=null,history=[],goingBack=false;
    const syncHand=()=>{const state=getState();if(state?.handId!==handId){handId=state?.handId;activePot=0;history=[];}return state;};
    const rememberPot=event=>{
      syncHand();
      const field=event.target?.closest?.('[data-mw-pot]');
      if(field&&dialog.contains(field))activePot=Number(field.dataset.mwPot);
    };
    const reset=()=>{activePot=0;handId=null;history=[];};
    const rememberSelection=event=>{
      const field=event.target?.closest?.('[data-mw-pot]');
      if(!field||goingBack)return;
      history.push({pot:Number(field.dataset.mwPot),player:Number(field.value),checked:!field.checked});
    };
    const keydown=event=>{
      if(!dialog.open)return;
      const state=syncHand();
      rememberPot(event);
      if(event.key==='Backspace'&&!isEditing(event.target)&&!event.repeat&&!event.isComposing&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&!event.defaultPrevented){
        event.preventDefault();event.stopPropagation();if(isBusy())return;
        const previous=history.pop();
        const field=previous&&[...dialog.querySelectorAll('[data-mw-pot]')].find(node=>Number(node.dataset.mwPot)===previous.pot&&Number(node.value)===previous.player);
        if(field){
          goingBack=true;
          try{field.checked=previous.checked;field.focus({preventScroll:true});field.dispatchEvent(new dialog.ownerDocument.defaultView.Event('change',{bubbles:true}));onError('');}
          finally{goingBack=false;}
        }else onBack();
        return;
      }
      const intent=resolveWinnerKey(event,{state,potIndex:activePot,editing:isEditing(event.target),enabled:!!dialog.querySelector('[data-mw-pot]'),busy:isBusy()});
      if(!intent)return;
      event.preventDefault();event.stopPropagation();
      if(intent.type==='REJECT_WINNER'){onError(intent.message);return;}
      const field=[...dialog.querySelectorAll('[data-mw-pot]')].find(node=>Number(node.dataset.mwPot)===intent.potIndex&&Number(node.value)===intent.playerId);
      if(!field||field.disabled){onError('That winner cannot be selected for this pot right now.');return;}
      field.checked=!field.checked;field.focus({preventScroll:true});
      const EventType=dialog.ownerDocument.defaultView.Event;
      field.dispatchEvent(new EventType('change',{bubbles:true}));onError('');onChange(intent);
    };
    dialog.addEventListener('focusin',rememberPot);dialog.addEventListener('change',rememberSelection);dialog.addEventListener('keydown',keydown);dialog.addEventListener('close',reset);
    const dispose=()=>{dialog.removeEventListener('focusin',rememberPot);dialog.removeEventListener('change',rememberSelection);dialog.removeEventListener('keydown',keydown);dialog.removeEventListener('close',reset);bindings.delete(dialog);};
    bindings.set(dialog,dispose);return dispose;
  }
  return {keyForPlayer,playerForKey,resolveWinnerKey,bind};
});
