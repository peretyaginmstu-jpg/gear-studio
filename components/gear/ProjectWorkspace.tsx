"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Check, Download, FolderOpen, LoaderCircle, Plus, Upload, Copy, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { APP_VERSION } from '@/lib/appVersion';
import { newProject, parseProject, projectFilename, restoreProjectJourney, serializeProject, snapshotJourney, MAX_PROJECT_BYTES, type ProjectDocument } from '@/lib/project';
import { listProjects, readProject, writeProject, storageErrorMessage, type ProjectEntry } from '@/lib/projectStorage';
import type { JourneyState } from '@/lib/journey';
import { downloadBlob } from '@/lib/download';
import { ProjectContext, type ProjectDraftStore } from './ProjectContext';

type LoadedProject = { document: ProjectDocument; revision: number | null; restored: boolean; notice?: string };
export interface ProjectSession { initial: JourneyState | undefined; onJourney: (state: JourneyState) => void; controls: ReactNode; busy: boolean }
type StudioComponent = ComponentType<{ project: ProjectSession }>;

export function ProjectWorkspace({ component }: { component: StudioComponent }) {
  const [loaded, setLoaded] = useState<LoadedProject | null>(null), [generation, setGeneration] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: LoadedProject;
      try {
        const { activeId } = await listProjects();
        if (activeId) {
          const saved = await readProject(activeId);
          next = { document: saved.project, revision: saved.revision, restored: true };
        } else next = { document: newProject(), revision: null, restored: false };
      } catch (error) {
        next = { document: newProject(), revision: null, restored: false,
          notice: `Не удалось открыть предыдущий проект. Его запись не изменена. ${error instanceof Error ? error.message : storageErrorMessage(error)}` };
      }
      if (!cancelled) setLoaded(next);
    })();
    return () => { cancelled = true; };
  }, []);
  const activate = useCallback((next: LoadedProject) => { setLoaded(next); setGeneration(value => value + 1); }, []);
  if (!loaded) return <main className="project-loading" aria-live="polite"><LoaderCircle size={25} className="project-spinner" /><h1>Открываем мастерскую</h1><p>Проверяем сохранённые на этом устройстве проекты…</p></main>;
  return <ProjectEditor key={`${loaded.document.id}-${generation}`} loaded={loaded} activate={activate} component={component} />;
}

