import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MidiMessageListener, MidiTransport } from "../midi/types.ts";
import { decodeDelegatedKey, DelegatedSession } from "./delegatedSession.ts";
import { lessonLedColor } from "./lessonColors.ts";

class Transport implements MidiTransport {
  label = "Test board";
  listeners = new Set<MidiMessageListener>();
  sent: number[][] = [];
  send = vi.fn(async (bytes: ArrayLike<number>) => { this.sent.push(Array.from(bytes)); });
  subscribe(listener: MidiMessageListener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  emit(bytes: number[], receivedAt = 1234) { this.listeners.forEach((listener) => listener(Uint8Array.from(bytes), receivedAt)); }
  ack(state = 1, token = this.sent.find((bytes) => bytes[2] === 7)!.slice(4, 8)) { this.emit([0xf0, 0x7d, 9, 2, ...token, state, 0xf7]); }
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("acknowledged learning sessions", () => {
  it("ignores notes and foreign acknowledgements until entry succeeds", async () => {
    const transport = new Transport(), onKey = vi.fn(), stopped = vi.fn();
    const session = new DelegatedSession(transport, onKey, stopped);
    const start = session.start();
    transport.emit([0x90, 64, 127]);
    transport.ack(1, [0, 0, 0, 0]);
    expect(onKey).not.toHaveBeenCalled();
    transport.ack(); await start;
    transport.emit([0x91, 30, 127]); transport.emit([0x91, 30, 0]);
    expect(onKey.mock.calls).toEqual([[130, true, 1234], [130, false, 1234]]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.sent.map((bytes) => bytes[2])).toEqual([7]);
    transport.ack();
    session.stop();
    expect(transport.sent.at(-1)!.slice(3, 7)).toEqual(transport.sent[0].slice(4, 8));
    expect(transport.listeners.size).toBe(0);
  });
  it("does not take over old firmware and releases a lost acknowledgement", async () => {
    const transport = new Transport(), stopped = vi.fn();
    const session = new DelegatedSession(transport, vi.fn(), stopped);
    const start = session.start();
    const result = expect(start).rejects.toThrow("Install the current firmware");
    await vi.advanceTimersByTimeAsync(3000); await result;
    expect(transport.sent.map((bytes) => bytes[2])).toEqual([7, 10]);
    expect(stopped).toHaveBeenCalledOnce();
    expect(transport.listeners.size).toBe(0);
  });
  it("stays active without heartbeat traffic until manual exit, then reconnects", async () => {
    const transport = new Transport(), stopped = vi.fn(), onKey = vi.fn();
    const session = new DelegatedSession(transport, onKey, stopped);
    const start = session.start(); transport.ack(); await start;
    await vi.advanceTimersByTimeAsync(60000);
    expect(transport.sent.map((bytes) => bytes[2])).toEqual([7]);
    expect(stopped).not.toHaveBeenCalled();
    const oldToken = transport.sent[0].slice(4, 8);
    transport.ack(0);
    expect(stopped).toHaveBeenCalledOnce();
    const next = new DelegatedSession(transport, onKey, stopped);
    const ready = next.start();
    const token = transport.sent.at(-1)!.slice(4, 8);
    transport.ack(1, token); await ready;
    transport.ack(0, oldToken);
    transport.emit([0x90, 60, 127], 6789);
    expect(onKey).toHaveBeenLastCalledWith(60, true, 6789);
    expect(stopped).toHaveBeenCalledOnce();
    next.stop();
  });
  it("does not accept the retired heartbeat protocol", async () => {
    const transport = new Transport();
    const session = new DelegatedSession(transport, vi.fn(), vi.fn());
    const result = expect(session.start()).rejects.toThrow("Install the current firmware");
    transport.emit([0xf0, 0x7d, 9, 1, ...transport.sent[0].slice(4, 8), 1, 0xf7]);
    await vi.advanceTimersByTimeAsync(2500); await result;
  });
  it("handles busy and manual device exits", async () => {
    const transport = new Transport(), stopped = vi.fn();
    const session = new DelegatedSession(transport, vi.fn(), stopped);
    const start = session.start(); transport.ack(2);
    await expect(start).rejects.toThrow("Release all keys");
    const next = new DelegatedSession(transport, vi.fn(), stopped);
    const ready = next.start();
    const token = transport.sent.filter((bytes) => bytes[2] === 7).at(-1)!.slice(4, 8);
    transport.ack(1, token); await ready;
    transport.ack(0, token);
    expect(stopped).toHaveBeenLastCalledWith(expect.stringContaining("ended the learning session"));
  });
  it("batches LED updates and stops on a failed write", async () => {
    const transport = new Transport(), stopped = vi.fn();
    const session = new DelegatedSession(transport, vi.fn(), stopped);
    const start = session.start(); transport.ack(); await start;
    session.setLights(Array(140).fill(lessonLedColor(60, "rest")));
    await vi.advanceTimersByTimeAsync(100);
    const frames = transport.sent.filter((bytes) => bytes[2] === 3);
    expect(frames).toHaveLength(9);
    expect(frames.every((bytes) => bytes.length <= 84)).toBe(true);
    transport.send.mockRejectedValueOnce(new Error("Disconnected"));
    session.setLights(Array(140).fill(lessonLedColor(60, "target")));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toHaveBeenCalledWith(expect.stringContaining("lights"));
  });
  it("rejects internal matrix slots and non-key MIDI", () => {
    for (const bytes of [[0x91, 40, 127], [0x90, 100, 127], [0x92, 0, 127], [0xb0, 64, 127], [0x90, 64]]) {
      expect(decodeDelegatedKey(Uint8Array.from(bytes))).toBeNull();
    }
    expect(decodeDelegatedKey(Uint8Array.from([0x81, 39, 0]))).toEqual({ index: 139, pressed: false });
  });
  it("sends layout orientation only after ACK and scopes it to the current session", async () => {
    const transport = new Transport();
    const session = new DelegatedSession(transport, vi.fn(), vi.fn());
    const ready = session.start();
    session.setDisplayRotation(1);
    expect(transport.sent).toHaveLength(1);
    transport.ack(); await ready;
    for (const rotation of [0, 1, 2, 3]) session.setDisplayRotation(rotation);
    const rotations = transport.sent.filter((bytes) => bytes[2] === 11);
    expect(rotations.map((bytes) => bytes[7])).toEqual([0, 1, 2, 3]);
    expect(rotations.every((bytes) => bytes.slice(3, 7).join() === transport.sent[0].slice(4, 8).join())).toBe(true);
    session.stop();
    session.setDisplayRotation(1);
    expect(transport.sent.filter((bytes) => bytes[2] === 11)).toHaveLength(4);
  });
  it("paces initial lights, coalesces color changes, and cancels pending batches on stop", async () => {
    const transport = new Transport();
    const session = new DelegatedSession(transport, vi.fn(), vi.fn());
    const ready = session.start(); transport.ack(); await ready;
    session.setLights(Array.from({ length: 140 }, (_, index) => lessonLedColor(60 + index % 12, "rest")));
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.sent.filter((bytes) => bytes[2] === 3)).toHaveLength(1);
    session.setLights(Array.from({ length: 140 }, (_, index) => lessonLedColor(60 + index % 12, "target")));
    await vi.advanceTimersByTimeAsync(10);
    const frames = transport.sent.filter((bytes) => bytes[2] === 3);
    expect(frames).toHaveLength(2);
    expect(frames[1].slice(3, 8)).toEqual([0, 0, 0, 127, 127]);
    session.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(transport.sent.filter((bytes) => bytes[2] === 3)).toHaveLength(2);
  });
});
