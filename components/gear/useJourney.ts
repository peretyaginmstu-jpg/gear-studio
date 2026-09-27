"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { initialJourney, journeyFromHash, journeyHash, transitionJourney, type JourneyAction, type JourneyState } from '@/lib/journey';

export function useJourney() {
  const [state, setState] = useState(initialJourney), current = useRef(state);
  const commit = useCallback((next: JourneyState, replace = false) => {
    current.current = next; setState(next);
    const hash = journeyHash(next);
    if (window.location.hash !== hash) {
      window.history[replace ? 'replaceState' : 'pushState'](null, '', `${window.location.pathname}${window.location.search}${hash}`);
    }
  }, []);
  const send = useCallback((action: JourneyAction) => {
    const next = transitionJourney(current.current, action); commit(next); return next;
  }, [commit]);
  useEffect(() => {
    const read = () => commit(journeyFromHash(current.current, window.location.hash), true);
    const frame = requestAnimationFrame(read);
    window.addEventListener('popstate', read); window.addEventListener('hashchange', read);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('popstate', read); window.removeEventListener('hashchange', read); };
  }, [commit]);
  return { state, send };
}
