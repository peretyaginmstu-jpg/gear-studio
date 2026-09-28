"use client";
import { useMemo, useRef, useState } from 'react';
import { Check, Ruler, ArrowRight } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { analyzeSpanMeasurement, selectSpanApplication } from '@/lib/spanMeasurement';
import type { SpanApplication, SpanCandidate, SpanMeasurementInput, SpanUncertainty } from '@/lib/spanMeasurement';
import { buildGearProfile, defaultGearParams } from '@/lib/gearMath';

type Facts = { teeth: boolean; involute: boolean; standardTip: boolean };
export interface SpanAssistantSeed { diameter?: number; diameterMethod?: SpanMeasurementInput['tipDiameterMethod']; pressureAngle?: number }
const number = (v: string) => v.trim() === '' ? NaN : Number(v);
const fmt = (v: number, digits = 6) => (Object.is(Number(v.toFixed(digits)), -0) ? 0 : v)
  .toLocaleString('ru-RU', { maximumFractionDigits: digits });

export function SpanMeasurementAssistant({ teeth, toolTipRadiusCoefficient, facts, seed, application, engaged,
  onDraftChange, onApply, onCancel }: {
  teeth: number; toolTipRadiusCoefficient: number; facts?: Facts; seed?: SpanAssistantSeed;
  application: SpanApplication | null; engaged: boolean;
  onDraftChange: () => void; onApply: (application: SpanApplication) => void; onCancel: () => void;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null), resultHeading = useRef<HTMLHeadingElement>(null);
  const [k, setK] = useState(''), [w, setW] = useState(''), [nextW, setNextW] = useState('');
  const [diameter, setDiameter] = useState(seed?.diameter !== undefined ? String(seed.diameter) : '');
  const [alpha, setAlpha] = useState(seed?.pressureAngle !== undefined ? String(seed.pressureAngle) : '');
  const [method, setMethod] = useState<SpanMeasurementInput['tipDiameterMethod']>(seed?.diameterMethod ?? 'unknown');
  const [ew, setEw] = useState(''), [enext, setEnext] = useState(''), [ed, setEd] = useState('');
  const [partConfirmed, setPartConfirmed] = useState(false), [standardConfirmed, setStandardConfirmed] = useState(false);
  const [angleConfirmed, setAngleConfirmed] = useState(false), [setupConfirmed, setSetupConfirmed] = useState(false);
  const [calculated, setCalculated] = useState(false);
  const edit = <T,>(set: (v: T) => void, value: T) => { onDraftChange(); setCalculated(false); set(value); };
  const input: SpanMeasurementInput = useMemo(() => ({ kind: 'spur', teeth, spanTeeth: number(k),
    pressureAngleDeg: alpha === '' ? null : number(alpha), pressureAngleConfirmed: angleConfirmed,
    spanMm: number(w), nextSpanMm: number(nextW), tipDiameterMm: number(diameter), tipDiameterMethod: method,
    errorBounds: { spanMm: number(ew), nextSpanMm: number(enext), tipDiameterMm: number(ed) },
    confirmations: { teeth: facts?.teeth ?? partConfirmed, involute: facts?.involute ?? partConfirmed,
      standardTip: facts?.standardTip ?? standardConfirmed, measurementSetup: setupConfirmed }, toolTipRadiusCoefficient,
  }), [teeth, k, alpha, angleConfirmed, w, nextW, diameter, method, ew, enext, ed, facts, partConfirmed, standardConfirmed, setupConfirmed, toolTipRadiusCoefficient]);
  const result = useMemo(() => calculated ? analyzeSpanMeasurement(input) : null, [input, calculated]);
  const calculate = () => { setCalculated(true); requestAnimationFrame(() => { resultHeading.current?.focus({ preventScroll: true }); resultHeading.current?.scrollIntoView({ block: 'nearest' }); }); };
  const cancel = () => { onCancel(); setCalculated(false); if (disclosure.current) disclosure.current.open = false; };
  return <details ref={disclosure} className="span-assistant">
    <summary><Ruler size={20} /><span>Не знаете модуль и смещение?<strong>Измерим зубья</strong></span>{application && <Check size={18} />}</summary>
    <div className="span-assistant-body">
      <p>Для наружного прямозубого эвольвентного колеса можно измерить общую нормаль дважды: по <b>k</b> и по <b>k+1</b> зубьям. Вместе с диаметром вершин это определит модуль, смещение и утонение одного колеса.</p>
      <details className="span-instructions"><summary>Как разместить инструмент</summary><SpanDiagram />
        <ol><li>Возьмите зубомерный микрометр или подходящий инструмент с плоскими параллельными измерительными поверхностями.</li>
          <li>Охватите k целых зубьев. Обе поверхности должны касаться боковин, вне вершин и галтелей. Запишите Wk.</li>
          <li>Тем же инструментом добавьте один зуб и измерьте W(k+1). Повторите на сохранных участках; разброс учтите в пределах ошибок.</li></ol>
        <p>Обычная линейка или произвольный размер штангенциркулем не заменяет общую нормаль. Геометрия губок и реальное прилегание проверяются вами.</p>
      </details>
      <p className="span-context">Наружное прямозубое · z = {Number.isFinite(teeth) ? teeth : '—'}. {facts ? 'Число зубьев и профиль — из ваших ответов.' : 'Число зубьев меняется в основных параметрах.'}</p>
      {seed && ((seed.diameter !== undefined && String(seed.diameter) !== diameter) || (seed.pressureAngle !== undefined && String(seed.pressureAngle) !== alpha)) && <button type="button" className="secondary-button full" onClick={() => {
        onDraftChange(); setCalculated(false);
        if (seed.diameter !== undefined) { setDiameter(String(seed.diameter)); setMethod(seed.diameterMethod ?? 'unknown'); }
        if (seed.pressureAngle !== undefined) { setAlpha(String(seed.pressureAngle)); setAngleConfirmed(false); }
      }}>Перенести уже введённый диаметр и угол</button>}
      {!facts && <label className="check-row"><Checkbox checked={partConfirmed} onCheckedChange={v => edit(setPartConfirmed, v === true)} /><span>Я проверил число зубьев и наружный прямозубой эвольвентный профиль.</span></label>}
      <div className="input-grid span-angle-count">
        <Field label="Известный угол α, °" value={alpha} onChange={v => { onDraftChange(); setCalculated(false); setAlpha(v); setAngleConfirmed(false); }} placeholder="Неизвестен" />
        <Field label="Число охватываемых зубьев k" value={k} onChange={v => edit(setK, v)} placeholder="Например, 3" />
      </div>
      <label className="check-row"><Checkbox checked={angleConfirmed} onCheckedChange={v => edit(setAngleConfirmed, v === true)} /><span>Угол известен по документации или подтверждён измерением. По одному контуру он не определён.</span></label>
      <p className="field-help">При неизвестном α два пролёта дают только основной шаг mπcosα. Помощник не принимает 20° автоматически.</p>
      <div className="span-readings">
        <Reading label={`Общая нормаль Wk${Number.isInteger(number(k)) ? `, по ${number(k)} зубьям` : ''}`} value={w} error={ew} onChange={v => edit(setW, v)} onError={v => edit(setEw, v)} />
        <Reading label={`Общая нормаль W(k+1)${Number.isInteger(number(k)) ? `, по ${number(k) + 1} зубьям` : ''}`} value={nextW} error={enext} onChange={v => edit(setNextW, v)} onError={v => edit(setEnext, v)} />
        <Reading label="Диаметр вершин da" value={diameter} error={ed} onChange={v => edit(setDiameter, v)} onError={v => edit(setEd, v)} />
      </div>
      <p className="field-help">Все размеры и ошибки — в мм. Введите предел абсолютной ошибки каждого отсчёта по инструменту и повторным измерениям. Это не только шаг дисплея; 0 означает точно заданное значение. Общую ошибку нуля мы не считаем автоматически сократившейся.</p>
      <label className="field-label span-method">Как получен da?<select className="select-control" value={method} onChange={e => edit(setMethod, e.target.value as SpanMeasurementInput['tipDiameterMethod'])}>
        <option value="unknown">Метод не подтверждён</option><option value="tip_circle">Диаметр окружности восстановлен</option>
        <option value="opposed_tips">Между противоположными вершинами</option><option value="uncorrected_caliper_span">Просто размер штангенциркулем</option>
      </select></label>
      <p className="field-help">При нечётном z обычный размер между вершинами не равен диаметру окружности.</p>
      {!facts && <label className="check-row"><Checkbox checked={standardConfirmed} onCheckedChange={v => edit(setStandardConfirmed, v === true)} /><span>Подтверждены ha* = 1 и отсутствие укорочения или модификации вершин.</span></label>}
      {facts && !facts.standardTip && <p className="field-help">Подтвердите стандартную высоту и отсутствие модификации вершин в этом шаге помощника по фото.</p>}
      <label className="check-row"><Checkbox checked={setupConfirmed} onCheckedChange={v => edit(setSetupConfirmed, v === true)} /><span>Оба пролёта измерены одним инструментом с плоскими параллельными поверхностями по сохранным зубьям; поверхности касались боковин, а не вершин или галтелей.</span></label>
      <p className="field-help">Корень проверяется для принятой рейки ρ/m = {fmt(toolTipRadiusCoefficient)}. Эти измерения не определяют инструмент, его галтель, износ или суммарный зазор пары.</p>
      <button type="button" className="secondary-button full" onClick={calculate}>Рассчитать по измерениям <ArrowRight size={17} /></button>
      {result && <div className="span-results">
        <h3 ref={resultHeading} tabIndex={-1}>Результат измерений</h3>
        {result.raw && <dl className="span-values"><div><dt>Модуль m</dt><dd>{fmt(result.raw.moduleMm)} мм</dd></div><div><dt>Смещение x</dt><dd>{fmt(result.raw.profileShift)}</dd></div><div><dt>Утонение j</dt><dd>{fmt(result.raw.toothThinningMm)} мм</dd></div></dl>}
        {result.issues.map(issue => <p className="inline-error" role="alert" key={issue.code}>{issue.message}</p>)}
        {result.exact && <><Candidate candidate={result.exact} fit={false} />
          <button type="button" className="primary-button full" disabled={application !== null} onClick={() => onApply(selectSpanApplication(result, 'exact-inverse'))}>{application ? <><Check size={18} /> Применено к черновику</> : <>Применить параметры <ArrowRight size={18} /></>}</button></>}
        {result.zeroThinningFit && <div className="span-fit"><h4>Возможна модель с нулевым утонением</h4>
          <p>Поправки помещаются в заданные пределы ошибок. Это согласованная модель при j = 0, а не новые измерения и не доказательство нулевого утонения детали.</p>
          <Candidate candidate={result.zeroThinningFit} fit />
          <div className="span-table-scroll"><table className="span-table"><thead><tr><th>Размер</th><th>Исходный</th><th>Принятый</th><th>Поправка</th></tr></thead><tbody>{(['spanMm', 'nextSpanMm', 'tipDiameterMm'] as const).map((key, i) => <tr key={key}><th>{['Wk', 'W(k+1)', 'da'][i]}</th><td>{fmt(input[key])}</td><td>{fmt(result.zeroThinningFit!.representativeReadings[key])}</td><td>{fmt(result.zeroThinningFit!.residuals[key])}</td></tr>)}</tbody></table></div>
          <button type="button" className="primary-button full" disabled={application !== null} onClick={() => onApply(selectSpanApplication(result, 'bounded-zero-thinning-fit'))}>{application ? 'Согласование применено' : 'Принять согласование при j = 0'}</button>
        </div>}
        {result.uncertainty && <Uncertainty data={result.uncertainty} />}
        {application && <p className="inline-status" role="status"><Check size={17} /> Параметры перенесены. Теперь можно построить модель и проверить её.</p>}
      </div>}
      {engaged && <button type="button" className="text-button span-cancel" onClick={cancel}>Использовать прямой ввод параметров</button>}
    </div>
  </details>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <label className="number-field">{label}<input aria-label={label} type="number" step="any" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label>;
}
function Reading({ label, value, error, onChange, onError }: { label: string; value: string; error: string; onChange: (v: string) => void; onError: (v: string) => void }) {
  return <div className="span-reading"><Field label={`${label}, мм`} value={value} onChange={onChange} placeholder="Измерьте" /><Field label={`Предел ошибки ${label}, ±мм`} value={error} onChange={onError} placeholder="Укажите" /></div>;
}
function Candidate({ candidate, fit }: { candidate: SpanCandidate; fit: boolean }) {
  return <><p>{fit ? `Будут приняты m = ${fmt(candidate.parameters.module)} мм, x = ${fmt(candidate.parameters.profileShift)}, j = 0 мм.` : 'Результат сохраняется без округления модуля до стандартного ряда.'}</p>
    {candidate.arithmetic.canonicalizedNumericalZero && <p className="field-help">Численный остаток j около нуля принят равным 0 в пределах ошибки вычислений ({candidate.arithmetic.zeroRoundoffToleranceMm.toExponential(2)} мм). Это отдельно записано в паспорт и не является подгонкой измерений.</p>}
    <details className="span-instructions"><summary>Проверка контакта с боковинами</summary><p>Проверен выбранный профиль с принятой корневой рейкой. Для обоих охватов симметричные точки касания находятся между концом галтели и вершиной.</p>
      <ul>{candidate.geometry.contacts.map(contact => <li key={contact.teeth}>По {contact.teeth} зубьям: радиус {fmt(contact.radiusMm)} мм; запас до перехода {fmt(contact.rootJoinMarginMm)} мм, до вершины {fmt(contact.tipMarginMm)} мм.</li>)}</ul>
      <p>Реальное прилегание и доступность губок зависят от инструмента. Модель не проверяет его конструкцию и не устанавливает пригодность передачи.</p></details></>;
}
function Uncertainty({ data }: { data: SpanUncertainty }) {
  return <details className="span-instructions span-uncertainty"><summary>Погрешности и чувствительность</summary>
    <p>Детерминированные пределы при фиксированном известном α, ha* = 1 и принятом инструменте. Допуск угла, износ, укорочение вершин и ошибки этих допущений не включены. Это не статистический доверительный интервал.</p>
    <dl className="dimension-list"><div><dt>Модуль, мм</dt><dd>{fmt(data.moduleMm.min)} … {fmt(data.moduleMm.max)}</dd></div><div><dt>Смещение x</dt><dd>{fmt(data.profileShift.min)} … {fmt(data.profileShift.max)}</dd></div><div><dt>Утонение, мм</dt><dd>{fmt(data.toothThinningMm.min)} … {fmt(data.toothThinningMm.max)}</dd></div></dl>
    <p>Предел относительной ошибки разности W(k+1) − Wk: {fmt(data.relativeBasePitchErrorBound * 100, 3)}%. Коэффициент чувствительности разности: {fmt(data.differenceConditionNumber, 2)}. Близкие отсчёты усиливают влияние ошибок.</p>
    <p>Контакт проверен у выбранной модели, не у каждого сочетания параметров внутри интервалов. Арифметический запас расширяет границы наружу.</p>
    <p className="span-formula">pb = W(k+1) − Wk; m = pb/(π cos α); x = (da/m − z − 2)/2.<br />Утонение j отдельно определяется из общей нормали; это не геометрическое смещение x и не зазор пары.</p>
  </details>;
}

