'use strict';
const browserJob = requireBrowserModule('src/solver/job-worker.js');
const browserSession = requireBrowserModule('src/multiway-session.js');
const browserRiver = requireBrowserModule('src/solver/plo-river-game.js');
const browserLimits = Object.freeze({maxNodes:12000,maxWorlds:144,maxMemoryBytes:48*1024*1024,maxBuildMs:750});
// Trusted runtime capability, never a message/input/checkpoint preference.
// Same mathematical solver; compilation reuse is enabled only in the browser.
const executeBrowserJob = args => browserJob.execute(args, {compilationReuse:true});
globalThis.TheibsBrowserSolver = Object.freeze({
  manifest:browserSolverManifest, execute:executeBrowserJob,
  core:requireBrowserModule('src/solver/extensive-solver.js'),
  actionConditioned:requireBrowserModule('src/solver/action-conditioned.js'),
  buildPloRiverGame:browserRiver.buildPloRiverGame,coverage:browserRiver.coverage,
  session:browserSession, crypto:browserNodeAdapters['node:crypto'], limits:browserLimits,
});
if (typeof globalThis.addEventListener === 'function' && typeof globalThis.postMessage === 'function') {
  let used = false;
  const send = (message,context={}) => globalThis.postMessage({...message,...context,buildFingerprint:browserSolverManifest.buildFingerprint});
  globalThis.addEventListener('message',event=>{
    const message = event.data || {}, started = performance.now();
    const context = {jobId:message.jobId,generation:message.generation};
    try {
      if (used) throw Error('Create a new solver worker for each refinement run.');
      used = true;
      if (message.type !== 'solve') throw Error('Choose a solver calculation.');
      if (message.expectedBuildFingerprint !== browserSolverManifest.buildFingerprint) throw Error('The browser solver build changed. Refresh the app.');
      if (typeof message.jobId !== 'string' || !message.jobId || !Number.isSafeInteger(message.generation) || message.generation < 0) throw Error('Invalid solver job identity.');
      const budget = message.budget;
      if (!budget || !Number.isFinite(budget.timeMs) || budget.timeMs <= 0 || budget.timeMs > 5000 ||
          !Number.isSafeInteger(budget.iterations) || budget.iterations < 1 || budget.iterations > 20000) throw Error('Use a solver budget up to 5000 ms and 20000 iterations.');
      const observed = browserSession.envelope(message.input?.multiway);
      context.handId = observed.multiway.handId || null; context.revisionKey = observed.state.revisionKey;
      if (message.expectedRevisionKey !== context.revisionKey) throw Error('The solver decision revision changed.');
      if (observed.multiway.config.playerCount !== 2) throw Error('The browser solver currently covers heads-up river decisions.');
      const input = structuredClone({multiway:observed.multiway,ranges:message.input.ranges,sizing:message.input.sizing,rake:message.input.rake,budget:browserLimits});
      // Termination is owned by the host. A Web Worker cannot handle a queued
      // cancel message while this unchanged synchronous solver is computing.
      // The host keeps the last complete result/checkpoint pair before stopping.
      const output = executeBrowserJob({input,budget,checkpoint:message.checkpoint,shouldCancel:()=>false,onProgress:value=>send(value,context)});
      send({type:'done',...output},context);
    } catch (error) { send({type:'error',error:error.message,workerMs:performance.now()-started},context); }
  });
  send({type:'ready',schemaVersion:browserSolverManifest.schemaVersion});
}
