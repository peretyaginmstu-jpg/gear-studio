"use client";
import { useState } from 'react';
import { ExternalLink, LoaderCircle, Factory } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import type { BuiltModel } from '@/lib/journey';
import type { ManufacturingDraft } from '@/lib/manufacturing';
import { layersUrl, prepareLayersDraft, sendLayersDraft } from '@/lib/layersOrder';

/** «Заказать печать в Layers»: the model goes to the studio only after this explicit confirmation. */
export function LayersOrder({ model, projectName, manufacturing }: { model: BuiltModel; projectName: string; manufacturing: ManufacturingDraft }) {
  const [open, setOpen] = useState(false), [agreed, setAgreed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [link, setLink] = useState('');
  if (!layersUrl) return null;
  const send = async () => {
    setBusy(true); setError(''); setLink('');
    // Opened synchronously inside the click so the browser does not treat it as a popup.
    const tab = window.open('', '_blank');
    try {
      const draft = await prepareLayersDraft({ params: model.params, origin: model.origin, evidence: model.evidence, projectName, revision: model.revision, manufacturing });
      const result = await sendLayersDraft(draft);
      setLink(result.orderUrl);
      if (tab) { tab.opener = null; tab.location.href = result.orderUrl; }
    } catch (e) { tab?.close(); setError(e instanceof Error ? e.message : 'Не удалось передать модель.'); }
    finally { setBusy(false); }
  };
  return <>
    <button className="secondary-button full layers-order-button" onClick={() => { setOpen(true); setAgreed(false); setError(''); setLink(''); }}><Factory size={18} /> Заказать печать в Layers</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="engineering-dialog">
        <DialogHeader><div className="dialog-kicker"><Factory size={17} /> СТУДИЯ 3D-ПЕЧАТИ LAYERS</div><DialogTitle>Заказать печать этой модели</DialogTitle>
          <DialogDescription>Модель сразу окажется в заказе: в Layers останется выбрать материал и количество. Студия согласует цену и требования, оплата — после подтверждения.</DialogDescription></DialogHeader>
        <div className="export-assumptions"><strong>Что будет передано</strong><ul>
          <li>Standard STL этой модели и его SHA-256, единицы — миллиметры.</li>
          <li>Параметры, расчётные размеры, название проекта «{projectName}» и ревизия модели.</li>
          <li>Карточка требований мастерской, если она заполнена.</li>
          <li>Фотографии, история проекта и контакты не передаются. Email вы укажете уже в Layers.</li></ul></div>
        <label className="check-row"><Checkbox checked={agreed} onCheckedChange={v => setAgreed(v === true)} /><span>Передать модель в Layers. Ссылка на заказ действует 72 часа.</span></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        {link && <p className="inline-status" role="status">Модель в заказе. Если вкладка не открылась: <a className="inline-link" href={link} target="_blank" rel="noopener noreferrer">открыть заказ в Layers <ExternalLink size={14} /></a></p>}
        <button className="primary-button full" disabled={!agreed || busy} onClick={send}>{busy ? <><LoaderCircle className="spin-icon" size={17} /> Передаём модель…</> : <>Перейти к заказу в Layers <ExternalLink size={17} /></>}</button>
      </DialogContent>
    </Dialog>
  </>;
}
