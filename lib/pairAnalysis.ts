import { buildGearProfile, involute, validateMesh, type GearKind, type GearParams, type GearProfile, type MeshValidation } from './gearMath.ts';
import { defaultModel, type ModelKind, type ModelParams } from './model.ts';
import type { InternalCutterGeometry } from './generatedInternalRoot.ts';
import { buildBevelMesh, type BevelDimensions, type BevelParams, type Point3 } from './bevelGeometry.ts';
import { analyzeCycloidalPair, type CycloidalPairGeometry, type CycloidalPairModel } from './cycloidalPair.ts';

export type PairStatus = 'pass' | 'warning' | 'fail' | 'unsupported';
export type PairFamily = 'external_cylindrical' | 'internal_cylindrical' | 'rack_pinion' | 'bevel_pitch_cones' | 'external_cycloidal' | 'unsupported';
export interface PairCheck { id: string; label: string; status: 'pass' | 'warning' | 'fail'; detail: string }
export interface PairDimensions {
  /** Reference circles: sum for external, difference for internal, pinion radius for rack. */
  referenceCenterDistanceMm: number | null;
  /** For a rack: pinion centre to the model's y=0 rack datum, not to its back surface. */
  operatingCenterDistanceMm: number | null;
  operatingPressureAngleDeg: number | null;
  /** Contact interval restricted to the model's actual involute/root joins. */
  transverseContactRatio: number | null;
  overlapContactRatio: number | null;
  totalContactRatio: number | null;
  transverseBacklashMm: number | null;
  /** Magnitude |omega_first / omega_second| = z_second / z_first. Null for rack. */
  ratio: number | null;
  minimumRadialClearanceMm: number | null;
  /** Full common face width; a herringbone uses half this width for overlap. */
  effectiveFaceWidthMm: number | null;
}
export interface PairReport {
  status: PairStatus;
  family: PairFamily;
  checks: PairCheck[];
  dimensions: PairDimensions;
  assumptions: string[];
  sources: { title: string; url: string }[];
  profileGeometry: { part: number; parameters: GearParams; rootRadiusMm: number | null; activeInvoluteJoinRadiusMm: number | null; internalCutterGeometry: InternalCutterGeometry | null }[];
  /** Only populated after BOTH bevel models and all cone compatibility checks succeed. */
  bevelGeometry: BevelPairGeometry | null;
  /** Individual model evidence, not proof of mutual contact; never contains mesh arrays. */
  bevelModels: { part: number; parameters: BevelParams; dimensions: BevelDimensions; meshValidation: MeshValidation; quality: { flankSamples: number } }[];
  /** Nominal diagnostic bounds may remain present with a continuity failure. */
  cycloidalGeometry: CycloidalPairGeometry | null;
  cycloidalModels: CycloidalPairModel[];
}
export interface PairInput { first: ModelParams; second: ModelParams; centerDistanceMm?: number }

export interface BevelPairGeometry {
  scope: 'pitch-cone-and-face-interval-precheck';
  firstPitchConeAngleDeg: number;
  secondPitchConeAngleDeg: number;
  shaftAngleDeg: number;
  outerConeDistanceMm: number;
  firstFaceIntervalMm: { start: number; end: number };
  secondFaceIntervalMm: { start: number; end: number };
  overlapStartMm: number;
  overlapEndMm: number;
  overlapLengthMm: number;
  /** Magnitude of the nominal pitch-cone ratio |omega_first / omega_second|. */
  ratio: number;
  idealAssembly: {
    assumption: 'common-apex-and-aligned-outer-pitch-cone-ends';
    coordinateSystem: 'right-handed; first-axis=+Z; second-axis-in-XZ; millimetres';
    apex: Point3;
    firstAxis: Point3;
    secondAxis: Point3;
    commonGenerator: Point3;
    overlapStart: Point3;
    overlapEnd: Point3;
    actualMountingVerified: false;
    toothPhaseRad: null;
  };
  /** Requires a separate conjugate-surface/contact analysis and actual assembly. */
  conjugacyVerified: false;
  contactRatio: null;
  backlashMm: null;
  interferenceFree: null;
}

const DEG = Math.PI / 180;
const supported: readonly string[] = ['spur', 'helical', 'herringbone', 'internal', 'internal-helical', 'rack', 'helical-rack'];
const rack = (p: ModelParams) => p.kind === 'rack' || p.kind === 'helical-rack';
const internal = (p: ModelParams) => p.kind === 'internal' || p.kind === 'internal-helical';
const helix = (p: ModelParams) => ['helical', 'herringbone', 'internal-helical', 'helical-rack'].includes(p.kind) ? p.helixAngleDeg : 0;
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const fmt = (v: number) => Number.isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: 4 }) : 'вне численного диапазона';
const rollLength = (r: number, rb: number) => Math.sqrt(Math.max(0, (r - rb) * (r + rb)));
const emptyDimensions = (): PairDimensions => ({
  referenceCenterDistanceMm: null, operatingCenterDistanceMm: null, operatingPressureAngleDeg: null,
  transverseContactRatio: null, overlapContactRatio: null, totalContactRatio: null,
  transverseBacklashMm: null, ratio: null, minimumRadialClearanceMm: null, effectiveFaceWidthMm: null,
});

