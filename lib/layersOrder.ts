import { APP_VERSION } from './appVersion.ts';
import { manufacturingReport, type ManufacturingDraft } from './manufacturing.ts';
import { modelDimensionsForReport, modelNames, type ModelParams } from './model.ts';
import { prepareModelExport } from './modelExport.ts';

/** Layers print studio (separate site). Unset → the order button is hidden. */
export const layersUrl = (process.env.NEXT_PUBLIC_LAYERS_URL ?? '').replace(/\/+$/, '');
export const LAYERS_MANIFEST_SCHEMA = 'zatseplenie.layers-draft.v1';

export interface LayersDraftInput {
  params: ModelParams; origin: string; evidence: unknown; projectName: string; revision: number;
  manufacturing?: ManufacturingDraft;
}
export interface LayersDraftLink { token: string; expiresAt: string; orderUrl: string }

async function sha256Hex(bytes: ArrayBuffer | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function modelTitle(params: ModelParams): string {
  const count = params.kind === 'worm' ? `z₁=${params.wormStarts ?? 1}` : `z=${params.teeth}`;
  return `${modelNames[params.kind]} ${count} m=${Number(params.module.toFixed(4))}`;
}

/**
 * Standard STL plus what the studio needs to agree before printing. Photos, contacts and the project
 * history are not sent. The idempotency key depends only on the content, so a repeated click reuses
 * the same Layers draft instead of creating another one.
 */
export async function prepareLayersDraft(input: LayersDraftInput) {
  const exported = prepareModelExport(input.params, 'standard', { origin: input.origin, evidence: input.evidence, manufacturing: input.manufacturing });
  const stlSha256 = await sha256Hex(exported.stl);
  const suffix = input.params.kind === 'worm' ? `starts${input.params.wormStarts ?? 1}` : `z${input.params.teeth}`;
  const stlName = `gear-${input.params.kind}-${suffix}-m${input.params.module.toFixed(3)}-standard.stl`;
  const manifest = {
    schema: LAYERS_MANIFEST_SCHEMA, units: 'mm', appVersion: APP_VERSION, title: modelTitle(input.params),
    project: { name: input.projectName.slice(0, 200), revision: input.revision },
    model: { kind: input.params.kind, kindName: modelNames[input.params.kind], params: input.params,
      dimensions: modelDimensionsForReport(exported.mesh), origin: input.origin.slice(0, 2000) },
    stl: { name: stlName, sha256: stlSha256, bytes: exported.stl.byteLength, triangles: exported.validation.triangles, preset: 'standard' },
    manufacturing: manufacturingReport(exported.mesh, input.manufacturing),
    notVerified: exported.passport.notVerified,
  };
  const idempotencyKey = (await sha256Hex(`${stlSha256}:${JSON.stringify(manifest)}`)).slice(0, 48);
  return { stl: exported.stl, stlName, manifest, idempotencyKey };
}

/** Plain multipart POST (no custom headers → no CORS preflight); the token comes back in a URL fragment. */
export async function sendLayersDraft(draft: Awaited<ReturnType<typeof prepareLayersDraft>>, baseUrl = layersUrl,
  fetchImpl: typeof fetch = fetch): Promise<LayersDraftLink> {
  baseUrl = baseUrl.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Адрес Layers не настроен.');
  const form = new FormData();
  form.append('stl', new Blob([draft.stl], { type: 'model/stl' }), draft.stlName);
  form.append('manifest', JSON.stringify(draft.manifest));
  form.append('idempotency_key', draft.idempotencyKey);
  let response: Response;
  try { response = await fetchImpl(`${baseUrl}/api/v1/integrations/gear-studio/drafts`, { method: 'POST', body: form, credentials: 'omit' }); }
  catch { throw new Error('Layers недоступен. Проверьте соединение и повторите; STL можно скачать и отправить вручную.'); }
  const data = await response.json().catch(() => null) as { token?: string; expires_at?: string; order_url?: string; detail?: string } | null;
  if (!response.ok || !data?.token || !data.order_url) throw new Error(data?.detail || `Layers отклонил модель (код ${response.status}).`);
  const url = new URL(data.order_url);
  if (url.origin !== new URL(baseUrl).origin || url.hash !== `#${data.token}`) throw new Error('Layers вернул неожиданную ссылку на заказ.');
  return { token: data.token, expiresAt: data.expires_at ?? '', orderUrl: data.order_url };
}
