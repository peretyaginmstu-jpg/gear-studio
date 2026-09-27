import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutSnapshot, initialJourney, journeyFromHash, transitionJourney, type JourneyState } from '../lib/journey.ts';
import { defaultModel } from '../lib/model.ts';
import { prepareModelExport } from '../lib/modelExport.ts';

const enter = () => transitionJourney(initialJourney(), { type: 'choose-input', mode: 'manual' });
const build = (state = enter()) => transitionJourney(state, { type: 'build', params: state.manualDraft, origin: 'Задано вручную', evidence: null });
const confirmed = () => transitionJourney(build(), { type: 'confirm' });

test('fresh session has no model or delivery; deep links and forward actions cannot create one', () => {
  const start = initialJourney();
  assert.equal(start.built, null); assert.equal(checkoutSnapshot(start), null);
  for (const stage of ['input', 'review', 'delivery', 'checkout'] as const) {
    assert.equal(transitionJourney(start, { type: 'navigate', stage }).stage, 'start');
    assert.equal(journeyFromHash(start, `#${stage}`).stage, 'start');
  }
  assert.equal(transitionJourney(start, { type: 'confirm' }).confirmedRevision, null);
  assert.equal(transitionJourney(start, { type: 'build', params: defaultModel(), origin: '', evidence: null }).built, null);
});
test('a valid editable template still needs build, review confirmation and delivery choice', () => {
  let s = enter();
  assert.equal(transitionJourney(s, { type: 'navigate', stage: 'review' }).stage, 'input');
  s = build(s); assert.equal(s.stage, 'review');
  assert.equal(transitionJourney(s, { type: 'navigate', stage: 'checkout' }).stage, 'review');
  assert.equal(transitionJourney(s, { type: 'choose-delivery', choice: { kind: 'file', preset: 'pro' } }).choice, null);
  s = transitionJourney(s, { type: 'confirm' }); assert.equal(s.stage, 'delivery');
  assert.equal(transitionJourney(s, { type: 'navigate', stage: 'checkout' }).stage, 'delivery');
  s = transitionJourney(s, { type: 'choose-delivery', choice: { kind: 'file', preset: 'standard' } });
  s = transitionJourney(s, { type: 'navigate', stage: 'checkout' });
  assert.equal(checkoutSnapshot(s)?.choice.kind, 'file');
});
test('invalid input cannot build or confirm and keeps its draft for correction', () => {
  let s = transitionJourney(enter(), { type: 'edit-manual', params: { ...defaultModel(), module: 0 } });
  s = build(s); assert.equal(s.stage, 'input'); assert.equal(s.built, null); assert.ok(s.error);
  assert.equal(s.manualDraft.module, 0); assert.equal(transitionJourney(s, { type: 'confirm' }).confirmedRevision, null);
});
test('back and forward preserve an unchanged draft and snapshot; a real edit invalidates both gates', () => {
  let s = confirmed(); const built = s.built;
  s = journeyFromHash(s, '#manual'); assert.equal(s.built, built);
  s = transitionJourney(s, { type: 'edit-manual', params: { ...s.manualDraft } }); assert.equal(s.built, built);
  s = journeyFromHash(s, '#review'); assert.equal(s.stage, 'review');
  s = transitionJourney(s, { type: 'edit-manual', params: { ...s.manualDraft, module: 2.1 } });
  assert.equal(s.stage, 'input'); assert.equal(s.built, null); assert.equal(s.confirmedRevision, null); assert.equal(s.choice, null);
  assert.equal(journeyFromHash(s, '#checkout').stage, 'input');
  assert.equal(journeyFromHash(s, '#start').manualDraft.module, 2.1);
});
test('photo edits invalidate confirmed results while navigation alone does not', () => {
  let s = transitionJourney(initialJourney(), { type: 'choose-input', mode: 'photo' });
  const evidence = { teeth: { confirmed: true }, measurement: { diameter: 52 } };
  s = transitionJourney(s, { type: 'build', params: defaultModel(), origin: 'Фото и подтверждения', evidence });
  evidence.measurement.diameter = 100;
  assert.equal((s.built!.evidence as typeof evidence).measurement.diameter, 52);
  s = transitionJourney(s, { type: 'confirm' });
  s = journeyFromHash(s, '#photo'); assert.ok(s.built);
  s = transitionJourney(s, { type: 'edit-photo' }); assert.equal(s.built, null); assert.equal(s.confirmedRevision, null);
});
test('changing input method preserves manual values and cannot retain photo confirmation', () => {
  let s = transitionJourney(enter(), { type: 'edit-manual', params: { ...defaultModel(), module: 3 } });
  s = transitionJourney(s, { type: 'choose-input', mode: 'photo' });
  s = transitionJourney(s, { type: 'choose-input', mode: 'manual' }); assert.equal(s.manualDraft.module, 3);
  s = build(s); s = transitionJourney(s, { type: 'confirm' });
  s = transitionJourney(s, { type: 'choose-input', mode: 'photo' }); assert.equal(s.built, null); assert.equal(s.confirmedRevision, null);
});
test('checkout exports its captured model and quality; later changes cannot silently alter the artifact', () => {
  let s: JourneyState = transitionJourney(confirmed(), { type: 'choose-delivery', choice: { kind: 'file', preset: 'pro' } });
  s = transitionJourney(s, { type: 'navigate', stage: 'checkout' });
  const checkout = checkoutSnapshot(s)!; assert.equal(checkout.choice.kind, 'file');
  const prepared = prepareModelExport(checkout.model.params, 'pro', checkout.model);
  s = transitionJourney(s, { type: 'edit-manual', params: { ...s.manualDraft, module: 3 } });
  assert.equal(checkoutSnapshot(s), null);
  assert.equal(prepared.passport.parameters.module, 2);
  assert.equal(prepared.passport.artifact.preset, 'pro');
  assert.equal(new DataView(prepared.stl).getUint32(80, true), prepared.passport.artifact.triangles);
});
