"use client";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Cog, ArrowRight, ArrowLeft, BookOpen, Check, Pencil, Info, FileJson, Grid2X2, ScanLine, SlidersHorizontal, Box, Download } from 'lucide-react';
import { Toaster } from 'sonner';
import { GearViewer } from '@/components/gear/GearViewer';
import { PhotoWizard } from '@/components/gear/PhotoWizard';
import { ReferenceDialog } from '@/components/gear/ReferenceDialog';
import { ParameterEditor } from '@/components/gear/ParameterEditor';
import { SpanMeasurementAssistant } from '@/components/gear/SpanMeasurementAssistant';
import { FamilyAssistant } from '@/components/gear/FamilyAssistant';
import { ModelChips, ModelSummary, ModelInspection } from '@/components/gear/ModelSummary';
import { CheckoutActions } from '@/components/gear/CheckoutActions';
import { useGearTool } from '@/components/gear/useGearTool';
import { useJourney } from '@/components/gear/useJourney';
import { validateMesh } from '@/lib/gearMath';
import { buildModelMesh, defaultModel, type ModelParams, type ModelKind } from '@/lib/model';
import { canVisit, checkoutSnapshot, hasCurrentModel, type JourneyStage, type InputMode } from '@/lib/journey';

const stages: { stage: JourneyStage; title: string }[] = [
  { stage: 'input', title: 'Исходные данные' }, { stage: 'review', title: 'Проверка модели' },
  { stage: 'delivery', title: 'Получение' }, { stage: 'checkout', title: 'Оформление' },
];

