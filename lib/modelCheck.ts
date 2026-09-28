import { validateMesh } from './gearMath.ts';
import { buildModelMesh, type ModelParams } from './model.ts';

/** Null when the parameters build a closed mesh, otherwise the reason shown next to the build button. */
export function checkModelParams(params: ModelParams): string | null {
  try {
    return validateMesh(buildModelMesh(params)).valid ? null : 'Сетка не прошла проверку. Измените параметры.';
  } catch (e) { return e instanceof Error ? e.message : 'Не удалось построить профиль.'; }
}
