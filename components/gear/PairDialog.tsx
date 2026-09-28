"use client";

import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, Link2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { modelNames, type ModelKind, type ModelParams } from '@/lib/model';
import { analyzeGearPair, createPairAnalysisDocument, initialPairMate, type PairDimensions, type PairStatus } from '@/lib/pairAnalysis';
import { downloadBlob } from '@/lib/download';
import { InternalCutterFields } from './InternalCutterFields';

const kinds: ModelKind[] = ['spur', 'helical', 'herringbone', 'internal', 'internal-helical', 'rack', 'helical-rack'];
const isHelical = (kind: ModelKind) => ['helical', 'herringbone', 'internal-helical', 'helical-rack'].includes(kind);
const isRack = (kind: ModelKind) => kind === 'rack' || kind === 'helical-rack';
const isInternal = (kind: ModelKind) => kind === 'internal' || kind === 'internal-helical';
const format = (n: number | null, digits = 4) => n === null || !Number.isFinite(n) ? 'Не рассчитано' : n.toLocaleString('ru-RU', { maximumFractionDigits: digits });
const verdicts: Record<PairStatus, string> = {
  pass: 'Геометрические проверки выполнены',
  warning: 'Геометрия проверена с оговорками',
  fail: 'Не выполнены геометрические условия',
  unsupported: 'Для этой пары расчёт не реализован',
};

