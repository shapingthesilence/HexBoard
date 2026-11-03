import {useLayoutEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent, type ReactNode} from 'react';
import {animationEase} from '../../animation.ts';
import {filterResponse} from './FilterResponse.tsx';
import {envelopePoints} from './ModSourceEditor.tsx';
import {timeValue} from './ModSourceEditor.tsx';
import {modulationSeconds} from './schema.ts';
import {cutoffHz} from './wavetableSchema.ts';
import {usePreviewAnimation} from './SynthVisualPreview.tsx';
import {CanvasPlot, plotDot, strokeWave, wavePath} from './CanvasPlot.tsx';
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
const peakOf = (all: number[][]) => {
  let peak = 1e-6;
  for (const wave of all) for (const value of wave) peak = Math.max(peak, Math.abs(value));
  return peak;
};
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

/** Sixteen frames as a receding stack; reuse one pixel surface for moving traces. */
export function TableTerrain({frame, live, spread, copies, warpMode, warpAmount, brightness, disabled, onFrame}: {frame: number; live: number; spread: number; copies: number; warpMode: number; warpAmount: number; brightness: number; disabled?: boolean; onFrame: (value: number) => void}) {
  const stack = useMemo(() => Array.from({length: frames}, (_, f) => waveform(frameSpectrum(f), 0, 0, 96)), []);
  const scale = useMemo(() => peakOf(stack), [stack]);
  const paths = useRef<{line: Path2D; fill: Path2D}[] | undefined>(undefined);
  const position = live * 15, spreadFrames = spread * 4;
  const current = useMemo(() => waveform(frameSpectrum(position, brightness), warpMode, warpAmount, 192), [position, brightness, warpMode, warpAmount]);
  const currentScale = Math.max(scale, peakOf([current]));
  const set = (e: PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(), y = (e.clientY - r.top) / r.height * 240; onFrame(Math.round(Math.max(0, Math.min(1, (196 - y) / 10.5 / 15)) * 65535)); };
  return <CanvasPlot className="wt-terrain" width={600} height={240} role="slider" tabIndex={disabled ? -1 : 0} aria-label="Wavetable frame · drag up and down" aria-valuemin={1} aria-valuemax={16} aria-valuenow={Math.round(frame * 15) + 1} aria-disabled={disabled}
    onPointerDown={e => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); set(e); }}
    onPointerMove={e => { if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) set(e); }}
    onKeyDown={e => { if (!disabled) keyStep(e, Math.round(frame * 65535), onFrame); }}
    paint={(ctx, c) => {
      paths.current ??= stack.map((_, i) => {
        const f = frames - 1 - i, wave = stack[f], x = 36 + f * 12, y = 196 - f * 10.5;
        const line = wavePath(wave, x, y, 380, 26, scale), fill = new Path2D(line);
        fill.lineTo(x + 380, y + 30); fill.lineTo(x, y + 30); fill.closePath();
        return {line, fill};
      });
      for (let i = 0; i < stack.length; ++i) {
        const f = frames - 1 - i, near = Math.abs(f - position) <= spreadFrames + .5;
        ctx.fillStyle = c.scope; ctx.globalAlpha = .92; ctx.fill(paths.current[i].fill);
        ctx.strokeStyle = near ? c.spread : c.frame; ctx.lineWidth = 1; ctx.globalAlpha = near ? 1 : .7; ctx.stroke(paths.current[i].line);
      }
      ctx.globalAlpha = 1; ctx.strokeStyle = c.edge; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(18, 196); ctx.lineTo(198, 38.5); ctx.stroke();
      ctx.fillStyle = c.accent;
      for (let i = 0; i < copies; ++i) {
        const f = Math.max(0, Math.min(15, position + (copies === 1 ? 0 : 2 * i / (copies - 1) - 1) * spreadFrames));
        plotDot(ctx, 18 + f * 12, 196 - f * 10.5, 3);
      }
      ctx.fillStyle = c.brand; plotDot(ctx, 18 + frame * 15 * 12, 196 - frame * 15 * 10.5, 6);
      ctx.strokeStyle = c.scope; ctx.stroke();
      strokeWave(ctx, current, 36 + position * 12, 196 - position * 10.5, 380, 34, currentScale);
      ctx.lineCap = 'butt'; ctx.lineJoin = 'round'; ctx.lineWidth = 2.4; ctx.strokeStyle = c.trace;
      ctx.shadowColor = c.trace; ctx.shadowBlur = 6 * ctx.getTransform().a; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = c.text; ctx.font = `10px ${c.font}`; ctx.fillText('1', 422, 200); ctx.fillText('16', 602, 42.5);
    }}/>;
}

