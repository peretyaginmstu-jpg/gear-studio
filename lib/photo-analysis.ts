/**
 * Local, deterministic silhouette analysis; no AI service and no metrological claim.
 * Input: a single isolated object, face-on, fully visible, on a plain background.
 * Accept ImageData directly. No DOM, canvas, package, or network dependency.
 */
export type ImageDataLike = { width: number; height: number; data: ArrayLike<number> };
export type PhotoCandidateType = 'external_circular' | 'internal_ring' | 'linear_rack' | 'undetermined';
export type ExpertQuestion = {
  id: string; label: string; reason: string; options?: string[];
};
export type PhotoDamageHypothesis = {
  status: 'requires_independent_confirmation';
  method: 'robust-period-template-v1';
  /** Hypothesis of the complete count, never an observed or confirmed count. */
  toothCount: number;
  boundary: 'outer' | 'inner';
  supportedTeeth: number;
  /** Fraction of expected tooth cells matching the template, not a visibility probability. */
  visibleToothFraction: number;
  candidatePitchDeg: number;
  /** RMS deviation of observed supported-tooth spacings / their expected spacings. */
  pitchScatterFraction: number;
  /** RMS template residual on supported cells / median template height. */
  templateErrorFraction: number;
  damagedSectors: { startDeg: number; endDeg: number; wrapsZero: boolean; estimatedToothCells: number; evidence: string }[];
  evidence: string[];
};
export type PhotoAnalysis = {
  /** Even a good silhouette is a proposal, never engineering acceptance. */
  status: 'proposal_requires_confirmation' | 'damage_hypothesis_requires_confirmation' | 'manual_required';
  candidateTypes: { type: PhotoCandidateType; confidence: number; evidence: string }[];
  /** Heuristic signal quality, not a calibrated probability of correctness. */
  confidence: number;
  /** Null unless all image gates and periodicity gates pass. User must confirm. */
  toothCount: number | null;
  /** Separate, incomplete evidence from mostly repeated contours with local material deficits. */
  damageHypothesis: PhotoDamageHypothesis | null;
  /** Pixel diameter in the ORIGINAL image; not a dimension in mm. */
  outsideDiameterPx: number | null;
  centerPx: { x: number; y: number } | null;
  moduleMm: null;
  warnings: string[];
  expertQuestions: ExpertQuestion[];
  diagnostics: {
    algorithm: 'silhouette-radial-v2-damage'; processedWidth: number; processedHeight: number;
    contrast: number; aspectRatio: number | null; clipped: boolean;
    backgroundSpread: number; foregroundFraction: number;
    outerPeriodicity: number; innerPeriodicity: number;
    /** Tooth suggestion before image quality rejection, useful for debugging only. */
    ungatedToothCandidate: number | null;
  };
};

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const average = (a: ArrayLike<number>) => {
  let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i]; return sum / (a.length || 1);
};
const deviation = (a: ArrayLike<number>, mean = average(a)) => {
  let sum = 0; for (let i = 0; i < a.length; i++) sum += (a[i] - mean) ** 2;
  return Math.sqrt(sum / (a.length || 1));
};
const quantile = (values: number[], q: number) => {
  const a = values.slice().sort((x, y) => x - y); return a[Math.floor((a.length - 1) * q)] ?? 0;
};

