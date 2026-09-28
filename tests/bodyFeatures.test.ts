import test from 'node:test';
import assert from 'node:assert/strict';
import { boreContour, buildGearMesh, deriveGear, stitchLoops, validateMesh, type GearParams, type Point2 } from '../lib/gearMath.ts';
import { buildModelMesh, defaultModel } from '../lib/model.ts';
import { standardKeyway } from '../lib/keyway.ts';

const p = (patch: Partial<GearParams> = {}): GearParams => ({ kind: 'spur', teeth: 30, module: 2, pressureAngleDeg: 20, helixAngleDeg: 0,
  width: 12, bore: 12, profileShift: 0, backlash: .05, ...patch });
const area = (loop: Point2[]) => loop.reduce((s, q, i) => { const r = loop[(i + 1) % loop.length]; return s + q.x * r.y - r.x * q.y; }, 0) / 2;

/** Sum of signed planar cap areas at height z; overlap or flipped triangles would break the equality with the ring area. */
function capArea(mesh: { positions: Float32Array; indices: Uint32Array }, z: number) {
  const P = mesh.positions, F = mesh.indices; let total = 0, flipped = 0;
  for (let k = 0; k < F.length; k += 3) {
    const [a, b, c] = [F[k] * 3, F[k + 1] * 3, F[k + 2] * 3];
    if (![a, b, c].every(i => Math.abs(P[i + 2] - z) < 1e-5)) continue;
    const s = ((P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a])) / 2;
    total += s; if (s * Math.sign(z || 1) <= 0) flipped++;
  }
  return { total, flipped };
}

test('keyway bore is a closed angle-monotone loop with the requested slot', () => {
  const loop = boreContour(6, 4, 1.8);
  assert.ok(area(loop) > Math.PI * 36);
  assert.equal(Math.max(...loop.map(q => q.x)), 7.8);
  assert.equal(Math.max(...loop.map(q => Math.abs(q.y)).filter((_, i) => loop[i].x > 6.01)), 2);
  const angles = loop.map(q => Math.atan2(q.y, q.x));
  let turns = 0; for (let i = 0; i < angles.length; i++) { const d = angles[(i + 1) % angles.length] - angles[i]; turns += d < -Math.PI ? d + 2 * Math.PI : d; assert.ok((d < -Math.PI ? d + 2 * Math.PI : d) > 0); }
  assert.ok(Math.abs(turns - 2 * Math.PI) < 1e-9);
});

test('ring stitching covers exactly the ring area without flipped triangles', () => {
  const outer = Array.from({ length: 37 }, (_, k) => ({ id: k, p: { x: 10 * Math.cos(k / 37 * 2 * Math.PI + .3), y: 10 * Math.sin(k / 37 * 2 * Math.PI + .3) } }));
  const inner = boreContour(4, 3, 2).map((q, k) => ({ id: 100 + k, p: q }));
  const pts = new Map([...outer, ...inner].map(v => [v.id, v.p]));
  const faces = stitchLoops(outer, inner, true); let sum = 0;
  for (let k = 0; k < faces.length; k += 3) { const [a, b, c] = [pts.get(faces[k])!, pts.get(faces[k + 1])!, pts.get(faces[k + 2])!];
    const s = ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2; assert.ok(s > 0); sum += s; }
  assert.ok(Math.abs(sum - (area(outer.map(v => v.p)) - area(inner.map(v => v.p)))) < 1e-9);
  assert.equal(faces.length / 3, outer.length + inner.length);
});

for (const kind of ['spur', 'helical', 'herringbone'] as const) test(`${kind}: keyway and hub give a closed mesh with exact planar caps`, () => {
  const params = p({ kind, helixAngleDeg: kind === 'spur' ? 0 : 20, keywayWidth: 4, keywayDepth: 1.8, hubDiameter: 30, hubLength: 9 });
  const mesh = buildGearMesh(params), v = validateMesh(mesh);
  assert.ok(v.valid, JSON.stringify(v));
  const hole = area(mesh.profile.hole!), rim = area(mesh.profile.outer), hub = Math.PI * 15 ** 2;
  const bottom = capArea(mesh, -6), top = capArea(mesh, 6), end = capArea(mesh, 15);
  assert.equal(bottom.flipped + top.flipped + end.flipped, 0);
  assert.ok(Math.abs(-bottom.total - (rim - hole)) < 1e-3 * rim);
  // A 48+ point hub polygon is slightly smaller than the true circle.
  const hubPolygon = area(Array.from({ length: 96 }, (_, k) => ({ x: 15 * Math.cos(k / 96 * 2 * Math.PI), y: 15 * Math.sin(k / 96 * 2 * Math.PI) })));
  assert.ok(Math.abs(top.total - (rim - hubPolygon)) < 1e-3 * rim);
  assert.ok(Math.abs(end.total - (hubPolygon - hole)) < 1e-3 * hub);
  assert.equal(mesh.dimensions.overallLength, 21);
  let zmax = -Infinity; for (let i = 2; i < mesh.positions.length; i += 3) zmax = Math.max(zmax, mesh.positions[i]); assert.ok(Math.abs(zmax - 15) < 1e-6);
});

