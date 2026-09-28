import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGearImage, type ImageDataLike } from '../lib/photo-analysis.ts';
import { analyzeGearRegion, normalizePhotoRegion, photoRegionFromCorners, samePhotoRegion, type PhotoRegion } from '../lib/photo-region.ts';
import { estimatePhotoCircle } from '../lib/photo-scale.ts';
import { initialJourney, transitionJourney } from '../lib/journey.ts';
import { defaultModel } from '../lib/model.ts';
import { prepareModelExport } from '../lib/modelExport.ts';
import { createPrintBrief } from '../lib/printBrief.ts';
import { defaultPrintSettings } from '../lib/printability.ts';

const TAU = 2 * Math.PI;
/** Independent periodic silhouette fixture, not a claim of a manufactured tooth profile. */
function scene({ width = 1000, height = 720, cx = 270, cy = 300, reference = true, damaged = false, tilted = false, lowContrast = false, busy = false } = {}): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4), phase = .13, pitch = TAU / 24;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x + .5 - cx, dy = y + .5 - cy;
    const u = tilted ? (dx + dy) / Math.sqrt(2) : dx, v = tilted ? (dy - dx) / Math.sqrt(2) / .72 : dy;
    const angle = Math.atan2(v, u), radius = Math.hypot(u, v);
    const fraction = (((angle - phase) / pitch + .5) % 1 + 1) % 1 - .5;
    let edge = 158 + 20 * Math.max(0, Math.min(1, (.4 - Math.abs(fraction)) / .2));
    const missingAngle = ((angle - phase - 3 * pitch + 3 * Math.PI) % TAU) - Math.PI;
    if (damaged && Math.abs(missingAngle) < .49 * pitch) edge = 158;
    const inside = (radius <= edge && radius > 24) || (reference && x >= 650 && x < 950 && y >= 470 && y < 570);
    let value = inside ? lowContrast ? 224 : 28 : 246;
    if (busy && !inside) value = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? 30 : 246;
    const i = (y * width + x) * 4; data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
  }
  return { width, height, data };
}
const region: PhotoRegion = { x: 50, y: 80, width: 440, height: 440 };
function cropOracle(image: ImageDataLike, r: PhotoRegion): ImageDataLike {
  // Deliberately separate row slicing, rather than the production copying loop.
  const source = Array.from(image.data), rows = Array.from({ length: r.height }, (_, row) =>
    source.slice(((row + r.y) * image.width + r.x) * 4, ((row + r.y) * image.width + r.x + r.width) * 4));
  return { width: r.width, height: r.height, data: Uint8ClampedArray.from(rows.flat()) };
}

