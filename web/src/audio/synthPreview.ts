export type SynthPreviewValues = Record<string, number>;

export interface SynthPreviewPatch {
  wavetableName: string;
  wavetableFolderPath: string;
  wavetableSamples?: Uint8Array;
  values: SynthPreviewValues;
}

interface PendingNote {
  note: number;
  velocity: number;
}

export class SynthPreviewController {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private patch: SynthPreviewPatch | null = null;
  private volume = 0.35;
  private modValue = 0;
  private pendingNotes: PendingNote[] = [];
  private loading: Promise<void> | null = null;

  get active(): boolean {
    return this.context !== null && this.context.state !== "closed";
  }

  setPatch(patch: SynthPreviewPatch): void {
    this.patch = {
      ...patch,
      values: { ...patch.values },
      wavetableSamples: patch.wavetableSamples ? new Uint8Array(patch.wavetableSamples) : undefined
    };
    this.postPatch();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.node?.port.postMessage({ type: "setVolume", volume: this.volume });
  }

  setMod(value: number): void {
    this.modValue = Math.max(0, Math.min(127, Math.round(value)));
    this.node?.port.postMessage({ type: "setMod", value: this.modValue });
  }

  async noteOn(note: number, velocity = 0.9): Promise<void> {
    this.pendingNotes.push({ note, velocity });
    await this.ensureStarted();
    this.flushPendingNotes();
  }

  noteOff(note: number): void {
    this.pendingNotes = this.pendingNotes.filter((pending) => pending.note !== note);
    this.node?.port.postMessage({ type: "noteOff", note });
  }

  allNotesOff(): void {
    this.pendingNotes = [];
    this.node?.port.postMessage({ type: "allNotesOff" });
  }

  async close(): Promise<void> {
    this.allNotesOff();
    this.node?.disconnect();
    this.node = null;
    if (this.context && this.context.state !== "closed") {
      await this.context.close();
    }
    this.context = null;
    this.loading = null;
  }

  private async ensureStarted(): Promise<void> {
    if (this.node && this.context && this.context.state !== "closed") {
      if (this.context.state === "suspended") {
        await this.context.resume();
      }
      return;
    }

    if (!this.loading) {
      this.loading = this.createAudioGraph();
    }
    await this.loading;
  }

  private async createAudioGraph(): Promise<void> {
    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("Browser audio preview is not available in this browser");
    }
    const context = new AudioContextCtor();
    await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}synth-preview-worklet.js`);
    const node = new AudioWorkletNode(context, "hexboard-synth-preview", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    node.connect(context.destination);
    this.context = context;
    this.node = node;
    this.node.port.postMessage({ type: "setVolume", volume: this.volume });
    this.node.port.postMessage({ type: "setMod", value: this.modValue });
    this.postPatch();
    if (context.state === "suspended") {
      await context.resume();
    }
  }

  private postPatch(): void {
    if (!this.node || !this.patch) {
      return;
    }
    this.node.port.postMessage({
      type: "setPatch",
      patch: {
        wavetableName: this.patch.wavetableName,
        wavetableFolderPath: this.patch.wavetableFolderPath,
        values: this.patch.values,
        wavetableSamples: this.patch.wavetableSamples
      }
    });
  }

  private flushPendingNotes(): void {
    if (!this.node) {
      return;
    }
    for (const pending of this.pendingNotes) {
      this.node.port.postMessage({
        type: "noteOn",
        note: pending.note,
        velocity: pending.velocity
      });
    }
    this.pendingNotes = [];
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
