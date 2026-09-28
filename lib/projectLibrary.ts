import type { ProjectListEntry } from './projectStorage.ts';

export type ProjectLibraryView = 'working' | 'archived';

export function filterProjectLibrary(entries: readonly ProjectListEntry[], view: ProjectLibraryView, search: string): ProjectListEntry[] {
  const query = search.trim().toLocaleLowerCase('ru-RU');
  return entries.filter(entry => !!entry.archivedAt === (view === 'archived') && entry.name.toLocaleLowerCase('ru-RU').includes(query))
    .sort((a, b) => (view === 'archived' ? b.archivedAt!.localeCompare(a.archivedAt!) : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id));
}
