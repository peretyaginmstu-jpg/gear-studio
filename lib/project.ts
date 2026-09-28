import { z } from 'zod';
import { APP_VERSION } from './appVersion.ts';
import { buildModelMesh, type ModelParams } from './model.ts';
import { validateMesh } from './gearMath.ts';
import { initialJourney, hasCurrentModel, type JourneyState, type PhotoCycloidalHandoff } from './journey.ts';
import { selectFamilyApplication } from './familyIdentification.ts';
import { analyzeSpanMeasurement, selectSpanApplication } from './spanMeasurement.ts';
import { estimatePhotoCircle, photoScaleSources } from './photo-scale.ts';
import { cycloidalPhotoInferenceMatches, type CycloidalPhotoModuleInference } from './cycloidalPhotoInference.ts';
import { assertPngDimensions, MAX_REFERENCE_PHOTOS, referencePhotosSchema } from './referencePhotos.ts';

export const PROJECT_SCHEMA = 'zatseplenie.project.v3';
export const PREVIOUS_PROJECT_SCHEMA = 'zatseplenie.project.v2';
export const LEGACY_PROJECT_SCHEMA = 'zatseplenie.project.v1';
export const MAX_PROJECT_BYTES = 32 * 1024 * 1024;
export const MAX_PROJECT_VERSIONS = 100;
export class ProjectSizeError extends Error {
  constructor() { super('Проект больше 32 МБ. Откройте «Версии» и создайте отдельный проект из текущего варианта.'); }
}
const finite = z.number().finite();
// An empty numeric control is NaN in memory, null on disk, and empty on restore.
const draftNumber = finite.nullable().transform(value => value ?? NaN);
const text = z.string().max(500);
const modelKind = z.enum(['spur', 'helical', 'herringbone', 'internal', 'internal-helical', 'rack', 'helical-rack', 'worm', 'cycloidal', 'bevel']);
const mode = z.enum(['manual', 'photo']);
const source = z.enum(['measurement', 'drawing', 'user_confirmation']);
const diameterMethod = z.enum(['tip_circle', 'opposed_tips', 'unknown', 'uncorrected_caliper_span']);
const modelSchema = z.object({
  kind: modelKind, teeth: draftNumber, module: draftNumber, width: draftNumber, bore: draftNumber,
  pressureAngleDeg: draftNumber, helixAngleDeg: draftNumber, profileShift: draftNumber, backlash: draftNumber,
  rimThickness: draftNumber.optional(), rackBaseHeight: draftNumber.optional(), toolTipRadiusCoefficient: draftNumber.optional(),
  profileTolerance: draftNumber.optional(), internalCutterTeeth: draftNumber.optional(), internalCutterProfileShift: draftNumber.optional(),
  internalCutterAddendumCoefficient: draftNumber.optional(), internalCutterTipRadiusCoefficient: draftNumber.optional(), internalCutterThinning: draftNumber.optional(),
  wormStarts: draftNumber.optional(), wormDiameterFactor: draftNumber.optional(), wormHand: z.enum(['right', 'left']).optional(),
  cycloidRollingRadius: draftNumber.optional(), bevelMateTeeth: draftNumber.optional(), bevelShaftAngleDeg: draftNumber.optional(),
}).strict();
const familyAnswers = z.object({
  partnerGroup: z.enum(['toothed', 'flexible', 'spline', 'unknown']).optional(),
  partner: z.enum(['gear-rack', 'worm', 'pins', 'belt', 'chain', 'unknown']).optional(),
  body: z.enum(['external-cylinder', 'internal-ring', 'rack', 'cone', 'screw', 'face', 'unknown']).optional(),
  direction: z.enum(['straight', 'inclined', 'opposed', 'unknown']).optional(),
  coneDirection: z.enum(['straight', 'curved', 'unknown']).optional(), screwPartner: z.enum(['wheel', 'nut', 'unknown']).optional(),
}).strict();
const familyHint = z.object({ type: z.enum(['external_circular', 'internal_ring', 'linear_rack', 'undetermined']), evidence: text.optional() }).nullable();
const familyApplication = z.object({ source: mode, acceptedByUser: z.literal(true), limitedModelAcknowledged: z.boolean(),
  decision: z.object({ answers: familyAnswers, photoHint: familyHint }),
}).transform((value, ctx) => {
  try { return selectFamilyApplication(value.decision.answers, value.source, value.decision.photoHint, value.limitedModelAcknowledged); }
  catch { ctx.addIssue({ code: 'custom', message: 'Несогласованные ответы о типе.' }); return z.NEVER; }
});
const readings = z.object({ spanMm: finite, nextSpanMm: finite, tipDiameterMm: finite });
const spanApplication = z.object({ selected: z.enum(['exact-inverse', 'bounded-zero-thinning-fit']), input: readings.extend({
  kind: z.literal('spur'), teeth: finite, spanTeeth: finite, pressureAngleDeg: finite.nullable(), pressureAngleConfirmed: z.boolean(),
  tipDiameterMethod: diameterMethod, errorBounds: readings,
  confirmations: z.object({ teeth: z.boolean(), involute: z.boolean(), standardTip: z.boolean(), measurementSetup: z.boolean() }),
  toolTipRadiusCoefficient: finite,
}) }).transform((value, ctx) => {
  try { return selectSpanApplication(analyzeSpanMeasurement(value.input), value.selected); }
  catch { ctx.addIssue({ code: 'custom', message: 'Измерения общей нормали не воспроизводятся.' }); return z.NEVER; }
});
const point = z.object({ x: finite, y: finite }).strict();
const photoScaleInput = z.object({
  imageWidth: finite.int().min(1).max(2048), imageHeight: finite.int().min(1).max(2048),
  referencePoints: z.array(point).max(2), tipPoints: z.array(point).max(3),
  referenceLengthMm: finite.optional(), referenceToleranceMm: finite.optional(), pixelUncertaintyPx: finite.optional(),
  confirmedCoplanar: z.boolean(), confirmedAxialView: z.boolean(),
});
const photoMeasurement = z.object({ input: photoScaleInput, confirmedTipCircle: z.literal(true),
  target: z.enum(['internal_tooth_tips', 'external_tooth_tips']),
}).transform((value, ctx) => {
  const result = estimatePhotoCircle(value.input);
  if (result.status !== 'ready') { ctx.addIssue({ code: 'custom', message: 'Разметка масштаба не воспроизводится.' }); return z.NEVER; }
  return { ...value, method: 'three-tip-circle-with-reference' as const, coordinateSpace: 'working_image_pixels' as const, result, sources: photoScaleSources };
});
const cycloidalInference = z.unknown().refine(value => {
  try {
    const v = value as CycloidalPhotoModuleInference;
    return v?.status === 'ready' ? cycloidalPhotoInferenceMatches(v)
      : v?.status === 'missing' ? z.array(text).max(30).safeParse(v.questions).success
        : v?.status === 'rejected' && text.safeParse(v.reason).success;
  } catch { return false; }
}, 'Несогласованный циклоидальный расчёт.').transform(value => value as CycloidalPhotoModuleInference);

