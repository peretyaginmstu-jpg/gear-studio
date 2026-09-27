import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMesh } from '../lib/gearMath.ts';
import { buildModelMesh, defaultModel, isHelicalKind, modelDimensionsForReport, modelNames, modelSpatialGeometryForReport } from '../lib/model.ts';
import type { ModelKind } from '../lib/model.ts';
import { assessPrint, defaultPrintSettings } from '../lib/printability.ts';
import { analyzeGearPair } from '../lib/pairAnalysis.ts';

test('all ten model defaults dispatch without leaking another family’s parameters', () => {
  const kinds = Object.keys(modelNames) as ModelKind[];
  assert.equal(kinds.length, 10);
  for (const kind of kinds) {
    const params = defaultModel(kind);
    assert.equal(params.helixAngleDeg, isHelicalKind(kind) ? 20 : 0, kind);
    const mesh = buildModelMesh({ ...params, bevelMateTeeth: 40, bevelShaftAngleDeg: 90, cycloidRollingRadius: 4 });
    assert.equal(mesh.params.kind, kind); assert.ok(validateMesh(mesh).valid, kind);
    if (kind !== 'bevel') { assert.equal('bevelMateTeeth' in mesh.params, false); assert.equal('bevelShaftAngleDeg' in mesh.params, false); }
    if (kind !== 'worm') { assert.equal('wormHand' in mesh.params, false); assert.equal('wormStarts' in mesh.params, false); }
    if (kind !== 'cycloidal') assert.equal('cycloidRollingRadius' in mesh.params, false);
  }
});

test('bevel adapter preserves its cone inputs and exposes true spatial ends in reports', () => {
  const params = defaultModel('bevel'); assert.equal(params.teeth, 40); assert.equal(params.bevelMateTeeth, 40);
  const mesh = buildModelMesh({ ...params, bevelMateTeeth: 80, bevelShaftAngleDeg: 90 });
  assert.ok('bevelDimensions' in mesh);
  assert.equal(mesh.bevelDimensions.mateTeeth, 80);
  assert.ok(Math.abs(mesh.bevelDimensions.pitchConeAngleDeg - 26.56505117707799) < 1e-10);
  const report = modelDimensionsForReport(mesh), spatial = modelSpatialGeometryForReport(mesh);
  assert.equal(report.baseDiameter, null); assert.equal(report.basePitch, null); assert.equal(report.virtualTeeth, null);
  assert.equal(report.normalPressureAngleDeg, 20); assert.equal(report.width, params.width);
  assert.ok(spatial); assert.deepEqual(spatial.sourceToWorld, mesh.bevelDimensions.sourceToWorld);
  assert.equal(spatial.outerEndContour.length, mesh.profile.outer.length); assert.equal(spatial.innerEndContour.length, mesh.profile.outer.length);
  assert.ok(spatial.outerEndContour.some(v => Math.abs(v.z - spatial.outerEndContour[0].z) > 1));
  assert.ok(spatial.innerEndContour.every(v => v.z >= 0));
  assert.equal(modelSpatialGeometryForReport(buildModelMesh(defaultModel('spur'))), null);
  assert.throws(() => buildModelMesh({ ...params, helixAngleDeg: 20 }), { code: 'BEVEL_HELIX' });
  assert.throws(() => buildModelMesh({ ...params, teeth: 24, bevelMateTeeth: 24 }), { code: 'BEVEL_ROOT_BELOW_BASE' });
});

test('bevel print check rejects a small-end tooth even when the outer tooth fits two extrusion lines', () => {
  const mesh = buildModelMesh({ ...defaultModel('bevel'), width: 40, bore: 20 });
  assert.ok('bevelDimensions' in mesh);
  assert.ok(mesh.dimensions.tipThickness > 2 * defaultPrintSettings.lineWidth);
  assert.ok(mesh.bevelDimensions.innerTipChordThickness < defaultPrintSettings.lineWidth);
  const report = assessPrint(mesh, validateMesh(mesh), defaultPrintSettings);
  assert.equal(report.checks.find(check => check.id === 'tip')?.status, 'fail');
  assert.equal(report.status, 'fail');
  assert.ok(Math.abs(report.size[2] - mesh.bevelDimensions.axialExtent) < 2e-6);
  assert.ok(Math.abs(report.size[2] - mesh.params.width) > 5);
});

test('bevel bore wall uses the small root and the physical axial envelope controls the bed check', () => {
  const mesh = buildModelMesh({ ...defaultModel('bevel'), width: 35, bore: 28 });
  assert.ok('bevelDimensions' in mesh);
  assert.ok((mesh.dimensions.rootDiameter - mesh.params.bore) / 2 > 20);
  assert.ok(mesh.bevelDimensions.minimumRadialBoreWall < 2 * defaultPrintSettings.lineWidth);
  const normal = assessPrint(mesh, validateMesh(mesh), defaultPrintSettings);
  assert.equal(normal.checks.find(check => check.id === 'wall')?.status, 'warning');
  const tooShort = assessPrint(mesh, validateMesh(mesh), { ...defaultPrintSettings, bedZ: mesh.bevelDimensions.axialExtent - 0.1 });
  assert.equal(tooShort.checks.find(check => check.id === 'bed')?.status, 'fail');
});

test('bevel never enters the cylindrical pair solver or receives calculated pair dimensions', () => {
  const bevel = defaultModel('bevel'), spur = defaultModel('spur');
  for (const [first, second] of [[bevel, spur], [spur, bevel], [bevel, bevel]]) {
    const report = analyzeGearPair({ first, second });
    assert.equal(report.status, 'unsupported'); assert.equal(report.family, 'unsupported');
    assert.ok(Object.values(report.dimensions).every(value => value === null));
    assert.match(report.checks[0].detail, /конического/);
  }
});
