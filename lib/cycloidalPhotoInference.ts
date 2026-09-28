import type { PhotoScaleUncertainty } from './photo-scale.ts';
import type { ConfirmedMeasurement, MeasurementSource, PhotoInferenceInput } from './photo-inference.ts';

export interface CycloidalPhotoModuleEvidence {
  method: 'confirmed-cycloidal-tip-circle-v1';
  formula: 'm = da / (z + 2)';
  wheelKind: ConfirmedMeasurement<'spur'>;
  profileType: ConfirmedMeasurement<'cycloidal'>;
  toothCount: ConfirmedMeasurement<number>;
  tipDiameterMm: ConfirmedMeasurement<number>;
  tipDiameterMethod: ConfirmedMeasurement<'tip_circle'>;
  standardAddendum: ConfirmedMeasurement<true>;
  addendum: { coefficient: 1; confirmedBy: MeasurementSource; modelBasis: 'cycloidal-kernel-ha-equals-m' };
  conditionalPhotoInterval: null | {
    kind: 'conditional_pixel_bound';
    lowerDiameterMm: number;
    upperDiameterMm: number;
    lowerModuleMm: number;
    upperModuleMm: number;
    includesReferenceTolerance: boolean;
    excludesCameraAndSelectionBias: true;
  };
}

export type CycloidalPhotoModuleInference =
  | { status: 'ready'; moduleMm: number; pitchDiameterMm: number; evidence: CycloidalPhotoModuleEvidence; warnings: string[] }
  | { status: 'missing'; questions: string[] }
  | { status: 'rejected'; reason: string };

const validSources: readonly MeasurementSource[] = ['measurement', 'drawing', 'user_confirmation'];
const sourceOk = (value: unknown): value is MeasurementSource => validSources.includes(value as MeasurementSource);

/** Guard the transfer boundary as well as the calculator: only preserve a result whose evidence still reproduces its values. */
export function cycloidalPhotoInferenceMatches(inference: CycloidalPhotoModuleInference | undefined,
  toothCountSeed?: { value: number; source: MeasurementSource }): boolean {
  if (!inference || inference.status !== 'ready') return false;
  const evidence = inference.evidence;
  const z = evidence.toothCount.value, da = evidence.tipDiameterMm.value;
  if (evidence.method !== 'confirmed-cycloidal-tip-circle-v1' || evidence.formula !== 'm = da / (z + 2)'
    || evidence.wheelKind.value !== 'spur' || !sourceOk(evidence.wheelKind.source)
    || evidence.profileType.value !== 'cycloidal' || !sourceOk(evidence.profileType.source)
    || !Number.isInteger(z) || z < 6 || z > 250 || !sourceOk(evidence.toothCount.source)
    || !Number.isFinite(da) || da <= 0 || !sourceOk(evidence.tipDiameterMm.source)
    || evidence.tipDiameterMethod.value !== 'tip_circle' || !sourceOk(evidence.tipDiameterMethod.source)
    || evidence.standardAddendum.value !== true || !sourceOk(evidence.standardAddendum.source)
    || evidence.addendum.coefficient !== 1 || evidence.addendum.modelBasis !== 'cycloidal-kernel-ha-equals-m'
    || !sourceOk(evidence.addendum.confirmedBy)
    || !Array.isArray(inference.warnings) || !inference.warnings.every(warning => typeof warning === 'string')) return false;
  const moduleMm = da / (z + 2), pitchDiameterMm = moduleMm * z;
  if (inference.moduleMm !== moduleMm || inference.pitchDiameterMm !== pitchDiameterMm
    || moduleMm < .1 || moduleMm > 30 || !Number.isFinite(pitchDiameterMm)) return false;
  if (toothCountSeed && (toothCountSeed.value !== z || toothCountSeed.source !== evidence.toothCount.source)) return false;
  const interval = evidence.conditionalPhotoInterval;
  if (interval && (interval.kind !== 'conditional_pixel_bound' || !Number.isFinite(interval.lowerDiameterMm)
    || !Number.isFinite(interval.upperDiameterMm) || interval.lowerDiameterMm <= 0
    || interval.lowerDiameterMm > da || da > interval.upperDiameterMm
    || interval.lowerModuleMm !== interval.lowerDiameterMm / (z + 2)
    || interval.upperModuleMm !== interval.upperDiameterMm / (z + 2)
    || typeof interval.includesReferenceTolerance !== 'boolean' || interval.excludesCameraAndSelectionBias !== true)) return false;
  return true;
}

/**
 * The current cycloidal kernel fixes ha=m, so da=2(R+m)=m(z+2).
 * This inverse is conditional on a user-confirmed full z, tip circle and height system.
 */
