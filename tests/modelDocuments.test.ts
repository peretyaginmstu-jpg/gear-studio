import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { unzipSync, strFromU8 } from 'fflate';
import { defaultModel, modelNames, type ModelKind } from '../lib/model.ts';
import { prepareModelExport } from '../lib/modelExport.ts';
import { inspectDocumentSTL, modelDocumentInput, modelNominalRows, projectSTLSilhouette } from '../lib/modelDocumentData.ts';
import { createModelDocuments } from '../lib/modelDocuments.ts';
import { emptyManufacturingDraft, reviewManufacturing } from '../lib/manufacturing.ts';
import { newSampleInspection, recordSampleInspection, copySampleInspection } from '../lib/sampleInspection.ts';

const fonts = { regular: readFileSync(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url)), bold: readFileSync(new URL('../public/fonts/NotoSans-Bold.ttf', import.meta.url)) };
const provenance = { origin: 'Контрольный образец по фото', evidence: { measurement: 52, confirmedByUser: true, note: 'Полное происхождение остаётся в JSON' } };
const hash = (data: Uint8Array | ArrayBuffer) => createHash('sha256').update(new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer, data instanceof ArrayBuffer ? 0 : data.byteOffset, data instanceof ArrayBuffer ? data.byteLength : data.byteLength)).digest('hex');

for (const kind of Object.keys(modelNames) as ModelKind[]) test(`${kind}: both document bundles preserve the delivered STL, passport, bounds and identity`, async () => {
  for (const preset of ['standard', 'pro'] as const) {
    const prepared = prepareModelExport(defaultModel(kind), preset, provenance), filename = `${kind}-${preset}.stl`;
    const input = modelDocumentInput(prepared, filename, `Заказ 024 / ${kind}`), before = new Uint8Array(prepared.stl).slice();
    const { bounds, triangles } = inspectDocumentSTL(prepared.stl);
    // Independently inspect the kernel's Float32 positions against the delivered-file reader.
    for (let axis = 0; axis < 3; axis++) {
      const values = Array.from(prepared.mesh.positions).filter((_, index) => index % 3 === axis);
      assert.equal(bounds.min[axis], values.reduce((a, b) => Math.min(a, b), Infinity));
      assert.equal(bounds.max[axis], values.reduce((a, b) => Math.max(a, b), -Infinity));
    }
    assert.equal(triangles, prepared.validation.triangles);
    for (const plane of ['XY', 'XZ', 'YZ'] as const) {
      const projected = projectSTLSilhouette(prepared.stl, plane, bounds, 180, 142);
      assert.ok(projected.path.length > 10 && !/NaN|Infinity/.test(projected.path));
      for (const match of projected.path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) {
        assert.ok(+match[1] >= -.0001 && +match[1] <= projected.width + .0001);
        assert.ok(+match[2] >= -.0001 && +match[2] <= projected.height + .0001);
      }
    }
    const bundle = await createModelDocuments(input, fonts, '2026-09-28T12:00:00.000Z');
    const files = unzipSync(bundle.zip), manifest = JSON.parse(strFromU8(files['manifest.json']));
    assert.equal(Object.keys(files).length, 5);
    assert.deepEqual(files[filename], before);
    assert.equal(strFromU8(files[`${kind}-${preset}-passport.json`]), input.passport);
    assert.deepEqual(JSON.parse(strFromU8(files[`${kind}-${preset}-passport.json`])).evidence, provenance.evidence);
    assert.deepEqual(manifest.stlBounds, bounds); assert.equal(manifest.projectName, input.projectName);
    for (const item of manifest.files) { assert.equal(hash(files[item.name]), item.sha256); assert.equal(files[item.name].byteLength, item.bytes); }
    assert.deepEqual(files[bundle.pdfName], bundle.pdf);
    const pdf = await PDFDocument.load(bundle.pdf);
    assert.ok(pdf.getPageCount() >= 3); assert.equal(pdf.getPageCount(), bundle.pages);
    assert.equal(pdf.getTitle(), `${input.projectName} - размерный лист`);
    assert.equal(pdf.getSubject(), `STL ${filename}; SHA-256 ${hash(before)}`);
    assert.deepEqual(new Uint8Array(prepared.stl), before);
    assert.ok(strFromU8(files['README.txt']).includes('миллиметрах'));
  }
});

