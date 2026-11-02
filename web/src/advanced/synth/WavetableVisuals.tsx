import {useMemo, useRef, type KeyboardEvent, type PointerEvent, type ReactNode} from 'react';
import {filterResponse} from './FilterResponse.tsx';
import {envelopePoints} from './ModSourceEditor.tsx';
import {timeValue} from './ModSourceEditor.tsx';
import {modulationSeconds} from './schema.ts';
import {cutoffHz} from './wavetableSchema.ts';
// UI-only previews of the board's wavetable model. They follow the firmware's
// Basic Shapes spectrum and phase-warp formulas; they never feed DSP.
const frames = 16, harmonics = 48;
function shapeHarmonic(anchor: number, h: number) {
  if (anchor === 0) return h === 1 ? 1 : 0;
  if (anchor === 1) return h & 1 ? 8 / (Math.PI * Math.PI) * ((h >> 1) & 1 ? -1 : 1) / (h * h) : 0;
  if (anchor === 2) return 2 / Math.PI * (h & 1 ? 1 : -1) / h;
  return h & 1 ? 4 / (Math.PI * h) : 0;
}
/** Harmonic amplitudes at a fractional frame (0..15), with Brightness as a harmonic count. */
export function frameSpectrum(frame: number, brightness = 1) {
  const x = 3 * Math.max(0, Math.min(15, frame)) / (frames - 1), a = Math.min(2, Math.floor(x)), t = x - a;
  // Firmware Brightness: 2^(8b) harmonics, half-octave taper, fundamental kept.
  const top = 2 ** (8 * brightness), start = Math.max(1, top / 2);
  return Array.from({length: harmonics}, (_, i) => {
    const h = i + 1, cut = h > top ? 0 : h <= start ? 1 : .5 + .5 * Math.cos(Math.PI * Math.log2(h / (top / 2)));
    return (shapeHarmonic(a, h) + t * (shapeHarmonic(a + 1, h) - shapeHarmonic(a, h))) * cut;
  });
}
/** Unit-phase warp with the firmware's Fold/Poly/Duty/Sync shapes. Returns [phase, window]. */
export function warp(p: number, mode: number, amount: number): [number, number] {
  const tri = p < .5 ? p : 1 - p;
  if (mode === 1) return [p + tri * amount * 127 * 1280 / 65536, 1];
  if (mode === 2) return [p + 2 * tri * (1 - 2 * tri) * amount * 127 / 128, 1];
  if (mode === 3) {
    const w = 1 / 16, ramp = p < .5 - w / 2 ? (p < w / 2 ? (p + w / 2) * 16 : 1) : p < .5 + w / 2 ? (.5 + w / 2 - p) * 16 : p > 1 - w / 2 ? (p - 1 + w / 2) * 16 : 0;
    return [p + amount * 127 / 512 * (2 * ramp - 1), 1];
  }
  if (mode === 4) { const q = 4 * p * (1 - p); return [p * (1 + 7 * amount), q * q]; }
  return [p, 1];
}
export function waveform(spectrum: number[], mode = 0, amount = 0, n = 160) {
  const out = Array.from({length: n}, (_, i) => {
    const [q, window] = warp(i / n, mode, amount);
    let v = 0; for (let h = 0; h < spectrum.length; ++h) if (spectrum[h]) v += spectrum[h] * Math.sin(2 * Math.PI * (h + 1) * q);
    return v * window;
  });
  return out;
}
const peakOf = (all: number[][]) => Math.max(1e-6, ...all.flatMap(w => w.map(Math.abs)));
const path = (w: number[], x: number, y: number, width: number, height: number, scale: number) =>
  w.map((v, i) => `${i ? 'L' : 'M'}${(x + i * width / (w.length - 1)).toFixed(1)},${(y - v / scale * height).toFixed(1)}`).join('');
function dragValue(e: PointerEvent<Element>, axis: 'x' | 'y', invert = false) {
  const r = e.currentTarget.getBoundingClientRect(), t = axis === 'x' ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
  const v = Math.max(0, Math.min(1, t));
  return invert ? 1 - v : v;
}
const keyStep = (e: KeyboardEvent, value: number, set: (v: number) => void, up = ['ArrowUp', 'ArrowRight'], down = ['ArrowDown', 'ArrowLeft']) => {
  if (![...up, ...down, 'Home', 'End'].includes(e.key)) return;
  e.preventDefault(); const step = e.shiftKey ? 655 : 2048;
  set(e.key === 'Home' ? 0 : e.key === 'End' ? 65535 : Math.max(0, Math.min(65535, value + (up.includes(e.key) ? step : -step))));
};

