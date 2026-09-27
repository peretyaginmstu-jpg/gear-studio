import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultGearParams, exportBinarySTL, GearGeometryError, validateMesh } from '../lib/gearMath.ts';
import { buildWormMesh, deriveWorm, wormRadiusAt } from '../lib/wormGeometry.ts';
import type { WormParams } from '../lib/wormGeometry.ts';

const PI = Math.PI, TAU = 2 * PI;
const p = (values: Partial<WormParams> = {}): WormParams => ({ ...defaultGearParams,
  kind: 'worm', module: 2, width: 12, bore: 3, backlash: 0, profileShift: 0,
  wormStarts: 2, wormDiameterFactor: 10, wormHand: 'right', ...values });
const close = (actual: number, expected: number, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ±${tolerance}`);

function readSTL(buffer: ArrayBuffer) {
  const data = new DataView(buffer), faces = data.getUint32(80, true);
  const positions: number[] = [], indices: number[] = [], map = new Map<string, number>();
  assert.equal(buffer.byteLength, 84 + 50 * faces);
  for (let f = 0; f < faces; f++) for (let v = 0; v < 3; v++) {
    const at = 84 + 50 * f + 12 + 12 * v;
    const xyz = [data.getFloat32(at, true), data.getFloat32(at + 4, true), data.getFloat32(at + 8, true)];
    assert.ok(xyz.every(Number.isFinite));
    const key = xyz.join(','); let id = map.get(key);
    if (id === undefined) { id = positions.length / 3; positions.push(...xyz); map.set(key, id); }
    indices.push(id);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

test('KHK axial-module Table 4.23 worm dimensions; normal and axial inputs stay distinct', () => {
  // KHK gives alpha_n=20°, mx=3, d1=44, z1=2. Convert the angle before input.
  const gamma = Math.atan(6 / 44);
  const ax = Math.atan(Math.tan(20 * PI / 180) / Math.cos(gamma)) * 180 / PI;
  const { dimensions: d, wormDimensions: w } = deriveWorm(p({ module: 3,
    wormDiameterFactor: 44 / 3, pressureAngleDeg: ax }));
  close(d.pitchDiameter, 44); close(d.tipDiameter, 50); close(d.rootDiameter, 36.5);
  close(d.addendum, 3); close(d.dedendum, 3.75);
  close(w.axialPitch, 9.42477796076938); close(w.lead, 18.84955592153876);
  close(w.leadAngleDeg, 7.76516601842533); close(d.normalPressureAngleDeg, 20);
  close(d.normalModule, 3 * Math.cos(gamma)); assert.notEqual(d.normalModule, 3);
  close(d.transverseCircularPitch, PI * 44 / 2);
  close(d.normalToothThickness / Math.cos(gamma), w.axialToothThickness);
  close(d.baseDiameter, 0); close(d.basePitch, 0);
});

test('ZA axial section is exactly a straight-sided trapezoid at the stated pressure angle', () => {
  const input = p({ module: 1.6, pressureAngleDeg: 25, backlash: 0.06 });
  const mx = input.module, rp = 8, rf = rp - 1.25 * mx, ra = rp + mx;
  const halfPitchThickness = PI * mx / 4 - 0.03, slope = Math.tan(25 * PI / 180);
  close(wormRadiusAt(input, 0, 0), ra);
  close(wormRadiusAt(input, 0, PI * mx / 2), rf);
  // Independent generating-line equation: z = ±(sx/2 - (r-rp) tan(alpha_x)).
  for (const radius of [rf, rp - 0.8, rp, rp + 0.7, ra]) for (const sign of [-1, 1]) {
    const z = sign * (halfPitchThickness - (radius - rp) * slope);
    close(wormRadiusAt(input, 0, z), radius);
    close(wormRadiusAt(input, 0, z + PI * mx), radius);
  }
  const z1 = halfPitchThickness - 0.7 * slope, z2 = halfPitchThickness + 0.8 * slope;
  close((z2 - z1) / (wormRadiusAt(input, 0, z1) - wormRadiusAt(input, 0, z2)), slope);
});

test('screw motion preserves the generating profile; starts, lead and hand have separate meanings', () => {
  for (const starts of [1, 2, 4, 8]) for (const hand of ['left', 'right'] as const) {
    const input = p({ wormStarts: starts, wormHand: hand });
    const signedLead = (hand === 'right' ? 1 : -1) * PI * input.module * starts;
    const z = PI * input.module / 4;
    for (const theta of [-2.31, -0.6, 0, 0.44, 1.91, TAU]) {
      close(wormRadiusAt(input, theta, z + signedLead * theta / TAU), 10);
      close(wormRadiusAt(input, theta + TAU / starts, z), wormRadiusAt(input, theta, z));
    }
    const mesh = buildWormMesh(input);
    const ringSize = mesh.profile.outer.length * 2, step = mesh.params.width / mesh.tessellation.axialSegments;
    const a = Math.atan2(mesh.positions[1], mesh.positions[0]);
    const b = Math.atan2(mesh.positions[ringSize * 3 + 1], mesh.positions[ringSize * 3]);
    const da = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    close(da / step, TAU / signedLead, 5e-6);
  }
});

test('multi-start transverse profile has rotational symmetry and all three radial levels', () => {
  for (const starts of [1, 3, 8]) {
    const mesh = buildWormMesh(p({ wormStarts: starts }));
    const points = mesh.profile.outer, perStart = points.length / starts;
    assert.equal(perStart, Math.floor(perStart));
    const co = Math.cos(TAU / starts), si = Math.sin(TAU / starts);
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + perStart) % points.length];
      close(a.x * co - a.y * si, b.x); close(a.x * si + a.y * co, b.y);
    }
    const radii = points.map(v => Math.hypot(v.x, v.y));
    close(Math.min(...radii), 7.5); close(Math.max(...radii), 12);
    assert.ok(radii.some(r => r > 7.5 + 1e-6 && r < 12 - 1e-6));
  }
});

test('triangle intersections with the axial plane track the generating trapezoid', () => {
  const input = p({ wormStarts: 1, width: 8, profileTolerance: 0.005 });
  const mesh = buildWormMesh(input), count = mesh.profile.outer.length, ringSize = count * 2;
  let intersections = 0;
  // Inspect only the actual outer-wall triangles; bore and planar end caps are excluded.
  for (let layer = 0; layer < mesh.tessellation.axialSegments; layer++) for (let j = 0; j < count; j++) {
    const a = layer * ringSize + j, b = layer * ringSize + (j + 1) % count;
    const c = (layer + 1) * ringSize + (j + 1) % count, d = (layer + 1) * ringSize + j;
    for (const tri of [[a, b, c], [a, c, d]]) for (let k = 0; k < 3; k++) {
      const u = tri[k] * 3, v = tri[(k + 1) % 3] * 3;
      const y1 = mesh.positions[u + 1], y2 = mesh.positions[v + 1];
      if ((y1 < 0) === (y2 < 0) || y1 === y2) continue;
      const t = -y1 / (y2 - y1), x = mesh.positions[u] + t * (mesh.positions[v] - mesh.positions[u]);
      if (x <= 0) continue;
      const z = mesh.positions[u + 2] + t * (mesh.positions[v + 2] - mesh.positions[u + 2]);
      close(x, wormRadiusAt(input, 0, z), 0.015);
      intersections++;
    }
  }
  assert.ok(intersections > 500);
});

for (const bore of [0, 3]) for (const hand of ['right', 'left'] as const)
  test(`ZA mesh, ${hand}, bore ${bore}: closed caps, outward winding, valid indices and STL roundtrip`, () => {
    const input = p({ bore, wormHand: hand }), mesh = buildWormMesh(input);
    const report = validateMesh(mesh); assert.ok(report.valid, JSON.stringify(report));
    assert.equal(report.boundaryEdges, 0); assert.equal(report.nonManifoldEdges, 0);
    for (const id of mesh.indices) assert.ok(id >= 0 && id < mesh.positions.length / 3);
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const r = Math.hypot(mesh.positions[i], mesh.positions[i + 1]), z = mesh.positions[i + 2];
      assert.ok(r <= 12.00001); assert.ok(z >= -6 && z <= 6);
      if (bore) assert.ok(r >= bore / 2 - 1e-6);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    close(minZ, -6); close(maxZ, 6);
    assert.ok(report.signedVolume > PI * (7.5 ** 2 - (bore / 2) ** 2) * 12 * 0.99);
    assert.ok(report.signedVolume < PI * (12 ** 2 - (bore / 2) ** 2) * 12);
    assert.equal(report.vertices - report.triangles / 2, bore ? 0 : 2);
    const roundtrip = readSTL(exportBinarySTL(mesh));
    assert.ok(validateMesh(roundtrip).valid);
    close(validateMesh(roundtrip).signedVolume, report.signedVolume, 1e-7);
  });

test('mesh converges to an independently integrated axial-trapezoid volume', () => {
  const input = p({ bore: 2, wormStarts: 3, width: 6 });
  const mx = input.module, pitch = PI * mx, rf = 7.5, ra = 12, slope = Math.tan(20 * PI / 180);
  const tipWidth = pitch / 2 - 2 * mx * slope;
  const rootLand = pitch / 2 - 2 * 1.25 * mx * slope;
  // Volume follows angular average of r²; dz/dr on each straight flank = tan(alpha_x).
  const averageR2 = (ra * ra * tipWidth + rf * rf * rootLand + 2 * slope * (ra ** 3 - rf ** 3) / 3) / pitch;
  const exact = PI * (averageR2 - 1) * input.width;
  const coarse = validateMesh(buildWormMesh(input, { flankSamples: 5 })).signedVolume;
  const fine = validateMesh(buildWormMesh({ ...input, profileTolerance: 0.001 }, { flankSamples: 24 })).signedVolume;
  assert.ok(Math.abs(fine - exact) < Math.abs(coarse - exact));
  close(fine, exact, exact * 0.001);
});

test('ordinary gear tooth count and helix angle never silently control the worm', () => {
  const a = buildWormMesh(p({ teeth: 6, helixAngleDeg: -45 }));
  const b = buildWormMesh(p({ teeth: 240, helixAngleDeg: 45 }));
  assert.deepEqual(a.positions, b.positions); assert.deepEqual(a.indices, b.indices);
  assert.deepEqual(a.wormDimensions, b.wormDimensions);
});

test('small and large scales, near-minimum core and tiny bores remain closed in float32', () => {
  let checked = 0;
  for (const axialModule of [0.1, 2, 30]) for (const q of [2.61, 10, 100])
    for (const starts of [1, 8]) for (const boreScale of [0, 0.025]) {
      const mesh = buildWormMesh(p({ module: axialModule, width: axialModule * 1.7,
        bore: axialModule * boreScale, wormStarts: starts, wormDiameterFactor: q }));
      const report = validateMesh(mesh);
      assert.ok(report.valid, JSON.stringify({ axialModule, q, starts, boreScale, report }));
      checked++;
    }
  assert.equal(checked, 36);
});

test('invalid worm dimensions and unreasonable browser meshes fail with explicit codes', () => {
  const cases: [Partial<WormParams>, string][] = [
    [{ module: NaN }, 'NON_FINITE'], [{ width: Infinity }, 'NON_FINITE'],
    [{ module: 0 }, 'MODULE_RANGE'], [{ width: 0 }, 'WIDTH_RANGE'],
    [{ pressureAngleDeg: 5 }, 'ANGLE_RANGE'], [{ pressureAngleDeg: 35 }, 'WORM_ROOT_OVERLAP'],
    [{ wormStarts: 1.5 }, 'WORM_STARTS'], [{ wormStarts: 0 }, 'WORM_STARTS'], [{ wormStarts: 9 }, 'WORM_STARTS'],
    [{ wormDiameterFactor: 2.5 }, 'WORM_DIAMETER_FACTOR'], [{ wormDiameterFactor: Infinity }, 'NON_FINITE'],
    [{ profileShift: 0.1 }, 'WORM_PROFILE_SHIFT'], [{ backlash: -0.01 }, 'BACKLASH_RANGE'],
    [{ backlash: 3 }, 'WORM_POINTED_THREAD'], [{ bore: 15 }, 'BORE_INTERSECTION'],
    [{ bore: -1 }, 'BORE_RANGE'], [{ bore: 1e-10 }, 'BORE_RANGE'],
    [{ profileTolerance: NaN }, 'PROFILE_TOLERANCE'], [{ profileTolerance: 0 }, 'PROFILE_TOLERANCE'],
    [{ width: 500, module: 0.1, wormStarts: 1, bore: 0 }, 'MESH_BUDGET'],
  ];
  for (const [values, code] of cases) assert.throws(() => buildWormMesh(p(values)),
    (error: unknown) => error instanceof GearGeometryError && error.code === code, JSON.stringify(values));
  assert.throws(() => deriveWorm({ ...p(), wormHand: 'unknown' } as unknown as WormParams), /направление/);
  assert.throws(() => deriveWorm({ ...p(), wormStarts: null } as unknown as WormParams), /конечным/);
  assert.throws(() => deriveWorm({ ...p(), kind: 'worm-wheel' } as unknown as WormParams), /только отдельный/);
  for (const value of [NaN, Infinity, -1, 0, 1.5]) assert.throws(() => buildWormMesh(p(), { axialSegments: value }));
  assert.throws(() => buildWormMesh(p(), { flankSamples: 100_000 }), /бюджет/);
  assert.throws(() => wormRadiusAt(p(), Infinity, 0), /конечными/);
});
