import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, serializeProject, parseProject, restoreProjectJourney, snapshotJourney, PROJECT_SCHEMA, LEGACY_PROJECT_SCHEMA, MAX_PROJECT_VERSIONS, MAX_PROJECT_BYTES } from '../lib/project.ts';
import { addProjectVersion, restoreProjectVersion, compareProjectSnapshots, copyProject, forkProjectVersion, snapshotDescription } from '../lib/projectVersions.ts';
import { initialJourney, transitionJourney } from '../lib/journey.ts';
import { defaultModel } from '../lib/model.ts';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const photoForms = () => ({ photo: { identity: 'default', values: { image: png, teeth: '24',
  imageSize: { width: 1, height: 1, id: 1, source: { fileName: 'деталь.png', mimeType: 'image/png', originalWidth: 1, originalHeight: 1 } } } } });
const manual = () => { const doc = newProject(); doc.journey.mode = 'manual'; doc.journey.stage = 'input'; return doc; };
const roundTrip = (doc: ReturnType<typeof newProject>) => parseProject(serializeProject(doc));

test('named version freezes all inputs independently of subsequent edits', () => {
  const original = manual(); original.forms = photoForms(); original.journey.manualDraft.module = NaN;
  const doc = addProjectVersion(original, '  Исходный образец  ', '  Посадку ещё измерить  ');
  doc.forms.photo.values.teeth = '30'; doc.journey.manualDraft.teeth = 30;
  assert.equal(doc.versions[0].journey.manualDraft.teeth, 24);
  assert.equal(doc.versions[0].forms.photo.values.teeth, '24');
  assert.equal(original.versions.length, 0);
  const portable = roundTrip(doc);
  assert.ok(Number.isNaN(portable.versions[0].journey.manualDraft.module));
  assert.equal(portable.versions[0].name, 'Исходный образец'); assert.equal(portable.versions[0].note, 'Посадку ещё измерить');
});

test('restore first preserves working state, and the return itself can be reversed', () => {
  let doc = addProjectVersion(manual(), 'Было 24');
  const selectedId = doc.versions[0].id, originalId = doc.id;
  doc.journey.manualDraft.teeth = 36; doc.forms = photoForms();
  doc = restoreProjectVersion(doc, selectedId);
  assert.equal(doc.id, originalId); assert.equal(doc.journey.manualDraft.teeth, 24); assert.deepEqual(doc.forms, {});
  assert.equal(doc.versions.length, 2); assert.equal(doc.versions[0].reason, 'before-restore');
  assert.equal(doc.versions[0].journey.manualDraft.teeth, 36); assert.equal(doc.versions[0].forms.photo.values.image, png);
  doc = restoreProjectVersion(roundTrip(doc), doc.versions[0].id);
  assert.equal(doc.journey.manualDraft.teeth, 36); assert.equal(doc.forms.photo.values.image, png);
  assert.equal(doc.versions.length, 3);
});

test('restoring a built photo version regenerates its model and resets delivery approval', () => {
  let state = transitionJourney(initialJourney(), { type: 'choose-input', mode: 'photo' });
  state = transitionJourney(state, { type: 'build', params: { ...defaultModel(), teeth: 32 }, origin: 'Тестовые измерения', evidence: { source: 'test' } });
  assert.ok(state.built); state = transitionJourney(state, { type: 'confirm' });
  let doc = newProject(); doc.journey = snapshotJourney(state); doc.forms = photoForms();
  doc = addProjectVersion(doc, 'До расточки'); doc.journey = manual().journey;
  const restored = restoreProjectJourney(restoreProjectVersion(roundTrip(doc), doc.versions[0].id));
  assert.equal(restored.mode, 'photo'); assert.equal(restored.stage, 'review'); assert.equal(restored.built?.params.teeth, 32);
  assert.equal(restored.confirmedRevision, null); assert.equal(restored.choice, null); assert.equal(restored.built?.validation.valid, true);
});

