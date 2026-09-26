'use strict';
const fs = require('node:fs');
const path = require('node:path');
/** Seed an installation only once. Never overwrite or merge an existing history. */
function ensureInitialHistory(target, seed) {
  if (fs.existsSync(target)) return 'EXISTING_PRESERVED';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(seed)) return 'NO_SEED';
  try { fs.writeFileSync(target, fs.readFileSync(seed), { flag: 'wx', mode: 0o600 }); return 'SEEDED'; }
  catch (error) { if (error.code === 'EEXIST') return 'EXISTING_PRESERVED'; throw error; }
}
module.exports = { ensureInitialHistory };
