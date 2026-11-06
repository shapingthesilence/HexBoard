import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { SynthVoiceShape, SynthVoiceShapeListener } from "../../audio/synthPreview.ts";
import { CanvasPlot, plotDot, type PlotColors } from "../../advanced/synth/CanvasPlot.tsx";
import { SYNTH_WAVETABLE_FRAME_COUNT, SYNTH_WAVETABLE_SAMPLE_COUNT } from "../../catalogs/index.ts";
import { driveInputGain, driveTransfer, envelopeTimeIndex, envelopeTimeLabel, envelopeTimeMs, envelopePositionCount, envelopeTimePosition, ModTarget, warpPhase } from "./classicSynthModel.ts";

const lastFrame = SYNTH_WAVETABLE_FRAME_COUNT - 1;



/** One frame of the table's base (unfiltered) samples, −1…1, read with linear interpolation. */
function frameSample(samples: Uint8Array, frame: number, phase: number): number {
  const offset = frame * SYNTH_WAVETABLE_SAMPLE_COUNT, x = phase * SYNTH_WAVETABLE_SAMPLE_COUNT, i = Math.floor(x) % SYNTH_WAVETABLE_SAMPLE_COUNT;
  const a = samples[offset + i], b = samples[offset + (i + 1) % SYNTH_WAVETABLE_SAMPLE_COUNT];
  return (a + (b - a) * (x - Math.floor(x)) - 128) / 128;
}
function frameWave(samples: Uint8Array, frame: number, points: number, shape: (phase: number) => number = (phase) => phase): Float32Array {
  const wave = new Float32Array(points + 1);
  for (let i = 0; i <= points; ++i) wave[i] = frameSample(samples, frame, shape(i / points));
  return wave;
}
function trace(ctx: CanvasRenderingContext2D, wave: Float32Array, x: number, y: number, width: number, height: number) {
  ctx.beginPath();
  for (let i = 0; i < wave.length; ++i) {
    const px = x + i * width / (wave.length - 1), py = y - wave[i] * height;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
}
const unavailable = (ctx: CanvasRenderingContext2D, c: PlotColors, x: number, y: number) => {
  ctx.fillStyle = c.text; ctx.font = `11px ${c.font}`; ctx.textAlign = "center"; ctx.fillText("Waveform preview unavailable", x, y); ctx.textAlign = "left";
};
const frameStep = (e: KeyboardEvent, frame: number, onFrame: (frame: number) => void) => {
  const delta = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
  if (delta === undefined && e.key !== "Home" && e.key !== "End") return;
  e.preventDefault();
  onFrame(e.key === "Home" ? 0 : e.key === "End" ? lastFrame : Math.max(0, Math.min(lastFrame, frame + (delta ?? 0))));
};

/** The table's 16 frames as a receding stack; drag up and down to pick the set frame.
 * While the browser preview plays, the frame the newest voice has reached glides through the stack. */
export function WavetableStack({ samples, name, frame, live, onFrame }: { samples?: Uint8Array; name: string; frame: number; live: SynthVoiceShape | null; onFrame: (frame: number) => void }) {
  const waves = useMemo(() => samples && Array.from({ length: SYNTH_WAVETABLE_FRAME_COUNT }, (_, f) => frameWave(samples, f, 96)), [samples]);
  // The stack shows the frame the voice has reached, as stored; the cycle view beside it shows the bends.
  const livePosition = live?.position;
  const playing = useMemo(() => samples && livePosition !== undefined ? { at: framePosition(livePosition), cycle: liveCycle(samples, { position: livePosition, fold: 0, duty: 0, poly: 0 }, 96) } : undefined, [samples, livePosition]);
  const paint = useCallback((ctx: CanvasRenderingContext2D, c: PlotColors) => {
    if (!waves) { unavailable(ctx, c, 300, 120); return; }
    ctx.lineJoin = ctx.lineCap = "round";
    for (let f = lastFrame; f >= 0; --f) {
      const x = 36 + f * 12, y = 186 - f * 10;
      trace(ctx, waves[f], x, y, 380, 30); ctx.lineTo(x + 380, y + 34); ctx.lineTo(x, y + 34); ctx.closePath();
      ctx.fillStyle = c.scope; ctx.globalAlpha = .92; ctx.fill();
      trace(ctx, waves[f], x, y, 380, 30); ctx.strokeStyle = c.frame; ctx.lineWidth = 1; ctx.globalAlpha = .6; ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const at = playing?.at ?? frame, x = 36 + at * 12, y = 186 - at * 10, gradient = ctx.createLinearGradient(x, 0, x + 380, 0);
    gradient.addColorStop(0, c.trace); gradient.addColorStop(1, c.accent);
    trace(ctx, playing?.cycle ?? waves[frame], x, y, 380, 30); ctx.strokeStyle = gradient; ctx.lineWidth = 2.6; ctx.stroke();
    ctx.strokeStyle = c.edge; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(18, 186); ctx.lineTo(18 + lastFrame * 12, 186 - lastFrame * 10); ctx.stroke();
    // The set frame keeps its handle; a playing voice shows as a ring where it is now.
    ctx.fillStyle = c.brand; plotDot(ctx, 18 + frame * 12, 186 - frame * 10, 6);
    if (playing) { ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(18 + at * 12, 186 - at * 10, 8, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.fillStyle = c.text; ctx.font = `11px ${c.font}`; ctx.fillText(`${name} · frame ${frame + 1} of 16`, 12, 18);
  }, [waves, frame, playing, name]);
  const fromPointer = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), y = (e.clientY - r.top) / r.height * 230;
    onFrame(Math.max(0, Math.min(lastFrame, Math.round((171 - y) / 10))));
  };
  return <CanvasPlot className="classic-stack" width={600} height={230} paint={paint} role="slider" tabIndex={0}
    aria-label="Wavetable position · drag up and down" aria-valuemin={1} aria-valuemax={16} aria-valuenow={frame + 1}
    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); fromPointer(e); }}
    onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e); }}
    onKeyDown={(e) => frameStep(e, frame, onFrame)}/>;
}

