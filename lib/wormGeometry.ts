import { GearGeometryError } from './gearMath.ts';
import type { GearDerived, GearDimensions, GearMesh, GearParams, GearProfile, MeshQuality, Point2 } from './gearMath.ts';

/**
 * An isolated cylindrical ZA worm, with a straight-sided axial trapezoid.
 * The axial module mx is NOT the normal module mn of the involute gear kernel.
 * Sources: KHK Technical Reference, §4.6, Tables 4.22, 4.23 and 4.26:
 * https://khkgears.net/new/gear_knowledge/gear_technical_reference/calculation_gear_dimensions.html
 * ZA definition: Litvin & Fuentes, Gear Geometry and Applied Theory, §19.4:
 * https://www.cambridge.org/core/books/abs/gear-geometry-and-applied-theory/wormgear-drives-with-cylindrical-worms/2583169B30F6E4D894D605D56E05BBE7
 * The preserved Python kernel's axial-to-transverse mapping and screw motion
 * were reviewed; its rounded transitions are not part of this sharp-root model.
 */
export type WormParams = Omit<GearParams, 'kind'> & {
  kind: 'worm';
  /** Number of independent helices, 1–8. The inherited teeth field is ignored. */
  wormStarts?: number;
  /** q = reference diameter / AXIAL module, greater than 2.5 and at most 100. */
  wormDiameterFactor?: number;
  /** Right hand advances in +z when angle increases in the right-handed xyz frame. */
  wormHand?: 'right' | 'left';
};
export interface WormDimensions {
  profile: 'ZA';
  axialModule: number;
  axialPressureAngleDeg: number;
  starts: number;
  diameterFactor: number;
  hand: 'right' | 'left';
  axialPitch: number;
  /** Positive magnitude; signedLead includes handedness. */
  lead: number;
  signedLead: number;
  /** Positive magnitude at the reference cylinder. */
  leadAngleDeg: number;
  axialToothThickness: number;
  axialTipThickness: number;
  axialRootLand: number;
}
export interface WormDerived extends Omit<GearDerived, 'params'> {
  params: WormParams;
  wormDimensions: WormDimensions;
}
export interface WormProfile extends Omit<GearProfile, 'params'> {
  params: WormParams;
}
export interface WormMesh extends Omit<GearMesh, 'params' | 'profile'> {
  params: WormParams;
  profile: WormProfile;
  wormDimensions: WormDimensions;
}
const PI = Math.PI, TAU = 2 * PI, DEG = PI / 180;
const fail = (code: string, message: string): never => { throw new GearGeometryError(code, message); };

/**
 * module=mx, pressureAngleDeg=alpha_x, width=threaded length, backlash=axial
 * tooth-thickness reduction. No profile shift, fillets, crowning or mating wheel.
 * teeth and helixAngleDeg have no effect; starts, q and hand define the helix.
 */
