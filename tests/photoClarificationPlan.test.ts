import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhotoClarificationPlan, photoClarificationPlanMarkdown, type PhotoClarificationContext } from '../lib/photoClarificationPlan.ts';
import { inferGearFromMeasurements, type ConfirmedMeasurement, type InferredGearKind, type PhotoInferenceInput } from '../lib/photo-inference.ts';
import { analyzeSpanMeasurement, selectSpanApplication } from '../lib/spanMeasurement.ts';
import type { PhotoRegionEvidence } from '../lib/photo-region.ts';

const fact = <T>(value: T): ConfirmedMeasurement<T> => ({ value, source: 'user_confirmation' });
const complete = (): PhotoInferenceInput => ({ kind: fact('spur'), toothCount: fact(24), profileType: fact('involute'),
  pressureAngleDeg: fact(20), profileShift: fact(0), tipDiameterMm: fact(52), tipDiameterMethod: fact('tip_circle'), standardAddendum: fact(true) });
const context = (input: PhotoInferenceInput = complete(), change: Partial<PhotoClarificationContext> = {}): PhotoClarificationContext => ({
  input, selectedKind: input.kind?.value ?? 'unknown', enteredToothCount: input.toothCount ? String(input.toothCount.value) : '',
  toothCountConfirmed: !!input.toothCount, familyReady: true, symmetricHerringbone: false, span: { mode: 'direct' }, ...change,
});
const ids = (ctx: PhotoClarificationContext) => buildPhotoClarificationPlan(ctx).items.map(item => item.id);
const spanApplication = () => selectSpanApplication(analyzeSpanMeasurement({
  kind: 'spur', teeth: 24, spanTeeth: 3, pressureAngleDeg: 20, pressureAngleConfirmed: true,
  spanMm: 15.44, nextSpanMm: 21.34, tipDiameterMm: 52, tipDiameterMethod: 'tip_circle',
  errorBounds: { spanMm: .01, nextSpanMm: .01, tipDiameterMm: .01 },
  confirmations: { teeth: true, involute: true, standardTip: true, measurementSetup: true }, toolTipRadiusCoefficient: .3,
}), 'bounded-zero-thinning-fit');

test('unknown step data produce concrete actions and no implicit angle, shift or profile', () => {
  const ctx = context({ kind: fact('spur'), toothCount: fact(24) }), before = structuredClone(ctx);
  const plan = buildPhotoClarificationPlan(ctx);
  assert.equal(plan.status, 'needs-information');
  assert.deepEqual(new Set(plan.items.map(item => item.id)), new Set(['profileType', 'pressureAngleDeg', 'profileShift', 'standardAddendum', 'tipDiameterMm', 'tipDiameterMethod']));
  assert.match(plan.nextAction, /чертеж|каталог|документац/);
  assert.ok(!plan.entered.some(value => /Угол α|Смещение|^Профиль$/.test(value.label)));
  assert.deepEqual(plan.methods.map(value => value.id), ['photo-scale', 'span']);
  assert.deepEqual(ctx, before, 'guidance must not mutate or confirm the draft');
});

test('all seven supported photo families are ready only for their relevant valid inputs', () => {
  const kinds: InferredGearKind[] = ['spur', 'helical', 'herringbone', 'internal', 'internal-helical', 'rack', 'helical-rack'];
  for (const kind of kinds) {
    const rack = kind.includes('rack'), helical = ['helical', 'herringbone', 'internal-helical', 'helical-rack'].includes(kind);
    const input = { ...complete(), kind: fact(kind), ...(helical ? { helixAngleDeg: fact(-20) } : {}),
      ...(rack ? { transversePitchMm: fact(6.28), tipDiameterMm: undefined, tipDiameterMethod: undefined } : {}) };
    const plan = buildPhotoClarificationPlan(context(input, { symmetricHerringbone: kind === 'herringbone' }));
    assert.equal(plan.status, 'step-ready', kind); assert.deepEqual(plan.items, [], kind); assert.deepEqual(plan.methods, [], kind);
    assert.match(plan.nextAction, /этого шага/); assert.match(plan.nextAction, /Проверьте размеры тела и модель/);
  }
});

test('each missing field remains actionable; unknown is not a confirmed value', () => {
  for (const field of ['profileType', 'pressureAngleDeg', 'profileShift', 'standardAddendum', 'tipDiameterMm', 'tipDiameterMethod', 'toothCount'] as const) {
    const input = { ...complete(), [field]: undefined }, plan = buildPhotoClarificationPlan(context(input));
    assert.notEqual(plan.status, 'step-ready', field); assert.ok(plan.items.some(item => item.id === field), field);
  }
  const plan = buildPhotoClarificationPlan(context({ ...complete(), kind: fact('helical') }));
  assert.ok(plan.items.some(item => item.id === 'helixAngleDeg'));
  assert.ok(!plan.methods.some(method => method.id === 'span'));
});

