"use client";

import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, Link2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { defaultModel, modelNames, type ModelKind, type ModelParams } from '@/lib/model';
import { analyzeGearPair, type PairDimensions, type PairStatus } from '@/lib/pairAnalysis';
import { downloadBlob } from '@/lib/download';

const kinds: ModelKind[] = ['spur', 'helical', 'herringbone', 'internal', 'internal-helical', 'rack', 'helical-rack'];
const isHelical = (kind: ModelKind) => ['helical', 'herringbone', 'internal-helical', 'helical-rack'].includes(kind);
const isRack = (kind: ModelKind) => kind === 'rack' || kind === 'helical-rack';
const isInternal = (kind: ModelKind) => kind === 'internal' || kind === 'internal-helical';
const format = (n: number | null, digits = 4) => n === null ? 'Не рассчитано' : n.toLocaleString('ru-RU', { maximumFractionDigits: digits });
const verdicts: Record<PairStatus, string> = {
  pass: 'Геометрические проверки выполнены',
  warning: 'Геометрия проверена с оговорками',
  fail: 'Не выполнены геометрические условия',
  unsupported: 'Для этой пары расчёт не реализован',
};

/** A visible starting point, not a solver or a claim that this is the user's actual mate. */
function initialMate(first: ModelParams): ModelParams {
  const kind: ModelKind = first.kind === 'herringbone' ? 'herringbone' : isHelical(first.kind) ? 'helical' : 'spur';
  const internalFirst = isInternal(first.kind), rackFirst = isRack(first.kind);
  return {
    ...defaultModel(kind),
    teeth: internalFirst ? Math.max(18, Math.min(36, first.teeth - 12)) : rackFirst ? 24 : Math.min(250, first.teeth * 2),
    module: first.module, pressureAngleDeg: first.pressureAngleDeg,
    helixAngleDeg: isHelical(first.kind) ? first.helixAngleDeg * (internalFirst || rackFirst ? 1 : -1) : 0,
    width: first.width, profileShift: 0, backlash: first.backlash, bore: 0,
  };
}

