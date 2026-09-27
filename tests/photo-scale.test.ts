import test from 'node:test';
import assert from 'node:assert/strict';
import { estimatePhotoCircle, type PhotoPoint, type PhotoScaleInput } from '../lib/photo-scale.ts';

const base = (change: Partial<PhotoScaleInput> = {}): PhotoScaleInput => ({
  imageWidth: 1600, imageHeight: 1600,
  referencePoints: [{ x: 300, y: 1250 }, { x: 800, y: 1250 }], referenceLengthMm: 100,
  tipPoints: [{ x: 1100, y: 800 }, { x: 800, y: 1100 }, { x: 500, y: 800 }],
  confirmedCoplanar: true, confirmedAxialView: true, ...change,
});
const close = (actual: number, expected: number, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const ready = (input: PhotoScaleInput) => {
  const result = estimatePhotoCircle(input);
  assert.equal(result.status, 'ready', JSON.stringify(result));
  if (result.status !== 'ready') throw Error('Expected a ready measurement');
  return result;
};
const rejects = (change: Partial<PhotoScaleInput>, code: string) => {
  const result = estimatePhotoCircle(base(change));
  assert.equal(result.status, 'rejected', JSON.stringify(result));
  assert.ok(result.issues.some(issue => issue.code === code), JSON.stringify(result.issues));
  assert.equal(result.diameterMm, undefined, 'rejected result cannot be applied');
};
const pointsOnCircle = (angles: number[], center = { x: 800, y: 800 }, radius = 300): PhotoPoint[] => angles.map(deg => ({
  x: center.x + radius * Math.cos(deg * Math.PI / 180), y: center.y + radius * Math.sin(deg * Math.PI / 180),
}));

test('independent right-triangle diameter and reference ratio give 120 mm', () => {
  // The hypotenuse joins x=500 and x=1100, so Thales gives diameter=600 px.
  // An independently specified 500 px reference is 100 mm: D=600*100/500.
  const result = ready(base());
  close(result.diameterMm, 120); close(result.scaleMmPerPixel, .2);
  close(result.circle.center.x, 800); close(result.circle.center.y, 800);
  close(result.circle.radiusPx, 300); close(result.circle.diameterPx, 600);
  assert.equal(result.uncertainty.kind, 'conditional_pixel_bound');
  assert.equal(result.uncertainty.pixelUncertaintyPx, 1);
  assert.equal(result.uncertainty.includesReferenceTolerance, false);
  assert.ok(result.uncertainty.lowerDiameterMm < 120 && result.uncertainty.upperDiameterMm > 120);
  assert.ok(result.warnings.some(warning => warning.includes('Допуск длины эталона не задан')));
});

test('equilateral circumcircle independently recovers radius and all point orders agree', () => {
  // a=300*sqrt(3), circumradius=a/sqrt(3)=300, established independently.
  const points = pointsOnCircle([0, 120, 240]);
  const expected = ready(base({ tipPoints: points }));
  for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const result = ready(base({ tipPoints: order.map(index => points[index]) }));
    close(result.diameterMm, 120); close(result.circle.center.x, 800); close(result.circle.center.y, 800);
    close(result.uncertainty.lowerDiameterMm, expected.uncertainty.lowerDiameterMm);
    close(result.uncertainty.upperDiameterMm, expected.uncertainty.upperDiameterMm);
  }
});

