import { GearGeometryError } from './gearMath.ts';
import type { GearDerived, GearDimensions, GearMesh, GearParams, GearProfile, MeshQuality, Point2 } from './gearMath.ts';

/**
 * Straight bevel teeth with an exact spherical-involute flank. Derivation:
 * Ligata & Zhang, 2011 IAJC-ASEE, paper 163 ENG 107, equations 1–2:
 * https://ijme.us/cd_11/PDF/Paper%20163%20ENG%20107.pdf
 * Fuentes-Aznar et al., AGMA 16FTM10 (authorized 2017 reprint):
 * https://thermalprocessing.com/wp-content/uploads/2017/201703/0317-Forging.pdf
 * This is not a scaled cylindrical involute, octoid, Gleason or spiral tooth.
 * End faces and the unfilleted root are explicit modelling choices; see docs.
 */
export type BevelParams = Omit<GearParams, 'kind'> & {
  kind: 'bevel';
  /** Mate tooth count fixes the pitch cone. Defaults to this gear's tooth count. */
  bevelMateTeeth?: number;
  /** Angle between the two intersecting axes, in degrees. Default 90. */
  bevelShaftAngleDeg?: number;
};
export interface Point3 extends Point2 { z: number }
export interface BevelDimensions {
  profile: 'spherical-involute';
  endFaces: 'back-cones-over-teeth; planar-inside-root';
  rootTransition: 'sharp-intersection-at-or-above-base-cone';
  toothSystem: 'outer ha=m; hf=1.25m; proportional along generators';
  outerModule: number;
  innerModule: number;
  mateTeeth: number;
  shaftAngleDeg: number;
  pitchConeAngleDeg: number;
  matePitchConeAngleDeg: number;
  baseConeAngleDeg: number;
  tipConeAngleDeg: number;
  rootConeAngleDeg: number;
  outerConeDistance: number;
  innerConeDistance: number;
  faceWidthAlongGenerator: number;
  innerScale: number;
  outerPitchDiameter: number;
  innerPitchDiameter: number;
  outerTipDiameter: number;
  innerTipDiameter: number;
  outerRootDiameter: number;
  innerRootDiameter: number;
  /** Circle on the sphere of radius Ro, NOT a planar cylindrical base circle. */
  outerReferenceSphereBaseDiameter: number;
  outerReferenceToothThickness: number;
  innerReferenceToothThickness: number;
  outerTipArcThickness: number;
  innerTipArcThickness: number;
  innerTipChordThickness: number;
  minimumRadialBoreWall: number;
  outerRootSpaceArcWidth: number;
  rootRollAngleRad: number;
  referenceRollAngleRad: number;
  tipRollAngleRad: number;
  referenceSphericalInvoluteRad: number;
  axialMin: number;
  axialMax: number;
  axialExtent: number;
  coreAxialHeight: number;
  boreAxialLength: number | null;
  /** World frame: the large planar back face is at z=0, pitch axis points -z. */
  apex: Point3;
  pitchAxisDirection: Point3;
  sourceToWorld: { zSign: -1; zOffset: number };
  cylindricalBaseDiameter: null;
  cylindricalBasePitch: null;
}
export interface BevelDiagnostics {
  profileTolerance: number;
  maxFlankChordErrorBound: number;
  maxCircularArcChordErrorBound: number;
  maxSampledFlankChordError: number;
  maxEndCapErrorBound: number;
  maxBoreChordErrorBound: number;
  /** Analytic geometry and faceting bounds; Float32/STL roundoff is separate. */
  toleranceScope: 'analytic-surfaces-before-float32';
  outerPointsPerTooth: number;
  maxAzimuthStepRad: number;
}
export interface BevelDerived extends Omit<GearDerived, 'params'> {
  params: BevelParams;
  bevelDimensions: BevelDimensions;
}
export interface BevelProfile extends Omit<GearProfile, 'params'> {
  params: BevelParams;
  bevelDimensions: BevelDimensions;
  bevelDiagnostics: BevelDiagnostics;
  /** True spatial end contour; inherited outer is only its XY projection. */
  outerEndContour: Point3[];
  innerEndContour: Point3[];
}
export interface BevelMesh extends Omit<GearMesh, 'params' | 'profile'> {
  params: BevelParams;
  profile: BevelProfile;
  bevelDimensions: BevelDimensions;
  bevelDiagnostics: BevelDiagnostics;
}

