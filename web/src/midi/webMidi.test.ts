import { expect, it, vi } from "vitest";
import { WebMidiTransport } from "./webMidi.ts";
import type { WebMidiInput, WebMidiOutput } from "./types.ts";

it("preserves MIDI receive timestamps even when dispatch is delayed", () => {
  const input: WebMidiInput = { id: "in", type: "input", onmidimessage: null };
  const output: WebMidiOutput = { id: "out", type: "output", send: vi.fn() };
  const transport = new WebMidiTransport(output, input), listener = vi.fn();
  const unsubscribe = transport.subscribe(listener);
  const data = Uint8Array.from([0x90, 60, 127]);
  input.onmidimessage?.({ data, timeStamp: 1250 });
  expect(listener).toHaveBeenCalledWith(data, 1250);
  unsubscribe();
  input.onmidimessage?.({ data, timeStamp: 1300 });
  expect(listener).toHaveBeenCalledOnce();
});
