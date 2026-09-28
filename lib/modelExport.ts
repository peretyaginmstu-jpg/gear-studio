import { exportBinarySTL, validateMesh, type MeshQuality, type MeshValidation } from './gearMath.ts';
import { buildModelMesh, modelDimensionsForReport, modelSpatialGeometryForReport, type ModelMesh, type ModelParams } from './model.ts';

export type ExportPreset = 'standard' | 'pro';
export const exportPresets: Record<ExportPreset, { title: string; detail: string; quality: MeshQuality }> = {
  standard: { title: 'Standard STL', detail: 'Средняя детализация', quality: { flankSamples: 12 } },
  pro: { title: 'Pro STL + паспорт', detail: 'Высокая детализация', quality: { flankSamples: 32 } },
};
export interface ModelProvenance { origin: string; evidence: unknown }

/** Always describe the supplied mesh, including its actual tessellation/count. */
export function createModelPassport(mesh: ModelMesh, validation: MeshValidation, provenance: ModelProvenance,
  preset: ExportPreset | null = null) {
  return {
    schema: 'zatseplenie.gear.v6', appVersion: '0.16.0', units: 'mm',
    origin: provenance.origin, evidence: provenance.evidence, parameters: mesh.params,
    artifact: { purpose: preset ? 'STL-export' : 'current-preview-model', preset,
      requestedQuality: preset ? exportPresets[preset].quality : null,
      actualTessellation: mesh.tessellation, vertices: mesh.positions.length / 3, triangles: mesh.indices.length / 3,
      interpretation: 'Детализация сетки не является классом точности или проверкой изготовленной детали.' },
    dimensions: modelDimensionsForReport(mesh),
    wormDimensions: 'wormDimensions' in mesh ? mesh.wormDimensions : null,
    cycloidalDimensions: 'cycloidalDimensions' in mesh ? mesh.cycloidalDimensions : null,
    cycloidalDiagnostics: 'cycloidalDiagnostics' in mesh ? mesh.cycloidalDiagnostics : null,
    bevelDimensions: 'bevelDimensions' in mesh ? mesh.bevelDimensions : null,
    bevelDiagnostics: 'bevelDiagnostics' in mesh ? mesh.bevelDiagnostics : null,
    spatialGeometry: modelSpatialGeometryForReport(mesh), rootDiagnostics: mesh.profile.rootDiagnostics ?? null,
    internalCutterGeometry: mesh.internalCutterGeometry ?? null, internalRootDiagnostics: mesh.profile.internalRootDiagnostics ?? null,
    meshValidation: validation, warnings: mesh.warnings,
    verified: ['Аналитический профиль в заданной области', 'Топология треугольной сетки'],
    notVerified: ['Ответное колесо и контакт пары', 'Прочность и ресурс', 'Точность изготовления', 'Точное соответствие образцу по фото'],
  };
}

/** Presets only change sampling density; they never alter the analytical input. */
export function prepareModelExport(params: ModelParams, preset: ExportPreset, provenance: ModelProvenance) {
  if (!Object.hasOwn(exportPresets, preset)) throw new Error('Неизвестная детализация STL.');
  const mesh = buildModelMesh(params, exportPresets[preset].quality), validation = validateMesh(mesh);
  if (!validation.valid) throw new Error('Сетка не прошла проверку. Измените параметры перед экспортом.');
  return { mesh, validation, stl: exportBinarySTL(mesh), passport: createModelPassport(mesh, validation, provenance, preset) };
}
