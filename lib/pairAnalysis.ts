import { buildGearProfile, involute, type GearKind, type GearParams, type GearProfile } from './gearMath.ts';
import type { ModelParams } from './model.ts';

export type PairStatus = 'pass' | 'warning' | 'fail' | 'unsupported';
export type PairFamily = 'external_cylindrical' | 'internal_cylindrical' | 'rack_pinion' | 'unsupported';
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
}
export interface PairInput { first: ModelParams; second: ModelParams; centerDistanceMm?: number }

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
  };
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
 * No strength, process tolerance, internal fillet or assembly certification is implied.
 */
export function analyzeGearPair({ first, second, centerDistanceMm }: PairInput): PairReport {
  const dimensions = emptyDimensions(), checks: PairCheck[] = [];
  const report: PairReport = {
    status: 'pass', family: 'unsupported', dimensions, checks,
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
    return unsupportedPair('Расчёт предназначен для эвольвентных цилиндрических колёс и реек. Для конического, червячного и циклоидального зацепления требуется отдельная модель пары.');
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
      add(`geometry-${index + 1}`, `Профиль детали ${index + 1}`, 'pass',
        profile.rootDiagnostics
          ? `Профиль построен; стык эвольвенты с огибающей инструмента при r = ${fmt(profile.rootDiagnostics.joinRadius)} мм.`
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
      const qf = rollLength(ip.rootDiameter / 2, ip.baseDiameter / 2);
      marginCheck('pinion-root', 'Контакт у корня наружного колеса', qi - tangentSpan - qj, 'Вершина внутреннего зуба должна контактировать с эвольвентой наружного зуба выше его переходной кривой.');
      marginCheck('ring-root', 'Контакт у впадины внутреннего колеса', qf - tangentSpan - qe, 'Проверена только граница текущей эвольвенты по окружности впадин, без галтели долбяка.');
      pathStart = Math.max(qi - tangentSpan, qj);
      pathEnd = Math.min(qe, qf - tangentSpan);
      dimensions.minimumRadialClearanceMm = Math.min(ip.rootDiameter / 2 - a - ep.tipDiameter / 2, ip.tipDiameter / 2 - a - ep.rootDiameter / 2);
      add('internal-assembly', 'Интерференция и сборка внутренней пары', 'warning', 'Галтель долбяка, трохоидальная и обрезная интерференция, а также траектория сборки не проверены. Положительные запасы по эвольвенте не подтверждают отсутствие этих препятствий.');
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
