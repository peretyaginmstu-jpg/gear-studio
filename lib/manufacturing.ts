import { z } from 'zod';
import { APP_VERSION } from './appVersion.ts';
import { isInternalKind, isRackKind, type ModelMesh } from './model.ts';

export const manufacturingPurposes = { unspecified: 'Нужно уточнить', prototype: 'Макет или пробная деталь', working: 'Рабочая передача' } as const;
export const manufacturingProcesses = { unspecified: 'Подобрать с исполнителем', fdm: 'FDM-печать', resin: 'Печать фотополимером', machining: 'Механическая обработка', other: 'Другой способ' } as const;
const dimensionId = z.enum(['bore', 'width', 'tipDiameter', 'rimDiameter', 'rackLength', 'rackHeight']);
export type ManufacturingDimensionId = z.infer<typeof dimensionId>;
export const manufacturingDimensionNames: Record<ManufacturingDimensionId, string> = { bore: 'Диаметр отверстия', width: 'Ширина или осевая длина',
  tipDiameter: 'Диаметр вершин', rimDiameter: 'Наружный диаметр обода', rackLength: 'Длина торцевого сечения рейки', rackHeight: 'Высота рейки' };
export const manufacturingDraftSchema = z.object({
  enabled: z.boolean(), purpose: z.enum(['unspecified', 'prototype', 'working']),
  process: z.enum(['unspecified', 'fdm', 'resin', 'machining', 'other']),
  quantity: z.string().max(12), material: z.string().max(120), application: z.string().max(500),
  operatingConditions: z.string().max(800), matingPart: z.string().max(500), notes: z.string().max(1000),
  tolerances: z.array(z.object({ dimension: dimensionId, lower: z.string().max(24), upper: z.string().max(24) }).strict()).max(6),
  review: z.object({ modelKey: z.string().max(6000), inputKey: z.string().max(16000), reviewedAt: z.string().datetime() }).strict().nullable(),
}).strict();
export type ManufacturingDraft = z.infer<typeof manufacturingDraftSchema>;
export const emptyManufacturingDraft = (): ManufacturingDraft => ({ enabled: false, purpose: 'unspecified', process: 'unspecified',
  quantity: '1', material: '', application: '', operatingConditions: '', matingPart: '', notes: '', tolerances: [], review: null });
export interface ManufacturingDimension { id: ManufacturingDimensionId; label: string; nominal: number }

/** Requirements refer to named nominal quantities, never to a projection's bounding box. */
export function manufacturingDimensions(mesh: ModelMesh): ManufacturingDimension[] {
  const p = mesh.params, d = mesh.dimensions;
  const rows: ManufacturingDimension[] = [{ id: 'width', nominal: p.width,
    label: p.kind === 'bevel' ? 'Ширина по образующей b' : p.kind === 'worm' ? 'Длина червяка по оси' : isRackKind(p.kind) ? 'Ширина рейки b' : 'Ширина венца b' }];
  if (isRackKind(p.kind)) return [...rows, { id: 'rackLength', label: 'Длина торцевого сечения рейки', nominal: d.rackLength },
    { id: 'rackHeight', label: 'Высота рейки', nominal: d.rackHeight }];
  if (isInternalKind(p.kind)) rows.push({ id: 'rimDiameter', label: 'Наружный диаметр обода', nominal: d.outsideDiameter });
  else if (p.bore > 0) rows.unshift({ id: 'bore', label: 'Диаметр отверстия', nominal: p.bore });
  rows.push({ id: 'tipDiameter', label: p.kind === 'bevel' ? 'Диаметр вершин на большом торце' : isInternalKind(p.kind) ? 'Диаметр вершин внутреннего венца' : 'Диаметр вершин', nominal: d.tipDiameter });
  return rows;
}

