import { isHelicalKind, isInternalKind, isRackKind, modelNames, type ModelMesh } from './model.ts';
import type { prepareModelExport, ExportPreset } from './modelExport.ts';

export type Axis = 'X' | 'Y' | 'Z';
export type Projection = 'XY' | 'XZ' | 'YZ';
export type Bounds3 = { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] };
export type DimensionRow = { label: string; value: number | string; unit: string };
export interface ModelDocumentInput {
  stl: ArrayBuffer; filename: string; projectName: string; preset: ExportPreset; appVersion: string;
  passport: string; origin: string; warnings: string[]; notVerified: string[]; nominalRows: DimensionRow[]; volume: number;
}
export function modelDocumentInput(prepared: ReturnType<typeof prepareModelExport>, filename: string, projectName: string): ModelDocumentInput {
  if (!prepared.validation.valid || prepared.passport.artifact.purpose !== 'STL-export' || !prepared.passport.artifact.preset)
    throw new Error('Документы требуют проверенного экспорта STL.');
  return { stl: prepared.stl, filename, projectName, preset: prepared.passport.artifact.preset, appVersion: prepared.passport.appVersion,
    passport: JSON.stringify(prepared.passport, null, 2), origin: prepared.passport.origin,
    warnings: prepared.passport.warnings.map(w => w.message), notVerified: [...prepared.passport.notVerified],
    nominalRows: modelNominalRows(prepared.mesh), volume: prepared.validation.signedVolume };
}
export const dimensionText = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 6, useGrouping: false });

/** Read the deliverable bytes, not a preview or a separately reconstructed model. */
export function inspectDocumentSTL(stl: ArrayBuffer): { triangles: number; bounds: Bounds3 } {
  if (stl.byteLength < 84) throw new Error('STL слишком короткий для размерного листа.');
  const view = new DataView(stl), triangles = view.getUint32(80, true);
  if (!triangles || stl.byteLength !== 84 + 50 * triangles) throw new Error('Размер STL не соответствует числу граней.');
  const min: Bounds3['min'] = [Infinity, Infinity, Infinity], max: Bounds3['max'] = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < triangles; t++) for (let vertex = 0; vertex < 3; vertex++) for (let axis = 0; axis < 3; axis++) {
    const value = view.getFloat32(84 + t * 50 + 12 + vertex * 12 + axis * 4, true);
    if (!Number.isFinite(value)) throw new Error('В STL есть недопустимые координаты.');
    min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
  }
  const size = max.map((value, axis) => value - min[axis]) as Bounds3['size'];
  if (size.some(value => !(value > 0))) throw new Error('STL не имеет объёма по одной из осей.');
  return { triangles, bounds: { min, max, size } };
}

/** Same-oriented projected front faces form a nonzero-fill silhouette, including real openings.
 * No hull, resampling, guessed nominal circle, hidden-line drawing or section is substituted.
 */
export function projectSTLSilhouette(stl: ArrayBuffer, projection: Projection, bounds: Bounds3, boxWidth: number, boxHeight: number) {
  const axes: Record<Projection, [number, number]> = { XY: [0, 1], XZ: [0, 2], YZ: [1, 2] };
  const [u, v] = axes[projection], scale = Math.min(boxWidth / bounds.size[u], boxHeight / bounds.size[v]);
  if (!(Number.isFinite(scale) && scale > 0)) throw new Error('Недопустимая рамка проекции.');
  const width = bounds.size[u] * scale, height = bounds.size[v] * scale;
  const view = new DataView(stl), paths: string[] = [];
  for (let t = 0, count = view.getUint32(80, true); t < count; t++) {
    const base = 84 + t * 50 + 12;
    const points = [0, 1, 2].map(vertex => [view.getFloat32(base + vertex * 12 + u * 4, true), view.getFloat32(base + vertex * 12 + v * 4, true)]);
    const [a, b, c] = points;
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 0) continue;
    paths.push(points.map(([x, y], i) => `${i ? 'L' : 'M'}${((x - bounds.min[u]) * scale).toFixed(4)},${((bounds.max[v] - y) * scale).toFixed(4)}`).join('') + 'Z');
  }
  return { path: paths.join(''), width, height, scale, horizontal: projection[0] as Axis, vertical: projection[1] as Axis,
    horizontalSize: bounds.size[u], verticalSize: bounds.size[v] };
}

