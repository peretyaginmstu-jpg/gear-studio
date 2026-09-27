"use client";
import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { Check, Ruler, RotateCcw, Undo2, ZoomIn } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { estimatePhotoCircle, photoScaleSources, type PhotoPoint, type PhotoScaleInput, type PhotoScaleReadyResult } from '@/lib/photo-scale';

export interface PhotoScaleMeasurement {
  method: 'three-tip-circle-with-reference';
  coordinateSpace: 'working_image_pixels';
  input: PhotoScaleInput;
  result: PhotoScaleReadyResult;
  confirmedTipCircle: true;
  target: 'internal_tooth_tips' | 'external_tooth_tips';
  sources: typeof photoScaleSources;
}
interface Props {
  active?: boolean;
  image: string;
  width: number;
  height: number;
  internal: boolean;
  isApplied: boolean;
  onMeasured: (measurement: PhotoScaleMeasurement) => void;
  onInvalidated: () => void;
}
const rowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 };
const smallButton: CSSProperties = { margin: 0, padding: '7px 10px', minHeight: 36, fontSize: 13 };
const helpStyle: CSSProperties = { margin: '6px 0', lineHeight: 1.65, fontSize: 13, color: 'var(--muted-foreground)' };
const format = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
const formatBound = (value: number, edge: 'lower' | 'upper') => {
  const scaled = value * 1000;
  return format(Number.isFinite(scaled) ? (edge === 'lower' ? Math.floor(scaled) : Math.ceil(scaled)) / 1000 : value);
};

