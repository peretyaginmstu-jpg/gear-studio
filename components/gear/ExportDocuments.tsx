"use client";
import { useEffect, useRef, useState } from 'react';
import { Archive, FileText, LoaderCircle } from 'lucide-react';
import type { ModelDocumentInput } from '@/lib/modelDocumentData';

export function ExportDocuments({ input, accepted }: { input: ModelDocumentInput; accepted: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [ready, setReady] = useState<{ pdfUrl: string; zipUrl: string; pdfName: string; zipName: string; pages: number; zipBytes: number } | null>(null);
  const generation = useRef(0), cancelTask = useRef<(() => void) | null>(null), urls = useRef<string[]>([]);
  useEffect(() => () => {
    generation.current++; cancelTask.current?.();
    // Snapshot ownership: React Strict Mode's first cleanup must not revoke URLs created later.
    const owned = [...urls.current]; urls.current = [];
    setTimeout(() => owned.forEach(url => URL.revokeObjectURL(url)), 60_000);
  }, []);
  const prepare = async () => {
    if (busy) return;
    const token = ++generation.current; setBusy(true); setError('');
    try {
      const { startModelDocuments } = await import('@/lib/modelDocumentClient');
      if (token !== generation.current) return;
      const task = startModelDocuments(input); cancelTask.current = task.cancel;
      const result = await task.promise;
      if (token !== generation.current) return;
      const pdfUrl = URL.createObjectURL(new Blob([new Uint8Array(result.pdf)], { type: 'application/pdf' }));
      const zipUrl = URL.createObjectURL(new Blob([new Uint8Array(result.zip)], { type: 'application/zip' }));
      urls.current.push(pdfUrl, zipUrl); cancelTask.current = null;
      setReady({ pdfName: result.pdfName, zipName: result.zipName, pages: result.pages, pdfUrl, zipUrl, zipBytes: result.zip.byteLength }); setBusy(false);
    } catch (failure) {
      if (token !== generation.current) return;
      setBusy(false); cancelTask.current = null;
      setError(failure instanceof Error ? failure.message : 'Не удалось создать документы. Повторите подготовку.');
    }
  };
  return <section className="export-documents" aria-label="Документы модели">
    <h3>Для проверки и передачи в мастерскую</h3>
    <p>PDF с проекциями, габаритами STL и номинальными параметрами. ZIP объединяет модель, этот PDF и JSON-паспорт. Фото и история передаются отдельным файлом проекта.</p>
    {!ready && <button className="secondary-button full" disabled={busy} onClick={() => { void prepare(); }}><FileText size={17} /> Подготовить PDF и ZIP</button>}
    {busy && <div className="document-progress"><p role="status"><LoaderCircle className="spin-icon" size={17} /> Готовим проекции и документы…</p><button className="text-button" onClick={() => { generation.current++; cancelTask.current?.(); cancelTask.current = null; setBusy(false); }}>Отменить подготовку</button></div>}
    {error && <p className="inline-error" role="alert">{error} STL и паспорт можно скачать отдельно.</p>}
    {ready && <><p className="document-ready" role="status">Документы готовы · {ready.pages} стр. · ZIP {(ready.zipBytes / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} МБ</p>
      <a className="secondary-button full" href={ready.pdfUrl} download={ready.pdfName} data-testid="dimensions-download"><FileText size={17} /> Размерный лист PDF</a>
      {accepted ? <a className="primary-button full" href={ready.zipUrl} download={ready.zipName} data-testid="package-download"><Archive size={17} /> Скачать комплект ZIP</a>
        : <button className="primary-button full" disabled><Archive size={17} /> Скачать комплект ZIP</button>}
      {!accepted && <p>Для скачивания комплекта со STL подтвердите условия модели выше.</p>}
    </>}
    <p className="document-scope">Размерный лист помогает сверить модель. Посадки, материал и допуски для рабочего чертежа нужно согласовать отдельно.</p>
  </section>;
}
