'use strict';
// Public transport smoke only. This does not claim authenticated gameplay,
// migration of data, hosted solver timings or real microphone validation.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const base=new URL(process.argv[2] || 'http://127.0.0.1:4182');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'.output/release-manifest.json'),'utf8'));
const results=[];
async function check(name,fn) {
  const started=performance.now();
  try { await fn();results.push({name,status:'PASS',ms:performance.now()-started}); }
  catch(error) { results.push({name,status:'FAIL',reason:error.message,ms:performance.now()-started}); }
}
async function request(route,init={}) {
  return fetch(new URL(route,base),{...init,redirect:'manual',signal:AbortSignal.timeout(60000)});
}
async function run() {
  for(const route of ['/','/app','/app/']) await check('page '+route,async()=>{
    const response=await request(route);assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/text\/html/);
    const text=await response.text();assert.ok(text.includes('THEIBS'));
    if(route.startsWith('/app'))assert.ok(text.includes(`THEIBS ${manifest.version}`));
  });
  await check('public engine version',async()=>{
    const response=await request('/api/status');assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal((await response.json()).version,manifest.version);
  });
  await check('public authentication config preserves Google and contains no server secret',async()=>{
    const response=await request('/api/public-config');assert.equal(response.status,200);
    const body=await response.json(),text=JSON.stringify(body);
    const config=body.auth || body;
    assert.equal(config.required,true);assert.equal(config.providers.google,true);
    assert.equal(text.includes('sb_secret_'),false);
  });
  for(const route of ['/api/workspace','/api/training/history'])await check('unauthenticated '+route,async()=>{
    const response=await request(route);assert.equal(response.status,401);
    assert.match(response.headers.get('content-type'),/application\/json/);
  });
  await check('unauthenticated calculation remains protected',async()=>{
    const response=await request('/api/analyze',{method:'POST',headers:{origin:base.origin,'content-type':'application/json'},body:'{}'});
    assert.equal(response.status,401);
  });
  await check('cross-origin request rejected',async()=>{
    const response=await request('/api/status',{headers:{origin:'https://untrusted.example'}});
    assert.equal(response.status,403);
  });
  await check('missing asset is a 404, not an application shell',async()=>{
    const response=await request('/not-an-asset-theibs-smoke.js');assert.equal(response.status,404);
  });
  let index=0;
  async function next() {
    while(index<manifest.assets.length) {
      const asset=manifest.assets[index++];
      await check('asset '+asset.path,async()=>{
        const response=await request('/'+asset.path);assert.equal(response.status,200);
        assert.equal(response.headers.get('cache-control'),'no-store');
        assert.equal(response.headers.get('x-content-type-options'),'nosniff');
        const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,asset.bytes);
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),asset.sha256);
      });
    }
  }
  await Promise.all(Array.from({length:4},next));
  const report={classification:'TRANSPORT_SMOKE',origin:base.origin,version:manifest.version,generatedAt:new Date().toISOString(),
    passed:results.filter(row=>row.status==='PASS').length,failed:results.filter(row=>row.status==='FAIL').length,results,
    notExecuted:['Authenticated gameplay','Oracle provisioning','Data migration and restore','Hosted solver benchmarks','Human speech recognition']};
  fs.writeFileSync(path.join(__dirname,'.output/smoke.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({origin:report.origin,version:report.version,passed:report.passed,failed:report.failed,
    failures:results.filter(row=>row.status==='FAIL'),notExecuted:report.notExecuted},null,2));
  if(report.failed)process.exitCode=1;
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
