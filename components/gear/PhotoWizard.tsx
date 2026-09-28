"use client";
import { useMemo, useRef, useState } from 'react';
import { Camera, Upload, ScanLine, Check, ArrowRight, ArrowLeft } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ImageDataLike, PhotoAnalysis } from '@/lib/photo-analysis';
import { inferGearFromMeasurements, type InferredGearKind, type MeasurementSource, type TipDiameterMethod, type PhotoInferenceInput } from '@/lib/photo-inference';
import { buildModelMesh, defaultModel, isRackKind, isInternalKind, isHelicalKind, modelNames, type ModelParams } from '@/lib/model';
import { PhotoScale, type PhotoScaleMeasurement } from './PhotoScale';
import { useActivePopup } from './useActivePopup';
import { defaultInternalCutter } from '@/lib/generatedInternalRoot';
import { InternalCutterFields, type InternalCutterInputs } from './InternalCutterFields';
import { SpanMeasurementAssistant } from './SpanMeasurementAssistant';
import type { SpanApplication, SpanMeasurementInput } from '@/lib/spanMeasurement';
import { FamilyAssistant } from './FamilyAssistant';
import { familyApplicationMatches, type FamilyApplication } from '@/lib/familyIdentification';
import { analyzeGearRegion, samePhotoRegion, normalizePhotoRegion, type PhotoRegion, type PhotoRegionEvidence } from '@/lib/photo-region';
import { PhotoRegionDialog } from './PhotoRegionDialog';
import { buildPhotoClarificationPlan } from '@/lib/photoClarificationPlan';
import { PhotoClarificationPlan } from './PhotoClarificationPlan';
import { transitionPhotoToothCountDraft, type PhotoToothCountResetReason } from '@/lib/photo-draft';