test('one photo shared by many versions is stored only once without mutating input', () => {
  let doc = manual(); doc.forms = photoForms();
  for (let i = 0; i < 12; i++) doc = addProjectVersion(doc, `Версия ${i}`);
  const encoded = serializeProject(doc), wire = JSON.parse(encoded);
  assert.equal(Object.keys(wire.assets).length, 1); assert.equal(encoded.split(png).length - 1, 1);
  assert.equal(doc.forms.photo.values.image, png); assert.equal(doc.versions[0].forms.photo.values.image, png);
  const decoded = parseProject(encoded); assert.equal(decoded.versions.length, 12);
  assert.ok(decoded.versions.every(version => version.forms.photo.values.image === png));
});

test('a photo replaced or removed from current work remains available in the old version', () => {
  let doc = manual(); doc.forms = photoForms(); doc = addProjectVersion(doc, 'Со снимком');
  doc.forms = {}; const decoded = roundTrip(doc);
  assert.equal(decoded.forms.photo, undefined); assert.equal(decoded.versions[0].forms.photo.values.image, png);
  assert.equal(restoreProjectVersion(decoded, decoded.versions[0].id).forms.photo.values.image, png);
});

test('the exact legacy v1 file migrates, retaining empty fields and photo drafts', () => {
  const current = manual(); current.forms = photoForms(); current.journey.manualDraft.module = NaN;
  const { versions: _versions, ...legacy } = current;
  assert.equal(_versions.length, 0);
  const migrated = parseProject(JSON.stringify({ ...legacy, schema: LEGACY_PROJECT_SCHEMA, appVersion: '0.19.0' }));
  assert.equal(migrated.schema, PROJECT_SCHEMA); assert.deepEqual(migrated.versions, []);
  assert.equal(migrated.forms.photo.values.image, png); assert.ok(Number.isNaN(migrated.journey.manualDraft.module));
  assert.equal(roundTrip(migrated).id, current.id);
  assert.throws(() => parseProject(JSON.stringify({ ...legacy, schema: LEGACY_PROJECT_SCHEMA, versions: [] })), /Несогласованная/);
});

test('unknown assets, external assets, duplicate ids and nested history are rejected', () => {
  let doc = manual(); doc.forms = photoForms(); doc = addProjectVersion(doc, 'Проверка');
  const wire = JSON.parse(serializeProject(doc)); delete wire.assets['photo-1'];
  assert.throws(() => parseProject(JSON.stringify(wire)), /фотография/);
  wire.assets['photo-1'] = 'https://example.com/photo.png'; assert.throws(() => parseProject(JSON.stringify(wire)), /поле/);
  wire.assets['photo-1'] = png; wire.versions.push(wire.versions[0]); assert.throws(() => parseProject(JSON.stringify(wire)), /идентификаторы/);
  wire.versions.pop(); wire.versions[0].versions = []; assert.throws(() => parseProject(JSON.stringify(wire)), /поле/);
});

test('history does not bypass validation of prior measurements, image bounds or family answers', () => {
  let doc = manual(); doc.forms = photoForms(); doc = addProjectVersion(doc, 'Версия'); doc.forms = {};
  const wire = JSON.parse(serializeProject(doc));
  wire.versions[0].forms.photo.values.imageSize.width = 2000;
  assert.throws(() => parseProject(JSON.stringify(wire)), /PNG/);
  wire.versions[0].forms.photo.values.imageSize.width = 1;
  wire.versions[0].forms.photo.values.familyApplication = { source: 'photo', acceptedByUser: true, limitedModelAcknowledged: false,
    decision: { answers: { body: 'unknown', partnerGroup: 'unknown' }, photoHint: null } };
  assert.throws(() => parseProject(JSON.stringify(wire)), /Повреждены/);
});

