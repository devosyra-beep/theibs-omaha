'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../../scripts/reference/sequence_form_lp.py');
const python = process.env.THEIBS_REFERENCE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
let checked;
function available() {
  if (checked === undefined) {
    const result = spawnSync(python, ['-c', 'import scipy,numpy'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    checked = result.status === 0 && !result.error;
  }
  return checked;
}
function reference(request) {
  if (!available()) throw Error('QA LP reference needs SciPy. See scripts/reference/README.md and THEIBS_REFERENCE_PYTHON.');
  const result = spawnSync(python, [script], { input: JSON.stringify(request), encoding: 'utf8', timeout: 60000,
    maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  const value = JSON.parse(result.stdout);
  if (result.status !== 0 || value.status === 'REFERENCE_ERROR') throw Error(value.error || result.stderr || 'Reference failed.');
  return value;
}
module.exports = { available, reference, python };