type ApplyParams = Partial<ModelParams> & { kind: InferredGearKind };
const inferredKinds: InferredGearKind[] = ['spur', 'helical', 'herringbone', 'internal', 'internal-helical', 'rack', 'helical-rack'];
export function PhotoWizard({ onApply, onManual, onManualFamily, onDraftChange, active = true }: { onApply: (p: ApplyParams, source: string, evidence: unknown) => void; onManual: () => void;
  onManualFamily: (application: FamilyApplication) => void; onDraftChange: () => void; active?: boolean }) {
  const [step, setStep] = useState(0), stepHeading = useRef<HTMLHeadingElement>(null);
  const goStep = (next: number) => { setStep(next); requestAnimationFrame(() => { stepHeading.current?.focus({ preventScroll: true }); stepHeading.current?.scrollIntoView({ block: 'start' }); }); };
  const edit = <T,>(setter: (value: T) => void, value: T) => { onDraftChange(); setter(value); };
  const fileInput = useRef<HTMLInputElement>(null), request = useRef(0);
  const [image, setImage] = useState<string | null>(null), [analysis, setAnalysis] = useState<PhotoAnalysis | null>(null);
  const pixels = useRef<ImageDataLike | null>(null);
  const [region, setRegion] = useState<PhotoRegion | null>(null), [analysisEvidence, setAnalysisEvidence] = useState<PhotoRegionEvidence | null>(null);
  const [analysisRevision, setAnalysisRevision] = useState(0);
  const [imageSize, setImageSize] = useState<{ width: number; height: number; id: number; source: { fileName: string; mimeType: string; originalWidth: number; originalHeight: number } } | null>(null);
  const [photoMeasurement, setPhotoMeasurement] = useState<PhotoScaleMeasurement | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [kind, setKind] = useState('unknown'), [profile, setProfile] = useState('unknown');
  const [teeth, setTeeth] = useState(''), [confirmedTeeth, setConfirmedTeeth] = useState(false);
  const [damageHypothesisTransferred, setDamageHypothesisTransferred] = useState(false);
  const [toothCountResetReason, setToothCountResetReason] = useState<PhotoToothCountResetReason>(null);
  const [diameter, setDiameter] = useState(''), [pitch, setPitch] = useState(''), [diameterMethod, setDiameterMethod] = useState('unknown');
  const [beta, setBeta] = useState(''), [alpha, setAlpha] = useState(''), [shift, setShift] = useState('');
  const [standard, setStandard] = useState(false), [symmetric, setSymmetric] = useState(false);
  const [width, setWidth] = useState(''), [body, setBody] = useState('');
  const [internalCutter, setInternalCutter] = useState<InternalCutterInputs>({ ...defaultInternalCutter });
  const [source, setSource] = useState<MeasurementSource>('user_confirmation');
  const [spanApplication, setSpanApplication] = useState<SpanApplication | null>(null), [spanPending, setSpanPending] = useState(false);
  const [familyApplication, setFamilyApplication] = useState<FamilyApplication | null>(null), [familyPending, setFamilyPending] = useState(false);
  const invalidateSpan = () => { if (spanApplication || spanPending) { setSpanApplication(null); setSpanPending(true); } };
  const editProfile = <T,>(setter: (value: T) => void, value: T) => { invalidateSpan(); edit(setter, value); };
  const supported = inferredKinds.includes(kind as InferredGearKind);
  const rack = supported && isRackKind(kind as InferredGearKind), internal = supported && isInternalKind(kind as InferredGearKind);
  const helical = supported && isHelicalKind(kind as InferredGearKind);
  const familyReady = !familyPending && (!familyApplication || familyApplicationMatches(familyApplication, kind as ModelParams['kind']));
  const setObservedKind = (next: string) => {
    if (next === kind) return; // Reapplying the same classification must not destroy measurements.
    const countDraft = transitionPhotoToothCountDraft(kind, next, analysis?.candidateTypes[0]?.type ?? null,
      { teeth, confirmed: confirmedTeeth, damageHypothesisTransferred });
    setTeeth(countDraft.teeth); setConfirmedTeeth(countDraft.confirmed);
    setDamageHypothesisTransferred(countDraft.damageHypothesisTransferred); setToothCountResetReason(countDraft.resetReason);
    setKind(next); setDiameter(''); setPitch(''); setDiameterMethod('unknown'); setBeta(''); setAlpha(''); setShift('');
    setBody(''); setProfile('unknown'); setStandard(false); setSymmetric(false); setPhotoMeasurement(null);
    setSpanApplication(null); setSpanPending(false); setInternalCutter({ ...defaultInternalCutter });
  };
  const chooseDirectKind = (next: string) => {
    onDraftChange(); setObservedKind(next); setFamilyApplication(null); setFamilyPending(false);
  };
  const applyFamily = (application: FamilyApplication) => {
    onDraftChange(); setFamilyApplication(application); setFamilyPending(false);
    if (application.decision.photoKind) setObservedKind(application.decision.photoKind);
    else { setObservedKind('other'); onManualFamily(application); }
  };
  const resetAnswers = () => {
    setKind('unknown'); setProfile('unknown'); setTeeth(''); setConfirmedTeeth(false); setDamageHypothesisTransferred(false); setDiameter(''); setPitch('');
    setToothCountResetReason(null);
    setDiameterMethod('unknown'); setBeta(''); setAlpha(''); setShift(''); setStandard(false); setSymmetric(false);
    setWidth(''); setBody(''); setSource('user_confirmation'); setPhotoMeasurement(null);
    setInternalCutter({ ...defaultInternalCutter });
    setSpanApplication(null); setSpanPending(false);
    setFamilyApplication(null); setFamilyPending(false);
  };
  const runAnalysis = async (input: ImageDataLike, selected: PhotoRegion | null, id: number) => {
    // Allow loading feedback to paint; a later file/region request owns the result.
    await new Promise(resolve => setTimeout(resolve, 20));
    if (id !== request.current) return;
    const result = analyzeGearRegion(input, selected);
    if (id !== request.current) return;
    setAnalysis(result.analysis); setAnalysisEvidence(result.evidence);
    if (result.analysis.toothCount) setTeeth(String(result.analysis.toothCount));
  };
  const applyRegion = async (selected: PhotoRegion | null) => {
    const input = pixels.current;
    if (!input || samePhotoRegion(region, selected, input)) return;
    const next = normalizePhotoRegion(selected, input), id = ++request.current;
    onDraftChange(); resetAnswers(); setAnalysisRevision(value => value + 1);
    setRegion(next); setAnalysis(null); setAnalysisEvidence(null); setError(''); setBusy(true);
    try { await runAnalysis(input, next, id); }
    catch (e) { if (id === request.current) setError(e instanceof Error ? e.message : 'Не удалось проанализировать область.'); }
    finally { if (id === request.current) setBusy(false); }
  };
  const loadFile = async (file?: File) => {
    if (!file) return;
    onDraftChange(); setStep(0);
    const id = ++request.current;
    setBusy(false); setError(''); setAnalysis(null); setAnalysisEvidence(null); setRegion(null); pixels.current = null;
    setAnalysisRevision(value => value + 1); setImage(null); setImageSize(null); resetAnswers();
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
      const input = ctx.getImageData(0, 0, canvas.width, canvas.height); pixels.current = input;
      await runAnalysis(input, null, id);
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
      ...(teeth !== '' && confirmedTeeth ? { toothCount: { ...fact(Number(teeth)), ...(damageHypothesisTransferred
        ? { note: 'Сначала перенесена гипотеза полного числа зубьев при локальном повреждении; затем пользователь отдельно подтвердил полное число, включая сломанные.' } : {}) } } : {}),
      ...(diameter !== '' && !rack ? { tipDiameterMm: diameterFact(Number(diameter)) } : {}),
      ...(diameterMethod !== 'unknown' && !rack ? { tipDiameterMethod: diameterFact(diameterMethod as TipDiameterMethod) } : {}),
      ...(pitch !== '' && rack ? { transversePitchMm: fact(Number(pitch)) } : {}),
      ...(beta !== '' && helical ? { helixAngleDeg: fact(Number(beta)) } : {}),
      ...(alpha !== '' ? { pressureAngleDeg: fact(Number(alpha)) } : {}),
      ...(shift !== '' ? { profileShift: fact(Number(shift)) } : {}),
      ...(standard ? { standardAddendum: fact(true) } : {}),
    };
  }, [analysis, supported, kind, source, profile, teeth, confirmedTeeth, damageHypothesisTransferred, diameter, diameterMethod, pitch, beta, alpha, shift, standard, rack, helical, photoMeasurement]);
  const invalidatePhotoMeasurement = () => {
    onDraftChange(); invalidateSpan();
    if (photoMeasurement) { setDiameter(''); setDiameterMethod('unknown'); }
    setPhotoMeasurement(null);
  };
  const setManualDiameter = (value: string) => {
    onDraftChange(); invalidateSpan();
    if (photoMeasurement) setDiameterMethod('unknown');
    setPhotoMeasurement(null); setDiameter(value);
  };
  const result = useMemo(() => inferGearFromMeasurements(input), [input]);
  const spanPath = kind === 'spur' && (spanPending || spanApplication !== null);
  const clarificationPlan = useMemo(() => buildPhotoClarificationPlan({ input, selectedKind: kind, enteredToothCount: teeth,
    toothCountConfirmed: confirmedTeeth, familyReady, symmetricHerringbone: symmetric, analysisRegion: analysisEvidence,
    span: kind === 'spur' && spanPending ? { mode: 'pending' } : kind === 'spur' && spanApplication ? { mode: 'applied', application: spanApplication } : { mode: 'direct' },
  }), [input, kind, teeth, confirmedTeeth, familyReady, symmetric, analysisEvidence, spanPending, spanApplication]);
  const profileParameters = spanPath ? spanApplication?.candidate.parameters ?? null : result.status === 'ready' ? result.parameters : null;
  const calculatedModule = spanPath ? spanApplication?.candidate.parameters.module : result.calculation?.normalModuleMm;
  const bodyValid = width !== '' && Number(width) > 0 && body !== '' && (rack || internal ? Number(body) > 0 : Number(body) >= 0);
  const ready = !busy && !!analysis && familyReady && supported && profileParameters !== null && bodyValid && confirmedTeeth && teeth !== '' && (kind !== 'herringbone' || symmetric);
  const apply = () => {
    if (!ready || !profileParameters) return;
    const patch: ApplyParams = { ...profileParameters, teeth: Number(teeth), width: Number(width), backlash: spanPath ? spanApplication!.candidate.parameters.backlash : 0,
      ...(kind === 'internal' ? internalCutter : {}),
      ...(rack ? { rackBaseHeight: Number(body) } : internal ? { rimThickness: Number(body) } : { bore: Number(body) }) };
    try {
      buildModelMesh({ ...defaultModel(patch.kind), ...patch });
      onApply(patch, spanPath ? 'Фото, подтверждённые данные и общая нормаль; модуль, смещение и утонение рассчитаны без округления.' : 'Фото и подтверждённые исходные данные; модуль рассчитан без округления.', {
        method: spanPath ? 'confirmed-photo-with-span-measurement-v1' : analysis?.damageHypothesis ? 'confirmed-measurements-with-damage-hypothesis-v4' : photoMeasurement ? 'confirmed-measurements-with-photo-scale-v3' : 'confirmed-measurements-v2',
        familySelection: familyApplication ?? { method: 'direct-list', source: 'photo', modelKind: kind },
        input: spanPath ? { kind: input.kind, profileType: input.profileType, toothCount: input.toothCount, standardAddendum: input.standardAddendum } : input,
        calculation: spanPath ? { method: 'span-measurement', parameters: spanApplication!.candidate.parameters, representativeReadings: spanApplication!.candidate.representativeReadings } : result.calculation,
        provenance: spanPath ? { profileParameters: 'derived-from-explicitly-applied-span-measurements' } : result.provenance,
        ...(spanPath ? { spanMeasurement: spanApplication } : {}),
        ...(photoMeasurement ? { photoMeasurement: { ...photoMeasurement, sourceImage: imageSize?.source,
          ...(spanPath ? { rawDiameterEqualsSpanReading: photoMeasurement.result.diameterMm === spanApplication!.input.tipDiameterMm } : {}) } } : {}),
        ...(analysis ? { photoAnalysisEvidence: {
          algorithm: analysis.diagnostics.algorithm, status: analysis.status, sourceImage: imageSize?.source,
          analysisRegion: analysisEvidence,
          workingImage: imageSize ? { width: imageSize.width, height: imageSize.height } : null,
          coordinateSystem: 'working_image_pixels; origin=top-left; angle=clockwise-from-right',
          centerPx: analysis.centerPx, outsideDiameterPx: analysis.outsideDiameterPx,
          strictToothCandidate: analysis.toothCount, damageHypothesis: analysis.damageHypothesis, diagnostics: analysis.diagnostics,
          hypothesisTransfer: { transferred: damageHypothesisTransferred, proposedFullToothCount: analysis.damageHypothesis?.toothCount ?? null,
            independentlyConfirmedByUser: damageHypothesisTransferred && confirmedTeeth, confirmedFullToothCount: confirmedTeeth ? Number(teeth) : null },
          warning: 'Сектора — ожидаемые зубцовые ячейки для осмотра, а не измеренные границы разрушения. Гипотеза не устанавливает профиль, модуль или пригодность детали.',
        } } : {}),
        bodyDimensions: { widthMm: Number(width), ...(rack ? { rackBaseHeightMm: Number(body) } : internal ? { rimThicknessMm: Number(body) } : { boreMm: Number(body) }), source },
        ...(kind === 'internal' ? { internalCutterAssumption: { parameters: { ...internalCutter }, source: 'specified-or-assumed; not-inferred-from-photo' } } : {}),
        reconstructionAssumptions: [spanPath ? 'Утонение получено из явно выбранного решения по общей нормали; посадочные допуски не восстановлены.' : 'Утонение зуба принято 0; посадочные допуски не восстановлены.', 'Переходы у основания и технологические детали не измерены по фотографии.', ...(kind === 'internal' ? ['Переходная кривая рассчитана по принятому долбяку; параметры инструмента показаны на шаге размеров и не определены по фото.'] : []), ...(kind === 'herringbone' ? ['Равные половины шеврона, без центральной канавки.'] : [])],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Эти параметры выходят за область модели.');
      requestAnimationFrame(() => { stepHeading.current?.focus({ preventScroll: true }); stepHeading.current?.scrollIntoView({ block: 'start' }); });
    }
  };
  const typeReady = !busy && !!analysis && familyReady && supported && confirmedTeeth && Number.isInteger(Number(teeth)) && Number(teeth) >= (rack ? 1 : 6) && Number(teeth) <= 250;
  const scaleReady = familyReady && profileParameters !== null && (kind !== 'herringbone' || symmetric);
  const canContinue = step === 0 ? !!image && !!analysis && !busy : step === 1 ? typeReady : scaleReady;
  const stepTitles = ['Добавьте фото детали', 'Уточните тип и число зубьев', 'Подтвердите масштаб и профиль', 'Размеры тела и построение'];
  return <div className="photo-wizard">
    <ol className="photo-progress" aria-label="Шаги помощника по фото">{['Фото', 'Тип и зубья', 'Масштаб', 'Размеры'].map((label, i) => <li key={label} aria-current={step === i ? 'step' : undefined}><span>{i + 1}</span>{label}</li>)}</ol>
    <h2 ref={stepHeading} tabIndex={-1} className="photo-step-heading">{stepTitles[step]}</h2>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <section hidden={step !== 0} aria-label="Фото и качество">
      <input ref={fileInput} aria-label="Загрузить фото колеса" className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void loadFile(e.target.files?.[0]); e.target.value = ''; }} />
      <button className={`upload-zone ${image ? 'with-image' : ''}`} onClick={() => fileInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void loadFile(e.dataTransfer.files[0]); }} disabled={busy}>
        {image ? <img src={image} alt="Загруженный образец для анализа контура" /> : <><Camera size={27} /><strong>Добавьте фото колеса</strong><span>Перетащите сюда или выберите файл</span></>}
        <span className="upload-caption"><Upload size={14} />{image ? 'Заменить фото' : 'JPG, PNG, WebP · до 20 МБ'}</span>
      </button>
      {image && imageSize && <PhotoRegionDialog key={imageSize.id} active={active && step === 0} busy={busy} image={image} width={imageSize.width} height={imageSize.height} region={region} onApply={next => { void applyRegion(next); }} />}
      <ul className="photo-hints"><li>Снимите торец строго сверху на однотонном фоне.</li><li>Для измерения по фото положите рядом эталон известного размера в плоскости торца.</li><li>Фото останется на устройстве. Размеры и профиль подтвердим дальше.</li></ul>
      {busy && <p className="inline-status" role="status">Анализируем контур…</p>}
      {analysis && <p className="inline-status" role="status"><Check size={17} /> Фото прочитано. Дальше проверим тип детали и зубья.</p>}
    </section>
    <section hidden={step !== 1} aria-label="Тип и число зубьев">
      <p className="step-intro">Контур даёт подсказку. Сверьте её с самой деталью, особенно если часть зубьев сломана.</p>
      {busy && <p className="inline-status" role="status">Анализируем выбранную область…</p>}
      {image && imageSize && <PhotoRegionDialog key={imageSize.id} active={active && step === 1} busy={busy} image={image} width={imageSize.width} height={imageSize.height} region={region} onApply={next => { void applyRegion(next); }} />}
    {analysis && <div className="photo-result"><span className="photo-result-title"><ScanLine size={17} />{analysis.damageHypothesis ? 'Гипотеза при локальном повреждении' : analysis.toothCount ? 'Найдена периодичность контура' : 'Нужно уточнение'}</span>
      {analysis.toothCount && <strong>{analysis.toothCount}<small> предполагаемых зубьев</small></strong>}
      {analysis.damageHypothesis && <>
        <strong>{analysis.damageHypothesis.toothCount}<small> — возможное полное число зубьев</small></strong>
        <p>С шаблоном согласуются {analysis.damageHypothesis.supportedTeeth} из {analysis.damageHypothesis.toothCount} ожидаемых участков ({Math.round(100 * analysis.damageHypothesis.visibleToothFraction)}%). Это гипотеза для {analysis.damageHypothesis.boundary === 'inner' ? 'внутреннего' : 'наружного'} контура, включая возможные утраченные зубья.</p>
        {image && imageSize && <DamagePreview image={image} width={imageSize.width} height={imageSize.height} analysis={analysis} />}
        <button type="button" className="secondary-button full" onClick={() => { onDraftChange(); invalidateSpan(); setTeeth(String(analysis.damageHypothesis!.toothCount)); setConfirmedTeeth(false); setDamageHypothesisTransferred(true); setToothCountResetReason(null); }}>
          Подставить гипотезу {analysis.damageHypothesis.toothCount}
        </button>
        {damageHypothesisTransferred && <p role="status">Гипотеза перенесена. Отдельно подтвердите полное число зубьев, включая сломанные, по детали, чертежу или данным ответного колеса.</p>}
      </>}
      <p>{analysis.candidateTypes[0]?.evidence || 'По этому снимку нельзя уверенно определить деталь.'}</p>
      <details><summary>Что удалось определить</summary>{analysis.damageHypothesis && <p>Разброс шага: {(100 * analysis.damageHypothesis.pitchScatterFraction).toFixed(2)}%; ошибка шаблона на сохранных участках: {(100 * analysis.damageHypothesis.templateErrorFraction).toFixed(1)}% его высоты. Это не допуск детали и не вероятность.</p>}<ul>{[...analysis.warnings, ...(analysis.damageHypothesis?.evidence ?? [])].map((w, i) => <li key={i}>{w}</li>)}</ul><p>Качество сигнала: {Math.round(analysis.confidence * 100)}/100. Это оценка контура, а не вероятность правильной детали.</p></details>
    </div>}
      <Choice active={active && step === 1} id="photo-type" label="Тип по осмотру детали" value={kind} onChange={chooseDirectKind} options={{ unknown: 'Пока не знаю', ...Object.fromEntries(inferredKinds.map(key => [key, modelNames[key]])), other: 'Циклоидальный, конус, червяк или другой тип' }} />
      <FamilyAssistant key={`${imageSize?.id ?? 'no-photo'}-${analysisRevision}`} active={active && step === 1 && !busy} source="photo" photoHint={analysis?.candidateTypes[0] ?? null}
        application={familyApplication} engaged={familyPending || !!familyApplication}
        onDraftChange={() => { onDraftChange(); setFamilyApplication(null); setFamilyPending(true); }} onApply={applyFamily}
        onCancel={() => { onDraftChange(); setFamilyApplication(null); setFamilyPending(false); }} />
      {familyPending && <p className="family-notice" role="status">Ответы о типе ещё не применены. Завершите помощник или вернитесь к прямому выбору типа.</p>}
      {!supported && <div className="expert-note"><p>{kind === 'other' ? 'Для этого типа нужны отдельные исходные параметры. Циклоидальное, коническое колесо и ZA-червяк доступны в ручном режиме.' : 'Осмотрите боковую поверхность: прямые, косые и шевронные зубья могут иметь похожий торцевой контур. У внутреннего колеса зубья направлены к центру кольца.'}</p><button className="inline-link" onClick={onManual}>Перейти к ручному вводу <ArrowRight size={14} /></button></div>}
      {toothCountResetReason && <p className="family-notice" role="status">{toothCountResetReason === 'wheel-rack-meaning'
        ? 'При переходе на рейку или с неё прежнее число очищено: у колеса задают полное число зубьев, у рейки — длину моделируемого участка. Укажите значение для выбранного типа.'
        : 'Выбранный тип расходится с подсказкой формы на фото. Число из прежнего варианта очищено; проверьте его для выбранной детали.'}</p>}
      <div className="photo-spaced"><Measure label={rack ? 'Число зубьев участка' : 'Полное число зубьев'} value={teeth} set={v => { onDraftChange(); invalidateSpan(); setTeeth(v); setConfirmedTeeth(false); setDamageHypothesisTransferred(false); setToothCountResetReason(null); }} placeholder="24" /></div>
      <label className="check-row"><Checkbox checked={confirmedTeeth} onCheckedChange={v => editProfile(setConfirmedTeeth, v === true)} /><span>Число зубьев проверено по детали, включая повреждённые.</span></label>
      {!typeReady && <p className="field-help">Выберите тип и отдельно подтвердите полное число зубьев. Помощник типа и гипотеза контура не подтверждают число зубьев.</p>}
    </section>
    <section hidden={step !== 2} aria-label="Масштаб и профиль">
      <p className="step-intro">Известный размер задаёт масштаб. Профиль и его углы берём из измерений или документации — по одному контуру их не определить.</p>
      <PhotoClarificationPlan plan={clarificationPlan} active={active && step === 2} />
      <Choice active={active && step === 2} id="photo-profile" label="Профиль по чертежу или измерениям" value={profile} onChange={v => editProfile(setProfile, v)} options={{ unknown: 'Не подтверждён', involute: 'Эвольвентный подтверждён', other: 'Циклоидальный или другой' }} />
      {profile === 'other' && <div className="expert-note" role="status">
        <p>Для циклоидального и специального профиля нужна отдельная геометрия. Фото-помощник не подменяет её эвольвентой. Перейдите к ручным настройкам и выберите подходящее семейство — снимок и ответы останутся в этом черновике.</p>
        <button className="inline-link" onClick={onManual}>Выбрать геометрию вручную <ArrowRight size={14} /></button>
      </div>}
      {image && imageSize && supported && !rack && <PhotoScale key={`${imageSize.id}-${analysisRevision}-${kind}`} active={active && step === 2} image={image} width={imageSize.width} height={imageSize.height} internal={internal} isApplied={photoMeasurement !== null}
        onInvalidated={invalidatePhotoMeasurement} onMeasured={measurement => { onDraftChange(); invalidateSpan(); setPhotoMeasurement(measurement); setDiameter(String(measurement.result.diameterMm)); setDiameterMethod('tip_circle'); }} />}
      <label className="check-row"><Checkbox checked={standard} onCheckedChange={v => editProfile(setStandard, v === true)} /><span>Подтверждены стандартная высота ha* = 1 и отсутствие укорочения или модификации вершин.</span></label>
      {kind === 'spur' && <SpanMeasurementAssistant key={`${imageSize?.id ?? 'no-image'}-${analysisRevision}`} teeth={Number(teeth)} toolTipRadiusCoefficient={.3}
        facts={{ teeth: typeReady, involute: profile === 'involute', standardTip: standard }}
        seed={{ ...(diameter !== '' ? { diameter: Number(diameter), diameterMethod: diameterMethod as SpanMeasurementInput['tipDiameterMethod'] } : {}), ...(alpha !== '' ? { pressureAngle: Number(alpha) } : {}) }}
        application={spanApplication} engaged={spanPath} onDraftChange={() => { onDraftChange(); setSpanApplication(null); setSpanPending(true); }}
        onApply={application => { onDraftChange(); setSpanApplication(application); setSpanPending(false); }}
        onCancel={() => { onDraftChange(); setSpanApplication(null); setSpanPending(false); }} />}
      <div hidden={spanPath}>
      <div className="photo-spaced">{rack ? <Measure label="Торцевой шаг, мм" value={pitch} set={v => edit(setPitch, v)} placeholder="6,28319" /> : <Measure label={internal ? 'Внутренний da, мм' : 'Диаметр вершин, мм'} value={diameter} set={setManualDiameter} placeholder="52" />}</div>
      {rack ? <p className="field-help">Измерьте расстояние вдоль перемещения рейки через несколько зубьев и разделите на число промежутков.</p> : <Choice active={active && step === 2 && !spanPath} id="diameter-method" label="Как определён диаметр вершин?" value={diameterMethod} onChange={v => { onDraftChange(); invalidateSpan(); setDiameterMethod(v); setPhotoMeasurement(null); }} options={{ unknown: 'Метод не подтверждён', tip_circle: 'Диаметр окружности восстановлен', opposed_tips: 'Между противоположными вершинами', uncorrected_caliper_span: 'Просто размер штангенциркулем' }} />}
      {!rack && <p className="field-help">{internal ? 'Нужна окружность вершин внутренних зубьев, не наружный размер кольца. ' : ''}При нечётном числе зубьев размер штангенциркулем не равен автоматически диаметру.</p>}
      {helical && <div className="photo-spaced"><Measure label="Угол β на делительной поверхности, °" value={beta} set={v => edit(setBeta, v)} placeholder="Например, −20" /><p className="field-help">Знак задаёт направление. Угол по фотографии без коррекции перспективы не подходит.</p></div>}
      <div className="input-grid photo-inputs"><Measure label={helical ? 'Угол αₙ, °' : 'Угол α, °'} value={alpha} set={v => editProfile(setAlpha, v)} placeholder="Неизвестен" /><Measure label="Смещение xₙ" value={shift} set={v => editProfile(setShift, v)} placeholder="Неизвестно" /></div>
      <p className="field-help">Введите подтверждённые значения. 20° и нулевое смещение не принимаются автоматически.</p>
      </div>
      {kind === 'herringbone' && <label className="check-row"><Checkbox checked={symmetric} onCheckedChange={v => edit(setSymmetric, v === true)} /><span>Половины шеврона равны, центральная канавка отсутствует.</span></label>}
      <Choice active={active && step === 2} id="measurement-source" label="Источник подтверждённых данных" value={source} onChange={v => edit(setSource, v as MeasurementSource)} options={{ user_confirmation: 'Проверены мной по детали / данным', measurement: 'Результаты измерений', drawing: 'Чертёж или документация' }} />
      {calculatedModule !== undefined && <div className="module-result"><span>Расчётный нормальный модуль</span><strong>{calculatedModule.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} мм</strong><code>{spanPath ? 'm = [W(k+1) − Wk] / (π cos α)' : result.calculation?.formula}</code><p>{spanPath ? 'Из явно применённого решения по общей нормали. Смещение и утонение сохранены вместе с измерениями.' : 'Из подтверждённых размеров. Без округления до стандартного ряда.'}</p></div>}
      {!spanPath && result.issues.map(issue => <p className="inline-error" key={issue.code}>{issue.message}</p>)}
      {!spanPath && result.missingQuestions.length > 0 && <details className="expert-more"><summary>Что ещё уточнить ({result.missingQuestions.length})</summary>{result.missingQuestions.map(q => <div key={q.id}><strong>{q.label}</strong><p>{q.reason}</p></div>)}</details>}
      {!scaleReady && <p className="field-help">{spanPath ? 'Рассчитайте и явно примените результат общей нормали или вернитесь в помощнике к прямому вводу. До этого перейти к построению нельзя.' : 'Неизвестный угол или профиль лучше уточнить по чертежу, данным ответной детали или измерениям. Помощник не подставляет их за вас.'}</p>}
    </section>
    <section hidden={step !== 3} aria-label="Размеры тела и резюме">
      <p className="step-intro">Осталось измерить тело детали. После построения вы сможете повернуть модель и проверить размеры.</p>
      <dl className="photo-summary"><div><dt>Тип</dt><dd>{supported ? modelNames[kind as InferredGearKind] : 'Не подтверждён'}</dd></div><div><dt>Число зубьев</dt><dd>{teeth || '—'}</dd></div><div><dt>Модуль</dt><dd>{calculatedModule !== undefined ? `${calculatedModule.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} мм` : '—'}</dd></div></dl>
      <div className="input-grid photo-spaced"><Measure label="Ширина, мм" value={width} set={v => edit(setWidth, v)} placeholder="Измерьте" /><Measure label={rack ? 'Основание, мм' : internal ? 'Обод, мм' : 'Отверстие, мм'} value={body} set={v => edit(setBody, v)} placeholder={rack || internal ? 'Измерьте' : '0 — сплошное'} /></div>
      <p className="field-help">Размеры тела обязательны. {spanPath ? `Утонение из принятого решения по общей нормали: ${spanApplication?.candidate.parameters.backlash.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} мм.` : 'Утонение зуба по фото не восстановлено: в модели принято 0.'} Галтель и посадки по фото не восстановлены; у наружного колеса принят радиус вершины инструмента 0,3mₙ. Его можно изменить вручную.</p>
      {kind === 'internal' && <InternalCutterFields params={internalCutter} onChange={(key, value) => { onDraftChange(); setError(''); setInternalCutter(old => ({ ...old, [key]: value })); }} />}
      {kind === 'internal-helical' && <p className="field-help">Внутреннее косозубое строится без производящей переходной поверхности. Плоский долбяк к этому режиму не применяется.</p>}
      {!ready && <p className="field-help">Укажите оба размера. Для сплошной детали отверстие равно 0.</p>}
    </section>
    <div className="wizard-actions">
      {step > 0 && <button className="secondary-button" onClick={() => goStep(step - 1)}><ArrowLeft size={17} /> Назад</button>}
      {step < 3 ? <button className="primary-button" disabled={!canContinue} onClick={() => goStep(step + 1)}>Далее <ArrowRight size={18} /></button>
        : <button className="primary-button" onClick={apply} disabled={!ready || busy}><Check size={18} /> Построить модель</button>}
    </div>
  </div>;
}

