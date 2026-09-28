import { z } from 'zod';
import { layersUrl } from './layersOrder.ts';
import { newSampleInspection, type SampleInspection } from './sampleInspection.ts';
import type { ManufacturingDraft } from './manufacturing.ts';
import type { ModelMesh, ModelParams } from './model.ts';

/** Everything Gear Studio learns back from Layers. Token-scoped calls need no account. */
const api = (path: string) => `${layersUrl}/api/v1/integrations/gear-studio${path}`;
const token = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);

export const layersLinkSchema = z.object({
  token, orderUrl: z.string().url().max(600), sentAt: z.string().datetime(), revision: z.number().int().nonnegative(),
  stlSha256: z.string().regex(/^[0-9a-f]{64}$/), title: z.string().max(200), kind: z.enum(['order', 'repeat', 'revision']),
  orderCode: z.string().max(20).nullable(), importedMeasurements: z.array(z.string().max(40)).max(40),
}).strict();
export const layersFormSchema = z.object({
  links: z.array(layersLinkSchema).max(50),
  /** Opened from a Layers order: a new revision goes into that order. */
  revisionTarget: z.object({ token, orderCode: z.string().max(20).nullable() }).strict().nullable(),
}).partial().strict();
export type LayersLink = z.infer<typeof layersLinkSchema>;
export type RevisionTarget = NonNullable<z.infer<typeof layersFormSchema>['revisionTarget']>;

export interface LayersMeasurement {
  id: string; sample: string; measured_on: string; operator: string; instrument: string; conditions: string; notes: string;
  readings: { dimension: string; label: string; values: string; uncertainty: string }[];
}
export interface LayersOrderState {
  code: string; status: string; status_label: string; cancelled: boolean; price_rub: number; remaining_rub: number; paid: boolean;
  price_confirmed: boolean; material: string; color: string; qty: number; infill: number; print_progress: number;
  due_date: string | null; eta: string | null; updated_at: string; steps: { key: string; label: string; done: boolean }[];
  measurements: LayersMeasurement[]; track_url: string;
}
export interface LayersStatus { state: 'draft' | 'expired' | 'ordered'; expires_at: string; revision: boolean; order_url: string | null; order: LayersOrderState | null }
export interface LayersMaterial { key: string; label: string; price_per_gram: number; density: number; thinning_mm: number; min_module_mm: number; shrinkage_pct: number; max_temp_c: number; note: string }

async function call<T>(url: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  if (!layersUrl && !url.startsWith('http')) throw new Error('Адрес Layers не настроен.');
  let response: Response;
  try { response = await fetchImpl(url, { credentials: 'omit', ...init }); }
  catch { throw new Error('Layers недоступен. Проверьте соединение.'); }
  if (response.status === 204) return null as T;
  const data = await response.json().catch(() => null) as (T & { detail?: string }) | null;
  if (!response.ok) throw Object.assign(new Error(data?.detail || `Layers ответил кодом ${response.status}.`), { status: response.status, data });
  return data as T;
}

export const draftStatus = (t: string, f?: typeof fetch) => call<LayersStatus>(api(`/drafts/${encodeURIComponent(t)}/status`), {}, f);
export const repeatDraft = (t: string, f?: typeof fetch) => call<{ token: string; order_url: string; expires_at: string }>(api(`/drafts/${encodeURIComponent(t)}/repeat`), { method: 'POST' }, f);
export const draftManifest = (t: string, f?: typeof fetch) => call<{ manifest: { title?: string; model?: { params?: unknown } }; stl_sha256: string; order: { code: string; status: string } | null }>(api(`/drafts/${encodeURIComponent(t)}/manifest`), {}, f);
export const layersMaterials = (f?: typeof fetch) => call<{ materials: LayersMaterial[]; interpretation: string }>(api('/materials'), {}, f);

/** Suggestions for the chosen print material; the user decides whether to apply them. */
export function materialAdvice(params: ModelParams, material: LayersMaterial) {
  const notes: string[] = [];
  const thinning = params.backlash < material.thinning_mm - 1e-9 ? material.thinning_mm : null;
  if (thinning !== null) notes.push(`Для ${material.label} студия рекомендует утонение зуба ${material.thinning_mm} мм на колесо (сейчас ${params.backlash} мм).`);
  if (params.module < material.min_module_mm) notes.push(`Модуль ${params.module} мм меньше рекомендуемого для ${material.label} (${material.min_module_mm} мм): зуб может печататься неустойчиво.`);
  if (material.shrinkage_pct >= .5) notes.push(`Усадка около ${material.shrinkage_pct}% — проверьте диаметр вершин и отверстие на пробном образце.`);
  notes.push(`Рабочая температура до ${material.max_temp_c} °C. ${material.note}`);
  return { thinning, notes };
}

