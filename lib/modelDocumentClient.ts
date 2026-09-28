import type { ModelDocumentInput } from './modelDocumentData';

export interface PreparedDocuments { pdf: Uint8Array; zip: Uint8Array; pdfName: string; zipName: string; pages: number }
export function startModelDocuments(input: ModelDocumentInput) {
  const worker = new Worker(new URL('./modelDocument.worker.ts', import.meta.url));
  let rejectPending: (reason: Error) => void = () => {};
  const promise = new Promise<PreparedDocuments>((resolve, reject) => {
    rejectPending = reject;
    worker.onmessage = (event: MessageEvent<PreparedDocuments & { ok: boolean; error?: string }>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data); else reject(new Error(event.data.error || 'Не удалось подготовить документы.'));
    };
    worker.onerror = () => { worker.terminate(); reject(new Error('Подготовка документов прервалась. Повторите; STL и паспорт доступны отдельно.')); };
    worker.postMessage(input);
  });
  return { promise, cancel: () => { worker.terminate(); rejectPending(new Error('Подготовка отменена.')); } };
}
