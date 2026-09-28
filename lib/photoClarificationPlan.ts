import { inferGearFromMeasurements, type InferenceField, type PhotoInferenceInput, type InferredGearKind, type TipDiameterMethod } from './photo-inference.ts';
import type { SpanApplication } from './spanMeasurement.ts';
import type { PhotoRegionEvidence } from './photo-region.ts';

export type PhotoPlanSpan = { mode: 'direct' } | { mode: 'pending' } | { mode: 'applied'; application: SpanApplication };
export interface PhotoClarificationContext {
  input: PhotoInferenceInput;
  selectedKind: string;
  enteredToothCount: string;
  toothCountConfirmed: boolean;
  familyReady: boolean;
  symmetricHerringbone: boolean;
  span: PhotoPlanSpan;
  analysisRegion?: PhotoRegionEvidence | null;
}
export interface PhotoPlanItem {
  id: InferenceField | 'module' | 'family' | 'span' | 'herringbone';
  title: string;
  action: string;
  problems: string[];
}
export interface PhotoPlanValue { label: string; value: string; note?: string }
export interface PhotoPlanMethod { id: 'photo-scale' | 'span'; title: string; description: string }
export interface PhotoClarificationPlan {
  status: 'needs-information' | 'needs-correction' | 'unsupported' | 'span-pending' | 'step-ready';
  route: PhotoPlanSpan['mode'];
  nextAction: string;
  items: PhotoPlanItem[];
  entered: PhotoPlanValue[];
  methods: PhotoPlanMethod[];
  scope: string;
}

const kindNames: Record<InferredGearKind, string> = {
  spur: 'Прямозубое колесо', helical: 'Косозубое колесо', herringbone: 'Шевронное колесо',
  internal: 'Внутреннее прямозубое', 'internal-helical': 'Внутреннее косозубое',
  rack: 'Прямозубая рейка', 'helical-rack': 'Косозубая рейка',
};
const isKnown = (kind: string): kind is InferredGearKind => Object.hasOwn(kindNames, kind);
const isRack = (kind: string) => kind === 'rack' || kind === 'helical-rack';
const isInternal = (kind: string) => kind === 'internal' || kind === 'internal-helical';
const isHelical = (kind: string) => ['helical', 'herringbone', 'internal-helical', 'helical-rack'].includes(kind);
const sources: Record<string, string> = { measurement: 'указаны измерения', drawing: 'указан чертёж / документация', user_confirmation: 'указана проверка пользователем' };
const diameterMethods: Record<string, string> = { tip_circle: 'восстановленная окружность', opposed_tips: 'противоположные вершины', uncorrected_caliper_span: 'размер штангенциркулем без коррекции' };
const number = (value: number): string => Number.isFinite(value) ? String(Object.is(value, -0) ? 0 : value) : 'некорректное число';
const scope = 'Это план только для шага «Масштаб и профиль». Размеры тела, построение и проверка модели выполняются далее. Памятка не является сохранённым проектом, чертежом или заказом; фотография в неё не входит. Файл создаётся на устройстве и не отправляется серверу.';

