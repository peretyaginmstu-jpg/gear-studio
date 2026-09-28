import { buildGearProfile, defaultGearParams } from './gearMath.ts';
import type { GearWarning } from './gearMath.ts';

export interface SpanReadings { spanMm: number; nextSpanMm: number; tipDiameterMm: number }
export type SpanErrorBounds = SpanReadings;
export interface SpanMeasurementInput extends SpanReadings {
  kind: string;
  teeth: number;
  spanTeeth: number;
  pressureAngleDeg: number | null;
  pressureAngleConfirmed: boolean;
  tipDiameterMethod: 'tip_circle' | 'opposed_tips' | 'unknown' | 'uncorrected_caliper_span';
  errorBounds: SpanErrorBounds;
  confirmations: { teeth: boolean; involute: boolean; standardTip: boolean; measurementSetup: boolean };
  /** Assumed rounded rack tip, not identified by the three measurements. */
  toolTipRadiusCoefficient: number;
}
export interface SpanParameters {
  kind: 'spur'; teeth: number; module: number; pressureAngleDeg: number; helixAngleDeg: 0;
  profileShift: number; backlash: number; toolTipRadiusCoefficient: number;
}
export interface SpanNumbers { basePitchMm: number; moduleMm: number; profileShift: number; toothThinningMm: number }
export interface SpanContact {
  teeth: number; spanMm: number; radiusMm: number; involuteRoll: number;
  rootJoinMarginMm: number; tipMarginMm: number;
}
export interface SpanCandidate {
  parameters: SpanParameters;
  representativeReadings: SpanReadings;
  residuals: SpanReadings;
  geometry: { baseRadiusMm: number; tipRadiusMm: number; generatedJoinRadiusMm: number; contacts: SpanContact[]; warnings: GearWarning[] };
  arithmetic: { rawThinningMm: number; zeroRoundoffToleranceMm: number; canonicalizedNumericalZero: boolean };
}
export interface SpanInterval { min: number; max: number }
export interface SpanUncertainty {
  interpretation: 'deterministic-independent-reading-bounds; conditional-on-fixed-angle-and-assumptions';
  basePitchMm: SpanInterval; moduleMm: SpanInterval; profileShift: SpanInterval; toothThinningMm: SpanInterval;
  differenceConditionNumber: number;
  relativeBasePitchErrorBound: number;
  angleToleranceIncluded: false;
  numericalPaddingIncluded: true;
  contactValidity: 'representative-only; not-certified-for-whole-interval-box';
}
export interface SpanIssue { code: string; message: string }
export interface SpanMeasurementResult {
  status: 'missing' | 'invalid' | 'ready' | 'resolution-required';
  input: SpanMeasurementInput;
  raw: SpanNumbers | null;
  uncertainty: SpanUncertainty | null;
  exact: SpanCandidate | null;
  zeroThinningFit: SpanCandidate | null;
  issues: SpanIssue[];
}
export interface SpanApplication {
  schema: 'zatseplenie.span-measurement.v1';
  selected: 'exact-inverse' | 'bounded-zero-thinning-fit';
  input: SpanMeasurementInput;
  raw: SpanNumbers;
  uncertainty: SpanUncertainty;
  candidate: SpanCandidate;
  rootInstrumentSource: 'explicit-assumption; not-inferred-from-span-or-photo';
  pressureAngleSource: 'explicitly-confirmed; not-inferred-from-span';
}

const keys = ['spanMm', 'nextSpanMm', 'tipDiameterMm'] as const;
const interval = (v: number, e: number): SpanInterval => ({ min: v - e, max: v + e });

/** KHK span relation; this is a forward measurement, not a meshing/backlash certificate. */
export function predictedSpanMm(p: SpanParameters, teeth: number): number {
  const a = p.pressureAngleDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return p.module * c * (Math.PI * (teeth - .5) + p.teeth * (Math.tan(a) - a))
    + 2 * p.profileShift * p.module * s - p.backlash * c;
}

function inverse(readings: SpanReadings, z: number, k: number, a: number): SpanNumbers {
  const basePitchMm = readings.nextSpanMm - readings.spanMm, c = Math.cos(a);
  const moduleMm = basePitchMm / (Math.PI * c);
  const profileShift = (readings.tipDiameterMm / moduleMm - z - 2) / 2;
  const B = Math.PI * (k - .5) - z * a - 2 * Math.tan(a);
  return { basePitchMm, moduleMm, profileShift,
    toothThinningMm: Math.tan(a) * readings.tipDiameterMm + B * moduleMm - readings.spanMm / c };
}

