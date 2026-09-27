"use client";
import { defaultInternalCutter, type internalCutterKeys } from '@/lib/generatedInternalRoot';
import type { ModelParams } from '@/lib/model';

export type InternalCutterKey = typeof internalCutterKeys[number];
export type InternalCutterInputs = Pick<ModelParams, InternalCutterKey>;
const fields: { key: InternalCutterKey; label: string; symbol: string; min: number; max?: number; step: number }[] = [
  { key: 'internalCutterTeeth', label: 'Зубьев долбяка', symbol: 'zс', min: 6, max: 249, step: 1 },
  { key: 'internalCutterProfileShift', label: 'Смещение долбяка', symbol: 'xс', min: -.8, max: 1, step: .05 },
  { key: 'internalCutterAddendumCoefficient', label: 'Головка долбяка', symbol: 'haс*', min: .5, max: 2, step: .05 },
  { key: 'internalCutterTipRadiusCoefficient', label: 'Радиус вершины долбяка', symbol: 'ρс / m', min: .05, max: .8, step: .01 },
  { key: 'internalCutterThinning', label: 'Утонение долбяка', symbol: 'jс, мм', min: 0, step: .01 },
];
export function InternalCutterFields({ params, onChange }: { params: InternalCutterInputs; onChange: (key: InternalCutterKey, value: number) => void }) {
  return <fieldset className="cutter-settings">
    <legend>Принятый долбяк</legend>
    <p className="field-help">Форма впадины зависит от инструмента. Эти значения заданы как предположение, по фото они не распознаны. Если инструмент известен, укажите его параметры.</p>
    <div className="input-grid">{fields.map(field => {
      const value = params[field.key] ?? defaultInternalCutter[field.key];
      return <label className="number-field" key={field.key}>{field.label}<em>{field.symbol}</em>
        <input aria-label={field.label} type="number" min={field.min} max={field.max} step={field.step} value={Number.isFinite(value) ? value : ''}
          onChange={event => onChange(field.key, event.target.value === '' ? NaN : Number(event.target.value))} />
      </label>;
    })}</div>
    <p className="field-help">Нужно zс &lt; z. Проверяются достижимость боковины, скругление и консервативная область без повторного срезания. Отказ означает выход из области этой модели инструмента.</p>
  </fieldset>;
}
