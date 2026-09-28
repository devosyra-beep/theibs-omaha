'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create,STORAGE_KEY}=require('../public/auth-session');
const config={required:true,supabaseUrl:'https://auth-fixture.invalid',supabasePublishableKey:'public-fixture'};
const NOW=2000000000000;
function jwt({sub='alice',sid='login-a',exp=(NOW+3600000)/1000,nonce='old'}={}){return 'fixture.'+Buffer.from(JSON.stringify({sub,session_id:sid,exp,nonce})).toString('base64url')+'.fixture';}
function stored({ttl=3600000,...options}={}){return {access_token:jwt({exp:(NOW+ttl)/1000,...options}),refresh_token:'refresh-fixture-old',expires_at:NOW+ttl};}
function response(body,status=200){return Response.json(body,{status});}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function setup({saved=stored(),fetch,storage:provided,now=()=>NOW,...options}={}){
 const map=new Map(saved?[[STORAGE_KEY,JSON.stringify(saved)]]:[]),events=[],calls=[];
 const storage=provided||{getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const controller=create({config,storage,baseUrl:'https://app-fixture.invalid/app',now,timers:false,onChange:e=>events.push(e),
 fetch:async(input,init)=>{calls.push({input,init});return fetch?fetch(input,init):response({ok:true});},...options});
 controller.load();return {controller,storage,events,calls,map};
}
function renewed({nonce='new',sub='alice',sid='login-a',ttl=3600000}={}){return {access_token:jwt({sub,sid,nonce,exp:(NOW+ttl)/1000}),refresh_token:'refresh-fixture-new',expires_in:ttl/1000};}
const isRefresh=input=>typeof input==='string'&&input.includes('/auth/v1/token');

test('expired startup refresh is singleflight and successful rotation preserves identity epoch',async()=>{
 const gate=deferred();let refreshes=0;
 const h=setup({saved:stored({ttl:-1000}),fetch:async(input)=>{if(isRefresh(input)){refreshes++;return gate.promise;}return response({ok:true});}});
 const before=h.controller.context().epoch,pending=Array.from({length:12},()=>h.controller.request('/api/probe'));
 await new Promise(setImmediate);assert.equal(refreshes,1);gate.resolve(response(renewed()));await Promise.all(pending);
 assert.equal(h.controller.context().epoch,before);assert.equal(h.controller.context().expired,false);
 for(const call of h.calls.filter(c=>c.input instanceof Request))assert.equal(call.input.headers.get('Authorization'),'Bearer '+renewed().access_token);
 assert.equal(h.events.filter(e=>e.reason==='TOKEN_REFRESHED').length,1);
});

test('only unauthorized request is retried once with identical mutation body',async()=>{
 let refreshes=0,attempts=0,commits=0;const bodies=[];
 const h=setup({fetch:async(input)=>{if(isRefresh(input)){refreshes++;return response(renewed());}bodies.push(await input.text());attempts++;if(attempts===1)return response({},401);commits++;return response({ok:true});}});
 await h.controller.request('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"value":1}'});
 assert.equal(refreshes,1);assert.equal(attempts,2);assert.equal(commits,1);assert.deepEqual(bodies,['{"value":1}','{"value":1}']);
});

test('parallel 401 responses share refresh including unchanged JWT with rotated refresh token',async()=>{
 const initial=stored();let refreshes=0;const requests=new Map();
 const h=setup({saved:initial,fetch:async(input)=>{if(isRefresh(input)){refreshes++;await new Promise(setImmediate);return response({...renewed(),access_token:initial.access_token});}const n=(requests.get(input.url)||0)+1;requests.set(input.url,n);return response({},n===1?401:200);}});
 await Promise.all(Array.from({length:8},(_,i)=>h.controller.request('/api/probe/'+i)));
 assert.equal(refreshes,1);assert.equal(h.controller.context().expired,false);
});

test('second 401 invalidates and never enters a retry loop',async()=>{
 let refreshes=0,attempts=0;const h=setup({fetch:async(input)=>isRefresh(input)?(refreshes++,response(renewed())):(attempts++,response({},401))});
 await assert.rejects(h.controller.request('/api/workspace',{method:'POST',body:'{}'}),{code:'AUTH_REQUIRED'});
 assert.equal(refreshes,1);assert.equal(attempts,2);assert.equal(h.storage.getItem(STORAGE_KEY),undefined);assert.equal(h.controller.context().expired,true);
 await assert.rejects(h.controller.request('/api/workspace'),{code:'AUTH_REQUIRED'});assert.equal(attempts,2);
});