/** Phase map (input → played phase) beside the single cycle it produces. */
export function WarpScope({mode, amount, frame, brightness}: {mode: number; amount: number; frame: number; brightness: number}) {
  const map = useMemo(() => Array.from({length: 97}, (_, i) => warp(i / 96, mode, amount)[0]), [mode, amount]);
  const top = Math.max(1, ...map);
  const wave = useMemo(() => waveform(frameSpectrum(frame * 15, brightness), mode, amount, 160), [frame, brightness, mode, amount]);
  const scale = peakOf([wave]);
  return <CanvasPlot className="wt-warp-scope" width={300} height={110} role="img" aria-label="Phase warp preview" paint={(ctx, c) => {
    ctx.fillStyle = c.raised; ctx.strokeStyle = c.border; ctx.beginPath(); ctx.roundRect(4, 6, 96, 96, 6); ctx.fill(); ctx.stroke();
    ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(4, 102); ctx.lineTo(100, 6); ctx.moveTo(112, 54); ctx.lineTo(296, 54); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath();
    map.forEach((q, i) => {
      const y = Math.round((102 - (q % 1 === 0 && q > 0 ? 1 : q % 1) * 96) * 10) / 10;
      if (i) ctx.lineTo(4 + i, y); else ctx.moveTo(4, y);
    });
    ctx.strokeStyle = c.accent; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.fillStyle = c.text; ctx.font = `10px ${c.font}`; ctx.fillText(top > 1.01 ? `×${top.toFixed(1)}` : 'phase', 8, 18);
    strokeWave(ctx, wave, 112, 54, 184, 44, scale); ctx.strokeStyle = c.trace; ctx.lineWidth = 2; ctx.stroke();
  }}/>;
}

/** Copies placed by stereo position and detune; faster shimmer means faster beating. */
export function UnisonField({copies, detune, width, spread}: {copies: number; detune: number; width: number; spread: number}) {
  const root = useRef<SVGSVGElement>(null);
  const dots = useRef<SVGCircleElement[]>([]);
  useLayoutEffect(() => { dots.current = Array.from(root.current!.querySelectorAll('.wt-unison-dot')); }, [copies]);
  usePreviewAnimation(root, (_node, elapsed, reduced) => {
    for (const dot of dots.current) {
      const duration = Number(dot.dataset.period), time = duration ? (elapsed % (2 * duration)) / duration : 0;
      const ease = animationEase(time <= 1 ? time : 2 - time);
      const opacity = reduced || !duration ? '.9' : (.45 + .55 * ease).toFixed(3);
      const transform = reduced || !duration ? 'none' : `scale(${(.85 + .25 * ease).toFixed(4)})`;
      if (dot.style.opacity !== opacity) dot.style.opacity = opacity;
      if (dot.style.transform !== transform) dot.style.transform = transform;
    }
  });
  const cents = detune * 50;
  return <svg ref={root} className="wt-unison" viewBox="0 0 260 110" role="img" aria-label={`${copies} unison voices`}>
    <path className="wt-scope-grid" d="M20 55H240M130 10V100"/>
    <text className="wt-axis" x="20" y="104">L</text><text className="wt-axis" x="236" y="104">R</text><text className="wt-axis" x="134" y="18">+{cents.toFixed(0)}¢</text>
    {Array.from({length: copies}, (_, c) => {
      const pos = copies === 1 ? 0 : 2 * c / (copies - 1) - 1, x = 130 + 105 * pos * width, y = 55 - 38 * pos * detune;
      const beat = Math.abs(220 * (2 ** (pos * cents / 1200) - 1));
      return <g key={c}>
        <line className="wt-unison-stem" x1={130} y1={55} x2={x} y2={y}/>
        <circle className="wt-unison-dot" cx={x} cy={y} r={5 + 3 * (1 - Math.abs(pos)) + 2 * spread} data-period={beat > .05 ? Number(Math.min(4, 1 / beat).toFixed(2)) * 1000 : 0}/>
      </g>;
    })}
  </svg>;
}

