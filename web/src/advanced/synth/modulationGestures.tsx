import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { clampDepth, routeDepthStep } from "./SynthControls.tsx";

/** Depth given to a route created by dropping a source on a knob. */
export const dropDepth = 16384;
const pct = (depth: number) => `${depth > 0 ? "+" : ""}${Math.round(depth / 65536 * 100)}%`;

export type SourceDrag = { source: number; x: number; y: number; target?: number };
/** Knob containers mark themselves with data-mod-target so a dropped source can find them. */
export const targetAt = (x: number, y: number) => {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-mod-target]");
  return el ? Number(el.dataset.modTarget) : undefined;
};

/** Drag a source button onto a knob. A press that never moves stays an ordinary click; check dragged() in onClick. */
export function useSourceDrag(onDrop: (target: number, source: number) => void) {
  const [drag, setDrag] = useState<SourceDrag>();
  const start = useRef<{ x: number; y: number; source: number; moved: boolean } | undefined>(undefined);
  const swallowClick = useRef(false);
  const drop = useRef(onDrop); drop.current = onDrop;
  const bind = (source: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => { swallowClick.current = false; if (e.button === 0) start.current = { x: e.clientX, y: e.clientY, source, moved: false }; },
    onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
      const s = start.current; if (!s) return;
      if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6) return;
      if (!s.moved) { s.moved = true; e.currentTarget.setPointerCapture(e.pointerId); }
      setDrag({ source, x: e.clientX, y: e.clientY, target: targetAt(e.clientX, e.clientY) });
    },
    onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => {
      const s = start.current; start.current = undefined;
      if (!s?.moved) return;
      swallowClick.current = true; setDrag(undefined);
      const target = targetAt(e.clientX, e.clientY);
      if (target !== undefined) drop.current(target, source);
    },
    onPointerCancel: () => { start.current = undefined; setDrag(undefined); },
  });
  /** True once for the click that ends a drag, so the button skips its normal action. */
  const dragged = () => { const was = swallowClick.current; swallowClick.current = false; return was; };
  return { drag, bind, dragged };
}

/** One route under a knob: drag vertically for depth, click for the route menu, arrows/Delete from the keyboard. */
export function RouteChip({ short, label, color, depth, disabled, onDepth, onMenu }: {
  short: string; label: string; color: string; depth: number; disabled?: boolean;
  onDepth: (depth: number) => void; onMenu: (x: number, y: number) => void;
}) {
  const drag = useRef<{ y: number; depth: number; moved: boolean } | undefined>(undefined), dragged = useRef(false);
  return <button type="button" className="route-chip" style={{ color }} disabled={disabled}
    aria-label={`${label} ${pct(depth)}. Drag or use arrow keys to change, Delete to remove, Enter for options`}
    title={`${label}: ${pct(depth)} · drag to change · click for options`}
    onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y: e.clientY, depth, moved: false }; dragged.current = false; }}
    onPointerMove={e => {
      const d = drag.current; if (!d) return;
      const dy = d.y - e.clientY;
      if (!d.moved && Math.abs(dy) < 3) return;
      d.moved = dragged.current = true; onDepth(clampDepth(d.depth + routeDepthStep(dy, e.shiftKey)));
    }}
    onPointerUp={() => { drag.current = undefined; }}
    onPointerCancel={() => { drag.current = undefined; }}
    onClick={e => { if (dragged.current) { dragged.current = false; return; } const r = e.currentTarget.getBoundingClientRect(); onMenu(r.left, r.bottom + 4); }}
    onContextMenu={e => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}
    onKeyDown={e => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); onDepth(clampDepth(depth + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 65.536 : 655.36))); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onDepth(0); }
    }}>{short} {pct(depth)}</button>;
}

/** Small route options popover opened from a chip or ring. */
export function RouteMenu({ title, color, depth, x, y, onDepth, onClose }: {
  title: string; color: string; depth: number; x: number; y: number; onDepth: (depth: number) => void; onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null), close = useRef(onClose); close.current = onClose;
  const [text, setText] = useState(String(Math.round(depth / 65536 * 100)));
  useEffect(() => setText(String(Math.round(depth / 65536 * 100))), [depth]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close.current(); } };
    const outside = (e: PointerEvent) => { if (!(e.target instanceof Node && root.current?.contains(e.target))) close.current(); };
    document.addEventListener("keydown", key, true); document.addEventListener("pointerdown", outside, true);
    root.current?.querySelector("input")?.select();
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", outside, true); };
  }, []);
  const commit = () => { const n = Number(text); if (Number.isFinite(n)) onDepth(clampDepth(n / 100 * 65536)); };
  return <div ref={root} className="route-menu" role="dialog" aria-label={`${title} route`} style={{ left: Math.min(x, window.innerWidth - 210), top: Math.min(y, window.innerHeight - 130), borderColor: color }}>
    <strong>{title}</strong>
    <label>Depth<input type="number" min={-100} max={100} step={1} value={text} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") { commit(); onClose(); } }}/>%</label>
    <div><button type="button" onClick={() => onDepth(-depth)}>Invert</button><button type="button" className="danger" onClick={() => { onDepth(0); onClose(); }}>Remove</button></div>
  </div>;
}
