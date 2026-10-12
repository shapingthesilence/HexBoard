import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SynthContext } from "./SynthContext.tsx";
import { MockMidiTransport } from "../midi/mockTransport.ts";
import { CapabilityFlag, type HelloResponsePayload } from "../protocol/index.ts";
import type { MidiTransport } from "../midi/types.ts";
const advanced = { hardwareVersion: 0x20, capabilityFlags: CapabilityFlag.AdvancedPhysicalSynth } as HelloResponsePayload;
const connected: MidiTransport = { label: "Connected main", send: async () => {}, subscribe: () => () => {} };
describe("unreleased Advanced synth visibility", () => {
  it("keeps offline and original-board editing free of Advanced options", () => {
    for (const hello of [null, { ...advanced, hardwareVersion: 2 }]) {
      const html = renderToStaticMarkup(createElement(SynthContext, { transport: connected, hello }));
      expect(html).not.toContain("Advanced");
      expect(html).not.toContain("Physical string editor");
      expect(html).toContain("Synth Library");
    }
  });
  it("requires a real transport even when a mock has Advanced identity", () => {
    const html = renderToStaticMarkup(createElement(SynthContext, { transport: new MockMidiTransport(), hello: advanced }));
    expect(html).not.toContain("Physical string editor");
    expect(html).not.toContain("Advanced");
  });
  it("shows the editor for an identified connected Advanced", () => {
    expect(renderToStaticMarkup(createElement(SynthContext, { transport: connected, hello: advanced }))).toContain("Physical string editor");
  });
});
