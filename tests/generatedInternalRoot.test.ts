import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGearMesh, buildGearProfile, deriveGear, exportBinarySTL, validateMesh, type GearParams, type Point2 } from '../lib/gearMath.ts';
import { deriveInternalCutter, internalRootPoint, internalRootDerivative } from '../lib/generatedInternalRoot.ts';
import { buildModelMesh, defaultModel } from '../lib/model.ts';
import { cutterSweep } from './internal-cutter-oracle.ts';
const base: GearParams = { kind: 'internal', teeth: 80, module: 2, pressureAngleDeg: 20, helixAngleDeg: 0, width: 10, bore: 0, profileShift: 0, backlash: .08 };
const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} ±${tol}`);
const area = (p: Point2[]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - a.y * b.x; }, 0) / 2;
const variants: GearParams[] = [base,
  { ...base, profileShift: .4, internalCutterTeeth: 30, internalCutterProfileShift: .1 },
  { ...base, backlash: .16, internalCutterTeeth: 30, internalCutterThinning: .06 },
  { ...base, profileShift: -.2, internalCutterProfileShift: -.1 },
  { ...base, module: .2, backlash: .008, width: 1 },
];
test('actual cutter-driven root and normalized default80/24 dimensions replace nominal1.25m depth', () => {
  const d = deriveGear(base), g = d.internalCutterGeometry!;
  assert.equal(defaultModel('internal').teeth, 80); assert.equal(d.params.internalCutterTeeth, 24);
  close(g.generatingPressureAngleDeg, 20.303883032055182); close(g.generatingCenterDistance, 56.10910226512397);
  close(g.joinRadius, 82.02146780843638); close(d.dimensions.rootDiameter, 165.21820453024793);
  close(d.dimensions.tipDiameter, 156); close(d.dimensions.dedendum, 2.6091022651239655);
  close(d.dimensions.outsideDiameter - d.dimensions.rootDiameter, 12);
  assert.equal(g.tool.provenance, 'specified-or-assumed; not-inferred-from-photo');
});
test('both thickness reductions affect generating distance, not only a phase rotation', () => {
  for (const p of variants) {
    const g = deriveInternalCutter(p), oracle = cutterSweep(p);
    close(g.generatingCenterDistance, oracle.a, 2e-10 * p.module);
    close(g.rootRadius, oracle.a + oracle.co, 2e-10 * p.module);
    const an = p.pressureAngleDeg * Math.PI / 180, ag = g.generatingPressureAngleDeg * Math.PI / 180;
    const delta = Math.tan(ag) - ag - (Math.tan(an) - an), wc = g.generatingCenterDistance / g.ratioMinusOne, wg = wc * p.teeth / g.tool.teeth;
    const sc = p.module * (Math.PI / 2 + 2 * g.tool.profileShift * Math.tan(an)) - g.tool.thinning;
    close(wg * (g.toothThickness / g.pitchRadius + 2 * delta) + wc * (sc / g.cutterPitchRadius - 2 * delta), 2 * Math.PI * wg / p.teeth);
  }
  assert.ok(deriveInternalCutter({ ...base, internalCutterThinning: .03 }).rootRadius > deriveInternalCutter(base).rootRadius);
});
test('exact half-pitch phase, Cartesian involute position, tool-circle tangency and join derivative', () => {
  for (const p of variants) {
    const g = deriveInternalCutter(p), t = g.joinRoll, an = p.pressureAngleDeg * Math.PI / 180;
    const rotation = g.toothThickness / (2 * g.pitchRadius) - (Math.tan(an) - an);
    const x = g.baseRadius * (Math.cos(t) + t * Math.sin(t)), y = g.baseRadius * (Math.sin(t) - t * Math.cos(t));
    const e = internalRootPoint(g, g.phiJoin), v = internalRootDerivative(g, g.phiJoin);
    close(g.phase, Math.PI / p.teeth, 0);
    close(e.x, x * Math.cos(rotation) - y * Math.sin(rotation)); close(e.y, x * Math.sin(rotation) + y * Math.cos(rotation));
    close(Math.atan2(v.y, v.x), rotation + t); close(g.joinError, 0, 1e-10); close(g.tangentErrorDeg, 0, 1e-10);
    const root = internalRootPoint(g, g.phiRoot), rootTangent = internalRootDerivative(g, g.phiRoot);
    close(Math.hypot(root.x, root.y), g.rootRadius); close(Math.atan2(root.y, root.x), g.rootStartAngle);
    close((root.x * rootTangent.x + root.y * rootTangent.y) / Math.hypot(rootTangent.x, rootTangent.y), 0, 1e-10);
    const h = 1e-6, before = internalRootPoint(g, g.phiJoin - h), after = internalRootPoint(g, g.phiJoin + h);
    close(v.x, (after.x - before.x) / (2 * h), 1e-5 * p.module); close(v.y, (after.y - before.y) / (2 * h), 1e-5 * p.module);
  }
});
test('whole bounded cutter sweep independently recovers root radius and working flank without stock penetration', () => {
  for (const p of variants) {
    const g = deriveInternalCutter(p), oracle = cutterSweep(p);
    for (const f of [0, .2, .5, .8, 1]) {
      const q = internalRootPoint(g, g.phiJoin + (g.phiRoot - g.phiJoin) * f), r = Math.hypot(q.x, q.y), a = Math.atan2(q.y, q.x);
      assert.ok(r > oracle.a + oracle.cb, 'Root oracle excludes every point of the arbitrary below-base closure');
      close(oracle.radialBoundary(a), r, 2e-8 * p.module);
    }
    for (let i = 0; i <= 12; i++) {
      const t = g.tipRoll + (g.joinRoll - g.tipRoll) * i / 12;
      const r = g.baseRadius * Math.hypot(1, t), a = g.halfTipAngle + t - Math.atan(t) - (g.tipRoll - Math.atan(g.tipRoll));
      close(oracle.margin(r, a), 0, 2e-9 * p.module);
    }
  }
});
test('64 independent parameter fixtures retain bounded-tool contact, remote-branch clearance and closed meshes', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/internal-cutter-matrix.json', import.meta.url), 'utf8')) as { name: string; params: GearParams }[];
  assert.equal(fixtures.length, 64);
  let reversedCurvature = 0;
  for (const { name, params } of fixtures) {
    const g = deriveInternalCutter(params), oracle = cutterSweep(params);
    if (g.ratioMinusOne < 1) reversedCurvature++;
    assert.ok(g.oppositeContactClearance > 0 && g.minimumGlobalOffsetFactor > 0, name);
    assert.ok(g.lowerToolClosure.coreRadius > 0 && g.lowerToolClosure.coreRadius + g.generatingCenterDistance < g.tipRadius, name);
    for (let i = 0; i <= 8; i++) {
      const q = internalRootPoint(g, g.phiJoin + (g.phiRoot - g.phiJoin) * i / 8);
      close(oracle.margin(Math.hypot(q.x, q.y), Math.atan2(q.y, q.x)), 0, 2e-8 * params.module);
    }
    for (let i = 0; i <= 12; i++) {
      const t = g.tipRoll + (g.joinRoll - g.tipRoll) * i / 12, angle = g.halfTipAngle + t - Math.atan(t) - (g.tipRoll - Math.atan(g.tipRoll));
      close(oracle.margin(g.baseRadius * Math.hypot(1, t), angle), 0, 2e-8 * params.module);
    }
    assert.ok(validateMesh(buildGearMesh(params)).valid, name);
  }
  assert.ok(reversedCurvature > 10, 'The global screen is exercised for k<1 as well as k>1');
});
test('global trimming screen rejects independently observed opposite-tip overcut', () => {
  for (const p of [{ ...base, teeth: 48, internalCutterTeeth: 40, backlash: 0 },
    { ...base, internalCutterTeeth: 70, pressureAngleDeg: 14.5, backlash: 0 },
    { ...base, internalCutterTeeth: 70, pressureAngleDeg: 14.5 }]) {
    assert.throws(() => deriveInternalCutter(p), { code: 'INTERNAL_CUTTER_TRIMMING_DOMAIN' });
    const r = p.module * p.teeth / 2 - p.module, rb = p.module * p.teeth / 2 * Math.cos(p.pressureAngleDeg * Math.PI / 180), t = Math.sqrt((r / rb) ** 2 - 1), an = p.pressureAngleDeg * Math.PI / 180;
    const angle = (p.module * Math.PI / 2 - p.backlash) / (p.module * p.teeth) - (Math.tan(an) - an) + t - Math.atan(t);
    assert.ok(cutterSweep(p).margin(r, angle, 1024) > .05, 'Known opposite cutter tip actually removes nominal flank stock');
  }
});
test('continuous global gates bound all remote rounded-tip motion below the ring tip', () => {
  for (const p of variants) {
    const g = deriveInternalCutter(p), a = g.generatingCenterDistance, R = g.cutterCircleCenterRadius, k = g.ratioMinusOne, rho = g.toolTipRadius;
    assert.ok(g.oppositeContactClearance > 0 && g.remoteCornerMaximumRadius < g.tipRadius && g.minimumGlobalOffsetFactor > 0);
    for (let i = 0; i <= 400; i++) {
      const c = -1 + 2 * i / 400, curvature = (k ** 3 * R ** 2 - a ** 2 + a * k * R * (1 - k) * c) / (a ** 2 + k ** 2 * R ** 2 - 2 * a * k * R * c) ** 1.5;
      assert.ok(1 + rho * curvature >= g.minimumGlobalOffsetFactor - 1e-12);
    }
    const etaEnd = -g.generatingPressureAngleDeg * Math.PI / 180 - Math.atan(g.cutterJoinRoll - rho / g.cutterBaseRadius);
    for (let i = 0; i <= 200; i++) {
      const eta = -Math.PI + (etaEnd + Math.PI) * i / 200, phi = (eta - g.cutterCircleCenterAngle) / (k + 1), q = internalRootPoint(g, phi);
      assert.ok(Math.hypot(q.x, q.y) <= g.remoteCornerMaximumRadius + 1e-9);
    }
  }
});
test('domain rejects lower cutter transition, crossed tips and budget exhaustion instead of replacing curves', () => {
  assert.throws(() => buildGearMesh({ ...base, internalCutterTeeth: 20 }), { code: 'INTERNAL_CUTTER_TIP_CONTACT' });
  for (const patch of [{ internalCutterTeeth: 80 }, { internalCutterTeeth: 24.5 }, { internalCutterThinning: -1 }, { internalCutterTipRadiusCoefficient: 0 }, { internalCutterAddendumCoefficient: 2 }]) assert.throws(() => deriveGear({ ...base, ...patch }));
  assert.throws(() => buildGearMesh({ ...base, profileTolerance: 1e-6 }), { code: 'INTERNAL_PROFILE_BUDGET' });
});
test('hole contour is strictly star shaped, symmetric and has the stated reference tooth thickness', () => {
  const p = buildGearProfile(base), hole = p.hole!, g = p.internalRootDiagnostics!, n = g.pointsPerTooth;
  for (let i = 0; i < hole.length; i++) { const a = hole[i], b = hole[(i + 1) % hole.length]; assert.ok(a.x * b.y - a.y * b.x > 0); }
  const tooth = hole.slice(0, n), pitch = 2 * Math.PI / base.teeth;
  for (const q of tooth) {
    const angle = Math.atan2(q.y, q.x), radius = Math.hypot(q.x, q.y), mirroredAngle = ((pitch - angle + g.halfTipAngle) % pitch + pitch) % pitch - g.halfTipAngle;
    assert.ok(tooth.some(v => Math.abs(Math.hypot(v.x, v.y) - radius) < 1e-9 && Math.abs(Math.atan2(v.y, v.x) - mirroredAngle) < 1e-9));
  }
  const t = Math.sqrt((g.pitchRadius / g.baseRadius) ** 2 - 1), angle = g.halfTipAngle + t - Math.atan(t) - (g.tipRoll - Math.atan(g.tipRoll));
  close(2 * g.pitchRadius * angle, g.toothThickness);
});
test('annular extrusion, welded binary STL and volume remain consistent as tolerance tightens', () => {
  const volumes: number[] = [], counts: number[] = [];
  const g = deriveInternalCutter(base), n = 4000, h = (g.phiRoot - g.phiJoin) / n;
  let integral = 0;
  for (let i = 0; i <= n; i++) { const phi = g.phiJoin + h * i, q = internalRootPoint(g, phi), v = internalRootDerivative(g, phi); integral += (q.x * v.y - q.y * v.x) * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2); }
  integral *= h / 3;
  // Green's theorem on the continuous curves; no mesh triangles or chord areas.
  const holeArea = base.teeth * (g.tipRadius ** 2 * g.halfTipAngle + g.baseRadius ** 2 * (g.joinRoll ** 3 - g.tipRoll ** 3) / 3 + integral + g.rootRadius ** 2 * g.rootLandAngle / 2);
  const exactVolume = (Math.PI * (g.rootRadius + 3 * base.module) ** 2 - holeArea) * base.width;
  for (const profileTolerance of [.02, .002, .0002]) {
    const mesh = buildGearMesh({ ...base, profileTolerance }), check = validateMesh(mesh), dg = mesh.profile.internalRootDiagnostics!;
    assert.ok(check.valid); assert.ok(dg.maxChordErrorBound <= profileTolerance); assert.ok(dg.maxSampledChordError <= dg.maxChordErrorBound + 1e-10);
    close(check.signedVolume, (area(mesh.profile.outer) - area(mesh.profile.hole!)) * base.width, .02);
    volumes.push(check.signedVolume); counts.push(check.triangles);
  }
  assert.ok(counts[2] > counts[1] && counts[1] > counts[0]);
  assert.ok(Math.abs(volumes[2] - exactVolume) < Math.abs(volumes[1] - exactVolume));
  assert.ok(Math.abs(volumes[1] - exactVolume) < Math.abs(volumes[0] - exactVolume));
  close(volumes[2], exactVolume, .16);
  const buffer = exportBinarySTL(buildGearMesh(base)), view = new DataView(buffer), positions: number[] = [], indices: number[] = [], map = new Map<string, number>();
  for (let i = 0; i < view.getUint32(80, true); i++) for (let j = 0; j < 3; j++) {
    const off = 84 + 50 * i + 12 + 12 * j, xyz = [0, 4, 8].map(n => view.getFloat32(off + n, true)), key = xyz.join(',');
    if (!map.has(key)) { map.set(key, positions.length / 3); positions.push(...xyz); } indices.push(map.get(key)!);
  }
  assert.ok(validateMesh({ positions: new Float32Array(positions), indices: new Uint32Array(indices) }).valid);
});
test('internal helix remains separate and model dispatch removes irrelevant cutter settings', () => {
  const legacy = buildGearMesh({ ...base, kind: 'internal-helical', helixAngleDeg: 20 });
  assert.equal(legacy.profile.internalRootDiagnostics, undefined); assert.equal(legacy.internalCutterGeometry, undefined);
  assert.ok(legacy.warnings.some(w => w.code === 'SIMPLIFIED_ROOT'));
  assert.throws(() => buildGearMesh({ ...base, kind: 'internal-helical', internalCutterTeeth: 24 }), { code: 'INTERNAL_CUTTER_KIND' });
  for (const kind of ['spur', 'internal-helical', 'worm', 'cycloidal', 'bevel'] as const) {
    const mesh = buildModelMesh({ ...defaultModel(kind), internalCutterTeeth: 999, internalCutterThinning: -2 });
    assert.equal(mesh.params.internalCutterTeeth, undefined); assert.ok(validateMesh(mesh).valid);
  }
});