export function PairDialog({ open, onOpenChange, params }: {
  open: boolean; onOpenChange: (open: boolean) => void; params: ModelParams;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="engineering-dialog print-dialog" data-testid="pair-dialog">
      <DialogHeader>
        <div className="dialog-kicker"><Link2 size={17} /> ГЕОМЕТРИЯ ПАРЫ</div>
        <DialogTitle>Проверить ответную деталь</DialogTitle>
        <DialogDescription>Рабочее положение, зазоры и непрерывность идеального зацепления. Прочность и ресурс требуют отдельного расчёта.</DialogDescription>
      </DialogHeader>
      <PairContent key={JSON.stringify(params)} params={params} />
    </DialogContent>
  </Dialog>;
}

function PairContent({ params }: { params: ModelParams }) {
  const [second, setSecond] = useState(() => initialMate(params));
  const [center, setCenter] = useState('');
  const centerDistanceMm = center.trim() === '' ? undefined : Number(center);
  const report = useMemo(() => analyzeGearPair({ first: params, second, centerDistanceMm }), [params, second, centerDistanceMm]);
  const rackPair = isRack(params.kind) || isRack(second.kind);
  const chevron = params.kind === 'herringbone' && second.kind === 'herringbone';
  const number = (key: keyof Pick<ModelParams, 'teeth' | 'module' | 'pressureAngleDeg' | 'helixAngleDeg' | 'profileShift' | 'width' | 'backlash' | 'toolTipRadiusCoefficient'>, value: number) =>
    setSecond(old => ({ ...old, [key]: value }));
  function exportReport() {
    try {
      const supportsCurrentFamily = kinds.includes(params.kind);
      const output = {
        schema: 'zatseplenie.pair-analysis.v1', createdAt: new Date().toISOString(), units: 'mm',
        input: { first: params, second: supportsCurrentFamily ? second : null,
          centerDistanceMm: supportsCurrentFamily ? centerDistanceMm ?? null : null,
          centerMode: supportsCurrentFamily ? centerDistanceMm === undefined ? 'calculated-from-profile-shifts' : 'user-specified' : 'not-applicable' },
        report,
      };
      const json = JSON.stringify(output, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2);
      downloadBlob(json, 'application/json', `gear-pair-${params.kind}-${supportsCurrentFamily ? second.kind : 'unsupported'}.json`);
      toast.success('Скачивание отчёта запрошено. Проверьте загрузки браузера.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Не удалось сохранить отчёт.'); }
  }
  if (!kinds.includes(params.kind)) return <>
    <p><strong>{modelNames[params.kind]}</strong></p>
    <p className="field-help">{params.kind === 'worm'
      ? `Осевой модуль mₓ = ${format(params.module)} мм; заходов = ${format(params.wormStarts ?? 1)}.`
      : params.kind === 'bevel'
        ? `Внешний модуль mₑ = ${format(params.module)} мм; z₁ = ${format(params.teeth)}, z₂ = ${format(params.bevelMateTeeth ?? params.teeth)}; Σ = ${format(params.bevelShaftAngleDeg ?? 90)}°.`
        : `Модуль m = ${format(params.module)} мм; зубьев z = ${format(params.teeth)}. Постоянный угол профиля αₙ для циклоиды не применяется.`}</p>
    <div className="print-verdict warning" role="status" data-testid="pair-verdict"><strong>{verdicts.unsupported}</strong>
      <p>{report.checks[0].detail}</p>
    </div>
    <p>{params.kind === 'worm'
      ? 'Нужна сопряжённая поверхность червячного колеса. Совпадение модуля и числа зубьев эвольвентного колеса не подтверждает совместимость с червяком ZA.'
      : params.kind === 'bevel'
        ? 'Числа зубьев и угол осей задают делительный конус одиночной модели. Контакт сферических эвольвент, зазоры и интерференция конической пары требуют отдельного расчёта; цилиндрические формулы этого диалога неприменимы.'
        : 'Для циклоидальной пары необходимо согласовать производящие окружности и рабочие участки обоих профилей. Этот диалог пока проверяет только цилиндрические эвольвентные пары.'}</p>
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
  return <>
    <div className="print-dialog-grid">
      <section>
        <h3>1. Текущая модель</h3>
        <p style={{ marginBottom: 8 }}><strong>{modelNames[params.kind]}</strong></p>
        <p className="field-help" data-testid="pair-first-summary">
          z = {format(params.teeth)} · mₙ = {format(params.module)} мм · αₙ = {format(params.pressureAngleDeg)}°<br />
          β = {format(isHelical(params.kind) ? params.helixAngleDeg : 0)}° · xₙ = {format(params.profileShift)} · b = {format(params.width)} мм<br />
          Уменьшение толщины δₙ₁ = {format(params.backlash)} мм
        </p>
        <h3 style={{ marginTop: 24 }}>2. Ответная деталь</h3>
        <p className="field-help">Начальные значения — пример. Введите параметры существующей детали или проектируемого колеса.</p>
        <label className="field-label" htmlFor="pair-kind">Тип ответной детали</label>
        <Select value={second.kind} onValueChange={value => setSecond(old => ({ ...old, kind: value as ModelKind }))}>
          <SelectTrigger id="pair-kind" className="select-control"><SelectValue /></SelectTrigger>
          <SelectContent>{kinds.map(kind => <SelectItem key={kind} value={kind}>{modelNames[kind]}</SelectItem>)}</SelectContent>
        </Select>
        <div className="input-grid" style={{ marginTop: 18 }}>
          <Num label={isRack(second.kind) ? 'Зубьев рейки' : 'Зубьев z₂'} value={second.teeth} min={isRack(second.kind) ? 1 : 6} max={250} change={v => number('teeth', v)} />
          <Num label="Модуль mₙ₂, мм" value={second.module} min={0.1} max={30} step={0.1} change={v => number('module', v)} />
          <Num label="Угол αₙ₂, °" value={second.pressureAngleDeg} min={10} max={35} step={0.1} change={v => number('pressureAngleDeg', v)} />
          <Num label="Наклон β₂, °" value={isHelical(second.kind) ? second.helixAngleDeg : 0} min={-45} max={45} step={0.1} disabled={!isHelical(second.kind)} change={v => number('helixAngleDeg', v)} />
          <Num label="Смещение xₙ₂" value={second.profileShift} min={-0.8} max={1} step={0.05} change={v => number('profileShift', v)} />
          <Num label="Ширина b₂, мм" value={second.width} min={0.01} max={500} step={0.1} change={v => number('width', v)} />
          <Num label="Утонение δₙ₂, мм" value={second.backlash} min={0} step={0.01} change={v => number('backlash', v)} />
          {!isRack(second.kind) && !isInternal(second.kind) && <Num label="Радиус инструмента / mₙ" value={second.toolTipRadiusCoefficient ?? 0.3} min={0.001} step={0.01} change={v => number('toolTipRadiusCoefficient', v)} />}
        </div>
        <p className="field-help">δₙ — уменьшение толщины одного зуба в нормальном сечении, не зазор всей пары. Ноль означает отсутствие утонения. Вторая наружная модель принята без отверстия; радиус инструмента по умолчанию 0,3 mₙ.</p>
        <h3 style={{ marginTop: 22 }}>3. Рабочее положение</h3>
        <label className="number-field" htmlFor="pair-center-distance">{rackPair ? 'Центр — линия y = 0 рейки, мм' : 'Фактическое межосевое a, мм'}</label>
        <input id="pair-center-distance" type="number" className="select-control" min="0.000001" step="0.01" value={center} placeholder="Пусто — рассчитать по x" onChange={event => setCenter(event.target.value)} />
        <p className="field-help">Без введённого a расстояние рассчитывается по смещениям профиля до утонения зубьев. Введённое a имеет приоритет. Для рейки отсчёт идёт от исходной линии профиля, а не от нижней поверхности.</p>
        <button className="secondary-button" type="button" onClick={() => { setSecond(initialMate(params)); setCenter(''); }}>Восстановить начальные значения</button>
      </section>
      <section className="print-checks" aria-label="Результат проверки пары">
        <div className={`print-verdict ${report.status === 'unsupported' ? 'warning' : report.status}`} role="status" data-testid="pair-verdict">
          <strong>{verdicts[report.status]}</strong>
          <p>Это результат перечисленных ниже проверок моделей. Нагрузки, ресурс и погрешности изготовления в расчёт не входят.</p>
        </div>
        <dl className="dimension-list" data-testid="pair-dimensions">{metrics.map(({ key, label, unit }) => <div key={key}>
          <dt>{label}</dt><dd>{format(report.dimensions[key])}{report.dimensions[key] !== null && unit ? ` ${unit}` : ''}</dd>
        </div>)}</dl>
        {report.checks.map(check => <div className={`print-check ${check.status}`} key={check.id} data-check={check.id} data-status={check.status}>
          {check.status === 'pass' ? <Check size={18} /> : check.status === 'fail' ? <X size={18} /> : <AlertTriangle size={18} />}
          <div><strong>{check.label}</strong><p>{check.detail}</p></div>
        </div>)}
      </section>
    </div>
    <details className="advanced-settings" style={{ marginTop: 0 }}>
      <summary>Допущения и источники формул</summary>
      <ul style={{ paddingLeft: 20, marginTop: 12 }}>{report.assumptions.map(text => <li key={text}>{text}</li>)}</ul>
      <p className="field-help" style={{ marginTop: 12 }}>Червячные и циклоидальные пары этим модулем не проверяются.</p>
      <p style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>{report.sources.map(source => <a className="inline-link" key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</p>
    </details>
    <div className="dialog-action-row">
      <p>В отчёте сохраняются обе детали, режим выбора расстояния, результаты и допущения. «Не рассчитано» не заменяется нулём.</p>
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