for(const code of [403,402,500,503])test(`HTTP ${code} does not refresh or retry a mutation`,async()=>{
 const h=setup({fetch:async()=>response({},code)});assert.equal((await h.controller.request('/api/workspace',{method:'POST',body:'{}'})).status,code);assert.equal(h.calls.length,1);
});
test('ambiguous network failure never replays a mutation',async()=>{
 const h=setup({fetch:async()=>{throw new Error('offline');}});await assert.rejects(h.controller.request('/api/workspace',{method:'POST',body:'{}'}),/offline/);assert.equal(h.calls.length,1);
});

test('no refresh token remains usable until expiry and then blocks all protected requests',async()=>{
 let time=NOW;const value=stored({ttl:2000});delete value.refresh_token;
 const h=setup({saved:value,now:()=>time});await h.controller.request('/api/probe');time+=3000;
 await assert.rejects(h.controller.request('/api/probe'),{code:'AUTH_REQUIRED'});assert.equal(h.calls.length,1);assert.equal(h.controller.context().expired,true);
});
test('401 without a refresh token fails immediately and clears credentials',async()=>{
 const value=stored();delete value.refresh_token;const h=setup({saved:value,fetch:async()=>response({},401)});
 await assert.rejects(h.controller.request('/api/probe'),{code:'AUTH_REQUIRED'});assert.equal(h.calls.length,1);assert.equal(h.storage.getItem(STORAGE_KEY),undefined);
});

test('refresh errors are sanitized and remove a rejected session',async()=>{
 const h=setup({saved:stored({ttl:-1000}),fetch:async()=>response({error_description:'SECRET_DO_NOT_EXPOSE'},400)});
 await assert.rejects(h.controller.ensureSession(),error=>error.code==='AUTH_REQUIRED'&&!error.message.includes('SECRET'));
 assert.equal(h.controller.context().expired,true);assert.equal(h.storage.getItem(STORAGE_KEY),undefined);
 assert.equal(JSON.stringify(h.events).includes('fixture.'),false);
});
test('bounded refresh aborts an unresponsive provider and invalidates',async()=>{
 const h=setup({saved:stored({ttl:-1000}),refreshTimeoutMs:25,fetch:async(input,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('timeout')),{once:true}))});
 const keepAlive=setTimeout(()=>{},1000);await assert.rejects(h.controller.ensureSession(),{code:'AUTH_REQUIRED'});clearTimeout(keepAlive);assert.equal(h.controller.context().expired,true);
});
test('refresh deadline also bounds waiting for a cross-tab lock',async()=>{
 const h=setup({saved:stored({ttl:-1000}),refreshTimeoutMs:25,withLock:()=>new Promise(()=>{})});
 const keepAlive=setTimeout(()=>{},1000);await assert.rejects(h.controller.ensureSession(),{code:'AUTH_REQUIRED'});clearTimeout(keepAlive);
 assert.equal(h.calls.length,0);assert.equal(h.controller.context().expired,true);
});
test('near expiry cached session refreshes before a protected request',async()=>{
 let refreshes=0;const h=setup({saved:stored({ttl:30000}),fetch:async(input)=>isRefresh(input)?(refreshes++,response(renewed())):response({ok:true})});
 await h.controller.request('/api/probe');assert.equal(refreshes,1);
});