test('invalid finite values and invalid sources are never promoted from inference provenance', () => {
  for (const patch of [{ pressureAngleDeg: fact(40) }, { pressureAngleDeg: fact(NaN) }, { profileShift: fact(2) }, { tipDiameterMm: fact(-52) },
    { pressureAngleDeg: { value: 20, source: 'guessed' as 'measurement' } }]) {
    const input = { ...complete(), ...patch };
    assert.equal(inferGearFromMeasurements(input).provenance.pressureAngleDeg.status, 'confirmed', 'old presence-based provenance is deliberately insufficient');
    const plan = buildPhotoClarificationPlan(context(input));
    assert.equal(plan.status, 'needs-correction'); assert.ok(plan.items.some(item => item.problems.length > 0));
    assert.doesNotMatch(photoClarificationPlanMarkdown(plan), /ANGLE_RANGE|NON_FINITE|INVALID_SOURCE/);
  }
});

test('unknown and unsupported families and profiles have an explicit next step without substitute models', () => {
  const unknown = buildPhotoClarificationPlan(context({ silhouette: 'external_circular' }));
  assert.equal(unknown.status, 'needs-information'); assert.ok(unknown.items.some(item => item.id === 'kind')); assert.deepEqual(unknown.methods, []);
  for (const selectedKind of ['other', 'worm', 'bevel', 'cycloidal']) {
    const plan = buildPhotoClarificationPlan(context({}, { selectedKind }));
    assert.equal(plan.status, 'unsupported'); assert.deepEqual(plan.methods, []); assert.match(plan.items[0].problems.join(' '), /ручную модель/);
  }
  for (const patch of [{ profileType: fact('cycloidal' as const) }, { standardAddendum: fact(false) }]) {
    const plan = buildPhotoClarificationPlan(context({ ...complete(), ...patch }));
    assert.equal(plan.status, 'unsupported'); assert.deepEqual(plan.methods, []);
  }
});

test('odd-tooth opposed-tip method needs clarification even when inference has no issue', () => {
  const input = { ...complete(), toothCount: fact(25), tipDiameterMethod: fact('opposed_tips' as const) };
  assert.deepEqual(inferGearFromMeasurements(input).issues, []);
  const plan = buildPhotoClarificationPlan(context(input));
  assert.equal(plan.status, 'needs-information'); assert.deepEqual(plan.items.map(item => item.id), ['tipDiameterMethod']);
  assert.match(plan.items[0].action, /нечётном/); assert.ok(plan.entered.some(value => value.note?.includes('требуется уточнение')));
});

test('rack pitch may yield a module while x/addendum remain unknown; circular tools are absent', () => {
  const input: PhotoInferenceInput = { ...complete(), kind: fact('rack'), transversePitchMm: fact(6.28), tipDiameterMm: undefined,
    tipDiameterMethod: undefined, profileShift: undefined, standardAddendum: undefined };
  assert.ok(inferGearFromMeasurements(input).calculation);
  const plan = buildPhotoClarificationPlan(context(input));
  assert.equal(plan.status, 'needs-information'); assert.deepEqual(plan.methods, []);
  assert.ok(plan.items.some(item => item.id === 'profileShift')); assert.ok(plan.items.some(item => item.id === 'standardAddendum'));
  const missingPitch = buildPhotoClarificationPlan(context({ ...input, transversePitchMm: undefined }));
  assert.match(missingPitch.items.find(item => item.id === 'transversePitchMm')!.action, /число промежутков/);
});

test('family, count and herringbone confirmations are independent gates beyond dimension inference', () => {
  const input = complete(); assert.equal(inferGearFromMeasurements(input).status, 'ready');
  assert.ok(ids(context(input, { familyReady: false })).includes('family'));
  assert.ok(ids(context(input, { toothCountConfirmed: false })).includes('toothCount'));
  assert.ok(ids(context(input, { enteredToothCount: '25' })).includes('toothCount'));
  assert.ok(ids(context(input, { enteredToothCount: '' })).includes('toothCount'));
  assert.ok(ids(context(input, { selectedKind: 'internal' })).includes('kind'));
  assert.ok(ids(context({ ...input, kind: fact('herringbone'), helixAngleDeg: fact(20) })).includes('herringbone'));
});