export function PairDialog({ open, onOpenChange, params }: {
  open: boolean; onOpenChange: (open: boolean) => void; params: ModelParams;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="engineering-dialog print-dialog" data-testid="pair-dialog">
      <DialogHeader>
        <div className="dialog-kicker"><Link2 size={17} /> ГЕОМЕТРИЯ ПАРЫ</div>
        <DialogTitle>{params.kind === 'bevel' ? 'Предпроверка конусов' : params.kind === 'cycloidal' ? 'Предпроверка циклоидальной пары' : 'Проверить ответную деталь'}</DialogTitle>
        <DialogDescription>{params.kind === 'bevel'
          ? 'Две прямозубые модели со сферической эвольвентой: построимость, делительные конусы и общая ширина. Контакт зубьев и реальный монтаж отдельно не проверяются.'
          : params.kind === 'cycloidal' ? 'Два внешних цилиндрических колеса: производящие окружности и необходимые границы рабочих боковин. Это не проверка циклоидального редуктора или полного контакта зубьев.'
            : 'Рабочее положение, зазоры и непрерывность идеального зацепления. Прочность и ресурс требуют отдельного расчёта.'}</DialogDescription>
      </DialogHeader>
      <PairContent key={JSON.stringify(params)} params={params} />
    </DialogContent>
  </Dialog>;
}

function PairContent({ params }: { params: ModelParams }) {
  const [second, setSecond] = useState(() => initialPairMate(params));
  const [center, setCenter] = useState('');
  const centerDistanceMm = center.trim() === '' ? undefined : Number(center);
  const report = useMemo(() => analyzeGearPair({ first: params, second, centerDistanceMm }), [params, second, centerDistanceMm]);
  const bevelPair = params.kind === 'bevel';
  const cycloidalPair = params.kind === 'cycloidal';
  const specialPair = bevelPair || cycloidalPair;
  const rackPair = isRack(params.kind) || isRack(second.kind);
  const chevron = params.kind === 'herringbone' && second.kind === 'herringbone';
  const number = (key: keyof Pick<ModelParams, 'teeth' | 'module' | 'pressureAngleDeg' | 'helixAngleDeg' | 'profileShift' | 'width' | 'backlash' | 'bore' | 'bevelShaftAngleDeg' | 'cycloidRollingRadius' | 'toolTipRadiusCoefficient'>, value: number) =>
    setSecond(old => ({ ...old, [key]: value }));
  function exportReport() {
    try {
      const supportsCurrentFamily = kinds.includes(params.kind) || specialPair;
      const output = createPairAnalysisDocument({ first: params, second, centerDistanceMm });
      const json = JSON.stringify(output, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2);
      downloadBlob(json, 'application/json', `gear-pair-${params.kind}-${supportsCurrentFamily ? second.kind : 'unsupported'}.json`);
      toast.success('Скачивание отчёта запрошено. Проверьте загрузки браузера.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Не удалось сохранить отчёт.'); }
  }
  if (!kinds.includes(params.kind) && !specialPair) return <>
    <p><strong>{modelNames[params.kind]}</strong></p>
    <p className="field-help">{params.kind === 'worm'
      ? `Осевой модуль mₓ = ${format(params.module)} мм; заходов = ${format(params.wormStarts ?? 1)}.`
      : `Модуль m = ${format(params.module)} мм; зубьев z = ${format(params.teeth)}.`}</p>
    <div className="print-verdict warning" role="status" data-testid="pair-verdict"><strong>{verdicts.unsupported}</strong>
      <p>{report.checks[0].detail}</p>
    </div>
    <p>{params.kind === 'worm'
      ? 'Нужна сопряжённая поверхность червячного колеса. Совпадение модуля и числа зубьев эвольвентного колеса не подтверждает совместимость с червяком ZA.'
      : 'Для этого семейства отдельная модель пары пока не реализована.'}</p>
    <div className="dialog-action-row"><p>Размеры пары не рассчитаны и сохраняются в отчёте как null.</p><button className="primary-button" onClick={exportReport}><Download size={16} /> Скачать отчёт JSON</button></div>
  </>;
  const metrics: { key: keyof PairDimensions; label: string; unit?: string }[] = [
    { key: 'referenceCenterDistanceMm', label: rackPair ? 'Радиус делительного цилиндра r₀' : 'Расстояние делительных окружностей a₀', unit: 'мм' },
    { key: 'operatingCenterDistanceMm', label: rackPair ? 'Центр — исходная линия рейки' : 'Рабочее межосевое расстояние a', unit: 'мм' },
    { key: 'operatingPressureAngleDeg', label: 'Рабочий поперечный угол αwt', unit: '°' },
    { key: 'transverseBacklashMm', label: 'Поперечный боковой зазор jₜ', unit: 'мм' },
    { key: 'minimumRadialClearanceMm', label: 'Минимальный радиальный зазор', unit: 'мм' },
    { key: 'transverseContactRatio', label: 'Торцовое перекрытие εα' },
    { key: 'overlapContactRatio', label: chevron ? 'Осевое перекрытие половины εβ' : 'Осевое перекрытие εβ' },
    { key: 'totalContactRatio', label: 'Суммарное перекрытие εγ' },
    { key: 'effectiveFaceWidthMm', label: 'Общая ширина при совмещении', unit: 'мм' },
    ...(!rackPair ? [{ key: 'ratio' as const, label: '|ω₁ / ω₂| = z₂ / z₁' }] : []),
  ];
  const cone = report.bevelGeometry;
  const coneMetrics = [
    { label: 'Угол первого конуса δ₁', value: cone?.firstPitchConeAngleDeg ?? null, unit: '°' },
    { label: 'Угол второго конуса δ₂', value: cone?.secondPitchConeAngleDeg ?? null, unit: '°' },
    { label: 'Угол между осями Σ', value: cone?.shaftAngleDeg ?? null, unit: '°' },
    { label: 'Общее внешнее расстояние R', value: cone?.outerConeDistanceMm ?? null, unit: 'мм' },
    { label: 'Начало перекрытия Q от апекса', value: cone?.overlapStartMm ?? null, unit: 'мм' },
    { label: 'Конец перекрытия Q от апекса', value: cone?.overlapEndMm ?? null, unit: 'мм' },
    { label: 'Общая длина по образующей', value: cone?.overlapLengthMm ?? null, unit: 'мм' },
    { label: '|ω₁ / ω₂| = z₂ / z₁', value: cone?.ratio ?? null, unit: '' },
  ];
  const cycloid = report.cycloidalGeometry;
  const cycloidMetrics = [
    { label: 'Делительный модуль m', value: cycloid?.referenceModuleMm ?? null, unit: 'мм' },
    { label: 'Общий производящий радиус r', value: cycloid?.rollingRadiusMm ?? null, unit: 'мм' },
    { label: 'Номинальное межосевое a₀', value: cycloid?.nominalCenterDistanceMm ?? null, unit: 'мм' },
    { label: 'Круговой шаг πm', value: cycloid?.circularPitchMm ?? null, unit: 'мм' },
    { label: 'Верхняя граница длины Smax', value: cycloid?.totalPitchTravelUpperBoundMm ?? null, unit: 'мм' },
    { label: 'Верхняя граница покрытия шага (не ε)', value: cycloid?.nominalFlankCoverageUpperBound ?? null, unit: '' },
    { label: 'Общая ширина при совмещении', value: cycloid?.faceOverlapMm ?? null, unit: 'мм' },
    { label: '|ω₁ / ω₂| = z₂ / z₁', value: cycloid?.ratio ?? null, unit: '' },
  ];
  return <>
    <div className="print-dialog-grid">
      <section>
        <h3>1. Текущая модель</h3>
        <p style={{ marginBottom: 8 }}><strong>{modelNames[params.kind]}</strong></p>
        {bevelPair ? <p className="field-help" data-testid="pair-first-summary">
          z₁ = {format(params.teeth)} · mₑ₁ = {format(params.module)} мм · α₁ = {format(params.pressureAngleDeg)}°<br />
          Партнёр, заданный при построении: z₂ = {format(params.bevelMateTeeth ?? params.teeth)}<br />
          Σ₁ = {format(params.bevelShaftAngleDeg ?? 90)}° · b₁ = {format(params.width)} мм по образующей<br />
          Отверстие {format(params.bore)} мм · утонение зуба {format(params.backlash)} мм
        </p> : cycloidalPair ? <p className="field-help" data-testid="pair-first-summary">
          z₁ = {format(params.teeth)} · m₁ = {format(params.module)} мм<br />
          Производящий r₁ = {format(params.cycloidRollingRadius ?? Math.min(2 * params.module, params.module * params.teeth / 4))} мм · b₁ = {format(params.width)} мм<br />
          Отверстие {format(params.bore)} мм · утонение зуба {format(params.backlash)} мм<br />
          Головка — эпициклоида, ножка — гипоциклоида; один r для обеих частей.
        </p> : <p className="field-help" data-testid="pair-first-summary">
          z = {format(params.teeth)} · mₙ = {format(params.module)} мм · αₙ = {format(params.pressureAngleDeg)}°<br />
          β = {format(isHelical(params.kind) ? params.helixAngleDeg : 0)}° · xₙ = {format(params.profileShift)} · b = {format(params.width)} мм<br />
          Уменьшение толщины δₙ₁ = {format(params.backlash)} мм
        </p>}
        <h3 style={{ marginTop: 24 }}>2. Ответная деталь</h3>
        <p className="field-help">{bevelPair
          ? 'Начальные значения взяты из параметров партнёра первой модели. Уточните размеры ответного колеса. Первая готовая модель здесь не меняется: для другого z₂ вернитесь к её данным и перестройте её.'
          : cycloidalPair ? 'Начальные значения — пример ответного колеса с тем же производящим радиусом. Введите параметры своей детали. Первое колесо здесь не меняется.'
            : 'Начальные значения — пример. Введите параметры существующей детали или проектируемого колеса.'}</p>
        {specialPair ? <p><strong>{bevelPair ? 'Прямозубое коническое · сферическая эвольвента' : 'Внешнее циклоидальное · эпи-/гипоциклоида'}</strong></p> : <>
        <label className="field-label" htmlFor="pair-kind">Тип ответной детали</label>
        <Select value={second.kind} onValueChange={value => setSecond(old => ({ ...old, kind: value as ModelKind }))}>
          <SelectTrigger id="pair-kind" className="select-control"><SelectValue /></SelectTrigger>
          <SelectContent>{kinds.map(kind => <SelectItem key={kind} value={kind}>{modelNames[kind]}</SelectItem>)}</SelectContent>
        </Select>
        </>}
        <div className="input-grid" style={{ marginTop: 18 }}>
          <Num label={isRack(second.kind) ? 'Зубьев рейки' : 'Зубьев z₂'} value={second.teeth} min={isRack(second.kind) ? 1 : 6} max={250} change={v => number('teeth', v)} />
          <Num label={bevelPair ? 'Внешний модуль mₑ₂, мм' : cycloidalPair ? 'Делительный модуль m₂, мм' : 'Модуль mₙ₂, мм'} value={second.module} min={0.1} max={30} step={0.1} change={v => number('module', v)} />
          {!cycloidalPair && <Num label={bevelPair ? 'Угол профиля α₂, °' : 'Угол αₙ₂, °'} value={second.pressureAngleDeg} min={10} max={35} step={0.1} change={v => number('pressureAngleDeg', v)} />}
          {bevelPair ? <>
            <Num label="Угол осей Σ₂, °" value={second.bevelShaftAngleDeg ?? 90} min={0.01} max={179.99} step={0.1} change={v => number('bevelShaftAngleDeg', v)} />
            <Num label="Партнёр второй модели: z₁" value={second.bevelMateTeeth ?? second.teeth} disabled change={() => {}} />
            <Num label="Отверстие второй модели, мм" value={second.bore} min={0} step={0.1} change={v => number('bore', v)} />
          </> : cycloidalPair ? <>
            <Num label="Производящий радиус r₂, мм" value={second.cycloidRollingRadius ?? Math.min(2 * second.module, second.module * second.teeth / 4)} min={0.000001} step={0.01} change={v => number('cycloidRollingRadius', v)} />
            <Num label="Отверстие второй модели, мм" value={second.bore} min={0} step={0.1} change={v => number('bore', v)} />
          </> : <>
          <Num label="Наклон β₂, °" value={isHelical(second.kind) ? second.helixAngleDeg : 0} min={-45} max={45} step={0.1} disabled={!isHelical(second.kind)} change={v => number('helixAngleDeg', v)} />
          <Num label="Смещение xₙ₂" value={second.profileShift} min={-0.8} max={1} step={0.05} change={v => number('profileShift', v)} />
          </>}
          <Num label={bevelPair ? 'Ширина b₂ по образующей, мм' : 'Ширина b₂, мм'} value={second.width} min={0.01} max={500} step={0.1} change={v => number('width', v)} />
          <Num label={bevelPair ? 'Утонение зуба на внешнем торце, мм' : cycloidalPair ? 'Утонение по делительной окружности, мм' : 'Утонение δₙ₂, мм'} value={second.backlash} min={0} step={0.01} change={v => number('backlash', v)} />
          {!specialPair && !isRack(second.kind) && !isInternal(second.kind) && <Num label="Радиус инструмента / mₙ" value={second.toolTipRadiusCoefficient ?? 0.3} min={0.001} step={0.01} change={v => number('toolTipRadiusCoefficient', v)} />}
        </div>
        <p className="field-help">{bevelPair
          ? 'Число зубьев партнёра второй модели фиксировано по первой детали. Утонение каждого зуба задано на внешнем делительном сечении; оно не является пространственным зазором пары. Смещение и винтовой наклон для этих моделей равны нулю.'
          : cycloidalPair ? 'Один r₂ образует обе части зуба. В текущем частном случае r₁ и r₂ должны совпадать. Постоянный угол давления и эвольвентное смещение неприменимы; β=0. Утонение отдельного зуба не является проверенным зазором пары.'
            : 'δₙ — уменьшение толщины одного зуба в нормальном сечении, не зазор всей пары. Ноль означает отсутствие утонения. Вторая наружная модель принята без отверстия; радиус инструмента по умолчанию 0,3 mₙ.'}</p>
        {second.kind === 'internal' && <InternalCutterFields params={second} onChange={(key, value) => setSecond(old => ({ ...old, [key]: value }))} />}
        {bevelPair ? <>
          <h3 style={{ marginTop: 22 }}>3. Условное совмещение</h3>
          <p className="field-help">Апексы делительных конусов и их внешние торцы условно совмещены. Q отсчитывается от апекса вдоль общей образующей. Реальные монтажные расстояния, положение осей и фаза зубьев не заданы — эта проверка не подтверждает посадку или контакт.</p>
        </> : cycloidalPair ? <>
          <h3 style={{ marginTop: 22 }}>3. Номинальное положение</h3>
          <label className="number-field" htmlFor="pair-center-distance">Фактическое межосевое a, мм (если известно)</label>
          <input id="pair-center-distance" type="number" className="select-control" min="0.000001" step="0.01" value={center} placeholder="Неизвестно — только номинальное a₀" onChange={event => setCenter(event.target.value)} />
          <p className="field-help">Проверка применима только при a₀=R₁+R₂. Другое введённое расстояние даёт отказ, без пересчёта по эвольвентным формулам. Параллельность осей и совмещение средних плоскостей здесь приняты; реальная посадка и фаза зубьев не подтверждены.</p>
        </> : <>
        <h3 style={{ marginTop: 22 }}>3. Рабочее положение</h3>
        <label className="number-field" htmlFor="pair-center-distance">{rackPair ? 'Центр — линия y = 0 рейки, мм' : 'Фактическое межосевое a, мм'}</label>
        <input id="pair-center-distance" type="number" className="select-control" min="0.000001" step="0.01" value={center} placeholder="Пусто — рассчитать по x" onChange={event => setCenter(event.target.value)} />
        <p className="field-help">Без введённого a расстояние рассчитывается по смещениям профиля до утонения зубьев. Введённое a имеет приоритет. Для рейки отсчёт идёт от исходной линии профиля, а не от нижней поверхности.</p>
        </>}
        <button className="secondary-button" type="button" onClick={() => { setSecond(initialPairMate(params)); setCenter(''); }}>Восстановить начальные значения</button>
      </section>
      <section className="print-checks" aria-label="Результат проверки пары">
        <div className={`print-verdict ${report.status === 'unsupported' ? 'warning' : report.status}`} role="status" data-testid="pair-verdict">
          <strong>{bevelPair && report.status === 'warning' ? 'Конусы согласованы; контакт не проверен' : cycloidalPair && report.status === 'warning' ? 'Необходимые условия проверены; контакт не подтверждён' : verdicts[report.status]}</strong>
          <p>{bevelPair ? 'Предпроверка конусов и размеров. Даже при совпадении всех условий сопряжённость поверхностей и реальное зацепление остаются непроверенными.' : cycloidalPair
            ? 'Предпроверка производящих окружностей и конечных боковин. Верхняя граница покрытия шага не является контактным отношением; реальное зацепление, зазор и интерференция не подтверждены.'
            : 'Это результат перечисленных ниже проверок моделей. Нагрузки, ресурс и погрешности изготовления в расчёт не входят.'}</p>
        </div>
        {bevelPair ? <>
          <dl className="dimension-list" data-testid="pair-dimensions">{coneMetrics.map(({ label, value, unit }) => <div key={label}>
            <dt>{label}</dt><dd>{format(value)}{value !== null && unit ? ` ${unit}` : ''}</dd>
          </div>)}</dl>
          <p className="field-help">Контактное отношение, боковой зазор и отсутствие интерференции: <strong>не проверены</strong>. Общая длина по образующей не заменяет контактное отношение.</p>
        </> : cycloidalPair ? <>
          <dl className="dimension-list" data-testid="pair-dimensions">{cycloidMetrics.map(({ label, value, unit }) => <div key={label}>
            <dt>{label}</dt><dd>{format(value, 6)}{value !== null && unit ? ` ${unit}` : ''}</dd>
          </div>)}</dl>
          <p className="field-help">Контактное отношение, боковой зазор и отсутствие интерференции: <strong>не проверены</strong>. При границе покрытия меньше 1 даже номинальных аналитических боковин недостаточно для непрерывного движения.</p>
        </> : <dl className="dimension-list" data-testid="pair-dimensions">{metrics.map(({ key, label, unit }) => <div key={key}>
          <dt>{label}</dt><dd>{format(report.dimensions[key])}{report.dimensions[key] !== null && unit ? ` ${unit}` : ''}</dd>
        </div>)}</dl>}
        {report.checks.map(check => <div className={`print-check ${check.status}`} key={check.id} data-check={check.id} data-status={check.status}>
          {check.status === 'pass' ? <Check size={18} /> : check.status === 'fail' ? <X size={18} /> : <AlertTriangle size={18} />}
          <div><strong>{check.label}</strong><p>{check.detail}</p></div>
        </div>)}
      </section>
    </div>
    <details className="advanced-settings" style={{ marginTop: 0 }}>
      <summary>Допущения и источники формул</summary>
      <ul style={{ paddingLeft: 20, marginTop: 12 }}>{report.assumptions.map(text => <li key={text}>{text}</li>)}</ul>
      <p className="field-help" style={{ marginTop: 12 }}>{bevelPair ? 'Формулы цилиндрического межосевого расстояния к этому отчёту не применяются.' : cycloidalPair ? 'Область — две внешние цилиндрические циклоидальные модели с общей производящей окружностью. Двухрадиусные профили и эксцентриковые редукторы сюда не входят.' : 'Для двух конических или внешних циклоидальных моделей доступны отдельные предпроверки. Червячная пара пока не рассчитывается.'}</p>
      <p style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>{report.sources.map(source => <a className="inline-link" key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</p>
    </details>
    <div className="dialog-action-row">
      <p>{bevelPair ? 'JSON содержит параметры обеих деталей, проверки сеток и конусов, условные координаты перекрытия и ограничения. Это не подтверждение сборки.' : cycloidalPair ? 'JSON содержит обе модели, радиусы, номинальные границы боковин и ограничения. Это не подтверждение полного зацепления или пригодности к печати.' : 'В отчёте сохраняются обе детали, режим выбора расстояния, результаты и допущения. «Не рассчитано» не заменяется нулём.'}</p>
      <button className="primary-button" onClick={exportReport}><Download size={16} /> Скачать отчёт JSON</button>
    </div>
  </>;
}

function Num({ label, value, change, min, max, step = 1, disabled = false }: {
  label: string; value: number; change: (value: number) => void; min?: number; max?: number; step?: number; disabled?: boolean;
}) {
  return <label>{label}<input type="number" value={Number.isFinite(value) ? value : ''} min={min} max={max} step={step} disabled={disabled}
    onChange={event => change(event.target.value === '' ? NaN : Number(event.target.value))} /></label>;
}
