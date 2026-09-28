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
