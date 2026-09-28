import type { ModelKind } from './model.ts';
import type { InferredGearKind } from './photo-inference.ts';

/** Observations only. None of these answers identify the tooth profile or a numeric parameter. */
export interface FamilyAnswers {
  partnerGroup?: 'toothed' | 'flexible' | 'spline' | 'unknown';
  partner?: 'gear-rack' | 'worm' | 'pins' | 'belt' | 'chain' | 'unknown';
  body?: 'external-cylinder' | 'internal-ring' | 'rack' | 'cone' | 'screw' | 'face' | 'unknown';
  direction?: 'straight' | 'inclined' | 'opposed' | 'unknown';
  coneDirection?: 'straight' | 'curved' | 'unknown';
  screwPartner?: 'wheel' | 'nut' | 'unknown';
}
export type FamilyQuestionId = keyof FamilyAnswers;
export interface FamilyQuestion { id: FamilyQuestionId; title: string; hint: string; options: { value: string; label: string; detail?: string }[] }
export interface FamilyPhotoHint {
  type: 'external_circular' | 'internal_ring' | 'linear_rack' | 'undetermined';
  evidence?: string;
}
export type FamilyStatus = 'question' | 'proposal' | 'limited-manual' | 'needs-inspection' | 'unsupported' | 'contradictory';
export interface FamilyDecision {
  status: FamilyStatus;
  answers: FamilyAnswers;
  route: FamilyQuestionId[];
  nextQuestion: FamilyQuestion | null;
  family: string | null;
  title: string;
  modelKind: ModelKind | null;
  photoKind: InferredGearKind | null;
  reasons: string[];
  conflicts: { code: string; source: 'answers' | 'photo'; blocking: boolean; message: string }[];
  nextSteps: string[];
  limitations: string[];
  notDetermined: readonly string[];
  photoHint: FamilyPhotoHint | null;
}
export const familyNotDetermined = ['tooth-profile', 'pressure-angle', 'helix-angle-and-hand', 'module', 'profile-shift',
  'tooth-count', 'tooth-thinning', 'material', 'generating-tool', 'pair-compatibility'] as const;
