import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, parseProject, serializeProject, snapshotJourney, restoreProjectJourney, projectFilename, MAX_PROJECT_BYTES } from '../lib/project.ts';
import { initialJourney, transitionJourney, canVisit } from '../lib/journey.ts';
import { defaultModel, modelNames, type ModelKind } from '../lib/model.ts';
import { selectFamilyApplication } from '../lib/familyIdentification.ts';
import { inferCycloidalPhotoModule } from '../lib/cycloidalPhotoInference.ts';
import { estimatePhotoCircle } from '../lib/photo-scale.ts';
import { analyzeSpanMeasurement, predictedSpanMm, selectSpanApplication } from '../lib/spanMeasurement.ts';

const roundTrip = (value: ReturnType<typeof newProject>) => parseProject(serializeProject(value));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';

test('empty project opens at start without a fabricated model', () => {
  const doc = roundTrip(newProject()), state = restoreProjectJourney(doc);
  assert.equal(state.stage, 'start'); assert.equal(state.built, null); assert.equal(canVisit(state, 'checkout'), false);
  assert.equal(doc.id, newProject(doc.id).id);
});

test('incomplete manual number survives as empty instead of silently becoming zero', () => {
  const doc = newProject(); doc.journey.mode = 'manual'; doc.journey.stage = 'input'; doc.journey.manualDraft.module = NaN;
  const restored = restoreProjectJourney(roundTrip(doc));
  assert.ok(Number.isNaN(restored.manualDraft.module)); assert.equal(restored.built, null); assert.equal(restored.stage, 'input');
});

for (const kind of Object.keys(modelNames) as ModelKind[]) test(`project rebuilds ${kind} from parameters, without saved checkout approval`, () => {
  let state = transitionJourney(initialJourney(), { type: 'choose-input', mode: 'manual' });
  state = transitionJourney(state, { type: 'edit-manual', params: defaultModel(kind) });
  state = transitionJourney(state, { type: 'build', params: state.manualDraft, origin: 'Исходные размеры', evidence: null });
  assert.ok(state.built, state.error ?? 'model must build');
  state = transitionJourney(state, { type: 'confirm' });
  state = transitionJourney(state, { type: 'choose-delivery', choice: { kind: 'file', preset: 'pro' } });
  state = transitionJourney(state, { type: 'navigate', stage: 'checkout' });
  const doc = newProject(); doc.journey = snapshotJourney(state);
  assert.ok(!serializeProject(doc).includes('positions'));
  const restored = restoreProjectJourney(roundTrip(doc));
  assert.equal(restored.stage, 'review'); assert.equal(restored.confirmedRevision, null); assert.equal(restored.choice, null);
  assert.equal(restored.built?.mesh.indices.length, state.built?.mesh.indices.length);
  assert.deepEqual(restored.built?.params, state.built?.params);
  assert.deepEqual(restored.built?.evidence, state.built?.evidence);
  assert.equal(canVisit(restored, 'checkout'), false); assert.ok(restored.built?.validation.valid);
});

test('invalid or stale built geometry falls back to its editable inputs', () => {
  const doc = newProject(); doc.journey.mode = 'manual'; doc.journey.stage = 'checkout';
  doc.journey.built = { mode: 'manual', revision: 0, params: { ...defaultModel(), teeth: -2 }, origin: 'test', evidence: null };
  const invalid = restoreProjectJourney(roundTrip(doc));
  assert.equal(invalid.built, null); assert.equal(invalid.stage, 'input'); assert.match(invalid.error!, /исправить/);
  doc.journey.built.params = defaultModel(); doc.journey.built.revision = 1;
  assert.equal(restoreProjectJourney(roundTrip(doc)).built, null);
  doc.journey.built.revision = 0; doc.journey.built.mode = 'photo';
  assert.equal(restoreProjectJourney(roundTrip(doc)).built, null);
});

test('photo, entered facts, unfinished helpers and scale points round-trip together', () => {
  const doc = newProject(); doc.journey.mode = 'photo'; doc.journey.stage = 'input';
  doc.forms = {
    photo: { identity: 'default', values: { step: 2, image: png,
      imageSize: { width: 1, height: 1, id: 7, source: { fileName: 'образец.png', mimeType: 'image/png', originalWidth: 1, originalHeight: 1 } },
      kind: 'spur', profile: 'involute', teeth: '24', confirmedTeeth: true, diameter: '52', width: '', spanPending: true,
      region: null, analysisRevision: 3 } },
    photoSpan: { identity: '7-3', values: { k: '3', w: '15.4', nextW: '', setupConfirmed: false } },
    photoFamily: { identity: '7-3', values: { answers: { partnerGroup: 'unknown', body: 'external-cylinder' }, page: 'direction' } },
    photoScale: { identity: '7-3-spur', values: { referencePoints: [{ x: 0, y: 0 }], tipPoints: [], pixelError: '', confirmedTips: false } },
  };
  const restored = roundTrip(doc);
  assert.deepEqual(restored.forms, doc.forms); assert.equal(restored.journey.mode, 'photo');
  assert.equal(restoreProjectJourney(restored).built, null);
});

