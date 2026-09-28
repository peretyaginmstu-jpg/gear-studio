/** Internal spur tooth root: the physical envelope of an explicitly specified
 * involute pinion cutter with circular tip corners. Millimetres and radians.
 * Cutter geometry is an input assumption, never inferred from a photograph.
 */
import { GearGeometryError, type GearParams, type GearDimensions, type Point2 } from './gearMath.ts';

export const internalCutterKeys = ['internalCutterTeeth', 'internalCutterProfileShift', 'internalCutterAddendumCoefficient', 'internalCutterTipRadiusCoefficient', 'internalCutterThinning'] as const;
export const defaultInternalCutter = {
  internalCutterTeeth: 24, internalCutterProfileShift: 0, internalCutterAddendumCoefficient: 1.25,
  internalCutterTipRadiusCoefficient: .3, internalCutterThinning: 0,
} as const;
export interface InternalCutterGeometry {
  method: 'circular-pinion-cutter-envelope';
  tool: { teeth: number; profileShift: number; addendumCoefficient: number; tipRadiusCoefficient: number; thinning: number; provenance: 'specified-or-assumed; not-inferred-from-photo' };
  ringTeeth: number; module: number; pitchRadius: number; baseRadius: number; tipRadius: number; toothThickness: number;
  cutterPitchRadius: number; cutterBaseRadius: number; cutterOutsideRadius: number; toolTipRadius: number;
  cutterCircleCenterRadius: number; cutterCircleCenter: Point2; cutterCircleCenterAngle: number;
  cutterFlankConstant: number; cutterJoinRoll: number; cutterJoinTangentAngle: number;
  generatingPressureAngleDeg: number; generatingCenterDistance: number; ratioMinusOne: number;
  phiJoin: number; phiRoot: number; phase: number; joinRoll: number; joinRadius: number; rootRadius: number;
  tipRoll: number; cutterRollAtRingTip: number; halfTipAngle: number; halfJoinAngle: number; rootStartAngle: number;
  oppositeContactRadiusAtRingTip: number; oppositeContactClearance: number;
  minimumGlobalOffsetFactor: number; remoteCornerMaximumRadius: number;
  lowerToolClosure: { method: 'radial-tooth-sides-and-circular-core'; coreRadius: number; maximumNonInterferingCoreRadius: number; assumption: 'mathematical-closure; actual-cutter-root-not-reconstructed' };
  rootLandAngle: number; rootLand: number;
  joinError: number; tangentErrorDeg: number;
  /** Conservative global bound on |d²E/dφ²|, before Float32. */
  rootSecondDerivativeBound: number;
}
export interface InternalRootDiagnostics extends InternalCutterGeometry {
  profileTolerance: number;
  maxChordErrorBound: number;
  maxSampledChordError: number;
  pointsPerTooth: number;
  approximation: 'C2-chord-bound-and-circular-sagitta; before-Float32; not-manufacturing-tolerance';
}
const PI = Math.PI, TAU = 2 * PI;
const fail = (code: string, message: string): never => { throw new GearGeometryError(code, message); };
const inv = (a: number) => Math.tan(a) - a;
const invRoll = (t: number) => t - Math.atan(t);
const polar = (r: number, a: number): Point2 => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
const rotate = (q: Point2, a: number): Point2 => ({ x: q.x * Math.cos(a) - q.y * Math.sin(a), y: q.x * Math.sin(a) + q.y * Math.cos(a) });
const cross = (a: Point2, b: Point2) => a.x * b.y - a.y * b.x;
const dot = (a: Point2, b: Point2) => a.x * b.x + a.y * b.y;
const norm = (p: Point2) => Math.hypot(p.x, p.y);

