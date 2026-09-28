import { buildModelMesh, defaultModel, type ModelMesh, type ModelParams } from './model.ts';
import { validateMesh, type MeshValidation } from './gearMath.ts';
import type { ExportPreset, ModelProvenance } from './modelExport.ts';
import { spanApplicationMatches, type SpanApplication } from './spanMeasurement.ts';

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
export interface JourneyState {
  stage: JourneyStage;
  mode: InputMode | null;
  manualDraft: ModelParams;
  manualSpan: SpanApplication | null;
  manualSpanPending: boolean;
  revision: number;
  built: BuiltModel | null;
  confirmedRevision: number | null;
  choice: DeliveryChoice | null;
  error: string | null;
}
export type JourneyAction =
  | { type: 'choose-input'; mode: InputMode }
  | { type: 'edit-manual'; params: ModelParams }
  | { type: 'edit-manual-span' }
  | { type: 'apply-manual-span'; application: SpanApplication }
  | { type: 'clear-manual-span' }
  | { type: 'edit-photo' }
  | { type: 'build'; params: ModelParams; origin: string; evidence: unknown }
  | { type: 'confirm' }
  | { type: 'choose-delivery'; choice: DeliveryChoice }
  | { type: 'navigate'; stage: JourneyStage };

export function initialJourney(): JourneyState {
  return { stage: 'start', mode: null, manualDraft: defaultModel(), manualSpan: null, manualSpanPending: false, revision: 0,
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

/** Navigation never creates or confirms a model. Only an explicit build can do so. */
export function transitionJourney(s: JourneyState, action: JourneyAction): JourneyState {
  switch (action.type) {
    case 'choose-input': {
      const next = s.mode !== null && s.mode !== action.mode ? changed(s) : { ...s, error: null };
      const manualDraft = action.mode === 'manual' && s.built?.mode === 'photo'
        ? structuredClone(s.built.params) : s.manualDraft;
      return { ...next, mode: action.mode, manualDraft, stage: 'input',
        ...(manualDraft !== s.manualDraft ? { manualSpan: null, manualSpanPending: false } : {}) };
    }
    case 'edit-manual':
      if (s.mode !== 'manual' || sameParams(s.manualDraft, action.params)) return s;
      return { ...changed(s), manualDraft: structuredClone(action.params),
        manualSpan: s.manualSpan && spanApplicationMatches(s.manualSpan, action.params) ? s.manualSpan : null,
        manualSpanPending: action.params.kind === 'spur' ? s.manualSpanPending : false };
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
    case 'build': {
      if (s.stage !== 'input' || !s.mode) return s;
      if (s.mode === 'manual' && (s.manualSpanPending || (s.manualSpan && !spanApplicationMatches(s.manualSpan, action.params))))
        return { ...s, error: 'Измерения изменены. Рассчитайте и примените их заново или явно вернитесь к прямому вводу параметров.' };
      try {
        const mesh = buildModelMesh(structuredClone(action.params)), validation = validateMesh(mesh);
        if (!validation.valid) throw new Error('Сетка не прошла проверку. Измените исходные данные.');
        // The snapshot owns its input and evidence; future draft edits cannot mutate a download.
        const spanEvidence = s.mode === 'manual' && s.manualSpan ? {
          origin: 'Общая нормаль: модуль, смещение и утонение рассчитаны по подтверждённым измерениям; тело задано вручную.',
          evidence: { spanMeasurement: s.manualSpan, bodyDimensions: { widthMm: action.params.width, boreMm: action.params.bore, source: 'manual' } },
        } : action;
        const built: BuiltModel = { revision: s.revision, mode: s.mode,
          params: structuredClone(mesh.params), mesh, validation,
          origin: spanEvidence.origin, evidence: structuredClone(spanEvidence.evidence) };
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
