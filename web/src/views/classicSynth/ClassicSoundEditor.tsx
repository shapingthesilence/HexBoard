import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Knob, type KnobRoute } from "../../advanced/synth/SynthControls.tsx";
import { synthWavetableBaseSamples } from "../../catalogs/index.ts";
import {
  arpDirectionOptions, arpDivisionOptions, driveLabel, envelopePositionCount, envelopeTimeIndex, envelopeTimeLabel, envelopeTimePosition,
  fxAmountByteToPercent, fxAmountPercentToByte, lfoSpeedLabel, lfoWaveOptions, ModTarget, modTargetOptions, pitchSemitones, playbackOptions,
  positionFrames, synthVibratoSpeedNoise, targetLabel, vibratoSpeedLabel, wavetableFrameToPositionByte, wavetablePositionByteToFrame,
  wheelAmountByteToPercent, wheelAmountPercentToByte, wheelTargetOptions,
  type EditableSynthValueKey, type EditableSynthValues
} from "./classicSynthModel.ts";
import { DriveView, EnvelopeEditor, EnvelopeShape, LfoShape, LiveCycleView, useLiveVoiceShape, WavetableStack, WheelPosition, type EnvelopeValues } from "./ClassicSynthVisuals.tsx";
import type { SynthVoiceShapeListener } from "../../audio/synthPreview.ts";
import "../../advanced/synth/PhysicalSynthEditor.css";
import "../../advanced/synth/WavetableSynthEditor.css";
import "../../advanced/synth/SynthIdentity.css";
import "./ClassicSoundEditor.css";

type SourceKey = "wheel" | "lfo" | "env1" | "env2";
interface SourceDefinition {
  key: SourceKey; name: string; short: string; note: string; color: string;
  target: EditableSynthValueKey; amount: EditableSynthValueKey;
  toPercent: (byte: number) => number; toByte: (percent: number) => number;
  targets: readonly { label: string; value: number }[];
  envelope?: "EffectEnvelope" | "EffectEnvelope2";
}
const sourceDefinitions: readonly SourceDefinition[] = [
  { key: "wheel", name: "Mod wheel", short: "Wheel", note: "Your mod wheel, or Mod in the test keyboard", color: "var(--classic-wheel)", target: "SynthModTarget", amount: "SynthModAmount", toPercent: wheelAmountByteToPercent, toByte: wheelAmountPercentToByte, targets: wheelTargetOptions },
  { key: "lfo", name: "LFO", short: "LFO", note: "One wave shared by every note", color: "var(--classic-lfo)", target: "SynthLfoTarget", amount: "SynthLfoAmount", toPercent: fxAmountByteToPercent, toByte: fxAmountPercentToByte, targets: modTargetOptions },
  { key: "env1", name: "Mod envelope 1", short: "Env 1", note: "Restarts with each note", color: "var(--classic-env1)", target: "EffectEnvelopeTarget", amount: "EffectEnvelopeAmount", toPercent: fxAmountByteToPercent, toByte: fxAmountPercentToByte, targets: modTargetOptions, envelope: "EffectEnvelope" },
  { key: "env2", name: "Mod envelope 2", short: "Env 2", note: "Restarts with each note", color: "var(--classic-env2)", target: "EffectEnvelope2Target", amount: "EffectEnvelope2Amount", toPercent: fxAmountByteToPercent, toByte: fxAmountPercentToByte, targets: modTargetOptions, envelope: "EffectEnvelope2" }
];
interface Route { source: SourceDefinition; target: number; percent: number }

