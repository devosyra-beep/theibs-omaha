'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const evaluation = require('../public/voice-evaluation');
const all = (locale='pt-BR',count=5) => ['development','evaluation'].flatMap(split=>evaluation.corpus({locale,count,split}));
const trial = id => all().find(t=>t.id.endsWith(id));

test('52 canonical cards are unique, fixed and disjoint between development and held-out sets',()=> {
  for(const locale of ['pt-BR','en-US'])for(const count of [4,5,6]) {
    const corpus = all(locale,count), single = corpus.filter(t=>t.kind==='single');
    assert.equal(single.length,52); assert.equal(new Set(single.map(t=>t.expected.cards[0])).size,52);
    assert.equal(new Set(corpus.map(t=>t.id)).size,corpus.length);
    assert.ok(corpus.every(t=>Object.isFrozen(t)&&(!t.expected||Object.isFrozen(t.expected))));
    assert.deepEqual(corpus,all(locale,count));
  }
});

test('practice covers each canonical card and supported command type without changing benchmark partitions',()=> {
  const required = ['destination-hero','destination-board','cards-turn','cards-river','cards-board',
    'select-hand','select-board','correct-hand','correct-board','remove-card','undo-entry','cancel-entry',
    'next-actor','short-fold','short-check','short-call','short-all-in','short-bet','short-raise',
    'pending-total','wrong-seat'];
  for(const locale of ['pt-BR','en-US'])for(const count of [4,5,6]) {
    const benchmark=all(locale,count), practice=evaluation.corpus({locale,count,split:'practice'});
    assert.equal(practice.filter(t=>t.kind==='single').length,52);
    assert.equal(practice.length,benchmark.length+required.length);
    assert.equal(new Set(practice.map(t=>t.id)).size,practice.length);
    assert.ok(practice.every(t=>t.split==='practice'&&Object.isFrozen(t)&&
      (!t.expected||Object.isFrozen(t.expected))&&(!t.initial||Object.isFrozen(t.initial))));
    assert.ok(practice.every(t=>!benchmark.some(b=>b.id===t.id)));
    for(const id of required) assert.ok(practice.some(t=>t.id.endsWith(`${id}-practice`)),`${locale} PLO${count}: ${id}`);
    for(const item of practice) assert.equal(evaluation.score(item,item.phrase).exact,true,item.id);
    assert.deepEqual(benchmark,all(locale,count));
  }
});

test('practice contextual and editing fixtures preserve actor, target and error boundaries',()=> {
  const practice=evaluation.corpus({split:'practice'}), trial=id=>practice.find(t=>t.id.endsWith(`${id}-practice`));
  assert.equal(evaluation.score(trial('cards-turn'),'river, dama de ouros').exact,false);
  assert.equal(evaluation.score(trial('correct-hand'),'corrigir carta três da mão para ás de espadas').exact,false);
  assert.equal(evaluation.score(trial('short-call'),'A2 pago').exact,false);
  assert.equal(evaluation.score(trial('wrong-seat'),trial('wrong-seat').phrase).exact,true);
  assert.equal(evaluation.score(trial('pending-total'),'vinte').exact,false);
  assert.equal(evaluation.score(trial('undo-entry'),'desfazer').exact,true);
  const row=evaluation.record(trial('undo-entry'),evaluation.score(trial('undo-entry'),'desfazer'),{});
  assert.equal(row.split,'practice');
  assert.equal(evaluation.aggregate([row]).cells[0].split,'practice');
});

for (const locale of ['pt-BR','en-US'])for(const count of [4,5,6])test(`all card, sequence, action and rejection prompts score correctly in isolated PLO${count} ${locale}`,()=>{
  for(const item of all(locale,count)) {
    const result=evaluation.score(item,item.phrase);
    assert.equal(result.exact,true,item.id);assert.equal(result.wrongApplication,false,item.id);
    assert.equal(result.appliedCount,item.expected===null?0:1,item.id);
  }
});

test('a valid wrong card and an explicit wrong destination cannot count as exact',()=>{
  const card=trial('card-As');
  const wrong=evaluation.score(card,'ás de copas');assert.equal(wrong.exact,false);assert.equal(wrong.wrongApplication,true);
  const wrongTarget=evaluation.score(card,'flop ás de espadas');assert.equal(wrongTarget.exact,false);assert.equal(wrongTarget.wrongApplication,true);
});

