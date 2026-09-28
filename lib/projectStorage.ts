import { parseProject, serializeProject, ProjectSizeError, type ProjectDocument } from './project.ts';

const DATABASE = 'zatseplenie-projects';
// Older clients must not write rows without understanding their archived state.
const DATABASE_VERSION = 2;
export interface ProjectEntry { id: string; name: string; updatedAt: string; revision: number; contents: string; archivedAt?: string | null }
export type ProjectListEntry = Omit<ProjectEntry, 'contents'>;
export interface StoredProject { project: ProjectDocument; revision: number; archivedAt: string | null }
export class ProjectConflictError extends Error {
  constructor() { super('Проект изменён в другой вкладке. Сохраните свою работу отдельной копией или скачайте файл проекта.'); }
}
export class ProjectArchivedError extends Error {
  constructor() { super('Проект перенесён в архив в другой вкладке. Изменения остались здесь: скачайте их или сохраните отдельной копией.'); }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Закройте старую вкладку сайта и повторите открытие проектов.'));
  });
}

export async function listProjects(): Promise<{ entries: ProjectListEntry[]; activeId: string | null }> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['projects', 'settings'], 'readonly');
    const rows = tx.objectStore('projects').openCursor(), active = tx.objectStore('settings').get('active'), entries: ProjectListEntry[] = [];
    rows.onsuccess = () => {
      const cursor = rows.result;
      if (!cursor) return;
      // Do not retain all image payloads at once just to display the library.
      const { id, name, updatedAt, revision, archivedAt } = cursor.value as ProjectEntry;
      entries.push({ id, name, updatedAt, revision, archivedAt: archivedAt ?? null }); cursor.continue();
    };
    tx.oncomplete = () => { db.close(); resolve({ entries: entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), activeId: active.result ?? null }); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export async function readProject(id: string): Promise<StoredProject> {
  const db = await openDatabase();
  const row = await new Promise<ProjectEntry | undefined>((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly'), request = tx.objectStore('projects').get(id);
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
  if (!row) throw new Error('Проект не найден в этом браузере. Откройте сохранённый файл проекта.');
  return decodeRow(row);
}

function decodeRow(row: ProjectEntry): StoredProject {
  return { project: parseProject(row.contents), revision: row.revision, archivedAt: row.archivedAt ?? null };
}

/** Explicit opening remembers even a read-only archived project without resaving its content. */
export async function openStoredProject(id: string): Promise<StoredProject> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['projects', 'settings'], 'readwrite'), request = tx.objectStore('projects').get(id);
    let result: StoredProject | undefined, failure: unknown;
    request.onsuccess = () => {
      try {
        if (!request.result) throw new Error('Проект не найден в этом браузере.');
        result = decodeRow(request.result as ProjectEntry);
        tx.objectStore('settings').put(id, 'active');
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => { db.close(); resolve(result!); };
    tx.onabort = () => { db.close(); reject(failure ?? tx.error); };
  });
}

/** Archive only library metadata. Photo bytes, history and modification time remain intact. */
export async function setProjectArchived(id: string, expectedRevision: number, archived: boolean): Promise<StoredProject> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects'), request = store.get(id);
    let result: StoredProject | undefined, failure: unknown;
    request.onsuccess = () => {
      try {
        const previous = request.result as ProjectEntry | undefined;
        if (!previous) throw new Error('Проект не найден в этом браузере.');
        if (previous.revision !== expectedRevision) throw new ProjectConflictError();
        if (!!previous.archivedAt === archived) { result = decodeRow(previous); return; }
        const next: ProjectEntry = { ...previous, archivedAt: archived ? new Date().toISOString() : null, revision: previous.revision + 1 };
        result = decodeRow(next); // Do not hide an unreadable record as a successfully archived project.
        store.put(next);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => { db.close(); resolve(result!); };
    tx.onabort = () => { db.close(); reject(failure ?? tx.error); };
  });
}

/** Compare and write in ONE transaction: two tabs cannot silently overwrite each other's work. */
export async function writeProject(project: ProjectDocument, expectedRevision: number | null): Promise<number> {
  const contents = serializeProject(project), db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['projects', 'settings'], 'readwrite'), store = tx.objectStore('projects');
    const request = store.get(project.id);
    let failure: Error | null = null, revision = 0;
    request.onsuccess = () => {
      const previous = request.result as ProjectEntry | undefined;
      if (previous?.archivedAt) { failure = new ProjectArchivedError(); tx.abort(); return; }
      if ((previous?.revision ?? null) !== expectedRevision) { failure = new ProjectConflictError(); tx.abort(); return; }
      revision = (previous?.revision ?? 0) + 1;
      store.put({ id: project.id, name: project.name, updatedAt: project.updatedAt, revision, contents, archivedAt: null } satisfies ProjectEntry);
      tx.objectStore('settings').put(project.id, 'active');
    };
    tx.oncomplete = () => { db.close(); resolve(revision); };
    tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? new Error('Не удалось сохранить проект.')); };
  });
}

export function storageErrorMessage(error: unknown): string {
  if (error instanceof ProjectSizeError) return error.message;
  if (error instanceof ProjectConflictError || error instanceof ProjectArchivedError) return error.message;
  if (error instanceof DOMException && error.name === 'VersionError')
    return 'База проектов обновлена новой версией сайта. Скачайте текущий проект перед обновлением вкладки.';
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return 'Место в браузере закончилось. Скачайте файл проекта, чтобы сохранить изменения.';
  return 'Автосохранение недоступно. Работа остаётся во вкладке; скачайте файл проекта перед закрытием.';
}