function instruction(field: PhotoPlanItem['id'], kind: string): Pick<PhotoPlanItem, 'title' | 'action'> {
  switch (field) {
    case 'kind': case 'family': return { title: 'Тип детали', action: 'Вернитесь на шаг «Тип и зубья»: осмотрите боковую поверхность и выберите семейство. При сомнении откройте «Помочь определить тип».' };
    case 'profileType': return { title: 'Профиль зубьев', action: 'Найдите обозначение профиля в чертеже, каталоге или документации детали. Если сведений нет, нужна проверка профиля по образцу. Одного торцевого фото недостаточно, чтобы подтвердить эвольвенту.' };
    case 'toothCount': return { title: 'Полное число зубьев', action: 'На шаге «Тип и зубья» пересчитайте полное число, включая повреждённые зубья, и отдельно подтвердите его. Предложение фотоанализа остаётся гипотезой.' };
    case 'tipDiameterMm': return { title: isInternal(kind) ? 'Диаметр внутренних вершин' : 'Диаметр вершин', action: isInternal(kind)
      ? 'Измерьте окружность вершин, направленных внутрь кольца. Наружный размер обода не подходит. Можно использовать «Измерить диаметр по фото» с эталоном в плоскости торца.'
      : 'Получите диаметр окружности вершин в миллиметрах. На шаге «Масштаб и профиль» доступно «Измерить диаметр по фото»: нужен эталон известной длины в плоскости торца и вид строго сверху.' };
    case 'tipDiameterMethod': return { title: 'Способ определения диаметра', action: 'Укажите, как получена именно окружность вершин. При нечётном числе зубьев противоположных одинаковых вершин нет: обычный размер штангенциркулем не равен автоматически диаметру. Подойдёт восстановленная окружность по корректной методике.' };
    case 'transversePitchMm': return { title: 'Шаг рейки', action: 'Измерьте расстояние вдоль перемещения рейки между одинаковыми точками нескольких зубьев и разделите на число промежутков. Введите результат в миллиметрах; это не ширина зуба.' };
    case 'helixAngleDeg': return { title: 'Угол и направление наклона β', action: 'Найдите угол на делительной поверхности в документации или определите его измерением. Сохраните знак направления. Наклон линии на фотографии без коррекции перспективы не подтверждает этот угол.' };
    case 'pressureAngleDeg': return { title: 'Угол профиля α', action: 'Найдите угол профиля в чертеже или документации либо определите отдельным измерением профиля. Диаметр и число зубьев его не устанавливают. Неизвестное значение не заменяйте на 20°.' };
    case 'profileShift': return { title: 'Смещение профиля x', action: kind === 'spur'
      ? 'Найдите коэффициент смещения в документации. Если он неизвестен, для этого прямозубого колеса можно воспользоваться «Измерим зубья» на шаге «Масштаб и профиль» — при известном угле профиля и выполненных условиях измерения. Неизвестное смещение не означает ноль.'
      : 'Найдите коэффициент нормального смещения в документации или уточните его измерением для этого семейства. Неизвестное смещение не означает ноль. Помощник общей нормали сейчас рассчитан только на наружное прямозубое колесо.' };
    case 'standardAddendum': return { title: 'Высота и состояние вершин', action: 'По документации или проверке профиля установите, что высота соответствует ha* = 1 и вершины не укорочены и не модифицированы. Отмечайте условие только при наличии основания; иначе для модели нужны дополнительные данные.' };
    case 'module': return { title: 'Размеры и единицы', action: 'Перепроверьте миллиметры, число зубьев, способ измерения и выбранное семейство. Если исходные данные верны, эта комбинация может выходить за область доступной модели.' };
    case 'herringbone': return { title: 'Устройство шеврона', action: 'Осмотрите обе половины: для этой модели они должны быть равны, с одинаковым модулем угла и без центральной канавки. Отдельно подтвердите условие в форме.' };
    case 'span': return { title: 'Измерение общей нормали', action: 'На шаге «Масштаб и профиль» откройте «Измерим зубья», завершите расчёт и явно примените выбранное решение. Либо выберите в этом помощнике возврат к прямому вводу. Прежние числа прямого ввода сейчас не используются.' };
  }
}