/** Table position (0–127) as frames, snapping the 16 stored positions like the firmware. */
function framePosition(position: number): number {
  const frame = position / 127 * lastFrame, nearest = Math.round(frame);
  return position === Math.round(nearest * 127 / lastFrame) ? nearest : frame;
}
/** One cycle as the newest voice renders it: blended frames, then fold, pulse-width and poly bends. */
function liveCycle(samples: Uint8Array, shape: SynthVoiceShape, points: number): Float32Array {
  const frames = framePosition(shape.position), a = Math.floor(frames), b = Math.min(lastFrame, a + 1), mix = frames - a;
  const cycle = new Float32Array(points + 1);
  for (let i = 0; i <= points; ++i) {
    let phase = i / points;
    phase = warpPhase(ModTarget.WaveFolding, phase, shape.fold / 127);
    phase = warpPhase(ModTarget.PulseWidth, phase, shape.duty / 127);
    phase = warpPhase(ModTarget.PolyWarp, phase, shape.poly / 127);
    cycle[i] = frameSample(samples, a, phase) * (1 - mix) + frameSample(samples, b, phase) * mix;
  }
  return cycle;
}
// Redraw for audible changes only, not every reported fraction.
const settledShape = (shape: SynthVoiceShape | null) => shape && {
  position: Math.round(shape.position * 4) / 4, fold: Math.round(shape.fold), duty: Math.round(shape.duty), poly: Math.round(shape.poly)
};

/** Follows the newest browser-preview voice, settled to audible changes; null while nothing plays. */
export function useLiveVoiceShape(subscribe?: (listener: SynthVoiceShapeListener) => () => void): SynthVoiceShape | null {
  const [live, setLive] = useState<SynthVoiceShape | null>(null);
  useEffect(() => {
    if (!subscribe) return undefined;
    let last = "null";
    const stop = subscribe((shape) => {
      const settled = settledShape(shape), key = JSON.stringify(settled);
      if (key !== last) { last = key; setLive(settled); }
    });
    return () => { stop(); setLive(null); };
  }, [subscribe]);
  return live;
}

