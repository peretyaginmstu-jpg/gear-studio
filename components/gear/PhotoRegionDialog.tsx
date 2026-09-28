"use client";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Crop, Check, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { photoRegionFromCorners, type PhotoRegion, type RegionPoint } from '@/lib/photo-region';
import { useActivePopup } from './useActivePopup';

export function PhotoRegionDialog({ active, busy, image, width, height, region, onApply }: {
  active: boolean; busy: boolean; image: string; width: number; height: number;
  region: PhotoRegion | null; onApply: (region: PhotoRegion | null) => void;
}) {
  const popup = useActivePopup(active), instructions = useId();
  const [points, setPoints] = useState<[RegionPoint | null, RegionPoint | null]>([null, null]);
  const [corner, setCorner] = useState<0 | 1>(0), [cursor, setCursor] = useState({ x: Math.round(width / 2), y: Math.round(height / 2) });
  const [focused, setFocused] = useState(false);
  const pointerStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const selection = useMemo(() => {
    if (!points[0] || !points[1]) return { ready: false, region: null, error: null };
    try { return { ready: true, region: photoRegionFromCorners(points[0], points[1], { width, height }), error: null }; }
    catch (e) { return { ready: false, region: null, error: e instanceof Error ? e.message : 'Проверьте углы рамки.' }; }
  }, [points, width, height]);
  const open = (next: boolean) => {
    if (next) {
      setPoints(region ? [{ x: region.x, y: region.y }, { x: region.x + region.width, y: region.y + region.height }] : [null, null]);
      setCorner(0); setCursor({ x: region?.x ?? Math.round(width / 2), y: region?.y ?? Math.round(height / 2) });
      pointerStart.current = null;
    }
    popup.onOpenChange(next);
  };
  const put = (point: RegionPoint) => {
    if (!active || busy) return;
    setPoints(previous => corner === 0 ? [point, previous[1]] : [previous[0], point]);
    setCursor(point); if (corner === 0) setCorner(1);
  };
  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const start = pointerStart.current; pointerStart.current = null;
    if (!start || start.id !== event.pointerId || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 6) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    // A pixel-edge selection. The complete image keeps its native aspect ratio.
    const point = { x: Math.round((event.clientX - rect.left) * width / rect.width), y: Math.round((event.clientY - rect.top) * height / rect.height) };
    if (point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height) { put(point); event.currentTarget.focus({ preventScroll: true }); }
  };
  const keyImage = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = event.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (delta) { event.preventDefault(); setCursor(p => ({ x: Math.max(0, Math.min(width, p.x + delta[0])), y: Math.max(0, Math.min(height, p.y + delta[1])) })); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); put(cursor); }
  };
  const apply = (value: PhotoRegion | null) => { if (active && !busy) { onApply(value); popup.onOpenChange(false); } };
  const box = selection.ready ? selection.region ?? { x: 0, y: 0, width, height } : null;
  const marker = Math.max(width, height) / 100;
  return <div className="photo-region-entry">
    <Dialog open={popup.open} onOpenChange={open}>
      <DialogTrigger asChild><button type="button" disabled={busy || !active} className="secondary-button full"><Crop size={17} />{region ? 'Изменить область детали' : 'Указать деталь на фото'}</button></DialogTrigger>
      <DialogContent className="photo-region-dialog">
        <DialogTitle>Укажите деталь на полном снимке</DialogTitle>
        <DialogDescription>Отметьте два противоположных угла рамки. Вся деталь и небольшой запас фона должны быть внутри; эталон и соседние предметы могут остаться снаружи.</DialogDescription>
        <p id={instructions} className="region-help">Область нужна только для анализа контура. Полное фото останется доступным для измерения по эталону. Касание рамкой зубьев может привести к отказу анализа.</p>
        <div className="region-toolbar">{([0, 1] as const).map(index => <button type="button" className="secondary-button" key={index} aria-pressed={corner === index} onClick={() => { setCorner(index); if (points[index]) setCursor(points[index]!); }}>{index + 1}. {index === 0 ? 'Первый угол' : 'Второй угол'}{points[index] && Number.isFinite(points[index]!.x) && Number.isFinite(points[index]!.y) && <Check size={14} />}</button>)}
          <button type="button" className="text-button" onClick={() => { setPoints([null, null]); setCorner(0); }}><RotateCcw size={15} /> Новая рамка</button>
        </div>
        <div className="region-image-wrap">
          <svg data-testid="photo-region-image" viewBox={`0 0 ${width} ${height}`} width={width} height={height}
            style={{ width: `min(100%, calc(45dvh * ${width / height}))` }}
            role="group" tabIndex={0} aria-label="Полное фото для выбора двух углов рамки" aria-describedby={instructions}
            onPointerDown={e => { if (e.button === 0) pointerStart.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; }} onPointerUp={pointerUp} onPointerCancel={() => { pointerStart.current = null; }}
            onKeyDown={keyImage} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
            <image href={image} width={width} height={height} />
            {box && <g pointerEvents="none"><path d={`M0,0 H${width} V${height} H0 Z M${box.x},${box.y} V${box.y + box.height} H${box.x + box.width} V${box.y} Z`} fill="#17263866" fillRule="evenodd" />
              <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="none" stroke="#94661f" strokeWidth={2} vectorEffect="non-scaling-stroke" /></g>}
            {points.map((point, index) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && <g key={index} pointerEvents="none">
              <circle cx={point.x} cy={point.y} r={marker * .45} fill="#94661f" stroke="white" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              <text x={point.x + marker} y={point.y - marker} fill="white" stroke="#49320f" strokeWidth={marker * .16} fontSize={marker * 1.5} paintOrder="stroke">{index + 1}</text></g>)}
            {focused && <g stroke="#d83750" strokeWidth={1.5} pointerEvents="none"><line x1={cursor.x - marker} y1={cursor.y} x2={cursor.x + marker} y2={cursor.y} vectorEffect="non-scaling-stroke" /><line x1={cursor.x} y1={cursor.y - marker} x2={cursor.x} y2={cursor.y + marker} vectorEffect="non-scaling-stroke" /></g>}
          </svg>
        </div>
        <p className="region-help" aria-live="polite">Сейчас: {corner === 0 ? 'первый' : 'второй'} угол. Прицел ({cursor.x}, {cursor.y}) px. Стрелки — шаг 1 px, Shift — 10 px, Enter — поставить угол. Можно ввести координаты ниже.</p>
        <div className="region-coordinate-grid">{([0, 1] as const).map(index => <fieldset key={index}><legend>Угол {index + 1}</legend><div>{(['x', 'y'] as const).map(axis => <label key={axis}>{axis}, px<input type="number" min={0} max={axis === 'x' ? width : height} step={1} aria-label={`Угол ${index + 1}, ${axis}, px`} value={Number.isFinite(points[index]?.[axis]) ? points[index]![axis] : ''} onChange={e => {
          const value = e.target.value === '' ? NaN : Number(e.target.value);
          setPoints(previous => { const next: [RegionPoint | null, RegionPoint | null] = [...previous]; next[index] = { x: previous[index]?.x ?? NaN, y: previous[index]?.y ?? NaN, [axis]: value }; return next; });
        }} /></label>)}</div></fieldset>)}</div>
        {selection.error && <p className="inline-error" role="alert">{selection.error}</p>}
        {box && <p className="region-help">Будет проанализировано {box.width} × {box.height} px; начало ({box.x}, {box.y}) полного рабочего кадра {width} × {height} px. Это выбор кадрирования, не измерение размера детали.</p>}
        <p className="region-reset-note">Изменение принятой области может означать другую деталь. Тип, измерения, подтверждения и разметку масштаба потребуется задать заново. Неизменённая рамка сохранит ответы.</p>
        <div className="region-actions"><button type="button" className="secondary-button" onClick={() => open(false)}>Отмена</button><button type="button" className="primary-button" disabled={!selection.ready || busy} onClick={() => apply(selection.region)}><Check size={17} /> Применить область</button></div>
        <button type="button" className="text-button region-full-image" disabled={busy} onClick={() => apply(null)}>Анализировать весь снимок</button>
      </DialogContent>
    </Dialog>
    <p className="field-help">{region ? `Анализ области ${region.width} × ${region.height} px. Для масштаба сохранён полный снимок.` : 'Если рядом есть эталон или другие предметы, выделите только деталь для анализа.'}</p>
  </div>;
}
