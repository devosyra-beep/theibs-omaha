'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Only a bundled, reviewed aggregate is served. User histories are never read here.
function experimentReport(file = path.join(__dirname, 'data', 'analyze-economics.json')) {
  const build = require('../package.json').version;
  if (!fs.existsSync(file)) return { status: 'NOT_EXECUTED', currentBuild: build, report: null };
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (report.schemaVersion !== 1 || report.evidenceOrigin !== 'SIMULATION' || !Array.isArray(report.scenarios)) {
    throw Error('Unsupported economic evidence format.');
  }
  return { status: 'OK', currentBuild: build, stale: report.candidateVersion !== build, report };
}
module.exports = { experimentReport };
