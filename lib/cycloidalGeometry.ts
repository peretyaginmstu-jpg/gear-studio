import { GearGeometryError } from './gearMath.ts';
import type { GearDerived, GearDimensions, GearMesh, GearParams, GearProfile, MeshQuality, Point2 } from './gearMath.ts';

/**
 * External cylindrical cycloidal teeth, in millimetres. The face is an
 * epicycloid and the flank below the reference circle is a hypocycloid.
 * Analytic definitions: Wolfram MathWorld, Epicycloid equations (1–2),
 * Hypocycloid equations (7–8):
 * https://mathworld.wolfram.com/Epicycloid.html
 * https://mathworld.wolfram.com/Hypocycloid.html
 * The independent FreeCAD Gears implementation also distinguishes the two
 * generating circles and reference-circle tooth thinning:
 * https://github.com/looooo/freecad.gears/blob/master/pygears/cycloid_tooth.py
 * Here ONE explicitly selected circle generates both portions. This is not
 * a cycloidal pin reducer, an involute, or a certification of a mating pair.
 */
export type CycloidalParams = Omit<GearParams, 'kind'> & {
  kind: 'cycloidal';
  /** Generating-circle radius in mm. Default min(2 m, R/2); not inferred from z. */
  cycloidRollingRadius?: number;
};
export interface CycloidalDimensions {
  profile: 'epicycloid-hypocycloid';
  referenceModule: number;
  pitchRadius: number;
  rollingRadius: number;
  /** Explicitly selected tooth-height system, not a universal cycloidal standard. */
  toothSystem: 'ha=m; hf=1.25m';
  addendumCoefficient: 1;
  dedendumCoefficient: 1.25;
  referenceToothThickness: number;
  tipArcThickness: number;
  rootSpaceArcWidth: number;
  /** Angles of the generating-circle centre, not polar angles of curve points. */
  addendumRollAngleRad: number;
  dedendumRollAngleRad: number;
  constantPressureAngleDeg: null;
  baseCircleDiameter: null;
  basePitch: null;
}
export interface CycloidalDiagnostics {
  profileTolerance: number;
  /** Analytic interpolation bound for each sampled 2D curve segment. */
  maxChordErrorBound: number;
  maxSampledChordError: number;
  /** Float32 coordinates and STL are not included in the 2D bound. */
  toleranceScope: 'analytic-2d-profile-before-float32';
  outerPointsPerTooth: number;
  borePointsPerTooth: number;
  radialDedendum: boolean;
}
export interface CycloidalDerived extends Omit<GearDerived, 'params'> {
  params: CycloidalParams;
  cycloidalDimensions: CycloidalDimensions;
}
export interface CycloidalProfile extends Omit<GearProfile, 'params'> {
  params: CycloidalParams;
  cycloidalDimensions: CycloidalDimensions;
  cycloidalDiagnostics: CycloidalDiagnostics;
}
export interface CycloidalMesh extends Omit<GearMesh, 'params' | 'profile'> {
  params: CycloidalParams;
  profile: CycloidalProfile;
  cycloidalDimensions: CycloidalDimensions;
  cycloidalDiagnostics: CycloidalDiagnostics;
}
const PI = Math.PI, TAU = 2 * PI;
const fail = (code: string, message: string): never => { throw new GearGeometryError(code, message); };
const polar = (r: number, a: number): Point2 => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
const rotate = (p: Point2, a: number): Point2 => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
type Curve = 'epi' | 'hypo';

function roulette(R: number, r: number, t: number, curve: Curve): Point2 {
  if (curve === 'epi') {
    const A = R + r, k = A / r;
    return { x: A * Math.cos(t) - r * Math.cos(k * t), y: A * Math.sin(t) - r * Math.sin(k * t) };
  }
  // Exact straight-line special case; avoid cancellation in its zero y value.
  if (r === R / 2) return { x: R * Math.cos(t), y: 0 };
  const A = R - r, k = A / r;
  return { x: A * Math.cos(t) + r * Math.cos(k * t), y: A * Math.sin(t) - r * Math.sin(k * t) };
}

