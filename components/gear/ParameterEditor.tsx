"use client";
import { useState, type ReactNode } from 'react';
import { RotateCcw, ArrowUpRight } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { isHelicalKind, isInternalKind, isRackKind, modelNames, type ModelKind, type ModelParams } from '@/lib/model';
import { useActivePopup } from './useActivePopup';
import { InternalCutterFields } from './InternalCutterFields';
import { standardKeyway } from '@/lib/keyway';

/** Only what defines the part; everything optional lives in the tool tray as pop-up panels. */
export function ParameterEditor({ active = true, params, onChange, onKind, onHand, onReference }: {
  active?: boolean; params: ModelParams; onChange: (key: keyof ModelParams, value: number) => void;
  onKind: (kind: ModelKind) => void; onHand: (hand: 'left' | 'right') => void; onReference: () => void;
}) {
  const helical = isHelicalKind(params.kind), rack = isRackKind(params.kind), internal = isInternalKind(params.kind);
  const worm = params.kind === 'worm', cycloidal = params.kind === 'cycloidal', bevel = params.kind === 'bevel';
  const [pitchUnit, setPitchUnit] = useState<'module' | 'dp'>(() => Number.isFinite(params.module) && isWholeDp(params.module) && !isMetricModule(params.module) ? 'dp' : 'module');
  const familyPopup = useActivePopup(active), handPopup = useActivePopup(active && worm);
  const kindNote = params.kind === 'internal-helical' ? 'Торцевая эвольвента до окружности впадин, без переходной поверхности косозубого долбяка.'
    : cycloidal ? 'Один производящий радиус для эпи- и гипоциклоиды; ha = m, hf = 1,25m, x = 0.'
    : bevel ? 'Сферическая эвольвента; партнёр задаёт делительный конус, контакт пары не рассчитан.' : null;
  const dpToggle = !worm && !cycloidal && !bevel && <span className="unit-toggle" role="group" aria-label="Система шага">
    <button type="button" aria-pressed={pitchUnit === 'module'} onClick={() => setPitchUnit('module')}>мм</button>
    <button type="button" aria-pressed={pitchUnit === 'dp'} onClick={() => setPitchUnit('dp')}>DP</button></span>;
  return <div className="parameter-editor">
    <div className="editor-family"><label className="field-label" htmlFor="gear-kind">Тип зацепления</label>
      <Select {...familyPopup} value={params.kind} onValueChange={v => onKind(v as ModelKind)}><SelectTrigger id="gear-kind" className="select-control"><SelectValue /></SelectTrigger>
        <SelectContent>{Object.entries(modelNames).map(([kind, title]) => <SelectItem key={kind} value={kind}>{title}</SelectItem>)}</SelectContent></Select>
      <button className="family-help" onClick={onReference}>Область применения <ArrowUpRight size={14} /></button>
      {kindNote && <p className="field-help kind-note">{kindNote}</p>}
    </div>
    <div className="input-grid editor-fields">
      {worm ? <NumberField label="Число заходов" symbol="z₁" value={params.wormStarts ?? 1} min={1} max={8} onChange={v => onChange('wormStarts', v)} />
        : <NumberField label="Число зубьев" symbol="z" value={params.teeth} min={rack ? 1 : 6} max={250} onChange={v => onChange('teeth', v)} />}
      {pitchUnit === 'dp' ? <NumberField label={helical ? 'Нормальный diametral pitch' : 'Diametral pitch'} symbol={helical ? 'Pₙ, 1/дюйм' : 'P, 1/дюйм'} extra={dpToggle} value={Math.round(25.4 / params.module * 1e6) / 1e6} min={.85} max={254} step={1} onChange={v => onChange('module', Number.isFinite(v) && v > 0 ? 25.4 / v : NaN)} />
        : <NumberField label={worm ? 'Осевой модуль' : bevel ? 'Внешний модуль' : cycloidal ? 'Делительный модуль' : helical ? 'Нормальный модуль' : 'Модуль'} symbol={worm ? 'mₓ, мм' : bevel ? 'mₑ, мм' : helical ? 'mₙ, мм' : 'm, мм'} extra={dpToggle} value={params.module} min={.1} max={30} step={.1} onChange={v => onChange('module', v)} />}
      <NumberField label={worm ? 'Длина нарезки' : bevel ? 'По образующей' : 'Ширина'} symbol={worm ? 'L, мм' : 'b, мм'} value={params.width} min={.1} max={500} step={.5} onChange={v => onChange('width', v)} />
      {!rack && !internal ? <NumberField label="Отверстие" symbol="⌀, мм" value={params.bore} min={0} step={.1} onChange={v => onChange('bore', v)} />
        : internal ? <NumberField label="Обод" symbol="мм" value={params.rimThickness ?? 3 * params.module} min={.1} step={.5} onChange={v => onChange('rimThickness', v)} />
          : <NumberField label="Основание" symbol="мм" value={params.rackBaseHeight ?? 3 * params.module} min={.1} step={.5} onChange={v => onChange('rackBaseHeight', v)} />}
      {!cycloidal && <NumberField label={worm ? 'Осевой угол' : 'Угол профиля'} symbol={worm ? 'αₓ, °' : helical ? 'αₙ, °' : 'α, °'} value={params.pressureAngleDeg} min={10} max={35} step={.5} onChange={v => onChange('pressureAngleDeg', v)} />}
      {!worm && !cycloidal && !bevel && <NumberField label="Смещение" symbol="x" value={params.profileShift} min={-.8} max={1} step={.05} onChange={v => onChange('profileShift', v)} />}
      {helical && <NumberField label="Угол наклона зуба" symbol="β, ° (знак — направление)" value={params.helixAngleDeg} min={-45} max={45} onChange={v => onChange('helixAngleDeg', v)} />}
      {worm && <><NumberField label="Коэффициент диаметра" symbol="q" value={params.wormDiameterFactor ?? 10} min={2.51} max={100} step={.5} onChange={v => onChange('wormDiameterFactor', v)} />
        <div><label className="field-label" htmlFor="worm-hand">Направление витка</label><Select {...handPopup} value={params.wormHand ?? 'right'} onValueChange={v => onHand(v as 'right' | 'left')}><SelectTrigger id="worm-hand" className="select-control"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="right">Правое</SelectItem><SelectItem value="left">Левое</SelectItem></SelectContent></Select></div></>}
      {cycloidal && <NumberField label="Производящий радиус" symbol="r, мм" value={params.cycloidRollingRadius ?? Math.min(2 * params.module, params.module * params.teeth / 4)} min={.001} max={params.module * params.teeth / 4} step={.1} onChange={v => onChange('cycloidRollingRadius', v)} />}
      {bevel && <><NumberField label="Зубьев партнёра" symbol="z₂" value={params.bevelMateTeeth ?? params.teeth} min={6} max={250} onChange={v => onChange('bevelMateTeeth', v)} />
        <NumberField label="Угол осей" symbol="Σ, °" value={params.bevelShaftAngleDeg ?? 90} min={1} max={179} onChange={v => onChange('bevelShaftAngleDeg', v)} /></>}
    </div>
    {pitchUnit === 'dp' && <p className="field-help">m = 25,4 / P = {Number.isFinite(params.module) ? params.module.toLocaleString('ru-RU', { maximumFractionDigits: 5 }) : '—'} мм. У старых дюймовых колёс часто α = 14,5°.</p>}
  </div>;
}

