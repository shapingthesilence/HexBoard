import {
  driveLabel, envelopePositionCount, envelopeTimeIndex, envelopeTimeLabel, envelopeTimePosition, synthVibratoSpeedNoise,
  vibratoSpeedLabel, wheelAmountByteToPercent, wheelAmountPercentToByte, type EditableSynthValueKey, type EditableSynthValues
} from "./classicSynthModel.ts";
import { ClassicKnob, ClassicPlayback, percent127 } from "./ClassicSoundEditor.tsx";
import { WheelPosition } from "./ClassicSynthVisuals.tsx";
import "../../advanced/synth/PhysicalSynthEditor.css";
import "../../advanced/synth/WavetableSynthEditor.css";
import "./ClassicSoundEditor.css";

/** Amp envelope stages in SAMPLER_ENVELOPE_OVERRIDE bit order. */
const stages: readonly { label: string; key: EditableSynthValueKey; level?: boolean }[] = [
  { label: "Attack", key: "EnvelopeAttackIndex" },
  { label: "Hold", key: "EnvelopeHoldIndex" },
  { label: "Decay", key: "EnvelopeDecayIndex" },
  { label: "Sustain", key: "EnvelopeSustainLevel", level: true },
  { label: "Release", key: "EnvelopeReleaseIndex" }
];

export interface ClassicSamplerSoundEditorProps {
  values: EditableSynthValues;
  onChange: (key: EditableSynthValueKey, value: number) => void;
  instrumentName: string;
  /** Opens the sound's instrument in the Instruments editor. */
  onEditInstrument?: () => void;
  /** Set bits replace the instrument's own stage (bit 0 attack … bit 4 release). */
  envelopeOverride: number;
  onEnvelopeOverrideChange: (mask: number) => void;
  /** Current mod wheel position, 0–127. */
  modWheel: number;
}

/** HexBoard Classic sampler sound: the instrument stays fixed; only the controls the board offers are edited. */
export function ClassicSamplerSoundEditor({ values: v, onChange, instrumentName, onEditInstrument, envelopeOverride, onEnvelopeOverrideChange, modWheel }: ClassicSamplerSoundEditorProps) {
  const wheelPercent = wheelAmountByteToPercent(v.SynthModAmount);
  const stageControl = (stage: (typeof stages)[number], bit: number) => {
    const own = (envelopeOverride & bit) === 0;
    // Turning a stage replaces the instrument's value, as on the board.
    const change = (value: number) => { onChange(stage.key, value); if (own) onEnvelopeOverrideChange(envelopeOverride | bit); };
    return <div className="classic-sampler-stage" key={stage.key} data-inst={own || undefined}>
      {stage.level
        ? <ClassicKnob label={stage.label} value={v[stage.key]} min={0} max={127} format={(value) => own ? "Inst" : percent127(value)} onChange={change}/>
        : <ClassicKnob label={stage.label} value={envelopeTimePosition(v[stage.key])} min={0} max={envelopePositionCount - 1}
            format={(position) => own ? "Inst" : envelopeTimeLabel(envelopeTimeIndex(position))} onChange={(position) => change(envelopeTimeIndex(position))}/>}
      <label className="checkField" title="Use the instrument's own value for this stage">
        <input type="checkbox" checked={own} aria-label={`${stage.label}: use instrument's own`}
          onChange={(event) => onEnvelopeOverrideChange(event.target.checked ? envelopeOverride & ~bit : envelopeOverride | bit)}/>
        <span>Inst</span>
      </label>
    </div>;
  };

  return <div className="classic-sound classic-sampler-sound">
    <ClassicPlayback values={v} onChange={onChange}/>

    <div className="wt-stages classic-stages">
      <fieldset className="wt-stage classic-oscillator" data-active><legend>Instrument <span className="wt-cost">Classic sampler</span></legend>
        <p className="classic-sampler-instrument"><strong>{instrumentName}</strong>
          {onEditInstrument && <button type="button" onClick={onEditInstrument}>Edit instrument</button>}
        </p>
        <p className="panel-note">The instrument is stored inside this sound, so copying or exporting the sound takes it along. Edit instrument opens it in Instruments; sending it back replaces it in this sound. The browser test keyboard can't play instruments; use Preview on HexBoard.</p>
      </fieldset>

      <fieldset className="wt-stage classic-oscillator" data-active><legend>Amp envelope <span className="wt-cost">each note</span></legend>
        <div className="knob-bank classic-sampler-stages">{stages.map((stage, index) => stageControl(stage, 1 << index))}</div>
        <p className="panel-note wt-stage-note">Inst keeps the value recorded with each part of the instrument. Turn a stage to replace it everywhere; tick Inst to go back.</p>
      </fieldset>

      <fieldset className="wt-stage classic-half" data-active={wheelPercent !== 0 || undefined}><legend>Vibrato <span className="wt-cost">mod wheel</span></legend>
        <WheelPosition position={modWheel} reach={wheelPercent !== 0 ? `full wheel: ${wheelPercent}% depth` : "off"}/>
        <div className="knob-bank">
          <ClassicKnob label="Wheel amount" value={wheelPercent} min={-100} max={100} format={(value) => `${value}%`} onChange={(value) => onChange("SynthModAmount", wheelAmountPercentToByte(value))}/>
          <ClassicKnob label="Vibrato speed" value={v.SynthVibratoSpeed} min={0} max={synthVibratoSpeedNoise} format={vibratoSpeedLabel} onChange={(value) => onChange("SynthVibratoSpeed", value)}/>
        </div>
      </fieldset>

      <fieldset className="wt-stage classic-half" data-active={v.SynthDrive > 0 || undefined}><legend>Drive <span className="wt-cost">all voices</span></legend>
        <div className="knob-bank"><ClassicKnob label="Drive" value={v.SynthDrive} min={0} max={3} format={driveLabel} onChange={(value) => onChange("SynthDrive", value)}/></div>
        <p className="panel-note wt-stage-note">Drive shapes the mix of every playing note, so chords and loud notes push it harder.</p>
      </fieldset>
    </div>
  </div>;
}
