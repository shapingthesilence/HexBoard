import {modulationRate,modulationSeconds} from './schema.ts';
import {lfoWave} from './ModSourceEditor.tsx';
import type {PhysicalExpression} from './client.ts';
// Last-key visualization only; the instrument generates independent sources.
export function envelopePreview(settings:number[],age:number){
  const [a,d,s,,delay,hold]=settings;let t=age-modulationSeconds(delay);if(t<0)return 0;
  const attack=modulationSeconds(a),decay=modulationSeconds(d),held=modulationSeconds(hold);
  const curve=2*settings[6]/65535-1;
  const shape=(x:number)=>curve>=0?x+curve*(x*x-x):x-curve*((1-(1-x)*(1-x))-x);
  if(settings[7] && t>=attack+held+decay && attack+held+decay>0){const period=attack+held+decay;t%=period;}
  if(t<attack)return shape(t/attack);t-=attack;if(t<held)return 1;t-=held;
  return t<decay?1+(s/65535-1)*shape(t/decay):s/65535;
}

/** Fixed-size visual state. Smoothing keeps its 50 ms response at any frame rate. */
export class SourcePreview {
  readonly values: [number, number] = [0, 0];
  private started: number;
  private off = 0;
  private releaseFrom = 0;
  private held = false;
  private key: number | null = null;
  private last: number;
  constructor(private origin: number) { this.started = this.last = origin; }
  advance(s: number[], e: PhysicalExpression | undefined, now: number) {
    const held = !!e?.held;
    if (held && (!this.held || e!.key !== this.key)) { this.started = now; this.off = 0; }
    if (!held && this.held) { this.off = now; this.releaseFrom = this.values[0]; }
    this.held = held; this.key = e?.key ?? null;
    const age = (now - this.started) / 1000;
    this.values[0] = held ? envelopePreview(s, age) : this.off ? this.releaseFrom * Math.max(0, 1 - (now - this.off) / 1000 / Math.max(.001, modulationSeconds(s[3]))) : 0;
    const phase = (now - (s[10] ? this.started : this.origin)) / 1000 * modulationRate(s[8]) + s[11] / 65535;
    const wave = lfoWave(Math.round(s[9] / 13107), phase), delay = modulationSeconds(s[12]), fade = modulationSeconds(s[13]);
    const amount = age < delay ? 0 : fade > 0 ? Math.min(1, (age - delay) / fade) : 1;
    const target = (s[14] ? (wave + 1) / 2 : wave) * amount, smoothing = .5 * s[15] / 65535;
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.values[1] += (target - this.values[1]) * (smoothing ? 1 - (smoothing / (.05 + smoothing)) ** (elapsed / .05) : 1);
    this.last = now;
    return this.values;
  }
}
