import { buildGearProfile, deriveGear, involute, type GearParams } from './gearMath.ts';

/**
 * Measurement over two pins (rollers) or balls in opposite tooth spaces, KHK/ГОСТ relation:
 * external inv φ = inv αt − π/z + st/d + dp/(z mn cos αn); internal flips the three last signs.
 * Odd tooth counts use the cos(90°/z) chord. For helical gears it is exact for balls only.
 * The tooth thickness is the modelled one, so it includes the per-gear thinning.
 */
export type PinKind = 'spur' | 'helical' | 'herringbone' | 'internal' | 'internal-helical';
export const pinMeasurementKinds: readonly string[] = ['spur', 'helical', 'herringbone', 'internal', 'internal-helical'];
export interface PinGeometry {
  pinDiameterMm: number;
  /** Measurement over pins (external) or between pins (internal), mm. */
  measurementMm: number;
  /** Diameter of the pin-centre circle, mm. */
  centreDiameterMm: number;
  pressureAngleAtPinDeg: number;
  /** Radius where the pin touches the flank; spur/internal spur only, otherwise null. */
  contactDiameterMm: number | null;
  /** Contact near the reference circle with pins protruding past the tips. */
  idealPinDiameterMm: number;
  internal: boolean;
  oddTeeth: boolean;
  method: 'two-pins' | 'two-balls';
  issues: string[];
}

export function inverseInvolute(value: number): number {
  if (!(value >= 0)) throw new RangeError('inv φ must be non-negative');
  let a = Math.cbrt(3 * value);
  for (let k = 0; k < 50; k++) {
    const t = Math.tan(a), step = (t - a - value) / (t * t);
    a -= step; if (Math.abs(step) < 1e-15) break;
  }
  return a;
}

function setup(p: GearParams) {
  if (!pinMeasurementKinds.includes(p.kind)) throw new Error('Размер по роликам рассчитывается для цилиндрических эвольвентных колёс.');
  const g = deriveGear(p), d = g.dimensions, internal = p.kind === 'internal' || p.kind === 'internal-helical';
  const z = p.teeth, at = d.transversePressureAngleDeg * Math.PI / 180, an = d.normalPressureAngleDeg * Math.PI / 180;
  const K = z * d.normalModule * Math.cos(an), eta = Math.PI / z - d.transverseToothThickness / d.pitchDiameter;
  return { g, d, internal, z, at, an, K, eta, helical: Math.abs(d.transverseModule - d.normalModule) > 1e-12 };
}

/** Pin diameter whose contact lies on the reference circle. */
export function idealPinDiameter(p: GearParams): number {
  const { internal, at, K, eta } = setup(p);
  return internal ? K * (Math.tan(at) - Math.tan(at - eta)) : K * (Math.tan(at + eta) - Math.tan(at));
}

/**
 * Contact on the reference circle, enlarged when needed so the pins protrude past the tips by 0.05 m
 * (positive shift raises the tips). Round to an available pin and recheck the warnings.
 */
export function recommendedPinDiameter(p: GearParams): number {
  const { d, internal } = setup(p), ideal = idealPinDiameter(p), margin = .05 * d.normalModule;
  const protrusion = (dp: number) => { const r = centreDiameter(p, dp); return internal ? d.tipDiameter - (r - dp) : r + dp - d.tipDiameter; };
  if (protrusion(ideal) >= margin) return ideal;
  let lo = ideal, hi = ideal;
  for (let k = 0; k < 60 && protrusion(hi) < margin; k++) { lo = hi; hi *= 1.1; }
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (protrusion(mid) < margin) lo = mid; else hi = mid; }
  return hi;
}

function centreDiameter(p: GearParams, dp: number): number {
  const { d, internal, at, K, eta } = setup(p);
  const invPhi = internal ? involute(at) + eta - dp / K : involute(at) - eta + dp / K;
  return invPhi > 0 ? d.baseDiameter / Math.cos(inverseInvolute(invPhi)) : NaN;
}

