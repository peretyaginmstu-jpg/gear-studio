import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGearPair, type PairReport } from '../lib/pairAnalysis.ts';
import { defaultModel, type ModelParams } from '../lib/model.ts';
import { buildGearProfile, defaultGearParams } from '../lib/gearMath.ts';

const p = (changes: Partial<ModelParams> = {}): ModelParams => ({ ...defaultModel(), bore: 0, ...changes });
const rad = Math.PI / 180;
function close(actual: number | null, expected: number, tolerance = 1e-9) {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) <= tolerance, `${actual} != ${expected} ± ${tolerance}`);
}
const check = (report: PairReport, id: string) => {
  const result = report.checks.find(c => c.id === id);
  assert.ok(result, `Missing check ${id}`);
  return result;
};
const involute = (angle: number) => Math.tan(angle) - angle;

test('24/48 spur: independent circles give contact, clearance, ratio and both thickness reductions', () => {
  const report = analyzeGearPair({ first: p(), second: p({ teeth: 48 }) });
  const d = report.dimensions;
  // Independent construction from circles, SDP/SI section 11, table 11-1:
  // m=2, alpha=20, r1=24, r2=48, ra1=26, ra2=50, a=72.
  const cos = Math.cos(20 * rad), sin = Math.sin(20 * rad);
  const expected = (Math.sqrt(26 ** 2 - (24 * cos) ** 2) + Math.sqrt(50 ** 2 - (48 * cos) ** 2) - 72 * sin) / (2 * Math.PI * cos);
  assert.equal(report.status, 'pass'); assert.equal(report.family, 'external_cylindrical');
  close(d.referenceCenterDistanceMm, 72); close(d.operatingCenterDistanceMm, 72);
  close(d.operatingPressureAngleDeg, 20); close(d.transverseContactRatio, expected);
  close(d.transverseContactRatio, 1.67470514819198, 1e-12);
  close(d.overlapContactRatio, 0); close(d.totalContactRatio, expected);
  close(d.transverseBacklashMm, .16); close(d.minimumRadialClearanceMm, .5);
  close(d.ratio, 2); close(d.effectiveFaceWidthMm, 10);
});

test('KHK Table 4.3 shifted spur example reproduces working angle and centre', () => {
  // https://khkgears.net/new/gear_knowledge/gear_technical_reference/calculation_gear_dimensions.html
  // KHK printed: m=3, z=12/24, x=.6/.36, alpha=20, alpha_w=26.0886, a=56.4999.
  const report = analyzeGearPair({ first: p({ module: 3, teeth: 12, profileShift: .6, backlash: 0 }), second: p({ module: 3, teeth: 24, profileShift: .36, backlash: 0 }) });
  assert.equal(report.status, 'warning', 'zero backlash is explicitly a warning');
  close(report.dimensions.referenceCenterDistanceMm, 54);
  close(report.dimensions.operatingCenterDistanceMm, 56.4999, .0001);
  close(report.dimensions.operatingPressureAngleDeg, 26.0886, .00005);
  close(report.dimensions.transverseBacklashMm, 0);
  // KHK shortens tips for a .25m clearance. This app keeps its own unshortened tips.
  close(report.dimensions.minimumRadialClearanceMm, 56.499869720305185 - 56.13, 1e-10);
  assert.ok(report.assumptions.some(s => s.includes('автоматически не укорачиваются')));
});

test('KHK Table 4.9 normal helical example reproduces working geometry, not transverse-system shift', () => {
  const first = p({ kind: 'helical', module: 3, teeth: 12, helixAngleDeg: 30, profileShift: .09809, backlash: 0 });
  const second = p({ kind: 'helical', module: 3, teeth: 60, helixAngleDeg: -30, backlash: 0 });
  const report = analyzeGearPair({ first, second });
  close(report.dimensions.operatingCenterDistanceMm, 125, .00001);
  close(report.dimensions.operatingPressureAngleDeg, 23.1126, .00005);
  close(report.dimensions.referenceCenterDistanceMm, 108 / Math.cos(30 * rad));
  close(report.dimensions.overlapContactRatio, 10 * .5 / (Math.PI * 3));
  close(report.dimensions.transverseBacklashMm, 0);
  assert.notEqual(report.status, 'fail');
});

