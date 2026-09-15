import type { MidiTransport } from "../midi/types.ts";
import type { LessonLedColor } from "./lessonColors.ts";

const version = 2;
const enter = 7, status = 9, exit = 10;
const ackTimeoutMs = 2500;
function tokenBytes(token: number) { return [token >>> 21 & 127, token >>> 14 & 127, token >>> 7 & 127, token & 127]; }
const frame = (command: number, ...payload: number[]) => [0xf0, 0x7d, command, ...payload, 0xf7];

export function decodeDelegatedKey(bytes: Uint8Array): { index: number; pressed: boolean } | null {
  if (bytes.length !== 3 || bytes[1] > 127 || bytes[2] > 127) return null;
  const kind = bytes[0] & 0xf0;
  if (kind !== 0x90 && kind !== 0x80) return null;
  const channel = bytes[0] & 15;
  if (channel > 1 || bytes[1] >= 100) return null;
  const index = channel * 100 + bytes[1];
  return index < 140 ? { index, pressed: kind === 0x90 && bytes[2] !== 0 } : null;
}

export class DelegatedSession {
  private readonly token = (crypto.getRandomValues(new Uint32Array(1))[0] & 0x0fffffff) || 1;
  private phase: "idle" | "starting" | "active" | "closed" = "idle";
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private resolveStart?: () => void;
  private rejectStart?: (error: Error) => void;
  private desiredLights: LessonLedColor[] = [];
  private sentLights: LessonLedColor[] = [];
  private painting = false;

  constructor(private readonly transport: MidiTransport,
    private readonly onKey: (index: number, pressed: boolean, receivedAt: number) => void,
    private readonly onStopped: (reason: string) => void) {}

  start(): Promise<void> {
    if (this.phase !== "idle") return Promise.reject(new Error("Start a new lesson session."));
    this.phase = "starting";
    const ready = new Promise<void>((resolve, reject) => { this.resolveStart = resolve; this.rejectStart = reject; });
    this.unsubscribe = this.transport.subscribe((bytes, receivedAt) => this.receive(bytes, receivedAt));
    this.timer = setTimeout(() => this.stop(
      "HexBoard did not confirm the learning session. Install the current firmware, release all keys, then try again. If the board is still in learning mode, hold the encoder for five seconds."
    ), ackTimeoutMs);
    void this.transport.send(frame(enter, version, ...tokenBytes(this.token), ...Array.from("HexBoard Learn", (c) => c.charCodeAt(0))))
      .catch(() => this.stop("Could not start the HexBoard learning session."));
    return ready;
  }

  stop(reason = "Lesson stopped. Hold the encoder for five seconds if the board is still in learning mode.") {
    if (this.phase === "closed") return;
    this.phase = "closed";
    clearTimeout(this.timer);
    this.unsubscribe?.();
    this.rejectStart?.(new Error(reason));
    this.resolveStart = undefined;
    this.rejectStart = undefined;
    // Token-scoped exit cannot terminate a newer browser session.
    void this.transport.send(frame(exit, ...tokenBytes(this.token))).catch(() => {});
    this.onStopped(reason);
  }

  setDisplayRotation(rotation: number) {
    if (this.phase !== "active" || !Number.isInteger(rotation) || rotation < 0 || rotation > 3) return;
    void this.transport.send(frame(11, ...tokenBytes(this.token), rotation))
      .catch(() => this.stop("Could not set the display orientation. Lesson stopped."));
  }

  setLights(lights: LessonLedColor[]) {
    this.desiredLights = lights.slice(0, 140);
    if (!this.painting && this.phase === "active") void this.paint();
  }

  private receive(bytes: Uint8Array, receivedAt = performance.now()) {
    if (bytes.length === 10 && bytes[0] === 0xf0 && bytes[1] === 0x7d && bytes[2] === status
      && bytes[3] === version && bytes[9] === 0xf7
      && tokenBytes(this.token).every((value, i) => value === bytes[i + 4])) {
      if (bytes[8] === 1) {
        if (this.phase !== "active" && this.phase !== "starting") return;
        clearTimeout(this.timer);
        this.phase = "active";
        this.resolveStart?.();
        this.resolveStart = undefined;
        this.rejectStart = undefined;
      } else if (bytes[8] === 2) {
        this.stop("Release all keys and close other apps controlling HexBoard, then try again. Hold the encoder for five seconds to exit an abandoned lesson.");
      } else if (bytes[8] === 0) {
        this.stop("HexBoard ended the learning session. Start again when ready.");
      }
      return;
    }
    if (this.phase !== "active") return;
    const event = decodeDelegatedKey(bytes);
    if (event) this.onKey(event.index, event.pressed, receivedAt);
  }

  private async paint() {
    this.painting = true;
    try {
      while (this.phase === "active") {
        const changes = this.desiredLights.map((light, index) => ({ light, index }))
          .filter(({ light, index }) => {
            const sent = this.sentLights[index];
            return !sent || sent.hue !== light.hue || sent.saturation !== light.saturation || sent.value !== light.value;
          }).slice(0, 16);
        if (!changes.length) break;
        await this.transport.send(frame(3, ...changes.flatMap(({ light, index }) => [index >> 7, index & 127, light.hue, light.saturation, light.value])));
        changes.forEach(({ light, index }) => { this.sentLights[index] = light; });
        // Let the device drain USB between batches, including the first frame.
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    } catch {
      this.stop("Could not update the board lights. Lesson stopped.");
    } finally {
      this.painting = false;
    }
  }
}
