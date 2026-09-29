"use client";
/* eslint-disable @next/next/no-img-element -- Normalized project PNGs are local and must not enter an image proxy. */
import { useId, useRef, useState } from 'react';
import { Images, Plus, Replace, RotateCcw, ScanLine, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { referencePhotoRoles, MAX_REFERENCE_PHOTOS, type ReferencePhotoRole } from '@/lib/referencePhotos';
import { useActivePopup } from './useActivePopup';
import type { ReferencePhotosController } from './useReferencePhotos';

const roleHints: Record<ReferencePhotoRole, string> = {
  side: 'Проследите зуб по всей ширине: прямой, наклонённый или две встречные половины. Угол наклона по перспективному фото не измеряется автоматически.',
  body: 'Покажите отверстие, ступицу или основание и отдельно запишите измеренные размеры. Фотография не заменяет измерение посадки.',
  damage: 'Покажите повреждённый участок крупно и укажите, что нужно восстановить. Видимые остатки не подтверждают исходное полное число зубьев.',
  partner: 'Покажите ответную деталь и расположение осей. Совместимость пары нужно проверять по её параметрам.',
  other: 'Укажите, что видно на снимке и какой вопрос он помогает уточнить. Заметка останется рядом с фото.',
};

export function ReferencePhotos({ controller, active, disabled = false, hint = 'Снимки и заметки рядом с параметрами', onUseForContour, onReturnToMain, defaultOpen = false }: {
  defaultOpen?: boolean; controller: ReferencePhotosController; active: boolean; disabled?: boolean; hint?: string;
  onUseForContour?: (id: string) => Promise<boolean>;
  onReturnToMain?: () => void;
}) {
  const { photos } = controller, busy = disabled || controller.busy;
  const popup = useActivePopup(active), [selectedId, setSelectedId] = useState<string | null>(null), [confirmMain, setConfirmMain] = useState(false);
  const [actualSize, setActualSize] = useState(false), opener = useRef<HTMLButtonElement | null>(null), summary = useRef<HTMLElement | null>(null);
  const promoting = useRef(false);
  const selected = photos.find(photo => photo.id === selectedId), upload = useRef<HTMLInputElement>(null), replace = useRef<HTMLInputElement>(null), fieldsId = useId();
  const open = (id: string, button: HTMLButtonElement) => { opener.current = button; promoting.current = false; setSelectedId(id); setConfirmMain(false); setActualSize(false); popup.onOpenChange(true); };
  return <div className="reference-photos">
    <details open={defaultOpen || undefined}><summary ref={summary}><Images size={20} /><span>Другие ракурсы <small>{hint}</small></span><b>{photos.length}/{MAX_REFERENCE_PHOTOS}</b></summary>
      <div className="reference-photos-body"><p>Добавьте вид сбоку, посадку, повреждение или ответную деталь. Снимки общие для обоих способов ввода и сохраняются в проекте. Они помогают осмотру; параметры подтверждаете вы.</p>
        {photos.length > 0 && <ul className="reference-photo-grid">{photos.map((photo, index) => <li key={photo.id}><button type="button" disabled={!active || busy} onClick={event => open(photo.id, event.currentTarget)} aria-label={`Открыть ракурс ${index + 1}: ${photo.source.fileName}`}>
          <img src={photo.image} alt="" /><strong>{referencePhotoRoles[photo.role]}</strong><span>{photo.source.fileName}</span>{photo.note && <small>Есть заметка</small>}
        </button></li>)}</ul>}
        <button type="button" className="secondary-button" disabled={!active || busy || photos.length >= MAX_REFERENCE_PHOTOS} onClick={() => upload.current?.click()}><Plus size={17} /> Добавить ракурсы</button>
        <p className="reference-photo-limit">До четырёх дополнительных снимков · JPG, PNG, WebP · до 20 МБ каждый. В проекте сохраняются уменьшенные копии.</p>
        {controller.busy && <p role="status" className="reference-photo-hint">Подготавливаем снимки…</p>}
        {controller.error && <p className="inline-error" role="alert">{controller.error} Прежние снимки сохранены.</p>}
        {(controller.notice || controller.canUndo) && <div className="reference-photo-notice" role="status">{controller.notice && <p>{controller.notice}</p>}{controller.canUndo && <button type="button" className="text-button" disabled={!active || busy} onClick={controller.undo}><RotateCcw size={15} /> Отменить изменение ракурсов</button>}</div>}
      </div>
    </details>
    <input ref={upload} type="file" accept="image/png,image/jpeg,image/webp" multiple className="visually-hidden" aria-label="Добавить дополнительные снимки" disabled={!active || busy} onChange={event => {
      const files = Array.from(event.target.files ?? []); event.target.value = ''; void controller.addFiles(files);
    }} />
    <input ref={replace} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden" aria-label="Заменить дополнительный снимок" disabled={!active || busy} onChange={async event => {
      const file = event.target.files?.[0], id = selectedId; event.target.value = '';
      if (file && id) { const next = await controller.replaceFile(id, file); if (next) setSelectedId(next); }
    }} />
    <Dialog open={popup.open && !!selected} onOpenChange={popup.onOpenChange}><DialogContent className="reference-photo-dialog" onCloseAutoFocus={event => {
      event.preventDefault();
      if (promoting.current && onReturnToMain) onReturnToMain();
      else if (active) (opener.current?.isConnected ? opener.current : summary.current)?.focus();
    }}>
      <div><DialogTitle>Ракурс образца</DialogTitle><DialogDescription>{selected?.source.fileName}</DialogDescription></div>
      {selected && <><div className="reference-photo-zoom" role="group" aria-label="Масштаб ракурса"><button type="button" aria-pressed={!actualSize} onClick={() => setActualSize(false)}>Вписать</button><button type="button" aria-pressed={actualSize} onClick={() => setActualSize(true)}>100% копии</button></div>
        <div className={`reference-photo-view ${actualSize ? 'actual' : ''}`} tabIndex={actualSize ? 0 : undefined} role={actualSize ? 'region' : undefined} aria-label={actualSize ? 'Снимок с прокруткой' : undefined}><img width={actualSize ? selected.width : undefined} height={actualSize ? selected.height : undefined} src={selected.image} alt={`${referencePhotoRoles[selected.role]}: ${selected.source.fileName}`} /></div>
        <nav className="reference-photo-switch" aria-label="Ракурсы образца">{photos.map((photo, index) => <button type="button" key={photo.id} disabled={busy} aria-pressed={photo.id === selected.id} onClick={() => { setSelectedId(photo.id); setConfirmMain(false); setActualSize(false); }}>{index + 1}. {referencePhotoRoles[photo.role]}</button>)}</nav>
        <div className="reference-photo-fields"><label htmlFor={`${fieldsId}-role`}>Что показано<select id={`${fieldsId}-role`} disabled={busy} value={selected.role} onChange={event => controller.update(selected.id, { role: event.target.value as ReferencePhotoRole })}>
          {Object.entries(referencePhotoRoles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label><label htmlFor={`${fieldsId}-note`}>Что нужно проверить<textarea id={`${fieldsId}-note`} disabled={busy} value={selected.note} onChange={event => controller.update(selected.id, { note: event.target.value })} maxLength={600} rows={3} placeholder="Например: проверить ширину венца без выступающей ступицы" /></label></div>
        <p className="reference-photo-hint">{roleHints[selected.role]}</p>
        <div className="reference-photo-actions"><button type="button" className="text-button" disabled={busy} onClick={() => replace.current?.click()}><Replace size={16} /> Заменить снимок</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => { controller.remove(selected.id); popup.onOpenChange(false); }}><Trash2 size={16} /> Убрать ракурс</button>
          {onUseForContour && <button type="button" className="text-button" disabled={busy} onClick={() => setConfirmMain(true)}><ScanLine size={16} /> Сделать основным</button>}
        </div>
        {controller.error && <p className="inline-error" role="alert">{controller.error} Текущий снимок сохранён.</p>}
        {busy && <p role="status" className="reference-photo-hint">Подготавливаем снимок…</p>}
        {confirmMain && onUseForContour && <div className="reference-photo-promote"><strong>Анализировать контур этого снимка?</strong><p>Разметка масштаба и ответы по прежнему основному снимку сбросятся. Само прежнее фото сохраним среди ракурсов. Выберите торцевой снимок с полным контуром детали.</p>
          <div><button type="button" className="primary-button" disabled={busy} onClick={async () => {
            promoting.current = true;
            if (await onUseForContour(selected.id)) { popup.onOpenChange(false); setConfirmMain(false); }
            else promoting.current = false;
          }}>Сменить основное фото</button><button type="button" className="text-button" disabled={busy} onClick={() => setConfirmMain(false)}>Оставить прежнее</button></div>
        </div>}
      </>}
    </DialogContent></Dialog>
  </div>;
}
