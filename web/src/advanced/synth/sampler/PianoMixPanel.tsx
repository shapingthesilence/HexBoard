import {useRef, useState, type CSSProperties, type ReactNode} from "react";
import {Knob} from "../SynthControls.tsx";
import {MixFader, type FaderTick} from "./MixFader.tsx";
import {PianoDiagram, type PianoPart} from "./PianoDiagram.tsx";
import {pianoMixDb, pianoMixDefaults, pianoMixKeys, pianoMixMax, pianoMixMaximum, pianoResonanceMax, pianoMixText, type PianoMix, type PianoMixKey} from "./pianoMix.mjs";

const channels: Record<PianoPart, {label: string; color: string; hint: string}> = {
  pianoKeyNoise: {label: "Key return", color: "var(--sampler-2)", hint: "The key landing back on its rail."},
  pianoPedalNoise: {label: "Pedal noise", color: "var(--wavetable-1)", hint: "Pedal and damper rail thumps."},
  pianoStringRelease: {label: "String release", color: "var(--strings-1)", hint: "The damper settling back onto the string."},
  pianoResonance: {label: "Resonance", color: "var(--sampler-1)", hint: "Undamped strings ringing in sympathy."},
  room: {label: "Room amount", color: "var(--brand)", hint: "The shared reverb."},
};
// Top of the resonance track holds the +16 to +36 dB audition range.
const auditionShare = .28;
const mixTicks: FaderTick[] = [{value: 1, label: "−48"}, {value: 49, label: "−24"}, {value: 73, label: "−12"}, {value: 97, label: "0"}, {value: 121, label: "+12"}];
const resonanceTicks: FaderTick[] = [...mixTicks, {value: 124, label: "+24"}, {value: 127, label: "+36"}];
const roomTicks: FaderTick[] = [0, 25, 50, 75, 100].map(value => ({value, label: String(value)}));

function wordPosition(key: PianoMixKey) {
  const max = pianoMixMaximum(key);
  if (max === pianoMixMax) return {to: (word: number) => word / pianoMixMax, from: (p: number) => p * pianoMixMax};
  const below = 1 - auditionShare;
  return {
    to: (word: number) => word <= pianoMixMax ? word / pianoMixMax * below : below + (word - pianoMixMax) / (max - pianoMixMax) * auditionShare,
    from: (p: number) => p <= below ? p / below * pianoMixMax : pianoMixMax + (p - below) / auditionShare * (max - pianoMixMax),
  };
}
/** Diagram brightness: −48 dB dark, +12 dB full; resonance reaches full at +36 dB. */
function intensity(key: PianoMixKey, word: number) {
  if (!word) return 0;
  const top = key === "pianoResonance" ? 36 : 12;
  return Math.max(.06, Math.min(1, (pianoMixDb(word) + 48) / (top + 48)));
}

