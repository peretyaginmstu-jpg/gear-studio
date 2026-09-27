import type { PhotoCandidateType } from './photo-analysis.ts';

/** Inverse dimensions from confirmed measurements, never from silhouette pixels. */
export type InferredGearKind = 'spur' | 'helical' | 'herringbone' | 'internal' | 'internal-helical' | 'rack' | 'helical-rack';
export type MeasurementSource = 'measurement' | 'drawing' | 'user_confirmation';
export interface ConfirmedMeasurement<T> { value: T; source: MeasurementSource; note?: string }
export type TipDiameterMethod = 'tip_circle' | 'opposed_tips' | 'uncorrected_caliper_span';
export interface PhotoInferenceInput {
  /** Suggests hypotheses only. A front silhouette does not identify tooth direction. */
  silhouette?: PhotoCandidateType;
  kind?: ConfirmedMeasurement<InferredGearKind>;
  profileType?: ConfirmedMeasurement<'involute' | 'cycloidal' | 'other'>;
  toothCount?: ConfirmedMeasurement<number>;
  /** Internal gears: diameter of inward tooth tips, NOT the outer ring body. */
  tipDiameterMm?: ConfirmedMeasurement<number>;
  tipDiameterMethod?: ConfirmedMeasurement<TipDiameterMethod>;
  /** Rack pitch along the travel direction, NOT normal pitch or tooth thickness. */
  transversePitchMm?: ConfirmedMeasurement<number>;
  /** Signed helix angle at the reference cylinder / rack reference plane, degrees. */
  helixAngleDeg?: ConfirmedMeasurement<number>;
  /** Normal reference pressure angle, never silently inferred as 20 degrees. */
  pressureAngleDeg?: ConfirmedMeasurement<number>;
  /** Normal profile shift coefficient xn; absent does not mean zero. */
  profileShift?: ConfirmedMeasurement<number>;
  /** True means ha*=1 AND unshortened tips: ha=mn(1 +/- xn). Not all shifted pairs satisfy this. */
  standardAddendum?: ConfirmedMeasurement<boolean>;
}
export type InferenceField = Exclude<keyof PhotoInferenceInput, 'silhouette'>;
export interface InferenceQuestion { id: InferenceField; label: string; reason: string; options?: string[] }
export interface InferenceIssue { code: string; field: InferenceField | 'module'; message: string }
export type ParameterProvenance =
  | { status: 'missing'; reason: string }
  | { status: 'confirmed'; value: string | number | boolean; source: MeasurementSource; note?: string }
  | { status: 'derived'; value: number; formula: string; inputs: string[] };
export type ProvenanceKey = InferenceField | 'module' | 'transverseModule' | 'pitchDiameterMm';
export interface InferenceHypothesis {
  kind: InferredGearKind;
  basis: 'confirmed-kind' | 'silhouette' | 'unclassified';
  /** Conditional equation; no default numeric module or pressure angle. */
  formula: string;
  requires: string[];
}
export interface InverseCalculation {
  normalModuleMm: number;
  transverseModuleMm: number;
  pitchDiameterMm: number | null;
  formula: string;
  inputs: Record<string, number>;
}
export interface InferredProfileParameters {
  kind: InferredGearKind;
  module: number;
  pressureAngleDeg: number;
  helixAngleDeg: number;
  profileShift: number;
  /** Rack count controls segment length and cannot be inferred from its pitch. */
  teeth?: number;
}
interface InferenceBase {
  missingQuestions: InferenceQuestion[];
  issues: InferenceIssue[];
  provenance: Record<ProvenanceKey, ParameterProvenance>;
  hypotheses: InferenceHypothesis[];
  suggestions: string[];
  /** Dimensions only. Width, bore, fits, roots, pair compatibility and load remain separate. */
  calculation: InverseCalculation | null;
}
export type PhotoInferenceResult = InferenceBase & (
  | { status: 'ready'; parameters: InferredProfileParameters; calculation: InverseCalculation }
  | { status: 'missing' | 'rejected'; parameters: null }
);