export function getExpertQuestions(type: PhotoCandidateType = 'undetermined', toothCount: number | null = null): ExpertQuestion[] {
  return [
    { id: 'type', label: 'Где расположены зубья и с чем зацепляется деталь?',
      reason: 'Силуэт не доказывает тип зацепления. Звёздочка, шлиц и зубчатое колесо могут выглядеть похоже.',
      options: ['Снаружи цилиндра', 'Внутри кольца', 'На прямой рейке', 'На конусе', 'Червяк / червячное колесо', 'Цепная звёздочка', 'Не знаю'] },
    { id: 'tooth_count', label: toothCount ? `Подтвердите число зубьев: на контуре найдено ${toothCount}.` : 'Сколько зубьев у колеса? Посчитайте их или сделайте чёткий снимок строго спереди.',
      reason: type === 'linear_rack' ? 'У рейки нужен шаг и длина зубчатого участка; число видимых зубьев не определяет модуль.' : 'Пропущенный или сломанный зуб, блик и перекрытие меняют результат.' },
    { id: 'outside_diameter', label: type === 'internal_ring' ? 'Измерьте диаметры по вершинам и впадинам внутренних зубьев, а также наружный диаметр кольца, в мм.' : 'Какой наружный диаметр по вершинам зубьев в мм? Измерьте его инструментом.',
      reason: 'Пиксели не задают физический масштаб. Для нечётного числа зубьев обычный замер штангенциркулем требует поправки или другого метода.' },
    { id: 'teeth_direction', label: 'На виде сбоку зубья прямые, наклонные или шевронные? Если наклонные — какой угол и направление?',
      reason: 'Один торцевой снимок не отличает надёжно прямозубое колесо от косозубого.', options: ['Прямые', 'Наклонные', 'Шевронные', 'Не знаю'] },
    { id: 'profile', label: 'Известны профиль зуба, угол зацепления, стандарт и маркировка?',
      reason: 'Эвольвента, циклоидальный профиль и специальные профили требуют разной математики.', options: ['Эвольвентный, 20°', 'Эвольвентный, другой угол', 'Циклоидальный', 'Не знаю'] },
    { id: 'profile_shift', label: 'Подтверждены стандартная высота зуба и нулевое смещение профиля x = 0?',
      reason: 'Формула m = da / (z + 2) применима только при этих условиях к внешнему прямозубому колесу.', options: ['Подтверждены по чертежу / стандарту', 'Есть смещение или нестандартный профиль', 'Неизвестно'] },
    { id: 'axial_dimensions', label: 'Каковы ширина венца, диаметр отверстия, ступица, шпоночный паз и фаски в мм?',
      reason: 'Торцевой силуэт не определяет осевые размеры и посадки.' },
    { id: 'mate', label: 'Известны ответное колесо, межосевое расстояние и требуемый боковой зазор?',
      reason: 'Эти данные помогают проверить совместимость и не заменяются совпадением внешнего вида.' },
    { id: 'use', label: 'Это макет или рабочая передача? Укажите нагрузку, обороты, температуру, материал и модель принтера.',
      reason: 'Возможность геометрической печати не подтверждает ресурс, прочность или допустимую нагрузку.' },
  ];
}

function otsu(hist: Uint32Array, total: number): number {
  let sum = 0; for (let i = 0; i < hist.length; i++) sum += i * hist[i];
  let left = 0, leftSum = 0, best = -1, threshold = 0;
  for (let i = 0; i < hist.length - 1; i++) {
    left += hist[i]; leftSum += i * hist[i];
    if (!left || left === total) continue;
    const delta = leftSum / left - (sum - leftSum) / (total - left);
    const between = left * (total - left) * delta * delta;
    if (between > best) { best = between; threshold = i; }
  }
  return threshold;
}

function largestComponent(raw: Uint8Array, w: number, h: number) {
  const visited = new Uint8Array(raw.length), queue = new Int32Array(raw.length);
  let largest: number[] = [], totalForeground = 0;
  for (let seed = 0; seed < raw.length; seed++) {
    if (!raw[seed]) continue;
    totalForeground++;
    if (visited[seed]) continue;
    let head = 0, tail = 0; queue[tail++] = seed; visited[seed] = 1;
    while (head < tail) {
      const i = queue[head++], x = i % w, y = Math.floor(i / w);
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && raw[j] && !visited[j]) { visited[j] = 1; queue[tail++] = j; }
      }
    }
    if (tail > largest.length) largest = Array.from(queue.subarray(0, tail));
  }
  const mask = new Uint8Array(raw.length);
  let minX = w, maxX = 0, minY = h, maxY = 0, sx = 0, sy = 0;
  for (const i of largest) {
    mask[i] = 1; const x = i % w, y = Math.floor(i / w);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y); sx += x; sy += y;
  }
  return { mask, count: largest.length, totalForeground, minX, maxX, minY, maxY, sx, sy };
}

