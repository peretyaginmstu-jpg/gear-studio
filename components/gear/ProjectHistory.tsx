"use client";
import { useState } from 'react';
import { BookmarkPlus, History, RotateCcw, Copy } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { MAX_PROJECT_VERSIONS, type ProjectDocument } from '@/lib/project';
import { compareProjectSnapshots, snapshotDescription } from '@/lib/projectVersions';

export function ProjectHistory({ project, busy, error, onClose, onSave, onRestore, onFork }: {
  project: ProjectDocument; busy: boolean; error: string | null; onClose: () => void;
  onSave: (name: string, note: string) => Promise<boolean>; onRestore: (id: string) => void; onFork: (id?: string) => void;
}) {
  const [name, setName] = useState(`Вариант ${project.versions.length + 1}`), [note, setNote] = useState('');
  const [showCreate, setShowCreate] = useState(!project.versions.length);
  const [selectedId, setSelectedId] = useState<string | null>(project.versions[0]?.id ?? null);
  const selected = project.versions.find(version => version.id === selectedId) ?? project.versions[0], comparison = selected ? compareProjectSnapshots(selected, project) : null;
  const atLimit = project.versions.length >= MAX_PROJECT_VERSIONS;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="project-history" showCloseButton={!busy}>
    <div><div className="dialog-kicker"><History size={18} /> ИСТОРИЯ ДЕТАЛИ</div><DialogTitle>Версии проекта</DialogTitle>
      <DialogDescription>Автосохранение хранит текущую работу. Версия фиксирует выбранный вариант вместе с фото, измерениями и ответами помощнику.</DialogDescription></div>
    <button type="button" className="secondary-button version-create-toggle" disabled={busy || atLimit} aria-expanded={showCreate} onClick={() => setShowCreate(value => !value)}><BookmarkPlus size={17} />{showCreate ? 'Скрыть поля версии' : 'Сохранить текущий вариант'}</button>
    {showCreate && <form className="version-create" onSubmit={async event => {
      event.preventDefault();
      if (await onSave(name, note)) { setName(`Вариант ${project.versions.length + 2}`); setNote(''); setShowCreate(false); setSelectedId(null); }
    }}>
      <label>Название версии<input aria-label="Название версии" value={name} onChange={event => setName(event.target.value)} maxLength={120} disabled={busy || atLimit} placeholder="Например: исходный образец" required /></label>
      <label>Заметка <span>необязательно</span><textarea aria-label="Заметка к версии" value={note} onChange={event => setNote(event.target.value)} maxLength={1000} disabled={busy || atLimit} rows={2} placeholder="Что изменили или что нужно проверить на образце" /></label>
      <button type="submit" className="primary-button" disabled={busy || atLimit || !name.trim()}><BookmarkPlus size={17} /> Сохранить версию</button>
      <p className="version-current">Сейчас: {snapshotDescription(project)}</p>
    </form>}
    {error && <p className="version-error" role="alert">{error}</p>}
    {atLimit && <p className="version-error">В истории 100 версий. Скачайте файл проекта и откройте нужный вариант отдельным проектом.</p>}
    <div className="version-history-heading"><h3>Сохранённые варианты</h3><span>{project.versions.length}</span></div>
    {!project.versions.length ? <p className="version-empty">Сохраните первый вариант перед изменением размеров. Его можно будет открыть позже.</p> : <ul className="version-list">
      {project.versions.map(version => <li key={version.id}>
        <button type="button" className={`version-select ${selected?.id === version.id ? 'selected' : ''}`} aria-pressed={selected?.id === version.id} disabled={busy} onClick={() => setSelectedId(version.id)}>
          <strong>{version.name}</strong><span>{new Date(version.createdAt).toLocaleString('ru-RU')}{version.reason === 'before-restore' ? ' · перед возвратом' : ''}</span>
          <small>{snapshotDescription(version)}</small>
        </button>
      </li>)}
    </ul>}
    {selected && comparison && <section className="version-detail" aria-label="Сравнение версии с текущей работой">
      <h3>{selected.name}</h3>{selected.note && <p className="version-note">{selected.note}</p>}
      <p className="version-meta">Сохранено в приложении {selected.appVersion}. При восстановлении геометрия будет пересчитана.</p>
      {(selected.journey.mode === 'photo' || project.journey.mode === 'photo') && <p className="version-meta">В фото-режиме сравнивается последняя построенная модель. Новые ответы помощнику также входят в версию.</p>}
      {comparison.canCompareParams ? comparison.changes.length ? <div className="version-table-scroll"><table>
        <caption>Отличия параметров от текущей работы</caption><thead><tr><th scope="col">Параметр</th><th scope="col">В версии</th><th scope="col">Сейчас</th></tr></thead>
        <tbody>{comparison.changes.map(change => <tr key={change.key}><th scope="row">{change.label}</th><td>{change.before}</td><td>{change.after}</td></tr>)}</tbody>
      </table></div> : <p>Геометрические параметры совпадают с текущей работой.</p> : <p>Сравнение параметров станет доступно после построения фото-модели или ввода ручных параметров. Черновики можно восстанавливать уже сейчас.</p>}
      {comparison.modeChanged && <p>Способ ввода отличается.</p>}
      {comparison.photoChanged && <p>Фотография отличается.</p>}
      {comparison.inputsChanged && <p>Ответы, измерения, настройки или шаг помощника отличаются.</p>}
      <p className="version-restore-note">Перед возвратом сохраним текущую работу отдельной версией. Построенную модель потребуется снова проверить перед получением файлов.</p>
      <div className="version-actions"><button type="button" className="secondary-button" disabled={busy || atLimit} onClick={() => onRestore(selected.id)}><RotateCcw size={16} /> Восстановить версию</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => onFork(selected.id)}><Copy size={16} /> Открыть отдельным проектом</button></div>
    </section>}
    <div className="version-fork"><p>Новая деталь на основе текущего варианта? История останется в исходном проекте.</p>
      <button type="button" className="text-button" disabled={busy} onClick={() => onFork()}><Copy size={16} /> Создать отдельный проект</button></div>
  </DialogContent></Dialog>;
}
