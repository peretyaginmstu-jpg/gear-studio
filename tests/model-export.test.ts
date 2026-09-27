import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelMesh, defaultModel, modelNames, type ModelKind } from '../lib/model.ts';
import { validateMesh } from '../lib/gearMath.ts';
import { createModelPassport, prepareModelExport, type ExportPreset } from '../lib/modelExport.ts';

const provenance = {
  origin: 'Параметры подтверждены пользователем по фото',
  evidence: { originalFile: 'sample.png', independentlyConfirmedByUser: true, module: { source: 'reference-and-tip-circle' } },
};

for (const kind of Object.keys(modelNames) as ModelKind[]) {
  test(`${kind}: Standard and Pro STL agree with their own passports and preserve the analytical inputs`, () => {
    const input = defaultModel(kind), original = structuredClone(input), originalEvidence = structuredClone(provenance);
    const standard = prepareModelExport(input, 'standard', provenance);
    const pro = prepareModelExport(input, 'pro', provenance);
    for (const [preset, prepared] of [['standard', standard], ['pro', pro]] as const) {
      const { mesh, validation, stl } = prepared;
      // Parse the delivered JSON and the binary STL independently of mesh indices.
      const passport = JSON.parse(JSON.stringify(prepared.passport));
      const triangleCount = new DataView(stl).getUint32(80, true);
      assert.equal(stl.byteLength, 84 + 50 * triangleCount);
      assert.ok(triangleCount > 0);
      assert.equal(passport.artifact.triangles, triangleCount);
      assert.equal(passport.meshValidation.triangles, triangleCount);
      assert.equal(passport.artifact.vertices, mesh.positions.length / 3);
      assert.equal(passport.artifact.purpose, 'STL-export');
      assert.equal(passport.artifact.preset, preset);
      assert.equal(passport.artifact.requestedQuality.flankSamples, preset === 'standard' ? 12 : 32);
      assert.deepEqual(passport.artifact.actualTessellation, mesh.tessellation);
      assert.equal(passport.schema, 'zatseplenie.gear.v6');
      assert.equal(passport.units, 'mm');
      assert.equal(passport.origin, provenance.origin);
      assert.deepEqual(passport.evidence, provenance.evidence);
      assert.deepEqual(passport.parameters, mesh.params);
      assert.equal(validation.valid, true);
      assert.equal(validation.boundaryEdges + validation.nonManifoldEdges + validation.inconsistentEdges, 0);
      assert.ok(validation.signedVolume > 0);
      assert.ok(passport.notVerified.includes('Точность изготовления'));
    }
    assert.deepEqual(input, original);
    assert.deepEqual(provenance, originalEvidence);
    assert.deepEqual(standard.mesh.params, pro.mesh.params);
    assert.deepEqual(standard.passport.dimensions, pro.passport.dimensions);
    assert.ok(pro.validation.triangles >= standard.validation.triangles);
    // Exact linear faces and tolerance-dominated worm sampling need no extra triangles.
    if (kind === 'rack' || kind === 'helical-rack' || kind === 'worm') {
      assert.equal(pro.validation.triangles, standard.validation.triangles);
    } else {
      assert.ok(pro.validation.triangles > standard.validation.triangles);
    }
  });
}

test('a current-model passport is explicitly distinct from the Pro export passport', () => {
  const input = defaultModel(), preview = buildModelMesh(input);
  const current = createModelPassport(preview, validateMesh(preview), provenance);
  const exported = prepareModelExport(input, 'pro', provenance).passport;
  assert.equal(current.artifact.purpose, 'current-preview-model');
  assert.equal(current.artifact.preset, null);
  assert.equal(current.artifact.requestedQuality, null);
  assert.equal(current.artifact.triangles, preview.indices.length / 3);
  assert.notEqual(current.artifact.triangles, exported.artifact.triangles);
});

test('internal STL passport preserves the assumed cutter, true root/join, tolerance and photo provenance separately', () => {
  const prepared = prepareModelExport({ ...defaultModel('internal'), internalCutterThinning: .03 }, 'pro', provenance);
  const report = JSON.parse(JSON.stringify(prepared.passport)), g = report.internalCutterGeometry;
  assert.equal(g.tool.teeth, 24); assert.equal(g.tool.thinning, .03);
  assert.equal(g.tool.provenance, 'specified-or-assumed; not-inferred-from-photo');
  assert.equal(report.rootDiagnostics, null); assert.equal(report.internalRootDiagnostics.method, 'circular-pinion-cutter-envelope');
  assert.equal(report.dimensions.rootDiameter, g.rootRadius * 2);
  assert.equal(report.internalRootDiagnostics.joinRadius, g.joinRadius);
  assert.ok(report.internalRootDiagnostics.maxChordErrorBound <= report.internalRootDiagnostics.profileTolerance);
  assert.ok(g.lowerToolClosure.coreRadius <= g.lowerToolClosure.maximumNonInterferingCoreRadius);
  assert.equal(report.dimensions.minimumProfileShift, null); assert.equal(report.dimensions.virtualTeeth, null);
  assert.deepEqual(report.evidence, provenance.evidence);
  assert.equal(report.parameters.internalCutterThinning, .03);
});

test('export presets cannot bypass kernel limits or accept an unknown quality key', () => {
  assert.throws(() => prepareModelExport(defaultModel(), 'ultra' as ExportPreset, provenance), /Неизвестная детализация/);
  const invalidBevel = { ...defaultModel('bevel'), teeth: 24, bevelMateTeeth: 24 };
  for (const preset of ['standard', 'pro'] as const) {
    assert.throws(() => prepareModelExport(invalidBevel, preset, provenance), { code: 'BEVEL_ROOT_BELOW_BASE' });
    assert.throws(() => prepareModelExport({ ...defaultModel(), bore: 1000 }, preset, provenance));
  }
});
