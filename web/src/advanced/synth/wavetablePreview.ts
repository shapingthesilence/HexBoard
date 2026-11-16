import {VisualPreview} from './visualPreview.ts';
import {parameterCount, sourceCount, type WavetablePreset} from './wavetableSchema.ts';

/** One bounded visual snapshot; MIDI and animation never enter editor/history state. */
export class WavetablePreview extends VisualPreview {
  constructor(private preset: WavetablePreset, origin = performance.now()) {
    super(parameterCount, 2, origin);
    this.advance(origin);
  }
  configure(preset: WavetablePreset, connected: boolean, pressure: number) {
    this.preset = preset; this.connected = connected; this.pressure = pressure;
  }
  protected sample(now: number) {
    this.sampleSources(this.preset.mod, now, 0);
    const s = this.sources;
    const p = this.parameters;
    for (let i = 0; i < p.length; ++i) p[i] = this.preset.parameters[i] / 65535;
    for (const r of this.preset.routes) if (r.source < sourceCount && r.destination < p.length) p[r.destination] += s[r.source] * r.depth / 65536;
    for (let i = 0; i < p.length; ++i) p[i] = Math.max(0, Math.min(1, p[i]));
  }
}
