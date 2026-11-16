import { useRef, type HTMLAttributes, type ReactNode } from "react";
import { modulationRings, knobRingPoint, knobRingViewBox } from "./modulationRing.ts";
export const sourceColors = ["#efb86b", "#5cdac6", "#b29aff", "#70b8ff", "#ef8eb8", "#f3cf6e", "#91aaff", "#f39cce", "#a7dc82"];
export const sourceShortNames = ["Strike", "Pressure", "Release", "X tilt", "Y tilt", "Env", "LFO", "Joystick", "Expression"];
/** Selects a modulation source. Shift-click locks it; dragging it onto a knob adds a route;
 * sources with settings get a separate caret that opens their editor. */
export function ModSourceButton({ label, color, pressed, locked, count, editorOpen, onSelect, onEditor, title, events }: {
    label: ReactNode; color: string; pressed: boolean; locked?: boolean; count?: ReactNode; editorOpen?: boolean;
    onSelect: (lock: boolean) => void; onEditor?: () => void; title?: string; events?: HTMLAttributes<HTMLButtonElement>;
}) {
    const name = typeof label === "string" ? label : "source";
    return <span className="mod-source-split" data-editor={onEditor ? true : undefined} data-locked={locked || undefined} style={{ borderColor: color }}>
      <button type="button" aria-pressed={pressed} title={title} onClick={e => onSelect(e.shiftKey)} {...events}><span className="source-dot" style={{ background: color }}/>{label}{locked && <svg className="source-lock" viewBox="0 0 10 12" aria-label="locked"><rect x="1" y="5" width="8" height="6.5" rx="1.2" fill="currentColor"/><path d="M3 5V3.5a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg>}{count !== undefined && <span className="source-route-count">{count}</span>}</button>
      {onEditor && <button type="button" className="mod-source-caret" aria-label={`${name} settings`} title={`${name} settings`} aria-haspopup="dialog" aria-expanded={!!editorOpen} onClick={onEditor}><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></button>}
    </span>;
}
/** Optional color/name serve engines with their own source lists. */
export function modulationCursor(source: number, color = sourceColors[source], name = sourceShortNames[source]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="104" height="32"><path d="M2 2v20l5-6 5 10 4-2-5-9h9z" fill="${color}" stroke="#14212b" stroke-width="2"/><rect x="22" y="8" width="80" height="22" rx="5" fill="#14212b" stroke="${color}"/><text x="62" y="23" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${color}">${name}</text></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 2, crosshair`;
}
export type KnobRoute = { label: string; i: number; depth: number; bipolar?: boolean; color?: string };
/** Depth spans ±65536 in 160 px of vertical drag (1600 px with Shift), matching modulate mode. */
export const routeDepthStep = (dy: number, fine: boolean) => dy * 131072 / (fine ? 1600 : 160);
export const clampDepth = (v: number) => Math.round(Math.max(-65536, Math.min(65536, v)));
const ringRadius = (slot: number, count: number) => 26 + slot * (count <= 4 ? 3 : 2);
/** Route slot under a pointer when it falls in the ring band outside the knob face. */
function ringAt(el: Element, x: number, y: number, count: number) {
    if (!count) return undefined;
    const r = el.getBoundingClientRect(), scale = 84 / r.width;
    const d = Math.hypot((x - r.left) * scale - 42, (y - r.top) * scale - 42);
    if (d < 25 || d > 40) return undefined;
    let best = 0;
    for (let slot = 1; slot < count; ++slot) if (Math.abs(d - ringRadius(slot, count)) < Math.abs(d - ringRadius(best, count))) best = slot;
    return best;
}
export function Knob({ label, value, min = 0, max = 65535, disabled, onChange, onRelease, baseValue, effectiveValue, routes = [], onRouteDepth, onRouteMenu, alternate, neutral, keyStep, valueText }: {
    label: string;
    value: number;
    min?: number;
    max?: number;
    /** Spoken value, when the number alone does not say it. */
    valueText?: string;
    disabled?: boolean;
    onChange: (value: number) => void;
    onRelease?: () => void;
    baseValue?: number;
    effectiveValue?: number;
    routes?: KnobRoute[];
    /** Dragging a coloured ring edits that route's depth. */
    onRouteDepth?: (source: number, depth: number) => void;
    /** Right-click or long-press on a ring. */
    onRouteMenu?: (source: number, x: number, y: number) => void;
    /** Option/Alt-drag edits this route depth instead of the value. */
    alternate?: { value: number; onChange: (depth: number) => void };
    /** Double-click value: centre for centred controls; default 0 for signed ranges, else the minimum (off). */
    neutral?: number;
    /** Arrow-key step (for example one semitone); default 1% (0.1% with Shift). */
    keyStep?: number;
}) {
    const base = baseValue === undefined ? (value - min) / (max - min) : baseValue / 65535;
    const liveDot = knobRingPoint(effectiveValue ?? base, 34);
    const drag = useRef<{ y: number; x: number; value: number; route?: (depth: number) => void } | null>(null);
    const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const clamp = (v: number) => Math.max(min, Math.min(max, v));
    const changed = useRef(false);
    const change = (next: number) => { if (next !== value) {
        changed.current = true;
        onChange(next);
    } };
    const finish = () => { clearTimeout(press.current); const valueDrag = drag.current && !drag.current.route; drag.current = null; if (valueDrag && changed.current) {
        changed.current = false;
        onRelease?.();
    } };
    const ringRoute = (e: { currentTarget: Element; clientX: number; clientY: number }) => { const slot = ringAt(e.currentTarget, e.clientX, e.clientY, routes.length); return slot === undefined ? undefined : routes[slot]; };
    return <div className="physical-knob" role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={valueText} aria-disabled={disabled}
      onPointerDown={e => {
        if (disabled || e.button !== 0) return;
        const ring = onRouteDepth ? ringRoute(e) : undefined;
        e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); changed.current = false;
        if (ring) {
            drag.current = { y: e.clientY, x: e.clientX, value: ring.depth, route: d => onRouteDepth!(ring.i, d) };
            if (onRouteMenu) { const { clientX: x, clientY: y } = e; press.current = setTimeout(() => { drag.current = null; onRouteMenu(ring.i, x, y); }, 500); }
        } else if (e.altKey && alternate) drag.current = { y: e.clientY, x: e.clientX, value: alternate.value, route: alternate.onChange };
        else drag.current = { y: e.clientY, x: e.clientX, value };
      }}
      onPointerMove={e => {
        if (!drag.current || !e.currentTarget.hasPointerCapture(e.pointerId)) {
            if (onRouteDepth) e.currentTarget.toggleAttribute("data-ring-hover", !!ringRoute(e));
            return;
        }
        if (Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) > 4) clearTimeout(press.current);
        const dy = drag.current.y - e.clientY;
        if (drag.current.route) drag.current.route(clampDepth(drag.current.value + routeDepthStep(dy, e.shiftKey)));
        else change(clamp(drag.current.value + dy * (max - min) / (e.shiftKey ? 1600 : 160)));
      }}
      onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId); finish(); }} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish}
      onPointerLeave={e => e.currentTarget.removeAttribute("data-ring-hover")}
      onDoubleClick={e => {
        if (disabled) return; e.preventDefault();
        // On a ring, clear that modulation; elsewhere return the knob to neutral.
        const ring = onRouteDepth ? ringRoute(e) : undefined;
        if (ring) { onRouteDepth!(ring.i, 0); return; }
        const target = neutral ?? (min < 0 && max > 0 ? 0 : min);
        if (target !== value) { onChange(target); onRelease?.(); }
      }}
      onContextMenu={e => { const ring = onRouteMenu ? ringRoute(e) : undefined; if (ring) { e.preventDefault(); onRouteMenu!(ring.i, e.clientX, e.clientY); } }}
      onKeyDown={e => { if (!disabled && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        change(clamp(e.key === 'Home' ? min : e.key === 'End' ? max : value + (['ArrowUp', 'ArrowRight'].includes(e.key) ? 1 : -1) * (keyStep ?? (max - min) / (e.shiftKey ? 1000 : 100))));
    } }} onKeyUp={finish}>
    <svg className="knob-rings" viewBox={knobRingViewBox} aria-hidden="true">
      {routes.flatMap((r, slot) => modulationRings(r.depth, 26 + slot * (routes.length <= 4 ? 3 : 2), base, r.bipolar ?? (r.i === 3 || r.i === 4 || r.i === 6)).map((arc, side) => {
            const depth = side === 0 ? r.depth : -r.depth;
            return <g key={`${r.i}:${side}`} style={{ color: r.color ?? sourceColors[r.i] }} data-source={r.label} data-depth={r.depth}>
        <title>{`${r.label}: ${r.depth > 0 ? "+" : ""}${Math.round(r.depth / 65536 * 100)}%`}</title>
        <path d={arc.path} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
        <path d="M -2 -2 L 1 0 L -2 2" fill="none" stroke="currentColor" strokeWidth="1.5" transform={`translate(${arc.x} ${arc.y}) rotate(${arc.angle + (depth < 0 ? 180 : 0)})`}/>
      </g>;
        }))}
      {routes.length > 0 && <circle className="modulation-position" cx={Math.round(liveDot.x * 10) / 10} cy={Math.round(liveDot.y * 10) / 10} r="2.6" fill="#f4fbff" stroke="#15232e" strokeWidth="1"/>}
    </svg>
    <span className="knob-face"><span className="knob-pointer" style={{ transform: `rotate(${-135 + 270 * (baseValue === undefined ? (value - min) / (max - min) : baseValue / 65535)}deg)` }}/></span>
  </div>;
}
