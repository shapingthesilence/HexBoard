import {createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject} from 'react';
import type {VisualPreview} from './visualPreview.ts';

export const PreviewContext = createContext<VisualPreview | null>(null);
function usePreview() {
  const preview = useContext(PreviewContext);
  if (!preview) throw Error('Synth preview is unavailable.');
  return preview;
}

/** Select only the graph's inputs; unrelated sources do not rerender it. */
export function PreviewValues({ids, children}: {ids: readonly number[]; children: (values: number[]) => ReactNode}) {
  const preview = usePreview(), snapshot = useRef<number[] | undefined>(undefined);
  const read = () => {
    if (!snapshot.current || snapshot.current.length !== ids.length || ids.some((id, i) => snapshot.current![i] !== preview.parameters[id])) {
      snapshot.current = ids.map(id => preview.parameters[id]);
    }
    return snapshot.current;
  };
  return children(useSyncExternalStore(preview.subscribe, read, read));
}

export function PreviewSource({id, children}: {id: number; children: (value: number) => ReactNode}) {
  // Meters need subpixel precision, not a fresh native CSS/DOM value for every
  // floating-point LFO sample. DSP/parameter calculations retain full precision.
  const preview = usePreview(), read = () => Math.round(preview.sources[id] * 1000) / 1000;
  return children(useSyncExternalStore(preview.subscribe, read, read));
}

export function PreviewNote({children}: {children: (key: number | null, held: boolean) => ReactNode}) {
  const preview = usePreview(), key = () => preview.expression?.key ?? null, held = () => !!preview.expression?.held;
  return children(useSyncExternalStore(preview.subscribe, key, key), useSyncExternalStore(preview.subscribe, held, held));
}

/** Paint decorations on the shared clock without seeking native animation timelines. */
export function usePreviewAnimation(root: RefObject<Element | null>, paint: (node: Element, elapsed: number, reduced: boolean) => void) {
  const preview = useContext(PreviewContext);
  const draw = useRef(paint); draw.current = paint;
  useEffect(() => {
    if (!preview || !root.current) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reset = true, visible = true;
    const refresh = () => { reset = true; };
    preference.addEventListener('change', refresh);
    const observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      if (visible) reset = true;
    });
    observer.observe(root.current);
    const stop = preview.subscribeFrame(now => {
      if (!root.current || !visible || (preference.matches && !reset)) return;
      draw.current(root.current, now - preview.origin, preference.matches); reset = false;
    });
    return () => { stop(); observer.disconnect(); preference.removeEventListener('change', refresh); };
  }, [preview, root]);
}

export function PreviewExpression({children}: {children: (expression: VisualPreview['expression']) => ReactNode}) {
  const preview = usePreview(), read = () => preview.expression;
  return children(useSyncExternalStore(preview.subscribe, read, read));
}

/** Optional for shared FX controls that are also rendered outside an engine. */
export function PreviewSelect({select, fallback, children}: {select: (sources: number[]) => number; fallback: number; children: (value: number) => ReactNode}) {
  const preview = useContext(PreviewContext), read = () => preview ? select(preview.sources) : fallback;
  return children(useSyncExternalStore(preview?.subscribe ?? noSubscription, read, read));
}
const noSubscription = () => () => {};
