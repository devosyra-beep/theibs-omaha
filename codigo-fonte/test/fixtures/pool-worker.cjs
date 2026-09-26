'use strict';
const {parentPort}=require('node:worker_threads');
parentPort?.on('message',({id,input})=>{
 if(input.exit)process.exit(7);
 if(input.throw)throw Error('worker fixture crash');
 setTimeout(()=>parentPort.postMessage(input.messageError?{id,error:'fixture calculation error'}:{id,result:{status:'OK',key:input.key,equity:{method:input.exact?'EXACT':'MONTE_CARLO',samples:500},scenarioSummary:input.totalSamples?{totalSamples:input.totalSamples}:null},workerExecutionMs:input.delay||0}),input.delay||0);
});
