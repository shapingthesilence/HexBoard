import { describe, expect, it } from "vitest";
import { CalibrationClient } from "./client.ts";
import { decodePresetSyncFrame, encodeDefaultPresetSyncFrame, encodeU14 } from "../../protocol/index.ts";
import type { MidiMessageListener, MidiTransport } from "../../midi/types.ts";
import { defaultConfig, parseConfig, respacePoints, validPoints } from "./model.ts";
import { CaptureParser } from "./protocol.mjs";

class Board implements MidiTransport {
  label = "test";
  listeners = new Set<MidiMessageListener>();
  requests: number[][] = [];
  reply: string | null = "lab,ready\n";
  scramble = false;
  subscribe(fn: MidiMessageListener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  async send(bytes: ArrayLike<number>) {
    const request = decodePresetSyncFrame(bytes); this.requests.push(request.payload);
    if (this.reply === null) return;
    for (let offset = 0; offset < this.reply.length; offset += 128) {
      const data = [...this.reply.slice(offset, offset + 128)].map(c => c.charCodeAt(0));
      const frame = encodeDefaultPresetSyncFrame(0x33, request.transactionId, [1, offset + data.length === this.reply.length ? 1 : 0,
        ...encodeU14(this.scramble ? offset + 1 : offset), ...encodeU14(this.reply.length), ...data]);
      this.listeners.forEach(fn => fn(Uint8Array.from(frame)));
    }
  }
}
describe("Calibration SysEx client", () => {
  it("uses token ownership and assembles bounded ordered replies without Serial", async () => {
    const board = new Board(), client = new CalibrationClient(board); await client.open();
    board.reply = "tr,c,7864,45874,3277\n" + "x".repeat(800);
    expect((await client.command("capture config")).join("\n")).toBe(board.reply.trim());
    expect(board.requests[0][5]).toBe(0);
    expect(board.requests[1][5]).toBe(1);
    expect(board.requests[0].slice(1, 5)).toEqual(board.requests[1].slice(1, 5));
    expect(board.listeners.size).toBe(0);
    board.reply = "lab,closed\n"; await client.close();
    expect(board.requests.at(-1)![5]).toBe(4);
    await expect(client.live(61)).rejects.toThrow("closed");
  });
  it("reopens after cleanup without losing the current session or leaking listeners", async () => {
    const board = new Board(), client = new CalibrationClient(board);
    const initial = client.open().catch(() => {});
    const closing = client.close();
    const reopened = client.open();
    await Promise.all([initial, closing, reopened]);
    await expect(client.live(61)).resolves.toEqual(["lab,ready"]);
    expect(board.requests.at(-2)![5]).toBe(0);
    expect(board.listeners.size).toBe(0);
    await client.close();
  });
  it("rejects reordered chunks and board failures instead of accepting partial settings", async () => {
    const board = new Board(), client = new CalibrationClient(board); board.scramble = true;
    await expect(client.open()).rejects.toThrow("Incomplete");
    board.scramble = false; board.reply = "error,release_keys_first\n";
    await expect(client.command("velocity thresholds 1 2 0")).rejects.toThrow("release keys first");
    await expect(client.command("cal start\nbootloader")).rejects.toThrow("Invalid");
    expect(board.listeners.size).toBe(0);
  });
  it("allows only one request and cancels an outstanding operation on close", async () => {
    const board = new Board(), client = new CalibrationClient(board); board.reply = null;
    const pending = client.live(61);
    await expect(client.command("cal status")).rejects.toThrow("still running");
    board.reply = "lab,closed\n";
    const rejected = expect(pending).rejects.toThrow("disconnected");
    await client.close(); await rejected; expect(board.listeners.size).toBe(0);
  });
});
const configLines = () => {
  const c = defaultConfig();
  return ["tr,c,7864,45874,3277", "tr,p,1800,40000,2,0,1,127,4", "tr,cap,curve_xy,engines,pressure_watch,pressure_ends,pressure_curve",
    `tr,engine,${c.engine.join(",")}`, `tr,pressure,${c.pressure.join(",")}`, `tr,pressure_curve,${c.pressureCurve.join(",")}`,
    ...["on", "off"].flatMap(kind => [`tr,curve,${kind},4`, ...[40000, 27000, 14000, 1800].map((us, i) => `tr,xy,${kind},${i},${us},${1 + i * 42}`)]), "tr,config_end"];
};
describe("Calibration records and curves", () => {
  it("preserves complete model, thresholds, both curves and pressure endpoints", () => {
    const c = parseConfig(configLines()); expect(c.curves.on).toHaveLength(4); expect(c.curves.off).toEqual(c.curves.on);
    expect(c.engine).toHaveLength(12); expect(c.pressure).toHaveLength(4);
    expect(validPoints(respacePoints(c.curves.on, 8))).toBe(true);
    expect(() => parseConfig(configLines().slice(0, -1))).toThrow("incomplete");
    expect(() => parseConfig(configLines().filter(line => !line.startsWith("tr,xy,on,2")))).toThrow("invalid velocity curve");
  });
  it("validates capture continuity across SysEx pages and rejects missing samples", () => {
    const parser = new CaptureParser();
    for (const line of ["tr,b,1,2,1,0,0", "tr,t,7864,45874,3277", "tr,k,0,61,2000,1,1", "tr,s,0,0,4294967295,4294967200,2000", "tr,s,1,0,0,797,2100"]) parser.feed(line);
    const capture = parser.feed("tr,e,2")!;
    expect(capture.gaps).toBe(0); expect(capture.channels[0].points[1].time).toBe(.893);
    parser.feed("tr,b,1,2,1,0,0"); parser.feed("tr,t,1,2,0"); parser.feed("tr,k,0,61,2000,1,1");
    expect(() => parser.feed("tr,s,1,0,2,2000,2100")).toThrow("Missing or reordered");
  });
});
