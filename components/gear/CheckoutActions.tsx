"use client";
import { useState } from 'react';
import { ArrowRight, Download, Info, Printer } from 'lucide-react';
import type { BuiltModel, DeliveryChoice } from '@/lib/journey';
import type { ExportPreset } from '@/lib/modelExport';
import { ExportDialog } from './ExportDialog';
import { PrintDialog } from './PrintDialog';
import { ManufacturingRequirements } from './ManufacturingRequirements';
import { useProjectField } from './ProjectContext';
import { emptyManufacturingDraft } from '@/lib/manufacturing';

/** Mounted only for a confirmed checkout snapshot; leaving checkout closes its dialogs. */
export function CheckoutActions({ model, choice, onChange, projectName }: { model: BuiltModel; choice: DeliveryChoice; onChange: () => void; projectName: string }) {
  const [exportPreset, setExportPreset] = useState<ExportPreset | null>(null), [printOpen, setPrintOpen] = useState(false);
  const [manufacturing, setManufacturing] = useProjectField('manufacturing', 'draft', emptyManufacturingDraft);
  const isPrint = choice.kind === 'print';
  return <>
    <div className="checkout-choice">
      {isPrint ? <Printer size={25} /> : <Download size={25} />}
      <div><span>Вы выбрали</span><h2>{isPrint ? 'Подготовку к печати' : choice.preset === 'pro' ? 'Pro STL + документы' : 'Standard STL'}</h2></div>
    </div>
    <p className="delivery-intro">{isPrint ? 'Укажите принтер и материал. Мы оценим геометрию и подготовим задание для расчёта или пробной печати.' : 'Файл будет построен по подтверждённой модели. Скачайте STL отдельно или подготовьте комплект с PDF размерного листа и JSON-паспортом.'}</p>
    <div className="checkout-total"><span>{isPrint ? 'Оценка и файлы задания' : 'Итого за файлы сейчас'}</span><strong>Бесплатно</strong></div>
    <ManufacturingRequirements mesh={model.mesh} draft={manufacturing} setDraft={setManufacturing} />
    {choice.kind === 'file' && choice.preset === 'pro' && <p className="access-note">Pro бесплатно в раннем доступе</p>}
    <button className="primary-button full package-primary" onClick={() => isPrint ? setPrintOpen(true) : setExportPreset(choice.preset)}>
      {isPrint ? 'Настроить печать и получить задание' : `Скачать ${choice.preset === 'pro' ? 'Pro' : 'Standard'} STL`} <ArrowRight size={20} />
    </button>
    {isPrint && <button className="secondary-button full" onClick={() => setExportPreset('standard')}><Download size={18} /> Скачать STL этой модели</button>}
    <button className="inline-link" onClick={onChange}>Изменить способ получения</button>
    <p className="delivery-note"><Info size={19} />{isPrint ? 'Задание скачивается на ваше устройство. Заказ исполнителю не отправляется; стоимость изготовления и оплата будут отдельным шагом позже.' : 'Оплата не требуется. Скачивание не подтверждает пригодность детали под нагрузкой: перед изготовлением проверьте сопряжение.'}</p>
    <ExportDialog open={exportPreset !== null} onOpenChange={open => { if (!open) setExportPreset(null); }} params={model.params} preset={exportPreset ?? 'standard'} origin={model.origin} evidence={model.evidence} projectName={projectName} manufacturing={manufacturing} />
    <PrintDialog open={printOpen} onOpenChange={setPrintOpen} mesh={model.mesh} validation={model.validation} provenance={{ origin: model.origin, evidence: model.evidence, manufacturing }} />
  </>;
}