type Room = {amount: number; onChange: (amount: number) => void; onToggle: () => void};
type Solo = {active: boolean; onToggle: () => void};
type Props = {
  mix?: Readonly<PianoMix>;
  onChange?: (key: PianoMixKey, value: number) => void;
  onRelease?: () => void;
  room?: Room;
  /** Live only: hear the sympathetic strings without the dry piano. */
  solo?: Solo;
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

export function PianoMixPanel({mix, onChange, onRelease, room, solo, disabled}: Props) {
  const previous = useRef<Record<PianoMixKey, number>>({...pianoMixDefaults});
  const beforeBoost = useRef(pianoMixDefaults.pianoResonance);
  const strips = useRef<Partial<Record<PianoPart, HTMLDivElement | null>>>({});
  const [active, setActive] = useState<PianoPart>();
  const edit = (key: PianoMixKey, value: number) => {
    if (value > 0) previous.current[key] = value;
    onChange?.(key, value);
  };
  const toggle = (key: PianoMixKey) => {
    if (!mix) return;
    if (mix[key] > 0) previous.current[key] = mix[key];
    edit(key, mix[key] > 0 ? 0 : previous.current[key] || pianoMixDefaults[key]);
    onRelease?.();
  };
  const boosted = mix?.pianoResonance === pianoResonanceMax;
  const boost = () => {
    if (!mix) return;
    if (boosted) edit("pianoResonance", beforeBoost.current);
    else {
      beforeBoost.current = mix.pianoResonance || pianoMixDefaults.pianoResonance;
      edit("pianoResonance", pianoResonanceMax);
    }
    onRelease?.();
  };
  const levels: Partial<Record<PianoPart, number>> = {};
  if (mix) for (const key of pianoMixKeys) levels[key] = intensity(key, mix[key]);
  if (room) levels.room = room.amount && Math.max(.06, Math.sqrt(room.amount));
  const focus = (part: PianoPart) => strips.current[part]?.querySelector<HTMLElement>("[role=slider]")?.focus();
  const silent = (part: PianoPart) => solo?.active && part !== "pianoResonance" && part !== "room";
  const strip = (part: PianoPart, on: boolean, toggleOn: () => void, fader: ReactNode, extra?: ReactNode) =>
    <div key={part} ref={node => { strips.current[part] = node; }}
      className={`piano-strip${active === part ? " is-active" : ""}${on ? "" : " is-off"}${silent(part) ? " is-silent" : ""}`}
      style={{"--fader": channels[part].color} as CSSProperties} title={channels[part].hint}
      onPointerEnter={() => setActive(part)} onPointerLeave={() => setActive(undefined)}>
      <strong>{channels[part].label}</strong>
      {fader}
      <div className="piano-strip-buttons">
        <button type="button" className="piano-strip-power" aria-pressed={on} aria-label={`${channels[part].label} on`}
          onClick={toggleOn}>{on ? "On" : "Off"}</button>
        {extra}
      </div>
    </div>;

  return <fieldset className="sampler-piano-panel piano-mix" disabled={disabled}>
    <legend>{mix ? "Piano mix" : "Room"}</legend>
    {mix && <PianoDiagram levels={levels} boosted={boosted} solo={solo?.active} active={active}
      onPick={part => { setActive(part); focus(part); }} onHover={setActive}/>}
    <div className="piano-strips">
      {mix && pianoMixKeys.map(key => {
        const map = wordPosition(key);
        const resonance = key === "pianoResonance";
        return strip(key, mix[key] > 0, () => toggle(key),
          <>
            <MixFader label={channels[key].label} value={mix[key]} min={0} max={pianoMixMaximum(key)}
              neutral={pianoMixDefaults[key]} valueText={pianoMixText(mix[key])} toPosition={map.to} fromPosition={map.from}
              ticks={resonance ? resonanceTicks : mixTicks} zoneFrom={resonance ? pianoMixMax : undefined}
              color={channels[key].color} disabled={disabled} onFocus={() => setActive(key)}
              onChange={value => edit(key, value)} onRelease={onRelease}/>
            <output aria-live="off" className={resonance && mix[key] > pianoMixMax ? "is-audition" : undefined}>{pianoMixText(mix[key])}</output>
          </>,
          resonance && <>
            <button type="button" className="piano-strip-boost" aria-pressed={boosted} title="Jump to +36 dB; click again to restore"
              onClick={boost}>+36 dB</button>
            {solo && <button type="button" className="piano-strip-solo" aria-pressed={solo.active}
              title="Mute the dry piano and lift the resonance dampers" onClick={solo.onToggle}>Solo</button>}
          </>);
      })}
      {room && strip("room", room.amount > 0, room.onToggle, <>
        <MixFader label={channels.room.label} value={Math.round(room.amount * 100)} min={0} max={100} neutral={18}
          valueText={`${Math.round(room.amount * 100)}%`} toPosition={v => v / 100} fromPosition={p => p * 100}
          ticks={roomTicks} color={channels.room.color} disabled={disabled} onFocus={() => setActive("room")}
          onChange={value => room.onChange(value / 100)} onRelease={onRelease}/>
        <output aria-live="off">{Math.round(room.amount * 100)}%</output>
      </>)}
    </div>
    {solo?.active && <p className="piano-solo-note" role="status">
      {mix?.pianoResonance ? "Solo: only the sympathetic strings are heard, with their dampers lifted. Play a chord and let go to hear them ring."
        : "Solo is on, but resonance is off, so nothing is heard."}
    </p>}
  </fieldset>;
}
