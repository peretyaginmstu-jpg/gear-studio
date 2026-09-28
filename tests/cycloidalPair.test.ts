import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGearPair, createPairAnalysisDocument, initialPairMate, type PairReport } from '../lib/pairAnalysis.ts';
import { defaultModel, type ModelParams } from '../lib/model.ts';
import type { Point2 } from '../lib/gearMath.ts';

const p = (changes: Partial<ModelParams> = {}): ModelParams => ({ ...defaultModel('cycloidal'), ...changes });
const close = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} ±${tolerance}`);
const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);
const dot = (a: Point2, b: Point2) => a.x * b.x + a.y * b.y;
const rot = (v: Point2, angle: number): Point2 => ({ x: v.x * Math.cos(angle) - v.y * Math.sin(angle), y: v.x * Math.sin(angle) + v.y * Math.cos(angle) });
const check = (report: PairReport, id: string) => {
  const found = report.checks.find(item => item.id === id); assert.ok(found, id); return found;
};
function noInvoluteMetrics(report: PairReport) {
  assert.ok(Object.values(report.dimensions).every(value => value === null));
  assert.deepEqual(report.profileGeometry, []); assert.deepEqual(report.bevelModels, []); assert.equal(report.bevelGeometry, null);
}
// Independent Cartesian roulettes; no calls to the production curve/radius inversions.
const epi = (R: number, r: number, t: number): Point2 => ({
  x: (R + r) * Math.cos(t) - r * Math.cos((R + r) * t / r),
  y: (R + r) * Math.sin(t) - r * Math.sin((R + r) * t / r),
});
const hypo = (R: number, r: number, t: number): Point2 => ({
  x: (R - r) * Math.cos(t) + r * Math.cos((R - r) * t / r),
  y: (R - r) * Math.sin(t) - r * Math.sin((R - r) * t / r),
});
function movingPoint(first: ModelParams, second: ModelParams, s: number, part: 1 | 2, parameterOffset = 0): Point2 {
  const model = part === 1 ? first : second, R = model.module * model.teeth / 2;
  const r = model.cycloidRollingRadius!, half = (Math.PI * model.module / 2 - model.backlash) / (2 * R);
  const face = part === 1 ? s > 0 : s < 0;
  const t = (part === 1 ? -s / R : s / R) + parameterOffset;
  const curve = face ? epi(R, r, t) : hypo(R, r, t);
  const phase = part === 1 ? -half + s / R : Math.PI - half - s / R;
  const world = rot(rot(curve, half), phase);
  return { x: world.x + (part === 2 ? first.module * first.teeth / 2 + R : 0), y: world.y };
}

test('cycloidal seed preserves the shared generating circle, including the first wheel default clamp', () => {
  for (const first of [p(), p({ teeth: 6, module: 1, bore: 0, backlash: 0, cycloidRollingRadius: undefined }), p({ cycloidRollingRadius: 7 })]) {
    const before = structuredClone(first), second = initialPairMate(first);
    assert.equal(second.kind, 'cycloidal'); assert.equal(second.teeth, Math.min(250, first.teeth * 2));
    close(second.cycloidRollingRadius!, first.cycloidRollingRadius ?? Math.min(2 * first.module, first.module * first.teeth / 4));
    assert.equal(second.module, first.module); assert.equal(second.width, first.width);
    assert.equal(second.helixAngleDeg, 0); assert.equal(second.profileShift, 0); assert.equal(second.bore, 0);
    second.cycloidRollingRadius = 1; assert.deepEqual(first, before);
  }
});

test('compatible default is a bounded warning and keeps real contact, phase, backlash and interference unknown', () => {
  const first = p(), second = { ...initialPairMate(first), width: 6 };
  const report = analyzeGearPair({ first, second }), g = report.cycloidalGeometry;
  assert.equal(report.family, 'external_cycloidal'); assert.equal(report.status, 'warning'); assert.ok(g);
  close(g.nominalCenterDistanceMm, 72); close(g.rollingRadiusMm, 4); close(g.ratio, 2);
  close(g.faceOverlapMm, 6); close(g.idealAssembly.axialOverlapStartMm, -3); close(g.idealAssembly.axialOverlapEndMm, 3);
  close(g.nominalFlankCoverageUpperBound, 1.2717788689530223);
  assert.equal(g.continuityNecessaryCondition, 'not-disproved'); assert.equal(g.enteredCenterDistanceMm, null);
  assert.equal(g.fullPairConjugacyVerified, false); assert.equal(g.idealAssembly.actualMountingVerified, false);
  assert.equal(g.idealAssembly.toothPhaseRad, null); assert.equal(g.contactRatio, null); assert.equal(g.backlashMm, null); assert.equal(g.interferenceFree, null);
  assert.equal(check(report, 'cycloidal-contact-unverified').status, 'warning'); noInvoluteMetrics(report);
});

test('independent moving frames make both finite analytic branches coincide and satisfy the common-normal velocity law', () => {
  const first = p({ cycloidRollingRadius: 4, backlash: .08 }), second = { ...initialPairMate(first), backlash: .13 };
  const report = analyzeGearPair({ first, second }), g = report.cycloidalGeometry; assert.ok(g);
  const R1 = first.module * first.teeth / 2, R2 = second.module * second.teeth / 2;
  for (const branch of g.branches) for (const fraction of [.1, .3, .6, .9]) {
    const sign = branch.addendumPart === 1 ? 1 : -1, s = sign * branch.pitchTravelUpperBoundMm * fraction;
    const q1 = movingPoint(first, second, s, 1), q2 = movingPoint(first, second, s, 2);
    close(dist(q1, q2), 0, 5e-13);
    const normal = { x: q1.x - R1, y: q1.y }, n = Math.hypot(normal.x, normal.y);
    for (const part of [1, 2] as const) {
      const minus = movingPoint(first, second, s, part, -1e-6), plus = movingPoint(first, second, s, part, 1e-6);
      const tangent = { x: plus.x - minus.x, y: plus.y - minus.y };
      close(dot(tangent, normal) / (Math.hypot(tangent.x, tangent.y) * n), 0, 2e-8);
    }
    const v1 = { x: -q1.y, y: q1.x }, omega2 = -R1 / R2;
    const v2 = { x: -omega2 * q2.y, y: omega2 * (q2.x - R1 - R2) };
    close(dot({ x: v1.x - v2.x, y: v1.y - v2.y }, normal), 0, 1e-10);
  }
});

test('independent path-circle bisection finds tip/root limits and the reported endpoint in full assembly coordinates', () => {
  const first = p({ cycloidRollingRadius: 12 }), second = initialPairMate(first);
  const report = analyzeGearPair({ first, second }), g = report.cycloidalGeometry; assert.ok(g);
  close(report.cycloidalModels[0].dimensions.rollingRadius, g.firstPitchRadiusMm / 2);
  for (const branch of g.branches) {
    const sign = branch.addendumPart === 1 ? 1 : -1;
    const point = (gamma: number) => ({ x: g.firstPitchRadiusMm + sign * g.rollingRadiusMm * (1 - Math.cos(gamma)), y: sign * g.rollingRadiusMm * Math.sin(gamma) });
    const limit = (part: 1 | 2, face: boolean) => {
      const model = report.cycloidalModels[part - 1], origin = part === 1 ? { x: 0, y: 0 } : { x: g.nominalCenterDistanceMm, y: 0 };
      const target = face ? model.tipRadiusMm : model.rootRadiusMm;
      let lo = 0, hi = Math.PI;
      for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2, radius = dist(point(mid), origin); if (face ? radius < target : radius > target) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    };
    close(branch.addendumLimitRad, limit(branch.addendumPart, true), 2e-13);
    close(branch.dedendumLimitRad, limit(branch.dedendumPart, false), 2e-13);
    const gamma = Math.min(limit(branch.addendumPart, true), limit(branch.dedendumPart, false));
    close(dist(branch.pathEnd, point(gamma)), 0, 1e-12);
    close(dist(branch.pathEnd, branch.pathCircleCenter), g.rollingRadiusMm, 1e-12);
  }
});

test('a constructible six-tooth pair falsifies continuous flank coverage without claiming physical impossibility', () => {
  const first = p({ teeth: 6, module: 1, cycloidRollingRadius: .87, bore: 0, backlash: 0 });
  const report = analyzeGearPair({ first, second: { ...first } }), g = report.cycloidalGeometry;
  assert.equal(report.status, 'fail'); assert.ok(g, 'valid nominal bounds must remain visible to explain this rejection');
  assert.ok(report.cycloidalModels.every(model => model.meshValidation.valid));
  close(g.nominalFlankCoverageUpperBound, .8919008209950929); assert.equal(g.continuityNecessaryCondition, 'fails');
  assert.equal(check(report, 'cycloidal-coverage-bound').status, 'fail'); assert.equal(g.contactRatio, null);
  assert.equal(report.checks.filter(item => item.status === 'fail').length, 1);
});

test('shared-radius mismatch separates independently transformed roulettes and suppresses pair metrics', () => {
  const first = p({ cycloidRollingRadius: 4 }), second = { ...initialPairMate(first), cycloidRollingRadius: 5 };
  assert.ok(dist(movingPoint(first, second, 2, 1), movingPoint(first, second, 2, 2)) > .09);
  const report = analyzeGearPair({ first, second });
  assert.equal(report.status, 'fail'); assert.equal(check(report, 'cycloidal-generators').status, 'fail');
  assert.equal(report.cycloidalGeometry, null); assert.equal(report.cycloidalModels.length, 2); noInvoluteMetrics(report);
});

test('module and nonnominal centre inputs reject this precheck instead of using involute working-angle formulas', () => {
  const first = p(), second = initialPairMate(first);
  const mismatch = analyzeGearPair({ first, second: { ...second, module: 2.1 } });
  assert.equal(check(mismatch, 'cycloidal-module').status, 'fail'); assert.equal(mismatch.cycloidalGeometry, null);
  for (const centerDistanceMm of [72.1, 0, NaN, Infinity]) {
    const report = analyzeGearPair({ first, second, centerDistanceMm });
    assert.equal(report.status, 'fail'); assert.equal(check(report, 'cycloidal-center').status, 'fail'); assert.equal(report.cycloidalGeometry, null); noInvoluteMetrics(report);
  }
  const nominal = analyzeGearPair({ first, second, centerDistanceMm: 72 });
  assert.equal(nominal.status, 'warning'); close(nominal.cycloidalGeometry!.enteredCenterDistanceMm!, 72);
});

test('each complete model must independently build and its normalized mesh evidence contains no vertex arrays', () => {
  const first = p({ cycloidRollingRadius: undefined }), second = initialPairMate(first);
  const report = analyzeGearPair({ first, second });
  for (const [i, model] of report.cycloidalModels.entries()) {
    assert.equal(model.part, i + 1); assert.equal(model.parameters.cycloidRollingRadius, 4);
    assert.ok(model.meshValidation.valid && model.meshValidation.signedVolume > 0); assert.deepEqual(model.quality, { flankSamples: 6 });
    for (const key of ['positions', 'indices', 'wormHand', 'bevelMateTeeth']) assert.ok(!(key in model) && !(key in model.parameters));
  }
  assert.ok(JSON.stringify(report).length < 20000);
  for (const change of [{ cycloidRollingRadius: .1 }, { cycloidRollingRadius: 100 }, { bore: 100 }, { width: 0 }, { profileShift: .1 }, { helixAngleDeg: 20 }]) {
    const invalid = analyzeGearPair({ first, second: { ...second, ...change } });
    assert.equal(invalid.status, 'fail'); assert.equal(invalid.cycloidalGeometry, null);
    assert.equal(check(invalid, 'cycloidal-model-1').status, 'pass'); assert.equal(check(invalid, 'cycloidal-model-2').status, 'fail');
  }
});

test('scale and part reversal preserve dimensionless bounds while widths and radial limits scale', () => {
  const baseline = analyzeGearPair({ first: p(), second: initialPairMate(p()) }).cycloidalGeometry!;
  for (const scale of [.1, 3]) {
    const first = p({ module: 2 * scale, cycloidRollingRadius: 4 * scale, width: 10 * scale, bore: 8 * scale, backlash: .08 * scale }), second = initialPairMate(first);
    const report = analyzeGearPair({ first, second }), g = report.cycloidalGeometry!;
    assert.equal(report.status, 'warning'); close(g.nominalFlankCoverageUpperBound, baseline.nominalFlankCoverageUpperBound);
    close(g.totalPitchTravelUpperBoundMm, baseline.totalPitchTravelUpperBoundMm * scale);
    close(g.rootCircleClearanceMm.firstTipToSecondRoot, .5 * scale);
    const reverse = analyzeGearPair({ first: second, second: first }).cycloidalGeometry!;
    close(reverse.nominalFlankCoverageUpperBound, g.nominalFlankCoverageUpperBound); close(reverse.ratio * g.ratio, 1);
    close(reverse.branches[0].rollAngleUpperBoundRad, g.branches[1].rollAngleUpperBoundRad);
  }
});

test('unused constant alpha is not a compatibility condition and thinning is never called pair backlash', () => {
  const first = p({ backlash: 0 }), second = { ...initialPairMate(first), pressureAngleDeg: 30, backlash: .1 };
  const report = analyzeGearPair({ first, second });
  assert.equal(report.status, 'warning'); assert.ok(report.cycloidalGeometry);
  assert.equal(report.cycloidalGeometry.backlashMm, null); assert.equal(report.cycloidalGeometry.contactRatio, null); noInvoluteMetrics(report);
});

test('mixed families are unsupported in both input orders without publishing cycloidal metrics', () => {
  for (const kind of ['spur', 'internal', 'rack', 'worm', 'bevel'] as const) for (const reverse of [false, true]) {
    const parts = [p(), defaultModel(kind)], report = analyzeGearPair({ first: parts[reverse ? 1 : 0], second: parts[reverse ? 0 : 1] });
    assert.equal(report.status, 'unsupported'); assert.equal(report.family, 'unsupported');
    assert.equal(report.cycloidalGeometry, null); assert.deepEqual(report.cycloidalModels, []); noInvoluteMetrics(report);
  }
});

test('additive v3 JSON owns both exact snapshots and a separately labelled nominal centre mode', () => {
  const first = p(), second = { ...initialPairMate(first), width: 8, bore: 6 }, expected = structuredClone({ first, second });
  const output = createPairAnalysisDocument({ first, second }, '2026-09-28T12:00:00.000Z');
  first.teeth = 30; second.width = 9;
  assert.equal(output.schema, 'zatseplenie.pair-analysis.v3'); assert.equal(output.appVersion, '0.18.0');
  assert.deepEqual(output.input.first, expected.first); assert.deepEqual(output.input.second, expected.second);
  assert.equal(output.input.centerMode, 'nominal-reference-circles'); assert.equal(output.input.centerDistanceMm, null);
  assert.equal(output.report.cycloidalModels[1].parameters.width, 8); assert.equal(output.report.status, 'warning');
  const entered = createPairAnalysisDocument({ ...expected, centerDistanceMm: 72 });
  assert.equal(entered.input.centerMode, 'user-specified-for-nominal-precheck'); close(entered.input.centerDistanceMm!, 72);
  assert.deepEqual(JSON.parse(JSON.stringify(output)).report.cycloidalGeometry, output.report.cycloidalGeometry);
  const old = createPairAnalysisDocument({ first: defaultModel('spur'), second: initialPairMate(defaultModel('spur')) });
  assert.equal(old.input.centerMode, 'calculated-from-profile-shifts'); assert.equal(old.report.status, 'pass');
  assert.equal(old.report.cycloidalGeometry, null); assert.deepEqual(old.report.cycloidalModels, []);
});