const PI = Math.PI, TAU = 2 * PI, DEG = PI / 180;
const fail = (code: string, message: string): never => { throw new GearGeometryError(code, message); };
const rotate = (v: Point3, a: number): Point3 => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a), z: v.z });
const scale = (v: Point3, s: number): Point3 => ({ x: s * v.x, y: s * v.y, z: s * v.z });

/** Unit-sphere involute from a great-circle tangent unwound from the base cone. */
export function sphericalInvolutePoint(baseConeAngleRad: number, rollAngleRad: number): Point3 {
  if (!(Number.isFinite(baseConeAngleRad) && baseConeAngleRad > 0 && baseConeAngleRad < PI / 2 &&
    Number.isFinite(rollAngleRad) && rollAngleRad >= 0 && rollAngleRad * Math.sin(baseConeAngleRad) < PI / 2))
    fail('BEVEL_INVOLUTE_DOMAIN', 'Сферическая эвольвента поддерживает острую основную полуугловую величину и первую северную ветвь.');
  return unitPoint(Math.sin(baseConeAngleRad), Math.cos(baseConeAngleRad), rollAngleRad);
}
function unitPoint(sb: number, cb: number, t: number): Point3 {
  const u = sb * t, cu = Math.cos(u), su = Math.sin(u), ct = Math.cos(t), st = Math.sin(t);
  return { x: sb * cu * ct + su * st, y: sb * cu * st - su * ct, z: cb * cu };
}
function rollAtCone(delta: number, sb: number, cb: number): number {
  // 1 - cos(u) = (cos(delta_b) - cos(delta))/cos(delta_b).
  // The product form avoids subtracting nearly equal cosines near the base.
  const db = Math.asin(sb);
  return 2 * Math.asin(Math.sqrt(Math.max(0, Math.sin((delta + db) / 2) * Math.sin((delta - db) / 2) / cb))) / sb;
}
function involuteAtRoll(t: number, sb: number): number {
  const u = sb * t;
  return t - Math.atan2(Math.sin(u), sb * Math.cos(u));
}
function endPoint(sb: number, cb: number, dp: number, Q: number, t: number): Point3 {
  const v = unitPoint(sb, cb, t), denominator = Math.hypot(v.x, v.y) * Math.sin(dp) + v.z * Math.cos(dp);
  return scale(v, Q / denominator);
}

/**
 * module is the OUTER module. width is face width along the pitch generator.
 * backlash reduces one tooth's OUTER reference-circle thickness; it is not a
 * computed pair clearance. The analytical source frame has apex (0,0,0) and
 * axis +z. The final mesh is reflected/translated onto its large flat back face.
 */
