"use client";
import { useMemo, useRef } from 'react';
import { GearViewer } from './GearViewer';
import { useModelCheck } from './useModelCheck';
import { buildModelMesh, type ModelMesh, type ModelParams } from '@/lib/model';

/**
 * The model the visitor is editing, always on screen. The worker validates first; the light preview mesh is
 * built only for valid parameters, and the last good model stays visible while new values are checked.
 */
export function LivePreview({ params, compact = true }: { params: ModelParams; compact?: boolean }) {
  const check = useModelCheck(params, true), last = useRef<ModelMesh | null>(null);
  const mesh = useMemo(() => {
    if (check.pending || check.error) return null;
    try { return buildModelMesh(params, { flankSamples: 8 }); } catch { return null; }
  }, [params, check.pending, check.error]);
  // Keep the previous model while typing; a fresh one replaces it as soon as the check passes.
  // eslint-disable-next-line react-hooks/refs -- remembered only to avoid an empty frame between edits
  if (mesh) last.current = mesh;
  // eslint-disable-next-line react-hooks/refs
  const shown = mesh ?? last.current;
  return <div className="live-preview" aria-live="polite">
    <GearViewer mesh={shown} error={null} compact={compact} />
    {check.error && !check.pending && <p className="live-preview-note" role="status">Такую деталь не построить: {check.error}</p>}
  </div>;
}