export function deriveWorm(input: WormParams): WormDerived {
  const p: WormParams = { ...input,
    wormStarts: input.wormStarts === undefined ? 1 : input.wormStarts,
    wormDiameterFactor: input.wormDiameterFactor === undefined ? 10 : input.wormDiameterFactor,
    wormHand: input.wormHand === undefined ? 'right' : input.wormHand };
  if (p.kind !== 'worm') fail('WORM_KIND', 'Модуль ZA строит только отдельный цилиндрический червяк.');
  for (const key of ['module', 'pressureAngleDeg', 'width', 'bore', 'profileShift', 'backlash', 'wormStarts', 'wormDiameterFactor'] as const) {
    if (typeof p[key] !== 'number' || !Number.isFinite(p[key])) fail('NON_FINITE', `Параметр ${key} должен быть конечным числом.`);
  }
  const starts = p.wormStarts!, q = p.wormDiameterFactor!, mx = p.module;
  if (!Number.isInteger(starts) || starts < 1 || starts > 8) fail('WORM_STARTS', 'Число заходов червяка должно быть целым от 1 до 8.');
  if (!(q > 2.5 && q <= 100)) fail('WORM_DIAMETER_FACTOR', 'Коэффициент диаметра q должен быть больше 2,5 и не больше 100.');
  if (p.wormHand !== 'right' && p.wormHand !== 'left') fail('WORM_HAND', 'Укажите правое или левое направление витка.');
  const hand = p.wormHand === 'left' ? 'left' : 'right';
  if (!(mx >= 0.1 && mx <= 30)) fail('MODULE_RANGE', 'Осевой модуль червяка должен быть от 0,1 до 30 мм.');
  if (!(p.width >= 0.01 && p.width <= 500)) fail('WIDTH_RANGE', 'Длина нарезанной части должна быть от 0,01 до 500 мм.');
  if (!(p.pressureAngleDeg >= 10 && p.pressureAngleDeg <= 35)) fail('ANGLE_RANGE', 'Осевой угол профиля должен быть от 10° до 35°.');
  if (p.profileShift !== 0) fail('WORM_PROFILE_SHIFT', 'Смещение профиля для этого ZA-червяка не реализовано; задайте x = 0.');
  if (p.backlash < 0) fail('BACKLASH_RANGE', 'Осевое уменьшение толщины витка не может быть отрицательным.');
  if (p.bore < 0 || (p.bore > 0 && p.bore < 0.02 * mx)) fail('BORE_RANGE', 'Отверстие: 0 (без отверстия) либо диаметр не меньше 0,02 осевого модуля.');
  if (p.profileTolerance !== undefined && (!Number.isFinite(p.profileTolerance) || p.profileTolerance < 1e-6 || p.profileTolerance > mx * 0.5))
    fail('PROFILE_TOLERANCE', 'Шаг точности профиля должен быть от 0,000001 мм до половины осевого модуля.');

  const ax = p.pressureAngleDeg * DEG, slope = Math.tan(ax), leadAngle = Math.atan(starts / q);
  const cp = Math.cos(leadAngle), pitch = PI * mx, lead = pitch * starts;
  const handSign = hand === 'right' ? 1 : -1;
  const rp = q * mx / 2, ha = mx, hf = 1.25 * mx, ra = rp + ha, rf = rp - hf;
  const sx = pitch / 2 - p.backlash, tip = sx - 2 * ha * slope;
  const rootLand = pitch - sx - 2 * hf * slope;
  if (tip < 0.02 * mx) fail('WORM_POINTED_THREAD', 'Осевые боковины дают слишком тонкую вершину витка. Уменьшите угол или утонение.');
  if (rootLand < 0.02 * mx) fail('WORM_ROOT_OVERLAP', 'Соседние витки перекрываются у впадин. Уменьшите осевой угол профиля.');
  if (rf < 0.05 * mx) fail('WORM_ROOT_RADIUS', 'Слишком малый корневой радиус; увеличьте коэффициент диаметра q.');
  if (p.bore / 2 >= rf - 0.02 * mx) fail('BORE_INTERSECTION', 'Отверстие пересекает основание витка или оставляет слишком тонкую стенку.');
  const dimensions: GearDimensions = {
    normalModule: mx * cp, transverseModule: q * mx / starts,
    normalPressureAngleDeg: Math.atan(slope * cp) / DEG,
    transversePressureAngleDeg: Math.atan(slope / Math.tan(leadAngle)) / DEG,
    pitchDiameter: 2 * rp, baseDiameter: 0, tipDiameter: 2 * ra,
    rootDiameter: 2 * rf, outsideDiameter: 2 * ra,
    normalCircularPitch: pitch * cp, transverseCircularPitch: TAU * rp / starts,
    basePitch: 0, normalToothThickness: sx * cp,
    transverseToothThickness: sx / Math.tan(leadAngle),
    // Compatibility field is transverse ARC thickness at the tip cylinder.
    // Use wormDimensions.axialTipThickness for the axial manufacturing section.
    tipThickness: tip * TAU * ra / lead,
    addendum: ha, dedendum: hf, width: p.width,
    minimumProfileShift: 0, virtualTeeth: 0,
    twistAngleDeg: handSign * p.width * TAU / lead / DEG,
    rackLength: 0, rackHeight: 0, rackAxialOffset: 0,
  };
  return {
    params: p, dimensions,
    wormDimensions: { profile: 'ZA', axialModule: mx, axialPressureAngleDeg: p.pressureAngleDeg,
      starts, diameterFactor: q, hand, axialPitch: pitch, lead,
      signedLead: handSign * lead, leadAngleDeg: leadAngle / DEG,
      axialToothThickness: sx, axialTipThickness: tip, axialRootLand: rootLand },
    warnings: [
      { code: 'WORM_AXIAL_INPUT', severity: 'info', message: 'ZA: модуль и угол заданы в осевом сечении. Угол подъёма и ход определяются числом заходов и коэффициентом диаметра q; поле числа зубьев колеса не используется.' },
      { code: 'WORM_SHARP_TRANSITIONS', severity: 'warning', message: 'Прямые осевые боковины ZA и винтовое движение заданы аналитически. Переходы к вершинам и впадинам острые: скругление инструмента и сбег резьбы не построены.' },
      { code: 'WORM_PAIR_REQUIRED', severity: 'warning', message: 'Построен отдельный червяк. Ответное червячное колесо, контакт, зазор пары, нагрев и несущая способность не проверены.' },
      { code: 'WORM_NOT_INVOLUTE', severity: 'info', message: 'ZA не имеет эвольвентной основной окружности: основной диаметр и основной шаг здесь неприменимы.' },
      ...(p.backlash > 0 ? [{ code: 'WORM_AXIAL_THINNING', severity: 'info' as const,
        message: `Виток утонён в осевом сечении на ${p.backlash.toFixed(3)} мм; это не рассчитанный боковой зазор червячной пары.` }] : []),
    ],
  };
}

