import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutSnapshot, initialJourney, journeyFromHash, transitionJourney, type JourneyState } from '../lib/journey.ts';
import { defaultModel } from '../lib/model.ts';
import { prepareModelExport } from '../lib/modelExport.ts';
import { analyzeSpanMeasurement, selectSpanApplication, type SpanMeasurementInput } from '../lib/spanMeasurement.ts';
import { createPrintBrief } from '../lib/printBrief.ts';
import { defaultPrintSettings } from '../lib/printability.ts';
import { selectFamilyApplication, type FamilyApplication } from '../lib/familyIdentification.ts';

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

const spanInput = (fit = false): SpanMeasurementInput => ({ kind: 'spur', teeth: 24, spanTeeth: 3,
  pressureAngleDeg: 20, pressureAngleConfirmed: true, tipDiameterMethod: 'tip_circle',
  spanMm: fit ? 15.44 : 15.357747658604712, nextSpanMm: fit ? 21.34 : 21.262010526791812, tipDiameterMm: 52,
  errorBounds: { spanMm: .01, nextSpanMm: .01, tipDiameterMm: .01 },
  confirmations: { teeth: true, involute: true, standardTip: true, measurementSetup: true }, toolTipRadiusCoefficient: .3,
});

test('editing span measurements invalidates a confirmed model and blocks building old template values', () => {
  let s = confirmed();
  s = transitionJourney(s, { type: 'edit-manual-span' });
  assert.equal(s.built, null); assert.equal(s.confirmedRevision, null); assert.equal(s.manualSpanPending, true);
  s = build(s); assert.equal(s.stage, 'input'); assert.equal(s.built, null); assert.match(s.error!, /Измерения изменены/);
  assert.equal(journeyFromHash(s, '#checkout').stage, 'input');
  s = transitionJourney(s, { type: 'clear-manual-span' });
  s = build(s); assert.equal(s.stage, 'review', 'explicit return to direct input can build its displayed values');
});

test('explicit span application preserves evidence through body edits and navigation but drops it after a profile edit', () => {
  const application = selectSpanApplication(analyzeSpanMeasurement(spanInput()), 'exact-inverse');
  let s = transitionJourney(enter(), { type: 'apply-manual-span', application });
  const accepted = s.manualDraft.module;
  application.candidate.parameters.module = 99;
  assert.equal(s.manualSpan!.candidate.parameters.module, accepted, 'application is owned by the draft');
  s = transitionJourney(s, { type: 'edit-manual', params: { ...s.manualDraft, width: 12, bore: 6 } });
  assert.ok(s.manualSpan); s = build(s);
  assert.equal(s.built!.params.width, 12); assert.match(s.built!.origin, /Общая нормаль/);
  const evidence = s.built!.evidence as { spanMeasurement: typeof application; bodyDimensions: { widthMm: number; boreMm: number } };
  assert.equal(evidence.bodyDimensions.widthMm, 12); assert.equal(evidence.bodyDimensions.boreMm, 6);
  assert.equal(evidence.spanMeasurement.input.spanMm, spanInput().spanMm);
  s = journeyFromHash(s, '#start'); s = journeyFromHash(s, '#manual'); assert.ok(s.manualSpan);
  s = transitionJourney(s, { type: 'edit-manual', params: { ...s.manualDraft, profileShift: .1 } });
  assert.equal(s.manualSpan, null); assert.equal(s.built, null); assert.equal(s.confirmedRevision, null);
});

test('fit checkout STL, passport and print brief share the selected representative, not the raw diameter or a preview guess', () => {
  const application = selectSpanApplication(analyzeSpanMeasurement(spanInput(true)), 'bounded-zero-thinning-fit');
  let s = transitionJourney(enter(), { type: 'apply-manual-span', application });
  s = build(s); s = transitionJourney(s, { type: 'confirm' });
  s = transitionJourney(s, { type: 'choose-delivery', choice: { kind: 'file', preset: 'pro' } });
  s = transitionJourney(s, { type: 'navigate', stage: 'checkout' });
  const model = checkoutSnapshot(s)!.model, prepared = prepareModelExport(model.params, 'pro', model);
  assert.equal(prepared.passport.parameters.module, application.candidate.parameters.module);
  assert.equal(prepared.passport.parameters.backlash, 0);
  assert.ok(Math.abs(prepared.passport.dimensions.tipDiameter - application.candidate.representativeReadings.tipDiameterMm) < 1e-12);
  assert.notEqual(prepared.passport.dimensions.tipDiameter, application.input.tipDiameterMm);
  assert.equal(new DataView(prepared.stl).getUint32(80, true), prepared.passport.artifact.triangles);
  const brief = createPrintBrief(model.mesh, model.validation, defaultPrintSettings, model, '2026-09-28T00:00:00.000Z');
  assert.deepEqual(brief.parameters, prepared.passport.parameters);
  assert.deepEqual(brief.evidence, prepared.passport.evidence); assert.equal(brief.origin, prepared.passport.origin);
  assert.equal(brief.orderStatus, 'Файл задания. Заказ не отправлен.'); assert.equal(brief.appVersion, '0.11.0');
  s = transitionJourney(s, { type: 'edit-manual-span' }); assert.equal(checkoutSnapshot(s), null);
  assert.equal(prepared.passport.parameters.module, application.candidate.parameters.module);
});

