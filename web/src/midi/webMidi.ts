import type {
  MidiMessageListener,
  MidiPortSummary,
  MidiTransport,
  WebMidiAccess,
  WebMidiInput,
  WebMidiOutput
} from "./types.ts";

interface NavigatorWithMidi {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<WebMidiAccess>;
}

export function isWebMidiSupported(): boolean {
  return typeof navigator !== "undefined"
    && typeof (navigator as unknown as NavigatorWithMidi).requestMIDIAccess === "function";
}

export async function requestPresetSyncMidiAccess(): Promise<WebMidiAccess> {
  const requestMIDIAccess = (navigator as unknown as NavigatorWithMidi).requestMIDIAccess;
  if (!requestMIDIAccess) {
    throw new Error("Web MIDI is not available in this browser");
  }
  return requestMIDIAccess.call(navigator, { sysex: true });
}

export function listMidiPorts(access: WebMidiAccess): MidiPortSummary[] {
  return [
    ...Array.from(access.inputs.values()).map((port) => summarizePort(port)),
    ...Array.from(access.outputs.values()).map((port) => summarizePort(port))
  ];
}

function summarizePort(port: WebMidiInput | WebMidiOutput): MidiPortSummary {
  return {
    id: port.id,
    name: port.name ?? port.id,
    manufacturer: port.manufacturer,
    type: port.type,
    state: port.state
  };
}

export class WebMidiTransport implements MidiTransport {
  readonly label: string;
  private readonly listeners = new Set<MidiMessageListener>();
  private readonly output: WebMidiOutput;
  private readonly input?: WebMidiInput;

  constructor(output: WebMidiOutput, input?: WebMidiInput) {
    this.output = output;
    this.input = input;
    this.label = output.name ?? output.id;
    if (this.input) {
      this.input.onmidimessage = (event) => {
        for (const listener of this.listeners) {
          listener(event.data);
        }
      };
    }
  }

  async send(bytes: ArrayLike<number>): Promise<void> {
    this.output.send(Uint8Array.from(Array.from(bytes)));
  }

  subscribe(listener: MidiMessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
