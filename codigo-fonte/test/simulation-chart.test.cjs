'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const tools=require('../public/simulation-tools');

function checkAxes(model){
  assert.ok(model.xDomain[1]>model.xDomain[0]);
  assert.ok(model.yDomain[1]>model.yDomain[0]);
  assert.ok(model.xTicks.length<=4);
  assert.ok(model.yTicks.length<=5);
  assert.ok(model.yTicks.includes(0),'Profit always has a visible zero reference');
  assert.equal(model.xTicks[0],0);
  assert.equal(model.xTicks.at(-1),model.lastPoint.hand);
  assert.ok(model.xTicks.every(Number.isInteger));
  assert.equal(new Set(model.yTicks).size,model.yTicks.length);
  assert.ok(model.yTicks.every(tick=>Number.isFinite(tick)&&tick>=model.yDomain[0]&&tick<=model.yDomain[1]));
  for(const point of model.points){
    assert.ok(point.hand>=model.xDomain[0]&&point.hand<=model.xDomain[1]);
    assert.ok(point.netChips>model.yDomain[0]&&point.netChips<model.yDomain[1],'Recorded endpoints have breathing room');
  }
}

test('flat and empty progress keep a truthful zero line with a nonzero plotting domain',()=>{
  const empty=tools.progressChartModel([]);
  checkAxes(empty);assert.deepEqual(empty.points,[{hand:0,netChips:0}]);
  assert.match(empty.description,/No settled hands/);
  const flat=tools.progressChartModel(Array.from({length:5},(_,hand)=>({hand,netChips:0})));
  checkAxes(flat);assert.deepEqual(flat.yDomain,[-1,1]);
  assert.equal(flat.minChips,0);assert.equal(flat.maxChips,0);
});

test('profit and loss domains include zero and retain exact recorded chip values',()=>{
  for(const netChips of [3.25,-3.25,.01,-.01,250000,-250000]){
    const points=[{hand:0,netChips:0},{hand:1,netChips}],before=structuredClone(points);
    const model=tools.progressChartModel(points);
    checkAxes(model);assert.deepEqual(model.points,before);assert.deepEqual(points,before);
    assert.equal(model.lastPoint.netChips,netChips);
    assert.match(model.description,/after 1 hand\./);
    assert.equal(model.minChips,Math.min(0,netChips));assert.equal(model.maxChips,Math.max(0,netChips));
    assert.ok(model.tickPrecision<=2);
  }
});

test('mixed cent results get distinct readable ticks without negative zero or rounded history',()=>{
  const model=tools.progressChartModel([{hand:0,netChips:0},{hand:1,netChips:.03},{hand:2,netChips:-.02},{hand:3,netChips:.01}]);
  checkAxes(model);assert.equal(model.tickPrecision,2);
  assert.equal(model.minChips,-.02);assert.equal(model.maxChips,.03);
  assert.ok(model.yTicks.every(tick=>!Object.is(tick,-0)));
  assert.match(model.description,/Latest result: 0.01 chips/);
  assert.match(model.description,/replays and hands without a payout are excluded/);
});

test('full progress retains every one of 2000 hands and uses sparse integer hand labels',()=>{
  const points=Array.from({length:2001},(_,hand)=>({hand,netChips:hand?((hand%7)-3)*.01:0}));
  const model=tools.progressChartModel(points);
  checkAxes(model);assert.equal(model.points.length,2001);assert.deepEqual(model.points,points);
  assert.deepEqual(model.xDomain,[0,2000]);assert.deepEqual(model.xTicks,[0,1000,2000]);
  assert.match(model.description,/2,000 hands/);
});

test('chart labels cover awkward hand counts without inventing fractional hands',()=>{
  for(const hand of [1,2,3,4,7,23,79,999,1999,2000]){
    checkAxes(tools.progressChartModel([{hand:0,netChips:0},{hand,netChips:17.37}]));
  }
});

test('latest hand labels stay exact and remove nearby rounded ticks on narrow charts',()=>{
  for(const [hands,expected] of [[7,[0,3,7]],[101,[0,50,101]]]){
    const points=Array.from({length:hands+1},(_,hand)=>({hand,netChips:hand*.01}));
    const model=tools.progressChartModel(points);
    checkAxes(model);assert.deepEqual(model.xTicks,expected);assert.deepEqual(model.points,points);
    for(let index=1;index<model.xTicks.length;index++){
      assert.ok((model.xTicks[index]-model.xTicks[index-1])/hands>=.2,'Adjacent hand labels retain at least 20% of the plot width');
    }
  }
});

test('chart consumes settled summary points while excluded records never affect its line or count',()=>{
  const progress=tools.practiceProgress();
  tools.recordProgress(progress,{id:'win',outcome:{heroNet:2.25}});
  tools.recordProgress(progress,{id:'replay',replayed:true,outcome:{heroNet:100}});
  tools.recordProgress(progress,{id:'unsettled',outcome:null});
  tools.recordProgress(progress,{id:'loss',outcome:{heroNet:-3.75}});
  const summary=tools.progressSummary(progress),before=structuredClone(progress);
  const model=tools.progressChartModel(summary.points);
  checkAxes(model);assert.deepEqual(model.points,[{hand:0,netChips:0},{hand:1,netChips:2.25},{hand:2,netChips:-1.5}]);
  assert.equal(model.lastPoint.hand,2);assert.deepEqual(progress,before);
});
