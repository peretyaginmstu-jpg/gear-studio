import { z } from 'zod';
import { APP_VERSION } from './appVersion.ts';
import { modelNames, type ModelMesh } from './model.ts';
import { manufacturingDraftSchema, manufacturingReport, type ManufacturingDraft } from './manufacturing.ts';

export const MAX_INSPECTIONS = 20;
export const MAX_INSPECTION_READINGS = 12;
const dimension = z.enum(['bore', 'width', 'tipDiameter', 'rimDiameter', 'rackLength', 'rackHeight']);
const finite = z.number().finite();
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}` : JSON.stringify(value);
const decimal = (raw: string): number | null => {
  const s = raw.trim().replace(/−/g, '-').replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d{1,6})?|\.\d{1,6})$/.test(s)) return null;
  const n = Number(s); return Number.isFinite(n) ? n : null;
};
const limitSchema = z.object({ dimension, label: z.string().max(120), nominal: finite.positive(), lower: finite, upper: finite }).strict()
  .refine(r => r.lower < r.upper && r.nominal + r.lower > 0 && Number.isFinite(r.nominal + r.upper));
const basisSchema = z.object({ appVersion: z.string().max(30), modelName: z.string().max(120), modelKey: z.string().max(6000), requirementsKey: z.string().max(16000),
  parameters: z.record(z.union([finite, z.string().max(120)])).refine(p => Object.keys(p).length <= 64),
  requirements: manufacturingDraftSchema, limits: z.array(limitSchema).min(1).max(6),
}).strict().refine(b => b.modelKey === canonical({ appVersion: b.appVersion, parameters: b.parameters }) && b.requirements.enabled
  && b.requirements.review?.modelKey === b.modelKey && b.requirements.review.inputKey === b.requirementsKey
  && b.requirementsKey === canonical({ ...b.requirements, review: null, enabled: true })
  && b.limits.length === b.requirements.tolerances.length && new Set(b.limits.map(r => r.dimension)).size === b.limits.length
  && b.limits.every((r, i) => { const t = b.requirements.tolerances[i]; return r.dimension === t.dimension && r.lower === decimal(t.lower) && r.upper === decimal(t.upper); }),
  'Несогласованные исходные требования протокола.');
export const sampleInspectionSchema = z.object({ id: z.string().uuid(), createdAt: z.string().datetime(), basedOn: z.string().uuid().nullable(),
  basis: basisSchema, sample: z.string().max(120), measuredOn: z.string().max(10), operator: z.string().max(120), instrument: z.string().max(240),
  conditions: z.string().max(500), uncertaintyBasis: z.string().max(500), notes: z.string().max(1000),
  readings: z.array(z.object({ dimension, values: z.string().max(500), uncertainty: z.string().max(24) }).strict()).min(1).max(6),
  recorded: z.object({ at: z.string().datetime(), contentKey: z.string().max(40000) }).strict().nullable(),
}).strict().refine(r => r.readings.length === r.basis.limits.length && r.readings.every((row, i) => row.dimension === r.basis.limits[i].dimension), 'Размеры протокола не соответствуют его исходному заданию.');
export const sampleInspectionsSchema = z.array(sampleInspectionSchema).max(MAX_INSPECTIONS)
  .refine(rows => new Set(rows.map(row => row.id)).size === rows.length, 'Повторяющиеся номера протоколов.');
export type SampleInspection = z.infer<typeof sampleInspectionSchema>;
const recordKey = (record: SampleInspection) => canonical({ ...record, recorded: null });
export const inspectionResultLabels = {
  incomplete: 'Не все измерения заполнены', outside: 'Есть значения вне пределов', overlap: 'Интервал пересекает границу',
  'point-only': 'Числа в пределах; неопределённость не задана', inside: 'Введённые интервалы в пределах',
} as const;
export type InspectionResult = keyof typeof inspectionResultLabels;
export const inspectionRule = 'Каждый отсчёт сравнивается отдельно с сохранёнными пределами. При заданной U сравнивается интервал y ± U; касание границы включено. Без U сравнивается только число. Усреднение и автоматическая приёмка детали не выполняются.';
export const inspectionSources = [
  { title: 'NIST TN 1297, section 6: expanded uncertainty', url: 'https://www.nist.gov/pml/nist-technical-note-1297/nist-tn-1297-6-expanded-uncertainty' },
  { title: 'JCGM 106:2012: measurement uncertainty in conformity assessment', url: 'https://www.bipm.org/documents/20126/50065304/JCGM_106_2012_E.pdf/fe9537d2-e7d7-e146-5abb-2649c3450b25' },
];

export function newSampleInspection(mesh: ModelMesh, requirements: ManufacturingDraft, now = new Date().toISOString()): SampleInspection {
  const report = manufacturingReport(mesh, requirements);
  if (!report || report.status !== 'reviewed' || !report.dimensions.length) throw new Error('Сначала задайте предельные размеры в требованиях мастерской и сверьте их с моделью.');
  return sampleInspectionSchema.parse({ id: crypto.randomUUID(), createdAt: now, basedOn: null,
    basis: { appVersion: APP_VERSION, modelName: modelNames[mesh.params.kind], parameters: { ...mesh.params },
      modelKey: requirements.review!.modelKey, requirementsKey: requirements.review!.inputKey, requirements: structuredClone(requirements),
      limits: report.dimensions.map(r => ({ dimension: r.dimension, label: r.label, nominal: r.nominal!, lower: r.lowerDeviation!, upper: r.upperDeviation! })) },
    sample: '', measuredOn: now.slice(0, 10), operator: '', instrument: '', conditions: '', uncertaintyBasis: '', notes: '',
    readings: report.dimensions.map(r => ({ dimension: r.dimension, values: '', uncertainty: '' })), recorded: null });
}

/** Copy for a correction preserves the old record and its original limits, including historical ones. */
export function copySampleInspection(record: SampleInspection, now = new Date().toISOString()): SampleInspection {
  return sampleInspectionSchema.parse({ ...structuredClone(record), id: crypto.randomUUID(), createdAt: now, basedOn: record.id, recorded: null });
}

// Only absorb floating-point arithmetic noise (a few ulps), never a manufacturing allowance.
const compare = (a: number, b: number) => Math.abs(a - b) <= 8 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) ? 0 : a < b ? -1 : 1;
function resultOf(states: InspectionResult[]): InspectionResult {
  for (const state of ['incomplete', 'outside', 'overlap', 'point-only'] as const) if (states.includes(state)) return state;
  return 'inside';
}
export function sampleInspectionReport(recordInput: SampleInspection, mesh: ModelMesh, requirements?: ManufacturingDraft) {
  const record = sampleInspectionSchema.parse(recordInput), current = manufacturingReport(mesh, requirements);
  const matchesCurrent = current?.status === 'reviewed' && current.review?.modelKey === record.basis.modelKey
    && requirements?.review?.inputKey === record.basis.requirementsKey && current.dimensions.length === record.basis.limits.length
    && current.dimensions.every((r, i) => { const limit = record.basis.limits[i]; return r.dimension === limit.dimension && r.nominal === limit.nominal && r.lowerDeviation === limit.lower && r.upperDeviation === limit.upper; });
  const issues: string[] = [];
  if (!record.sample.trim()) issues.push('Укажите обозначение образца.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.measuredOn) || !Number.isFinite(Date.parse(record.measuredOn)) || new Date(record.measuredOn).toISOString().slice(0, 10) !== record.measuredOn) issues.push('Укажите существующую дату измерений.');
  if (!record.instrument.trim()) issues.push('Укажите инструмент и метод измерения.');
  const rows = record.readings.map((r, index) => {
    const spec = record.basis.limits[index], minimum = spec.nominal + spec.lower, maximum = spec.nominal + spec.upper;
    const tokens = r.values.trim() ? r.values.split(/[;\n]/).map(v => v.trim()) : [];
    const errors: string[] = [];
    if (!tokens.length || tokens.length > MAX_INSPECTION_READINGS) errors.push(`Введите от 1 до ${MAX_INSPECTION_READINGS} отсчётов; разделитель — точка с запятой или новая строка.`);
    const values = tokens.map(decimal), uncertainty = r.uncertainty.trim() ? decimal(r.uncertainty) : null;
    if (values.some(v => v === null || !(v > 0) || v > 1_000_000)) errors.push('Отсчёты: положительные размеры в мм до 1 000 000, не более шести знаков после запятой.');
    if (r.uncertainty.trim() && (uncertainty === null || uncertainty <= 0 || uncertainty > 1_000_000)) errors.push('U: положительное число в мм до 1 000 000; неизвестное оставьте пустым, не заменяйте нулём.');
    if (uncertainty !== null && !record.uncertaintyBasis.trim()) errors.push('Укажите основание для U и коэффициент охвата или оговорённый уровень охвата.');
    const readings = values.slice(0, MAX_INSPECTION_READINGS).map((value, i) => {
      if (errors.length || value === null) return { input: tokens[i], value, low: null, high: null, result: 'incomplete' as InspectionResult };
      // Inputs have at most six decimals; integer micromillimetres avoid cancellation noise in exported intervals.
      const units = Math.round(value * 1e6), radius = Math.round((uncertainty ?? 0) * 1e6);
      const low = (units - radius) / 1e6, high = (units + radius) / 1e6;
      const result: InspectionResult = compare(high, minimum) < 0 || compare(low, maximum) > 0 ? 'outside'
        : compare(low, minimum) >= 0 && compare(high, maximum) <= 0 ? uncertainty === null ? 'point-only' : 'inside' : 'overlap';
      return { input: tokens[i], value, low, high, result };
    });
    issues.push(...errors.map(e => `${spec.label}: ${e}`));
    return { ...spec, minimum, maximum, input: r.values, uncertaintyInput: r.uncertainty, uncertainty, readings, errors,
      result: errors.length ? 'incomplete' as InspectionResult : resultOf(readings.map(v => v.result)) };
  });
  const recorded = !!record.recorded && record.recorded.contentKey === recordKey(record) && !issues.length;
  return { schema: 'zatseplenie.sample-inspection.v1', id: record.id, basedOn: record.basedOn, createdAt: record.createdAt,
    recordState: recorded ? 'recorded' as const : 'draft' as const, recordedAt: recorded ? record.recorded!.at : null,
    reference: matchesCurrent ? 'current' as const : 'historical' as const, basis: structuredClone(record.basis),
    sample: record.sample, measuredOn: record.measuredOn, operator: record.operator, instrument: record.instrument,
    conditions: record.conditions, uncertaintyBasis: record.uncertaintyBasis, notes: record.notes,
    result: issues.length ? 'incomplete' as InspectionResult : resultOf(rows.map(r => r.result)), rows, issues, rule: inspectionRule,
    interpretation: 'Измерения введены пользователем. Фиксация записи не является подписью, поверкой инструмента или приёмкой детали. Сравнение отдельных размеров не подтверждает работу передачи, материал, прочность или ресурс.', sources: inspectionSources };
}
export type SampleInspectionReport = ReturnType<typeof sampleInspectionReport>;
export function recordSampleInspection(record: SampleInspection, mesh: ModelMesh, requirements?: ManufacturingDraft, now = new Date().toISOString()): SampleInspection {
  const report = sampleInspectionReport(record, mesh, requirements);
  if (report.issues.length) throw new Error(report.issues[0]);
  return sampleInspectionSchema.parse({ ...record, recorded: { at: now, contentKey: recordKey(record) } });
}
export const sampleInspectionReports = (rows: SampleInspection[] | undefined, mesh: ModelMesh, requirements?: ManufacturingDraft) =>
  sampleInspectionsSchema.parse(rows ?? []).map(row => sampleInspectionReport(row, mesh, requirements));