/** Nominal quantities keep their own tooth system and plane, separate from STL bounding sizes. */
export function modelNominalRows(mesh: ModelMesh): DimensionRow[] {
  const p = mesh.params, d = mesh.dimensions, rows: DimensionRow[] = [];
  const row = (label: string, value: number | string, unit = 'мм') => rows.push({ label, value, unit });
  const rack = isRackKind(p.kind), internal = isInternalKind(p.kind);
  row('Тип модели', modelNames[p.kind], '');
  row(p.kind === 'worm' ? 'Осевой модуль m_x' : p.kind === 'bevel' ? 'Внешний модуль m_e' : p.kind === 'cycloidal' ? 'Делительный модуль m' : 'Нормальный модуль m_n', p.module);
  if ('wormDimensions' in mesh) row('Число заходов', mesh.wormDimensions.starts, '');
  else row('Число зубьев z', p.teeth, '');
  row(p.kind === 'bevel' ? 'Ширина по образующей b' : p.kind === 'worm' ? 'Длина по оси' : rack ? 'Ширина рейки b' : 'Ширина венца b', p.width);
  if (!rack && !internal) row('Диаметр отверстия (номинал)', p.bore || 'Нет отверстия', p.bore ? 'мм' : '');
  if (rack) {
    row('Длина торцевого сечения', d.rackLength); row('Высота рейки', d.rackHeight);
    row('Торцевой шаг p_t', d.transverseCircularPitch); row('Осевое смещение торцов', d.rackAxialOffset);
    row('Основание под впадиной', p.rackBaseHeight ?? 3 * p.module);
  } else {
    const prefix = p.kind === 'bevel' ? 'Большой ' : '';
    row(`${prefix}делительный диаметр d`, d.pitchDiameter); row(`${prefix}диаметр вершин d_a`, d.tipDiameter);
    row(`${prefix}диаметр впадин d_f`, d.rootDiameter);
    if (internal) { row('Наружный диаметр обода', d.outsideDiameter); row('Обод за впадиной', (d.outsideDiameter - d.rootDiameter) / 2); }
  }
  if (p.kind !== 'cycloidal') row(p.kind === 'worm' ? 'Осевой угол профиля' : p.kind === 'bevel' ? 'Угол профиля (исходный)' : 'Нормальный угол профиля', p.pressureAngleDeg, '°');
  if (isHelicalKind(p.kind)) row(p.kind === 'herringbone' ? 'Угол первой половины шеврона' : 'Угол наклона зубьев', p.helixAngleDeg, '°');
  if (!['worm', 'bevel', 'cycloidal'].includes(p.kind)) row('Коэффициент смещения x_n', p.profileShift, '');
  row(p.kind === 'worm' ? 'Осевое утонение зуба' : p.kind === 'bevel' ? 'Утонение на большом торце' : p.kind === 'cycloidal' ? 'Утонение на делительной окружности' : 'Нормальное утонение зуба', p.backlash);
  if ('wormDimensions' in mesh) {
    const w = mesh.wormDimensions; row('Осевой шаг p_x', w.axialPitch); row('Ход витка (модуль)', w.lead);
    row('Направление', w.hand === 'right' ? 'Правое' : 'Левое', ''); row('Коэффициент диаметра q', w.diameterFactor, '');
  }
  if ('cycloidalDimensions' in mesh) { row('Радиус производящей окружности', mesh.cycloidalDimensions.rollingRadius); row('Постоянный угол профиля', 'Не применим', ''); }
  if ('bevelDimensions' in mesh) {
    const b = mesh.bevelDimensions;
    row('Зубья ответного колеса', b.mateTeeth, ''); row('Угол осей', b.shaftAngleDeg, '°'); row('Делительный конус', b.pitchConeAngleDeg, '°');
    row('Внешнее конусное расстояние', b.outerConeDistance); row('Малый модуль', b.innerModule); row('Малый делительный диаметр', b.innerPitchDiameter);
    row('Номинальная высота по оси', b.axialExtent);
  }
  if (mesh.internalCutterGeometry) {
    const c = mesh.internalCutterGeometry;
    row('Принятый долбяк: число зубьев', c.tool.teeth, ''); row('Принятый долбяк: радиус вершины', c.toolTipRadius);
    row('Принятый долбяк: утонение', c.tool.thinning);
  }
  return rows;
}
