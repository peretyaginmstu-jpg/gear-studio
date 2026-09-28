"use client";
import { ChevronDown, ClipboardList, Download } from 'lucide-react';
import { toast } from 'sonner';
import { downloadBlob } from '@/lib/download';
import { photoClarificationPlanMarkdown, type PhotoClarificationPlan as ClarificationPlan } from '@/lib/photoClarificationPlan';

/** Opening, reading and downloading this guidance never edits the photo draft. */
export function PhotoClarificationPlan({ plan, active }: { plan: ClarificationPlan; active: boolean }) {
  return <details className="photo-plan">
    <summary><ClipboardList size={19} /><span>Не всё известно? План уточнений</span><ChevronDown size={17} /></summary>
    <div className="photo-plan-body">
      <div className="photo-plan-next"><strong>{plan.status === 'step-ready' ? 'Данные этого шага собраны' : 'С чего начать'}</strong><p>{plan.nextAction}</p></div>
      <div className="photo-plan-download"><button type="button" className="secondary-button" disabled={!active} onClick={() => {
        if (!active) return;
        downloadBlob(photoClarificationPlanMarkdown(plan), 'text/markdown;charset=utf-8', 'gear-photo-clarification-plan.md');
        toast.success('Скачивание памятки запрошено. Фото в файл не входит.');
      }}><Download size={16} /> Скачать план уточнений (.md)</button><small>Локальная памятка без фото. Это не сохранение проекта.</small></div>
      {plan.items.length > 0 && <ol className="photo-plan-list">{plan.items.map(item => <li key={item.id}>
        <h3>{item.title}</h3>{item.problems.map(problem => <p className="photo-plan-problem" key={problem}>{problem}</p>)}<p>{item.action}</p>
      </li>)}</ol>}
      {plan.methods.length > 0 && <div className="photo-plan-methods"><h3>Что можно сделать здесь</h3>{plan.methods.map(method => <div key={method.id}><strong>{method.title}</strong><p>{method.description}</p></div>)}</div>}
      <details className="photo-plan-entered"><summary>Введено сейчас</summary><p>Значение и указанный источник сами по себе не доказывают правильность измерения.</p><dl>{plan.entered.map((value, index) => <div key={index}><dt>{value.label}</dt><dd>{value.value}{value.note && <small>{value.note}</small>}</dd></div>)}</dl></details>
      <p className="photo-plan-scope">{plan.scope}</p>
    </div>
  </details>;
}