type SpectralPeak = { k: number; power: number; phase: number };
type PeriodResult = { toothCount: number | null; score: number; amplitude: number; bestFrequency: number | null; peaks: SpectralPeak[] };
function circularPeriod(profile: Float64Array): PeriodResult {
  const n = profile.length, mean = average(profile);
  const residual = Float64Array.from(profile, x => x - mean);
  // Remove slow variation to expose tooth frequency, but reject tilt separately.
  for (let k = 1; k <= 4; k++) {
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) { const t = 2 * Math.PI * k * i / n; a += residual[i] * Math.cos(t); b += residual[i] * Math.sin(t); }
    a *= 2 / n; b *= 2 / n;
    for (let i = 0; i < n; i++) { const t = 2 * Math.PI * k * i / n; residual[i] -= a * Math.cos(t) + b * Math.sin(t); }
  }
  const totalVariance = deviation(residual) ** 2;
  const amplitude = quantile(Array.from(residual), .95) - quantile(Array.from(residual), .05);
  if (amplitude < Math.max(2.5, mean * .012) || totalVariance < .7) return { toothCount: null, score: 0, amplitude, bestFrequency: null, peaks: [] };
  const maxZ = Math.min(160, Math.floor(2 * Math.PI * mean / 8));
  const powers: SpectralPeak[] = [];
  for (let k = 6; k <= maxZ; k++) {
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) { const t = 2 * Math.PI * k * i / n; a += residual[i] * Math.cos(t); b += residual[i] * Math.sin(t); }
    a *= 2 / n; b *= 2 / n; powers.push({ k, power: (a * a + b * b) / 2, phase: Math.atan2(b, a) });
  }
  powers.sort((a, b) => b.power - a.power);
  const best = powers[0]; if (!best) return { toothCount: null, score: 0, amplitude, bestFrequency: null, peaks: [] };
  const explained = clamp(best.power / totalVariance);
  // A second non-harmonic frequency indicates damage, competing objects or noise.
  const alternative = powers.find(p => p.k !== best.k && p.k % best.k !== 0)?.power ?? 0;
  const distinctness = clamp(1 - alternative / Math.max(best.power, 1e-9));
  let correlationNumerator = 0, correlationDenominator = 0;
  const period = n / best.k;
  for (let i = 0; i < n; i++) {
    const shifted = (i + period) % n, j = Math.floor(shifted), t = shifted - j;
    const value = residual[j] * (1 - t) + residual[(j + 1) % n] * t;
    correlationNumerator += residual[i] * value; correlationDenominator += residual[i] ** 2;
  }
  const repeatability = clamp(correlationNumerator / Math.max(correlationDenominator, 1e-9));
  const toothHeights: number[] = [];
  for (let tooth = 0; tooth < best.k; tooth++) {
    const center = ((best.phase / (2 * Math.PI) + tooth) * period + n) % n;
    let lo = Infinity, hi = -Infinity;
    for (let j = -Math.floor(period / 2); j <= Math.floor(period / 2); j++) {
      const v = residual[(Math.round(center + j) + 2 * n) % n]; lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    toothHeights.push(hi - lo);
  }
  const heightCV = deviation(toothHeights) / Math.max(average(toothHeights), 1e-9);
  const score = clamp(.4 * explained + .35 * repeatability + .25 * distinctness);
  const minimumRelativeHeight = Math.min(...toothHeights) / Math.max(quantile(toothHeights, .5), 1e-9);
  const valid = explained > .35 && repeatability > .75 && distinctness > .7 && heightCV < .22 && minimumRelativeHeight > .5;
  return { toothCount: valid ? best.k : null, score: valid ? score : Math.min(score, .49), amplitude, bestFrequency: best.k,
    peaks: powers.slice(0, 6).filter(peak => peak.power >= best.power * .2) };
}

/**
 * A second, deliberately separate route for a predominantly intact contour.
 * A spectrum only proposes periods. Median-folded tooth templates, individual
 * cell residuals, observed peak spacings and the sign/locality of lost material
 * must independently support one unambiguous period. Image gates are unchanged.
 */
