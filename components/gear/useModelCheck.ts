"use client";
import { useEffect, useRef, useState } from 'react';
import { checkModelParams } from '@/lib/modelCheck';
import type { ModelParams } from '@/lib/model';

/**
 * Builds and validates the draft mesh in a worker so typing stays responsive on large or complex models.
 * `pending` is true until the result for exactly these parameters has arrived.
 */
export function useModelCheck(params: ModelParams, enabled: boolean): { pending: boolean; error: string | null } {
  const worker = useRef<Worker | null>(null), sequence = useRef(0);
  const [result, setResult] = useState<{ params: ModelParams; error: string | null } | null>(null);
  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    try { worker.current = new Worker(new URL('../../lib/modelCheck.worker.ts', import.meta.url)); } catch { worker.current = null; }
    return () => { worker.current?.terminate(); worker.current = null; };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const id = ++sequence.current;
    const timer = setTimeout(() => {
      const current = worker.current;
      if (!current) { setResult({ params, error: checkModelParams(params) }); return; }
      current.onmessage = (event: MessageEvent<{ id: number; error: string | null }>) => { if (event.data.id === sequence.current) setResult({ params, error: event.data.error }); };
      current.onerror = () => { if (id === sequence.current) setResult({ params, error: checkModelParams(params) }); };
      current.postMessage({ id, params });
    }, 80);
    return () => clearTimeout(timer);
  }, [params, enabled]);
  const current = result?.params === params;
  return { pending: enabled && !current, error: current ? result.error : null };
}