export function deriveCycloidal(input: CycloidalParams): CycloidalDerived {
  const p: CycloidalParams = { ...input };
  if (p.kind !== 'cycloidal') fail('CYCLOIDAL_KIND', 'Циклоидальное ядро строит только внешнее цилиндрическое колесо.');
  for (const key of ['teeth', 'module', 'pressureAngleDeg', 'helixAngleDeg', 'width', 'bore', 'profileShift', 'backlash'] as const) {
    if (typeof p[key] !== 'number' || !Number.isFinite(p[key])) fail('NON_FINITE', `Параметр ${key} должен быть конечным числом.`);
  }
  if (!Number.isInteger(p.teeth) || p.teeth < 6 || p.teeth > 250) fail('TEETH_RANGE', 'Число зубьев должно быть целым от 6 до 250.');
  if (p.module < 0.1 || p.module > 30) fail('MODULE_RANGE', 'Делительный модуль должен быть от 0,1 до 30 мм.');
  if (p.width < 0.01 || p.width > 500) fail('WIDTH_RANGE', 'Ширина должна быть от 0,01 до 500 мм.');
  if (p.profileShift !== 0) fail('CYCLOIDAL_PROFILE_SHIFT', 'Смещение циклоидального профиля не реализовано; задайте x = 0.');
  if (p.helixAngleDeg !== 0) fail('CYCLOIDAL_HELIX', 'Это прямозубое циклоидальное колесо; задайте β = 0.');
  if (p.backlash < 0) fail('BACKLASH_RANGE', 'Утонение зуба по делительной окружности не может быть отрицательным.');
  if (p.bore < 0 || (p.bore > 0 && p.bore < 0.02 * p.module)) fail('BORE_RANGE', 'Отверстие: 0 либо диаметр не меньше 0,02 модуля.');
  if (p.profileTolerance !== undefined && (!Number.isFinite(p.profileTolerance) || p.profileTolerance < 1e-6 || p.profileTolerance > 0.5 * p.module))
    fail('PROFILE_TOLERANCE', 'Допуск дискретизации должен быть от 0,000001 мм до половины модуля.');
  const m = p.module, R = m * p.teeth / 2, ha = m, hf = 1.25 * m, ra = R + ha, rf = R - hf;
  const r = p.cycloidRollingRadius === undefined ? Math.min(2 * m, R / 2) : p.cycloidRollingRadius;
  if (typeof r !== 'number' || !Number.isFinite(r)) fail('NON_FINITE', 'Радиус производящей окружности должен быть конечным числом.');
  if (!(r > 0 && r <= R / 2)) fail('CYCLOIDAL_ROLLING_RADIUS', 'Радиус производящей окружности должен быть больше 0 и не больше половины делительного радиуса R.');
  p.cycloidRollingRadius = r;
  if (2 * r < hf - 1e-12 * m) fail('CYCLOIDAL_ROOT_UNREACHABLE', 'Гипоциклоида не достигает выбранной глубины впадины; увеличьте производящую окружность.');
  if (p.bore / 2 >= rf - 0.02 * m) fail('BORE_INTERSECTION', 'Отверстие пересекает основание зубьев или оставляет слишком тонкую стенку.');
  const pitch = TAU / p.teeth, thickness = PI * m / 2 - p.backlash, half = thickness / (2 * R);
  if (thickness < 0.02 * m) fail('TOOTH_THICKNESS', 'Утонение даёт недопустимую толщину зуба по делительной окружности.');
  // Stable inversion of rho² = R² ± 2 r (R ± r) (1 - cos(R t/r)).
  const epiSine2 = (2 * R * ha + ha * ha) / (4 * r * (R + r));
  const hypoSine2 = (2 * R * hf - hf * hf) / (4 * r * (R - r));
  if (epiSine2 > 1 + 1e-12 || hypoSine2 > 1 + 1e-12) fail('CYCLOIDAL_BRANCH', 'Высота зуба выходит за первую монотонную ветвь циклоиды.');
  const ta = 2 * r / R * Math.asin(Math.sqrt(Math.min(1, epiSine2)));
  const tf = 2 * r / R * Math.asin(Math.sqrt(Math.min(1, hypoSine2)));
  const a = roulette(R, r, ta, 'epi'), f = roulette(R, r, tf, 'hypo');
  const halfTip = half - Math.atan2(a.y, a.x), halfRoot = half + Math.atan2(f.y, f.x);
  const tip = 2 * ra * halfTip, rootSpace = rf * (pitch - 2 * halfRoot);
  if (!(tip >= 0.02 * m)) fail('CYCLOIDAL_POINTED_TOOTH', 'Эпициклоидальные боковины пересекаются у вершины; измените производящий радиус или утонение.');
  if (!(rootSpace >= 0.02 * m)) fail('CYCLOIDAL_ROOT_OVERLAP', 'Гипоциклоидальные ножки соседних зубьев пересекаются; измените производящий радиус или утонение.');
  // Compatibility numbers only: zero means N/A for involute-only fields.
  // The explicit null values in cycloidalDimensions must be used in reports.
  const dimensions: GearDimensions = {
    normalModule: m, transverseModule: m, normalPressureAngleDeg: 0, transversePressureAngleDeg: 0,
    pitchDiameter: 2 * R, baseDiameter: 0, tipDiameter: 2 * ra, rootDiameter: 2 * rf, outsideDiameter: 2 * ra,
    normalCircularPitch: PI * m, transverseCircularPitch: PI * m, basePitch: 0,
    normalToothThickness: thickness, transverseToothThickness: thickness, tipThickness: tip,
    addendum: ha, dedendum: hf, width: p.width, minimumProfileShift: 0, virtualTeeth: p.teeth,
    twistAngleDeg: 0, rackLength: 0, rackHeight: 0, rackAxialOffset: 0,
  };
  return { params: p, dimensions,
    cycloidalDimensions: { profile: 'epicycloid-hypocycloid', referenceModule: m, pitchRadius: R,
      rollingRadius: r, toothSystem: 'ha=m; hf=1.25m', addendumCoefficient: 1, dedendumCoefficient: 1.25,
      referenceToothThickness: thickness, tipArcThickness: tip, rootSpaceArcWidth: rootSpace,
      addendumRollAngleRad: ta, dedendumRollAngleRad: tf, constantPressureAngleDeg: null,
      baseCircleDiameter: null, basePitch: null },
    warnings: [
      { code: 'CYCLOIDAL_ANALYTIC', severity: 'info', message: 'Головка зуба — эпициклоида, ножка — гипоциклоида. Обе построены одной явно заданной производящей окружностью.' },
      { code: 'CYCLOIDAL_TOOTH_SYSTEM', severity: 'info', message: 'Принята система высот ha = m, hf = 1,25m. Это выбранный исходный профиль, не универсальный стандарт циклоидальных колёс; переходы к окружностям вершин и впадин без галтели.' },
      { code: 'CYCLOIDAL_NOT_INVOLUTE', severity: 'info', message: 'Постоянный угол давления, эвольвентная основная окружность и основной шаг неприменимы. Поле α не участвует в расчёте.' },
      { code: 'CYCLOIDAL_PAIR_REQUIRED', severity: 'warning', message: 'Для сопряжённого колеса нужны согласованные производящие окружности и высоты зубьев; совпадения m и z недостаточно. Контакт, интерференция, зазор и несущая способность пары не проверены.' },
      { code: 'CYCLOIDAL_TOLERANCE_SCOPE', severity: 'info', message: 'Допуск относится к дискретизации аналитического плоского контура до преобразования в Float32; это не сертифицированная пространственная точность STL.' },
      ...(p.backlash > 0 ? [{ code: 'CYCLOIDAL_THINNING', severity: 'info' as const, message: `Толщина одного зуба уменьшена по делительной окружности на ${p.backlash.toFixed(3)} мм; это не рассчитанный зазор пары.` }] : []),
    ],
  };
}

