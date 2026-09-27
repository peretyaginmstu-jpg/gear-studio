/** A point in the continuous pixel coordinate system of the working image. */
export interface PhotoPoint { readonly x: number; readonly y: number }
export interface PhotoScaleInput {
  referencePoints: readonly PhotoPoint[];
  tipPoints: readonly PhotoPoint[];
  referenceLengthMm?: number;
  /** Symmetric bound on the known reference length, not a standard deviation. */
  referenceToleranceMm?: number;
  confirmedCoplanar: boolean;
  confirmedAxialView: boolean;
  imageWidth: number;
  imageHeight: number;
  /** Euclidean displacement bound for EACH selected point; defaults to 1 px. */
  pixelUncertaintyPx?: number;
}
export interface PhotoCircle {
  center: PhotoPoint;
  radiusPx: number;
  diameterPx: number;
}
export interface PhotoScaleUncertainty {
  kind: 'conditional_pixel_bound';
  pixelUncertaintyPx: number;
  lowerDiameterMm: number;
  upperDiameterMm: number;
  maxRelativeDeviation: number;
  includesReferenceTolerance: boolean;
}
export interface PhotoScaleIssue {
  code: string;
  field: keyof PhotoScaleInput | 'geometry' | 'uncertainty';
  message: string;
}
interface PhotoScaleBase {
  issues: PhotoScaleIssue[];
  warnings: string[];
  missingFields: (keyof PhotoScaleInput)[];
  circle?: PhotoCircle;
  scaleMmPerPixel?: number;
  uncertainty?: PhotoScaleUncertainty;
}
export type PhotoScaleReadyResult = PhotoScaleBase & {
  status: 'ready'; diameterMm: number; circle: PhotoCircle;
  scaleMmPerPixel: number; uncertainty: PhotoScaleUncertainty;
};
export type PhotoScaleResult = PhotoScaleReadyResult | (PhotoScaleBase & { status: 'missing' | 'rejected'; diameterMm?: never });

export const photoScaleSources = [
  { title: 'MathWorks — Measuring Planar Objects with a Calibrated Camera',
    url: 'https://www.mathworks.com/help/vision/ug/measuring-planar-objects-with-a-calibrated-camera.html' },
  { title: 'MathWorks — What Is Camera Calibration?',
    url: 'https://www.mathworks.com/help/vision/ug/camera-calibration.html' },
] as const;

export const photoScaleLimits = { minimumReferencePx: 20, minimumReferenceErrorRatio: 20,
  minimumCoverageDeg: 150, minimumNeighborDeg: 20, maximumRelativeDeviation: .2 } as const;

