import { useState, useEffect } from "react";
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
export function restBounds(rests: number[]) {
  const captured = rests.filter(v => v > 0);
  return captured.length ? [Math.min(...captured), Math.max(...captured)] : [0, 0];
}
export function HallPeakMap({ peaks, rests, phase, onView, disabled }: { onView?: (view: string) => void; disabled?: boolean; peaks: number[]; rests: number[]; phase?: string }) {
  const [view, setView] = useState("peaks");
  useEffect(() => { if (phase === "rest") setView("peaks"); }, [phase]);
  const rest = view === "rest", values = rest ? rests : peaks;
  const [low, high] = restBounds(rests);
  const label = rest ? "Resting ADC for each key" : "Peak ADC movement for each key";
  return <section className="hallPeakSection" aria-label="Hall calibration map">
    <h4>{rest ? "Rest variation map" : "Captured raw ADC peaks"}</h4>
    <div className="sectionTabs" aria-label="Hall map view"><button type="button" aria-pressed={!rest} disabled={disabled} onClick={() => { setView("peaks"); onView?.("peaks"); }}>Press peaks</button><button type="button" aria-pressed={rest} disabled={disabled} onClick={() => { setView("rest"); onView?.("rest"); }}>Rest variation</button><button type="button" disabled={disabled} onClick={() => onView?.("off")}>LEDs off</button></div>
    <p className="calHint">{rest ? `Colors span the lowest to highest captured rest reading across the board (${high-low} ADC counts difference). Rest capture averages untouched readings; afterward this map stays fixed while you press keys. Saved calibration uses its guarded rest baseline. Sensor offsets and neighboring magnets also affect these values; this is not a physical height measurement.` : `${phase === "rest" ? "Keep every key released while rest is captured." : phase === "running" ? "Press each key firmly, then release. Its highest reading stays visible; press it again to increase the captured endpoint." : "These are retained raw endpoints. Start a new sweep to capture fresh peaks."} Gray means little or no captured movement. Colors show ADC movement above rest, corrected for sensor polarity; they do not certify a full press.`}</p>
    <div className="hallPeakLegend"><span>{rest ? low : 0}</span><span className="hallPeakRamp" aria-hidden="true" /><span>{rest ? high : "1600+"} ADC counts</span></div>
    <div className="hallPeakMap" role="list" aria-label={label}>{advancedNoteSurface.map(k => {
      const value = values[k.hallKey], missing = value === undefined || (rest && value === 0);
      const background = missing ? "var(--surface-muted)" : rest ? spectrum(high === low ? .5 : (value-low)/(high-low)) : peakColor(value);
      const description = `Key ${k.hallKey}: ${missing ? "waiting" : value} ${rest ? "rest ADC" : "ADC counts above rest"}`;
      return <div role="listitem" key={k.hallKey} title={description} aria-label={description}
        style={{ gridRow: k.row + 1, gridColumn: k.coordCol + 1, background, color: !missing && (rest || value > 8) ? "white" : "var(--text)" }}>
        <span>{k.hallKey}</span><strong>{missing ? "—" : value}</strong>
      </div>;
    })}</div>
  </section>;
}