function ProjectEditor({ loaded, activate, component: Studio }: { loaded: LoadedProject; activate: (value: LoadedProject) => void; component: StudioComponent }) {
  const initial = useMemo(() => loaded.restored ? restoreProjectJourney(loaded.document) : undefined, [loaded]);
  const document = useRef(loaded.document), journey = useRef<JourneyState | null>(initial ?? null);
  const revision = useRef(loaded.revision), serial = useRef(1), savedSerial = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), saving = useRef<Promise<boolean> | null>(null);
  const failed = useRef(false), alive = useRef(true);
  const [name, setName] = useState(loaded.document.name), [status, setStatus] = useState<'saving' | 'saved' | 'error'>('saving');
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState(loaded.notice ?? (loaded.restored
    ? initial?.built ? 'Проект восстановлен на этом устройстве. Сохранённая модель пересчитана; проверьте её перед получением файлов.'
      : 'Черновик восстановлен на этом устройстве. Продолжите ввод с сохранёнными фото, измерениями и ответами.' : null));
  const [libraryOpen, setLibraryOpen] = useState(false), [entries, setEntries] = useState<Omit<ProjectEntry, 'contents'>[]>([]);
  const [actionBusy, setActionBusy] = useState(false), [inputBusy, setInputBusy] = useState(false);
  const busy = actionBusy || inputBusy;
  const fileInput = useRef<HTMLInputElement>(null);

  const snapshot = useCallback((): ProjectDocument => ({ ...document.current, appVersion: APP_VERSION, updatedAt: new Date().toISOString(),
    journey: journey.current ? snapshotJourney(journey.current) : document.current.journey }), []);
  const flush = useCallback(async (): Promise<boolean> => {
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
        if (alive.current) { setStatus('saved'); setError(null); }
        return true;
      } catch (error) {
        failed.current = true;
        if (alive.current) { setStatus('error'); setError(storageErrorMessage(error)); }
        return false;
      }
    })();
    saving.current = task;
    const ok = await task; saving.current = null; return ok;
  }, [snapshot]);
  const touch = useCallback(() => {
    serial.current++;
    if (failed.current) return;
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 400);
  }, [flush]);
  const drafts = useMemo<ProjectDraftStore>(() => ({
    processing: setInputBusy,
    get: (scope, identity, field) => {
      const entry = document.current.forms[scope];
      return entry?.identity === identity ? entry.values[field] : undefined;
    },
    put: (scope, identity, field, value) => {
      const entry = document.current.forms[scope];
      if (entry?.identity === identity && Object.is(entry.values[field], value)) return;
      document.current.forms = { ...document.current.forms, [scope]: { identity, values: { ...(entry?.identity === identity ? entry.values : {}), [field]: value } } };
      touch();
    },
  }), [touch]);
  const onJourney = useCallback((state: JourneyState) => {
    if (journey.current === state) return;
    journey.current = state; touch();
  }, [touch]);
  useEffect(() => {
    alive.current = true;
    // A restored copy may mount without changing any fields; it still needs a completed save status.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 400);
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      if (serial.current > savedSerial.current) { void flush(); event.preventDefault(); event.returnValue = ''; }
    };
    const background = () => { if (documentVisibility() === 'hidden') void flush(); };
    window.addEventListener('beforeunload', protectUnsaved); window.document.addEventListener('visibilitychange', background);
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); window.removeEventListener('beforeunload', protectUnsaved); window.document.removeEventListener('visibilitychange', background); };
  }, [flush]);

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setActionBusy(true);
    try { await task(); } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось выполнить действие. Текущий проект сохранён во вкладке.'); }
    finally { if (alive.current) setActionBusy(false); }
  };
  const exportProject = () => {
    const current = snapshot(), contents = serializeProject(current);
    // Validate our own portable file as well as imports; never label a broken snapshot a backup.
    try { parseProject(contents); downloadBlob(contents, 'application/json', projectFilename(current.name)); setNotice('Файл проекта подготовлен к скачиванию вместе с фото и измерениями. Проверьте загрузки браузера.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось подготовить файл проекта.'); }
  };
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
  const controls = <section className="project-bar" aria-label="Текущий проект">
    <div className="project-bar-main"><label className="project-name">ПРОЕКТ<input aria-label="Название проекта" disabled={busy} maxLength={120} value={name} onChange={event => {
      const value = event.target.value; setName(value); document.current.name = value.trim() || 'Новая деталь'; touch();
    }} onBlur={() => setName(document.current.name)} /></label>
      <span className={`project-save-state ${status}`} role="status">{status === 'saved' ? <Check size={15} /> : status === 'saving' ? <LoaderCircle size={15} className="project-spinner" /> : null}
        {inputBusy ? 'Обрабатываем фото…' : status === 'saved' ? 'Сохранено на устройстве' : status === 'saving' ? 'Сохраняем…' : 'Не сохранено'}</span>
      <div className="project-tools">
        <button type="button" className="text-button" disabled={busy} onClick={() => { void run(async () => { const result = await listProjects(); setEntries(result.entries); setLibraryOpen(true); }); }}><FolderOpen size={17} /> Мои проекты</button>
        <button type="button" className="text-button" disabled={busy} onClick={exportProject}><Download size={17} /> Скачать проект</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={17} /> Открыть файл</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => { void run(async () => { if (await flush()) activate({ document: newProject(), revision: null, restored: false }); }); }}><Plus size={17} /> Новый</button>
      </div>
    </div>
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
      <ul>{entries.map(entry => <li key={entry.id}><div><strong>{entry.name}</strong><span>{new Date(entry.updatedAt).toLocaleString('ru-RU')}{entry.id === loaded.document.id ? ' · открыт сейчас' : ''}</span></div>
        <button className="secondary-button" disabled={busy || entry.id === loaded.document.id} onClick={() => { void run(async () => {
          if (!await flush()) return;
          const next = await readProject(entry.id); activate({ document: next.project, revision: next.revision, restored: true });
        }); }}>Открыть</button></li>)}</ul>
      {!entries.length && <p>Первый проект появится здесь после автосохранения.</p>}
    </DialogContent></Dialog>
  </section>;
  return <ProjectContext.Provider value={drafts}><Studio project={{ initial, onJourney, controls, busy }} /></ProjectContext.Provider>;
}

function documentVisibility() { return window.document.visibilityState; }
