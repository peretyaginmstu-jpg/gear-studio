/** What the Pro package contains and what it costs. Price 0 = free early access (no payment configured). */
export const proContents = [
  { id: 'stl', title: 'STL высокой детализации', hint: 'Плавные боковины зубьев для печати и обработки' },
  { id: 'dxf', title: 'Контур DXF', hint: 'Для лазера, гидроабразива, электроэрозии' },
  { id: 'pdf', title: 'Размерный лист PDF', hint: 'Три проекции, габариты и параметры' },
  { id: 'passport', title: 'Паспорт модели', hint: 'Все параметры и происхождение данных' },
] as const;

export interface ProOffer { priceRub: number; paymentsEnabled: boolean; source: 'early-access' | 'layers' }
export const earlyAccessOffer: ProOffer = { priceRub: 0, paymentsEnabled: false, source: 'early-access' };
export const priceLabel = (offer: ProOffer) => offer.priceRub > 0 ? `${offer.priceRub.toLocaleString('ru-RU')} ₽` : 'Бесплатно';

// ---------- Phase 2: paid Pro through Layers (YooKassa) ----------
const proApi = (base: string, path: string) => `${base}/api/v1/integrations/gear-studio/pro${path}`;
const proToken = /^[A-Za-z0-9_-]{20,64}$/;
export type ProStatus = 'pending' | 'paid' | 'cancelled';
export interface ProPurchaseState { status: ProStatus; title: string; price_rub: number; download_url: string | null }

async function proCall<T>(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<T> {
  let response: Response;
  try { response = await fetchImpl(url, { credentials: 'omit', ...init }); }
  catch { throw new Error('Layers недоступен. Проверьте соединение.'); }
  const data = await response.json().catch(() => null) as (T & { detail?: string }) | null;
  if (!response.ok) throw new Error(data?.detail || `Layers ответил кодом ${response.status}.`);
  return data as T;
}

/** Price from Layers; without Layers (or on any error) Pro stays free early access. */
export async function fetchProOffer(base: string, fetchImpl: typeof fetch = fetch): Promise<ProOffer> {
  if (!base) return earlyAccessOffer;
  try {
    const r = await proCall<{ price_rub: number; payments_enabled: boolean }>(proApi(base, '/offer'), {}, fetchImpl);
    return r.payments_enabled && r.price_rub > 0 ? { priceRub: r.price_rub, paymentsEnabled: true, source: 'layers' } : earlyAccessOffer;
  } catch { return earlyAccessOffer; }
}

export const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

export async function startProCheckout(base: string, input: { email: string; params: unknown; title: string; appVersion: string; returnUrl: string },
  fetchImpl: typeof fetch = fetch) {
  const r = await proCall<{ token: string; confirmation_url: string }>(proApi(base, '/checkout'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: input.email.trim(), params: input.params, title: input.title, app_version: input.appVersion, return_url: input.returnUrl.split('#')[0] }),
  }, fetchImpl);
  if (!proToken.test(r.token) || !/^https:\/\//.test(r.confirmation_url ?? '')) throw new Error('Layers вернул неполный ответ на оплату.');
  return r;
}

export async function proPurchaseState(base: string, token: string, fetchImpl: typeof fetch = fetch): Promise<ProPurchaseState> {
  const r = await proCall<ProPurchaseState>(proApi(base, `/purchases/${encodeURIComponent(token)}`), {}, fetchImpl);
  // Only an http(s) link from a paid purchase becomes a download button.
  return { ...r, download_url: r.status === 'paid' && typeof r.download_url === 'string' && /^https?:\/\//.test(r.download_url) ? r.download_url : null };
}

const RETURN_KEY = 'gear-pro-return', BOUGHT_KEY = 'gear-pro-purchases';
const store = (kind: 'session' | 'local') => { try { return kind === 'session' ? window.sessionStorage : window.localStorage; } catch { return null; } };

/** Reads #pro=<token> left by the payment page once, before the journey rewrites the address. */
export function captureProReturn(hash = window.location.hash): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('pro');
  if (!token) return null;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (!proToken.test(token)) return null;
  store('session')?.setItem(RETURN_KEY, token);
  return token;
}
/** The returned purchase waiting to be shown in the download sheet (read once). */
export function takeProReturn(): string | null {
  const s = store('session'), token = s?.getItem(RETURN_KEY) ?? null;
  s?.removeItem(RETURN_KEY);
  return token && proToken.test(token) ? token : null;
}

export interface RememberedPurchase { token: string; title: string; at: string }
export function rememberedPurchases(): RememberedPurchase[] {
  try { const list = JSON.parse(store('local')?.getItem(BOUGHT_KEY) ?? '[]'); return Array.isArray(list) ? list.filter(p => proToken.test(p?.token)) : []; } catch { return []; }
}
export function rememberPurchase(p: RememberedPurchase) {
  const list = [p, ...rememberedPurchases().filter(x => x.token !== p.token)].slice(0, 30);
  try { store('local')?.setItem(BOUGHT_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}
