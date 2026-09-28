import { buildModelMesh, defaultModel, type ModelKind, type ModelMesh, type ModelParams } from './model.ts';
import { validateMesh, type MeshValidation } from './gearMath.ts';
import type { ExportPreset, ModelProvenance } from './modelExport.ts';
import { spanApplicationMatches, type SpanApplication } from './spanMeasurement.ts';
import { familyApplicationMatches, type FamilyApplication } from './familyIdentification.ts';
import type { MeasurementSource } from './photo-inference.ts';
import { cycloidalPhotoInferenceMatches, type CycloidalPhotoModuleInference } from './cycloidalPhotoInference.ts';
import type { referencePhotoManifest } from './referencePhotos.ts';

export type JourneyStage = 'start' | 'input' | 'review' | 'delivery' | 'checkout';
export type InputMode = 'manual' | 'photo';
export type DeliveryChoice = { kind: 'file'; preset: ExportPreset } | { kind: 'print' };
export interface BuiltModel extends ModelProvenance {
  revision: number;
  mode: InputMode;
  params: ModelParams;
  mesh: ModelMesh;
  validation: MeshValidation;
}
export interface PhotoCycloidalHandoff {
  method: 'confirmed-photo-cycloidal-handoff-v1';
  selectedPhotoKind: 'spur';
  selectedProfile: 'cycloidal';
  toothCountSeed: { value: number; source: MeasurementSource } | null;
  moduleInference: CycloidalPhotoModuleInference | null;
  photoScaleEvidence: unknown | null;
}
export interface JourneyState {
  stage: JourneyStage;
  mode: InputMode | null;
  manualDraft: ModelParams;
  manualSpan: SpanApplication | null;
  manualSpanPending: boolean;
  manualFamily: FamilyApplication | null;
  manualFamilyPending: boolean;
  manualFamilyMethod: 'direct-parameters' | 'direct-list' | 'webmcp';
  photoCycloidalHandoff: PhotoCycloidalHandoff | null;
  revision: number;
  built: BuiltModel | null;
  confirmedRevision: number | null;
  choice: DeliveryChoice | null;
  error: string | null;
}
export type JourneyAction =
  | { type: 'choose-input'; mode: InputMode }
  | { type: 'photo-to-manual-cycloidal'; toothCount?: { value: number; source: MeasurementSource }; moduleInference?: CycloidalPhotoModuleInference; photoScaleEvidence?: unknown }
  | { type: 'edit-manual'; params: ModelParams }
  | { type: 'select-manual-kind'; kind: ModelKind }
  | { type: 'edit-manual-family' }
  | { type: 'apply-manual-family'; application: FamilyApplication }
  | { type: 'clear-manual-family'; method?: 'direct-list' | 'webmcp' }
  | { type: 'edit-manual-span' }
  | { type: 'apply-manual-span'; application: SpanApplication }
  | { type: 'clear-manual-span' }
  | { type: 'edit-photo' }
  | { type: 'edit-reference-photos' }
  | { type: 'build'; params: ModelParams; origin: string; evidence: unknown; referencePhotos?: ReturnType<typeof referencePhotoManifest> }
  | { type: 'confirm' }
  | { type: 'choose-delivery'; choice: DeliveryChoice }
  | { type: 'navigate'; stage: JourneyStage };

export function initialJourney(): JourneyState {
  return { stage: 'start', mode: null, manualDraft: defaultModel(), manualSpan: null, manualSpanPending: false,
    manualFamily: null, manualFamilyPending: false, manualFamilyMethod: 'direct-parameters', photoCycloidalHandoff: null, revision: 0,
    built: null, confirmedRevision: null, choice: null, error: null };
}
export const hasCurrentModel = (s: JourneyState): boolean => !!s.built && s.built.revision === s.revision && s.built.validation.valid;
export const hasConfirmedModel = (s: JourneyState): boolean => hasCurrentModel(s) && s.confirmedRevision === s.revision;
export function canVisit(s: JourneyState, stage: JourneyStage): boolean {
  if (stage === 'start') return true;
  if (stage === 'input') return s.mode !== null;
  if (stage === 'review') return hasCurrentModel(s);
  if (stage === 'delivery') return hasConfirmedModel(s);
  return hasConfirmedModel(s) && s.choice !== null;
}
const changed = (s: JourneyState): JourneyState => ({ ...s, stage: 'input', revision: s.revision + 1,
  built: null, confirmedRevision: null, choice: null, error: null });
