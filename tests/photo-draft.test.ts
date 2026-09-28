import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionPhotoToothCountDraft } from '../lib/photo-draft.ts';

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
