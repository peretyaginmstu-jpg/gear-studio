"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Archive, ArchiveRestore, Check, Download, FolderOpen, LoaderCircle, Plus, Upload, Copy, RefreshCw, History, MoreHorizontal } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { APP_VERSION } from '@/lib/appVersion';
import { newProject, parseProject, projectFilename, restoreProjectJourney, serializeProject, snapshotJourney, MAX_PROJECT_BYTES, type ProjectDocument } from '@/lib/project';
import { listProjects, openStoredProject, readProject, setProjectArchived, writeProject, storageErrorMessage, ProjectConflictError, type ProjectListEntry } from '@/lib/projectStorage';
import { filterProjectLibrary, type ProjectLibraryView } from '@/lib/projectLibrary';
import type { JourneyState } from '@/lib/journey';
import { downloadBlob } from '@/lib/download';
import { ProjectContext, type ProjectDraftStore } from './ProjectContext';
import { addProjectVersion, restoreProjectVersion, forkProjectVersion } from '@/lib/projectVersions';
import { ProjectHistory } from './ProjectHistory';
import { LayersAccount } from './LayersAccount';
import { backupEntry, markBackedUp, shouldRemindBackup, snoozeBackup } from '@/lib/backupReminder';
import { layersUrl, modelTitle } from '@/lib/layersOrder';
import { captureReferrer, completeLayersLogin, draftManifest, rememberSyncedRevision } from '@/lib/layersLink';
import { captureProReturn } from '@/lib/proOffer';
import { takeSharedModel } from '@/lib/shareLink';

type LoadedProject = { document: ProjectDocument; revision: number | null; restored: boolean; notice?: string; archivedAt?: string | null; focusProject?: boolean };
export interface ProjectSession { initial: JourneyState | undefined; onJourney: (state: JourneyState) => void; controls: ReactNode; busy: boolean; archived: boolean; name: string }
type StudioComponent = ComponentType<{ project: ProjectSession }>;

export function ProjectWorkspace({ component }: { component: StudioComponent }) {
  const [loaded, setLoaded] = useState<LoadedProject | null>(null), [generation, setGeneration] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: LoadedProject;
      captureReferrer();
      const login = completeLayersLogin();
      captureProReturn();
      const fromLayers = await openLayersDraft();
      if (fromLayers) { if (!cancelled) setLoaded(fromLayers); return; }
      const shared = await openSharedModel();
      if (shared) { if (!cancelled) setLoaded(shared); return; }
      try {
        const { activeId } = await listProjects();
        if (activeId) {
          const saved = await readProject(activeId);
          next = { document: saved.project, revision: saved.revision, archivedAt: saved.archivedAt, restored: true };
        } else next = { document: newProject(), revision: null, restored: false };
      } catch (error) {
        next = { document: newProject(), revision: null, restored: false,
          notice: `Не удалось открыть предыдущий проект. Его запись не изменена. ${error instanceof Error ? error.message : storageErrorMessage(error)}` };
      }
      if (login) next = { ...next, notice: login === 'signed-in' ? 'Аккаунт Layers подключён: проекты можно хранить в нём, заказы привязываются к аккаунту.' : 'Вход через Layers не подтверждён. Попробуйте ещё раз из «Мои проекты».' };
      if (!cancelled) setLoaded(next);
    })();
    return () => { cancelled = true; };
  }, []);
  const activate = useCallback((next: LoadedProject) => { setLoaded(next); setGeneration(value => value + 1); }, []);
  if (!loaded) return <main className="project-loading" aria-live="polite"><LoaderCircle size={25} className="project-spinner" /><h1>Открываем мастерскую</h1><p>Проверяем сохранённые на этом устройстве проекты…</p></main>;
  return <ProjectEditor key={`${loaded.document.id}-${generation}`} loaded={loaded} activate={activate} component={component} />;
}

