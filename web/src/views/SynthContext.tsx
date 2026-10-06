import { useMemo } from "react";
import { SynthPresetLibrary } from "./SynthPresetLibrary.tsx";
import { boardForHello, canEditConnectedSynth } from "../midi/boardContext.ts";
import { MockMidiTransport } from "../midi/mockTransport.ts";
import type { MidiTransport } from "../midi/types.ts";
import type { HelloResponsePayload } from "../protocol/index.ts";

export function SynthContext({ transport, hello }: { transport: MidiTransport; hello: HelloResponsePayload | null }) {
  const offlineTransport = useMemo(() => new MockMidiTransport(), []);
  const board = boardForHello(hello);
  return <>
    <div className="card">
      {hello && <p>Synth context: {board.label}</p>}
      {!board.synth && <p>Advanced synthesis is not available yet. Tunings, layouts and Learn use the shared editor and browser sound.</p>}
      {hello && board.synth && !canEditConnectedSynth(hello) && <p>This firmware does not support synth preset writes.</p>}
    </div>
    {board.synth && <SynthPresetLibrary key={board.synth} transport={canEditConnectedSynth(hello) ? transport : offlineTransport} />}
  </>;
}
