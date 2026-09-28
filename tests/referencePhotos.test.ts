import test from 'node:test';
import assert from 'node:assert/strict';
import { appendReferencePhotos, swapReferencePhoto, referencePhotoManifest, referencePhotosSchema, MAX_REFERENCE_IMAGE_CHARS, type ReferencePhoto } from '../lib/referencePhotos.ts';
import { newProject, parseProject, serializeProject, snapshotJourney, PROJECT_SCHEMA, PREVIOUS_PROJECT_SCHEMA } from '../lib/project.ts';
import { addProjectVersion, restoreProjectVersion, compareProjectSnapshots } from '../lib/projectVersions.ts';
import { initialJourney, transitionJourney, canVisit } from '../lib/journey.ts';
import { defaultModel } from '../lib/model.ts';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const photo = (note = ''): ReferencePhoto => ({ id: crypto.randomUUID(), role: 'side', note, image: png, width: 1, height: 1,
  source: { fileName: 'вид-сбоку.png', mimeType: 'image/png', originalWidth: 1, originalHeight: 1 } });
const withPhotos = () => {
  const doc = newProject(), main = photo();
  doc.forms = { photo: { identity: 'default', values: { image: png, imageSize: { width: 1, height: 1, id: 1, source: main.source } } },
    photoReferences: { identity: 'default', values: { photos: [photo('Проверить направление'), { ...photo('Проверить отверстие'), role: 'body' }] } } };
  return doc;
};
const roundTrip = (doc: ReturnType<typeof newProject>) => parseProject(serializeProject(doc));

test('supporting images and notes share one asset with main photo and every history snapshot', () => {
  let doc = withPhotos();
  const before = structuredClone(doc.forms);
  for (let i = 0; i < 4; i++) doc = addProjectVersion(doc, `Осмотр ${i}`);
  const contents = serializeProject(doc), wire = JSON.parse(contents), restored = parseProject(contents);
  assert.equal(wire.schema, PROJECT_SCHEMA); assert.equal(Object.keys(wire.assets).length, 1);
  assert.equal(contents.split(png).length - 1, 1);
  assert.deepEqual(doc.forms, before); assert.deepEqual(restored.forms, before);
  assert.ok(restored.versions.every(version => JSON.stringify(version.forms) === JSON.stringify(before)));
});

test('restoring a version recovers removed photos and notes without changing the stored version', () => {
  let doc = addProjectVersion(withPhotos(), 'Исходный осмотр');
  const originalId = doc.versions[0].id, original = structuredClone(doc.forms);
  doc.forms.photoReferences.values.photos = [];
  assert.equal(compareProjectSnapshots(doc.versions[0], doc).referencePhotosChanged, true);
  doc = restoreProjectVersion(roundTrip(doc), originalId);
  assert.deepEqual(doc.forms, original); assert.deepEqual(doc.versions[0].forms.photoReferences.values.photos, []);
  assert.equal(compareProjectSnapshots(doc, structuredClone(doc)).referencePhotosChanged, false);
});

test('import normalization does not invent photo or input changes from object property order', () => {
  const before = withPhotos(), after = roundTrip(before);
  const photos = after.forms.photoReferences.values.photos as ReferencePhoto[];
  photos[0] = { source: { ...photos[0].source }, height: photos[0].height, width: photos[0].width,
    image: photos[0].image, note: photos[0].note, role: photos[0].role, id: photos[0].id };
  let comparison = compareProjectSnapshots(before, after);
  assert.equal(comparison.referencePhotosChanged, false); assert.equal(comparison.inputsChanged, false);
  photos[0].note = 'Другая заметка после импорта';
  comparison = compareProjectSnapshots(before, after);
  assert.equal(comparison.referencePhotosChanged, true); assert.equal(comparison.inputsChanged, true);
});

test('v2 projects and image histories migrate; v2 cannot disguise the new multi-view format', () => {
  const doc = withPhotos(); delete doc.forms.photoReferences;
  const wire = JSON.parse(serializeProject(addProjectVersion(doc, 'Старая версия')));
  wire.schema = PREVIOUS_PROJECT_SCHEMA; wire.appVersion = '0.21.0';
  const restored = parseProject(JSON.stringify(wire));
  assert.equal(restored.schema, PROJECT_SCHEMA); assert.equal(restored.versions.length, 1); assert.equal(restored.forms.photo.values.image, png);
  wire.versions[0].forms.photoReferences = { identity: 'default', values: { photos: [] } };
  assert.throws(() => parseProject(JSON.stringify(wire)), /требуют v3/);
});