const modalRatios: Record<number, number[]> = {2: [1, 2.756, 5.404, 8.933], 3: [1, 3.984, 10.67, 20]};
const modalDecays: Record<number, number[]> = {2: [1, .65, .4, .25], 3: [1, .3, .1, .05]};
/** Resonant partials over a log frequency axis: tune moves them, decay lengthens them. */
export function ResonatorPartials({mode, tune, decay, mix}: {mode: number; tune: number; decay: number; mix: number}) {
  const ratio = 2 ** (3 * tune), x = (r: number) => Math.round((14 + Math.log2(r) / Math.log2(64) * 232) * 10) / 10;
  const partials = mode === 1 ? Array.from({length: 12}, (_, i) => [(i + 1) * ratio, (.9 + .0985 * decay) ** (i * 1.5)]) : (modalRatios[mode] ?? []).map((r, i) => [r * ratio, modalDecays[mode][i]]);
  return <svg className="wt-partials" viewBox="0 0 260 90" role="img" aria-label="Resonator partials">
    <path className="wt-scope-grid" d="M14 78H246"/>
    {mode === 0 ? <text className="wt-axis" x="130" y="48" textAnchor="middle">Off · the oscillator passes straight through</text> :
      partials.filter(([r]) => r < 64).map(([r, g], i) => <line key={i} className="wt-partial" x1={x(r)} x2={x(r)} y1={78} y2={Math.round((78 - 64 * g * (.35 + .65 * decay)) * 10) / 10} style={{opacity: (.35 + .65 * mix).toFixed(3)}}/>)}
    <text className="wt-axis" x="14" y="88">×1</text><text className="wt-axis" x="246" y="88" textAnchor="end">×64</text>
  </svg>;
}

