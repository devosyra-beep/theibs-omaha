const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const out=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'../validacao/analyze-online-2026-09-27/economic-panel-final');
fs.mkdirSync(out,{recursive:true});assert.equal(fs.readdirSync(out).length,0,'Preserve evidence; use new directory.');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theibs-econ-ui-'));
Object.assign(process.env,{THEIBS_DATA_PATH:path.join(temp,'events.jsonl'),THEIBS_WORKSPACE_PATH:path.join(temp,'workspace.json'),THEIBS_LLM_CONFIG_PATH:path.join(temp,'llm.json'),THEIBS_LLM_PROVIDER:'none'});
const {server}=require('../server'),pool=require('../src/analysis-worker');
const bundled=fs.readFileSync(path.join(__dirname,'../src/data/analyze-economics.json'));
const report={status:'RUNNING',execution:'LOCAL_EXECUTED',source:'ACTUAL_AUDITED_SIMULATION_AGGREGATE',aggregateSHA256:crypto.createHash('sha256').update(bundled).digest('hex'),checks:[],errors:[]};
let browser;
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true,channel:'msedge'});report.browser=browser.version();
 const page=await browser.newPage({viewport:{width:1366,height:900}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/app`);await page.waitForFunction(()=>window.theibsApp);await page.evaluate(()=>theibsApp.ready);
 const response=await page.request.get(`http://127.0.0.1:${server.address().port}/api/analysis/experiments`);assert.equal(response.status(),200);
 const evidence=await response.json();assert.deepEqual(evidence.report,JSON.parse(bundled));assert.equal(evidence.stale,true);report.checks.push('API serves the exact audited frozen 0.14.0 aggregate and labels it stale for the current build');
 const before=await page.evaluate(()=>JSON.stringify({cards:theibsCardKeyboard.state.snapshot(),fields:[...document.querySelectorAll('#analysis-form input,#analysis-form select')].map(x=>[x.id,x.value,x.checked])}));
 await page.locator('#analyze-economics>summary').click();await page.waitForSelector('#economic-report:not([hidden])');
 for(let i=0;i<evidence.report.scenarios.length;i++){
  const scenario=evidence.report.scenarios[i],candidate=scenario.policies.find(p=>p.id==='candidate');
  await page.locator('#economic-scenario').selectOption(String(i));
  const text=await page.locator('#economic-report').textContent();
  const formatted=await page.evaluate(n=>n.toLocaleString('pt-BR',{maximumFractionDigits:2}),candidate.meanBB100);
  assert.ok(text.includes(formatted+' bb/100'));assert.match(text,/financiamento ilimitado/);assert.match(text,/IC da média/);assert.match(text,/Poder planejado de 80%/);assert.match(text,/99,583/);assert.match(text,/99,375/);
  assert.match(await page.locator('#economic-status').innerText(),/Evidência de outra versão/);assert.match(await page.locator('#economic-status').innerText(),/INCONCLUSIVE/);report.checks.push(scenario.id+': actual return, adjusted intervals and funding rendered');
 }
 await page.locator('#economic-scenario').selectOption('1');await page.locator('#analyze-economics').screenshot({path:path.join(out,'economic-actual-rake.png')});
 const after=await page.evaluate(()=>JSON.stringify({cards:theibsCardKeyboard.state.snapshot(),fields:[...document.querySelectorAll('#analysis-form input,#analysis-form select')].map(x=>[x.id,x.value,x.checked])}));
 // Exclude the economic selector itself, which is intentionally user-selectable.
 const normalize=s=>{const x=JSON.parse(s);x.fields=x.fields.filter(([id])=>id!=='economic-scenario');return x;};assert.deepEqual(normalize(after),normalize(before));
 report.checks.push('Reading experiment never applies its assumptions to the current hand');assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;}
finally{await browser?.close();await pool.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}})();