/** Coefficients of j = c0 Wk + c1 W(k+1) + cd da, retaining shared-reading correlations. */
function thinningCoefficients(z: number, k: number, a: number): SpanReadings {
  const c = Math.cos(a), B = Math.PI * (k - .5) - z * a - 2 * Math.tan(a);
  const nextSpanMm = B / (Math.PI * c);
  return { spanMm: -nextSpanMm - 1 / c, nextSpanMm, tipDiameterMm: Math.tan(a) };
}
function roundoffLimit(input: SpanMeasurementInput, coefficients: SpanReadings): number {
  // A deliberately conservative floating-point guard, NOT a measurement-error allowance.
  return 64 * Number.EPSILON * keys.reduce((s, key) => s + Math.abs(coefficients[key] * input[key]), 0);
}

function uncertainty(input: SpanMeasurementInput, raw: SpanNumbers, a: number, coefficients: SpanReadings): SpanUncertainty | null {
  const e = input.errorBounds, ep = e.spanMm + e.nextSpanMm;
  // Outward arithmetic guards supplement the declared measurement box; they never narrow it.
  const fp = 64 * Number.EPSILON;
  const pitchPadding = fp * (Math.abs(input.spanMm) + Math.abs(input.nextSpanMm) + ep);
  const basePitchMm = interval(raw.basePitchMm, ep + pitchPadding);
  if (basePitchMm.min <= 0 || input.tipDiameterMm - e.tipDiameterMm <= 0) return null;
  const moduleMm = { min: basePitchMm.min / (Math.PI * Math.cos(a)), max: basePitchMm.max / (Math.PI * Math.cos(a)) };
  const profileShift = {
    min: ((input.tipDiameterMm - e.tipDiameterMm) / moduleMm.max - input.teeth - 2) / 2,
    max: ((input.tipDiameterMm + e.tipDiameterMm) / moduleMm.min - input.teeth - 2) / 2,
  };
  const shiftPadding = fp * (Math.abs(input.tipDiameterMm / moduleMm.min) + input.teeth + 2);
  profileShift.min -= shiftPadding; profileShift.max += shiftPadding;
  const ej = keys.reduce((sum, key) => sum + Math.abs(coefficients[key]) * e[key], 0);
  return { interpretation: 'deterministic-independent-reading-bounds; conditional-on-fixed-angle-and-assumptions',
    basePitchMm, moduleMm, profileShift, toothThinningMm: interval(raw.toothThinningMm, ej + roundoffLimit(input, coefficients) + fp * ej),
    differenceConditionNumber: (Math.abs(input.spanMm) + Math.abs(input.nextSpanMm)) / raw.basePitchMm,
    relativeBasePitchErrorBound: ep / raw.basePitchMm,
    angleToleranceIncluded: false, numericalPaddingIncluded: true, contactValidity: 'representative-only; not-certified-for-whole-interval-box' };
}

function checkCandidate(input: SpanMeasurementInput, readings: SpanReadings, values: SpanNumbers,
  thinning: number, numericalZero: boolean, numericalTolerance: number): SpanCandidate {
  const parameters: SpanParameters = { kind: 'spur', teeth: input.teeth, module: values.moduleMm,
    pressureAngleDeg: input.pressureAngleDeg!, helixAngleDeg: 0, profileShift: values.profileShift,
    backlash: thinning, toolTipRadiusCoefficient: input.toolTipRadiusCoefficient };
  // Width and bore do not enter this planar check. The user's body is validated at the explicit build.
  const profile = buildGearProfile({ ...defaultGearParams, ...parameters, width: 1, bore: 0 });
  if (!profile.rootDiagnostics) throw new Error('Не получен переход к эвольвенте принятого инструмента.');
  const baseRadiusMm = profile.dimensions.baseDiameter / 2, tipRadiusMm = profile.dimensions.tipDiameter / 2;
  const generatedJoinRadiusMm = profile.rootDiagnostics.joinRadius;
  const representativeReadings = { spanMm: predictedSpanMm(parameters, input.spanTeeth),
    nextSpanMm: predictedSpanMm(parameters, input.spanTeeth + 1), tipDiameterMm: profile.dimensions.tipDiameter };
  const contacts = [input.spanTeeth, input.spanTeeth + 1].map((teeth, index): SpanContact => {
    const spanMm = index === 0 ? representativeReadings.spanMm : representativeReadings.nextSpanMm;
    const radiusMm = Math.hypot(baseRadiusMm, spanMm / 2), involuteRoll = spanMm / (2 * baseRadiusMm);
    return { teeth, spanMm, radiusMm, involuteRoll,
      rootJoinMarginMm: radiusMm - generatedJoinRadiusMm, tipMarginMm: tipRadiusMm - radiusMm };
  });
  const marginTolerance = 128 * Number.EPSILON * tipRadiusMm;
  for (const contact of contacts) {
    if (contact.rootJoinMarginMm <= marginTolerance || contact.tipMarginMm <= marginTolerance)
      throw new Error(`Общая нормаль по ${contact.teeth} зубьям не имеет внутреннего контакта на обеих эвольвентных боковинах: ${contact.rootJoinMarginMm <= marginTolerance ? 'контакт у перехода к корню или ниже него' : 'контакт у вершины или выше неё'}. Измените число охватываемых зубьев и повторите оба измерения.`);
  }
  // Only numerical differences are allowed between the candidate and its own representative readings.
  const consistency = keys.every(key => Math.abs(representativeReadings[key] - readings[key])
    <= 256 * Number.EPSILON * Math.max(1, Math.abs(readings[key])) + numericalTolerance);
  if (!consistency) throw new Error('Измерения не согласованы с выбранными параметрами.');
  return { parameters, representativeReadings,
    residuals: { spanMm: representativeReadings.spanMm - input.spanMm,
      nextSpanMm: representativeReadings.nextSpanMm - input.nextSpanMm,
      tipDiameterMm: representativeReadings.tipDiameterMm - input.tipDiameterMm },
    geometry: { baseRadiusMm, tipRadiusMm, generatedJoinRadiusMm, contacts, warnings: profile.warnings },
    arithmetic: { rawThinningMm: values.toothThinningMm, zeroRoundoffToleranceMm: numericalTolerance,
      canonicalizedNumericalZero: numericalZero } };
}

