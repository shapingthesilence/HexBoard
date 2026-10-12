import type { MidiTransport } from "../../midi/types.ts";
import { decodePresetSyncFrame, encodeDefaultPresetSyncFrame, encodeU14, encodeU21, decodeU14, decodeU21 } from "../../protocol/index.ts";
import { physicalPresetFromUnknown, defaultFx, validateFx, type FxRack, type PhysicalPreset, type PhysicalVelocityEngine, encodeLogPitchHz } from "./schema.ts";

export interface PhysicalState { state: "stopped" | "playing" | "loading"; instrument: number; bend: number; preset: PhysicalPreset }
export function decodePhysicalState(payload: number[]): PhysicalState {
  if (payload.length !== 379 || payload[0] !== 13 || payload[1] > 2 || payload[2] > 3)
    throw Error("Unsupported physical synth response. Update Advanced main firmware for preset velocity engines.");
  const bend = (decodeU21(payload.slice(3, 6)) - 131072) / 65536;
  if (bend < -2 || bend > 2) throw Error("Invalid pitch bend state.");
  const parameters = Array.from({ length: 31 }, (_, i) => decodeU21(payload.slice(6 + i * 3, 9 + i * 3)));
  const routes = Array.from({ length: 93 }, (_, i) => decodeU21(payload.slice(99 + i * 3, 102 + i * 3)) - 65536);
  return { state: (["stopped", "playing", "loading"] as const)[payload[1]], instrument: payload[2], bend,
    preset: physicalPresetFromUnknown({ format: "hexboard.physical.v17",effects:defaultFx(),tiltRoutes:Array(62).fill(0), name: "Device RAM", parameters, routes, velocityEngine: payload[378] }) };
}
export interface MotionState {detected:boolean;valid:boolean;tiltX:number;tiltY:number;tiltRoutes:number[]}
export function decodeMotion(p:number[]):MotionState {if(p.length!==195||p[0]!==13||p[1]>1||p[2]>1)throw Error("Unsupported motion response. Update Advanced firmware.");const x=decodeU21(p.slice(3,6)),y=decodeU21(p.slice(6,9)),routes=Array.from({length:62},(_,i)=>decodeU21(p.slice(9+i*3,12+i*3))-65536);if(x>65534||y>65534||routes.some(v=>v<-65536||v>65536)||[7,8,21,27,28,30].some(id=>routes.slice(id*2,id*2+2).some(Boolean)))throw Error("Invalid motion state.");return {detected:!!p[1],valid:!!p[2],tiltX:(x-32767)/32767,tiltY:(y-32767)/32767,tiltRoutes:routes};}
export interface PhysicalExpression { tiltX?:number;tiltY?:number;motionValid?:boolean;motionDetected?:boolean; key: number | null; held: boolean; velocity: number; pressure: number; release: number }
export function decodePhysicalExpression(p: number[]): PhysicalExpression {
  const key = decodeU14(p.slice(1, 3)), pressure = decodeU21(p.slice(5, 8));
  if (p.length !== 9 || p[0] !== 13 || (key > 132 && key !== 16383) || p[3] > 1 || p[4] > 127 || p[8] > 127 || pressure > 65535)
    throw Error("Invalid expression response.");
  return { key: key === 16383 ? null : key, held: Boolean(p[3]), velocity: p[4], pressure, release: p[8] };
}
export function decodeFx(payload:number[]): FxRack {
  if(payload.length!==66||payload[0]!==13)throw Error("Unsupported FX response. Update Advanced firmware.");
  const padded=payload.slice(1,6), end=padded.indexOf(0);
  if(end>=0 && padded.slice(end).some(id=>id!==0))throw Error("Invalid effect order.");
  return validateFx({order:padded.filter(Boolean),values:Array.from({length:5},(_,i)=>Array.from({length:4},(_,j)=>decodeU21(payload.slice(6+(i*4+j)*3,9+(i*4+j)*3))))});
}
let nextTransaction = 1000;
export class PhysicalSynthClient {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private fx = defaultFx();
  private motion:MotionState={detected:false,valid:false,tiltX:0,tiltY:0,tiltRoutes:Array(62).fill(0)};
  private abort?: () => void;
  constructor(private transport: MidiTransport) {}
  close() { this.closed = true; this.abort?.(); }
  async read() { const state=await this.request(0);this.fx=await this.request<FxRack>(10);this.motion=await this.request<MotionState>(12);return {...state,preset:{...state.preset,effects:this.fx,tiltRoutes:this.motion.tiltRoutes}}; }
  async effects(fx:FxRack) { const f=validateFx(fx);await this.request<FxRack>(11,[...f.order,...Array(5-f.order.length).fill(0),...f.values.flat().flatMap(encodeU21)]);return this.request(0); }
  async expression() {const e=await this.request<PhysicalExpression>(8);this.motion=await this.request<MotionState>(12);return {...e,tiltX:this.motion.tiltX,tiltY:this.motion.tiltY,motionValid:this.motion.valid,motionDetected:this.motion.detected};}
  async zeroMotion(){this.motion=await this.request<MotionState>(15);return this.motion;}
  async tiltRoute(id:number,axis:number,depth:number){this.motion=await this.request<MotionState>(14,[id,axis,...encodeU21(depth+65536)]);return this.request(0);}
  start(instrument = 2) { return this.request(1, [instrument]); }
  stop() { return this.request(2); }
  parameter(id: number, value: number) { return this.request(3, [id, ...encodeU21(value)]); }
  route(id: number, source: number, depth: number) { return this.request(4, [id, source, ...encodeU21(depth + 65536)]); }
  bend(semitones: number) { return this.request(5, encodeU21(Math.round(semitones * 65536) + 131072)); }
  retuneHz(key: number, tone: number, hz: number) { return this.request(6, [...encodeU14(key), tone, ...encodeLogPitchHz(hz)]); }
  velocityEngine(kind: PhysicalVelocityEngine) { return this.request(9, [kind]); }
  async apply(preset: PhysicalPreset) {
    const p = physicalPresetFromUnknown(preset);
    await this.request(7, [...p.parameters.flatMap(encodeU21), ...p.routes.flatMap(v => encodeU21(v + 65536)), p.velocityEngine]);
    for(let attempt=0;;++attempt){try{this.motion=await this.request<MotionState>(13,p.tiltRoutes.flatMap(v=>encodeU21(v+65536)));break;}catch(error){if(attempt>=20 || !(error instanceof Error) || error.message!=="The board rejected this synth operation.")throw error;await new Promise(resolve=>setTimeout(resolve,30));}}
    // The model batch may still be draining through SPI. Retry rack backpressure.
    for(let attempt=0;;++attempt){try{return await this.effects(p.effects);}catch(error){if(attempt>=12 || !(error instanceof Error) || error.message!=="The board rejected this synth operation.")throw error;await new Promise(resolve=>setTimeout(resolve,30));}}
  }
  private request<T = PhysicalState>(operation: number, data: number[] = []): Promise<T> {
    const run = this.tail.catch(() => undefined).then(() => this.rpc<T>(operation, data));
    this.tail = run; return run;
  }
  private rpc<T>(operation: number, data: number[]): Promise<T> {
    if (this.closed) return Promise.reject(Error("Physical synth disconnected."));
    const transaction = nextTransaction++ % 16383 + 1;
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {}; let done = false;
      const finish = (error?: Error, state?: T) => {
        if (done) return;
        done = true; clearTimeout(timer); unsubscribe(); this.abort = undefined;
        if (error) reject(error); else resolve(state!);
      };
      const timer = setTimeout(() => finish(Error("The board did not reply. Reconnect to retry.")), 5000);
      this.abort = () => finish(Error("Physical synth disconnected."));
      unsubscribe = this.transport.subscribe(bytes => {
        if (bytes[0] !== 0xf0 || bytes[1] !== 0x7d || bytes[2] !== 0x10) return;
        try {
          const frame = decodePresetSyncFrame(bytes);
          if (frame.transactionId !== transaction) return;
          if (frame.message === 7) {
            finish(Error(frame.payload[1] === 3 ? "Update Advanced main firmware for preset velocity engines." : frame.payload[1] === 8 ? "Stop Learn or Calibration and release keys before changing the velocity engine or loading a sound." : "The board rejected this synth operation."));
          } else if (frame.message === (operation === 8 ? 0x36 : operation>=12 ? 0x38 : operation>=10 ? 0x37 : 0x35)) { if(operation>=12){this.motion=decodeMotion(frame.payload);finish(undefined,this.motion as T);}else if(operation>=10){this.fx=decodeFx(frame.payload);finish(undefined,this.fx as T);}else if(operation===8)finish(undefined,decodePhysicalExpression(frame.payload) as T);else {const state=decodePhysicalState(frame.payload);finish(undefined,{...state,preset:{...state.preset,effects:this.fx,tiltRoutes:this.motion.tiltRoutes}} as T);} }
        } catch (error) { finish(error instanceof Error ? error : Error("Invalid synth response.")); }
      });
      void this.transport.send(encodeDefaultPresetSyncFrame(0x34, transaction, [13, operation, ...data]))
        .catch(error => finish(error instanceof Error ? error : Error("Could not reach the board.")));
    });
  }
}
