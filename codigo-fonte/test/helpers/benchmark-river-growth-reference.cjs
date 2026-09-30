'use strict';
const fs=require('node:fs'),path=require('node:path');
const {available,python}=require('./sequence-form-reference.cjs');
const {scenarios,runReferenceScenario}=require('./solver-river-growth-reference.cjs');
if(!available())throw Error('Independent SciPy reference unavailable; set THEIBS_REFERENCE_PYTHON.');
const report={classification:'MODEL_INDEPENDENT_SEQUENCE_FORM_LP_RIVER_GROWTH',generatedAt:new Date().toISOString(),python,
  target:'PRIVATE_INFORMATION_SET_COMMITMENT_VALUE',limits:['Numerical LP with residual guards, not symbolic proof.',
    'Ex ante commitment over the full prior; not original conditional hand EV.','Local synchronous QA cost, not a serving latency benchmark.',
    'Node RSS snapshots are not a peak memory measurement; LP runtime memory is reported separately.'],cases:[]};
for(const scenario of scenarios){report.cases.push(runReferenceScenario(scenario));console.log(`${scenario.combos}x${scenario.combos}/${scenario.sizings}: all action references passed`);}
report.passedContainmentChecks=report.cases.reduce((sum,item)=>sum+item.actions.reduce((n,row)=>n+row.refinements.length,0),0);
const output=path.resolve(__dirname,'../../../validacao/river-hu-expanded-lp-reference.json');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(output);