export function pinMeasurement(p: GearParams, pinDiameterMm: number): PinGeometry {
  const { d, internal, z, at, K, eta, helical } = setup(p);
  if (!(pinDiameterMm > 0 && Number.isFinite(pinDiameterMm))) throw new Error('Диаметр ролика должен быть положительным.');
  const invPhi = internal ? involute(at) + eta - pinDiameterMm / K : involute(at) - eta + pinDiameterMm / K;
  const issues: string[] = [];
  if (!(invPhi > 0)) throw new Error(internal ? 'Ролик слишком велик для впадины внутреннего колеса.' : 'Ролик слишком мал: он не касается боковых сторон впадины.');
  const phi = inverseInvolute(invPhi), db = d.baseDiameter, d0 = db / Math.cos(phi), odd = z % 2 === 1;
  const chord = odd ? d0 * Math.cos(Math.PI / (2 * z)) : d0;
  const measurementMm = internal ? chord - pinDiameterMm : chord + pinDiameterMm;
  let contactDiameterMm: number | null = null;
  if (!helical) {
    const tangent = db / 2 * Math.tan(phi) + (internal ? 1 : -1) * pinDiameterMm / 2;
    contactDiameterMm = 2 * Math.hypot(db / 2, tangent);
    const low = internal ? d.tipDiameter : 2 * (buildGearProfile(p, 8).rootDiagnostics?.joinRadius ?? d.baseDiameter / 2);
    if (!internal && (tangent <= 0 || contactDiameterMm < Math.max(low, d.baseDiameter)))
      issues.push('Ролик касается ниже рабочей эвольвенты — у переходной кривой. Возьмите ролик большего диаметра.');
    if (!internal && contactDiameterMm > d.tipDiameter) issues.push('Ролик касается выше вершины зуба. Возьмите ролик меньшего диаметра.');
    if (internal && contactDiameterMm < low) issues.push('Ролик касается за вершиной внутреннего зуба. Возьмите ролик большего диаметра.');
    if (internal && contactDiameterMm > d.rootDiameter) issues.push('Ролик касается у впадины внутреннего колеса. Возьмите ролик меньшего диаметра.');
  }
  if (!internal && d0 + pinDiameterMm <= d.tipDiameter)
    issues.push('Ролики не выступают за вершины зубьев: микрометр упрётся в зубья.');
  if (internal && d0 - pinDiameterMm >= d.tipDiameter)
    issues.push('Ролики утоплены за вершины внутренних зубьев: измерение между ними недоступно.');
  if (helical) issues.push('Для косозубого колеса формула точна для шариков; цилиндрические ролики дают другой размер.');
  return { pinDiameterMm, measurementMm, centreDiameterMm: d0, pressureAngleAtPinDeg: phi * 180 / Math.PI,
    contactDiameterMm, idealPinDiameterMm: recommendedPinDiameter(p), internal, oddTeeth: odd, method: helical ? 'two-balls' : 'two-pins', issues };
}

export interface PinInverse {
  /** Normal tooth thickness at the reference circle implied by the reading, mm. */
  normalToothThicknessMm: number;
  /** Profile shift that gives this thickness with zero thinning. */
  equivalentProfileShift: number;
  /** Thinning relative to the current x, mm (negative: tooth is thicker than nominal). */
  thinningAtCurrentShiftMm: number;
}

/** Solves the tooth thickness from a measured M; x and thinning are not separable from M alone. */
export function inversePinMeasurement(p: GearParams, pinDiameterMm: number, measuredMm: number): PinInverse {
  const { d, internal, z, at, an, K } = setup(p);
  if (!(measuredMm > 0 && pinDiameterMm > 0)) throw new Error('Введите положительные размеры M и dp.');
  const chord = internal ? measuredMm + pinDiameterMm : measuredMm - pinDiameterMm;
  const d0 = z % 2 ? chord / Math.cos(Math.PI / (2 * z)) : chord;
  if (!(d0 > d.baseDiameter)) throw new Error('Размер M несовместим с основной окружностью колеса: проверьте z, модуль, угол и dp.');
  const invPhi = involute(Math.acos(d.baseDiameter / d0));
  const stOverD = internal ? involute(at) + Math.PI / z - pinDiameterMm / K - invPhi : invPhi - involute(at) + Math.PI / z - pinDiameterMm / K;
  const st = stOverD * d.pitchDiameter, sn = st * d.normalModule / d.transverseModule, mn = d.normalModule;
  const sign = internal ? -1 : 1;
  const equivalentProfileShift = sign * (sn - mn * Math.PI / 2) / (2 * mn * Math.tan(an));
  const nominal = mn * (Math.PI / 2 + sign * 2 * p.profileShift * Math.tan(an));
  return { normalToothThicknessMm: sn, equivalentProfileShift, thinningAtCurrentShiftMm: nominal - sn };
}