test('nominal rows distinguish rack section length, bevel generator width and inapplicable tooth-system quantities', () => {
  const rack = prepareModelExport(defaultModel('helical-rack'), 'standard', provenance);
  const b = inspectDocumentSTL(rack.stl).bounds;
  assert.ok(Math.abs(b.size[0] - (rack.mesh.dimensions.rackLength + Math.abs(rack.mesh.dimensions.rackAxialOffset))) < 1e-4);
  assert.ok(b.size[0] > rack.mesh.dimensions.rackLength);
  assert.ok(!modelNominalRows(rack.mesh).some(row => /диаметр/.test(row.label)));
  const bevel = prepareModelExport(defaultModel('bevel'), 'standard', provenance);
  assert.notEqual(inspectDocumentSTL(bevel.stl).bounds.size[2], bevel.mesh.params.width);
  assert.equal(modelNominalRows(bevel.mesh).find(row => row.label === 'Ширина по образующей b')?.value, bevel.mesh.params.width);
  const worm = prepareModelExport({ ...defaultModel('worm'), teeth: 120, wormStarts: 2, wormHand: 'left' }, 'standard', provenance);
  const wormRows = modelNominalRows(worm.mesh);
  assert.ok(!wormRows.some(row => row.label === 'Число зубьев z'));
  assert.equal(wormRows.find(row => row.label === 'Число заходов')?.value, 2);
  assert.equal(wormRows.find(row => row.label === 'Направление')?.value, 'Левое');
  const cycloid = prepareModelExport(defaultModel('cycloidal'), 'standard', provenance);
  assert.equal(modelNominalRows(cycloid.mesh).find(row => row.label === 'Постоянный угол профиля')?.value, 'Не применим');
});

function covers(path: string, x: number, y: number): boolean {
  return path.split('Z').filter(Boolean).some(triangle => {
    const p = [...triangle.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(match => [+match[1], +match[2]]);
    const cross = p.map((a, i) => { const b = p[(i + 1) % 3]; return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); });
    return cross.every(v => v >= -1e-8) || cross.every(v => v <= 1e-8);
  });
}
test('axial silhouettes retain the through bore and the opening of an internal wheel', () => {
  for (const kind of ['spur', 'internal'] as const) {
    const prepared = prepareModelExport({ ...defaultModel(kind), bore: 8 }, 'standard', provenance), { bounds } = inspectDocumentSTL(prepared.stl);
    const projected = projectSTLSilhouette(prepared.stl, 'XY', bounds, 180, 142);
    const point = (x: number, y: number) => [(x - bounds.min[0]) * projected.scale, (bounds.max[1] - y) * projected.scale];
    const center = point(0, 0), material = point(kind === 'spur' ? 10 : (prepared.mesh.dimensions.outsideDiameter / 2 - 1), 0);
    assert.equal(covers(projected.path, center[0], center[1]), false);
    assert.equal(covers(projected.path, material[0], material[1]), true);
    assert.equal(covers(projected.path, -1000, -1000), false);
  }
});

