'use strict';
// Provider-neutral, INACTIVE integration boundary. This module does not open a
// socket, request a microphone, send audio, store transcripts or load an SDK.
// A future authorized provider must map its events to this final-only contract.
class VoiceStreamContract {
  constructor({ parse, apply, currentContext }) {
    if (![parse,apply,currentContext].every(fn=>typeof fn==='function')) throw Error('parse, apply and currentContext are required.');
    Object.assign(this,{parse,apply,currentContext}); this.epoch=0; this.cancel();
  }
  begin({ consent=false, providerAuthorized=false, locale }={}) {
    this.cancel();
    if (!consent || !providerAuthorized) throw Error('Explicit audio consent and provider authorization are required.');
    if (!['pt-BR','en-US'].includes(locale)) throw Error('Unsupported language.');
    this.locale=locale; this.context=this.currentContext(); this.active=true;
    return this.epoch;
  }
  cancel() { this.epoch++; this.active=false; this.busy=false; this.lastSequence=-1; this.context=null; }
  async accept(event) {
    if (!this.active || event?.epoch!==this.epoch) return {status:'STALE'};
    if (this.currentContext()!==this.context) {this.cancel();return {status:'CONTEXT_CHANGED'};}
    if (event.kind==='interim') return {status:'PROVISIONAL_NOT_APPLIED'};
    if (event.kind!=='final' || !Number.isSafeInteger(event.sequence) || event.sequence<0 || typeof event.text!=='string' || !event.text.trim() || event.text.length>800) {this.cancel();return {status:'INVALID_EVENT'};}
    if (event.sequence<=this.lastSequence) return {status:'REPLAY_IGNORED'};
    if (this.busy || event.sequence!==this.lastSequence+1) {this.cancel();return {status:'SEQUENCE_GAP_REQUIRES_RESTART'};}
    const epoch=this.epoch,context=this.context;
    this.busy=true; this.lastSequence=event.sequence;
    try {
      const command=this.parse(event.text,this.locale);
      if (!this.active || this.epoch!==epoch || this.currentContext()!==context) return {status:'STALE'};
      // The existing keyboard/ledger must check expectedContext atomically.
      const result=await this.apply(command,{expectedContext:context,epoch});
      if (this.epoch!==epoch) return {status:'STALE'};
      if (result?.ok!==true) {this.cancel();return {status:'NOT_APPLIED'};}
      this.context=this.currentContext();
      return {status:'APPLIED_ONCE'};
    } catch { if(this.epoch===epoch)this.cancel();return {status:'REJECTED'}; }
    finally { if(this.epoch===epoch)this.busy=false; }
  }
}
module.exports={VoiceStreamContract};