/** An explicit adapter prevents worm/cycloid/bevel settings entering the involute kernel. */
function gearParams(p: ModelParams): GearParams {
  return {
    kind: p.kind as GearKind, teeth: p.teeth, module: p.module,
    pressureAngleDeg: p.pressureAngleDeg, helixAngleDeg: p.helixAngleDeg,
    width: p.width, bore: p.bore, profileShift: p.profileShift, backlash: p.backlash,
    rimThickness: p.rimThickness, rackBaseHeight: p.rackBaseHeight,
    toolTipRadiusCoefficient: p.toolTipRadiusCoefficient, profileTolerance: p.profileTolerance,
    ...(p.kind === 'internal' ? { internalCutterTeeth: p.internalCutterTeeth, internalCutterProfileShift: p.internalCutterProfileShift,
      internalCutterAddendumCoefficient: p.internalCutterAddendumCoefficient, internalCutterTipRadiusCoefficient: p.internalCutterTipRadiusCoefficient, internalCutterThinning: p.internalCutterThinning } : {}),
  };
}

/** Visible initial values only: the first model and its cone are never modified. */
export function initialPairMate(first: ModelParams): ModelParams {
  if (first.kind === 'cycloidal') return {
    ...defaultModel('cycloidal'), teeth: Math.min(250, first.teeth * 2),
    module: first.module, pressureAngleDeg: first.pressureAngleDeg,
    cycloidRollingRadius: first.cycloidRollingRadius ?? Math.min(2 * first.module, first.module * first.teeth / 4),
    width: first.width, backlash: first.backlash, bore: 0,
  };
  if (first.kind === 'bevel') return {
    ...defaultModel('bevel'), teeth: first.bevelMateTeeth ?? first.teeth,
    bevelMateTeeth: first.teeth, bevelShaftAngleDeg: first.bevelShaftAngleDeg ?? 90,
    module: first.module, pressureAngleDeg: first.pressureAngleDeg,
    width: first.width, backlash: first.backlash, bore: 0,
  };
  const helical = ['helical', 'herringbone', 'internal-helical', 'helical-rack'].includes(first.kind);
  const kind: ModelKind = first.kind === 'herringbone' ? 'herringbone' : helical ? 'helical' : 'spur';
  return {
    ...defaultModel(kind),
    teeth: internal(first) ? Math.max(18, Math.min(36, first.teeth - 12)) : rack(first) ? 24 : Math.min(250, first.teeth * 2),
    module: first.module, pressureAngleDeg: first.pressureAngleDeg,
    helixAngleDeg: helical ? first.helixAngleDeg * (internal(first) || rack(first) ? 1 : -1) : 0,
    width: first.width, profileShift: 0, backlash: first.backlash, bore: 0,
  };
}

/** Own the input snapshot and compute its report together; no stale preview report. */
export function createPairAnalysisDocument(input: PairInput, createdAt = new Date().toISOString()) {
  const snapshot = structuredClone(input);
  const hasVisibleMate = supported.includes(snapshot.first.kind) || snapshot.first.kind === 'bevel' || snapshot.first.kind === 'cycloidal';
  const coneInput = snapshot.first.kind === 'bevel' || snapshot.second.kind === 'bevel';
  const cycloidalInput = snapshot.first.kind === 'cycloidal' || snapshot.second.kind === 'cycloidal';
  return {
    schema: 'zatseplenie.pair-analysis.v3', appVersion: '0.16.0', createdAt, units: 'mm',
    input: {
      first: snapshot.first, second: hasVisibleMate ? snapshot.second : null,
      centerDistanceMm: hasVisibleMate && !coneInput ? snapshot.centerDistanceMm ?? null : null,
      centerMode: !hasVisibleMate || coneInput ? 'not-applicable' : cycloidalInput
        ? snapshot.centerDistanceMm === undefined ? 'nominal-reference-circles' : 'user-specified-for-nominal-precheck'
        : snapshot.centerDistanceMm === undefined ? 'calculated-from-profile-shifts' : 'user-specified',
      // Preserve an API misuse for audit, without treating it as a bevel mounting dimension.
      ...(coneInput && snapshot.centerDistanceMm !== undefined ? { rejectedCylindricalCenterDistanceMm: snapshot.centerDistanceMm } : {}),
    },
    report: analyzeGearPair(snapshot),
  };
}