test('version and size limits refuse changes instead of silently pruning old work', () => {
  let doc = manual();
  for (let i = 0; i < MAX_PROJECT_VERSIONS; i++) doc = addProjectVersion(doc, String(i));
  assert.equal(roundTrip(doc).versions.length, MAX_PROJECT_VERSIONS);
  assert.throws(() => addProjectVersion(doc, 'Ещё'), /100 версий/);
  assert.throws(() => restoreProjectVersion(doc, doc.versions[0].id), /100 версий/);
  assert.equal(doc.versions.length, MAX_PROJECT_VERSIONS);
  const separate = forkProjectVersion(doc, doc.versions[0].id);
  assert.equal(separate.versions.length, 0); assert.notEqual(separate.id, doc.id);
  assert.equal(addProjectVersion(separate, 'Продолжение').versions.length, 1);
  assert.throws(() => addProjectVersion(manual(), '  '), /Название/);
  assert.throws(() => addProjectVersion(manual(), 'Имя', 'x'.repeat(1001)), /Заметка/);
  assert.throws(() => restoreProjectVersion(doc, crypto.randomUUID()), /не найдена/);
  assert.throws(() => parseProject('я'.repeat(Math.ceil(MAX_PROJECT_BYTES / 2) + 1)), /32 МБ/);
});

test('copying work changes identity and isolates fields while preserving the source history', () => {
  const source = addProjectVersion(manual(), 'Оригинал'), copied = { ...copyProject(source), versions: [] };
  assert.notEqual(copied.id, source.id); assert.equal(copied.versions.length, 0); assert.equal(source.versions.length, 1);
  copied.journey.manualDraft.teeth = 40; assert.equal(source.journey.manualDraft.teeth, 24);
});

test('opening a historical variant as a new project preserves both its inputs and the source', () => {
  const source = addProjectVersion(manual(), 'Прототип');
  source.journey.manualDraft.teeth = 30;
  const branch = forkProjectVersion(source, source.versions[0].id);
  assert.equal(branch.journey.manualDraft.teeth, 24); assert.equal(source.journey.manualDraft.teeth, 30);
  assert.equal(branch.versions.length, 0); assert.equal(source.versions.length, 1); assert.notEqual(branch.id, source.id);
  assert.equal(forkProjectVersion(source).journey.manualDraft.teeth, 30);
  assert.throws(() => forkProjectVersion(source, crypto.randomUUID()), /не найдена/);
});

test('comparison shows small numeric edits and less common geometry settings without rounding them away', () => {
  const before = manual(); before.journey.manualDraft = defaultModel('internal'); const after = structuredClone(before);
  after.journey.manualDraft.module += .00000001; after.journey.manualDraft.internalCutterThinning = .05;
  after.journey.manualDraft.width = NaN;
  const result = compareProjectSnapshots(before, after);
  assert.equal(result.canCompareParams, true);
  assert.deepEqual(result.changes.map(change => change.key), ['module', 'width', 'rimThickness', 'internalCutterThinning']);
  assert.notEqual(result.changes[0].before, result.changes[0].after); assert.equal(result.changes[1].after, 'Не задано');
  assert.equal(compareProjectSnapshots(after, structuredClone(after)).changes.length, 0);
});

test('comparison ignores settings of another family and equates implicit defaults with built values', () => {
  const before = manual(), after = structuredClone(before);
  delete before.journey.manualDraft.wormStarts; delete before.journey.manualDraft.wormDiameterFactor; delete before.journey.manualDraft.wormHand;
  after.journey.manualDraft.toolTipRadiusCoefficient = .3;
  assert.deepEqual(compareProjectSnapshots(before, after).changes, []);
  before.journey.manualDraft = defaultModel('worm'); after.journey.manualDraft = { ...before.journey.manualDraft, wormStarts: 2 };
  assert.deepEqual(compareProjectSnapshots(before, after).changes.map(change => change.key), ['wormStarts']);
});

test('unfinished photo drafts do not report default manual dimensions as their model', () => {
  const draft = manual(); draft.journey.mode = 'photo'; draft.forms = photoForms();
  assert.match(snapshotDescription(draft), /По фото · черновик/); assert.ok(!snapshotDescription(draft).includes('z 24'));
  assert.equal(compareProjectSnapshots(draft, manual()).canCompareParams, false);
  assert.equal(compareProjectSnapshots(draft, manual()).photoChanged, true);
});