const signed = (value: number, unit = "%") => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value * 10) / 10)}${unit}`;
/** What a route does at full depth, in the target's own units. */
function routeEffect(target: number, percent: number, lfo: boolean): string {
  const text = target === ModTarget.Pitch ? signed(pitchSemitones(percent), " st") : target === ModTarget.WavetablePosition ? signed(positionFrames(percent), " frames") : signed(percent);
  return lfo ? `±${text.replace(/^[+−]/, "")}` : text;
}
const oscillatorTargets = [ModTarget.Vibrato, ModTarget.Pitch, ModTarget.WaveFolding, ModTarget.PulseWidth, ModTarget.PolyWarp] as const;
// Off silences the synth rather than shaping a sound, so patches pick a playing mode.
// A sound saved with Off still shows it until another mode is chosen.
const patchModes = playbackOptions.filter((option) => option.value !== 0);
const percent127 = (value: number) => `${Math.round(value / 127 * 100)}%`;

interface KnobProps {
  label: string; value: number; min: number; max: number; format: (value: number) => string;
  onChange: (value: number) => void; routes?: KnobRoute[]; lit?: string;
}
/** A stepped Classic setting on the shared synth knob. */
export function ClassicKnob({ label, value, min, max, format, onChange, routes, lit }: KnobProps) {
  const text = format(value);
  return <div className="physical-control" data-lit={lit ? true : undefined} style={lit ? { "--lit": lit } as CSSProperties : undefined}>
    <strong>{label}</strong>
    <div className="knob-wrap"><Knob label={label} value={value} min={min} max={max} keyStep={1} valueText={text} routes={routes}
      onChange={(next) => { const stepped = Math.max(min, Math.min(max, Math.round(next))); if (stepped !== value) onChange(stepped); }}/></div>
    <output>{text}</output>
  </div>;
}

function Choice({ label, value, options, onChange }: { label: string; value: number; options: readonly { label: string; value: number }[]; onChange: (value: number) => void }) {
  return <label className="classic-choice"><span>{label}</span><select value={value} onChange={(e) => onChange(Number(e.target.value))}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>;
}

export interface ClassicSoundEditorProps {
  values: EditableSynthValues;
  onChange: (key: EditableSynthValueKey, value: number) => void;
  wavetableName: string;
  /** The selected table's samples; mip levels are ignored. */
  samples?: Uint8Array;
  wavetablePicker: ReactNode;
  /** Shown when the table's samples are not in this browser. */
  missingSamples?: ReactNode;
  /** Current mod wheel position, 0–127. */
  modWheel: number;
  /** Follows the browser preview's newest voice, for the live pictures. */
  subscribeVoiceShape?: (listener: SynthVoiceShapeListener) => () => void;
}

/** HexBoard Classic wavetable sound: oscillator, volume envelope, output drive and four motion sources. */
export function ClassicSoundEditor({ values: v, onChange, wavetableName, samples, wavetablePicker, missingSamples, modWheel, subscribeVoiceShape }: ClassicSoundEditorProps) {
  const [focus, setFocus] = useState<SourceKey>();
  const base = useMemo(() => samples && synthWavetableBaseSamples(samples), [samples]);
  const routes: Route[] = sourceDefinitions.map((source) => ({ source, target: v[source.target], percent: source.toPercent(v[source.amount]) }))
    .filter((route) => route.percent !== 0 && route.target !== ModTarget.Off);
  const routesTo = (target: number) => routes.filter((route) => route.target === target);
  const focusedRoute = routes.find((route) => route.source.key === focus);
  const lit = (target: number) => focusedRoute?.target === target ? focusedRoute.source.color : undefined;
  // Rings show how far each source moves the setting: the LFO swings both ways.
  const rings = (target: number): KnobRoute[] => routesTo(target).map((route, i) => ({ label: route.source.name, i, depth: route.percent / 100 * 65536, bipolar: route.source.key === "lfo", color: route.source.color }));

  const frame = wavetablePositionByteToFrame(v.SynthWavetablePosition) - 1;
  const live = useLiveVoiceShape(subscribeVoiceShape);
  const mode = v.PlaybackMode, arp = mode === 2 || mode === 6, mono = mode === 1 || mode === 4;
  const timeKnob = (label: string, key: EditableSynthValueKey, target?: number) => <ClassicKnob key={key} label={label} value={envelopeTimePosition(v[key])} min={0} max={envelopePositionCount - 1}
    format={(position) => envelopeTimeLabel(envelopeTimeIndex(position))} onChange={(position) => onChange(key, envelopeTimeIndex(position))}
    routes={target === undefined ? undefined : rings(target)} lit={target === undefined ? undefined : lit(target)}/>;
  const levelKnob = (label: string, key: EditableSynthValueKey, target?: number) => <ClassicKnob key={key} label={label} value={v[key]} min={0} max={127} format={percent127}
    onChange={(value) => onChange(key, value)} routes={target === undefined ? undefined : rings(target)} lit={target === undefined ? undefined : lit(target)}/>;
  const volume: EnvelopeValues = [v.EnvelopeAttackIndex, v.EnvelopeHoldIndex, v.EnvelopeDecayIndex, v.EnvelopeSustainLevel, v.EnvelopeReleaseIndex];
  const volumeKeys: EditableSynthValueKey[] = ["EnvelopeAttackIndex", "EnvelopeHoldIndex", "EnvelopeDecayIndex", "EnvelopeSustainLevel", "EnvelopeReleaseIndex"];

  return <div className="classic-sound" data-synth-off={mode === 0 || undefined}>
    <fieldset className="classic-playback"><legend>Playback</legend>
      <Choice label="Synth mode" value={mode} options={mode === 0 ? playbackOptions : patchModes} onChange={(value) => onChange("PlaybackMode", value)}/>
      {arp && <>
        <Choice label="Arpeggiator rate" value={v.ArpeggiatorDivision} options={arpDivisionOptions} onChange={(value) => onChange("ArpeggiatorDivision", value)}/>
        <Choice label="Arpeggiator direction" value={v.ArpeggiatorDirection} options={arpDirectionOptions} onChange={(value) => onChange("ArpeggiatorDirection", value)}/>
        <ClassicKnob label="Note length" value={v.ArpeggiatorNoteLength} min={1} max={100} format={(value) => `${value}%`} onChange={(value) => onChange("ArpeggiatorNoteLength", value)}/>
        <ClassicKnob label="Tempo" value={v.SynthBPM} min={1} max={255} format={(value) => `${value} BPM`} onChange={(value) => onChange("SynthBPM", value)}/>
      </>}
      {mono && <ClassicKnob label="Portamento" value={v.SynthPortamentoTimeIndex} min={0} max={19} format={envelopeTimeLabel} onChange={(value) => onChange("SynthPortamentoTimeIndex", value)}/>}
    </fieldset>

    <div className="wt-workspace">
      <div className="wt-stages classic-stages">
        <fieldset className="wt-stage classic-oscillator" data-active><legend>Oscillator <span className="wt-cost">{wavetableName} · frame {frame + 1}</span></legend>
          <div className="classic-table-row">{wavetablePicker}<small>Drag the table up or down to pick a frame.</small></div>
          {missingSamples}
          <div className="classic-pictures">
            <WavetableStack samples={base} name={wavetableName} frame={frame} live={live} onFrame={(next) => onChange("SynthWavetablePosition", wavetableFrameToPositionByte(next + 1))}/>
            <LiveCycleView samples={base} position={v.SynthWavetablePosition} live={live}/>
          </div>
          <div className="knob-bank">
            <ClassicKnob label="Wavetable position" value={frame + 1} min={1} max={16} format={(value) => `${value}/16`} onChange={(value) => onChange("SynthWavetablePosition", wavetableFrameToPositionByte(value))}
              routes={rings(ModTarget.WavetablePosition)} lit={lit(ModTarget.WavetablePosition)}/>
            <ClassicKnob label="Vibrato speed" value={v.SynthVibratoSpeed} min={0} max={synthVibratoSpeedNoise} format={vibratoSpeedLabel} onChange={(value) => onChange("SynthVibratoSpeed", value)} lit={lit(ModTarget.Vibrato)}/>
          </div>
          <div className="classic-targets" aria-label="Modulation in the oscillator">
            {oscillatorTargets.map((target) => {
              const here = routesTo(target), color = lit(target);
              return <span key={target} className="classic-target" data-live={here.length > 0 || undefined} data-lit={color ? true : undefined} style={color ? { "--lit": color } as CSSProperties : undefined}>
                {here.map(({ source }) => <i key={source.key} style={{ background: source.color }}/>)}{targetLabel(target)}
                {here.map(({ source, percent }) => <em key={source.key} style={{ color: source.color }}> {routeEffect(target, percent, source.key === "lfo")}</em>)}
                {target === ModTarget.Vibrato && <em> · {vibratoSpeedLabel(v.SynthVibratoSpeed)}</em>}
              </span>;
            })}
          </div>
        </fieldset>

        <fieldset className="wt-stage classic-half" data-active><legend>Volume envelope <span className="wt-cost">each note</span></legend>
          <EnvelopeEditor values={volume} onChange={(stage, value) => onChange(volumeKeys[stage], value)}/>
          <div className="knob-bank">
            {timeKnob("Attack", "EnvelopeAttackIndex", ModTarget.Attack)}{timeKnob("Hold", "EnvelopeHoldIndex", ModTarget.Hold)}{timeKnob("Decay", "EnvelopeDecayIndex", ModTarget.Decay)}
            {levelKnob("Sustain", "EnvelopeSustainLevel", ModTarget.Sustain)}{timeKnob("Release", "EnvelopeReleaseIndex", ModTarget.Release)}
          </div>
        </fieldset>

        <fieldset className="wt-stage classic-half" data-active={v.SynthDrive > 0 || undefined}><legend>Drive <span className="wt-cost">all voices</span></legend>
          <DriveView samples={base} frame={frame} mode={v.SynthDrive}/>
          <div className="knob-bank"><ClassicKnob label="Drive" value={v.SynthDrive} min={0} max={3} format={driveLabel} onChange={(value) => onChange("SynthDrive", value)}/></div>
          <p className="panel-note wt-stage-note">Drive shapes the mix of every playing note, so chords and loud notes push it harder. Each step raises the level going into the same soft clip.</p>
        </fieldset>
      </div>

      <aside className="wt-side classic-sources" aria-label="Motion sources">
        <span className="classic-side-title">Motion sources</span>
        {sourceDefinitions.map((source) => {
          const target = v[source.target], percent = source.toPercent(v[source.amount]), active = percent !== 0 && target !== ModTarget.Off;
          const summary = active ? `→ ${targetLabel(target)} ${routeEffect(target, percent, source.key === "lfo")}` : "Off";
          const env = source.envelope;
          return <section key={source.key} className="classic-source" data-active={active || undefined} data-focused={focus === source.key || undefined} style={{ "--source": source.color } as CSSProperties}>
            <button type="button" className="classic-source-head" aria-pressed={focus === source.key} title="Highlight where this source goes" onClick={() => setFocus(focus === source.key ? undefined : source.key)}>
              <b>{source.name}</b><span>{summary}</span><small>{source.note}</small>
            </button>
            {source.key === "wheel" && <WheelPosition position={modWheel} reach={active ? `full wheel: ${routeEffect(target, percent, false)}` : "not routed"}/>}
            {source.key === "lfo" && <LfoShape wave={v.SynthLfoWave} speed={lfoSpeedLabel(v.SynthLfoSpeed)} inverted={percent < 0}/>}
            {env && <EnvelopeShape values={[v[`${env}AttackIndex`], v[`${env}HoldIndex`], v[`${env}DecayIndex`], v[`${env}SustainLevel`], v[`${env}ReleaseIndex`]]} inverted={percent < 0}/>}
            <Choice label="Target" value={target} options={source.targets} onChange={(value) => onChange(source.target, value)}/>
            {source.key === "lfo" && <Choice label="Wave" value={v.SynthLfoWave} options={lfoWaveOptions} onChange={(value) => onChange("SynthLfoWave", value)}/>}
            <div className="knob-bank">
              <ClassicKnob label="Amount" value={percent} min={-100} max={100} format={(value) => signed(value)} onChange={(value) => onChange(source.amount, source.toByte(value))}/>
              {source.key === "lfo" && <ClassicKnob label="Speed" value={v.SynthLfoSpeed} min={0} max={19} format={lfoSpeedLabel} onChange={(value) => onChange("SynthLfoSpeed", value)}/>}
              {env && <>{timeKnob("Attack", `${env}AttackIndex`)}{timeKnob("Hold", `${env}HoldIndex`)}{timeKnob("Decay", `${env}DecayIndex`)}{levelKnob("Sustain", `${env}SustainLevel`)}{timeKnob("Release", `${env}ReleaseIndex`)}</>}
            </div>
          </section>;
        })}
      </aside>
    </div>
  </div>;
}
