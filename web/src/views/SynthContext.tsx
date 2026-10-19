import { useMemo } from "react";
import { SynthPresetLibrary } from "./SynthPresetLibrary.tsx";
import { boardForHello, canEditConnectedSynth, hasAdvancedDevice } from "../midi/boardContext.ts";
import { MockMidiTransport } from "../midi/mockTransport.ts";
import type { MidiTransport } from "../midi/types.ts";
import { initialPreset } from "../advanced/synth/schema.ts";
import { AdvancedSynthEditor } from "../advanced/synth/AdvancedSynthEditor.tsx";
import { CapabilityFlag } from "../protocol/index.ts";
import type { HelloResponsePayload } from "../protocol/index.ts";

export function SynthContext({ transport, hello }: { transport: MidiTransport; hello: HelloResponsePayload | null }) {
  const offlineTransport = useMemo(() => new MockMidiTransport(), []);
  hello = transport instanceof MockMidiTransport ? null : hello;
  const board = boardForHello(hello);
  const physical = hasAdvancedDevice(hello) && !(transport instanceof MockMidiTransport);
  const connectedPhysical = Boolean(physical && hello && (hello.capabilityFlags & CapabilityFlag.AdvancedPhysicalSynth));
  return <>
    <div className="card">
      {hello && <p>Synth context: {board.label}</p>}
      {physical && !connectedPhysical && <p>Connect updated Advanced firmware to audition this physical instrument.</p>}
      {hello && board.synth && !canEditConnectedSynth(hello) && <p>This firmware does not support synth preset writes.</p>}
    </div>
    {physical ? <AdvancedSynthEditor sampler={Boolean(hello && (hello.capabilityFlags & CapabilityFlag.AdvancedSampler))} engines={Boolean(hello && (hello.capabilityFlags & CapabilityFlag.AdvancedSynthEngines))} key={`${transport.label}:${initialPreset.format}`} transport={connectedPhysical ? transport : undefined} /> : board.synth && <SynthPresetLibrary key={board.synth} transport={canEditConnectedSynth(hello) ? transport : offlineTransport} />}
  </>;
}
