"use client";
import { useMemo, useState } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { buildGearProfile, deriveGear } from '@/lib/gearMath';
import { gearKernelParams, type ModelParams } from '@/lib/model';

interface Hint { id: string; text: string; action?: { label: string; patch: Partial<ModelParams> } }

/** Advice that appears only when the current values call for it, with a one-click fix where one exists. */
export function contextHints(params: ModelParams): Hint[] {
  if (!['spur', 'helical', 'herringbone'].includes(params.kind)) return [];
  try {
    const d = deriveGear(gearKernelParams(params)), hints: Hint[] = [];
    if (d.warnings.some(w => w.code === 'UNDERCUT')) {
      // Smallest shift from the undercut limit upward that the rack-generated root actually accepts.
      let x = Math.min(1, Math.ceil(d.dimensions.minimumProfileShift * 100) / 100);
      for (; x < 1; x = Math.round((x + .05) * 100) / 100) {
        try { buildGearProfile(gearKernelParams({ ...params, profileShift: x }), 8); break; } catch { /* try a larger shift */ }
      }
      hints.push({ id: `undercut-${params.teeth}`, text: `При z = ${params.teeth} ножка зуба подрежется инструментом и ослабнет. Положительное смещение это убирает.`,
        action: { label: `Смещение x = ${x.toLocaleString('ru-RU')}`, patch: { profileShift: x } } });
    }
    if (params.bore > 0 && params.bore >= 10 && !(params.keywayWidth ?? 0) && params.module >= 1.5)
      hints.push({ id: `keyway-${params.bore}`, text: 'Колесо на валу обычно фиксируют шпонкой. Паз можно добавить в «Паз и ступица».' });
    return hints;
  } catch { return []; }
}

export function ContextHints({ params, onPatch }: { params: ModelParams; onPatch: (patch: Partial<ModelParams>) => void }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const hints = useMemo(() => contextHints(params).filter(h => !dismissed.includes(h.id)), [params, dismissed]);
  if (!hints.length) return null;
  return <div className="context-hints" aria-live="polite">{hints.map(h => <div key={h.id} className="context-hint" role="status">
    <Lightbulb size={17} /><p>{h.text}</p>
    {h.action && <button type="button" className="secondary-button" onClick={() => onPatch(h.action!.patch)}>{h.action.label}</button>}
    <button type="button" className="context-hint-close" aria-label="Скрыть подсказку" onClick={() => setDismissed(d => [...d, h.id])}><X size={15} /></button>
  </div>)}</div>;
}
