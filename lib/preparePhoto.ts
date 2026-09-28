import { MAX_REFERENCE_IMAGE_CHARS, type PhotoSource, type WorkingPhoto } from './referencePhotos';

function rasterize(input: CanvasImageSource, width: number, height: number, source: PhotoSource, reference: boolean): WorkingPhoto {
  const limit = reference ? 1280 : 2048;
  let scale = Math.min(1, limit / Math.max(width, height));
  const canvas = document.createElement('canvas');
  // Reference views are bounded individually so four views fit alongside one main PNG.
  for (;;) {
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Не удалось прочитать фото.');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(input, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/png');
    if (!reference || image.length <= MAX_REFERENCE_IMAGE_CHARS) return { image, width: canvas.width, height: canvas.height, source };
    scale *= .8;
  }
}

export async function preparePhotoFile(file: File, reference = false): Promise<WorkingPhoto> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Подойдут JPG, PNG или WebP. HEIC сначала сохраните в JPEG.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Файл больше 20 МБ. Уменьшите изображение.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('Не удалось прочитать изображение. Проверьте файл или сохраните его заново в JPG, PNG или WebP.'); }
  try {
    if (bitmap.width * bitmap.height > 60_000_000) throw new Error('Уменьшите изображение до 60 Мп или меньше.');
    return rasterize(bitmap, bitmap.width, bitmap.height,
      { fileName: file.name.slice(0, 500), mimeType: file.type as PhotoSource['mimeType'], originalWidth: bitmap.width, originalHeight: bitmap.height }, reference);
  } finally { bitmap.close(); }
}

export async function prepareReferenceFromMain(photo: WorkingPhoto): Promise<WorkingPhoto> {
  const image = new Image(); image.src = photo.image; await image.decode();
  return rasterize(image, photo.width, photo.height, { ...photo.source }, true);
}

export async function photoPixels(photo: WorkingPhoto): Promise<ImageData> {
  const image = new Image(); image.src = photo.image; await image.decode();
  if (image.naturalWidth !== photo.width || image.naturalHeight !== photo.height) throw new Error('Размеры фото изменились. Загрузите снимок заново.');
  const canvas = document.createElement('canvas'); canvas.width = photo.width; canvas.height = photo.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Не удалось прочитать фото.');
  ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, photo.width, photo.height);
}
