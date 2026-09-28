import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGearPair, createPairAnalysisDocument, initialPairMate, type PairReport } from '../lib/pairAnalysis.ts';
import { defaultModel, type ModelParams } from '../lib/model.ts';
import type { Point3 } from '../lib/bevelGeometry.ts';

const p = (changes: Partial<ModelParams> = {}): ModelParams => ({ ...defaultModel('bevel'), ...changes });
const DEG = Math.PI / 180;
const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ±${tolerance}`);
const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Point3) => Math.hypot(a.x, a.y, a.z);
const distance = (a: Point3, b: Point3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const check = (report: PairReport, id: string) => {
  const found = report.checks.find(item => item.id === id);
  assert.ok(found, id); return found;
};
function noCylindricalMetrics(report: PairReport) {
  assert.ok(Object.values(report.dimensions).every(value => value === null));
  assert.deepEqual(report.profileGeometry, []);
}

test('bevel seed uses the first fixed partner count, reciprocal count and cone parameters', () => {
  const first = p({ teeth: 40, bevelMateTeeth: 80, module: 1.5, pressureAngleDeg: 25, bevelShaftAngleDeg: 100, width: 8 });
  const saved = structuredClone(first), second = initialPairMate(first);
  assert.equal(second.kind, 'bevel'); assert.equal(second.teeth, 80); assert.equal(second.bevelMateTeeth, 40);
  assert.equal(second.module, 1.5); assert.equal(second.pressureAngleDeg, 25);
  assert.equal(second.bevelShaftAngleDeg, 100); assert.equal(second.width, 8);
  assert.equal(second.helixAngleDeg, 0); assert.equal(second.profileShift, 0); assert.equal(second.bore, 0);
  second.teeth = 60;
  assert.deepEqual(first, saved, 'editing the mate must not silently rebuild the first cone');
  assert.equal(initialPairMate(p()).teeth, 40, 'default bevel does not inherit the spur double-z seed');
});

test('equal bevel cones have conditional coordinate overlap and never certify contact', () => {
  const first = p(), second = { ...initialPairMate(first), width: 6 };
  const report = analyzeGearPair({ first, second }), g = report.bevelGeometry;
  assert.equal(report.status, 'warning'); assert.equal(report.family, 'bevel_pitch_cones'); assert.ok(g);
  const R = Math.hypot(40, 40);
  close(g.firstPitchConeAngleDeg, 45); close(g.secondPitchConeAngleDeg, 45); close(g.shaftAngleDeg, 90);
  close(g.outerConeDistanceMm, R); close(g.firstFaceIntervalMm.start, R - 10); close(g.secondFaceIntervalMm.start, R - 6);
  close(g.overlapStartMm, R - 6); close(g.overlapEndMm, R); close(g.overlapLengthMm, 6); close(g.ratio, 1);
  close(g.idealAssembly.overlapEnd.x, 40); close(g.idealAssembly.overlapEnd.z, 40);
  assert.equal(g.idealAssembly.actualMountingVerified, false); assert.equal(g.idealAssembly.toothPhaseRad, null);
  assert.equal(g.conjugacyVerified, false); assert.equal(g.contactRatio, null); assert.equal(g.backlashMm, null); assert.equal(g.interferenceFree, null);
  assert.equal(check(report, 'bevel-apex-assumption').status, 'warning');
  assert.equal(check(report, 'bevel-contact-unverified').status, 'warning');
  noCylindricalMetrics(report);
});

test('independent triangle and vector construction verifies unequal cones and several shaft angles', () => {
  for (const [z1, z2, sigma, moduleValue] of [[40, 80, 90, 2], [80, 120, 100, 1.5], [60, 60, 120, .5], [100, 100, 30, .2], [40, 40, 60, 3]]) {
    const first = p({ teeth: z1, bevelMateTeeth: z2, bevelShaftAngleDeg: sigma, module: moduleValue, width: 2 * moduleValue, bore: 0, backlash: .02 * moduleValue });
    const second = { ...initialPairMate(first), width: moduleValue };
    const report = analyzeGearPair({ first, second }), g = report.bevelGeometry;
    assert.ok(g, JSON.stringify(report.checks)); assert.equal(report.status, 'warning');
    // Law of cosines on the triangle of pitch diameters; no call to deriveBevel.
    const d1 = z1 * moduleValue, d2 = z2 * moduleValue, s = sigma * DEG;
    const R = Math.sqrt(d1 * d1 + d2 * d2 + 2 * d1 * d2 * Math.cos(s)) / (2 * Math.sin(s));
    const delta1 = Math.asin(d1 / (2 * R)), delta2 = Math.asin(d2 / (2 * R));
    close(g.outerConeDistanceMm, R); close(g.firstPitchConeAngleDeg, delta1 / DEG); close(g.secondPitchConeAngleDeg, delta2 / DEG);
    close(g.firstPitchConeAngleDeg + g.secondPitchConeAngleDeg, sigma); close(g.ratio, z2 / z1);
    const a = g.idealAssembly;
    for (const v of [a.firstAxis, a.secondAxis, a.commonGenerator]) close(length(v), 1, 1e-12);
    close(dot(a.firstAxis, a.secondAxis), Math.cos(s), 1e-12);
    close(dot(a.firstAxis, a.commonGenerator), Math.cos(delta1), 1e-12);
    close(dot(a.secondAxis, a.commonGenerator), Math.cos(delta2), 1e-12);
    close(distance(a.apex, a.overlapStart), R - moduleValue);
    close(distance(a.apex, a.overlapEnd), R); close(distance(a.overlapStart, a.overlapEnd), moduleValue);
    // Perpendicular distances to each axis reproduce pitch radii at the same Q.
    for (const [axis, z] of [[a.firstAxis, z1], [a.secondAxis, z2]] as const) {
      const axial = dot(a.overlapEnd, axis);
      close(Math.sqrt(length(a.overlapEnd) ** 2 - axial ** 2), moduleValue * z / 2);
    }
    noCylindricalMetrics(report);
  }
});

test('swapping parts inverts ratio and preserves physical overlap coordinates along Q', () => {
  const first = p({ teeth: 40, bevelMateTeeth: 80, width: 12 }), second = { ...initialPairMate(first), width: 7, bore: 6 };
  const a = analyzeGearPair({ first, second }).bevelGeometry, b = analyzeGearPair({ first: second, second: first }).bevelGeometry;
  assert.ok(a && b); close(a.ratio * b.ratio, 1); close(a.overlapLengthMm, b.overlapLengthMm);
  close(a.overlapStartMm, b.overlapStartMm); close(a.outerConeDistanceMm, b.outerConeDistanceMm);
  close(a.firstPitchConeAngleDeg, b.secondPitchConeAngleDeg);
  assert.deepEqual(a.firstFaceIntervalMm, b.secondFaceIntervalMm);
});

test('both actual bounded meshes are validated and only compact normalized evidence is retained', () => {
  const first = p({ bevelMateTeeth: undefined, bevelShaftAngleDeg: undefined }), second = { ...initialPairMate(first), width: 8, bore: 3 };
  const report = analyzeGearPair({ first, second });
  assert.equal(report.bevelModels.length, 2);
  for (const [i, model] of report.bevelModels.entries()) {
    assert.equal(model.part, i + 1); assert.equal(model.parameters.kind, 'bevel');
    assert.equal(model.parameters.bevelMateTeeth, 40); assert.equal(model.parameters.bevelShaftAngleDeg, 90);
    assert.equal(model.meshValidation.valid, true); assert.ok(model.meshValidation.triangles > 0); assert.ok(model.meshValidation.signedVolume > 0);
    for (const key of ['positions', 'indices', 'wormHand', 'cycloidRollingRadius']) assert.ok(!(key in model) && !(key in model.parameters));
    assert.deepEqual(model.quality, { flankSamples: 6 });
  }
  assert.ok(JSON.stringify(report).length < 20000);
});

test('reciprocal z mismatches preserve the already-built first cone and suppress all pair metrics', () => {
  const first = p(), saved = structuredClone(first);
  for (const second of [{ ...initialPairMate(first), teeth: 42 }, { ...initialPairMate(first), bevelMateTeeth: 42 }]) {
    const report = analyzeGearPair({ first, second });
    assert.equal(report.status, 'fail'); assert.equal(check(report, 'bevel-mutual-teeth').status, 'fail');
    assert.equal(report.bevelGeometry, null); assert.equal(report.bevelModels.length, 2); noCylindricalMetrics(report);
  }
  assert.deepEqual(first, saved);
});

test('module, profile angle and shaft angle mismatch cannot leak plausible cone-pair metrics', () => {
  const first = p();
  for (const [change, id] of [
    [{ module: 2.1 }, 'bevel-outer-module'], [{ pressureAngleDeg: 21 }, 'bevel-pressure-angle'], [{ bevelShaftAngleDeg: 92 }, 'bevel-shaft-angle'],
  ] as [Partial<ModelParams>, string][]) {
    const report = analyzeGearPair({ first, second: { ...initialPairMate(first), ...change } });
    assert.equal(report.status, 'fail'); assert.equal(check(report, id).status, 'fail');
    assert.equal(report.bevelGeometry, null); noCylindricalMetrics(report);
  }
});

test('each part must independently build: unsupported roots, holes, width and surface inputs fail', () => {
  const first = p();
  const cases: Partial<ModelParams>[] = [{ teeth: 24, bevelMateTeeth: 24 }, { bore: 80 }, { width: 60 }, { profileShift: .1 }, { helixAngleDeg: 20 }, { pressureAngleDeg: NaN }, { profileTolerance: 0 }];
  for (const change of cases) {
    const report = analyzeGearPair({ first, second: { ...initialPairMate(first), ...change } });
    assert.equal(report.status, 'fail', JSON.stringify(change)); assert.equal(report.bevelGeometry, null);
    assert.equal(check(report, 'bevel-model-1').status, 'pass'); assert.equal(check(report, 'bevel-model-2').status, 'fail'); noCylindricalMetrics(report);
  }
  const bothBad = analyzeGearPair({ first: p({ module: 0 }), second: p({ width: NaN }) });
  assert.equal(check(bothBad, 'bevel-model-1').status, 'fail'); assert.equal(check(bothBad, 'bevel-model-2').status, 'fail');
  assert.deepEqual(bothBad.bevelModels, []); assert.equal(bothBad.bevelGeometry, null);
});

test('the R/3 face-width recommendation warns while geometric overlap remains usable', () => {
  const first = p({ width: 35, bore: 3 }), second = { ...initialPairMate(first), width: 30 };
  const report = analyzeGearPair({ first, second });
  assert.equal(report.status, 'warning'); assert.ok(report.bevelGeometry);
  close(report.bevelGeometry.overlapLengthMm, 30);
  assert.equal(check(report, 'bevel-model-1-BEVEL_WIDE_FACE').status, 'warning');
});

test('thinning is never summed into a spatial backlash and zero thinning is not a contact certificate', () => {
  for (const [j1, j2] of [[0, 0], [.08, .15]]) {
    const first = p({ backlash: j1 }), second = { ...initialPairMate(first), backlash: j2 };
    const report = analyzeGearPair({ first, second });
    assert.equal(report.status, 'warning'); assert.ok(report.bevelGeometry);
    assert.equal(report.bevelGeometry.backlashMm, null); assert.equal(report.bevelGeometry.contactRatio, null);
    assert.equal(report.bevelGeometry.interferenceFree, null); noCylindricalMetrics(report);
  }
});

test('cylindrical centre input is explicitly rejected for bevel, including finite values', () => {
  const first = p(), second = initialPairMate(first);
  for (const centerDistanceMm of [80, 0, NaN]) {
    const report = analyzeGearPair({ first, second, centerDistanceMm });
    assert.equal(report.status, 'fail'); assert.equal(check(report, 'bevel-center-not-applicable').status, 'fail');
    assert.equal(report.bevelGeometry, null); noCylindricalMetrics(report);
  }
});

test('bevel mixed families are unsupported in either order, before any cylindrical profile call', () => {
  for (const kind of ['spur', 'internal', 'rack', 'worm', 'cycloidal'] as const) for (const reverse of [false, true]) {
    const parts = [p(), defaultModel(kind)];
    const report = analyzeGearPair({ first: parts[reverse ? 1 : 0], second: parts[reverse ? 0 : 1] });
    assert.equal(report.status, 'unsupported'); assert.equal(report.family, 'unsupported'); assert.equal(report.bevelGeometry, null);
    assert.deepEqual(report.bevelModels, []); noCylindricalMetrics(report);
  }
});

test('pair JSON owns both exact input snapshots and their normalized reports without assembly certification', () => {
  const first = p({ teeth: 40, bevelMateTeeth: 80 }), second = { ...initialPairMate(first), width: 8, bore: 6 };
  const expected = structuredClone({ first, second }), output = createPairAnalysisDocument({ first, second }, '2026-09-28T12:00:00.000Z');
  first.teeth = 60; second.width = 9;
  assert.equal(output.schema, 'zatseplenie.pair-analysis.v3'); assert.equal(output.appVersion, '0.12.0');
  assert.equal(output.createdAt, '2026-09-28T12:00:00.000Z'); assert.equal(output.units, 'mm');
  assert.deepEqual(output.input.first, expected.first); assert.deepEqual(output.input.second, expected.second);
  assert.equal(output.input.centerMode, 'not-applicable'); assert.equal(output.input.centerDistanceMm, null);
  assert.equal(output.report.bevelModels[0].parameters.teeth, 40); assert.equal(output.report.bevelModels[1].parameters.width, 8);
  assert.equal(output.report.status, 'warning'); assert.equal(output.report.bevelGeometry!.idealAssembly.actualMountingVerified, false);
  assert.deepEqual(JSON.parse(JSON.stringify(output)).report.bevelGeometry, output.report.bevelGeometry);
  const invalid = createPairAnalysisDocument({ ...expected, centerDistanceMm: 90 });
  assert.equal(invalid.input.centerMode, 'not-applicable'); assert.equal(invalid.input.rejectedCylindricalCenterDistanceMm, 90);
  assert.equal(invalid.report.status, 'fail'); assert.equal(invalid.report.bevelGeometry, null);
});

test('separate exporter preserves old cylinder modes and hides an unsupported auto-seeded mate', () => {
  const first = defaultModel('spur'), second = initialPairMate(first);
  const automatic = createPairAnalysisDocument({ first, second });
  assert.equal(automatic.input.centerMode, 'calculated-from-profile-shifts'); assert.equal(automatic.report.status, 'pass');
  assert.equal(automatic.report.bevelGeometry, null); assert.deepEqual(automatic.report.bevelModels, []);
  const manual = createPairAnalysisDocument({ first, second, centerDistanceMm: 72.1 });
  assert.equal(manual.input.centerMode, 'user-specified'); assert.equal(manual.input.centerDistanceMm, 72.1);
  const unsupported = createPairAnalysisDocument({ first: defaultModel('worm'), second });
  assert.equal(unsupported.input.second, null); assert.equal(unsupported.input.centerMode, 'not-applicable');
});
