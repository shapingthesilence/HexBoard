import {useRef, type KeyboardEvent, type PointerEvent} from 'react';
import {bendThrough, envelopeCurve} from './envelopeCurve.ts';
import './CurvedEnvelope.css';

export type CurveSegment = 'attack' | 'decay' | 'release';
export interface CurvedEnvelopeValues {delay?: number; attack: number; hold?: number; decay: number; sustain: number; release: number}
type Bends = Record<CurveSegment, number>;
const base = 86, top = 14, width = 280, left = 10, steps = 24;
/**
 * Shared draggable envelope for every engine: corner handles set time (and
 * sustain); the midpoint handle on each attack/decay/release segment sets its
 * curve. Double-click a curve handle to straighten it. Times are seconds.
 */
export function CurvedEnvelope({values, bends, live, disabled, label = 'Envelope', onTime, onSustain, onBend}: {
  values: CurvedEnvelopeValues; bends?: Bends; live?: number; disabled?: boolean; label?: string;
  onTime?: (segment: CurveSegment, seconds: number) => void; onSustain?: (level: number) => void; onBend?: (segment: CurveSegment, bend: number) => void;
}) {
  const b = bends ?? {attack: 0, decay: 0, release: 0};
  const delay = values.delay ?? 0, hold = values.hold ?? 0, sustainShow = .3;
  const total = Math.max(.02, delay + values.attack + hold + values.decay + sustainShow + values.release);
  // Each curved segment keeps a minimum width so its handle stays reachable.
  const visual = (t: number) => Math.max(t, total * .05);
  const shown = [delay, visual(values.attack), hold, visual(values.decay), sustainShow, visual(values.release)];
  const scale = width / shown.reduce((a, x) => a + x, 0);
  const xs: number[] = [left]; for (const t of shown) xs.push(xs[xs.length - 1] + t * scale);
  const ySus = base - (base - top) * values.sustain;
  const segments = {
    attack: {x0: xs[1], x1: xs[2], y0: base, y1: top, bend: b.attack},
    decay: {x0: xs[3], x1: xs[4], y0: top, y1: ySus, bend: b.decay},
    release: {x0: xs[5], x1: xs[6], y0: ySus, y1: base, bend: b.release}
  };
  const curvePath = (s: typeof segments.attack) => Array.from({length: steps}, (_, i) => { const t = (i + 1) / steps; return `L${(s.x0 + (s.x1 - s.x0) * t).toFixed(1)},${(s.y0 + (s.y1 - s.y0) * envelopeCurve(t, s.bend)).toFixed(1)}`; }).join('');
  const d = `M${xs[0]},${base}L${xs[1]},${base}${curvePath(segments.attack)}L${xs[3]},${top}${curvePath(segments.decay)}L${xs[5]},${ySus}${curvePath(segments.release)}`;
  const drag = useRef<{kind: 'time' | 'curve'; segment: CurveSegment} | undefined>(undefined);
  const point = (e: PointerEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); return {x: (e.clientX - r.left) / r.width * 300, y: (e.clientY - r.top) / r.height * 100}; };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const active = drag.current; if (!active || disabled) return;
    const {x, y} = point(e), s = segments[active.segment];
    if (active.kind === 'curve') { if (s.y1 !== s.y0) onBend?.(active.segment, bendThrough((y - s.y0) / (s.y1 - s.y0))); return; }
    // Corner: time from the segment start in display seconds; decay also sets sustain.
    onTime?.(active.segment, Math.max(0, (x - s.x0) / scale));
    if (active.segment === 'decay') onSustain?.(Math.max(0, Math.min(1, (base - y) / (base - top))));
  };
  const start = (e: PointerEvent<SVGElement>, kind: 'time' | 'curve', segment: CurveSegment) => {
    if (disabled) return; e.preventDefault(); drag.current = {kind, segment}; (e.currentTarget.ownerSVGElement ?? e.currentTarget as unknown as SVGSVGElement).setPointerCapture(e.pointerId);
  };
  const nudge = (e: KeyboardEvent, segment: CurveSegment) => {
    if (disabled || !['ArrowUp', 'ArrowDown', 'Home'].includes(e.key)) return; e.preventDefault();
    const s = segments[segment], rising = s.y1 < s.y0, step = (e.shiftKey ? .02 : .1) * (e.key === 'ArrowUp' === rising ? -1 : 1);
    onBend?.(segment, e.key === 'Home' ? 0 : Math.max(-1, Math.min(1, s.bend + step)));
  };
  const curveHandle = (segment: CurveSegment) => {
    const s = segments[segment]; if (!onBend || s.y1 === s.y0) return null;
    const cx = (s.x0 + s.x1) / 2, cy = s.y0 + (s.y1 - s.y0) * envelopeCurve(.5, s.bend);
    return <g key={segment} className="curve-handle" role="slider" tabIndex={disabled ? -1 : 0} aria-label={`${label} ${segment} curve`} aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(s.bend * 100)}
      aria-valuetext={s.bend === 0 ? 'Straight' : `${s.bend < 0 ? 'Fast' : 'Slow'} ${Math.round(Math.abs(s.bend) * 100)}%`}
      onPointerDown={e => start(e, 'curve', segment)} onDoubleClick={() => { if (!disabled) onBend(segment, 0); }} onKeyDown={e => nudge(e, segment)}>
      <title>Drag to bend · double-click to straighten</title>
      <circle cx={cx} cy={cy} r={12} fill="transparent"/><rect className="curve-handle-mark" x={cx - 4} y={cy - 4} width={8} height={8} rx={2} transform={`rotate(45 ${cx} ${cy})`}/>
    </g>;
  };
  const timeHandle = (segment: CurveSegment, cx: number, cy: number) => onTime && <circle key={segment} className="time-handle" cx={cx} cy={cy} r={5.5} role="slider" tabIndex={disabled ? -1 : 0}
    aria-label={`${label} ${segment} time`} aria-valuemin={0} aria-valuemax={20} aria-valuenow={Math.round(values[segment] * 1000) / 1000}
    onPointerDown={e => start(e, 'time', segment)}
    onKeyDown={e => { if (disabled || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); onTime(segment, Math.max(0, values[segment] * (e.key === 'ArrowRight' ? 1.1 : 1 / 1.1) + (e.key === 'ArrowRight' && values[segment] < .001 ? .001 : 0))); }}/>;
  return <svg className="curved-envelope" viewBox="0 0 300 100" role="group" aria-label={`${label} · drag corners for time, diamonds for curve`}
    onPointerMove={move} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }} data-disabled={disabled || undefined}>
    <path className="curved-envelope-grid" d={`M${left} ${top}H${left + width}M${left} ${base}H${left + width}`}/>
    <path className="curved-envelope-fill" d={`${d}L${xs[6]},${base}Z`}/>
    <path className="curved-envelope-line" d={d}/>
    {live !== undefined && live > 0 && <line className="curved-envelope-live" x1={left} x2={left + width} y1={base - (base - top) * live} y2={base - (base - top) * live}/>}
    {(['attack', 'decay', 'release'] as const).map(curveHandle)}
    {timeHandle('attack', xs[2], top)}{timeHandle('decay', xs[4], ySus)}{timeHandle('release', xs[6], base)}
  </svg>;
}