/** The cycle the newest browser-preview voice is playing now; the set frame while nothing plays. */
export function LiveCycleView({ samples, position, live }: { samples?: Uint8Array; position: number; live: SynthVoiceShape | null }) {
  const shape = live ?? { position, fold: 0, duty: 0, poly: 0 };
  const cycle = useMemo(() => samples && liveCycle(samples, shape, 180), [samples, shape.position, shape.fold, shape.duty, shape.poly]);
  const frame = framePosition(shape.position) + 1;
  const label = `${live ? "Playing" : "Set"} · frame ${Number.isInteger(frame) ? frame : frame.toFixed(1)}`;
  const bends = live ? [["Fold", live.fold], ["Pulse", live.duty], ["Poly", live.poly]].filter(([, v]) => v !== 0).map(([n, v]) => `${n} ${Math.round(Number(v) / 127 * 100)}%`).join(" · ") : "";
  const paint = useCallback((ctx: CanvasRenderingContext2D, c: PlotColors) => {
    if (!cycle) { unavailable(ctx, c, 200, 115); return; }
    const mid = 122, height = 82;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.strokeStyle = c.border; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(10, mid); ctx.lineTo(390, mid); ctx.stroke(); ctx.setLineDash([]);
    const gradient = ctx.createLinearGradient(10, 0, 390, 0); gradient.addColorStop(0, c.trace); gradient.addColorStop(1, c.accent);
    trace(ctx, cycle, 10, mid, 380, height); ctx.strokeStyle = gradient; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.font = `11px ${c.font}`; ctx.fillStyle = c.text; ctx.fillText(label, 12, 18);
    ctx.textAlign = "right"; ctx.fillText(bends || (live ? "" : "Play a note to see it live"), 390, 18); ctx.textAlign = "left";
  }, [cycle, label, bends, live]);
  return <CanvasPlot className="classic-scope" width={400} height={230} paint={paint} role="img" aria-label={`${label}${bends ? `, ${bends}` : ""}`}/>;
}

/** Output drive: the board's transfer curve, and the played frame through it at full level. */
export function DriveView({ samples, frame, mode }: { samples?: Uint8Array; frame: number; mode: number }) {
  const paint = useCallback((ctx: CanvasRenderingContext2D, c: PlotColors) => {
    const size = 104, x0 = 10, y0 = 30, mid = y0 + size / 2;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.strokeStyle = c.border; ctx.lineWidth = 1; ctx.strokeRect(x0 + .5, y0 + .5, size, size);
    ctx.setLineDash([2, 3]); ctx.strokeStyle = c.text; ctx.globalAlpha = .5; ctx.beginPath(); ctx.moveTo(x0, y0 + size); ctx.lineTo(x0 + size, y0); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const curve = new Float32Array(81);
    for (let i = 0; i <= 80; ++i) curve[i] = driveTransfer(i / 40 - 1, mode);
    const gradient = (from: number, to: number) => { const g = ctx.createLinearGradient(from, 0, to, 0); g.addColorStop(0, c.trace); g.addColorStop(1, c.accent); return g; };
    trace(ctx, curve, x0, mid, size, size / 2); ctx.strokeStyle = gradient(x0, x0 + size); ctx.lineWidth = 2.6; ctx.stroke();
    ctx.fillStyle = c.text; ctx.font = `10px ${c.font}`; ctx.fillText("in → out", x0 + 4, y0 + size - 5);
    ctx.font = `11px ${c.font}`; ctx.fillText(mode ? `${driveInputGain[mode]}× into the soft clip` : "Off · clean", x0, 16);
    const sx = x0 + size + 16, width = 420 - sx - 10;
    ctx.strokeStyle = c.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx, mid); ctx.lineTo(sx + width, mid); ctx.stroke();
    if (!samples) { unavailable(ctx, c, sx + width / 2, mid - 8); return; }
    const clean = frameWave(samples, frame, 160);
    if (mode) { trace(ctx, clean, sx, mid, width, size / 2); ctx.strokeStyle = c.foreground; ctx.globalAlpha = .28; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1; }
    trace(ctx, clean.map((v) => driveTransfer(v, mode)), sx, mid, width, size / 2); ctx.strokeStyle = gradient(sx, sx + width); ctx.lineWidth = 2.2; ctx.stroke();
    ctx.fillStyle = c.text; ctx.font = `10px ${c.font}`; ctx.fillText(mode ? `Frame ${frame + 1} driven · clean behind` : `Frame ${frame + 1}`, sx, y0 - 6);
  }, [samples, frame, mode]);
  return <CanvasPlot className="classic-drive" width={420} height={150} paint={paint} role="img" aria-label={mode ? `Drive curve at ${driveInputGain[mode]}× input gain` : "Drive off"}/>;
}