interface Sampling { tolerance: number; maxBound: number; maxSampled: number }
function distanceToSegment(v: Point2, a: Point2, b: Point2): number {
  const x = b.x - a.x, y = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((v.x - a.x) * x + (v.y - a.y) * y) / (x * x + y * y)));
  return Math.hypot(v.x - a.x - t * x, v.y - a.y - t * y);
}
function sampleRoulette(R: number, r: number, end: number, curve: Curve, seeds: number, state: Sampling): Point2[] {
  if (curve === 'hypo' && r === R / 2) return [roulette(R, r, 0, curve), roulette(R, r, end, curve)];
  const points: Point2[] = [roulette(R, r, 0, curve)];
  // |f''| is increasing on the first epi branch and decreasing on the first
  // hypo branch. Its endpoint maximum bounds linear interpolation by M h²/8.
  const secondDerivativeNorm = (t: number) => {
    const A = curve === 'epi' ? R + r : R - r, k = A / r;
    const x = -A * Math.cos(t) + (curve === 'epi' ? 1 : -1) * r * k * k * Math.cos(k * t);
    const y = -A * Math.sin(t) + r * k * k * Math.sin(k * t);
    return Math.hypot(x, y);
  };
  const addSpan = (t0: number, t1: number, depth: number) => {
    const a = roulette(R, r, t0, curve), b = roulette(R, r, t1, curve);
    const bound = secondDerivativeNorm(curve === 'epi' ? t1 : t0) * (t1 - t0) ** 2 / 8;
    if (bound > state.tolerance) {
      if (depth >= 24 || points.length >= 4096) fail('MESH_BUDGET', 'Допуск циклоидального контура превышает бюджет дискретизации браузера.');
      const mid = (t0 + t1) / 2; addSpan(t0, mid, depth + 1); addSpan(mid, t1, depth + 1); return;
    }
    state.maxBound = Math.max(state.maxBound, bound);
    for (const fraction of [0.25, 0.5, 0.75]) state.maxSampled = Math.max(state.maxSampled,
      distanceToSegment(roulette(R, r, t0 + (t1 - t0) * fraction, curve), a, b));
    points.push(b);
  };
  for (let i = 0; i < seeds; i++) addSpan(end * i / seeds, end * (i + 1) / seeds, 0);
  return points;
}
function sampleArc(radius: number, start: number, end: number, state: Sampling): Point2[] {
  const maxStep = Math.min(PI / 12, 4 * Math.asin(Math.sqrt(Math.min(1, state.tolerance / (2 * radius)))));
  const segments = Math.max(1, Math.ceil((end - start) / maxStep));
  if (segments > 4096) fail('MESH_BUDGET', 'Слишком много отсчётов окружности для браузера.');
  const bound = 2 * radius * Math.sin((end - start) / (4 * segments)) ** 2;
  state.maxBound = Math.max(state.maxBound, bound); state.maxSampled = Math.max(state.maxSampled, bound);
  return Array.from({ length: segments + 1 }, (_, j) => polar(radius, start + (end - start) * j / segments));
}