export type ProjectForms = Record<string, { identity: string; values: Record<string, unknown> }>;
const familyForm = z.object({ answers: familyAnswers, page: z.enum(['partnerGroup', 'partner', 'body', 'direction', 'coneDirection', 'screwPartner', 'result']), limitedAcknowledged: z.boolean() }).partial().strict();
const spanForm = z.object({ k: text, w: text, nextW: text, diameter: text, alpha: text, method: diameterMethod,
  ew: text, enext: text, ed: text, partConfirmed: z.boolean(), standardConfirmed: z.boolean(), angleConfirmed: z.boolean(), setupConfirmed: z.boolean(), calculated: z.boolean(),
}).partial().strict();
const photoForm = z.object({
  step: finite.int().min(0).max(3), image: z.string().max(24 * 1024 * 1024).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/).nullable(),
  imageSize: z.object({ width: finite.int().min(1).max(2048), height: finite.int().min(1).max(2048), id: finite.int().nonnegative(),
    source: z.object({ fileName: text, mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']), originalWidth: finite.int().positive().max(60_000_000), originalHeight: finite.int().positive().max(60_000_000) }) }).nullable(),
  imageReference: z.object({ id: z.string().uuid(), role: z.enum(['side', 'body', 'damage', 'partner', 'other']), note: z.string().max(600) }).strict().nullable(),
  region: z.object({ x: finite.int().nonnegative(), y: finite.int().nonnegative(), width: finite.int().positive(), height: finite.int().positive() }).nullable(),
  analysisRevision: finite.int().nonnegative(), photoMeasurement: photoMeasurement.nullable(),
  kind: z.enum(['unknown', 'other', 'spur', 'helical', 'herringbone', 'internal', 'internal-helical', 'rack', 'helical-rack']),
  profile: z.enum(['unknown', 'involute', 'cycloidal', 'other']), teeth: text, confirmedTeeth: z.boolean(), damageHypothesisTransferred: z.boolean(),
  toothCountResetReason: z.enum(['wheel-rack-meaning', 'photo-family-conflict']).nullable(),
  diameter: text, pitch: text, diameterMethod, beta: text, alpha: text, shift: text, standard: z.boolean(), symmetric: z.boolean(), width: text, body: text,
  internalCutter: z.object({ internalCutterTeeth: draftNumber, internalCutterProfileShift: draftNumber, internalCutterAddendumCoefficient: draftNumber,
    internalCutterTipRadiusCoefficient: draftNumber, internalCutterThinning: draftNumber }).strict(),
  source, spanApplication: spanApplication.nullable(), spanPending: z.boolean(), familyApplication: familyApplication.nullable(), familyPending: z.boolean(),
}).partial().strict();
const scaleForm = z.object({ referencePoints: z.array(point).max(2), tipPoints: z.array(point).max(3), referenceLength: text, referenceTolerance: text,
  pixelError: text.nullable(), selectionErrors: z.array(finite.nonnegative()).max(5), coplanar: z.boolean(), axial: z.boolean(), confirmedTips: z.boolean(),
}).partial().strict();
const printForm = z.object({ settings: z.object({ bedX: draftNumber, bedY: draftNumber, bedZ: draftNumber,
  nozzle: draftNumber, lineWidth: draftNumber, layer: draftNumber, material: z.enum(['PLA', 'PETG', 'PA', 'PA-CF']) }).strict() }).partial().strict();
const formSchemas: Record<string, z.ZodTypeAny> = { photo: photoForm, photoFamily: familyForm, manualFamily: familyForm,
  photoSpan: spanForm, manualSpan: spanForm, photoScale: scaleForm, print: printForm,
  photoReferences: z.object({ photos: referencePhotosSchema }).partial().strict(),
  pair: z.object({ second: modelSchema, center: text }).partial().strict() };

const handoff = z.object({ method: z.literal('confirmed-photo-cycloidal-handoff-v1'), selectedPhotoKind: z.literal('spur'), selectedProfile: z.literal('cycloidal'),
  toothCountSeed: z.object({ value: finite.int().min(6).max(250), source }).nullable(), moduleInference: cycloidalInference.nullable(), photoScaleEvidence: z.unknown(),
}).refine(value => value.moduleInference?.status !== 'ready' || cycloidalPhotoInferenceMatches(value.moduleInference, value.toothCountSeed ?? undefined));
const savedJourney = z.object({
  stage: z.enum(['start', 'input', 'review', 'delivery', 'checkout']), mode: mode.nullable(), manualDraft: modelSchema,
  manualSpan: spanApplication.nullable(), manualSpanPending: z.boolean(), manualFamily: familyApplication.nullable(), manualFamilyPending: z.boolean(),
  manualFamilyMethod: z.enum(['direct-parameters', 'direct-list', 'webmcp']), photoCycloidalHandoff: handoff.nullable(),
  revision: finite.int().nonnegative(),
  built: z.object({ revision: finite.int().nonnegative(), mode, params: modelSchema, origin: z.string().max(12000), evidence: z.unknown() }).nullable(),
}).strict();
export type SavedJourney = z.infer<typeof savedJourney>;
export interface ProjectSnapshot { journey: SavedJourney; forms: ProjectForms }
export interface ProjectVersion extends ProjectSnapshot {
  id: string;
  name: string;
  note: string;
  createdAt: string;
  appVersion: string;
  reason: 'named' | 'before-restore';
}
export interface ProjectDocument {
  schema: typeof PROJECT_SCHEMA;
  appVersion: string;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  journey: SavedJourney;
  forms: ProjectForms;
  versions: ProjectVersion[];
}
const formsSchema = z.record(z.object({ identity: z.string().max(4000), values: z.record(z.unknown()) }).strict());
const versionSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(120), note: z.string().max(1000),
  createdAt: z.string().datetime(), appVersion: z.string().max(30), reason: z.enum(['named', 'before-restore']),
  journey: savedJourney, forms: formsSchema,
}).strict();
const documentSchema = z.object({ schema: z.literal(PROJECT_SCHEMA), appVersion: z.string().max(30), id: z.string().uuid(),
  name: z.string().trim().min(1).max(120), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  journey: savedJourney, forms: formsSchema, versions: z.array(versionSchema).max(MAX_PROJECT_VERSIONS),
  assets: z.record(z.string().max(24 * 1024 * 1024).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/)),
}).strict();

