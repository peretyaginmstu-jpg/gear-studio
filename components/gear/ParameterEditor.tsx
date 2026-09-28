"use client";
import type { ReactNode } from 'react';
import { RotateCcw, SlidersHorizontal, ArrowUpRight } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { isHelicalKind, isInternalKind, isRackKind, modelNames, type ModelKind, type ModelParams } from '@/lib/model';
import { useActivePopup } from './useActivePopup';
import { InternalCutterFields } from './InternalCutterFields';
import { MeasurementGuide } from './MeasurementGuide';
import { standardKeyway } from '@/lib/keyway';

export function ParameterEditor({ active = true, params, onChange, onPatch, onKind, onHand, onReset, onReference, familyAssistant }: {
  active?: boolean; params: ModelParams; onChange: (key: keyof ModelParams, value: number) => void;
  /** Several fields in one edit; sequential onChange calls would each start from the same stale draft. */
  onPatch: (patch: Partial<ModelParams>) => void;
  onKind: (kind: ModelKind) => void; onHand: (hand: 'left' | 'right') => void;
  onReset: () => void; onReference: () => void;
  familyAssistant?: ReactNode;
}) {
  const helical = isHelicalKind(params.kind), rack = isRackKind(params.kind), internal = isInternalKind(params.kind);
  const worm = params.kind === 'worm', cycloidal = params.kind === 'cycloidal', bevel = params.kind === 'bevel';
  const bodyFeatures = ['spur', 'helical', 'herringbone'].includes(params.kind), cylindrical = !worm && !cycloidal && !bevel;
  const familyPopup = useActivePopup(active), handPopup = useActivePopup(active && worm);
  return <div className="parameter-editor">
    <div className="editor-family"><label className="field-label" htmlFor="gear-kind">Тип зацепления</label>
      <Select {...familyPopup} value={params.kind} onValueChange={v => onKind(v as ModelKind)}><SelectTrigger id="gear-kind" className="select-control"><SelectValue /></SelectTrigger>
        <SelectContent>{Object.entries(modelNames).map(([kind, title]) => <SelectItem key={kind} value={kind}>{title}</SelectItem>)}</SelectContent></Select>
      <button className="family-help" onClick={onReference}>Область применения <ArrowUpRight size={14} /></button>
    </div>
    {familyAssistant}
    <MeasurementGuide active={active} kind={params.kind} teeth={params.teeth} initialTopic="module" label="Как измерить вашу деталь" hint="Модуль, зубья и размеры тела — на схемах" />
    <div className="input-grid editor-fields">
      {worm ? <NumberField label="Число заходов" symbol="z₁" value={params.wormStarts ?? 1} min={1} max={8} onChange={v => onChange('wormStarts', v)} />
        : <NumberField label="Число зубьев" symbol="z" value={params.teeth} min={rack ? 1 : 6} max={250} onChange={v => onChange('teeth', v)} />}
      <NumberField label={worm ? 'Осевой модуль' : bevel ? 'Внешний модуль' : cycloidal ? 'Делительный модуль' : helical ? 'Нормальный модуль' : 'Модуль'} symbol={worm ? 'mₓ, мм' : bevel ? 'mₑ, мм' : helical ? 'mₙ, мм' : 'm, мм'} value={params.module} min={.1} max={30} step={.1} onChange={v => onChange('module', v)} />
      <NumberField label={worm ? 'Длина нарезки' : bevel ? 'По образующей' : 'Ширина'} symbol={worm ? 'L, мм' : 'b, мм'} value={params.width} min={.1} max={500} step={.5} onChange={v => onChange('width', v)} />
      {!rack && !internal ? <NumberField label="Отверстие" symbol="⌀, мм" value={params.bore} min={0} step={.1} onChange={v => onChange('bore', v)} />
        : internal ? <NumberField label="Обод" symbol="мм" value={params.rimThickness ?? 3 * params.module} min={.1} step={.5} onChange={v => onChange('rimThickness', v)} />
          : <NumberField label="Основание" symbol="мм" value={params.rackBaseHeight ?? 3 * params.module} min={.1} step={.5} onChange={v => onChange('rackBaseHeight', v)} />}
      {!cycloidal && <NumberField label={worm ? 'Осевой угол' : 'Угол профиля'} symbol={worm ? 'αₓ, °' : helical ? 'αₙ, °' : 'α, °'} value={params.pressureAngleDeg} min={10} max={35} step={.5} onChange={v => onChange('pressureAngleDeg', v)} />}
      {!worm && !cycloidal && !bevel && <NumberField label="Смещение" symbol="x" value={params.profileShift} min={-.8} max={1} step={.05} onChange={v => onChange('profileShift', v)} />}
      {helical && <NumberField label="Угол наклона зуба" symbol="β, °" value={params.helixAngleDeg} min={-45} max={45} onChange={v => onChange('helixAngleDeg', v)} />}
      {worm && <><NumberField label="Коэффициент диаметра" symbol="q" value={params.wormDiameterFactor ?? 10} min={2.51} max={100} step={.5} onChange={v => onChange('wormDiameterFactor', v)} />
        <div><label className="field-label" htmlFor="worm-hand">Направление витка</label><Select {...handPopup} value={params.wormHand ?? 'right'} onValueChange={v => onHand(v as 'right' | 'left')}><SelectTrigger id="worm-hand" className="select-control"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="right">Правое</SelectItem><SelectItem value="left">Левое</SelectItem></SelectContent></Select></div></>}
      {cycloidal && <NumberField label="Производящий радиус" symbol="r, мм" value={params.cycloidRollingRadius ?? Math.min(2 * params.module, params.module * params.teeth / 4)} min={.001} max={params.module * params.teeth / 4} step={.1} onChange={v => onChange('cycloidRollingRadius', v)} />}
      {bevel && <><NumberField label="Зубьев партнёра" symbol="z₂" value={params.bevelMateTeeth ?? params.teeth} min={6} max={250} onChange={v => onChange('bevelMateTeeth', v)} />
        <NumberField label="Угол осей" symbol="Σ, °" value={params.bevelShaftAngleDeg ?? 90} min={1} max={179} onChange={v => onChange('bevelShaftAngleDeg', v)} /></>}
    </div>
    {helical && <p className="field-help">Знак β меняет направление винтовой линии.</p>}
    {bodyFeatures && <BodyFeatures params={params} onChange={onChange} onPatch={onPatch} />}
    {params.kind === 'internal' && <InternalCutterFields params={params} onChange={onChange} />}
    {params.kind === 'internal-helical' && <p className="field-help">Отдельный режим: торцевая эвольвента до окружности впадин без переходной поверхности косозубого долбяка. Плоская огибающая прямозубого инструмента здесь не используется.</p>}
    {cycloidal && <p className="field-help">Один радиус для эпициклоиды и гипоциклоиды; по умолчанию min(2m, R/2). ha = m, hf = 1,25m. Постоянный угол давления неприменим, x = 0.</p>}
    {bevel && <p className="field-help">Сферическая эвольвента; ha = mₑ, hf = 1,25mₑ. Впадина не ниже основного конуса; галтель и переходная поверхность не построены. Партнёр задаёт делительный конус, но контакт пары не рассчитан.</p>}
    <details className="advanced-settings"><summary><SlidersHorizontal size={16} /> Тонкая настройка</summary>
      <div className="input-grid"><NumberField label="Уменьшение толщины зуба" symbol="мм" value={params.backlash} min={0} step={.01} onChange={v => onChange('backlash', v)} />
        {cylindrical && <NumberField label="Высота головки" symbol="ha*" value={params.addendumCoefficient ?? 1} min={.5} max={1.5} step={.05} onChange={v => onChange('addendumCoefficient', v)} />}
        {cylindrical && params.kind !== 'internal' && <NumberField label="Радиальный зазор" symbol="c*" value={params.clearanceCoefficient ?? .25} min={.05} max={.6} step={.05} onChange={v => onChange('clearanceCoefficient', v)} />}
        {!internal && !rack && !worm && !cycloidal && !bevel && <NumberField label="Радиус вершины рейки" symbol="ρ / mₙ" value={params.toolTipRadiusCoefficient ?? .3} min={.05} max={.5} step={.01} onChange={v => onChange('toolTipRadiusCoefficient', v)} />}
      </div>
      <p className="field-help">{worm ? 'Утонение в осевом сечении витка.' : cycloidal ? 'Утонение по делительной окружности одного колеса.' : bevel ? 'Утонение по внешней делительной окружности, уменьшается к малому торцу.' : 'Утонение в нормальном сечении одного колеса. Радиус инструмента по фото не определяется.'} Это не суммарный зазор пары.{cylindrical && ' Стандартный исходный контур: ha* = 1, c* = 0,25; укороченный зуб — обычно ha* = 0,8.'}</p>
    </details>
    <button className="text-button reset-params" onClick={onReset}><RotateCcw size={15} /> Сбросить параметры</button>
  </div>;
}

