(function (root) {
  'use strict';
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const kinds=[['players','Players'],['hands','Hand records'],['archive','Archived hands'],['decisions','Decision histories']];
  let getContext=null,onImport=null,dialog=null,captured=null,plan=null,incoming=null,summary=null,conflicts=null,phase='IDLE',generation=0,opener=null;
  const helper=()=>root.TheibsPlayersBackup;
  const clone=value=>root.structuredClone(value);
  const busy=()=>['READING','DOWNLOADING','RESTORING'].includes(phase);
  const hasChanges=()=>Boolean(plan && (plan.summary?.recordsChanged>0 || plan.summary?.provenanceChanged===true));
  function context() {
    const value=getContext?.();
    if(!value || typeof value.ownerKey!=='string' || !/^[a-f0-9]{64}$/i.test(value.ownerKey) || !value.library || value.revision===undefined)
      throw Error('The player library is unavailable for this account.');
    return value;
  }
  const sessionKey=value=>JSON.stringify(value.session ?? null);
  function capture(value) {
    return {ownerKey:value.ownerKey,revision:value.revision,session:sessionKey(value),capturedSession:clone(value.session ?? null),library:clone(value.library)};
  }
  function current() {
    if(!captured || !dialog?.open)return false;
    try{const value=context();return value.ownerKey===captured.ownerKey && value.revision===captured.revision && sessionKey(value)===captured.session;}
    catch{return false;}
  }
  function requireCurrent() {
    if(!current())throw Error('The account or player library changed. Close and reopen Backup. Saved data was left untouched.');
  }
  function active(token){return token===generation && Boolean(dialog?.open);}
  function status(text,error=false) {
    const node=dialog.querySelector('[data-backup-status]');node.textContent=text;node.classList.toggle('players-error',error);
    node.setAttribute('role',error?'alert':'status');
  }
  function controls() {
    if(!dialog)return;
    const valid=current();
    dialog.querySelector('[data-backup-download]').disabled=busy() || !valid;
    dialog.querySelector('[data-backup-file]').disabled=['DOWNLOADING','RESTORING'].includes(phase) || !valid;
    dialog.querySelector('[data-backup-restore]').disabled=busy() || !valid || !hasChanges();
    dialog.setAttribute('aria-busy',String(busy()));
  }
  function preview() {
    const node=dialog.querySelector('[data-backup-preview]');
    const count=value=>Number.isSafeInteger(value) && value>=0?value.toLocaleString('en-US'):'Unknown';
    if(!plan){
      if(conflicts && summary?.totals){node.hidden=false;node.innerHTML=`<h3>Restore blocked</h3><table class="players-backup-counts"><thead><tr><th>Records</th><th>In file</th><th>Conflicts</th></tr></thead><tbody>${kinds.map(([key,label])=>`<tr><th scope="row">${label}</th><td>${esc(count(summary.totals[key]))}</td><td>${esc(count(conflicts[key]))}</td></tr>`).join('')}</tbody></table><p>Conflicting or overlapping records stop this restore. No records will be overwritten.</p>`;return;}
      node.replaceChildren();node.hidden=true;return;
    }
    node.hidden=false;
    node.innerHTML=`<h3>Restore preview</h3><table class="players-backup-counts"><thead><tr><th>Records</th><th>New</th><th>Already present</th></tr></thead><tbody>${kinds.map(([key,label])=>`<tr><th scope="row">${label}</th><td>${esc(count(plan.summary?.added?.[key]))}</td><td>${esc(count(plan.summary?.identical?.[key]))}</td></tr>`).join('')}</tbody></table><p>No conflicting records were found. Existing matching records will be kept.</p><p class="players-backup-help">Decision histories contain original recorded snapshots. Restoring them does not run a new analysis.</p>`;
  }
  function reset() {
    generation++;captured=null;plan=null;incoming=null;summary=null;conflicts=null;phase='IDLE';
    if(dialog){dialog.querySelector('[data-backup-file]').value='';preview();status('');controls();}
  }
  function close() {
    reset();if(dialog?.open)dialog.close();
    if(opener?.isConnected!==false)opener?.focus?.({preventScroll:true});opener=null;
  }
  function failure(cause,stage) {
    plan=null;incoming=null;phase='ERROR';
    const conflict=typeof cause?.code==='string' && (cause.code.includes('CONFLICT') || cause.code==='BACKUP_OVERLAPPING_PLAYER');
    conflicts=conflict?Object.fromEntries(kinds.map(([key])=>[key,Array.isArray(cause.conflicts)?cause.conflicts.filter(item=>item.kind===key).length:null])):null;
    preview();
    const fallback=stage==='restore'?'Restore did not complete. Review the player library before retrying.':'The backup could not be read or validated. Saved data was left untouched.';
    status(conflict?'Conflicting records stop this restore. Existing records were not overwritten.':cause?.code && typeof cause.message==='string'?cause.message:cause?.message?.startsWith('The account or player library changed.')?cause.message:fallback,true);
    controls();
  }
  async function reviewFile() {
    const file=dialog.querySelector('[data-backup-file]').files?.[0],token=++generation;
    plan=null;incoming=null;summary=null;conflicts=null;phase='IDLE';preview();status('');
    if(!file){controls();return;}
    phase='READING';status('Reading and checking backup…');controls();
    try{
      requireCurrent();const api=helper();
      if(!api || typeof api.parse!=='function' || typeof api.planImport!=='function')throw Object.assign(Error('Backup tools are unavailable. Reload the app.'),{code:'BACKUP_RUNTIME_UNAVAILABLE'});
      if(!Number.isSafeInteger(file.size) || file.size<1 || file.size>api.MAX_BYTES)throw Object.assign(Error('Choose a nonempty backup file no larger than 10 MiB. Saved data was left untouched.'),{code:'BACKUP_FILE_SIZE'});
      const text=await file.text();if(!active(token))return;requireCurrent();
      if(typeof text!=='string' || new root.TextEncoder().encode(text).byteLength>api.MAX_BYTES)throw Object.assign(Error('The backup file exceeds the size limit. Saved data was left untouched.'),{code:'BACKUP_FILE_SIZE'});
      const parsed=await api.parse(text,{ownerKey:captured.ownerKey});if(!active(token))return;requireCurrent();
      summary=clone(parsed.summary);
      const reviewed=api.planImport({current:captured.library,incoming:parsed});
      if(!active(token))return;requireCurrent();plan=reviewed;incoming=clone(parsed.document);summary=clone(reviewed.summary);phase='REVIEW';preview();
      status(reviewed.summary.recordsChanged>0?'Backup checked. Review the counts, then choose Restore.':reviewed.summary.provenanceChanged===true?'The records already match. Restore will add only the backup-origin receipt.':'All reviewed records are already in this library. Nothing to restore.');controls();
    }catch(cause){if(active(token))failure(cause,'review');}
  }
  async function download() {
    if(busy())return;const token=++generation;plan=null;incoming=null;summary=null;conflicts=null;preview();phase='DOWNLOADING';status('Preparing backup…');controls();
    try{
      requireCurrent();const api=helper();if(typeof api?.create!=='function')throw Object.assign(Error('Backup tools are unavailable. Reload the app.'),{code:'BACKUP_RUNTIME_UNAVAILABLE'});
      const backup=await api.create({ownerKey:captured.ownerKey,library:captured.library});if(!active(token))return;requireCurrent();
      const blob=new root.Blob([backup.text],{type:'application/json'}),url=root.URL.createObjectURL(blob),anchor=root.document.createElement('a');
      try{anchor.href=url;anchor.download=`theibs-player-library-${new Date().toISOString().slice(0,10)}.json`;anchor.hidden=true;root.document.body.append(anchor);anchor.click();}
      finally{anchor.remove();root.setTimeout(()=>root.URL.revokeObjectURL(url),0);}
      phase='IDLE';status('Backup prepared. Check your downloads and keep the file private; it contains player notes and recorded hands.');controls();
    }catch(cause){if(active(token))failure(cause,'download');}
  }
  async function restore() {
    if(busy() || !hasChanges())return;
    const token=++generation;
    try{
      requireCurrent();const reviewed=plan,binding={ownerKey:captured.ownerKey,session:captured.session};phase='RESTORING';status('Restoring reviewed records…');controls();
      await onImport({plan:reviewed,incoming:clone(incoming),capturedOwner:captured.ownerKey,capturedRevision:captured.revision,capturedSession:clone(captured.capturedSession)});if(!active(token))return;
      const latest=context();if(latest.ownerKey!==binding.ownerKey || sessionKey(latest)!==binding.session){close();return;}
      captured=capture(latest);plan=null;incoming=null;summary=null;phase='COMPLETE';preview();status(reviewed.summary.recordsChanged>0?'Backup restored. Existing matching records were kept.':'Backup-origin receipt added. Existing matching records were kept.');controls();
    }catch(cause){if(active(token))failure(cause,'restore');}
  }
  function createDialog() {
    if(dialog)return;
    dialog=root.document.createElement('dialog');dialog.id='players-backup-dialog';dialog.className='multiway-dialog players-backup-dialog';
    dialog.setAttribute('aria-labelledby','players-backup-title');dialog.setAttribute('aria-describedby','players-backup-scope');
    dialog.innerHTML='<div class="multiway-dialog-head"><h2 id="players-backup-title">Player library backup</h2><button type="button" class="text-button" data-backup-close aria-label="Close player library backup">×</button></div><p id="players-backup-scope">Includes players, notes, confirmed observations, recorded hands and original decision snapshots. The current table session, settings and range templates are excluded.</p><p class="players-backup-help">Files stay on this device. Integrity checks file consistency, not the origin or mathematical validity of saved results.</p><button type="button" class="ghost-button" data-backup-download>Download backup</button><label class="players-backup-file">Review backup<input type="file" accept="application/json,.json" data-backup-file aria-describedby="players-backup-restore-help"></label><p id="players-backup-restore-help" class="players-backup-help">Selecting a file only reviews it. Existing matching records are kept; conflicting records stop the restore.</p><section data-backup-preview hidden aria-label="Backup restore preview"></section><p data-backup-status role="status" aria-live="polite"></p><div class="players-backup-actions"><button type="button" class="ghost-button" data-backup-cancel>Cancel</button><button type="button" class="primary-button" data-backup-restore disabled>Restore</button></div>';
    root.document.body.append(dialog);
    dialog.querySelector('[data-backup-file]').addEventListener('change',reviewFile);
    dialog.querySelector('[data-backup-download]').addEventListener('click',download);
    dialog.querySelector('[data-backup-restore]').addEventListener('click',restore);
    for(const selector of ['[data-backup-close]','[data-backup-cancel]'])dialog.querySelector(selector).addEventListener('click',close);
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{if(!dialog.open)reset();});
  }
  function init(options) {
    if(typeof options?.getContext!=='function' || typeof options?.onImport!=='function')throw Error('Player backup requires library access and a restore handler.');
    close();getContext=options.getContext;onImport=options.onImport;createDialog();return root.TheibsPlayersBackupUI;
  }
  function open() {
    if(!getContext || !onImport)throw Error('Player backup is not initialized.');
    createDialog();if(dialog.open){dialog.focus();return;}
    reset();captured=capture(context());opener=root.document.activeElement;dialog.showModal();controls();
    dialog.querySelector('[data-backup-download]').focus({preventScroll:true});
  }
  root.TheibsPlayersBackupUI={init,open,close,getState:()=>({open:Boolean(dialog?.open),phase,canRestore:current() && !busy() && hasChanges(),summary:summary?clone(summary):null})};
})(typeof globalThis!=='undefined'?globalThis:this);
