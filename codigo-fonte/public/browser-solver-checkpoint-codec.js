(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TheibsBrowserSolverCheckpointCodec = api;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict';
  const VERSION = 'THEIBS_SOLVER_CHECKPOINT_TRANSPORT_V1';
  const MAX_DATA_BYTES = 32 * 1024 * 1024, MAX_METADATA_BYTES = 32 * 1024 * 1024, MAX_MATRICES = 64, MAX_ROWS = 12000;
  const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
  const invalid = () => { throw Error('Invalid browser solver checkpoint transport.'); };
  function plain(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null || prototype === Object.prototype) return true;
    const constructor = Object.getOwnPropertyDescriptor(prototype,'constructor')?.value;
    return Object.getPrototypeOf(prototype) === null && typeof constructor === 'function' &&
      constructor.prototype === prototype && Function.prototype.toString.call(constructor) === 'function Object() { [native code] }';
  }
  function metadata(value,seen = new Set(),depth=0) {
    if(depth>256)invalid();
    if (value == null || typeof value === 'string' || typeof value === 'boolean' || value === undefined) return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) invalid();return value; }
    if (!Array.isArray(value) && !plain(value) || seen.has(value)) invalid();
    seen.add(value);
    const result = Array.isArray(value) ? Array(value.length) : Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype);
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value,key);
      if (descriptor.get || descriptor.set || key === '__proto__') invalid();
      Object.defineProperty(result,key,{value:metadata(descriptor.value,seen,depth+1),enumerable:true,writable:true,configurable:true});
    }
    seen.delete(value);return result;
  }
  function checkpoints(checkpoint) {
    if (!plain(checkpoint) || typeof checkpoint.version !== 'string' || !checkpoint.version || checkpoint.version.length > 100) invalid();
    const result = [{value:checkpoint,path:[]}];
    if (checkpoint.global != null) { if (!plain(checkpoint.global)) invalid();result.push({value:checkpoint.global,path:['global']}); }
    if (checkpoint.actionCheckpoints != null) {
      if (!plain(checkpoint.actionCheckpoints)) invalid();
      for (const [id,value] of Object.entries(checkpoint.actionCheckpoints)) {
        if (!id || ['__proto__','constructor','prototype'].includes(id) || !plain(value)) invalid();
        result.push({value,path:['actionCheckpoints',id]});
      }
    }
    return result;
  }
  function at(value,path) { for (const key of path) { if (!plain(value) || !own(value,key)) invalid();value=value[key]; }return value; }
  function set(value,path,replacement) { const parent=at(value,path.slice(0,-1));Object.defineProperty(parent,path.at(-1),{value:replacement,enumerable:true,writable:true,configurable:true}); }
  function isPacket(value) { return value?.encoding === VERSION; }
  function pack(checkpoint) {
    if (checkpoint == null) return null;
    const sources=checkpoints(checkpoint), matrices=[], values=[];
    // Only the CFR numerical matrices are packed. Certificates, identity and
    // diagnostic fields retain their original values and plain-data shape.
    let count=0;
    for (const {value,path} of sources) {
      if (own(value,'regrets') !== own(value,'strategySums')) invalid();
      if (!own(value,'regrets')) continue;
      const rows=value.regrets;
      if (!Array.isArray(rows) || !Array.isArray(value.strategySums) || rows.length > MAX_ROWS || rows.length !== value.strategySums.length) invalid();
      for (const key of ['regrets','strategySums']) {
        const matrix=value[key], rowLengths=[];let length=0;
        for (let index=0;index<matrix.length;index++) {
          const row=matrix[index];
          if (!Array.isArray(row) || row.length !== rows[index]?.length) invalid();
          for (const number of row) if (!Number.isFinite(number) || number < 0) invalid();
          rowLengths.push(row.length);length+=row.length;
          if (!Number.isSafeInteger(length) || (count+length)*8 > MAX_DATA_BYTES) invalid();
        }
        matrices.push({path:[...path,key],rowLengths,offset:count,length});values.push(matrix);count+=length;
        if (matrices.length > MAX_MATRICES) invalid();
      }
    }
    // Copy metadata with the large matrices replaced before traversing it.
    const excluded=new Map(matrices.map((matrix,index)=>[JSON.stringify(matrix.path),index]));
    function detached(value,path=[],seen=new Set()) {
      const matrix=excluded.get(JSON.stringify(path));
      if (matrix!==undefined) return {transportMatrix:matrix};
      if (value == null || typeof value !== 'object') return metadata(value);
      if (!Array.isArray(value) && !plain(value) || seen.has(value)) invalid();
      seen.add(value);const result=Array.isArray(value)?Array(value.length):Object.create(Object.getPrototypeOf(value)===null?null:Object.prototype);
      for (const key of Object.keys(value)) {
        const descriptor=Object.getOwnPropertyDescriptor(value,key);
        if(descriptor.get || descriptor.set || key==='__proto__')invalid();
        Object.defineProperty(result,key,{value:detached(descriptor.value,[...path,key],seen),enumerable:true,writable:true,configurable:true});
      }
      seen.delete(value);return result;
    }
    const data=new Float64Array(count);let offset=0;
    for (const matrix of values) for (const row of matrix) { data.set(row,offset);offset+=row.length; }
    const packet={encoding:VERSION,checkpoint:detached(checkpoint),matrices,data:data.buffer};
    validate(packet);return packet;
  }
  function validate(packet,expected={}) {
    if (!plain(packet) || !isPacket(packet) || !Array.isArray(packet.matrices) || packet.matrices.length > MAX_MATRICES) invalid();
    let data,size;
    try { size=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get.call(packet.data); } catch { invalid(); }
    if (size > MAX_DATA_BYTES || size%8!==0) invalid();
    try { data=new Float64Array(packet.data); } catch { invalid(); }
    const sources=checkpoints(packet.checkpoint), known=new Map();
    for (const {value,path} of sources) {
      for(const key of ['iterations','workIterations','averagingDelay'])if(value[key]!==undefined && (!Number.isSafeInteger(value[key]) || value[key]<0))invalid();
      if (own(value,'regrets') !== own(value,'strategySums')) invalid();
      if (own(value,'regrets')) for (const key of ['regrets','strategySums']) known.set(JSON.stringify([...path,key]),value[key]);
    }
    if (known.size !== packet.matrices.length) invalid();
    let offset=0;const paths=new Set();
    for (let index=0;index<packet.matrices.length;index++) {
      const matrix=packet.matrices[index];
      if(!plain(matrix) || !Array.isArray(matrix.path) || matrix.path.length<1 || matrix.path.length>3 ||
        !matrix.path.every(key=>typeof key==='string' && key.length>0 && key.length<=1000))invalid();
      const path=JSON.stringify(matrix.path),marker=known.get(path);
      if (!known.has(path) || paths.has(path) ||
        !plain(marker) || Object.keys(marker).length !== 1 || marker.transportMatrix !== index ||
        !Array.isArray(matrix.rowLengths) || matrix.rowLengths.length > MAX_ROWS ||
        !matrix.rowLengths.every(length=>Number.isSafeInteger(length) && length>=0) ||
        !Number.isSafeInteger(matrix.length) || matrix.length<0 || matrix.offset !== offset ||
        matrix.rowLengths.reduce((sum,length)=>sum+length,0) !== matrix.length || matrix.length > data.length-offset) invalid();
      paths.add(path);offset+=matrix.length;
    }
    if (offset !== data.length) invalid();
    for (const {value,path} of sources) if (own(value,'regrets')) {
      const first=packet.matrices[value.regrets.transportMatrix],second=packet.matrices[value.strategySums.transportMatrix];
      if (JSON.stringify(first.rowLengths)!==JSON.stringify(second.rowLengths) || typeof value.version!=='string' || !value.version ||
        expected.solverVersion !== undefined && value.version!==expected.solverVersion) invalid();
    }
    const header=packet.checkpoint;
    if (expected.adaptiveVersion!==undefined && !own(header,'regrets') && header.version!==expected.adaptiveVersion ||
      expected.certificateVersion!==undefined && header.certificateVersion!==expected.certificateVersion ||
      expected.policyKey!==undefined && header.comparisonPolicyKey!==expected.policyKey ||
      expected.solverVersion!==undefined && !own(header,'regrets') && header.solverVersion!==expected.solverVersion) invalid();
    metadata(header);
    if(new root.TextEncoder().encode(JSON.stringify({checkpoint:header,matrices:packet.matrices})).byteLength>MAX_METADATA_BYTES)invalid();
    for (const value of data) if (!Number.isFinite(value) || value < 0) invalid();
    return packet;
  }
  function unpack(packet,expected) {
    if (packet == null) return null;
    validate(packet,expected);const result=metadata(packet.checkpoint),data=new Float64Array(packet.data);
    for (const matrix of packet.matrices) {
      let offset=matrix.offset;
      const rows=matrix.rowLengths.map(length=>{const row=Array.from(data.subarray(offset,offset+length));offset+=length;return row;});
      set(result,matrix.path,rows);
    }
    return result;
  }
  function transfers(packet) { validate(packet);return [packet.data]; }
  function copyForTransfer(packet) {
    if (packet == null) return {packet:null,transfer:[]};
    validate(packet);
    const copied={encoding:VERSION,checkpoint:metadata(packet.checkpoint),matrices:metadata(packet.matrices),data:packet.data.slice(0)};
    return {packet:copied,transfer:[copied.data]};
  }
  function byteLength(packet) {
    validate(packet);
    return packet.data.byteLength+new root.TextEncoder().encode(JSON.stringify({encoding:packet.encoding,checkpoint:packet.checkpoint,matrices:packet.matrices})).byteLength;
  }
  return Object.freeze({VERSION,MAX_DATA_BYTES,MAX_METADATA_BYTES,MAX_MATRICES,MAX_ROWS,pack,unpack,isPacket,validate,transfers,copyForTransfer,byteLength});
});