export type EnvelopeValues = readonly [attack: number, hold: number, decay: number, sustain: number, release: number];
/** Straight-line stages as the board runs them; time spacing is compressed so short stages stay visible. */
function envelopePoints([attack, hold, decay, sustain, release]: EnvelopeValues, x: number, y: number, width: number, height: number) {
  const weight = (index: number) => { const ms = envelopeTimeMs(index); return ms === 0 ? 0 : 12 + Math.log1p(ms) * 8; };
  const w = [weight(attack), weight(hold), weight(decay), weight(release)], held = 46, scale = width / (w[0] + w[1] + w[2] + held + w[3]), level = sustain / 127;
  const t = [0, w[0], w[0] + w[1], w[0] + w[1] + w[2], w[0] + w[1] + w[2] + held, w[0] + w[1] + w[2] + held + w[3]];
  return [[t[0], 0], [t[1], 1], [t[2], 1], [t[3], level], [t[4], level], [t[5], 0]].map(([time, value]) => [x + time * scale, y + height - value * height] as const);
}
const envelopeText = ([attack, hold, decay, sustain, release]: EnvelopeValues) =>
  `attack ${envelopeTimeLabel(attack)}, hold ${envelopeTimeLabel(hold)}, decay ${envelopeTimeLabel(decay)}, sustain ${Math.round(sustain / 127 * 100)}%, release ${envelopeTimeLabel(release)}`;

/** Volume envelope with draggable attack, hold, decay/sustain and release handles. */
export function EnvelopeEditor({ values, onChange }: { values: EnvelopeValues; onChange: (stage: number, value: number) => void }) {
  const points = envelopePoints(values, 14, 22, 372, 96);
  const drag = useRef<{ stage: number; x: number; y: number; position: number; sustain: number } | undefined>(undefined);
  const path = `M${points.map((p) => p.map((v) => Math.round(v * 10) / 10).join(",")).join("L")}`;
  const setTime = (stage: number, position: number) => onChange(stage, envelopeTimeIndex(Math.max(0, Math.min(envelopePositionCount - 1, position))));
  const viewPoint = (svg: SVGSVGElement, clientX: number, clientY: number) => { const r = svg.getBoundingClientRect(); return [(clientX - r.left) / r.width * 400, (clientY - r.top) / r.height * 140]; };
  const handles = [[0, 1, "Attack"], [1, 2, "Hold"], [2, 3, "Decay and sustain"], [4, 5, "Release"]] as const;
  // A short hold puts its handle on top of Attack's; nudge it right so both stay grabbable.
  const handleX = (stage: number, index: number) => stage === 1 ? Math.max(points[2][0], points[1][0] + 16) : points[index][0];
  return <svg className="classic-envelope" viewBox="0 0 400 140" aria-label={`Volume envelope: ${envelopeText(values)}. Drag the handles.`}
    onPointerMove={(e) => {
      const d = drag.current; if (!d) return;
      const [x, y] = viewPoint(e.currentTarget, e.clientX, e.clientY);
      setTime(d.stage, d.position + Math.round((x - d.x) / 12));
      if (d.stage === 2) onChange(3, Math.max(0, Math.min(127, Math.round(d.sustain - (y - d.y) * 127 / 96))));
    }}
    onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
    <path className="classic-env-grid" d="M14 118H386"/>
    <path className="classic-env-fill" d={`${path}L${points[5][0]},118Z`}/>
    <path className="classic-env-line" d={path}/>
    <line className="classic-env-keyup" x1={points[4][0]} x2={points[4][0]} y1={22} y2={118}/>
    <text className="classic-env-axis" x={14} y={134}>key down</text>
    <text className="classic-env-axis" x={points[4][0] + 4} y={134}>key up</text>
    {handles.map(([stage, index, label]) => <circle key={stage} className="classic-env-handle" cx={handleX(stage, index)} cy={points[index][1]} r={6} role="slider" tabIndex={0}
      aria-label={label} aria-valuemin={0} aria-valuemax={envelopePositionCount - 1} aria-valuenow={envelopeTimePosition(values[stage])}
      aria-valuetext={stage === 2 ? `${envelopeTimeLabel(values[2])}, sustain ${Math.round(values[3] / 127 * 100)}%` : envelopeTimeLabel(values[stage])}
      onPointerDown={(e) => { const svg = e.currentTarget.ownerSVGElement as SVGSVGElement, [x, y] = viewPoint(svg, e.clientX, e.clientY); drag.current = { stage, x, y, position: envelopeTimePosition(values[stage]), sustain: values[3] }; svg.setPointerCapture(e.pointerId); }}
      onKeyDown={(e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key], level = { ArrowUp: 4, ArrowDown: -4 }[e.key];
        if (step !== undefined) { e.preventDefault(); setTime(stage, envelopeTimePosition(values[stage]) + step); }
        else if (level !== undefined) { e.preventDefault(); if (stage === 2) onChange(3, Math.max(0, Math.min(127, values[3] + level))); else setTime(stage, envelopeTimePosition(values[stage]) + Math.sign(level)); }
      }}/>)}
  </svg>;
}

