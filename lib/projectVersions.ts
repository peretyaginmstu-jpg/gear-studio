import { APP_VERSION } from './appVersion.ts';
import { MAX_PROJECT_VERSIONS, type ProjectDocument, type ProjectSnapshot, type ProjectVersion } from './project.ts';
import { modelNames, isInternalKind, isRackKind, isHelicalKind, type ModelParams } from './model.ts';
import { defaultInternalCutter } from './generatedInternalRoot.ts';

export function addProjectVersion(project: ProjectDocument, name: string, note = '', reason: ProjectVersion['reason'] = 'named', date = new Date().toISOString()): ProjectDocument {
  if (!name.trim() || name.trim().length > 120) throw new Error('Название версии должно содержать от 1 до 120 символов.');
  if (note.trim().length > 1000) throw new Error('Заметка должна быть не длиннее 1000 символов.');
  if (project.versions.length >= MAX_PROJECT_VERSIONS) throw new Error('В проекте уже 100 версий. Скачайте архив и создайте отдельный проект для новых вариантов.');
  const version: ProjectVersion = { id: crypto.randomUUID(), name: name.trim(), note: note.trim(), reason,
    createdAt: date, appVersion: APP_VERSION, ...structuredClone({ journey: project.journey, forms: project.forms }) };
  return { ...project, appVersion: APP_VERSION, updatedAt: date, versions: [version, ...project.versions] };
}

/** A return is append-only: the prior working state is saved before replacing any inputs. */
export function restoreProjectVersion(project: ProjectDocument, versionId: string, date = new Date().toISOString()): ProjectDocument {
  const selected = project.versions.find(version => version.id === versionId);
  if (!selected) throw new Error('Эта версия не найдена. Откройте историю заново.');
  const backedUp = addProjectVersion(project, `До возврата · ${new Date(date).toLocaleTimeString('ru-RU')}`,
    `Текущая работа перед восстановлением версии «${selected.name}».`, 'before-restore', date);
  return { ...backedUp, ...structuredClone({ journey: selected.journey, forms: selected.forms }) };
}

export function copyProject(project: ProjectDocument, name = `${project.name.slice(0, 110)} (копия)`, date = new Date().toISOString()): ProjectDocument {
  return { ...structuredClone(project), id: crypto.randomUUID(), name, createdAt: date, updatedAt: date, appVersion: APP_VERSION };
}

export function forkProjectVersion(project: ProjectDocument, versionId?: string): ProjectDocument {
  const selected = versionId ? project.versions.find(version => version.id === versionId) : project;
  if (!selected) throw new Error('Эта версия не найдена. Откройте историю заново.');
  return copyProject({ ...project, journey: selected.journey, forms: selected.forms, versions: [] },
    versionId ? `${project.name.slice(0, 65)} — ${selected.name.slice(0, 50)}` : undefined);
}

export function snapshotParams(snapshot: ProjectSnapshot): ModelParams | null {
  const { built, mode, revision } = snapshot.journey;
  if (built && built.revision === revision && built.mode === mode) return built.params;
  return mode === 'manual' ? snapshot.journey.manualDraft : null;
}

export function snapshotDescription(snapshot: ProjectSnapshot): string {
  const mode = snapshot.journey.mode === 'photo' ? 'По фото' : snapshot.journey.mode === 'manual' ? 'Ручной ввод' : 'Способ ещё не выбран';
  const params = snapshotParams(snapshot);
  const hasModel = snapshot.journey.built && snapshot.journey.built.revision === snapshot.journey.revision && snapshot.journey.built.mode === snapshot.journey.mode;
  const values = params ? ` · ${modelNames[params.kind]} · ${params.kind === 'worm' ? `z₁ ${format(params.wormStarts ?? 1)}` : `z ${format(params.teeth)}`} · m ${format(params.module)} · b ${format(params.width)} мм` : '';
  return `${mode} · ${hasModel ? 'модель построена' : 'черновик'}${values}`;
}