test('actor fixture is fixed by the expected command; ASR cannot redefine whose turn it is',()=>{
  const expected=trial('raise'), result=evaluation.score(expected,'adversário um aumenta para cinquenta');
  assert.equal(result.exact,false);assert.equal(result.appliedCount,0);assert.equal(result.clarification,false);assert.equal(result.refusal,true);
  assert.equal(evaluation.score(expected,'adversário dois aumenta para quarenta').wrongApplication,true);
});

test('background speech falsely recognized as a card is counted as a false acceptance',()=>{
  const result=evaluation.score(trial('unknown'),'oito de paus');
  assert.equal(result.falseAcceptance,true);assert.equal(result.wrongApplication,true);assert.equal(result.exact,false);
});

test('missing finals, cancellations, start failures and timeouts are failures even for rejection prompts',()=>{
  for(const outcome of ['no_final','timeout','cancelled','start_failure','recognizer_error']) {
    const result=evaluation.score(trial('unknown'),'',{outcome});
    assert.equal(result.exact,false);assert.equal(result.lost,true);assert.equal(result.appliedCount,0);
  }
});

test('an invalid or changed final never receives credit for exact recognition',()=>{
  const card=trial('card-As');
  assert.equal(evaluation.score(card,'ás de').clarification,true);
  assert.equal(evaluation.score(card,card.phrase,{finalRevisions:1}).exact,false);
});

test('aggregate denominators retain unsuccessful attempts; unavailable and negative timings remain missing',()=>{
  const card=trial('card-As'), rows=[
    evaluation.record(card,evaluation.score(card,card.phrase),{startupMs:10,finalToScoreMs:4}),
    evaluation.record(card,evaluation.score(card,'',{outcome:'timeout'}),{startupMs:-1,totalMs:15000}),
    evaluation.record(card,evaluation.score(card,'',{outcome:'start_failure'}),{})
  ];
  const total=evaluation.aggregate(rows).total;
  assert.equal(total.attempts,3);assert.equal(total.exact,1);assert.equal(total.accuracy,1/3);
  assert.equal(total.lost,2);assert.equal(total.timeouts,1);assert.equal(total.startFailures,1);
  assert.deepEqual(total.timing.finalToScoreMs,{n:1,missing:2,p50:4,p95:4});
  assert.equal(total.timing.startupMs.n,1);assert.equal(total.timing.speechEndEventToFinalMs.n,0);
});

test('aggregate keeps scenario strata separate and never exports prompts, raw transcripts, trial IDs or samples',()=>{
  const card=trial('card-As'), result=evaluation.score(card,card.phrase);
  const rows=[evaluation.record(card,{...result,transcript:'private raw speech',audio:'private audio'},{startupMs:10}),
    evaluation.record({...card,split:'evaluation'},result,{startupMs:20},{condition:'moderate-noise',processing:'device',version:'0.14.5'})];
  const exported=evaluation.aggregate(rows), json=JSON.stringify(exported);
  assert.equal(exported.cells.length,2);assert.equal(exported.privacy.audioStored,false);assert.equal(exported.privacy.upload,false);
  for(const text of [card.phrase,card.id,'private raw speech','private audio','"records"','"transcript"'])assert.equal(json.includes(text),false,text);
  assert.equal(exported.externalHumanValidation,'NOT_ESTABLISHED');
  assert.equal(exported.productionCardLatency,'NOT_MEASURED');
});

test('Wilson uncertainty is explicit for small samples and no trials do not imply success',()=>{
  assert.equal(evaluation.wilson(0,0),null);
  const one=evaluation.wilson(1,1);assert.ok(one.low<.21&&one.high>.99);
  const none=evaluation.wilson(0,10);assert.equal(none.low,0);assert.ok(none.high>.27);
  assert.equal(evaluation.aggregate([]).total.accuracy,null);
  assert.equal(evaluation.percentile([], .95),null);
  assert.equal(evaluation.percentile([5,1,2,3,4],.5),3);
});

test('invalid evaluation configurations are rejected instead of silently remapped',()=>{
  for(const options of [{locale:'es-ES'},{count:2},{split:'training-modified-after-results'}])assert.throws(()=>evaluation.corpus(options));
});