/** Pop-up panel: tooth thinning, basic rack, tool radius, internal cutter and reset. */
export function FineTuningPanel({ params, onChange, onReset }: { params: ModelParams; onChange: (key: keyof ModelParams, value: number) => void; onReset: () => void }) {
  const rack = isRackKind(params.kind), internal = isInternalKind(params.kind);
  const worm = params.kind === 'worm', cycloidal = params.kind === 'cycloidal', bevel = params.kind === 'bevel', cylindrical = !worm && !cycloidal && !bevel;
  return <div className="tool-panel">
    <div className="input-grid"><NumberField label="Уменьшение толщины зуба" symbol="мм" value={params.backlash} min={0} step={.01} onChange={v => onChange('backlash', v)} />
      {cylindrical && <NumberField label="Высота головки" symbol="ha*" value={params.addendumCoefficient ?? 1} min={.5} max={1.5} step={.05} onChange={v => onChange('addendumCoefficient', v)} />}
      {cylindrical && params.kind !== 'internal' && <NumberField label="Радиальный зазор" symbol="c*" value={params.clearanceCoefficient ?? .25} min={.05} max={.6} step={.05} onChange={v => onChange('clearanceCoefficient', v)} />}
      {!internal && !rack && cylindrical && <NumberField label="Радиус вершины рейки" symbol="ρ / mₙ" value={params.toolTipRadiusCoefficient ?? .3} min={.05} max={.5} step={.01} onChange={v => onChange('toolTipRadiusCoefficient', v)} />}
    </div>
    <p className="field-help">{worm ? 'Утонение в осевом сечении витка.' : cycloidal ? 'Утонение по делительной окружности одного колеса.' : bevel ? 'Утонение по внешней делительной окружности, уменьшается к малому торцу.' : 'Утонение в нормальном сечении одного колеса.'} Это не суммарный зазор пары.{cylindrical && ' Стандарт: ha* = 1, c* = 0,25; укороченный зуб — ha* = 0,8.'}</p>
    {params.kind === 'internal' && <InternalCutterFields params={params} onChange={onChange} />}
    <button className="text-button reset-params" onClick={onReset}><RotateCcw size={15} /> Сбросить все параметры</button>
  </div>;
}

