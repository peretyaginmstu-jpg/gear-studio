"use client";
import { useEffect, useState } from 'react';
import { Download, Check, LoaderCircle, Package, ArrowRight, FileBox, Mail } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { modelNames, type ModelParams } from '@/lib/model';
import { prepareModelExport } from '@/lib/modelExport';
import { modelDocumentInput } from '@/lib/modelDocumentData';
import { startModelDocuments } from '@/lib/modelDocumentClient';
import { modelProfileDxf, supportsDxf } from '@/lib/dxfExport';
import { downloadBlob } from '@/lib/download';
import { earlyAccessOffer, fetchProOffer, priceLabel, proContents, proPurchaseState, rememberPurchase, startProCheckout, validEmail, type ProOffer, type ProPurchaseState } from '@/lib/proOffer';
import { layersUrl, modelTitle } from '@/lib/layersOrder';
import { APP_VERSION } from '@/lib/appVersion';

type Phase = { kind: 'choose' } | { kind: 'working'; what: 'standard' | 'pro' | 'pay' } | { kind: 'done'; what: 'standard' | 'pro' } | { kind: 'error'; message: string }
  | { kind: 'purchase'; token: string; state: ProPurchaseState | null; error?: string };
const EMAIL_KEY = 'gear-pro-email';
const savedEmail = () => { try { return localStorage.getItem(EMAIL_KEY) ?? ''; } catch { return ''; } };
const origin = 'Параметры заданы вручную';
const stem = (p: ModelParams) => `gear-${p.kind}-${p.kind === 'worm' ? `starts${p.wormStarts ?? 1}` : `z${p.teeth}`}-m${p.module.toFixed(3)}`;

/**
 * One sheet from «Скачать» to the file: free Standard STL in one click, or the Pro package.
 * Clicking a download is the confirmation of the visible model (onAccept records it in the project).
 */
export function DownloadSheet({ open, onOpenChange, params, projectName, onAccept, onMore, returnToken = null, layersBase = layersUrl }: {
  open: boolean; onOpenChange: (open: boolean) => void; params: ModelParams; projectName: string;
  onAccept: () => boolean; onMore: () => void;
  /** Purchase the payment page returned with (#pro=…): the sheet opens on its status. */
  returnToken?: string | null; layersBase?: string;
}) {
  const [phase, setPhase] = useState<Phase>(() => returnToken ? { kind: 'purchase', token: returnToken, state: null } : { kind: 'choose' });
  const [offer, setOffer] = useState<ProOffer>(earlyAccessOffer), [email, setEmail] = useState(savedEmail);
  useEffect(() => { if (open && layersBase) void fetchProOffer(layersBase).then(setOffer); }, [open, layersBase]);
  const purchaseToken = phase.kind === 'purchase' && phase.state?.status !== 'paid' && phase.state?.status !== 'cancelled' ? phase.token : null;
  useEffect(() => {
    if (!purchaseToken || !open) return;
    let stop = false, timer = 0, tries = 0;
    const poll = async () => {
      try {
        const state = await proPurchaseState(layersBase, purchaseToken);
        if (stop) return;
        setPhase({ kind: 'purchase', token: purchaseToken, state });
        if (state.status === 'paid') rememberPurchase({ token: purchaseToken, title: state.title, at: new Date().toISOString() });
        if (state.status === 'pending' && ++tries < 40) timer = window.setTimeout(poll, 3000);
      } catch (e) { if (!stop) setPhase({ kind: 'purchase', token: purchaseToken, state: null, error: e instanceof Error ? e.message : 'Не удалось проверить оплату.' }); }
    };
    void poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [purchaseToken, open, layersBase]);
  const close = (value: boolean) => { onOpenChange(value); if (!value) setPhase({ kind: 'choose' }); };
  const pay = async () => {
    if (!validEmail(email)) { setPhase({ kind: 'error', message: 'Укажите email: на него придут чек и ссылка на скачивание.' }); return; }
    if (!onAccept()) { setPhase({ kind: 'error', message: 'Модель не строится с этими параметрами. Исправьте их и попробуйте снова.' }); return; }
    try { localStorage.setItem(EMAIL_KEY, email.trim()); } catch { /* ignore */ }
    setPhase({ kind: 'working', what: 'pay' });
    try {
      const { confirmation_url } = await startProCheckout(layersBase, { email, params, title: modelTitle(params), appVersion: APP_VERSION, returnUrl: window.location.href });
      window.location.assign(confirmation_url);
    } catch (e) { setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'Не удалось перейти к оплате.' }); }
  };
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
    setPhase({ kind: 'working', what: 'pro' });
    try {
      const prepared = prepareModelExport(params, 'pro', { origin, evidence: null }), filename = `${stem(params)}-pro.stl`;
      const input = { ...modelDocumentInput(prepared, filename, projectName), ...(supportsDxf(params) ? { extras: { [`${stem(params)}-profile.dxf`]: modelProfileDxf(params).dxf } } : {}) };
      const result = await startModelDocuments(input).promise;
      downloadBlob(result.zip as BlobPart, 'application/zip', result.zipName);
      setPhase({ kind: 'done', what: 'pro' });
    } catch (e) { setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'Не удалось подготовить комплект.' }); }
  };
  const busy = phase.kind === 'working', paid = offer.paymentsEnabled && offer.priceRub > 0;
  if (phase.kind === 'purchase') return <Dialog open={open} onOpenChange={close}>
    <DialogContent className="download-sheet">
      <PurchaseStatus phase={phase} onRetry={() => setPhase({ kind: 'choose' })} onMore={() => { close(false); onMore(); }} />
    </DialogContent>
  </Dialog>;
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
            {paid && <label className="download-email"><Mail size={16} /><input type="email" autoComplete="email" inputMode="email" placeholder="Email для чека и ссылки" aria-label="Email для чека и ссылки"
              value={email} onChange={e => setEmail(e.target.value)} /></label>}
            <button type="button" className="primary-button full" disabled={busy} onClick={() => void (paid ? pay() : pro())}>
              {phase.kind === 'working' && phase.what !== 'standard' ? <><LoaderCircle className="spin-icon" size={18} /> {phase.what === 'pay' ? 'Переходим к оплате…' : 'Собираем комплект…'}</>
                : paid ? <>Оплатить и скачать · {priceLabel(offer)}</> : <><Download size={18} /> Скачать комплект</>}</button>
            <p className="download-fine">{paid ? 'Оплата один раз через ЮKassa, без подписки. Чек и ссылка на повторное скачивание — на почту.' : 'Бесплатно в раннем доступе.'}</p>
          </section>
        </div>
        {phase.kind === 'error' && <p className="inline-error" role="alert">{phase.message}</p>}
        <p className="download-fine">Скачивая файл, вы подтверждаете размеры модели на экране. Прочность и посадку проверяют на пробном образце.</p>
      </>}
    </DialogContent>
  </Dialog>;
}

