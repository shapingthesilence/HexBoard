import type { MidiMessageListener, MidiTransport } from "./types.ts";

export class MockMidiTransport implements MidiTransport {
  readonly label = "Mock device";
  readonly sentMessages: Uint8Array[] = [];
  private readonly listeners = new Set<MidiMessageListener>();

  async send(bytes: ArrayLike<number>): Promise<void> {
    this.sentMessages.push(Uint8Array.from(Array.from(bytes)));
  }

  subscribe(listener: MidiMessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(bytes: ArrayLike<number>): void {
    const message = Uint8Array.from(Array.from(bytes));
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  clear(): void {
    this.sentMessages.length = 0;
  }
}