/** Does not use a free phase fit. The clearance-free thickness equation fixes phase=π/z. */
export function deriveInternalCutter(p: GearParams): InternalCutterGeometry {
  if (p.kind !== 'internal') fail('INTERNAL_CUTTER_KIND', 'Плоская огибающая долбяка реализована только для внутреннего прямозубого колеса.');
  const m = p.module, z = p.teeth, alpha = p.pressureAngleDeg * PI / 180;
  const zc = p.internalCutterTeeth ?? defaultInternalCutter.internalCutterTeeth;
  const xc = p.internalCutterProfileShift ?? 0, hac = p.internalCutterAddendumCoefficient ?? 1.25;
  const rhoC = p.internalCutterTipRadiusCoefficient ?? .3, jc = p.internalCutterThinning ?? 0;
  if (![m, z, alpha, p.profileShift, p.backlash, zc, xc, hac, rhoC, jc].every(Number.isFinite)) fail('INTERNAL_CUTTER_NON_FINITE', 'Параметры колеса и долбяка должны быть конечными числами.');
  if (!(m > 0 && Number.isInteger(z) && z >= 6 && alpha > 0 && alpha < PI / 2 && p.backlash >= 0)) fail('INTERNAL_CUTTER_INPUT', 'Недопустимые исходные параметры внутреннего колеса.');
  if (!(Number.isInteger(zc) && zc >= 6 && zc < z)) fail('INTERNAL_CUTTER_TEETH', 'Число зубьев долбяка должно быть целым, не меньше 6 и меньше числа зубьев внутреннего колеса.');
  if (!(xc >= -.8 && xc <= 1 && hac >= .5 && hac <= 2 && rhoC >= .05 && rhoC <= .8 && jc >= 0)) fail('INTERNAL_CUTTER_RANGE', 'Область долбяка: xс от −0,8 до 1; haс* от 0,5 до 2; ρс/m от 0,05 до 0,8; утонение неотрицательно.');
  const r = m * z / 2, rc = m * zc / 2, rb = r * Math.cos(alpha), bc = rc * Math.cos(alpha);
  const s = m * (PI / 2 - 2 * p.profileShift * Math.tan(alpha)) - p.backlash;
  const sc = m * (PI / 2 + 2 * xc * Math.tan(alpha)) - jc;
  if (!(s > .05 * m && s < (PI - .05) * m && sc > .05 * m && sc < (PI - .05) * m)) fail('INTERNAL_CUTTER_THICKNESS', 'Смещение и утонение дают недопустимую толщину зуба колеса или долбяка.');
  const target = inv(alpha) + (2 * (p.profileShift - xc) * Math.tan(alpha) + (p.backlash + jc) / m) / (z - zc);
  if (!(target > 1e-12)) fail('INTERNAL_GENERATING_ANGLE', 'Для этих толщин не получен положительный угол обката долбяка. Измените смещения или инструмент.');
  let lo = 0, hi = PI / 2 - 1e-7;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (inv(mid) < target) lo = mid; else hi = mid; }
  const ag = (lo + hi) / 2, a = (rb - bc) / Math.cos(ag), k = z / zc - 1, L = k + 1;
  const rac = rc + m * (xc + hac), rho = m * rhoC, R = rac - rho;
  if (!(R > bc && R > a / k + 1e-10 * m)) fail('INTERNAL_CUTTER_REACH', 'Круглая вершина долбяка не даёт регулярную переходную ветвь: её центр должен быть вне рабочего делительного радиуса инструмента.');
  const H = Math.sqrt((R / bc) ** 2 - 1), tc = H + rho / bc, A = sc / (2 * rc) + inv(alpha), psi = tc - A;
  const gamma = psi - Math.atan(H), center = rotate({ x: bc, y: -bc * H }, psi);
  if (!(A > 0 && A < PI / zc && gamma < -1e-8)) fail('INTERNAL_CUTTER_POINTED', 'Боковины или скруглённые вершины долбяка пересекаются: нет положительной площадки на вершине инструмента.');
  const ra = r - m * ((p.addendumCoefficient ?? 1) - p.profileShift), rf = a + rac;
  if (!(ra >= rb && ra < rf)) fail('INTERNAL_CUTTER_RING_TIP', 'Вершина внутреннего колеса должна быть не ниже основной окружности и внутри фактического корня.');
  const tt = Math.sqrt((ra / rb) ** 2 - 1), tipToolRoll = (rb * tt - a * Math.sin(ag)) / bc;
  if (tipToolRoll < -1e-12) fail('INTERNAL_CUTTER_TIP_CONTACT', 'У вершины колеса контакт выходит ниже начала эвольвентной части долбяка. Его нижний переход здесь не задан; увеличьте число зубьев долбяка или измените исходные параметры. Это ограничение реализованного инструмента, а не доказательство подрезания.');
  // Global, conservative trimming exclusion: the opposite contact of the extended
  // sharp involute must be outside the COMPLETE cutter tip circle for every r>=ra.
  // This radius increases with r, so checking the interval endpoint proves the bound.
  const oppositeRadius = Math.hypot(bc, rb * tt + a * Math.sin(ag));
  if (!(oppositeRadius > rac + 1e-9 * m)) fail('INTERNAL_CUTTER_TRIMMING_DOMAIN', 'Инструмент не прошёл консервативную проверку повторного срезания боковины. Уменьшите число зубьев долбяка или измените его геометрию. Вне этой области профиль не выдаётся; это не утверждение физической невозможности изготовления.');
  // For c=cos(η), κ=(B+D*c)/(S-T*c)^(3/2). Its derivative has at most one
  // interior zero. Positive 1+ρ*κ proves radial monotonicity on BOTH corner branches,
  // not merely on the short branch drawn in the final profile.
  const B = k ** 3 * R ** 2 - a ** 2, D = a * k * R * (1 - k);
  const S = a ** 2 + k ** 2 * R ** 2, T = 2 * a * k * R;
  const curvature = (c: number) => (B + D * c) / (S - T * c) ** 1.5;
  const candidates = [-1, 1];
  if (Math.abs(D) > 1e-15 * m ** 2) { const stationary = -(2 * D * S + 3 * T * B) / (T * D); if (stationary > -1 && stationary < 1) candidates.push(stationary); }
  const offsetFactor = 1 + rho * Math.min(...candidates.map(curvature));
  if (!(offsetFactor > 1e-8)) fail('INTERNAL_CUTTER_GLOBAL_CUSP', 'Удалённая ветвь движения вершины долбяка не прошла проверку регулярности. Выберите другой инструмент.');
  const remoteRadius = Math.hypot(rb, bc * tc - a * Math.sin(ag));
  if (!(remoteRadius < ra && Math.abs(a - rac) < ra)) fail('INTERNAL_CUTTER_REMOTE_BRANCH', 'Не удалось исключить пересечение удалённой ветви инструмента с рабочим профилем.');
  const tg = (a * Math.sin(ag) + bc * tc) / rb, rj = rb * Math.hypot(1, tg);
  const phiJoin = (ag - psi) / L, phiRoot = -gamma / L, phase = PI / z;
  const half = (t: number) => s / (2 * r) - inv(alpha) + invRoll(t);
  const halfTip = half(tt), halfJoin = half(tg), rootStart = phase - phiRoot;
  if (!(tt < tg && rj < rf && halfTip > 1e-8 && halfTip < halfJoin && halfJoin < rootStart && rootStart < phase)) fail('INTERNAL_GENERATED_INTERSECTION', 'Вершина, эвольвента или переход соседних зубьев пересекаются в выбранной области долбяка.');
  // On η=Lφ+γ∈[αg−atan(H),0], R>a/k implies |C′|>0, a regular outer offset,
  // increasing radius and polar angle, and tool normals entirely within its bounded round corner.
  const vmin = k * R - a, amax = a + k * k * R, bmax = a + k ** 3 * R;
  const bound = amax + rho * (2 * bmax / vmin + 6 * amax ** 2 / vmin ** 2);
  const g: InternalCutterGeometry = {
    method: 'circular-pinion-cutter-envelope', tool: { teeth: zc, profileShift: xc, addendumCoefficient: hac, tipRadiusCoefficient: rhoC, thinning: jc, provenance: 'specified-or-assumed; not-inferred-from-photo' },
    ringTeeth: z, module: m, pitchRadius: r, baseRadius: rb, tipRadius: ra, toothThickness: s,
    cutterPitchRadius: rc, cutterBaseRadius: bc, cutterOutsideRadius: rac, toolTipRadius: rho,
    cutterCircleCenterRadius: R, cutterCircleCenter: center, cutterCircleCenterAngle: gamma, cutterFlankConstant: A,
    cutterJoinRoll: tc, cutterJoinTangentAngle: psi, generatingPressureAngleDeg: ag * 180 / PI, generatingCenterDistance: a, ratioMinusOne: k,
    phiJoin, phiRoot, phase, joinRoll: tg, joinRadius: rj, rootRadius: rf, tipRoll: tt, cutterRollAtRingTip: Math.max(0, tipToolRoll),
    oppositeContactRadiusAtRingTip: oppositeRadius, oppositeContactClearance: oppositeRadius - rac,
    minimumGlobalOffsetFactor: offsetFactor, remoteCornerMaximumRadius: remoteRadius,
    lowerToolClosure: { method: 'radial-tooth-sides-and-circular-core', coreRadius: Math.min(bc - 2 * m, .95 * (ra - a)),
      maximumNonInterferingCoreRadius: ra - a, assumption: 'mathematical-closure; actual-cutter-root-not-reconstructed' },
    halfTipAngle: halfTip, halfJoinAngle: halfJoin, rootStartAngle: rootStart,
    rootLandAngle: 2 * phiRoot, rootLand: 2 * phiRoot * rf, joinError: 0, tangentErrorDeg: 0, rootSecondDerivativeBound: bound,
  };
  const e = internalRootPoint(g, phiJoin), expected = polar(rj, halfJoin), tangent = internalRootDerivative(g, phiJoin);
  const invTangent = polar(1, s / (2 * r) - inv(alpha) + tg);
  g.joinError = Math.hypot(e.x - expected.x, e.y - expected.y);
  g.tangentErrorDeg = Math.abs(Math.atan2(cross(invTangent, tangent), dot(invTangent, tangent))) * 180 / PI;
  if (!(g.joinError <= 1e-8 * m && g.tangentErrorDeg <= 1e-7 && Number.isFinite(bound))) fail('INTERNAL_GENERATED_JOIN', 'Не удалось подтвердить аналитический стык и касательную переходной кривой.');
  return g;
}
function motion(g: InternalCutterGeometry, phi: number) {
  const a = polar(g.generatingCenterDistance, -phi), c = rotate(g.cutterCircleCenter, g.ratioMinusOne * phi), k = g.ratioMinusOne;
  return { c: { x: a.x + c.x, y: a.y + c.y }, v: { x: a.y - k * c.y, y: -a.x + k * c.x }, acc: { x: -a.x - k * k * c.x, y: -a.y - k * k * c.y } };
}
/** Fixed physical branch E=C−ρ J C′/|C′|, rotated by exactly π/z. */
export function internalRootPoint(g: InternalCutterGeometry, phi: number): Point2 {
  const { c, v } = motion(g, phi), length = norm(v);
  return rotate({ x: c.x + g.toolTipRadius * v.y / length, y: c.y - g.toolTipRadius * v.x / length }, g.phase);
}
export function internalRootDerivative(g: InternalCutterGeometry, phi: number): Point2 {
  const { v, acc } = motion(g, phi), length = norm(v);
  const factor = 1 + g.toolTipRadius * cross(v, acc) / length ** 3;
  return rotate({ x: v.x * factor, y: v.y * factor }, g.phase);
}
const pointSegmentDistance = (p: Point2, a: Point2, b: Point2) => {
  const v = { x: b.x - a.x, y: b.y - a.y }, den = dot(v, v), t = den ? Math.max(0, Math.min(1, dot({ x: p.x - a.x, y: p.y - a.y }, v) / den)) : 0;
  return Math.hypot(p.x - a.x - t * v.x, p.y - a.y - t * v.y);
};

