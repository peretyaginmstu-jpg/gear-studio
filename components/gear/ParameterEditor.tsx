"use client";
import { RotateCcw, SlidersHorizontal, ArrowUpRight } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { isHelicalKind, isInternalKind, isRackKind, modelNames, type ModelKind, type ModelParams } from '@/lib/model';

export function ParameterEditor({ params, onChange, onKind, onHand, onReset, onReference }: {
  params: ModelParams; onChange: (key: keyof ModelParams, value: number) => void;
  onKind: (kind: ModelKind) => void; onHand: (hand: 'left' | 'right') => void;
  onReset: () => void; onReference: () => void;
}) {
  const helical = isHelicalKind(params.kind), rack = isRackKind(params.kind), internal = isInternalKind(params.kind);
  const worm = params.kind === 'worm', cycloidal = params.kind === 'cycloidal', bevel = params.kind === 'bevel';
  return <div className="parameter-editor">
    <div className="editor-family"><label className="field-label" htmlFor="gear-kind">Тип зацепления</label>
      <Select value={params.kind} onValueChange={v => onKind(v as ModelKind)}><SelectTrigger id="gear-kind" className="select-control"><SelectValue /></SelectTrigger>
        <SelectContent>{Object.entries(modelNames).map(([kind, title]) => <SelectItem key={kind} value={kind}>{title}</SelectItem>)}</SelectContent></Select>
      <button className="family-help" onClick={onReference}>Область применения <ArrowUpRight size={14} /></button>
    </div>
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
        <div><label className="field-label" htmlFor="worm-hand">Направление витка</label><Select value={params.wormHand ?? 'right'} onValueChange={v => onHand(v as 'right' | 'left')}><SelectTrigger id="worm-hand" className="select-control"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="right">Правое</SelectItem><SelectItem value="left">Левое</SelectItem></SelectContent></Select></div></>}
      {cycloidal && <NumberField label="Производящий радиус" symbol="r, мм" value={params.cycloidRollingRadius ?? Math.min(2 * params.module, params.module * params.teeth / 4)} min={.001} max={params.module * params.teeth / 4} step={.1} onChange={v => onChange('cycloidRollingRadius', v)} />}
      {bevel && <><NumberField label="Зубьев партнёра" symbol="z₂" value={params.bevelMateTeeth ?? params.teeth} min={6} max={250} onChange={v => onChange('bevelMateTeeth', v)} />
        <NumberField label="Угол осей" symbol="Σ, °" value={params.bevelShaftAngleDeg ?? 90} min={1} max={179} onChange={v => onChange('bevelShaftAngleDeg', v)} /></>}
    </div>
    {helical && <p className="field-help">Знак β меняет направление винтовой линии.</p>}
    {cycloidal && <p className="field-help">Один радиус для эпициклоиды и гипоциклоиды; по умолчанию min(2m, R/2). ha = m, hf = 1,25m. Постоянный угол давления неприменим, x = 0.</p>}
    {bevel && <p className="field-help">Сферическая эвольвента; ha = mₑ, hf = 1,25mₑ. Впадина не ниже основного конуса; галтель и переходная поверхность не построены. Партнёр задаёт делительный конус, но контакт пары не рассчитан.</p>}
    <details className="advanced-settings"><summary><SlidersHorizontal size={16} /> Тонкая настройка</summary>
      <div className="input-grid"><NumberField label="Уменьшение толщины зуба" symbol="мм" value={params.backlash} min={0} step={.01} onChange={v => onChange('backlash', v)} />
        {!internal && !rack && !worm && !cycloidal && !bevel && <NumberField label="Радиус вершины рейки" symbol="ρ / mₙ" value={params.toolTipRadiusCoefficient ?? .3} min={.05} max={.5} step={.01} onChange={v => onChange('toolTipRadiusCoefficient', v)} />}
      </div>
      <p className="field-help">{worm ? 'Утонение в осевом сечении витка.' : cycloidal ? 'Утонение по делительной окружности одного колеса.' : bevel ? 'Утонение по внешней делительной окружности, уменьшается к малому торцу.' : 'Утонение в нормальном сечении одного колеса. Радиус инструмента по фото не определяется.'} Это не суммарный зазор пары.</p>
    </details>
    <button className="text-button reset-params" onClick={onReset}><RotateCcw size={15} /> Сбросить параметры</button>
  </div>;
}

function NumberField({ label, symbol, value, onChange, min, max, step = 1 }: {
  label: string; symbol: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return <label className="number-field">{label}<em>{symbol}</em><input aria-label={label} type="number" value={Number.isFinite(value) ? value : ''} min={min} max={max} step={step} onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))} /></label>;
}
