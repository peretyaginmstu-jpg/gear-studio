"use client";
import { useEffect, useState } from 'react';
import { Download, CheckCircle2, LoaderCircle, FileJson } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { modelNames, type ModelParams } from '@/lib/model';
import { exportPresets, prepareModelExport, type ExportPreset, type ModelProvenance } from '@/lib/modelExport';
import { downloadBlob } from '@/lib/download';

type Prepared = { url: string; filename: string; triangles: number; bytes: number; warnings: string[]; passport: string };
export function ExportDialog({ open, onOpenChange, params, preset, origin, evidence }: {
  open: boolean; onOpenChange: (v: boolean) => void; params: ModelParams; preset: ExportPreset;
} & ModelProvenance) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open && <ExportContent key={`${preset}:${JSON.stringify(params)}:${origin}`} params={params} preset={preset} origin={origin} evidence={evidence} />}</Dialog>;
}
/** Each opening/parameter set owns fresh acceptance and a single prepared file. */
function ExportContent({ params, preset, origin, evidence }: { params: ModelParams; preset: ExportPreset } & ModelProvenance) {
  const [accepted, setAccepted] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let url: string | null = null;
    const timer = setTimeout(() => {
      try {
        const { mesh, validation: check, stl: bytes, passport } = prepareModelExport(params, preset, { origin, evidence });
        if (disposed) return;
        url = URL.createObjectURL(new Blob([bytes], { type: 'model/stl' }));
        const suffix = params.kind === 'worm' ? `starts${params.wormStarts ?? 1}` : `z${params.teeth}`;
        setPrepared({ url, filename: `gear-${params.kind}-${suffix}-m${params.module.toFixed(3)}-${preset}.stl`, triangles: check.triangles, bytes: bytes.byteLength, warnings: mesh.warnings.map(w => w.message), passport: JSON.stringify(passport, null, 2) });
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : 'Не удалось построить STL.'); }
    }, 20);
    return () => { disposed = true; clearTimeout(timer); if (url) { const old = url; setTimeout(() => URL.revokeObjectURL(old), 60_000); } };
  }, [params, preset, origin, evidence]);
  return <DialogContent className="engineering-dialog export-dialog">
    <DialogHeader><div className="dialog-kicker"><Download size={17} /> ЭКСПОРТ МОДЕЛИ</div><DialogTitle>{exportPresets[preset].title}</DialogTitle><DialogDescription>{modelNames[params.kind]} · {params.kind === 'bevel' ? 'внешний mₑ' : params.kind === 'worm' ? 'mₓ' : params.kind === 'cycloidal' ? 'm' : 'mₙ'} {params.module.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} мм · {exportPresets[preset].detail}</DialogDescription></DialogHeader>
    <p>Бесплатно{preset === 'pro' ? ' в раннем доступе' : ''}. Импортируйте STL в миллиметрах. Паспорт ниже описывает именно этот файл и его фактическую сетку.</p>
    <p>Детализация усиливает дискретизацию кривых там, где это применимо. У реек и некоторых других профилей число треугольников может совпасть с Standard. Это не класс точности изготовления.</p>
    {!prepared && !error && <p className="inline-status" role="status"><LoaderCircle className="spin-icon" size={17} /> Строим и проверяем сетку…</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {prepared && <><div className="export-ready" role="status"><CheckCircle2 size={18} /><span>{prepared.triangles.toLocaleString('ru-RU')} треугольников · {(prepared.bytes / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} МБ</span></div><div className="export-assumptions"><strong>Условия рассчитанной модели</strong><ul>{prepared.warnings.map((w, i) => <li key={i}>{w}</li>)}<li>Пара колёс, нагрузка, ресурс и точность изготовленной детали не проверены.</li></ul></div></>}
    <label className="check-row"><Checkbox checked={accepted} onCheckedChange={v => setAccepted(v === true)} /><span>Условия модели понятны. Использую STL для пробного изготовления и проверки.</span></label>
    {prepared && accepted ? <a className="primary-button full" href={prepared.url} download={prepared.filename} data-testid="stl-download"><Download size={17} /> Скачать модель</a> : <button className="primary-button full" disabled><Download size={17} /> Скачать модель</button>}
    <button className="secondary-button full" disabled={!prepared} data-testid="export-passport" onClick={() => { if (prepared) downloadBlob(prepared.passport, 'application/json', prepared.filename.replace('.stl', '-passport.json')); }}><FileJson size={17} /> Паспорт этого STL</button>
  </DialogContent>;
}