/** Sixteen frames as a receding stack; the bright trace is what the voice plays now. */
export function TableTerrain({frame, live, spread, copies, warpMode, warpAmount, brightness, disabled, onFrame}: {frame: number; live: number; spread: number; copies: number; warpMode: number; warpAmount: number; brightness: number; disabled?: boolean; onFrame: (value: number) => void}) {
  const stack = useMemo(() => Array.from({length: frames}, (_, f) => waveform(frameSpectrum(f), 0, 0, 96)), []);
  const scale = useMemo(() => peakOf(stack), [stack]);
  const position = live * 15, spreadFrames = spread * 4;
  const current = useMemo(() => waveform(frameSpectrum(position, brightness), warpMode, warpAmount, 192), [position, brightness, warpMode, warpAmount]);
  const currentScale = Math.max(scale, peakOf([current]));
  const origin = (f: number) => [36 + f * 12, 196 - f * 10.5];
  const copyFrames = Array.from({length: copies}, (_, c) => Math.max(0, Math.min(15, position + (copies === 1 ? 0 : 2 * c / (copies - 1) - 1) * spreadFrames)));
  const set = (e: PointerEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(), y = (e.clientY - r.top) / r.height * 240; onFrame(Math.round(Math.max(0, Math.min(1, (196 - y) / 10.5 / 15)) * 65535)); };
  const [cx, cy] = origin(position);
  return <svg className="wt-terrain" viewBox="0 0 600 240" role="slider" tabIndex={disabled ? -1 : 0} aria-label="Wavetable frame · drag up and down" aria-valuemin={1} aria-valuemax={16} aria-valuenow={Math.round(frame * 15) + 1} aria-disabled={disabled}
    onPointerDown={e => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); set(e); }}
    onPointerMove={e => { if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) set(e); }}
    onKeyDown={e => { if (!disabled) keyStep(e, Math.round(frame * 65535), onFrame); }}>
    <defs><filter id="wt-glow" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    {stack.map((w, i) => { const f = frames - 1 - i, [x, y] = origin(f), near = Math.abs(f - position) <= spreadFrames + .5;
      return <g key={f} className={near ? 'wt-frame in-spread' : 'wt-frame'}>
        <path className="wt-frame-fill" d={`${path(w, x, y, 380, 26, scale)}L${x + 380},${y + 30}L${x},${y + 30}Z`}/>
        <path className="wt-frame-line" d={path(w, x, y, 380, 26, scale)}/>
      </g>; })}
    <path className="wt-rail" d={`M${origin(0)[0] - 18},${origin(0)[1]} L${origin(15)[0] - 18},${origin(15)[1]}`}/>
    {copyFrames.map((f, i) => { const [x, y] = origin(f); return <circle key={i} className="wt-copy-dot" cx={x - 18} cy={y} r={3}/>; })}
    <circle className="wt-base-dot" cx={origin(frame * 15)[0] - 18} cy={origin(frame * 15)[1]} r={6}/>
    <path className="wt-current" filter="url(#wt-glow)" d={path(current, cx, cy, 380, 34, currentScale)}/>
    <text className="wt-axis" x={origin(0)[0] + 386} y={origin(0)[1] + 4}>1</text><text className="wt-axis" x={origin(15)[0] + 386} y={origin(15)[1] + 4}>16</text>
  </svg>;
}

/** Phase map (input → played phase) beside the single cycle it produces. */
export function WarpScope({mode, amount, frame, brightness}: {mode: number; amount: number; frame: number; brightness: number}) {
  const map = Array.from({length: 97}, (_, i) => { const [q] = warp(i / 96, mode, amount); return q; });
  const top = Math.max(1, ...map);
  const wave = useMemo(() => waveform(frameSpectrum(frame * 15, brightness), mode, amount, 160), [frame, brightness, mode, amount]);
  const scale = peakOf([wave]);
  return <svg className="wt-warp-scope" viewBox="0 0 300 110" role="img" aria-label="Phase warp preview">
    <rect className="wt-scope-bg" x="4" y="6" width="96" height="96" rx="6"/>
    <path className="wt-scope-grid" d="M4 102L100 6"/>
    <path className="wt-warp-map" d={map.map((q, i) => `${i ? 'L' : 'M'}${(4 + i).toFixed(1)},${(102 - (q % 1 === 0 && q > 0 ? 1 : q % 1) * 96).toFixed(1)}`).join('')}/>
    <text className="wt-axis" x="8" y="18">{top > 1.01 ? `×${top.toFixed(1)}` : 'phase'}</text>
    <path className="wt-scope-grid" d="M112 54H296"/>
    <path className="wt-scope-wave" d={path(wave, 112, 54, 184, 44, scale)}/>
  </svg>;
}

