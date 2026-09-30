'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../hosting/cloudflare/worker.mjs');
const env = { API_UPSTREAM: 'https://backend.example' };
const front = 'https://theibs.example';

test('gateway keeps page aliases, query parameters and missing assets distinct from API', async () => {
  const { createGateway } = await modulePromise;
  const seen=[];
  const gateway=createGateway(() => { throw Error('Unexpected API request'); });
  const assets={fetch:async request=>{seen.push(request.url);return new Response('asset',{status:200});}};
  for(const [route,path] of [['/','/landing.html'],['/app','/index.html'],['/app/','/index.html'],['/card-voice.js','/card-voice.js']]) {
    const response=await gateway.fetch(new Request(front+route+'?login=1'),{...env,ASSETS:assets});
    assert.equal(new URL(seen.at(-1)).pathname,path);
    assert.equal(new URL(seen.at(-1)).search,'?login=1');
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
  assert.equal((await gateway.fetch(new Request(front+'/app',{method:'POST'}),env)).status,405);
});

test('gateway streams payload without changing financial values or provenance; only authorized headers pass', async () => {
  const { createGateway }=await modulePromise;
  const payload=JSON.stringify({ev:-2.5,lowerBound:0,source:'CFR_PLUS',status:'SOLVED',precision:'INCONCLUSIVE'});
  let captured;
  const gateway=createGateway(async(url,options)=>{
    captured={url:String(url),options,body:await new Response(options.body).text()};
    return new Response(payload,{status:202,headers:{'content-type':'application/json','access-control-allow-origin':'*','set-cookie':'private=1'}});
  });
  const response=await gateway.fetch(new Request(front+'/api/analyze?phase=PREVIEW',{method:'POST',body:payload,headers:{
    origin:front,authorization:'Bearer fixture-only',cookie:'secret=ignored','content-type':'application/json',
    'x-forwarded-host':'evil.example','x-theibs-remote-text-consent':'true'
  }}),env);
  assert.equal(captured.url,'https://backend.example/api/analyze?phase=PREVIEW');
  assert.equal(captured.body,payload);
  assert.equal(captured.options.headers.get('origin'),'https://backend.example');
  assert.equal(captured.options.headers.get('authorization'),'Bearer fixture-only');
  assert.equal(captured.options.headers.get('cookie'),null);
  assert.equal(captured.options.headers.get('x-forwarded-host'),null);
  assert.equal(captured.options.headers.get('x-theibs-remote-text-consent'),'true');
  assert.equal(captured.options.redirect,'manual');
  assert.equal(captured.options.cache,'no-store');
  assert.equal(captured.options.cf,undefined);
  assert.equal(response.status,202);
  assert.equal(await response.text(),payload);
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.equal(response.headers.get('set-cookie'),null);
});

test('cross-origin browser requests fail before forwarding credentials', async () => {
  const {createGateway}=await modulePromise;
  let calls=0;
  const gateway=createGateway(async()=>{calls++;return new Response('wrong');});
  for(const origin of ['https://evil.example','null',front+'/']) {
    assert.equal((await gateway.fetch(new Request(front+'/api/analyze',{headers:{origin}}),env)).status,403);
  }
  assert.equal(calls,0);
});

test('non-browser signed webhooks and status requests keep their paths, signature and error status', async () => {
  const {createGateway}=await modulePromise;
  let received;
  const gateway=createGateway(async(url,options)=>{
    received={url:String(url),signature:options.headers.get('x-webhook-signature'),origin:options.headers.get('origin')};
    return Response.json({status:'ERROR',reason:'Denied'},{status:401});
  });
  const response=await gateway.fetch(new Request(front+'/api/billing/webhook?secret=fixture',{method:'POST',body:'{}',headers:{'x-webhook-signature':'fixture','content-type':'application/json'}}),env);
  assert.deepEqual(received,{url:'https://backend.example/api/billing/webhook?secret=fixture',signature:'fixture',origin:null});
  assert.equal(response.status,401);
  assert.equal(response.headers.get('cache-control'),'no-store');
  await response.text();
  const health=await gateway.fetch(new Request(front+'/healthz'),env);
  assert.equal(health.status,401);await health.text();
});

test('upstream is a fixed HTTPS origin; request URLs cannot redirect the proxy', async () => {
  const {createGateway,upstreamOrigin}=await modulePromise;
  for(const value of ['http://backend.example','https://user:password@backend.example','https://backend.example/path','https://backend.example/?host=evil','https://localhost','https://127.0.0.1','https://[::1]']) {
    assert.throws(()=>upstreamOrigin(value));
  }
  let target;
  const gateway=createGateway(async url=>{target=new URL(url);return new Response('ok');});
  await (await gateway.fetch(new Request(front+'/api//evil.example/status'),env)).text();
  assert.equal(target.origin,env.API_UPSTREAM);
  assert.equal(target.pathname,'/api//evil.example/status');
  const bad=await gateway.fetch(new Request(front+'/api/status'),{API_UPSTREAM:'http://backend.example'});
  assert.equal(bad.status,503);
});

test('transport failures never manufacture a decision or a numeric result', async () => {
  const {createGateway}=await modulePromise;
  const response=await createGateway(async()=>{throw Error('private upstream details');}).fetch(new Request(front+'/api/analyze'),env);
  assert.equal(response.status,502);
  const result=await response.json();
  assert.equal(result.code,'UPSTREAM_UNAVAILABLE');
  assert.equal(result.ev,undefined);
  assert.equal(result.reason.includes('private'),false);
});

test('upstream redirects are rejected without exposing or following their destination', async () => {
  const {createGateway}=await modulePromise;
  let calls=0;
  const response=await createGateway(async(_url,options)=>{
    calls++;
    assert.equal(options.redirect,'manual');
    return new Response(null,{status:307,headers:{location:'https://other.example/private'}});
  }).fetch(new Request(front+'/api/analyze',{headers:{authorization:'Bearer fixture-only'}}),env);
  assert.equal(calls,1);
  assert.equal(response.status,502);
  assert.equal(response.headers.get('location'),null);
  assert.equal((await response.json()).code,'UPSTREAM_REDIRECT');
});

test('deadline and caller cancellation reach the upstream request', async () => {
  const {createGateway}=await modulePromise;
  const untilAbort=async(_url,options)=>new Promise((resolve,reject)=>{
    if(options.signal.aborted)reject(Error('aborted'));
    else options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});
  });
  const timeout=await createGateway(untilAbort,10).fetch(new Request(front+'/api/analyze'),env);
  assert.equal(timeout.status,504);
  assert.equal((await timeout.json()).code,'UPSTREAM_TIMEOUT');
  const cancel=new AbortController();
  const pending=createGateway(untilAbort).fetch(new Request(front+'/api/analyze',{signal:cancel.signal}),env);
  cancel.abort();
  assert.equal((await pending).status,502);
});

test('deadline and client cancellation remain effective after upstream headers arrive', async () => {
  const {createGateway}=await modulePromise;
  const hangingBody=async()=>new Response(new ReadableStream({start(){}}));
  const timeout=await createGateway(hangingBody,10).fetch(new Request(front+'/api/analyze'),env);
  await assert.rejects(timeout.text(),/transport was interrupted/);
  const caller=new AbortController();
  const response=await createGateway(hangingBody).fetch(new Request(front+'/api/analyze',{signal:caller.signal}),env);
  caller.abort();
  await assert.rejects(response.text(),/transport was interrupted/);
});
