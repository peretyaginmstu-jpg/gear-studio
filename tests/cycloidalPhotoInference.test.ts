import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultModel } from '../lib/model.ts';
import { buildCycloidalMesh } from '../lib/cycloidalGeometry.ts';
import { cycloidalPhotoInferenceMatches, inferCycloidalPhotoModule } from '../lib/cycloidalPhotoInference.ts';
import type { ConfirmedMeasurement, PhotoInferenceInput } from '../lib/photo-inference.ts';
import type { PhotoScaleUncertainty } from '../lib/photo-scale.ts';

const fact = <T>(value: T, source: ConfirmedMeasurement<T>['source'] = 'measurement'): ConfirmedMeasurement<T> => ({ value, source });
const base = (change: Partial<PhotoInferenceInput> = {}): PhotoInferenceInput => ({
  kind: fact('spur', 'user_confirmation'), profileType: fact('cycloidal', 'drawing'), toothCount: fact(24),
  tipDiameterMm: fact(78), tipDiameterMethod: fact('tip_circle'), standardAddendum: fact(true, 'drawing'), ...change,
});
const ready = (input: PhotoInferenceInput, uncertainty?: PhotoScaleUncertainty) => {
  const result = inferCycloidalPhotoModule(input, uncertainty);
  assert.equal(result.status, 'ready', JSON.stringify(result));
  if (result.status !== 'ready') throw Error('Expected a derived cycloidal module');
  return result;
};
const close = (actual: number, expected: number, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('confirmed cycloidal da=78 and z=24 recover m=3 without standard-series snapping', () => {
  const result = ready(base());
  close(result.moduleMm, 3); close(result.pitchDiameterMm, 72);
  assert.equal(result.evidence.formula, 'm = da / (z + 2)');
  assert.equal(result.evidence.addendum.coefficient, 1);
  assert.deepEqual(result.evidence.tipDiameterMm, fact(78));
});

test('derived module agrees with the forward cycloidal kernel tip diameter', () => {
  for (const { teeth, module, diameter } of [{ teeth: 6, module: 1.25, diameter: 10 }, { teeth: 24, module: 3, diameter: 78 }, { teeth: 97, module: 2.005, diameter: 198.495 }]) {
    const result = ready(base({ toothCount: fact(teeth), tipDiameterMm: fact(diameter) }));
    close(result.moduleMm, module);
    const mesh = buildCycloidalMesh({ ...defaultModel('cycloidal'), kind: 'cycloidal', teeth, module: result.moduleMm, bore: 0 });
    close(mesh.dimensions.tipDiameter, diameter, 1e-10);
    close(mesh.cycloidalDimensions.referenceModule, result.moduleMm);
  }
});

test('PhotoScale uncertainty propagates monotonically to an explicitly conditional module interval', () => {
  const uncertainty: PhotoScaleUncertainty = { kind: 'conditional_pixel_bound', pixelUncertaintyPx: 2,
    lowerDiameterMm: 77.6, upperDiameterMm: 78.4, maxRelativeDeviation: .01, includesReferenceTolerance: true };
  const result = ready(base(), uncertainty);
  const interval = result.evidence.conditionalPhotoInterval!;
  close(interval.lowerModuleMm, 77.6 / 26); close(interval.upperModuleMm, 78.4 / 26);
  assert.equal(interval.includesReferenceTolerance, true); assert.equal(interval.excludesCameraAndSelectionBias, true);
  assert.ok(result.warnings.some(warning => /наклон камеры/.test(warning)));
});

test('handoff guard reproduces the formula and requires evidence sources to remain consistent', () => {
  const inference = ready(base());
  assert.equal(cycloidalPhotoInferenceMatches(inference, { value: 24, source: 'measurement' }), true);
  assert.equal(cycloidalPhotoInferenceMatches(inference, { value: 24, source: 'drawing' }), false);
  assert.equal(cycloidalPhotoInferenceMatches({ ...inference, moduleMm: 3.01 }), false);
  assert.equal(cycloidalPhotoInferenceMatches({ ...inference, evidence: { ...inference.evidence,
    wheelKind: fact('helical' as 'spur') } }), false);
});

test('missing prerequisites produce concrete questions instead of a numeric module', () => {
  for (const input of [
    base({ kind: undefined }), base({ profileType: undefined }), base({ toothCount: undefined }),
    base({ tipDiameterMm: undefined }), base({ tipDiameterMethod: undefined }), base({ standardAddendum: undefined }),
    base({ standardAddendum: fact(false) }), base({ tipDiameterMethod: fact('opposed_tips') }),
  ]) {
    const result = inferCycloidalPhotoModule(input);
    assert.equal(result.status, 'missing', JSON.stringify(result));
    if (result.status === 'missing') assert.ok(result.questions.length);
  }
});

test('helix, internal teeth, non-cycloidal profile and invalid measurements never enter this kernel', () => {
  for (const input of [base({ kind: fact('helical') }), base({ kind: fact('internal') }), base({ profileType: fact('involute') })])
    assert.equal(inferCycloidalPhotoModule(input).status, 'missing');
  for (const input of [
    base({ toothCount: fact(5) }), base({ toothCount: fact(24.5) }), base({ toothCount: fact(251) }),
    base({ tipDiameterMm: fact(0) }), base({ tipDiameterMm: fact(Infinity) }),
    base({ tipDiameterMm: fact(10000) }), base({ tipDiameterMm: { value: 78, source: 'ai_guess' as 'measurement' } }),
  ]) assert.equal(inferCycloidalPhotoModule(input).status, 'rejected', JSON.stringify(input));
});

test('an inconsistent PhotoScale interval is rejected, never clipped', () => {
  const uncertainty: PhotoScaleUncertainty = { kind: 'conditional_pixel_bound', pixelUncertaintyPx: 2,
    lowerDiameterMm: 78.1, upperDiameterMm: 79, maxRelativeDeviation: .02, includesReferenceTolerance: false };
  const result = inferCycloidalPhotoModule(base(), uncertainty);
  assert.equal(result.status, 'rejected');
});