/** Ear-clip a single tooth sector, then replicate its cap. This handles radial
 * hypocycloids without zero-area radial fans or duplicated bore vertices. */
function triangulateSector(points: Point2[], scale: number): number[] {
  const cross = (a: Point2, b: Point2, c: Point2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const tolerance = 1e-14 * scale * scale, polygon = points.map((_, i) => i), faces: number[] = [];
  while (polygon.length > 3) {
    let found = false;
    for (let k = 0; k < polygon.length; k++) {
      const a = polygon[(k + polygon.length - 1) % polygon.length], b = polygon[k], c = polygon[(k + 1) % polygon.length];
      if (cross(points[a], points[b], points[c]) <= tolerance) continue;
      let inside = false;
      for (const id of polygon) {
        if (id === a || id === b || id === c) continue;
        const v = points[id];
        if (cross(points[a], points[b], v) >= -tolerance && cross(points[b], points[c], v) >= -tolerance && cross(points[c], points[a], v) >= -tolerance) { inside = true; break; }
      }
      if (!inside) { faces.push(a, b, c); polygon.splice(k, 1); found = true; break; }
    }
    if (!found) fail('CYCLOIDAL_TRIANGULATION', 'Не удалось триангулировать циклоидальный сектор без вырожденных граней.');
  }
  if (cross(points[polygon[0]], points[polygon[1]], points[polygon[2]]) <= tolerance)
    fail('CYCLOIDAL_TRIANGULATION', 'Вырожденный заключительный треугольник циклоидального сектора.');
  faces.push(...polygon); return faces;
}

/** Closed capped straight extrusion. No third-party geometry dependency. */
export function buildCycloidalMesh(input: CycloidalParams, quality: MeshQuality = {}): CycloidalMesh {
  const derived = deriveCycloidal(input), p = derived.params, c = derived.cycloidalDimensions, d = derived.dimensions;
  for (const value of [quality.flankSamples, quality.axialSegments]) {
    if (value !== undefined && (!Number.isFinite(value) || !Number.isInteger(value) || value < 1)) fail('QUALITY_RANGE', 'Число отсчётов должно быть целым положительным числом.');
  }
  if ((quality.flankSamples ?? 12) > 64 || (quality.axialSegments ?? 1) > 256) fail('MESH_BUDGET', 'Число отсчётов превышает бюджет браузера.');
  const flankSamples = Math.max(5, quality.flankSamples ?? 12), axialSegments = quality.axialSegments ?? 1;
  const state: Sampling = { tolerance: p.profileTolerance ?? p.module * 0.002, maxBound: 0, maxSampled: 0 };
  const R = c.pitchRadius, r = c.rollingRadius, ra = d.tipDiameter / 2, rf = d.rootDiameter / 2, pitch = TAU / p.teeth;
  const half = c.referenceToothThickness / (2 * R), halfTip = c.tipArcThickness / (2 * ra), halfRoot = (pitch - c.rootSpaceArcWidth / rf) / 2;
  const epi = sampleRoulette(R, r, c.addendumRollAngleRad, 'epi', flankSamples, state);
  const hypo = sampleRoulette(R, r, c.dedendumRollAngleRad, 'hypo', flankSamples, state);
  const sector: Point2[] = [];
  const append = (points: Point2[]) => { for (const v of points) { const last = sector.at(-1); if (!last || Math.hypot(v.x - last.x, v.y - last.y) > 1e-10 * p.module) sector.push(v); } };
  append(sampleArc(rf, -pitch / 2, -halfRoot, state));
  append(hypo.toReversed().map(v => rotate({ x: v.x, y: -v.y }, -half)));
  append(epi.map(v => rotate(v, -half)));
  append(sampleArc(ra, -halfTip, halfTip, state));
  append(epi.toReversed().map(v => rotate({ x: v.x, y: -v.y }, half)));
  append(hypo.map(v => rotate(v, half)));
  append(sampleArc(rf, halfRoot, pitch / 2, state));
  const boreSector = p.bore > 0 ? sampleArc(p.bore / 2, -pitch / 2, pitch / 2, state) : null;
  const n = sector.length - 1, h = boreSector ? boreSector.length - 1 : 0;
  if (n + h > 4096) fail('MESH_BUDGET', 'Слишком плотная дискретизация одного зуба для браузера.');
  const count = n * p.teeth, holeCount = h * p.teeth, ringSize = count + holeCount;
  const vertices = (axialSegments + 1) * ringSize + (boreSector ? 0 : 2);
  const capTriangles = (n + h) * p.teeth;
  const triangles = 2 * axialSegments * ringSize + 2 * capTriangles;
  if (vertices > 250_000 || triangles > 500_000) fail('MESH_BUDGET', 'Циклоидальная сетка превышает бюджет браузера; уменьшите число зубьев или плотность сетки.');
  const capPoints = [...sector, ...(boreSector ? boreSector.toReversed() : [{ x: 0, y: 0 }])];
  const cap = triangulateSector(capPoints, p.module);
  const outer: Point2[] = [], hole: Point2[] | null = boreSector ? [] : null;
  for (let tooth = 0; tooth < p.teeth; tooth++) {
    for (let j = 0; j < n; j++) outer.push(rotate(sector[j], tooth * pitch));
    if (boreSector && hole) for (let j = 0; j < h; j++) hole.push(rotate(boreSector[j], tooth * pitch));
  }
  const positions = new Float32Array(vertices * 3), indices = new Uint32Array(triangles * 3);
  let vi = 0, fi = 0;
  const vertex = (x: number, y: number, z: number) => { const id = vi / 3; positions[vi++] = x; positions[vi++] = y; positions[vi++] = z; return id; };
  const face = (a: number, b: number, c: number) => { indices[fi++] = a; indices[fi++] = b; indices[fi++] = c; };
  for (let layer = 0; layer <= axialSegments; layer++) {
    const z = p.width * (layer / axialSegments - 0.5);
    for (const loop of [outer, ...(hole ? [hole] : [])]) for (const v of loop) vertex(v.x, v.y, z);
  }
  for (let layer = 0; layer < axialSegments; layer++) {
    const low = layer * ringSize, high = low + ringSize;
    for (let j = 0; j < count; j++) { const next = (j + 1) % count;
      face(low + j, low + next, high + next); face(low + j, high + next, high + j); }
    for (let j = 0; j < holeCount; j++) { const next = (j + 1) % holeCount;
      face(low + count + j, high + count + next, low + count + next); face(low + count + j, high + count + j, high + count + next); }
  }
  const bottomCentre = boreSector ? -1 : vertex(0, 0, -p.width / 2), topCentre = boreSector ? -1 : vertex(0, 0, p.width / 2);
  for (let tooth = 0; tooth < p.teeth; tooth++) {
    const id = (local: number, top: boolean) => {
      const offset = top ? axialSegments * ringSize : 0;
      if (local <= n) return offset + (tooth * n + local) % count;
      if (boreSector) return offset + count + (tooth * h + h - (local - n - 1)) % holeCount;
      return top ? topCentre : bottomCentre;
    };
    for (let j = 0; j < cap.length; j += 3) {
      face(id(cap[j], true), id(cap[j + 1], true), id(cap[j + 2], true));
      face(id(cap[j], false), id(cap[j + 2], false), id(cap[j + 1], false));
    }
  }
  // No collapsing or replacement curve: reject if Float32 cannot retain a face.
  for (let j = 0; j < indices.length; j += 3) {
    const a = indices[j] * 3, b = indices[j + 1] * 3, c = indices[j + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) <= 1e-11)
      fail('CYCLOIDAL_FLOAT_PRECISION', 'Float32 не сохраняет отдельные грани этого профиля; уменьшите плотность дискретизации или измените масштаб.');
  }
  const diagnostics: CycloidalDiagnostics = { profileTolerance: state.tolerance, maxChordErrorBound: state.maxBound,
    maxSampledChordError: state.maxSampled, toleranceScope: 'analytic-2d-profile-before-float32',
    outerPointsPerTooth: n, borePointsPerTooth: h, radialDedendum: r === R / 2 };
  const profile: CycloidalProfile = { ...derived, outer, hole, cycloidalDiagnostics: diagnostics };
  return { ...derived, positions, indices, profile, cycloidalDiagnostics: diagnostics, tessellation: { flankSamples, axialSegments } };
}
