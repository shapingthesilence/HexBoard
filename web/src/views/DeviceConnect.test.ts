import { describe, expect, it, vi } from "vitest";
import { discoverHexBoards } from "./DeviceConnect.tsx";
import { decodePresetSyncFrame, encodeDefaultPresetSyncFrame, MessageType } from "../protocol/index.ts";
import type { WebMidiAccess, WebMidiInput, WebMidiOutput } from "../midi/types.ts";

function board(id: string, schema = 7, advanced = false) {
  const input: WebMidiInput = { id: `${id}-in`, name: id, type: "input", state: "connected", onmidimessage: null };
  const output: WebMidiOutput = {
    id: `${id}-out`, name: id, type: "output", state: "connected",
    send: vi.fn(data => {
      const frame = decodePresetSyncFrame(data);
      if (frame.message === MessageType.HelloRequest) input.onmidimessage?.({ data: Uint8Array.from(encodeDefaultPresetSyncFrame(MessageType.HelloResponse, frame.transactionId,
        [1,0,1,0,...(advanced ? [0,8,0x40,0x7c] : [0,0,0x3e,0x7e]),0,4,8,0,19,schema,9,1,0,64,64,64,64,advanced ? 0x20 : 2])) });
    })
  };
  return { input, output };
}
function access(...boards: ReturnType<typeof board>[]): WebMidiAccess {
  return { inputs: new Map(boards.map(item => [item.input.id, item.input])), outputs: new Map(boards.map(item => [item.output.id, item.output])) };
}

describe("HexBoard reconnection discovery", () => {
  it("discovers Advanced with truthful preview capabilities and no synth schema", async () => {
    expect((await discoverHexBoards(access(board("HexBoard Advanced", 0, true)))).map(device => device.label)).toEqual(["HexBoard Advanced"]);
  });
  it("skips stale disconnected ports and discovers newly plugged-in endpoints", async () => {
    const old = board("HexBoard old"), next = board("HexBoard replacement");
    old.input.state = old.output.state = "disconnected";
    const midi = access(old, next);
    expect((await discoverHexBoards(midi)).map(device => device.key)).toEqual(["HexBoard replacement-out::HexBoard replacement-in"]);
    expect(old.output.send).not.toHaveBeenCalled();
    next.input.state = next.output.state = "disconnected";
    expect(await discoverHexBoards(midi)).toEqual([]);
    next.input.state = next.output.state = "connected";
    expect((await discoverHexBoards(midi)).map(device => device.key)).toEqual(["HexBoard replacement-out::HexBoard replacement-in"]);
  });
  it("continues discovery when an earlier port cannot open", async () => {
    const stale = board("HexBoard stale"), next = board("HexBoard working");
    stale.output.open = vi.fn(async () => { throw Error("Port disappeared"); });
    expect((await discoverHexBoards(access(stale, next))).map(device => device.label)).toEqual(["HexBoard working"]);
  });
  it("rejects incompatible devices without hiding another compatible board", async () => {
    const old = board("HexBoard old", 2), next = board("HexBoard current");
    expect((await discoverHexBoards(access(old, next))).map(device => device.label)).toEqual(["HexBoard current"]);
  });
});
