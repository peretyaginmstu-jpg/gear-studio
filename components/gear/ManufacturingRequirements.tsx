"use client";
import { useState, type Dispatch, type SetStateAction } from 'react';
import { ClipboardList, Plus, Check, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { manufacturingDimensions, manufacturingDimensionNames, manufacturingNumber, manufacturingPurposes, manufacturingProcesses,
  manufacturingReport, manufacturingStatus, reviewManufacturing, type ManufacturingDraft, type ManufacturingDimensionId } from '@/lib/manufacturing';
import { modelNames, type ModelMesh } from '@/lib/model';

export function ManufacturingRequirements({ mesh, draft, setDraft }: { mesh: ModelMesh; draft: ManufacturingDraft; setDraft: Dispatch<SetStateAction<ManufacturingDraft>> }) {
  const [open, setOpen] = useState(false);
  const report = manufacturingReport(mesh, draft), dimensions = manufacturingDimensions(mesh);
  const change = <K extends keyof ManufacturingDraft>(key: K, value: ManufacturingDraft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const updateTolerance = (index: number, patch: Partial<ManufacturingDraft['tolerances'][number]>) => setDraft(previous => ({ ...previous,
    tolerances: previous.tolerances.map((row, i) => i === index ? { ...row, ...patch } : row) }));
  const available = dimensions.find(option => !draft.tolerances.some(row => row.dimension === option.id));
  // A quiet chip; the card with all fields opens only on demand.
  const badge = report ? report.status === 'reviewed' ? 'сверены' : report.status === 'needs-review' ? 'сверить' : 'черновик' : null;
  return <>
    <button type="button" className={`tool-chip${badge ? ' active' : ''}`} aria-haspopup="dialog" onClick={() => { change('enabled', true); setOpen(true); }}>
      <ClipboardList size={16} /><span>Требования к детали</span>{badge && <b>{badge}</b>}</button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="engineering-dialog manufacturing-dialog">
      <DialogHeader><div className="dialog-kicker"><ClipboardList size={18} /> ЗАДАНИЕ МАСТЕРСКОЙ</div><DialogTitle>Требования к изготовлению</DialogTitle><DialogDescription>{modelNames[mesh.params.kind]}. Заполните известное; остальное можно согласовать с исполнителем.</DialogDescription></DialogHeader>
      <p>Карточка сохраняется в проекте и его версиях, входит в PDF, паспорт STL и задание печати. Заказ автоматически не отправляется.</p>
      <label className="check-row"><Checkbox checked={draft.enabled} onCheckedChange={value => change('enabled', value === true)} /><span>Включать требования в документы</span></label>
      <fieldset disabled={!draft.enabled} className="manufacturing-fields"><legend className="visually-hidden">Требования пользователя</legend>
        <div className="manufacturing-input-grid">
          <label>Назначение<select value={draft.purpose} onChange={event => change('purpose', event.target.value as ManufacturingDraft['purpose'])}>{Object.entries(manufacturingPurposes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Количество, шт.<input inputMode="numeric" maxLength={12} value={draft.quantity} onChange={event => change('quantity', event.target.value)} /></label>
          <label>Способ изготовления<select value={draft.process} onChange={event => change('process', event.target.value as ManufacturingDraft['process'])}>{Object.entries(manufacturingProcesses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Материал готовой детали<input maxLength={120} placeholder="Марка и производитель, если известны" value={draft.material} onChange={event => change('material', event.target.value)} /></label>
        </div>
        <label>Где работает деталь<textarea rows={2} maxLength={500} value={draft.application} onChange={event => change('application', event.target.value)} placeholder="Механизм и задача этой детали" /></label>
        <label>Нагрузка и условия работы<textarea rows={2} maxLength={800} value={draft.operatingConditions} onChange={event => change('operatingConditions', event.target.value)} placeholder="Известные момент, обороты, температура, смазка, требуемый ресурс" /></label>
        <label>Ответная деталь и сопряжение<textarea rows={2} maxLength={500} value={draft.matingPart} onChange={event => change('matingPart', event.target.value)} placeholder="Вал, ответное колесо, способ крепления или ссылка на обозначение чертежа" /></label>
        <section className="manufacturing-tolerances" aria-label="Предельные размеры">
          <h3>Размеры готовой детали</h3><p>Укажите нижнее и верхнее отклонения от номинала в мм. Знаки имеют значение: например, −0,02 и +0,03. Требования не изменяют STL; припуски и компенсацию нужно согласовать отдельно.</p>
          {draft.tolerances.map((row, index) => {
            const result = report?.dimensions[index], spec = dimensions.find(option => option.id === row.dimension), label = spec?.label ?? manufacturingDimensionNames[row.dimension];
            return <fieldset className="manufacturing-tolerance" key={index}><legend>Размер {index + 1}</legend>
              <label>Контролируемый размер<select aria-label={`Контролируемый размер ${index + 1}`} value={row.dimension} onChange={event => updateTolerance(index, { dimension: event.target.value as ManufacturingDimensionId })}>
                {!spec && <option value={row.dimension}>{label} — отсутствует у этой модели</option>}
                {dimensions.map(option => <option key={option.id} value={option.id} disabled={draft.tolerances.some((other, i) => i !== index && other.dimension === option.id)}>{option.label}</option>)}
              </select></label>
              <p className="manufacturing-nominal">Номинал текущей модели: {spec ? `${manufacturingNumber(spec.nominal)} мм` : 'не применяется'}</p>
              <div className="manufacturing-input-grid"><label>Нижнее отклонение, мм<input aria-label={`Нижнее отклонение: ${label}`} inputMode="decimal" maxLength={24} placeholder="−0,02" value={row.lower} onChange={event => updateTolerance(index, { lower: event.target.value })} /></label>
                <label>Верхнее отклонение, мм<input aria-label={`Верхнее отклонение: ${label}`} inputMode="decimal" maxLength={24} placeholder="+0,03" value={row.upper} onChange={event => updateTolerance(index, { upper: event.target.value })} /></label></div>
              {result && (result.errors.length ? <p className="inline-error">{result.errors.join(' ')}</p> : <p className="manufacturing-limits">Предельные размеры: {manufacturingNumber(result.minimum!)}…{manufacturingNumber(result.maximum!)} мм</p>)}
              <button className="text-button" aria-label={`Убрать допуск: ${label}`} onClick={() => change('tolerances', draft.tolerances.filter((_, i) => i !== index))}><Trash2 size={15} /> Убрать размер</button>
            </fieldset>;
          })}
          <button className="secondary-button" disabled={!available} onClick={() => { if (available) change('tolerances', [...draft.tolerances, { dimension: available.id, lower: '', upper: '' }]); }}><Plus size={16} /> Добавить размер с допуском</button>
        </section>
        <label>Примечания и контроль<textarea rows={3} maxLength={1000} value={draft.notes} onChange={event => change('notes', event.target.value)} placeholder="Что согласовать перед изготовлением, как проверить пробную деталь" /></label>
      </fieldset>
      {report && <div className={`manufacturing-review ${report.status}`} aria-live="polite"><strong>{manufacturingStatus[report.status]}</strong>
        {report.status === 'needs-review' && <p>{!report.review?.matchesModel ? 'Номиналы относятся к текущей модели. Прежняя отметка проверки относилась к другой модели или версии приложения.' : 'После последней проверки изменены требования.'}</p>}
        {!!report.issues.length && <ul>{report.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
        <p>Останется согласовать: {report.clarifications.join('; ')}.</p>
        {report.status === 'reviewed' && <p>Сверено пользователем {new Date(report.review!.reviewedAt).toLocaleString('ru-RU')}. Исполнитель ещё не подтверждал возможность изготовления.</p>}
      </div>}
      <div className="manufacturing-actions"><button className="secondary-button" onClick={() => setOpen(false)}>Закрыть</button>
        <button className="primary-button" disabled={!report || !!report.issues.length || report.status === 'reviewed'} onClick={() => setDraft(reviewManufacturing(mesh, draft))}><Check size={17} /> Сверено с этой моделью</button></div>
    </DialogContent></Dialog>
  </>;
}