test('rotation, translation and resolution preserve mm and the stipulated uncertainty', () => {
  const original = base({ referenceToleranceMm: .1, pixelUncertaintyPx: 2 });
  const expected = ready(original);
  for (const angle of [0, .123, Math.PI / 3, Math.PI, -Math.PI / 4]) {
    for (const scale of [.5, 1, 3.7]) {
      const transform = (p: PhotoPoint): PhotoPoint => ({
        x: ((p.x - 800) * Math.cos(angle) - (p.y - 800) * Math.sin(angle) + 800 + 37) * scale,
        y: ((p.x - 800) * Math.sin(angle) + (p.y - 800) * Math.cos(angle) + 800 + 83) * scale,
      });
      const result = ready({ ...original, referencePoints: original.referencePoints.map(transform), tipPoints: original.tipPoints.map(transform),
        imageWidth: 1800 * scale, imageHeight: 1800 * scale, pixelUncertaintyPx: 2 * scale });
      close(result.diameterMm, expected.diameterMm);
      close(result.circle.diameterPx, expected.circle.diameterPx * scale);
      close(result.uncertainty.lowerDiameterMm, expected.uncertainty.lowerDiameterMm);
      close(result.uncertainty.upperDiameterMm, expected.uncertainty.upperDiameterMm);
    }
  }
});

test('missing points, physical scale or either physical confirmation cannot yield usable mm', () => {
  for (const [field, value] of [['referencePoints', []], ['referencePoints', [{ x: 1, y: 1 }]], ['tipPoints', []], ['tipPoints', base().tipPoints.slice(0, 2)], ['referenceLengthMm', undefined], ['confirmedCoplanar', false], ['confirmedAxialView', false]] as const) {
    const result = estimatePhotoCircle(base({ [field]: value }));
    assert.equal(result.status, 'missing', JSON.stringify(result));
    assert.ok(result.missingFields.includes(field));
    assert.equal(result.diameterMm, undefined);
  }
  const runtime = base({ confirmedCoplanar: 'yes' as unknown as boolean });
  assert.equal(estimatePhotoCircle(runtime).status, 'missing', 'truthy text is not physical confirmation');
});

test('rejects invalid lengths, tolerances, dimensions, uncertainty, counts and coordinates', () => {
  for (const value of [0, -1, NaN, Infinity]) rejects({ referenceLengthMm: value }, 'INVALID_REFERENCE_LENGTH');
  for (const value of [-.1, 100, 101, NaN, Infinity]) rejects({ referenceToleranceMm: value }, 'INVALID_REFERENCE_TOLERANCE');
  for (const value of [0, -1, NaN, Infinity]) rejects({ imageWidth: value }, 'INVALID_IMAGE_SIZE');
  for (const value of [-1, NaN, Infinity]) rejects({ pixelUncertaintyPx: value }, 'INVALID_PIXEL_UNCERTAINTY');
  rejects({ referencePoints: [...base().referencePoints, { x: 1, y: 1 }] }, 'INVALID_POINT_COUNT');
  rejects({ tipPoints: [...base().tipPoints, { x: 1, y: 1 }] }, 'INVALID_POINT_COUNT');
  for (const point of [{ x: -1, y: 10 }, { x: 1601, y: 10 }, { x: 10, y: -1 }, { x: 10, y: 1601 }, { x: NaN, y: 10 }, { x: 10, y: Infinity }])
    rejects({ tipPoints: [point, ...base().tipPoints.slice(1)] }, 'POINT_OUTSIDE_IMAGE');
});

test('short reference is checked in image pixels and relative to selection uncertainty', () => {
  rejects({ referencePoints: [{ x: 20, y: 20 }, { x: 39, y: 20 }] }, 'REFERENCE_TOO_SHORT');
  rejects({ referencePoints: [{ x: 20, y: 20 }, { x: 20, y: 20 }] }, 'REFERENCE_TOO_SHORT');
  rejects({ referencePoints: [{ x: 20, y: 20 }, { x: 70, y: 20 }], pixelUncertaintyPx: 3 }, 'REFERENCE_TOO_SHORT');
});