export function inferCycloidalPhotoModule(input: PhotoInferenceInput, diameterUncertainty?: PhotoScaleUncertainty): CycloidalPhotoModuleInference {
  const kind = input.kind, profile = input.profileType, teeth = input.toothCount;
  const diameter = input.tipDiameterMm, method = input.tipDiameterMethod, addendum = input.standardAddendum;
  for (const [label, fact] of [['type', kind], ['profile', profile], ['tooth count', teeth], ['tip diameter', diameter], ['diameter method', method], ['addendum', addendum]] as const) {
    if (fact && !sourceOk(fact.source)) return { status: 'rejected', reason: `Источник подтверждения для ${label} некорректен.` };
  }
  if (kind?.value !== 'spur') return { status: 'missing', questions: ['Подтвердите внешнее прямозубое цилиндрическое колесо.'] };
  if (profile?.value !== 'cycloidal') return { status: 'missing', questions: ['Подтвердите циклоидальный профиль по чертежу, документации или осмотру детали.'] };
  if (!teeth) return { status: 'missing', questions: ['Подтвердите полное число зубьев, включая повреждённые.'] };
  if (!Number.isInteger(teeth.value) || teeth.value < 6 || teeth.value > 250)
    return { status: 'rejected', reason: 'Число зубьев должно быть целым от 6 до 250.' };
  if (!diameter) return { status: 'missing', questions: ['Измерьте или возьмите из чертежа диаметр окружности вершин.'] };
  if (!Number.isFinite(diameter.value) || diameter.value <= 0)
    return { status: 'rejected', reason: 'Диаметр окружности вершин должен быть конечным числом больше нуля.' };
  if (!method) return { status: 'missing', questions: ['Подтвердите, что задан именно диаметр окружности вершин.'] };
  if (method.value !== 'tip_circle') return { status: 'missing', questions: ['Для этой модели нужен диаметр окружности вершин; размер между вершинами штангенциркулем не подменяет его.'] };
  if (!addendum) return { status: 'missing', questions: ['Подтвердите высоту головки ha=m и отсутствие укорочения или модификации вершин.'] };
  if (addendum.value !== true) return { status: 'missing', questions: ['Текущая геометрия требует подтверждённой высоты головки ha=m без укорочения.'] };

  if (diameterUncertainty && (diameterUncertainty.kind !== 'conditional_pixel_bound'
    || !Number.isFinite(diameterUncertainty.pixelUncertaintyPx) || diameterUncertainty.pixelUncertaintyPx < 0
    || !Number.isFinite(diameterUncertainty.maxRelativeDeviation) || diameterUncertainty.maxRelativeDeviation < 0
    || !Number.isFinite(diameterUncertainty.lowerDiameterMm) || !Number.isFinite(diameterUncertainty.upperDiameterMm)
    || diameterUncertainty.lowerDiameterMm <= 0 || diameterUncertainty.lowerDiameterMm > diameter.value
    || diameter.value > diameterUncertainty.upperDiameterMm))
    return { status: 'rejected', reason: 'Условный интервал PhotoScale не содержит заданный диаметр; проверьте измерение.' };

  const z = teeth.value, da = diameter.value, moduleMm = da / (z + 2), pitchDiameterMm = moduleMm * z;
  if (![moduleMm, pitchDiameterMm].every(Number.isFinite) || moduleMm < .1 || moduleMm > 30)
    return { status: 'rejected', reason: 'Расчётный модуль вне области модели 0,1–30 мм. Проверьте единицы, диаметр и число зубьев.' };

  const conditionalPhotoInterval = diameterUncertainty ? {
    kind: 'conditional_pixel_bound' as const,
    lowerDiameterMm: diameterUncertainty.lowerDiameterMm,
    upperDiameterMm: diameterUncertainty.upperDiameterMm,
    lowerModuleMm: diameterUncertainty.lowerDiameterMm / (z + 2),
    upperModuleMm: diameterUncertainty.upperDiameterMm / (z + 2),
    includesReferenceTolerance: diameterUncertainty.includesReferenceTolerance,
    excludesCameraAndSelectionBias: true as const,
  } : null;
  const warnings = conditionalPhotoInterval ? [
    'Интервал модуля условный: он переносит границы ошибок точек и эталона PhotoScale, но не учитывает наклон камеры, дисторсию, неверно выбранные вершины или ошибку предположения ha=m.',
    ...(conditionalPhotoInterval.lowerModuleMm < .1 || conditionalPhotoInterval.upperModuleMm > 30
      ? ['Условный интервал частично выходит за диапазон модуля текущего ядра; это не исправлено округлением или усечением.'] : []),
  ] : ['Результат условен: ошибки диаметра не заданы интервалом, а высота головки принята по подтверждённой гипотезе ha=m.'];
  return { status: 'ready', moduleMm, pitchDiameterMm, warnings, evidence: {
    method: 'confirmed-cycloidal-tip-circle-v1', formula: 'm = da / (z + 2)',
    wheelKind: { value: 'spur', source: kind.source, ...(kind.note ? { note: kind.note } : {}) },
    profileType: { value: 'cycloidal', source: profile.source, ...(profile.note ? { note: profile.note } : {}) },
    toothCount: structuredClone(teeth), tipDiameterMm: structuredClone(diameter),
    tipDiameterMethod: { value: 'tip_circle', source: method.source, ...(method.note ? { note: method.note } : {}) },
    standardAddendum: { value: true, source: addendum.source, ...(addendum.note ? { note: addendum.note } : {}) },
    addendum: { coefficient: 1, confirmedBy: addendum.source, modelBasis: 'cycloidal-kernel-ha-equals-m' },
    conditionalPhotoInterval,
  } };
}
