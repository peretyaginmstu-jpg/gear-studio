import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelMesh, defaultModel, modelNames, type ModelKind } from '../lib/model.ts';
import { validateMesh } from '../lib/gearMath.ts';
import { emptyManufacturingDraft, manufacturingDimensions, manufacturingDraftSchema, manufacturingPrintNotes, manufacturingReport, reviewManufacturing, type ManufacturingDraft } from '../lib/manufacturing.ts';
import { prepareModelExport } from '../lib/modelExport.ts';
import { createPrintBrief } from '../lib/printBrief.ts';
import { defaultPrintSettings } from '../lib/printability.ts';
import { newProject, parseProject, serializeProject, snapshotJourney, restoreProjectJourney, PROJECT_SCHEMA, PREVIOUS_PROJECT_SCHEMA } from '../lib/project.ts';
import { addProjectVersion, restoreProjectVersion, compareProjectSnapshots } from '../lib/projectVersions.ts';
import { initialJourney, transitionJourney } from '../lib/journey.ts';

const origin = { origin: 'Контрольные исходные данные', evidence: { source: 'user_confirmation' } };
const draft = (): ManufacturingDraft => ({ ...emptyManufacturingDraft(), enabled: true, purpose: 'working', process: 'fdm',
  quantity: '12', material: 'PA12 / согласовать марку', application: 'Передача контрольного механизма', operatingConditions: '20 об/мин; нагрузку уточнить',
  matingPart: 'Вал 8 мм, контроль посадки на образце', notes: 'Сначала изготовить одну пробную деталь',
  tolerances: [{ dimension: 'bore', lower: '+0,01', upper: '+0,03' }, { dimension: 'width', lower: '−0,1', upper: '+0.1' }] });

test('optional requirements start empty and never infer a material, tolerance or approval', () => {
  const mesh = buildModelMesh(defaultModel()), empty = emptyManufacturingDraft();
  assert.equal(manufacturingReport(mesh), null); assert.equal(manufacturingReport(mesh, empty), null);
  assert.equal(empty.material, ''); assert.deepEqual(empty.tolerances, []);
  assert.throws(() => reviewManufacturing(mesh, empty), /включите/);
  const pending = manufacturingReport(mesh, { ...empty, enabled: true })!;
  assert.equal(pending.status, 'draft'); assert.equal(pending.request.quantity, 1);
  assert.ok(pending.issues.some(s => s.includes('назначение')));
  assert.ok(pending.clarifications.includes('Марка материала'));
});

test('signed decimal deviations define independent finished-part limits without changing the STL', () => {
  const input = defaultModel(), mesh = buildModelMesh(input), requirements = reviewManufacturing(mesh, draft());
  const report = manufacturingReport(mesh, requirements)!;
  assert.equal(report.status, 'reviewed');
  assert.deepEqual(report.dimensions.map(row => [row.minimum, row.maximum]), [[8.01, 8.03], [9.9, 10.1]]);
  const plain = prepareModelExport(input, 'pro', origin), withRequirements = prepareModelExport(input, 'pro', { ...origin, manufacturing: requirements });
  assert.deepEqual(new Uint8Array(plain.stl), new Uint8Array(withRequirements.stl));
  assert.deepEqual(withRequirements.passport.manufacturing, report);
  assert.equal(withRequirements.passport.parameters.bore, 8);
  assert.match(report.source, /not-inferred-from-photo/);
});

