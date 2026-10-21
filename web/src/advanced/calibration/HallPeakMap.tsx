import { useState, useEffect, useRef } from "react";
import { advancedNoteSurface } from "../../midi/boardContext.ts";

// Fixed scale: colors do not change when another key sets a larger peak.
export const peakScale = 1600;
function spectrum(fraction: number) { return `hsl(${240 * (1 - Math.max(0, Math.min(fraction, 1)))} 80% 38%)`; }
export function peakColor(value: number) { return value <= 8 ? "var(--surface-muted)" : spectrum(value / peakScale); }
function parseReadings(lines: string[], tag: string): number[] {
  const values = lines.find(line => line.startsWith(`cal,${tag},`))?.split(",").slice(2);
  if (!values || values.length !== 133 || values.some(v => !/^\d+$/.test(v) || Number(v) > 4095)) return [];
  return values.map(Number);
}
export function parseHallPeaks(lines: string[]) { return parseReadings(lines, "peaks"); }
export function parseHallRests(lines: string[]) { return parseReadings(lines, "rests"); }
export function parseHallLimits(lines: string[]) { return parseReadings(lines, "limits"); }
export function draggedPeak(value: number, upPixels: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value + upPixels * 4)));
}
export function parseHallRaw(lines: string[]) { return parseReadings(lines, "raw"); }
export function restBounds(rests: number[], includeZero = false) {
  const captured = rests.filter(v => includeZero || v > 0);
  return captured.length ? [Math.min(...captured), Math.max(...captured)] : [0, 0];
}
export function HallPeakMap({ peaks, rests, raw = [], liveSupported = false, phase, onView, disabled, limits = [], minimum = 1, onPeakEdit }: { limits?: number[]; minimum?: number; onPeakEdit?: (key: number, delta: number) => Promise<void>; onView?: (view: string) => void; disabled?: boolean; peaks: number[]; rests: number[]; raw?: number[]; liveSupported?: boolean; phase?: string }) {
  const [view, setView] = useState("peaks");
  const [draft, setDraft] = useState<{ key: number; value: number } | null>(null);
  const drag = useRef<{ key: number; y: number; value: number; next: number; pointer: number } | null>(null);
  const editable = !disabled && phase !== "rest" && phase !== "running" && Boolean(onPeakEdit);
  async function commit(key: number, value: number) {
    setDraft({ key, value });
    try { await onPeakEdit?.(key, value); } finally { setDraft(null); }
  }

  useEffect(() => { if (phase === "rest") setView("peaks"); }, [phase]);
  const live = view === "live", rest = live || view === "rest", values = live ? raw : rest ? rests : peaks;
  const [low, high] = restBounds(values, live);
  const label = live ? "Live raw ADC for each key" : rest ? "Resting ADC for each key" : "Peak ADC movement for each key";
  return <section className="hallPeakSection" aria-label="Hall calibration map">
    <h4>{live ? "Live variation map" : rest ? "Rest variation map" : "Captured raw ADC peaks"}</h4>
    <div className="sectionTabs" aria-label="Hall map view"><button type="button" aria-pressed={view === "peaks"} disabled={disabled} onClick={() => { setView("peaks"); onView?.("peaks"); }}>Press peaks</button><button type="button" aria-pressed={view === "rest"} disabled={disabled} onClick={() => { setView("rest"); onView?.("rest"); }}>Rest variation</button>{liveSupported && <button type="button" aria-pressed={live} disabled={disabled} onClick={() => { setView("live"); onView?.("live"); }}>Live variation</button>}<button type="button" disabled={disabled} onClick={() => onView?.("off")}>LEDs off</button></div>
    <p className="calHint">{live ? `Live raw ADC readings refresh about five times per second. Release every key to compare rest variation; pressing a key changes its reading immediately. Colors rescale across the current board minimum and maximum (${high-low} ADC counts difference). Sensor offsets and neighboring magnets also affect these values; this is not a physical height measurement.` : rest ? `Colors span the lowest to highest captured rest reading across the board (${high-low} ADC counts difference). Rest capture averages untouched readings; afterward this map stays fixed while you press keys. Saved calibration uses its guarded rest baseline. Sensor offsets and neighboring magnets also affect these values; this is not a physical height measurement.` : `${phase === "rest" ? "Keep every key released while rest is captured." : phase === "running" ? "Press each key firmly, then release. Its highest reading stays visible; press it again to increase the captured endpoint." : "These are retained raw endpoints. Start a new sweep to capture fresh peaks."} Gray means little or no captured movement. Colors show ADC movement above rest, corrected for sensor polarity; they do not certify a full press.`}</p>
    <div className="hallPeakLegend"><span>{rest ? low : 0}</span><span className="hallPeakRamp" aria-hidden="true" /><span>{rest ? high : "1600+"} ADC counts</span></div>
    {view === "peaks" && onPeakEdit && <p className="calHint">After finishing calibration, drag a key up to increase its press peak or down to decrease it (4 ADC counts per pixel). Arrow keys adjust by 1; Shift adjusts by 10. Release to apply in RAM, then use Save Hall calibration to keep edits after restart. Only calibrated keys can be edited.</p>}
    <svg className="hallPeakMap" viewBox="0 0 500 602" role="group" aria-label={label}>
      {advancedNoteSurface.map(k => {
        const value = view === "peaks" && draft?.key === k.hallKey ? draft.value : values[k.hallKey];
        const missing = value === undefined || (rest && !live && value === 0);
        const canEdit = view === "peaks" && editable && !missing && limits[k.hallKey] >= minimum;
        const background = missing ? "var(--surface-muted)" : rest ? spectrum(high === low ? .5 : (value-low)/(high-low)) : peakColor(value);
        const description = `Key ${k.hallKey}: ${missing ? "waiting" : value} ${live ? "live raw ADC" : rest ? "rest ADC" : "ADC counts above rest"}`;
        return <g key={k.hallKey} transform={`translate(${25 + k.coordCol * 25} ${28 + k.row * 42})`}
          role={canEdit ? "slider" : "img"} aria-label={description} tabIndex={canEdit ? 0 : undefined}
          aria-valuemin={canEdit ? minimum : undefined} aria-valuemax={canEdit ? limits[k.hallKey] : undefined}
          aria-valuenow={canEdit ? value : undefined} aria-orientation={canEdit ? "vertical" : undefined}
          data-editable={canEdit} data-dragging={draft?.key === k.hallKey}
          onPointerDown={event => {
            if (!canEdit || event.button !== 0) return;
            event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { key: k.hallKey, y: event.clientY, value, next: value, pointer: event.pointerId };
          }}
          onPointerMove={event => {
            const current = drag.current;
            if (!current || current.key !== k.hallKey || current.pointer !== event.pointerId) return;
            current.next = draggedPeak(current.value, current.y-event.clientY, minimum, limits[k.hallKey]);
            setDraft({ key: k.hallKey, value: current.next });
          }}
          onPointerUp={event => {
            const current = drag.current;
            if (!current || current.key !== k.hallKey || current.pointer !== event.pointerId) return;
            drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId);
            if (current.next !== current.value) void commit(k.hallKey, current.next); else setDraft(null);
          }}
          onPointerCancel={() => { drag.current = null; setDraft(null); }}
          onLostPointerCapture={() => { if (drag.current?.key === k.hallKey) { drag.current = null; setDraft(null); } }}
          onKeyDown={event => {
            if (event.key === "Escape") { drag.current = null; setDraft(null); return; }
            if (!canEdit || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const next = Math.max(minimum, Math.min(limits[k.hallKey], value + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1)));
            if (next !== value) void commit(k.hallKey, next);
          }}>
          <title>{description}</title>
          <polygon points="0,-26 23,-13 23,13 0,26 -23,13 -23,-13" fill={background} />
          <text y="-5" fill={!missing && (rest || value > 8) ? "white" : "var(--text)"}> {k.hallKey}</text>
          <text y="10" className="hallPeakValue" fill={!missing && (rest || value > 8) ? "white" : "var(--text)"}>{missing ? "—" : value}</text>
        </g>;
      })}
    </svg>
  </section>;
}
