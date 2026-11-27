import {useRef, type CSSProperties, type KeyboardEvent, type PointerEvent} from "react";

export type FaderTick = {value: number; label: string};
type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Double-click returns here. */
  neutral: number;
  valueText: string;
  /** 0 at the bottom of the track, 1 at the top. */
  toPosition: (value: number) => number;
  fromPosition: (position: number) => number;
  ticks: readonly FaderTick[];
  /** Values from here to the top use the striped audition track. */
  zoneFrom?: number;
  color: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  onRelease?: () => void;
  onFocus?: () => void;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const percent = (position: number) => `${(clamp(position, 0, 1) * 100).toFixed(2)}%`;

export function MixFader({label, value, min, max, neutral, valueText, toPosition, fromPosition, ticks, zoneFrom,
  color, disabled, onChange, onRelease, onFocus}: Props) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const set = (next: number) => { next = clamp(Math.round(next), min, max); if (next !== value) onChange(next); };
  const pick = (clientY: number) => {
    const box = track.current?.getBoundingClientRect();
    if (box?.height) set(fromPosition(clamp(1 - (clientY - box.top) / box.height, 0, 1)));
  };
  const release = () => { if (dragging.current) { dragging.current = false; onRelease?.(); } };
  const keys: Record<string, (v: number) => number> = {
    ArrowUp: v => v + 1, ArrowRight: v => v + 1, ArrowDown: v => v - 1, ArrowLeft: v => v - 1,
    PageUp: v => v + 6, PageDown: v => v - 6, Home: () => min, End: () => max,
  };
  const position = toPosition(value);
  return <div className="mix-fader" role="slider" tabIndex={disabled ? -1 : 0} aria-label={label}
    aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={valueText}
    aria-disabled={disabled || undefined} style={{"--fader": color} as CSSProperties}
    onFocus={onFocus}
    onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
      if (disabled || e.button) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.focus();
      dragging.current = true;
      pick(e.clientY);
    }}
    onPointerMove={(e: PointerEvent<HTMLDivElement>) => { if (dragging.current) pick(e.clientY); }}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    onDoubleClick={() => { if (!disabled) { set(neutral); onRelease?.(); } }}
    onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
      const step = keys[e.key];
      if (!step || disabled) return;
      e.preventDefault();
      set(step(value));
    }}
    onKeyUp={(e: KeyboardEvent<HTMLDivElement>) => { if (keys[e.key] && !disabled) onRelease?.(); }}>
    <div className="mix-fader-scale" aria-hidden="true">
      {ticks.map(tick => <span key={tick.value} style={{bottom: percent(toPosition(tick.value))}}>{tick.label}</span>)}
    </div>
    <div className="mix-fader-track" ref={track} aria-hidden="true">
      {zoneFrom !== undefined && <div className="mix-fader-zone" style={{bottom: percent(toPosition(zoneFrom))}}/>}
      {ticks.map(tick => <i key={tick.value} className={tick.value === neutral ? "is-unity" : undefined}
        style={{bottom: percent(toPosition(tick.value))}}/>)}
      <div className="mix-fader-fill" style={{height: percent(position)}}/>
      <div className="mix-fader-cap" style={{bottom: percent(position)}}/>
    </div>
  </div>;
}
