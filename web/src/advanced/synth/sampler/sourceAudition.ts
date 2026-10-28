import type { WorkletSynthesizer } from "spessasynth_lib";
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";
import type { PresetChoice } from "./import.mjs";
export class SourceAudition {
  private ctx?: AudioContext;
  private synth?: WorkletSynthesizer;
  private bytes?: ArrayBuffer;
  private opening?: Promise<void>;
  private requested = 0;
  private epoch = 0;
  async load(bytes: ArrayBuffer) {
    this.close();
    this.bytes = bytes;
  }
  private async ready() {
    if (this.synth) return;
    if (this.opening) return this.opening;
    const epoch = this.epoch,
      bytes = this.bytes!,
      ctx = new AudioContext();
    this.ctx = ctx;
    const opening = (async () => {
      let synth: WorkletSynthesizer | undefined;
      try {
        await ctx.audioWorklet.addModule(processorUrl);
        if (epoch !== this.epoch) return;
        const { WorkletSynthesizer } = await import("spessasynth_lib");
        if (epoch !== this.epoch) return;
        synth = new WorkletSynthesizer(ctx);
        synth.connect(ctx.destination);
        await synth.isReady;
        if (epoch !== this.epoch) {
          synth.destroy();
          return;
        }
        await synth.soundBankManager.addSoundBank(bytes.slice(0), "original");
        if (epoch !== this.epoch) {
          synth.destroy();
          return;
        }
        this.synth = synth;
      } catch (error) {
        synth?.destroy();
        if (epoch === this.epoch) throw error;
      }
    })();
    this.opening = opening;
    try {
      await opening;
    } finally {
      if (this.opening === opening) this.opening = undefined;
    }
  }
  async on(preset: PresetChoice, note: number, velocity: number) {
    const request = ++this.requested;
    await this.ready();
    if (request !== this.requested || !this.synth || !this.ctx) return;
    await this.ctx.resume();
    if (request !== this.requested) return;
    const channel = preset.drums ? 9 : 0;
    this.synth.stopAll(true);
    this.synth.controllerChange(channel, 0, Math.floor(preset.bank / 128));
    this.synth.controllerChange(channel, 32, preset.bank % 128);
    this.synth.programChange(channel, preset.program);
    this.synth.pitchWheelRange(channel, 2);
    this.synth.noteOn(channel, note, velocity);
  }
  off() {
    this.requested++;
    this.synth?.stopAll(false);
  }
  close() {
    this.requested++;
    this.epoch++;
    this.opening = undefined;
    this.synth?.destroy();
    this.synth = undefined;
    void this.ctx?.close();
    this.ctx = undefined;
  }
}