function BodyFeatures({ params, onChange, onPatch }: { params: ModelParams; onChange: (key: keyof ModelParams, value: number) => void; onPatch: (patch: Partial<ModelParams>) => void }) {
  const optional = (key: keyof ModelParams) => (v: number) => onChange(key, Number.isFinite(v) ? v : 0);
  const suggested = params.bore > 0 ? standardKeyway(params.bore) : null;
  const keyway = (params.keywayWidth ?? 0) > 0 || (params.keywayDepth ?? 0) > 0, hub = (params.hubDiameter ?? 0) > 0 || (params.hubLength ?? 0) > 0;
  return <details className="advanced-settings body-features" open={keyway || hub}><summary><SlidersHorizontal size={16} /> Шпоночный паз и ступица</summary>
    <div className="input-grid">
      <NumberField label="Ширина паза" symbol="b, мм" value={params.keywayWidth ?? 0} min={0} step={.5} onChange={optional('keywayWidth')} />
      <NumberField label="Глубина паза" symbol="t₂, мм" value={params.keywayDepth ?? 0} min={0} step={.1} onChange={optional('keywayDepth')} />
      <NumberField label="Диаметр ступицы" symbol="D, мм" value={params.hubDiameter ?? 0} min={0} step={.5} onChange={optional('hubDiameter')} />
      <NumberField label="Длина ступицы" symbol="L, мм" value={params.hubLength ?? 0} min={0} step={.5} onChange={optional('hubLength')} />
    </div>
    {suggested && <button type="button" className="text-button" onClick={() => onPatch({ keywayWidth: suggested.width, keywayDepth: suggested.depth })}>
      Паз по ГОСТ 23360 для ⌀{params.bore}: {suggested.width} × {suggested.depth} мм</button>}
    <p className="field-help">0 — элемента нет. t₂ отсчитывается от поверхности отверстия по оси паза. Ступица выступает с одной стороны венца. Углы паза острые; допуски и скругления задайте в требованиях мастерской.</p>
  </details>;
}

function NumberField({ label, symbol, value, onChange, min, max, step = 1 }: {
  label: string; symbol: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return <label className="number-field">{label}<em>{symbol}</em><input aria-label={label} type="number" value={Number.isFinite(value) ? value : ''} min={min} max={max} step={step} onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))} /></label>;
}
