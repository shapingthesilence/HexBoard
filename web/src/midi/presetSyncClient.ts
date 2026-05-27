import {
  MessageType,
  decodePresetSyncFrame,
  encodeDefaultPresetSyncFrame,
  encodeHelloRequestPayload,
  encodeReadRequestPayload
} from "../protocol/index.ts";
import type { MidiTransport } from "./types.ts";

export class PresetSyncClient {
  private transactionId = 1;
  private readonly transport: MidiTransport;

  constructor(transport: MidiTransport) {
    this.transport = transport;
  }

  async sendHello(hostMaxPackedChunk = 128): Promise<number[]> {
    return this.send(MessageType.HelloRequest, encodeHelloRequestPayload(hostMaxPackedChunk));
  }

  async sendReadRequest(objectType: number, handle: number, readFlags = 0): Promise<number[]> {
    return this.send(MessageType.ReadRequest, encodeReadRequestPayload(objectType, handle, readFlags));
  }

  subscribeToFrames(listener: (frame: ReturnType<typeof decodePresetSyncFrame>) => void): () => void {
    return this.transport.subscribe((bytes) => {
      listener(decodePresetSyncFrame(bytes));
    });
  }

  private async send(message: number, payload: number[]): Promise<number[]> {
    const transaction = this.nextTransaction();
    const frame = encodeDefaultPresetSyncFrame(message, transaction, payload);
    await this.transport.send(frame);
    return frame;
  }

  private nextTransaction(): number {
    const current = this.transactionId;
    this.transactionId = this.transactionId >= 0x3fff ? 1 : this.transactionId + 1;
    return current;
  }
}
