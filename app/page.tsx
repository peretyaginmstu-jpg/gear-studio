"use client";
import { useEffect, useRef, useState } from 'react';
import { Camera, Cog, ArrowRight, ArrowLeft, BookOpen, Check, Pencil, Info, FileJson, Grid2X2, ScanLine, SlidersHorizontal, Box, Download, HelpCircle, Ruler, KeyRound, LayoutTemplate, Link2, Images } from 'lucide-react';
import { Toaster } from 'sonner';
import { GearViewer } from '@/components/gear/GearViewer';
import { PhotoWizard } from '@/components/gear/PhotoWizard';
import { ReferenceDialog } from '@/components/gear/ReferenceDialog';
import { ParameterEditor, BodyFeaturesPanel, FineTuningPanel, bodyFeaturesBadge, bodyFeatureKinds, fineTuningBadge } from '@/components/gear/ParameterEditor';
import { SpanMeasurementAssistant } from '@/components/gear/SpanMeasurementAssistant';
import { PinMeasurementTool } from '@/components/gear/PinMeasurementTool';
import { TemplatePicker, PairSynthesisPanel } from '@/components/gear/StarterTools';
import { ToolTray } from '@/components/gear/ToolTray';
import { ContextHints, contextHints } from '@/components/gear/ContextHints';
import { MeasurementGuide } from '@/components/gear/MeasurementGuide';
import { FamilyAssistant } from '@/components/gear/FamilyAssistant';
import { ModelChips, ModelSummary, ModelInspection } from '@/components/gear/ModelSummary';
import { CheckoutActions } from '@/components/gear/CheckoutActions';
import { useGearTool } from '@/components/gear/useGearTool';
import { useJourney } from '@/components/gear/useJourney';
import { useModelCheck } from '@/components/gear/useModelCheck';
import { LivePreview } from '@/components/gear/LivePreview';
import { DownloadSheet } from '@/components/gear/DownloadSheet';
import { checkModelParams } from '@/lib/modelCheck';
import { defaultModel, isInternalKind, isRackKind, modelNames, type ModelParams, type ModelKind } from '@/lib/model';
import { canVisit, checkoutSnapshot, hasCurrentModel, type JourneyStage, type InputMode } from '@/lib/journey';
import { APP_VERSION } from '@/lib/appVersion';
import { ProjectWorkspace, type ProjectSession } from '@/components/gear/ProjectWorkspace';
import { useReferencePhotos } from '@/components/gear/useReferencePhotos';
import { ReferencePhotos } from '@/components/gear/ReferencePhotos';
import { referencePhotoManifest } from '@/lib/referencePhotos';

const stages: { stage: JourneyStage; title: string }[] = [
  { stage: 'input', title: 'Исходные данные' }, { stage: 'review', title: 'Проверка модели' },
  { stage: 'delivery', title: 'Получение' }, { stage: 'checkout', title: 'Оформление' },
];
const photoCountSourceLabels = { user_confirmation: 'проверка пользователем', measurement: 'результаты измерений', drawing: 'чертёж или документация' } as const;

export default function Home() {
  return <ProjectWorkspace component={Studio} />;
}