type Interval = { lo: number; hi: number };
const bits = new DataView(new ArrayBuffer(8));
/** Directed rounding prevents ordinary floating point roundoff narrowing the bounds. */
function up(value: number): number {
  if (value === Infinity || Number.isNaN(value)) return value;
  if (value === 0) return Number.MIN_VALUE;
  bits.setFloat64(0, value);
  bits.setBigUint64(0, bits.getBigUint64(0) + (value > 0 ? BigInt(1) : -BigInt(1)));
  return bits.getFloat64(0);
}
const down = (value: number) => -up(-value);
const exact = (value: number): Interval => ({ lo: value, hi: value });
const add = (a: Interval, b: Interval): Interval => ({ lo: down(a.lo + b.lo), hi: up(a.hi + b.hi) });
const subtract = (a: Interval, b: Interval): Interval => ({ lo: down(a.lo - b.hi), hi: up(a.hi - b.lo) });
function multiply(a: Interval, b: Interval): Interval {
  const products = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
  return { lo: down(Math.min(...products)), hi: up(Math.max(...products)) };
}
function square(a: Interval): Interval {
  return { lo: a.lo <= 0 && a.hi >= 0 ? 0 : Math.max(0, down(Math.min(a.lo * a.lo, a.hi * a.hi))),
    hi: up(Math.max(a.lo * a.lo, a.hi * a.hi)) };
}
function absolute(a: Interval): Interval {
  return { lo: a.lo <= 0 && a.hi >= 0 ? 0 : Math.min(Math.abs(a.lo), Math.abs(a.hi)),
    hi: Math.max(Math.abs(a.lo), Math.abs(a.hi)) };
}
function vector(a: PhotoPoint, b: PhotoPoint) {
  return { x: subtract(exact(b.x), exact(a.x)), y: subtract(exact(b.y), exact(a.y)) };
}
function distanceInterval(a: PhotoPoint, b: PhotoPoint): Interval {
  const v = vector(a, b), squared = add(square(v.x), square(v.y));
  return { lo: Math.max(0, down(Math.sqrt(Math.max(0, squared.lo)))), hi: up(Math.sqrt(squared.hi)) };
}
const distance = (a: PhotoPoint, b: PhotoPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const finitePositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Stable circumcircle using translated, normalized coordinates. */
function circumcircle(points: readonly PhotoPoint[]): PhotoCircle | undefined {
  const [a, b, c] = points, size = Math.max(distance(a, b), distance(a, c), distance(b, c));
  if (!(size > 0) || !Number.isFinite(size)) return;
  const ux = (b.x - a.x) / size, uy = (b.y - a.y) / size;
  const vx = (c.x - a.x) / size, vy = (c.y - a.y) / size;
  const cross = ux * vy - uy * vx;
  if (Math.abs(cross) < 1e-8) return;
  const uu = ux * ux + uy * uy, vv = vx * vx + vy * vy;
  const x = (uu * vy - vv * uy) / (2 * cross), y = (ux * vv - vx * uu) / (2 * cross);
  const radiusPx = Math.hypot(x, y) * size;
  const center = { x: a.x + x * size, y: a.y + y * size };
  if (![center.x, center.y, radiusPx].every(Number.isFinite)) return;
  return { center, radiusPx, diameterPx: 2 * radiusPx };
}

/**
 * Conservative analytic enclosure, not samples of perturbed points.
 * D_px = abc / |u × v|. Every chord changes by at most 2ε and
 * |Δ(u × v)| ≤ 2ε(|u|+|v|)+4ε². Choose the tightest valid anchor bound.
 * Multiply that enclosure by [(L−t)/(s+2ε), (L+t)/(s−2ε)].
 * These are conditional image-coordinate bounds; camera/plane errors are excluded.
 */
function diameterBound(input: PhotoScaleInput, epsilon: number, nominalMm: number): PhotoScaleUncertainty | undefined {
  const [a, b, c] = input.tipPoints, sides = [distanceInterval(a, b), distanceInterval(a, c), distanceInterval(b, c)];
  const u = vector(a, b), v = vector(a, c);
  const cross = absolute(subtract(multiply(u.x, v.y), multiply(u.y, v.x)));
  const delta = multiply(exact(2), exact(epsilon));
  const crossError = Math.min(...[[0, 1], [0, 2], [1, 2]].map(([i, j]) =>
    add(multiply(delta, add(sides[i], sides[j])), square(delta)).hi));
  const areaLow = down(cross.lo - crossError), areaHigh = up(cross.hi + crossError);
  const ref = distanceInterval(input.referencePoints[0], input.referencePoints[1]);
  const refLow = down(ref.lo - delta.hi), refHigh = up(ref.hi + delta.hi);
  if (!(areaLow > 0 && refLow > 0)) return;
  const sideBounds = sides.map(s => ({ lo: Math.max(0, down(s.lo - delta.hi)), hi: up(s.hi + delta.hi) }));
  const product = sideBounds.reduce(multiply, exact(1));
  const diameterLowPx = Math.max(0, down(product.lo / areaHigh)), diameterHighPx = up(product.hi / areaLow);
  const length = input.referenceLengthMm!, tolerance = input.referenceToleranceMm ?? 0;
  const scaleLow = Math.max(0, down(down(length - tolerance) / refHigh)), scaleHigh = up(up(length + tolerance) / refLow);
  const lowerDiameterMm = Math.max(0, down(diameterLowPx * scaleLow)), upperDiameterMm = up(diameterHighPx * scaleHigh);
  const maxRelativeDeviation = up(Math.max(up(nominalMm - lowerDiameterMm), up(upperDiameterMm - nominalMm)) / nominalMm);
  if (![lowerDiameterMm, upperDiameterMm, maxRelativeDeviation].every(Number.isFinite)) return;
  return { kind: 'conditional_pixel_bound', pixelUncertaintyPx: epsilon, lowerDiameterMm, upperDiameterMm,
    maxRelativeDeviation, includesReferenceTolerance: input.referenceToleranceMm !== undefined };
}

export function estimatePhotoCircle(input: PhotoScaleInput): PhotoScaleResult {
  const issues: PhotoScaleIssue[] = [], missingFields: (keyof PhotoScaleInput)[] = [];
  const warnings = [
    'Интервал условен: каждая выбранная точка должна отличаться от правильной не более чем на заданный радиус в пикселях.',
    'Перспектива, дисторсия объектива, разная высота эталона и торца, повреждения и выбор неверной окружности в интервал не входят.',
    'Три точки всегда задают окружность: совпадение разметки с кругом не подтверждает эвольвентный профиль и точность изготовления.',
  ];
  if (input.referenceToleranceMm === undefined) warnings.push('Допуск длины эталона не задан и в интервал не включён.');
  const reject = (code: string, field: PhotoScaleIssue['field'], message: string) => issues.push({ code, field, message });
  const epsilon = input.pixelUncertaintyPx ?? 1;
  if (!finitePositive(input.imageWidth) || !finitePositive(input.imageHeight))
    reject('INVALID_IMAGE_SIZE', 'imageWidth', 'Нужны положительные конечные размеры рабочего изображения.');
  if (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0)
    reject('INVALID_PIXEL_UNCERTAINTY', 'pixelUncertaintyPx', 'Ошибка точки должна быть конечным неотрицательным числом в пикселях.');
  if (input.confirmedCoplanar !== true) missingFields.push('confirmedCoplanar');
  if (input.confirmedAxialView !== true) missingFields.push('confirmedAxialView');
  if (input.referenceLengthMm === undefined) missingFields.push('referenceLengthMm');
  else if (!finitePositive(input.referenceLengthMm)) reject('INVALID_REFERENCE_LENGTH', 'referenceLengthMm', 'Длина эталонного отрезка должна быть больше нуля.');
  if (input.referenceToleranceMm !== undefined && (typeof input.referenceToleranceMm !== 'number' || !Number.isFinite(input.referenceToleranceMm) || input.referenceToleranceMm < 0 || (finitePositive(input.referenceLengthMm) && input.referenceToleranceMm >= input.referenceLengthMm)))
    reject('INVALID_REFERENCE_TOLERANCE', 'referenceToleranceMm', 'Допуск эталона должен быть неотрицательным и меньше его длины.');
  for (const [field, maximum] of [['referencePoints', 2], ['tipPoints', 3]] as const) {
    const points = input[field];
    if (!Array.isArray(points) || points.length > maximum) { reject('INVALID_POINT_COUNT', field, `Нужно ${maximum} точки для ${field === 'referencePoints' ? 'эталона' : 'окружности'}.`); continue; }
    if (points.length < maximum) missingFields.push(field);
    if (points.some(p => !p || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > input.imageWidth || p.y > input.imageHeight))
      reject('POINT_OUTSIDE_IMAGE', field, 'Все точки должны находиться в пределах рабочего изображения.');
  }
  const base: PhotoScaleBase = { issues, warnings, missingFields };
  const finish = (): PhotoScaleResult => ({ ...base, status: issues.length ? 'rejected' : 'missing' });
  if (issues.length) return finish();
  let referencePx: number | undefined;
  if (input.referencePoints.length === 2) {
    referencePx = distance(input.referencePoints[0], input.referencePoints[1]);
    if (referencePx < Math.max(photoScaleLimits.minimumReferencePx, photoScaleLimits.minimumReferenceErrorRatio * epsilon))
      reject('REFERENCE_TOO_SHORT', 'referencePoints', 'Выберите более длинный эталон: минимум 20 пикселей и 20 радиусов ошибки точки.');
    else if (input.referenceLengthMm !== undefined) base.scaleMmPerPixel = input.referenceLengthMm / referencePx;
  }
  if (input.tipPoints.length === 3) {
    const circle = circumcircle(input.tipPoints);
    if (!circle) reject('DEGENERATE_CIRCLE', 'tipPoints', 'Точки совпадают или почти лежат на одной прямой. Выберите вершины в разных частях колеса.');
    else {
      base.circle = circle;
      const angles = input.tipPoints.map(p => (Math.atan2(p.y - circle.center.y, p.x - circle.center.x) + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
      const gaps = angles.map((angle, i) => ((i === 2 ? angles[0] + 2 * Math.PI : angles[i + 1]) - angle) * 180 / Math.PI);
      if (Math.min(...gaps) < photoScaleLimits.minimumNeighborDeg - 1e-9 || 360 - Math.max(...gaps) < photoScaleLimits.minimumCoverageDeg - 1e-9)
        reject('TIP_POINTS_CLUSTERED', 'tipPoints', 'Разнесите вершины по окружности: охват не меньше 150°, соседние точки не ближе 20°.');
      const margin = Math.max(input.imageWidth, input.imageHeight) * 1e-10;
      if (circle.center.x - circle.radiusPx < -margin || circle.center.y - circle.radiusPx < -margin || circle.center.x + circle.radiusPx > input.imageWidth + margin || circle.center.y + circle.radiusPx > input.imageHeight + margin)
        reject('CIRCLE_OUTSIDE_IMAGE', 'geometry', 'Окружность выходит за кадр. Нужен снимок, на котором выбранная окружность видна целиком.');
    }
  }
  if (issues.length || !base.circle || base.scaleMmPerPixel === undefined || referencePx === undefined) return finish();
  const diameterMm = base.circle.diameterPx * base.scaleMmPerPixel;
  if (!finitePositive(diameterMm) || !finitePositive(base.scaleMmPerPixel)) {
    reject('NUMERIC_RANGE', 'geometry', 'Масштаб или диаметр выходит за вычислимый диапазон.'); return finish();
  }
  const uncertainty = diameterBound(input, epsilon, diameterMm);
  if (!uncertainty) { reject('UNBOUNDED_UNCERTAINTY', 'uncertainty', 'При указанной ошибке точек устойчивый интервал диаметра не получается. Увеличьте масштаб или разнесите точки.'); return finish(); }
  base.uncertainty = uncertainty;
  if (uncertainty.maxRelativeDeviation > photoScaleLimits.maximumRelativeDeviation)
    reject('UNCERTAINTY_TOO_HIGH', 'uncertainty', 'Условный интервал отклоняется от диаметра более чем на 20%. Нужен более крупный снимок, длинный эталон или более точная разметка.');
  if (issues.length || missingFields.length) return finish();
  return { ...base, status: 'ready', diameterMm, circle: base.circle, scaleMmPerPixel: base.scaleMmPerPixel, uncertainty };
}
