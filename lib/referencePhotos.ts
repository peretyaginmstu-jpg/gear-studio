import { z } from 'zod';

export const MAX_REFERENCE_PHOTOS = 4;
export const MAX_REFERENCE_IMAGE_CHARS = 2 * 1024 * 1024;
export const referencePhotoRoles = {
  side: 'Зубья сбоку', body: 'Отверстие и тело', damage: 'Повреждение', partner: 'Ответная деталь', other: 'Другой ракурс',
} as const;
export type ReferencePhotoRole = keyof typeof referencePhotoRoles;
export const photoSourceSchema = z.object({ fileName: z.string().max(500), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  originalWidth: z.number().int().positive().max(60_000_000), originalHeight: z.number().int().positive().max(60_000_000) }).strict();
export type PhotoSource = z.infer<typeof photoSourceSchema>;
export interface WorkingPhoto { image: string; width: number; height: number; source: PhotoSource }
export interface ReferencePhoto extends WorkingPhoto { id: string; role: ReferencePhotoRole; note: string }

/** Check the normalized PNG header before any browser decoder sees imported data. */
export function assertPngDimensions(image: string, width: number, height: number): void {
  try {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image)) throw new Error();
    const header = atob(image.slice('data:image/png;base64,'.length, 'data:image/png;base64,'.length + 44));
    const view = new DataView(Uint8Array.from(header, c => c.charCodeAt(0)).buffer);
    if (view.byteLength < 24 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a || view.getUint32(12) !== 0x49484452
      || view.getUint32(16) !== width || view.getUint32(20) !== height) throw new Error();
  } catch { throw new Error('Размеры PNG не совпадают с проектом.'); }
}

export const referencePhotoSchema = z.object({ id: z.string().uuid(), role: z.enum(['side', 'body', 'damage', 'partner', 'other']), note: z.string().max(600),
  image: z.string().max(MAX_REFERENCE_IMAGE_CHARS).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/),
  width: z.number().int().min(1).max(1280), height: z.number().int().min(1).max(1280), source: photoSourceSchema,
}).strict().superRefine((photo, ctx) => {
  try { assertPngDimensions(photo.image, photo.width, photo.height); }
  catch { ctx.addIssue({ code: 'custom', message: 'Несогласованное изображение ракурса.' }); }
});
export const referencePhotosSchema = z.array(referencePhotoSchema).max(MAX_REFERENCE_PHOTOS).superRefine((photos, ctx) => {
  if (new Set(photos.map(photo => photo.id)).size !== photos.length) ctx.addIssue({ code: 'custom', message: 'Повторяется идентификатор ракурса.' });
});

export function appendReferencePhotos(current: readonly ReferencePhoto[], additions: readonly ReferencePhoto[]): ReferencePhoto[] {
  const next = [...current, ...additions];
  if (next.length > MAX_REFERENCE_PHOTOS) throw new Error('Можно сохранить до четырёх дополнительных ракурсов. Замените один из снимков.');
  if (new Set(next.map(photo => photo.id)).size !== next.length) throw new Error('Этот ракурс уже есть в проекте.');
  return next;
}

/** Moving a view into analysis preserves the prior main image in the vacated slot. */
export function swapReferencePhoto(current: readonly ReferencePhoto[], id: string, previousMain: ReferencePhoto | null): ReferencePhoto[] {
  if (!current.some(photo => photo.id === id)) throw new Error('Ракурс уже изменён. Откройте список снимков заново.');
  const next = current.flatMap(photo => photo.id === id ? previousMain ? [previousMain] : [] : [photo]);
  if (new Set(next.map(photo => photo.id)).size !== next.length) throw new Error('Повторяется идентификатор ракурса.');
  return next;
}

/** Passport metadata never embeds photos or calls visual notes confirmed measurements. */
export function referencePhotoManifest(photos: readonly ReferencePhoto[]) {
  return { method: 'supporting-views-v1' as const, interpretation: 'user-labelled-visual-references; not automatically measured or confirmed',
    photos: photos.map(({ id, role, note, width, height, source }) => ({ id, role, note, width, height, source: { ...source } })) };
}
