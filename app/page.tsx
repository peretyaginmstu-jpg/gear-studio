"use client";
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { Camera, Download, Cog, ArrowRight, Printer, BookOpen, Check, ChevronRight, ChevronDown, Pencil, Info, FileJson, FileText, AlertTriangle, Link2, Grid2X2, ScanLine, ShieldCheck } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Toaster, toast } from 'sonner';
import { GearViewer } from '@/components/gear/GearViewer';
import { PhotoWizard } from '@/components/gear/PhotoWizard';
import { PrintDialog } from '@/components/gear/PrintDialog';
import { ReferenceDialog } from '@/components/gear/ReferenceDialog';
import { PairDialog } from '@/components/gear/PairDialog';
import { ExportDialog } from '@/components/gear/ExportDialog';
import { ParameterEditor } from '@/components/gear/ParameterEditor';
import { useGearTool } from '@/components/gear/useGearTool';
import { validateMesh } from '@/lib/gearMath';
import { buildModelMesh, defaultModel, modelNames, isRackKind, isInternalKind, isHelicalKind, type ModelParams, type ModelKind } from '@/lib/model';
import { createModelPassport, type ExportPreset } from '@/lib/modelExport';
import { downloadBlob } from '@/lib/download';

const fmt = (n: number, digits = 2) => Number.isFinite(n) ? n.toLocaleString('ru-RU', { maximumFractionDigits: digits }) : '—';

