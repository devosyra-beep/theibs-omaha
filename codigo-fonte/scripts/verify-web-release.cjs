'use strict';
// Read-only public release check. This does not claim authenticated gameplay
// or real microphone validation in production.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const base=process.argv[2] || 'https://theibs-omaha.onrender.com';
const out=path.resolve(__dirname,'../../validacao/multiway-release-live.json');
const hash=text=>crypto.createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
const assets=['index.html','app.js','dashboard.css','multiway-ui.js','multiway-solver-ui.js','multiway-solver.css','multiway.css','opponent-inputs.js','card-voice.js','card-voice-ui.js','card-voice.css','multiway-assistant-ui.js','player-profile-model.js','players-storage.js','players-ui.js','players.css','service-worker.js'];
(async()=>{
  const health=await fetch(base+'/healthz');
  const statusResponse=await fetch(base+'/api/status'),status=await statusResponse.json();
  const results=[];
  for(const name of assets){
    const response=await fetch(base+(name==='index.html'?'/app':'/'+name));
    const actual=await response.text(),expected=fs.readFileSync(path.join(root,'public',name),'utf8');
    results.push({file:name,httpStatus:response.status,match:response.ok&&hash(actual)===hash(expected),sha256:hash(actual)});
  }
  const report={evidence:'LIVE_PUBLIC_HTTP_AND_ASSET_PARITY',checkedAt:new Date().toISOString(),url:base,
    expectedVersion:require(path.join(root,'package.json')).version,version:status.version,health:health.status,statusCode:statusResponse.status,assets:results};
  report.pass=health.ok&&statusResponse.ok&&report.version===report.expectedVersion&&results.every(item=>item.match);
  fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,version:report.version,health:report.health,matched:results.filter(item=>item.match).length,total:results.length,failures:results.filter(item=>!item.match)},null,2));
  if(!report.pass)process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