/** Read-only guidance: it never returns a parameter patch or changes any confirmation. */
export function buildPhotoClarificationPlan(context: PhotoClarificationContext): PhotoClarificationPlan {
  const { input, selectedKind: kind, span } = context;
  const known = isKnown(kind), rack = isRack(kind), usingSpan = span.mode !== 'direct';
  const items: PhotoPlanItem[] = [];
  const add = (id: PhotoPlanItem['id'], problem?: string) => {
    let item = items.find(value => value.id === id);
    if (!item) { item = { id, ...instruction(id, kind), problems: [] }; items.push(item); }
    if (problem && !item.problems.includes(problem)) item.problems.push(problem);
  };
  let unsupported = !known && kind !== 'unknown', correction = false;
  if (!known || input.kind?.value !== kind) add('kind', !known && kind !== 'unknown' ? 'Этот фото-расчёт не поддерживает выбранное семейство. Уточните тип или используйте подходящую ручную модель с её ограничениями.' : undefined);
  if (!context.familyReady) add('family', 'Ответы помощника типа ещё не применены. Завершите выбор или вернитесь к прямому списку на предыдущем шаге.');
  const z = input.toothCount?.value;
  if (!context.toothCountConfirmed || context.enteredToothCount.trim() === '' || Number(context.enteredToothCount) !== z
    || z === undefined || !Number.isInteger(z) || z < (rack ? 1 : 6) || z > 250) add('toothCount');

  // Applied span uses its representative readings, not stale direct measurements.
  // Pending span lists only the shared prerequisites; its own assistant owns Wk and Wk+1.
  let effective: PhotoInferenceInput = input;
  if (usingSpan) {
    effective = { kind: input.kind, profileType: input.profileType, toothCount: input.toothCount, standardAddendum: input.standardAddendum };
    if (kind !== 'spur') { add('span', 'Помощник общей нормали не применяется к этому семейству. Вернитесь к прямому вводу.'); unsupported = true; }
    if (span.mode === 'applied') {
      const app = span.application, p = app.candidate.parameters;
      const validApplication = app.schema === 'zatseplenie.span-measurement.v1' && p.kind === 'spur' && p.teeth === z && app.input.teeth === z
        && app.input.pressureAngleConfirmed && app.input.pressureAngleDeg === p.pressureAngleDeg
        && Object.values(app.input.confirmations).every(value => value === true)
        && Number.isFinite(p.module) && p.module >= .1 && p.module <= 30 && Number.isFinite(p.backlash) && p.backlash >= 0;
      if (!validApplication) { add('span', 'Применённое решение не соответствует текущим исходным данным. Пересчитайте и примените его заново.'); correction = true; }
      effective = { ...effective,
        tipDiameterMm: { value: app.candidate.representativeReadings.tipDiameterMm, source: 'measurement' },
        tipDiameterMethod: { value: app.input.tipDiameterMethod as TipDiameterMethod, source: 'measurement' },
        pressureAngleDeg: { value: p.pressureAngleDeg, source: 'user_confirmation' },
        profileShift: { value: p.profileShift, source: 'measurement' },
      };
    }
  }
  const result = inferGearFromMeasurements(effective);
  const shared = new Set<InferenceField>(['kind', 'profileType', 'toothCount', 'standardAddendum']);
  if (known) {
    for (const issue of result.issues) {
      if (usingSpan && span.mode === 'pending' && !shared.has(issue.field as InferenceField)) continue;
      correction = true;
      if (issue.code.startsWith('UNSUPPORTED')) unsupported = true;
      add(issue.field, issue.message);
      if (issue.code === 'INVALID_SOURCE') add(issue.field, 'В конце формы укажите действительный источник этих данных; сам выбор источника не проверяет значение.');
    }
    for (const question of result.missingQuestions) {
      if (!usingSpan || span.mode === 'applied' || shared.has(question.id)) add(question.id);
    }
    if (kind === 'herringbone' && !context.symmetricHerringbone) add('herringbone');
  }
  if (span.mode === 'pending') add('span');
  const entered: PhotoPlanValue[] = [
    { label: 'Семейство', value: known ? kindNames[kind] : kind === 'unknown' ? 'не выбрано' : 'другое / неподдержанное', note: context.familyReady ? 'выбор пользователя' : 'выбор помощника ещё не применён' },
    { label: rack ? 'Число зубьев участка' : 'Полное число зубьев', value: context.enteredToothCount || 'не введено', note: context.toothCountConfirmed && !items.some(item => item.id === 'toothCount') ? 'пользователь отметил проверку' : 'нужна отдельная проверка' },
    { label: 'Способ расчёта', value: span.mode === 'direct' ? 'прямой ввод' : span.mode === 'pending' ? 'общая нормаль — решение ещё не применено' : 'общая нормаль — выбранное решение применено' },
  ];
  const labels: Partial<Record<InferenceField, string>> = {
    profileType: 'Профиль', standardAddendum: 'ha* = 1, без укорочения вершин',
    tipDiameterMm: isInternal(kind) ? 'Диаметр внутренних вершин, мм' : 'Диаметр вершин, мм', tipDiameterMethod: 'Способ определения диаметра',
    transversePitchMm: 'Шаг вдоль перемещения рейки, мм', helixAngleDeg: 'Угол β на делительной поверхности, °',
    pressureAngleDeg: isHelical(kind) ? 'Нормальный угол αₙ, °' : 'Угол α, °', profileShift: 'Смещение xₙ',
  };
  const fieldOrder: InferenceField[] = ['profileType', 'standardAddendum', ...(rack ? ['transversePitchMm' as const] : ['tipDiameterMm' as const, 'tipDiameterMethod' as const]),
    ...(isHelical(kind) ? ['helixAngleDeg' as const] : []), 'pressureAngleDeg', 'profileShift'];
  for (const field of fieldOrder) {
    const fact = input[field];
    if (!fact) continue;
    const value = typeof fact.value === 'number' ? number(fact.value)
      : field === 'profileType' ? fact.value === 'involute' ? 'эвольвентный выбран пользователем' : 'другой профиль'
      : field === 'standardAddendum' ? fact.value === true ? 'отмечено пользователем' : 'условие не выполнено'
      : Object.hasOwn(diameterMethods, String(fact.value)) ? diameterMethods[String(fact.value)] : 'неизвестный способ';
    const inactive = usingSpan && !shared.has(field);
    entered.push({ label: labels[field]!, value, note: inactive ? 'прежний прямой ввод; не используется в выбранном маршруте'
      : `${Object.hasOwn(sources, fact.source) ? sources[fact.source] : 'источник некорректен'}${items.some(item => item.id === field) ? '; требуется уточнение' : ''}` });
  }
  if (kind === 'herringbone') entered.push({ label: 'Равные половины без канавки', value: context.symmetricHerringbone ? 'отмечено пользователем' : 'не подтверждено' });
  if (span.mode === 'applied') {
    const { input: raw, candidate } = span.application;
    entered.push({ label: 'Выбранное решение общей нормали', value: span.application.selected === 'bounded-zero-thinning-fit' ? 'согласование с нулевым утонением в пределах заданных ошибок' : 'обратный расчёт по исходным измерениям' },
      { label: `Общая нормаль по ${number(raw.spanTeeth)} зубьям, мм`, value: `${number(raw.spanMm)} ± ${number(raw.errorBounds.spanMm)}` },
      { label: `Общая нормаль по ${number(raw.spanTeeth + 1)} зубьям, мм`, value: `${number(raw.nextSpanMm)} ± ${number(raw.errorBounds.nextSpanMm)}` },
      { label: 'Исходный диаметр в помощнике, мм', value: `${number(raw.tipDiameterMm)} ± ${number(raw.errorBounds.tipDiameterMm)}` },
      { label: 'Диаметр принятого решения, мм', value: number(candidate.representativeReadings.tipDiameterMm) },
      { label: 'Угол в помощнике, °', value: raw.pressureAngleDeg === null ? 'не введён' : number(raw.pressureAngleDeg) },
      { label: 'Принятый модуль, мм', value: number(candidate.parameters.module), note: 'рассчитан в применённом решении общей нормали' },
      { label: 'Принятое смещение', value: number(candidate.parameters.profileShift) },
      { label: 'Принятое утонение, мм', value: number(candidate.parameters.backlash) });
  }
  if (context.analysisRegion) {
    const { region, workingImage, method } = context.analysisRegion;
    entered.push({ label: 'Фото для анализа', value: method === 'full-image' ? `полный рабочий кадр ${workingImage.width} × ${workingImage.height} px`
      : `область (${region.x}, ${region.y}), ${region.width} × ${region.height} px; полный кадр ${workingImage.width} × ${workingImage.height} px`, note: 'пиксели не являются миллиметрами; само изображение в памятку не включено' });
  }
  const methods: PhotoPlanMethod[] = [];
  if (known && !unsupported && !usingSpan && items.some(item => ['tipDiameterMm', 'tipDiameterMethod'].includes(item.id)))
    if (!rack) methods.push({ id: 'photo-scale', title: 'Диаметр по полному фото', description: 'На шаге «Масштаб и профиль» нажмите «Измерить диаметр по фото». Понадобятся эталон в плоскости торца, его известная длина и вид строго сверху. Выбранная область анализа не обрезает фото для измерения.' });
  if (kind === 'spur' && !unsupported && !usingSpan && items.some(item => ['profileShift', 'tipDiameterMm', 'tipDiameterMethod', 'pressureAngleDeg'].includes(item.id)))
    methods.push({ id: 'span', title: 'Если модуль и смещение неизвестны', description: 'На шаге «Масштаб и профиль» откройте «Измерим зубья». Нужны известный угол профиля, подтверждённая эвольвента и вершины, диаметр и две общие нормали по соседним числам зубьев. Используются плоские параллельные измерительные поверхности; помощник проверяет условия контакта.' });
  const ready = known && context.familyReady && items.length === 0 && result.status === 'ready' && span.mode !== 'pending';
  const status: PhotoClarificationPlan['status'] = ready ? 'step-ready' : unsupported ? 'unsupported' : correction ? 'needs-correction' : span.mode === 'pending' ? 'span-pending' : 'needs-information';
  return { status, route: span.mode, nextAction: ready
    ? 'Данные этого шага собраны. Проверьте размеры тела и модель перед скачиванием.'
    : items[0]?.action.split(/(?<=[.!?])\s/)[0] ?? 'Перепроверьте исходные данные и выбранный способ расчёта.', items, entered, methods, scope };
}

