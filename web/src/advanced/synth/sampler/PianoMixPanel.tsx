import {useRef} from "react";
import {Knob} from "../SynthControls.tsx";
import {pianoMixDefaults, pianoMixKeys, pianoMixMaximum, pianoResonanceMax, pianoMixText, type PianoMix, type PianoMixKey} from "./pianoMix.mjs";

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

export function SamplerMixKnob({label, value, min = 0, max, neutral, valueText, disabled, onChange, onRelease}: {
  label: string; value: number; min?: number; max: number; neutral: number; valueText: string;
  disabled?: boolean; onChange: (value: number) => void; onRelease?: () => void;
}) {
  return <div className="physical-control sampler-piano-control">
    <strong>{label}</strong>
    <div className="knob-wrap">
      <Knob label={label} value={value} min={min} max={max} neutral={neutral} keyStep={1} valueText={valueText}
        disabled={disabled} onChange={value => onChange(Math.round(value))} onRelease={onRelease}/>
    </div>
    <output aria-live="off">{valueText}</output>
  </div>;
}

export function PianoMixPanel({mix, onChange, onRelease, room, disabled}: Props) {
  const previousResonance = useRef(pianoMixDefaults.pianoResonance);
  const beforeBoost = useRef(pianoMixDefaults.pianoResonance);
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
      {mix && <button type="button" aria-pressed={mix.pianoResonance === pianoResonanceMax} onClick={() => {
        if (mix.pianoResonance === pianoResonanceMax) edit("pianoResonance", beforeBoost.current);
        else {
          beforeBoost.current = mix.pianoResonance;
          edit("pianoResonance", pianoResonanceMax);
        }
        onRelease?.();
      }}>Boost resonance +36 dB</button>}
    </div>
    <div className="knob-bank sampler-piano-knobs">
      {mix && pianoMixKeys.map(key => <SamplerMixKnob key={key} label={labels[key]} value={mix[key]} max={pianoMixMaximum(key)} neutral={pianoMixDefaults[key]} valueText={pianoMixText(mix[key])} disabled={disabled} onChange={value => edit(key, value)} onRelease={onRelease}/>)}
      {room && <SamplerMixKnob label="Room amount" value={Math.round(room.amount * 100)} max={100} neutral={18} valueText={`${Math.round(room.amount * 100)}%`} disabled={disabled} onChange={value => room.onChange(value / 100)} onRelease={onRelease}/>}
    </div>
  </fieldset>;
}
