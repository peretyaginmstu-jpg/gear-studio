import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultModel, buildModelMesh, modelNames, type ModelKind } from '../lib/model.ts';
import { emptyManufacturingDraft, reviewManufacturing } from '../lib/manufacturing.ts';
import { newSampleInspection, sampleInspectionReport, recordSampleInspection, copySampleInspection, sampleInspectionSchema, sampleInspectionsSchema, MAX_INSPECTIONS } from '../lib/sampleInspection.ts';
import { prepareModelExport } from '../lib/modelExport.ts';
import { createPrintBrief } from '../lib/printBrief.ts';
import { defaultPrintSettings } from '../lib/printability.ts';
import { validateMesh } from '../lib/gearMath.ts';
import { initialJourney, transitionJourney } from '../lib/journey.ts';
import { newProject, parseProject, serializeProject, snapshotJourney, restoreProjectJourney, PROJECT_SCHEMA, PREVIOUS_PROJECT_SCHEMA } from '../lib/project.ts';
import { addProjectVersion, restoreProjectVersion, compareProjectSnapshots } from '../lib/projectVersions.ts';

const now = '2026-09-28T15:00:00.000Z';
const mesh = buildModelMesh(defaultModel());
const requirements = reviewManufacturing(mesh, { ...emptyManufacturingDraft(), enabled: true, purpose: 'prototype', material: 'PETG', process: 'fdm',
  tolerances: [{ dimension: 'bore', lower: '0.01', upper: '0.03' }] }, now);
const draft = () => ({ ...newSampleInspection(mesh, requirements, now), sample: 'Образец 1', instrument: 'Контрольный микрометр; два сечения',
  readings: [{ dimension: 'bore' as const, values: '8,015; 8.020\n8,025', uncertainty: '' }] });
const origin = { origin: 'Synthetic inspection QA', evidence: { source: 'manual' } };

test('inspection starts only with reviewed limits and never invents measured values or uncertainty', () => {
  assert.throws(() => newSampleInspection(mesh, emptyManufacturingDraft()), /Сначала/);
  assert.throws(() => newSampleInspection(mesh, { ...requirements, review: null }), /Сначала/);
  assert.throws(() => newSampleInspection(mesh, reviewManufacturing(mesh, { ...requirements, tolerances: [] })), /Сначала/);
  const record = newSampleInspection(mesh, requirements, now), report = sampleInspectionReport(record, mesh, requirements);
  assert.equal(report.result, 'incomplete'); assert.equal(report.reference, 'current'); assert.equal(report.recordState, 'draft');
  assert.equal(record.readings[0].values, ''); assert.equal(record.readings[0].uncertainty, '');
  assert.equal(report.rows[0].uncertainty, null); assert.deepEqual(report.rows[0].readings, []);
  assert.throws(() => recordSampleInspection(record, mesh, requirements), /образца/);
});

test('each reading is compared independently; an acceptable mean cannot hide an outlier', () => {
  let r = draft(); r.readings[0].values = '8,005;8,035';
  const result = sampleInspectionReport(r, mesh, requirements);
  assert.equal(result.result, 'outside'); assert.deepEqual(result.rows[0].readings.map(v => v.result), ['outside', 'outside']);
  r = draft(); assert.equal(sampleInspectionReport(r, mesh, requirements).result, 'point-only');
  r.readings[0].values = '8,01;8,03';
  assert.equal(sampleInspectionReport(r, mesh, requirements).result, 'point-only');
  r.readings[0].values = '8,030001'; assert.equal(sampleInspectionReport(r, mesh, requirements).result, 'outside');
});

test('explicit uncertainty distinguishes contained, overlapping and disjoint intervals without assuming coverage', () => {
  const r = draft(); r.uncertaintyBasis = 'Синтетическая оценка для теста, k=2'; r.readings[0].uncertainty = '0,005';
  const inside = sampleInspectionReport(r, mesh, requirements); assert.equal(inside.result, 'inside');
  assert.equal(inside.rows[0].readings.length, 3); assert.equal(inside.rows[0].readings[1].low, 8.015);
  r.readings[0].values = '8,010; 8,032'; assert.equal(sampleInspectionReport(r, mesh, requirements).result, 'overlap');
  r.readings[0].values = '8,040'; assert.equal(sampleInspectionReport(r, mesh, requirements).result, 'outside');
  r.readings[0].values = '8,03'; r.readings[0].uncertainty = '0.000001'; assert.equal(sampleInspectionReport(r, mesh, requirements).result, 'overlap');
  r.uncertaintyBasis = ''; assert.equal(sampleInspectionReport(r, mesh, requirements).result, 'incomplete');
});

