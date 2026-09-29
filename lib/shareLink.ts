import { defaultModel, type ModelParams } from './model.ts';
import { modelParamsSchema } from './project.ts';

/** ?gear=… carries only the fields that differ from the example of that kind: short links, readable JSON. */
const toBase64Url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

export function encodeShare(params: ModelParams): string {
  const base = defaultModel(params.kind) as Record<string, unknown>, diff: Record<string, unknown> = { kind: params.kind };
  for (const [key, value] of Object.entries(params)) if (value !== undefined && base[key] !== value) diff[key] = value;
  return toBase64Url(JSON.stringify(diff));
}

export function decodeShare(raw: string): ModelParams | null {
  if (!raw || raw.length > 2000) return null;
  try {
    const diff = JSON.parse(fromBase64Url(raw)) as { kind?: unknown };
    if (!diff || typeof diff !== 'object' || typeof diff.kind !== 'string') return null;
    const parsed = modelParamsSchema.safeParse({ ...defaultModel(diff.kind as ModelParams['kind']), ...diff });
    if (!parsed.success) return null;
    const params = parsed.data as ModelParams;
    // Empty draft fields are fine inside a project, not in a link someone else opens.
    return Object.values(params).every(v => typeof v !== 'number' || Number.isFinite(v)) ? params : null;
  } catch { return null; }
}

export function shareUrl(params: ModelParams, location: Pick<Location, 'origin' | 'pathname'> = window.location) {
  return `${location.origin}${location.pathname}?gear=${encodeShare(params)}`;
}

/** Reads ?gear= once and removes it, so reloading the page does not open the shared model again. */
export function takeSharedModel(): ModelParams | null {
  const url = new URL(window.location.href), raw = url.searchParams.get('gear');
  if (raw === null) return null;
  url.searchParams.delete('gear');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  return decodeShare(raw);
}