type DamagePeriodResult = { hypothesis: PhotoDamageHypothesis; centerShift: { x: number; y: number } };
function recenteredRadialProfile(profile: Float64Array, dx: number, dy: number): Float64Array | null {
  const tau = 2 * Math.PI, count = profile.length;
  const points = Array.from(profile, (radius, index) => {
    const angle = index * tau / count, x = radius * Math.cos(angle) - dx, y = radius * Math.sin(angle) - dy;
    return { x, y, angle: (Math.atan2(y, x) + tau) % tau, radius: Math.hypot(x, y) };
  });
  // Do not sort a folded/re-entrant contour into an invented one-ray boundary.
  // The corrected center must keep every sampled edge angularly forward.
  if (points.some((point, index) => {
    const next = points[(index + 1) % count];
    return point.x * next.y - point.y * next.x <= 0;
  })) return null;
  points.sort((a, b) => a.angle - b.angle);
  const wrapped = [{ ...points[count - 1], angle: points[count - 1].angle - tau }, ...points, { ...points[0], angle: points[0].angle + tau }];
  const result = new Float64Array(count); let segment = 0;
  for (let index = 0; index < count; index++) {
    const angle = index * tau / count;
    while (wrapped[segment + 1].angle < angle) segment++;
    const a = wrapped[segment], b = wrapped[segment + 1];
    // Intersect the new ray with the sampled contour chord. This adjusts both
    // angle and radius; merely removing a sinusoidal radius does not fix phase.
    result[index] = a.radius * b.radius * Math.sin(b.angle - a.angle)
      / (b.radius * Math.sin(b.angle - angle) + a.radius * Math.sin(angle - a.angle));
  }
  return result;
}
function damagedPeriod(profile: Float64Array, spectral: PeriodResult, boundary: 'outer' | 'inner', refineCenter = true): DamagePeriodResult | null {
  const n = profile.length, bins = 40, sign = boundary === 'outer' ? 1 : -1;
  const sample = (index: number) => {
    const wrapped = ((index % n) + n) % n, lower = Math.floor(wrapped), fraction = wrapped - lower;
    return sign * (profile[lower] * (1 - fraction) + profile[(lower + 1) % n] * fraction);
  };
  const candidates: DamagePeriodResult[] = [];
  for (const peak of spectral.peaks) {
    const z = peak.k, period = n / z, phase = peak.phase + (sign < 0 ? Math.PI : 0);
    const center = phase / (2 * Math.PI) * period;
    const rawCells: number[][] = [], baselineSamples: { angle: number; value: number }[] = [];
    for (let tooth = 0; tooth < z; tooth++) {
      const raw = Array.from({ length: bins }, (_, bin) => sample(center + (tooth + bin / (bins - 1) - .5) * period));
      const left = quantile(raw.slice(0, 4), .5), right = quantile(raw.slice(-4), .5);
      rawCells.push(raw); baselineSamples.push({ angle: (center + tooth * period) * 2 * Math.PI / n, value: (left + right) / 2 });
    }
    // Center/bounding-box error gives a slow first-harmonic baseline. Fit it
    // from the least-deviating 70% of cell edges, without normalizing each
    // damaged cell to its own low edge (which would hide missing fragments).
    let coefficients = [quantile(baselineSamples.map(point => point.value), .5), 0, 0];
    const predict = (angle: number) => coefficients[0] + coefficients[1] * Math.cos(angle) + coefficients[2] * Math.sin(angle);
    for (let iteration = 0; iteration < 5; iteration++) {
      const retained = baselineSamples.map(point => ({ ...point, error: Math.abs(point.value - predict(point.angle)) }))
        .sort((a, b) => a.error - b.error).slice(0, Math.max(6, Math.ceil(z * .7)));
      const matrix = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
      for (const point of retained) {
        const row = [1, Math.cos(point.angle), Math.sin(point.angle)];
        for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) matrix[i][j] += row[i] * row[j]; matrix[i][3] += row[i] * point.value; }
      }
      let solvable = true;
      for (let column = 0; column < 3; column++) {
        let pivot = column;
        for (let row = column + 1; row < 3; row++) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
        if (Math.abs(matrix[pivot][column]) < 1e-8) { solvable = false; break; }
        [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
        const divisor = matrix[column][column];
        for (let j = column; j < 4; j++) matrix[column][j] /= divisor;
        for (let row = 0; row < 3; row++) if (row !== column) {
          const factor = matrix[row][column];
          for (let j = column; j < 4; j++) matrix[row][j] -= factor * matrix[column][j];
        }
      }
      if (solvable) coefficients = matrix.map(row => row[3]);
    }
    const dx = coefficients[1] / sign, dy = coefficients[2] / sign, displacement = Math.hypot(dx, dy);
    if (refineCenter && peak === spectral.peaks[0] && displacement > .3 && displacement < average(profile) * .04) {
      const recentered = recenteredRadialProfile(profile, dx, dy);
      if (recentered && Array.from(recentered).every(value => Number.isFinite(value) && value > 0)) {
        const revised = damagedPeriod(recentered, circularPeriod(recentered), boundary, false);
        if (revised?.hypothesis.toothCount === z) { candidates.push({ hypothesis: revised.hypothesis, centerShift: { x: dx, y: dy } }); continue; }
      }
    }
    const cells = rawCells.map((raw, tooth) => raw.map((radius, bin) =>
      radius - predict((center + (tooth + bin / (bins - 1) - .5) * period) * 2 * Math.PI / n)));
    const template = Array.from({ length: bins }, (_, bin) => quantile(cells.map(cell => cell[bin]), .5));
    const base = quantile(template, .05), height = quantile(template, .95) - base;
    if (height < Math.max(2.5, average(profile) * .012)) continue;
    // A doubled/subharmonic period may have two peaks per cell. It is not a
    // one-tooth template even if a Fourier harmonic happens to be prominent.
    let peaks = 0, above = false;
    for (const value of template) {
      const current = value > base + .45 * height;
      if (current && !above) peaks++;
      above = current;
    }
    if (peaks !== 1 || template[0] > base + .3 * height || template[bins - 1] > base + .3 * height) continue;
    const supported: { index: number; offset: number; error: number }[] = [], damaged: number[] = [];
    let unexplained = false;
    for (let tooth = 0; tooth < z; tooth++) {
      const cell = cells[tooth], errors = cell.map((value, bin) => value - template[bin]);
      const rms = Math.sqrt(average(errors.map(value => value ** 2))) / height;
      const actualHeight = quantile(cell, .95) - quantile(cell, .05);
      let weight = 0, weightedPosition = 0;
      for (let bin = 0; bin < bins; bin++) {
        const amount = Math.max(0, cell[bin] - base - .55 * height);
        weight += amount; weightedPosition += amount * (bin / (bins - 1) - .5);
      }
      if (rms <= .16 && actualHeight >= .72 * height && actualHeight <= 1.28 * height && weight > .05 * height) {
        supported.push({ index: tooth, offset: weightedPosition / weight, error: rms });
      } else {
        const deficit = average(errors.map(value => Math.max(0, -value))) / height;
        const excess = average(errors.map(value => Math.max(0, value))) / height;
        // A local downward mismatch has to dominate; arbitrary shape changes,
        // extra material, shadows and alternate tooth shapes are not filled in.
        if (deficit >= .08 && excess <= .04 && deficit >= 3 * excess) damaged.push(tooth);
        else unexplained = true;
      }
    }
    if (unexplained || damaged.length < 1 || damaged.length > 4 || supported.length < 6 || supported.length / z < .75) continue;
    const spacingErrors = supported.map((item, i) => {
      const next = supported[(i + 1) % supported.length], steps = (next.index - item.index + z) % z;
      return (next.offset - item.offset) / steps;
    });
    const scatter = Math.sqrt(average(spacingErrors.map(value => value ** 2)));
    if (scatter > .06 || Math.max(...spacingErrors.map(Math.abs)) > .15) continue;
    const damagedSet = new Set(damaged), sectors: PhotoDamageHypothesis['damagedSectors'] = [];
    const firstGood = supported[0].index;
    const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;
    let start: number | null = null;
    for (let step = 1; step <= z + 1; step++) {
      const index = firstGood + step;
      if (step <= z && damagedSet.has(index % z)) { if (start === null) start = index; }
      else if (start !== null) {
        const length = index - start, startDeg = normalizeAngle((center / period + start - .5) * 360 / z);
        const unwrappedEnd = startDeg + length * 360 / z;
        sectors.push({ startDeg, endDeg: normalizeAngle(unwrappedEnd), wrapsZero: unwrappedEnd >= 360, estimatedToothCells: length,
          evidence: 'Локальный дефицит контура относительно медианного шаблона; причина и границы повреждения требуют осмотра.' });
        start = null;
      }
    }
    if (sectors.length > 3) continue;
    const templateErrorFraction = Math.sqrt(average(supported.map(item => item.error ** 2)));
    candidates.push({ centerShift: { x: 0, y: 0 }, hypothesis: { status: 'requires_independent_confirmation', method: 'robust-period-template-v1', toothCount: z, boundary,
      supportedTeeth: supported.length, visibleToothFraction: supported.length / z, candidatePitchDeg: 360 / z,
      pitchScatterFraction: scatter, templateErrorFraction, damagedSectors: sectors,
      evidence: [
        `${supported.length} из ${z} ожидаемых зубцовых участков согласуются с общим шаблоном.`,
        `Предполагаемый угловой шаг ${(360 / z).toFixed(3)}°; среднеквадратичный разброс шага ${(scatter * 100).toFixed(2)}%.`,
        `${damaged.length} участка имеют локальный дефицит материала относительно шаблона; это гипотеза повреждения или перекрытия, а не распознанный факт.`,
        'Полное число зубьев, включая утраченные, нужно подтвердить по детали, чертежу или ответному колесу.',
      ] } });
  }
  // Competing periods remain unresolved instead of choosing the nicest score.
  return candidates.length === 1 ? candidates[0] : null;
}

