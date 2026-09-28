"use client";
import { useCallback, useEffect, useState } from 'react';
import { CloudUpload, CloudDownload, LogIn, LogOut, LoaderCircle } from 'lucide-react';
import { layersUrl } from '@/lib/layersOrder';
import { accountToken, beginLayersLogin, forgetAccount, getAccount, getCloudProject, listCloudProjects, putCloudProject, rememberSyncedRevision,
  signOut, syncedRevision, type CloudProject, type LayersAccount as Account } from '@/lib/layersLink';

/**
 * Layers account inside the project library: cloud copies of projects and the account's gear orders.
 * Sync is explicit: «Сохранить в Layers» never overwrites a newer cloud revision silently.
 */
export function LayersAccount({ projectId, serialize, openCloud, disabled }: {
  projectId: string; serialize: () => Promise<string | null>; openCloud: (data: string, cloudRevision: number) => Promise<void>; disabled: boolean;
}) {
  const [token, setToken] = useState<string | null>(null), [account, setAccount] = useState<Account | null>(null);
  const [projects, setProjects] = useState<CloudProject[]>([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(async (t: string) => {
    try { const [a, p] = await Promise.all([getAccount(t), listCloudProjects(t)]); setAccount(a); setProjects(p.projects); }
    catch (e) { if ((e as { status?: number }).status === 401) { forgetAccount(); setToken(null); setAccount(null); } setMessage(e instanceof Error ? e.message : 'Layers недоступен.'); }
  }, []);
  useEffect(() => { const t = accountToken(); const timer = setTimeout(() => { setToken(t); if (t) void load(t); }, 0); return () => clearTimeout(timer); }, [load]);
  if (!layersUrl) return null;
  const act = async (task: () => Promise<void>) => { setBusy(true); setMessage(''); try { await task(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось выполнить.'); } finally { setBusy(false); } };
  const save = () => act(async () => {
    const data = await serialize(); if (!data || !token) return;
    try { const r = await putCloudProject(token, projectId, data, syncedRevision(projectId)); rememberSyncedRevision(projectId, r.revision); setMessage(`Сохранено в Layers, версия ${r.revision}.`); await load(token); }
    catch (e) { if ((e as { status?: number }).status === 409) throw new Error('В аккаунте более новая версия этого проекта (с другого устройства). Откройте её ниже или скачайте файл, чтобы сохранить обе.'); throw e; }
  });
  if (!token) return <section className="layers-account" aria-label="Аккаунт Layers">
    <h3>Аккаунт Layers</h3><p>Храните проекты в аккаунте студии и открывайте на другом устройстве; заказы из генератора видны в одном месте.</p>
    <button type="button" className="secondary-button" disabled={disabled} onClick={beginLayersLogin}><LogIn size={16} /> Войти через Layers</button>
    {message && <p className="field-help">{message}</p>}
  </section>;
  const current = projects.find(p => p.id === projectId);
  return <section className="layers-account" aria-label="Аккаунт Layers">
    <div className="layers-orders-head"><h3>Аккаунт Layers{account ? ` · ${account.email}` : ''}</h3>
      <button type="button" className="text-button" disabled={busy} onClick={() => act(async () => { await signOut(token); setToken(null); setAccount(null); setProjects([]); })}><LogOut size={15} /> Выйти</button></div>
    <button type="button" className="secondary-button" disabled={busy || disabled} onClick={save}>{busy ? <LoaderCircle size={16} className="project-spinner" /> : <CloudUpload size={16} />} Сохранить текущий проект в Layers
      {current ? ` (в аккаунте версия ${current.revision}${syncedRevision(projectId) !== current.revision ? ', отличается от этой копии' : ''})` : ''}</button>
    {message && <p className="field-help" role="status">{message}</p>}
    {projects.length > 0 && <ul className="cloud-projects">{projects.map(p => <li key={p.id}><div><strong>{p.name}</strong><span>версия {p.revision} · {new Date(p.updated_at).toLocaleString('ru-RU')}{p.id === projectId ? ' · открыт сейчас' : ''}</span></div>
      <button type="button" className="secondary-button" disabled={busy || disabled} onClick={() => act(async () => {
        if (p.id === projectId && !confirm('Заменить открытую копию версией из аккаунта Layers? Локальные несохранённые в Layers изменения будут потеряны; скачайте файл, если они нужны.')) return;
        const r = await getCloudProject(token, p.id); await openCloud(r.data, r.revision);
      })}><CloudDownload size={16} /> Открыть</button></li>)}</ul>}
    {account && account.orders.length > 0 && <p className="field-help">Заказов из генератора в аккаунте: {account.orders.length}. Последний: {account.orders[0].code} — {account.orders[0].status_label}.</p>}
  </section>;
}