test('malformed and incomplete input stays in the draft; invalid readings cannot be recorded', () => {
  for (const values of ['', '8,02;', '8,02,8,03', 'NaN', 'Infinity', '-1', '0', '1e1', '1000001', '8.0000001', Array(13).fill('8.02').join(';')]) {
    const r = draft(); r.readings[0].values = values;
    assert.equal(sampleInspectionReport(r, mesh, requirements).result, 'incomplete', values);
    assert.throws(() => recordSampleInspection(r, mesh, requirements));
    assert.equal(sampleInspectionSchema.parse(r).readings[0].values, values);
  }
  for (const u of ['0', '-1', '−', '1e-3', '0.0000001', '1000001']) {
    const r = draft(); r.readings[0].uncertainty = u; r.uncertaintyBasis = 'test';
    assert.equal(sampleInspectionReport(r, mesh, requirements).result, 'incomplete', u);
  }
  for (const measuredOn of ['', '2026-02-30', '2026-13-10', 'yesterday']) {
    assert.throws(() => recordSampleInspection({ ...draft(), measuredOn }, mesh, requirements), /дату/);
    assert.equal(sampleInspectionReport({ ...draft(), measuredOn }, mesh, requirements).result, 'incomplete');
  }
});

test('a recorded snapshot survives key order changes; editing it invalidates the record and copying preserves the original', () => {
  const saved = recordSampleInspection(draft(), mesh, requirements, now);
  assert.equal(sampleInspectionReport(saved, mesh, requirements).recordState, 'recorded');
  const reordered = Object.fromEntries(Object.entries(saved).reverse()) as typeof saved;
  assert.equal(sampleInspectionReport(reordered, mesh, requirements).recordState, 'recorded');
  assert.equal(sampleInspectionReport({ ...saved, notes: 'Changed' }, mesh, requirements).recordState, 'draft');
  const copy = copySampleInspection(saved, now); assert.notEqual(copy.id, saved.id); assert.equal(copy.basedOn, saved.id);
  assert.deepEqual(copy.basis, saved.basis); assert.equal(copy.recorded, null); copy.readings[0].values = '8.1';
  assert.equal(sampleInspectionReport(copy, mesh, requirements).result, 'outside');
  assert.equal(sampleInspectionReport(saved, mesh, requirements).result, 'point-only');
});

test('old limits remain frozen after geometry, requirement, inclusion or version changes', () => {
  const saved = recordSampleInspection(draft(), mesh, requirements, now), before = JSON.stringify(saved);
  const other = buildModelMesh({ ...defaultModel(), bore: 9 });
  const nextRequirements = reviewManufacturing(other, requirements, now);
  const historical = sampleInspectionReport(saved, other, nextRequirements);
  assert.equal(historical.reference, 'historical'); assert.equal(historical.recordState, 'recorded');
  assert.equal(historical.rows[0].minimum, 8.01); assert.equal(historical.result, 'point-only');
  const changed = reviewManufacturing(mesh, { ...requirements, material: 'PA' }, now);
  assert.equal(sampleInspectionReport(saved, mesh, changed).reference, 'historical');
  assert.equal(sampleInspectionReport(saved, mesh, { ...requirements, enabled: false }).reference, 'historical');
  assert.equal(sampleInspectionReport(saved, mesh).reference, 'historical');
  const oldVersion = structuredClone(saved); oldVersion.basis.appVersion = '0.1.0';
  oldVersion.basis.modelKey = oldVersion.basis.modelKey.replace(/"appVersion":"[^"]+"/, '"appVersion":"0.1.0"');
  oldVersion.basis.requirements.review!.modelKey = oldVersion.basis.modelKey;
  assert.equal(sampleInspectionReport(oldVersion, mesh, requirements).reference, 'historical');
  assert.equal(JSON.stringify(saved), before);
});

