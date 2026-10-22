import { useRef } from "react";
import { modulationRings, knobRingPoint, knobRingViewBox } from "./modulationRing.ts";
export const sourceColors = ["#efb86b", "#5cdac6", "#b29aff", "#70b8ff", "#ef8eb8", "#f3cf6e", "#91aaff", "#f39cce", "#a7dc82"];
export const sourceShortNames = ["Strike", "Pressure", "Release", "X tilt", "Y tilt", "Env", "LFO", "Joystick", "Expression"];
export function modulationCursor(source: number) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="104" height="32"><path d="M2 2v20l5-6 5 10 4-2-5-9h9z" fill="${sourceColors[source]}" stroke="#14212b" stroke-width="2"/><rect x="22" y="8" width="80" height="22" rx="5" fill="#14212b" stroke="${sourceColors[source]}"/><text x="62" y="23" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${sourceColors[source]}">${sourceShortNames[source]}</text></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 2, crosshair`;
}
export function Knob({ label, value, min = 0, max = 65535, disabled, onChange, onRelease, baseValue, effectiveValue, routes = [] }: {
    label: string;
    value: number;
    min?: number;
    max?: number;
    disabled?: boolean;
    onChange: (value: number) => void;
    onRelease?: () => void;
    baseValue?: number;
    effectiveValue?: number;
    routes?: {
        label: string;
        i: number;
        depth: number;
        bipolar?: boolean;
    }[];
}) {
    const base = baseValue === undefined ? (value - min) / (max - min) : baseValue / 65535;
    const liveDot = knobRingPoint(effectiveValue ?? base, 34);
    const drag = useRef<{
        y: number;
        value: number;
    } | null>(null);
    const clamp = (v: number) => Math.max(min, Math.min(max, v));
    const changed = useRef(false);
    const change = (next: number) => { if (next !== value) {
        changed.current = true;
        onChange(next);
    } };
    const finish = () => { drag.current = null; if (changed.current) {
        changed.current = false;
        onRelease?.();
    } };
    return <div className="physical-knob" role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-disabled={disabled} onPointerDown={e => { if (disabled || e.button !== 0)
        return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); changed.current = false; drag.current = { y: e.clientY, value }; }} onPointerMove={e => { if (drag.current && e.currentTarget.hasPointerCapture(e.pointerId))
        change(clamp(drag.current.value + (drag.current.y - e.clientY) * (max - min) / (e.shiftKey ? 1600 : 160))); }} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId); finish(); }} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish} onKeyDown={e => { if (!disabled && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        change(clamp(e.key === 'Home' ? min : e.key === 'End' ? max : value + (['ArrowUp', 'ArrowRight'].includes(e.key) ? 1 : -1) * (max - min) / (e.shiftKey ? 1000 : 100)));
    } }} onKeyUp={finish}>
    <svg className="knob-rings" viewBox={knobRingViewBox} aria-hidden="true">
      {routes.flatMap((r, slot) => modulationRings(r.depth, 26 + slot * (routes.length <= 4 ? 3 : 2), base, r.bipolar ?? (r.i === 3 || r.i === 4 || r.i === 6)).map((arc, side) => {
            const depth = side === 0 ? r.depth : -r.depth;
            return <g key={`${r.i}:${side}`} style={{ color: sourceColors[r.i] }} data-source={r.label} data-depth={r.depth}>
        <title>{`${r.label}: ${r.depth > 0 ? "+" : ""}${Math.round(r.depth / 65536 * 100)}%`}</title>
        <path d={arc.path} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
        <path d="M -2 -2 L 1 0 L -2 2" fill="none" stroke="currentColor" strokeWidth="1.5" transform={`translate(${arc.x} ${arc.y}) rotate(${arc.angle + (depth < 0 ? 180 : 0)})`}/>
      </g>;
        }))}
      {routes.length > 0 && <circle className="modulation-position" cx={liveDot.x} cy={liveDot.y} r="2.6" fill="#f4fbff" stroke="#15232e" strokeWidth="1" data-value={effectiveValue ?? base}/>}
    </svg>
    <span className="knob-face"><span className="knob-pointer" style={{ transform: `rotate(${-135 + 270 * (baseValue === undefined ? (value - min) / (max - min) : baseValue / 65535)}deg)` }}/></span>
  </div>;
}
