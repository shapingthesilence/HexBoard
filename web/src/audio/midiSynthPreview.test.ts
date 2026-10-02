import { describe, expect, it, vi } from "vitest";
import { MidiSynthPreview } from "./midiSynthPreview.ts";

function host(range = 2) {
  const sink = { noteOn: vi.fn(), noteOff: vi.fn(), setPitch: vi.fn(), setMod: vi.fn() };
  const midi = new MidiSynthPreview(sink, range);
  const send = (...bytes: number[]) => midi.receive(Uint8Array.from(bytes));
  return { midi, sink, send };
}

describe("MIDI synth audition", () => {
  it("keeps same-note voices on separate channels and honors velocity-zero note off", () => {
    const { send, sink } = host();
    send(0x90, 60, 127);
    send(0x91, 60, 64);
    expect(sink.noteOn.mock.calls).toEqual([[60, 1, "midi:0:60", 0], [60, 64 / 127, "midi:1:60", 0]]);
    send(0x90, 60, 0);
    expect(sink.noteOff).toHaveBeenCalledExactlyOnceWith("midi:0:60");
    send(0x81, 60, 0);
    expect(sink.noteOff).toHaveBeenLastCalledWith("midi:1:60");
  });

  it("applies HexBoard's pre-note bend and live per-channel retuning", () => {
    const { send, sink, midi } = host(48);
    send(0xe1, 0, 65); // +128 / 8192 = +0.75 semitone at ±48
    send(0x91, 60, 127);
    send(0x92, 60, 127);
    expect(sink.noteOn.mock.calls[0][3]).toBe(0.75);
    expect(sink.noteOn.mock.calls[1][3]).toBe(0);
    send(0xe1, 0, 63);
    expect(sink.setPitch).toHaveBeenLastCalledWith("midi:1:60", -0.75);
    midi.setBendRange(12);
    expect(sink.setPitch).toHaveBeenCalledWith("midi:1:60", -0.1875);
  });

  it("uses RPN bend sensitivity per channel, including cents and null/NRPN selection", () => {
    const { send, sink } = host();
    send(0xb1, 101, 0);
    send(0xb1, 100, 0);
    send(0xb1, 6, 12);
    send(0xb1, 38, 50);
    send(0xe1, 0, 96); // half of range
    send(0x91, 69, 127);
    expect(sink.noteOn).toHaveBeenLastCalledWith(69, 1, "midi:1:69", 6.25);
    send(0xb1, 101, 127);
    send(0xb1, 100, 127);
    send(0xb1, 6, 48);
    send(0xe1, 0, 32);
    expect(sink.setPitch).toHaveBeenLastCalledWith("midi:1:69", -6.25);
    send(0xb1, 101, 0);
    send(0xb1, 100, 0);
    send(0xb1, 99, 1);
    send(0xb1, 6, 48);
    send(0xe1, 0, 96);
    expect(sink.setPitch).toHaveBeenLastCalledWith("midi:1:69", 6.25);
  });

  it("sustains released notes per channel and preserves physically held notes", () => {
    const { send, sink } = host();
    send(0x90, 60, 127);
    send(0x90, 64, 127);
    send(0x91, 60, 127);
    send(0xb0, 64, 127);
    send(0x80, 60, 0);
    expect(sink.noteOff).not.toHaveBeenCalled();
    send(0x81, 60, 0);
    expect(sink.noteOff).toHaveBeenLastCalledWith("midi:1:60");
    send(0xb0, 64, 0);
    expect(sink.noteOff).toHaveBeenLastCalledWith("midi:0:60");
    expect(sink.noteOff).not.toHaveBeenCalledWith("midi:0:64");
  });

  it("handles retrigger, modulation, panic, and reset controllers", () => {
    const { send, sink } = host();
    send(0x90, 60, 127);
    send(0x90, 60, 32);
    expect(sink.noteOff).toHaveBeenCalledWith("midi:0:60", true);
    send(0xb0, 1, 100);
    expect(sink.setMod).toHaveBeenLastCalledWith(100);
    send(0xb0, 64, 127);
    send(0xb0, 123, 0);
    expect(sink.noteOff).toHaveBeenCalledTimes(1); // All Notes Off obeys sustain.
    send(0xb0, 121, 0);
    expect(sink.noteOff).toHaveBeenLastCalledWith("midi:0:60");
    expect(sink.setMod).toHaveBeenLastCalledWith(0);
    send(0xb0, 120, 0); // All Sound Off also kills release tails.
    expect(sink.noteOff).toHaveBeenLastCalledWith("midi:0:60", true);
  });

  it("clears sustained/held notes and tails on stop, then accepts a fresh attack", () => {
    const { send, sink, midi } = host();
    send(0x90, 60, 127);
    send(0x80, 60, 0);
    send(0x91, 64, 127);
    midi.stop();
    expect(sink.noteOff.mock.calls.slice(-2)).toEqual([["midi:0:60", true], ["midi:1:64", true]]);
    send(0x81, 64, 0);
    expect(sink.noteOff).toHaveBeenCalledTimes(3);
    send(0x91, 64, 127);
    expect(sink.noteOn).toHaveBeenCalledTimes(3);
  });

  it("ignores SysEx, realtime, malformed messages, and unrelated channel messages", () => {
    const { send, sink } = host();
    send(0xf0, 1, 0xf7);
    send(0xf8);
    send(0x90, 60);
    send(0x90, 200, 127);
    send(60, 127, 0);
    send(0xc0, 1);
    send(0xa0, 60, 100);
    for (const callback of Object.values(sink)) expect(callback).not.toHaveBeenCalled();
  });
});