const family = (direction: 'straight' | 'inclined' = 'straight') => selectFamilyApplication({
  partnerGroup: 'unknown', body: 'external-cylinder', direction,
}, 'manual');

test('editing family observations invalidates confirmation and cannot build or deep-link past pending answers', () => {
  let s = transitionJourney(confirmed(), { type: 'edit-manual-family' });
  assert.equal(s.manualFamilyPending, true); assert.equal(s.built, null); assert.equal(s.confirmedRevision, null);
  s = build(s); assert.equal(s.built, null); assert.match(s.error!, /Признаки типа изменены/);
  for (const hash of ['#review', '#delivery', '#checkout']) assert.equal(journeyFromHash(s, hash).stage, 'input');
  s = journeyFromHash(s, '#start'); s = journeyFromHash(s, '#manual'); assert.equal(s.manualFamilyPending, true);
  s = transitionJourney(s, { type: 'apply-manual-family', application: family() });
  assert.equal(build(s).stage, 'review');
});
test('same family application preserves span, body and exact nonstandard parameters; a different family resets dependent values', () => {
  const span = selectSpanApplication(analyzeSpanMeasurement(spanInput(true)), 'bounded-zero-thinning-fit');
  let s = transitionJourney(enter(), { type: 'apply-manual-span', application: span });
  s = transitionJourney(s, { type: 'edit-manual', params: { ...s.manualDraft, width: 12 } });
  const params = structuredClone(s.manualDraft);
  s = transitionJourney(s, { type: 'edit-manual-family' });
  assert.ok(s.manualSpan, 'draft remains available while the type is pending');
  s = transitionJourney(s, { type: 'apply-manual-family', application: family() });
  assert.deepEqual(s.manualDraft, params); assert.deepEqual(s.manualSpan, span);
  s = transitionJourney(s, { type: 'apply-manual-family', application: family('inclined') });
  assert.deepEqual(s.manualDraft, defaultModel('helical')); assert.equal(s.manualSpan, null); assert.equal(s.manualSpanPending, false);
});
test('family and span evidence coexist in the same captured passport and print brief', () => {
  const span = selectSpanApplication(analyzeSpanMeasurement(spanInput()), 'exact-inverse');
  const application = family();
  let s = transitionJourney(enter(), { type: 'apply-manual-span', application: span });
  s = transitionJourney(s, { type: 'apply-manual-family', application });
  application.decision.answers.direction = 'inclined';
  assert.equal(s.manualFamily!.decision.answers.direction, 'straight');
  s = transitionJourney(s, { type: 'edit-manual', params: { ...s.manualDraft, width: 12 } });
  s = build(s); const model = s.built!;
  const prepared = prepareModelExport(model.params, 'standard', model);
  const evidence = prepared.passport.evidence as { familySelection: FamilyApplication; spanMeasurement: typeof span };
  assert.equal(evidence.familySelection.decision.answers.direction, 'straight');
  assert.equal(evidence.familySelection.method, 'guided-observations'); assert.deepEqual(evidence.spanMeasurement, span);
  const brief = createPrintBrief(model.mesh, model.validation, defaultPrintSettings, model);
  assert.deepEqual(brief.evidence, prepared.passport.evidence); assert.deepEqual(brief.parameters, prepared.passport.parameters);
  s = transitionJourney(s, { type: 'edit-manual-family' });
  assert.equal(s.built, null); assert.equal(evidence.familySelection.decision.answers.direction, 'straight');
});
test('direct choice and explicit cancellation clear guided evidence; same direct family retains numerical work', () => {
  let s = transitionJourney(enter(), { type: 'apply-manual-family', application: family() });
  s = transitionJourney(s, { type: 'edit-manual', params: { ...s.manualDraft, module: 2.125 } });
  assert.ok(s.manualFamily, 'observations do not claim a numerical module');
  s = transitionJourney(s, { type: 'select-manual-kind', kind: 'spur' });
  assert.equal(s.manualDraft.module, 2.125); assert.equal(s.manualFamily, null); assert.equal(s.manualFamilyMethod, 'direct-list');
  s = transitionJourney(s, { type: 'edit-manual-family' });
  s = transitionJourney(s, { type: 'clear-manual-family' }); assert.equal(s.manualFamilyPending, false); assert.equal(build(s).stage, 'review');
  s = transitionJourney(s, { type: 'apply-manual-family', application: family() });
  s = transitionJourney(s, { type: 'edit-manual', params: defaultModel('internal') });
  assert.equal(s.manualFamily, null); assert.equal(s.manualFamilyPending, false);
});
test('WebMCP replacement clears both assistants and builds only an unconfirmed review', () => {
  let s = transitionJourney(enter(), { type: 'edit-manual-span' });
  s = transitionJourney(s, { type: 'edit-manual-family' });
  // Same public actions as useGearTool, including method after a possible kind change.
  s = transitionJourney(s, { type: 'choose-input', mode: 'manual' });
  s = transitionJourney(s, { type: 'clear-manual-span' });
  s = transitionJourney(s, { type: 'edit-manual', params: defaultModel('helical') });
  s = transitionJourney(s, { type: 'clear-manual-family', method: 'webmcp' });
  s = build(s); assert.equal(s.stage, 'review'); assert.equal(s.confirmedRevision, null); assert.equal(checkoutSnapshot(s), null);
  assert.deepEqual(s.built!.evidence, { familySelection: { method: 'webmcp', source: 'manual', modelKind: 'helical' } });
});
test('limited photo observations transfer to a named manual model with their limitations and require manual build', () => {
  const application = selectFamilyApplication({ partnerGroup: 'unknown', body: 'cone', coneDirection: 'straight' }, 'photo', { type: 'external_circular' }, true);
  let s = transitionJourney(initialJourney(), { type: 'choose-input', mode: 'photo' });
  s = transitionJourney(s, { type: 'choose-input', mode: 'manual' });
  s = transitionJourney(s, { type: 'apply-manual-family', application });
  assert.equal(s.stage, 'input'); assert.equal(s.built, null); assert.equal(s.manualDraft.kind, 'bevel');
  s = build(s); assert.equal(s.stage, 'review');
  const evidence = s.built!.evidence as { familySelection: FamilyApplication };
  assert.equal(evidence.familySelection.source, 'photo'); assert.equal(evidence.familySelection.method, 'limited-manual-model');
  assert.equal(evidence.familySelection.limitedModelAcknowledged, true);
  s = journeyFromHash(s, '#manual');
  s = transitionJourney(s, { type: 'edit-manual', params: { ...s.manualDraft, module: 3, width: 12 } });
  s = transitionJourney(s, { type: 'choose-input', mode: 'photo' });
  s = transitionJourney(s, { type: 'choose-input', mode: 'manual' });
  s = transitionJourney(s, { type: 'apply-manual-family', application });
  assert.equal(s.manualDraft.module, 3); assert.equal(s.manualDraft.width, 12, 'reopening the same manual family keeps its dimensions');
  s = transitionJourney(s, { type: 'select-manual-kind', kind: 'helical' });
  s = transitionJourney(s, { type: 'choose-input', mode: 'photo' });
  s = transitionJourney(s, { type: 'choose-input', mode: 'manual' });
  s = transitionJourney(s, { type: 'apply-manual-family', application });
  assert.deepEqual(s.manualDraft, defaultModel('bevel'), 'explicit reopening replaces a different manual family');
  assert.equal(s.built, null);
});
test('photo family, damage and scale evidence share one immutable export snapshot', () => {
  const application = selectFamilyApplication({ partnerGroup: 'unknown', body: 'external-cylinder', direction: 'straight' }, 'photo', { type: 'external_circular' });
  const evidence = { familySelection: application, photoAnalysisEvidence: { hypothesisTransfer: { transferred: true, independentlyConfirmedByUser: true, confirmedFullToothCount: 24 } },
    photoMeasurement: { sourceImage: 'synthetic-fixture', diameterMm: 52, conditional: true } };
  let s = transitionJourney(initialJourney(), { type: 'choose-input', mode: 'photo' });
  s = transitionJourney(s, { type: 'build', params: defaultModel(), origin: 'Фото и подтверждённые данные', evidence });
  const model = s.built!, passport = prepareModelExport(model.params, 'standard', model).passport;
  const brief = createPrintBrief(model.mesh, model.validation, defaultPrintSettings, model);
  assert.deepEqual(passport.evidence, evidence); assert.deepEqual(brief.evidence, passport.evidence);
  evidence.familySelection.decision.answers.direction = 'inclined'; evidence.photoMeasurement.diameterMm = 99;
  assert.equal((passport.evidence as typeof evidence).familySelection.decision.answers.direction, 'straight');
  assert.equal((passport.evidence as typeof evidence).photoMeasurement.diameterMm, 52);
});
