"use client";
import { useEffect, useRef, useState } from 'react';
import { useProjectActivity, useProjectField } from './ProjectContext';
import { appendReferencePhotos, MAX_REFERENCE_PHOTOS, type ReferencePhoto } from '@/lib/referencePhotos';
import { preparePhotoFile } from '@/lib/preparePhoto';

export function useReferencePhotos(onDraftChange: () => void) {
  const [photos, setPhotos] = useProjectField<ReferencePhoto[]>('photoReferences', 'photos', []);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [undoPhotos, setUndoPhotos] = useState<ReferencePhoto[] | null>(null), request = useRef(0);
  useProjectActivity(busy);
  useEffect(() => () => { request.current++; }, []);
  const commit = (next: ReferencePhoto[], message: string, undo = true) => {
    setUndoPhotos(undo ? photos : null); setPhotos(next); setNotice(message); setError(''); onDraftChange();
  };
  const load = async (files: File[], replaceId?: string): Promise<string | null> => {
    if (!files.length || busy) return null;
    if (!replaceId && photos.length + files.length > MAX_REFERENCE_PHOTOS) {
      setError(`Свободных мест: ${MAX_REFERENCE_PHOTOS - photos.length}. Выберите меньше файлов или замените снимок.`); return null;
    }
    const previous = replaceId ? photos.find(photo => photo.id === replaceId) : null;
    if (replaceId && !previous) return null;
    const id = ++request.current;
    setBusy(true); setError('');
    try {
      const prepared: ReferencePhoto[] = [];
      for (const file of files) {
        try {
          const image = await preparePhotoFile(file, true);
          if (id !== request.current) return null;
          prepared.push({ ...image, id: crypto.randomUUID(), role: previous?.role ?? 'other', note: '' });
        } catch (error) { throw new Error(`${file.name.slice(0, 100)}: ${error instanceof Error ? error.message : 'не удалось прочитать снимок.'}`); }
      }
      const next = replaceId ? photos.map(photo => photo.id === replaceId ? prepared[0] : photo) : appendReferencePhotos(photos, prepared);
      commit(next, replaceId ? 'Ракурс заменён. Подпишите новое фото; прежнюю заметку можно вернуть вместе со снимком.' : `Добавлено снимков: ${prepared.length}. Укажите назначение ракурсов.`);
      return prepared[0].id;
    } catch (error) { if (id === request.current) setError(error instanceof Error ? error.message : 'Не удалось загрузить ракурсы.'); return null; }
    finally { if (id === request.current) setBusy(false); }
  };
  return { photos, busy, error, notice, canUndo: undoPhotos !== null, reportError: setError,
    addFiles: (files: File[]) => load(files), replaceFile: (id: string, file: File) => load([file], id),
    update: (id: string, patch: Pick<Partial<ReferencePhoto>, 'role' | 'note'>) => {
      const found = photos.find(photo => photo.id === id);
      if (!found || busy || Object.entries(patch).every(([key, value]) => found[key as 'role' | 'note'] === value)) return;
      commit(photos.map(photo => photo.id === id ? { ...photo, ...patch } : photo), '', false);
    },
    remove: (id: string) => { if (!busy && photos.some(photo => photo.id === id)) commit(photos.filter(photo => photo.id !== id), 'Ракурс убран из текущей работы.'); },
    undo: () => { if (undoPhotos && !busy) { setPhotos(undoPhotos); setUndoPhotos(null); setNotice('Предыдущее состояние ракурсов возвращено.'); onDraftChange(); } },
    // The caller commits the main image and invalidates its measurements in the same React batch.
    replaceFromPrimary: (next: ReferencePhoto[]) => { setPhotos(next); setUndoPhotos(null); setError(''); setNotice('Прежнее основное фото сохранено среди ракурсов, если оно было загружено.'); },
  };
}
export type ReferencePhotosController = ReturnType<typeof useReferencePhotos>;
