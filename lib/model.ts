import { buildGearMesh, defaultGearParams, type GearKind, type GearMesh, type GearParams, type MeshQuality } from './gearMath.ts';
import { buildWormMesh, type WormParams, type WormMesh } from './wormGeometry.ts';
import { buildCycloidalMesh, type CycloidalParams, type CycloidalMesh } from './cycloidalGeometry.ts';
import { buildBevelMesh, type BevelParams, type BevelMesh } from './bevelGeometry.ts';
import { defaultInternalCutter } from './generatedInternalRoot.ts';

export type ModelKind = GearKind | 'worm' | 'cycloidal' | 'bevel';
export type ModelParams = Omit<GearParams, 'kind'> & {
  kind: ModelKind;
  wormStarts?: number;
  wormDiameterFactor?: number;
  wormHand?: 'right' | 'left';
  cycloidRollingRadius?: number;
  bevelMateTeeth?: number;
  bevelShaftAngleDeg?: number;
};
export type ModelMesh = GearMesh | WormMesh | CycloidalMesh | BevelMesh;
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
  bevel: 'Коническое прямозубое',
};
export const isRackKind = (kind: ModelKind) => kind === 'rack' || kind === 'helical-rack';
export const isInternalKind = (kind: ModelKind) => kind === 'internal' || kind === 'internal-helical';
export const isHelicalKind = (kind: ModelKind) => ['helical', 'herringbone', 'internal-helical', 'helical-rack'].includes(kind);

export function defaultModel(kind: ModelKind = 'spur'): ModelParams {
  return {
    ...defaultGearParams,
    kind,
    teeth: kind === 'bevel' ? 40 : kind === 'internal' ? 80 : kind === 'internal-helical' ? 48 : isRackKind(kind) ? 10 : 24,
    width: kind === 'worm' ? 32 : 10,
    helixAngleDeg: isHelicalKind(kind) ? defaultGearParams.helixAngleDeg : 0,
    wormStarts: 1,
    wormDiameterFactor: 10,
    wormHand: 'right',
    ...(kind === 'bevel' ? { bevelMateTeeth: 40, bevelShaftAngleDeg: 90 } : {}),
    ...(kind === 'internal' ? defaultInternalCutter : {}),
  };
}

export const cylindricalOnlyKeys = ['addendumCoefficient', 'clearanceCoefficient', 'keywayWidth', 'keywayDepth', 'hubDiameter', 'hubLength'] as const;

export function buildModelMesh(input: ModelParams, quality: MeshQuality = {}): ModelMesh {
  // Each independent kernel receives only its own parameters.
  const { wormStarts, wormDiameterFactor, wormHand, cycloidRollingRadius, bevelMateTeeth, bevelShaftAngleDeg } = input;
  if (input.kind === 'worm' || input.kind === 'cycloidal' || input.kind === 'bevel') {
    // Cylindrical-only extensions and the internal cutter never reach kernels with their own tooth systems.
    const shared: Record<string, unknown> = { ...gearKernelParams({ ...input, kind: 'spur' }), kind: input.kind };
    for (const key of cylindricalOnlyKeys) delete shared[key];
    if (input.kind === 'worm') return buildWormMesh({ ...shared, wormStarts, wormDiameterFactor, wormHand } as WormParams, quality);
    if (input.kind === 'cycloidal') return buildCycloidalMesh({ ...shared, cycloidRollingRadius } as CycloidalParams, quality);
    return buildBevelMesh({ ...shared, bevelMateTeeth, bevelShaftAngleDeg } as BevelParams, quality);
  }
  return buildGearMesh(gearKernelParams(input), quality);
}

/** Parameters accepted by the cylindrical involute kernel; worm, cycloid and bevel fields are removed. */
export function gearKernelParams(input: ModelParams): GearParams {
  const { wormStarts: _ws, wormDiameterFactor: _wd, wormHand: _wh, cycloidRollingRadius: _cr, bevelMateTeeth: _bm, bevelShaftAngleDeg: _bs,
    internalCutterTeeth, internalCutterProfileShift, internalCutterAddendumCoefficient, internalCutterTipRadiusCoefficient, internalCutterThinning, ...gear } = input;
  void [_ws, _wd, _wh, _cr, _bm, _bs];
  return (input.kind === 'internal' ? { ...gear, internalCutterTeeth, internalCutterProfileShift,
    internalCutterAddendumCoefficient, internalCutterTipRadiusCoefficient, internalCutterThinning } : gear) as GearParams;
}

/** Public reports use null for quantities that do not belong to that tooth system. */
export function modelDimensionsForReport(mesh: ModelMesh) {
  if (isInternalKind(mesh.params.kind)) return { ...mesh.dimensions, minimumProfileShift: null, virtualTeeth: null };
  if ('bevelDimensions' in mesh) return { ...mesh.dimensions, baseDiameter: null, basePitch: null,
    minimumProfileShift: null, virtualTeeth: null };
  if ('cycloidalDimensions' in mesh) return { ...mesh.dimensions,
    normalPressureAngleDeg: null, transversePressureAngleDeg: null, baseDiameter: null,
    basePitch: null, minimumProfileShift: null, virtualTeeth: null };
  if ('wormDimensions' in mesh) return { ...mesh.dimensions, baseDiameter: null, basePitch: null,
    minimumProfileShift: null, virtualTeeth: null };
  return mesh.dimensions;
}

/** Spatial end data belongs to the bevel report, not to a flattened profile. */
export function modelSpatialGeometryForReport(mesh: ModelMesh) {
  if ('bevelDimensions' in mesh) return { coordinateSystem: 'world-mm; large-flat-end-at-z0; pitch-axis-minus-z',
    sourceToWorld: mesh.bevelDimensions.sourceToWorld, apex: mesh.bevelDimensions.apex,
    outerEndContour: mesh.profile.outerEndContour, innerEndContour: mesh.profile.innerEndContour };
  return null;
}
