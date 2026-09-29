import { deriveGear } from './gearMath.ts';
import { gearKernelParams, type ModelKind, type ModelParams } from './model.ts';
import { moduleSeries1 } from './pairSynthesis.ts';

/** GOST 9563 series 2 — used only when it fits the measured diameter clearly better than series 1. */
export const moduleSeries2 = [.7, .9, 1.125, 1.375, 1.75, 2.25, 2.75, 3.5, 4.5, 5.5, 7, 9];
const kinds: ModelKind[] = ['spur', 'helical', 'herringbone', 'internal', 'internal-helical'];
export const supportsDiameterHelper = (kind: ModelKind) => kinds.includes(kind);

/** Tip diameter of these parameters with another module; the bore and body features do not affect it. */
export function tipDiameterFor(params: ModelParams, module: number): number | null {
  if (!supportsDiameterHelper(params.kind) || !(module > 0)) return null;
  try {
    const { dimensions } = deriveGear(gearKernelParams({ ...params, module, bore: 0, keywayWidth: undefined, keywayDepth: undefined, hubDiameter: undefined, hubLength: undefined }));
    return dimensions.tipDiameter > 0 ? dimensions.tipDiameter : null;
  } catch { return null; }
}

export interface ModuleSuggestion { module: number; tipDiameter: number; exactModule: number; deviationMm: number; series: 1 | 2 }

/**
 * Standard module whose tip diameter is closest to the measured one, keeping teeth, helix angle and shift.
 * Tip diameter is linear in the module for a fixed tooth system, so the exact module is a simple ratio.
 */
export function moduleForTipDiameter(params: ModelParams, measured: number): ModuleSuggestion | null {
  if (!(measured > 0) || !Number.isFinite(measured)) return null;
  const unit = tipDiameterFor(params, 1);
  if (!unit) return null;
  const exactModule = measured / unit;
  const pick = (series: number[], n: 1 | 2) => series.map(module => ({ module, series: n, tipDiameter: tipDiameterFor(params, module) }))
    .filter((c): c is { module: number; series: 1 | 2; tipDiameter: number } => c.tipDiameter !== null)
    .sort((a, b) => Math.abs(a.tipDiameter - measured) - Math.abs(b.tipDiameter - measured))[0];
  const first = pick(moduleSeries1, 1), second = pick(moduleSeries2, 2);
  if (!first && !second) return null;
  // Series 1 is preferred unless series 2 is at least twice as close.
  const best = !second || (first && Math.abs(first.tipDiameter - measured) <= 2 * Math.abs(second.tipDiameter - measured)) ? first! : second;
  return { module: best.module, tipDiameter: best.tipDiameter, exactModule, deviationMm: best.tipDiameter - measured, series: best.series };
}