/** Copies placed by stereo position and detune; faster shimmer means faster beating. */
export function UnisonField({copies, detune, width, spread}: {copies: number; detune: number; width: number; spread: number}) {
  const cents = detune * 50;
  return <svg className="wt-unison" viewBox="0 0 260 110" role="img" aria-label={`${copies} unison voices`}>
    <path className="wt-scope-grid" d="M20 55H240M130 10V100"/>
    <text className="wt-axis" x="20" y="104">L</text><text className="wt-axis" x="236" y="104">R</text><text className="wt-axis" x="134" y="18">+{cents.toFixed(0)}¢</text>
    {Array.from({length: copies}, (_, c) => {
      const pos = copies === 1 ? 0 : 2 * c / (copies - 1) - 1, x = 130 + 105 * pos * width, y = 55 - 38 * pos * detune;
      const beat = Math.abs(220 * (2 ** (pos * cents / 1200) - 1));
      return <g key={c}>
        <line className="wt-unison-stem" x1={130} y1={55} x2={x} y2={y}/>
        <circle className="wt-unison-dot" cx={x} cy={y} r={5 + 3 * (1 - Math.abs(pos)) + 2 * spread} style={{animationDuration: beat > .05 ? `${Math.min(4, 1 / beat).toFixed(2)}s` : '0s'}}/>
      </g>;
    })}
  </svg>;
}

const modalRatios: Record<number, number[]> = {2: [1, 2.756, 5.404, 8.933], 3: [1, 3.984, 10.67, 20]};
const modalDecays: Record<number, number[]> = {2: [1, .65, .4, .25], 3: [1, .3, .1, .05]};
/** Resonant partials over a log frequency axis: tune moves them, decay lengthens them. */
export function ResonatorPartials({mode, tune, decay, mix}: {mode: number; tune: number; decay: number; mix: number}) {
  const ratio = 2 ** (3 * tune), x = (r: number) => 14 + Math.log2(r) / Math.log2(64) * 232;
  const partials = mode === 1 ? Array.from({length: 12}, (_, i) => [(i + 1) * ratio, (.9 + .0985 * decay) ** (i * 1.5)]) : (modalRatios[mode] ?? []).map((r, i) => [r * ratio, modalDecays[mode][i]]);
  return <svg className="wt-partials" viewBox="0 0 260 90" role="img" aria-label="Resonator partials">
    <path className="wt-scope-grid" d="M14 78H246"/>
    {mode === 0 ? <text className="wt-axis" x="130" y="48" textAnchor="middle">Off · the oscillator passes straight through</text> :
      partials.filter(([r]) => r < 64).map(([r, g], i) => <line key={i} className="wt-partial" x1={x(r)} x2={x(r)} y1={78} y2={78 - 64 * g * (.35 + .65 * decay)} style={{opacity: .35 + .65 * mix}}/>)}
    <text className="wt-axis" x="14" y="88">×1</text><text className="wt-axis" x="246" y="88" textAnchor="end">×64</text>
  </svg>;
}

/** Drag across for cutoff, up and down for resonance. */
export function FilterCurve({cutoff, resonance, mode, live, disabled, onChange}: {cutoff: number; resonance: number; mode: number; live: number; disabled?: boolean; onChange: (cutoff: number, resonance: number) => void}) {
  const dbY = (a: number) => 10 + (18 - Math.max(-42, Math.min(18, 20 * Math.log10(Math.max(1e-5, a))))) / 60 * 72;
  const curve = (c: number) => Array.from({length: 97}, (_, i) => { const hz = 20 * 1000 ** (i / 96); return `${i ? 'L' : 'M'}${(8 + i * 2.5).toFixed(1)},${dbY(filterResponse(c, resonance, 1, mode, hz)).toFixed(1)}`; }).join('');
  const xOf = (c: number) => 8 + Math.log(cutoffHz(c) / 20) / Math.log(1000) * 240;
  const set = (e: PointerEvent<SVGSVGElement>) => onChange(Math.round(dragValue(e, 'x') * 65535), Math.round(dragValue(e, 'y', true) * 65535));
  return <svg className="wt-filter" viewBox="0 0 256 94" role="slider" tabIndex={disabled ? -1 : 0} aria-label="Filter cutoff and resonance · drag" aria-valuemin={0} aria-valuemax={65535} aria-valuenow={Math.round(cutoff * 65535)} aria-disabled={disabled}
    onPointerDown={e => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); set(e); }} onPointerMove={e => { if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) set(e); }}
    onKeyDown={e => { if (disabled) return; if (e.key === 'ArrowUp' || e.key === 'ArrowDown') keyStep(e, Math.round(resonance * 65535), v => onChange(Math.round(cutoff * 65535), v), ['ArrowUp'], ['ArrowDown']); else keyStep(e, Math.round(cutoff * 65535), v => onChange(v, Math.round(resonance * 65535)), ['ArrowRight'], ['ArrowLeft']); }}>
    <path className="wt-scope-grid" d="M8 34H248M8 58H248"/>
    <path className="wt-filter-fill" d={`${curve(live)}L248,90L8,90Z`}/>
    <path className="wt-filter-base" d={curve(cutoff)}/>
    <path className="wt-filter-line" d={curve(live)}/>
    <circle className="wt-filter-handle" cx={xOf(cutoff)} cy={dbY(filterResponse(cutoff, resonance, 1, mode, cutoffHz(cutoff)))} r={6}/>
  </svg>;
}

