import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGearImage, type ImageDataLike } from '../lib/photo-analysis.ts';

const TAU = 2 * Math.PI;
interface Shape {
  z?: number; phase?: number; missing?: number[]; shape?: 'rounded' | 'trapezoid' | 'triangle';
  fragment?: { start: number; span: number; depth: number }; inner?: boolean;
  sx?: number; sy?: number; cx?: number; cy?: number; rotate?: number;
  irregularSpacing?: boolean; irregularHeight?: boolean; mixed?: boolean;
  smooth?: boolean; notch?: boolean; spot?: boolean; half?: boolean; shadow?: boolean;
  busy?: boolean; secondObject?: boolean; lowContrast?: boolean;
}
const angularDifference = (a: number, b: number) => ((a - b + 3 * Math.PI) % TAU) - Math.PI;

/** Independent analytic silhouettes: the detector's FFT/template is not used. */
function imageShape(options: Shape = {}): ImageDataLike {
  const width = 512, height = 512, z = options.z ?? 24, phase = options.phase ?? .137, pitch = TAU / z;
  const data = new Uint8ClampedArray(width * height * 4), radius = 178, depth = 18, root = radius - depth;
  const toothShape = (fraction: number) => options.shape === 'triangle' ? Math.max(0, 1 - Math.abs(fraction) / .43)
    : options.shape === 'trapezoid' ? Math.max(0, Math.min(1, (.4 - Math.abs(fraction)) / .2))
    : (1 + Math.cos(TAU * fraction)) / 2;
  const centers = Array.from({ length: z }, (_, index) => phase + index * pitch + (options.irregularSpacing ? .22 * pitch * Math.sin(index * 2.399) : 0));
  const missingAngles = (options.missing ?? []).map(index => phase + index * pitch);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x + .5 - (options.cx ?? 256), dy = y + .5 - (options.cy ?? 256), rotation = options.rotate ?? 0;
    const u = (dx * Math.cos(rotation) + dy * Math.sin(rotation)) / (options.sx ?? 1);
    const v = (-dx * Math.sin(rotation) + dy * Math.cos(rotation)) / (options.sy ?? 1);
    const angle = (Math.atan2(v, u) + TAU) % TAU, r = Math.hypot(u, v);
    let index = ((Math.round((angle - phase) / pitch) % z) + z) % z;
    if (options.irregularSpacing) {
      for (const candidate of [(index - 1 + z) % z, (index + 1) % z])
        if (Math.abs(angularDifference(angle, centers[candidate])) < Math.abs(angularDifference(angle, centers[index]))) index = candidate;
    }
    let protrusion = toothShape(angularDifference(angle, centers[index]) / pitch);
    if (options.irregularHeight) protrusion *= .45 + .55 * (1 + Math.sin(index * 2.399)) / 2;
    if (options.mixed) protrusion = .5 * protrusion + .5 * (1 + Math.cos(31 * (angle - phase))) / 2;
    let edge = root + depth * protrusion;
    if (missingAngles.some(center => Math.abs(angularDifference(angle, center)) < .49 * pitch)) edge = root;
    if (options.fragment && ((angle - options.fragment.start + TAU) % TAU) < options.fragment.span) edge = Math.min(edge, root - options.fragment.depth);
    let inside = r > 24 && r <= edge;
    if (options.inner) {
      let inward = 120 - depth * protrusion;
      if (missingAngles.some(center => Math.abs(angularDifference(angle, center)) < .49 * pitch)) inward = 120;
      inside = r <= radius && r >= inward;
    }
    if (options.smooth) inside = r <= radius;
    if (options.notch && Math.abs(angularDifference(angle, .57)) < .12 && r > radius - 35) inside = false;
    if (options.spot && Math.hypot(u - 62, v + 27) < 23) inside = false;
    if (options.half && u < 0) inside = false;
    if (options.shadow && Math.hypot(u - 38, v - 26) < radius - 4) inside = true;
    // A disconnected strip is >15% of foreground; it triggers the pre-existing
    // multi-object gate rather than relying on a small ignored dust particle.
    if (options.secondObject && x > 7 && x < 60 && y > 30 && y < 480) inside = true;
    let value = inside ? (options.lowContrast ? 224 : 28) : 246;
    if (options.busy && !inside) value = (Math.floor(x / 13) + Math.floor(y / 13)) % 2 ? 30 : 246;
    const offset = (y * width + x) * 4;
    data[offset] = value; data[offset + 1] = value; data[offset + 2] = value; data[offset + 3] = 255;
  }
  return { width, height, data };
}