// Labels cover the full ModelParams contract, so a less common manufacturing setting cannot disappear from comparison.
const labels: Record<keyof ModelParams, string> = {
  kind: 'Тип зацепления', teeth: 'Число зубьев', module: 'Модуль, мм', width: 'Ширина, мм', bore: 'Отверстие, мм',
  pressureAngleDeg: 'Угол профиля, °', helixAngleDeg: 'Угол наклона, °', profileShift: 'Смещение профиля', backlash: 'Утонение зуба, мм',
  rimThickness: 'Толщина обода, мм', rackBaseHeight: 'Основание рейки, мм', toolTipRadiusCoefficient: 'Радиус вершины инструмента / m',
  profileTolerance: 'Допуск профиля, мм', internalCutterTeeth: 'Зубья долбяка', internalCutterProfileShift: 'Смещение долбяка',
  internalCutterAddendumCoefficient: 'Высота головки долбяка / m', internalCutterTipRadiusCoefficient: 'Радиус долбяка / m', internalCutterThinning: 'Утонение долбяка, мм',
  wormStarts: 'Заходы червяка', wormDiameterFactor: 'Коэффициент диаметра червяка', wormHand: 'Направление червяка',
  cycloidRollingRadius: 'Производящая окружность, мм', bevelMateTeeth: 'Зубья ответного конического колеса', bevelShaftAngleDeg: 'Угол осей, °',
};

function format(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'number' && !Number.isFinite(value)) return 'Не задано';
  if (typeof value === 'number') return String(value).replace('.', ',');
  if (value === 'right') return 'Правое';
  if (value === 'left') return 'Левое';
  return String(value);
}

function applies(key: keyof ModelParams, params: ModelParams): boolean {
  const { kind } = params;
  if (key.startsWith('worm')) return kind === 'worm';
  if (key.startsWith('bevel')) return kind === 'bevel';
  if (key.startsWith('internalCutter')) return kind === 'internal';
  if (key === 'cycloidRollingRadius') return kind === 'cycloidal';
  if (key === 'rimThickness') return isInternalKind(kind);
  if (key === 'rackBaseHeight') return isRackKind(kind);
  if (key === 'toolTipRadiusCoefficient') return ['spur', 'helical', 'herringbone'].includes(kind);
  if (key === 'helixAngleDeg') return isHelicalKind(kind);
  if (key === 'bore') return !isInternalKind(kind) && !isRackKind(kind);
  if (key === 'teeth') return kind !== 'worm';
  if (key === 'pressureAngleDeg') return kind !== 'cycloidal';
  if (key === 'profileShift') return !['worm', 'cycloidal', 'bevel'].includes(kind);
  return true;
}

function comparisonValue(params: ModelParams, key: keyof ModelParams): unknown {
  if (!applies(key, params)) return 'Не применяется';
  if (params[key] !== undefined) return params[key];
  if (key in defaultInternalCutter) return defaultInternalCutter[key as keyof typeof defaultInternalCutter];
  if (key === 'toolTipRadiusCoefficient') return .3;
  if (key === 'rimThickness' || key === 'rackBaseHeight') return 3 * params.module;
  if (key === 'cycloidRollingRadius') return Math.min(2 * params.module, params.module * params.teeth / 4);
  if (key === 'bevelMateTeeth') return params.teeth;
  if (key === 'bevelShaftAngleDeg') return 90;
  if (key === 'wormStarts') return 1;
  if (key === 'wormDiameterFactor') return 10;
  if (key === 'wormHand') return 'right';
  return undefined;
}
export function compareProjectSnapshots(saved: ProjectSnapshot, current: ProjectSnapshot) {
  const before = snapshotParams(saved), after = snapshotParams(current);
  const changes = before && after ? (Object.keys(labels) as (keyof ModelParams)[])
    .filter(key => !Object.is(comparisonValue(before, key), comparisonValue(after, key)))
    .map(key => ({ key, label: labels[key], before: key === 'kind' ? modelNames[before.kind] : format(comparisonValue(before, key)),
      after: key === 'kind' ? modelNames[after.kind] : format(comparisonValue(after, key)) })) : [];
  return { changes, canCompareParams: !!before && !!after,
    modeChanged: saved.journey.mode !== current.journey.mode,
    photoChanged: saved.forms.photo?.values.image !== current.forms.photo?.values.image,
    inputsChanged: JSON.stringify(saved.forms) !== JSON.stringify(current.forms),
  };
}