test('manual centre uses operating tooth arcs including shifts and individually supplied reductions', () => {
  const first = p({ teeth: 24, profileShift: .2, backlash: .07 });
  const second = p({ teeth: 48, profileShift: .1, backlash: .13 });
  const a = 72.8, aw = Math.acos(72 * Math.cos(20 * rad) / a);
  // Independent sum of circular tooth arcs at working radii 1:2.
  const k = a / 72, rw1 = a / 3, rw2 = 2 * a / 3;
  const st1 = Math.PI + .8 * Math.tan(20 * rad) - .07;
  const st2 = Math.PI + .4 * Math.tan(20 * rad) - .13;
  const expected = 2 * Math.PI * k - (k * st1 + 2 * rw1 * (involute(20 * rad) - involute(aw))) - (k * st2 + 2 * rw2 * (involute(20 * rad) - involute(aw)));
  const report = analyzeGearPair({ first, second, centerDistanceMm: a });
  close(report.dimensions.operatingPressureAngleDeg, aw / rad);
  close(report.dimensions.transverseBacklashMm, expected);
  const nominal = analyzeGearPair({ first, second });
  close(nominal.dimensions.transverseBacklashMm, .2 * nominal.dimensions.operatingCenterDistanceMm! / 72);
  assert.notEqual(report.dimensions.operatingCenterDistanceMm, nominal.dimensions.operatingCenterDistanceMm);
});

test('positive total shift at unshifted centre is interference, not automatically a positive backlash', () => {
  const report = analyzeGearPair({ first: p({ profileShift: .2, backlash: 0 }), second: p({ teeth: 48, profileShift: .2, backlash: 0 }), centerDistanceMm: 72 });
  assert.equal(report.status, 'fail'); assert.equal(check(report, 'backlash').status, 'fail');
  close(report.dimensions.transverseBacklashMm, -1.6 * Math.tan(20 * rad));
});

test('internal pair uses difference of shifts and the opposite working-thickness signs', () => {
  const first = p({ teeth: 36, profileShift: .1, backlash: .06 });
  const second = p({ kind: 'internal', teeth: 96, profileShift: .3, backlash: .12 });
  const nominal = analyzeGearPair({ first, second });
  assert.equal(nominal.family, 'internal_cylindrical'); assert.equal(nominal.status, 'warning');
  close(nominal.dimensions.referenceCenterDistanceMm, 60);
  close(nominal.dimensions.operatingCenterDistanceMm, 60.39061360652763);
  close(nominal.dimensions.operatingPressureAngleDeg, 20.99453916242656);
  close(nominal.dimensions.transverseBacklashMm, .18 * 60.39061360652763 / 60);
  assert.equal(check(nominal, 'internal-assembly').status, 'warning');
  const a = 60.6, aw = Math.acos(60 * Math.cos(20 * rad) / a), k = a / 60;
  const expected = k * (.18 + 4 * (.3 - .1) * Math.tan(20 * rad)) - 2 * a * (involute(aw) - involute(20 * rad));
  close(analyzeGearPair({ first, second, centerDistanceMm: a }).dimensions.transverseBacklashMm, expected);
  assert.ok(analyzeGearPair({ first, second, centerDistanceMm: 61 }).dimensions.transverseBacklashMm! < nominal.dimensions.transverseBacklashMm!);
});

test('internal model root boundaries use both directions of radial clearance', () => {
  const report = analyzeGearPair({ first: p({ teeth: 36, profileShift: .1 }), second: p({ kind: 'internal', teeth: 96, profileShift: .3 }), centerDistanceMm: 61 });
  // ring root=99.1, pinion tip=38.2; ring tip=94.6, pinion root=33.7.
  close(report.dimensions.minimumRadialClearanceMm, Math.min(99.1 - 61 - 38.2, 94.6 - 61 - 33.7));
  assert.equal(check(report, 'radial-clearance').status, 'fail');
});

test('generated root joins restrict contact without claiming a proved contour collision', () => {
  const first = p(), second = p({ kind: 'internal', teeth: 72 });
  const report = analyzeGearPair({ first, second });
  const pg = buildGearProfile({ ...defaultGearParams, bore: 0 }), join = pg.rootDiagnostics!.joinRadius;
  const rb = 24 * Math.cos(20 * rad);
  const available = (Math.sqrt(26 ** 2 - rb ** 2) - Math.sqrt(join ** 2 - rb ** 2)) / (2 * Math.PI * Math.cos(20 * rad));
  close(report.dimensions.transverseContactRatio, available);
  assert.equal(check(report, 'pinion-root').status, 'warning');
  assert.match(check(report, 'pinion-root').detail, /пересечение контуров не проверены/);
  assert.equal(report.status, 'warning');
});

