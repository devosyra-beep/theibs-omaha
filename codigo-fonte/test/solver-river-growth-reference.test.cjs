'use strict';
// Optional QA dependency only. Never imported by the production application.
const test=require('node:test');
const assert=require('node:assert/strict');
const {available}=require('./helpers/sequence-form-reference.cjs');
const {scenarios,runReferenceScenario}=require('./helpers/solver-river-growth-reference.cjs');
const enabled=available();
for(const scenario of scenarios)test(`independent LP validates ${scenario.combos}x${scenario.combos} private river ranges and ${scenario.sizings} sizing levels`,
  {skip:enabled?false:'QA-only SciPy reference unavailable; see scripts/reference/README.md.'},()=>{
    const result=runReferenceScenario(scenario);assert.equal(result.actions.length,scenario.sizings+2);
    assert.ok(result.actions.every(action=>action.refinements.length===3&&action.refinements.every(row=>row.containsLPWithinResidualTolerance)));
    assert.ok(result.reference.referenceNashConv<1e-7);
  });
