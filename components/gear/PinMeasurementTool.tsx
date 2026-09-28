"use client";
import { useMemo, useState } from 'react';
import { CircleDot } from 'lucide-react';
import { gearKernelParams, type ModelParams } from '@/lib/model';
import { inversePinMeasurement, pinMeasurement, pinMeasurementKinds, recommendedPinDiameter } from '@/lib/pinMeasurement';

const fmt = (v: number, digits = 3) => Number.isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: digits }) : '—';
const parse = (v: string) => v.trim() === '' ? NaN : Number(v.replace(',', '.'));
const attempt = <T,>(fn: () => T): T | Error => { try { return fn(); } catch (e) { return e instanceof Error ? e : new Error(String(e)); } };

/** Control size over pins for the current parameters and, from a reading, the tooth thickness it implies. */
export function PinMeasurementTool({ params, onApplyShift }: { params: ModelParams; onApplyShift?: (profileShift: number) => void }) {
  const [pin, setPin] = useState(''), [measured, setMeasured] = useState('');
  const gear = useMemo(() => pinMeasurementKinds.includes(params.kind) ? gearKernelParams(params) : null, [params]);
  const recommended = useMemo(() => gear ? attempt(() => recommendedPinDiameter(gear)) : null, [gear]);
  const dp = pin === '' && recommended && !(recommended instanceof Error) ? Math.round(recommended * 100) / 100 : parse(pin);
  const forward = useMemo(() => gear && Number.isFinite(dp) ? attempt(() => pinMeasurement(gear, dp)) : null, [gear, dp]);
  const inverse = useMemo(() => gear && Number.isFinite(dp) && Number.isFinite(parse(measured)) ? attempt(() => inversePinMeasurement(gear, dp, parse(measured))) : null, [gear, dp, measured]);
  if (!gear) return null;
  const internal = params.kind === 'internal' || params.kind === 'internal-helical', ball = params.kind !== 'spur' && params.kind !== 'internal';
  return <details className="advanced-settings pin-tool"><summary><CircleDot size={16} /> Размер по {ball ? 'шарикам' : 'роликам'} (M)</summary>
    <p className="field-help">Два {ball ? 'шарика' : 'ролика'} во {internal ? 'впадинах внутреннего венца; M — расстояние между ними' : 'впадинах напротив друг друга; M — размер через них микрометром'}. Размер учитывает смещение и утонение зуба.</p>
    <div className="input-grid">
      <label className="number-field">Диаметр {ball ? 'шарика' : 'ролика'}<em>dp, мм</em><input aria-label="Диаметр ролика" inputMode="decimal" value={pin} placeholder={Number.isFinite(dp) ? String(dp) : ''} onChange={e => setPin(e.target.value)} /></label>
      <label className="number-field">Измеренный размер<em>M, мм</em><input aria-label="Измеренный размер по роликам" inputMode="decimal" value={measured} onChange={e => setMeasured(e.target.value)} /></label>
    </div>
    {recommended && !(recommended instanceof Error) && <p className="field-help">Рекомендуемый dp ≈ {fmt(recommended)} мм: касание у делительной окружности, {ball ? 'шарики' : 'ролики'} выступают за вершины. Возьмите ближайший имеющийся и введите его.</p>}
    {forward instanceof Error ? <p className="inline-error">{forward.message}</p> : forward && <dl className="dimension-list pin-result">
      <div><dt>Расчётный M при текущих параметрах</dt><dd data-testid="pin-measurement">{fmt(forward.measurementMm, 4)} мм</dd></div>
      <div><dt>Окружность центров</dt><dd>⌀ {fmt(forward.centreDiameterMm)} мм</dd></div>
      {forward.contactDiameterMm !== null && <div><dt>Диаметр точки касания</dt><dd>⌀ {fmt(forward.contactDiameterMm)} мм</dd></div>}
      {forward.oddTeeth && <div><dt>Нечётное z</dt><dd>M по хорде cos(90°/z)</dd></div>}
    </dl>}
    {forward && !(forward instanceof Error) && forward.issues.length > 0 && <ul className="field-help pin-issues">{forward.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    {inverse instanceof Error ? <p className="inline-error">{inverse.message}</p> : inverse && <div className="pin-inverse" role="status">
      <p>По измерению толщина зуба sₙ = {fmt(inverse.normalToothThicknessMm)} мм. Это соответствует смещению x = {fmt(inverse.equivalentProfileShift)} без утонения или утонению {fmt(inverse.thinningAtCurrentShiftMm)} мм при текущем x = {fmt(params.profileShift)}.</p>
      <p className="field-help">Один размер M не разделяет смещение и утонение. Для выбора сверьте диаметр вершин или чертёж.</p>
      {onApplyShift && inverse.equivalentProfileShift >= -.8 && inverse.equivalentProfileShift <= 1 && <button type="button" className="secondary-button full" onClick={() => onApplyShift(Math.round(inverse.equivalentProfileShift * 1e4) / 1e4)}>Применить x = {fmt(inverse.equivalentProfileShift, 4)} и утонение 0</button>}
    </div>}
  </details>;
}