/** Amp ADSR with draggable attack, decay/sustain and release handles. */
export function EnvelopeGraph({values, live, disabled, onChange}: {values: [number, number, number, number]; live?: number; disabled?: boolean; onChange: (index: number, value: number) => void}) {
  const settings = [values[0], values[1], values[2], values[3], 0, 0, 32768, 0];
  const points = envelopePoints(settings);
  const drag = useRef<number | undefined>(undefined);
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const id = drag.current; if (id === undefined || disabled) return;
    const r = e.currentTarget.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 300, y = (e.clientY - r.top) / r.height * 100;
    if (id === 2) { onChange(2, Math.round(Math.max(0, Math.min(1, (86 - y) / 72)) * 65535)); return; }
    const total = Math.max(.02, [0, 1, 3].reduce((a, i) => a + modulationSeconds(settings[i]), .3)), previous = id === 0 ? points[1][0] : id === 1 ? points[3][0] : points[5][0];
    onChange(id, timeValue(Math.max(0, x - previous) / 280 * total));
  };
  const d = `M${points.map(p => p.join(',')).join('L')}`;
  return <svg className="wt-envelope" viewBox="0 0 300 100" onPointerMove={move} onPointerUp={() => drag.current = undefined} onPointerCancel={() => drag.current = undefined} aria-label="Amp envelope · drag the handles">
    <path className="wt-scope-grid" d="M10 14H290M10 86H290"/>
    <path className="wt-env-fill" d={`${d}L${points[points.length - 1][0]},86Z`}/><path className="wt-env-line" d={d}/>
    {live !== undefined && live > 0 && <line className="wt-env-live" x1={10} x2={290} y1={86 - 72 * live} y2={86 - 72 * live}/>}
    {([[0, 2], [1, 4], [2, 5], [3, 6]] as const).map(([id, index]) => <circle key={id} className="wt-env-handle" cx={points[index][0]} cy={points[index][1]} r={6} role="slider" tabIndex={disabled ? -1 : 0}
      aria-label={`Amp ${['attack', 'decay', 'sustain', 'release'][id]}`} aria-valuemin={0} aria-valuemax={65535} aria-valuenow={values[id]}
      onPointerDown={e => { if (disabled) return; drag.current = id; (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); }}
      onKeyDown={e => { if (!disabled) keyStep(e, values[id], v => onChange(id, v)); }}/>)}
  </svg>;
}

export interface FlowStage {id: string; label: string; active: boolean; cost: number; note?: string}
/** Order of operations: each stage feeds the next; the sub skips straight to the output. */
export function SignalFlow({stages, subActive, playing, onSelect}: {stages: FlowStage[]; subActive: boolean; playing: boolean; onSelect: (id: string) => void}): ReactNode {
  return <nav className="wt-flow" aria-label="Signal flow" data-playing={playing || undefined}>
    <ol>{stages.map(s => <li key={s.id} data-active={s.active || undefined}>
      <button type="button" onClick={() => onSelect(s.id)} title={s.note}><span className="wt-flow-name">{s.label}</span>{s.cost > 0 && <span className="wt-flow-cost">{s.cost}%</span>}</button>
    </li>)}</ol>
    <div className="wt-flow-sub" data-active={subActive || undefined} title="Clean sub: skips the resonator, filter and ensemble"><span>Sub · clean bypass</span></div>
  </nav>;
}
