"use client";
import { useContext, useMemo, useState } from 'react';
import { LayoutTemplate, Link2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ProjectContext } from './ProjectContext';
import { gearTemplates } from '@/lib/templates';
import { synthesizePairs, type PairCandidate } from '@/lib/pairSynthesis';
import type { ModelParams } from '@/lib/model';

const fmt = (v: number, d = 3) => v.toLocaleString('ru-RU', { maximumFractionDigits: d });
const parse = (v: string) => v.trim() === '' ? NaN : Number(v.replace(',', '.'));

/** Starting points for the manual branch: a generic template or a pair designed from ratio and centre distance. */
export function StarterTools({ onApply }: { onApply: (params: ModelParams) => void }) {
  const store = useContext(ProjectContext);
  const [pairOpen, setPairOpen] = useState(false);
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
    onApply(c.gears[0]); setPairOpen(false);
  };
  const field = (key: keyof typeof form, label: string, symbol: string) => <label className="number-field">{label}<em>{symbol}</em>
    <input aria-label={label} inputMode="decimal" value={form[key]} onChange={e => { setForm({ ...form, [key]: e.target.value }); setResult(null); }} /></label>;
  const list = useMemo(() => result instanceof Error ? null : result, [result]);
  return <div className="starter-tools">
    <label className="field-label" htmlFor="gear-template"><LayoutTemplate size={15} /> Начать с шаблона</label>
    <select id="gear-template" className="select-control native" value="" onChange={e => { const t = gearTemplates.find(x => x.id === e.target.value); if (t) onApply(structuredClone(t.params)); }}>
      <option value="">Выберите типовую деталь…</option>
      {gearTemplates.map(t => <option key={t.id} value={t.id}>{t.title} — {t.hint}</option>)}
    </select>
    <p className="field-help">Шаблоны — типовые заготовки, не каталожные детали производителей. Сверьте значения с образцом.</p>
    <button type="button" className="text-button" onClick={() => setPairOpen(true)}><Link2 size={15} /> Подобрать пару по передаточному числу и межосевому</button>
    <Dialog open={pairOpen} onOpenChange={setPairOpen}>
      <DialogContent className="engineering-dialog pair-synthesis">
        <DialogHeader><div className="dialog-kicker"><Link2 size={17} /> ПОДБОР ПАРЫ</div><DialogTitle>Шестерня и колесо под ваш редуктор</DialogTitle>
          <DialogDescription>Стандартные модули ГОСТ 9563, числа зубьев под передаточное число и смещение профиля под заданное межосевое расстояние. Каждая пара проверяется расчётом зацепления.</DialogDescription></DialogHeader>
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
        {list && list.length > 0 && <p className="field-help">«Взять»: шестерня z₁ попадёт в редактор, колесо z₂ и межосевое — в «Проверить пару» после построения. ⚠ — есть предупреждения проверки пары.</p>}
      </DialogContent>
    </Dialog>
  </div>;
}
