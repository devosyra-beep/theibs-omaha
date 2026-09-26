'use strict';
// Rebuild only the files already shipped in this Electron package. Preserve
// the original archive and verify every byte before replacing app.asar.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const target = path.join(root, 'THEIBS-0.3.0-Windows/resources/app.asar');
const backup = target + '.v0.2.0.bak';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const current = fs.readFileSync(target);
const original = fs.existsSync(backup) ? fs.readFileSync(backup) : current;
const header = JSON.parse(original.subarray(16, 16 + original.readUInt32LE(12)));
// Include new application modules as the local package evolves.
for(const folder of ['public','src']) {
  for(const entry of fs.readdirSync(path.join(root,'codigo-fonte',folder),{withFileTypes:true})) {
    if(entry.isFile()) header.files[folder].files[entry.name] ||= {};
  }
}
const parts = [], files = [];
let offset = 0;
function visit(dir, prefix = '') {
  for (const [name, entry] of Object.entries(dir.files)) {
    const relative = prefix + name;
    if (entry.files) { visit(entry, relative + '/'); continue; }
    if (entry.unpacked || entry.link) throw new Error('Unsupported archive entry: ' + relative);
    const file = path.resolve(root, 'codigo-fonte', relative);
    if (!file.startsWith(path.join(root, 'codigo-fonte') + path.sep)) throw new Error('Invalid archive path');
    const bytes = fs.readFileSync(file);
    const blocks = [];
    for (let start = 0; start < bytes.length; start += 4194304) blocks.push(hash(bytes.subarray(start, start + 4194304)));
    entry.size = bytes.length;
    entry.offset = String(offset);
    entry.integrity = { algorithm: 'SHA256', hash: hash(bytes), blockSize: 4194304, blocks };
    files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes), offset });
    offset += bytes.length;
    parts.push(bytes);
  }
}
visit(header);
const json = Buffer.from(JSON.stringify(header));
const padded = Math.ceil(json.length / 4) * 4;
const pickle = Buffer.alloc(8 + padded);
pickle.writeUInt32LE(4 + padded, 0);
pickle.writeUInt32LE(json.length, 4);
json.copy(pickle, 8);
const size = Buffer.alloc(8);
size.writeUInt32LE(4, 0);
size.writeUInt32LE(pickle.length, 4);
const archive = Buffer.concat([size, pickle, ...parts]);
for (const file of files) {
  const start = 8 + archive.readUInt32LE(4) + file.offset;
  if (hash(archive.subarray(start, start + file.bytes)) !== file.sha256) throw new Error('Failed archive verification: ' + file.path);
}
if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, { flag: 'wx' });
const staged = target + '.keyboard-fix.tmp';
fs.writeFileSync(staged, archive);
if (hash(fs.readFileSync(staged)) !== hash(archive)) throw new Error('Failed disk verification');
fs.renameSync(staged, target);
const version = require('../package.json').version;
const report = { version, originalSha256: hash(original), asarSha256: hash(archive), backup, filesVerified: files.length, files };
fs.mkdirSync(path.join(root, 'validacao'), { recursive: true });
fs.writeFileSync(path.join(root, 'validacao', version === '0.2.1' ? 'package-keyboard-fix.json' : `package-${version}.json`), JSON.stringify(report, null, 2));
console.log(`Packaged ${files.length} verified files. Original saved at ${backup}`);
