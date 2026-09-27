import { buildGearMesh, defaultGearParams, type GearKind, type GearMesh, type GearParams, type MeshQuality } from './gearMath.ts';
import { buildWormMesh, type WormParams, type WormMesh } from './wormGeometry.ts';
import { buildCycloidalMesh, type CycloidalParams, type CycloidalMesh } from './cycloidalGeometry.ts';

export type ModelKind = GearKind | 'worm' | 'cycloidal';
export type ModelParams = Omit<GearParams, 'kind'> & {
  kind: ModelKind;
  wormStarts?: number;
  wormDiameterFactor?: number;
  wormHand?: 'right' | 'left';
  cycloidRollingRadius?: number;
};
export type ModelMesh = GearMesh | WormMesh | CycloidalMesh;
export const modelNames: Record<ModelKind, string> = {
  spur: 'Прямозубое колесо',
  helical: 'Косозубое колесо',
  herringbone: 'Шевронное колесо',
  internal: 'Внутреннее прямозубое',
  'internal-helical': 'Внутреннее косозубое',
  rack: 'Прямозубая рейка',
  'helical-rack': 'Косозубая рейка',
  worm: 'Червяк ZA',
  cycloidal: 'Циклоидальное колесо',
};
export const isRackKind = (kind: ModelKind) => kind === 'rack' || kind === 'helical-rack';
export const isInternalKind = (kind: ModelKind) => kind === 'internal' || kind === 'internal-helical';
export const isHelicalKind = (kind: ModelKind) => ['helical', 'herringbone', 'internal-helical', 'helical-rack'].includes(kind);

export function defaultModel(kind: ModelKind = 'spur'): ModelParams {
  return {
    ...defaultGearParams,
    kind,
    teeth: isInternalKind(kind) ? 48 : isRackKind(kind) ? 10 : 24,
    width: kind === 'worm' ? 32 : 10,
    helixAngleDeg: kind === 'cycloidal' ? 0 : defaultGearParams.helixAngleDeg,
    wormStarts: 1,
    wormDiameterFactor: 10,
    wormHand: 'right',
  };
}

export function buildModelMesh(input: ModelParams, quality: MeshQuality = {}): ModelMesh {
  // Each independent kernel receives only its own parameters.
  const { wormStarts, wormDiameterFactor, wormHand, cycloidRollingRadius, ...gear } = input;
  if (input.kind === 'worm') return buildWormMesh({ ...gear, wormStarts, wormDiameterFactor, wormHand } as WormParams, quality);
  if (input.kind === 'cycloidal') return buildCycloidalMesh({ ...gear, cycloidRollingRadius } as CycloidalParams, quality);
  return buildGearMesh(gear as GearParams, quality);
}

/** Public reports use null for quantities that do not belong to that tooth system. */
export function modelDimensionsForReport(mesh: ModelMesh) {
  if ('cycloidalDimensions' in mesh) return { ...mesh.dimensions,
    normalPressureAngleDeg: null, transversePressureAngleDeg: null, baseDiameter: null,
    basePitch: null, minimumProfileShift: null, virtualTeeth: null };
  if ('wormDimensions' in mesh) return { ...mesh.dimensions, baseDiameter: null, basePitch: null,
    minimumProfileShift: null, virtualTeeth: null };
  return mesh.dimensions;
}