test('full frame is exactly the existing detector, with explicit full-image metadata', () => {
  const input = scene(), expected = analyzeGearImage(input), actual = analyzeGearRegion(input);
  assert.deepEqual(actual.analysis, expected);
  assert.deepEqual(analyzeGearRegion(input, { x: 0, y: 0, width: input.width, height: input.height }), actual);
  assert.equal(actual.evidence.method, 'full-image'); assert.equal(actual.evidence.workingImage.width, 1000);
  assert.deepEqual(actual.evidence.processedImage, { width: 512, height: 369 });
  assert.equal(actual.analysis.status, 'manual_required'); assert.equal(actual.analysis.toothCount, null);
  assert.ok(actual.analysis.warnings.some(s => s.includes('несколько заметных объектов')));
});
test('only the selected gear is analyzed; reference pixels and the full source image remain untouched', () => {
  const input = scene(), before = Uint8ClampedArray.from(input.data), result = analyzeGearRegion(input, region);
  assert.equal(result.analysis.status, 'proposal_requires_confirmation'); assert.equal(result.analysis.toothCount, 24);
  assert.deepEqual(result.analysis.centerPx, { x: 270, y: 300 });
  assert.equal(result.analysis.moduleMm, null); assert.deepEqual(input.data, before);
  assert.equal(input.data[(500 * input.width + 800) * 4], 28, 'reference outside the selected region is still in the source');
  assert.equal(result.evidence.method, 'user-selection'); assert.deepEqual(result.evidence.region, region);
  assert.deepEqual(result.evidence.workingImage, { width: 1000, height: 720 });
  assert.deepEqual(result.evidence.processedImage, { width: 440, height: 440 });
  const local = analyzeGearImage(cropOracle(input, region));
  assert.equal(result.analysis.outsideDiameterPx, local.outsideDiameterPx);
  assert.deepEqual({ ...result.analysis, centerPx: local.centerPx }, local, 'only the center changes coordinate space');
});
test('non-square odd crop dimensions use native detector sampling and exact offset translation', () => {
  const input = scene({ reference: false, width: 1400, height: 1000, cx: 670, cy: 480 });
  for (const r of [{ x: 371, y: 211, width: 603, height: 547 }, { x: 373, y: 219, width: 601, height: 549 }]) {
    const local = analyzeGearImage(cropOracle(input, r)), result = analyzeGearRegion(input, r);
    assert.ok(local.centerPx); assert.equal(result.analysis.toothCount, local.toothCount);
    assert.deepEqual(result.analysis.centerPx, { x: local.centerPx.x + r.x, y: local.centerPx.y + r.y });
    assert.equal(result.analysis.outsideDiameterPx, local.outsideDiameterPx);
    assert.deepEqual(result.evidence.processedImage, { width: 512, height: Math.round(r.height * 512 / r.width) });
    assert.equal(result.evidence.processedToWorking.scaleX, r.width / 512);
    assert.equal(result.evidence.processedToWorking.scaleY, r.height / result.evidence.processedImage.height);
  }
});
test('damage hypothesis remains unconfirmed and its sector angles do not rotate or scale with crop placement', () => {
  const input = scene({ damaged: true }), local = analyzeGearImage(cropOracle(input, region)), result = analyzeGearRegion(input, region);
  assert.equal(local.status, 'damage_hypothesis_requires_confirmation'); assert.equal(result.analysis.toothCount, null);
  assert.equal(result.analysis.damageHypothesis?.toothCount, 24);
  assert.deepEqual(result.analysis.damageHypothesis, local.damageHypothesis);
  assert.deepEqual(result.analysis.centerPx, { x: local.centerPx!.x + region.x, y: local.centerPx!.y + region.y });
  assert.equal(result.analysis.outsideDiameterPx, local.outsideDiameterPx);
});
test('cropping cannot turn clipping, low contrast, tilt or busy background into an accepted contour', () => {
  const cases = [
    { image: scene(), r: { x: 190, y: 80, width: 300, height: 440 }, warning: 'края кадра' },
    { image: scene({ lowContrast: true }), r: region, warning: 'контраст' },
    { image: scene({ tilted: true }), r: region, warning: 'эллипс' },
    { image: scene({ busy: true }), r: region, warning: null },
  ];
  for (const { image, r, warning } of cases) {
    const result = analyzeGearRegion(image, r).analysis;
    assert.equal(result.status, 'manual_required'); assert.equal(result.toothCount, null); assert.equal(result.damageHypothesis, null);
    if (warning) assert.ok(result.warnings.some(s => s.includes(warning)), JSON.stringify(result.warnings));
  }
});
test('region validation rejects fractional, nonfinite, reversed, empty and out-of-bounds rectangles', () => {
  const size = { width: 100, height: 80 }, valid = { x: 10, y: 20, width: 60, height: 40 };
  assert.deepEqual(normalizePhotoRegion(valid, size), valid);
  for (const patch of [{ x: -.01 }, { y: -1 }, { x: .5 }, { width: 1.5 }, { height: 0 }, { width: -60 },
    { x: 41 }, { y: 41 }, { width: 100 }, { x: NaN }, { y: Infinity }, { height: Number.MAX_SAFE_INTEGER }])
    assert.throws(() => normalizePhotoRegion({ ...valid, ...patch }, size), /Рамка/);
  assert.throws(() => normalizePhotoRegion(null, { width: 0, height: 80 }));
  assert.throws(() => normalizePhotoRegion(null, { width: 100.5, height: 80 }));
});
test('two corners support either placement direction; same or whole-frame selection does not signal a different part', () => {
  const size = { width: 1000, height: 720 }, a = { x: 50, y: 80 }, b = { x: 490, y: 520 };
  assert.deepEqual(photoRegionFromCorners(a, b, size), region); assert.deepEqual(photoRegionFromCorners(b, a, size), region);
  assert.equal(samePhotoRegion(region, { ...region }, size), true);
  assert.equal(samePhotoRegion(region, { ...region, x: 51 }, size), false);
  assert.equal(samePhotoRegion(null, { x: 0, y: 0, ...size }, size), true);
  assert.throws(() => photoRegionFromCorners(a, a, size));
  assert.throws(() => photoRegionFromCorners(a, { x: 1001, y: 500 }, size));
});
test('strict RGBA and bounded working-image resources are checked before copying or analyzing', () => {
  for (const data of [[], [0, 0, 0], [0, 0, 0, 256], [0, NaN, 0, 255], [0, 0, 0, Infinity], [0, 0, .5, 255], [0, 0, 0, -1]])
    assert.throws(() => analyzeGearRegion({ width: 1, height: 1, data }));
  assert.equal(analyzeGearRegion({ width: 1, height: 1, data: [255, 255, 255, 255] }).analysis.status, 'manual_required');
  const fake = { get length(): never { throw new Error('Pixel storage must not be read before size preflight'); } };
  for (const size of [{ width: 2049, height: 1 }, { width: 1, height: 2049 }, { width: Number.MAX_SAFE_INTEGER, height: 2 }])
    assert.throws(() => analyzeGearRegion({ ...size, data: fake }), /2048/);
  const input = { width: 2, height: 1, data: [255, 255, 255, 255, 255, 255, NaN, 255] };
  assert.throws(() => analyzeGearRegion(input, { x: 0, y: 0, width: 1, height: 1 }), /RGBA/, 'invalid unselected RGBA is not hidden');
});

