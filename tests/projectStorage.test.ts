import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { newProject, serializeProject } from '../lib/project.ts';
import { addProjectVersion } from '../lib/projectVersions.ts';
import { filterProjectLibrary } from '../lib/projectLibrary.ts';
import { listProjects, openStoredProject, readProject, setProjectArchived, writeProject, ProjectArchivedError, ProjectConflictError, storageErrorMessage, type ProjectEntry } from '../lib/projectStorage.ts';

const DATABASE = 'zatseplenie-projects';
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
const namedProject = (name: string) => ({ ...newProject(), name });

function open(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('projects', { keyPath: 'id' }); db.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function row(id: string): Promise<ProjectEntry> {
  const db = await open(2);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects'), request = tx.objectStore('projects').get(id);
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
function fixture() {
  const p = namedProject('Насос — привод');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=';
  p.forms.photo = { identity: 'default', values: { image: png, imageSize: { width: 1, height: 1, id: 1,
    source: { fileName: 'sample.png', mimeType: 'image/png', originalWidth: 1, originalHeight: 1 } }, width: '13', confirmedTeeth: true } };
  p.forms.photoReferences = { identity: 'default', values: { photos: [{ id: crypto.randomUUID(), image: png, width: 1, height: 1,
    source: { fileName: 'side.png', mimeType: 'image/png', originalWidth: 1, originalHeight: 1 }, role: 'side', note: 'Проверить направление' }] } };
  return addProjectVersion(p, 'Образец до изменений');
}

test('upgrading a v1 database preserves projects, photo history, revisions and active selection', async () => {
  const p = fixture(), contents = serializeProject(p), db = await open(1);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['projects', 'settings'], 'readwrite');
    tx.objectStore('projects').put({ id: p.id, name: p.name, updatedAt: p.updatedAt, revision: 7, contents });
    tx.objectStore('settings').put(p.id, 'active');
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  }); db.close();
  const list = await listProjects();
  assert.equal(list.activeId, p.id); assert.equal(list.entries[0].archivedAt, null); assert.equal(list.entries[0].revision, 7);
  const loaded = await readProject(p.id);
  assert.deepEqual(loaded.project.forms, p.forms); assert.equal(loaded.project.versions.length, 1);
  assert.equal((await row(p.id)).contents, contents);
});

test('archive and restore preserve exact stored content and modification time including all images and versions', async () => {
  const p = fixture(), version = await writeProject(p, null), before = await row(p.id);
  const archived = await setProjectArchived(p.id, version, true), archivedRow = await row(p.id);
  assert.ok(archived.archivedAt); assert.equal(archived.revision, version + 1);
  assert.equal(archivedRow.contents, before.contents); assert.equal(archivedRow.updatedAt, before.updatedAt);
  assert.deepEqual(archived.project.forms, p.forms); assert.deepEqual(archived.project.versions, p.versions);
  const restored = await setProjectArchived(p.id, archived.revision, false);
  assert.equal(restored.archivedAt, null); assert.equal(restored.revision, version + 2);
  assert.equal((await row(p.id)).contents, before.contents);
  const same = await setProjectArchived(p.id, restored.revision, false);
  assert.equal(same.revision, restored.revision);
});

test('archived projects cannot be overwritten by a stale or freshly loaded editor; rescue copies stay active', async () => {
  const p = fixture(), v = await writeProject(p, null), archived = await setProjectArchived(p.id, v, true);
  for (const expected of [v, archived.revision]) await assert.rejects(writeProject({ ...p, name: 'Изменения другой вкладки' }, expected), ProjectArchivedError);
  assert.equal((await readProject(p.id)).project.name, p.name);
  const copy = { ...p, id: crypto.randomUUID(), name: 'Сохранённая отдельная копия' };
  await writeProject(copy, null);
  assert.equal((await readProject(copy.id)).archivedAt, null);
  assert.ok((await readProject(p.id)).archivedAt);
});