/** Canonical binding survives JSON key reordering. A new app release requires renewed review. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
const modelKey = (mesh: ModelMesh) => canonical({ appVersion: APP_VERSION, parameters: mesh.params });
const inputKey = (draft: ManufacturingDraft) => canonical({ ...draft, review: null, enabled: true });
const decimal = (value: string): number | null => {
  const normal = value.trim().replace(/−/g, '-').replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d{1,6})?|\.\d{1,6})$/.test(normal)) return null;
  const number = Number(normal); return Number.isFinite(number) ? number : null;
};
export const manufacturingNumber = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 6, useGrouping: false });
export const signedDeviation = (value: number) => `${value > 0 ? '+' : ''}${manufacturingNumber(value)}`;

export function manufacturingReport(mesh: ModelMesh, input?: ManufacturingDraft | null) {
  if (!input) return null;
  const draft = manufacturingDraftSchema.parse(input);
  if (!draft.enabled) return null;
  const issues: string[] = [], options = manufacturingDimensions(mesh), seen = new Set<string>();
  const quantity = /^\d+$/.test(draft.quantity.trim()) ? Number(draft.quantity) : NaN;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10_000) issues.push('Количество: целое число от 1 до 10 000.');
  if (draft.purpose === 'unspecified') issues.push('Укажите назначение: пробная деталь или рабочая передача.');
  const dimensions = draft.tolerances.map(row => {
    const spec = options.find(option => option.id === row.dimension), lower = decimal(row.lower), upper = decimal(row.upper);
    const errors: string[] = [];
    if (seen.has(row.dimension)) errors.push('Размер указан дважды.');
    seen.add(row.dimension);
    if (!spec) errors.push('Размер отсутствует у текущей модели. Выберите другой или уберите строку.');
    if (lower === null || upper === null) errors.push('Введите оба отклонения в мм, до шести знаков после запятой.');
    else if (lower >= upper) errors.push('Верхнее отклонение должно быть больше нижнего.');
    else if (spec && (!(spec.nominal + lower > 0) || !Number.isFinite(spec.nominal + upper))) errors.push('Предельные размеры должны быть конечными и больше нуля.');
    issues.push(...errors.map(error => `${spec?.label ?? manufacturingDimensionNames[row.dimension]}: ${error}`));
    return { dimension: row.dimension, label: spec?.label ?? manufacturingDimensionNames[row.dimension], nominal: spec?.nominal ?? null,
      lowerDeviation: lower, upperDeviation: upper, lowerInput: row.lower, upperInput: row.upper,
      minimum: !errors.length && spec && lower !== null ? spec.nominal + lower : null,
      maximum: !errors.length && spec && upper !== null ? spec.nominal + upper : null, errors };
  });
  const matchesModel = !!draft.review && draft.review.modelKey === modelKey(mesh);
  const matchesInputs = !!draft.review && draft.review.inputKey === inputKey(draft);
  const status: 'needs-review' | 'reviewed' | 'draft' = draft.review && (!matchesModel || !matchesInputs) ? 'needs-review' : draft.review && !issues.length ? 'reviewed' : 'draft';
  const clarifications = [!draft.material.trim() && 'Марка материала', draft.process === 'unspecified' && 'Способ изготовления',
    !draft.application.trim() && 'Применение детали', !draft.matingPart.trim() && 'Ответная деталь и условия сопряжения',
    draft.purpose === 'working' && !draft.operatingConditions.trim() && 'Нагрузка, обороты, температура, смазка и ресурс',
    !draft.tolerances.length && 'Требуемые предельные размеры и метод контроля',
    'Возможность изготовить и проверить деталь по этим требованиям'].filter((value): value is string => !!value);
  return { schema: 'zatseplenie.manufacturing.v1', status, source: 'user-entered; not-inferred-from-photo',
    request: { purpose: draft.purpose, process: draft.process, quantity: Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 10_000 ? quantity : null,
      quantityInput: draft.quantity, material: draft.material.trim(), application: draft.application.trim(), operatingConditions: draft.operatingConditions.trim(),
      matingPart: draft.matingPart.trim(), notes: draft.notes.trim() },
    dimensions, issues, clarifications, review: draft.review ? { reviewedAt: draft.review.reviewedAt, matchesModel, matchesInputs, modelKey: draft.review.modelKey } : null,
    interpretation: 'Требования пользователя к готовой детали. Номинальная геометрия STL не меняется; припуски и компенсацию согласуют с исполнителем. Проверка пользователем не является согласованием исполнителя или гарантией изготовления.' };
}
export type ManufacturingReport = NonNullable<ReturnType<typeof manufacturingReport>>;
export const manufacturingStatus = { draft: 'Черновик требований', 'needs-review': 'Требования нужно пересмотреть', reviewed: 'Требования сверены с моделью' } as const;

export function reviewManufacturing(mesh: ModelMesh, draft: ManufacturingDraft, reviewedAt = new Date().toISOString()): ManufacturingDraft {
  const report = manufacturingReport(mesh, draft);
  if (!report || report.issues.length) throw new Error(report?.issues[0] || 'Сначала включите требования к изготовлению.');
  return manufacturingDraftSchema.parse({ ...draft, review: { modelKey: modelKey(mesh), inputKey: inputKey(draft), reviewedAt } });
}

/** Print settings describe an FDM trial; different requirements must remain visible. */
export function manufacturingPrintNotes(report: ManufacturingReport | null, material: string): string[] {
  if (!report) return [];
  const notes: string[] = [];
  if (report.status !== 'reviewed') notes.push('Требования к изготовлению ещё не сверены с текущей моделью.');
  if (!['unspecified', 'fdm'].includes(report.request.process)) notes.push(`В требованиях выбран способ «${manufacturingProcesses[report.request.process]}». Здесь оценивается только пробная FDM-печать.`);
  if (report.request.material && report.request.material.toLocaleUpperCase('ru-RU') !== material.toLocaleUpperCase('ru-RU'))
    notes.push(`В требованиях материал «${report.request.material}», в настройках пробной печати — ${material}. Согласуйте различие; одно поле не заменяет другое.`);
  return notes;
}