export const photoInferenceSources = [{
  title: 'KHK — Calculation of Gear Dimensions',
  url: 'https://khkgears.net/gear-knowledge/gear-technical-reference/calculation-gear-dimensions/',
  detail: 'Tables 4.5, 4.6, 4.13: unshortened addendum, internal tip diameter and normal/transverse pitch. Tables 4.3 and 4.9 show why shifted pairs can require tip shortening.',
}];

const kinds: InferredGearKind[] = ['spur', 'helical', 'herringbone', 'internal', 'internal-helical', 'rack', 'helical-rack'];
const fields: InferenceField[] = ['kind', 'profileType', 'toothCount', 'tipDiameterMm', 'tipDiameterMethod', 'transversePitchMm', 'helixAngleDeg', 'pressureAngleDeg', 'profileShift', 'standardAddendum'];
const helical = (kind: InferredGearKind) => ['helical', 'herringbone', 'internal-helical', 'helical-rack'].includes(kind);
const rack = (kind: InferredGearKind) => kind === 'rack' || kind === 'helical-rack';
const internal = (kind: InferredGearKind) => kind === 'internal' || kind === 'internal-helical';
const formula = (kind: InferredGearKind) => rack(kind)
  ? helical(kind) ? 'mn = pt × cos(β) / π' : 'm = pt / π'
  : internal(kind)
    ? helical(kind) ? 'mn = da / [z / cos(β) − 2(1 − xn)]' : 'm = da / [z − 2(1 − x)]'
    : helical(kind) ? 'mn = da / [z / cos(β) + 2(1 + xn)]' : 'm = da / [z + 2(1 + x)]';

function questions(kind?: InferredGearKind, z?: number): Record<InferenceField, InferenceQuestion> {
  return {
    kind: { id: 'kind', label: 'Подтвердите тип и направление зубьев по детали или виду сбоку.',
      reason: 'Торцевой силуэт с наружными зубьями не отличает прямые, косые и шевронные зубья; регулярный контур может оказаться шлицем или звёздочкой.' },
    profileType: { id: 'profileType', label: 'Подтверждён ли эвольвентный профиль по чертежу, маркировке или измерению?',
      reason: 'Одинаковый диаметр и число зубьев не доказывают эвольвентный профиль.', options: ['Эвольвентный', 'Циклоидальный', 'Другой', 'Неизвестно'] },
    toothCount: { id: 'toothCount', label: 'Подтвердите полное число зубьев, включая повреждённые.',
      reason: 'Число выступов на фотографии остаётся гипотезой до проверки.' },
    tipDiameterMm: { id: 'tipDiameterMm', label: kind && internal(kind)
      ? 'Измерьте диаметр окружности вершин внутренних зубьев в мм.' : 'Измерьте диаметр окружности вершин зубьев в мм.',
      reason: kind && internal(kind) ? 'Наружный диаметр тела кольца не участвует в этой формуле.' : 'Пиксели фотографии не устанавливают масштаб в миллиметрах.' },
    tipDiameterMethod: { id: 'tipDiameterMethod', label: z !== undefined && z % 2 !== 0
      ? 'Как получен диаметр окружности вершин при нечётном числе зубьев?' : 'Подтвердите, что измерен диаметр окружности вершин.',
      reason: 'Необработанный размер между губками штангенциркуля не всегда равен диаметру. При нечётном z нет диаметрально противоположных одинаковых зубьев; нужен восстановленный диаметр окружности по корректной методике.' },
    transversePitchMm: { id: 'transversePitchMm', label: 'Измерьте торцевой шаг рейки вдоль направления перемещения в мм.',
      reason: 'Измерьте расстояние между одинаковыми точками нескольких зубьев и разделите на число промежутков. Это не ширина зуба и не шаг по нормали к наклонным зубьям.' },
    helixAngleDeg: { id: 'helixAngleDeg', label: 'Укажите угол и направление наклона на делительной поверхности.',
      reason: 'Угол на окружности вершин и проекция на фото не равны автоматически углу β на делительном цилиндре. Для шеврона подтвердите одинаковый по модулю угол обеих половин.' },
    pressureAngleDeg: { id: 'pressureAngleDeg', label: 'Укажите подтверждённый нормальный угол профиля αn в градусах.',
      reason: 'Диаметр, шаг и z не определяют угол профиля. Значение 20° без документа или измерений будет предположением.' },
    profileShift: { id: 'profileShift', label: 'Укажите подтверждённый коэффициент нормального смещения xn.',
      reason: 'Неизвестное смещение нельзя принимать за ноль. Для рейки оно задаёт положение исходной линии, хотя на расчёт модуля из шага не влияет.' },
    standardAddendum: { id: 'standardAddendum', label: 'Подтверждены ha* = 1 и отсутствие укорочения или модификации вершин?',
      reason: 'Используется ha = mn(1 + xn) снаружи и ha = mn(1 − xn) внутри. У смещённой пары высота может зависеть от межосевого расстояния и второго колеса, поэтому одного xn недостаточно.' },
  };
}

