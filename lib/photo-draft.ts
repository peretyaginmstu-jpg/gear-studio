import type { PhotoCandidateType } from './photo-analysis.ts';

export type PhotoToothCountResetReason = 'wheel-rack-meaning' | 'photo-family-conflict' | null;

export interface PhotoToothCountDraft {
  teeth: string;
  confirmed: boolean;
  damageHypothesisTransferred: boolean;
}

function kindFamily(kind: string): 'external' | 'internal' | 'rack' | null {
  if (['spur', 'helical', 'herringbone'].includes(kind)) return 'external';
  if (['internal', 'internal-helical'].includes(kind)) return 'internal';
  if (['rack', 'helical-rack'].includes(kind)) return 'rack';
  return null;
}

function silhouetteFamily(type: PhotoCandidateType | null): 'external' | 'internal' | 'rack' | null {
  if (type === 'external_circular') return 'external';
  if (type === 'internal_ring') return 'internal';
  if (type === 'linear_rack') return 'rack';
  return null;
}

/**
 * A type edit always invalidates confirmation and damage-hypothesis provenance.
 * Counts cannot cross the wheel/rack boundary, and a detected count is not
 * carried into a family that contradicts the photographed contour.
 */
export function transitionPhotoToothCountDraft(
  currentKind: string,
  nextKind: string,
  silhouette: PhotoCandidateType | null,
  draft: PhotoToothCountDraft,
): PhotoToothCountDraft & { resetReason: PhotoToothCountResetReason } {
  if (currentKind === nextKind) return { ...draft, resetReason: null };

  const previousFamily = kindFamily(currentKind), nextFamily = kindFamily(nextKind);
  const wheelRackMeaningChanged = (previousFamily === 'rack') !== (nextFamily === 'rack');
  const photographedFamily = silhouetteFamily(silhouette);
  const photoConflictsWithNextKind = photographedFamily !== null && nextFamily !== null && photographedFamily !== nextFamily;
  const resetReason = wheelRackMeaningChanged ? 'wheel-rack-meaning'
    : photoConflictsWithNextKind ? 'photo-family-conflict' : null;

  return {
    teeth: resetReason ? '' : draft.teeth,
    confirmed: false,
    damageHypothesisTransferred: false,
    resetReason,
  };
}
