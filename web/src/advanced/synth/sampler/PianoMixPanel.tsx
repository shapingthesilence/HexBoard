import {useRef, type ReactNode} from "react";
import {Knob} from "../SynthControls.tsx";
import {pianoMixDefaults, pianoMixKeys, pianoMixMax, pianoMixText, type PianoMix, type PianoMixKey} from "./pianoMix.mjs";

const labels: Record<PianoMixKey, string> = {
  pianoKeyNoise: "Key return",
  pianoPedalNoise: "Pedal noise",
  pianoStringRelease: "String release",
  pianoResonance: "Resonance",
};
type Room = {amount: number; onChange: (amount: number) => void; onToggle: () => void};
type Props = {
  mix?: Readonly<PianoMix>;
  onChange?: (key: PianoMixKey, value: number) => void;
  onRelease?: () => void;
  room?: Room;
  disabled?: boolean;
};

export function PianoMixPanel({mix, onChange, onRelease, room, disabled}: Props) {
  const previousResonance = useRef(pianoMixDefaults.pianoResonance);
  const control = (label: string, value: number, maximum: number, neutral: number, text: string, change: (value: number) => void): ReactNode => (
    <div key={label} className="physical-control sampler-piano-control">
      <strong>{label}</strong>
      <div className="knob-wrap">
        <Knob label={label} value={value} min={0} max={maximum} neutral={neutral} keyStep={1} valueText={text}
          disabled={disabled} onChange={v => change(Math.round(v))} onRelease={onRelease}/>
      </div>
      <output aria-live="off">{text}</output>
    </div>
  );
  const edit = (key: PianoMixKey, value: number) => {
    if (key === "pianoResonance" && value > 0) previousResonance.current = value;
    onChange?.(key, value);
  };
  return <fieldset className="sampler-piano-panel" disabled={disabled}>
    <legend>{mix ? "Piano mix" : "Room"}</legend>
    <div className="source-tabs sampler-piano-bypass">
      {room && <button type="button" aria-pressed={room.amount > 0} onClick={room.onToggle}>Room</button>}
      {mix && <button type="button" aria-pressed={mix.pianoResonance > 0} onClick={() => {
        if (mix.pianoResonance > 0) previousResonance.current = mix.pianoResonance;
        edit("pianoResonance", mix.pianoResonance > 0 ? 0 : previousResonance.current);
        onRelease?.();
      }}>Sympathetic resonance</button>}
    </div>
    <div className="knob-bank sampler-piano-knobs">
      {mix && pianoMixKeys.map(key => control(labels[key], mix[key], pianoMixMax, pianoMixDefaults[key], pianoMixText(mix[key]), value => edit(key, value)))}
      {room && control("Room amount", Math.round(room.amount * 100), 100, 18, `${Math.round(room.amount * 100)}%`, value => room.onChange(value / 100))}
    </div>
  </fieldset>;
}
