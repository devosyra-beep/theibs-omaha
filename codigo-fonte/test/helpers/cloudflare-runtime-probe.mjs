// QA entrypoint only; never deploy this handler. It verifies client-disconnect
// propagation in workerd using the production gateway and compatibility flags.
import {createGateway} from '../../hosting/cloudflare/worker.mjs';
let started=false, aborted=false;
const gateway=createGateway(async(_url,options)=>{
  started=true;
  return new Response(new ReadableStream({start(output){
    const cancel=()=>{aborted=true;output.error(new Error('QA cancellation'));};
    if(options.signal.aborted)cancel();
    else options.signal.addEventListener('abort',cancel,{once:true});
  }}));
});
export default {
  fetch(request,env) {
    if(new URL(request.url).pathname==='/probe-status')return Response.json({started,aborted});
    return gateway.fetch(request,env);
  }
};
