'use client';

import { useEffect, useState } from 'react';
import { followCheck, getCheck, type Check } from '@/api/client';
import { applyEvent } from './checkState';

export type CheckState =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'ready'; check: Check; streamLost: boolean };

/** Loads a check by id and, while it is still running, follows its stream. */
export function useCheck(id: string): CheckState {
  const [result, setResult] = useState<CheckState>({ state: 'loading' });

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    setResult({ state: 'loading' });

    void getCheck(id).then((found) => {
      if (cancelled) return;
      if (!found) {
        setResult({ state: 'missing' });
        return;
      }
      setResult({ state: 'ready', check: found, streamLost: false });
      if (found.status !== 'running') return;
      stop = followCheck(
        id,
        (event) =>
          setResult((current) => {
            const base = current.state === 'ready' ? current.check : null;
            const next = applyEvent(base, event);
            return next ? { state: 'ready', check: next, streamLost: false } : current;
          }),
        () =>
          setResult((current) =>
            current.state === 'ready' ? { ...current, streamLost: true } : current,
          ),
      );
    });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [id]);

  return result;
}
