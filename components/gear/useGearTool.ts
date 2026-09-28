"use client";
import { useEffect, useRef } from 'react';
import { buildModelMesh, defaultModel, modelDimensionsForReport, modelNames, type ModelParams } from '@/lib/model';
import { validateMesh } from '@/lib/gearMath';

/** Keep the existing browser tool independent of the page's visual arrangement. */
export function useGearTool(params: ModelParams, onApply: (params: ModelParams) => void) {
  const state = useRef({ params, onApply });
  useEffect(() => { state.current = { params, onApply }; }, [params, onApply]);
  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options: unknown) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const registration = context.registerTool({
      name: 'configure_gear', title: 'Задать параметры колеса',
      description: 'Изменяет параметры в конструкторе, проверяет геометрию и возвращает номинальные размеры. Не подтверждает прочность или изготовление.',
      inputSchema: { type: 'object', properties: {
        kind: { type: 'string', enum: Object.keys(modelNames) }, teeth: { type: 'integer', minimum: 1, maximum: 250 },
        module: { type: 'number', minimum: .1, maximum: 30 }, width: { type: 'number', exclusiveMinimum: 0, maximum: 500 },
        bore: { type: 'number', minimum: 0 }, pressureAngleDeg: { type: 'number', minimum: 10, maximum: 35 },
        helixAngleDeg: { type: 'number', minimum: -45, maximum: 45 }, profileShift: { type: 'number', minimum: -.8, maximum: 1 },
        backlash: { type: 'number', minimum: 0 }, wormStarts: { type: 'integer', minimum: 1, maximum: 8 },
        wormDiameterFactor: { type: 'number', exclusiveMinimum: 2.5, maximum: 100 }, wormHand: { type: 'string', enum: ['right', 'left'] },
        cycloidRollingRadius: { type: 'number', exclusiveMinimum: 0, description: 'Радиус производящей окружности в мм; не больше m·z/4' },
        bevelMateTeeth: { type: 'integer', minimum: 6, maximum: 250, description: 'Число зубьев партнёра для определения делительного конуса' },
        bevelShaftAngleDeg: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 180, description: 'Угол пересекающихся осей; оба делительных конуса острые' },
        internalCutterTeeth: { type: 'integer', minimum: 6, maximum: 249, description: 'Принятый долбяк внутреннего прямозубого; zс < z, не измерено по фото' },
        internalCutterProfileShift: { type: 'number', minimum: -.8, maximum: 1 },
        internalCutterAddendumCoefficient: { type: 'number', minimum: .5, maximum: 2 },
        internalCutterTipRadiusCoefficient: { type: 'number', minimum: .05, maximum: .8 },
        internalCutterThinning: { type: 'number', minimum: 0, description: 'Утонение долбяка в мм; только internal' },
      }, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input: unknown) => {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Ожидается объект параметров.');
        const allowed = ['kind', 'teeth', 'module', 'width', 'bore', 'pressureAngleDeg', 'helixAngleDeg', 'profileShift', 'backlash', 'wormStarts', 'wormDiameterFactor', 'wormHand', 'cycloidRollingRadius', 'bevelMateTeeth', 'bevelShaftAngleDeg', 'internalCutterTeeth', 'internalCutterProfileShift', 'internalCutterAddendumCoefficient', 'internalCutterTipRadiusCoefficient', 'internalCutterThinning'];
        if (Object.keys(input).some(k => !allowed.includes(k))) throw new Error('Неизвестный параметр.');
        const patch = input as Partial<ModelParams>;
        if (patch.kind !== undefined && !Object.hasOwn(modelNames, patch.kind)) throw new Error('Неизвестный тип.');
        const base = patch.kind && patch.kind !== state.current.params.kind ? defaultModel(patch.kind) : state.current.params;
        const p = { ...base, ...patch } as ModelParams, mesh = buildModelMesh(p), check = validateMesh(mesh);
        if (!check.valid) throw new Error('Некорректная сетка');
        state.current.onApply(p);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { appVersion: '0.17.0', journey: { stage: 'review', requiresModelConfirmation: true }, parameters: mesh.params, dimensions: modelDimensionsForReport(mesh),
          wormDimensions: 'wormDimensions' in mesh ? mesh.wormDimensions : null,
          cycloidalDimensions: 'cycloidalDimensions' in mesh ? mesh.cycloidalDimensions : null,
          internalCutterGeometry: mesh.internalCutterGeometry ?? null, internalRootDiagnostics: mesh.profile.internalRootDiagnostics ?? null,
          bevelDimensions: 'bevelDimensions' in mesh ? mesh.bevelDimensions : null, warnings: mesh.warnings, meshValid: check.valid };
      },
    }, { signal: lifecycle.signal });
    Promise.resolve(registration).catch(() => {});
    return () => lifecycle.abort();
  }, []);
}
