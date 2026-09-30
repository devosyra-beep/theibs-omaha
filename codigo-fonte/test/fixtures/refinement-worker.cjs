'use strict';
// Exercise the production worker's catch/serialization path with deterministic
// internal computation failures, without depending on the host CPU speed.
const engine = require('../../src/decision-engine');
engine.decide = input => { throw Object.assign(Error('Controlled worker calculation error.'), { code: input.controlledError }); };
require('../../src/analysis-worker');