test('malformed STL and mismatched passports cannot become an apparently valid document package', async () => {
  const prepared = prepareModelExport(defaultModel(), 'standard', provenance), input = modelDocumentInput(prepared, 'part.stl', 'Деталь');
  assert.throws(() => inspectDocumentSTL(new ArrayBuffer(10)), /короткий/);
  assert.throws(() => inspectDocumentSTL(prepared.stl.slice(0, -1)), /не соответствует/);
  const nan = prepared.stl.slice(0); new DataView(nan).setFloat32(96, NaN, true);
  assert.throws(() => inspectDocumentSTL(nan), /недопустимые/);
  await assert.rejects(createModelDocuments({ ...input, filename: '../part.stl' }, fonts), /имя или дату/);
  const wrong = JSON.parse(input.passport); wrong.artifact.triangles++;
  await assert.rejects(createModelDocuments({ ...input, passport: JSON.stringify(wrong) }, fonts), /Паспорт не соответствует/);
});

test('long Cyrillic names and unsupported glyphs remain identifiable without breaking PDF generation', async () => {
  const prepared = prepareModelExport(defaultModel(), 'standard', { ...provenance, origin: 'Замер '.repeat(500) });
  const name = '⚙️ '.repeat(10) + 'Деталь_без_пробелов_'.repeat(4);
  const input = modelDocumentInput(prepared, 'unicode.stl', name), bundle = await createModelDocuments(input, fonts);
  const pdf = await PDFDocument.load(bundle.pdf), files = unzipSync(bundle.zip);
  assert.equal(pdf.getTitle(), `${name} - размерный лист`);
  assert.equal(JSON.parse(strFromU8(files['manifest.json'])).projectName, name);
  assert.equal(JSON.parse(strFromU8(files['unicode-passport.json'])).origin, 'Замер '.repeat(500));
  assert.ok(pdf.getPageCount() >= 4);
});

test('reviewed requirements enter the same PDF/passport bundle and remain visibly stale after model edits', async () => {
  const source = prepareModelExport(defaultModel(), 'standard', provenance);
  const manufacturing = reviewManufacturing(source.mesh, { ...emptyManufacturingDraft(), enabled: true, purpose: 'working', quantity: '12', material: 'PA12',
    tolerances: [{ dimension: 'bore', lower: '+0,01', upper: '+0,03' }], notes: 'Контрольный образец; сначала проверить посадку.' });
  for (const width of [10, 12]) {
    const prepared = prepareModelExport({ ...defaultModel(), width }, 'standard', { ...provenance, manufacturing });
    const input = modelDocumentInput(prepared, 'requirements.stl', 'Карточка мастерской');
    const bundle = await createModelDocuments(input, fonts), files = unzipSync(bundle.zip), passport = JSON.parse(strFromU8(files['requirements-passport.json']));
    assert.equal(passport.manufacturing.status, width === 10 ? 'reviewed' : 'needs-review');
    assert.deepEqual(passport.manufacturing, input.manufacturing);
    assert.equal(passport.manufacturing.dimensions[0].minimum, 8.01);
    assert.ok(bundle.pages >= 4); assert.equal(bundle.pages, (await PDFDocument.load(bundle.pdf)).getPageCount());
    assert.deepEqual(files['requirements.stl'], new Uint8Array(prepared.stl));
  }
  const prepared = prepareModelExport(defaultModel(), 'standard', { ...provenance, manufacturing }), input = modelDocumentInput(prepared, 'requirements.stl', 'Деталь');
  input.manufacturing!.request.material = 'Изменён только PDF';
  await assert.rejects(createModelDocuments(input, fonts), /Требования.*не соответствуют/);
});

test('long manufacturing notes and unfinished signed inputs preserve their draft and paginate', async () => {
  const manufacturing = { ...emptyManufacturingDraft(), enabled: true, purpose: 'prototype' as const, quantity: '', material: 'Специальный материал',
    notes: 'Сначала согласовать измерения и технологию. '.repeat(22), tolerances: [{ dimension: 'bore' as const, lower: '−', upper: '' }] };
  const prepared = prepareModelExport(defaultModel(), 'standard', { ...provenance, manufacturing }), input = modelDocumentInput(prepared, 'draft.stl', 'Черновик мастерской');
  const bundle = await createModelDocuments(input, fonts), files = unzipSync(bundle.zip);
  const requirements = JSON.parse(strFromU8(files['draft-passport.json'])).manufacturing;
  assert.equal(requirements.status, 'draft'); assert.equal(requirements.request.quantity, null);
  assert.equal(requirements.dimensions[0].lowerInput, '−'); assert.equal(requirements.dimensions[0].minimum, null);
  assert.ok(bundle.pages >= 5);
});