function analyzeBevelPair({ first, second, centerDistanceMm }: PairInput): PairReport {
  const report: PairReport = {
    status: 'warning', family: 'bevel_pitch_cones', dimensions: emptyDimensions(), checks: [],
    profileGeometry: [], bevelModels: [], bevelGeometry: null, cycloidalModels: [], cycloidalGeometry: null,
    assumptions: [
      'Предпроверка делительных конусов и размеров двух прямозубых моделей со сферической эвольвентой. Совпадение конусов не доказывает сопряжённость их зубчатых поверхностей.',
      'Для координат перекрытия условно совмещены апексы и внешние торцы делительных конусов. Q — расстояние от общего апекса вдоль общей образующей; интервал каждой детали [R − b, R].',
      'Фактические монтажные расстояния, положение осей и фаза зубьев не заданы. Возможность идеального совмещения не подтверждает положение реальной сборки.',
      'Используется собственная система зуба ha=mₑ, hf=1,25mₑ с пропорциональным уменьшением к апексу. Это не каталоговая геометрия Gleason, Klingelnberg или octoid.',
      'Контактное отношение, пространственный боковой зазор, интерференция, прочность и ресурс не рассчитаны. Утонение отдельных зубьев не приравнивается к зазору пары.',
    ],
    sources: [
      { title: 'KHK — §4.4, геометрия делительных конусов', url: 'https://khkgears.net/gear-knowledge/gear-technical-reference/calculation-gear-dimensions/' },
      { title: 'Ligata & Zhang — Geometry Definition and Contact Analysis of Spherical Involute Straight Bevel Gears (2011)', url: 'https://ijme.us/cd_11/PDF/Paper%20163%20ENG%20107.pdf' },
      { title: 'Kolivand — Surface and Contact Lines Calculation (2014), DOI 10.4271/2014-01-1765', url: 'https://saemobilus.sae.org/papers/involute-straight-bevel-gear-surface-contact-lines-calculation-utilizing-ease-off-topography-approach-2014-01-1765' },
    ],
  };
  const add = (id: string, label: string, status: PairCheck['status'], detail: string) => report.checks.push({ id, label, status, detail });
  const finish = () => {
    report.status = report.checks.some(check => check.status === 'fail') ? 'fail' : 'warning';
    return report;
  };
  if (first.kind !== 'bevel' || second.kind !== 'bevel') {
    report.family = 'unsupported'; report.status = 'unsupported';
    add('unsupported', 'Эта пара пока не рассчитывается', 'warning', 'Предпроверка конусов требует двух прямозубых конических моделей со сферической эвольвентой. Смешанная пара с цилиндрическим, червячным или другим профилем не подменяется такой моделью.');
    return report;
  }
  if (centerDistanceMm !== undefined)
    add('bevel-center-not-applicable', 'Монтажные данные', 'fail', 'Цилиндрическое межосевое расстояние a неприменимо к этой предпроверке. Она использует угол осей и условный общий апекс; фактическая посадка отдельно не задана.');

  // Building and validating both meshes also exercises the kernel's sampling/resource gates.
  // Keep only compact evidence; this mesh density is not an export package or accuracy class.
  const quality = { flankSamples: 6 };
  for (const [index, input] of [first, second].entries()) {
    try {
      const params: BevelParams = {
        kind: 'bevel', teeth: input.teeth, module: input.module, pressureAngleDeg: input.pressureAngleDeg,
        width: input.width, bore: input.bore, backlash: input.backlash,
        profileShift: input.profileShift, helixAngleDeg: input.helixAngleDeg,
        profileTolerance: input.profileTolerance, bevelMateTeeth: input.bevelMateTeeth,
        bevelShaftAngleDeg: input.bevelShaftAngleDeg,
      };
      const mesh = buildBevelMesh(params, quality), validation = validateMesh(mesh);
      report.bevelModels.push({ part: index + 1, parameters: mesh.params, dimensions: mesh.bevelDimensions, meshValidation: validation, quality: { ...quality } });
      add(`bevel-model-${index + 1}`, `Коническая модель ${index + 1}`, validation.valid ? 'pass' : 'fail', validation.valid
        ? `Аналитический профиль и замкнутая сетка построены: ${validation.triangles} треугольников. Это проверка отдельной модели, не контакта пары.`
        : 'Сетка отдельной модели не прошла проверку замкнутости, ориентации или ненулевого объёма.');
      for (const warning of mesh.warnings.filter(item => item.code === 'BEVEL_WIDE_FACE'))
        add(`bevel-model-${index + 1}-${warning.code}`, `Ширина детали ${index + 1}`, 'warning', warning.message);
    } catch (error) {
      add(`bevel-model-${index + 1}`, `Коническая модель ${index + 1}`, 'fail', error instanceof Error ? error.message : 'Не удалось построить коническую модель.');
    }
  }
  if (report.bevelModels.length !== 2) return finish();
  const [model1, model2] = report.bevelModels, p1 = model1.parameters, p2 = model2.parameters;
  const d1 = model1.dimensions, d2 = model2.dimensions;
  const mutualTeeth = d1.mateTeeth === p2.teeth && d2.mateTeeth === p1.teeth;
  add('bevel-mutual-teeth', 'Числа зубьев ответных колёс', mutualTeeth ? 'pass' : 'fail',
    `Первая модель построена для z₂=${d1.mateTeeth}, введено z₂=${p2.teeth}; вторая рассчитана для z₁=${d2.mateTeeth}, у первой z₁=${p1.teeth}. При изменении партнёра перестройте первую модель с новым z₂: её готовый конус здесь не меняется.`);
  add('bevel-outer-module', 'Внешний модуль', same(p1.module, p2.module) ? 'pass' : 'fail', `mₑ₁=${fmt(p1.module)} мм; mₑ₂=${fmt(p2.module)} мм.`);
  add('bevel-pressure-angle', 'Угол профиля', same(p1.pressureAngleDeg, p2.pressureAngleDeg) ? 'pass' : 'fail', `α₁=${fmt(p1.pressureAngleDeg)}°; α₂=${fmt(p2.pressureAngleDeg)}°. Совпадение этих параметров не заменяет проверку сопряжённых поверхностей.`);
  add('bevel-shaft-angle', 'Угол между осями', same(d1.shaftAngleDeg, d2.shaftAngleDeg) ? 'pass' : 'fail', `Σ₁=${fmt(d1.shaftAngleDeg)}°; Σ₂=${fmt(d2.shaftAngleDeg)}°.`);
  const angleSum = d1.pitchConeAngleDeg + d2.pitchConeAngleDeg;
  const conesMatch = same(angleSum, d1.shaftAngleDeg) && same(angleSum, d2.shaftAngleDeg)
    && same(d1.matePitchConeAngleDeg, d2.pitchConeAngleDeg) && same(d2.matePitchConeAngleDeg, d1.pitchConeAngleDeg);
  add('bevel-angle-sum', 'Согласование углов конусов', conesMatch ? 'pass' : 'fail', `δ₁=${fmt(d1.pitchConeAngleDeg)}°; δ₂=${fmt(d2.pitchConeAngleDeg)}°; сумма ${fmt(angleSum)}° должна совпадать с обоими Σ.`);
  add('bevel-outer-distance', 'Внешнее конусное расстояние', same(d1.outerConeDistance, d2.outerConeDistance) ? 'pass' : 'fail', `R₁=${fmt(d1.outerConeDistance)} мм; R₂=${fmt(d2.outerConeDistance)} мм. Для общего внешнего делительного сечения расстояния должны совпадать.`);
  if (report.checks.some(check => check.status === 'fail')) return finish();

  const start = Math.max(d1.innerConeDistance, d2.innerConeDistance), end = Math.min(d1.outerConeDistance, d2.outerConeDistance);
  if (!(end > start)) {
    add('bevel-face-overlap', 'Перекрытие вдоль образующей', 'fail', 'Интервалы обеих моделей вдоль общей образующей не имеют положительной общей длины.');
    return finish();
  }
  const delta = d1.pitchConeAngleDeg * DEG, sigma = d1.shaftAngleDeg * DEG;
  const generator = { x: Math.sin(delta), y: 0, z: Math.cos(delta) };
  const pointAt = (q: number): Point3 => ({ x: q * generator.x, y: 0, z: q * generator.z });
  report.bevelGeometry = {
    scope: 'pitch-cone-and-face-interval-precheck', firstPitchConeAngleDeg: d1.pitchConeAngleDeg,
    secondPitchConeAngleDeg: d2.pitchConeAngleDeg, shaftAngleDeg: d1.shaftAngleDeg,
    outerConeDistanceMm: d1.outerConeDistance,
    firstFaceIntervalMm: { start: d1.innerConeDistance, end: d1.outerConeDistance },
    secondFaceIntervalMm: { start: d2.innerConeDistance, end: d2.outerConeDistance },
    overlapStartMm: start, overlapEndMm: end, overlapLengthMm: end - start, ratio: p2.teeth / p1.teeth,
    idealAssembly: {
      assumption: 'common-apex-and-aligned-outer-pitch-cone-ends',
      coordinateSystem: 'right-handed; first-axis=+Z; second-axis-in-XZ; millimetres',
      apex: { x: 0, y: 0, z: 0 }, firstAxis: { x: 0, y: 0, z: 1 },
      secondAxis: { x: Math.sin(sigma), y: 0, z: Math.cos(sigma) }, commonGenerator: generator,
      overlapStart: pointAt(start), overlapEnd: pointAt(end), actualMountingVerified: false, toothPhaseRad: null,
    },
    conjugacyVerified: false, contactRatio: null, backlashMm: null, interferenceFree: null,
  };
  add('bevel-face-overlap', 'Перекрытие вдоль общей образующей', 'pass', `При условном совмещении апексов: Q от ${fmt(start)} до ${fmt(end)} мм; длина ${fmt(end - start)} мм. Это общая часть ширины моделей, не контактное отношение зубьев.`);
  add('bevel-apex-assumption', 'Апекс и реальный монтаж', 'warning', 'Размеры допускают идеальное совмещение делительных конусов в общем апексе. Монтажные расстояния, положение осей и фаза реальной сборки не проверены.');
  add('bevel-contact-unverified', 'Контакт поверхностей не проверен', 'warning', 'Согласованы только перечисленные условия конусов. Сопряжённость двух сферических эвольвент, линии контакта, зазор и интерференция требуют отдельного пространственного расчёта; их значения оставлены null.');
  return finish();
}

