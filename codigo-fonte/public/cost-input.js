(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TheibsCostInput=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const missing=value=>value==null||String(value).trim()==='';
  function collect(fields){
    const result={rake:fields.rake,assumeNoRake:fields.assumeNoRake===true};
    if(fields.mode!=='PERCENT_CAPPED')return result;
    result.rake=undefined;result.assumeNoRake=false;
    const absent=[];
    if(missing(fields.rate))absent.push('rakeSchedule.rate');
    if(missing(fields.cap))absent.push('rakeSchedule.cap');
    if(absent.length){result.costInputMissing=absent;return result;}
    result.rakeSchedule={type:'PERCENT_CAPPED',rate:Number(fields.rate)/100,cap:Number(fields.cap),
      noFlopNoDrop:fields.noFlopNoDrop===true,rounding:fields.rounding,source:'USER_PROVIDED',version:'1'};
    return result;
  }
  // Old drafts may contain a checkbox that the old UI checked automatically.
  // Keep cards and actual amounts; require a fresh explicit zero-cost choice.
  function restoreZeroRake(workspace){
    const explicitVersion=workspace?.ui?.costInputsVersion===1;
    // The restored workspace is an in-memory draft. Sanitize its legacy return
    // snapshot too, before exitMultiway can copy those checkbox values back.
    // Do not change recorded amounts, cards or new explicit cost choices.
    const backup=workspace?.multiwayYesple?.fields;
    if(!explicitVersion&&backup&&typeof backup==='object'&&!Array.isArray(backup))backup.assumeNoRake=false;
    return explicitVersion&&workspace.fields?.assumeNoRake===true;
  }
  return {collect,restoreZeroRake};
});