test('rack datum, travel and contact use pinion reference radius, independent of rack tooth count', () => {
  const first = p(), second = p({ kind: 'rack', teeth: 10 });
  const report = analyzeGearPair({ first, second });
  assert.equal(report.family, 'rack_pinion'); assert.equal(report.status, 'warning');
  close(report.dimensions.operatingCenterDistanceMm, 24); close(report.dimensions.operatingPressureAngleDeg, 20);
  close(report.dimensions.transverseBacklashMm, .16); close(report.dimensions.minimumRadialClearanceMm, .5);
  // SDP/SI rack line of action: qa - r sin(alpha) + ha_rack / sin(alpha).
  const alpha = 20 * rad;
  const expected = (Math.sqrt(26 ** 2 - (24 * Math.cos(alpha)) ** 2) - 24 * Math.sin(alpha) + 2 / Math.sin(alpha)) / (2 * Math.PI * Math.cos(alpha));
  close(report.dimensions.transverseContactRatio, expected);
  assert.equal(report.dimensions.ratio, null);
  assert.deepEqual(report.dimensions, analyzeGearPair({ first, second: { ...second, teeth: 50 } }).dimensions);
  assert.equal(check(report, 'rack-ends').status, 'warning');
});

test('shifted rack automatic datum adds both shifts; manual offset changes backlash but not pressure angle', () => {
  const first = p({ profileShift: .4 }), second = p({ kind: 'rack', teeth: 10, profileShift: .2 });
  const report = analyzeGearPair({ first, second });
  close(report.dimensions.operatingCenterDistanceMm, 25.2);
  close(report.dimensions.transverseBacklashMm, .16);
  const moved = analyzeGearPair({ first, second, centerDistanceMm: 25.7 });
  close(moved.dimensions.operatingPressureAngleDeg, 20);
  close(moved.dimensions.transverseBacklashMm, .16 + Math.tan(20 * rad));
  assert.deepEqual(report.dimensions, analyzeGearPair({ first: second, second: first }).dimensions);
});

test('KHK Table 4.13 helical rack numeric geometry with the explicit model sign convention', () => {
  const beta = 10 + 57 / 60 + 49 / 3600;
  const first = p({ kind: 'helical', module: 2.5, teeth: 20, helixAngleDeg: beta });
  const second = p({ kind: 'helical-rack', module: 2.5, teeth: 10, helixAngleDeg: beta });
  const report = analyzeGearPair({ first, second });
  // KHK mounting height includes H=27.5; our a is to y=0, not the backing.
  close(report.dimensions.operatingCenterDistanceMm! + 27.5, 52.96478, .00002);
  close(report.dimensions.operatingPressureAngleDeg, 20.34160, .00001);
  assert.equal(check(report, 'helix-hand').status, 'pass');
  const wrong = analyzeGearPair({ first, second: { ...second, helixAngleDeg: -beta } });
  assert.equal(check(wrong, 'helix-hand').status, 'fail');
});

test('external helices require opposite signs; internal helices require equal signs', () => {
  const first = p({ kind: 'helical', teeth: 36, helixAngleDeg: 25, profileShift: .1 });
  const sameHand = p({ kind: 'helical', teeth: 72, helixAngleDeg: 25 });
  assert.equal(check(analyzeGearPair({ first, second: sameHand }), 'helix-hand').status, 'fail');
  assert.notEqual(analyzeGearPair({ first, second: { ...sameHand, helixAngleDeg: -25 } }).status, 'fail');
  const ring = p({ kind: 'internal-helical', teeth: 96, helixAngleDeg: 25, profileShift: .3 });
  assert.equal(check(analyzeGearPair({ first, second: ring }), 'helix-hand').status, 'pass');
  assert.equal(check(analyzeGearPair({ first, second: { ...ring, helixAngleDeg: -25 } }), 'helix-hand').status, 'fail');
});

test('herringbone overlap uses narrower half-width and requires a matching chevron', () => {
  const first = p({ kind: 'herringbone', width: 20, helixAngleDeg: 30 });
  const second = p({ kind: 'herringbone', teeth: 48, width: 12, helixAngleDeg: -30 });
  const report = analyzeGearPair({ first, second });
  close(report.dimensions.effectiveFaceWidthMm, 12);
  close(report.dimensions.overlapContactRatio, 6 * .5 / (Math.PI * 2));
  assert.equal(check(report, 'herringbone-topology').status, 'warning');
  assert.equal(check(analyzeGearPair({ first, second: { ...second, kind: 'helical' } }), 'herringbone-topology').status, 'fail');
});

test('module, normal angle and helix magnitude mismatch suppresses invalid pair dimensions', () => {
  for (const [id, second] of [
    ['normal-module', p({ module: 2.1 })], ['pressure-angle', p({ pressureAngleDeg: 25 })],
    ['helix-magnitude', p({ kind: 'helical', helixAngleDeg: 25 })],
  ] as const) {
    const report = analyzeGearPair({ first: p(), second });
    assert.equal(report.status, 'fail'); assert.equal(check(report, id).status, 'fail');
    assert.ok(Object.values(report.dimensions).every(value => value === null));
  }
});

