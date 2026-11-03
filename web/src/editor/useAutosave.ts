import {useEffect, useRef, useState, type DependencyList} from 'react';
import {Autosave} from './autosave.ts';

/** Draft edits coalesce; leaving the page/editor flushes the latest pending edit. */
export function useAutosave(save: () => unknown | Promise<unknown>, dependencies: DependencyList, onError: (error: unknown) => void = () => {}, delay = 400) {
  const error = useRef(onError); error.current = onError;
  const [writer] = useState(() => new Autosave(delay, e => error.current(e)));
  useEffect(() => { writer.schedule(save); }, dependencies);
  useEffect(() => {
    const flush = () => { void writer.flush().catch(e => error.current(e)); };
    const hidden = () => { if (document.hidden) flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      flush();
    };
  }, [writer]);
  return writer;
}