test('solid hub without bore and plain bore stay closed', () => {
  assert.ok(validateMesh(buildGearMesh(p({ bore: 0, hubDiameter: 20, hubLength: 5 }))).valid);
  assert.ok(validateMesh(buildGearMesh(p({ bore: 10 }))).valid);
});

test('body features are validated with explicit reasons', () => {
  const code = (patch: Partial<GearParams>) => { try { deriveGear(p(patch)); return 'ok'; } catch (e) { return (e as { code: string }).code; } };
  assert.equal(code({ keywayWidth: 4, keywayDepth: 1.8, bore: 0 }), 'KEYWAY_WITHOUT_BORE');
  assert.equal(code({ keywayWidth: 4 }), 'KEYWAY_INCOMPLETE');
  assert.equal(code({ keywayWidth: 11, keywayDepth: 1 }), 'KEYWAY_WIDTH');
  assert.equal(code({ keywayWidth: 4, keywayDepth: 22 }), 'KEYWAY_WALL');
  assert.equal(code({ hubDiameter: 20 }), 'HUB_INCOMPLETE');
  assert.equal(code({ hubDiameter: 80, hubLength: 5 }), 'HUB_DIAMETER');
  assert.equal(code({ hubDiameter: 12.5, hubLength: 5 }), 'HUB_WALL');
  assert.equal(code({ kind: 'internal', teeth: 80, bore: 0, hubDiameter: 20, hubLength: 5 }), 'BODY_FEATURE_KIND');
  assert.equal(code({ keywayWidth: -1 }), 'BODY_FEATURE_RANGE');
  assert.equal(code({ keywayWidth: 4, keywayDepth: 1.8, hubDiameter: 30, hubLength: 9 }), 'ok');
});

test('custom basic rack changes tooth heights and undercut limit', () => {
  const std = deriveGear(p()).dimensions, stub = deriveGear(p({ addendumCoefficient: .8, clearanceCoefficient: .2 })).dimensions;
  assert.equal(std.tipDiameter, 64); assert.equal(std.rootDiameter, 55);
  assert.ok(Math.abs(stub.tipDiameter - 63.2) < 1e-12); assert.ok(Math.abs(stub.rootDiameter - 56) < 1e-12);
  assert.ok(Math.abs(stub.minimumProfileShift - (std.minimumProfileShift - .2)) < 1e-12);
  assert.ok(deriveGear(p({ addendumCoefficient: .8 })).warnings.some(w => w.code === 'NONSTANDARD_RACK'));
  assert.throws(() => deriveGear(p({ addendumCoefficient: 2 })), /ha\*/);
  assert.throws(() => deriveGear(p({ clearanceCoefficient: 0 })), /c\*/);
  assert.ok(validateMesh(buildGearMesh(p({ addendumCoefficient: .8, clearanceCoefficient: .35 }))).valid);
  const internal = deriveGear(p({ kind: 'internal', teeth: 80, bore: 0, addendumCoefficient: .8 })).dimensions;
  assert.ok(Math.abs(internal.tipDiameter - (160 - 3.2)) < 1e-9);
});

test('other kernels never receive cylindrical-only extensions', () => {
  for (const kind of ['worm', 'cycloidal', 'bevel'] as const)
    assert.ok(buildModelMesh({ ...defaultModel(kind), addendumCoefficient: .8, keywayWidth: 2, keywayDepth: 1, hubDiameter: 5, hubLength: 5 }).positions.length > 0);
});

test('standard keyway follows GOST 23360 ranges', () => {
  assert.deepEqual(standardKeyway(12), { width: 4, depth: 1.8, standard: 'GOST 23360-78' });
  assert.deepEqual(standardKeyway(12.1), { width: 5, depth: 2.3, standard: 'GOST 23360-78' });
  assert.equal(standardKeyway(5), null); assert.equal(standardKeyway(120), null);
});

test('cap triangulation stays exact over a sweep of small gears, keyways and coarse sampling', () => {
  let checked = 0;
  for (const teeth of [12, 14, 24, 40]) for (const mn of [1, 2.5]) for (const flankSamples of [5, 12]) {
    const rf = deriveGear(p({ teeth, module: mn, bore: 0, profileShift: teeth < 20 ? .5 : 0 })).dimensions.rootDiameter / 2;
    for (const fraction of [.3, .55]) {
      const bore = Math.round(2 * rf * fraction * 10) / 10, key = { width: +(bore * .35).toFixed(2), depth: +(bore * .15).toFixed(2) };
      let mesh; try { mesh = buildGearMesh(p({ teeth, module: mn, bore, profileShift: teeth < 20 ? .5 : 0, keywayWidth: key.width, keywayDepth: key.depth }), { flankSamples }); } catch (e) { assert.match((e as { code: string }).code, /KEYWAY_WALL|BORE_INTERSECTION/); continue; }
      assert.ok(validateMesh(mesh).valid);
      const cap = capArea(mesh, 6), expected = area(mesh.profile.outer) - area(mesh.profile.hole!);
      assert.equal(cap.flipped, 0); assert.ok(Math.abs(cap.total - expected) < 1e-4 * expected, JSON.stringify({ teeth, mn, bore }));
      checked++;
    }
  }
  assert.ok(checked > 20);
});