function rackEvidence(mask: Uint8Array, w: number, box: { minX: number; maxX: number; minY: number; maxY: number }) {
  const bw = box.maxX - box.minX + 1, bh = box.maxY - box.minY + 1;
  if (Math.max(bw, bh) / Math.min(bw, bh) < 2.2) return false;
  const horizontal = bw > bh, length = horizontal ? bw : bh, thickness = horizontal ? bh : bw;
  const low: number[] = [], high: number[] = [];
  for (let along = Math.ceil(length * .04); along < length * .96; along++) {
    let first = thickness, last = -1;
    for (let across = 0; across < thickness; across++) {
      const x = box.minX + (horizontal ? along : across), y = box.minY + (horizontal ? across : along);
      if (mask[y * w + x]) { first = Math.min(first, across); last = across; }
    }
    if (last < 0) return false; low.push(first); high.push(last);
  }
  const edge = deviation(low) > deviation(high) ? low : high, other = edge === low ? high : low;
  const amp = quantile(edge, .9) - quantile(edge, .1);
  if (amp < 4 || deviation(other) > Math.max(1.5, amp * .1)) return false;
  const mean = average(edge), centers: number[] = [];
  let start = -1;
  for (let i = 0; i <= edge.length; i++) {
    const above = i < edge.length && edge[i] > mean;
    if (above && start < 0) start = i;
    if (!above && start >= 0) { if (start > 0 && i < edge.length) centers.push((start + i - 1) / 2); start = -1; }
  }
  if (centers.length < 5) return false;
  const gaps = centers.slice(1).map((v, i) => v - centers[i]);
  return average(gaps) >= 8 && deviation(gaps) / average(gaps) < .10;
}

