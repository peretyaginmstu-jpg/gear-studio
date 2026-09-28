import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSpanMeasurement, predictedSpanMm, selectSpanApplication, spanApplicationMatches } from '../lib/spanMeasurement.ts';
import type { SpanMeasurementInput, SpanParameters, SpanReadings } from '../lib/spanMeasurement.ts';
import { buildGearProfile } from '../lib/gearMath.ts';

const close = (actual: number, expected: number, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ± ${tolerance}`);
const base = (changes: Partial<SpanMeasurementInput> = {}): SpanMeasurementInput => ({
  kind: 'spur', teeth: 24, spanTeeth: 3, pressureAngleDeg: 20, pressureAngleConfirmed: true,
  tipDiameterMethod: 'tip_circle', spanMm: 15.357747658604712, nextSpanMm: 21.262010526791812, tipDiameterMm: 52,
  errorBounds: { spanMm: .01, nextSpanMm: .01, tipDiameterMm: .02 },
  confirmations: { teeth: true, involute: true, standardTip: true, measurementSetup: true }, toolTipRadiusCoefficient: .3,
  ...changes,
});
const exact = (input: SpanMeasurementInput) => {
  const result = analyzeSpanMeasurement(input); assert.equal(result.status, 'ready', JSON.stringify(result.issues));
  assert.ok(result.exact); return result;
};
const zeroErrors = { spanMm: 0, nextSpanMm: 0, tipDiameterMm: 0 };

/** Independent Cartesian involute/jaw oracle: maximize the y support, without a span formula. */
function jawSpan(z: number, m: number, a: number, x: number, j: number, k: number): number {
  const rb = m * z * Math.cos(a) / 2, ra = m * (z / 2 + 1 + x);
  const pitchHalf = (m * (Math.PI / 2 + 2 * x * Math.tan(a)) - j) / (m * z);
  const phase = pitchHalf + Math.tan(a) - a + (k - 1) * Math.PI / z;
  const upper = Math.sqrt((ra / rb) ** 2 - 1);
  const position = (u: number) => {
    // Involute unwound from a base circle, then reflected and rotated to the outer flank.
    const ix = rb * (Math.cos(u) + u * Math.sin(u)), iy = -rb * (Math.sin(u) - u * Math.cos(u));
    return { x: ix * Math.cos(phase) - iy * Math.sin(phase), y: ix * Math.sin(phase) + iy * Math.cos(phase) };
  };
  // Find the zero of a central-difference tangent's y component, not u=phase by substitution.
  const dy = (u: number) => (position(u + 1e-5).y - position(u - 1e-5).y) / 2e-5;
  let lo = 1e-4, hi = upper;
  assert.ok(dy(lo) > 0 && dy(hi) < 0, 'oracle needs an interior jaw contact');
  for (let n = 0; n < 70; n++) { const mid = (lo + hi) / 2; if (dy(mid) > 0) lo = mid; else hi = mid; }
  const contact = position((lo + hi) / 2);
  close(contact.x, rb, 1e-7);
  return 2 * contact.y;
}

/** Independent 3×3 system solve, used for all corners of the reading-error box. */
function solveReadings(input: SpanMeasurementInput, y: SpanReadings) {
  const a = input.pressureAngleDeg! * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const row = (k: number, w: number) => [c * (Math.PI * (k - .5) + input.teeth * (Math.tan(a) - a)), 2 * s, -c, w];
  const matrix = [row(input.spanTeeth, y.spanMm), row(input.spanTeeth + 1, y.nextSpanMm), [input.teeth + 2, 2, 0, y.tipDiameterMm]];
  for (let col = 0; col < 3; col++) {
    const divisor = matrix[col][col]; for (let j = col; j < 4; j++) matrix[col][j] /= divisor;
    for (let row = 0; row < 3; row++) if (row !== col) {
      const factor = matrix[row][col]; for (let j = col; j < 4; j++) matrix[row][j] -= factor * matrix[col][j];
    }
  }
  return { m: matrix[0][3], x: matrix[1][3] / matrix[0][3], j: matrix[2][3] };
}

test('95 independently generated jaw fixtures recover their parameters and actual contact radii', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/span-jaw-cases.json', import.meta.url), 'utf8')) as {
    cases: { z: number; m: number; alpha: number; x: number; j: number; k: number; Wk: number; Wnext: number; da: number; r1: number; r2: number }[] };
  assert.equal(fixture.cases.length, 95);
  for (const row of fixture.cases) {
    const result = exact(base({ teeth: row.z, spanTeeth: row.k, pressureAngleDeg: row.alpha,
      spanMm: row.Wk, nextSpanMm: row.Wnext, tipDiameterMm: row.da, errorBounds: zeroErrors }));
    close(result.raw!.moduleMm, row.m, 2e-11); close(result.raw!.profileShift, row.x, 2e-11); close(result.raw!.toothThinningMm, row.j, 2e-11);
    close(result.exact!.geometry.contacts[0].radiusMm, row.r1, 5e-9); close(result.exact!.geometry.contacts[1].radiusMm, row.r2, 5e-9);
    // Also make the numerical-contact fixture reproducible through the independent local oracle.
    close(jawSpan(row.z, row.m, row.alpha * Math.PI / 180, row.x, row.j, row.k), row.Wk, 2e-9);
    close(jawSpan(row.z, row.m, row.alpha * Math.PI / 180, row.x, row.j, row.k + 1), row.Wnext, 2e-9);
  }
});

/** Exhaustive 27 active sets; no multiplier bracketing/bisection from the implementation. */
function enumeratedZeroFit(input: SpanMeasurementInput) {
  const keys = ['spanMm', 'nextSpanMm', 'tipDiameterMm'] as const;
  const c = keys.map(key => solveReadings(input, { ...zeroErrors, [key]: 1 }).j), e = keys.map(key => input.errorBounds[key]);
  const target = -solveReadings(input, input).j;
  let best: { delta: number[]; objective: number } | null = null;
  for (let state = 0; state < 27; state++) {
    const modes = [state % 3 - 1, Math.floor(state / 3) % 3 - 1, Math.floor(state / 9) - 1];
    const delta = modes.map((mode, i) => mode * e[i]);
    const remaining = target - delta.reduce((sum, d, i) => sum + d * c[i], 0);
    const denominator = modes.reduce((sum, mode, i) => sum + (mode === 0 ? (c[i] * e[i]) ** 2 : 0), 0);
    if (denominator === 0) { if (Math.abs(remaining) > 1e-12) continue; }
    else for (let i = 0; i < 3; i++) if (modes[i] === 0) delta[i] = remaining * c[i] * e[i] ** 2 / denominator;
    if (delta.some((d, i) => Math.abs(d) > e[i] + 1e-12)) continue;
    const objective = delta.reduce((sum, d, i) => sum + (e[i] === 0 ? 0 : (d / e[i]) ** 2), 0);
    if (!best || objective < best.objective) best = { delta, objective };
  }
  return best;
}

test('bounded fits agree with an independent 27-active-set minimizer, including unequal and fixed errors', () => {
  for (const w of [15.44, 15.45]) for (const errors of [[.01, .01, .01], [.02, .003, .01], [0, .02, .04], [.02, 0, 0]]) {
    const input = base({ spanMm: w, nextSpanMm: 21.34,
      errorBounds: { spanMm: errors[0], nextSpanMm: errors[1], tipDiameterMm: errors[2] } });
    const expected = enumeratedZeroFit(input), result = analyzeSpanMeasurement(input);
    if (!expected) { assert.equal(result.zeroThinningFit, null); continue; }
    assert.ok(result.zeroThinningFit, JSON.stringify(result.issues));
    const d = result.zeroThinningFit.residuals;
    [d.spanMm, d.nextSpanMm, d.tipDiameterMm].forEach((value, i) => close(value, expected.delta[i], 2e-11));
  }
});

test('KHK Table 5.10 span 32.8266 mm agrees with the Cartesian jaw construction and recovers m/x/j', () => {
  const a = 20 * Math.PI / 180, w4 = jawSpan(24, 3, a, .4, 0, 4), w5 = jawSpan(24, 3, a, .4, 0, 5);
  close(w4, 32.8266, .00005); close(w5, 41.683021550944275);
  const result = exact(base({ spanTeeth: 4, spanMm: w4, nextSpanMm: w5, tipDiameterMm: 80.4, errorBounds: zeroErrors }));
  close(result.exact!.parameters.module, 3); close(result.exact!.parameters.profileShift, .4); close(result.exact!.parameters.backlash, 0);
  const contacts = result.exact!.geometry.contacts;
  close(contacts[0].radiusMm, 37.600447647225884); close(contacts[1].radiusMm, 39.73368055623867);
});

test('independent parallel-jaw contacts recover nonstandard modules, shifts and per-gear thinning', () => {
  const rows = [
    { z: 24, m: 2, x: 0, j: .08, a: 20, k: 3 },
    { z: 37, m: 1.25, x: .3, j: .025, a: 20, k: 5 },
    { z: 40, m: 2.137, x: .2, j: .061, a: 25, k: 6 },
    { z: 60, m: .4, x: .3, j: .006, a: 14.5, k: 6 },
  ];
  for (const row of rows) {
    const a = row.a * Math.PI / 180;
    const result = exact(base({ teeth: row.z, spanTeeth: row.k, pressureAngleDeg: row.a,
      spanMm: jawSpan(row.z, row.m, a, row.x, row.j, row.k),
      nextSpanMm: jawSpan(row.z, row.m, a, row.x, row.j, row.k + 1),
      tipDiameterMm: row.m * (row.z + 2 + 2 * row.x) }));
    close(result.raw!.moduleMm, row.m); close(result.raw!.profileShift, row.x); close(result.raw!.toothThinningMm, row.j);
  }
});

test('zero thinning with zero measurement errors is usable; arithmetic zero is explicitly recorded', () => {
  const result = exact(base({ spanMm: 15.432923068267584, nextSpanMm: 21.33718593645468, errorBounds: zeroErrors }));
  assert.equal(result.exact!.parameters.backlash, 0);
  assert.equal(result.exact!.arithmetic.canonicalizedNumericalZero, true);
  assert.ok(Math.abs(result.raw!.toothThinningMm) <= result.exact!.arithmetic.zeroRoundoffToleranceMm);
  assert.equal(result.zeroThinningFit, null);
});

test('real negative thinning cannot apply exact inverse, but a selected bounded fit preserves every raw reading', () => {
  const input = base({ spanMm: 15.44, nextSpanMm: 21.34, errorBounds: { spanMm: .01, nextSpanMm: .01, tipDiameterMm: .01 } });
  const result = analyzeSpanMeasurement(input);
  assert.equal(result.status, 'resolution-required'); assert.equal(result.exact, null); assert.ok(result.zeroThinningFit);
  close(result.raw!.toothThinningMm, -.005723894849889888);
  assert.throws(() => selectSpanApplication(result, 'exact-inverse'));
  const selected = selectSpanApplication(result, 'bounded-zero-thinning-fit');
  assert.deepEqual(selected.input, input); assert.equal(selected.candidate.parameters.backlash, 0);
  for (const key of ['spanMm', 'nextSpanMm', 'tipDiameterMm'] as const)
    assert.ok(Math.abs(selected.candidate.residuals[key]) <= input.errorBounds[key] + 1e-12);
  assert.notEqual(selected.candidate.representativeReadings.tipDiameterMm, input.tipDiameterMm, 'fit must not be recomputed with raw diameter');
  close(predictedSpanMm(selected.candidate.parameters, 3), selected.candidate.representativeReadings.spanMm);
});

test('bounded fit reaches an active error bound where unconstrained WLS would leave the reading box', () => {
  const result = analyzeSpanMeasurement(base({ spanMm: 15.45, nextSpanMm: 21.34,
    errorBounds: { spanMm: .01, nextSpanMm: .01, tipDiameterMm: .01 } }));
  assert.ok(result.zeroThinningFit, JSON.stringify(result.issues));
  close(result.zeroThinningFit.residuals.spanMm, -.01);
  close(result.zeroThinningFit.residuals.nextSpanMm, -.007772544868649703);
  close(result.zeroThinningFit.residuals.tipDiameterMm, .006672987678259004);
});

test('zero-error readings stay fixed during fit, and an infeasible measurement box never creates a result', () => {
  const fixed = analyzeSpanMeasurement(base({ spanMm: 15.44, nextSpanMm: 21.34,
    errorBounds: { spanMm: .02, nextSpanMm: .03, tipDiameterMm: 0 } }));
  assert.ok(fixed.zeroThinningFit); close(fixed.zeroThinningFit.residuals.tipDiameterMm, 0, 1e-12);
  const impossible = analyzeSpanMeasurement(base({ spanMm: 15.44, nextSpanMm: 21.34, errorBounds: zeroErrors }));
  assert.equal(impossible.zeroThinningFit, null); assert.equal(impossible.exact, null);
  assert.ok(impossible.issues.some(issue => issue.code === 'NO_ADMISSIBLE_ZERO_FIT'));
});

test('subnormal error bound does not overflow the bounded-fit multiplier or square an error to zero', () => {
  const result = analyzeSpanMeasurement(base({ spanMm: 15.44, nextSpanMm: 21.34,
    errorBounds: { spanMm: 1e-320, nextSpanMm: .01, tipDiameterMm: .02 } }));
  assert.ok(result.zeroThinningFit, JSON.stringify(result.issues));
  close(result.zeroThinningFit.residuals.spanMm, 0);
  close(result.zeroThinningFit.residuals.nextSpanMm, -.0034195649845590367);
  close(result.zeroThinningFit.residuals.tipDiameterMm, .01174324002889036);
});

test('conditional deterministic intervals contain independently solved corners and retain exact thinning extrema', () => {
  const input = base({ errorBounds: { spanMm: .002, nextSpanMm: .003, tipDiameterMm: .011 } });
  const result = exact(input), bounds = result.uncertainty!;
  const results = [];
  for (let mask = 0; mask < 8; mask++) {
    const readings = { spanMm: input.spanMm + (mask & 1 ? 1 : -1) * input.errorBounds.spanMm,
      nextSpanMm: input.nextSpanMm + (mask & 2 ? 1 : -1) * input.errorBounds.nextSpanMm,
      tipDiameterMm: input.tipDiameterMm + (mask & 4 ? 1 : -1) * input.errorBounds.tipDiameterMm };
    const solved = solveReadings(input, readings); results.push(solved);
    for (const [value, range] of [[solved.m, bounds.moduleMm], [solved.x, bounds.profileShift], [solved.j, bounds.toothThinningMm]] as const)
      assert.ok(value >= range.min - 1e-11 && value <= range.max + 1e-11);
  }
  close(bounds.toothThinningMm.min, Math.min(...results.map(row => row.j)));
  close(bounds.toothThinningMm.max, Math.max(...results.map(row => row.j)));
  close(bounds.moduleMm.min, Math.min(...results.map(row => row.m)));
  close(bounds.profileShift.max, Math.max(...results.map(row => row.x)));
  assert.equal(bounds.angleToleranceIncluded, false);
  assert.match(bounds.contactValidity, /representative-only/);
  assert.ok(bounds.differenceConditionNumber > 1);
});

test('unknown pressure angle, unconfirmed facts, other families and wrong diameter methods cannot apply', () => {
  const missingAngle = analyzeSpanMeasurement(base({ pressureAngleDeg: null, pressureAngleConfirmed: false }));
  assert.equal(missingAngle.status, 'missing'); assert.equal(missingAngle.exact, null);
  for (const kind of ['helical', 'internal', 'bevel', 'cycloidal']) {
    assert.equal(analyzeSpanMeasurement(base({ kind })).status, 'invalid');
  }
  for (const key of ['teeth', 'involute', 'standardTip', 'measurementSetup'] as const) {
    const input = base(); input.confirmations[key] = false;
    assert.equal(analyzeSpanMeasurement(input).status, 'missing');
  }
  assert.equal(analyzeSpanMeasurement(base({ tipDiameterMethod: 'uncorrected_caliper_span' })).exact, null);
  assert.equal(analyzeSpanMeasurement(base({ teeth: 25, tipDiameterMethod: 'opposed_tips' })).exact, null);
});

test('bad readings, k, errors and a nonpositive base-pitch interval are rejected without clipping', () => {
  for (const changes of [{ nextSpanMm: 15 }, { spanTeeth: 0 }, { spanTeeth: 3.5 }, { spanTeeth: 24 },
    { errorBounds: { ...zeroErrors, spanMm: -1 } }, { errorBounds: { ...zeroErrors, spanMm: 8 } }]) {
    const result = analyzeSpanMeasurement(base(changes)); assert.equal(result.status, 'invalid'); assert.equal(result.exact, null);
  }
});

test('both spans must contact actual generated involutes, not a fillet, tip arc or continued theoretical curve', () => {
  const p: SpanParameters = { kind: 'spur', teeth: 24, module: 2, pressureAngleDeg: 20, helixAngleDeg: 0,
    profileShift: 0, backlash: .08, toolTipRadiusCoefficient: .3 };
  const profile = buildGearProfile({ ...p, width: 10, bore: 8 });
  close(exact(base()).exact!.geometry.generatedJoinRadiusMm, profile.rootDiagnostics!.joinRadius);
  for (const k of [1, 5]) {
    const result = analyzeSpanMeasurement(base({ spanTeeth: k, spanMm: predictedSpanMm(p, k), nextSpanMm: predictedSpanMm(p, k + 1) }));
    assert.equal(result.exact, null); assert.ok(result.issues.some(issue => issue.code === 'PROFILE_OR_CONTACT_DOMAIN'));
  }
});

test('applied evidence owns its measurements; matching ignores body dimensions but invalidates derived geometry edits', () => {
  const result = exact(base()), app = selectSpanApplication(result, 'exact-inverse');
  result.input.spanMm = 0; result.exact!.parameters.module = 99;
  close(app.input.spanMm, 15.357747658604712); close(app.candidate.parameters.module, 2);
  assert.equal(spanApplicationMatches(app, app.candidate.parameters), true);
  assert.equal(spanApplicationMatches(app, { ...app.candidate.parameters, profileShift: .1 }), false);
  assert.equal(spanApplicationMatches(app, { ...app.candidate.parameters, toolTipRadiusCoefficient: .31 }), false);
});
