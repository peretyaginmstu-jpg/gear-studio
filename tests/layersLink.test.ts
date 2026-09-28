import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelMesh, defaultModel } from '../lib/model.ts';
import { emptyManufacturingDraft, reviewManufacturing } from '../lib/manufacturing.ts';
import { sampleInspectionSchema } from '../lib/sampleInspection.ts';
import { draftStatus, inspectionFromLayers, layersFormSchema, materialAdvice, type LayersMaterial } from '../lib/layersLink.ts';
import { newProject, parseProject, serializeProject } from '../lib/project.ts';

const pa: LayersMaterial = { key: 'PA-CF', label: 'PA-CF (нейлон)', price_per_gram: 18, density: 1.15, thinning_mm: .15, min_module_mm: 1, shrinkage_pct: .8, max_temp_c: 120, note: 'Сушка обязательна.' };

test('material advice proposes thinning and flags small modules', () => {
  const a = materialAdvice({ ...defaultModel('spur'), backlash: .08, module: .8 }, pa);
  assert.equal(a.thinning, .15);
  assert.ok(a.notes.some(n => n.includes('меньше рекомендуемого')));
  assert.ok(a.notes.some(n => n.includes('Усадка около 0.8%')));
  assert.equal(materialAdvice({ ...defaultModel('spur'), backlash: .2 }, pa).thinning, null);
});

test('workshop measurements become a valid sample inspection against reviewed limits', () => {
  const params = { ...defaultModel('spur'), bore: 12 }, mesh = buildModelMesh(params);
  const draft = { ...emptyManufacturingDraft(), enabled: true, purpose: 'working' as const, process: 'fdm' as const,
    tolerances: [{ dimension: 'tipDiameter' as const, lower: '-0.1', upper: '0' }, { dimension: 'bore' as const, lower: '0', upper: '0.05' }] };
  const reviewed = reviewManufacturing(mesh, draft);
  const record = inspectionFromLayers(mesh, reviewed, 'LP-ABC123', { id: 'm1', sample: 'Шт. 1', measured_on: '2026-10-02', operator: 'Никита',
    instrument: 'Микрометр', conditions: '', notes: '', readings: [{ dimension: 'tipDiameter', label: 'Диаметр вершин', values: '51.95 51.96', uncertainty: '0.005' }] });
  assert.ok(sampleInspectionSchema.safeParse(record).success);
  assert.equal(record.sample, 'Шт. 1 · LP-ABC123');
  assert.deepEqual(Object.fromEntries(record.readings.map(r => [r.dimension, r.values])), { tipDiameter: '51.95 51.96', bore: '' });
  assert.throws(() => inspectionFromLayers(mesh, reviewed, 'LP-1', { id: 'm2', sample: '', measured_on: '', operator: '', instrument: '', conditions: '', notes: '',
    readings: [{ dimension: 'width', label: 'Ширина', values: '10', uncertainty: '' }] }), /нет размеров/);
});

test('project files keep Layers links and reject malformed tokens', () => {
  const doc = newProject();
  const link = { token: 'a'.repeat(43), orderUrl: 'https://layers.test/order/gear#' + 'a'.repeat(43), sentAt: new Date().toISOString(), revision: 2,
    stlSha256: 'f'.repeat(64), title: 'Прямозубое колесо z=24 m=2', kind: 'order' as const, orderCode: 'LP-ABC123', importedMeasurements: [] };
  doc.forms.layers = { identity: 'default', values: { links: [link], revisionTarget: null } };
  assert.deepEqual(parseProject(serializeProject(doc)).forms.layers?.values.links, [link]);
  assert.equal(layersFormSchema.safeParse({ links: [{ ...link, token: 'bad token' }] }).success, false);
});

test('token calls refuse to run without a configured Layers address', async () => {
  await assert.rejects(draftStatus('a'.repeat(43)), /не настроен/);
});
