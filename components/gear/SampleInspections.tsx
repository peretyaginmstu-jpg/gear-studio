"use client";
import { useState, type Dispatch, type SetStateAction } from 'react';
import { ClipboardCheck, Plus, Copy, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { downloadBlob } from '@/lib/download';
import { APP_VERSION } from '@/lib/appVersion';
import { manufacturingReport, manufacturingNumber as number, type ManufacturingDraft } from '@/lib/manufacturing';
import { MAX_INSPECTIONS, newSampleInspection, copySampleInspection, recordSampleInspection, sampleInspectionReport,
  inspectionResultLabels, inspectionRule, type SampleInspection } from '@/lib/sampleInspection';
import type { ModelMesh } from '@/lib/model';

export function SampleInspections({ mesh, manufacturing, records, setRecords, projectName }: {
  mesh: ModelMesh; manufacturing: ManufacturingDraft; records: SampleInspection[];
  setRecords: Dispatch<SetStateAction<SampleInspection[]>>; projectName: string;
}) {
  const [open, setOpen] = useState(false), [selected, setSelected] = useState(''), [error, setError] = useState('');
  const [removed, setRemoved] = useState<SampleInspection | null>(null);
  const record = records.find(r => r.id === selected) ?? records.at(-1);
  const report = record ? sampleInspectionReport(record, mesh, manufacturing) : null;
  const requirements = manufacturingReport(mesh, manufacturing), atLimit = records.length >= MAX_INSPECTIONS;
  const canStart = requirements?.status === 'reviewed' && !!requirements.dimensions.length && !atLimit;
  const locked = report?.recordState === 'recorded';
  const edit = <K extends keyof SampleInspection>(key: K, value: SampleInspection[K]) => {
    if (!record || locked) return;
    setRecords(previous => previous.map(r => r.id === record.id ? { ...r, [key]: value, recorded: null } : r));
  };
  const add = (copy = false) => {
    try {
      if (atLimit) return;
      const next = copy && record ? copySampleInspection(record) : newSampleInspection(mesh, manufacturing);
      setRecords(previous => [...previous, next]); setSelected(next.id); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось начать протокол.'); }
  };
  return <section className="manufacturing-summary inspection-summary" aria-label="Проверка образца">
    <h3><ClipboardCheck size={19} /> Проверка образца</h3>
    <p>{records.length ? `Протоколов в проекте: ${records.length}. Измерения сохраняются с исходными пределами.` : 'Изготовили пробную деталь? Запишите измерения и сравните их с требованиями мастерской.'}</p>
    <button className="secondary-button full" onClick={() => setOpen(true)}><ClipboardCheck size={17} />{records.length ? 'Открыть протоколы' : 'Проверить образец'}</button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="engineering-dialog manufacturing-dialog inspection-dialog">
      <DialogHeader><div className="dialog-kicker"><ClipboardCheck size={18} /> ПРОВЕРКА ОБРАЗЦА</div><DialogTitle>Измерения изготовленной детали</DialogTitle><DialogDescription>Сравните каждый отсчёт с требованиями. Протокол сохранится в проекте, PDF и паспорте модели.</DialogDescription></DialogHeader>
      <p>Записывайте фактические измерения. Числовое сравнение не заменяет решение о приёмке и проверку работы передачи.</p>
      <div className="inspection-toolbar"><button className="secondary-button" disabled={!canStart} onClick={() => add()}><Plus size={16} /> Новый образец</button>
        <button className="secondary-button" disabled={!record || atLimit} onClick={() => add(true)}><Copy size={16} /> Копия для исправления</button></div>
      {!canStart && <p className="inspection-hint">{atLimit ? `В проекте уже ${MAX_INSPECTIONS} протоколов. Скачайте проект для сохранения и продолжите в отдельном проекте.` : 'Чтобы начать новый образец, добавьте предельные размеры в задание мастерской и сверьте требования с моделью.'}</p>}
      {error && <p role="alert" className="inline-error">{error}</p>}
      {removed && <p>Черновик убран. <button className="text-button" disabled={atLimit} onClick={() => { setRecords(previous => [...previous, removed]); setSelected(removed.id); setRemoved(null); }}>Вернуть черновик</button> Отмена доступна до выхода с этого шага.</p>}
      {!!records.length && <label className="inspection-selector">Протокол<select value={record?.id ?? ''} onChange={event => { setSelected(event.target.value); setError(''); }}>
        {records.map((r, index) => <option key={r.id} value={r.id}>{index + 1}. {r.sample || 'Новый образец'} · {r.measuredOn || 'дата не задана'}</option>)}
      </select></label>}
      {record && report && <>
        <div className={`inspection-reference ${report.reference}`} role="status"><strong>{report.reference === 'current' ? 'Исходные требования совпадают с текущими' : 'Протокол относится к прежней модели или требованиям'}</strong>
          <p>{record.basis.modelName} · приложение {record.basis.appVersion}. Требования сверены {new Date(record.basis.requirements.review!.reviewedAt).toLocaleString('ru-RU')}.</p>
          <p>{report.reference === 'historical' ? 'Ниже сохранены прежние пределы. Новая геометрия и новые требования не меняют эти результаты.' : 'Пределы зафиксированы при создании протокола и не меняются вслед за моделью.'}</p>
          <p>Материал по исходному заданию: {record.basis.requirements.material || 'не задан'}. {record.basedOn && 'Создана отдельная копия; исходная запись сохранена.'}</p>
        </div>
        <fieldset disabled={locked} className="manufacturing-fields"><legend className="visually-hidden">Данные измерений</legend>
          <div className="manufacturing-input-grid"><label>Обозначение образца<input maxLength={120} value={record.sample} onChange={event => edit('sample', event.target.value)} placeholder="Например, пробная деталь №1" /></label>
            <label>Дата измерений<input type="date" value={record.measuredOn} onChange={event => edit('measuredOn', event.target.value)} /></label></div>
          <label>Кто измерял, необязательно<input maxLength={120} value={record.operator} onChange={event => edit('operator', event.target.value)} /></label>
          <label>Инструмент и метод измерения<textarea rows={2} maxLength={240} value={record.instrument} onChange={event => edit('instrument', event.target.value)} placeholder="Прибор, идентификатор, метод и места измерения" /></label>
          <label>Условия измерения<textarea rows={2} maxLength={500} value={record.conditions} onChange={event => edit('conditions', event.target.value)} placeholder="Температура, выдержка, ориентация, подготовка поверхности" /></label>
          <details className="inspection-help"><summary>Как учитывать неопределённость измерения</summary><p>Если расширенная неопределённость U известна, укажите её в мм и основание оценки. Цена деления прибора сама по себе не является U. Неизвестное оставьте пустым: тогда сравнивается только введённое число, без заключения о соответствии.</p><p>{inspectionRule}</p></details>
          <label>Основание для U, если она задана<textarea rows={2} maxLength={500} value={record.uncertaintyBasis} onChange={event => edit('uncertaintyBasis', event.target.value)} placeholder="Источник оценки U, коэффициент охвата k или оговорённый уровень охвата" /></label>
          {report.rows.map((row, index) => <fieldset key={row.dimension} className="manufacturing-tolerance inspection-reading"><legend>{row.label}</legend>
            <p>Номинал {number(row.nominal)} мм · пределы {number(row.minimum)}…{number(row.maximum)} мм</p>
            <label>Отсчёты, мм<textarea rows={2} maxLength={500} aria-label={`Отсчёты: ${row.label}`} value={record.readings[index].values}
              onChange={event => edit('readings', record.readings.map((r, i) => i === index ? { ...r, values: event.target.value } : r))} placeholder="8,012; 8,015; 8,014" /></label>
            <p className="inspection-hint">До 12 отсчётов одного размера. Разделяйте точкой с запятой или новой строкой; запятая служит десятичным разделителем.</p>
            <label>Расширенная неопределённость U, мм<input inputMode="decimal" maxLength={24} aria-label={`Неопределённость: ${row.label}`} value={record.readings[index].uncertainty}
              onChange={event => edit('readings', record.readings.map((r, i) => i === index ? { ...r, uncertainty: event.target.value } : r))} placeholder="Оставьте пустым, если неизвестна" /></label>
            {!!row.errors.length && <p className="inline-error">{row.errors.join(' ')}</p>}
            {!!row.readings.length && <ol className="inspection-results">{row.readings.map((r, i) => <li key={i} className={`inspection-result ${r.result}`}>
              <strong>{r.input || 'Пустой отсчёт'} мм</strong>{r.low !== null && row.uncertainty !== null && <span> · интервал {number(r.low)}…{number(r.high!)} мм</span>}<span> — {inspectionResultLabels[r.result]}</span>
            </li>)}</ol>}
          </fieldset>)}
          <label>Примечания к образцу<textarea rows={3} maxLength={1000} value={record.notes} onChange={event => edit('notes', event.target.value)} placeholder="Сборка, заедание, наблюдения; не подменяйте ими измерения" /></label>
        </fieldset>
        <div className={`inspection-verdict ${report.result}`} aria-live="polite"><strong>{inspectionResultLabels[report.result]}</strong>
          {!!report.issues.length && <ul>{report.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
          <p>{locked ? `Запись зафиксирована ${new Date(report.recordedAt!).toLocaleString('ru-RU')}. Для исправления создайте копию.` : 'Черновик сохраняется автоматически. После заполнения зафиксируйте запись.'}</p><p>{report.interpretation}</p></div>
        <div className="inspection-toolbar"><button className="secondary-button" onClick={() => downloadBlob(JSON.stringify({ schema: 'zatseplenie.inspection-document.v1', appVersion: APP_VERSION, projectName, inspection: report }, null, 2), 'application/json', `gear-inspection-${record.id}.json`)}><Download size={16} /> Скачать протокол JSON</button>
          {!locked && <button className="text-button" onClick={() => { setRemoved(record); setRecords(previous => previous.filter(r => r.id !== record.id)); setError(''); }}>Убрать черновик</button>}</div>
      </>}
      <div className="manufacturing-actions"><button className="secondary-button" onClick={() => setOpen(false)}>Закрыть</button>
        <button className="primary-button" disabled={!record || !report || !!report.issues.length || locked} onClick={() => {
          try { if (record) { const next = recordSampleInspection(record, mesh, manufacturing); setRecords(previous => previous.map(r => r.id === next.id ? next : r)); setError(''); } }
          catch (e) { setError(e instanceof Error ? e.message : 'Проверьте введённые измерения.'); }
        }}><ClipboardCheck size={17} /> Зафиксировать запись</button></div>
    </DialogContent></Dialog>
  </section>;
}
