import { lazy, Suspense, useMemo, useState } from "react";
import { boardForHello, canEditConnectedSynth, hasAdvancedDevice } from "../midi/boardContext.ts";
import { MockMidiTransport } from "../midi/mockTransport.ts";
import type { MidiTransport } from "../midi/types.ts";
import { initialPreset } from "../advanced/synth/schema.ts";
import { CapabilityFlag } from "../protocol/index.ts";
import type { HelloResponsePayload } from "../protocol/index.ts";
import type { SamplerSoundTarget } from "../advanced/synth/SamplerEditor.tsx";

const SamplerEditor = lazy(() => import("../advanced/synth/SamplerEditor.tsx").then(module => ({ default: module.SamplerEditor })));
const SynthPresetLibrary = lazy(() => import("./SynthPresetLibrary.tsx").then(module => ({ default: module.SynthPresetLibrary })));
const AdvancedSynthEditor = lazy(() => import("../advanced/synth/AdvancedSynthEditor.tsx").then(module => ({ default: module.AdvancedSynthEditor })));

export function SynthContext({ transport, hello }: { transport: MidiTransport; hello: HelloResponsePayload | null }) {
  // Sounds are the home view; the sampler editor opens from a sampler sound or New sampler sound.
  const [classicTab, setClassicTab] = useState<"wavetable" | "sampler">("wavetable");
  // The sampler sound whose samples are open in the sampler editor.
  const [instrumentSound, setInstrumentSound] = useState<SamplerSoundTarget>();
  const offlineTransport = useMemo(() => new MockMidiTransport(), []);
  hello = transport instanceof MockMidiTransport ? null : hello;
  const board = boardForHello(hello);
  const physical = hasAdvancedDevice(hello) && !(transport instanceof MockMidiTransport);
  const connectedPhysical = Boolean(physical && hello && (hello.capabilityFlags & CapabilityFlag.AdvancedPhysicalSynth));
  return <>
    {hello && <p className="synthContextNote">
      Synth context: {board.label}
      {physical && !connectedPhysical && " · Connect updated Advanced firmware to audition this physical instrument."}
      {board.synth && !canEditConnectedSynth(hello) && " · This firmware does not support synth preset writes."}
    </p>}
    <Suspense fallback={<p role="status">Opening synth editor…</p>}>
    {physical ? <AdvancedSynthEditor sampler={Boolean(hello && (hello.capabilityFlags & CapabilityFlag.AdvancedSampler))} engines={Boolean(hello && (hello.capabilityFlags & CapabilityFlag.AdvancedSynthEngines))} key={`${transport.label}:${initialPreset.format}`} transport={connectedPhysical ? transport : undefined} /> : board.synth && <>{classicTab === "sampler" && hello && (hello.capabilityFlags & CapabilityFlag.CompactSampler) ? <SamplerEditor target="classic" transport={transport} sound={instrumentSound} onBack={() => { setClassicTab("wavetable"); setInstrumentSound(undefined); }}/> : <SynthPresetLibrary key={board.synth} transport={canEditConnectedSynth(hello) ? transport : offlineTransport} onEditInstrument={hello && (hello.capabilityFlags & CapabilityFlag.CompactSampler) ? (sound) => { setInstrumentSound(sound); setClassicTab("sampler"); } : undefined} onNewSamplerSound={hello && (hello.capabilityFlags & CapabilityFlag.CompactSampler) ? () => { setInstrumentSound(undefined); setClassicTab("sampler"); } : undefined} />}</>}
    </Suspense>
  </>;
}