export function deriveBevel(input: BevelParams): BevelDerived {
  const p: BevelParams = { ...input, bevelMateTeeth: input.bevelMateTeeth === undefined ? input.teeth : input.bevelMateTeeth,
    bevelShaftAngleDeg: input.bevelShaftAngleDeg === undefined ? 90 : input.bevelShaftAngleDeg };
  if (p.kind !== 'bevel') fail('BEVEL_KIND', 'Коническое ядро строит только прямозубое колесо со сферической эвольвентой.');
  for (const key of ['teeth', 'module', 'pressureAngleDeg', 'helixAngleDeg', 'width', 'bore', 'profileShift', 'backlash', 'bevelMateTeeth', 'bevelShaftAngleDeg'] as const) {
    if (typeof p[key] !== 'number' || !Number.isFinite(p[key])) fail('NON_FINITE', `Параметр ${key} должен быть конечным числом.`);
  }
  const mate = p.bevelMateTeeth!, shaft = p.bevelShaftAngleDeg!, m = p.module;
  if (!Number.isInteger(p.teeth) || p.teeth < 6 || p.teeth > 250 || !Number.isInteger(mate) || mate < 6 || mate > 250)
    fail('TEETH_RANGE', 'Числа зубьев обоих колёс должны быть целыми от 6 до 250.');
  if (m < 0.1 || m > 30) fail('MODULE_RANGE', 'Внешний модуль должен быть от 0,1 до 30 мм.');
  if (p.width < 0.01 || p.width > 500) fail('WIDTH_RANGE', 'Ширина по образующей должна быть от 0,01 до 500 мм.');
  if (p.pressureAngleDeg < 10 || p.pressureAngleDeg > 35) fail('ANGLE_RANGE', 'Угол профиля должен быть от 10° до 35°.');
  if (!(shaft > 0 && shaft < 180)) fail('BEVEL_SHAFT_ANGLE', 'Угол между пересекающимися осями должен быть больше 0° и меньше 180°.');
  if (p.profileShift !== 0) fail('BEVEL_PROFILE_SHIFT', 'Смещение сферического профиля не реализовано; задайте x = 0.');
  if (p.helixAngleDeg !== 0) fail('BEVEL_HELIX', 'Это прямозубое коническое колесо; задайте β = 0.');
  if (p.backlash < 0) fail('BACKLASH_RANGE', 'Утонение по внешней делительной окружности не может быть отрицательным.');
  if (p.bore < 0 || (p.bore > 0 && p.bore < 0.02 * m)) fail('BORE_RANGE', 'Отверстие: 0 либо диаметр не меньше 0,02 внешнего модуля.');
  if (p.profileTolerance !== undefined && (!Number.isFinite(p.profileTolerance) || p.profileTolerance < 1e-6 || p.profileTolerance > 0.5 * m))
    fail('PROFILE_TOLERANCE', 'Допуск дискретизации должен быть от 0,000001 мм до половины внешнего модуля.');
  const sigma = shaft * DEG, dp = Math.atan2(Math.sin(sigma), mate / p.teeth + Math.cos(sigma)), dp2 = sigma - dp;
  if (!(dp > 1e-8 && dp < PI / 2 - 1e-8 && dp2 > 1e-8 && dp2 < PI / 2 - 1e-8))
    fail('BEVEL_PITCH_CONE_DOMAIN', 'Реализованы внешние колёса с двумя острыми делительными конусами; коронное колесо и тупой конус требуют другой модели.');
  const sd = Math.sin(dp), cd = Math.cos(dp), sb = sd * Math.cos(p.pressureAngleDeg * DEG), cb = Math.sqrt(1 - sb * sb);
  const db = Math.asin(sb), R = m * p.teeth / (2 * sd), Ri = R - p.width, ha = m, hf = 1.25 * m;
  if (!(Ri > 0)) fail('BEVEL_FACE_WIDTH', 'Ширина по образующей должна быть меньше внешнего конусного расстояния; иначе тело достигает апекса.');
  const da = dp + Math.atan(ha / R), df = dp - Math.atan(hf / R), ratio = Ri / R;
  if (!(da < PI / 2 - 1e-8)) fail('BEVEL_TIP_CONE_DOMAIN', 'Конус вершин выходит за поддерживаемую острую ветвь.');
  if (df < db - 1e-12) fail('BEVEL_ROOT_BELOW_BASE', 'Впадина ниже основного конуса; производящий переходный профиль ещё не реализован. Увеличьте число зубьев или угол профиля. Это ограничение модели, а не доказательство подрезания.');
  const rp = R * sd, ra = rp + ha * cd, rf = rp - hf * cd;
  if (p.bore / 2 >= ratio * rf - 0.02 * m * ratio)
    fail('BORE_INTERSECTION', 'Цилиндрическое отверстие пересекает малый корневой торец или оставляет слишком тонкую стенку.');
  const thickness = PI * m / 2 - p.backlash, pitch = TAU / p.teeth;
  if (thickness < 0.02 * m) fail('TOOTH_THICKNESS', 'Утонение даёт недопустимую толщину зуба по внешней делительной окружности.');
  const tf = rollAtCone(df, sb, cb), tp = rollAtCone(dp, sb, cb), ta = rollAtCone(da, sb, cb);
  const invp = involuteAtRoll(tp, sb), half = thickness / (2 * rp);
  const halfTip = half + invp - involuteAtRoll(ta, sb), halfRoot = half + invp - involuteAtRoll(tf, sb);
  const tip = 2 * ra * halfTip, rootSpace = rf * (pitch - 2 * halfRoot);
  if (!(tip >= 0.02 * m)) fail('BEVEL_POINTED_TOOTH', 'Сферические эвольвенты пересекаются у вершины или оставляют слишком тонкую вершину. Уменьшите утонение или угол профиля.');
  if (!(rootSpace >= 0.02 * m)) fail('BEVEL_ROOT_OVERLAP', 'Боковины соседних зубьев перекрываются у корня.');
  const rootZ = R * cd + hf * sd, coreHeight = rootZ * (1 - ratio);
  const axialMin = 0, axialMax = rootZ - Ri * (cd - ha / R * sd);
  // Numeric compatibility fields are 0 where cylindrical concepts do not apply.
  // Reports must use the explicit nulls and named cone dimensions below.
  const dimensions: GearDimensions = {
    normalModule: m, transverseModule: m, normalPressureAngleDeg: p.pressureAngleDeg, transversePressureAngleDeg: p.pressureAngleDeg,
    pitchDiameter: 2 * rp, baseDiameter: 0, tipDiameter: 2 * ra, rootDiameter: 2 * rf, outsideDiameter: 2 * ra,
    normalCircularPitch: PI * m, transverseCircularPitch: PI * m, basePitch: 0,
    normalToothThickness: thickness, transverseToothThickness: thickness, tipThickness: tip,
    addendum: ha, dedendum: hf, width: p.width, minimumProfileShift: 0, virtualTeeth: 0,
    twistAngleDeg: 0, rackLength: 0, rackHeight: 0, rackAxialOffset: 0,
  };
  const bevelDimensions: BevelDimensions = {
    profile: 'spherical-involute', endFaces: 'back-cones-over-teeth; planar-inside-root',
    rootTransition: 'sharp-intersection-at-or-above-base-cone', toothSystem: 'outer ha=m; hf=1.25m; proportional along generators',
    outerModule: m, innerModule: ratio * m, mateTeeth: mate, shaftAngleDeg: shaft,
    pitchConeAngleDeg: dp / DEG, matePitchConeAngleDeg: dp2 / DEG, baseConeAngleDeg: db / DEG,
    tipConeAngleDeg: da / DEG, rootConeAngleDeg: df / DEG,
    outerConeDistance: R, innerConeDistance: Ri, faceWidthAlongGenerator: p.width, innerScale: ratio,
    outerPitchDiameter: 2 * rp, innerPitchDiameter: 2 * rp * ratio,
    outerTipDiameter: 2 * ra, innerTipDiameter: 2 * ra * ratio, outerRootDiameter: 2 * rf, innerRootDiameter: 2 * rf * ratio,
    outerReferenceSphereBaseDiameter: 2 * R * sb,
    outerReferenceToothThickness: thickness, innerReferenceToothThickness: thickness * ratio,
    outerTipArcThickness: tip, innerTipArcThickness: tip * ratio,
    innerTipChordThickness: 2 * ra * ratio * Math.sin(halfTip), minimumRadialBoreWall: rf * ratio - p.bore / 2,
    outerRootSpaceArcWidth: rootSpace,
    rootRollAngleRad: tf, referenceRollAngleRad: tp, tipRollAngleRad: ta, referenceSphericalInvoluteRad: invp,
    axialMin, axialMax, axialExtent: axialMax - axialMin, coreAxialHeight: coreHeight, boreAxialLength: p.bore > 0 ? coreHeight : null,
    apex: { x: 0, y: 0, z: rootZ }, pitchAxisDirection: { x: 0, y: 0, z: -1 }, sourceToWorld: { zSign: -1, zOffset: rootZ },
    cylindricalBaseDiameter: null, cylindricalBasePitch: null,
  };
  return { params: p, dimensions, bevelDimensions, warnings: [
    { code: 'BEVEL_SPHERICAL_INVOLUTE', severity: 'info', message: 'Боковина — аналитическая сферическая эвольвента с прямыми образующими от общего апекса. Это отдельная геометрия, не октойд, Gleason или спиральный зуб.' },
    { code: 'BEVEL_TOOTH_SYSTEM', severity: 'warning', message: 'Приняты внешние высоты ha = m, hf = 1,25m и пропорциональное уменьшение к апексу. Впадина целиком не ниже основного конуса; галтель, след инструмента и производящая переходная поверхность не построены.' },
    { code: 'BEVEL_BACK_CONES', severity: 'info', message: 'Ширина измерена по образующей делительного конуса. У зубьев торцы — задние конусы Q = r·sinδ + z·cosδ; внутри корневых окружностей торцы плоские, отверстие цилиндрическое. Большой плоский торец лежит при z = 0. Плоская проекция контура не является торцевым чертежом.' },
    { code: 'BEVEL_PAIR_REQUIRED', severity: 'warning', message: 'Число зубьев партнёра задаёт делительный конус. Контакт и интерференция пары, зазор, несущая способность, технология и класс точности не проверены.' },
    { code: 'BEVEL_TOLERANCE_SCOPE', severity: 'info', message: 'Допуск ограничивает дискретизацию аналитических поверхностей до Float32. Он не задаёт рабочий допуск изготовления или сертифицированную точность STL.' },
    ...(p.width > R / 3 ? [{ code: 'BEVEL_WIDE_FACE', severity: 'warning' as const, message: 'Ширина больше трети внешнего конусного расстояния. Геометрия допустима в модели; это выходит за обычную рекомендацию выбора ширины и требует отдельного расчёта передачи.' }] : []),
    ...(p.backlash > 0 ? [{ code: 'BEVEL_THINNING', severity: 'info' as const, message: `Зуб утонён на внешней делительной окружности на ${p.backlash.toFixed(3)} мм; утонение уменьшается к малому торцу пропорционально конусному расстоянию. Это не рассчитанный зазор пары.` }] : []),
  ] };
}

