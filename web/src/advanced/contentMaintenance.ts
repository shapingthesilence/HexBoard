import type { MidiTransport } from "../midi/types.ts";

interface SynthControl {
  status(): Promise<{ state: string; instrument: number; bend?: number }>;
  stopAndWait(): Promise<void>;
  start(instrument: number): Promise<unknown>;
  bend?(semitones: number): Promise<unknown>;
  close(): void;
}

// Explicit file maintenance may pause playback; ordinary content preview does not.
export async function withStoppedSynth<T>(synth: SynthControl, operation: () => Promise<T>): Promise<T> {
  let resume: number | undefined;
  let bend: number | undefined;
  try {
    const state = await synth.status();bend = state.bend;
    if (state.state !== "stopped") { resume = state.instrument; await synth.stopAndWait(); }
    return await operation();
  } finally {
    try { if (resume !== undefined) { await synth.start(resume); if (bend !== undefined && synth.bend) await synth.bend(bend); } }
    finally { synth.close(); }
  }
}

export async function withAdvancedContentMaintenance<T>(transport: MidiTransport, advanced: boolean, operation: () => Promise<T>): Promise<T> {
  if (!advanced) return operation();
  const { PhysicalSynthClient } = await import("./synth/client.ts");
  return withStoppedSynth(new PhysicalSynthClient(transport), operation);
}