export function analyzeGearImage(image: ImageDataLike): PhotoAnalysis {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || image.data.length !== image.width * image.height * 4)
    throw new Error('Expected nonempty RGBA ImageData with exactly width × height × 4 values.');
  // Keep work bounded on mobile and preserve original-pixel coordinates in output.
  const scale = Math.min(1, 512 / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale)), h = Math.max(1, Math.round(image.height * scale));
  const sx = image.width / w, sy = image.height / h, rgb = new Uint8Array(w * h * 3);
  const border: [number[], number[], number[]] = [[], [], []];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const source = (Math.min(image.height - 1, Math.floor((y + .5) * sy)) * image.width + Math.min(image.width - 1, Math.floor((x + .5) * sx))) * 4;
    const alpha = Number(image.data[source + 3]) / 255, i = y * w + x;
    for (let c = 0; c < 3; c++) {
      const value = Math.round(Number(image.data[source + c]) * alpha + 255 * (1 - alpha)); rgb[i * 3 + c] = value;
      if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3) border[c].push(value);
    }
  }
  const bg = border.map(values => quantile(values, .5));
  const backgroundSpread = Math.sqrt(border.reduce((sum, a, c) => sum + deviation(a, bg[c]) ** 2, 0) / 3);
  const distance = new Uint8Array(w * h), histogram = new Uint32Array(256);
  for (let i = 0; i < distance.length; i++) {
    distance[i] = Math.round(Math.sqrt(((rgb[i * 3] - bg[0]) ** 2 + (rgb[i * 3 + 1] - bg[1]) ** 2 + (rgb[i * 3 + 2] - bg[2]) ** 2) / 3)); histogram[distance[i]]++;
  }
  const threshold = Math.max(24, otsu(histogram, distance.length));
  const raw = Uint8Array.from(distance, v => v > threshold ? 1 : 0), object = largestComponent(raw, w, h);
  const warnings: string[] = [
    'Локальный анализ силуэта предлагает параметры для проверки; он не распознаёт стандарт, профиль или материал.',
    'Масштаб в мм, модуль, угол зацепления, смещение профиля и ширина колеса по одному фото не установлены.',
  ];
  const foregroundFraction = object.count / (w * h);
  const clipped = object.count > 0 && (object.minX <= 2 || object.minY <= 2 || object.maxX >= w - 3 || object.maxY >= h - 3);
  const bw = object.maxX - object.minX + 1, bh = object.maxY - object.minY + 1;
  const aspectRatio = object.count ? Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)) : null;
  const foregroundDistance: number[] = [];
  for (let i = 0; i < object.mask.length; i++) if (object.mask[i]) foregroundDistance.push(distance[i]);
  const contrast = quantile(foregroundDistance, .5);
  const result: PhotoAnalysis = {
    status: 'manual_required', candidateTypes: [], confidence: 0, toothCount: null, damageHypothesis: null,
    outsideDiameterPx: null, centerPx: null, moduleMm: null, warnings, expertQuestions: getExpertQuestions(),
    diagnostics: { algorithm: 'silhouette-radial-v2-damage', processedWidth: w, processedHeight: h, contrast,
      aspectRatio, clipped, backgroundSpread, foregroundFraction, outerPeriodicity: 0, innerPeriodicity: 0, ungatedToothCandidate: null },
  };
  if (object.count < 200 || foregroundFraction < .015 || foregroundFraction > .85) {
    warnings.push('Не удалось выделить отдельную деталь достаточного размера. Снимите её целиком на однотонном контрастном фоне.');
    result.candidateTypes.push({ type: 'undetermined', confidence: 0, evidence: 'Нет пригодного отдельного силуэта.' }); return result;
  }
  const cx = (object.minX + object.maxX) / 2, cy = (object.minY + object.maxY) / 2;
  result.centerPx = { x: (cx + .5) * sx, y: (cy + .5) * sy };
  const imageGate = !clipped && backgroundSpread < 22 && contrast >= 45 && foregroundFraction > .035 && object.count / Math.max(1, object.totalForeground) > .85;
  if (clipped) warnings.push('Контур касается края кадра: часть зубьев может быть обрезана.');
  if (backgroundSpread >= 22) warnings.push('Фон неоднороден или объект касается рамки: сегментация ненадёжна.');
  if (contrast < 45) warnings.push('Недостаточный контраст силуэта с фоном.');
  if (object.count / Math.max(1, object.totalForeground) <= .85) warnings.push('На снимке несколько заметных объектов или фон с деталями.');
  if (aspectRatio! > 1.12) {
    if (imageGate && rackEvidence(object.mask, w, object)) {
      result.candidateTypes.push({ type: 'linear_rack', confidence: .65, evidence: 'Вытянутый силуэт: повторяющиеся выступы на одной прямой стороне и ровная противоположная сторона.' });
      result.confidence = .65; result.status = 'proposal_requires_confirmation'; result.expertQuestions = getExpertQuestions('linear_rack');
      warnings.push('Периодический линейный контур лишь допускает зубчатую рейку; модуль и профиль не определены.'); return result;
    }
    warnings.push('Контур заметно вытянут: возможны наклон камеры, боковой вид, рейка или другая деталь. Нужен торцевой снимок строго по оси.');
  }
  const n = 2048, outer = new Float64Array(n), inner = new Float64Array(n), rLimit = Math.hypot(bw, bh) / 2 + 2;
  let innerRays = 0, missingRays = 0;
  const centerEmpty = !object.mask[Math.round(cy) * w + Math.round(cx)];
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * i / n, cos = Math.cos(a), sin = Math.sin(a); let first = -1, last = -1;
    for (let r = 0; r <= rLimit; r += .5) {
      const x = Math.round(cx + cos * r), y = Math.round(cy + sin * r);
      if (x < 0 || x >= w || y < 0 || y >= h) break;
      if (object.mask[y * w + x]) { if (first < 0) first = r; last = r; }
    }
    if (last < 0) missingRays++; else outer[i] = last + .25;
    if (centerEmpty && first > 0) { inner[i] = Math.max(0, first - .25); innerRays++; }
  }
  const meanR = average(outer);
  if (meanR < 40) warnings.push('Слишком мало пикселей на контуре для надёжного подсчёта зубьев.');
  const outerResult = circularPeriod(outer);
  const innerResult: PeriodResult = innerRays === n && average(inner) > meanR * .35 ? circularPeriod(inner) : { toothCount: null, score: 0, amplitude: 0, bestFrequency: null, peaks: [] };
  result.diagnostics.outerPeriodicity = outerResult.score; result.diagnostics.innerPeriodicity = innerResult.score;
  const internalCandidate = innerResult.toothCount !== null && outerResult.toothCount === null;
  const candidate = internalCandidate ? innerResult : outerResult;
  result.diagnostics.ungatedToothCandidate = candidate.bestFrequency;
  // Second angular harmonic detects oblique/elliptical views even at 45° to image axes.
  let a2 = 0, b2 = 0;
  for (let i = 0; i < n; i++) { a2 += outer[i] * Math.cos(4 * Math.PI * i / n); b2 += outer[i] * Math.sin(4 * Math.PI * i / n); }
  const ellipticity = 2 * Math.hypot(a2, b2) / n / Math.max(meanR, 1);
  const centroidOffset = Math.hypot(object.sx / object.count - cx, object.sy / object.count - cy) / Math.max(meanR, 1);
  const circularGate = aspectRatio! <= 1.12 && ellipticity < .04 && centroidOffset < .04 && missingRays === 0 && meanR >= 40;
  if (ellipticity >= .04) warnings.push('Радиальный контур похож на эллипс: возможен наклон детали или перспективное искажение.');
  if (centroidOffset >= .04) warnings.push('Силуэт несимметричен: возможны перекрытие, повреждение зубьев, ступица или тень.');
  if (imageGate && circularGate) {
    result.outsideDiameterPx = 2 * quantile(Array.from(outer), .995) * (sx + sy) / 2;
    const outerDamage = innerResult.toothCount === null ? damagedPeriod(outer, outerResult, 'outer') : null;
    const innerDamage = outerResult.amplitude < Math.max(2.5, meanR * .012) ? damagedPeriod(inner, innerResult, 'inner') : null;
    const damagedResult = outerDamage && innerDamage ? null : outerDamage ?? innerDamage;
    if (damagedResult) {
      const damage = damagedResult.hypothesis;
      const type: PhotoCandidateType = damage.boundary === 'inner' ? 'internal_ring' : 'external_circular';
      const score = Math.min(.8, damage.visibleToothFraction * (1 - damage.templateErrorFraction) * (1 - damage.pitchScatterFraction));
      result.status = 'damage_hypothesis_requires_confirmation'; result.damageHypothesis = damage; result.confidence = score;
      result.centerPx = { x: (cx + damagedResult.centerShift.x + .5) * sx, y: (cy + damagedResult.centerShift.y + .5) * sy };
      result.candidateTypes.push({ type, confidence: score, evidence: 'Большая часть контура повторяет один шаблон; локальные участки имеют дефицит материала. Полное число зубьев — отдельная гипотеза.' });
      result.expertQuestions = getExpertQuestions(type).map(question => question.id === 'tooth_count'
        ? { ...question, label: `Подтвердите полное число зубьев, включая сломанные: гипотеза ${damage.toothCount}.`,
          reason: 'Сохранные участки поддерживают этот угловой шаг; утраченные зубья не наблюдаются и не считаются подтверждёнными.' } : question);
      warnings.push('Есть локальные отклонения, похожие на утрату материала или перекрытие. Число зубьев сохранено отдельно как гипотеза; автоматически оно не подставлено.');
    } else if (candidate.toothCount !== null) {
      const type: PhotoCandidateType = internalCandidate ? 'internal_ring' : 'external_circular';
      const score = clamp(candidate.score * .94, 0, .94);
      result.status = 'proposal_requires_confirmation'; result.confidence = score; result.toothCount = candidate.toothCount;
      result.candidateTypes.push({ type, confidence: score, evidence: internalCandidate ? 'Периодические выступы на внутренней границе кольца; внешняя граница гладкая.' : 'Замкнутый приблизительно круглый контур с регулярными наружными выступами.' });
      result.expertQuestions = getExpertQuestions(type, result.toothCount);
      warnings.push('Найдено повторение контура. Подтвердите число зубьев вручную: регулярные выступы сами по себе не доказывают зубчатое зацепление.');
    } else {
      warnings.push('Регулярный зубчатый контур не выделен уверенно. Число зубьев не подставлено.');
    }
  }
  if (!result.candidateTypes.length) result.candidateTypes.push({ type: 'undetermined', confidence: 0, evidence: 'Недостаточно геометрических признаков или не пройдена проверка качества изображения.' });
  return result;
}

