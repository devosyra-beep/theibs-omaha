'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const VERSION='THEIBS_SOLVER_CACHE_V3';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function stable(value){if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';return JSON.stringify(value);}
function keyFor(input){return hash(stable({...input,version:VERSION,solver:require('./extensive-solver').VERSION,rules:require('./plo-river-game').RULES_VERSION,adapter:require('./plo-river-game').VERSION,qualification:require('./solution-status').VERSION,precision:require('../decision-precision').VERSION,actionCertificate:require('./action-conditioned').VERSION,adaptive:require('./versions').ADAPTIVE_VERSION,decisionOutcome:require('./decision-outcome').VERSION,comparisonPolicyVersion:require('./decision-outcome').POLICY_VERSION}));}
function createSolutionCache({directory,maxBytes=32*1024*1024,maxEntryBytes=4*1024*1024,maxEntries=16}={}){
  const entries=new Map();let bytes=0;const stats={hits:0,misses:0,diskHits:0,writes:0,evictions:0};
  const idFor=(owner,key)=>hash(String(owner))+'.'+key;
  function remember(id,value,size){if(entries.has(id))bytes-=entries.get(id).size;entries.delete(id);entries.set(id,{value,size});bytes+=size;while(entries.size>maxEntries||bytes>maxBytes){const first=entries.keys().next().value;bytes-=entries.get(first).size;entries.delete(first);stats.evictions++;}}
  function location(id){if(!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(id))throw Error('Invalid solver cache identity.');return path.join(directory,id+'.json');}
  async function get(owner,key){const id=idFor(owner,key);if(entries.has(id)){const found=entries.get(id);entries.delete(id);entries.set(id,found);stats.hits++;return structuredClone(found.value);}
    if(directory)try{const file=location(id),info=await fs.stat(file);if(info.size>maxEntryBytes)throw Error('oversized');const value=JSON.parse(await fs.readFile(file,'utf8'));if(value.version!==VERSION||value.key!==key||value.owner!==hash(String(owner)))throw Error('incompatible');remember(id,value,info.size);stats.hits++;stats.diskHits++;return structuredClone(value);}catch{}
    stats.misses++;return null;
  }
  async function put(owner,key,result,checkpoint){const value={version:VERSION,key,owner:hash(String(owner)),result,checkpoint,savedAt:Date.now()},encoded=JSON.stringify(value),size=Buffer.byteLength(encoded);if(size>maxEntryBytes)return {saved:false,reason:'ENTRY_MEMORY_LIMIT'};
    const id=idFor(owner,key);remember(id,JSON.parse(encoded),size);stats.writes++;
    if(directory)try{await fs.mkdir(directory,{recursive:true});const file=location(id),tmp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,encoded,{mode:0o600});await fs.rename(tmp,file);
      const files=await fs.readdir(directory);const items=await Promise.all(files.filter(name=>/^[a-f0-9]{64}\.[a-f0-9]{64}\.json$/.test(name)).map(async name=>{const full=path.join(directory,name),info=await fs.stat(full);return {full,size:info.size,time:info.mtimeMs};}));let total=items.reduce((sum,item)=>sum+item.size,0);for(const item of items.sort((a,b)=>a.time-b.time)){if(total<=maxBytes)break;await fs.unlink(item.full);total-=item.size;}
    }catch(error){return {saved:true,persisted:false,reason:error.code||'DISK_UNAVAILABLE'};}
    return {saved:true,persisted:Boolean(directory)};
  }
  return {get,put,keyFor,stats:()=>({...stats,memoryBytes:bytes,entries:entries.size,maxBytes}),clearMemory:()=>{entries.clear();bytes=0;}};
}
module.exports={VERSION,stable,keyFor,createSolutionCache};