test('accepted scale is recalculated from observations; forged diameter is ignored', () => {
  const doc = newProject();
  const input = { imageWidth: 1000, imageHeight: 1000, referencePoints: [{ x: 50, y: 50 }, { x: 450, y: 50 }],
    tipPoints: [{ x: 700, y: 500 }, { x: 400, y: 500 + 100 * Math.sqrt(3) }, { x: 400, y: 500 - 100 * Math.sqrt(3) }],
    referenceLengthMm: 100, referenceToleranceMm: 0, pixelUncertaintyPx: 0, confirmedCoplanar: true, confirmedAxialView: true };
  const computed = estimatePhotoCircle(input); assert.equal(computed.status, 'ready');
  doc.forms.photo = { identity: 'default', values: { photoMeasurement: { input, result: { status: 'ready', diameterMm: 999 }, confirmedTipCircle: true, target: 'external_tooth_tips' } } };
  const restored = roundTrip(doc).forms.photo.values.photoMeasurement as { result: { diameterMm: number } };
  assert.ok(Math.abs(restored.result.diameterMm - 100) < 1e-9);
});

test('family application recomputes the proposal while keeping pending manual answers', () => {
  const doc = newProject();
  const application = selectFamilyApplication({ partnerGroup: 'unknown', body: 'external-cylinder', direction: 'straight' }, 'manual');
  doc.journey.manualFamily = { ...application, modelKind: 'worm' };
  doc.journey.manualFamilyPending = true;
  doc.forms.manualFamily = { identity: 'default', values: { answers: { partnerGroup: 'toothed' }, page: 'partner', limitedAcknowledged: false } };
  const restored = roundTrip(doc);
  assert.equal(restored.journey.manualFamily?.modelKind, 'spur'); assert.equal(restored.journey.manualFamilyPending, true);
  assert.deepEqual(restored.forms.manualFamily, doc.forms.manualFamily);
});

test('accepted span readings round-trip by recalculating their applied parameters', () => {
  const params = { kind: 'spur' as const, teeth: 24, module: 2, pressureAngleDeg: 20, helixAngleDeg: 0 as const,
    profileShift: 0, backlash: .06, toolTipRadiusCoefficient: .3 };
  const application = selectSpanApplication(analyzeSpanMeasurement({ kind: 'spur', teeth: 24, spanTeeth: 3,
    pressureAngleDeg: 20, pressureAngleConfirmed: true, spanMm: predictedSpanMm(params, 3), nextSpanMm: predictedSpanMm(params, 4),
    tipDiameterMm: 52, tipDiameterMethod: 'opposed_tips', toolTipRadiusCoefficient: .3,
    errorBounds: { spanMm: .01, nextSpanMm: .01, tipDiameterMm: .01 },
    confirmations: { teeth: true, involute: true, standardTip: true, measurementSetup: true },
  }), 'exact-inverse');
  const doc = newProject(); doc.journey.manualSpan = application;
  const restored = roundTrip(doc);
  assert.deepEqual(restored.journey.manualSpan, application);
});

test('cycloidal photo provenance survives and rejects inconsistent derived module', () => {
  const fact = <T,>(value: T) => ({ value, source: 'measurement' as const });
  const inference = inferCycloidalPhotoModule({ kind: fact('spur'), profileType: fact('cycloidal'), toothCount: fact(24),
    tipDiameterMm: fact(52), tipDiameterMethod: fact('tip_circle'), standardAddendum: fact(true) });
  assert.equal(inference.status, 'ready');
  let state = transitionJourney(initialJourney(), { type: 'choose-input', mode: 'photo' });
  state = transitionJourney(state, { type: 'photo-to-manual-cycloidal', toothCount: fact(24), moduleInference: inference });
  const doc = newProject(); doc.journey = snapshotJourney(state);
  assert.deepEqual(roundTrip(doc).journey.photoCycloidalHandoff, doc.journey.photoCycloidalHandoff);
  if (doc.journey.photoCycloidalHandoff?.moduleInference?.status === 'ready') doc.journey.photoCycloidalHandoff.moduleInference.moduleMm = 5;
  assert.throws(() => roundTrip(doc), /поле/);
});

test('rejects malformed, newer and oversized files without creating a replacement project', () => {
  assert.throws(() => parseProject('{'), /JSON/);
  assert.throws(() => parseProject('{"schema":"zatseplenie.project.v99"}'), /формат/);
  assert.throws(() => parseProject(' '.repeat(MAX_PROJECT_BYTES + 1)), /32 МБ/);
  const doc = newProject(); const raw = JSON.parse(serializeProject(doc)); delete raw.journey.manualDraft;
  assert.throws(() => parseProject(JSON.stringify(raw)), /manualDraft/);
  doc.forms.unrecognized = { identity: 'default', values: {} };
  assert.throws(() => roundTrip(doc), /Неизвестный раздел/);
});

test('rejects external image URLs, corrupt sizes and prototype keys', () => {
  const doc = newProject(); doc.forms.photo = { identity: 'default', values: { image: 'https://example.com/tracker.png' } };
  assert.throws(() => roundTrip(doc), /Повреждены/);
  doc.forms.photo.values = { image: png, imageSize: { width: 2048, height: 2048, id: 1, source: { fileName: 'a.png', mimeType: 'image/png', originalWidth: 1, originalHeight: 1 } } };
  assert.throws(() => roundTrip(doc), /PNG/);
  assert.throws(() => parseProject('{"__proto__":{"polluted":true}}'), /Недопустимое/);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test('project filename is portable and preserves Russian names', () => {
  assert.equal(projectFilename('../Мотор:24/шестерня?'), '..Мотор24шестерня.gear.json');
  assert.equal(projectFilename(':/?'), 'gear-project.gear.json');
});