/** Drag across for cutoff, up and down for resonance. */
export function FilterCurve({cutoff, resonance, mode, live, disabled, onChange}: {cutoff: number; resonance: number; mode: number; live: number; disabled?: boolean; onChange: (cutoff: number, resonance: number) => void}) {
  const dbY = (a: number) => 10 + (18 - Math.max(-42, Math.min(18, 20 * Math.log10(Math.max(1e-5, a))))) / 60 * 72;
  const curve = (c: number) => Array.from({length: 97}, (_, i) => Math.round(dbY(filterResponse(c, resonance, 1, mode, 20 * 1000 ** (i / 96))) * 10) / 10);
  const liveCurve = useMemo(() => curve(live), [live, resonance, mode]);
  const baseCurve = useMemo(() => curve(cutoff), [cutoff, resonance, mode]);
  const xOf = (c: number) => 8 + Math.log(cutoffHz(c) / 20) / Math.log(1000) * 240;
  const set = (e: PointerEvent<HTMLCanvasElement>) => onChange(Math.round(dragValue(e, 'x') * 65535), Math.round(dragValue(e, 'y', true) * 65535));
  return <CanvasPlot className="wt-filter" width={256} height={94} role="slider" tabIndex={disabled ? -1 : 0} aria-label="Filter cutoff and resonance · drag" aria-valuemin={0} aria-valuemax={65535} aria-valuenow={Math.round(cutoff * 65535)} aria-disabled={disabled}
    onPointerDown={e => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); set(e); }} onPointerMove={e => { if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) set(e); }}
    onKeyDown={e => { if (disabled) return; if (e.key === 'ArrowUp' || e.key === 'ArrowDown') keyStep(e, Math.round(resonance * 65535), v => onChange(Math.round(cutoff * 65535), v), ['ArrowUp'], ['ArrowDown']); else keyStep(e, Math.round(cutoff * 65535), v => onChange(v, Math.round(resonance * 65535)), ['ArrowRight'], ['ArrowLeft']); }}
    paint={(ctx, c) => {
      const line = (values: number[]) => { ctx.beginPath(); values.forEach((y, i) => { if (i) ctx.lineTo(8 + i * 2.5, y); else ctx.moveTo(8, y); }); };
      ctx.strokeStyle = c.border; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(8, 34); ctx.lineTo(248, 34); ctx.moveTo(8, 58); ctx.lineTo(248, 58); ctx.stroke(); ctx.setLineDash([]);
      line(liveCurve); ctx.lineTo(248, 90); ctx.lineTo(8, 90); ctx.closePath(); ctx.fillStyle = c.trace; ctx.globalAlpha = .14; ctx.fill(); ctx.globalAlpha = 1;
      line(baseCurve); ctx.setLineDash([4, 3]); ctx.strokeStyle = c.frame; ctx.stroke(); ctx.setLineDash([]);
      line(liveCurve); ctx.strokeStyle = c.trace; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = c.brand; plotDot(ctx, xOf(cutoff), dbY(filterResponse(cutoff, resonance, 1, mode, cutoffHz(cutoff))), 6); ctx.strokeStyle = c.scope; ctx.stroke();
    }}/>;
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
    {live !== undefined && live > 0 && <line className="wt-env-live" x1={10} x2={290} y1={Math.round((86 - 72 * live) * 10) / 10} y2={Math.round((86 - 72 * live) * 10) / 10}/>}
    {([[0, 2], [1, 4], [2, 5], [3, 6]] as const).map(([id, index]) => <circle key={id} className="wt-env-handle" cx={points[index][0]} cy={points[index][1]} r={6} role="slider" tabIndex={disabled ? -1 : 0}
      aria-label={`Amp ${['attack', 'decay', 'sustain', 'release'][id]}`} aria-valuemin={0} aria-valuemax={65535} aria-valuenow={values[id]}
      onPointerDown={e => { if (disabled) return; drag.current = id; (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); }}
      onKeyDown={e => { if (!disabled) keyStep(e, values[id], v => onChange(id, v)); }}/>)}
  </svg>;
}

export interface FlowStage {id: string; label: string; active: boolean; cost: number; note?: string}
/** Order of operations: each stage feeds the next; the sub skips straight to the output. */
export function SignalFlow({stages, subActive, playing, onSelect}: {stages: FlowStage[]; subActive: boolean; playing: boolean; onSelect: (id: string) => void}): ReactNode {
  const root = useRef<HTMLElement>(null);
  usePreviewAnimation(root, (node, elapsed, reduced) => {
    if (!playing) return;
    (node as HTMLElement).style.setProperty('--wt-flow-position', `${reduced ? 100 : (100 - 200 * (elapsed % 900) / 900).toFixed(1)}%`);
  });
  return <nav ref={root} className="wt-flow" aria-label="Signal flow" data-playing={playing || undefined}>
    <ol>{stages.map(s => <li key={s.id} data-active={s.active || undefined}>
      <button type="button" onClick={() => onSelect(s.id)} title={s.note}><span className="wt-flow-name">{s.label}</span>{s.cost > 0 && <span className="wt-flow-cost">{s.cost}%</span>}</button>
    </li>)}</ol>
    <div className="wt-flow-sub" data-active={subActive || undefined} title="Clean sub: skips the resonator, filter and FX rack"><span>Sub · clean bypass</span></div>
  </nav>;
}
