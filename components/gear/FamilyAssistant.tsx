"use client";
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Download, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { downloadBlob } from '@/lib/download';
import { changeFamilyAnswer, familyMemo, familyQuestion, identifyFamily, selectFamilyApplication,
  type FamilyAnswers, type FamilyApplication, type FamilyPhotoHint, type FamilyQuestionId } from '@/lib/familyIdentification';

export function FamilyAssistant({ active, source, photoHint = null, application, engaged, onDraftChange, onApply, onCancel }: {
  active: boolean; source: 'manual' | 'photo'; photoHint?: FamilyPhotoHint | null;
  application: FamilyApplication | null; engaged: boolean;
  onDraftChange: () => void; onApply: (application: FamilyApplication) => void; onCancel: () => void;
}) {
  const [answers, setAnswers] = useState<FamilyAnswers>({}), [page, setPage] = useState<FamilyQuestionId | 'result'>('partnerGroup');
  const [limitedAcknowledged, setLimitedAcknowledged] = useState(false);
  const [seenApplication, setSeenApplication] = useState<FamilyApplication | null>(null);
  // An application can arrive from the other input branch. Reconcile that one event;
  // clearing it after an edit must never restore old answers over the user's draft.
  if (application !== seenApplication) {
    setSeenApplication(application);
    if (application) { setAnswers(structuredClone(application.decision.answers)); setPage('result'); setLimitedAcknowledged(application.limitedModelAcknowledged); }
  }
  const disclosure = useRef<HTMLDetailsElement>(null), target = useRef<HTMLElement>(null), frame = useRef<number | null>(null);
  const radioName = useId(), result = useMemo(() => identifyFamily(answers, photoHint), [answers, photoHint]);
  const current = page !== 'result' && result.route.includes(page) ? page : result.nextQuestion?.id ?? 'result';
  const question = current !== 'result' ? familyQuestion(current, answers) : null;
  const accepted = !!application && JSON.stringify(application.decision.answers) === JSON.stringify(result.answers);
  const reopenManual = accepted && source === 'photo' && result.status === 'limited-manual';
  const focus = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (active) frame.current = requestAnimationFrame(() => { target.current?.focus({ preventScroll: true }); target.current?.scrollIntoView({ block: 'nearest' }); });
  };
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, [active]);
  const go = (next: FamilyQuestionId | 'result') => { setPage(next); focus(); };
  const cancel = () => { onCancel(); if (disclosure.current) { disclosure.current.open = false; disclosure.current.querySelector('summary')?.focus(); } };
  const choose = (id: FamilyQuestionId, value: string) => {
    if (answers[id] === value || !active) return;
    setAnswers(changeFamilyAnswer(answers, id, value as NonNullable<FamilyAnswers[FamilyQuestionId]>));
    setLimitedAcknowledged(false); onDraftChange();
  };
  const accept = () => { if (active) onApply(selectFamilyApplication(answers, source, photoHint, limitedAcknowledged || accepted)); };
  return <details ref={disclosure} className="family-assistant">
    <summary><HelpCircle size={20} /><span>Помочь определить тип<small>По тому, что видно на детали</small></span>{application && <Check size={18} />}</summary>
    <div className="family-assistant-body">
      <p className="family-intro">Несколько вопросов о рабочих зубьях. Размеры и профиль уточним отдельно.</p>
      {photoHint && photoHint.type !== 'undetermined' && <p className="family-photo-hint">Фото подсказывает {photoHint.type === 'internal_ring' ? 'зубья внутри кольца' : photoHint.type === 'linear_rack' ? 'линейную планку' : 'наружный круглый контур'}. Проверьте это при осмотре — ответы за вас не выбраны.</p>}
      {question ? <>
        <fieldset className="family-question"><legend ref={el => { target.current = el; }} tabIndex={-1}>{question.title}</legend><p>{question.hint}</p>
          <div className="family-options">{question.options.map(option => <label key={option.value} className={answers[question.id] === option.value ? 'selected' : ''}>
            <input type="radio" name={`${radioName}-${question.id}`} value={option.value} checked={answers[question.id] === option.value} disabled={!active} onChange={() => choose(question.id, option.value)} />
            <span>{option.label}{option.detail && <small>{option.detail}</small>}</span>
          </label>)}</div>
        </fieldset>
        <div className="family-navigation">{result.route.indexOf(question.id) > 0 && <button type="button" className="secondary-button" onClick={() => go(result.route[result.route.indexOf(question.id) - 1])}><ArrowLeft size={17} /> Назад</button>}
          <button type="button" className="primary-button" disabled={!active || !answers[question.id]} onClick={() => go(result.route[result.route.indexOf(question.id) + 1] ?? 'result')}>Далее <ArrowRight size={17} /></button>
        </div>
      </> : <div className="family-result">
        <p className="family-result-label">{result.status === 'proposal' ? 'УСЛОВНОЕ ПРЕДЛОЖЕНИЕ' : result.status === 'limited-manual' ? 'ОГРАНИЧЕННАЯ РУЧНАЯ МОДЕЛЬ' : 'ЧТО УТОЧНИТЬ ДАЛЬШЕ'}</p>
        <h3 ref={el => { target.current = el; }} tabIndex={-1}>{result.title}</h3>
        {result.reasons.length > 0 && <ul>{result.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        {result.conflicts.map(conflict => <p className="family-notice" key={conflict.code}>{conflict.message}</p>)}
        {result.limitations.map(text => <p key={text} className="family-limit">{text}</p>)}
        <div className="family-next"><h4>{result.modelKind ? 'Следующий шаг' : 'Что осмотреть или найти'}</h4><ul>{result.nextSteps.map(text => <li key={text}>{text}</li>)}</ul></div>
        {result.status === 'limited-manual' && <label className="family-ack"><input type="checkbox" disabled={!active || accepted} checked={limitedAcknowledged || accepted} onChange={e => setLimitedAcknowledged(e.target.checked)} /><span>Понимаю: это выбор ограниченной математической модели для ручного ввода, а не подтверждение профиля исходной детали.</span></label>}
        {['proposal', 'limited-manual'].includes(result.status) && <button type="button" className="primary-button full" disabled={!active || (accepted && !reopenManual) || (result.status === 'limited-manual' && !limitedAcknowledged && !accepted)} onClick={accept}>
          {reopenManual ? <>{result.modelKind === 'worm' ? 'Открыть ручную модель червяка ZA' : 'Открыть ручную модель сферической эвольвенты'} <ArrowRight size={17} /></> : accepted ? <><Check size={18} /> Выбор применён</> : result.status === 'limited-manual' ? <>{result.modelKind === 'worm' ? 'Задать вручную червяк ZA' : 'Задать вручную сферическую эвольвенту'} <ArrowRight size={17} /></> : <>Применить выбранное семейство <ArrowRight size={17} /></>}
        </button>}
        {accepted && <p className="inline-status" role="status">Выбрано только семейство. Проверьте остальные параметры перед построением.</p>}
        <div className="family-result-actions"><button type="button" className="text-button" onClick={() => go(result.route[result.route.length - 1])}><ArrowLeft size={16} /> Изменить ответы</button>
          <button type="button" className="text-button" onClick={() => { downloadBlob(JSON.stringify(familyMemo(answers, photoHint), null, 2), 'application/json', 'gear-family-memo.json'); toast.success('Скачивание памятки запрошено. Она остаётся локальным файлом.'); }}><Download size={16} /> Скачать памятку</button></div>
      </div>}
      {engaged && <button type="button" className="family-cancel text-button" onClick={cancel}>Вернуться к прямому выбору типа</button>}
    </div>
  </details>;
}