function getHypotheses(input: PhotoInferenceInput): InferenceHypothesis[] {
  const confirmed = input.kind?.value;
  const candidates: InferredGearKind[] = confirmed && kinds.includes(confirmed) ? [confirmed]
    : input.silhouette === 'external_circular' ? ['spur', 'helical', 'herringbone']
    : input.silhouette === 'internal_ring' ? ['internal', 'internal-helical']
    : input.silhouette === 'linear_rack' ? ['rack', 'helical-rack'] : kinds;
  return candidates.map(kind => ({
    kind, basis: confirmed && kinds.includes(confirmed) ? 'confirmed-kind' : input.silhouette && input.silhouette !== 'undetermined' ? 'silhouette' : 'unclassified',
    formula: formula(kind),
    requires: [
      'Тип и эвольвентный профиль подтверждены независимо от силуэта.',
      ...(rack(kind) ? ['Шаг измерен вдоль перемещения рейки.'] : ['Подтверждены z, диаметр окружности вершин, xn, ha*=1 и отсутствие укорочения вершин.']),
      ...(helical(kind) ? ['Известны угол β на делительной поверхности и направление зубьев.'] : []),
    ],
  }));
}

/**
 * Ready means a confirmed basic profile-parameter patch, not a reconstructed complete part.
 * Missing αn can coexist with a calculated module: the equation does not identify αn.
 * No standard-series snapping, guessed pressure angle, default x, or pixel-to-mm conversion.
 */