test('reference outside the analysis region still measures the full frame and reaches the same STL passport and print brief', () => {
  const image = scene(), detected = analyzeGearRegion(image, region);
  const measurementInput = { imageWidth: image.width, imageHeight: image.height,
    referencePoints: [{ x: 650, y: 470 }, { x: 950, y: 470 }], referenceLengthMm: 50, referenceToleranceMm: .05, pixelUncertaintyPx: 1,
    tipPoints: [0, 8, 16].map(index => ({ x: 270 + 178 * Math.cos(.13 + index * TAU / 24), y: 300 + 178 * Math.sin(.13 + index * TAU / 24) })),
    confirmedCoplanar: true, confirmedAxialView: true };
  assert.ok(measurementInput.referencePoints.every(p => p.x > region.x + region.width));
  const measured = estimatePhotoCircle(measurementInput);
  assert.equal(measured.status, 'ready'); if (measured.status !== 'ready') throw new Error('Expected valid full-frame measurement');
  assert.ok(Math.abs(measured.diameterMm - 356 * 50 / 300) < 1e-10);
  const wronglyCroppedCoordinates = estimatePhotoCircle({ ...measurementInput, imageWidth: region.width, imageHeight: region.height });
  assert.equal(wronglyCroppedCoordinates.status, 'rejected', 'measurement coordinates cannot be interpreted as crop-local');
  const evidence = { photoAnalysisEvidence: { centerPx: detected.analysis.centerPx, analysisRegion: detected.evidence,
    workingImage: { width: image.width, height: image.height }, strictToothCandidate: detected.analysis.toothCount },
    photoMeasurement: { input: measurementInput, result: measured }, confirmations: { teeth: true, profile: 'involute', alpha: 20, x: 0, standardTip: true } };
  const params = { ...defaultModel(), module: measured.diameterMm / 26, teeth: 24, profileShift: 0, pressureAngleDeg: 20 };
  let state = transitionJourney(initialJourney(), { type: 'choose-input', mode: 'photo' });
  state = transitionJourney(state, { type: 'build', params, origin: 'Synthetic region + explicitly confirmed measurements', evidence });
  assert.ok(state.built); const model = state.built;
  const file = prepareModelExport(model.params, 'standard', model), brief = createPrintBrief(model.mesh, model.validation, defaultPrintSettings, model);
  assert.deepEqual(file.passport.evidence, evidence); assert.deepEqual(brief.evidence, file.passport.evidence);
  assert.equal(new DataView(file.stl).getUint32(80, true), file.passport.artifact.triangles);
  evidence.photoAnalysisEvidence.analysisRegion.region.x = 999;
  assert.equal((file.passport.evidence as typeof evidence).photoAnalysisEvidence.analysisRegion.region.x, 50);
  state = transitionJourney(state, { type: 'edit-photo' }); assert.equal(state.built, null);
});
