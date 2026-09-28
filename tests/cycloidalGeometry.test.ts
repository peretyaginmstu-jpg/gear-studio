import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultGearParams, exportBinarySTL, GearGeometryError, validateMesh } from '../lib/gearMath.ts';
import type { Point2 } from '../lib/gearMath.ts';
import { buildCycloidalMesh, deriveCycloidal } from '../lib/cycloidalGeometry.ts';
import type { CycloidalParams } from '../lib/cycloidalGeometry.ts';
import { buildModelMesh, defaultModel, modelDimensionsForReport, modelNames } from '../lib/model.ts';
import { assessPrint, defaultPrintSettings } from '../lib/printability.ts';

const PI = Math.PI, TAU = 2 * PI;
const p = (values: Partial<CycloidalParams> = {}): CycloidalParams => ({ ...defaultGearParams,
  kind: 'cycloidal', helixAngleDeg: 0, ...values });
const close = (actual: number, expected: number, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ±${tolerance}`);
const rotate = (v: Point2, a: number): Point2 => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
const area = (points: Point2[]) => points.reduce((sum, a, j) => {
  const b = points[(j + 1) % points.length]; return sum + a.x * b.y - a.y * b.x;
}, 0) / 2;
function segmentDistance(v: Point2, a: Point2, b: Point2) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((v.x - a.x) * dx + (v.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(v.x - a.x - t * dx, v.y - a.y - t * dy);
}
function roundtripSTL(buffer: ArrayBuffer) {
  const data = new DataView(buffer), count = data.getUint32(80, true), positions: number[] = [], indices: number[] = [];
  const vertexMap = new Map<string, number>();
  assert.equal(buffer.byteLength, 84 + 50 * count);
  for (let triangle = 0; triangle < count; triangle++) for (let vertex = 0; vertex < 3; vertex++) {
    const start = 84 + 50 * triangle + 12 + 12 * vertex;
    const xyz = [0, 4, 8].map(offset => data.getFloat32(start + offset, true));
    assert.ok(xyz.every(Number.isFinite)); const key = xyz.join(','); let id = vertexMap.get(key);
    if (id === undefined) { id = positions.length / 3; vertexMap.set(key, id); positions.push(...xyz); } indices.push(id);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

test('cycloidal dimensions use reference pitch/pi and an explicit tooth-height system', () => {
  const input = p({ teeth: 24, module: 3, backlash: 0.12 }), { params, dimensions: d, cycloidalDimensions: c, warnings } = deriveCycloidal(input);
  close(d.pitchDiameter, 72); close(d.tipDiameter, 78); close(d.rootDiameter, 64.5);
  close(d.transverseCircularPitch, PI * 3); close(c.referenceModule, 3); close(c.rollingRadius, 6);
  close(c.referenceToothThickness, PI * 3 / 2 - 0.12); close(params.cycloidRollingRadius!, 6);
  assert.equal(c.toothSystem, 'ha=m; hf=1.25m'); assert.equal(c.constantPressureAngleDeg, null);
  assert.equal(c.baseCircleDiameter, null); assert.equal(c.basePitch, null);
  assert.ok(warnings.some(w => w.code === 'CYCLOIDAL_PAIR_REQUIRED'));
  assert.ok(warnings.some(w => w.code === 'CYCLOIDAL_TOOTH_SYSTEM'));
  close(deriveCycloidal(p({ teeth: 6, bore: 0 })).cycloidalDimensions.rollingRadius, 3);
});

test('sampled flanks agree with independent Cartesian rolling-circle equations', () => {
  for (const rollingRadius of [3, 4, 12]) {
    const input = p({ cycloidRollingRadius: rollingRadius, profileTolerance: 0.001 });
    const mesh = buildCycloidalMesh(input), c = mesh.cycloidalDimensions, R = 24, r = rollingRadius;
    const half = (PI * input.module / 2 - input.backlash) / (2 * R);
    for (const curve of ['epi', 'hypo'] as const) for (let j = 0; j <= 120; j++) {
      const t = (curve === 'epi' ? c.addendumRollAngleRad : c.dedendumRollAngleRad) * j / 120;
      // Direct no-slip position: centre of the rolling circle plus its rim vector.
      const centreRadius = curve === 'epi' ? R + r : R - r;
      const spin = centreRadius / r * t;
      const base = curve === 'epi'
        ? { x: centreRadius * Math.cos(t) - r * Math.cos(spin), y: centreRadius * Math.sin(t) - r * Math.sin(spin) }
        : { x: centreRadius * Math.cos(t) + r * Math.cos(spin), y: centreRadius * Math.sin(t) - r * Math.sin(spin) };
      const expected = rotate({ x: base.x, y: curve === 'epi' ? base.y : -base.y }, -half);
      let nearest = Infinity;
      const points = mesh.profile.outer, n = mesh.cycloidalDiagnostics.outerPointsPerTooth;
      for (let i = 0; i < n; i++) nearest = Math.min(nearest, segmentDistance(expected, points[i], points[i + 1]));
      assert.ok(nearest <= 0.001000001, JSON.stringify({ curve, j, rollingRadius, nearest }));
      if (j % 10 === 0 && (curve === 'epi' || rollingRadius !== 12)) {
        const closestVertex = Math.min(...points.slice(0, n + 1).map(v => Math.hypot(v.x - expected.x, v.y - expected.y)));
        close(closestVertex, 0, 1e-9);
      }
    }
    assert.ok(mesh.cycloidalDiagnostics.maxChordErrorBound <= 0.001);
    assert.ok(mesh.cycloidalDiagnostics.maxSampledChordError <= 0.001);
  }
});

test('r=R/2 is an exact radial hypocycloid and remains valid with a shaft hole', () => {
  const input = p({ cycloidRollingRadius: 12 }), mesh = buildCycloidalMesh(input);
  const half = mesh.cycloidalDimensions.referenceToothThickness / 48;
  assert.equal(mesh.cycloidalDiagnostics.radialDedendum, true);
  const t = mesh.cycloidalDimensions.dedendumRollAngleRad;
  close(24 * Math.cos(t), 21.5);
  for (const sign of [-1, 1]) for (const radius of [21.5, 22, 23, 24]) {
    const expected = rotate({ x: radius, y: 0 }, sign * half), outline = mesh.profile.outer;
    const distance = Math.min(...outline.map((a, j) => segmentDistance(expected, a, outline[(j + 1) % outline.length])));
    close(distance, 0, 1e-9);
  }
  assert.ok(validateMesh(mesh).valid); assert.ok(validateMesh(roundtripSTL(exportBinarySTL(mesh))).valid);
});

test('tooth symmetry, angular pitch and reference-circle thinning are exact', () => {
  const input = p({ backlash: 0.3 }), mesh = buildCycloidalMesh(input), points = mesh.profile.outer;
  const n = mesh.cycloidalDiagnostics.outerPointsPerTooth, pitch = TAU / input.teeth;
  for (let j = 0; j < points.length; j++) {
    const expected = rotate(points[j], pitch), actual = points[(j + n) % points.length];
    close(expected.x, actual.x); close(expected.y, actual.y);
  }
  for (const a of points.slice(0, n + 1)) {
    const mirror = Math.min(...points.slice(0, n + 1).map(b => Math.hypot(a.x - b.x, a.y + b.y)));
    close(mirror, 0, 1e-8);
  }
  const pitchPoints = points.slice(0, n + 1).filter(v => Math.abs(Math.hypot(v.x, v.y) - 24) < 1e-8);
  assert.equal(pitchPoints.length, 2);
  const width = (Math.atan2(pitchPoints[1].y, pitchPoints[1].x) - Math.atan2(pitchPoints[0].y, pitchPoints[0].x)) * 24;
  close(width, PI - 0.3);
  const unthinned = buildCycloidalMesh(p({ backlash: 0 }));
  close(unthinned.cycloidalDimensions.referenceToothThickness - width, 0.3);
});

for (const bore of [0, 8, 42]) for (const rollingRadius of [4, 12])
  test(`closed cycloidal extrusion: bore=${bore}, generating radius=${rollingRadius}`, () => {
    const mesh = buildCycloidalMesh(p({ bore, cycloidRollingRadius: rollingRadius }), { axialSegments: 3 });
    const check = validateMesh(mesh); assert.ok(check.valid, JSON.stringify(check));
    assert.equal(check.vertices - check.triangles / 2, bore ? 0 : 2);
    for (const index of mesh.indices) assert.ok(index < mesh.positions.length / 3);
    const exactPolygonVolume = (area(mesh.profile.outer) - (mesh.profile.hole ? area(mesh.profile.hole) : 0)) * mesh.params.width;
    close(check.signedVolume, exactPolygonVolume, 0.01);
    const stl = roundtripSTL(exportBinarySTL(mesh)), stlCheck = validateMesh(stl); assert.ok(stlCheck.valid, JSON.stringify(stlCheck));
    close(stlCheck.signedVolume, check.signedVolume, 1e-7);
    assert.equal(mesh.params.kind, 'cycloidal'); assert.equal(mesh.profile.params.kind, 'cycloidal');
  });

test('volume and tolerance converge to independent analytic line-integral area', () => {
  const input = p({ bore: 8, backlash: 0.08 }), c = deriveCycloidal(input).cycloidalDimensions;
  const R = 24, r = 4, ra = 26, rf = 21.5, pitch = TAU / 24, h = (PI - input.backlash) / (2 * R);
  const ta = c.addendumRollAngleRad, tf = c.dedendumRollAngleRad;
  const epiX = (R + r) * Math.cos(ta) - r * Math.cos((R + r) / r * ta);
  const epiY = (R + r) * Math.sin(ta) - r * Math.sin((R + r) / r * ta);
  const hypoX = (R - r) * Math.cos(tf) + r * Math.cos((R - r) / r * tf);
  const hypoY = (R - r) * Math.sin(tf) - r * Math.sin((R - r) / r * tf);
  const tipHalf = h - Math.atan2(epiY, epiX), rootHalf = h + Math.atan2(hypoY, hypoX);
  // Green's theorem: 1/2 ∮(x dy - y dx), integrated symbolically for each arc.
  const epiIntegral = (R + r) * (R + 2 * r) * (ta - r / R * Math.sin(R / r * ta));
  const hypoIntegral = (R - r) * (R - 2 * r) * (tf - r / R * Math.sin(R / r * tf));
  const exactArea = 24 * (epiIntegral + hypoIntegral + ra * ra * tipHalf + rf * rf * (pitch / 2 - rootHalf)) - PI * 16;
  const exactVolume = exactArea * input.width;
  const coarse = buildCycloidalMesh({ ...input, profileTolerance: 0.02 }, { flankSamples: 5 });
  const fine = buildCycloidalMesh({ ...input, profileTolerance: 0.0001 }, { flankSamples: 5 });
  const coarseError = Math.abs(validateMesh(coarse).signedVolume - exactVolume), fineError = Math.abs(validateMesh(fine).signedVolume - exactVolume);
  assert.ok(fine.profile.outer.length > coarse.profile.outer.length); assert.ok(fineError < coarseError / 20);
  close(validateMesh(fine).signedVolume, exactVolume, 0.15);
  assert.equal(fine.cycloidalDiagnostics.toleranceScope, 'analytic-2d-profile-before-float32');
});

test('constant pressure angle has no effect; generating radius materially changes the profile', () => {
  const a = buildCycloidalMesh(p({ pressureAngleDeg: 10 })), b = buildCycloidalMesh(p({ pressureAngleDeg: 35 }));
  assert.deepEqual(a.positions, b.positions); assert.deepEqual(a.indices, b.indices);
  const alternate = buildCycloidalMesh(p({ cycloidRollingRadius: 6 }));
  assert.notEqual(a.cycloidalDimensions.tipArcThickness, alternate.cycloidalDimensions.tipArcThickness);
});

test('representative sizes, tooth counts and radial dedenda remain finite and closed', () => {
  for (const moduleMm of [0.1, 2, 30]) for (const teeth of [6, 24, 90, 250]) for (const radial of [false, true]) {
    const mesh = buildCycloidalMesh(p({ module: moduleMm, teeth, width: 2 * moduleMm, bore: 0.025 * moduleMm,
      backlash: 0, cycloidRollingRadius: radial ? moduleMm * teeth / 4 : undefined }));
    const check = validateMesh(mesh); assert.ok(check.valid, JSON.stringify({ module: moduleMm, teeth, radial, check }));
    const n = mesh.cycloidalDiagnostics.outerPointsPerTooth, sector = mesh.profile.outer.slice(0, n + 1);
    let previous = -Infinity;
    for (const v of sector) {
      const angle = Math.atan2(v.y, v.x), radius = Math.hypot(v.x, v.y);
      assert.ok(angle >= previous - 1e-12); previous = angle;
      assert.ok(radius >= mesh.dimensions.rootDiameter / 2 - 1e-8 && radius <= mesh.dimensions.tipDiameter / 2 + 1e-8);
    }
  }
});

test('unreachable roots, crossed teeth, unsupported shifts and excessive meshes are rejected', () => {
  const cases: [Partial<CycloidalParams>, string][] = [
    [{ teeth: 5 }, 'TEETH_RANGE'], [{ teeth: 7.5 }, 'TEETH_RANGE'], [{ module: 0 }, 'MODULE_RANGE'],
    [{ width: 0 }, 'WIDTH_RANGE'], [{ width: NaN }, 'NON_FINITE'], [{ backlash: -1 }, 'BACKLASH_RANGE'],
    [{ bore: -1 }, 'BORE_RANGE'], [{ bore: 1e-12 }, 'BORE_RANGE'], [{ bore: 43 }, 'BORE_INTERSECTION'],
    [{ profileShift: 0.1 }, 'CYCLOIDAL_PROFILE_SHIFT'], [{ helixAngleDeg: 10 }, 'CYCLOIDAL_HELIX'],
    [{ cycloidRollingRadius: 0 }, 'CYCLOIDAL_ROLLING_RADIUS'], [{ cycloidRollingRadius: 12.1 }, 'CYCLOIDAL_ROLLING_RADIUS'],
    [{ cycloidRollingRadius: NaN }, 'NON_FINITE'], [{ cycloidRollingRadius: 1 }, 'CYCLOIDAL_ROOT_UNREACHABLE'],
    [{ cycloidRollingRadius: 1.3 }, 'CYCLOIDAL_POINTED_TOOTH'], [{ cycloidRollingRadius: 2 }, 'CYCLOIDAL_ROOT_OVERLAP'],
    [{ backlash: 3.5 }, 'TOOTH_THICKNESS'], [{ backlash: 2 }, 'CYCLOIDAL_POINTED_TOOTH'],
    [{ profileTolerance: 0 }, 'PROFILE_TOLERANCE'], [{ profileTolerance: Infinity }, 'PROFILE_TOLERANCE'],
  ];
  for (const [input, code] of cases) assert.throws(() => buildCycloidalMesh(p(input)),
    (error: unknown) => error instanceof GearGeometryError && error.code === code, JSON.stringify(input));
  for (const value of [0, -1, 1.5, NaN]) assert.throws(() => buildCycloidalMesh(p(), { flankSamples: value }));
  assert.throws(() => buildCycloidalMesh(p(), { flankSamples: 1000 }), (e: unknown) => e instanceof GearGeometryError && e.code === 'MESH_BUDGET');
  assert.throws(() => buildCycloidalMesh(p({ teeth: 250, module: 30, bore: 0, profileTolerance: 1e-6 })),
    (e: unknown) => e instanceof GearGeometryError && e.code === 'MESH_BUDGET');
  assert.throws(() => buildCycloidalMesh(p(), { axialSegments: 256 }), (e: unknown) => e instanceof GearGeometryError && e.code === 'MESH_BUDGET');
});

test('model adapter dispatches cycloidal separately and removes unrelated kernel settings', () => {
  const input = defaultModel('cycloidal'), mesh = buildModelMesh(input);
  assert.equal(Object.keys(modelNames).length, 10); assert.equal(input.helixAngleDeg, 0);
  assert.ok('cycloidalDimensions' in mesh); assert.equal(mesh.params.kind, 'cycloidal');
  assert.ok(!('wormHand' in mesh.params)); assert.ok(!('wormStarts' in mesh.params));
  if ('cycloidalDimensions' in mesh) close(mesh.cycloidalDimensions.rollingRadius, 4);
  const spur = buildModelMesh({ ...defaultModel('spur'), cycloidRollingRadius: 4 });
  assert.ok(!('cycloidRollingRadius' in spur.params)); assert.ok(validateMesh(spur).valid);
  const worm = buildModelMesh({ ...defaultModel('worm'), cycloidRollingRadius: 4 });
  assert.ok(!('cycloidRollingRadius' in worm.params)); assert.ok('wormDimensions' in worm);
  assert.throws(() => buildModelMesh({ ...input, profileShift: 0.1 }), { code: 'CYCLOIDAL_PROFILE_SHIFT' });
});

test('cycloidal reports mark involute quantities N/A and FDM uses a chord with pair limits', () => {
  const mesh = buildModelMesh(defaultModel('cycloidal')), report = modelDimensionsForReport(mesh);
  assert.equal(report.normalPressureAngleDeg, null); assert.equal(report.transversePressureAngleDeg, null);
  assert.equal(report.baseDiameter, null); assert.equal(report.basePitch, null); assert.equal(report.minimumProfileShift, null);
  close(report.pitchDiameter, 48);
  const print = assessPrint(mesh, validateMesh(mesh), defaultPrintSettings);
  assert.equal(print.status, 'warning');
  assert.ok(print.checks.find(check => check.id === 'tip')?.detail.includes('хорда'));
  assert.ok(print.checks.find(check => check.id === 'geometry')?.detail.includes('производящие окружности'));
});