function Studio({ project }: { project: ProjectSession }) {
  const { state, send } = useJourney(project.initial, project.onJourney), heading = useRef<HTMLHeadingElement>(null);
  const referencePhotos = useReferencePhotos(() => send({ type: 'edit-reference-photos' }));
  const [reference, setReference] = useState(false), [downloadOpen, setDownloadOpen] = useState(false);
  const quickEdit = (params: ModelParams) => send({ type: 'quick-edit', params });
  const quickCheck = useModelCheck(state.manualDraft, state.stage === 'start' || (state.mode === 'manual' && state.stage === 'input'));
  // «Скачать» confirms the visible model in place; the sheet needs to know synchronously whether it built.
  const acceptDraft = () => {
    if (checkModelParams(state.manualDraft)) return false;
    send({ type: 'accept-model', params: state.manualDraft, origin: 'Параметры заданы вручную', evidence: null, referencePhotos: referencePhotoManifest(referencePhotos.photos) });
    return true;
  };
  const manualCheck = quickCheck, updating = manualCheck.pending;
  useEffect(() => {
    const frame = requestAnimationFrame(() => { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); });
    return () => cancelAnimationFrame(frame);
  }, [state.stage, state.mode]);
  const edit = (params: ModelParams) => send({ type: 'edit-manual', params });
  const change = (key: keyof ModelParams, value: number) => edit({ ...state.manualDraft, [key]: value });
  const selectKind = (kind: ModelKind) => send({ type: 'select-manual-kind', kind });
  const chooseInput = (mode: InputMode) => send({ type: 'choose-input', mode });
  const navigate = (stage: JourneyStage) => send({ type: 'navigate', stage });
  const buildManual = () => { if (!updating && !manualCheck.error && !state.manualSpanPending && !state.manualFamilyPending) send({ type: 'build', params: state.manualDraft, origin: 'Параметры заданы вручную', evidence: null, referencePhotos: referencePhotoManifest(referencePhotos.photos) }); };
  const photoHandoff = state.photoCycloidalHandoff, photoCountSeed = photoHandoff?.toothCountSeed;
  const photoCountStillCurrent = !!photoCountSeed && state.manualDraft.kind === 'cycloidal' && state.manualDraft.teeth === photoCountSeed.value;
  const photoModuleInference = photoHandoff?.moduleInference;
  const photoModuleSeed = photoModuleInference?.status === 'ready' ? photoModuleInference : null;
  const photoModuleStillCurrent = !!photoModuleSeed && photoCountStillCurrent && state.manualDraft.kind === 'cycloidal' && state.manualDraft.module === photoModuleSeed.moduleMm;
  const photoCountNotice = photoCountSeed
    ? photoCountStillCurrent
      ? `Перенесено проверенное полное число зубьев z=${photoCountSeed.value} (${photoCountSourceLabels[photoCountSeed.source]}).`
      : `В фото-помощнике подтверждено z=${photoCountSeed.value}, текущее z=${state.manualDraft.teeth} задано вручную.`
    : `Полное число зубьев не перенесено из фото; проверьте z=${state.manualDraft.teeth} по детали или чертежу.`;
  const photoModuleNotice = photoModuleSeed
    ? photoModuleStillCurrent
      ? `Расчётный модуль m=${photoModuleSeed.moduleMm} мм выведен из подтверждённых z=${photoModuleSeed.evidence.toothCount.value} и da=${photoModuleSeed.evidence.tipDiameterMm.value} мм по формуле m=da/(z+2); источник da: ${photoCountSourceLabels[photoModuleSeed.evidence.tipDiameterMm.source]}.`
      : `Фото-модуль m=${photoModuleSeed.moduleMm} мм рассчитан при z=${photoModuleSeed.evidence.toothCount.value}; сейчас модель использует z=${state.manualDraft.teeth} и m=${state.manualDraft.module}. После изменения параметров проверьте модуль; паспорт сохранит исходный фото-расчёт отдельно от текущих параметров.`
    : `Модуль по фото не рассчитан${photoModuleInference?.status === 'missing' ? `: ${photoModuleInference.questions.join(' ')}` : photoModuleInference?.status === 'rejected' ? `: ${photoModuleInference.reason}` : '.'} Текущее m=${state.manualDraft.module} требует ручной проверки.`;
  const photoHandoffNotice = photoHandoff ? `${photoCountNotice} ${photoModuleNotice} Проверьте геометрию перед построением.` : null;
  const model = hasCurrentModel(state) ? state.built : null, checkout = checkoutSnapshot(state);
  const modelVisible = model && ['review', 'delivery', 'checkout'].includes(state.stage);
  const inputActive = state.stage === 'input', photoActive = inputActive && state.mode === 'photo';
  useGearTool(state.built?.params ?? state.manualDraft, params => {
    if (project.archived) throw new Error('Верните проект из архива в работу перед изменением параметров.');
    if (project.busy) throw new Error('Дождитесь завершения обработки фото.');
    send({ type: 'choose-input', mode: 'manual' }); send({ type: 'clear-manual-span' }); send({ type: 'edit-manual', params }); send({ type: 'clear-manual-family', method: 'webmcp' });
    send({ type: 'build', params, origin: 'Параметры заданы через инструмент конструктора', evidence: null, referencePhotos: referencePhotoManifest(referencePhotos.photos) });
  });

  return <div className="studio studio-v5 studio-v6">
    <Toaster position="bottom-center" richColors />
    <header className="topbar">
      <button className="brand" disabled={project.busy} onClick={() => navigate('start')} aria-label="Зацепление — на главную"><span className="brand-symbol"><Cog /></span>ЗАЦЕПЛЕНИЕ<span className="brand-version">LAB</span></button>
      <span className="top-context">От детали — к своей модели</span>
      <button className="text-button header-reference" onClick={() => setReference(true)}><BookOpen size={20} /> Справочник</button>
    </header>
    {project.controls}
    {state.stage !== 'start' && <nav inert={project.busy} className="journey-progress" aria-label="Путь к модели"><ol>{stages.map(({ stage, title }, index) => <li key={stage} aria-current={stage === state.stage ? 'step' : undefined}>
      <button disabled={!canVisit(state, stage)} onClick={() => navigate(stage)}><span>{canVisit(state, stage) && index < stages.findIndex(s => s.stage === state.stage) ? <Check size={15} /> : index + 1}</span>{title}</button>
    </li>)}</ol></nav>}

    <main inert={project.busy}>
      {state.stage === 'start' && <section className="journey-start landing">
        <div className="landing-hero">
          <div className="landing-copy">
            <p className="journey-eyebrow">ГЕНЕРАТОР ЗУБЧАТЫХ КОЛЁС</p>
            <h1 ref={heading} tabIndex={-1}>Шестерня за минуту</h1>
            <p className="start-intro">Меняйте размеры — модель обновляется сразу. Скачайте STL бесплатно или Pro-комплект для изготовления.</p>
            <div className="quick-form">
              <label className="quick-field quick-kind">Тип<select value={state.manualDraft.kind} onChange={e => quickEdit(defaultModel(e.target.value as ModelKind))}>
                {Object.entries(modelNames).map(([kind, title]) => <option key={kind} value={kind}>{title}</option>)}</select></label>
              {state.manualDraft.kind !== 'worm' && <QuickNumber label="Зубьев" value={state.manualDraft.teeth} step={1} onChange={v => quickEdit({ ...state.manualDraft, teeth: v })} />}
              <QuickNumber label="Модуль, мм" value={state.manualDraft.module} step={.25} onChange={v => quickEdit({ ...state.manualDraft, module: v })} />
              <QuickNumber label="Ширина, мм" value={state.manualDraft.width} step={1} onChange={v => quickEdit({ ...state.manualDraft, width: v })} />
              {!isRackKind(state.manualDraft.kind) && !isInternalKind(state.manualDraft.kind) && <QuickNumber label="Отверстие, мм" value={state.manualDraft.bore} step={.5} onChange={v => quickEdit({ ...state.manualDraft, bore: v })} />}
            </div>
            <div className="landing-actions">
              <button className="primary-button" disabled={quickCheck.pending || !!quickCheck.error} onClick={() => setDownloadOpen(true)}><Download size={20} /> Скачать модель</button>
              <button className="secondary-button" onClick={() => { chooseInput('manual'); }}><SlidersHorizontal size={18} /> Больше настроек</button>
            </div>
            <button className="inline-link landing-photo" onClick={() => chooseInput('photo')}><Camera size={16} /> Есть только сломанная деталь? Восстановим по фото</button>
            {model && <button className="inline-link resume-model" onClick={() => navigate('review')}>Вернуться к построенной модели <ArrowRight size={16} /></button>}
          </div>
          <LivePreview params={state.manualDraft} />
        </div>
        <div className="start-capabilities"><span><Cog size={18} /> 10 семейств зацепления</span><span><Box size={18} /> STL бесплатно, без регистрации</span><span><Download size={18} /> DXF и PDF для мастерской</span></div>
        <p className="start-footnote">Расчёты и фото остаются на устройстве. Пригодность рабочей передачи проверяют по нагрузке, материалу и ответной детали.</p>
        <div className="mobile-download-bar"><button className="primary-button full" disabled={quickCheck.pending || !!quickCheck.error} onClick={() => setDownloadOpen(true)}><Download size={20} /> Скачать модель</button></div>
      </section>}

      {/* Both input branches stay mounted. Ordinary navigation preserves photo, points and answers. */}
      <section className="journey-input" hidden={!inputActive} aria-label="Исходные данные">
        <div className="input-heading"><button className="inline-link" onClick={() => navigate('start')}><ArrowLeft size={17} /> На главную</button>
          <h1 ref={inputActive ? heading : null} tabIndex={-1}>{state.mode === 'photo' ? 'Восстановим деталь по шагам' : 'Задайте параметры своей детали'}</h1>
          <p>{state.mode === 'photo' ? 'Сначала снимок, затем только нужные уточнения.' : 'Замените пример данными своей детали.'}</p>
        </div>
        <div className="input-workspace">
          <div className="journey-form">
            <div hidden={state.mode !== 'manual'}>
              {photoHandoffNotice && <p className="family-notice" role="status">{photoHandoffNotice}</p>}
              <ParameterEditor active={inputActive && state.mode === 'manual'} params={state.manualDraft} onChange={change} onKind={selectKind}
                onHand={hand => edit({ ...state.manualDraft, wormHand: hand })} onReference={() => setReference(true)} />
              <ContextHints params={state.manualDraft} onPatch={patch => edit({ ...state.manualDraft, ...patch })} />
              <ToolTray label="Если нужно" tools={[
                { id: 'family', icon: <HelpCircle size={16} />, label: 'Не знаю тип', title: 'Определим тип по детали', badge: state.manualFamilyPending ? 'не применено' : state.manualFamily ? 'выбран' : null,
                  render: () => <FamilyAssistant defaultOpen active={inputActive && state.mode === 'manual'} source="manual" application={state.manualFamily} engaged={state.manualFamilyPending || !!state.manualFamily}
                    onDraftChange={() => send({ type: 'edit-manual-family' })} onApply={application => send({ type: 'apply-manual-family', application })} onCancel={() => send({ type: 'clear-manual-family' })} /> },
                { id: 'measure', icon: <Ruler size={16} />, label: 'Измерить деталь', title: 'Измерения образца', badge: state.manualSpanPending ? 'не применено' : state.manualSpan ? 'по нормали' : null,
                  description: 'Схемы измерений, общая нормаль и размер по роликам — если модуль или смещение неизвестны.',
                  render: () => <div className="tool-panel">
                    <MeasurementGuide active kind={state.manualDraft.kind} teeth={state.manualDraft.teeth} initialTopic="module" label="Как измерить вашу деталь" hint="Модуль, зубья и размеры тела — на схемах" />
                    {state.manualDraft.kind === 'spur' && <SpanMeasurementAssistant teeth={state.manualDraft.teeth} toolTipRadiusCoefficient={state.manualDraft.toolTipRadiusCoefficient ?? .3}
                      application={state.manualSpan} engaged={state.manualSpanPending || state.manualSpan !== null}
                      onDraftChange={() => send({ type: 'edit-manual-span' })} onApply={application => send({ type: 'apply-manual-span', application })} onCancel={() => send({ type: 'clear-manual-span' })} />}
                    <PinMeasurementTool params={state.manualDraft} onApplyShift={x => edit({ ...state.manualDraft, profileShift: x, backlash: 0 })} />
                  </div> },
                { id: 'body', icon: <KeyRound size={16} />, label: 'Паз и ступица', title: 'Шпоночный паз и ступица', badge: bodyFeaturesBadge(state.manualDraft), hidden: !bodyFeatureKinds.includes(state.manualDraft.kind),
                  render: () => <BodyFeaturesPanel params={state.manualDraft} onChange={change} onPatch={patch => edit({ ...state.manualDraft, ...patch })} /> },
                { id: 'template', icon: <LayoutTemplate size={16} />, label: 'Шаблон', title: 'Начать с типовой детали',
                  render: close => <TemplatePicker onApply={params => { send({ type: 'clear-manual-span' }); send({ type: 'clear-manual-family' }); edit(params); close(); }} /> },
                { id: 'pair', icon: <Link2 size={16} />, label: 'Подобрать пару', title: 'Шестерня и колесо под ваш редуктор',
                  description: 'Модули ГОСТ 9563, зубья под передаточное число и смещение под межосевое; каждая пара проверяется расчётом зацепления.',
                  render: close => <PairSynthesisPanel onApply={params => { send({ type: 'clear-manual-span' }); send({ type: 'clear-manual-family' }); edit(params); close(); }} /> },
                { id: 'photos', icon: <Images size={16} />, label: 'Фото детали', title: 'Ракурсы образца', badge: referencePhotos.photos.length ? String(referencePhotos.photos.length) : null,
                  render: () => <ReferencePhotos defaultOpen controller={referencePhotos} active={inputActive && state.mode === 'manual'} disabled={project.busy} /> },
                { id: 'fine', icon: <SlidersHorizontal size={16} />, label: 'Тонкая настройка', title: 'Тонкая настройка', badge: fineTuningBadge(state.manualDraft),
                  render: () => <FineTuningPanel params={state.manualDraft} onChange={change} onReset={() => edit(defaultModel(state.manualDraft.kind))} /> },
              ]} />
              <div className="manual-build-status" aria-live="polite">{state.manualFamilyPending ? <p>Ответы о типе ещё не применены. Завершите помощник или вернитесь в нём к прямому выбору типа.</p> : state.manualSpanPending ? <p>Измерения ещё не применены. Завершите помощник или выберите в нём прямой ввод параметров.</p> : updating ? <p>Проверяем параметры…</p> : manualCheck.error ? <p className="inline-error" role="alert">{contextHints(state.manualDraft).some(h => h.action) ? 'С этими значениями модель не построить — примените подсказку выше.' : manualCheck.error}</p> : <p><Check size={17} /> Параметры можно использовать для построения.</p>}</div>
              <div className="manual-actions">
                <button className="primary-button full" disabled={state.manualFamilyPending || state.manualSpanPending || updating || !!manualCheck.error} onClick={() => setDownloadOpen(true)}><Download size={20} /> Скачать модель</button>
                <button className="secondary-button full build-model-button" disabled={state.manualFamilyPending || state.manualSpanPending || updating || !!manualCheck.error} onClick={buildManual}>Проверить размеры подробно <ArrowRight size={18} /></button>
              </div>
            </div>
            <div hidden={state.mode !== 'photo'}><PhotoWizard referencePhotos={referencePhotos} active={photoActive} onDraftChange={() => send({ type: 'edit-photo' })} onApply={(params, origin, evidence) => send({ type: 'build', params: { ...defaultModel(params.kind), ...params }, origin, evidence, referencePhotos: referencePhotoManifest(referencePhotos.photos) })} onManual={(kind, handoff) => {
              if (kind === 'cycloidal') send({ type: 'photo-to-manual-cycloidal', ...handoff });
              else { chooseInput('manual'); if (kind) selectKind(kind); }
            }}
              onManualFamily={application => { chooseInput('manual'); send({ type: 'apply-manual-family', application }); }} /></div>
            {state.error && <p className="inline-error" role="alert">{state.error}</p>}
          </div>
          <aside className="input-help">
            {state.mode === 'manual' ? inputActive && <LivePreview params={state.manualDraft} /> : <span className="help-icon"><Camera size={24} /></span>}
            <p>{state.mode === 'photo' ? 'Фото подсказывает контур; размеры и число зубьев вы подтверждаете.' : 'Модель обновляется по мере ввода. Не знаете значение — «Измерить деталь» или справочник.'}</p>
            <button className="inline-link" onClick={() => setReference(true)}><BookOpen size={16} /> Справочник</button>
            <button className="inline-link" onClick={() => chooseInput(state.mode === 'photo' ? 'manual' : 'photo')}>{state.mode === 'photo' ? 'Ввести вручную' : 'По фото'} <ArrowRight size={16} /></button>
            {model && <button className="inline-link" onClick={() => navigate('review')}>Вернуться к модели <ArrowRight size={16} /></button>}
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
            <p className="delivery-intro">Поверните модель и сравните с деталью.</p>
            <ol className="review-checks"><li><Check size={19} /><span>Тип, число и направление зубьев</span></li><li><Check size={19} /><span>Модуль, ширина и отверстие или обод</span></li><li><Check size={19} /><span>Допущения и ограничения в разделе геометрии</span></li></ol>
            <button className="primary-button full package-primary" onClick={() => send({ type: 'confirm' })}>Модель верна — продолжить <ArrowRight size={20} /></button>
            <p className="delivery-note"><Info size={19} /> Вы подтверждаете размеры и форму. Это не проверка прочности, ресурса или совместимости всей передачи.</p>
          </>}
          {state.stage === 'delivery' && <><h2>Файл или подготовка печати</h2><p className="delivery-intro">Выберите результат для этой модели. На следующем шаге получите файлы или настройки и задание.</p>
            <fieldset className="package-options"><legend className="visually-hidden">Способ получения</legend>
              <label className={`package-card ${state.choice?.kind === 'file' && state.choice.preset === 'standard' ? 'selected' : ''}`}><input type="radio" name="delivery-choice" checked={state.choice?.kind === 'file' && state.choice.preset === 'standard'} onChange={() => send({ type: 'choose-delivery', choice: { kind: 'file', preset: 'standard' } })} /><div><strong>Standard STL — бесплатно</strong><p>Средняя детализация для просмотра и пробного изготовления. PDF и паспорт сетки доступны при скачивании.</p></div></label>
              <label className={`package-card package-pro ${state.choice?.kind === 'file' && state.choice.preset === 'pro' ? 'selected' : ''}`}><input type="radio" name="delivery-choice" checked={state.choice?.kind === 'file' && state.choice.preset === 'pro'} onChange={() => send({ type: 'choose-delivery', choice: { kind: 'file', preset: 'pro' } })} /><div><strong>Pro STL + документы</strong><p>Высокая детализация. Бесплатно в раннем доступе.</p><ul><li><Grid2X2 size={18} /> Дискретизация кривых</li><li><FileJson size={18} /> PDF, паспорт и комплект ZIP</li></ul></div></label>
              <label className={`package-card ${state.choice?.kind === 'print' ? 'selected' : ''}`}><input type="radio" name="delivery-choice" checked={state.choice?.kind === 'print'} onChange={() => send({ type: 'choose-delivery', choice: { kind: 'print' } })} /><div><strong>Подготовить к печати</strong><p>Материал, геометрическая оценка для FDM и задание для расчёта. STL тоже доступен.</p></div></label>
            </fieldset>
            <button className="primary-button full package-primary" disabled={!state.choice} onClick={() => navigate('checkout')}>Продолжить <ArrowRight size={20} /></button>
            <p className="delivery-note"><Info size={19} /> Плотность STL не меняет аналитический профиль и не является классом точности. Платежи пока не подключены.</p>
          </>}
          {checkout && <CheckoutActions model={checkout.model} choice={checkout.choice} onChange={() => navigate('delivery')} projectName={project.name}
            onAdjustParams={params => { send({ type: 'choose-input', mode: 'manual' }); send({ type: 'clear-manual-span' }); send({ type: 'clear-manual-family' }); edit(params); }} />}
        </aside>
        <section className="engineering-panel"><ModelInspection model={model} onReference={() => setReference(true)} /></section>
      </div>}
    </main>
    <footer className="page-footer"><span>ЗАЦЕПЛЕНИЕ <span className="muted">/ инженерная мастерская</span></span><span>Локальные вычисления · Миллиметры · Версия {APP_VERSION}</span></footer>
    <ReferenceDialog open={reference} onOpenChange={setReference} />
    <DownloadSheet open={downloadOpen} onOpenChange={setDownloadOpen} params={state.manualDraft} projectName={project.name}
      onAccept={acceptDraft} onMore={() => navigate('delivery')} />
  </div>;
}

/** Landing field: commits on each valid number; an empty box does not wipe the model. */
function QuickNumber({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return <label className="quick-field">{label}<input type="number" inputMode="decimal" aria-label={label} step={step} value={Number.isFinite(value) ? value : ''}
    onChange={e => { const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v)) onChange(v); }} /></label>;
}
