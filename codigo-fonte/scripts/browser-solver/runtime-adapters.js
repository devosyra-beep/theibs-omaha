'use strict';
// Synchronous SHA-256 is required by the unchanged solver's streaming hashes.
// FIPS 180-4 compression, with TextEncoder matching Node's UTF-8 string input.
const sha256Constants = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotateRight = (value, bits) => (value >>> bits) | (value << (32 - bits));
class BrowserSha256 {
  constructor() {
    this.state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    this.block = new Uint8Array(64); this.words = new Uint32Array(64);
    this.length = 0; this.used = 0; this.finished = false;
  }
  compress(bytes, offset = 0) {
    const w = this.words;
    for (let i = 0; i < 16; i++) { const p = offset + i * 4; w[i] = (bytes[p] << 24) | (bytes[p+1] << 16) | (bytes[p+2] << 8) | bytes[p+3]; }
    for (let i = 16; i < 64; i++) {
      const a = w[i-15], b = w[i-2];
      w[i] = w[i-16] + (rotateRight(a,7) ^ rotateRight(a,18) ^ (a >>> 3)) + w[i-7] + (rotateRight(b,17) ^ rotateRight(b,19) ^ (b >>> 10));
    }
    let [a,b,c,d,e,f,g,h] = this.state;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotateRight(e,6)^rotateRight(e,11)^rotateRight(e,25)) + ((e&f)^(~e&g)) + sha256Constants[i] + w[i]) >>> 0;
      const t2 = ((rotateRight(a,2)^rotateRight(a,13)^rotateRight(a,22)) + ((a&b)^(a&c)^(b&c))) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    const values = [a,b,c,d,e,f,g,h];
    for (let i = 0; i < 8; i++) this.state[i] += values[i];
  }
  update(value, encoding) {
    if (this.finished) throw Error('Digest already called.');
    if (encoding !== undefined && encoding !== 'utf8' && encoding !== 'utf-8') throw Error('The browser solver only uses UTF-8 hash input.');
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) :
      ArrayBuffer.isView(value) ? new Uint8Array(value.buffer,value.byteOffset,value.byteLength) :
      value instanceof ArrayBuffer ? new Uint8Array(value) : null;
    if (!bytes) throw TypeError('SHA-256 input must be a string or byte array.');
    this.length += bytes.length;
    if (!Number.isSafeInteger(this.length) || this.length > Number.MAX_SAFE_INTEGER / 8) throw Error('SHA-256 input is too large.');
    let offset = 0;
    if (this.used) {
      const take = Math.min(64-this.used,bytes.length); this.block.set(bytes.subarray(0,take),this.used); this.used += take; offset += take;
      if (this.used === 64) { this.compress(this.block); this.used = 0; }
    }
    while (offset + 64 <= bytes.length) { this.compress(bytes,offset); offset += 64; }
    if (offset < bytes.length) { this.block.set(bytes.subarray(offset),this.used); this.used += bytes.length-offset; }
    return this;
  }
  digest(encoding) {
    if (this.finished) throw Error('Digest already called.');
    if (encoding !== 'hex') throw Error('The browser solver only uses hexadecimal SHA-256 output.');
    this.finished = true; this.block[this.used++] = 0x80;
    if (this.used > 56) { this.block.fill(0,this.used); this.compress(this.block); this.used = 0; }
    this.block.fill(0,this.used,56);
    const bits = this.length * 8, view = new DataView(this.block.buffer);
    view.setUint32(56,Math.floor(bits/0x100000000)); view.setUint32(60,bits>>>0);
    this.compress(this.block);
    return Array.from(this.state,value=>value.toString(16).padStart(8,'0')).join('');
  }
}
function browserRandomUUID() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]&15)|64; bytes[8] = (bytes[8]&63)|128;
  const hex = Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const browserNodeAdapters = Object.freeze({
  'node:crypto': Object.freeze({createHash(algorithm) { if (algorithm !== 'sha256') throw Error('Only SHA-256 is used by the browser solver.'); return new BrowserSha256(); },randomUUID:browserRandomUUID}),
  'node:perf_hooks': Object.freeze({performance:globalThis.performance}),
  // The browser entry invokes execute directly, never the Node Atomics branch.
  'node:worker_threads': Object.freeze({parentPort:null}),
});
// Browsers do not expose the Node heap counter. Keep this observational metric
// unknown; the original tree reservations and working-memory guards still run.
const browserProcess = Object.freeze({memoryUsage:()=>({heapUsed:null})});