export function generatedInternalOutline(p: GearParams, d: GearDimensions, g: InternalCutterGeometry, flankSamples: number): { outline: Point2[]; diagnostics: InternalRootDiagnostics } {
  const tolerance = p.profileTolerance ?? .002 * p.module;
  if (!(Number.isFinite(tolerance) && tolerance >= 1e-6 && tolerance <= .5 * p.module)) fail('INTERNAL_PROFILE_TOLERANCE', 'Допуск дискретизации профиля: от 0,000001 мм до половины модуля.');
  const outerRadius = d.outsideDiameter / 2, maxPerTooth = Math.min(4096, Math.floor(500_000 / (8 * p.teeth)));
  let accepted = 0, maxBound = 0, maxSampled = 0;
  const sample = (fn: (t: number) => Point2, start: number, end: number, M: number, minimum: number): Point2[] => {
    const points = [fn(start)];
    const refine = (s: number, a: Point2, e: number, b: Point2, depth: number) => {
      const angle = Math.atan2(cross(a, b), dot(a, b)), bound = Math.max((e - s) ** 2 * M / 8, outerRadius * (1 - Math.cos(angle / 2)));
      if (bound > tolerance) {
        if (depth >= 24 || accepted > maxPerTooth) fail('INTERNAL_PROFILE_BUDGET', 'Переходная кривая требует слишком много отсчётов. Ослабьте допуск или измените инструмент.');
        const mid = (s + e) / 2, q = fn(mid); refine(s, a, mid, q, depth + 1); refine(mid, q, e, b, depth + 1);
      } else {
        if (++accepted > maxPerTooth) fail('INTERNAL_PROFILE_BUDGET', 'Превышен бюджет дискретизации внутреннего зуба.');
        maxBound = Math.max(maxBound, bound);
        for (const f of [.25, .5, .75]) maxSampled = Math.max(maxSampled, pointSegmentDistance(fn(s + (e - s) * f), a, b));
        points.push(b);
      }
    };
    for (let j = 0; j < minimum; j++) { const s = start + (end - start) * j / minimum, e = start + (end - start) * (j + 1) / minimum; refine(s, fn(s), e, fn(e), 0); }
    return points;
  };
  const invAlpha = inv(p.pressureAngleDeg * PI / 180), halfBase = g.toothThickness / (2 * g.pitchRadius) - invAlpha;
  const flank = sample(t => polar(g.baseRadius * Math.hypot(1, t), halfBase + invRoll(t)), g.tipRoll, g.joinRoll, g.baseRadius * Math.hypot(1, g.joinRoll), flankSamples);
  const root = sample(phi => internalRootPoint(g, phi), g.phiJoin, g.phiRoot, g.rootSecondDerivativeBound, Math.max(4, Math.ceil(flankSamples / 2)));
  const tipArc = sample(t => polar(g.tipRadius, t), -g.halfTipAngle, g.halfTipAngle, outerRadius, Math.max(3, Math.ceil(flankSamples / 3)));
  const pitch = TAU / p.teeth, rootArc = sample(t => polar(g.rootRadius, t), g.rootStartAngle, pitch - g.rootStartAngle, outerRadius, 2);
  const sector: Point2[] = [], add = (q: Point2) => { const previous = sector.at(-1); if (!previous || Math.hypot(q.x - previous.x, q.y - previous.y) > 1e-10 * p.module) sector.push(q); };
  tipArc.forEach(add); flank.slice(1).forEach(add); root.slice(1).forEach(add); rootArc.slice(1).forEach(add);
  root.slice(0, -1).reverse().forEach(q => add(rotate({ x: q.x, y: -q.y }, pitch)));
  flank.slice(0, -1).reverse().forEach(q => add(rotate({ x: q.x, y: -q.y }, pitch)));
  sector.pop(); // next tooth owns the shared tip-arc start
  if (sector.length * p.teeth * 8 > 500_000 || sector.length * p.teeth * 4 > 250_000) fail('INTERNAL_PROFILE_BUDGET', 'Превышен бюджет сетки внутреннего колеса.');
  const outline: Point2[] = [];
  for (let tooth = 0; tooth < p.teeth; tooth++) for (const q of sector) outline.push(rotate(q, tooth * pitch));
  // Positive adjacent cross products make every cap annulus cell injective; no skipped radial loops.
  for (let j = 0; j < outline.length; j++) if (!(cross(outline[j], outline[(j + 1) % outline.length]) > 1e-12 * p.module ** 2)) fail('INTERNAL_STAR_SHAPE', 'Профиль не даёт строгого радиального контура для замкнутой сетки.');
  return { outline, diagnostics: { ...g, profileTolerance: tolerance, maxChordErrorBound: maxBound, maxSampledChordError: maxSampled,
    pointsPerTooth: sector.length, approximation: 'C2-chord-bound-and-circular-sagitta; before-Float32; not-manufacturing-tolerance' } };
}
