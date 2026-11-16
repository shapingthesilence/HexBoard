import type {ControllerState, PhysicalExpression} from './client.ts';
import {SourcePreview} from './sourcePreview.ts';

/** Fixed-size live data shared by synth views, separate from editable/history state. */
export abstract class VisualPreview {
  readonly parameters: number[];
  readonly sources: number[];
  expression?: PhysicalExpression;
  protected controller?: ControllerState;
  protected connected = false;
  protected pressure = 0;
  private banks: SourcePreview[];
  private listeners = new Set<() => void>();
  private frames = new Set<(now: number) => void>();
  constructor(parameters: number, banks: number, readonly origin = performance.now()) {
    this.parameters = Array(parameters).fill(0);
    this.sources = Array(7 + banks * 2).fill(0);
    this.banks = Array.from({length: banks}, () => new SourcePreview(origin));
  }
  setExpression = (expression?: PhysicalExpression) => {
    const old = this.expression;
    if (old && expression && (Object.keys(expression) as (keyof PhysicalExpression)[]).every(key => old[key] === expression[key])) return;
    this.expression = expression;
  };
  setController = (controller?: ControllerState) => { this.controller = controller; };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  subscribeFrame = (paint: (now: number) => void) => { this.frames.add(paint); return () => { this.frames.delete(paint); }; };
  protected sampleSources(settings: readonly number[][], now: number, expressionDefault = 1) {
    const e = this.expression, s = this.sources;
    s[0] = this.connected ? (e?.velocity ?? 0) / 127 : .8;
    s[1] = this.connected ? (e?.pressure ?? 0) / 65535 : this.pressure / 65535;
    s[2] = this.connected ? (e?.release ?? 0) / 127 : 0;
    s[3] = e?.tiltX ?? 0; s[4] = e?.tiltY ?? 0;
    for (let i = 0; i < this.banks.length; ++i) {
      const values = this.banks[i].advance(settings[i], e, now);
      s[5 + i * 2] = values[0]; s[6 + i * 2] = values[1];
    }
    s[s.length - 2] = this.controller?.modulation ?? 0;
    s[s.length - 1] = this.controller?.expression ?? expressionDefault;
  }
  protected abstract sample(now: number): void;
  advance = (now: number) => {
    this.sample(now);
    // React may mount/unmount subscribers while publishing. A frame visits
    // only its starting subscribers, so additions cannot extend it forever.
    const listeners = [...this.listeners], frames = [...this.frames];
    for (const listener of listeners) if (this.listeners.has(listener)) listener();
    for (const paint of frames) if (this.frames.has(paint)) paint(now);
  };
}