function DamagePreview({ image, width, height, analysis }: { image: string; width: number; height: number; analysis: PhotoAnalysis }) {
  const hypothesis = analysis.damageHypothesis, center = analysis.centerPx;
  if (!hypothesis || !center || !analysis.outsideDiameterPx) return null;
  const radius = analysis.outsideDiameterPx * .52;
  return <details>
    <summary>Показать участки для проверки</summary>
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Ожидаемые зубцовые ячейки с отклонениями от шаблона"
      style={{ display: 'block', width: '100%', height: 'auto', margin: '10px 0', borderRadius: 5 }}>
      <image href={image} width={width} height={height} />
      {hypothesis.damagedSectors.map((sector, index) => {
        const start = sector.startDeg * Math.PI / 180, end = sector.endDeg * Math.PI / 180;
        const span = (sector.endDeg - sector.startDeg + 360) % 360;
        const p = { x: center.x + radius * Math.cos(start), y: center.y + radius * Math.sin(start) };
        const q = { x: center.x + radius * Math.cos(end), y: center.y + radius * Math.sin(end) };
        const path = `M ${center.x} ${center.y} L ${p.x} ${p.y} A ${radius} ${radius} 0 ${span > 180 ? 1 : 0} 1 ${q.x} ${q.y} Z`;
        const labelAngle = (sector.startDeg + span / 2) * Math.PI / 180;
        return <g key={index}>
          <path d={path} fill="#ff9b2240" stroke="#ed7d00" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <text x={center.x + radius * .72 * Math.cos(labelAngle)} y={center.y + radius * .72 * Math.sin(labelAngle)} textAnchor="middle" dominantBaseline="central"
            fontSize={Math.max(width, height) / 22} fontWeight={700} fill="#fff" stroke="#723700" strokeWidth={Math.max(width, height) / 200} paintOrder="stroke">{index + 1}</text>
        </g>;
      })}
    </svg>
    <p>Подсвечены ожидаемые зубцовые ячейки, а не точные границы поломки. Осмотрите их; перекрытие или специальная форма могут выглядеть так же.</p>
    <ul>{hypothesis.damagedSectors.map((sector, index) => <li key={index}>{index + 1}: {sector.startDeg.toFixed(1)}°–{sector.endDeg.toFixed(1)}°{sector.wrapsZero ? ' через 0°' : ''}; ячеек: {sector.estimatedToothCells}.</li>)}</ul>
    <p>0° направлен вправо; угол растёт по часовой стрелке.</p>
  </details>;
}
function Measure({ label, value, set, placeholder }: { label: string; value: string; set: (v: string) => void; placeholder: string }) {
  return <label className="number-field">{label}<input aria-label={label} type="number" step="any" value={value} onChange={e => set(e.target.value)} placeholder={placeholder} /></label>;
}
function Choice({ active = true, id, label, value, onChange, options }: { active?: boolean; id: string; label: string; value: string; onChange: (v: string) => void; options: Record<string, string> }) {
  const popup = useActivePopup(active);
  return <div className="photo-spaced"><label className="field-label" htmlFor={id}>{label}</label><Select {...popup} value={value} onValueChange={onChange}><SelectTrigger id={id} className="select-control"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(options).map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent></Select></div>;
}