test('signout during refresh cannot resurrect the old login',async()=>{
 const gate=deferred();const h=setup({saved:stored({ttl:-1000}),fetch:async(input)=>isRefresh(input)?gate.promise:new Response(null,{status:204})});
 const pending=h.controller.ensureSession();await new Promise(setImmediate);await h.controller.signOut();gate.resolve(response(renewed()));
 await assert.rejects(pending);assert.equal(h.controller.hasSession(),false);assert.equal(h.storage.getItem(STORAGE_KEY),undefined);
});
test('changed identity during refresh preserves other tab storage and never sends pending operation',async()=>{
 const gate=deferred();const h=setup({saved:stored({ttl:-1000}),fetch:async()=>gate.promise});
 const pending=h.controller.request('/api/workspace',{method:'POST',body:'{}'});await new Promise(setImmediate);
 const bob=stored({sub:'bob',sid:'login-b'});h.storage.setItem(STORAGE_KEY,JSON.stringify(bob));h.controller.handleStorage();gate.resolve(response(renewed()));
 await assert.rejects(pending);assert.equal(h.calls.length,1);assert.equal(JSON.parse(h.storage.getItem(STORAGE_KEY)).access_token,bob.access_token);assert.equal(h.controller.context().expired,true);
});
test('signout before another tab storage event cannot erase that new login',async()=>{
 const h=setup({fetch:async()=>new Response(null,{status:204})}),other=stored({sub:'bob',sid:'login-b'});
 h.storage.setItem(STORAGE_KEY,JSON.stringify(other));await h.controller.signOut();
 assert.equal(JSON.parse(h.storage.getItem(STORAGE_KEY)).access_token,other.access_token);assert.equal(h.controller.context().expired,true);
});
test('provider refresh returning another identity is rejected',async()=>{
 const h=setup({saved:stored({ttl:-1000}),fetch:async()=>response(renewed({sub:'bob'}))});await assert.rejects(h.controller.ensureSession(),{code:'AUTH_SESSION_CHANGED'});assert.equal(h.controller.hasSession(),false);
});
test('late protected response cannot resolve after same-origin storage removal',async()=>{
 const gate=deferred();const h=setup({fetch:async()=>gate.promise});const pending=h.controller.request('/api/probe');await new Promise(setImmediate);
 h.storage.removeItem(STORAGE_KEY);h.controller.handleStorage();gate.resolve(response({private:'old identity'}));await assert.rejects(pending,{code:'AUTH_SESSION_CHANGED'});
});

test('same JWT with rotated refresh token is adopted from another tab',async()=>{
 const initial=stored(),sent=[];const h=setup({saved:initial,fetch:async(input,init)=>{sent.push(JSON.parse(init.body).refresh_token);return response(renewed());}});
 h.storage.setItem(STORAGE_KEY,JSON.stringify({...initial,refresh_token:'refresh-fixture-peer'}));const before=h.controller.context().epoch;h.controller.handleStorage();
 await h.controller.ensureSession({force:true});assert.deepEqual(sent,['refresh-fixture-peer']);assert.equal(h.controller.context().epoch,before);
});
test('cross-tab lock adopts completed rotation instead of reusing single-use token',async()=>{
 const shared=new Map([[STORAGE_KEY,JSON.stringify(stored({ttl:-1000}))]]),storage={getItem:k=>shared.get(k),setItem:(k,v)=>shared.set(k,v),removeItem:k=>shared.delete(k)};
 let tail=Promise.resolve(),refreshes=0;const withLock=task=>{const result=tail.then(task);tail=result.catch(()=>{});return result;};
 const fetch=async()=>{refreshes++;await new Promise(setImmediate);return response(renewed());};
 const a=setup({storage,withLock,fetch}),b=setup({storage,withLock,fetch});await Promise.all([a.controller.ensureSession(),b.controller.ensureSession()]);assert.equal(refreshes,1);
});
test('short TTL does not renew on every immediate request',async()=>{
 let time=NOW,refreshes=0;const h=setup({saved:stored({ttl:-1000}),now:()=>time,fetch:async(input)=>isRefresh(input)?(refreshes++,response(renewed({ttl:10000}))):response({ok:true})});
 await h.controller.ensureSession();await Promise.all(Array.from({length:10},()=>h.controller.request('/api/probe')));assert.equal(refreshes,1);
 time+=8001;await h.controller.ensureSession();assert.equal(refreshes,2);
});
test('aborted callers cannot send a protected request',async()=>{
 const h=setup(),abort=new AbortController();abort.abort();await assert.rejects(h.controller.request('/api/probe',{signal:abort.signal}),{name:'AbortError'});assert.equal(h.calls.length,0);
});
test('contexts and events contain no credentials',async()=>{
 const h=setup();assert.deepEqual(Object.keys(h.controller.context()),['epoch','required','expired']);assert.equal(JSON.stringify(h.events).includes('refresh-fixture'),false);assert.equal(JSON.stringify(h.events).includes('fixture.'),false);
});