export const fineTuningBadge = (p: ModelParams): string | null => {
  const parts = [(p.addendumCoefficient ?? 1) !== 1 && `ha* ${p.addendumCoefficient}`, (p.clearanceCoefficient ?? .25) !== .25 && `c* ${p.clearanceCoefficient}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
};
export const bodyFeaturesBadge = (p: ModelParams): string | null => {
  const parts = [(p.keywayWidth ?? 0) > 0 && `паз ${p.keywayWidth}×${p.keywayDepth}`, (p.hubLength ?? 0) > 0 && `ступица ⌀${p.hubDiameter}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
};
export const bodyFeatureKinds: readonly string[] = ['spur', 'helical', 'herringbone'];

const metricModules = [.1, .12, .15, .2, .25, .3, .4, .5, .6, .7, .8, .9, 1, 1.125, 1.25, 1.375, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 25, 28];
const isMetricModule = (m: number) => metricModules.some(v => Math.abs(v - m) < 1e-9);
/** Integer diametral pitch within display precision, e.g. 25.4/24 = 1.058333 mm. */
const isWholeDp = (m: number) => { const P = 25.4 / m; return P >= 1 && Math.abs(P - Math.round(P)) < 1e-5 && !isMetricModule(m); };

/** Pop-up panel: parallel-key slot and one-sided hub. */
export function BodyFeaturesPanel({ params, onChange, onPatch }: { params: ModelParams; onChange: (key: keyof ModelParams, value: number) => void; onPatch: (patch: Partial<ModelParams>) => void }) {
  const optional = (key: keyof ModelParams) => (v: number) => onChange(key, Number.isFinite(v) ? v : 0);
  const suggested = params.bore > 0 ? standardKeyway(params.bore) : null;
  return <div className="tool-panel">
    <div className="input-grid">
      <NumberField label="Ширина паза" symbol="b, мм" value={params.keywayWidth ?? 0} min={0} step={.5} onChange={optional('keywayWidth')} />
      <NumberField label="Глубина паза" symbol="t₂, мм" value={params.keywayDepth ?? 0} min={0} step={.1} onChange={optional('keywayDepth')} />
      <NumberField label="Диаметр ступицы" symbol="D, мм" value={params.hubDiameter ?? 0} min={0} step={.5} onChange={optional('hubDiameter')} />
      <NumberField label="Длина ступицы" symbol="L, мм" value={params.hubLength ?? 0} min={0} step={.5} onChange={optional('hubLength')} />
    </div>
    {suggested && <button type="button" className="secondary-button" onClick={() => onPatch({ keywayWidth: suggested.width, keywayDepth: suggested.depth })}>
      Паз по ГОСТ 23360 для ⌀{params.bore}: {suggested.width} × {suggested.depth} мм</button>}
    <p className="field-help">0 — элемента нет. t₂ — от поверхности отверстия по оси паза. Ступица выступает с одной стороны венца. Углы паза острые.</p>
  </div>;
}

function NumberField({ label, symbol, value, onChange, min, max, step = 1, extra }: {
  label: string; symbol: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; extra?: ReactNode;
}) {
  // Buttons inside a <label> would take over its labelling, so a field with extra controls uses a plain wrapper.
  const input = <input aria-label={label} type="number" value={Number.isFinite(value) ? value : ''} min={min} max={max} step={step} onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />;
  return extra ? <div className="number-field">{label}{extra}<em>{symbol}</em>{input}</div> : <label className="number-field">{label}<em>{symbol}</em>{input}</label>;
}