/** Workshop readings become a regular sample inspection (limits come from the reviewed requirements). */
export function inspectionFromLayers(mesh: ModelMesh, requirements: ManufacturingDraft, orderCode: string, m: LayersMeasurement): SampleInspection {
  const record = newSampleInspection(mesh, requirements);
  const byDimension = new Map(m.readings.map(r => [r.dimension, r]));
  const matched = record.readings.filter(r => byDimension.has(r.dimension)).length;
  if (!matched) throw new Error('В протоколе Layers нет размеров, для которых в требованиях заданы пределы.');
  const measuredOn = /^\d{4}-\d{2}-\d{2}$/.test(m.measured_on) ? m.measured_on : record.measuredOn;
  return { ...record, sample: `${m.sample} · ${orderCode}`.slice(0, 120), measuredOn, operator: `${m.operator} (Layers)`.slice(0, 120),
    instrument: m.instrument.slice(0, 240), conditions: m.conditions.slice(0, 500),
    notes: `Импорт из Layers, заказ ${orderCode}, протокол ${m.id}. ${m.notes}`.slice(0, 1000),
    readings: record.readings.map(r => { const src = byDimension.get(r.dimension);
      return src ? { dimension: r.dimension, values: src.values.slice(0, 500), uncertainty: src.uncertainty.slice(0, 24) } : r; }) };
}

// ---------- 7. account ----------
const TOKEN_KEY = 'layers-account-token', STATE_KEY = 'layers-connect-state';
const storage = () => { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } };
export const accountToken = () => storage()?.getItem(TOKEN_KEY) ?? null;

export function beginLayersLogin(): void {
  const state = crypto.randomUUID().replace(/-/g, '');
  try { sessionStorage.setItem(STATE_KEY, state); } catch { /* the check below then fails safely */ }
  const back = window.location.href.split('#')[0];
  // Layers is a separate site, not a Next.js route of this app.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `${layersUrl}/connect/gear-studio?${new URLSearchParams({ return: back, state })}`;
}

/** Reads #layers-token=…&state=… once, checks the state and removes the fragment from the address bar. */
export function completeLayersLogin(hash = window.location.hash): 'signed-in' | 'rejected' | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const raw = params.get('layers-token');
  if (!raw) return null;
  let expected: string | null = null;
  try { expected = sessionStorage.getItem(STATE_KEY); sessionStorage.removeItem(STATE_KEY); } catch { /* ignore */ }
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (!expected || params.get('state') !== expected || !/^[A-Za-z0-9_-]{20,80}$/.test(raw)) return 'rejected';
  storage()?.setItem(TOKEN_KEY, raw);
  return 'signed-in';
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
export interface LayersAccount { email: string; name: string; orders: (LayersOrderState & { title: string; draft_token: string })[] }
export interface CloudProject { id: string; name: string; revision: number; size: number; updated_at: string }
export const getAccount = (t: string, f?: typeof fetch) => call<LayersAccount>(api('/account'), { headers: bearer(t) }, f);
export async function signOut(t: string, f?: typeof fetch) {
  try { await call(api('/account'), { method: 'DELETE', headers: bearer(t) }, f); } finally { storage()?.removeItem(TOKEN_KEY); }
}
export const forgetAccount = () => storage()?.removeItem(TOKEN_KEY);
export const listCloudProjects = (t: string, f?: typeof fetch) => call<{ projects: CloudProject[] }>(api('/projects'), { headers: bearer(t) }, f);
export const getCloudProject = (t: string, id: string, f?: typeof fetch) => call<{ id: string; name: string; revision: number; data: string }>(api(`/projects/${id}`), { headers: bearer(t) }, f);
export const putCloudProject = (t: string, id: string, data: string, baseRevision: number | null, f?: typeof fetch) =>
  call<{ id: string; revision: number; updated_at: string }>(api(`/projects/${id}`), { method: 'PUT', headers: { ...bearer(t), 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, base_revision: baseRevision }) }, f);

/** Cloud revision the local copy was last synced against, per project id. */
const SYNC_KEY = 'layers-cloud-revisions';
export function syncedRevision(id: string): number | null {
  try { return JSON.parse(storage()?.getItem(SYNC_KEY) ?? '{}')[id] ?? null; } catch { return null; }
}
export function rememberSyncedRevision(id: string, revision: number) {
  try { const map = JSON.parse(storage()?.getItem(SYNC_KEY) ?? '{}'); map[id] = revision; storage()?.setItem(SYNC_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

// ---------- 5. referral ----------
const REF_KEY = 'layers-referrer';
/** utm_source=layers from the Layers site → remembered for this tab and sent with drafts. */
export function captureReferrer(search = window.location.search): string | null {
  const q = new URLSearchParams(search);
  if (q.get('utm_source') === 'layers') {
    const value = `layers-${(q.get('utm_medium') ?? 'site').replace(/[^a-z0-9-]/gi, '').slice(0, 20)}`;
    try { sessionStorage.setItem(REF_KEY, value); } catch { /* ignore */ }
    return value;
  }
  try { return sessionStorage.getItem(REF_KEY); } catch { return null; }
}
