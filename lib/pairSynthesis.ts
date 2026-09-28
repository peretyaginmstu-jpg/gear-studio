import { involute } from './gearMath.ts';
import { analyzeGearPair, type PairReport } from './pairAnalysis.ts';
import { defaultModel, gearKernelParams, type ModelParams } from './model.ts';

/** ГОСТ 9563-60 (ISO 54): first series preferred, second series allowed. */
export const moduleSeries1 = [.5, .6, .8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
export const moduleSeries2 = [.55, .7, .9, 1.125, 1.375, 1.75, 2.25, 2.75, 3.5, 4.5, 5.5, 7, 9];

export interface SynthesisInput {
  ratio: number; centerDistanceMm: number; pressureAngleDeg?: number; helixAngleDeg?: number;
  /** Allowed relative ratio error, default 2 %. */
  ratioTolerance?: number; width?: number; backlash?: number; maxCandidates?: number;
}
export interface PairCandidate {
  module: number; series: 1 | 2; teeth: [number, number]; ratio: number; ratioErrorPct: number;
  profileShift: [number, number]; shiftSum: number; workingPressureAngleDeg: number; referenceCenterMm: number;
  gears: [ModelParams, ModelParams]; report: PairReport;
}

/**
 * Enumerates standard modules and tooth counts whose centre distance can be met by profile shift
 * (inv αw = inv αt + 2 Σx tan αn / (z1+z2)), splits Σx so the pinion avoids undercut,
 * and keeps only pairs that the existing pair check passes. Ranked: small |Σx|, small ratio error, first series.
 */
export function synthesizePairs(input: SynthesisInput): PairCandidate[] {
  const { ratio, centerDistanceMm: a } = input;
  if (!(ratio >= 1 && ratio <= 12)) throw new Error('Передаточное число — от 1 до 12 (колесо не меньше шестерни).');
  if (!(a > 2 && a <= 2000)) throw new Error('Межосевое расстояние — от 2 до 2000 мм.');
  const alpha = (input.pressureAngleDeg ?? 20) * Math.PI / 180, beta = (input.helixAngleDeg ?? 0) * Math.PI / 180;
  const at = Math.atan(Math.tan(alpha) / Math.cos(beta)), tol = input.ratioTolerance ?? .02, helical = Math.abs(beta) > 1e-9;
  const found: Omit<PairCandidate, 'report'>[] = [];
  for (const [series, list] of [[1, moduleSeries1], [2, moduleSeries2]] as const) for (const m of list) {
    const sumNominal = 2 * a * Math.cos(beta) / m;
    for (let sum = Math.max(12, Math.floor(sumNominal * .9)); sum <= Math.ceil(sumNominal * 1.12) && sum <= 500; sum++) {
      const z1 = Math.round(sum / (1 + ratio)), z2 = sum - z1;
      if (z1 < 8 || z2 > 250) continue;
      const actual = z2 / z1, error = Math.abs(actual - ratio) / ratio;
      if (error > tol) continue;
      const a0 = m * sum / (2 * Math.cos(beta)), cosAw = a0 * Math.cos(at) / a;
      if (!(cosAw > 0 && cosAw < 1)) continue;
      const aw = Math.acos(cosAw), xSum = (involute(aw) - involute(at)) * sum / (2 * Math.tan(alpha));
      if (xSum < -.5 || xSum > 1.2) continue;
      const zv = (z: number) => z / Math.cos(beta) ** 3, xmin = (z: number) => 1 - zv(z) * Math.sin(alpha) ** 2 / 2;
      let x1 = Math.max(xmin(z1), xSum * z2 / sum, xSum / 2), x2 = xSum - x1;
      if (x2 < xmin(z2)) { x2 = xmin(z2); x1 = xSum - x2; }
      if (x1 < xmin(z1) - 1e-9 || x1 > 1 || x2 < -.8 || x2 > 1) continue;
      const round = (x: number) => Math.round(x * 1e4) / 1e4;
      // Same field set as a built cylindrical model, so the pair check finds the stored mate by these parameters.
      const make = (teeth: number, x: number): ModelParams => gearKernelParams({ ...defaultModel(helical ? 'helical' : 'spur'), teeth, module: m,
        pressureAngleDeg: input.pressureAngleDeg ?? 20, helixAngleDeg: helical ? (input.helixAngleDeg ?? 0) : 0, profileShift: x,
        width: input.width ?? Math.max(4, Math.round(8 * m)), backlash: input.backlash ?? .05, bore: 0 }) as ModelParams;
      const x1r = round(x1), x2r = round(xSum - x1r);
      const second = make(z2, x2r);
      found.push({ module: m, series, teeth: [z1, z2], ratio: actual, ratioErrorPct: error * 100, profileShift: [x1r, x2r], shiftSum: round(xSum),
        workingPressureAngleDeg: aw * 180 / Math.PI, referenceCenterMm: a0,
        gears: [make(z1, x1r), helical ? { ...second, helixAngleDeg: -(input.helixAngleDeg ?? 0) } : second] });
    }
  }
  // Without load data prefer what a workshop would pick: first-series module, pinion z1 about 17–40
  // (no undercut, not needlessly fine), small total shift and ratio error.
  const score = (c: Omit<PairCandidate, 'report'>) => (c.series - 1) + Math.abs(c.shiftSum) + c.ratioErrorPct * .2
    + Math.max(0, c.teeth[0] - 40) / 20 + Math.max(0, 17 - c.teeth[0]) * .05;
  found.sort((p, q) => score(p) - score(q));
  const result: PairCandidate[] = [];
  for (const candidate of found) {
    if (result.length >= (input.maxCandidates ?? 6)) break;
    let report: PairReport;
    try { report = analyzeGearPair({ first: candidate.gears[0], second: candidate.gears[1], centerDistanceMm: a }); } catch { continue; }
    if (report.status === 'fail' || report.status === 'unsupported') continue;
    result.push({ ...candidate, report });
  }
  return result;
}
