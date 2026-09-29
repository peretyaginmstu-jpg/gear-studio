"use client";
import { useState } from 'react';
import { Download, Check, LoaderCircle, Package, ArrowRight, FileBox } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { modelNames, type ModelParams } from '@/lib/model';
import { prepareModelExport } from '@/lib/modelExport';
import { modelDocumentInput } from '@/lib/modelDocumentData';
import { startModelDocuments } from '@/lib/modelDocumentClient';
import { modelProfileDxf, supportsDxf } from '@/lib/dxfExport';
import { downloadBlob } from '@/lib/download';
import { earlyAccessOffer, priceLabel, proContents, type ProOffer } from '@/lib/proOffer';

type Phase = { kind: 'choose' } | { kind: 'working'; what: 'standard' | 'pro' } | { kind: 'done'; what: 'standard' | 'pro' } | { kind: 'error'; message: string };
const origin = 'Параметры заданы вручную';
const stem = (p: ModelParams) => `gear-${p.kind}-${p.kind === 'worm' ? `starts${p.wormStarts ?? 1}` : `z${p.teeth}`}-m${p.module.toFixed(3)}`;

/**
 * One sheet from «Скачать» to the file: free Standard STL in one click, or the Pro package.
 * Clicking a download is the confirmation of the visible model (onAccept records it in the project).
 */
export function DownloadSheet({ open, onOpenChange, params, projectName, onAccept, onMore, offer = earlyAccessOffer, payPro }: {
  open: boolean; onOpenChange: (open: boolean) => void; params: ModelParams; projectName: string;
  onAccept: () => boolean; onMore: () => void; offer?: ProOffer;
  /** Phase 2: resolves when the Pro package is paid (or immediately for free early access). */
  payPro?: () => Promise<boolean>;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const close = (value: boolean) => { onOpenChange(value); if (!value) setPhase({ kind: 'choose' }); };
  const standard = () => {
    if (!onAccept()) { setPhase({ kind: 'error', message: 'Модель не строится с этими параметрами. Исправьте их и попробуйте снова.' }); return; }
    try {
      const { stl } = prepareModelExport(params, 'standard', { origin, evidence: null });
      downloadBlob(stl, 'model/stl', `${stem(params)}-standard.stl`);
      setPhase({ kind: 'done', what: 'standard' });
    } catch (e) { setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'Не удалось подготовить STL.' }); }
  };
  const pro = async () => {
    if (!onAccept()) { setPhase({ kind: 'error', message: 'Модель не строится с этими параметрами. Исправьте их и попробуйте снова.' }); return; }
    if (payPro && !(await payPro())) return;
    setPhase({ kind: 'working', what: 'pro' });
    try {
      const prepared = prepareModelExport(params, 'pro', { origin, evidence: null }), filename = `${stem(params)}-pro.stl`;
      const input = { ...modelDocumentInput(prepared, filename, projectName), ...(supportsDxf(params) ? { extras: { [`${stem(params)}-profile.dxf`]: modelProfileDxf(params).dxf } } : {}) };
      const result = await startModelDocuments(input).promise;
      downloadBlob(result.zip as BlobPart, 'application/zip', result.zipName);
      setPhase({ kind: 'done', what: 'pro' });
    } catch (e) { setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'Не удалось подготовить комплект.' }); }
  };
  const busy = phase.kind === 'working';
  return <Dialog open={open} onOpenChange={close}>
    <DialogContent className="download-sheet">
      <DialogTitle>{phase.kind === 'done' ? 'Готово!' : 'Скачать модель'}</DialogTitle>
      <DialogDescription>{modelNames[params.kind]} · {params.kind === 'worm' ? `z₁ ${params.wormStarts ?? 1}` : `z ${params.teeth}`} · m {params.module.toLocaleString('ru-RU', { maximumFractionDigits: 4 })} мм · b {params.width} мм</DialogDescription>
      {phase.kind === 'done' ? <div className="download-done" role="status">
        <span className="download-done-icon"><Check size={28} /></span>
        <p>{phase.what === 'pro' ? 'Комплект в загрузках: STL, DXF, PDF и паспорт в одном ZIP.' : 'STL в загрузках. Импортируйте его в миллиметрах.'}</p>
        <button type="button" className="primary-button full" onClick={() => { close(false); onMore(); }}>Печать, заказ и документы для мастерской <ArrowRight size={18} /></button>
        <button type="button" className="text-button" onClick={() => setPhase({ kind: 'choose' })}>Скачать ещё вариант</button>
      </div> : <>
        <div className="download-options">
          <section className="download-card">
            <div className="download-card-head"><FileBox size={22} /><div><h3>STL</h3><p>Для просмотра и пробной печати</p></div><strong>Бесплатно</strong></div>
            <button type="button" className="secondary-button full" disabled={busy} onClick={standard}><Download size={18} /> Скачать STL</button>
          </section>
          <section className="download-card featured">
            <div className="download-card-head"><Package size={22} /><div><h3>Pro-комплект</h3><p>Всё для изготовления в одном ZIP</p></div><strong>{priceLabel(offer)}</strong></div>
            <ul>{proContents.map(item => <li key={item.id}><Check size={15} /><span><b>{item.title}</b> — {item.hint}</span></li>)}</ul>
            <button type="button" className="primary-button full" disabled={busy} onClick={() => void pro()}>
              {phase.kind === 'working' ? <><LoaderCircle className="spin-icon" size={18} /> Собираем комплект…</> : offer.priceRub > 0 ? <>Оплатить и скачать · {priceLabel(offer)}</> : <><Download size={18} /> Скачать комплект</>}</button>
            <p className="download-fine">{offer.priceRub > 0 ? 'Оплата один раз, без подписки. Чек и ссылка на повторное скачивание — на почту.' : 'Бесплатно в раннем доступе.'}</p>
          </section>
        </div>
        {phase.kind === 'error' && <p className="inline-error" role="alert">{phase.message}</p>}
        <p className="download-fine">Скачивая файл, вы подтверждаете размеры модели на экране. Прочность и посадку проверяют на пробном образце.</p>
      </>}
    </DialogContent>
  </Dialog>;
}