test('stale archive/restore requests leave a newer revision and active selection untouched', async () => {
  const p = fixture(), first = await writeProject(p, null), newer = await writeProject({ ...p, name: 'Новые размеры' }, first);
  await assert.rejects(setProjectArchived(p.id, first, true), ProjectConflictError);
  assert.equal((await readProject(p.id)).project.name, 'Новые размеры');
  const archived = await setProjectArchived(p.id, newer, true);
  await assert.rejects(setProjectArchived(p.id, newer, false), ProjectConflictError);
  assert.equal((await readProject(p.id)).archivedAt, archived.archivedAt);
  assert.equal((await listProjects()).activeId, p.id);
});

test('concurrent edit and archive serialize atomically with exactly one winner', async () => {
  const p = fixture(), first = await writeProject(p, null);
  const outcomes = await Promise.allSettled([setProjectArchived(p.id, first, true), writeProject({ ...p, name: 'Новый вариант' }, first)]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const current = await readProject(p.id);
  assert.equal(current.revision, first + 1);
  assert.equal(current.project.name, current.archivedAt ? p.name : 'Новый вариант');
});

test('opening an archived record remembers selection without saving, restoring or changing another project', async () => {
  const a = fixture(), b = namedProject('Другая деталь'), av = await writeProject(a, null);
  const archive = await setProjectArchived(a.id, av, true); await writeProject(b, null);
  const opened = await openStoredProject(a.id);
  assert.equal(opened.revision, archive.revision); assert.equal(opened.archivedAt, archive.archivedAt);
  assert.equal((await listProjects()).activeId, a.id); assert.equal((await readProject(b.id)).revision, 1);
  await setProjectArchived(a.id, archive.revision, false);
  assert.equal((await listProjects()).activeId, a.id);
});

test('changing another project archive status does not steal active selection', async () => {
  const a = namedProject('A'), b = namedProject('B'), av = await writeProject(a, null); await writeProject(b, null);
  const archive = await setProjectArchived(a.id, av, true); assert.equal((await listProjects()).activeId, b.id);
  await setProjectArchived(a.id, archive.revision, false); assert.equal((await listProjects()).activeId, b.id);
});

test('older database clients fail instead of dropping the archive marker; files retain portable v3', async () => {
  const p = fixture(), v = await writeProject(p, null); await setProjectArchived(p.id, v, true);
  await assert.rejects(open(1), error => error instanceof DOMException && error.name === 'VersionError');
  assert.ok((await readProject(p.id)).archivedAt);
  const portable = JSON.parse((await row(p.id)).contents);
  assert.equal(portable.schema, 'zatseplenie.project.v3'); assert.equal(portable.archivedAt, undefined);
  assert.match(storageErrorMessage(new ProjectArchivedError()), /отдельной копией/);
});

test('missing or unreadable records cannot change archive metadata or remembered selection', async () => {
  const p = namedProject('Исправный'), v = await writeProject(p, null), db = await open(2), id = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put({ id, name: 'Повреждённый', updatedAt: p.updatedAt, revision: v, contents: '{invalid' });
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  }); db.close();
  await assert.rejects(openStoredProject(id)); await assert.rejects(setProjectArchived(id, v, true));
  await assert.rejects(setProjectArchived(crypto.randomUUID(), 1, true));
  assert.equal((await listProjects()).activeId, p.id); assert.equal((await row(id)).archivedAt, undefined);
});

test('library search and sorting keep working and archived projects separate without mutating their order', () => {
  const item = (id: string, name: string, updatedAt: string, archivedAt?: string) => ({ id, name, updatedAt, revision: 1, archivedAt });
  const entries = [item('1','НАСОС старый','2026-01-02','2026-04-01'), item('2','Насос новый','2026-03-01'), item('3','Вал','2026-04-01'), item('4','Насос запасной','2026-01-01','2026-05-01')];
  assert.deepEqual(filterProjectLibrary(entries,'working','  насос ').map(p=>p.id), ['2']);
  assert.deepEqual(filterProjectLibrary(entries,'archived','НАСОС').map(p=>p.id), ['4','1']);
  assert.deepEqual(filterProjectLibrary(entries,'working','').map(p=>p.id), ['3','2']);
  assert.deepEqual(entries.map(p=>p.id), ['1','2','3','4']);
});