test('collinear, nearly collinear, coincident and clustered tips are not a circle measurement', () => {
  rejects({ tipPoints: [{ x: 300, y: 300 }, { x: 500, y: 300 }, { x: 700, y: 300 }] }, 'DEGENERATE_CIRCLE');
  rejects({ tipPoints: [{ x: 300, y: 300 }, { x: 500, y: 300 + 1e-8 }, { x: 700, y: 300 }] }, 'DEGENERATE_CIRCLE');
  rejects({ tipPoints: [{ x: 300, y: 300 }, { x: 300, y: 300 }, { x: 700, y: 500 }] }, 'DEGENERATE_CIRCLE');
  for (const angles of [[0, 10, 15], [0, 5, 180], [0, 50, 100]]) rejects({ tipPoints: pointsOnCircle(angles) }, 'TIP_POINTS_CLUSTERED');
  close(ready(base({ tipPoints: pointsOnCircle([0, 75, 150]) })).diameterMm, 120);
});

test('circle outside image is rejected even when all selected points are inside', () => {
  rejects({ tipPoints: [{ x: 350, y: 800 }, { x: 50, y: 1100 }, { x: 50, y: 500 }] }, 'CIRCLE_OUTSIDE_IMAGE');
});

test('large or unbounded pixel interval rejects the measurement', () => {
  rejects({ pixelUncertaintyPx: 25 }, 'UNCERTAINTY_TOO_HIGH');
  rejects({ tipPoints: pointsOnCircle([0, 120, 240], { x: 800, y: 800 }, .2) }, 'UNBOUNDED_UNCERTAINTY');
});

test('explicit reference tolerance propagates both ways; epsilon zero stays an explicit ideal assumption', () => {
  const result = ready(base({ pixelUncertaintyPx: 0, referenceToleranceMm: .5 }));
  assert.equal(result.uncertainty.includesReferenceTolerance, true);
  // With no coordinate error, 600/500 * [99.5,100.5] = [119.4,120.6].
  assert.ok(result.uncertainty.lowerDiameterMm <= 119.4);
  assert.ok(result.uncertainty.upperDiameterMm >= 120.6);
  close(result.uncertainty.lowerDiameterMm, 119.4);
  close(result.uncertainty.upperDiameterMm, 120.6);
  const noError = ready(base({ pixelUncertaintyPx: 0, referenceToleranceMm: 0 }));
  assert.ok(noError.uncertainty.lowerDiameterMm <= 120 && noError.uncertainty.upperDiameterMm >= 120);
  close(noError.uncertainty.lowerDiameterMm, 120); close(noError.uncertainty.upperDiameterMm, 120);
});

test('analytic bounds enclose an independent true diameter for 1000 bounded perturbations', () => {
  let state = 41317;
  const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 2 ** 32; };
  const epsilon = 2, tolerance = .1;
  const perturb = (p: PhotoPoint): PhotoPoint => {
    const angle = random() * 2 * Math.PI, radius = epsilon * Math.sqrt(random());
    return { x: p.x + radius * Math.cos(angle), y: p.y + radius * Math.sin(angle) };
  };
  // True circle and true reference are independent known geometry, not a call to this estimator.
  for (let trial = 0; trial < 1000; trial++) {
    const input = base();
    const result = ready({ ...input, referencePoints: input.referencePoints.map(perturb), tipPoints: input.tipPoints.map(perturb),
      referenceLengthMm: 100 + tolerance * (2 * random() - 1), referenceToleranceMm: tolerance, pixelUncertaintyPx: epsilon });
    assert.ok(result.uncertainty.lowerDiameterMm <= 120, `lower bound excludes truth at trial ${trial}`);
    assert.ok(result.uncertainty.upperDiameterMm >= 120, `upper bound excludes truth at trial ${trial}`);
  }
});

test('does not mutate frozen input or imply camera calibration or profile identification', () => {
  const input = base();
  for (const group of [input.referencePoints, input.tipPoints]) { group.forEach(Object.freeze); Object.freeze(group); }
  Object.freeze(input);
  const result = ready(input);
  assert.ok(result.warnings.some(warning => warning.includes('дисторсия')));
  assert.ok(result.warnings.some(warning => warning.includes('не подтверждает эвольвентный профиль')));
  assert.equal('toothCount' in result, false);
  assert.equal('module' in result, false);
});