export function inferGearFromMeasurements(input: PhotoInferenceInput): PhotoInferenceResult {
  const kind = input.kind?.value, z = input.toothCount?.value;
  const catalog = questions(kind, z), missingQuestions: InferenceQuestion[] = [], issues: InferenceIssue[] = [];
  const provenance = Object.fromEntries(fields.map(field => {
    const fact = input[field];
    return [field, fact ? { status: 'confirmed', ...fact } : { status: 'missing', reason: catalog[field].reason }];
  })) as Record<ProvenanceKey, ParameterProvenance>;
  for (const field of ['module', 'transverseModule', 'pitchDiameterMm'] as const)
    provenance[field] = { status: 'missing', reason: 'Недостаточно подтверждённых исходных данных.' };
  const ask = (field: InferenceField) => { if (!missingQuestions.some(q => q.id === field)) missingQuestions.push(catalog[field]); };
  const reject = (code: string, field: InferenceIssue['field'], message: string) => { issues.push({ code, field, message }); };
  const need = (field: InferenceField) => { if (!input[field]) ask(field); };

  // Runtime validation also protects JS callers and restored browser data.
  for (const field of fields) {
    const fact = input[field];
    if (fact && !['measurement', 'drawing', 'user_confirmation'].includes(fact.source))
      reject('INVALID_SOURCE', field, 'Источник подтверждения должен быть явно указан.');
  }
  if (input.kind && !kinds.includes(kind!)) reject('UNSUPPORTED_KIND', 'kind', 'Этот обратный расчёт поддерживает цилиндрические эвольвентные колёса и рейки.');
  if (input.profileType && input.profileType.value !== 'involute') reject('UNSUPPORTED_PROFILE', 'profileType', 'Для указанного профиля нужна другая модель; эвольвента не подставляется автоматически.');
  if (input.standardAddendum && input.standardAddendum.value !== true) reject('UNSUPPORTED_ADDENDUM', 'standardAddendum', 'Для нестандартной высоты или укорочения вершин нужны дополнительные данные и другая формула.');
  if (input.tipDiameterMethod && !['tip_circle', 'opposed_tips', 'uncorrected_caliper_span'].includes(input.tipDiameterMethod.value))
    reject('INVALID_MEASUREMENT_METHOD', 'tipDiameterMethod', 'Неизвестный метод определения диаметра.');
  for (const field of ['toothCount', 'tipDiameterMm', 'transversePitchMm', 'helixAngleDeg', 'pressureAngleDeg', 'profileShift'] as const) {
    const value = input[field]?.value;
    if (input[field] && (typeof value !== 'number' || !Number.isFinite(value))) reject('NON_FINITE', field, 'Нужно конечное числовое значение.');
  }
  if (z !== undefined && (!Number.isInteger(z) || z < (kind && rack(kind) ? 1 : 6) || z > 250))
    reject('TEETH_RANGE', 'toothCount', 'Поддерживается 6–250 зубьев для колеса и 1–250 для участка рейки.');
  for (const field of ['tipDiameterMm', 'transversePitchMm'] as const)
    if (input[field] && !(input[field].value > 0)) reject('DIMENSION_RANGE', field, 'Измеренный размер должен быть больше нуля.');
  const alpha = input.pressureAngleDeg?.value, shift = input.profileShift?.value, enteredBeta = input.helixAngleDeg?.value;
  if (alpha !== undefined && !(alpha >= 10 && alpha <= 35)) reject('ANGLE_RANGE', 'pressureAngleDeg', 'Ядро поддерживает нормальный угол профиля от 10° до 35°.');
  if (shift !== undefined && !(shift >= -0.8 && shift <= 1)) reject('SHIFT_RANGE', 'profileShift', 'Ядро поддерживает коэффициент смещения от −0,8 до +1.');
  if (enteredBeta !== undefined && !(Math.abs(enteredBeta) <= 45)) reject('HELIX_RANGE', 'helixAngleDeg', 'Ядро поддерживает угол наклона от −45° до +45°.');
  if (kind && kinds.includes(kind) && enteredBeta !== undefined && ((helical(kind) && enteredBeta === 0) || (!helical(kind) && enteredBeta !== 0)))
    reject('HELIX_KIND_CONFLICT', 'helixAngleDeg', 'Угол наклона противоречит подтверждённому прямому или наклонному направлению зубьев.');

  need('kind'); need('profileType'); need('pressureAngleDeg'); need('profileShift'); need('standardAddendum');
  let measurementValid = false, beta: number | undefined;
  if (kind && kinds.includes(kind)) {
    if (helical(kind)) { need('helixAngleDeg'); beta = enteredBeta; }
    else {
      beta = 0;
      if (!input.helixAngleDeg) provenance.helixAngleDeg = { status: 'derived', value: 0, formula: 'β = 0 (подтверждённые прямые зубья)', inputs: ['kind'] };
    }
    if (rack(kind)) {
      need('transversePitchMm');
      measurementValid = input.transversePitchMm !== undefined;
    } else {
      need('toothCount'); need('tipDiameterMm'); need('tipDiameterMethod');
      const method = input.tipDiameterMethod?.value;
      measurementValid = method === 'tip_circle' || (method === 'opposed_tips' && z !== undefined && z % 2 === 0);
      if (method && !measurementValid) ask('tipDiameterMethod');
    }
  }
  const suggestions = [
    'Сначала подтвердите профиль и направление зубьев по маркировке, чертежу или дополнительным видам.',
    'Ширину, отверстие, посадки, галтель инструмента и зазор задайте отдельно: эти размеры не восстановлены данным расчётом.',
  ];
  if (!input.pressureAngleDeg) suggestions.push('Угол профиля определите по документации или отдельному измерению; совпадение наружного диаметра не выбирает между 14,5°, 20°, 25° и другими углами.');
  if (kind && rack(kind)) suggestions.push('Для длины участка рейки подтвердите число шагов или длину; модуль из шага не определяет длину рейки.');
  if (kind && internal(kind)) suggestions.push('Проверьте, что введён диаметр внутренних вершин, а не наружный диаметр обода или диаметр впадин.');
  if (kind === 'herringbone') suggestions.push('Измерьте ширины половин шеврона, фазу и центральную канавку: одинаковый модуль не устанавливает эти размеры.');
  if (!kind) suggestions.push('Список типов — альтернативные гипотезы, не результат классификации. Силуэт также не исключает неэвольвентный профиль, шлиц или звёздочку.');
  const hypotheses = getHypotheses(input);
  let calculation: InverseCalculation | null = null;
  if (!issues.length && kind && kinds.includes(kind) && input.profileType?.value === 'involute' && beta !== undefined && measurementValid) {
    const cb = Math.cos(beta * Math.PI / 180);
    const canCalculate = rack(kind) ? !!input.transversePitchMm : z !== undefined && !!input.tipDiameterMm && shift !== undefined && input.standardAddendum?.value === true;
    if (canCalculate) {
      const denominator = rack(kind) ? Math.PI / cb : z! / cb + (internal(kind) ? -2 * (1 - shift!) : 2 * (1 + shift!));
      const measured = rack(kind) ? input.transversePitchMm!.value : input.tipDiameterMm!.value;
      const mn = measured / denominator;
      if (!Number.isFinite(mn) || mn < .1 || mn > 30) reject('MODULE_RANGE', 'module', 'Полученный нормальный модуль вне поддерживаемого диапазона 0,1–30 мм. Проверьте размер, единицы и гипотезу.');
      else {
        const inputs: Record<string, number> = rack(kind) ? { pt: measured, beta } : { da: measured, z: z!, beta, xn: shift! };
        calculation = { normalModuleMm: mn, transverseModuleMm: mn / cb, pitchDiameterMm: rack(kind) ? null : z! * mn / cb, formula: formula(kind), inputs };
        provenance.module = { status: 'derived', value: mn, formula: calculation.formula, inputs: rack(kind) ? ['transversePitchMm', 'helixAngleDeg'] : ['tipDiameterMm', 'toothCount', 'helixAngleDeg', 'profileShift', 'standardAddendum'] };
        provenance.transverseModule = { status: 'derived', value: mn / cb, formula: 'mt = mn / cos(β)', inputs: ['module', 'helixAngleDeg'] };
        if (calculation.pitchDiameterMm !== null) provenance.pitchDiameterMm = { status: 'derived', value: calculation.pitchDiameterMm, formula: 'd = z × mt', inputs: ['toothCount', 'transverseModule'] };
        else provenance.pitchDiameterMm = { status: 'missing', reason: 'У линейной рейки нет конечной делительной окружности.' };
      }
    }
  }
  const base = { missingQuestions, issues, provenance, hypotheses, suggestions, calculation };
  if (issues.length) return { ...base, status: 'rejected', parameters: null, calculation: null };
  if (missingQuestions.length || !calculation || !kind || beta === undefined || alpha === undefined || shift === undefined)
    return { ...base, status: 'missing', parameters: null };
  return { ...base, status: 'ready', calculation, parameters: { kind, module: calculation.normalModuleMm, pressureAngleDeg: alpha, helixAngleDeg: beta, profileShift: shift, ...(z !== undefined ? { teeth: z } : {}) } };
}
