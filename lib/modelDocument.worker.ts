import { createModelDocuments } from './modelDocuments';
import type { ModelDocumentInput } from './modelDocumentData';

self.onmessage = async (event: MessageEvent<ModelDocumentInput>) => {
  try {
    const prefix = process.env.NEXT_PUBLIC_BASE_PATH || '';
    const readFont = async (name: string) => {
      const response = await fetch(`${prefix}/fonts/${name}.ttf`);
      if (!response.ok) throw new Error('Не удалось загрузить шрифт PDF. Проверьте соединение и повторите.');
      return new Uint8Array(await response.arrayBuffer());
    };
    const [regular, bold] = await Promise.all([readFont('NotoSans-Regular'), readFont('NotoSans-Bold')]);
    const result = await createModelDocuments(event.data, { regular, bold });
    self.postMessage({ ok: true, pdf: result.pdf, zip: result.zip, pdfName: result.pdfName, zipName: result.zipName, pages: result.pages });
  } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Не удалось подготовить документы.' }); }
};