function radialAt(d: WormDerived, angleRad: number, axialZ: number): number {
  const w = d.wormDimensions;
  // A helical flank is a generating straight line moved by z = signedLead*theta/2π.
  const phase = axialZ - w.signedLead * angleRad / TAU;
  const offset = phase - w.axialPitch * Math.floor(phase / w.axialPitch + 0.5);
  const r = d.dimensions.pitchDiameter / 2 + (w.axialToothThickness / 2 - Math.abs(offset)) / Math.tan(w.axialPressureAngleDeg * DEG);
  return Math.max(d.dimensions.rootDiameter / 2, Math.min(d.dimensions.tipDiameter / 2, r));
}

/** Analytic radial boundary of the infinite ZA thread before trimming to ±width/2. */
export function wormRadiusAt(input: WormParams, angleRad: number, axialZ: number): number {
  if (!Number.isFinite(angleRad) || !Number.isFinite(axialZ)) fail('NON_FINITE', 'Координаты сечения должны быть конечными.');
  return radialAt(deriveWorm(input), angleRad, axialZ);
}

/**
 * Every sharp axial-profile junction is represented in the transverse section.
 * Subdivision follows both circle curvature and the Archimedes-spiral flank.
 * The returned profile is centered at z=0; mesh rings screw it to actual z.
 */
function startSection(d: WormDerived, flankSamples: number, maxAngle: number): Point2[] {
  const w = d.wormDimensions, h = w.lead / TAU, sector = TAU / w.starts;
  const tipHalf = w.axialTipThickness / (2 * h), rootHalf = (w.axialPitch - w.axialRootLand) / (2 * h);
  const knots = [-sector / 2, -rootHalf, -tipHalf, tipHalf, rootHalf, sector / 2];
  const points: Point2[] = [];
  for (let start = 0; start < w.starts; start++) {
    for (let span = 0; span < knots.length - 1; span++) {
      const a = knots[span], b = knots[span + 1];
      const count = Math.max(span === 1 || span === 3 ? flankSamples : 1, Math.ceil((b - a) / maxAngle));
      for (let j = 0; j < count; j++) {
        const angle = start * sector + a + (b - a) * j / count;
        const radius = radialAt(d, angle, 0);
        points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
      }
    }
  }
  return points;
}