export type MeasuredSpurInput = {
  toothCount: number; outsideDiameterMm: number;
  confirmedExternalSpur: boolean;
  confirmedStandardFullDepth: boolean;
  confirmedZeroProfileShift: boolean;
  /** Actual tip-circle diameter, not an uncorrected caliper chord on odd z. */
  confirmedTipCircleDiameter: boolean;
};
export type MeasuredSpurResult = { ok: true; moduleMm: number; pitchDiameterMm: number; formula: string; warnings: string[] } | { ok: false; missing: string[] };

export function deriveMeasuredSpurParameters(input: MeasuredSpurInput): MeasuredSpurResult {
  const missing: string[] = [];
  if (!Number.isInteger(input.toothCount) || input.toothCount < 6 || input.toothCount > 1000) missing.push('Подтвердите целое число зубьев z от 6 до 1000.');
  if (!Number.isFinite(input.outsideDiameterMm) || input.outsideDiameterMm <= 0) missing.push('Введите измеренный наружный диаметр da > 0 в мм.');
  if (!input.confirmedExternalSpur) missing.push('Подтвердите, что колесо внешнее прямозубое.');
  if (!input.confirmedStandardFullDepth) missing.push('Подтвердите стандартную полную высоту зуба с коэффициентом головки ha* = 1.');
  if (!input.confirmedZeroProfileShift) missing.push('Подтвердите нулевое смещение профиля x = 0.');
  if (!input.confirmedTipCircleDiameter) missing.push('Подтвердите, что измерен диаметр окружности вершин; для нечётного z простой замер между зубьями может отличаться.');
  if (missing.length) return { ok: false, missing };
  const moduleMm = input.outsideDiameterMm / (input.toothCount + 2);
  return { ok: true, moduleMm, pitchDiameterMm: moduleMm * input.toothCount, formula: 'm = da / (z + 2)', warnings: [
    'Расчёт использует подтверждённые пользователем условия. Стандартный ряд модулей автоматически не выбирается и результат не округляется.',
    'Угол зацепления, подрезание, посадки, зазоры, прочность и совместимость с ответным колесом проверяются отдельно.',
  ] };
}