test('current and historical sample records enter PDF/ZIP unchanged and cannot be substituted independently', async () => {
  const base = prepareModelExport(defaultModel(), 'standard', provenance);
  const manufacturing = reviewManufacturing(base.mesh, { ...emptyManufacturingDraft(), enabled: true, purpose: 'prototype', material: 'PETG',
    tolerances: [{ dimension: 'bore', lower: '0.01', upper: '0.03' }] });
  const draft = newSampleInspection(base.mesh, manufacturing); draft.sample = 'Образец 026'; draft.instrument = 'Контрольный прибор';
  draft.readings[0].values = '8,02;8,04'; draft.readings[0].uncertainty = '0,005'; draft.uncertaintyBasis = 'Синтетические данные, k=2';
  const record = recordSampleInspection(draft, base.mesh, manufacturing);
  for (const bore of [8, 9]) {
    const prepared = prepareModelExport({ ...defaultModel(), bore }, 'pro', { ...provenance, manufacturing, inspections: [record] });
    const input = modelDocumentInput(prepared, 'inspection.stl', 'Контроль образца');
    assert.equal(input.inspections[0].reference, bore === 8 ? 'current' : 'historical');
    assert.equal(input.inspections[0].result, 'outside'); assert.equal(input.inspections[0].rows[0].nominal, 8);
    const bundle = await createModelDocuments(input, fonts), files = unzipSync(bundle.zip);
    assert.deepEqual(JSON.parse(strFromU8(files['inspection-passport.json'])).inspections, input.inspections);
    assert.deepEqual(files['inspection.stl'], new Uint8Array(prepared.stl)); assert.deepEqual(files['inspection-dimensions.pdf'], bundle.pdf);
    assert.ok(bundle.pages >= 5);
    input.inspections[0].rows[0].minimum = 0;
    await assert.rejects(createModelDocuments(input, fonts), /Протоколы.*не соответствуют/);
  }
});

test('inspection-only documents retain every draft and frozen limit when current manufacturing is disabled', async () => {
  const base = prepareModelExport(defaultModel(), 'standard', provenance);
  const manufacturing = reviewManufacturing(base.mesh, { ...emptyManufacturingDraft(), enabled: true, purpose: 'prototype',
    tolerances: [{ dimension: 'width', lower: '-0.1', upper: '0.1' }] });
  const first = newSampleInspection(base.mesh, manufacturing); first.sample = 'Длинный черновик'; first.readings[0].values = '10,0;';
  first.notes = 'Согласовать метод измерения, места контроля и неопределённость. '.repeat(15);
  const second = copySampleInspection(first);
  const prepared = prepareModelExport(defaultModel(), 'standard', { ...provenance, manufacturing: { ...manufacturing, enabled: false }, inspections: [first, second] });
  const input = modelDocumentInput(prepared, 'inspection-draft.stl', 'Черновики контроля'), bundle = await createModelDocuments(input, fonts);
  assert.equal(input.manufacturing, null); assert.ok(input.inspections.every(r => r.reference === 'historical' && r.recordState === 'draft'));
  assert.ok(bundle.pages >= 5); assert.equal(bundle.pages, (await PDFDocument.load(bundle.pdf)).getPageCount());
  const passport = JSON.parse(strFromU8(unzipSync(bundle.zip)['inspection-draft-passport.json']));
  assert.equal(passport.inspections[0].rows[0].input, '10,0;'); assert.equal(passport.inspections[1].basedOn, first.id);
});
