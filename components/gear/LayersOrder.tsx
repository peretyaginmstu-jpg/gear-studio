"use client";
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, LoaderCircle, Factory, RefreshCw, Repeat, ClipboardCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useProjectField } from './ProjectContext';
import type { BuiltModel } from '@/lib/journey';
import type { ManufacturingDraft } from '@/lib/manufacturing';
import type { ModelParams } from '@/lib/model';
import type { SampleInspection } from '@/lib/sampleInspection';
import { layersUrl, prepareLayersDraft, sendLayersDraft } from '@/lib/layersOrder';
import { accountToken, captureReferrer, draftStatus, inspectionFromLayers, layersMaterials, materialAdvice, repeatDraft,
  type LayersLink, type LayersMaterial, type LayersStatus, type RevisionTarget } from '@/lib/layersLink';

const fmtRub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
/** Opened synchronously inside a click so the browser does not treat it as a popup. */
const openTab = () => window.open('', '_blank');
const go = (tab: Window | null, url: string) => { if (tab) { tab.opener = null; tab.location.href = url; } };

/** «Заказать печать в Layers» and everything that comes back: status, measurements, repeat, revision. */
export function LayersOrder({ model, projectName, manufacturing, setInspections, onAdjustParams }: {
  model: BuiltModel; projectName: string; manufacturing: ManufacturingDraft;
  setInspections: (update: (records: SampleInspection[]) => SampleInspection[]) => void;
  onAdjustParams: (params: ModelParams) => void;
}) {
  const [links, setLinks] = useProjectField<LayersLink[]>('layers', 'links', []);
  const [revisionTarget, setRevisionTarget] = useProjectField<RevisionTarget | null>('layers', 'revisionTarget', null);
  const [open, setOpen] = useState(false), [agreed, setAgreed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [link, setLink] = useState(''), [asRevision, setAsRevision] = useState(!!revisionTarget);
  const [materials, setMaterials] = useState<LayersMaterial[] | null>(null), [material, setMaterial] = useState('');
  useEffect(() => { if (open && layersUrl && !materials) layersMaterials().then(r => setMaterials(r.materials)).catch(() => setMaterials([])); }, [open, materials]);
  if (!layersUrl) return null;
  const chosen = materials?.find(m => m.key === material) ?? null, advice = chosen ? materialAdvice(model.params, chosen) : null;

  const send = async () => {
    setBusy(true); setError(''); setLink('');
    const revision = asRevision && revisionTarget ? revisionTarget : null, tab = revision ? null : openTab();
    try {
      const draft = await prepareLayersDraft({ params: model.params, origin: model.origin, evidence: model.evidence, projectName,
        revision: model.revision, manufacturing, preferredMaterial: material || undefined, referrer: captureReferrer() ?? undefined });
      const result = await sendLayersDraft(draft, layersUrl, fetch, { revisionOf: revision?.token, referrer: captureReferrer() ?? undefined, bearer: accountToken() });
      setLinks(current => [{ token: result.token, orderUrl: result.orderUrl, sentAt: new Date().toISOString(), revision: model.revision,
        stlSha256: draft.manifest.stl.sha256, title: draft.manifest.title, kind: revision ? 'revision' : 'order',
        orderCode: result.revisionFor ?? null, importedMeasurements: [] } satisfies LayersLink, ...current].slice(0, 50));
      if (revision) { setRevisionTarget(null); setAsRevision(false); setLink(''); setOpen(false); }
      else { setLink(result.orderUrl); go(tab, result.orderUrl); }
    } catch (e) { tab?.close(); setError(e instanceof Error ? e.message : 'Не удалось передать модель.'); }
    finally { setBusy(false); }
  };

  return <>
    <button className="secondary-button full layers-order-button" onClick={() => { setOpen(true); setAgreed(false); setError(''); setLink(''); setAsRevision(!!revisionTarget); }}>
      <Factory size={18} /> {revisionTarget ? `Ревизия в заказ ${revisionTarget.orderCode ?? 'Layers'}` : 'Заказать печать в Layers'}</button>
    <LayersOrders links={links} setLinks={setLinks} model={model} manufacturing={manufacturing} setInspections={setInspections} />
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="engineering-dialog">
        <DialogHeader><div className="dialog-kicker"><Factory size={17} /> СТУДИЯ 3D-ПЕЧАТИ LAYERS</div><DialogTitle>{asRevision ? 'Новая ревизия модели в заказ' : 'Заказать печать этой модели'}</DialogTitle>
          <DialogDescription>{asRevision ? `STL приложится к заказу ${revisionTarget?.orderCode ?? ''}; студия заново подтвердит цену.` : 'Модель сразу окажется в заказе: в Layers останется выбрать материал и количество. Студия согласует цену и требования, оплата — после подтверждения.'}</DialogDescription></DialogHeader>
        {revisionTarget && <label className="check-row"><Checkbox checked={asRevision} onCheckedChange={v => setAsRevision(v === true)} /><span>Отправить как ревизию в заказ {revisionTarget.orderCode ?? ''}, а не новым заказом.</span></label>}
        {!asRevision && <div className="layers-material">
          <label className="field-label" htmlFor="layers-material">Материал печати</label>
          <select id="layers-material" className="select-control native" value={material} onChange={e => setMaterial(e.target.value)}>
            <option value="">Выберу в Layers</option>
            {(materials ?? []).map(m => <option key={m.key} value={m.key}>{m.label} · {m.price_per_gram} ₽/г · до {m.max_temp_c} °C</option>)}
          </select>
          {materials === null && open && <p className="field-help">Загружаем материалы студии…</p>}
          {advice && <ul className="field-help layers-advice">{advice.notes.map(n => <li key={n}>{n}</li>)}</ul>}
          {advice?.thinning != null && <button type="button" className="text-button" onClick={() => { setOpen(false); onAdjustParams({ ...model.params, backlash: advice.thinning! }); }}>
            Применить утонение {advice.thinning} мм и перестроить модель</button>}
        </div>}
        <div className="export-assumptions"><strong>Что будет передано</strong><ul>
          <li>Standard STL этой модели и его SHA-256, единицы — миллиметры.</li>
          <li>Параметры, расчётные размеры, название проекта «{projectName}» и ревизия модели.</li>
          <li>Карточка требований мастерской, если она заполнена.</li>
          <li>Фотографии и история проекта не передаются.{accountToken() ? ' Заказ будет привязан к вашему аккаунту Layers.' : ' Email вы укажете уже в Layers.'}</li></ul></div>
        <label className="check-row"><Checkbox checked={agreed} onCheckedChange={v => setAgreed(v === true)} /><span>Передать модель в Layers.{asRevision ? '' : ' Ссылка на заказ действует 72 часа.'}</span></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        {link && <p className="inline-status" role="status">Модель в заказе. Если вкладка не открылась: <a className="inline-link" href={link} target="_blank" rel="noopener noreferrer">открыть заказ в Layers <ExternalLink size={14} /></a></p>}
        <button className="primary-button full" disabled={!agreed || busy} onClick={send}>{busy ? <><LoaderCircle className="spin-icon" size={17} /> Передаём модель…</>
          : asRevision ? <>Отправить ревизию</> : <>Перейти к заказу в Layers <ExternalLink size={17} /></>}</button>
      </DialogContent>
    </Dialog>
  </>;
}

/** Orders sent from this project, with live status from Layers. */
function LayersOrders({ links, setLinks, model, manufacturing, setInspections }: {
  links: LayersLink[]; setLinks: (update: (links: LayersLink[]) => LayersLink[]) => void; model: BuiltModel; manufacturing: ManufacturingDraft;
  setInspections: (update: (records: SampleInspection[]) => SampleInspection[]) => void;
}) {
  const [statuses, setStatuses] = useState<Record<string, LayersStatus | Error>>({}), [loading, setLoading] = useState(false), [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    if (!links.length) return;
    setLoading(true);
    const entries = await Promise.all(links.slice(0, 10).map(async l => [l.token, await draftStatus(l.token).catch((e: Error) => e)] as const));
    setStatuses(Object.fromEntries(entries)); setLoading(false);
    const codes = new Map(entries.flatMap(([t, s]) => !(s instanceof Error) && s.order ? [[t, s.order.code]] : []));
    if ([...codes].some(([t, c]) => links.find(l => l.token === t)?.orderCode !== c)) setLinks(cur => cur.map(l => codes.has(l.token) ? { ...l, orderCode: codes.get(l.token)! } : l));
  }, [links, setLinks]);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer); }, [links.length]); // eslint-disable-line react-hooks/exhaustive-deps -- refresh on new links only
  if (!links.length) return null;
  const importMeasurements = (l: LayersLink, s: LayersStatus) => {
    setNotice('');
    try {
      const fresh = s.order!.measurements.filter(m => !l.importedMeasurements.includes(m.id));
      if (!fresh.length) { setNotice('Все протоколы этого заказа уже импортированы.'); return; }
      const records = fresh.map(m => inspectionFromLayers(model.mesh, manufacturing, s.order!.code, m));
      setInspections(cur => [...records, ...cur].slice(0, 20));
      setLinks(cur => cur.map(x => x.token === l.token ? { ...x, importedMeasurements: [...x.importedMeasurements, ...fresh.map(m => m.id)].slice(-40) } : x));
      setNotice(`Импортировано протоколов: ${records.length}. Они в разделе «Проверка образца».`);
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Не удалось импортировать измерения.'); }
  };
  const repeat = async (l: LayersLink) => {
    const tab = openTab();
    try { const r = await repeatDraft(l.token); go(tab, r.order_url);
      setLinks(cur => [{ ...l, token: r.token, orderUrl: r.order_url, sentAt: new Date().toISOString(), kind: 'repeat' as const, orderCode: null, importedMeasurements: [] }, ...cur].slice(0, 50));
    } catch (e) { tab?.close(); setNotice(e instanceof Error ? e.message : 'Не удалось повторить заказ.'); }
  };
  return <section className="layers-orders" aria-label="Заказы в Layers">
    <div className="layers-orders-head"><h3>Заказы в Layers</h3><button className="text-button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} /> Обновить</button></div>
    {notice && <p className="field-help" role="status">{notice}</p>}
    <ul>{links.slice(0, 10).map(l => { const s = statuses[l.token], o = s && !(s instanceof Error) ? s.order : null;
      return <li key={l.token}>
        <div><strong>{o?.code ?? l.orderCode ?? 'Черновик'}</strong> · {l.title}{l.kind !== 'order' && <em> · {l.kind === 'repeat' ? 'повтор' : 'ревизия'}</em>}
          {l.revision !== model.revision && <span className="field-help"> · модель с тех пор изменилась</span>}</div>
        {s instanceof Error ? <p className="field-help">{s.message}</p> : !s ? <p className="field-help">Загружаем статус…</p>
          : !o ? <p className="field-help">{s.state === 'expired' ? 'Ссылка истекла, заказ не оформлен.' : <>Заказ ещё не оформлен. <a className="inline-link" href={s.order_url ?? l.orderUrl} target="_blank" rel="noopener noreferrer">Продолжить в Layers</a></>}</p>
          : <>
            <p className="layers-status"><b>{o.cancelled ? 'Отменён' : o.status_label}</b>{o.status === 'printing' && ` · ${o.print_progress}%`} · {o.material} ×{o.qty}
              {' · '}{o.paid ? 'оплачен' : o.price_confirmed ? `к оплате ${fmtRub(o.remaining_rub)}` : 'цена на согласовании'}{o.due_date && ` · готов к ${new Date(o.due_date).toLocaleDateString('ru-RU')}`}</p>
            <ol className="layers-steps">{o.steps.map(step => <li key={step.key} className={step.done ? 'done' : ''}>{step.label}</li>)}</ol>
            <div className="layers-actions">
              <a className="inline-link" href={o.track_url} target="_blank" rel="noopener noreferrer">Отследить <ExternalLink size={13} /></a>
              {!o.cancelled && <button className="text-button" onClick={() => void repeat(l)}><Repeat size={15} /> Повторить заказ</button>}
              {o.measurements.length > 0 && <button className="text-button" onClick={() => importMeasurements(l, s)}><ClipboardCheck size={15} /> Измерения студии ({o.measurements.length}) → проверка образца</button>}
            </div>
          </>}
      </li>; })}</ul>
  </section>;
}
