export type MidiMessageListener = (bytes: Uint8Array) => void;

export interface MidiTransport {
  readonly label: string;
  send(bytes: ArrayLike<number>): Promise<void>;
  subscribe(listener: MidiMessageListener): () => void;
}

export interface MidiPortSummary {
  id: string;
  name: string;
  manufacturer?: string;
  type: "input" | "output";
  state?: string;
}

export interface WebMidiMessageEvent {
  data: Uint8Array;
}

export interface WebMidiInput {
  id: string;
  name?: string;
  manufacturer?: string;
  type: "input";
  state?: string;
  onmidimessage: ((event: WebMidiMessageEvent) => void) | null;
}

export interface WebMidiOutput {
  id: string;
  name?: string;
  manufacturer?: string;
  type: "output";
  state?: string;
  send(data: number[] | Uint8Array): void;
}

export interface WebMidiPortMap<T> {
  values(): IterableIterator<T>;
}

export interface WebMidiAccess {
  inputs: WebMidiPortMap<WebMidiInput>;
  outputs: WebMidiPortMap<WebMidiOutput>;
}