interface Sampling {
  tolerance: number; maxAngle: number; maxFlankBound: number; maxArcBound: number; maxSampled: number;
}
function distanceToSegment(v: Point3, a: Point3, b: Point3): number {
  const x = b.x - a.x, y = b.y - a.y, z = b.z - a.z, length2 = x * x + y * y + z * z;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((v.x - a.x) * x + (v.y - a.y) * y + (v.z - a.z) * z) / length2)) : 0;
  return Math.hypot(v.x - a.x - t * x, v.y - a.y - t * y, v.z - a.z - t * z);
}
/** Conservative supremum of |(R C / D)''| on the northern involute branch. */
function flankSecondDerivativeBound(t0: number, t1: number, sb: number, cb: number, dp: number, R: number): number {
  const u0 = sb * t0, u1 = sb * t1, d0 = Math.acos(cb * Math.cos(u0)), d1 = Math.acos(cb * Math.cos(u1));
  const Dmin = Math.min(Math.cos(d0 - dp), Math.cos(d1 - dp));
  const sinOffset = Math.max(Math.abs(Math.sin(d0 - dp)), Math.abs(Math.sin(d1 - dp)));
  const deltaPrimeMax = cb * sb * Math.sin(u1) / Math.sin(d1);
  const deltaSecondMax = sb ** 4 * Math.cos(d0) / Math.sin(d0) ** 3;
  const Dprime = sinOffset * deltaPrimeMax, Dsecond = deltaPrimeMax ** 2 + sinOffset * deltaSecondMax;
  const Cprime = cb * Math.sin(u1);
  const Csecond = cb * Math.sqrt(Math.max(
    sb * sb * Math.cos(u0) ** 2 + cb * cb * Math.sin(u0) ** 2,
    sb * sb * Math.cos(u1) ** 2 + cb * cb * Math.sin(u1) ** 2));
  return R * (Csecond / Dmin + 2 * Cprime * Dprime / Dmin ** 2 + Dsecond / Dmin ** 2 + 2 * Dprime ** 2 / Dmin ** 3);
}
function sampleFlank(sb: number, cb: number, dp: number, R: number, tf: number, tp: number, ta: number, seeds: number, state: Sampling): Point3[] {
  const points = [endPoint(sb, cb, dp, R, tf)];
  const add = (t0: number, t1: number, depth: number) => {
    const a = endPoint(sb, cb, dp, R, t0), b = endPoint(sb, cb, dp, R, t1);
    const bound = flankSecondDerivativeBound(t0, t1, sb, cb, dp, R) * (t1 - t0) ** 2 / 8;
    const step = involuteAtRoll(t1, sb) - involuteAtRoll(t0, sb);
    if (bound > state.tolerance || step > state.maxAngle) {
      if (depth >= 24 || points.length >= 4096) fail('MESH_BUDGET', 'Допуск сферической эвольвенты превышает бюджет дискретизации браузера.');
      const mid = (t0 + t1) / 2; add(t0, mid, depth + 1); add(mid, t1, depth + 1); return;
    }
    state.maxFlankBound = Math.max(state.maxFlankBound, bound);
    for (const f of [0.25, 0.5, 0.75]) state.maxSampled = Math.max(state.maxSampled,
      distanceToSegment(endPoint(sb, cb, dp, R, t0 + (t1 - t0) * f), a, b));
    points.push(b);
  };
  // Keep the exact reference-circle point in the contour, independently of quality.
  for (const [start, end] of [[tf, tp], [tp, ta]]) for (let i = 0; i < seeds; i++)
    add(start + (end - start) * i / seeds, start + (end - start) * (i + 1) / seeds, 0);
  return points;
}
function sampleArc(radius: number, z: number, start: number, end: number, state: Sampling): Point3[] {
  const count = Math.max(1, Math.ceil((end - start) / state.maxAngle));
  if (count > 4096) fail('MESH_BUDGET', 'Слишком много отсчётов круговой кромки для браузера.');
  state.maxArcBound = Math.max(state.maxArcBound, 2 * radius * Math.sin((end - start) / (4 * count)) ** 2);
  return Array.from({ length: count + 1 }, (_, i) => {
    const a = start + (end - start) * i / count; return { x: radius * Math.cos(a), y: radius * Math.sin(a), z };
  });
}