/** A small envelope shape; negative amounts pull the target the other way. */
export function EnvelopeShape({ values, inverted }: { values: EnvelopeValues; inverted: boolean }) {
  const points = envelopePoints(values, 6, 6, 248, 44).map(([x, y]) => [x, inverted ? 56 - y : y]);
  return <svg className="classic-source-picture" viewBox="0 0 260 56" role="img" aria-label={`Envelope: ${envelopeText(values)}`}>
    <path d={`M${points.map((p) => p.map((v) => Math.round(v * 10) / 10).join(",")).join("L")}`}/>
  </svg>;
}

/** The board's LFO shapes (readSynthLfoSample), two cycles at any speed. */
export function LfoShape({ wave, speed, inverted }: { wave: number; speed: string; inverted: boolean }) {
  const path = useMemo(() => {
    let seed = 11;
    const steps = Array.from({ length: 12 }, () => (seed = seed * 16807 % 2147483647) / 2147483647 * 2 - 1);
    const value = (t: number) => {
      const phase = t % 1;
      switch (wave) {
        case 1: return phase < .25 ? phase * 4 : phase < .75 ? 2 - phase * 4 : phase * 4 - 4;
        case 2: return phase * 2 - 1;
        case 3: return phase < .5 ? 1 : -1;
        case 4: return steps[Math.floor(t * 4) % 12];
        case 5: { const a = Math.floor(t * 4), f = t * 4 - a, e = f * f * (3 - 2 * f); return steps[a % 12] * (1 - e) + steps[(a + 1) % 12] * e; }
        default: return Math.sin(2 * Math.PI * t);
      }
    };
    let d = "";
    for (let i = 0; i <= 240; ++i) d += `${i ? "L" : "M"}${(6 + i * 248 / 240).toFixed(1)},${(26 - (inverted ? -1 : 1) * value(i / 120) * 20).toFixed(1)}`;
    return d;
  }, [wave, inverted]);
  return <svg className="classic-source-picture" viewBox="0 0 260 56" role="img" aria-label={`LFO shape at ${speed}`}>
    <path className="classic-source-axis" d="M6 26H254"/><path d={path}/>
    <text x={254} y={53} textAnchor="end">{speed} · two cycles</text>
  </svg>;
}

/** Where the mod wheel (or the test keyboard's Mod knob) sits now. */
export function WheelPosition({ position, reach }: { position: number; reach: string }) {
  const x = 10 + position / 127 * 240;
  return <svg className="classic-source-picture" viewBox="0 0 260 56" role="img" aria-label={`Mod wheel at ${Math.round(position / 127 * 100)}%. ${reach}`}>
    <path className="classic-source-axis" d="M10 24H250" strokeWidth={6}/>
    <path d={`M10 24H${x.toFixed(1)}`} strokeWidth={6}/>
    <circle cx={x} cy={24} r={6}/>
    <text x={10} y={53}>wheel {Math.round(position / 127 * 100)}%</text>
    <text x={250} y={53} textAnchor="end">{reach}</text>
  </svg>;
}