/** After the payment page: wait for Layers to confirm, then hand out the server-built package. */
function PurchaseStatus({ phase, onRetry, onMore }: { phase: Extract<Phase, { kind: 'purchase' }>; onRetry: () => void; onMore: () => void }) {
  const state = phase.state;
  if (state?.status === 'paid' && state.download_url) return <>
    <DialogTitle>Оплачено — спасибо!</DialogTitle>
    <DialogDescription>{state.title}</DialogDescription>
    <div className="download-done" role="status">
      <span className="download-done-icon"><Check size={28} /></span>
      <p>Pro-комплект готов: STL, DXF, PDF и паспорт в одном ZIP. Ссылка на повторное скачивание — в письме.</p>
      <a className="primary-button full" href={state.download_url} download><Download size={18} /> Скачать комплект</a>
      <button type="button" className="text-button" onClick={onMore}>Печать, заказ и документы для мастерской</button>
    </div>
  </>;
  if (state?.status === 'cancelled') return <>
    <DialogTitle>Оплата не прошла</DialogTitle>
    <DialogDescription>Деньги не списаны. Можно попробовать ещё раз.</DialogDescription>
    <button type="button" className="primary-button full" onClick={onRetry}>Вернуться к скачиванию</button>
  </>;
  return <>
    <DialogTitle>Проверяем оплату…</DialogTitle>
    <DialogDescription>{phase.error ?? 'Обычно это занимает несколько секунд. Окно можно не закрывать.'}</DialogDescription>
    {phase.error ? <button type="button" className="secondary-button full" onClick={onRetry}>Вернуться к скачиванию</button>
      : <p className="download-wait" role="status"><LoaderCircle className="spin-icon" size={20} /> {state?.status === 'pending' ? 'Ждём подтверждение от ЮKassa' : 'Связываемся с Layers'}</p>}
    <p className="download-fine">Если оплата прошла, а файл не появился, ссылка придёт на почту.</p>
  </>;
}