/** Closed ruled tooth shell, back-cone tooth ends, flat core ends and a bore. */
export function buildBevelMesh(input: BevelParams, quality: MeshQuality = {}): BevelMesh {
  const derived = deriveBevel(input), p = derived.params, b = derived.bevelDimensions;
  for (const value of [quality.flankSamples, quality.axialSegments])
    if (value !== undefined && (!Number.isFinite(value) || !Number.isInteger(value) || value < 1)) fail('QUALITY_RANGE', 'Число отсчётов должно быть целым положительным числом.');
  if ((quality.flankSamples ?? 12) > 64 || (quality.axialSegments ?? 1) > 256) fail('MESH_BUDGET', 'Число отсчётов превышает бюджет браузера.');
  const flankSamples = Math.max(5, quality.flankSamples ?? 12), axialSegments = quality.axialSegments ?? 1;
  const R = b.outerConeDistance, Ri = b.innerConeDistance, dp = b.pitchConeAngleDeg * DEG, db = b.baseConeAngleDeg * DEG;
  const sd = Math.sin(dp), cd = Math.cos(dp), sb = Math.sin(db), cb = Math.cos(db), ra = b.outerTipDiameter / 2, rf = b.outerRootDiameter / 2;
  const tolerance = p.profileTolerance ?? p.module * 0.002, capScale = ra * Math.max(1, Math.tan(dp));
  const state: Sampling = { tolerance, maxAngle: Math.min(PI / 12, 4 * Math.asin(Math.sqrt(Math.min(1, tolerance / (2 * capScale))))),
    maxFlankBound: 0, maxArcBound: 0, maxSampled: 0 };
  const pitch = TAU / p.teeth, half = b.outerReferenceToothThickness / b.outerPitchDiameter;
  const halfTip = b.outerTipArcThickness / (2 * ra), halfRoot = (pitch - b.outerRootSpaceArcWidth / rf) / 2;
  const flank = sampleFlank(sb, cb, dp, R, b.rootRollAngleRad, b.referenceRollAngleRad, b.tipRollAngleRad, flankSamples, state)
    .map(v => rotate(v, -half - b.referenceSphericalInvoluteRad));
  const sector: Point3[] = [], rootFlags: boolean[] = [];
  const append = (points: Point3[], onRoot: (index: number) => boolean = () => false) => { for (let j = 0; j < points.length; j++) {
    const v = points[j];
    const last = sector.at(-1);
    if (!last || Math.hypot(v.x - last.x, v.y - last.y, v.z - last.z) > 1e-10 * p.module) { sector.push(v); rootFlags.push(onRoot(j)); }
  } };
  append(sampleArc(rf, (R - rf * sd) / cd, -pitch / 2, -halfRoot, state), () => true);
  append(flank, j => j === 0);
  append(sampleArc(ra, (R - ra * sd) / cd, -halfTip, halfTip, state));
  append(flank.toReversed().map(v => ({ x: v.x, y: -v.y, z: v.z })), j => j === flank.length - 1);
  append(sampleArc(rf, (R - rf * sd) / cd, halfRoot, pitch / 2, state), () => true);
  const n = sector.length - 1, count = n * p.teeth, holeCount = p.bore > 0 ? count : 0, ringSize = count + holeCount;
  const nonRootCount = rootFlags.slice(0, n).filter(value => !value).length * p.teeth;
  let toothCapTriangles = 0;
  for (let j = 0; j < n; j++) toothCapTriangles += Number(!rootFlags[j]) + Number(!rootFlags[j + 1]);
  const vertices = (axialSegments + 1) * ringSize + 2 * nonRootCount + (holeCount ? 0 : 2);
  const triangles = 2 * axialSegments * ringSize + (holeCount ? 4 : 2) * count + 2 * toothCapTriangles * p.teeth;
  if (n > 4096 || vertices > 250_000 || triangles > 500_000) fail('MESH_BUDGET', 'Коническая сетка превышает бюджет браузера; уменьшите число зубьев или плотность сетки.');
  let maxStep = 0;
  for (let j = 1; j < sector.length; j++) {
    const step = Math.atan2(sector[j].y, sector[j].x) - Math.atan2(sector[j - 1].y, sector[j - 1].x);
    if (!(step > 0)) fail('BEVEL_CONTOUR_ORDER', 'Конический контур теряет строгую угловую монотонность.');
    maxStep = Math.max(maxStep, step);
  }
  const sourceOuter: Point3[] = [];
  for (let tooth = 0; tooth < p.teeth; tooth++) for (let j = 0; j < n; j++) sourceOuter.push(rotate(sector[j], tooth * pitch));
  const world = (v: Point3): Point3 => ({ x: v.x, y: v.y, z: b.sourceToWorld.zOffset - v.z });
  const outerEndContour = sourceOuter.map(world), innerEndContour = sourceOuter.map(v => world(scale(v, b.innerScale)));
  const outer: Point2[] = outerEndContour.map(v => ({ x: v.x, y: v.y }));
  const rb = p.bore / 2, hole: Point2[] | null = holeCount ? outer.map(v => {
    const r = Math.hypot(v.x, v.y); return { x: rb * v.x / r, y: rb * v.y / r };
  }) : null;
  const positions = new Float32Array(vertices * 3), indices = new Uint32Array(triangles * 3);
  let vi = 0, fi = 0;
  const vertex = (x: number, y: number, z: number) => { const id = vi / 3; positions[vi++] = x; positions[vi++] = y; positions[vi++] = z; return id; };
  // Reflection of z reverses handedness: reverse every source-frame triangle.
  const face = (a: number, c: number, d: number) => { indices[fi++] = a; indices[fi++] = d; indices[fi++] = c; };
  for (let layer = 0; layer <= axialSegments; layer++) {
    const Q = Ri + p.width * layer / axialSegments;
    for (const v of sourceOuter) vertex(v.x * Q / R, v.y * Q / R, b.sourceToWorld.zOffset - v.z * Q / R);
    if (hole) for (const v of hole) vertex(v.x, v.y, b.sourceToWorld.zOffset * (1 - Q / R));
  }
  for (let layer = 0; layer < axialSegments; layer++) {
    const low = layer * ringSize, high = low + ringSize;
    for (let j = 0; j < count; j++) {
      const next = (j + 1) % count;
      face(low + j, low + next, high + next); face(low + j, high + next, high + j);
      if (hole) { face(low + count + j, high + count + next, low + count + next); face(low + count + j, high + count + j, high + count + next); }
    }
  }
  const top = axialSegments * ringSize;
  // Root-ring vertices on root lands reuse the shell indices. The wedge next to
  // a land is one triangle; a zero-width annulus is never emitted or welded later.
  const rootRings = [b.innerScale, 1].map((ratio, layer) => sourceOuter.map((v, j) => {
    if (rootFlags[j % n]) return (layer ? top : 0) + j;
    const r = Math.hypot(v.x, v.y);
    return vertex(ratio * rf * v.x / r, ratio * rf * v.y / r, b.sourceToWorld.zOffset * (1 - ratio));
  }));
  const bottomCentre = hole ? -1 : vertex(0, 0, b.coreAxialHeight), topCentre = hole ? -1 : vertex(0, 0, 0);
  for (let j = 0; j < count; j++) {
    const next = (j + 1) % count;
    for (let layer = 0; layer < 2; layer++) {
      const offset = layer ? top : 0, roots = rootRings[layer];
      const capFace = (a: number, c: number, d: number) => layer ? face(a, c, d) : face(a, d, c);
      if (offset + next !== roots[next]) capFace(offset + j, offset + next, roots[next]);
      if (offset + j !== roots[j]) capFace(offset + j, roots[next], roots[j]);
    }
    if (hole) {
      face(rootRings[1][j], rootRings[1][next], top + count + next); face(rootRings[1][j], top + count + next, top + count + j);
      face(rootRings[0][j], count + next, rootRings[0][next]); face(rootRings[0][j], count + j, count + next);
    } else { face(topCentre, rootRings[1][j], rootRings[1][next]); face(bottomCentre, rootRings[0][next], rootRings[0][j]); }
  }
  if (vi !== positions.length || fi !== indices.length) fail('BEVEL_MESH_COUNT', 'Число вершин или граней не соответствует замкнутой топологии.');
  for (let j = 0; j < indices.length; j += 3) {
    const a = indices[j] * 3, c = indices[j + 1] * 3, d = indices[j + 2] * 3;
    const ux = positions[c] - positions[a], uy = positions[c + 1] - positions[a + 1], uz = positions[c + 2] - positions[a + 2];
    const vx = positions[d] - positions[a], vy = positions[d + 1] - positions[a + 1], vz = positions[d + 2] - positions[a + 2];
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) <= 1e-11)
      fail('BEVEL_FLOAT_PRECISION', 'Float32 не сохраняет отдельные грани этой сетки; уменьшите плотность дискретизации или измените масштаб.');
  }
  const sagFactor = 2 * Math.sin(maxStep / 4) ** 2;
  const diagnostics: BevelDiagnostics = {
    profileTolerance: tolerance, maxFlankChordErrorBound: state.maxFlankBound, maxCircularArcChordErrorBound: state.maxArcBound,
    maxSampledFlankChordError: state.maxSampled, maxEndCapErrorBound: ra * Math.tan(dp) * sagFactor,
    maxBoreChordErrorBound: rb * sagFactor, toleranceScope: 'analytic-surfaces-before-float32',
    outerPointsPerTooth: n, maxAzimuthStepRad: maxStep,
  };
  const profile: BevelProfile = { ...derived, outer, hole, outerEndContour, innerEndContour, bevelDiagnostics: diagnostics };
  return { ...derived, profile, positions, indices, bevelDiagnostics: diagnostics, tessellation: { flankSamples, axialSegments } };
}