test('binding detects changed geometry, app release and edited requirements while ignoring object-key order', () => {
  const mesh = buildModelMesh(defaultModel()), checked = reviewManufacturing(mesh, draft(), '2026-09-28T14:00:00.000Z');
  const wider = buildModelMesh({ ...defaultModel(), width: 12 });
  const stale = manufacturingReport(wider, checked)!;
  assert.equal(stale.status, 'needs-review'); assert.equal(stale.review?.matchesModel, false);
  assert.equal(stale.dimensions[1].minimum, 11.9);
  assert.equal(manufacturingReport(mesh, { ...checked, quantity: '13' })!.status, 'needs-review');
  assert.equal(manufacturingReport(mesh, { ...checked, review: { ...checked.review!, modelKey: checked.review!.modelKey.replace(/"appVersion":"[^"]+"/, '"appVersion":"0.1.0"') } })!.status, 'needs-review');
  const reordered = structuredClone(mesh); reordered.params = Object.fromEntries(Object.entries(mesh.params).reverse()) as typeof mesh.params;
  assert.equal(manufacturingReport(reordered, checked)!.status, 'reviewed');
  assert.equal(manufacturingReport(wider, reviewManufacturing(wider, checked))!.status, 'reviewed');
  assert.equal(manufacturingReport(mesh, { ...checked, enabled: false }), null);
});

test('nominal dimension choices follow all ten tooth systems and remain stable across quality presets', () => {
  for (const kind of Object.keys(modelNames) as ModelKind[]) {
    const mesh = buildModelMesh(defaultModel(kind)), options = manufacturingDimensions(mesh);
    assert.equal(options.find(row => row.id === 'width')?.nominal, mesh.params.width);
    assert.equal(options.some(row => row.id === 'bore'), !['internal', 'internal-helical', 'rack', 'helical-rack'].includes(kind));
    if (kind.includes('rack')) { assert.equal(options.find(row => row.id === 'rackLength')?.nominal, mesh.dimensions.rackLength); assert.ok(!options.some(row => row.id === 'tipDiameter')); }
    if (kind === 'bevel') assert.match(options.find(row => row.id === 'width')!.label, /образующей/);
    if (kind === 'worm') assert.match(options.find(row => row.id === 'width')!.label, /оси/);
    const checked = reviewManufacturing(mesh, { ...draft(), tolerances: [{ dimension: 'width', lower: '-0.05', upper: '0.05' }] });
    for (const preset of ['standard', 'pro'] as const) assert.equal(prepareModelExport(defaultModel(kind), preset, { ...origin, manufacturing: checked }).passport.manufacturing!.status, 'reviewed', `${kind}/${preset}`);
  }
});

test('invalid or inapplicable limits remain editable drafts and cannot acquire a review', () => {
  const mesh = buildModelMesh(defaultModel());
  for (const [lower, upper] of [['0', '0'], ['.2', '.1'], ['−', '.1'], ['0.0000001', '0.1'], ['-8', '0.1'], ['1e3', '2e3'], ['NaN', 'Infinity']]) {
    const data = { ...draft(), tolerances: [{ dimension: 'bore' as const, lower, upper }] };
    assert.ok(manufacturingReport(mesh, data)!.issues.length, `${lower}/${upper}`);
    assert.throws(() => reviewManufacturing(mesh, data));
    assert.deepEqual(manufacturingDraftSchema.parse(data).tolerances, data.tolerances);
  }
  const double = { ...draft(), tolerances: [draft().tolerances[0], draft().tolerances[0]] };
  assert.match(manufacturingReport(mesh, double)!.issues.join(' '), /дважды/);
  for (const quantity of ['0', '-1', '1.5', 'NaN', '10001']) assert.throws(() => reviewManufacturing(mesh, { ...draft(), quantity }), /Количество/);
  const withoutHole = buildModelMesh({ ...defaultModel(), bore: 0 }), checked = reviewManufacturing(mesh, draft());
  const missing = manufacturingReport(withoutHole, checked)!;
  assert.equal(missing.status, 'needs-review'); assert.equal(missing.dimensions[0].nominal, null);
  assert.match(missing.issues.join(' '), /отсутствует/);
  assert.throws(() => manufacturingDraftSchema.parse({ ...draft(), unknown: 'bad' }));
  assert.throws(() => manufacturingDraftSchema.parse({ ...draft(), material: 'A'.repeat(121) }));
});

test('requirements survive portable project/history restoration for both photo and manual models', () => {
  for (const mode of ['manual', 'photo'] as const) {
    let state = transitionJourney(initialJourney(), { type: 'choose-input', mode });
    state = transitionJourney(state, { type: 'build', params: defaultModel(), ...origin });
    assert.ok(state.built);
    const checked = reviewManufacturing(state.built.mesh, draft());
    let doc = newProject(); doc.journey = snapshotJourney(state); doc.forms.manufacturing = { identity: 'default', values: { draft: checked } };
    doc = addProjectVersion(doc, 'Проверенные требования');
    doc.forms.manufacturing.values.draft = { ...checked, quantity: '25', tolerances: [{ dimension: 'bore', lower: '−', upper: '' }] };
    assert.equal(compareProjectSnapshots(doc.versions[0], doc).manufacturingChanged, true);
    const portable = parseProject(serializeProject(doc)); assert.equal(portable.schema, PROJECT_SCHEMA);
    assert.equal((portable.forms.manufacturing.values.draft as ManufacturingDraft).tolerances[0].lower, '−');
    const restored = restoreProjectVersion(portable, portable.versions[0].id), current = restoreProjectJourney(restored);
    assert.equal(current.stage, 'review'); assert.equal(current.confirmedRevision, null);
    const restoredRequirements = restored.forms.manufacturing.values.draft as ManufacturingDraft;
    assert.equal(manufacturingReport(current.built!.mesh, restoredRequirements)!.status, 'reviewed');
    assert.equal(restoredRequirements.quantity, '12');
  }
});

test('v3 migrates intact, but a downgraded document cannot hide manufacturing data in current or historical forms', () => {
  const doc = addProjectVersion(newProject(), 'Старая версия');
  const wire = JSON.parse(serializeProject(doc)); wire.schema = PREVIOUS_PROJECT_SCHEMA; wire.appVersion = '0.24.0';
  assert.equal(parseProject(JSON.stringify(wire)).versions.length, 1);
  assert.equal(parseProject(JSON.stringify(wire)).schema, PROJECT_SCHEMA);
  wire.versions[0].forms.manufacturing = { identity: 'default', values: { draft: draft() } };
  assert.throws(() => parseProject(JSON.stringify(wire)), /требуют v4/);
  delete wire.versions[0].forms.manufacturing; wire.forms.manufacturing = { identity: 'default', values: { draft: draft() } };
  assert.throws(() => parseProject(JSON.stringify(wire)), /требуют v4/);
});

test('FDM settings never overwrite requested material/process and disagreements are in the print brief', () => {
  const mesh = buildModelMesh(defaultModel()), checked = reviewManufacturing(mesh, { ...draft(), process: 'machining', material: 'Сталь 40Х' });
  const report = manufacturingReport(mesh, checked)!;
  const notes = manufacturingPrintNotes(report, 'PLA');
  assert.equal(notes.length, 2); assert.match(notes.join(' '), /Механическая обработка/); assert.match(notes.join(' '), /Сталь 40Х/);
  const brief = createPrintBrief(mesh, validateMesh(mesh), defaultPrintSettings, { ...origin, manufacturing: checked });
  assert.equal(brief.schema, 'zatseplenie.print-brief.v7'); assert.deepEqual(brief.manufacturing, report);
  assert.equal(brief.settings.material, defaultPrintSettings.material); assert.equal(brief.manufacturing?.request.material, 'Сталь 40Х');
  assert.equal(brief.manufacturingNotes.length, 2);
});
