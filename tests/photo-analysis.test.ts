import assert from 'node:assert/strict';
import { analyzeGearImage, deriveMeasuredSpurParameters } from '../lib/photo-analysis.ts';
import type { ImageDataLike } from '../lib/photo-analysis.ts';

type ShapeOptions = {
  z?: number; radius?: number; depth?: number; ring?: boolean; rack?: boolean;
  sx?: number; sy?: number; rotation?: number; cx?: number; cy?: number;
  fg?: number[]; bg?: number[]; transparent?: boolean; damaged?: boolean; noisyBorder?: boolean;
  secondObject?: boolean; circle?: boolean;
};
function synthetic(o: ShapeOptions = {}): ImageDataLike {
  const width = 512, height = 512, data = new Uint8ClampedArray(width * height * 4);
  const z = o.z ?? 24, radius = o.radius ?? 175, depth = o.depth ?? 18;
  const fg = o.fg ?? [30, 40, 50], bg = o.bg ?? [245, 245, 245];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x + .5 - (o.cx ?? 256), dy = y + .5 - (o.cy ?? 256), rotation = o.rotation ?? .132;
    const u = (dx * Math.cos(rotation) + dy * Math.sin(rotation)) / (o.sx ?? 1);
    const v = (-dx * Math.sin(rotation) + dy * Math.cos(rotation)) / (o.sy ?? 1);
    const r = Math.hypot(u, v), angle = Math.atan2(v, u);
    const phase = ((angle * z / (Math.PI * 2)) % 1 + 1) % 1;
    // Flat tip/root and sloped flanks: periodic silhouette, not an involute validator.
    const tooth = phase < .2 || phase > .8 ? 1 : phase < .4 ? (.4 - phase) / .2 : phase > .6 ? (phase - .6) / .2 : 0;
    let outer = radius - depth + depth * tooth;
    if (o.damaged && Math.abs(angle) < Math.PI / z) outer = radius - depth;
    let inside = o.circle ? r <= radius : r <= outer && r > 24;
    if (o.ring) inside = r < radius && r > 120 - depth * tooth;
    if (o.rack) {
      const rackPhase = ((x - 66) % 28 + 28) % 28;
      const protrusion = rackPhase < 14 ? 22 : 0;
      inside = x > 66 && x < 446 && y > 230 - protrusion && y < 288;
    }
    if (o.secondObject && x > 25 && x < 110 && y > 25 && y < 110) inside = true;
    let color = inside ? fg : bg;
    if (o.noisyBorder && !inside) color = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? [30, 30, 30] : [245, 245, 245];
    const i = (y * width + x) * 4;
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = o.transparent && !inside ? 0 : 255;
  }
  return { width, height, data };
}
const rows: object[] = [];
function accepts(name: string, options: ShapeOptions, count: number, type = 'external_circular') {
  const r = analyzeGearImage(synthetic(options));
  rows.push({ name, expected: count, found: r.toothCount, type: r.candidateTypes[0].type, confidence: +r.confidence.toFixed(3), diameter: r.outsideDiameterPx });
  assert.equal(r.toothCount, count, `${name}: ${JSON.stringify(r)}`);
  assert.equal(r.damageHypothesis, null, `${name}: intact contour must not invent damage`);
  assert.equal(r.candidateTypes[0].type, type, name);
  assert.equal(r.moduleMm, null, name);
  assert.ok(r.expertQuestions.some(q => q.id === 'outside_diameter'), name);
  assert.ok(Math.abs(r.outsideDiameterPx! - 2 * (options.radius ?? 175)) < 3, `${name}: diameter`);
}
function refuses(name: string, options: ShapeOptions) {
  const r = analyzeGearImage(synthetic(options));
  rows.push({ name, expected: null, found: r.toothCount, type: r.candidateTypes[0].type, warnings: r.warnings.slice(2) });
  assert.equal(r.toothCount, null, `${name}: ${JSON.stringify(r)}`);
  assert.equal(r.status, 'manual_required', name);
  assert.equal(r.damageHypothesis, null, name);
}
for (const z of [8, 12, 20, 24, 40, 72]) accepts(`external z=${z}`, { z }, z);
accepts('white on dark', { z: 30, fg: [250, 250, 250], bg: [10, 10, 10] }, 30);
accepts('same luminance colored object', { z: 32, fg: [230, 10, 20], bg: [30, 100, 210] }, 32);
accepts('transparent background', { z: 36, transparent: true, bg: [0, 0, 0] }, 36);
accepts('internal toothed ring', { z: 40, ring: true }, 40, 'internal_ring');
refuses('plain circle', { circle: true });
refuses('tilted gear', { z: 24, sy: .75 });
refuses('tilted gear rotated 45 degrees', { z: 24, sy: .75, rotation: Math.PI / 4 });
refuses('clipped gear', { z: 24, cx: 110 });
refuses('low contrast', { z: 24, fg: [220, 220, 220] });
refuses('small image feature', { z: 24, radius: 25, depth: 4 });
const damaged = analyzeGearImage(synthetic({ z: 24, damaged: true }));
assert.equal(damaged.toothCount, null, 'a missing tooth is never an observed complete count');
assert.equal(damaged.status, 'damage_hypothesis_requires_confirmation');
assert.equal(damaged.damageHypothesis?.toothCount, 24);
rows.push({ name: 'missing tooth', strictCount: damaged.toothCount, separateHypothesis: damaged.damageHypothesis?.toothCount });
refuses('busy background', { z: 24, noisyBorder: true });
// Separate substantial item has >15% of segmented foreground, so multiobject gate fails.
refuses('two large foreground objects', { z: 24, radius: 105, secondObject: true });
const rack = analyzeGearImage(synthetic({ rack: true }));
assert.equal(rack.candidateTypes[0].type, 'linear_rack');
assert.equal(rack.toothCount, null); rows.push({ name: 'rack candidate', type: rack.candidateTypes[0].type });
const blank = analyzeGearImage({ width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4).fill(255) });
assert.equal(blank.toothCount, null); assert.equal(blank.status, 'manual_required');
assert.throws(() => analyzeGearImage({ width: 0, height: 2, data: [] }));

const valid = { toothCount: 24, outsideDiameterMm: 52, confirmedExternalSpur: true,
  confirmedStandardFullDepth: true, confirmedZeroProfileShift: true, confirmedTipCircleDiameter: true };
const derived = deriveMeasuredSpurParameters(valid);
assert.equal(derived.ok, true);
if (derived.ok) { assert.equal(derived.moduleMm, 2); assert.equal(derived.pitchDiameterMm, 48); }
for (const key of ['confirmedExternalSpur', 'confirmedStandardFullDepth', 'confirmedZeroProfileShift', 'confirmedTipCircleDiameter'] as const)
  assert.equal(deriveMeasuredSpurParameters({ ...valid, [key]: false }).ok, false, key);
for (const outsideDiameterMm of [0, -5, NaN, Infinity]) assert.equal(deriveMeasuredSpurParameters({ ...valid, outsideDiameterMm }).ok, false);
for (const toothCount of [0, -5, 24.5, NaN, Infinity]) assert.equal(deriveMeasuredSpurParameters({ ...valid, toothCount }).ok, false);
console.log(JSON.stringify({ tests: 'PASS', cases: rows, measurementGates: 'PASS' }, null, 2));
