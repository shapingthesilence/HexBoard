import {VisualPreview} from './visualPreview.ts';
import {effectiveParameters, type PhysicalPreset} from './schema.ts';
import {effectiveAdvanced, type AdvancedPatch} from './advancedSchema.ts';

export class PhysicalPreview extends VisualPreview {
  constructor(private preset: PhysicalPreset, origin = performance.now()) { super(preset.parameters.length, 1, origin); this.advance(origin); }
  configure(preset: PhysicalPreset, connected: boolean, pressure: number) { this.preset = preset; this.connected = connected; this.pressure = pressure; }
  protected sample(now: number) {
    this.sampleSources([this.preset.modulation.settings], now);
    const values = effectiveParameters(this.preset, this.sources);
    for (let i = 0; i < values.length; ++i) this.parameters[i] = values[i];
  }
}

/** The native envelope/LFO settings shown by the Juno/DX7 controls. */
function classicSourceSettings(patch: AdvancedPatch) {
    const settings = [...patch.settings], np = patch.parameters;
    if (patch.engine === 4) {
        settings.splice(0, 4, ...np.slice(settings[5] >= 32768 ? 16 : 12, settings[5] >= 32768 ? 20 : 16));
        settings[4] = settings[5] = 0;
        settings[8] = Math.round(np[20] * 8.65 * Math.LN2 / 5.991465);
        settings[12] = np[21];
    }
    else {
        const op = (5 - Math.round(settings[5] / 13107)) * 21;
        settings[0] = Math.round((99 - np[op]) * 65535 / 99);
        settings[1] = Math.round((99 - np[op + 1]) * 65535 / 99);
        settings[2] = Math.round(np[op + 6] * 65535 / 99);
        settings[3] = Math.round((99 - np[op + 3]) * 65535 / 99);
        settings[4] = settings[5] = 0;
        const rate = np[137], hz = rate === 0 ? .064 : rate <= 64 ? rate / 6 : rate <= 85 ? rate - 64 * 5 / 6 : 31.67 + (rate - 85) * 1.33;
        settings[8] = Math.round(Math.log(hz / .05) / 5.991465 * 65535);
        settings[9] = [1, 3, 2, 4, 0, 5][np[142]] * 13107;
        settings[10] = np[141] ? 65535 : 0;
        settings[12] = np[138] === 0 ? 0 : Math.round(Math.log(np[138] / 99 * 5 / .001) / 9.903488 * 65535);
    }
    return settings;
}

export class ClassicPreview extends VisualPreview {
  private settings: number[];
  constructor(private patch: AdvancedPatch, origin = performance.now()) {
    super(patch.parameters.length, 1, origin); this.settings = classicSourceSettings(patch); this.advance(origin);
  }
  configure(patch: AdvancedPatch, connected: boolean, pressure: number) {
    if (patch !== this.patch) this.settings = classicSourceSettings(patch);
    this.patch = patch; this.connected = connected; this.pressure = pressure;
  }
  protected sample(now: number) {
    this.sampleSources([this.settings], now);
    const values = effectiveAdvanced(this.patch, this.sources);
    for (let i = 0; i < values.length; ++i) this.parameters[i] = values[i];
  }
}