/** Bound recursion and reject special object keys before any data enters application state. */
function inspectJson(value: unknown, depth = 0, counter = { count: 0 }): void {
  if (++counter.count > 300_000 || depth > 30) throw new Error('Слишком сложный файл проекта.');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Нечисловое значение в файле проекта.');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Недопустимое поле проекта.');
    inspectJson(child, depth + 1, counter);
  }
}

export function parseProject(contents: string): ProjectDocument {
  if (new TextEncoder().encode(contents).byteLength > MAX_PROJECT_BYTES) throw new ProjectSizeError();
  let raw: unknown;
  try { raw = JSON.parse(contents); } catch { throw new Error('Файл не является JSON-проектом «Зацепления».'); }
  inspectJson(raw);
  if (!raw || typeof raw !== 'object' || ![PROJECT_SCHEMA, PREVIOUS_PROJECT_SCHEMA, LEGACY_PROJECT_SCHEMA].includes((raw as { schema: string }).schema))
    throw new Error('Неизвестный формат проекта. Нужен файл .gear.json; STL и паспорт не являются файлом проекта.');
  if ((raw as { schema: string }).schema !== PROJECT_SCHEMA) {
    const legacy = raw as { forms?: unknown; versions?: { forms?: unknown }[] };
    const references = (forms: unknown) => !!forms && typeof forms === 'object' && (Object.hasOwn(forms, 'photoReferences')
      || !!(forms as ProjectForms).photo?.values?.imageReference);
    if (references(legacy.forms) || Array.isArray(legacy.versions) && legacy.versions.some(version => references(version?.forms)))
      throw new Error('Несогласованная версия формата: несколько ракурсов требуют v3.');
  }
  if ((raw as { schema: string }).schema === LEGACY_PROJECT_SCHEMA) {
    // Only the original v1 shape can migrate; never silently discard unexpected history.
    if ('versions' in raw || 'assets' in raw) throw new Error('Несогласованная версия формата проекта.');
    raw = { ...raw, schema: PROJECT_SCHEMA, versions: [], assets: {} };
  }
  if ((raw as { schema: string }).schema === PREVIOUS_PROJECT_SCHEMA) raw = { ...(raw as Record<string, unknown>), schema: PROJECT_SCHEMA };
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Не удалось прочитать проект: проверьте поле ${parsed.error.issues[0]?.path.join('.') || 'данных'}.`);
  const { assets, ...doc } = parsed.data;
  if (Object.keys(assets).length > (MAX_PROJECT_VERSIONS + 1) * (MAX_REFERENCE_PHOTOS + 1)) throw new Error('Слишком много фотографий в проекте.');
  if (new Set(doc.versions.map(version => version.id)).size !== doc.versions.length) throw new Error('Повторяющиеся идентификаторы версий.');
  return { ...doc, forms: parseForms(doc.forms, assets), versions: doc.versions.map(version => ({ ...version, forms: parseForms(version.forms, assets) })) };
}

function parseForms(saved: ProjectForms, assets: Record<string, string>): ProjectForms {
  const forms: ProjectForms = {};
  const resolveImage = (image: unknown) => {
    if (!image || typeof image !== 'object') return image;
    const ref = z.object({ asset: z.string().regex(/^photo-\d+$/) }).strict().safeParse(image);
    if (!ref.success || !Object.hasOwn(assets, ref.data.asset)) throw new Error('Не найдена фотография сохранённой версии.');
    return assets[ref.data.asset];
  };
  for (const [key, form] of Object.entries(saved)) {
    const schema = formSchemas[key];
    if (!schema) throw new Error(`Неизвестный раздел проекта: ${key}. Обновите приложение.`);
    let values = form.values;
    if (key === 'photo' && values.image) values = { ...values, image: resolveImage(values.image) };
    if (key === 'photoReferences' && Array.isArray(values.photos)) values = { ...values,
      photos: values.photos.map(photo => photo && typeof photo === 'object' ? { ...photo, image: resolveImage(photo.image) } : photo) };
    const result = schema.safeParse(values);
    if (!result.success) throw new Error(`Повреждены данные раздела ${key}. Исходный проект не изменён.`);
    forms[key] = { identity: form.identity, values: result.data };
  }
  const photo = forms.photo?.values as z.infer<typeof photoForm> | undefined;
  if (!!photo?.image !== !!photo?.imageSize) throw new Error('Фотография и её размеры не согласованы.');
  if (photo?.imageReference && (!photo.image || (forms.photoReferences?.values.photos as { id: string }[] | undefined)?.some(item => item.id === photo.imageReference!.id)))
    throw new Error('Идентификатор основного снимка не согласован с ракурсами.');
  if (photo?.image && photo.imageSize) {
    // Check PNG header dimensions before image decoding; remote images and SVG cannot enter a project.
    assertPngDimensions(photo.image, photo.imageSize.width, photo.imageSize.height);
    if (photo.region && (photo.region.x + photo.region.width > photo.imageSize.width || photo.region.y + photo.region.height > photo.imageSize.height))
      throw new Error('Область детали выходит за фотографию.');
  }
  return forms;
}

export function snapshotJourney(state: JourneyState): SavedJourney {
  const { stage, mode, manualDraft, manualSpan, manualSpanPending, manualFamily, manualFamilyPending, manualFamilyMethod, photoCycloidalHandoff, revision } = state;
  return structuredClone({ stage, mode, manualDraft, manualSpan, manualSpanPending, manualFamily, manualFamilyPending, manualFamilyMethod, photoCycloidalHandoff, revision,
    built: hasCurrentModel(state) && state.built ? { revision, mode: state.built.mode, params: state.built.params, origin: state.built.origin, evidence: state.built.evidence } : null });
}

export function newProject(id = crypto.randomUUID(), date = new Date().toISOString()): ProjectDocument {
  return { schema: PROJECT_SCHEMA, appVersion: APP_VERSION, id, name: 'Новая деталь', createdAt: date, updatedAt: date, journey: snapshotJourney(initialJourney()), forms: {}, versions: [] };
}

/** Rebuild geometry with the current kernel. Saved checks and commercial choices are never imported as approval. */
export function restoreProjectJourney(project: ProjectDocument): JourneyState {
  const saved = project.journey;
  const state: JourneyState = { ...initialJourney(), ...structuredClone(saved), built: null,
    photoCycloidalHandoff: saved.photoCycloidalHandoff as PhotoCycloidalHandoff | null,
    confirmedRevision: null, choice: null, error: null };
  if (saved.built && saved.built.revision === saved.revision && saved.built.mode === saved.mode) {
    try {
      const mesh = buildModelMesh(saved.built.params), validation = validateMesh(mesh);
      if (!validation.valid) throw new Error('Сетка не прошла повторную проверку.');
      state.built = { ...structuredClone(saved.built), params: mesh.params as ModelParams, evidence: structuredClone(saved.built.evidence ?? null), mesh, validation };
    } catch (error) { state.error = `Сохранённую модель нужно исправить: ${error instanceof Error ? error.message : 'ошибка геометрии'}`; }
  }
  state.stage = saved.stage === 'start' ? 'start' : state.built && ['review', 'delivery', 'checkout'].includes(saved.stage)
    ? 'review' : saved.mode ? 'input' : 'start';
  return state;
}

/** The file stores each photo once, while editable snapshots keep ordinary image strings in memory. */
export function serializeProject(project: ProjectDocument): string {
  const assets: Record<string, string> = {}, images = new Map<string, string>();
  const packImage = (image: unknown): unknown => {
    if (typeof image !== 'string' || !image.startsWith('data:image/png;base64,')) return image;
    let key = images.get(image);
    if (!key) { key = `photo-${images.size + 1}`; images.set(image, key); assets[key] = image; }
    return { asset: key };
  };
  const packForms = (forms: ProjectForms): ProjectForms => {
    const packed = { ...forms };
    if (forms.photo?.values.image) packed.photo = { ...forms.photo, values: { ...forms.photo.values, image: packImage(forms.photo.values.image) } };
    const refs = forms.photoReferences;
    if (refs && Array.isArray(refs.values.photos)) packed.photoReferences = { ...refs, values: { ...refs.values,
      photos: refs.values.photos.map(photo => ({ ...photo, image: packImage(photo.image) })) } };
    return packed;
  };
  const contents = JSON.stringify({ ...project, schema: PROJECT_SCHEMA, forms: packForms(project.forms),
    versions: project.versions.map(version => ({ ...version, forms: packForms(version.forms) })), assets }, null, 2);
  if (new TextEncoder().encode(contents).byteLength > MAX_PROJECT_BYTES) throw new ProjectSizeError();
  return contents;
}
export const projectFilename = (name: string): string => `${name.replace(/[^\p{L}\p{N}._ -]/gu, '').trim().slice(0, 80) || 'gear-project'}.gear.json`;
