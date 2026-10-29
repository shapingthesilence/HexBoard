import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Recording } from "./prepare.mjs";
import { crossfadeFrames } from "./encode.mjs";
import { recordingBounds, moveBoundary, snapLoop, matchLoop, loopPitchChange, loopSeam, waveformDetail, type Boundary } from "./loopEditing.ts";

function FrameField({ label, value, onFocus, onCommit }: { label: string; value: number; onFocus?: () => void; onCommit: (value: number) => number }) {
  const [draft, setDraft] = useState(String(value)), editing = useRef(false), skipBlur = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(String(value)); }, [value]);
  const commit = () => {
    editing.current = false;
    const number = Number(draft);
    const actual = draft.trim() && Number.isFinite(number) ? onCommit(Math.round(number)) : value;
    setDraft(String(actual));
  };
  return <label>{label}<input aria-label={label} type="text" inputMode="numeric" value={draft}
    onFocus={() => { editing.current = true; onFocus?.(); }} onChange={event => setDraft(event.target.value)}
    onBlur={() => { if (skipBlur.current) skipBlur.current = false; else commit(); }}
    onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); skipBlur.current = true; commit(); event.currentTarget.blur(); }
      if (event.key === "Escape") { skipBlur.current = true; editing.current = false; setDraft(String(value)); event.currentTarget.blur(); }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault(); const base = draft.trim() && Number.isFinite(Number(draft)) ? Math.round(Number(draft)) : value;
        const next = base + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 16 : 1);
        setDraft(String(onCommit(next)));
      }
    }}/></label>;
}