test('zero-angle helical and herringbone kinds reduce to the same spur pair', () => {
  const first = p(), second = p({ teeth: 48 });
  const expected = analyzeGearPair({ first, second });
  const flat = analyzeGearPair({ first: { ...first, kind: 'herringbone', helixAngleDeg: 0 }, second: { ...second, kind: 'helical', helixAngleDeg: 0 } });
  assert.deepEqual(flat.dimensions, expected.dimensions); assert.equal(flat.status, expected.status);
});

test('base-circle constraint and positive real distance are checked without fallback or clamping', () => {
  const first = p(), second = p({ teeth: 48 });
  assert.equal(check(analyzeGearPair({ first, second, centerDistanceMm: 60 }), 'base-circles').status, 'fail');
  for (const a of [0, -1, NaN, Infinity]) {
    const report = analyzeGearPair({ first, second, centerDistanceMm: a });
    assert.equal(report.status, 'fail');
    assert.equal(report.dimensions.operatingCenterDistanceMm, null);
    assert.equal(check(report, 'center-distance').status, 'fail');
  }
});

test('too small centre detects negative backlash and radial penetration independently', () => {
  const report = analyzeGearPair({ first: p(), second: p({ teeth: 48 }), centerDistanceMm: 71 });
  assert.equal(report.status, 'fail');
  assert.equal(check(report, 'backlash').status, 'fail');
  assert.equal(check(report, 'radial-clearance').status, 'fail');
  close(report.dimensions.minimumRadialClearanceMm, -.5);
  close(report.dimensions.transverseBacklashMm, -.5204138209786224);
});

test('contact below one fails; no transverse contact cannot be rescued by face overlap', () => {
  const low = analyzeGearPair({ first: p(), second: p({ teeth: 48 }), centerDistanceMm: 74 });
  close(low.dimensions.transverseContactRatio, .7689045680604404);
  assert.equal(check(low, 'contact-ratio').status, 'fail');
  const none = analyzeGearPair({ first: p({ kind: 'helical', width: 100, helixAngleDeg: 30 }), second: p({ kind: 'helical', width: 100, teeth: 48, helixAngleDeg: -30 }), centerDistanceMm: 100 });
  close(none.dimensions.transverseContactRatio, 0);
  assert.ok(none.dimensions.overlapContactRatio! > 1);
  assert.equal(none.dimensions.totalContactRatio, null);
  assert.equal(check(none, 'contact-ratio').status, 'fail');
});

test('zero backlash remains numeric zero with a warning, and unsupported types stay null', () => {
  const zero = analyzeGearPair({ first: p({ backlash: 0 }), second: p({ teeth: 48, backlash: 0 }) });
  assert.equal(zero.dimensions.transverseBacklashMm, 0);
  assert.equal(check(zero, 'backlash').status, 'warning');
  for (const kind of ['worm', 'cycloidal', 'unimplemented'] as const) {
    const report = analyzeGearPair({ first: { ...p(), kind } as ModelParams, second: p() });
    assert.equal(report.status, 'unsupported'); assert.equal(report.family, 'unsupported');
    assert.ok(Object.values(report.dimensions).every(v => v === null));
  }
});

test('internal ordering, invalid families, invalid profiles and added model settings are handled safely', () => {
  const first = p({ teeth: 36, profileShift: .1 }), second = p({ kind: 'internal', teeth: 96, profileShift: .3 });
  const normal = analyzeGearPair({ first, second }), swapped = analyzeGearPair({ first: second, second: first });
  const { ratio: originalRatio, ...normalDimensions } = normal.dimensions;
  const { ratio: reverseRatio, ...reverseDimensions } = swapped.dimensions;
  assert.deepEqual(normalDimensions, reverseDimensions); close(originalRatio! * reverseRatio!, 1);
  assert.equal(analyzeGearPair({ first: second, second: { ...second, teeth: 72 } }).status, 'unsupported');
  assert.equal(analyzeGearPair({ first: p({ kind: 'rack' }), second: p({ kind: 'rack' }) }).status, 'unsupported');
  assert.equal(analyzeGearPair({ first: p({ teeth: 100 }), second }).status, 'fail');
  assert.equal(analyzeGearPair({ first: p({ module: NaN }), second }).status, 'fail');
  // defaultModel includes the string wormHand, which the cylindrical kernel rejects if leaked.
  const extras = { ...p(), wormHand: 'left', cycloidRollingRadius: 2 } as ModelParams;
  assert.equal(analyzeGearPair({ first: extras, second: p({ teeth: 48 }) }).status, 'pass');
});

test('finite extreme input cannot leak NaN or Infinity as report dimensions', () => {
  const report = analyzeGearPair({ first: p(), second: p({ teeth: 48 }), centerDistanceMm: 1e308 });
  assert.equal(report.status, 'fail');
  assert.ok(Object.values(report.dimensions).every(v => v === null || Number.isFinite(v)));
  assert.equal(check(report, 'numeric-range').status, 'fail');
});