function hypothesis(shape: Shape, expected: number) {
  const result = analyzeGearImage(imageShape(shape));
  assert.equal(result.status, 'damage_hypothesis_requires_confirmation', JSON.stringify({ shape, result }));
  assert.equal(result.toothCount, null, 'the full count remains separate from strict observation');
  assert.equal(result.moduleMm, null);
  const candidate = result.damageHypothesis;
  assert.ok(candidate); assert.equal(candidate.toothCount, expected);
  assert.equal(candidate.status, 'requires_independent_confirmation');
  assert.ok(candidate.visibleToothFraction >= .75 && candidate.visibleToothFraction < 1);
  assert.equal(candidate.supportedTeeth / expected, candidate.visibleToothFraction);
  assert.ok(candidate.pitchScatterFraction <= .06 && candidate.templateErrorFraction <= .16);
  assert.ok(candidate.damagedSectors.length >= 1 && candidate.damagedSectors.length <= 3);
  assert.ok(result.expertQuestions.some(question => question.id === 'tooth_count' && question.label.includes('включая сломанные')));
  for (const sector of candidate.damagedSectors) {
    assert.ok(sector.startDeg >= 0 && sector.startDeg < 360 && sector.endDeg >= 0 && sector.endDeg < 360);
    assert.ok(sector.estimatedToothCells >= 1);
  }
  return result;
}
function refusal(shape: Shape) {
  const result = analyzeGearImage(imageShape(shape));
  assert.equal(result.status, 'manual_required', JSON.stringify({ shape, result }));
  assert.equal(result.toothCount, null);
  assert.equal(result.damageHypothesis, null, 'image failure cannot be rescued by the damage route');
  return result;
}

test('one to three missing teeth across independent shapes, counts and phases stay hypotheses', () => {
  for (const shape of ['rounded', 'trapezoid', 'triangle'] as const) {
    for (const z of [12, 24, 37, 60]) {
      for (const count of [1, 2, 3]) {
        // These two placements shift the bounding-box center beyond the bounded
        // refinement domain; they are exercised as documented refusals below.
        if ((z === 12 && count === 2) || (z === 24 && count === 3)) continue;
        const phase = count * .227 + z * .007;
        hypothesis({ shape, z, phase, missing: Array.from({ length: count }, (_, i) => i + 2) }, z);
      }
    }
  }
});

test('large center shifts or asymmetry from some local losses remain conservative refusals', () => {
  for (const shape of ['rounded', 'trapezoid', 'triangle'] as const) {
    refusal({ shape, z: 12, phase: .538, missing: [2, 3] });
    refusal({ shape, z: 24, phase: .849, missing: [2, 3, 4] });
  }
});

test('separated losses and sectors wrapping zero have explicit angular support', () => {
  hypothesis({ z: 32, shape: 'trapezoid', phase: .1, missing: [2, 13, 24] }, 32);
  const result = hypothesis({ z: 24, shape: 'trapezoid', phase: .01, missing: [0] }, 24);
  assert.ok(result.damageHypothesis!.damagedSectors.some(sector => sector.wrapsZero));
});

test('a locally missing body fragment may span partial neighbouring tooth cells', () => {
  for (const count of [1, 2, 3]) hypothesis({ z: 32, shape: 'trapezoid', phase: .39,
    fragment: { start: 1.37, span: count * TAU / 32, depth: 5 } }, 32);
});

test('internal missing teeth use the inward material contour, not the outer ring', () => {
  for (const count of [1, 2, 3]) {
    const result = hypothesis({ z: 32, inner: true, missing: Array.from({ length: count }, (_, i) => i + 4), shape: 'trapezoid' }, 32);
    assert.equal(result.damageHypothesis!.boundary, 'inner');
    assert.equal(result.candidateTypes[0].type, 'internal_ring');
  }
});

test('global background, framing, contrast and oblique-view gates remain mandatory', () => {
  for (const options of [{ busy: true }, { secondObject: true }, { lowContrast: true }, { cx: 100 }, { sy: .74 }, { sy: .74, rotate: Math.PI / 4 }, { shadow: true }])
    refusal({ z: 24, missing: [3, 4], ...options });
});

test('smooth circles with a spot/notch, half wheels and distributed irregularity do not invent a full count', () => {
  for (const options of [{ smooth: true, spot: true }, { smooth: true, notch: true }, { half: true },
    { irregularSpacing: true }, { irregularHeight: true }, { mixed: true }, { missing: [0, 2, 4, 6, 8, 10] }]) refusal({ z: 24, ...options });
});

test('clean contours retain the strict proposal and never acquire damage metadata', () => {
  for (const shape of ['rounded', 'trapezoid', 'triangle'] as const) {
    const result = analyzeGearImage(imageShape({ z: 24, shape }));
    assert.equal(result.status, 'proposal_requires_confirmation');
    assert.equal(result.toothCount, 24); assert.equal(result.damageHypothesis, null);
  }
});
