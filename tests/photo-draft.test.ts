import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedCycloidalPhotoToothCount, transitionPhotoToothCountDraft } from '../lib/photo-draft.ts';

const draft = { teeth: '24', confirmed: true, damageHypothesisTransferred: true };

test('switching between wheel and rack clears the incompatible count and its confirmations', () => {
  assert.deepEqual(transitionPhotoToothCountDraft('spur', 'rack', 'external_circular', draft), {
    teeth: '', confirmed: false, damageHypothesisTransferred: false, resetReason: 'wheel-rack-meaning',
  });
  assert.deepEqual(transitionPhotoToothCountDraft('rack', 'helical', 'linear_rack', draft), {
    teeth: '', confirmed: false, damageHypothesisTransferred: false, resetReason: 'wheel-rack-meaning',
  });
});

test('a photo tooth candidate is cleared when the selected family contradicts its contour', () => {
  assert.deepEqual(transitionPhotoToothCountDraft('unknown', 'internal', 'external_circular', draft), {
    teeth: '', confirmed: false, damageHypothesisTransferred: false, resetReason: 'photo-family-conflict',
  });
});

test('same tooth-count semantics preserve the entered count but require fresh confirmation', () => {
  assert.deepEqual(transitionPhotoToothCountDraft('spur', 'helical', 'external_circular', draft), {
    teeth: '24', confirmed: false, damageHypothesisTransferred: false, resetReason: null,
  });
  assert.deepEqual(transitionPhotoToothCountDraft('unknown', 'spur', 'external_circular', draft), {
    teeth: '24', confirmed: false, damageHypothesisTransferred: false, resetReason: null,
  });
});

test('selecting the current kind does not invalidate the draft', () => {
  assert.deepEqual(transitionPhotoToothCountDraft('spur', 'spur', 'external_circular', draft), {
    ...draft, resetReason: null,
  });
});

test('cycloidal photo handoff accepts only a confirmed full count from an external straight wheel', () => {
  assert.deepEqual(confirmedCycloidalPhotoToothCount({ kind: 'spur', teeth: '36', confirmed: true, source: 'drawing' }), { value: 36, source: 'drawing' });
  for (const kind of ['helical', 'herringbone', 'internal', 'rack']) {
    assert.equal(confirmedCycloidalPhotoToothCount({ kind, teeth: '36', confirmed: true, source: 'user_confirmation' }), null, `${kind} uses a different or unsupported geometry`);
  }
  assert.equal(confirmedCycloidalPhotoToothCount({ kind: 'spur', teeth: '36', confirmed: false, source: 'user_confirmation' }), null);
  for (const teeth of ['', '5', '10.5', '251']) {
    assert.equal(confirmedCycloidalPhotoToothCount({ kind: 'spur', teeth, confirmed: true, source: 'measurement' }), null, `${teeth || 'empty'} is not a supported complete count`);
  }
});
