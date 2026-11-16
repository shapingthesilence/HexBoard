import {useCallback, useRef, useState, type SetStateAction} from 'react';
import {EditHistory} from './editHistory.ts';

export function useEditHistory<T>(initial: () => T, equal: (a: T, b: T) => boolean) {
  const [value, render] = useState(initial);
  const history = useRef<EditHistory<T> | null>(null);
  if (!history.current) history.current = new EditHistory(value, 64, equal);
  const refresh = useCallback(() => render(history.current!.value), []);
  const set = useCallback((update: SetStateAction<T>) => {
    const h = history.current!;
    h.set(typeof update === 'function' ? (update as (value: T) => T)(h.value) : update);
    refresh();
  }, [refresh]);
  const reset = useCallback((next: T) => { history.current!.reset(next); refresh(); }, [refresh]);
  const replace = useCallback((update: SetStateAction<T>) => {
    const h = history.current!;
    h.replace(typeof update === 'function' ? (update as (value: T) => T)(h.value) : update);
    refresh();
  }, [refresh]);
  const undo = useCallback(() => { const next = history.current!.undo(); refresh(); return next; }, [refresh]);
  const redo = useCallback(() => { const next = history.current!.redo(); refresh(); return next; }, [refresh]);
  const begin = useCallback(() => history.current!.begin(), []);
  const end = useCallback(() => history.current!.end(), []);
  return {value, set, reset, replace, undo, redo, begin, end, canUndo: history.current.canUndo, canRedo: history.current.canRedo};
}