/** Bounded least-squares projection onto j=0. Zero error bounds keep that reading fixed. */
function boundedZeroFit(input: SpanMeasurementInput, raw: SpanNumbers, a: number, coefficients: SpanReadings,
  numericalTolerance: number): SpanCandidate | null {
  const e = input.errorBounds;
  const capacity = keys.reduce((sum, key) => sum + Math.abs(coefficients[key]) * e[key], 0);
  if (-raw.toothThinningMm > capacity + numericalTolerance || capacity === 0) return null;
  const target = Math.min(-raw.toothThinningMm, capacity);
  const scale = Math.max(...keys.map(key => Math.abs(coefficients[key] * e[key])));
  const correction = (key: keyof SpanReadings, lambda: number) => {
    // Work in normalized residuals: neither epsilon² underflow nor 1/epsilon overflow.
    const normalized = lambda * (coefficients[key] * e[key] / scale);
    return e[key] * Math.max(-1, Math.min(1, normalized));
  };
  const projected = (lambda: number) => keys.reduce((sum, key) => sum + coefficients[key] * correction(key, lambda), 0);
  let hi = 1;
  while (projected(hi) < target && hi < Number.MAX_VALUE / 2) hi *= 2;
  let lo = 0;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (projected(mid) < target) lo = mid; else hi = mid; }
  const adjusted: SpanReadings = { spanMm: input.spanMm + correction('spanMm', hi),
    nextSpanMm: input.nextSpanMm + correction('nextSpanMm', hi),
    tipDiameterMm: input.tipDiameterMm + correction('tipDiameterMm', hi) };
  const fitted = inverse(adjusted, input.teeth, input.spanTeeth, a);
  const candidate = checkCandidate(input, adjusted, fitted, 0, false, numericalTolerance);
  if (keys.some(key => Math.abs(candidate.residuals[key]) > e[key] + numericalTolerance)) return null;
  return candidate;
}

