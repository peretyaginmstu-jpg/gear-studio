"use client";
import { useState } from 'react';
import { Ruler } from 'lucide-react';
import { isInternalKind, type ModelParams } from '@/lib/model';
import { moduleForTipDiameter, supportsDiameterHelper } from '@/lib/quickSizing';

const mm = (v: number, digits = 2) => v.toLocaleString('ru-RU', { maximumFractionDigits: digits });

/** «Модуль» means nothing to most visitors; the outside diameter is what they can measure with a ruler. */
export function ModuleFromDiameter({ params, onApply }: { params: ModelParams; onApply: (module: number) => void }) {
  const [open, setOpen] = useState(false), [value, setValue] = useState('');
  if (!supportsDiameterHelper(params.kind)) return null;
  const internal = isInternalKind(params.kind);
  const suggestion = moduleForTipDiameter(params, Number(value.replace(',', '.')));
  if (!open) return <button type="button" className="inline-link quick-sizing-open" onClick={() => setOpen(true)}><Ruler size={15} /> Не знаете модуль? Посчитаем по диаметру</button>;
  return <div className="quick-sizing" role="group" aria-label="Модуль по диаметру">
    <label className="quick-field">{internal ? 'Диаметр по вершинам зубьев (внутренний), мм' : 'Наружный диаметр детали, мм'}
      <input type="number" inputMode="decimal" step={.1} autoFocus value={value} onChange={e => setValue(e.target.value)} placeholder="Измерьте по вершинам зубьев" /></label>
    {suggestion ? <div className="quick-sizing-result">
      <p>Подходит <b>модуль {mm(suggestion.module, 3)} мм</b>: при {params.teeth} зубьях ⌀ {mm(suggestion.tipDiameter)} мм
        {Math.abs(suggestion.deviationMm) >= .05 && <> (у вас {mm(Number(value.replace(',', '.')))}, разница {mm(Math.abs(suggestion.deviationMm))} мм)</>}.</p>
      {Math.abs(suggestion.deviationMm) > Math.max(.5, suggestion.tipDiameter * .02) && <p className="quick-sizing-warn">Разница заметная — проверьте число зубьев. Возможно, колесо дюймовое (DP) или со смещением: это настраивается в «Больше настроек».</p>}
      <button type="button" className="secondary-button" onClick={() => { onApply(suggestion.module); setOpen(false); setValue(''); }}>Применить модуль {mm(suggestion.module, 3)}</button>
    </div> : <p className="quick-sizing-hint">Сначала укажите число зубьев, затем диаметр по вершинам зубьев штангенциркулем.</p>}
    <button type="button" className="text-button" onClick={() => setOpen(false)}>Скрыть</button>
  </div>;
}