export function SamplerWaveform({ recording: a, onChange }: { recording: Recording; onChange: (change: Partial<Recording>, remember: boolean) => void }) {
  const length = a.channels[0].length, b = recordingBounds(a), looping = a.mode === 1 || a.mode === 3;
  const [view, setView] = useState<[number, number]>([0, length]);
  const [locked, setLocked] = useState(true), [snap, setSnap] = useState(false), [active, setActive] = useState<Boundary>("loopStart");
  const [gainChoice, setGainChoice] = useState("auto"), [message, setMessage] = useState("");
  const original = useRef({ data: a.channels[0], frames: looping ? b.loopEnd - b.loopStart : 0 });
  const current = useRef(a); current.current = a;
  const drag = useRef(false), pointerOffset = useRef(0), clip = useId().replaceAll(":", "");
  useEffect(() => {
    if (original.current.data !== a.channels[0] || (looping && original.current.frames < 1)) {
      original.current = { data: a.channels[0], frames: looping ? b.loopEnd - b.loopStart : 0 };
      setView([0, length]); setMessage("");
    }
  }, [a.channels[0], length, looping]);
  const start = Math.max(0, Math.min(view[0], length - 1)), end = Math.min(length, Math.max(start + 1, view[1])), span = end - start;
  const height = a.channels.length * 110;
  const display = useMemo(() => {
    let peak = 0;
    for (const channel of a.channels) for (let i = start; i < end; ++i) peak = Math.max(peak, Math.abs(channel[i]));
    const gain = gainChoice === "auto" ? Math.min(128, .95 / (peak || 1)) : +gainChoice;
    return { paths: a.channels.map(channel => waveformDetail(channel, start, end, 560, 110, gain)), gain };
  }, [a.channels, start, end, gainChoice]);
  const overview = useMemo(() => waveformDetail(a.channels[0], 0, length, 560, 30, 1), [a.channels[0], length]);
  const show = (from: number, to: number) => {
    const size = Math.min(length, Math.max(Math.min(4, length), Math.round(to - from)));
    const first = Math.max(0, Math.min(length - size, Math.round(from))); setView([first, first + size]);
  };
  const focus = (frame: number, size: number) => show(frame - size / 2, frame + size / 2);
  const change = (boundary: Boundary, frame: number, remember: boolean, useSnap = snap) => {
    const source = current.current;
    const update = moveBoundary(source, boundary, frame, looping && locked, looping && useSnap, Math.max(2, Math.min(128, Math.ceil(span / 70))));
    const previous = recordingBounds(source);
    if (Object.entries(update).some(([key, value]) => previous[key as Boundary] !== value)) { setMessage(""); onChange(update, remember); }
    return update[boundary]!;
  };
  const tool = (update: Partial<Recording>) => {
    const changed = Object.entries(update).some(([key, value]) => b[key as Boundary] !== value);
    if (changed) { onChange(update, true); setMessage(locked ? "Loop moved; length and repetition pitch preserved." : "Loop boundaries changed. Check the pitch readout and audition."); }
    else setMessage(seam.jump < .0001 && seam.slope < .0001 ? "Loop seam already matches at this length." : "No better matching boundaries nearby at this length. Try a crossfade, or unlock length to resize.");
  };
  const seam = loopSeam(a), cents = loopPitchChange(a, original.current.frames || b.loopEnd - b.loopStart), fade = crossfadeFrames(a);
  const markerNames: Record<Boundary, string> = { start: "Trim start", end: "Trim end", loopStart: "Loop start", loopEnd: "Loop end" };
  const markers: Boundary[] = looping ? ["start", "end", "loopStart", "loopEnd"] : ["start", "end"];
  return <div className="sampler-wave-editor">
    <div className="sampler-fields sampler-wave-tools">
      <button onClick={() => show(0, length)}>Full sample</button>
      <button disabled={!looping} onClick={() => { const size = Math.max(16, (b.loopEnd - b.loopStart) * 1.3); focus((b.loopStart + b.loopEnd) / 2, size); }}>Zoom to loop</button>
      <button disabled={!looping} onClick={() => { setActive("loopStart"); focus(b.loopStart, 64); }}>View loop start</button>
      <button disabled={!looping} onClick={() => { setActive("loopEnd"); focus(b.loopEnd, 64); }}>View loop end</button>
      <button aria-label="Zoom in waveform" onClick={() => focus((start + end) / 2, span / 2)}>+</button>
      <button aria-label="Zoom out waveform" onClick={() => focus((start + end) / 2, span * 2)}>−</button>
      <button aria-label="Pan waveform earlier" disabled={start === 0} onClick={() => show(start - span / 2, end - span / 2)}>←</button>
      <button aria-label="Pan waveform later" disabled={end === length} onClick={() => show(start + span / 2, end + span / 2)}>→</button>
      <label>Display gain<select aria-label="Waveform display gain" value={gainChoice} onChange={event => setGainChoice(event.target.value)}>
        <option value="auto">Auto</option>{[1, 2, 4, 8, 16].map(n => <option key={n} value={n}>×{n}</option>)}
      </select></label>
    </div>
    <svg className="sampler-wave sampler-wave-detail" viewBox={`0 0 560 ${height}`} role="group" aria-label={`Waveform of ${a.name}`}>
      <defs><clipPath id={clip}><rect width="560" height={height}/></clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        {looping && <rect className="sampler-loop-area" x={(b.loopStart - start) * 560 / span} y="0" width={(b.loopEnd - b.loopStart) * 560 / span} height={height}/>}
        {a.channels.map((channel, i) => <g key={i} transform={`translate(0 ${i * 110})`}>
          <line className="sampler-zero-line" x1="0" x2="560" y1="55" y2="55"/>
          <path d={display.paths[i]}/><text x="6" y="14">{a.channels.length === 2 ? i ? "R" : "L" : "Mono"}</text>
          {span <= 96 && Array.from(channel.subarray(start, end), (value, n) => <circle key={n} className="sampler-sample-point" cx={n * 560 / span} cy={55 - value * 110 * .43 * display.gain} r="2"/>)}
        </g>)}
      </g>
      {markers.map(boundary => {
        const n = b[boundary]; if (n < start || n > end) return null;
        const x = (n - start) * 560 / span, isLoop = boundary.startsWith("loop");
        return <g key={boundary} role="slider" tabIndex={0} aria-label={`${markerNames[boundary]} handle`} aria-valuenow={n} aria-valuemin={b.start} aria-valuemax={b.end}
          className="sampler-wave-handle" onFocus={() => setActive(boundary)}
          onPointerDown={event => {
            event.currentTarget.setPointerCapture(event.pointerId); setActive(boundary); drag.current = false;
            const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
            pointerOffset.current = start + (event.clientX - rect.left) / rect.width * span - n;
          }}
          onPointerMove={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
            const before = recordingBounds(current.current)[boundary];
            if (change(boundary, start + (event.clientX - rect.left) / rect.width * span - pointerOffset.current, !drag.current) !== before) drag.current = true;
          }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = false; }}
          onPointerCancel={() => { drag.current = false; }} onLostPointerCapture={() => { drag.current = false; }}
          onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault(); const before = recordingBounds(current.current)[boundary];
            if (change(boundary, before + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 16 : 1), !drag.current, false) !== before) drag.current = true;
          }} onKeyUp={() => { drag.current = false; }} onBlur={() => { drag.current = false; }}>
          <line x1={x} x2={x} y1="0" y2={height} className={isLoop ? "loop" : "trim"}/>
          <rect x={Math.max(0, Math.min(550, x - 5))} y={isLoop ? height - 18 : 0} width="10" height="18" rx="2" className={isLoop ? "loop-grip" : "trim-grip"}/>
        </g>;
      })}
    </svg>
    <svg className="sampler-wave-overview" viewBox="0 0 560 30" role="slider" tabIndex={0} aria-label="Waveform overview position" aria-valuemin={0} aria-valuemax={length} aria-valuenow={Math.round((start + end) / 2)}
      onPointerDown={event => { const rect = event.currentTarget.getBoundingClientRect(); focus((event.clientX - rect.left) / rect.width * length, span); }}
      onKeyDown={event => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); show(start + (event.key === "ArrowLeft" ? -1 : 1) * span / 4, end + (event.key === "ArrowLeft" ? -1 : 1) * span / 4); } }}>
      <path d={overview}/><rect x={start / length * 560} y="0" width={Math.max(2, span / length * 560)} height="30"/>
    </svg>
    <p className="sampler-wave-readout">View {start.toLocaleString()}–{end.toLocaleString()} frames · {(span / a.rate * 1000).toFixed(3)} ms · end markers are exclusive</p>
    <div className="sampler-fields">
      {(["start", "end"] as Boundary[]).map(boundary => <FrameField key={boundary} label={markerNames[boundary]} value={b[boundary]} onFocus={() => setActive(boundary)} onCommit={n => change(boundary, n, true, false)}/>)}
    </div>
    <details className="sampler-loop-details"><summary>Loop details &amp; fine adjustments</summary>
    {looping ? <><div className="sampler-fields">
      {(["loopStart", "loopEnd"] as Boundary[]).map(boundary => <FrameField key={boundary} label={markerNames[boundary]} value={b[boundary]} onFocus={() => setActive(boundary)} onCommit={n => change(boundary, n, true, false)}/>)}
      <FrameField label="Crossfade frames" value={fade} onCommit={n => {
        const frames = crossfadeFrames({ ...a, crossfade: Math.max(0, n) * 1000 / a.rate });
        if (frames !== fade) onChange({ crossfade: frames * 1000 / a.rate }, true); return frames;
      }}/>
    </div>
      <div className="sampler-fields sampler-loop-tools">
        <label><input type="checkbox" checked={locked} onChange={event => setLocked(event.target.checked)}/>Lock loop length / pitch</label>
        <label><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)}/>Snap drag to zero</label>
        <button onClick={() => tool(snapLoop(a, locked))}>Snap to zero</button>
        <button onClick={() => tool(matchLoop(a, locked, active === "loopEnd" ? "loopEnd" : "loopStart"))}>Match seam</button>
        <button aria-label={locked ? "Nudge loop earlier one frame" : "Nudge active loop boundary earlier one frame"} onClick={() => change(active === "loopEnd" ? "loopEnd" : "loopStart", b[active === "loopEnd" ? "loopEnd" : "loopStart"] - 1, true, false)}>−1 frame</button>
        <button aria-label={locked ? "Nudge loop later one frame" : "Nudge active loop boundary later one frame"} onClick={() => change(active === "loopEnd" ? "loopEnd" : "loopStart", b[active === "loopEnd" ? "loopEnd" : "loopStart"] + 1, true, false)}>+1 frame</button>
      </div>
      <p className="sampler-wave-readout" role="status">Loop {b.loopEnd - b.loopStart} frames · {((b.loopEnd - b.loopStart) / a.rate * 1000).toFixed(4)} ms · repeat rate {(a.rate / (b.loopEnd - b.loopStart)).toFixed(3)} Hz · length change {cents >= 0 ? "+" : ""}{cents.toFixed(2)} cents<br/>Raw seam mismatch {(seam.jump * 100).toFixed(2)}% · slope mismatch {(seam.slope * 100).toFixed(2)}% · crossfade {fade} frames</p>
      {message && <p className="panel-note" role="status">{message}</p>}
      <p className="panel-note">Zero crossings also need matching direction and shape. Use Match seam or a short crossfade, then audition. A multi-cycle loop’s repeat rate is not the note’s fundamental.</p>
    </> : <p className="panel-note">Choose a looping playback mode or apply a suggested loop to edit its boundaries.</p>}</details>
  </div>;
}
