import { buildGearMesh, defaultGearParams, type GearKind, type GearMesh, type GearParams, type MeshQuality } from './gearMath.ts';
import { buildWormMesh, type WormParams, type WormMesh } from './wormGeometry.ts';

export type ModelKind = GearKind | 'worm';
export type ModelParams = Omit<GearParams, 'kind'> & {
  kind: ModelKind;
  wormStarts?: number;
  wormDiameterFactor?: number;
  wormHand?: 'right' | 'left';
};
export type ModelMesh = GearMesh | WormMesh;
export const modelNames: Record<ModelKind, string> = {
  spur: 'Прямозубое колесо',
  helical: 'Косозубое колесо',
  herringbone: 'Шевронное колесо',
  internal: 'Внутреннее прямозубое',
  'internal-helical': 'Внутреннее косозубое',
  rack: 'Прямозубая рейка',
  'helical-rack': 'Косозубая рейка',
  worm: 'Червяк ZA',
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
    wormStarts: 1,
    wormDiameterFactor: 10,
    wormHand: 'right',
  };
}

export function buildModelMesh(input: ModelParams, quality: MeshQuality = {}): ModelMesh {
  if (input.kind === 'worm') return buildWormMesh(input as WormParams, quality);
  // Worm-only settings must never enter the cylindrical kernel's numeric contract.
  const { wormStarts, wormDiameterFactor, wormHand, ...gear } = input;
  return buildGearMesh(gear as GearParams, quality);
}
