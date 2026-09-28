import { buildCycloidalMesh, type CycloidalDimensions, type CycloidalParams } from './cycloidalGeometry.ts';
import { validateMesh, type MeshValidation, type Point2 } from './gearMath.ts';
import type { PairCheck, PairInput, PairReport } from './pairAnalysis.ts';

export interface CycloidalPairModel {
  part: number;
  parameters: CycloidalParams;
  dimensions: CycloidalDimensions;
  tipRadiusMm: number;
  rootRadiusMm: number;
  meshValidation: MeshValidation;
  quality: { flankSamples: number };
}
export interface CycloidalNominalBranch {
  addendumPart: 1 | 2;
  dedendumPart: 1 | 2;
  /** Gamma is the generating-point angle on the FIXED path circle, not kernel t. */
  addendumLimitRad: number;
  dedendumLimitRad: number;
  rollAngleUpperBoundRad: number;
  pitchTravelUpperBoundMm: number;
  limitingBoundary: 'addendum-tip' | 'dedendum-root' | 'both';
  pathCircleCenter: Point2;
  pathEnd: Point2;
}
export interface CycloidalPairGeometry {
  scope: 'equal-generating-circle-nominal-precheck';
  referenceModuleMm: number;
  firstPitchRadiusMm: number;
  secondPitchRadiusMm: number;
  rollingRadiusMm: number;
  nominalCenterDistanceMm: number;
  enteredCenterDistanceMm: number | null;
  circularPitchMm: number;
  ratio: number;
  faceOverlapMm: number;
  rootCircleClearanceMm: { firstTipToSecondRoot: number; secondTipToFirstRoot: number };
  branches: [CycloidalNominalBranch, CycloidalNominalBranch];
  totalPitchTravelUpperBoundMm: number;
  /** Necessary coverage bound on nominal analytic flanks; NOT a measured/verified epsilon. */
  nominalFlankCoverageUpperBound: number;
  continuityNecessaryCondition: 'fails' | 'at-boundary' | 'not-disproved';
  idealAssembly: {
    assumption: 'nominal-centre-distance; parallel-axes; aligned-midplanes';
    coordinateSystem: 'first-centre=(0,0); second-centre=(a,0); axes=+Z; millimetres';
    firstCenter: Point2;
    secondCenter: Point2;
    pitchPoint: Point2;
    axialOverlapStartMm: number;
    axialOverlapEndMm: number;
    actualMountingVerified: false;
    toothPhaseRad: null;
  };
  fullPairConjugacyVerified: false;
  contactRatio: null;
  backlashMm: null;
  interferenceFree: null;
}

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const fmt = (value: number) => Number.isFinite(value) ? value.toLocaleString('ru-RU', { maximumFractionDigits: 6 }) : 'не задано';

/**
 * Durley, Kinematics of Machines (1907), §67: the SAME describing circle must
 * generate each contacting epi/hypo pair; two circles may differ in general.
 * This kernel uses one circle per wheel, hence our admitted subset has r1=r2.
 * Finite first branches bound nominal pitch travel by r*min(Gamma_a,Gamma_f).
 * Normal agreement of these curves does not prove full-profile noninterference.
 */
