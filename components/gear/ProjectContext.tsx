"use client";
import { createContext, useContext, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export interface ProjectDraftStore {
  get: (scope: string, identity: string, field: string) => unknown;
  put: (scope: string, identity: string, field: string, value: unknown) => void;
  processing: (busy: boolean) => void;
}
export const ProjectContext = createContext<ProjectDraftStore | null>(null);

export function useProjectActivity(busy: boolean) {
  const store = useContext(ProjectContext);
  useEffect(() => { store?.processing(busy); }, [store, busy]);
}

/** Persist only committed form state. Identity prevents measurements crossing photo/family changes. */
export function useProjectField<T>(scope: string, field: string, initial: T | (() => T), identity = 'default'): [T, Dispatch<SetStateAction<T>>] {
  const store = useContext(ProjectContext);
  const [value, setValue] = useState<T>(() => {
    const saved = store?.get(scope, identity, field);
    return saved !== undefined ? saved as T : typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  useEffect(() => { store?.put(scope, identity, field, value); }, [store, scope, identity, field, value]);
  return [value, setValue];
}
