import type { MidiTransport } from "../../midi/types.ts";
import { decodePresetSyncFrame, encodeDefaultPresetSyncFrame, encodeU14, encodeU28 } from "../../protocol/index.ts";
import { fields, parseConfig, type LabConfig } from "./model.ts";

let nextTransaction = 6000;
export class CalibrationClient {
  readonly token = Math.floor(Math.random() * 0xffffffe) + 1;
  private pending = false;
  private stopped = false;
  private abort?: () => void;
  private closing?: Promise<void>;
  private idle?: () => void;
  constructor(private transport: MidiTransport) {}
  get busy() { return this.pending; }
  async open() {
    await this.closing; this.closing = undefined; this.stopped = false;
    await this.rpc(0);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      // Let a short in-flight reply drain before sending the release. This also
      // makes React's setup/cleanup/setup development cycle safe on real USB.
      if (this.pending) await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 100);
        this.idle = () => { clearTimeout(timer); resolve(); };
      });
      this.abort?.();
      try { await this.rpc(4); } catch { /* The board's five-second lease handles lost connections. */ }
      this.stopped = true;
    })();
    return this.closing;
  }
  async command(command: string) {
    if (!/^[\x20-\x7e]{1,191}$/.test(command)) throw Error("Invalid calibration operation.");
    return (await this.rpc(1, [...command].map(c => c.charCodeAt(0)))).split(/\r?\n/).filter(Boolean);
  }
  async config(): Promise<LabConfig> { return parseConfig(await this.command("capture config")); }
  async live(key: number) { return (await this.rpc(3, encodeU14(key))).split(/\r?\n/).filter(Boolean); }
  async capture(cursor: number) { return (await this.rpc(2, encodeU14(cursor))).split(/\r?\n/).filter(Boolean); }
  private rpc(operation: number, data: number[] = []): Promise<string> {
    if (this.stopped) return Promise.reject(Error("Calibration session has closed."));
    if (this.pending) return Promise.reject(Error("A calibration operation is still running."));
    this.pending = true;
    const transaction = nextTransaction++ % 16383 + 1;
    return new Promise((resolve, reject) => {
      let received = 0, expected = -1, text = "", finished = false;
      let unsubscribe = () => {};
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true; clearTimeout(timer); unsubscribe(); this.pending = false; this.abort = undefined;
        this.idle?.(); this.idle = undefined;
        if (error) reject(error); else resolve(text);
      };
      const timer = setTimeout(() => finish(Error("The board did not finish this operation. Reconnect Calibration to retry.")), 5000);
      this.abort = () => finish(Error("Calibration disconnected."));
      unsubscribe = this.transport.subscribe(bytes => {
        if (bytes[0] !== 0xf0 || bytes[1] !== 0x7d || bytes[2] !== 0x10) return;
        try {
          const frame = decodePresetSyncFrame(bytes);
          if (frame.transactionId !== transaction) return;
          if (frame.message === 7) { finish(Error("The board is busy. Stop Learn or a preview before calibrating.")); return; }
          if (frame.message !== 0x33) return;
          const p = frame.payload, offset = (p[2] << 7) | p[3], total = (p[4] << 7) | p[5];
          if (p.length < 6 || p.length > 134 || p[0] !== 1 || p[1] > 1 || total > 4096 ||
              offset !== received || (expected >= 0 && total !== expected) || offset + p.length - 6 > total)
            throw Error("Incomplete calibration response. Reconnect to retry.");
          expected = total; received += p.length - 6;
          text += String.fromCharCode(...p.slice(6));
          if (p[1]) {
            if (received !== total) throw Error("Incomplete calibration response.");
            const failure = text.split(/\r?\n/).find(line => /^(error,|tr,error,)/.test(line) || /(?:^|,)[^,=]*_failed(?:,|$)/.test(line));
            if (failure) throw Error(failure.replace(/^error,/, "").replaceAll("_", " "));
            finish();
          }
        } catch (error) { finish(error instanceof Error ? error : Error("Invalid calibration response.")); }
      });
      const frame = encodeDefaultPresetSyncFrame(0x32, transaction, [1, ...encodeU28(this.token), operation, ...data]);
      void this.transport.send(frame).catch(error => finish(error instanceof Error ? error : Error("Could not reach the board.")));
    });
  }
}
export function record(lines: string[], prefix: string) {
  return fields(lines.find(line => line.startsWith(prefix)) ?? "");
}