/** Remounted by the wizard for each new image and changed gear family. */
export function PhotoScale({ active = true, image, width, height, internal, isApplied, onMeasured, onInvalidated }: Props) {
  const [open, setOpen] = useState(false), [zoom, setZoom] = useState(1);
  const [referencePoints, setReferencePoints] = useState<PhotoPoint[]>([]), [tipPoints, setTipPoints] = useState<PhotoPoint[]>([]);
  const [referenceLength, setReferenceLength] = useState(''), [referenceTolerance, setReferenceTolerance] = useState('');
  const [pixelError, setPixelError] = useState<string | null>(null), [selectionErrors, setSelectionErrors] = useState<number[]>([]);
  const [coplanar, setCoplanar] = useState(false), [axial, setAxial] = useState(false), [confirmedTips, setConfirmedTips] = useState(false);
  const [cursor, setCursor] = useState<PhotoPoint>({ x: width / 2, y: height / 2 }), [focused, setFocused] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null), instructionsId = useId();
  // A suggested selection error of two CSS pixels, converted when each point is placed.
  // Zooming later cannot retroactively improve an earlier selection's precision.
  const suggestedError = Math.ceil(Math.max(1, ...selectionErrors) * 100) / 100;
  const input = useMemo((): PhotoScaleInput => ({
    imageWidth: width, imageHeight: height, referencePoints, tipPoints,
    referenceLengthMm: referenceLength === '' ? undefined : Number(referenceLength),
    referenceToleranceMm: referenceTolerance === '' ? undefined : Number(referenceTolerance),
    pixelUncertaintyPx: pixelError === null ? suggestedError : pixelError === '' ? NaN : Number(pixelError),
    confirmedCoplanar: coplanar, confirmedAxialView: axial,
  }), [width, height, referencePoints, tipPoints, referenceLength, referenceTolerance, pixelError, suggestedError, coplanar, axial]);
  const result = useMemo(() => estimatePhotoCircle(input), [input]);
  const complete = referencePoints.length === 2 && tipPoints.length === 3;
  const step = referencePoints.length < 2 ? 1 : tipPoints.length < 3 ? 2 : 3;
  const invalidate = () => onInvalidated();
  const addPoint = (point: PhotoPoint) => {
    if (complete) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const suggested = rect?.width && rect.height ? 2 * Math.max(width / rect.width, height / rect.height) : 2;
    invalidate(); setConfirmedTips(false);
    setSelectionErrors(previous => [...previous, suggested]);
    if (referencePoints.length < 2) setReferencePoints(previous => [...previous, point]);
    else setTipPoints(previous => [...previous, point]);
  };
  const clickImage = (event: MouseEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    // SVG has the same aspect ratio as the image and no internal letterboxing.
    const point = { x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height };
    if (point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height) { setCursor(point); addPoint(point); }
  };
  const keyImage = (event: KeyboardEvent<SVGSVGElement>) => {
    const increment = event.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-increment, 0], ArrowRight: [increment, 0], ArrowUp: [0, -increment], ArrowDown: [0, increment] }[event.key];
    if (delta) { event.preventDefault(); setCursor(p => ({ x: Math.max(0, Math.min(width, p.x + delta[0])), y: Math.max(0, Math.min(height, p.y + delta[1])) })); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); addPoint(cursor); }
  };
  const undo = () => {
    invalidate(); setConfirmedTips(false); setSelectionErrors(previous => previous.slice(0, -1));
    if (tipPoints.length) setTipPoints(previous => previous.slice(0, -1));
    else setReferencePoints(previous => previous.slice(0, -1));
  };
  const reset = () => {
    invalidate(); setReferencePoints([]); setTipPoints([]); setSelectionErrors([]); setReferenceLength(''); setReferenceTolerance('');
    setPixelError(null); setCoplanar(false); setAxial(false); setConfirmedTips(false); setZoom(1);
  };
  const transfer = () => {
    if (result.status !== 'ready' || !confirmedTips) return;
    onMeasured({ method: 'three-tip-circle-with-reference', coordinateSpace: 'working_image_pixels', input, result,
      confirmedTipCircle: true, target: internal ? 'internal_tooth_tips' : 'external_tooth_tips', sources: photoScaleSources });
    setOpen(false);
  };
  const markerSize = Math.max(width, height) / 120;
  return <div style={{ margin: '16px 0' }}>
    <Dialog open={open && active} onOpenChange={setOpen}>
      <DialogTrigger asChild><button type="button" className="secondary-button full"><Ruler size={16} />{isApplied ? 'Проверить измерение по фото' : 'Измерить диаметр по фото'}</button></DialogTrigger>
      <DialogContent style={{ width: 'calc(100vw - 24px)', maxWidth: 980, maxHeight: '94dvh', overflowY: 'auto', padding: 22, gap: 12 }}>
        <DialogTitle style={{ paddingRight: 25 }}>Диаметр по эталону на фото</DialogTitle>
        <DialogDescription>Отметьте два конца известного отрезка и три вершины зубьев. Эталон должен быть в одной плоскости с измеряемым торцом.</DialogDescription>
        <ol aria-label="Этапы измерения" style={{ ...rowStyle, margin: 0, padding: 0, listStyle: 'none', fontSize: 13 }}>
          {[[1, `Эталон ${referencePoints.length}/2`], [2, `Вершины ${tipPoints.length}/3`], [3, 'Проверка']].map(([number, label]) =>
            <li key={number} aria-current={step === number ? 'step' : undefined} style={{ padding: '7px 10px', borderRadius: 5, background: step === number ? 'var(--accent)' : 'var(--muted)', fontWeight: step === number ? 650 : 400 }}>{number}. {label}</li>)}
        </ol>
        <p id={instructionsId} style={helpStyle}>
          {step === 1 ? 'Щёлкните по двум меткам эталона, расстояние между которыми известно. Выбирайте длинный отрезок.' : step === 2 ? 'Выберите точки на трёх неповреждённых вершинах, разнесённых по всей окружности.' : 'Сверьте окружность с остальными вершинами и подтвердите условия съёмки.'}
          {' '}{internal ? 'Для внутреннего колеса нужны кромки зубьев, обращённые к центру, а не наружная граница кольца.' : 'Нужны верхние кромки на окружности вершин.'}
          {' '}На плоской площадке выбирайте её край на окружности: середина прямой хорды лежит внутри круга.
        </p>
        <div style={rowStyle}>
          <button type="button" className="secondary-button" style={smallButton} onClick={undo} disabled={!referencePoints.length}><Undo2 size={14} />Отменить точку</button>
          <button type="button" className="secondary-button" style={smallButton} onClick={reset}><RotateCcw size={14} />Сбросить</button>
          <span style={{ ...rowStyle, marginLeft: 'auto' }}><ZoomIn size={15} />{[1, 2, 4].map(value => <button type="button" key={value} className="secondary-button" style={{ ...smallButton, background: zoom === value ? 'var(--accent)' : undefined }} aria-pressed={zoom === value} aria-label={`Масштаб фото ${value}×`} onClick={() => setZoom(value)}>{value}×</button>)}</span>
        </div>
        <div style={{ width: '100%', maxHeight: '50dvh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, background: '#d9dde2' }}>
          <svg ref={svgRef} data-testid="photo-scale-image" viewBox={`0 0 ${width} ${height}`} width={width} height={height}
            style={{ display: 'block', width: `min(${zoom * 100}%, ${width * zoom}px, calc((50dvh - 2px) * ${width / height * zoom}))`, maxWidth: 'none', height: 'auto', margin: '0 auto', cursor: complete ? 'default' : 'crosshair' }}
            role="group" tabIndex={0} aria-label="Фото для разметки эталона и окружности" aria-describedby={instructionsId}
            onClick={clickImage} onKeyDown={keyImage} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
            <image href={image} x={0} y={0} width={width} height={height} />
            {referencePoints.length === 2 && <line x1={referencePoints[0].x} y1={referencePoints[0].y} x2={referencePoints[1].x} y2={referencePoints[1].y} stroke="#06b6d4" strokeWidth={3} vectorEffect="non-scaling-stroke" />}
            {result.circle && <circle cx={result.circle.center.x} cy={result.circle.center.y} r={result.circle.radiusPx} fill="none" stroke={result.status === 'rejected' ? '#e84343' : '#00a77c'} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
            {[...referencePoints.map((point, index) => ({ point, label: `Э${index + 1}`, color: '#06b6d4' })), ...tipPoints.map((point, index) => ({ point, label: `В${index + 1}`, color: '#f4aa23' }))].map(({ point, label, color }) => <g key={label} pointerEvents="none">
              <circle cx={point.x} cy={point.y} r={markerSize * .5} fill={color} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              <text x={point.x + markerSize} y={point.y - markerSize} fill={color} stroke="#10202a" strokeWidth={markerSize * .16} paintOrder="stroke" fontSize={markerSize * 2} fontWeight={700}>{label}</text>
            </g>)}
            {focused && !complete && <g stroke="#ff3355" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none">
              <line x1={cursor.x - markerSize} y1={cursor.y} x2={cursor.x + markerSize} y2={cursor.y} /><line x1={cursor.x} y1={cursor.y - markerSize} x2={cursor.x} y2={cursor.y + markerSize} />
            </g>}
          </svg>
        </div>
        <p style={helpStyle}>{width} × {height} px рабочего изображения. При увеличении перемещайте фото полосами прокрутки. Клавиатура: стрелки — прицел, Enter — точка, Shift — шаг 10 px.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <label className="number-field">Длина эталона, мм<input aria-label="Длина эталона, мм" type="number" min="0" step="any" placeholder="Известный размер" value={referenceLength} onChange={e => { invalidate(); setReferenceLength(e.target.value); }} /></label>
          <label className="number-field">Допуск эталона ±, мм<input aria-label="Допуск эталона ±, мм" type="number" min="0" step="any" placeholder="Не задан" value={referenceTolerance} onChange={e => { invalidate(); setReferenceTolerance(e.target.value); }} /></label>
          <label className="number-field">Ошибка точки, px<input aria-label="Радиус ошибки точки в пикселях рабочего изображения" type="number" min="0" step="any" value={pixelError ?? String(suggestedError)} onChange={e => { invalidate(); setPixelError(e.target.value); }} /></label>
        </div>
        <p style={helpStyle}>Ошибка — предполагаемый радиус вокруг каждой выбранной точки в пикселях рабочего изображения. Автоподстановка {format(suggestedError)} px соответствует 2 пикселям экрана в худшем масштабе разметки; это предположение, не проверка точности. Для размытых кромок увеличьте значение.</p>
        <div>
          <label className="check-row" style={{ margin: '7px 0' }}><Checkbox checked={coplanar} onCheckedChange={v => { invalidate(); setCoplanar(v === true); }} /><span>Метки эталона и выбранные вершины находятся в одной плоскости на одной высоте.</span></label>
          <label className="check-row" style={{ margin: '7px 0' }}><Checkbox checked={axial} onCheckedChange={v => { invalidate(); setAxial(v === true); }} /><span>Камера смотрит по оси колеса; торец не наклонён к плоскости снимка.</span></label>
          <label className="check-row" style={{ margin: '7px 0' }}><Checkbox checked={confirmedTips} onCheckedChange={v => { invalidate(); setConfirmedTips(v === true); }} disabled={!complete} /><span>{internal ? 'Выбраны именно вершины внутренних зубьев, обращённые к центру; наружный обод не измеряется.' : 'Выбраны именно неповреждённые вершины зубьев; окружность согласуется с остальными вершинами.'}</span></label>
        </div>
        {result.issues.map(issue => <p className="inline-error" role="alert" style={{ margin: 0 }} key={issue.code + issue.field}>{issue.message}</p>)}
        {result.status === 'ready' && <div className="module-result" style={{ margin: 0 }} role="status">
          <span>{internal ? 'Диаметр окружности внутренних вершин' : 'Диаметр окружности вершин'}</span>
          <strong data-testid="photo-measured-diameter">{format(result.diameterMm)} мм</strong>
          <p>Условный интервал: {formatBound(result.uncertainty.lowerDiameterMm, 'lower')}–{formatBound(result.uncertainty.upperDiameterMm, 'upper')} мм; отклонение до {formatBound(result.uncertainty.maxRelativeDeviation * 100, 'upper')}%. Масштаб {format(result.scaleMmPerPixel)} мм/px.</p>
        </div>}
        <p style={helpStyle}>Наклон камеры, дисторсия объектива и неверно выбранная окружность в интервал не входят. Этот способ задаёт масштаб снимка и не заменяет метрологическую калибровку камеры.</p>
        <details style={{ fontSize: 13, lineHeight: 1.7 }}><summary style={{ cursor: 'pointer' }}>Границы метода и источники</summary><ul style={{ listStyle: 'disc', paddingLeft: 18 }}>{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>{photoScaleSources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" style={{ display: 'block', color: 'var(--muted-foreground)', textDecoration: 'underline' }}>{source.title}</a>)}</details>
        <button type="button" className="primary-button full" disabled={result.status !== 'ready' || !confirmedTips} onClick={transfer}><Check size={16} />Использовать диаметр</button>
        <p style={helpStyle}>Число зубьев, тип, профиль, угол и смещение подтверждаются отдельно в мастере.</p>
      </DialogContent>
    </Dialog>
    {isApplied && <p className="field-help" role="status">Диаметр перенесён из разметки. Точки, масштаб и условный интервал будут сохранены в паспорте.</p>}
  </div>;
}
