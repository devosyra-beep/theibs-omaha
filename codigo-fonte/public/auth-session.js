/* Claims correlate session continuity only. Server authentication authorizes.
 * The public controller never exposes credentials or logs provider payloads. */
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TheibsAuthSession=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const STORAGE_KEY='theibs.auth.session.v1',EARLY_MS=60000;
  function authError(code='AUTH_REQUIRED'){const e=new Error(code==='AUTH_SESSION_CHANGED'?'Your session changed. Sign in again before continuing.':'Your session expired or could not be renewed. Sign in again to continue.');e.code=code;return e;}
  function claims(token){try{return JSON.parse(atob(String(token).split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{return {};}}
  function identity(value){if(!value?.access_token)return null;const jwt=claims(value.access_token),sub=jwt.sub||value.user?.id;return sub?`${sub}:${jwt.session_id||'-'}`:`opaque:${value.access_token}`;}
  function create({config,fetch:send,storage,baseUrl,now=Date.now,onChange=()=>{},withLock=null,timers=true,refreshTimeoutMs=8000}){
    let session=null,epoch=0,generation=0,refreshMargin=EARLY_MS,rejected=false,signedOut=false,refreshing=null,timer=null;
    const pending=new Set(),required=config.required!==false;
    function expiry(value=session){const stored=Number(value?.expires_at),jwt=Number(claims(value?.access_token).exp)*1000;return Number.isFinite(jwt)&&jwt>0?Math.min(stored,jwt):stored;}
    function context(){return {epoch,required,expired:required&&(signedOut||rejected||!session?.access_token||!Number.isFinite(expiry())||expiry()<=now())};}
    function read(){try{return JSON.parse(storage.getItem(STORAGE_KEY)||'null');}catch{return null;}}
    function persist(value){try{if(value)storage.setItem(STORAGE_KEY,JSON.stringify(value));else storage.removeItem(STORAGE_KEY);}catch{}}
    function assertEpoch(expected){if(epoch!==expected||signedOut||rejected)throw authError('AUTH_SESSION_CHANGED');}
    function changed(a,b){return a?.access_token!==b?.access_token||a?.refresh_token!==b?.refresh_token||Number(a?.expires_at)!==Number(b?.expires_at);}
    function schedule(){clearTimeout(timer);timer=null;if(!timers||!required||!session||signedOut||rejected)return;const remaining=expiry()-now(),early=session.refresh_token?refreshMargin:0;timer=setTimeout(()=>{ensureSession().catch(()=>{});},Math.max(1,Math.min(2147483647,remaining-early)));timer.unref?.();}
    function invalidate(reason='AUTH_REQUIRED',{clearStorage=true}={}){epoch++;rejected=true;session=null;clearTimeout(timer);timer=null;for(const c of pending)c.abort(authError(reason==='AUTH_SESSION_CHANGED'?'AUTH_SESSION_CHANGED':'AUTH_REQUIRED'));pending.clear();if(clearStorage)persist(null);onChange({reason,invalid:true,context:context()});}
    function accept(value,{initial=false,persistValue=true}={}){
      if(!value?.access_token||!Number.isFinite(Number(value.expires_at)))throw authError();
      if(!initial&&identity(session)!==identity(value)){invalidate('AUTH_SESSION_CHANGED',{clearStorage:false});throw authError('AUTH_SESSION_CHANGED');}
      session=value;generation++;refreshMargin=initial?EARLY_MS:Math.min(EARLY_MS,Math.max(1,(expiry()-now())*0.2));rejected=false;signedOut=false;if(initial)epoch++;if(persistValue)persist(value);schedule();onChange({reason:initial?'SESSION_LOADED':'TOKEN_REFRESHED',invalid:false,context:context()});
    }
    function load(value=read()){if(!required){session=null;rejected=false;signedOut=false;onChange({reason:'AUTH_NOT_REQUIRED',invalid:false,context:context()});return;}if(!value?.access_token){session=null;rejected=true;onChange({reason:'AUTH_REQUIRED',invalid:true,context:context()});return;}try{accept(value,{initial:true});}catch{invalidate();}}
    async function ensureSession({force=false,failedToken=null,failedGeneration=null}={}){
      if(!required)return context();if(signedOut||rejected||!session?.access_token)throw authError();
      if(failedToken&&session.access_token!==failedToken&&expiry()>now())return context();
      if(failedGeneration!==null&&generation!==failedGeneration&&expiry()>now())return context();
      if(!force&&expiry()-now()>refreshMargin)return context();
      if(!session.refresh_token){if(!force&&expiry()>now()){schedule();return context();}invalidate();throw authError();}
      if(refreshing)return refreshing;
      const expectedEpoch=epoch,expectedIdentity=identity(session),controller=new AbortController();pending.add(controller);
      const timeout=setTimeout(()=>controller.abort(),refreshTimeoutMs);timeout.unref?.();
      const refresh=async()=>{
        controller.signal.throwIfAborted();assertEpoch(expectedEpoch);const stored=read();
        if(!stored?.access_token||identity(stored)!==expectedIdentity){invalidate('AUTH_SESSION_CHANGED',{clearStorage:false});throw authError('AUTH_SESSION_CHANGED');}
        if(changed(stored,session)){accept(stored,{persistValue:false});if(expiry()>now()&&(force||expiry()-now()>refreshMargin))return context();}
        const old=session;
        try{
          const response=await send(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:config.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:old.refresh_token}),signal:controller.signal});
          const data=await response.json().catch(()=>({}));assertEpoch(expectedEpoch);
          if(!response.ok||!data.access_token||!data.refresh_token)throw authError();
          const ttl=Number(data.expires_in),absolute=Number(data.expires_at)*1000,next={access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Number.isFinite(absolute)&&absolute>now()?absolute:now()+ttl*1000,...(data.user?.id?{user:{id:data.user.id}}:{})};
          if(!Number.isFinite(expiry(next))||expiry(next)<=now()||identity(next)!==expectedIdentity)throw authError('AUTH_SESSION_CHANGED');
          const latest=read();if(!latest||identity(latest)!==expectedIdentity)throw authError('AUTH_SESSION_CHANGED');
          accept(next);return context();
        }catch(error){if(epoch===expectedEpoch&&!signedOut&&!rejected)invalidate(error.code==='AUTH_SESSION_CHANGED'?'AUTH_SESSION_CHANGED':'AUTH_REQUIRED',{clearStorage:identity(read())===expectedIdentity});throw authError(error.code==='AUTH_SESSION_CHANGED'?'AUTH_SESSION_CHANGED':'AUTH_REQUIRED');}
      };
      let abortListener;
      const aborted=new Promise((resolve,reject)=>{abortListener=()=>reject(authError(controller.signal.reason?.code==='AUTH_SESSION_CHANGED'?'AUTH_SESSION_CHANGED':'AUTH_REQUIRED'));controller.signal.addEventListener('abort',abortListener,{once:true});});
      const task=Promise.race([Promise.resolve().then(()=>withLock?withLock(refresh,{signal:controller.signal}):refresh()),aborted]);refreshing=task;
      try{return await task;}catch(error){if(epoch===expectedEpoch&&!rejected)invalidate('AUTH_REQUIRED',{clearStorage:identity(read())===expectedIdentity});throw authError(error.code==='AUTH_SESSION_CHANGED'?'AUTH_SESSION_CHANGED':'AUTH_REQUIRED');}
      finally{clearTimeout(timeout);controller.signal.removeEventListener('abort',abortListener);pending.delete(controller);if(refreshing===task)refreshing=null;}
    }
    async function request(input,init={}){
      if(!required)return send(input,init);const expectedEpoch=epoch;await ensureSession();assertEpoch(expectedEpoch);
      const controller=new AbortController(),template=input instanceof Request?new Request(input,init):new Request(new URL(input,baseUrl),init),signal=AbortSignal.any([template.signal,controller.signal]);pending.add(controller);
      async function attempt(){assertEpoch(expectedEpoch);signal.throwIfAborted();const headers=new Headers(template.headers);headers.set('Authorization',`Bearer ${session.access_token}`);return send(new Request(template.clone(),{headers,signal}));}
      try{const used=session.access_token,usedGeneration=generation;let response=await attempt();assertEpoch(expectedEpoch);
        // The web server authenticates before protected handlers. Only 401 can
        // retry; never replay after network ambiguity, 403, 5xx or new identity.
        if(response.status===401){await ensureSession({force:true,failedToken:used,failedGeneration:usedGeneration});assertEpoch(expectedEpoch);response=await attempt();assertEpoch(expectedEpoch);if(response.status===401){invalidate();throw authError();}}
        return response;
      }finally{pending.delete(controller);}
    }
    function handleStorage(){if(!required)return;const stored=read();if(!session||!stored||identity(stored)!==identity(session)){invalidate('AUTH_SESSION_CHANGED',{clearStorage:false});return;}if(changed(stored,session)){accept(stored,{persistValue:false});ensureSession().catch(()=>{});}}
    async function signOut(){const token=session?.access_token,currentIdentity=identity(session);signedOut=true;invalidate('SIGNED_OUT',{clearStorage:identity(read())===currentIdentity});if(token&&config.supabaseUrl)try{await send(`${config.supabaseUrl}/auth/v1/logout?scope=local`,{method:'POST',headers:{apikey:config.supabasePublishableKey,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)});}catch{}}
    function dispose(){clearTimeout(timer);for(const c of pending)c.abort();pending.clear();}
    return {load,context,ensureSession,request,handleStorage,signOut,hasSession:()=>Boolean(session?.access_token),dispose};
  }
  return {create,STORAGE_KEY};
});
