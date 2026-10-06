import { useId, useRef, useState } from "react";
import { curveVelocity, movePoint, movePressurePoint, type CurvePoint, type Strike } from "./model.ts";

export const chartColors = ["var(--brand)", "#bc7e19", "#bc527d", "#5d82ce", "#9370ca", "#789854", "#c37e4c"];
export interface Series { label: string; points: Array<{ x: number; y: number }>; color?: string }
export function Plot({ series, xLabel, yLabel, range, yRange, lines = [], onRange }: {
  series: Series[]; xLabel: string; yLabel: string; range?: number[] | null; yRange?: [number, number];
  lines?: Array<{ value: number; label: string }>;
  onRange?: (range: number[]) => void;
}) {
  const id = useId(), drag = useRef<number | null>(null);
  const [selection, setSelection] = useState<number[] | null>(null);
  const points = series.flatMap(s => s.points);
  if (!points.length) return <div className="calEmpty">No measurements yet.</div>;
  const allX = points.map(p => p.x), allY = [...points.map(p => p.y), ...lines.map(l => l.value)];
  const lo = range?.[0] ?? Math.min(...allX), hi = Math.max(lo + .001, range?.[1] ?? Math.max(...allX));
  const min = Math.min(...allY), max = Math.max(...allY), pad = Math.max((max - min) * .1, .05);
  const yMin = yRange?.[0] ?? min - pad, yMax = yRange?.[1] ?? max + pad;
  const x = (v: number) => 60 + (v - lo) / (hi - lo) * 620;
  const y = (v: number) => 220 - (v - yMin) / (yMax - yMin) * 190;
  const position = (event: React.PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    return Math.max(lo, Math.min(hi, lo + ((event.clientX - box.left) / box.width * 700 - 60) / 620 * (hi - lo)));
  };
  return <svg className="calPlot" viewBox="0 0 700 265" role="img" aria-label={`${yLabel} against ${xLabel}`}>
    <defs><clipPath id={id}><rect x="60" y="22" width="620" height="200" /></clipPath></defs>
    {[0, 1, 2, 3, 4].map(i => <g key={i}>
      <line x1="60" x2="680" y1={y(yMin + (yMax - yMin) * i / 4)} y2={y(yMin + (yMax - yMin) * i / 4)} className="calGrid" />
      <text x="51" y={y(yMin + (yMax - yMin) * i / 4) + 4} textAnchor="end">{(yMin + (yMax - yMin) * i / 4).toFixed(max < 10 ? 2 : 0)}</text>
      <text x={60 + i * 155} y="243" textAnchor="middle">{(lo + (hi - lo) * i / 4).toFixed(hi - lo < 10 ? 2 : 1)}</text>
    </g>)}
    <text x="60" y="14">{yLabel}</text><text x="680" y="263" textAnchor="end">{xLabel}</text>
    <g clipPath={`url(#${id})`}>
      {lines.map(l => <g key={l.label}><line x1="60" x2="680" y1={y(l.value)} y2={y(l.value)} stroke="var(--text-soft)" strokeDasharray="4 4" /><text x="674" y={y(l.value) - 4} textAnchor="end">{l.label}</text></g>)}
      {series.map((s, i) => <path key={s.label} d={s.points.map((p, j) => `${j ? "L" : "M"}${x(p.x)},${y(p.y)}`).join(" ")} fill="none" stroke={s.color ?? chartColors[i % chartColors.length]} strokeWidth="2" />)}
      {selection && <rect x={x(Math.min(...selection))} width={Math.abs(x(selection[1]) - x(selection[0]))} y="22" height="200" fill="var(--brand)" opacity=".2" />}
    </g>
    {onRange && <rect x="60" y="22" width="620" height="200" fill="transparent" style={{ touchAction: "none" }}
      onPointerDown={e => { if (e.button !== 0) return; drag.current = position(e); e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (drag.current !== null) setSelection([drag.current, position(e)]); }}
      onPointerUp={e => { if (drag.current !== null) { const end = position(e); if (Math.abs(end - drag.current) > .2) onRange([Math.min(end, drag.current), Math.max(end, drag.current)]); } drag.current = null; setSelection(null); }}
      onPointerCancel={() => { drag.current = null; setSelection(null); }} />}
  </svg>;
}
export function CurveChart({ points, onChange, windowMs, last, disabled }: {
  points: CurvePoint[]; onChange: (points: CurvePoint[]) => void; windowMs: number; last: Strike | null; disabled?: boolean;
}) {
  const drag = useRef<number | null>(null);
  const x = (us: number) => 50 + Math.min(us, windowMs * 1000) / (windowMs * 1000) * 580;
  const y = (value: number) => 210 - value / 127 * 185;
  return <svg className="calPlot calCurve" viewBox="0 0 660 250" role="group" aria-label="Velocity response curve" style={{ touchAction: "none" }}
    onPointerMove={e => { if (drag.current === null || disabled) return; const box = e.currentTarget.getBoundingClientRect();
      onChange(movePoint(points, drag.current, ((e.clientX - box.left) / box.width * 660 - 50) / 580 * windowMs * 1000,
        (210 - (e.clientY - box.top) / box.height * 250) / 185 * 127)); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
    {[0, 1, 2, 3, 4].map(i => <g key={i}><line className="calGrid" x1="50" x2="630" y1={y(i * 127 / 4)} y2={y(i * 127 / 4)} />
      <text x="42" y={y(i * 127 / 4) + 4} textAnchor="end">{Math.round(i * 127 / 4)}</text><text x={50 + i * 145} y="232" textAnchor="middle">{i * windowMs / 4}</text></g>)}
    <text x="50" y="14">Velocity</text><text x="630" y="249" textAnchor="end">Crossing time (ms)</text>
    <path d={points.map((p, i) => `${i ? "L" : "M"}${x(p.us)},${y(p.velocity)}`).join(" ")} fill="none" stroke="var(--brand)" strokeWidth="2" />
    {last?.us && <g><line x1={x(last.us)} x2={x(last.us)} y1="25" y2="210" stroke={chartColors[1]} strokeDasharray="4 4" />
      <circle cx={x(last.us)} cy={y(last.velocity)} r="5" fill={chartColors[1]} /><circle cx={x(last.us)} cy={y(curveVelocity(points, last.us))} r="8" fill="none" stroke={chartColors[1]} strokeWidth="2" /></g>}
    {points.map((p, i) => <circle key={i} cx={x(p.us)} cy={y(p.velocity)} r="7" fill="var(--surface)" stroke="var(--brand)" strokeWidth="2"
      tabIndex={disabled ? -1 : 0} role="button" aria-label={`Point ${i + 1}: velocity ${p.velocity} at ${(p.us / 1000).toFixed(2)} milliseconds`}
      onPointerDown={e => { if (disabled || e.button !== 0) return; e.preventDefault(); drag.current = i; e.currentTarget.ownerSVGElement!.setPointerCapture(e.pointerId); }}
      onKeyDown={e => { if (disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return; e.preventDefault();
        onChange(movePoint(points, i, p.us + (e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0) * (e.shiftKey ? 10000 : 1000),
          p.velocity + (e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0))); }} />)}
  </svg>;
}

export function PressureCurveChart({ points, onChange, disabled }: {
  points: number[]; onChange: (points: number[]) => void; disabled?: boolean;
}) {
  const drag = useRef<number | null>(null);
  const y = (value: number) => 210 - value / 65535 * 185;
  return <svg className="calPlot calCurve" viewBox="0 0 660 250" role="group" aria-label="Pressure response curve" style={{ touchAction: "none" }}
    onPointerMove={e => {
      if (drag.current === null || disabled) return;
      const box = e.currentTarget.getBoundingClientRect();
      onChange(movePressurePoint(points, drag.current, (210 - (e.clientY - box.top) / box.height * 250) / 185 * 65535));
    }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
    {[0, 1, 2, 3, 4].map(i => <g key={i}><line className="calGrid" x1="50" x2="630" y1={y(i * 65535 / 4)} y2={y(i * 65535 / 4)} />
      <text x="42" y={y(i * 65535 / 4) + 4} textAnchor="end">{i * 25}</text><text x={50 + i * 145} y="232" textAnchor="middle">{i * 25}</text></g>)}
    <text x="50" y="14">Pressure output (%)</text><text x="630" y="249" textAnchor="end">Position in pressure range (%)</text>
    <path d={[0, ...points, 65535].map((value, i) => `${i ? "L" : "M"}${50 + i * 145},${y(value)}`).join(" ")} fill="none" stroke="var(--brand)" strokeWidth="2" />
    {points.map((value, i) => <circle key={i} cx={50 + (i + 1) * 145} cy={y(value)} r="7" fill="var(--surface)" stroke="var(--brand)" strokeWidth="2"
      tabIndex={disabled ? -1 : 0} role="slider" aria-label={`Pressure output at ${(i + 1) * 25}% travel`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value / 65535 * 100)}
      onPointerDown={e => { if (disabled || e.button !== 0) return; e.preventDefault(); drag.current = i; e.currentTarget.ownerSVGElement!.setPointerCapture(e.pointerId); }}
      onKeyDown={e => {
        if (disabled || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
        e.preventDefault(); onChange(movePressurePoint(points, i, value + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 3277 : 655)));
      }} />)}
  </svg>;
}