/** Monotone inverse on [0, pi/2); all angles in radians. */
function inverseInvolute(value: number): number {
  let low = 0, high = Math.PI / 2 - 1e-8;
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (involute(mid) < value) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

/**
 * Ideal, unloaded parallel-axis geometry in the existing model's normal system.
 * KHK Tables 4.3/4.6/4.9: working angle and profile shift; SDP/SI §11: contact.
 * Backlash is derived from the two actual tooth arcs at working radii, not a fit table.
 * Generated internal spur joins bound active contact; no strength or assembly certification.
 */
export function analyzeGearPair({ first, second, centerDistanceMm }: PairInput): PairReport {
  if (first.kind === 'bevel' || second.kind === 'bevel') return analyzeBevelPair({ first, second, centerDistanceMm });
  if (first.kind === 'cycloidal' || second.kind === 'cycloidal') return analyzeCycloidalPair({ first, second, centerDistanceMm });
  const dimensions = emptyDimensions(), checks: PairCheck[] = [];
  const report: PairReport = {
    status: 'pass', family: 'unsupported', dimensions, checks, profileGeometry: [], bevelGeometry: null, bevelModels: [], cycloidalGeometry: null, cycloidalModels: [],
    assumptions: [
      'Идеальная геометрия без нагрузки; оси параллельны, общая ширина полностью совмещена и фаза зубьев настроена.',
      'Уменьшение нормальной толщины задано отдельно для каждой детали. Рассчитанный поперечный зазор не является допуском изготовления.',
      'Высоты зубьев и радиусы взяты из этих моделей; вершины при смещении профиля автоматически не укорачиваются.',
      'Расчёт не определяет прочность, ресурс, точность печати, тепловое расширение или податливость опор.',
    ],
    sources: [
      { title: 'KHK — Calculation of Gear Dimensions, Tables 4.3, 4.6, 4.9, 4.13', url: 'https://khkgears.net/new/gear_knowledge/gear_technical_reference/calculation_gear_dimensions.html' },
      { title: 'SDP/SI — Elements of Metric Gear Technology, sections 3, 6, 11', url: 'https://www.sdp-si.com/D815/D815-Technical-Section.pdf' },
    ],
  };
  const add = (id: string, label: string, status: PairCheck['status'], detail: string) => checks.push({ id, label, status, detail });
  const done = () => {
    let overflow = false;
    for (const key of Object.keys(dimensions) as (keyof PairDimensions)[]) {
      if (dimensions[key] !== null && !Number.isFinite(dimensions[key])) { dimensions[key] = null; overflow = true; }
    }
    if (overflow) add('numeric-range', 'Численный диапазон', 'fail', 'Расстояние вышло за численный диапазон расчёта. Неопределённые результаты не сохранены как числа.');
    report.status = checks.some(c => c.status === 'fail') ? 'fail' : checks.some(c => c.status === 'warning') ? 'warning' : 'pass';
    return report;
  };
  const unsupportedPair = (detail: string) => {
    add('unsupported', 'Эта пара пока не рассчитывается', 'warning', detail);
    report.assumptions = ['Геометрическая модель выбранной пары не реализована; никакие условия её совместимости не подтверждены.', 'Все размеры пары оставлены null; расчёт эвольвентной пары к этим деталям не применялся.'];
    report.status = 'unsupported';
    return report;
  };
  if (!supported.includes(first.kind) || !supported.includes(second.kind))
    return unsupportedPair('Расчёт предназначен для эвольвентных цилиндрических колёс и реек; для конических и внешних циклоидальных колёс доступны отдельные предпроверки. Червячная пара пока не рассчитывается.');
  if ((rack(first) && rack(second)) || (internal(first) && internal(second)) ||
      (rack(first) && internal(second)) || (internal(first) && rack(second)))
    return unsupportedPair('Поддерживаются два наружных колеса, наружное с внутренним либо наружное колесо с рейкой.');
  report.family = rack(first) || rack(second) ? 'rack_pinion' : internal(first) || internal(second) ? 'internal_cylindrical' : 'external_cylindrical';
  const family = report.family;
  if (centerDistanceMm !== undefined && (!Number.isFinite(centerDistanceMm) || centerDistanceMm <= 0)) {
    add('center-distance', 'Фактическое расстояние', 'fail', 'Расстояние должно быть конечным положительным числом. Пустое поле означает расчёт по смещению профиля.');
    return done();
  }

  const profiles: GearProfile[] = [];
  for (const [index, p] of [first, second].entries()) {
    try {
      const profile = buildGearProfile(gearParams(p), 6);
      profiles.push(profile);
      const join = profile.internalRootDiagnostics?.joinRadius ?? profile.rootDiagnostics?.joinRadius;
      report.profileGeometry.push({ part: index + 1, parameters: profile.params,
        rootRadiusMm: rack(p) ? null : profile.dimensions.rootDiameter / 2,
        activeInvoluteJoinRadiusMm: rack(p) ? null : join ?? profile.dimensions.rootDiameter / 2,
        internalCutterGeometry: profile.internalCutterGeometry ?? null });
      add(`geometry-${index + 1}`, `Профиль детали ${index + 1}`, 'pass',
        join !== undefined
          ? `Профиль построен; стык эвольвенты с огибающей инструмента при r = ${fmt(join)} мм.${profile.internalCutterGeometry ? ` Долбяк zс=${profile.internalCutterGeometry.tool.teeth} задан или принят, по фото не установлен.` : ''}`
          : rack(p) ? 'Прямолинейные боковины рейки до острых углов впадин.' : 'Эвольвентные боковины до окружности впадин; галтель внутреннего колеса не построена.');
      for (const warning of profile.warnings.filter(w => w.code === 'UNDERCUT'))
        add(`profile-${index + 1}-${warning.code}`, `Ограничение детали ${index + 1}`, 'warning', warning.message);
    } catch (error) {
      add(`geometry-${index + 1}`, `Профиль детали ${index + 1}`, 'fail', error instanceof Error ? error.message : 'Не удалось построить профиль.');
    }
  }
  if (profiles.length !== 2) return done();
  const [g1, g2] = profiles;
  const d1 = g1.dimensions, d2 = g2.dimensions;
  add('normal-module', 'Нормальный модуль', same(first.module, second.module) ? 'pass' : 'fail', `mₙ₁ = ${fmt(first.module)} мм; mₙ₂ = ${fmt(second.module)} мм. Для этой модели пары модули должны совпадать.`);
  add('pressure-angle', 'Нормальный угол профиля', same(first.pressureAngleDeg, second.pressureAngleDeg) ? 'pass' : 'fail', `αₙ₁ = ${fmt(first.pressureAngleDeg)}°; αₙ₂ = ${fmt(second.pressureAngleDeg)}°.`);
  const beta1 = helix(first), beta2 = helix(second);
  add('helix-magnitude', 'Величина наклона зубьев', same(Math.abs(beta1), Math.abs(beta2)) ? 'pass' : 'fail', `|β₁| = ${fmt(Math.abs(beta1))}°; |β₂| = ${fmt(Math.abs(beta2))}°.`);
  const opposite = family === 'external_cylindrical';
  const correctHand = same(beta1, opposite ? -beta2 : beta2);
  add('helix-hand', 'Направление зубьев', correctHand ? 'pass' : 'fail',
    family === 'rack_pinion'
      ? 'Для рейки с зубьями к +Y и колеса над ней, при общей оси +Z, знаки β в этих моделях должны совпадать. Это координатный знак модели, а не обозначение руки рейки в каталоге.'
      : opposite ? 'При общей оси +Z наружные колёса требуют противоположных знаков β; нулевые углы совместимы.'
        : 'При общей оси +Z внутреннее и наружное колёса требуют одинаковых знаков β.');
  const chevron = first.kind === 'herringbone' || second.kind === 'herringbone';
  if (chevron && Math.abs(beta1) > 1e-9) {
    const both = first.kind === 'herringbone' && second.kind === 'herringbone';
    add('herringbone-topology', 'Шевронные половины', both ? 'warning' : 'fail', both
      ? 'Принято совпадение средних плоскостей и фаз обеих половин. Для осевого перекрытия взята половина общей ширины; сборка шеврона отдельно не проверена.'
      : 'При ненулевом β шеврон требует ответного шеврона: одна винтовая линия не сопрягается с обеими половинами.');
  }
  if (checks.some(c => c.status === 'fail')) return done();

  const at = d1.transversePressureAngleDeg * DEG, an = first.pressureAngleDeg * DEG;
  const b = Math.min(first.width, second.width);
  dimensions.effectiveFaceWidthMm = b;
  dimensions.overlapContactRatio = (chevron ? b / 2 : b) * Math.abs(Math.sin(beta1 * DEG)) / (Math.PI * first.module);
  add('face-overlap', 'Общая рабочая ширина', 'pass', `${fmt(b)} мм при совмещении средних плоскостей${chevron ? '; для перекрытия одной шевронной половины используется ' + fmt(b / 2) + ' мм' : ''}.`);

  let pathStart: number, pathEnd: number, a: number;
  const tolerance = 1e-9 * Math.max(1, d1.transverseCircularPitch, d2.transverseCircularPitch);
  const marginCheck = (id: string, label: string, margin: number, detail: string) =>
    add(id, label, margin <= tolerance ? 'warning' : 'pass', `${detail} Запас по линии зацепления: ${fmt(margin)} мм.` +
      (margin < -tolerance ? ' Часть теоретического пути выходит за рабочую эвольвенту и исключена из εα. Контакт с переходной кривой и фактическое пересечение контуров не проверены.'
        : margin <= tolerance ? ' Контакт достигает границы рабочего профиля; запаса нет.' : ''));

  if (family === 'rack_pinion') {
    const pg = rack(first) ? g2 : g1, rg = rack(first) ? g1 : g2;
    const pinion = pg.params, rp = rg.params, pd = pg.dimensions, rd = rg.dimensions;
    const r = pd.pitchDiameter / 2, rb = pd.baseDiameter / 2, ra = pd.tipDiameter / 2;
    dimensions.referenceCenterDistanceMm = r;
    a = centerDistanceMm ?? r + pinion.module * (pinion.profileShift + rp.profileShift);
    dimensions.operatingCenterDistanceMm = a;
    dimensions.operatingPressureAngleDeg = at / DEG;
    if (!(a > 0)) {
      add('center-distance', 'Положение рейки', 'fail', 'Расчётное расстояние до исходной линии рейки не положительно.');
      return done();
    }
    add('center-distance', 'Положение рейки', 'pass', `${fmt(a)} мм от центра колеса до исходной линии y = 0 рейки; ${centerDistanceMm === undefined ? 'рассчитано по сумме x обеих деталей' : 'задано пользователем'}. Рабочий угол не меняется с положением рейки.`);
    report.assumptions.push('Рейка: зубья направлены к +Y, центр колеса над ней, ширина вдоль общей +Z. Расстояние до исходной линии y=0 не включает высоту основания рейки.');
    add('rack-travel', 'Подача рейки', 'pass', `За оборот колеса: ${fmt(Math.PI * pd.pitchDiameter)} мм. Количество зубьев рейки задаёт длину заготовки, а не передаточное отношение.`);
    add('rack-ends', 'Концы рейки', 'warning', 'Расчёт относится к внутреннему участку длинной рейки. Допустимый ход, запас зубьев у торцов и начальная фаза не заданы.');
    const offset = a - r, qa = rollLength(ra, rb), qj = rollLength(pg.rootDiagnostics!.joinRadius, rb);
    // Coordinate along the pinion's line of action, measured from its base tangent.
    const nominalStart = r * Math.sin(at) + (offset - rd.addendum) / Math.sin(at);
    const rackRootEnd = r * Math.sin(at) + (offset + rd.dedendum) / Math.sin(at);
    marginCheck('pinion-root', 'Контакт у корня колеса', nominalStart - qj, 'Вершина рейки должна входить в рабочую эвольвенту выше стыка с огибающей инструмента.');
    marginCheck('rack-root', 'Контакт у корня рейки', rackRootEnd - qa, 'Контакт вершины колеса должен оставаться выше линии впадин рейки.');
    pathStart = Math.max(nominalStart, qj);
    pathEnd = Math.min(qa, rackRootEnd);
    dimensions.minimumRadialClearanceMm = Math.min(a - ra + rd.dedendum, a - rd.addendum - pd.rootDiameter / 2);
    dimensions.transverseBacklashMm = pd.transverseCircularPitch - pd.transverseToothThickness -
      (rd.transverseToothThickness - 2 * offset * Math.tan(at));
  } else {
    const intPair = family === 'internal_cylindrical';
    const externalProfile = internal(first) ? g2 : g1, internalProfile = internal(first) ? g1 : g2;
    const toothSpan = intPair ? internalProfile.params.teeth - externalProfile.params.teeth : first.teeth + second.teeth;
    if (toothSpan <= 0) {
      add('internal-size', 'Размер внутреннего колеса', 'fail', 'Внутреннее колесо должно иметь больше зубьев, чем наружное.');
      return done();
    }
    const r1 = d1.pitchDiameter / 2, r2 = d2.pitchDiameter / 2;
    const rb1 = d1.baseDiameter / 2, rb2 = d2.baseDiameter / 2;
    const a0 = intPair ? internalProfile.dimensions.pitchDiameter / 2 - externalProfile.dimensions.pitchDiameter / 2 : r1 + r2;
    const baseSpan = intPair ? internalProfile.dimensions.baseDiameter / 2 - externalProfile.dimensions.baseDiameter / 2 : rb1 + rb2;
    dimensions.referenceCenterDistanceMm = a0;
    dimensions.ratio = second.teeth / first.teeth;
    if (centerDistanceMm === undefined) {
      const x = intPair ? internalProfile.params.profileShift - externalProfile.params.profileShift : first.profileShift + second.profileShift;
      const target = involute(at) + 2 * x * Math.tan(an) / toothSpan;
      if (target < 0) {
        add('center-distance', 'Расстояние по смещениям профиля', 'fail', 'Сумма или разность x не даёт действительного рабочего угла для неутонённых зубьев. Задайте реальное расстояние или измените профиль.');
        return done();
      }
      a = baseSpan / Math.cos(inverseInvolute(target));
    } else a = centerDistanceMm;
    dimensions.operatingCenterDistanceMm = a;
    add('center-distance', 'Рабочее межосевое расстояние', 'pass', `a = ${fmt(a)} мм; a₀ = ${fmt(a0)} мм. ${centerDistanceMm === undefined ? 'a рассчитано по x для зубьев до уменьшения толщины; введённые уменьшения толщины создают зазор.' : 'В расчёте используется заданное пользователем a.'}`);
    if (a < baseSpan - tolerance) {
      add('base-circles', 'Общая касательная основных окружностей', 'fail', `a меньше ${intPair ? 'разности' : 'суммы'} основных радиусов (${fmt(baseSpan)} мм); действительный рабочий угол отсутствует.`);
      return done();
    }
    const aw = Math.acos(Math.min(1, baseSpan / a)), invDifference = involute(at) - involute(aw);
    dimensions.operatingPressureAngleDeg = aw / DEG;
    add('base-circles', 'Рабочий угол', 'pass', `αwt = ${fmt(aw / DEG)}° из касательной основных окружностей.`);
    const rw1 = a * (first.teeth / toothSpan), rw2 = a * (second.teeth / toothSpan);
    const sw1 = rw1 * (d1.transverseToothThickness / r1 + (internal(first) ? -2 : 2) * invDifference);
    const sw2 = rw2 * (d2.transverseToothThickness / r2 + (internal(second) ? -2 : 2) * invDifference);
    dimensions.transverseBacklashMm = 2 * Math.PI * rw1 / first.teeth - sw1 - sw2;
    const tangentSpan = a * Math.sin(aw);
    if (intPair) {
      const ep = externalProfile.dimensions, ip = internalProfile.dimensions;
      const qe = rollLength(ep.tipDiameter / 2, ep.baseDiameter / 2);
      const qi = rollLength(ip.tipDiameter / 2, ip.baseDiameter / 2);
      const qj = rollLength(externalProfile.rootDiagnostics!.joinRadius, ep.baseDiameter / 2);
      const qf = rollLength(internalProfile.internalRootDiagnostics?.joinRadius ?? ip.rootDiameter / 2, ip.baseDiameter / 2);
      marginCheck('pinion-root', 'Контакт у корня наружного колеса', qi - tangentSpan - qj, 'Вершина внутреннего зуба должна контактировать с эвольвентой наружного зуба выше его переходной кривой.');
      marginCheck('ring-root', 'Контакт у впадины внутреннего колеса', qf - tangentSpan - qe, internalProfile.internalRootDiagnostics
        ? 'Рабочая эвольвента ограничена реальным стыком с огибающей принятого долбяка; переходная кривая не включена в путь контакта.'
        : 'Косозубой внутренний профиль: граница текущей эвольвенты по окружности впадин, без производящей переходной поверхности.');
      pathStart = Math.max(qi - tangentSpan, qj);
      pathEnd = Math.min(qe, qf - tangentSpan);
      dimensions.minimumRadialClearanceMm = Math.min(ip.rootDiameter / 2 - a - ep.tipDiameter / 2, ip.tipDiameter / 2 - a - ep.rootDiameter / 2);
      add('internal-assembly', 'Интерференция и сборка внутренней пары', 'warning', `${internalProfile.internalRootDiagnostics ? 'Производящая переходная кривая построена для принятого долбяка. ' : 'Производящая переходная поверхность косозубого долбяка не построена. '}Контакт ответного колеса с этой областью, внеполюсная интерференция и траектория сборки пары не проверены. Проверка инструмента не является проверкой ответного колеса.`);
    } else {
      const qa1 = rollLength(d1.tipDiameter / 2, rb1), qa2 = rollLength(d2.tipDiameter / 2, rb2);
      const qj1 = rollLength(g1.rootDiagnostics!.joinRadius, rb1), qj2 = rollLength(g2.rootDiagnostics!.joinRadius, rb2);
      marginCheck('root-first', 'Контакт у корня детали 1', tangentSpan - qa2 - qj1, 'Контакт вершины детали 2 должен оставаться на рабочей эвольвенте детали 1.');
      marginCheck('root-second', 'Контакт у корня детали 2', tangentSpan - qa1 - qj2, 'Контакт вершины детали 1 должен оставаться на рабочей эвольвенте детали 2.');
      pathStart = Math.max(tangentSpan - qa2, qj1);
      pathEnd = Math.min(qa1, tangentSpan - qj2);
      dimensions.minimumRadialClearanceMm = Math.min(a - d1.tipDiameter / 2 - d2.rootDiameter / 2, a - d2.tipDiameter / 2 - d1.rootDiameter / 2);
    }
    add('rotation', 'Передаточное отношение', 'pass', `|ω₁ / ω₂| = z₂ / z₁ = ${fmt(dimensions.ratio)}; ${intPair ? 'одинаковое' : 'противоположное'} направление вращения.`);
  }

  const clearance = dimensions.minimumRadialClearanceMm!;
  add('radial-clearance', 'Радиальный зазор вершина — впадина', clearance < -tolerance ? 'fail' : clearance <= tolerance ? 'warning' : 'pass',
    `Минимум для двух направлений контакта: ${fmt(clearance)} мм.${clearance < -tolerance ? ' Окружность вершин пересекает границу впадин ответной детали.' : clearance <= tolerance ? ' Запаса до касания нет.' : ' Проверены радиальные границы текущих моделей.'}`);
  const backlash = dimensions.transverseBacklashMm!;
  // Remove floating-point residue only; zero is a physical zero, never "unknown".
  if (Math.abs(backlash) <= tolerance) dimensions.transverseBacklashMm = 0;
  add('backlash', 'Поперечный боковой зазор', backlash < -tolerance ? 'fail' : backlash <= tolerance ? 'warning' : 'pass',
    `jₜ = ${fmt(dimensions.transverseBacklashMm!)} мм.${backlash < -tolerance ? ' Толщины зубьев не помещаются в рабочий шаг: геометрический натяг.' : backlash <= tolerance ? ' Нулевой расчётный зазор не оставляет запаса на погрешности.' : ' Получен из толщин обеих деталей в рабочем положении.'}`);
  const path = Math.max(0, pathEnd - pathStart);
  const ea = path / d1.basePitch;
  dimensions.transverseContactRatio = ea;
  if (path <= tolerance) {
    add('contact-ratio', 'Непрерывность зацепления', 'fail', 'Общего рабочего участка эвольвент нет. Осевое перекрытие не может создать отсутствующий контакт.');
  } else {
    const total = ea + dimensions.overlapContactRatio!;
    dimensions.totalContactRatio = total;
    const status = total < 1 - 1e-9 ? 'fail' : total <= 1 + 1e-9 || ea < 1 || (dimensions.overlapContactRatio === 0 && total < 1.2) ? 'warning' : 'pass';
    add('contact-ratio', 'Непрерывность зацепления', status,
      `εα = ${fmt(ea)}; εβ = ${fmt(dimensions.overlapContactRatio!)}; εγ = ${fmt(total)}. ` +
      (total < 1 - 1e-9 ? 'Суммарное перекрытие меньше 1: непрерывного идеального контакта нет.'
        : total <= 1 + 1e-9 ? 'Граница непрерывности; запаса перекрытия нет.'
          : ea < 1 ? 'Непрерывность обеспечивается только осевым перекрытием при принятом совмещении ширины.'
            : dimensions.overlapContactRatio === 0 && total < 1.2 ? 'Для прямозубой пары запас мал: SDP/SI рекомендует значение не менее 1,2.'
              : 'Идеальное перекрытие больше 1; использован общий участок рабочих боковин до переходных кривых.'));
  }
  return done();
}