test('promotion swaps only the selected reference and preserves metadata on the old main image', () => {
  const first = photo('Вид слева'), second = photo('Посадка'), previousMain = photo('Заметка основного');
  const current = [first, second], next = swapReferencePhoto(current, first.id, previousMain);
  assert.deepEqual(next, [previousMain, second]); assert.deepEqual(current, [first, second]);
  assert.deepEqual(swapReferencePhoto(current, first.id, null), [second]);
  assert.throws(() => swapReferencePhoto(current, crypto.randomUUID(), previousMain), /уже изменён/);
  assert.throws(() => swapReferencePhoto(current, first.id, second), /идентификатор/);
});

test('main-view metadata survives project and history transfer and cannot alias an extra photo', () => {
  const doc = withPhotos(), main = photo('Снимок с обозначениями');
  doc.forms.photo.values.imageReference = { id: main.id, role: main.role, note: main.note };
  assert.deepEqual(roundTrip(doc).forms.photo.values.imageReference, doc.forms.photo.values.imageReference);
  (doc.forms.photoReferences.values.photos as ReferencePhoto[]).push(main);
  assert.throws(() => roundTrip(doc), /основного снимка/);
});

test('limits and malformed reference assets reject the whole import, including historical snapshots', () => {
  const doc = withPhotos(), current = doc.forms.photoReferences.values.photos as ReferencePhoto[];
  assert.equal(appendReferencePhotos(current, [photo(), photo()]).length, 4);
  assert.throws(() => appendReferencePhotos(current, [photo(), photo(), photo()]), /четырёх/);
  assert.equal(current.length, 2);
  assert.throws(() => appendReferencePhotos(current, [current[0]]), /уже есть/);
  assert.equal(referencePhotosSchema.safeParse([photo(), { ...photo(), width: 2 }]).success, false);
  assert.equal(referencePhotosSchema.safeParse([{ ...photo(), image: 'data:image/svg+xml;base64,AAAA' }]).success, false);
  assert.equal(referencePhotosSchema.safeParse([{ ...photo(), image: 'data:image/png;base64,' + 'A'.repeat(MAX_REFERENCE_IMAGE_CHARS) }]).success, false);
  const wire = JSON.parse(serializeProject(addProjectVersion(doc, 'Осмотр')));
  wire.forms = {};
  wire.versions[0].forms.photoReferences.values.photos[1].image.asset = 'photo-999';
  assert.throws(() => parseProject(JSON.stringify(wire)), /фотография/);
  wire.versions[0].forms.photoReferences.values.photos[1].image = { asset: 'photo-1' };
  wire.versions[0].forms.photoReferences.values.photos[1].role = 'automatically-confirmed';
  assert.throws(() => parseProject(JSON.stringify(wire)), /Повреждены/);
});

for (const mode of ['photo', 'manual'] as const) test(`view changes invalidate ${mode} model approval; passport snapshots isolate notes and omit pixels`, () => {
  const views = [photo('Ширину проверить вручную')];
  let state = transitionJourney(initialJourney(), { type: 'choose-input', mode });
  state = transitionJourney(state, { type: 'build', params: defaultModel(), origin: 'Тестовый ввод', evidence: { photoEvidence: true }, referencePhotos: referencePhotoManifest(views) });
  assert.ok(state.built);
  const evidence = state.built.evidence as { supportingPhotos: ReturnType<typeof referencePhotoManifest> };
  assert.equal(evidence.supportingPhotos.photos[0].note, views[0].note); assert.ok(!JSON.stringify(evidence).includes('base64'));
  views[0].note = 'Новая заметка'; assert.equal(evidence.supportingPhotos.photos[0].note, 'Ширину проверить вручную');
  const project = withPhotos(); project.journey = snapshotJourney(state);
  assert.deepEqual(roundTrip(project).journey.built?.evidence, state.built.evidence);
  state = transitionJourney(state, { type: 'confirm' }); assert.equal(canVisit(state, 'delivery'), true);
  const params = state.manualDraft;
  state = transitionJourney(state, { type: 'edit-reference-photos' });
  assert.equal(state.built, null); assert.equal(state.confirmedRevision, null); assert.equal(canVisit(state, 'delivery'), false);
  assert.deepEqual(state.manualDraft, params);
});
