import { describe, expect, it, vi } from "vitest";
import { subscribeControllerInput } from "./controllerInput.ts";
import { WebMidiTransport } from "./webMidi.ts";
import type { WebMidiInput, WebMidiMessageEvent } from "./types.ts";

function port() {
  const listeners = new Set<(event: WebMidiMessageEvent) => void>();
  const close = vi.fn();
  const input: WebMidiInput & { close: typeof close } = {
    id: "controller", type: "input", onmidimessage: null, close,
    addEventListener: (_, listener) => { listeners.add(listener); },
    removeEventListener: (_, listener) => { listeners.delete(listener); },
    open: vi.fn(async () => input)
  };
  const emit = (data: number[]) => {
    const event = { data: Uint8Array.from(data), timeStamp: 1234 };
    input.onmidimessage?.(event);
    for (const listener of listeners) listener(event);
  };
  return { input, emit, listeners };
}

describe("controller input ownership", () => {
  it("shares a HexBoard port with sync and removes only its own listener", () => {
    const { input, emit, listeners } = port();
    const transport = new WebMidiTransport({ id: "out", type: "output", send: vi.fn() }, input);
    const sync = vi.fn(), preview = vi.fn(), error = vi.fn();
    const unsubscribeSync = transport.subscribe(sync);
    const syncHandler = input.onmidimessage;
    const unsubscribe = subscribeControllerInput(input, preview, error);
    emit([0x90, 60, 127]);
    expect(preview).toHaveBeenCalledWith(Uint8Array.from([0x90, 60, 127]), 1234);
    expect(sync).toHaveBeenCalledOnce();
    expect(input.open).toHaveBeenCalledOnce();
    unsubscribe();
    emit([0xf0, 1, 0xf7]);
    expect(preview).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(input.onmidimessage).toBe(syncHandler);
    expect(input.close).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    expect(error).not.toHaveBeenCalled();
    unsubscribeSync();
  });

  it("ignores a port-open failure after switching inputs or closing the editor", async () => {
    const { input } = port();
    let reject!: (reason: Error) => void;
    input.open = () => new Promise((_, no) => { reject = no; });
    const error = vi.fn();
    const unsubscribe = subscribeControllerInput(input, vi.fn(), error);
    unsubscribe();
    reject(new Error("Disconnected"));
    await Promise.resolve();
    expect(error).not.toHaveBeenCalled();
  });

  it("reports input-open failures while subscribed", async () => {
    const { input, listeners } = port();
    input.open = async () => { throw new Error("Port unavailable"); };
    const error = vi.fn();
    const unsubscribe = subscribeControllerInput(input, vi.fn(), error);
    await Promise.resolve();
    expect(error).toHaveBeenCalledWith(new Error("Port unavailable"));
    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});