/** Original analytical explanatory drawing, deliberately labelled as a fixed example. */
function SpanDiagram() {
  const points = useMemo(() => buildGearProfile({ ...defaultGearParams, kind: 'spur', teeth: 24, module: 2,
    profileShift: 0, backlash: 0, helixAngleDeg: 0, bore: 0 }).outer, []);
  // Presentation only: stable SVG serialization across server/browser math implementations.
  const svg = (v: number) => Number(v.toFixed(4));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${svg(280 + p.y * 6)},${svg(300 - p.x * 6)}`).join(' ') + ' Z';
  const rb = 24 * Math.cos(20 * Math.PI / 180), halfSpan = 15.432923068267584 / 2;
  const left = svg(280 - halfSpan * 6), right = svg(280 + halfSpan * 6), y = svg(300 - rb * 6);
  return <figure className="span-diagram"><svg viewBox="0 0 560 230" role="img" aria-label="Схема общей нормали по трём зубьям: две плоские параллельные поверхности касаются противоположных эвольвентных боковин">
    <path d={path} fill="#eee7d8" stroke="#ad976f" strokeWidth="1.5" />
    {[left, right].map((x, i) => <g key={x}><path d={`M${x},67 V${y + 24}`} stroke="#8d7d62" strokeWidth="1" strokeDasharray="4 4" />
      <rect x={i ? x : x - 9} y={y - 5} width="9" height="10" rx="1" fill="#4d5358" />
      <circle cx={x} cy={y} r="3.5" fill="#fff" stroke="#94661f" strokeWidth="2" /></g>)}
    <path d={`M${left},78 H${right} M${left + 7},74 L${left},78 L${left + 7},82 M${right - 7},74 L${right},78 L${right - 7},82`} fill="none" stroke="#94661f" strokeWidth="1.5" />
    <text x="280" y="59" textAnchor="middle" fill="#533c1b" fontSize="18" fontWeight="600">Wk</text>
    {[-1, 0, 1].map((tooth, i) => <text key={tooth} x={svg(280 + 26 * Math.sin(tooth * Math.PI / 12) * 6)} y={svg(300 - 26 * Math.cos(tooth * Math.PI / 12) * 6 - 9)} textAnchor="middle" fill="#533c1b" fontSize="14">{i + 1}</text>)}
    <text x="280" y="213" textAnchor="middle" fill="#4d5358" fontSize="14">k = 3 · контакт на боковинах</text>
  </svg><figcaption>Схема размещения, не измерение вашей детали. Для второго отсчёта охватите на один зуб больше.</figcaption></figure>;
}
