'use strict';
// Runtime-only ASAR. Build from current sources; no previous-version archive,
// copied history, developer scripts or discarded UI is needed to rebuild it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const source=path.resolve(__dirname,'..'),root=path.dirname(source);
const target=path.join(root,'THEIBS','resources','app.asar');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const included=new Map();
function add(relative){
 relative=relative.replaceAll('\\','/');if(included.has(relative))return;
 const absolute=path.resolve(source,relative);if(!absolute.startsWith(source+path.sep))throw Error('Invalid source path');
 const bytes=fs.readFileSync(absolute);included.set(relative,bytes);
 if(relative.endsWith('.js'))for(const match of bytes.toString().matchAll(/require\(['"](\.[^'"]+)['"]\)/g)){
  let dependency=path.resolve(path.dirname(absolute),match[1]);if(!path.extname(dependency))dependency+='.js';
  add(path.relative(source,dependency));
 }
}
add('desktop/main.js');add('server.js');
const html=fs.readFileSync(path.join(source,'public/index.html'),'utf8');add('public/index.html');
for(const match of html.matchAll(/(?:src|href)="\/(.+?)"/g))add('public/'+match[1]);
const original=require('../package.json');
included.set('package.json',Buffer.from(JSON.stringify({name:original.name,version:original.version,private:true,type:'commonjs',main:'desktop/main.js',description:original.description},null,2)));
const header={files:{}},parts=[],manifest=[];let offset=0;
for(const [relative,bytes]of [...included].sort((a,b)=>a[0].localeCompare(b[0]))){
 let dir=header;const names=relative.split('/');for(const name of names.slice(0,-1)){dir.files[name]||={files:{}};dir=dir.files[name];}
 const blocks=[];for(let i=0;i<bytes.length;i+=4194304)blocks.push(hash(bytes.subarray(i,i+4194304)));
 dir.files[names.at(-1)]={size:bytes.length,offset:String(offset),integrity:{algorithm:'SHA256',hash:hash(bytes),blockSize:4194304,blocks}};
 manifest.push({path:relative,size:bytes.length,offset,sha256:hash(bytes)});parts.push(bytes);offset+=bytes.length;
}
const json=Buffer.from(JSON.stringify(header)),pickle=Buffer.alloc(8+Math.ceil(json.length/4)*4),size=Buffer.alloc(8);
pickle.writeUInt32LE(pickle.length-4,0);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);size.writeUInt32LE(4,0);size.writeUInt32LE(pickle.length,4);
const archive=Buffer.concat([size,pickle,...parts]);
for(const file of manifest){const start=8+pickle.length+file.offset;if(hash(archive.subarray(start,start+file.size))!==file.sha256)throw Error('Archive mismatch: '+file.path);}
fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,archive);
console.log(JSON.stringify({version:original.version,target,files:manifest.length,bytes:archive.length,sha256:hash(archive),included:manifest.map(f=>f.path)},null,2));