export default function Home() {
  const { state, send } = useJourney(), heading = useRef<HTMLHeadingElement>(null);
  const [reference, setReference] = useState(false);
  const deferred = useDeferredValue(state.manualDraft), updating = deferred !== state.manualDraft;
  const manualCheck = useMemo(() => {
    if (state.mode !== 'manual' || state.stage !== 'input') return { error: null };
    try {
      const mesh = buildModelMesh(deferred);
      return { error: validateMesh(mesh).valid ? null : 'Сетка не прошла проверку. Измените параметры.' };
    } catch (e) { return { error: e instanceof Error ? e.message : 'Не удалось построить профиль.' }; }
  }, [deferred, state.mode, state.stage]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); });
    return () => cancelAnimationFrame(frame);
  }, [state.stage, state.mode]);
  const edit = (params: ModelParams) => send({ type: 'edit-manual', params });
  const change = (key: keyof ModelParams, value: number) => edit({ ...state.manualDraft, [key]: value });
  const selectKind = (kind: ModelKind) => send({ type: 'select-manual-kind', kind });
  const chooseInput = (mode: InputMode) => send({ type: 'choose-input', mode });
  const navigate = (stage: JourneyStage) => send({ type: 'navigate', stage });
  const buildManual = () => { if (!updating && !manualCheck.error && !state.manualSpanPending && !state.manualFamilyPending) send({ type: 'build', params: state.manualDraft, origin: 'Параметры заданы вручную', evidence: null }); };
  const model = hasCurrentModel(state) ? state.built : null, checkout = checkoutSnapshot(state);
  const modelVisible = model && ['review', 'delivery', 'checkout'].includes(state.stage);
  const inputActive = state.stage === 'input', photoActive = inputActive && state.mode === 'photo';
  useGearTool(state.built?.params ?? state.manualDraft, params => {
    send({ type: 'choose-input', mode: 'manual' }); send({ type: 'clear-manual-span' }); send({ type: 'edit-manual', params }); send({ type: 'clear-manual-family', method: 'webmcp' });
    send({ type: 'build', params, origin: 'Параметры заданы через инструмент конструктора', evidence: null });
  });

  return <div className="studio studio-v5 studio-v6">
    <Toaster position="bottom-center" richColors />
    <header className="topbar">
      <button className="brand" onClick={() => navigate('start')} aria-label="Зацепление — на главную"><span className="brand-symbol"><Cog /></span>ЗАЦЕПЛЕНИЕ<span className="brand-version">LAB</span></button>
      <span className="top-context">От детали — к своей модели</span>
      <button className="text-button header-reference" onClick={() => setReference(true)}><BookOpen size={20} /> Справочник</button>
    </header>
    {state.stage !== 'start' && <nav className="journey-progress" aria-label="Путь к модели"><ol>{stages.map(({ stage, title }, index) => <li key={stage} aria-current={stage === state.stage ? 'step' : undefined}>
      <button disabled={!canVisit(state, stage)} onClick={() => navigate(stage)}><span>{canVisit(state, stage) && index < stages.findIndex(s => s.stage === state.stage) ? <Check size={15} /> : index + 1}</span>{title}</button>
    </li>)}</ol></nav>}

    <main>
      {state.stage === 'start' && <section className="journey-start">
        <p className="journey-eyebrow">ИНЖЕНЕРНАЯ МАСТЕРСКАЯ В БРАУЗЕРЕ</p>
        <h1 ref={heading} tabIndex={-1}>Восстановите шестерню.<br />Или создайте новую.</h1>
        <p className="start-intro">Начните с фотографии детали или известных размеров. Мы поможем собрать исходные данные, построить модель и подготовить её к изготовлению.</p>
        <div className="start-choices">
          <button className="start-choice" onClick={() => chooseInput('photo')}><span className="start-choice-icon"><Camera size={29} /></span><span><small>У МЕНЯ ЕСТЬ ДЕТАЛЬ</small><strong>Восстановить по фото</strong><span>Загрузите снимок. Помощник подскажет, что измерить и подтвердить.</span></span><ArrowRight size={23} /></button>
          <button className="start-choice" onClick={() => chooseInput('manual')}><span className="start-choice-icon"><SlidersHorizontal size={29} /></span><span><small>Я ЗНАЮ РАЗМЕРЫ</small><strong>Задать параметры</strong><span>Выберите тип зацепления и введите параметры своей детали.</span></span><ArrowRight size={23} /></button>
        </div>
        {model && <button className="inline-link resume-model" onClick={() => navigate('review')}>Вернуться к построенной модели <ArrowRight size={16} /></button>}
        {state.mode && !model && <p className="draft-kept">Ваш черновик сохранён в этой вкладке. Выберите тот же способ, чтобы продолжить.</p>}
        <div className="start-steps"><div><span>01</span><h2>Расскажите о детали</h2><p>Фото и измерения или параметры из чертежа.</p></div><div><span>02</span><h2>Проверьте модель</h2><p>Поверните её в 3D, сверьте размеры и ограничения.</p></div><div><span>03</span><h2>Получите результат</h2><p>Скачайте STL с паспортом или подготовьте задание на печать.</p></div></div>
        <div className="start-capabilities"><span><Cog size={18} /> 10 семейств зацепления</span><span><Box size={18} /> Настоящая 3D-модель</span><span><Download size={18} /> Бесплатный Standard STL</span></div>
        <p className="start-footnote">Расчёты и фото остаются на устройстве. Пригодность рабочей передачи проверяют по нагрузке, материалу и ответной детали.</p>
      </section>}

      {/* Both input branches stay mounted. Ordinary navigation preserves photo, points and answers. */}
      <section className="journey-input" hidden={!inputActive} aria-label="Исходные данные">
        <div className="input-heading"><button className="inline-link" onClick={() => navigate('start')}><ArrowLeft size={17} /> Сменить способ</button>
          <h1 ref={inputActive ? heading : null} tabIndex={-1}>{state.mode === 'photo' ? 'Восстановим деталь по шагам' : 'Задайте параметры своей детали'}</h1>
          <p>{state.mode === 'photo' ? 'Сначала снимок, затем только те уточнения, которые нужны для построения.' : 'Начальные значения — редактируемый пример. Замените их данными своей детали и нажмите «Построить модель».'}</p>
        </div>
        <div className="input-workspace">
          <div className="journey-form">
            <div hidden={state.mode !== 'manual'}>
              <ParameterEditor active={inputActive && state.mode === 'manual'} params={state.manualDraft} onChange={change} onKind={selectKind}
                onHand={hand => edit({ ...state.manualDraft, wormHand: hand })} onReset={() => edit(defaultModel(state.manualDraft.kind))} onReference={() => setReference(true)}
                familyAssistant={<FamilyAssistant active={inputActive && state.mode === 'manual'} source="manual" application={state.manualFamily} engaged={state.manualFamilyPending || !!state.manualFamily}
                  onDraftChange={() => send({ type: 'edit-manual-family' })} onApply={application => send({ type: 'apply-manual-family', application })} onCancel={() => send({ type: 'clear-manual-family' })} />} />
              {state.manualDraft.kind === 'spur' && <SpanMeasurementAssistant teeth={state.manualDraft.teeth} toolTipRadiusCoefficient={state.manualDraft.toolTipRadiusCoefficient ?? .3}
                application={state.manualSpan} engaged={state.manualSpanPending || state.manualSpan !== null}
                onDraftChange={() => send({ type: 'edit-manual-span' })} onApply={application => send({ type: 'apply-manual-span', application })} onCancel={() => send({ type: 'clear-manual-span' })} />}
              <div className="manual-build-status" aria-live="polite">{state.manualFamilyPending ? <p>Ответы о типе ещё не применены. Завершите помощник или вернитесь в нём к прямому выбору типа.</p> : state.manualSpanPending ? <p>Измерения ещё не применены. Завершите помощник или выберите в нём прямой ввод параметров.</p> : updating ? <p>Проверяем параметры…</p> : manualCheck.error ? <p className="inline-error" role="alert">{manualCheck.error}</p> : <p><Check size={17} /> Параметры можно использовать для построения.</p>}</div>
              <button className="primary-button full build-model-button" disabled={state.manualFamilyPending || state.manualSpanPending || updating || !!manualCheck.error} onClick={buildManual}>Построить модель <ArrowRight size={20} /></button>
            </div>
            <div hidden={state.mode !== 'photo'}><PhotoWizard active={photoActive} onDraftChange={() => send({ type: 'edit-photo' })} onApply={(params, origin, evidence) => send({ type: 'build', params: { ...defaultModel(params.kind), ...params }, origin, evidence })} onManual={() => chooseInput('manual')}
              onManualFamily={application => { chooseInput('manual'); send({ type: 'apply-manual-family', application }); }} /></div>
            {state.error && <p className="inline-error" role="alert">{state.error}</p>}
          </div>
          <aside className="input-help"><span className="help-icon">{state.mode === 'photo' ? <Camera size={24} /> : <Pencil size={24} />}</span>
            <h2>Это данные вашей детали</h2><p>{state.mode === 'photo' ? 'Фотография помогает увидеть контур. Реальный размер, профиль и недостающие зубья требуют подтверждения.' : 'Модуль, число зубьев и размеры задают геометрию. Если чего-то не знаете, сверьтесь с чертежом или измерьте ответную деталь.'}</p>
            <p>После построения будет отдельный шаг проверки — до выбора файла или печати.</p>
            <button className="inline-link" onClick={() => setReference(true)}><BookOpen size={16} /> Открыть справочник</button>
            <button className="inline-link" onClick={() => chooseInput(state.mode === 'photo' ? 'manual' : 'photo')}>{state.mode === 'photo' ? 'Перейти к ручному вводу' : 'Использовать фото'} <ArrowRight size={16} /></button>
            {model && <button className="inline-link" onClick={() => navigate('review')}>Вернуться к модели без изменений <ArrowRight size={16} /></button>}
          </aside>
        </div>
      </section>

      {modelVisible && <div className="workbench journey-model-workspace">
        <section className="workbench-model" aria-label="Ваша построенная модель"><div className="ready-heading">
          <button className="inline-link model-back" onClick={() => navigate(state.stage === 'review' ? 'input' : state.stage === 'delivery' ? 'review' : 'delivery')}><ArrowLeft size={17} />{state.stage === 'review' ? 'Изменить данные' : 'Назад'}</button>
          <h1 ref={heading} tabIndex={-1}>{state.stage === 'review' ? 'Проверьте модель' : state.stage === 'delivery' ? 'Как получить модель?' : 'Всё для вашей модели'}</h1>
          <ModelChips params={model.params} />
        </div><GearViewer mesh={model.mesh} error={null} /></section>
        <section className="source-panel model-source-summary" aria-label="Построенные параметры"><h2><ScanLine size={21} /> Параметры вашей модели</h2><ModelSummary params={model.params} />
          <button className="inline-link" onClick={() => navigate('input')}><Pencil size={16} /> Изменить исходные данные</button>
        </section>
        <aside className="delivery-panel journey-next-panel" aria-label={state.stage === 'review' ? 'Проверка перед получением' : 'Получение результата'}>
          {state.stage === 'review' && <><p className="journey-eyebrow">МОДЕЛЬ ПО ВАШИМ ДАННЫМ</p><h2>Похожа на вашу деталь?</h2>
            <p className="delivery-intro">Поверните модель и сравните основные размеры. Если нужно что-то исправить, вернитесь к исходным данным.</p>
            <ol className="review-checks"><li><Check size={19} /><span>Тип, число и направление зубьев</span></li><li><Check size={19} /><span>Модуль, ширина и отверстие или обод</span></li><li><Check size={19} /><span>Допущения и ограничения в разделе геометрии</span></li></ol>
            <button className="primary-button full package-primary" onClick={() => send({ type: 'confirm' })}>Модель верна — продолжить <ArrowRight size={20} /></button>
            <button className="secondary-button full" onClick={() => navigate('input')}><Pencil size={18} /> Изменить данные</button>
            <p className="delivery-note"><Info size={19} /> Вы подтверждаете размеры и форму. Это не проверка прочности, ресурса или совместимости всей передачи.</p>
          </>}
          {state.stage === 'delivery' && <><h2>Файл или подготовка печати</h2><p className="delivery-intro">Выберите результат для этой модели. На следующем шаге получите файлы или настройки и задание.</p>
            <fieldset className="package-options"><legend className="visually-hidden">Способ получения</legend>
              <label className={`package-card ${state.choice?.kind === 'file' && state.choice.preset === 'standard' ? 'selected' : ''}`}><input type="radio" name="delivery-choice" checked={state.choice?.kind === 'file' && state.choice.preset === 'standard'} onChange={() => send({ type: 'choose-delivery', choice: { kind: 'file', preset: 'standard' } })} /><div><strong>Standard STL — бесплатно</strong><p>Средняя детализация для просмотра и пробного изготовления. Паспорт сетки доступен при скачивании.</p></div></label>
              <label className={`package-card package-pro ${state.choice?.kind === 'file' && state.choice.preset === 'pro' ? 'selected' : ''}`}><input type="radio" name="delivery-choice" checked={state.choice?.kind === 'file' && state.choice.preset === 'pro'} onChange={() => send({ type: 'choose-delivery', choice: { kind: 'file', preset: 'pro' } })} /><div><strong>Pro STL + паспорт</strong><p>Высокая детализация. Бесплатно в раннем доступе.</p><ul><li><Grid2X2 size={18} /> Дискретизация кривых</li><li><FileJson size={18} /> Паспорт экспортируемой сетки</li></ul></div></label>
              <label className={`package-card ${state.choice?.kind === 'print' ? 'selected' : ''}`}><input type="radio" name="delivery-choice" checked={state.choice?.kind === 'print'} onChange={() => send({ type: 'choose-delivery', choice: { kind: 'print' } })} /><div><strong>Подготовить к печати</strong><p>Материал, геометрическая оценка для FDM и задание для расчёта. STL тоже доступен.</p></div></label>
            </fieldset>
            <button className="primary-button full package-primary" disabled={!state.choice} onClick={() => navigate('checkout')}>Продолжить <ArrowRight size={20} /></button>
            <p className="delivery-note"><Info size={19} /> Плотность STL не меняет аналитический профиль и не является классом точности. Платежи пока не подключены.</p>
          </>}
          {checkout && <CheckoutActions model={checkout.model} choice={checkout.choice} onChange={() => navigate('delivery')} />}
        </aside>
        <section className="engineering-panel"><ModelInspection model={model} onReference={() => setReference(true)} /></section>
      </div>}
    </main>
    <footer className="page-footer"><span>ЗАЦЕПЛЕНИЕ <span className="muted">/ инженерная мастерская</span></span><span>Локальные вычисления · Миллиметры · Версия 0.10</span></footer>
    <ReferenceDialog open={reference} onOpenChange={setReference} />
  </div>;
}
