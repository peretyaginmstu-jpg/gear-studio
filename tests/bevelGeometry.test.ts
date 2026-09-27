import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultGearParams, exportBinarySTL, GearGeometryError, validateMesh } from '../lib/gearMath.ts';
import type { Point2 } from '../lib/gearMath.ts';
import { buildBevelMesh, deriveBevel, sphericalInvolutePoint } from '../lib/bevelGeometry.ts';
import type { BevelParams, Point3 } from '../lib/bevelGeometry.ts';

const PI = Math.PI, TAU = 2 * PI, DEG = PI / 180;
const p = (changes: Partial<BevelParams> = {}): BevelParams => ({ ...defaultGearParams, kind: 'bevel', teeth: 40, helixAngleDeg: 0, ...changes });
const close = (actual: number, expected: number, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ±${tolerance}`);
const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Point3, b: Point3): Point3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const length = (a: Point3) => Math.hypot(a.x, a.y, a.z);
const area = (points: Point2[]) => points.reduce((sum, a, j) => {
  const b = points[(j + 1) % points.length]; return sum + a.x * b.y - a.y * b.x;
}, 0) / 2;
const rotate = (a: Point3, t: number): Point3 => ({ x: a.x * Math.cos(t) - a.y * Math.sin(t), y: a.x * Math.sin(t) + a.y * Math.cos(t), z: a.z });
function segmentDistance(v: Point3, a: Point3, b: Point3) {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, w = { x: v.x - a.x, y: v.y - a.y, z: v.z - a.z };
  const t = Math.max(0, Math.min(1, dot(u, w) / dot(u, u)));
  return Math.hypot(w.x - t * u.x, w.y - t * u.y, w.z - t * u.z);
}
/** Independent scalar cone construction, not the kernel's Cartesian formula. */
function oracle(input: BevelParams) {
  const sigma = (input.bevelShaftAngleDeg ?? 90) * DEG;
  const dp = Math.atan2(input.teeth * Math.sin(sigma), (input.bevelMateTeeth ?? input.teeth) + input.teeth * Math.cos(sigma));
  const R = input.module * input.teeth / (2 * Math.sin(dp)), db = Math.asin(Math.sin(dp) * Math.cos(input.pressureAngleDeg * DEG));
  const df = dp - Math.atan(1.25 * input.module / R), da = dp + Math.atan(input.module / R);
  const F = (delta: number) => {
    const u = Math.acos(Math.min(1, Math.cos(delta) / Math.cos(db)));
    return u / Math.sin(db) - Math.atan(Math.tan(u) / Math.sin(db));
  };
  const half = (PI * input.module / 2 - input.backlash) / (input.module * input.teeth), halfTip = half + F(dp) - F(da), halfRoot = half + F(dp) - F(df);
  const rootZ = R * Math.cos(dp) + 1.25 * input.module * Math.sin(dp);
  const point = (delta: number, sign = -1, Q = R): Point3 => {
    const q = Math.tan(delta - dp), r = Q * (Math.sin(dp) + q * Math.cos(dp)), angle = sign * (half + F(dp) - F(delta));
    return { x: r * Math.cos(angle), y: r * Math.sin(angle), z: rootZ - Q * (Math.cos(dp) - q * Math.sin(dp)) };
  };
  return { dp, db, df, da, R, Ri: R - input.width, rootZ, F, halfTip, halfRoot, point };
}
function roundtripSTL(buffer: ArrayBuffer) {
  const data = new DataView(buffer), count = data.getUint32(80, true), positions: number[] = [], indices: number[] = [], map = new Map<string, number>();
  assert.equal(buffer.byteLength, 84 + 50 * count);
  for (let i = 0; i < count; i++) for (let j = 0; j < 3; j++) {
    const start = 84 + 50 * i + 12 + 12 * j, xyz = [0, 4, 8].map(offset => data.getFloat32(start + offset, true));
    assert.ok(xyz.every(Number.isFinite)); const key = xyz.join(','); let id = map.get(key);
    if (id === undefined) { id = positions.length / 3; map.set(key, id); positions.push(...xyz); } indices.push(id);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}
function simpson(fn: (x: number) => number, from: number, to: number, count = 12000) {
  const h = (to - from) / count;
  let sum = fn(from) + fn(to);
  for (let i = 1; i < count; i++) sum += (i % 2 ? 4 : 2) * fn(from + h * i);
  return sum * h / 3;
}

test('bevel dimensions match independent 40/40 cone and thickness values', () => {
  const { bevelDimensions: b, dimensions: d, warnings, params } = deriveBevel(p());
  close(b.outerConeDistance, 56.568542494923804); close(b.innerConeDistance, 46.568542494923804);
  close(b.baseConeAngleDeg, 41.64114326790979); close(b.tipConeAngleDeg, 47.02486829727734); close(b.rootConeAngleDeg, 42.46950696004088);
  close(b.outerPitchDiameter, 80); close(b.outerTipDiameter, 82.82842712474618); close(b.outerRootDiameter, 76.46446609406726);
  close(b.referenceSphericalInvoluteRad, 0.02059834285709522); close(b.outerTipArcThickness, 1.4848739622256768);
  close(b.innerScale, 0.8232233047033631); close(b.coreAxialHeight, 7.3835678118654755); close(b.axialExtent, 10.003048327204944);
  assert.equal(params.bevelMateTeeth, 40); assert.equal(params.bevelShaftAngleDeg, 90);
  assert.equal(b.endFaces, 'back-cones-over-teeth; planar-inside-root'); assert.equal(b.rootTransition, 'sharp-intersection-at-or-above-base-cone');
  assert.equal(b.cylindricalBaseDiameter, null); assert.equal(b.cylindricalBasePitch, null); assert.equal(d.baseDiameter, 0);
  close(b.outerReferenceSphereBaseDiameter, 80 * Math.cos(20 * DEG));
  assert.ok(warnings.some(w => w.code === 'BEVEL_PAIR_REQUIRED')); assert.ok(warnings.some(w => w.code === 'BEVEL_TOOTH_SYSTEM'));
});

test('Cartesian curve equals independent rolling great-circle construction and lies on the unit sphere', () => {
  for (const db of [8, 24, 42, 70].map(a => a * DEG)) for (let j = 0; j <= 60; j++) {
    const t = 1.2 * j / 60, u = t * Math.sin(db), base = { x: Math.sin(db), y: 0, z: Math.cos(db) };
    // Rodrigues rotation about the normal of the tangent great-circle plane,
    // followed by rotation of that plane around the base cone's axis.
    const normal = { x: -Math.cos(db), y: 0, z: Math.sin(db) }, tangent = cross(normal, base);
    const rolled = { x: base.x * Math.cos(u) - tangent.x * Math.sin(u), y: base.y * Math.cos(u) - tangent.y * Math.sin(u), z: base.z * Math.cos(u) - tangent.z * Math.sin(u) };
    const expected = rotate(rolled, t), actual = sphericalInvolutePoint(db, t);
    close(actual.x, expected.x, 1e-12); close(actual.y, expected.y, 1e-12); close(actual.z, expected.z, 1e-12);
    close(length(actual), 1, 1e-12); close(actual.z, Math.cos(db) * Math.cos(u), 1e-12);
  }
});

test('finite-difference spherical tangent recovers pressure angle at the reference cone', () => {
  for (const input of [p(), p({ teeth: 80, bevelMateTeeth: 40 }), p({ teeth: 100, bevelShaftAngleDeg: 50, pressureAngleDeg: 25 })]) {
    const o = oracle(input), b = deriveBevel(input).bevelDimensions, t = b.referenceRollAngleRad, h = 1e-6;
    const a = sphericalInvolutePoint(o.db, t - h), c = sphericalInvolutePoint(o.db, t + h), v = sphericalInvolutePoint(o.db, t);
    const tangent = { x: (c.x - a.x) / (2 * h), y: (c.y - a.y) / (2 * h), z: (c.z - a.z) / (2 * h) }, norm = length(tangent);
    const azimuth = Math.atan2(v.y, v.x), meridian = { x: Math.cos(o.dp) * Math.cos(azimuth), y: Math.cos(o.dp) * Math.sin(azimuth), z: -Math.sin(o.dp) };
    close(dot(tangent, v), 0, 1e-9); close(Math.acos(dot(tangent, meridian) / norm) / DEG, input.pressureAngleDeg, 1e-7);
    // A cylindrical involute's inv(alpha) is a different angular function.
    assert.ok(Math.abs(o.F(o.dp) - (Math.tan(input.pressureAngleDeg * DEG) - input.pressureAngleDeg * DEG)) > 1e-4);
  }
});

test('both flanks and all tooth rotations agree with independent cone-section coordinates', () => {
  const input = p({ profileTolerance: 0.0005 }), mesh = buildBevelMesh(input, { flankSamples: 5 }), o = oracle(input);
  const n = mesh.bevelDiagnostics.outerPointsPerTooth, points = mesh.profile.outerEndContour;
  for (const sign of [-1, 1]) for (let j = 0; j <= 100; j++) {
    const delta = o.df + (o.da - o.df) * j / 100, expected = o.point(delta, sign);
    let nearest = Infinity;
    for (let k = 0; k < n; k++) nearest = Math.min(nearest, segmentDistance(expected, points[k], points[k + 1]));
    assert.ok(nearest <= input.profileTolerance! * 1.00001, `${sign} ${j}: distance ${nearest}`);
  }
  for (const delta of [o.df, o.dp, o.da]) for (const sign of [-1, 1]) {
    const expected = o.point(delta, sign);
    close(Math.min(...points.slice(0, n + 1).map(v => Math.hypot(v.x - expected.x, v.y - expected.y, v.z - expected.z))), 0, 1e-10);
  }
  for (const tooth of [1, 7, 39]) for (let j = 0; j < n; j++) {
    const expected = rotate(points[j], TAU * tooth / input.teeth), actual = points[tooth * n + j];
    close(actual.x, expected.x, 1e-10); close(actual.y, expected.y, 1e-10); close(actual.z, expected.z, 1e-10);
  }
});

test('sections along the generators share an apex and scale module, height and tooth thickness', () => {
  const input = p({ bevelMateTeeth: 80, width: 14 }), mesh = buildBevelMesh(input, { axialSegments: 4 }), o = oracle(input), b = mesh.bevelDimensions;
  const count = mesh.profile.outer.length, ring = 2 * count;
  for (let layer = 0; layer <= 4; layer++) {
    const Q = o.Ri + input.width * layer / 4;
    for (let j = 0; j < count; j += 7) {
      const idx = (layer * ring + j) * 3, a = mesh.profile.outerEndContour[j];
      const source = { x: mesh.positions[idx], y: mesh.positions[idx + 1], z: o.rootZ - mesh.positions[idx + 2] };
      close(source.x, a.x * Q / o.R, 8e-6); close(source.y, a.y * Q / o.R, 8e-6); close(source.z, (o.rootZ - a.z) * Q / o.R, 8e-6);
      close(Math.hypot(source.x, source.y) * Math.sin(o.dp) + source.z * Math.cos(o.dp), Q, 8e-6);
    }
    const left = o.point(o.dp, -1, Q), right = o.point(o.dp, 1, Q), r = Q * Math.sin(o.dp);
    close((Math.atan2(right.y, right.x) - Math.atan2(left.y, left.x)) * r, b.outerReferenceToothThickness * Q / o.R);
    close(Math.hypot(o.point(o.da, -1, Q).x, o.point(o.da, -1, Q).y) - r, input.module * Math.cos(o.dp) * Q / o.R);
  }
  close(b.innerModule, input.module * o.Ri / o.R); close(b.innerTipChordThickness, 2 * b.innerTipDiameter / 2 * Math.sin(o.halfTip));
  close(b.minimumRadialBoreWall, b.innerRootDiameter / 2 - input.bore / 2);
  assert.deepEqual(b.pitchAxisDirection, { x: 0, y: 0, z: -1 }); close(b.apex.z, o.rootZ);
});

test('two acute pitch cones satisfy ratio, shaft angle and common cone distance at several axis angles', () => {
  for (const [z1, z2, sigma] of [[40, 80, 90], [80, 120, 100], [60, 60, 120], [100, 100, 30], [40, 40, 60]]) {
    const a = deriveBevel(p({ teeth: z1, bevelMateTeeth: z2, bevelShaftAngleDeg: sigma })).bevelDimensions;
    const b = deriveBevel(p({ teeth: z2, bevelMateTeeth: z1, bevelShaftAngleDeg: sigma })).bevelDimensions;
    close(a.pitchConeAngleDeg + b.pitchConeAngleDeg, sigma); close(a.matePitchConeAngleDeg, b.pitchConeAngleDeg);
    close(Math.sin(a.pitchConeAngleDeg * DEG) / Math.sin(b.pitchConeAngleDeg * DEG), z1 / z2);
    close(a.outerConeDistance, b.outerConeDistance); close(a.innerConeDistance, b.innerConeDistance);
  }
});

for (const bore of [0, 8]) test(`closed oriented STL, exact faceted volume and root-land seams with bore=${bore}`, () => {
  const input = p({ bore }), mesh = buildBevelMesh(input, { axialSegments: 3 }), check = validateMesh(mesh), b = mesh.bevelDimensions;
  assert.ok(check.valid, JSON.stringify(check)); assert.equal(check.vertices - check.triangles / 2, bore ? 0 : 2);
  const rootPoints = mesh.profile.outer.map(v => {
    const f = b.outerRootDiameter / (2 * Math.hypot(v.x, v.y)); return { x: v.x * f, y: v.y * f };
  });
  const A = area(mesh.profile.outer), Ar = area(rootPoints), Ah = mesh.profile.hole ? area(mesh.profile.hole) : 0, k = b.innerScale;
  const teethVolume = (A - Ar) * (b.outerConeDistance ** 3 - b.innerConeDistance ** 3) / (3 * b.outerConeDistance ** 2 * Math.cos(b.pitchConeAngleDeg * DEG));
  const coreVolume = Ar * b.coreAxialHeight / 3 * (1 + k + k * k) - Ah * b.coreAxialHeight;
  close(check.signedVolume, teethVolume + coreVolume, 0.008);
  const stl = roundtripSTL(exportBinarySTL(mesh)), result = validateMesh(stl);
  assert.ok(result.valid, JSON.stringify(result)); close(result.signedVolume, check.signedVolume, 1e-7);
  assert.equal(result.triangles, check.triangles); assert.equal(result.vertices, check.vertices);
  const zs = Array.from(mesh.positions).filter((_, i) => i % 3 === 2);
  close(Math.min(...zs), 0, 1e-6); close(Math.max(...zs), b.axialExtent, 1e-6);
});

test('flat core, curved tooth caps and true cylinder bore obey the stated surface tolerance', () => {
  const input = p({ teeth: 80, bevelMateTeeth: 40, profileTolerance: 0.001 }), mesh = buildBevelMesh(input), b = mesh.bevelDimensions, o = oracle(input);
  const count = mesh.profile.outer.length, ring = count * 2, get = (i: number): Point3 => ({ x: mesh.positions[3 * i], y: mesh.positions[3 * i + 1], z: mesh.positions[3 * i + 2] });
  for (const layer of [0, 1]) for (let j = 0; j < count; j++) {
    const v = get(layer * ring + count + j);
    close(Math.hypot(v.x, v.y), 4, 3e-7); close(v.z, layer ? 0 : b.coreAxialHeight, 1e-6);
  }
  const cap = (Q: number, v: Point3) => o.rootZ - (Q - Math.max(Math.hypot(v.x, v.y), b.outerRootDiameter / 2 * Q / o.R) * Math.sin(o.dp)) / Math.cos(o.dp);
  const sideTriangles = 2 * ring;
  for (let face = sideTriangles; face < mesh.indices.length / 3; face++) {
    const points = [0, 1, 2].map(j => get(mesh.indices[3 * face + j]));
    const errors = [o.Ri, o.R].map(Q => Math.max(...points.map(v => Math.abs(v.z - cap(Q, v)))));
    const Q = errors[0] < errors[1] ? o.Ri : o.R;
    assert.ok(Math.min(...errors) < 1e-5);
    for (const weights of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5]]) {
      const middle = { x: 0, y: 0, z: 0 };
      points.forEach((v, j) => { middle.x += weights[j] * v.x; middle.y += weights[j] * v.y; middle.z += weights[j] * v.z; });
      assert.ok(Math.abs(middle.z - cap(Q, middle)) <= mesh.bevelDiagnostics.maxEndCapErrorBound + 1e-5);
    }
  }
  for (const value of [mesh.bevelDiagnostics.maxFlankChordErrorBound, mesh.bevelDiagnostics.maxCircularArcChordErrorBound,
    mesh.bevelDiagnostics.maxEndCapErrorBound, mesh.bevelDiagnostics.maxBoreChordErrorBound]) assert.ok(value <= input.profileTolerance! * (1 + 1e-10));
  assert.ok(mesh.bevelDiagnostics.maxSampledFlankChordError <= mesh.bevelDiagnostics.maxFlankChordErrorBound);
});

test('volume converges to independent analytical line-integral and frustum quadrature', () => {
  const input = p(), o = oracle(input), sd = Math.sin(o.dp), cd = Math.cos(o.dp), sb = Math.sin(o.db), cb = Math.cos(o.db);
  const tf = Math.acos(Math.cos(o.df) / cb) / sb, ta = Math.acos(Math.cos(o.da) / cb) / sb;
  const flankIntegral = simpson(t => {
    const u = sb * t, cosDelta = cb * Math.cos(u), sinDelta = Math.sqrt(1 - cosDelta * cosDelta), D = sinDelta * sd + cosDelta * cd;
    // Independent polar Green integral: r² d(theta)/dt.
    return o.R ** 2 * cb ** 2 * Math.sin(u) ** 2 / (D * D);
  }, tf, ta);
  const ra = input.module * input.teeth / 2 + input.module * cd, rf = input.module * input.teeth / 2 - 1.25 * input.module * cd;
  const A = input.teeth * (flankIntegral + ra * ra * o.halfTip + rf * rf * (PI / input.teeth - o.halfRoot));
  const k = o.Ri / o.R, H = o.rootZ * (1 - k), rootArea = PI * rf * rf;
  const exact = (A - rootArea) * (o.R ** 3 - o.Ri ** 3) / (3 * o.R ** 2 * cd) + rootArea * H / 3 * (1 + k + k * k) - PI * (input.bore / 2) ** 2 * H;
  const coarse = buildBevelMesh({ ...input, profileTolerance: 0.02 }, { flankSamples: 5 });
  const fine = buildBevelMesh({ ...input, profileTolerance: 0.00008 }, { flankSamples: 5 });
  const ec = Math.abs(validateMesh(coarse).signedVolume - exact), ef = Math.abs(validateMesh(fine).signedVolume - exact);
  assert.ok(fine.profile.outer.length > coarse.profile.outer.length); assert.ok(ef < ec / 20, `coarse=${ec}, fine=${ef}`);
  close(validateMesh(fine).signedVolume, exact, 0.12);
  assert.equal(fine.bevelDiagnostics.toleranceScope, 'analytic-surfaces-before-float32');
});

test('wide but geometrically valid face widths warn rather than enforce the R/3 recommendation', () => {
  const input = p({ width: 35, bore: 3 }), mesh = buildBevelMesh(input);
  assert.ok(mesh.params.width > mesh.bevelDimensions.outerConeDistance / 3);
  assert.ok(mesh.warnings.some(w => w.code === 'BEVEL_WIDE_FACE')); assert.ok(validateMesh(mesh).valid);
});

test('representative scales, tooth counts and shaft angles remain closed after Float32', () => {
  for (const moduleValue of [0.1, 2, 30]) for (const [teeth, mate, shaft, pressureAngle] of [[40, 40, 60, 20], [40, 80, 90, 20], [80, 40, 90, 20], [100, 100, 30, 20], [60, 60, 120, 20], [250, 250, 90, 10]]) {
    const input = p({ module: moduleValue, teeth, bevelMateTeeth: mate, bevelShaftAngleDeg: shaft, pressureAngleDeg: pressureAngle, width: moduleValue * 2, bore: moduleValue * 0.05, backlash: 0 });
    const mesh = buildBevelMesh(input), check = validateMesh(mesh);
    assert.ok(check.valid, JSON.stringify({ module: moduleValue, teeth, mate, shaft, check }));
  }
});

test('root exactly at the base cone is supported without a substituted flank', () => {
  const dp = PI / 4, R = 40 / Math.sin(dp), df = dp - Math.atan(2.5 / R), alpha = Math.acos(Math.sin(df) / Math.sin(dp)) / DEG;
  const mesh = buildBevelMesh(p({ pressureAngleDeg: alpha }));
  close(mesh.bevelDimensions.rootConeAngleDeg, mesh.bevelDimensions.baseConeAngleDeg, 1e-10);
  close(mesh.bevelDimensions.rootRollAngleRad, 0, 1e-7); assert.ok(validateMesh(mesh).valid);
});

test('unsupported roots, cone domains, intersections and excessive meshes fail explicitly', () => {
  const cases: [Partial<BevelParams>, string][] = [
    [{ teeth: 24 }, 'BEVEL_ROOT_BELOW_BASE'], [{ teeth: 5 }, 'TEETH_RANGE'], [{ bevelMateTeeth: 40.5 }, 'TEETH_RANGE'],
    [{ bevelMateTeeth: NaN }, 'NON_FINITE'], [{ bevelShaftAngleDeg: Infinity }, 'NON_FINITE'], [{ width: NaN }, 'NON_FINITE'],
    [{ module: 0 }, 'MODULE_RANGE'], [{ width: 0 }, 'WIDTH_RANGE'], [{ width: 60 }, 'BEVEL_FACE_WIDTH'],
    [{ pressureAngleDeg: 9 }, 'ANGLE_RANGE'], [{ bevelShaftAngleDeg: 180 }, 'BEVEL_SHAFT_ANGLE'],
    [{ teeth: 80, bevelMateTeeth: 40, bevelShaftAngleDeg: 130 }, 'BEVEL_PITCH_CONE_DOMAIN'],
    [{ teeth: 250, bevelMateTeeth: 6, bevelShaftAngleDeg: 91 }, 'BEVEL_TIP_CONE_DOMAIN'],
    [{ backlash: -1 }, 'BACKLASH_RANGE'], [{ backlash: 4 }, 'TOOTH_THICKNESS'], [{ backlash: 2 }, 'BEVEL_POINTED_TOOTH'],
    [{ bore: -1 }, 'BORE_RANGE'], [{ bore: 1e-8 }, 'BORE_RANGE'], [{ bore: 63 }, 'BORE_INTERSECTION'],
    [{ profileShift: 0.1 }, 'BEVEL_PROFILE_SHIFT'], [{ helixAngleDeg: 20 }, 'BEVEL_HELIX'],
    [{ profileTolerance: 0 }, 'PROFILE_TOLERANCE'], [{ profileTolerance: Infinity }, 'PROFILE_TOLERANCE'],
  ];
  for (const [change, code] of cases) assert.throws(() => buildBevelMesh(p(change)),
    (error: unknown) => error instanceof GearGeometryError && error.code === code, JSON.stringify(change));
  assert.throws(() => deriveBevel(p({ teeth: 24 })), /переходный профиль ещё не реализован/);
  for (const quality of [{ flankSamples: 0 }, { axialSegments: NaN }, { flankSamples: 2.5 }])
    assert.throws(() => buildBevelMesh(p(), quality), (e: unknown) => e instanceof GearGeometryError && e.code === 'QUALITY_RANGE');
  for (const quality of [{ flankSamples: 65 }, { axialSegments: 257 }, { flankSamples: 64, axialSegments: 256 }])
    assert.throws(() => buildBevelMesh(p(), quality), (e: unknown) => e instanceof GearGeometryError && e.code === 'MESH_BUDGET');
  assert.throws(() => sphericalInvolutePoint(0, 1), (e: unknown) => e instanceof GearGeometryError && e.code === 'BEVEL_INVOLUTE_DOMAIN');
  assert.throws(() => sphericalInvolutePoint(PI / 4, 4), (e: unknown) => e instanceof GearGeometryError && e.code === 'BEVEL_INVOLUTE_DOMAIN');
});
