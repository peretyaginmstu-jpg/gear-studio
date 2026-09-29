"use client";
import { useMemo, useRef } from 'react';
import { GearViewer } from './GearViewer';
import { useModelCheck } from './useModelCheck';
import { Share2 } from 'lucide-react';
import { buildModelMesh, isInternalKind, isRackKind, type ModelMesh, type ModelParams } from '@/lib/model';

const mm = (v: number) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} мм`;
/** The one or two sizes people compare with the real part. */
export function sizeLabel(mesh: ModelMesh): string {
  const d = mesh.dimensions, p = mesh.params;
  if (isRackKind(p.kind)) return `Длина ${mm(d.rackLength)} · высота ${mm(d.rackHeight)}`;
  const length = p.kind === 'worm' ? 'длина' : 'ширина';
  return `${isInternalKind(p.kind) ? '⌀ вершин (внутр.)' : '⌀ наружный'} ${mm(d.tipDiameter)} · ${length} ${mm(p.width)}`;
}

/**
 * The model the visitor is editing, always on screen. The worker validates first; the light preview mesh is
 * built only for valid parameters, and the last good model stays visible while new values are checked.
 */
export function LivePreview({ params, compact = true, onShare }: { params: ModelParams; compact?: boolean; onShare?: () => void }) {
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
    {shown && <p className="live-preview-size" aria-live="off">{sizeLabel(shown)}</p>}
    {onShare && <button type="button" className="live-preview-share" onClick={onShare} aria-label="Поделиться ссылкой на модель" title="Поделиться ссылкой"><Share2 size={18} /></button>}
    {check.error && !check.pending && <p className="live-preview-note" role="status">Такую деталь не построить: {check.error}</p>}
  </div>;
}