const unknown = { value: 'unknown', label: 'Не знаю / не видно' };
const questions: Record<FamilyQuestionId, FamilyQuestion> = {
  partnerGroup: { id: 'partnerGroup', title: 'Что соприкасается с этими зубьями?',
    hint: 'Речь о зубьях, которые нужно восстановить. Отверстие со шлицами в центре — другое соединение.', options: [
      { value: 'toothed', label: 'Другая жёсткая деталь с зубьями или витком', detail: 'Колесо, рейка, червяк или ролики' },
      { value: 'flexible', label: 'Ремень или цепь' }, { value: 'spline', label: 'Ответные шлицы вала или втулки', detail: 'Детали соединяются соосно, без обкатывания зубьев' }, unknown] },
  partner: { id: 'partner', title: 'Какая именно ответная деталь?', hint: 'Если механизм разобран и второй детали нет, можно продолжить по форме вашей детали.', options: [] },
  body: { id: 'body', title: 'Где расположены рабочие зубья?', hint: 'Осмотрите деталь спереди и сбоку. Круглый силуэт сам по себе ещё не определяет тип.', options: [
    { value: 'external-cylinder', label: 'Снаружи цилиндрического колеса', detail: 'Зубчатый обод примерно одного диаметра по всей ширине' },
    { value: 'internal-ring', label: 'Внутри кольца' }, { value: 'rack', label: 'Вдоль прямой планки' },
    { value: 'cone', label: 'На сужающемся коническом ободе' }, { value: 'screw', label: 'Непрерывный винтовой виток' },
    { value: 'face', label: 'На плоском торце, вокруг оси', detail: 'Не на цилиндрическом ободе' }, unknown] },
  direction: { id: 'direction', title: 'Как идут зубья при взгляде сбоку?', hint: 'Нужен вид вдоль ширины. По одной фотографии торца наклон не подтверждается.', options: [
    { value: 'straight', label: 'Прямо, без наклона по ширине', detail: 'У колеса — параллельно его оси' },
    { value: 'inclined', label: 'В одном наклонном направлении' },
    { value: 'opposed', label: 'Две встречные наклонные половины' }, unknown] },
  coneDirection: { id: 'coneDirection', title: 'Как выглядят зубья на конусе?', hint: 'Конус определяет форму тела, но не способ построения боковин зуба.', options: [
    { value: 'straight', label: 'Прямые, направлены к вершине конуса' }, { value: 'curved', label: 'Изогнутые или спиральные' }, unknown] },
  screwPartner: { id: 'screwPartner', title: 'С чем работает винтовой виток?', hint: 'Это помогает отличить червяк от винта или резьбового соединения.', options: [
    { value: 'wheel', label: 'С зубчатым колесом сбоку' }, { value: 'nut', label: 'С гайкой или резьбовой втулкой' }, unknown] },
};
export function familyQuestion(id: FamilyQuestionId, answers: FamilyAnswers): FamilyQuestion {
  if (id !== 'partner') return questions[id];
  return { ...questions.partner, options: answers.partnerGroup === 'flexible' ? [
    { value: 'belt', label: 'Зубчатый ремень' }, { value: 'chain', label: 'Цепь' }, unknown,
  ] : [{ value: 'gear-rack', label: 'Другое зубчатое колесо или рейка' },
    { value: 'worm', label: 'Червяк — винтовая деталь' }, { value: 'pins', label: 'Отдельные ролики или цевки' }, unknown] };
}
/** Route depends only on supplied observations, never on the image candidate. */
function routeFor(a: FamilyAnswers): FamilyQuestionId[] {
  const route: FamilyQuestionId[] = ['partnerGroup'];
  if (!a.partnerGroup || a.partnerGroup === 'spline') return route;
  if (a.partnerGroup !== 'unknown') {
    route.push('partner');
    if (!a.partner || a.partnerGroup === 'flexible' || a.partner === 'pins') return route;
  }
  route.push('body');
  if (['external-cylinder', 'internal-ring', 'rack'].includes(a.body ?? '') && a.partner !== 'worm') route.push('direction');
  else if (a.body === 'cone' && a.partner !== 'worm') route.push('coneDirection');
  else if (a.body === 'screw') route.push('screwPartner');
  return route;
}
/** Real answer edits drop all later answers; navigation and repeated identical answers do not. */
export function changeFamilyAnswer<K extends FamilyQuestionId>(answers: FamilyAnswers, id: K, value: NonNullable<FamilyAnswers[K]>): FamilyAnswers {
  const route = routeFor(answers), index = route.indexOf(id);
  if (index < 0 || !familyQuestion(id, answers).options.some(o => o.value === value)) throw new Error('Ответ не относится к текущему вопросу.');
  if (answers[id] === value) return { ...answers };
  const next: FamilyAnswers = {};
  for (const key of route.slice(0, index)) Object.assign(next, { [key]: answers[key] });
  Object.assign(next, { [id]: value });
  return next;
}
const labels: Partial<Record<ModelKind, string>> = {
  spur: 'Наружное прямозубое колесо', helical: 'Наружное косозубое колесо', herringbone: 'Наружное шевронное колесо',
  internal: 'Внутреннее прямозубое колесо', 'internal-helical': 'Внутреннее косозубое колесо',
  rack: 'Прямозубая рейка', 'helical-rack': 'Косозубая рейка',
};
export function identifyFamily(input: FamilyAnswers, photoHint: FamilyPhotoHint | null = null): FamilyDecision {
  const route = routeFor(input), answers: FamilyAnswers = {};
  const conflicts: FamilyDecision['conflicts'] = [];
  for (const key of Object.keys(input) as FamilyQuestionId[]) {
    if (input[key] === undefined) continue;
    if (!route.includes(key) || !familyQuestion(key, input)?.options.some(o => o.value === input[key])) {
      conflicts.push({ code: 'INAPPLICABLE_ANSWER', source: 'answers', blocking: true,
        message: 'Ответы относятся к разным веткам помощника. Уточните ранний ответ и пройдите подходящие вопросы заново.' });
    } else Object.assign(answers, { [key]: input[key] });
  }
  const nextId = route.find(id => !answers[id]);
  const r: FamilyDecision = { status: nextId ? 'question' : 'needs-inspection', answers, route,
    nextQuestion: nextId ? familyQuestion(nextId, answers) : null, family: null, title: 'Нужно осмотреть деталь', modelKind: null,
    photoKind: null, reasons: [], conflicts, nextSteps: [], limitations: [
      'Ответы описывают форму и расположение зубьев. Эвольвента или иной профиль, углы, размеры и материал здесь не подтверждаются.',
    ], notDetermined: familyNotDetermined, photoHint: photoHint ? { ...photoHint } : null };
  const stop = (status: FamilyStatus, family: string, title: string, nextSteps: string[]) => {
    r.status = status; r.family = family; r.title = title; r.nextSteps = nextSteps; return finish(r);
  };
  if (conflicts.length) return stop('contradictory', 'unresolved', 'Уточните сочетание ответов', ['Вернитесь к первому отличающемуся ответу. Это не заключение о физической невозможности механизма.']);
  if (nextId) return finish(r);
  if (answers.partnerGroup === 'spline') return stop('unsupported', 'spline', 'Похоже на шлицевое соединение', [
    'Найдите обозначение на валу, втулке или чертеже: стандарт, число шлицев, диаметры и посадка.',
    'Проверьте форму шлица — прямобочная, эвольвентная или другая. Обычное колесо не заменяет шлицевое соединение.',
  ]);
  if (answers.partnerGroup === 'flexible') return stop(answers.partner === 'unknown' ? 'needs-inspection' : 'unsupported',
    answers.partner === 'belt' ? 'timing-pulley' : answers.partner === 'chain' ? 'sprocket' : 'flexible-drive',
    answers.partner === 'belt' ? 'Нужен профиль зубчатого шкива' : answers.partner === 'chain' ? 'Нужна звёздочка под цепь' : 'Сначала отличим ремень от цепи',
    answers.partner === 'belt' ? ['Прочитайте маркировку ремня: семейство профиля и шаг; измерьте ширину ремня и посчитайте зубья шкива.', 'Шкив не подменяется эвольвентным колесом.'] : answers.partner === 'chain'
      ? ['Найдите обозначение цепи; измерьте шаг между осями шарниров и диаметр ролика, определите число рядов.', 'Звёздочка требует отдельной геометрии впадин под эту цепь.']
      : ['Посмотрите на ответную деталь: цельная гибкая лента или цепь с отдельными шарнирами. Сфотографируйте её маркировку.']);
  if (answers.partner === 'pins') return stop('unsupported', 'pin-gear', 'Зацепление с роликами или цевками', [
    'Посчитайте цевки, измерьте их диаметр и окружность центров; найдите сведения об эксцентриситете и профиле ответной детали.',
    'Циклоидальное колесо приложения не является универсальным профилем под любые цевки.',
  ]);
  if (answers.body === 'unknown') return stop('needs-inspection', 'unresolved', 'Нужен вид расположения зубьев', ['Сделайте снимок спереди и сбоку, чтобы были видны рабочая поверхность и ось. При возможности добавьте ответную деталь.']);
  if (answers.body === 'face') return stop('unsupported', 'face-gear', 'Торцовое или корончатое зацепление', [
    'Уточните по чертежу положение осей и профиль торцовых зубьев, сфотографируйте ответную деталь.', 'Торцовые зубья не подменяются цилиндрическим или обычным коническим колесом.',
  ]);
  if (answers.partner === 'worm' && answers.body === 'external-cylinder') return stop('unsupported', 'worm-wheel', 'Это может быть червячное колесо', [
    'Нужны параметры сопряжённого червяка, межосевое расстояние и форма зубьев колеса.', 'Модель ZA в приложении строит сам червяк. Косозубое колесо не заменяет червячное.',
  ]);
  if (answers.partner === 'worm' && answers.body !== 'screw') {
    r.conflicts.push({ code: 'MATE_BODY_UNRESOLVED', source: 'answers', blocking: true,
      message: 'Эта ответная деталь и указанная форма не позволяют выбрать одну из доступных моделей. Уточните, какая деталь восстанавливается и где находятся её зубья.' });
    return stop('contradictory', 'unresolved', 'Нужно уточнить рабочее соединение', ['Осмотрите обе детали и расположение их осей. Нестандартный механизм может требовать отдельной модели.']);
  }
  if (answers.body === 'screw') {
    if (answers.screwPartner === 'nut' && ['gear-rack', 'worm'].includes(answers.partner ?? '')) {
      r.conflicts.push({ code: 'SCREW_MATE_CONFLICT', source: 'answers', blocking: true,
        message: 'Ранее указана зубчатая ответная деталь, затем — гайка. Ответы не позволяют выбрать одну модель: уточните, что соприкасается именно с восстанавливаемым витком.' });
      return stop('contradictory', 'unresolved', 'Уточните ответную деталь', ['Вернитесь к вопросу об ответной детали. Если на детали несколько соединений, рассматривайте каждое отдельно.']);
    }
    if (answers.screwPartner === 'nut') return stop('unsupported', 'threaded-connection', 'Винт или резьбовое соединение', ['Найдите стандарт и обозначение резьбы; измерьте шаг, диаметр, число заходов и направление.', 'Червяк ZA не заменяет винт с гайкой.']);
    if (answers.screwPartner !== 'wheel') return stop('needs-inspection', 'screw-unresolved', 'Виток ещё не определяет червяк', ['Уточните ответную деталь: колесо сбоку или гайка вдоль оси. Нужны также шаг, направление и профиль витка.']);
    if (answers.partner === 'worm') {
      r.conflicts.push({ code: 'SCREW_MATE_CONFLICT', source: 'answers', blocking: true, message: 'Сначала указана винтовая ответная деталь, затем — колесо. Уточните ответную деталь именно этих витков.' });
      return stop('contradictory', 'unresolved', 'Уточните ответную деталь', ['Вернитесь к вопросу об ответной детали.']);
    }
    r.modelKind = 'worm'; r.reasons.push('Вы указали непрерывный виток, работающий с колесом сбоку.');
    r.limitations.push('Предлагается только ручная модель архимедова червяка ZA. Наблюдения не доказывают профиль ZA исходной детали или совместимость с её колесом.');
    return stop('limited-manual', 'worm', 'Можно задать ручную модель червяка ZA', ['Проверьте тип червяка по документации, осевой модуль, число заходов, направление и параметры пары.']);
  }
  if (answers.body === 'cone') {
    if (answers.coneDirection !== 'straight') return stop(answers.coneDirection === 'curved' ? 'unsupported' : 'needs-inspection', 'bevel-unresolved',
      answers.coneDirection === 'curved' ? 'Конические зубья изогнуты' : 'Нужен вид зубьев на конусе', ['Уточните прямые или криволинейные зубья, тип профиля и расположение осей по документации. Spiral, octoid, Gleason и гипоидная геометрия здесь не строятся.']);
    r.modelKind = 'bevel'; r.reasons.push('Вы указали коническое тело с прямыми зубьями.');
    r.limitations.push('Предлагается только ручная сферическая эвольвента. Она не подтверждает профиль исходной детали и не воспроизводит автоматически octoid, Gleason или производящий процесс.');
    return stop('limited-manual', 'straight-bevel', 'Можно задать сферическую эвольвенту', ['Нужны числа зубьев пары, угол осей, внешний модуль, угол профиля и ширина по образующей. Сверьте модель с требуемой системой зубьев.']);
  }
  if (answers.direction === 'unknown') return stop('needs-inspection', 'direction-unresolved', 'Нужен боковой вид зубьев', ['Осмотрите всю ширину: зубья идут прямо, в одну сторону или двумя встречными половинами. Не выбирайте прямозубое только по торцу.']);
  if (answers.direction === 'opposed' && answers.body !== 'external-cylinder') return stop('unsupported', answers.body === 'rack' ? 'opposed-rack' : 'opposed-internal', 'Встречные половины в этом исполнении не поддержаны', ['Уточните размеры половин и наличие средней канавки. Наружное шевронное колесо не заменяет внутреннее колесо или рейку.']);
  const kind = answers.body === 'external-cylinder' ? answers.direction === 'straight' ? 'spur' : answers.direction === 'inclined' ? 'helical' : 'herringbone'
    : answers.body === 'internal-ring' ? answers.direction === 'straight' ? 'internal' : 'internal-helical'
      : answers.body === 'rack' ? answers.direction === 'straight' ? 'rack' : 'helical-rack' : null;
  if (!kind) return stop('needs-inspection', 'unresolved', 'Недостаточно признаков', ['Осмотрите форму и боковой вид зубьев.']);
  r.modelKind = kind; r.photoKind = kind; r.reasons.push(`Расположение: ${familyQuestion('body', answers).options.find(o => o.value === answers.body)!.label.toLocaleLowerCase('ru')}.`,
    `Направление: ${familyQuestion('direction', answers).options.find(o => o.value === answers.direction)!.label.toLocaleLowerCase('ru')}.`);
  if (answers.partnerGroup === 'unknown' || answers.partner === 'unknown') r.limitations.push('Ответная деталь неизвестна. Предложение основано только на форме; назначение и сопряжение нужно проверить отдельно.');
  if (kind === 'herringbone') r.limitations.push('Модель использует равные встречные половины без средней канавки. В фото-пути это потребуется подтвердить отдельно.');
  return stop('proposal', kind, labels[kind]!, ['Отдельно подтвердите систему профиля и задайте размеры. Для косых зубьев измерьте угол и направление наклона; совместимость пары проверяется отдельно.']);
}
function finish(r: FamilyDecision): FamilyDecision {
  const expected = r.photoHint?.type === 'external_circular' ? 'external-cylinder' : r.photoHint?.type === 'internal_ring' ? 'internal-ring' : r.photoHint?.type === 'linear_rack' ? 'rack' : null;
  if (expected && r.answers.body && r.answers.body !== 'unknown' && r.answers.body !== expected) r.conflicts.push({
    code: 'PHOTO_OBSERVATION_DIFFERENCE', source: 'photo', blocking: false,
    message: 'Контур на фото предложил другое расположение зубьев. Проверьте, видны ли именно рабочие зубья: блик, отверстие или ракурс могли изменить силуэт. Ваш осмотр не отменяется автоматически.',
  });
  return r;
}
export interface FamilyApplication {
  schema: 'zatseplenie.family-selection.v1';
  method: 'guided-observations' | 'limited-manual-model';
  source: 'manual' | 'photo';
  modelKind: ModelKind;
  acceptedByUser: true;
  limitedModelAcknowledged: boolean;
  decision: FamilyDecision;
}
/** Only this explicit operation creates accepted evidence. Re-evaluate, rather than trusting a caller's proposal. */
export function selectFamilyApplication(answers: FamilyAnswers, source: 'manual' | 'photo', photoHint: FamilyPhotoHint | null = null,
  acknowledgeLimitedModel = false): FamilyApplication {
  const decision = identifyFamily(answers, photoHint);
  if (!decision.modelKind || !['proposal', 'limited-manual'].includes(decision.status) || decision.conflicts.some(c => c.blocking))
    throw new Error('Пока нельзя выбрать семейство. Уточните признаки детали.');
  if (decision.status === 'limited-manual' && !acknowledgeLimitedModel) throw new Error('Отдельно подтвердите ограниченную ручную модель.');
  return structuredClone({ schema: 'zatseplenie.family-selection.v1', method: decision.status === 'limited-manual' ? 'limited-manual-model' : 'guided-observations',
    source, modelKind: decision.modelKind, acceptedByUser: true, limitedModelAcknowledged: decision.status === 'limited-manual', decision });
}
export const familyApplicationMatches = (a: FamilyApplication, kind: ModelKind) => a.acceptedByUser === true && a.modelKind === kind;
export function familyMemo(answers: FamilyAnswers, photoHint: FamilyPhotoHint | null = null) {
  return { schema: 'zatseplenie.family-memo.v1', purpose: 'Локальная памятка осмотра. Не заявка, не заказ и не подтверждённая модель.',
    decision: structuredClone(identifyFamily(answers, photoHint)), acceptedByUser: false };
}
