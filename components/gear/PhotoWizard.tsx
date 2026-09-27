"use client";
import { useMemo, useRef, useState } from 'react';
import { Camera, Upload, ScanLine, Check, ArrowRight } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { analyzeGearImage, type PhotoAnalysis } from '@/lib/photo-analysis';
import { inferGearFromMeasurements, type InferredGearKind, type MeasurementSource, type TipDiameterMethod, type PhotoInferenceInput } from '@/lib/photo-inference';
import { buildModelMesh, defaultModel, isRackKind, isInternalKind, isHelicalKind, modelNames, type ModelParams } from '@/lib/model';
import { PhotoScale, type PhotoScaleMeasurement } from './PhotoScale';

type ApplyParams = Partial<ModelParams> & { kind: InferredGearKind };
export function PhotoWizard({ onApply, onManual }: { onApply: (p: ApplyParams, source: string, evidence: unknown) => void; onManual: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null), request = useRef(0);
  const [image, setImage] = useState<string | null>(null), [analysis, setAnalysis] = useState<PhotoAnalysis | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number; id: number; source: { fileName: string; mimeType: string; originalWidth: number; originalHeight: number } } | null>(null);
  const [photoMeasurement, setPhotoMeasurement] = useState<PhotoScaleMeasurement | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [kind, setKind] = useState('unknown'), [profile, setProfile] = useState('unknown');
  const [teeth, setTeeth] = useState(''), [confirmedTeeth, setConfirmedTeeth] = useState(false);
  const [diameter, setDiameter] = useState(''), [pitch, setPitch] = useState(''), [diameterMethod, setDiameterMethod] = useState('unknown');
  const [beta, setBeta] = useState(''), [alpha, setAlpha] = useState(''), [shift, setShift] = useState('');
  const [standard, setStandard] = useState(false), [symmetric, setSymmetric] = useState(false);
  const [width, setWidth] = useState(''), [body, setBody] = useState('');
  const [source, setSource] = useState<MeasurementSource>('user_confirmation');
  const supported = ['spur', 'helical', 'herringbone', 'internal', 'internal-helical', 'rack', 'helical-rack'].includes(kind);
  const rack = supported && isRackKind(kind as InferredGearKind), internal = supported && isInternalKind(kind as InferredGearKind);
  const helical = supported && isHelicalKind(kind as InferredGearKind);
  const resetAnswers = () => {
    setKind('unknown'); setProfile('unknown'); setTeeth(''); setConfirmedTeeth(false); setDiameter(''); setPitch('');
    setDiameterMethod('unknown'); setBeta(''); setAlpha(''); setShift(''); setStandard(false); setSymmetric(false);
    setWidth(''); setBody(''); setSource('user_confirmation'); setPhotoMeasurement(null);
  };
  const loadFile = async (file?: File) => {
    if (!file) return;
    const id = ++request.current;
    setBusy(false); setError(''); setAnalysis(null); setImage(null); setImageSize(null); resetAnswers();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('Подойдут JPG, PNG или WebP. HEIC сначала сохраните в JPEG.'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('Файл больше 20 МБ. Уменьшите изображение.'); return; }
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      if (id !== request.current) { bitmap.close(); return; }
      if (bitmap.width * bitmap.height > 60_000_000) { bitmap.close(); throw new Error('Уменьшите изображение до 60 Мп или меньше.'); }
      const sourceImage = { fileName: file.name, mimeType: file.type, originalWidth: bitmap.width, originalHeight: bitmap.height };
      const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) { bitmap.close(); throw new Error('Не удалось прочитать фото.'); }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      if (id !== request.current) return;
      setImageSize({ width: canvas.width, height: canvas.height, id, source: sourceImage });
      setImage(canvas.toDataURL('image/png'));
      await new Promise(resolve => setTimeout(resolve, 20));
      const result = analyzeGearImage(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (id !== request.current) return;
      setAnalysis(result); if (result.toothCount) setTeeth(String(result.toothCount));
    } catch (e) { if (id === request.current) setError(e instanceof Error ? e.message : 'Не удалось открыть файл.'); }
    finally { if (id === request.current) setBusy(false); }
  };
  const input = useMemo((): PhotoInferenceInput => {
    const fact = <T,>(value: T) => ({ value, source });
    const diameterFact = <T,>(value: T) => photoMeasurement
      ? { value, source: 'measurement' as const, note: 'Локальное фото: эталонный отрезок и три точки окружности вершин; условный интервал сохранён отдельно.' }
      : fact(value);
    return {
      silhouette: analysis?.candidateTypes[0]?.type,
      ...(supported ? { kind: fact(kind as InferredGearKind) } : {}),
      ...(profile !== 'unknown' ? { profileType: fact(profile as 'involute' | 'other') } : {}),
      ...(teeth !== '' && confirmedTeeth ? { toothCount: fact(Number(teeth)) } : {}),
      ...(diameter !== '' && !rack ? { tipDiameterMm: diameterFact(Number(diameter)) } : {}),
      ...(diameterMethod !== 'unknown' && !rack ? { tipDiameterMethod: diameterFact(diameterMethod as TipDiameterMethod) } : {}),
      ...(pitch !== '' && rack ? { transversePitchMm: fact(Number(pitch)) } : {}),
      ...(beta !== '' && helical ? { helixAngleDeg: fact(Number(beta)) } : {}),
      ...(alpha !== '' ? { pressureAngleDeg: fact(Number(alpha)) } : {}),
      ...(shift !== '' ? { profileShift: fact(Number(shift)) } : {}),
      ...(standard ? { standardAddendum: fact(true) } : {}),
    };
  }, [analysis, supported, kind, source, profile, teeth, confirmedTeeth, diameter, diameterMethod, pitch, beta, alpha, shift, standard, rack, helical, photoMeasurement]);
  const invalidatePhotoMeasurement = () => {
    if (photoMeasurement) { setDiameter(''); setDiameterMethod('unknown'); }
    setPhotoMeasurement(null);
  };
  const setManualDiameter = (value: string) => {
    if (photoMeasurement) setDiameterMethod('unknown');
    setPhotoMeasurement(null); setDiameter(value);
  };
  const result = useMemo(() => inferGearFromMeasurements(input), [input]);
  const bodyValid = width !== '' && Number(width) > 0 && body !== '' && (rack || internal ? Number(body) > 0 : Number(body) >= 0);
  const ready = supported && result.status === 'ready' && bodyValid && confirmedTeeth && teeth !== '' && (kind !== 'herringbone' || symmetric);
  const apply = () => {
    if (!ready || result.status !== 'ready') return;
    const patch: ApplyParams = { ...result.parameters, teeth: Number(teeth), width: Number(width), backlash: 0,
      ...(rack ? { rackBaseHeight: Number(body) } : internal ? { rimThickness: Number(body) } : { bore: Number(body) }) };
    try {
      buildModelMesh({ ...defaultModel(patch.kind), ...patch });
      onApply(patch, 'Фото и подтверждённые исходные данные; модуль рассчитан без округления.', {
        method: photoMeasurement ? 'confirmed-measurements-with-photo-scale-v3' : 'confirmed-measurements-v2', input, calculation: result.calculation, provenance: result.provenance,
        ...(photoMeasurement ? { photoMeasurement: { ...photoMeasurement, sourceImage: imageSize?.source } } : {}),
        bodyDimensions: { widthMm: Number(width), ...(rack ? { rackBaseHeightMm: Number(body) } : internal ? { rimThicknessMm: Number(body) } : { boreMm: Number(body) }), source },
        reconstructionAssumptions: ['Утонение зуба принято 0; посадочные допуски не восстановлены.', 'Переходы у основания и технологические детали не измерены по фотографии.', ...(kind === 'herringbone' ? ['Равные половины шеврона, без центральной канавки.'] : [])],
      });
    } catch (e) { setError(e instanceof Error ? e.message : 'Эти параметры выходят за область модели.'); }
  };
  return <div className="photo-wizard">
    <input ref={fileInput} aria-label="Загрузить фото колеса" className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void loadFile(e.target.files?.[0]); e.target.value = ''; }} />
    <button className={`upload-zone ${image ? 'with-image' : ''}`} onClick={() => fileInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void loadFile(e.dataTransfer.files[0]); }} disabled={busy}>
      {image ? <img src={image} alt="Загруженный образец для анализа контура" /> : <><Camera size={27} /><strong>Добавьте фото колеса</strong><span>Перетащите сюда или выберите файл</span></>}
      <span className="upload-caption"><Upload size={14} />{image ? 'Заменить фото' : 'JPG, PNG, WebP · до 20 МБ'}</span>
    </button>
    <p className="field-help">Снимите торец строго сверху на однотонном фоне. Для наклона зубьев нужен также осмотр сбоку.</p>
    <p className="privacy-note">Фото обрабатывается на устройстве.</p>
    {busy && <p className="inline-status" role="status">Анализируем контур…</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {analysis && <div className="photo-result"><span className="photo-result-title"><ScanLine size={17} />{analysis.toothCount ? 'Найдена периодичность контура' : 'Нужно уточнение'}</span>
      {analysis.toothCount && <strong>{analysis.toothCount}<small> предполагаемых зубьев</small></strong>}
      <p>{analysis.candidateTypes[0]?.evidence || 'По этому снимку нельзя уверенно определить деталь.'}</p>
      <details><summary>Что удалось определить</summary><ul>{analysis.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul><p>Качество сигнала: {Math.round(analysis.confidence * 100)}/100. Это оценка контура, а не вероятность правильной детали.</p></details>
    </div>}
    <div className="expert-heading"><span className="section-number">?</span><h3>Уточним как инженер</h3></div>
    <Choice id="photo-type" label="1. Тип по осмотру детали" value={kind} onChange={v => { setKind(v); setDiameter(''); setPitch(''); setDiameterMethod('unknown'); setBeta(''); setBody(''); setStandard(false); setSymmetric(false); setPhotoMeasurement(null); }} options={{ unknown: 'Пока не знаю', ...Object.fromEntries(Object.entries(modelNames).filter(([key]) => key !== 'worm' && key !== 'cycloidal')), other: 'Циклоидальный, конус, червяк или другой тип' }} />
    {!supported && <div className="expert-note"><p>{kind === 'other' ? 'Нужны тип профиля, размеры и данные ответной детали. Отдельный ZA-червяк можно построить в ручном режиме.' : 'Круглый торцевой контур не отличает прямые зубья от косых и шевронных. Осмотрите боковую поверхность; внутренние зубья направлены к центру кольца.'}</p><button className="inline-link" onClick={onManual}>Ручной режим <ArrowRight size={14} /></button></div>}
    <Choice id="photo-profile" label="2. Профиль по чертежу или измерениям" value={profile} onChange={setProfile} options={{ unknown: 'Не подтверждён', involute: 'Эвольвентный подтверждён', other: 'Циклоидальный или другой' }} />
    {image && imageSize && supported && !rack && <PhotoScale key={`${imageSize.id}-${kind}`} image={image} width={imageSize.width} height={imageSize.height} internal={internal} isApplied={photoMeasurement !== null}
      onInvalidated={invalidatePhotoMeasurement} onMeasured={measurement => { setPhotoMeasurement(measurement); setDiameter(String(measurement.result.diameterMm)); setDiameterMethod('tip_circle'); }} />}
    <div className="input-grid photo-inputs">
      <Measure label={rack ? 'Число зубьев участка' : 'Полное число зубьев'} value={teeth} set={v => { setTeeth(v); setConfirmedTeeth(false); }} placeholder="24" />
      {rack ? <Measure label="Торцевой шаг, мм" value={pitch} set={setPitch} placeholder="6,28319" /> : <Measure label={internal ? 'Внутренний da, мм' : 'Диаметр вершин, мм'} value={diameter} set={setManualDiameter} placeholder="52" />}
    </div>
    <label className="check-row"><Checkbox checked={confirmedTeeth} onCheckedChange={v => setConfirmedTeeth(v === true)} /><span>Число зубьев проверено по детали, включая повреждённые.</span></label>
    {rack ? <p className="field-help">Шаг измеряется вдоль перемещения рейки: расстояние через несколько зубьев разделите на число промежутков.</p> : <Choice id="diameter-method" label="Как определён диаметр вершин?" value={diameterMethod} onChange={v => { setDiameterMethod(v); setPhotoMeasurement(null); }} options={{ unknown: 'Метод не подтверждён', tip_circle: 'Диаметр окружности восстановлен', opposed_tips: 'Между противоположными вершинами', uncorrected_caliper_span: 'Просто размер штангенциркулем' }} />}
    {!rack && <p className="field-help">{internal ? 'Нужна окружность вершин внутренних зубьев, не наружный размер кольца. ' : ''}При нечётном числе зубьев размер штангенциркулем не равен автоматически диаметру.</p>}
    {helical && <div className="photo-spaced"><Measure label="Угол β на делительной поверхности, °" value={beta} set={setBeta} placeholder="Например, −20" /><p className="field-help">Знак задаёт направление. Угол по фотографии без коррекции перспективы не подходит.</p></div>}
    <div className="input-grid photo-inputs"><Measure label={helical ? 'Угол αₙ, °' : 'Угол α, °'} value={alpha} set={setAlpha} placeholder="Неизвестен" /><Measure label="Смещение xₙ" value={shift} set={setShift} placeholder="Неизвестно" /></div>
    <p className="field-help">Введите подтверждённые значения. 20° и нулевое смещение не принимаются автоматически.</p>
    <label className="check-row"><Checkbox checked={standard} onCheckedChange={v => setStandard(v === true)} /><span>Подтверждены стандартная высота ha* = 1 и отсутствие укорочения или модификации вершин.</span></label>
    {kind === 'herringbone' && <label className="check-row"><Checkbox checked={symmetric} onCheckedChange={v => setSymmetric(v === true)} /><span>Половины шеврона равны, центральная канавка отсутствует.</span></label>}
    <Choice id="measurement-source" label="Источник подтверждённых данных" value={source} onChange={v => setSource(v as MeasurementSource)} options={{ user_confirmation: 'Проверены мной по детали / данным', measurement: 'Результаты измерений', drawing: 'Чертёж или документация' }} />
    {result.calculation && <div className="module-result"><span>Расчётный нормальный модуль</span><strong>{result.calculation.normalModuleMm.toLocaleString('ru-RU', { maximumFractionDigits:5 })} мм</strong><code>{result.calculation.formula}</code><p>Из подтверждённых размеров. Без округления до стандартного ряда.</p></div>}
    {result.issues.map(issue => <p className="inline-error" key={issue.code}>{issue.message}</p>)}
    {result.missingQuestions.length > 0 && <details className="expert-more"><summary>Что ещё уточнить ({result.missingQuestions.length})</summary>{result.missingQuestions.map(q => <div key={q.id}><strong>{q.label}</strong><p>{q.reason}</p></div>)}</details>}
    <div className="photo-spaced"><strong className="field-label">Размеры тела детали</strong><div className="input-grid"><Measure label="Ширина, мм" value={width} set={setWidth} placeholder="Измерьте" /><Measure label={rack ? 'Основание, мм' : internal ? 'Обод, мм' : 'Отверстие, мм'} value={body} set={setBody} placeholder={rack || internal ? 'Измерьте' : '0 — сплошное'} /></div></div>
    <p className="field-help">Размеры тела обязательны. Галтель, посадки и утонение зуба по фото не восстановлены: в модели утонение 0; у наружного колеса радиус вершины инструмента 0,3mₙ. Их можно изменить вручную.</p>
    <button className="primary-button full photo-spaced" onClick={apply} disabled={!ready || busy}><Check size={16} /> Применить параметры</button>
    {!ready && <p className="field-help">Для построения нужны подтверждённый профиль, исходные размеры и число зубьев. Если данные неизвестны, сохраните неопределённость и измерьте ответную деталь.</p>}
  </div>;
}
function Measure({ label, value, set, placeholder }: { label: string; value: string; set: (v: string) => void; placeholder: string }) {
  return <label className="number-field">{label}<input aria-label={label} type="number" step="any" value={value} onChange={e => set(e.target.value)} placeholder={placeholder} /></label>;
}
function Choice({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: Record<string, string> }) {
  return <div className="photo-spaced"><label className="field-label" htmlFor={id}>{label}</label><Select value={value} onValueChange={onChange}><SelectTrigger id={id} className="select-control"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(options).map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent></Select></div>;
}