/** A human-readable local memo, not a project restore format or a model artifact. */
export function photoClarificationPlanMarkdown(plan: PhotoClarificationPlan): string {
  const text = (value: string) => value.replace(/\s+/g, ' ').replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');
  return [
    '# План уточнений для фото детали', '', 'Зацепление 0.12.0 · локальная памятка', '',
    '## Следующее действие', '', text(plan.nextAction), '',
    '## Введено сейчас', '', ...plan.entered.map(value => `- ${text(value.label)}: ${text(value.value)}${value.note ? ` (${text(value.note)})` : ''}.`), '',
    'Введённое значение и указанный источник сами по себе не доказывают правильность измерения.', '',
    '## Что осталось уточнить', '', ...(plan.items.length ? plan.items.flatMap((item, index) => [
      `${index + 1}. **${text(item.title)}.** ${text(item.action)}${item.problems.length ? ` ${item.problems.map(text).join(' ')}` : ''}`,
    ]) : ['Данные только этого шага собраны. Это не подтверждение готовности или пригодности всей детали.']), '',
    ...(plan.methods.length ? ['## Доступные способы', '', ...plan.methods.map(method => `- **${text(method.title)}.** ${text(method.description)}`), ''] : []),
    '## Границы памятки', '', text(plan.scope), '',
  ].join('\n');
}
