'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
// The browser runtime is generated from the authoritative solver source.
// Build it before copying assets so Git-connected Linux deployments cannot
// publish a stale worker alongside a newer client.
execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/build-browser-solver.cjs')], { stdio: 'inherit' });
const source = path.resolve(__dirname, '../../public');
const target = path.resolve(__dirname, '.output/assets');
const version = require('../../package.json').version;
if (!fs.readFileSync(path.join(source, 'index.html'), 'utf8').includes(`THEIBS ${version}`)) {
  throw Error('Interface and engine versions differ. Preserve release parity before deploying.');
}
// Only this generated directory can be replaced; never remove source or data.
if (target !== path.join(__dirname, '.output', 'assets')) throw Error('Invalid asset output directory.');
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
const manifest = [];
function copy(directory, relative='') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) throw Error('Hidden files and symlinks are not deployable assets.');
    const key = relative + entry.name, file = path.join(directory, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(path.join(target, key), { recursive: true }); copy(file, key+'/'); }
    else if (entry.isFile()) {
      const bytes = fs.readFileSync(file);
      fs.writeFileSync(path.join(target, key), bytes);
      manifest.push({ path:key, bytes:bytes.length, sha256:crypto.createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
copy(source);
fs.writeFileSync(path.join(target, '_headers'), '/*\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n');
fs.writeFileSync(path.join(__dirname, '.output/release-manifest.json'), JSON.stringify({version, assets:manifest}, null, 2)+'\n');
console.log(JSON.stringify({version, assets:manifest.length, bytes:manifest.reduce((sum,file)=>sum+file.bytes,0)}));
