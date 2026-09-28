'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {authenticateRequest}=require('../src/supabase-service');
const {create,STORAGE_KEY}=require('../public/auth-session');
const env={THEIBS_AUTH_REQUIRED:'true',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'};
const request={headers:{authorization:'Bearer synthetic-access'}};

for(const status of [429,500,502,503,504,400,404])test(`provider HTTP ${status} is temporary unavailability, never an expired session`,async()=>{
 let calls=0;await assert.rejects(authenticateRequest(request,env,async()=>{calls++;return new Response('PRIVATE_PROVIDER_DETAIL',{status});}),error=>{
  assert.equal(error.statusCode,503);assert.equal(error.code,'AUTH_SERVICE_UNAVAILABLE');assert.doesNotMatch(error.message,/PRIVATE|synthetic-access|sb_publishable/);return true;
 });assert.equal(calls,1);
});
for(const name of ['TypeError','TimeoutError','AbortError'])test(`provider ${name} is sanitized HTTP 503`,async()=>{
 await assert.rejects(authenticateRequest(request,env,async(url,options)=>{assert.equal(options.signal instanceof AbortSignal,true);throw Object.assign(new Error('PRIVATE_NETWORK_DETAIL'),{name});}),error=>{
  assert.equal(error.statusCode,503);assert.equal(error.code,'AUTH_SERVICE_UNAVAILABLE');assert.doesNotMatch(error.message,/PRIVATE/);return true;
 });
});
test('genuine HTTP 401 rejection remains 401 and does not leak provider body',async()=>{
 await assert.rejects(authenticateRequest(request,env,async()=>new Response('PRIVATE_PROVIDER_DETAIL',{status:401})),error=>error.statusCode===401&&error.code==='AUTH_REJECTED'&&!error.message.includes('PRIVATE'));
});
test('HTTP 403 permission denial remains forbidden, without forcing token rotation',async()=>{
 await assert.rejects(authenticateRequest(request,env,async()=>new Response('{}',{status:403})),error=>error.statusCode===403&&error.code==='AUTH_FORBIDDEN');
});
test('missing bearer token is 401 without contacting provider',async()=>{
 let calls=0;await assert.rejects(authenticateRequest({headers:{}},env,async()=>{calls++;}),error=>error.statusCode===401);assert.equal(calls,0);
});
for(const body of ['not-json','{}','{"id":null}','{"id":5}','{"id":""}'])test(`malformed success ${body} is unavailable, not authorization`,async()=>{
 await assert.rejects(authenticateRequest(request,env,async()=>new Response(body)),error=>error.statusCode===503);
});
test('user body stream failure is temporary unavailability',async()=>{
 await assert.rejects(authenticateRequest(request,env,async()=>({ok:true,text:async()=>{throw new Error('PRIVATE_BODY_DETAIL');}})),error=>error.statusCode===503&&!error.message.includes('PRIVATE'));
});
test('successful authentication still returns verified user and server token',async()=>{
 const result=await authenticateRequest(request,env,async()=>Response.json({id:'fixture-user',email:'fixture@example.invalid'}));
 assert.equal(result.user.id,'fixture-user');assert.equal(result.token,'synthetic-access');assert.equal(result.local,false);
});
test('mapped outage reaches web controller without refresh, logout, mutation or automatic retry; next user attempt works',async()=>{
 let providerCalls=0,protectedCalls=0,mutations=0,refreshes=0,unavailable=true;
 const value={access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Date.now()+3600000};
 const values=new Map([[STORAGE_KEY,JSON.stringify(value)]]),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const controller=create({config:{required:true,supabaseUrl:env.SUPABASE_URL,supabasePublishableKey:env.SUPABASE_PUBLISHABLE_KEY},storage,baseUrl:'https://app-fixture.invalid',timers:false,fetch:async(input)=>{
  if(typeof input==='string'){refreshes++;throw new Error('Refresh must not be called for outage');}
  protectedCalls++;
  try {await authenticateRequest({headers:{authorization:input.headers.get('Authorization')}},env,async()=>{providerCalls++;return unavailable?new Response('UNAVAILABLE',{status:503}):Response.json({id:'fixture-user'});});}
  catch(error){return Response.json({reason:error.message},{status:error.statusCode});}
  mutations++;return Response.json({ok:true});
 }});
 controller.load();const before=controller.context(),first=await controller.request('/api/workspace',{method:'POST',body:'{}'});
 assert.equal(first.status,503);assert.deepEqual(controller.context(),before);assert.equal(storage.getItem(STORAGE_KEY),JSON.stringify(value));
 assert.deepEqual({providerCalls,protectedCalls,mutations,refreshes},{providerCalls:1,protectedCalls:1,mutations:0,refreshes:0});
 unavailable=false;assert.equal((await controller.request('/api/workspace',{method:'POST',body:'{}'})).status,200);
 assert.deepEqual({providerCalls,protectedCalls,mutations,refreshes},{providerCalls:2,protectedCalls:2,mutations:1,refreshes:0});controller.dispose();
});
