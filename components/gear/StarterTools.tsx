"use client";
import { useContext, useMemo, useState } from 'react';
import { ProjectContext } from './ProjectContext';
import { gearTemplates } from '@/lib/templates';
import { synthesizePairs, type PairCandidate } from '@/lib/pairSynthesis';
import type { ModelParams } from '@/lib/model';

const fmt = (v: number, d = 3) => v.toLocaleString('ru-RU', { maximumFractionDigits: d });
const parse = (v: string) => v.trim() === '' ? NaN : Number(v.replace(',', '.'));

/** Generic starting points; picking one replaces the draft. */
export function TemplatePicker({ onApply }: { onApply: (params: ModelParams) => void }) {
  return <div className="template-list">
    {gearTemplates.map(t => <button key={t.id} type="button" className="template-item" onClick={() => onApply(structuredClone(t.params))}>
      <strong>{t.title}</strong><span>{t.hint}</span></button>)}
    <p className="field-help">Типовые заготовки, не каталожные детали производителей. Сверьте значения с образцом.</p>
  </div>;
}

/** Pair designed from ratio and centre distance: pinion to the editor, wheel to the pair check. */
export function PairSynthesisPanel({ onApply }: { onApply: (params: ModelParams) => void }) {
  const store = useContext(ProjectContext);
  const [form, setForm] = useState({ ratio: '3', center: '60', alpha: '20', beta: '0', tol: '2' });
  const [result, setResult] = useState<PairCandidate[] | Error | null>(null);
  const run = () => {
    try { setResult(synthesizePairs({ ratio: parse(form.ratio), centerDistanceMm: parse(form.center), pressureAngleDeg: parse(form.alpha),
      helixAngleDeg: parse(form.beta) || 0, ratioTolerance: parse(form.tol) / 100, maxCandidates: 8 })); }
    catch (e) { setResult(e instanceof Error ? e : new Error('Не удалось подобрать пару.')); }
  };
  const apply = (c: PairCandidate) => {
    // Pair dialog state is keyed by the first gear's parameters; the wheel waits there for the check.
    const identity = JSON.stringify(c.gears[0]);
    store?.put('pair', identity, 'second', c.gears[1]);
    store?.put('pair', identity, 'center', String(parse(form.center)));
    onApply(c.gears[0]);
  };
  const field = (key: keyof typeof form, label: string, symbol: string) => <label className="number-field">{label}<em>{symbol}</em>
    <input aria-label={label} inputMode="decimal" value={form[key]} onChange={e => { setForm({ ...form, [key]: e.target.value }); setResult(null); }} /></label>;
  const list = useMemo(() => result instanceof Error ? null : result, [result]);
  return <div className="tool-panel pair-synthesis">
    <div className="input-grid">
      {field('ratio', 'Передаточное число', 'u = z₂/z₁')}{field('center', 'Межосевое расстояние', 'a, мм')}
      {field('alpha', 'Угол профиля', 'α, °')}{field('beta', 'Угол наклона', 'β, °')}{field('tol', 'Допуск на u', '%')}
    </div>
    <button type="button" className="primary-button full" onClick={run}>Подобрать</button>
    {result instanceof Error && <p className="inline-error" role="alert">{result.message}</p>}
    {list && !list.length && <p className="field-help" role="status">Подходящих пар нет: увеличьте допуск на передаточное число или измените межосевое.</p>}
    {list && list.length > 0 && <table className="pair-candidates"><thead><tr><th>m, мм</th><th>z₁ / z₂</th><th>u</th><th>x₁ / x₂</th><th>αw</th><th>εα</th><th /></tr></thead>
      <tbody>{list.map(c => <tr key={`${c.module}-${c.teeth.join('-')}`}>
        <td>{fmt(c.module)}{c.series === 2 && <small> (2-й ряд)</small>}</td><td>{c.teeth[0]} / {c.teeth[1]}</td>
        <td>{fmt(c.ratio, 3)}{c.ratioErrorPct > .005 && <small> ({fmt(c.ratioErrorPct, 2)}%)</small>}</td>
        <td>{fmt(c.profileShift[0], 3)} / {fmt(c.profileShift[1], 3)}</td><td>{fmt(c.workingPressureAngleDeg, 2)}°</td>
        <td>{c.report.dimensions.transverseContactRatio != null ? fmt(c.report.dimensions.transverseContactRatio, 2) : '—'}{c.report.status === 'warning' && ' ⚠'}</td>
        <td><button type="button" className="secondary-button" onClick={() => apply(c)}>Взять</button></td></tr>)}</tbody></table>}
    {list && list.length > 0 && <p className="field-help">«Взять»: шестерня z₁ — в редактор, колесо z₂ и межосевое — в «Проверить пару» после построения.</p>}
  </div>;
}