/** Capped millimetre mesh; no external libraries or CAD service required. */
export function buildWormMesh(input: WormParams, quality: MeshQuality = {}): WormMesh {
  const derived = deriveWorm(input), p = derived.params, w = derived.wormDimensions;
  for (const value of [quality.flankSamples, quality.axialSegments]) {
    if (value !== undefined && (!Number.isFinite(value) || !Number.isInteger(value) || value < 1))
      fail('QUALITY_RANGE', 'Количество отсчётов сетки должно быть целым положительным числом.');
  }
  if ((quality.flankSamples ?? 12) > 64 || (quality.axialSegments ?? 1) > 4096)
    fail('MESH_BUDGET', 'Запрошенное число отсчётов превышает бюджет браузера.');
  const flankSamples = Math.max(5, quality.flankSamples ?? 12);
  const ra = derived.dimensions.tipDiameter / 2, tolerance = p.profileTolerance ?? p.module * 0.01;
  // A conservative curvature scale also accounts for dr/dtheta on the spiral.
  // This controls local chord sampling, not a certified global STL tolerance.
  const radialSlope = w.lead / TAU / Math.tan(w.axialPressureAngleDeg * DEG);
  const maxAngle = Math.min(3 * DEG, Math.sqrt(8 * tolerance / (ra + 2 * radialSlope)));
  const twist = derived.dimensions.twistAngleDeg * DEG;
  const axialSegments = Math.max(1, quality.axialSegments ?? 1, Math.ceil(Math.abs(twist) / maxAngle));
  if (axialSegments > 4096) fail('MESH_BUDGET', 'Слишком много витков для браузерной сетки. Уменьшите длину или увеличьте модуль/число заходов.');
  const outer = startSection(derived, flankSamples, maxAngle);
  const hole = p.bore > 0 ? outer.map(v => {
    const r = Math.hypot(v.x, v.y); return { x: v.x * p.bore / (2 * r), y: v.y * p.bore / (2 * r) };
  }) : null;
  const count = outer.length, ringSize = count * (hole ? 2 : 1);
  const vertices = (axialSegments + 1) * ringSize + (hole ? 0 : 2);
  const triangles = 2 * axialSegments * ringSize + (hole ? 4 * count : 2 * count);
  if (vertices > 250_000 || triangles > 500_000)
    fail('MESH_BUDGET', 'Слишком сложная сетка ZA для браузера. Уменьшите длину, качество или число отсчётов.');
  const positions = new Float32Array(vertices * 3), indices = new Uint32Array(triangles * 3);
  let vi = 0, fi = 0;
  const vertex = (x: number, y: number, z: number) => {
    const id = vi / 3; positions[vi++] = x; positions[vi++] = y; positions[vi++] = z; return id;
  };
  const face = (a: number, b: number, c: number) => { indices[fi++] = a; indices[fi++] = b; indices[fi++] = c; };
  for (let k = 0; k <= axialSegments; k++) {
    const t = k / axialSegments, z = (t - 0.5) * p.width, phase = twist * (t - 0.5);
    const co = Math.cos(phase), si = Math.sin(phase);
    for (const loop of [outer, ...(hole ? [hole] : [])]) {
      for (const v of loop) vertex(v.x * co - v.y * si, v.x * si + v.y * co, z);
    }
  }
  for (let k = 0; k < axialSegments; k++) {
    const low = k * ringSize, high = (k + 1) * ringSize;
    for (let j = 0; j < count; j++) {
      const next = (j + 1) % count;
      face(low + j, low + next, high + next); face(low + j, high + next, high + j);
      if (hole) {
        face(low + count + j, high + count + next, low + count + next);
        face(low + count + j, high + count + j, high + count + next);
      }
    }
  }
  const top = axialSegments * ringSize;
  if (hole) {
    for (let j = 0; j < count; j++) {
      const next = (j + 1) % count;
      face(top + j, top + next, top + count + next); face(top + j, top + count + next, top + count + j);
      face(j, count + next, next); face(j, count + j, count + next);
    }
  } else {
    const bottomCentre = vertex(0, 0, -p.width / 2), topCentre = vertex(0, 0, p.width / 2);
    for (let j = 0; j < count; j++) {
      const next = (j + 1) % count;
      face(topCentre, top + j, top + next); face(bottomCentre, next, j);
    }
  }
  const profile: WormProfile = { params: p, dimensions: derived.dimensions, warnings: derived.warnings, outer, hole };
  return { ...derived, positions, indices, profile, tessellation: { flankSamples, axialSegments } };
}