export function analyzeSpanMeasurement(input: SpanMeasurementInput): SpanMeasurementResult {
  const result: SpanMeasurementResult = { status: 'missing', input: structuredClone(input), raw: null,
    uncertainty: null, exact: null, zeroThinningFit: null, issues: [] };
  const issue = (code: string, message: string) => result.issues.push({ code, message });
  if (input.kind !== 'spur') { result.status = 'invalid'; issue('UNSUPPORTED_KIND', 'Помощник общей нормали рассчитан только для наружного прямозубого эвольвентного колеса.'); return result; }
  if (input.pressureAngleDeg === null || !input.pressureAngleConfirmed) {
    issue('ANGLE_REQUIRED', 'Подтвердите известный угол профиля. Два пролёта определяют основной шаг mπcosα, но не разделяют неизвестные m и α.'); return result;
  }
  if (!Object.values(input.confirmations).every(Boolean)) {
    issue('CONFIRMATIONS_REQUIRED', 'Подтвердите число зубьев, эвольвентный профиль, стандартную вершину и способ измерения общей нормали.'); return result;
  }
  if (input.tipDiameterMethod === 'unknown') { issue('DIAMETER_METHOD_REQUIRED', 'Укажите, как определён действительный диаметр окружности вершин.'); return result; }
  if (input.tipDiameterMethod === 'uncorrected_caliper_span' || (input.tipDiameterMethod === 'opposed_tips' && input.teeth % 2 !== 0)) {
    result.status = 'invalid'; issue('DIAMETER_NOT_CIRCLE', 'Неисправленный размер штангенциркулем, особенно при нечётном z, не устанавливает диаметр окружности вершин. Нужен восстановленный диаметр.'); return result;
  }
  const numbers = [...keys.map(key => input[key]), ...keys.map(key => input.errorBounds[key]), input.teeth,
    input.spanTeeth, input.pressureAngleDeg, input.toolTipRadiusCoefficient];
  if (!numbers.every(Number.isFinite)) { issue('READINGS_REQUIRED', 'Введите оба пролёта, диаметр, число охватываемых зубьев и пределы ошибок. Для точно заданного значения предел равен 0.'); return result; }
  result.status = 'invalid';
  if (!Number.isInteger(input.teeth) || input.teeth < 6 || input.teeth > 250
    || !Number.isInteger(input.spanTeeth) || input.spanTeeth < 1 || input.spanTeeth + 1 > input.teeth) {
    issue('TOOTH_COUNTS', 'Нужны целые z от 6 до 250 и k ≥ 1; k+1 не больше общего числа зубьев.'); return result;
  }
  if (keys.some(key => input[key] <= 0 || input.errorBounds[key] < 0) || input.nextSpanMm <= input.spanMm) {
    issue('READING_RANGE', 'Размеры должны быть положительными, пределы ошибок — неотрицательными. Общая нормаль по k+1 зубьям должна быть больше, чем по k.'); return result;
  }
  if (input.pressureAngleDeg < 10 || input.pressureAngleDeg > 35 || input.toolTipRadiusCoefficient < .05 || input.toolTipRadiusCoefficient > .5) {
    issue('PROFILE_DOMAIN', 'Область ядра: α от 10° до 35°, принятый радиус вершины рейки ρ/m от 0,05 до 0,5.'); return result;
  }
  const a = input.pressureAngleDeg * Math.PI / 180, coefficients = thinningCoefficients(input.teeth, input.spanTeeth, a);
  const raw = inverse(input, input.teeth, input.spanTeeth, a), tolerance = roundoffLimit(input, coefficients);
  result.raw = raw; result.uncertainty = uncertainty(input, raw, a, coefficients);
  if (!result.uncertainty) {
    issue('UNBOUNDED_INPUT', 'Указанные ошибки допускают нулевой основной шаг или диаметр. Параметры не имеют конечного положительного диапазона: уточните измерения.'); return result;
  }
  if (raw.toothThinningMm < -tolerance) {
    result.status = 'resolution-required';
    issue('NEGATIVE_THINNING', 'Из исходных отсчётов получается отрицательное утонение. Этот результат не применяется: перепроверьте измерения и допущения либо явно выберите согласование с j = 0 в пределах ошибок.');
    try { result.zeroThinningFit = boundedZeroFit(input, raw, a, coefficients, tolerance); }
    catch (e) { issue('FIT_PROFILE_DOMAIN', e instanceof Error ? e.message : 'Согласованный профиль вне области ядра.'); }
    if (!result.zeroThinningFit) issue('NO_ADMISSIBLE_ZERO_FIT', 'Допустимый профиль с j = 0 в заданных пределах ошибок не найден. Увеличивать погрешность только ради результата нельзя: повторите измерения или уточните форму вершин и угол.');
    return result;
  }
  try {
    const numericalZero = Math.abs(raw.toothThinningMm) <= tolerance;
    result.exact = checkCandidate(input, input, raw, numericalZero ? 0 : raw.toothThinningMm, numericalZero, tolerance);
    result.status = 'ready';
  } catch (e) { issue('PROFILE_OR_CONTACT_DOMAIN', e instanceof Error ? e.message : 'Профиль или контакты вне области модели.'); }
  return result;
}

/** Explicit user selection is kept separately from raw measurements and from any fitted values. */
export function selectSpanApplication(result: SpanMeasurementResult, selected: SpanApplication['selected']): SpanApplication {
  const candidate = selected === 'exact-inverse' ? result.exact : result.zeroThinningFit;
  if (!candidate || !result.raw || !result.uncertainty) throw new Error('Для этого выбора нет проверенного результата измерений.');
  return structuredClone({ schema: 'zatseplenie.span-measurement.v1', selected, input: result.input,
    raw: result.raw, uncertainty: result.uncertainty, candidate,
    rootInstrumentSource: 'explicit-assumption; not-inferred-from-span-or-photo',
    pressureAngleSource: 'explicitly-confirmed; not-inferred-from-span' });
}

export function spanApplicationMatches(application: SpanApplication, params: Partial<Omit<SpanParameters, 'kind' | 'helixAngleDeg'>> & { kind?: string; helixAngleDeg?: number }): boolean {
  return (Object.keys(application.candidate.parameters) as (keyof SpanParameters)[])
    .every(key => Object.is(application.candidate.parameters[key], params[key]));
}
