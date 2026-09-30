'use strict';
const assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const base='http://127.0.0.1:4183';
async function status() { return (await fetch(base+'/probe-status',{signal:AbortSignal.timeout(5000)})).json(); }
async function until(field) {
  for(let i=0;i<30;i++) { const state=await status();if(state[field])return state;await delay(50); }
  throw Error('Runtime did not confirm '+field);
}
async function main() {
  const initial=await status();assert.equal(initial.started,false);assert.equal(initial.aborted,false);
  const caller=new AbortController();
  const pending=fetch(base+'/api/cancel-probe',{signal:caller.signal}).then(response=>response.arrayBuffer()).then(()=>({rejected:false}),error=>({rejected:true,name:error.name}));
  try {
    await until('started');caller.abort();
    const client=await pending;assert.equal(client.rejected,true);
    const state=await until('aborted');assert.equal(state.aborted,true);
    console.log(JSON.stringify({classification:'WORKERD_RUNTIME_HARNESS',incomingClientCancellation:'PASS',upstreamAbortSignal:'PASS'}));
  } finally {caller.abort();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
