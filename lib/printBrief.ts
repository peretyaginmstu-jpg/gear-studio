import type { MeshValidation } from './gearMath.ts';
import { modelDimensionsForReport, modelSpatialGeometryForReport, type ModelMesh } from './model.ts';
import type { ModelProvenance } from './modelExport.ts';
import { assessPrint, type PrintSettings } from './printability.ts';

/** A local preparation file, with the same captured provenance as the model's STL passport. */
export function createPrintBrief(mesh: ModelMesh, validation: MeshValidation, settings: PrintSettings,
  provenance: ModelProvenance, createdAt = new Date().toISOString()) {
  return {
    schema: 'zatseplenie.print-brief.v6', appVersion: '0.17.0', createdAt, units: 'mm',
    origin: provenance.origin, evidence: structuredClone(provenance.evidence), parameters: mesh.params,
    dimensions: modelDimensionsForReport(mesh),
    wormDimensions: 'wormDimensions' in mesh ? mesh.wormDimensions : null,
    cycloidalDimensions: 'cycloidalDimensions' in mesh ? mesh.cycloidalDimensions : null,
    cycloidalDiagnostics: 'cycloidalDiagnostics' in mesh ? mesh.cycloidalDiagnostics : null,
    bevelDimensions: 'bevelDimensions' in mesh ? mesh.bevelDimensions : null,
    bevelDiagnostics: 'bevelDiagnostics' in mesh ? mesh.bevelDiagnostics : null,
    spatialGeometry: modelSpatialGeometryForReport(mesh), internalCutterGeometry: mesh.internalCutterGeometry ?? null,
    internalRootDiagnostics: mesh.profile.internalRootDiagnostics ?? null,
    settings: { ...settings }, assessment: assessPrint(mesh, validation, settings), geometryWarnings: mesh.warnings,
    customerInputRequired: ['Назначение: макет / рабочая передача', 'Крутящий момент, обороты и срок службы',
      'Температура, смазка, ответная деталь', 'Посадки и допуски по чертежу', 'Пробная печать и проверка сопряжения'],
    orderStatus: 'Файл задания. Заказ не отправлен.',
  };
}
