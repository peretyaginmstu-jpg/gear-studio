"use client";
import { useEffect, useState } from 'react';
import { Download, CheckCircle2, LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { exportBinarySTL, validateMesh } from '@/lib/gearMath';
import { buildModelMesh, modelNames, type ModelParams } from '@/lib/model';

type Prepared = { url: string; filename: string; triangles: number; bytes: number; warnings: string[] };
export function ExportDialog({ open, onOpenChange, params }: { open: boolean; onOpenChange: (v: boolean) => void; params: ModelParams }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open && <ExportContent key={JSON.stringify(params)} params={params} />}</Dialog>;
}
/** Each opening/parameter set owns fresh acceptance and a single prepared file. */
function ExportContent({ params }: { params: ModelParams }) {
  const [accepted, setAccepted] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let url: string | null = null;
    const timer = setTimeout(() => {
      try {
        const mesh = buildModelMesh(params, { flankSamples: 24 });
        const check = validateMesh(mesh);
        const bytes = exportBinarySTL(mesh);
        if (disposed) return;
        url = URL.createObjectURL(new Blob([bytes], { type: 'model/stl' }));
        const suffix = params.kind === 'worm' ? `starts${params.wormStarts ?? 1}` : `z${params.teeth}`;
        setPrepared({ url, filename: `gear-${params.kind}-${suffix}-m${params.module.toFixed(3)}.stl`, triangles: check.triangles, bytes: bytes.byteLength, warnings: mesh.warnings.map(w => w.message) });
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : 'Не удалось построить STL.'); }
    }, 20);
    return () => { disposed = true; clearTimeout(timer); if (url) { const old = url; setTimeout(() => URL.revokeObjectURL(old), 60_000); } };
  }, [params]);
  return <DialogContent className="engineering-dialog export-dialog">
    <DialogHeader><div className="dialog-kicker"><Download size={17} /> ЭКСПОРТ МОДЕЛИ</div><DialogTitle>STL для пробного изготовления</DialogTitle><DialogDescription>{modelNames[params.kind]} · {params.kind === 'bevel' ? 'внешний mₑ' : params.kind === 'worm' ? 'mₓ' : params.kind === 'cycloidal' ? 'm' : 'mₙ'} {params.module.toLocaleString('ru-RU')} мм</DialogDescription></DialogHeader>
    <p>Размеры заданы в миллиметрах. Выберите эти единицы при импорте в слайсер.</p>
    {!prepared && !error && <p className="inline-status" role="status"><LoaderCircle className="spin-icon" size={17} /> Строим и проверяем сетку…</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {prepared && <><div className="export-ready" role="status"><CheckCircle2 size={18} /><span>{prepared.triangles.toLocaleString('ru-RU')} треугольников · {(prepared.bytes / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} МБ</span></div><div className="export-assumptions"><strong>Условия рассчитанной модели</strong><ul>{prepared.warnings.map((w, i) => <li key={i}>{w}</li>)}<li>Пара колёс, нагрузка, ресурс и точность изготовленной детали не проверены.</li></ul></div></>}
    <label className="check-row"><Checkbox checked={accepted} onCheckedChange={v => setAccepted(v === true)} /><span>Условия модели понятны. Использую STL для пробного изготовления и проверки.</span></label>
    {prepared && accepted ? <a className="primary-button full" href={prepared.url} download={prepared.filename} data-testid="stl-download"><Download size={17} /> Скачать модель</a> : <button className="primary-button full" disabled><Download size={17} /> Скачать модель</button>}
  </DialogContent>;
}