const sameParams = (a: ModelParams, b: ModelParams): boolean =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => Object.is(a[key as keyof ModelParams], b[key as keyof ModelParams]));
const measurementSources: readonly MeasurementSource[] = ['measurement', 'drawing', 'user_confirmation'];
function confirmedPhotoCountSeed(seed?: { value: number; source: MeasurementSource }) {
  if (!seed || !Number.isInteger(seed.value) || seed.value < 6 || seed.value > 250 || !measurementSources.includes(seed.source)) return null;
  return { value: seed.value, source: seed.source };
}

/** Navigation never creates or confirms a model. Only an explicit build can do so. */
export function transitionJourney(s: JourneyState, action: JourneyAction): JourneyState {
  switch (action.type) {
    case 'choose-input': {
      const next = s.mode !== null && s.mode !== action.mode ? changed(s) : { ...s, error: null };
      const manualDraft = action.mode === 'manual' && s.built?.mode === 'photo'
        ? structuredClone(s.built.params) : s.manualDraft;
      return { ...next, mode: action.mode, manualDraft, stage: 'input',
        ...(action.mode === 'manual' && s.built?.mode === 'photo' ? { photoCycloidalHandoff: null } : {}),
        ...(manualDraft !== s.manualDraft ? { manualSpan: null, manualSpanPending: false, manualFamily: null, manualFamilyPending: false, manualFamilyMethod: 'direct-parameters' as const } : {}) };
    }
    case 'photo-to-manual-cycloidal': {
      if (s.mode !== 'photo' || s.stage !== 'input') return s;
      const toothCountSeed = confirmedPhotoCountSeed(action.toothCount);
      const offeredModule = action.moduleInference;
      const moduleReady = offeredModule?.status === 'ready' && cycloidalPhotoInferenceMatches(offeredModule, toothCountSeed ?? undefined);
      const moduleInference = offeredModule?.status === 'ready'
        ? moduleReady ? offeredModule
          : { status: 'rejected' as const, reason: 'Модульный расчёт не согласован с подтверждённым числом зубьев; задайте модуль вручную.' }
        : offeredModule ?? null;
      const moduleSeed = moduleInference?.status === 'ready' ? moduleInference.moduleMm : undefined;
      const manualDraft = { ...defaultModel('cycloidal'), ...(toothCountSeed ? { teeth: toothCountSeed.value } : {}), ...(moduleSeed ? { module: moduleSeed } : {}) };
      const next = changed(s);
      return { ...next, mode: 'manual', manualDraft, manualSpan: null, manualSpanPending: false,
        manualFamily: null, manualFamilyPending: false, manualFamilyMethod: 'direct-list',
        photoCycloidalHandoff: { method: 'confirmed-photo-cycloidal-handoff-v1', selectedPhotoKind: 'spur', selectedProfile: 'cycloidal', toothCountSeed,
          moduleInference: moduleInference ? structuredClone(moduleInference) : null,
          photoScaleEvidence: action.photoScaleEvidence === undefined ? null : structuredClone(action.photoScaleEvidence) } };
    }
    case 'edit-manual':
      if (s.mode !== 'manual' || sameParams(s.manualDraft, action.params)) return s;
      return { ...changed(s), manualDraft: structuredClone(action.params),
        ...(s.manualDraft.kind !== action.params.kind ? { photoCycloidalHandoff: null } : {}),
        ...(s.manualDraft.kind !== action.params.kind ? { manualFamily: null, manualFamilyPending: false, manualFamilyMethod: 'direct-parameters' as const } : {}),
        manualSpan: s.manualSpan && spanApplicationMatches(s.manualSpan, action.params) ? s.manualSpan : null,
        manualSpanPending: action.params.kind === 'spur' ? s.manualSpanPending : false };
    case 'select-manual-kind':
      if (s.mode !== 'manual') return s;
      return { ...changed(s), manualFamily: null, manualFamilyPending: false, manualFamilyMethod: 'direct-list',
        ...(s.manualDraft.kind !== action.kind ? { manualDraft: defaultModel(action.kind), manualSpan: null, manualSpanPending: false, photoCycloidalHandoff: null } : {}) };
    case 'edit-manual-family':
      return s.mode === 'manual' ? { ...changed(s), manualFamily: null, manualFamilyPending: true } : s;
    case 'apply-manual-family':
      if (s.mode !== 'manual' || !action.application.acceptedByUser) return s;
      return { ...changed(s), manualFamily: structuredClone(action.application), manualFamilyPending: false,
        ...(s.manualDraft.kind !== action.application.modelKind
          ? { manualDraft: defaultModel(action.application.modelKind), manualSpan: null, manualSpanPending: false, photoCycloidalHandoff: null } : {}) };
    case 'clear-manual-family':
      return s.manualFamily || s.manualFamilyPending || s.manualFamilyMethod !== (action.method ?? 'direct-list') || (action.method === 'webmcp' && s.photoCycloidalHandoff !== null)
        ? { ...changed(s), manualFamily: null, manualFamilyPending: false, manualFamilyMethod: action.method ?? 'direct-list',
          ...(action.method === 'webmcp' ? { photoCycloidalHandoff: null } : {}) } : s;
    case 'edit-manual-span':
      return s.mode === 'manual' && s.manualDraft.kind === 'spur'
        ? { ...changed(s), manualSpan: null, manualSpanPending: true } : s;
    case 'apply-manual-span':
      if (s.mode !== 'manual' || s.manualDraft.kind !== 'spur') return s;
      return { ...changed(s), manualDraft: { ...s.manualDraft, ...structuredClone(action.application.candidate.parameters) },
        manualSpan: structuredClone(action.application), manualSpanPending: false };
    case 'clear-manual-span':
      return s.manualSpan || s.manualSpanPending ? { ...changed(s), manualSpan: null, manualSpanPending: false } : s;
    case 'edit-photo': return s.mode === 'photo' ? changed(s) : s;
    case 'edit-reference-photos': return s.mode ? changed(s) : s;
    case 'build': {
      if (s.stage !== 'input' || !s.mode) return s;
      if (s.mode === 'manual' && (s.manualFamilyPending || (s.manualFamily && !familyApplicationMatches(s.manualFamily, action.params.kind))))
        return { ...s, error: 'Признаки типа изменены. Примените предложение заново или явно вернитесь к прямому выбору типа.' };
      if (s.mode === 'manual' && (s.manualSpanPending || (s.manualSpan && !spanApplicationMatches(s.manualSpan, action.params))))
        return { ...s, error: 'Измерения изменены. Рассчитайте и примените их заново или явно вернитесь к прямому вводу параметров.' };
      try {
        const mesh = buildModelMesh(structuredClone(action.params)), validation = validateMesh(mesh);
        if (!validation.valid) throw new Error('Сетка не прошла проверку. Измените исходные данные.');
        // The snapshot owns its input and evidence; future draft edits cannot mutate a download.
        const photoHandoff = s.mode === 'manual' ? s.photoCycloidalHandoff : null;
        const countSeed = photoHandoff?.toothCountSeed ?? null;
        const countSeedUsed = !!countSeed && action.params.kind === 'cycloidal' && action.params.teeth === countSeed.value;
        const moduleInference = photoHandoff?.moduleInference ?? null;
        const moduleSeed = moduleInference?.status === 'ready' ? moduleInference : null;
        const moduleSeedUsed = !!moduleSeed && action.params.kind === 'cycloidal'
          && action.params.module === moduleSeed.moduleMm && action.params.teeth === moduleSeed.evidence.toothCount.value;
        const handoffOrigin = photoHandoff ? countSeed
          ? countSeedUsed
            ? ` Циклоидальный профиль и прямозубый тип выбраны в помощнике по фото; подтверждённое полное число зубьев z=${countSeed.value} перенесено (${countSeed.source}).`
            : ` В черновик из помощника по фото перенесено подтверждённое z=${countSeed.value} (${countSeed.source}), но построенная модель использует z=${action.params.teeth}; перенос не является источником текущего числа.`
          : ' Циклоидальный профиль выбран в помощнике по фото, но подтверждённое полное число зубьев не перенесено; число модели требует ручной проверки.' : '';
        const moduleHandoffOrigin = photoHandoff ? moduleSeed
          ? moduleSeedUsed
            ? ` Модуль m=${moduleSeed.moduleMm} мм рассчитан по подтверждённым da=${moduleSeed.evidence.tipDiameterMm.value} мм и z=${moduleSeed.evidence.toothCount.value} формулой m=da/(z+2), при принятом ha=m.`
            : ` Фото-помощник рассчитал m=${moduleSeed.moduleMm} мм при z=${moduleSeed.evidence.toothCount.value}, но текущая модель использует z=${action.params.teeth} и m=${action.params.module} мм; после изменения параметров модуль нужно сверить заново.`
          : ` Модуль по фото не рассчитан: ${moduleInference?.status === 'missing' ? moduleInference.questions.join(' ') : moduleInference?.status === 'rejected' ? moduleInference.reason : 'неполные подтверждённые исходные данные'} Текущее значение модуля требует ручной проверки.` : '';
        const provenance = s.mode === 'manual' ? {
          origin: (s.manualSpan ? 'Общая нормаль: модуль, смещение и утонение рассчитаны по подтверждённым измерениям; тело задано вручную.' : action.origin)
            + (s.manualFamily ? ' Семейство выбрано по ответам помощника; система профиля этим не подтверждена.' : '') + handoffOrigin + moduleHandoffOrigin,
          evidence: { ...(s.manualSpan ? { spanMeasurement: s.manualSpan, bodyDimensions: { widthMm: action.params.width, boreMm: action.params.bore, source: 'manual' } } : {}),
            familySelection: s.manualFamily ?? { method: s.manualFamilyMethod, source: 'manual', modelKind: action.params.kind },
            ...(photoHandoff ? { photoCycloidalHandoff: { ...structuredClone(photoHandoff), toothCountSeedUsedInBuiltModel: countSeedUsed,
              moduleSeedUsedInBuiltModel: moduleSeedUsed,
              builtToothCount: action.params.kind === 'cycloidal' ? action.params.teeth : null,
              builtModuleMm: action.params.kind === 'cycloidal' ? action.params.module : null,
              moduleStatus: moduleSeed ? moduleSeedUsed ? 'derived-and-used' : 'derived-but-edited'
                : moduleInference?.status === 'missing' ? 'not-derived-from-photo' : moduleInference?.status === 'rejected' ? 'photo-inference-rejected' : 'not-derived-from-photo',
              toothCountStatus: countSeed ? countSeedUsed ? 'transferred-and-used' : 'transferred-but-edited' : 'not-confirmed-in-photo-workflow' } } : {}) },
        } : action;
        const built: BuiltModel = { revision: s.revision, mode: s.mode,
          params: structuredClone(mesh.params), mesh, validation,
          origin: provenance.origin, evidence: structuredClone(action.referencePhotos?.photos.length ? {
            ...(provenance.evidence && typeof provenance.evidence === 'object' ? provenance.evidence : {}), supportingPhotos: action.referencePhotos,
          } : provenance.evidence) };
        return { ...s, stage: 'review', built, confirmedRevision: null, choice: null, error: null };
      } catch (e) {
        return { ...s, built: null, confirmedRevision: null, choice: null,
          error: e instanceof Error ? e.message : 'Не удалось построить модель.' };
      }
    }
    case 'confirm':
      return s.stage === 'review' && hasCurrentModel(s)
        ? { ...s, confirmedRevision: s.revision, stage: 'delivery', error: null } : s;
    case 'choose-delivery':
      if (!hasConfirmedModel(s) || !['delivery', 'checkout'].includes(s.stage)) return s;
      if (action.choice.kind !== 'print' && !(action.choice.kind === 'file' && ['standard', 'pro'].includes(action.choice.preset))) return s;
      return { ...s, choice: { ...action.choice }, stage: 'delivery' };
    case 'navigate':
      return canVisit(s, action.stage) ? { ...s, stage: action.stage, error: null } : s;
  }
}

export function journeyHash(s: JourneyState): string { return `#${s.stage === 'input' ? s.mode : s.stage}`; }
/** A fresh result deep-link cannot recover a model that was never built in this tab. */
export function journeyFromHash(s: JourneyState, hash: string): JourneyState {
  const route = hash.replace(/^#/, '');
  if (route === 'manual' || route === 'photo') return transitionJourney(s, { type: 'choose-input', mode: route });
  const stage = ['review', 'delivery', 'checkout', 'start'].includes(route) ? route as JourneyStage : 'start';
  return { ...s, stage: canVisit(s, stage) ? stage : s.mode ? 'input' : 'start' };
}
export function checkoutSnapshot(s: JourneyState): { model: BuiltModel; choice: DeliveryChoice } | null {
  return s.stage === 'checkout' && hasConfirmedModel(s) && s.built && s.choice
    ? { model: s.built, choice: { ...s.choice } } : null;
}