export function analyzeCycloidalPair({ first, second, centerDistanceMm }: PairInput): PairReport {
  const report: PairReport = {
    status: 'warning', family: 'external_cycloidal', checks: [], profileGeometry: [],
    bevelModels: [], bevelGeometry: null, cycloidalModels: [], cycloidalGeometry: null,
    dimensions: {
      referenceCenterDistanceMm: null, operatingCenterDistanceMm: null, operatingPressureAngleDeg: null,
      transverseContactRatio: null, overlapContactRatio: null, totalContactRatio: null,
      transverseBacklashMm: null, ratio: null, minimumRadialClearanceMm: null, effectiveFaceWidthMm: null,
    },
    assumptions: [
      'Предпроверка двух внешних цилиндрических прямозубых циклоидальных колёс. Это не эксцентриковый циклоидальный редуктор и не цевочное зацепление.',
      'Общая производящая окружность нужна для пары «эпициклоида первого — гипоциклоида второго» и отдельно для обратной пары. Эти два радиуса в общем случае могут различаться. Одиночное ядро использует один радиус для обеих частей каждого колеса, поэтому здесь проверяется только частный случай r₁=r₂.',
      'Приняты номинальное межосевое a=R₁+R₂, параллельные оси и совмещённые средние плоскости. Введённое a проверяется на совпадение с номинальным, но реальное положение осей и фаза зубьев не подтверждены.',
      'Высоты ha=m и hf=1,25m — выбранная система одиночного ядра, не универсальный стандарт. Используются конечные первые ветви эпи- и гипоциклоид до фактических окружностей вершин и впадин.',
      'Верхняя граница покрытия шага учитывает только длину номинальных аналитических боковин. Значение не меньше 1 не доказывает контакт или отсутствие столкновений полного зуба. Контакт дуг вершин/впадин, интерференция, реальный зазор, прочность и печатные условия не проверены.',
      'Постоянный угол давления, эвольвентный основной шаг и пересчёт рабочего угла при изменении a неприменимы. Утонение каждой детали сохранено отдельно; оно не выдаётся за проверенный зазор пары.',
    ],
    sources: [
      { title: 'R. J. Durley — Kinematics of Machines (1907), §67, pp. 197–199; Cornell', url: 'https://ecommons.cornell.edu/server/api/core/bitstreams/f7252185-b02b-4ebb-aa6f-2027d7839795/content' },
      { title: 'Wolfram MathWorld — Epicycloid', url: 'https://mathworld.wolfram.com/Epicycloid.html' },
      { title: 'Wolfram MathWorld — Hypocycloid', url: 'https://mathworld.wolfram.com/Hypocycloid.html' },
    ],
  };
  const add = (id: string, label: string, status: PairCheck['status'], detail: string) => report.checks.push({ id, label, status, detail });
  const finish = () => {
    report.status = report.checks.some(check => check.status === 'fail') ? 'fail' : 'warning';
    return report;
  };
  if (first.kind !== 'cycloidal' || second.kind !== 'cycloidal') {
    report.family = 'unsupported'; report.status = 'unsupported';
    add('unsupported', 'Эта пара пока не рассчитывается', 'warning', 'Циклоидальная предпроверка требует двух внешних цилиндрических циклоидальных колёс. Смешанная пара не подменяется эвольвентным или циклоидальным зацеплением.');
    return report;
  }
  for (const [index, input] of [first, second].entries()) {
    try {
      const params: CycloidalParams = {
        kind: 'cycloidal', teeth: input.teeth, module: input.module,
        pressureAngleDeg: input.pressureAngleDeg, helixAngleDeg: input.helixAngleDeg,
        width: input.width, bore: input.bore, profileShift: input.profileShift, backlash: input.backlash,
        cycloidRollingRadius: input.cycloidRollingRadius, profileTolerance: input.profileTolerance,
      };
      const quality = { flankSamples: 6 }, mesh = buildCycloidalMesh(params, quality), validation = validateMesh(mesh);
      report.cycloidalModels.push({ part: index + 1, parameters: mesh.params, dimensions: mesh.cycloidalDimensions,
        tipRadiusMm: mesh.dimensions.tipDiameter / 2, rootRadiusMm: mesh.dimensions.rootDiameter / 2,
        meshValidation: validation, quality });
      add(`cycloidal-model-${index + 1}`, `Циклоидальная модель ${index + 1}`, validation.valid ? 'pass' : 'fail', validation.valid
        ? `Аналитический профиль и замкнутая сетка построены: ${validation.triangles} треугольников. Контакт с другой моделью этим не подтверждён.`
        : 'Сетка отдельной модели не прошла проверку замкнутости, ориентации или ненулевого объёма.');
    } catch (error) {
      add(`cycloidal-model-${index + 1}`, `Циклоидальная модель ${index + 1}`, 'fail', error instanceof Error ? error.message : 'Не удалось построить модель.');
    }
  }
  if (report.cycloidalModels.length !== 2) return finish();
  const [one, two] = report.cycloidalModels, d1 = one.dimensions, d2 = two.dimensions;
  const R1 = d1.pitchRadius, R2 = d2.pitchRadius, r = d1.rollingRadius, m = d1.referenceModule, a = R1 + R2;
  add('cycloidal-module', 'Делительный модуль и шаг', same(m, d2.referenceModule) ? 'pass' : 'fail', `m₁=${fmt(m)} мм; m₂=${fmt(d2.referenceModule)} мм. Для этих периодических профилей круговой шаг πm должен совпадать.`);
  add('cycloidal-generators', 'Перекрёстные производящие окружности', same(r, d2.rollingRadius) ? 'pass' : 'fail', `r₁=${fmt(r)} мм; r₂=${fmt(d2.rollingRadius)} мм. В текущем ядре каждый радиус образует и головку, и ножку; для обеих контактирующих эпи-/гипоциклоид радиусы должны совпадать. Другая двухрадиусная система здесь не реализована.`);
  const centerMatches = centerDistanceMm === undefined || Number.isFinite(centerDistanceMm) && same(centerDistanceMm, a);
  add('cycloidal-center', 'Номинальное межосевое расстояние', centerMatches ? 'pass' : 'fail',
    `a₀=R₁+R₂=${fmt(a)} мм.${centerDistanceMm === undefined ? ' Фактическое расстояние не введено.' : ` Введено a=${fmt(centerDistanceMm)} мм.`} Изменённое a не пересчитывается по эвольвентной формуле; для него эта номинальная предпроверка неприменима.`);
  if (report.checks.some(check => check.status === 'fail')) return finish();

  const branch = (face: CycloidalPairModel, flank: CycloidalPairModel, addendumPart: 1 | 2): CycloidalNominalBranch => {
    const da = face.dimensions, df = flank.dimensions;
    const ga = da.pitchRadius * da.addendumRollAngleRad / r, gf = df.pitchRadius * df.dedendumRollAngleRad / r;
    const gamma = Math.min(ga, gf), sign = addendumPart === 1 ? 1 : -1;
    return {
      addendumPart, dedendumPart: addendumPart === 1 ? 2 : 1,
      addendumLimitRad: ga, dedendumLimitRad: gf, rollAngleUpperBoundRad: gamma,
      pitchTravelUpperBoundMm: r * gamma,
      limitingBoundary: same(ga, gf) ? 'both' : ga < gf ? 'addendum-tip' : 'dedendum-root',
      pathCircleCenter: { x: R1 + sign * r, y: 0 },
      pathEnd: { x: R1 + sign * 2 * r * Math.sin(gamma / 2) ** 2, y: sign * r * Math.sin(gamma) },
    };
  };
  const branches: [CycloidalNominalBranch, CycloidalNominalBranch] = [branch(one, two, 1), branch(two, one, 2)];
  const total = branches[0].pitchTravelUpperBoundMm + branches[1].pitchTravelUpperBoundMm;
  const pitch = Math.PI * m, bound = total / pitch;
  const continuity = bound < 1 - 1e-9 ? 'fails' : bound <= 1 + 1e-9 ? 'at-boundary' : 'not-disproved';
  const clear1 = a - one.tipRadiusMm - two.rootRadiusMm, clear2 = a - two.tipRadiusMm - one.rootRadiusMm;
  const width = Math.min(one.parameters.width, two.parameters.width);
  report.cycloidalGeometry = {
    scope: 'equal-generating-circle-nominal-precheck', referenceModuleMm: m,
    firstPitchRadiusMm: R1, secondPitchRadiusMm: R2, rollingRadiusMm: r,
    nominalCenterDistanceMm: a, enteredCenterDistanceMm: centerDistanceMm ?? null,
    circularPitchMm: pitch, ratio: two.parameters.teeth / one.parameters.teeth, faceOverlapMm: width,
    rootCircleClearanceMm: { firstTipToSecondRoot: clear1, secondTipToFirstRoot: clear2 },
    branches, totalPitchTravelUpperBoundMm: total, nominalFlankCoverageUpperBound: bound,
    continuityNecessaryCondition: continuity,
    idealAssembly: {
      assumption: 'nominal-centre-distance; parallel-axes; aligned-midplanes',
      coordinateSystem: 'first-centre=(0,0); second-centre=(a,0); axes=+Z; millimetres',
      firstCenter: { x: 0, y: 0 }, secondCenter: { x: a, y: 0 }, pitchPoint: { x: R1, y: 0 },
      axialOverlapStartMm: -width / 2, axialOverlapEndMm: width / 2,
      actualMountingVerified: false, toothPhaseRad: null,
    },
    fullPairConjugacyVerified: false, contactRatio: null, backlashMm: null, interferenceFree: null,
  };
  add('cycloidal-branch-limits', 'Конечные участки боковин', 'pass', `Головка 1 / ножка 2: γ≤${fmt(branches[0].rollAngleUpperBoundRad)} рад; головка 2 / ножка 1: γ≤${fmt(branches[1].rollAngleUpperBoundRad)} рад. Каждый предел взят по более короткой из двух фактических ветвей.`);
  add('cycloidal-coverage-bound', 'Верхняя граница покрытия шага', continuity === 'fails' ? 'fail' : 'warning',
    `Smax/(πm)=${fmt(bound)}; Smax=${fmt(total)} мм, шаг=${fmt(pitch)} мм. ` + (continuity === 'fails'
      ? 'Даже верхней границы длины аналитических боковин недостаточно для непрерывного движения в номинальной кинематике. Контакт с дугами вершин/впадин не может считаться подтверждённым продолжением зацепления.'
      : continuity === 'at-boundary' ? 'Граница практически равна одному шагу; запаса нет. Это не рассчитанное контактное отношение.'
        : 'Недостаток длины этим условием не установлен. Это не рассчитанное контактное отношение и не доказательство непрерывного контакта.'));
  add('cycloidal-root-circle-clearance', 'Граница корня и вершины', Math.min(clear1, clear2) < -1e-9 * Math.max(1, m) ? 'fail' : 'pass', `По окружностям: ${fmt(clear1)} и ${fmt(clear2)} мм. Это только радиальное необходимое условие; столкновения боковин и всей детали не проверены.`);
  add('cycloidal-face-overlap', 'Общая ширина при осевом совмещении', 'pass', `${fmt(width)} мм при совпадении средних плоскостей. Реальное осевое положение не введено.`);
  add('cycloidal-contact-unverified', 'Полное зацепление не подтверждено', 'warning', 'Согласование производящих окружностей и необходимые границы не подтверждают контакт полного зуба, фазу, монтаж, боковой зазор или отсутствие интерференции. Эти величины оставлены null; расчёт прочности и печатные условия не выполнялись.');
  return finish();
}
