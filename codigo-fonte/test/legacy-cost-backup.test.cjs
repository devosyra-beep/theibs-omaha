'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { restoreZeroRake } = require('../public/cost-input');

test('legacy Multiway return snapshot cannot restore a silently enabled zero rake', () => {
  const saved = { ui:{}, fields:{assumeNoRake:true,rake:'3.50'}, multiwayYesple:{keyboard:{marker:'keep'},fields:{assumeNoRake:true,rake:'2.25',potBeforeAction:'42'}} };
  assert.equal(restoreZeroRake(saved), false);
  assert.equal(saved.multiwayYesple.fields.assumeNoRake, false);
  assert.equal(saved.fields.rake, '3.50');
  assert.equal(saved.multiwayYesple.fields.rake, '2.25');
  assert.equal(saved.multiwayYesple.fields.potBeforeAction, '42');
  assert.deepEqual(saved.multiwayYesple.keyboard,{marker:'keep'});
});
test('new explicit cost choices in both the current and return snapshots are preserved', () => {
  const saved = {ui:{costInputsVersion:1},fields:{assumeNoRake:true},multiwayYesple:{fields:{assumeNoRake:true}}};
  const before = structuredClone(saved);
  assert.equal(restoreZeroRake(saved), true);
  assert.deepEqual(saved,before);
});
test('no saved workspace or a missing return snapshot is safe', () => {
  assert.equal(restoreZeroRake(null), false);
  assert.equal(restoreZeroRake({}), false);
  assert.equal(restoreZeroRake({ui:{costInputsVersion:1},fields:{assumeNoRake:false}}), false);
});