test('bounded schemas reject missing dimensions, inconsistent references and duplicate records', () => {
  const r = draft();
  assert.throws(() => sampleInspectionSchema.parse({ ...r, readings: [] }));
  assert.throws(() => sampleInspectionSchema.parse({ ...r, readings: [{ dimension: 'width', values: '1', uncertainty: '' }] }));
  assert.throws(() => sampleInspectionSchema.parse({ ...r, basis: { ...r.basis, modelKey: 'fake' } }));
  assert.throws(() => sampleInspectionsSchema.parse([r, r]));
  assert.throws(() => sampleInspectionsSchema.parse(Array.from({ length: MAX_INSPECTIONS + 1 }, () => copySampleInspection(r))));
  assert.throws(() => sampleInspectionSchema.parse({ ...r, sample: 'A'.repeat(121) }));
  const altered = structuredClone(r); altered.basis.limits[0].nominal = 80;
  assert.equal(sampleInspectionReport(altered, mesh, requirements).reference, 'historical');
});

test('all ten families and both STL presets carry the same dimensional observations without changing mesh bytes', () => {
  for (const kind of Object.keys(modelNames) as ModelKind[]) {
    const params = defaultModel(kind), built = buildModelMesh(params);
    const req = reviewManufacturing(built, { ...requirements, tolerances: [{ dimension: 'width', lower: '-0.1', upper: '0.1' }] }, now);
    const r = newSampleInspection(built, req, now); r.sample = kind; r.instrument = 'Synthetic'; r.readings[0].values = String(params.width);
    const saved = recordSampleInspection(r, built, req, now);
    for (const preset of ['standard', 'pro'] as const) {
      const plain = prepareModelExport(params, preset, origin), exported = prepareModelExport(params, preset, { ...origin, manufacturing: req, inspections: [saved] });
      assert.deepEqual(exported.stl, plain.stl); assert.equal(exported.passport.inspections[0].reference, 'current', `${kind}/${preset}`);
      assert.equal(exported.passport.inspections[0].result, 'point-only');
    }
  }
});

test('photo/manual project files, history restoration and print briefs preserve original inspections', () => {
  for (const mode of ['photo', 'manual'] as const) {
    let state = transitionJourney(initialJourney(), { type: 'choose-input', mode });
    state = transitionJourney(state, { type: 'build', params: defaultModel(), ...origin });
    const saved = recordSampleInspection(draft(), mesh, requirements, now);
    let doc = newProject(); doc.journey = snapshotJourney(state);
    doc.forms.manufacturing = { identity: 'default', values: { draft: requirements } };
    doc.forms.inspections = { identity: 'default', values: { records: [saved] } };
    doc = addProjectVersion(doc, 'Контроль образца'); doc.forms.inspections.values.records = [saved, copySampleInspection(saved)];
    assert.equal(compareProjectSnapshots(doc.versions[0], doc).inspectionsChanged, true);
    const portable = parseProject(serializeProject(doc)); assert.equal(portable.schema, PROJECT_SCHEMA);
    const restored = restoreProjectVersion(portable, portable.versions[0].id); assert.equal(restoreProjectJourney(restored).stage, 'review');
    assert.deepEqual(restored.forms.inspections.values.records, [saved]);
    const brief = createPrintBrief(mesh, validateMesh(mesh), defaultPrintSettings, { ...origin, manufacturing: requirements, inspections: [saved] });
    assert.equal(brief.schema, 'zatseplenie.print-brief.v8'); assert.equal(brief.inspections[0].recordState, 'recorded');
  }
});

test('v4 projects migrate with requirements intact; downgraded schemas cannot hide inspection data', () => {
  let doc = newProject(); doc.forms.manufacturing = { identity: 'default', values: { draft: requirements } };
  doc = addProjectVersion(doc, 'v4 requirements');
  const wire = JSON.parse(serializeProject(doc)); wire.schema = PREVIOUS_PROJECT_SCHEMA;
  assert.deepEqual(parseProject(JSON.stringify(wire)).forms.manufacturing, doc.forms.manufacturing);
  wire.versions[0].forms.inspections = { identity: 'default', values: { records: [draft()] } };
  assert.throws(() => parseProject(JSON.stringify(wire)), /требуют v5/);
  delete wire.versions[0].forms.inspections; wire.forms.inspections = { identity: 'default', values: { records: [draft()] } };
  assert.throws(() => parseProject(JSON.stringify(wire)), /требуют v5/);
});