export default function Home() {
  const [params, setParams] = useState<ModelParams>(defaultModel()), deferred = useDeferredValue(params);
  const [mode, setMode] = useState<'manual' | 'photo'>('manual'), [parametersOpen, setParametersOpen] = useState(false);
  const [reference, setReference] = useState(false), [print, setPrint] = useState(false), [pairOpen, setPairOpen] = useState(false), [exportOpen, setExportOpen] = useState(false);
  const [preset, setPreset] = useState<ExportPreset>('pro'), [origin, setOrigin] = useState('Параметры заданы вручную'), [evidence, setEvidence] = useState<unknown>(null);
  const editorRef = useRef<HTMLElement>(null);
  const calculation = useMemo(() => {
    try {
      const mesh = buildModelMesh(deferred), validation = validateMesh(mesh);
      if (!validation.valid) throw new Error('Сетка не прошла проверку. Измените параметры.');
      return { mesh, validation, error: null };
    } catch (e) { return { mesh: null, validation: null, error: e instanceof Error ? e.message : 'Не удалось построить профиль.' }; }
  }, [deferred]);
  const { mesh, validation, error } = calculation, updating = deferred !== params, ready = !!mesh && !!validation && !updating;
  const d = mesh?.dimensions, worm = mesh && 'wormDimensions' in mesh ? mesh.wormDimensions : null;
  const cycloidal = mesh && 'cycloidalDimensions' in mesh ? mesh.cycloidalDimensions : null, bevel = mesh && 'bevelDimensions' in mesh ? mesh.bevelDimensions : null;
  const rack = isRackKind(params.kind), internal = isInternalKind(params.kind), isWorm = params.kind === 'worm', isBevel = params.kind === 'bevel';
  const moduleSymbol = isWorm ? 'mₓ' : isBevel ? 'mₑ' : isHelicalKind(params.kind) ? 'mₙ' : 'm';
  const manual = () => { setOrigin('Параметры заданы вручную'); setEvidence(null); };
  const change = (key: keyof ModelParams, value: number) => { setParams(p => ({ ...p, [key]: value })); manual(); };
  const selectKind = (kind: ModelKind) => { setParams(defaultModel(kind)); manual(); };
  const reset = () => { setParams(defaultModel(params.kind)); manual(); toast('Исходные параметры восстановлены'); };
  const openEditor = (nextMode: 'manual' | 'photo') => {
    setMode(nextMode); setParametersOpen(true);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const openExport = (next: ExportPreset) => { if (ready) { setPreset(next); setExportOpen(true); } };
  const downloadParams = () => {
    if (!mesh || !validation || !ready) return;
    downloadBlob(JSON.stringify(createModelPassport(mesh, validation, { origin, evidence }), null, 2), 'application/json', 'gear-parameters.json');
    toast('Скачивание паспорта текущей модели запрошено');
  };
  useGearTool(params, p => { setParams(p); setEvidence(null); setOrigin('Параметры заданы через инструмент конструктора'); setMode('manual'); });

  return <div className="studio studio-v5">
    <Toaster position="bottom-center" richColors />
    <header className="topbar">
      <a className="brand" href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`}><span className="brand-symbol"><Cog /></span>ЗАЦЕПЛЕНИЕ<span className="brand-version">LAB</span></a>
      <span className="top-context">Модель и изготовление</span>
      <button className="text-button header-reference" onClick={() => setReference(true)}><BookOpen size={20} /> Справочник</button>
    </header>
    <main className="workbench">
      <section className="workbench-model" aria-label="Текущая модель">
        <div className="ready-heading">
          <h1>{updating ? 'Пересчитываем модель…' : mesh ? 'Ваша модель готова' : 'Уточните параметры модели'}</h1>
          <div className="model-chips"><span className="model-family">{modelNames[params.kind]}</span>
            <span className="parameter-chip">{isWorm ? 'z₁' : 'z'} <strong>{fmt(isWorm ? params.wormStarts ?? 1 : params.teeth, 0)}</strong></span>
            <span className="parameter-chip">{moduleSymbol} <strong>{fmt(params.module)} мм</strong></span>
            <span className="parameter-chip">{isWorm ? 'L' : 'b'} <strong>{fmt(params.width)} мм</strong></span>
          </div>
          {mode === 'photo' && <p className="photo-model-note" role="note">Здесь показана текущая модель. Параметры фото появятся после подтверждения и применения.</p>}
        </div>
        <GearViewer mesh={mesh} error={error} />
      </section>

      <section className="source-panel" ref={editorRef} aria-label="Параметры и исходные данные">
        <button className="panel-disclosure" aria-expanded={parametersOpen} aria-controls="parameter-editor" onClick={() => setParametersOpen(v => !v)}>
          <span><ScanLine size={22} /> Параметры и исходные данные</span><ChevronDown size={20} className={parametersOpen ? 'is-open' : ''} />
        </button>
        <dl className="parameter-summary">
          <div><dt>Тип зацепления</dt><dd>{modelNames[params.kind]}</dd></div>
          <div><dt>{isWorm ? 'Число заходов' : 'Число зубьев'}</dt><dd>{isWorm ? 'z₁' : 'z'}&nbsp; {fmt(isWorm ? params.wormStarts ?? 1 : params.teeth, 0)}</dd></div>
          <div><dt>{isBevel ? 'Внешний модуль' : isWorm ? 'Осевой модуль' : isHelicalKind(params.kind) ? 'Нормальный модуль' : 'Модуль'}</dt><dd>{moduleSymbol}&nbsp; {fmt(params.module)} мм</dd></div>
          <div><dt>{isBevel ? 'По образующей' : isWorm ? 'Длина нарезки' : 'Ширина'}</dt><dd>{isWorm ? 'L' : 'b'}&nbsp; {fmt(params.width)} мм</dd></div>
          <div><dt>{internal ? 'Обод' : rack ? 'Основание' : 'Отверстие'}</dt><dd>{!internal && !rack && '⌀ '}{fmt(internal ? params.rimThickness ?? 3 * params.module : rack ? params.rackBaseHeight ?? 3 * params.module : params.bore)} мм</dd></div>
        </dl>
        <div className="source-actions">
          <button className={`secondary-button ${parametersOpen && mode === 'photo' ? 'chosen' : ''}`} onClick={() => openEditor('photo')}><Camera size={21} /> Восстановить по фото</button>
          <button className={`secondary-button ${parametersOpen && mode === 'manual' ? 'chosen' : ''}`} onClick={() => openEditor('manual')}><Pencil size={21} /> Задать вручную</button>
        </div>
        <div id="parameter-editor" className="source-editor" hidden={!parametersOpen}>
          {mode === 'photo' ? <PhotoWizard onApply={(p, source, facts) => {
            setParams({ ...defaultModel(p.kind), ...p }); setOrigin(source); setEvidence(facts); setMode('manual');
            toast.success('Параметры применены. Проверьте 3D-модель.');
          }} onManual={() => setMode('manual')} /> : <ParameterEditor params={params} onChange={change} onKind={selectKind}
            onHand={hand => { setParams(p => ({ ...p, wormHand: hand })); manual(); }} onReset={reset} onReference={() => setReference(true)} />}
        </div>
      </section>

      <aside className="delivery-panel" aria-label="Файлы и печать">
        <Tabs defaultValue="files" className="delivery-tabs">
          <TabsList className="delivery-tab-list"><TabsTrigger value="files"><FileText size={22} /> Файлы</TabsTrigger><TabsTrigger value="print"><Printer size={22} /> Печать</TabsTrigger></TabsList>
          <TabsContent value="files" className="delivery-content">
            <h2>Скачайте модель для своих задач</h2>
            <p className="delivery-intro">Оба варианта сохраняют аналитический профиль зуба. Детализация сетки не является подтверждением точности или прочности.</p>
            <fieldset className="package-options"><legend className="visually-hidden">Детализация STL</legend>
              <label className={`package-card ${preset === 'standard' ? 'selected' : ''}`}>
                <input type="radio" name="export-preset" value="standard" checked={preset === 'standard'} onChange={() => setPreset('standard')} />
                <div><strong>Standard STL — бесплатно</strong><p>Средняя детализация для просмотра и пробного изготовления.</p></div>
              </label>
              <label className={`package-card package-pro ${preset === 'pro' ? 'selected' : ''}`}>
                <input type="radio" name="export-preset" value="pro" checked={preset === 'pro'} onChange={() => setPreset('pro')} />
                <div><strong>Pro STL + паспорт</strong><p>Высокая детализация и параметры именно экспортируемой модели.</p>
                  <ul><li><Grid2X2 size={19} /> Детализация кривых</li><li><FileJson size={19} /> Паспорт параметров JSON</li><li><ShieldCheck size={19} /> Результат проверки сетки</li></ul>
                </div>
              </label>
            </fieldset>
            <div className="package-download">
              <p className="access-note">{preset === 'pro' ? 'Бесплатно в раннем доступе' : 'Бесплатно. Без регистрации.'}</p>
              <button className="primary-button full package-primary" disabled={!ready} onClick={() => openExport(preset)}>Скачать {preset === 'pro' ? 'Pro STL' : 'Standard STL'} <ArrowRight size={21} /></button>
              {preset === 'pro' && <button className="free-download" disabled={!ready} onClick={() => openExport('standard')}><Download size={19} /> Скачать бесплатный Standard STL</button>}
            </div>
            <button className="print-path" disabled={!ready} onClick={() => setPrint(true)}><Printer size={25} /><span><strong>Подготовить к печати</strong><small>Выберите материал, проверьте размеры и скачайте задание.</small></span><ChevronRight size={21} /></button>
            <p className="delivery-note"><Info size={20} /> Перед изготовлением проверьте размеры и сопряжение.</p>
          </TabsContent>
          <TabsContent value="print" className="delivery-content print-tab-content">
            <h2>От модели — к пробной детали</h2><p className="delivery-intro">Проверьте, подходит ли геометрия вашему FDM-принтеру, и сохраните задание для себя или исполнителя.</p>
            <div className="print-step"><span>01</span><div><strong>Габариты и толщина</strong><p>Стол, сопло, линии, слои и минимальные размеры зуба.</p></div></div>
            <div className="print-step"><span>02</span><div><strong>Материал и настройки</strong><p>Выберите материал пробной детали. Нагрузку и ресурс рассчитывают отдельно.</p></div></div>
            <div className="print-step"><span>03</span><div><strong>Задание на печать</strong><p>Файл JSON с параметрами, проверками и вопросами для исполнителя.</p></div></div>
            <button className="primary-button full package-primary" disabled={!ready} onClick={() => setPrint(true)}>Оценить печать <ArrowRight size={21} /></button>
            <p className="delivery-note"><Info size={20} /> Заказ и оплата не оформляются. Сейчас доступна оценка геометрии и скачивание задания.</p>
          </TabsContent>
        </Tabs>
      </aside>

      <section className="engineering-panel">
        <details className="engineering-details"><summary><span>{mesh ? <Check size={20} /> : <AlertTriangle size={20} />} Геометрия и проверка</span><span className="mesh-count">{validation ? `${fmt(validation.triangles, 0)} треугольников` : 'Требует уточнения'} <ChevronDown size={17} /></span></summary>
          <p className="origin-note">{origin}</p>
          {d ? <dl className="dimension-list"><Dimension label={rack ? 'Длина рейки' : isBevel ? 'Большой делительный диаметр' : 'Делительный диаметр'} value={rack ? d.rackLength : d.pitchDiameter} testId="pitch-diameter" />
            <Dimension label={rack ? 'Высота рейки' : isBevel ? 'Большой диаметр вершин' : 'Диаметр вершин'} value={rack ? d.rackHeight : d.tipDiameter} />
            {!rack && <Dimension label={isBevel ? 'Большой диаметр впадин' : 'Диаметр впадин'} value={d.rootDiameter} />}
            <Dimension label={isWorm ? 'Осевой шаг' : isBevel ? 'Внешний окружной шаг' : cycloidal ? 'Делительный шаг' : 'Торцевой шаг'} value={worm?.axialPitch ?? d.transverseCircularPitch} digits={3} />
            <Dimension label={isWorm ? 'Осевой размер вершины' : isBevel ? 'Хорда малой вершины' : cycloidal ? 'Дуга вершины' : 'Толщина вершины'} value={bevel?.innerTipChordThickness ?? worm?.axialTipThickness ?? d.tipThickness} digits={3} />
            {cycloidal && <><Dimension label="Производящий радиус" value={cycloidal.rollingRadius} /><div><dt>Постоянный угол α</dt><dd>Неприменим</dd></div></>}
            {worm && <><Dimension label="Ход витка" value={worm.lead} /><div><dt>Угол подъёма γ</dt><dd>{fmt(worm.leadAngleDeg)}°</dd></div></>}
            {bevel && <><div><dt>Делительный конус δ₁</dt><dd>{fmt(bevel.pitchConeAngleDeg)}°</dd></div><div><dt>Основной конус δᵦ</dt><dd>{fmt(bevel.baseConeAngleDeg)}°</dd></div><Dimension label="Конусное расстояние Rₑ" value={bevel.outerConeDistance} /><Dimension label="Малый модуль mᵢ" value={bevel.innerModule} digits={3} /><Dimension label="Высота по оси H" value={bevel.axialExtent} /></>}
            {['helical', 'herringbone', 'internal-helical', 'helical-rack'].includes(params.kind) && <Dimension label="Торцевой модуль" value={d.transverseModule} digits={3} />}
          </dl> : <p className="inline-error">{error}</p>}
          <div className="engineering-actions">
            <button className="secondary-button pair-button" disabled={!ready} onClick={() => setPairOpen(true)}><Link2 size={18} /> Проверить пару</button>
            <button className="secondary-button" disabled={!ready} onClick={downloadParams}><FileJson size={18} /> Паспорт текущей модели</button>
          </div>
          {mesh && <div className="calculation-details"><h3>Допущения модели</h3><ul>{mesh.warnings.map(w => <li className={w.severity} key={w.code}>{w.message}</li>)}</ul>
            {'cycloidalDiagnostics' in mesh && <p>Верхняя граница ошибки плоской хорды: {fmt(mesh.cycloidalDiagnostics.maxChordErrorBound, 5)} мм при допуске {fmt(mesh.cycloidalDiagnostics.profileTolerance, 4)} мм до Float32.</p>}
            {'bevelDiagnostics' in mesh && <p>Границы дискретизации до Float32: боковина {fmt(mesh.bevelDiagnostics.maxFlankChordErrorBound, 5)} мм; задний конус {fmt(mesh.bevelDiagnostics.maxEndCapErrorBound, 5)} мм при допуске {fmt(mesh.bevelDiagnostics.profileTolerance, 4)} мм.</p>}
            {mesh.profile.rootDiagnostics && <p>Выборочная ошибка хорды профиля: {fmt(mesh.profile.rootDiagnostics.maxSampledChordError, 5)} мм при заданном {fmt(mesh.profile.rootDiagnostics.profileTolerance, 3)} мм. Это не класс точности детали.</p>}
            <button className="inline-link" onClick={() => setReference(true)}>Подробнее о методе</button>
          </div>}
        </details>
      </section>
    </main>
    <footer className="page-footer"><span>ЗАЦЕПЛЕНИЕ <span className="muted">/ инженерная мастерская</span></span><span>Локальные вычисления · Миллиметры · Версия 0.5</span></footer>
    <ReferenceDialog open={reference} onOpenChange={setReference} />
    <PrintDialog open={print && ready} onOpenChange={setPrint} mesh={mesh} validation={validation} />
    <ExportDialog open={exportOpen && ready} onOpenChange={setExportOpen} params={params} preset={preset} origin={origin} evidence={evidence} />
    <PairDialog open={pairOpen && ready} onOpenChange={setPairOpen} params={params} />
  </div>;
}

function Dimension({ label, value, digits = 2, testId }: { label: string; value: number; digits?: number; testId?: string }) {
  return <div><dt>{label}</dt><dd data-testid={testId}>{fmt(value, digits)} мм</dd></div>;
}
