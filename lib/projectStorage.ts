import { parseProject, serializeProject, ProjectSizeError, type ProjectDocument } from './project.ts';

const DATABASE = 'zatseplenie-projects';
export interface ProjectEntry { id: string; name: string; updatedAt: string; revision: number; contents: string }
export class ProjectConflictError extends Error {
  constructor() { super('Проект изменён в другой вкладке. Сохраните свою работу отдельной копией или скачайте файл проекта.'); }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('projects', { keyPath: 'id' }); request.result.createObjectStore('settings'); };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Закройте старую вкладку сайта и повторите открытие проектов.'));
  });
}

export async function listProjects(): Promise<{ entries: Omit<ProjectEntry, 'contents'>[]; activeId: string | null }> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['projects', 'settings'], 'readonly');
    const rows = tx.objectStore('projects').getAll(), active = tx.objectStore('settings').get('active');
    tx.oncomplete = () => { db.close(); resolve({ entries: (rows.result as ProjectEntry[])
      .map(({ id, name, updatedAt, revision }) => ({ id, name, updatedAt, revision })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), activeId: active.result ?? null }); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export async function readProject(id: string): Promise<{ project: ProjectDocument; revision: number }> {
  const db = await openDatabase();
  const row = await new Promise<ProjectEntry | undefined>((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly'), request = tx.objectStore('projects').get(id);
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
  if (!row) throw new Error('Проект не найден в этом браузере. Откройте сохранённый файл проекта.');
  return { project: parseProject(row.contents), revision: row.revision };
}

/** Compare and write in ONE transaction: two tabs cannot silently overwrite each other's work. */
export async function writeProject(project: ProjectDocument, expectedRevision: number | null): Promise<number> {
  const contents = serializeProject(project), db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['projects', 'settings'], 'readwrite'), store = tx.objectStore('projects');
    const request = store.get(project.id);
    let conflict = false, revision = 0;
    request.onsuccess = () => {
      const previous = request.result as ProjectEntry | undefined;
      if ((previous?.revision ?? null) !== expectedRevision) { conflict = true; tx.abort(); return; }
      revision = (previous?.revision ?? 0) + 1;
      store.put({ id: project.id, name: project.name, updatedAt: project.updatedAt, revision, contents } satisfies ProjectEntry);
      tx.objectStore('settings').put(project.id, 'active');
    };
    tx.oncomplete = () => { db.close(); resolve(revision); };
    tx.onabort = () => { db.close(); reject(conflict ? new ProjectConflictError() : tx.error ?? new Error('Не удалось сохранить проект.')); };
  });
}

export function storageErrorMessage(error: unknown): string {
  if (error instanceof ProjectSizeError) return error.message;
  if (error instanceof ProjectConflictError) return error.message;
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return 'Место в браузере закончилось. Скачайте файл проекта, чтобы сохранить изменения.';
  return 'Автосохранение недоступно. Работа остаётся во вкладке; скачайте файл проекта перед закрытием.';
}
