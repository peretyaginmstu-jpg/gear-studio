import { analyzeGearImage, type ImageDataLike, type PhotoAnalysis } from './photo-analysis.ts';

/** Pixel-cell edges: [x, x + width) × [y, y + height), with integer coordinates. */
export interface PhotoRegion { x: number; y: number; width: number; height: number }
export interface RegionPoint { x: number; y: number }
export interface WorkingImageSize { width: number; height: number }
export const photoRegionLimits = { maxDimension: 2048, maxPixels: 2048 * 2048 } as const;
export interface PhotoRegionEvidence {
  schema: 'zatseplenie.photo-region.v1';
  method: 'full-image' | 'user-selection';
  coordinateSystem: 'working_image_pixels; origin=top-left; angle=clockwise-from-right';
  regionConvention: 'integer-pixel-cell-edges; half-open';
  region: PhotoRegion;
  workingImage: WorkingImageSize;
  processedImage: WorkingImageSize;
  processedToWorking: { offsetX: number; offsetY: number; scaleX: number; scaleY: number };
  cropOperation: 'integer-pixel-copy; no-stretch';
}
export interface RegionAnalysis { analysis: PhotoAnalysis; evidence: PhotoRegionEvidence }

function validateSize(size: WorkingImageSize): void {
  if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) || size.width <= 0 || size.height <= 0)
    throw new Error('Рабочий снимок должен иметь положительные целочисленные размеры.');
  if (size.width > photoRegionLimits.maxDimension || size.height > photoRegionLimits.maxDimension || size.width * size.height > photoRegionLimits.maxPixels)
    throw new Error('Рабочий снимок для анализа должен быть не больше 2048 px по каждой стороне.');
}
/** Full-frame selection canonicalizes to null, so selecting it again is a no-op. */
export function normalizePhotoRegion(region: PhotoRegion | null, size: WorkingImageSize): PhotoRegion | null {
  validateSize(size);
  if (region === null) return null;
  if (![region.x, region.y, region.width, region.height].every(Number.isSafeInteger)
    || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
    || region.x + region.width > size.width || region.y + region.height > size.height)
    throw new Error('Рамка должна иметь целочисленные границы внутри снимка и ненулевую ширину и высоту.');
  if (region.x === 0 && region.y === 0 && region.width === size.width && region.height === size.height) return null;
  return { x: region.x, y: region.y, width: region.width, height: region.height };
}
/** Corners may be placed in either order. A reversed width/height is never accepted by the analysis API. */
export function photoRegionFromCorners(first: RegionPoint, second: RegionPoint, size: WorkingImageSize): PhotoRegion | null {
  return normalizePhotoRegion({ x: Math.min(first.x, second.x), y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x), height: Math.abs(second.y - first.y) }, size);
}
export function samePhotoRegion(a: PhotoRegion | null, b: PhotoRegion | null, size: WorkingImageSize): boolean {
  const first = normalizePhotoRegion(a, size), second = normalizePhotoRegion(b, size);
  return first === null || second === null ? first === second
    : first.x === second.x && first.y === second.y && first.width === second.width && first.height === second.height;
}
function validateRGBA(image: ImageDataLike): void {
  validateSize(image);
  if (!image.data || image.data.length !== image.width * image.height * 4)
    throw new Error('Нужен полный RGBA-буфер рабочего снимка: ровно width × height × 4 значений.');
  // Bytes are valid by construction. For generic ArrayLike inputs validate even
  // pixels outside the crop, rather than allowing invalid data to hide there.
  if (!(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray)) {
    for (let i = 0; i < image.data.length; i++) {
      const value = image.data[i];
      if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error('RGBA должен содержать целые значения от 0 до 255.');
    }
  }
}

/**
 * Same detector and gates; only the selected pixels are fed to its 512px preflight.
 * No canvas, DOM, resampling, new threshold, automatic confirmation, or scale in mm.
 */
export function analyzeGearRegion(image: ImageDataLike, selected: PhotoRegion | null = null): RegionAnalysis {
  validateRGBA(image);
  const normalized = normalizePhotoRegion(selected, image);
  const region = normalized ?? { x: 0, y: 0, width: image.width, height: image.height };
  let input = image;
  if (normalized) {
    const data = new Uint8ClampedArray(region.width * region.height * 4);
    for (let y = 0; y < region.height; y++) {
      const source = ((region.y + y) * image.width + region.x) * 4, destination = y * region.width * 4;
      for (let i = 0; i < region.width * 4; i++) data[destination + i] = image.data[source + i];
    }
    input = { width: region.width, height: region.height, data };
  }
  const local = analyzeGearImage(input);
  const analysis = normalized && local.centerPx ? { ...local, centerPx: { x: local.centerPx.x + region.x, y: local.centerPx.y + region.y } } : local;
  const processedImage = { width: local.diagnostics.processedWidth, height: local.diagnostics.processedHeight };
  return { analysis, evidence: {
    schema: 'zatseplenie.photo-region.v1', method: normalized ? 'user-selection' : 'full-image',
    coordinateSystem: 'working_image_pixels; origin=top-left; angle=clockwise-from-right',
    regionConvention: 'integer-pixel-cell-edges; half-open', region: { ...region },
    workingImage: { width: image.width, height: image.height }, processedImage,
    processedToWorking: { offsetX: region.x, offsetY: region.y, scaleX: region.width / processedImage.width, scaleY: region.height / processedImage.height },
    cropOperation: 'integer-pixel-copy; no-stretch',
  } };
}
