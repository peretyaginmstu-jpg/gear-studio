"use client";
import { useState } from 'react';
import { Check, AlertTriangle, ChevronDown, Link2 } from 'lucide-react';
import { isRackKind, isInternalKind, isHelicalKind, modelNames, type ModelParams } from '@/lib/model';
import type { BuiltModel } from '@/lib/journey';
import { PairDialog } from './PairDialog';
export const formatModelNumber = (n: number, digits = 2) => Number.isFinite(n) ? n.toLocaleString('ru-RU', { maximumFractionDigits: digits }) : '—';
const fmt = formatModelNumber;
export function ModelChips({ params }: { params: ModelParams }) {
  const isWorm = params.kind === 'worm', moduleSymbol = isWorm ? 'mₓ' : params.kind === 'bevel' ? 'mₑ' : isHelicalKind(params.kind) ? 'mₙ' : 'm';
  return (
          <div className="model-chips"><span className="model-family">{modelNames[params.kind]}</span>
            <span className="parameter-chip">{isWorm ? 'z₁' : 'z'} <strong>{fmt(isWorm ? params.wormStarts ?? 1 : params.teeth, 0)}</strong></span>
            <span className="parameter-chip">{moduleSymbol} <strong>{fmt(params.module)} мм</strong></span>
            <span className="parameter-chip">{isWorm ? 'L' : 'b'} <strong>{fmt(params.width)} мм</strong></span>
          </div>
  );
}
export function ModelSummary({ params }: { params: ModelParams }) {
  const isWorm = params.kind === 'worm', isBevel = params.kind === 'bevel', internal = isInternalKind(params.kind), rack = isRackKind(params.kind);
  const moduleSymbol = isWorm ? 'mₓ' : isBevel ? 'mₑ' : isHelicalKind(params.kind) ? 'mₙ' : 'm';
  return (
        <dl className="parameter-summary">
          <div><dt>Тип зацепления</dt><dd>{modelNames[params.kind]}</dd></div>
          <div><dt>{isWorm ? 'Число заходов' : 'Число зубьев'}</dt><dd>{isWorm ? 'z₁' : 'z'}&nbsp; {fmt(isWorm ? params.wormStarts ?? 1 : params.teeth, 0)}</dd></div>
          <div><dt>{isBevel ? 'Внешний модуль' : isWorm ? 'Осевой модуль' : isHelicalKind(params.kind) ? 'Нормальный модуль' : 'Модуль'}</dt><dd>{moduleSymbol}&nbsp; {fmt(params.module)} мм</dd></div>
          <div><dt>{isBevel ? 'По образующей' : isWorm ? 'Длина нарезки' : 'Ширина'}</dt><dd>{isWorm ? 'L' : 'b'}&nbsp; {fmt(params.width)} мм</dd></div>
          <div><dt>{internal ? 'Обод' : rack ? 'Основание' : 'Отверстие'}</dt><dd>{!internal && !rack && '⌀ '}{fmt(internal ? params.rimThickness ?? 3 * params.module : rack ? params.rackBaseHeight ?? 3 * params.module : params.bore)} мм</dd></div>
        </dl>
  );
}
export function ModelInspection({ model, onReference }: { model: BuiltModel; onReference: () => void }) {
  const [pairOpen, setPairOpen] = useState(false);
  const { mesh, validation, params, origin } = model, d = mesh.dimensions, error = null;
  const worm = 'wormDimensions' in mesh ? mesh.wormDimensions : null;
  const cycloidal = 'cycloidalDimensions' in mesh ? mesh.cycloidalDimensions : null, bevel = 'bevelDimensions' in mesh ? mesh.bevelDimensions : null;
  const rack = isRackKind(params.kind), isWorm = params.kind === 'worm', isBevel = params.kind === 'bevel';
  return <>
        <details className="engineering-details"><summary><span>{mesh ? <Check size={20} /> : <AlertTriangle size={20} />} Геометрия и проверка</span><span className="mesh-count">{validation ? `${fmt(validation.triangles, 0)} треугольников` : 'Требует уточнения'} <ChevronDown size={17} /></span></summary>
          <p className="origin-note">{origin}</p>
          {d ? <dl className="dimension-list"><Dimension label={rack ? 'Длина рейки' : isBevel ? 'Большой делительный диаметр' : 'Делительный диаметр'} value={rack ? d.rackLength : d.pitchDiameter} testId="pitch-diameter" />
            <Dimension label={rack ? 'Высота рейки' : isBevel ? 'Большой диаметр вершин' : 'Диаметр вершин'} value={rack ? d.rackHeight : d.tipDiameter} />
            {!rack && <Dimension label={isBevel ? 'Большой диаметр впадин' : 'Диаметр впадин'} value={d.rootDiameter} />}
            <Dimension label={isWorm ? 'Осевой шаг' : isBevel ? 'Внешний окружной шаг' : cycloidal ? 'Делительный шаг' : 'Торцевой шаг'} value={worm?.axialPitch ?? d.transverseCircularPitch} digits={3} />
            <Dimension label={isWorm ? 'Осевой размер вершины' : isBevel ? 'Хорда малой вершины' : cycloidal ? 'Дуга вершины' : 'Толщина вершины'} value={bevel?.innerTipChordThickness ?? worm?.axialTipThickness ?? d.tipThickness} digits={3} />
            {cycloidal && <><Dimension label="Производящий радиус" value={cycloidal.rollingRadius} /><div><dt>Постоянный угол α</dt><dd>Неприменим</dd></div></>}
            {worm && <><Dimension label="Ход витка" value={worm.lead} /><div><dt>Угол подъёма γ</dt><dd>{fmt(worm.leadAngleDeg)}°</dd></div></>}
            {bevel && <><div><dt>Делительный конус δ₁</dt><dd>{fmt(bevel.pitchConeAngleDeg)}°</dd></div><div><dt>Основной конус δᵦ</dt><dd>{fmt(bevel.baseConeAngleDeg)}°</dd></div><Dimension label="Конусное расстояние Rₑ" value={bevel.outerConeDistance} /><Dimension label="Малый модуль mᵢ" value={bevel.innerModule} digits={3} /><Dimension label="Высота по оси H" value={bevel.axialExtent} /></>}
            {['helical', 'herringbone', 'internal-helical', 'helical-rack'].includes(params.kind) && <Dimension label="Торцевой модуль" value={d.transverseModule} digits={3} />}
          </dl> : <p className="inline-error">{error}</p>}
          <div className="engineering-actions">
            <button className="secondary-button pair-button" onClick={() => setPairOpen(true)}><Link2 size={18} /> Проверить пару</button>
          </div>
          {mesh && <div className="calculation-details"><h3>Допущения модели</h3><ul>{mesh.warnings.map(w => <li className={w.severity} key={w.code}>{w.message}</li>)}</ul>
            {'cycloidalDiagnostics' in mesh && <p>Верхняя граница ошибки плоской хорды: {fmt(mesh.cycloidalDiagnostics.maxChordErrorBound, 5)} мм при допуске {fmt(mesh.cycloidalDiagnostics.profileTolerance, 4)} мм до Float32.</p>}
            {'bevelDiagnostics' in mesh && <p>Границы дискретизации до Float32: боковина {fmt(mesh.bevelDiagnostics.maxFlankChordErrorBound, 5)} мм; задний конус {fmt(mesh.bevelDiagnostics.maxEndCapErrorBound, 5)} мм при допуске {fmt(mesh.bevelDiagnostics.profileTolerance, 4)} мм.</p>}
            {mesh.profile.rootDiagnostics && <p>Выборочная ошибка хорды профиля: {fmt(mesh.profile.rootDiagnostics.maxSampledChordError, 5)} мм при заданном {fmt(mesh.profile.rootDiagnostics.profileTolerance, 3)} мм. Это не класс точности детали.</p>}
            <button className="inline-link" onClick={onReference}>Подробнее о методе</button>
          </div>}
        </details>
    <PairDialog open={pairOpen} onOpenChange={setPairOpen} params={params} />
  </>;
}
function Dimension({ label, value, digits = 2, testId }: { label: string; value: number; digits?: number; testId?: string }) {
  return <div><dt>{label}</dt><dd data-testid={testId}>{fmt(value, digits)} мм</dd></div>;
}
