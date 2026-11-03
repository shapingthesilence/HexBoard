import { lazy, Suspense, useMemo, useState } from "react";
import { boardForHello, canEditConnectedSynth, hasAdvancedDevice } from "../midi/boardContext.ts";
import { MockMidiTransport } from "../midi/mockTransport.ts";
import type { MidiTransport } from "../midi/types.ts";
import { initialPreset } from "../advanced/synth/schema.ts";
import { CapabilityFlag } from "../protocol/index.ts";
import type { HelloResponsePayload } from "../protocol/index.ts";

const SamplerEditor = lazy(() => import("../advanced/synth/SamplerEditor.tsx").then(module => ({ default: module.SamplerEditor })));
const SynthPresetLibrary = lazy(() => import("./SynthPresetLibrary.tsx").then(module => ({ default: module.SynthPresetLibrary })));
const AdvancedSynthEditor = lazy(() => import("../advanced/synth/AdvancedSynthEditor.tsx").then(module => ({ default: module.AdvancedSynthEditor })));

export function SynthContext({ transport, hello }: { transport: MidiTransport; hello: HelloResponsePayload | null }) {
  const [classicTab, setClassicTab] = useState<"wavetable" | "sampler">("wavetable");
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
    <Suspense fallback={<p role="status">Opening synth editor…</p>}>
    {physical ? <AdvancedSynthEditor sampler={Boolean(hello && (hello.capabilityFlags & CapabilityFlag.AdvancedSampler))} engines={Boolean(hello && (hello.capabilityFlags & CapabilityFlag.AdvancedSynthEngines))} key={`${transport.label}:${initialPreset.format}`} transport={connectedPhysical ? transport : undefined} /> : board.synth && <>{!!(hello && (hello.capabilityFlags & CapabilityFlag.CompactSampler)) && <nav className="engine-selector" aria-label="Classic synth editor"><button aria-pressed={classicTab === "wavetable"} onClick={()=>setClassicTab("wavetable")}>Wavetable</button><button aria-pressed={classicTab === "sampler"} onClick={()=>setClassicTab("sampler")}>Sampler</button></nav>}{classicTab === "sampler" && hello && (hello.capabilityFlags & CapabilityFlag.CompactSampler) ? <SamplerEditor target="classic" transport={transport}/> : <SynthPresetLibrary key={board.synth} transport={canEditConnectedSynth(hello) ? transport : offlineTransport} />}</>}
    </Suspense>
  </>;
}
