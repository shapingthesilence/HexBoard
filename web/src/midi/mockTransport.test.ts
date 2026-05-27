import { describe, expect, it } from "vitest";
import { MockMidiTransport } from "./mockTransport.ts";

describe("MockMidiTransport", () => {
  it("records sent messages and emits incoming messages", async () => {
    const transport = new MockMidiTransport();
    const incoming: number[][] = [];
    transport.subscribe((bytes) => incoming.push(Array.from(bytes)));

    await transport.send([0xf0, 0x7d, 0xf7]);
    transport.emit([0x90, 0x40, 0x7f]);

    expect(transport.sentMessages.map((message) => Array.from(message))).toEqual([[0xf0, 0x7d, 0xf7]]);
    expect(incoming).toEqual([[0x90, 0x40, 0x7f]]);
  });
});

