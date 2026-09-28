"use client";
import { useState } from 'react';
import { ArrowRight, Download, Info, Printer } from 'lucide-react';
import type { BuiltModel, DeliveryChoice } from '@/lib/journey';
import type { ModelParams } from '@/lib/model';
import type { ExportPreset } from '@/lib/modelExport';
import { ExportDialog } from './ExportDialog';
import { PrintDialog } from './PrintDialog';
import { ManufacturingRequirements } from './ManufacturingRequirements';
import { useProjectField } from './ProjectContext';
import { emptyManufacturingDraft } from '@/lib/manufacturing';
import { SampleInspections } from './SampleInspections';
import type { SampleInspection } from '@/lib/sampleInspection';
import { LayersOrder } from './LayersOrder';

/** Mounted only for a confirmed checkout snapshot; leaving checkout closes its dialogs. */
export function CheckoutActions({ model, choice, onChange, projectName, onAdjustParams }: { model: BuiltModel; choice: DeliveryChoice; onChange: () => void; projectName: string; onAdjustParams: (params: ModelParams) => void }) {
  const [exportPreset, setExportPreset] = useState<ExportPreset | null>(null), [printOpen, setPrintOpen] = useState(false);
  const [manufacturing, setManufacturing] = useProjectField('manufacturing', 'draft', emptyManufacturingDraft);
  const [inspections, setInspections] = useProjectField<SampleInspection[]>('inspections', 'records', []);
  const isPrint = choice.kind === 'print';
  return <>
    <div className="checkout-choice">
      {isPrint ? <Printer size={25} /> : <Download size={25} />}
      <div><span>Вы выбрали</span><h2>{isPrint ? 'Подготовку к печати' : choice.preset === 'pro' ? 'Pro STL + документы' : 'Standard STL'}</h2></div>
    </div>
    <p className="delivery-intro">{isPrint ? 'Принтер и материал — мы оценим геометрию и дадим задание для печати.' : 'STL по подтверждённой модели; PDF и паспорт — в том же окне.'} Бесплатно.</p>
    <button className="primary-button full package-primary" onClick={() => isPrint ? setPrintOpen(true) : setExportPreset(choice.preset)}>
      {isPrint ? 'Настроить печать и получить задание' : `Скачать ${choice.preset === 'pro' ? 'Pro' : 'Standard'} STL`} <ArrowRight size={20} />
    </button>
    {isPrint && <button className="secondary-button full" onClick={() => setExportPreset('standard')}><Download size={18} /> Скачать STL этой модели</button>}
    <LayersOrder model={model} projectName={projectName} manufacturing={manufacturing} setInspections={setInspections} onAdjustParams={onAdjustParams} />
    <div className="tool-tray checkout-tray"><span className="tool-tray-label">Для мастерской</span><div className="tool-tray-chips">
      <ManufacturingRequirements mesh={model.mesh} draft={manufacturing} setDraft={setManufacturing} />
      <SampleInspections mesh={model.mesh} manufacturing={manufacturing} records={inspections} setRecords={setInspections} projectName={projectName} />
    </div></div>
    <button className="inline-link" onClick={onChange}>Изменить способ получения</button>
    <p className="delivery-note"><Info size={19} />{isPrint ? 'Задание скачивается на ваше устройство и никуда не отправляется.' : 'Перед изготовлением проверьте сопряжение: файл не подтверждает работу под нагрузкой.'}</p>
    <ExportDialog open={exportPreset !== null} onOpenChange={open => { if (!open) setExportPreset(null); }} params={model.params} preset={exportPreset ?? 'standard'} origin={model.origin} evidence={model.evidence} projectName={projectName} manufacturing={manufacturing} inspections={inspections} />
    <PrintDialog open={printOpen} onOpenChange={setPrintOpen} mesh={model.mesh} validation={model.validation} provenance={{ origin: model.origin, evidence: model.evidence, manufacturing, inspections }} />
  </>;
}