test('pending span cannot reuse ready direct values and prioritizes shared prerequisites', () => {
  const pending = context(complete(), { span: { mode: 'pending' } }), plan = buildPhotoClarificationPlan(pending);
  assert.equal(plan.status, 'span-pending'); assert.deepEqual(plan.items.map(item => item.id), ['span']); assert.deepEqual(plan.methods, []);
  assert.match(plan.items[0].action, /вернит|возврат/);
  assert.ok(plan.entered.filter(value => /Угол α|Смещение|Диаметр вершин/.test(value.label)).every(value => value.note?.includes('не используется')));
  const absent = buildPhotoClarificationPlan({ ...pending, input: { kind: fact('spur'), toothCount: fact(24) } });
  assert.equal(absent.items[0].id, 'profileType');
  assert.deepEqual(absent.items.map(item => item.id), ['profileType', 'standardAddendum', 'span']);
});

test('applied bounded span uses its representative readings, not absent or stale direct values', () => {
  const application = spanApplication(), ctx = context({ kind: fact('spur'), toothCount: fact(24), profileType: fact('involute'), standardAddendum: fact(true),
    tipDiameterMm: fact(-5), tipDiameterMethod: fact('uncorrected_caliper_span'), pressureAngleDeg: fact(40), profileShift: fact(2) }, { span: { mode: 'applied', application } });
  const plan = buildPhotoClarificationPlan(ctx);
  assert.equal(plan.status, 'step-ready'); assert.deepEqual(plan.items, []);
  const memo = photoClarificationPlanMarkdown(plan);
  assert.ok(memo.includes(String(application.candidate.representativeReadings.tipDiameterMm)));
  assert.ok(memo.includes(String(application.candidate.parameters.module))); assert.match(memo, /52 ± 0.01/);
  assert.match(memo, /прежний прямой ввод; не используется/);
  assert.notEqual(buildPhotoClarificationPlan({ ...ctx, toothCountConfirmed: false }).status, 'step-ready');
  assert.notEqual(buildPhotoClarificationPlan({ ...ctx, input: { ...ctx.input, toothCount: fact(25) }, enteredToothCount: '25' }).status, 'step-ready');
});

test('fresh inputs, family or region yield a fresh plan without retained confirmations', () => {
  const accepted = context(); assert.equal(buildPhotoClarificationPlan(accepted).status, 'step-ready');
  const changed = context({ kind: fact('internal'), toothCount: fact(80) });
  const plan = buildPhotoClarificationPlan(changed);
  assert.notEqual(plan.status, 'step-ready'); assert.ok(!plan.methods.some(method => method.id === 'span'));
  assert.match(plan.items.find(item => item.id === 'tipDiameterMm')!.action, /внутрь кольца/);
  const region: PhotoRegionEvidence = { schema: 'zatseplenie.photo-region.v1', method: 'user-selection',
    coordinateSystem: 'working_image_pixels; origin=top-left; angle=clockwise-from-right', regionConvention: 'integer-pixel-cell-edges; half-open',
    region: { x: 141, y: 140, width: 439, height: 440 }, workingImage: { width: 1200, height: 800 }, processedImage: { width: 439, height: 440 },
    processedToWorking: { offsetX: 141, offsetY: 140, scaleX: 1, scaleY: 1 }, cropOperation: 'integer-pixel-copy; no-stretch' };
  const reset = buildPhotoClarificationPlan(context({}, { analysisRegion: region }));
  assert.notEqual(reset.status, 'step-ready'); assert.match(photoClarificationPlanMarkdown(reset), /141, 140/);
  assert.ok(!reset.entered.some(value => /Угол α|Смещение/.test(value.label)));
});

test('memo is readable Markdown with scope and current values, no photo or project payload', () => {
  const ctx = context(), before = structuredClone(ctx), plan = buildPhotoClarificationPlan(ctx);
  const memo = photoClarificationPlanMarkdown(plan);
  assert.match(memo, /^# План уточнений/); assert.match(memo, /Введено сейчас/); assert.match(memo, /Угол α, °: 20/);
  assert.match(memo, /Смещение xₙ: 0/); assert.match(memo, /не является сохранённым проектом, чертежом или заказом/);
  assert.match(memo, /не отправляется серверу/); assert.doesNotMatch(memo, /data:image|base64|"schema"|provenance/);
  assert.equal(photoClarificationPlanMarkdown(plan), memo); assert.deepEqual(ctx, before);
  const edited = buildPhotoClarificationPlan(context({ ...complete(), pressureAngleDeg: undefined }));
  assert.match(photoClarificationPlanMarkdown(edited), /Угол профиля/); assert.notEqual(edited.status, 'step-ready');
  const invalid = buildPhotoClarificationPlan(context({ ...complete(), tipDiameterMethod: fact('constructor' as 'tip_circle'),
    pressureAngleDeg: { value: 20, source: 'toString' as 'measurement' } }));
  assert.equal(invalid.status, 'needs-correction');
  assert.match(photoClarificationPlanMarkdown(invalid), /неизвестный способ/);
  assert.doesNotMatch(photoClarificationPlanMarkdown(invalid), /function|Ниже|зубья» ниже/);
});
