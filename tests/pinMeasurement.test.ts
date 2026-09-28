import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGearProfile, type GearParams, type Point2 } from '../lib/gearMath.ts';
import { idealPinDiameter, recommendedPinDiameter, inverseInvolute, inversePinMeasurement, pinMeasurement } from '../lib/pinMeasurement.ts';
import { involute } from '../lib/gearMath.ts';

const p = (patch: Partial<GearParams> = {}): GearParams => ({ kind: 'spur', teeth: 24, module: 2, pressureAngleDeg: 20, helixAngleDeg: 0,
  width: 10, bore: 0, profileShift: 0, backlash: 0, ...patch });
const close = (a: number, b: number, e: number, msg?: string) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b} ± ${e} ${msg ?? ''}`);
function distanceToLoop(c: Point2, loop: Point2[]) {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(c.x - a.x - t * dx, c.y - a.y - t * dy)); }
  return best;
}

test('inverse involute round-trips', () => { for (const a of [.05, .3, .6, 1.1]) close(inverseInvolute(involute(a)), a, 1e-13); });

test('hand-checked example: m=1, z=20, α=20°, x=0, dp=1.7 mm gives M ≈ 22.2941', () => {
  // inv φ = 1.7/(20·cos20°) − π/40 + inv20° = 0.026819 → φ = 24.13°, d0 = 18.794/cos φ, M = d0 + dp.
  const r = pinMeasurement(p({ module: 1, teeth: 20 }), 1.7);
  close(r.measurementMm, 22.2941, 5e-4);
});

for (const [name, patch] of [['spur even', {}], ['spur odd x=+0.3 thinning', { teeth: 25, profileShift: .3, backlash: .06 }], ['spur x=-0.2', { teeth: 40, profileShift: -.2 }]] as const)
  test(`${name}: the pin touches the built external profile at the predicted centre`, () => {
    const params = p(patch), dp = +recommendedPinDiameter(params).toFixed(2), r = pinMeasurement(params, dp);
    const outline = buildGearProfile(params, 48).outer, z = params.teeth, centre = { x: r.centreDiameterMm / 2 * Math.cos(Math.PI / z), y: r.centreDiameterMm / 2 * Math.sin(Math.PI / z) };
    close(distanceToLoop(centre, outline), dp / 2, 2e-3 * params.module);
    assert.deepEqual(r.issues, []);
    assert.ok(r.contactDiameterMm! > r.centreDiameterMm * 0 && r.centreDiameterMm + dp > buildGearProfile(params).dimensions.tipDiameter);
  });

test('internal spur: the pin touches the built internal profile', () => {
  const params = p({ kind: 'internal', teeth: 60, profileShift: .2 }), dp = +idealPinDiameter(params).toFixed(2), r = pinMeasurement(params, dp);
  const hole = buildGearProfile(params, 48).hole!, z = params.teeth;
  const at = (angle: number) => distanceToLoop({ x: r.centreDiameterMm / 2 * Math.cos(angle), y: r.centreDiameterMm / 2 * Math.sin(angle) }, hole);
  // Internal teeth are centred on angle 0, so the space bisector is π/z.
  close(at(Math.PI / z), dp / 2, 2e-3 * params.module);
  assert.deepEqual(r.issues, []);
  assert.ok(r.measurementMm < r.centreDiameterMm && r.internal);
});

test('ideal pin for a standard gear is about 1.68 m', () => close(idealPinDiameter(p({ teeth: 200 })) / 2, 1.68, .01));

test('inverse recovers thickness, equivalent x and thinning', () => {
  for (const kind of ['spur', 'helical', 'internal'] as const) for (const teeth of [23, 40]) {
    const truth = p({ kind, teeth: kind === 'internal' ? teeth + 40 : teeth, helixAngleDeg: kind === 'helical' ? 15 : 0, profileShift: .25, backlash: .04 });
    const dp = +idealPinDiameter(truth).toFixed(3), M = pinMeasurement(truth, dp).measurementMm;
    const guess = { ...truth, profileShift: 0, backlash: 0 }, inv = inversePinMeasurement(guess, dp, M);
    close(inv.thinningAtCurrentShiftMm, -(2 * .25 * 2 * Math.tan(20 * Math.PI / 180) * (kind === 'internal' ? -1 : 1)) + .04, 1e-9, kind);
    const back = inversePinMeasurement(truth, dp, M);
    close(back.thinningAtCurrentShiftMm, .04, 1e-9, kind);
    close(pinMeasurement({ ...guess, profileShift: inv.equivalentProfileShift }, dp).measurementMm, M, 1e-9, kind);
  }
});

test('warnings for unsuitable pins and non-involute kinds', () => {
  assert.throws(() => pinMeasurement(p(), 1), /слишком мал/);
  assert.ok(pinMeasurement(p(), 3).issues.some(s => s.includes('не выступают')));
  assert.ok(pinMeasurement(p({ teeth: 30 }), 2.2).issues.some(s => s.includes('ниже рабочей')));
  assert.ok(pinMeasurement(p(), 7).issues.some(s => s.includes('выше вершины')));
  assert.equal(pinMeasurement(p({ kind: 'helical', helixAngleDeg: 20 }), 3.4).method, 'two-balls');
  assert.throws(() => pinMeasurement(p({ kind: 'rack' }), 3));
  assert.throws(() => pinMeasurement(p(), 0));
});