/** #layers-draft=<токен>: модель заказа из админки Layers открывается отдельным проектом; ревизия пойдёт в тот же заказ. */
async function openLayersDraft(): Promise<LoadedProject | null> {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('layers-draft');
  if (!token) return null;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (!layersUrl || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  try {
    const { manifest, order } = await draftManifest(token);
    const doc = newProject();
    doc.journey = { ...doc.journey, stage: 'input', mode: 'manual', manualDraft: manifest.model?.params as typeof doc.journey.manualDraft };
    doc.forms = { layers: { identity: 'default', values: { links: [], revisionTarget: { token, orderCode: order?.code ?? null } } } };
    const checked = parseProject(serializeProject(doc));
    checked.name = (order ? `Заказ ${order.code}: ` : '') + (manifest.title || modelTitle(checked.journey.manualDraft));
    checked.name = checked.name.slice(0, 120);
    const revision = await writeProject(checked, null);
    return { document: checked, revision, restored: true, focusProject: true,
      notice: `Модель заказа ${order?.code ?? ''} открыта из Layers отдельным проектом. Измените параметры, постройте и проверьте модель — в оформлении появится «Ревизия в заказ».` };
  } catch (error) {
    return { document: newProject(), revision: null, restored: false,
      notice: `Не удалось открыть модель из Layers: ${error instanceof Error ? error.message : 'ошибка'}. Текущие проекты не изменены.` };
  }
}

/** ?gear=…: a model someone shared opens as its own project on the first screen; other projects stay untouched. */
async function openSharedModel(): Promise<LoadedProject | null> {
  const hasLink = new URLSearchParams(window.location.search).has('gear');
  const params = takeSharedModel();
  if (!params) return hasLink ? { document: newProject(), revision: null, restored: false, notice: 'Ссылка на модель повреждена или устарела. Открыт пример — задайте размеры сами.' } : null;
  try {
    const doc = newProject();
    doc.journey = { ...doc.journey, stage: 'start', mode: 'manual', manualDraft: params as typeof doc.journey.manualDraft };
    const checked = parseProject(serializeProject(doc));
    checked.name = `По ссылке: ${modelTitle(params)}`.slice(0, 120);
    const revision = await writeProject(checked, null);
    return { document: checked, revision, restored: true, notice: 'Открыта модель по ссылке — отдельным проектом. Ваши прежние проекты — в «Мои проекты».' };
  } catch (error) {
    return { document: newProject(), revision: null, restored: false,
      notice: `Не удалось открыть модель по ссылке: ${error instanceof Error ? error.message : 'ошибка'}.` };
  }
}

function ProjectEditor({ loaded, activate, component: Studio }: { loaded: LoadedProject; activate: (value: LoadedProject) => void; component: StudioComponent }) {
  const archived = !!loaded.archivedAt;
  const initial = useMemo(() => loaded.restored ? restoreProjectJourney(loaded.document) : undefined, [loaded]);
  const document = useRef(loaded.document), journey = useRef<JourneyState | null>(initial ?? null);
  const revision = useRef(loaded.revision), serial = useRef(1), savedSerial = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), saving = useRef<Promise<boolean> | null>(null);
  const failed = useRef(false), failureMessage = useRef<string | null>(null), alive = useRef(true);
  const [name, setName] = useState(loaded.document.name), [status, setStatus] = useState<'saving' | 'saved' | 'error'>(archived ? 'saved' : 'saving');
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState(loaded.notice ?? (loaded.restored && !archived
    ? initial?.built ? 'Проект восстановлен на этом устройстве. Сохранённая модель пересчитана; проверьте её перед получением файлов.'
      : 'Черновик восстановлен на этом устройстве. Продолжите ввод с сохранёнными фото, измерениями и ответами.' : null));
  const [libraryOpen, setLibraryOpen] = useState(false), [entries, setEntries] = useState<ProjectListEntry[]>([]);
  const [libraryView, setLibraryView] = useState<ProjectLibraryView>('working'), [libraryNotice, setLibraryNotice] = useState(''), [libraryError, setLibraryError] = useState<string | null>(null);
  const libraryViewButton = useRef<HTMLButtonElement | null>(null);
  const archiveBanner = useRef<HTMLDivElement | null>(null), projectName = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!loaded.focusProject) return;
    const frame = requestAnimationFrame(() => (archived ? archiveBanner.current : projectName.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [loaded, archived]);
  const [search, setSearch] = useState('');
  const [historyDocument, setHistoryDocument] = useState<ProjectDocument | null>(null), [historyError, setHistoryError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false), [inputBusy, setInputBusy] = useState(false);
  const inputOwners = useRef(new Set<symbol>());
  const busy = actionBusy || inputBusy;
  const fileInput = useRef<HTMLInputElement>(null), moreMenu = useRef<HTMLDetailsElement>(null);
  // Local-only storage: once there is a model or saved versions, remind to keep a copy outside this browser.
  const [remindBackup, setRemindBackup] = useState(false);
  // The «Ещё» menu closes on an outside click or Escape, like any menu.
  useEffect(() => {
    const close = (event: Event) => { const menu = moreMenu.current; if (menu?.open && (event.type === 'keydown' ? (event as KeyboardEvent).key === 'Escape' : !menu.contains(event.target as Node))) menu.open = false; };
    window.document.addEventListener('pointerdown', close); window.document.addEventListener('keydown', close);
    return () => { window.document.removeEventListener('pointerdown', close); window.document.removeEventListener('keydown', close); };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setRemindBackup(!archived && shouldRemindBackup({ hasWork: !!loaded.document.journey.built || loaded.document.versions.length > 0,
      updatedAt: loaded.document.updatedAt, entry: backupEntry(loaded.document.id) })), 0);
    return () => clearTimeout(timer);
  }, [loaded, archived]);

  const snapshot = useCallback((): ProjectDocument => archived ? document.current : ({ ...document.current, appVersion: APP_VERSION, updatedAt: new Date().toISOString(),
    journey: journey.current ? snapshotJourney(journey.current) : document.current.journey }), [archived]);
  const flush = useCallback(async (): Promise<boolean> => {
    if (archived) return true;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (saving.current) return saving.current;
    if (failed.current) return false;
    const task = (async () => {
      try {
        while (savedSerial.current < serial.current) {
          const version = serial.current, next = snapshot();
          revision.current = await writeProject(next, revision.current);
          document.current.updatedAt = next.updatedAt;
          savedSerial.current = version;
        }
        failureMessage.current = null;
        if (alive.current) { setStatus('saved'); setError(null); }
        return true;
      } catch (error) {
        failed.current = true;
        failureMessage.current = storageErrorMessage(error);
        if (alive.current) { setStatus('error'); setError(failureMessage.current); }
        return false;
      }
    })();
    saving.current = task;
    const ok = await task; saving.current = null; return ok;
  }, [snapshot, archived]);
  const touch = useCallback(() => {
    serial.current++;
    if (failed.current) return;
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 400);
  }, [flush]);
  const drafts = useMemo<ProjectDraftStore>(() => ({
    processing: (owner, busy) => { if (busy) inputOwners.current.add(owner); else inputOwners.current.delete(owner); setInputBusy(inputOwners.current.size > 0); },
    get: (scope, identity, field) => {
      const entry = document.current.forms[scope];
      return entry?.identity === identity ? entry.values[field] : undefined;
    },
    put: (scope, identity, field, value) => {
      if (archived) return;
      const entry = document.current.forms[scope];
      if (entry?.identity === identity && Object.is(entry.values[field], value)) return;
      document.current.forms = { ...document.current.forms, [scope]: { identity, values: { ...(entry?.identity === identity ? entry.values : {}), [field]: value } } };
      touch();
    },
  }), [touch, archived]);
  const onJourney = useCallback((state: JourneyState) => {
    if (archived) return;
    if (journey.current === state) return;
    journey.current = state; touch();
  }, [touch, archived]);
  useEffect(() => {
    alive.current = true;
    if (archived) return () => { alive.current = false; };
    // A restored copy may mount without changing any fields; it still needs a completed save status.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 400);
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      if (serial.current > savedSerial.current) { void flush(); event.preventDefault(); event.returnValue = ''; }
    };
    const background = () => { if (documentVisibility() === 'hidden') void flush(); };
    window.addEventListener('beforeunload', protectUnsaved); window.document.addEventListener('visibilitychange', background);
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); window.removeEventListener('beforeunload', protectUnsaved); window.document.removeEventListener('visibilitychange', background); };
  }, [flush, archived]);

  const run = async (task: () => Promise<void>, report: (message: string | null) => void = setNotice): Promise<boolean> => {
    if (busy) return false;
    setActionBusy(true);
    try { await task(); return true; } catch (error) { report(error instanceof Error ? error.message : 'Не удалось выполнить действие. Текущий проект сохранён во вкладке.'); return false; }
    finally { if (alive.current) setActionBusy(false); }
  };
  const exportProject = () => {
    // Validate our own portable file as well as imports; never label a broken snapshot a backup.
    try { const current = snapshot(), contents = serializeProject(current); parseProject(contents); downloadBlob(contents, 'application/json', projectFilename(current.name)); markBackedUp(current.id); setRemindBackup(false); setNotice('Файл проекта подготовлен к скачиванию вместе с фото, измерениями и историей версий. Проверьте загрузки браузера.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось подготовить файл проекта.'); }
  };
  const changeHistory = (versionId?: string, versionName = '', versionNote = '') => run(async () => {
    if (archived) throw new Error('Верните проект в работу перед изменением истории.');
    setHistoryError(null);
    if (!await flush()) throw new Error(failureMessage.current ?? 'Не удалось сохранить текущую работу. Закройте историю и устраните ошибку сохранения или создайте отдельный проект.');
    const next = versionId ? restoreProjectVersion(snapshot(), versionId) : addProjectVersion(snapshot(), versionName, versionNote);
    // Validate before the atomic write; history failure cannot partially replace the working state.
    parseProject(serializeProject(next));
    const nextRevision = await writeProject(next, revision.current);
    if (versionId) activate({ document: next, revision: nextRevision, restored: true,
      notice: `Версия восстановлена. Предыдущая работа сохранена в истории. ${next.journey.built ? 'Проверьте модель перед получением файлов.' : 'Продолжите ввод исходных данных.'}` });
    else {
      document.current = next; revision.current = nextRevision; setHistoryDocument(next);
      setNotice(`Версия «${versionName.trim()}» сохранена вместе с исходными данными.`);
    }
  }, setHistoryError);
  const importProject = (file?: File) => {
    if (!file) return;
    void run(async () => {
      if (file.size > MAX_PROJECT_BYTES) throw new Error('Проект больше 32 МБ.');
      const imported = parseProject(await file.text());
      if (!await flush()) return;
      const copy = { ...imported, id: crypto.randomUUID(), name: `${imported.name.slice(0, 109)} (импорт)`, updatedAt: new Date().toISOString() };
      // Write the copy before switching; invalid files and write errors leave the current project intact.
      const version = await writeProject(copy, null);
      activate({ document: copy, revision: version, restored: true,
        notice: 'Открыта отдельная копия из файла. Продолжите работу с сохранёнными данными; если модель уже построена, проверьте её перед получением файлов.' });
    });
  };
  const refreshLibrary = async () => { const result = await listProjects(); setEntries(result.entries); };
  const changeArchive = (entry: Pick<ProjectListEntry, 'id' | 'name' | 'revision'>, nextArchived: boolean) => run(async () => {
    setLibraryError(null); setLibraryNotice('');
    const current = entry.id === loaded.document.id;
    if (current && !await flush()) throw new Error(failureMessage.current ?? 'Сначала сохраните текущую работу.');
    try {
      const next = await setProjectArchived(entry.id, current ? revision.current! : entry.revision, nextArchived);
      const message = nextArchived ? `«${next.project.name}» в архиве. Фото, параметры и версии сохранены.` : `«${next.project.name}» возвращён в работу.`;
      if (current) activate({ document: next.project, revision: next.revision, archivedAt: next.archivedAt, restored: true, notice: message, focusProject: true });
      else { await refreshLibrary(); setLibraryNotice(message); requestAnimationFrame(() => libraryViewButton.current?.focus()); }
    } catch (error) {
      if (current && archived && error instanceof ProjectConflictError) {
        // This view is read-only: no local draft can be lost by showing the newer saved state.
        const next = await openStoredProject(entry.id);
        activate({ document: next.project, revision: next.revision, archivedAt: next.archivedAt, restored: true, focusProject: true,
          notice: 'Состояние проекта изменилось в другой вкладке. Открыта актуальная сохранённая версия; действие архива повторно не применено.' });
        return;
      }
      await refreshLibrary().catch(() => {}); throw error;
    }
  }, libraryOpen ? setLibraryError : setNotice);
  const visibleEntries = filterProjectLibrary(entries, libraryView, search);
  const workingCount = entries.filter(entry => !entry.archivedAt).length, archivedCount = entries.length - workingCount;
  const controls = <section className="project-bar" aria-label="Текущий проект">
    <div className="project-bar-main"><label className="project-name">ПРОЕКТ<input ref={projectName} aria-label="Название проекта" disabled={busy || archived} maxLength={120} value={name} onChange={event => {
      const value = event.target.value; setName(value); document.current.name = value.trim() || 'Новая деталь'; touch();
    }} onBlur={() => setName(document.current.name)} /></label>
      <span className={`project-save-state ${status}`} role="status">{status === 'saved' ? <Check size={15} /> : status === 'saving' ? <LoaderCircle size={15} className="project-spinner" /> : null}
        {archived ? 'В архиве' : inputBusy ? 'Обрабатываем фото…' : status === 'saved' ? 'Сохранено на устройстве' : status === 'saving' ? 'Сохраняем…' : 'Не сохранено'}</span>
      <div className="project-tools">
        <button type="button" className="text-button" disabled={busy} onClick={() => { void run(async () => { if (!await flush()) return; await refreshLibrary(); setSearch(''); setLibraryNotice(''); setLibraryError(null); setLibraryView(archived ? 'archived' : 'working'); setLibraryOpen(true); }); }}><FolderOpen size={17} /> Мои проекты</button>
        <details className="project-more" ref={moreMenu}><summary className="text-button"><MoreHorizontal size={17} /> Ещё</summary>
          <div className="project-more-menu" onClick={() => { if (moreMenu.current) moreMenu.current.open = false; }}>
            <button type="button" className="text-button" disabled={busy || archived} onClick={() => { setHistoryDocument(snapshot()); setHistoryError(null); }}><History size={17} /> Версии</button>
            <button type="button" className="text-button" disabled={busy} onClick={exportProject}><Download size={17} /> Скачать проект</button>
            <button type="button" className="text-button" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={17} /> Открыть файл</button>
            <button type="button" className="text-button" disabled={busy} onClick={() => { void run(async () => { if (await flush()) activate({ document: newProject(), revision: null, restored: false }); }); }}><Plus size={17} /> Новый</button>
          </div>
        </details>
      </div>
    </div>
    {remindBackup && <div className="project-backup-banner" role="status"><span>Проект хранится только в этом браузере. Скачайте файл или сохраните в аккаунт Layers, чтобы не потерять работу.</span>
      <button type="button" className="text-button" disabled={busy} onClick={exportProject}><Download size={16} /> Скачать проект</button>
      <button type="button" className="text-button" onClick={() => { snoozeBackup(loaded.document.id); setRemindBackup(false); }}>Напомнить через неделю</button></div>}
    {archived && <div className="project-archive-banner" ref={archiveBanner} tabIndex={-1} role="region" aria-label="Архивный проект"><Archive size={22} /><div><strong>Проект в архиве</strong><p>Фото, параметры и история сохранены. Верните проект в работу, чтобы продолжить редактирование и открыть версии. Файл проекта можно скачать сейчас.</p></div>
      <button className="secondary-button" disabled={busy} onClick={() => { void changeArchive({ id: loaded.document.id, name, revision: revision.current! }, false); }}><ArchiveRestore size={17} /> Вернуть в работу</button></div>}
    <input ref={fileInput} className="visually-hidden" type="file" aria-label="Открыть файл проекта" accept=".json,.gear.json,application/json" onChange={event => { importProject(event.target.files?.[0]); event.target.value = ''; }} />
    {error && <div className="project-error" role="alert"><p>{error}</p><div>
      <button type="button" className="text-button" onClick={() => { failed.current = false; setStatus('saving'); void flush(); }}><RefreshCw size={15} /> Повторить сохранение</button>
      <button type="button" className="text-button" disabled={busy} onClick={() => { void run(async () => {
        const copy = { ...snapshot(), id: crypto.randomUUID(), name: `${document.current.name.slice(0, 110)} (копия)` };
        const version = await writeProject(copy, null); activate({ document: copy, revision: version, restored: true });
      }); }}><Copy size={15} /> Сохранить отдельной копией</button>
    </div></div>}
    {notice && <div className="project-notice" role="status"><p>{notice}</p><button type="button" className="text-button" aria-label="Закрыть сообщение о проекте" onClick={() => setNotice(null)}>Понятно</button></div>}
    <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}><DialogContent className="project-library">
      <DialogTitle>Мои проекты</DialogTitle><DialogDescription>Сохраняются в этом браузере. Для переноса на другое устройство и резервной копии скачайте файл проекта. Очистка данных сайта удалит локальные записи.</DialogDescription>
      <div className="project-library-views" role="group" aria-label="Раздел проектов">{(['working', 'archived'] as const).map(view => <button key={view} ref={libraryView === view ? libraryViewButton : undefined} type="button" disabled={busy} aria-pressed={libraryView === view} onClick={() => { setLibraryView(view); setLibraryError(null); }}>
        {view === 'working' ? `В работе · ${workingCount}` : `Архив · ${archivedCount}`}</button>)}</div>
      <LayersAccount projectId={loaded.document.id} disabled={busy || archived} onBackedUp={() => { markBackedUp(loaded.document.id); setRemindBackup(false); }}
        serialize={async () => { if (!await flush()) { setLibraryError(failureMessage.current ?? 'Сначала сохраните текущую работу.'); return null; } return serializeProject(snapshot()); }}
        openCloud={async (data, cloudRevision) => { await run(async () => {
          const doc = parseProject(data);
          if (!await flush()) return;
          let local: number | null = null;
          try { local = (await readProject(doc.id)).revision; } catch { local = null; }
          const version = await writeProject({ ...doc, updatedAt: new Date().toISOString() }, local);
          rememberSyncedRevision(doc.id, cloudRevision);
          setLibraryOpen(false);
          activate({ document: doc, revision: version, restored: true, notice: `Открыта версия ${cloudRevision} из аккаунта Layers.` });
        }, setLibraryError); }} />
      <label className="project-search">Найти проект<input type="search" aria-label="Найти проект" value={search} onChange={event => setSearch(event.target.value)} placeholder="Название детали или заказа" /></label>
      {libraryError && <p role="alert" className="version-error">{libraryError}</p>}
      {libraryNotice && <p role="status" className="library-notice">{libraryNotice}</p>}
      <ul aria-label={libraryView === 'working' ? 'Проекты в работе' : 'Архивные проекты'}>{visibleEntries.map(entry => <li key={entry.id}><div><strong>{entry.name}</strong><span>Изменён {new Date(entry.updatedAt).toLocaleString('ru-RU')}{entry.id === loaded.document.id ? ' · открыт сейчас' : ''}</span>{entry.archivedAt && <span>В архиве с {new Date(entry.archivedAt).toLocaleString('ru-RU')}</span>}</div>
        <div className="project-row-actions">
        <button className="secondary-button" aria-label={`Открыть проект: ${entry.name}`} disabled={busy || entry.id === loaded.document.id} onClick={() => { void run(async () => {
          if (!await flush()) return;
          const next = await openStoredProject(entry.id); activate({ document: next.project, revision: next.revision, archivedAt: next.archivedAt, restored: true });
        }, setLibraryError); }}>Открыть</button>
        <button className="text-button" aria-label={`${entry.archivedAt ? 'Вернуть в работу' : 'В архив'}: ${entry.name}`} disabled={busy} onClick={() => { void changeArchive(entry, !entry.archivedAt); }}>{entry.archivedAt ? <ArchiveRestore size={16} /> : <Archive size={16} />}{entry.archivedAt ? 'Вернуть в работу' : 'В архив'}</button>
        </div></li>)}</ul>
      {!visibleEntries.length && <p role="status" className="library-empty">{search.trim() ? 'По этому названию в выбранном разделе проектов нет.' : libraryView === 'archived' ? 'Архив пока пуст. Завершённые работы можно убрать сюда из рабочего списка.' : 'Проектов в работе пока нет. Создайте новый или верните нужную деталь из архива.'}</p>}
      <div className="project-library-footer"><p>Архив скрывает завершённые работы из основного списка и сохраняет все данные. Место на устройстве не освобождается.</p><button className="text-button" disabled={busy} onClick={() => { void run(async () => { await refreshLibrary(); setLibraryError(null); }, setLibraryError); }}><RefreshCw size={16} /> Обновить список</button></div>
    </DialogContent></Dialog>
    {historyDocument && <ProjectHistory project={historyDocument} busy={busy} error={historyError} onClose={() => setHistoryDocument(null)}
      onSave={(name, note) => changeHistory(undefined, name, note)} onRestore={id => { void changeHistory(id); }}
      onFork={versionId => { void run(async () => {
        // A copy also rescues a draft when the original cannot be written because of another tab.
        await flush();
        const copy = forkProjectVersion(snapshot(), versionId);
        const nextRevision = await writeProject(copy, null);
        activate({ document: copy, revision: nextRevision, restored: true,
          notice: 'Создан отдельный проект из выбранного варианта. История версий осталась в исходном проекте.' });
      }, setHistoryError); }} />}
  </section>;
  return <ProjectContext.Provider value={drafts}><Studio project={{ initial, onJourney, controls, busy: busy || archived, archived, name: name.trim() || 'Новая деталь' }} /></ProjectContext.Provider>;
}

function documentVisibility() { return window.document.visibilityState; }
