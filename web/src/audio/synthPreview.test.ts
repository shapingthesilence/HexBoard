import { afterEach, describe, expect, it, vi } from "vitest";
import { SynthPreviewController } from "./synthPreview.ts";
import { MidiSynthPreview } from "./midiSynthPreview.ts";
import workletUrl from "./synth-preview-worklet.js?url";
import workletSource from "./synth-preview-worklet.js?raw";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function host(withWorklet = false) {
  const module = deferred();
  const messages: any[] = [];
  const contexts: FakeContext[] = [];
  const processors: any[] = [];
  class FakeContext {
    state = "running";
    destination = {};
    audioWorklet = { addModule: vi.fn(() => module.promise) };
    resume = vi.fn(async () => {});
    close = vi.fn(async () => { this.state = "closed"; });
    constructor() { contexts.push(this); }
  }
  vi.stubGlobal("window", { AudioContext: FakeContext });
  vi.stubGlobal("AudioWorkletNode", class {
    private processor: any;
    port = { postMessage: (message: any) => {
      messages.push(message);
      this.processor?.port.onmessage({ data: message });
    } };
    constructor() {
      if (!withWorklet) return;
      let Constructor: any;
      new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", workletSource)(
        class { port = {}; }, (_name: string, ctor: any) => { Constructor = ctor; }, 48000
      );
      this.processor = new Constructor();
      processors.push(this.processor);
    }
    connect() {}
    disconnect() {}
  });
  const controller = new SynthPreviewController();
  controller.setPatch({ wavetableName: "Basic Shapes", wavetableFolderPath: "/Built In", values: {}, wavetableSamples: new Uint8Array(8192) });
  return { controller, contexts, messages, module, processors };
}
afterEach(() => vi.unstubAllGlobals());
describe("browser audio lifecycle", () => {
  it("loads the build-resolved processor URL instead of an independently cached public script", async () => {
    const { controller, contexts, module } = host();
    const start = controller.start();
    expect(contexts[0].audioWorklet.addModule).toHaveBeenCalledExactlyOnceWith(workletUrl);
    expect(workletUrl).not.toBe(`${import.meta.env.BASE_URL}synth-preview-worklet.js`);
    module.resolve();
    await start;
    await controller.close();
  });

  it("releases MIDI channel unisons through the controller and shipped worklet", async () => {
    const { controller, module, processors } = host(true);
    const start = controller.start();
    module.resolve();
    await start;
    const starts: Promise<void>[] = [];
    const midi = new MidiSynthPreview({
      noteOn: (...args) => { starts.push(controller.noteOn(...args)); },
      noteOff: (id, immediate) => controller.noteOff(id, immediate),
      setPitch: (id, offset) => controller.setPitch(id, offset),
      setMod: value => controller.setMod(value)
    });
    midi.receive(Uint8Array.from([0x90, 60, 127]));
    midi.receive(Uint8Array.from([0x91, 60, 127]));
    await Promise.all(starts);
    const processor = processors[0];
    expect(processor.heldNotes).toEqual(["midi:0:60", "midi:1:60"]);
    expect(processor.voices.filter((voice: any) => voice.active)).toHaveLength(2);
    midi.receive(Uint8Array.from([0x80, 60, 0]));
    expect(processor.heldNotes).toEqual(["midi:1:60"]);
    midi.receive(Uint8Array.from([0x91, 60, 0]));
    expect(processor.heldNotes).toEqual([]);
    processor.process([], [[new Float32Array(4800)]]);
    expect(processor.voices.some((voice: any) => voice.active)).toBe(false);
    await controller.close();
  });
  it("retunes queued MIDI voices and releases only the selected channel while loading", async () => {
    const { controller, messages, module } = host();
    const starts = [controller.noteOn(60, 1, "midi:0:60", 0.25), controller.noteOn(60, 0.5, "midi:1:60")];
    controller.setPitch("midi:1:60", 0.75);
    controller.noteOff("midi:0:60");
    module.resolve();
    await Promise.all(starts);
    expect(messages.filter(message => message.type === "noteOn")).toEqual([
      { type: "noteOn", note: 60, velocity: 0.5, id: "midi:1:60", pitchOffset: 0.75 }
    ]);
    await controller.close();
  });
  it("cancels a note released while the worklet is loading", async () => {
    const { controller, messages, module, contexts } = host();
    const start = controller.noteOn(60);
    expect(contexts[0].resume).toHaveBeenCalled();
    controller.noteOff(60);
    module.resolve();
    await start;
    expect(messages.some(message => message.type === "noteOn")).toBe(false);
    await controller.close();
  });
  it("shares startup for a chord and cancels queued notes on stop", async () => {
    const { controller, contexts, messages, module } = host();
    const starts = [controller.noteOn(60), controller.noteOn(64)];
    controller.allNotesOff();
    module.resolve();
    await Promise.all(starts);
    expect(contexts).toHaveLength(1);
    expect(messages.some(message => message.type === "noteOn")).toBe(false);
    await controller.close();
  });
  it("closes a pending context without connecting a late node", async () => {
    const { controller, contexts, messages, module } = host();
    const start = controller.noteOn(60);
    await controller.close();
    module.resolve();
    await start;
    expect(contexts[0].state).toBe("closed");
    expect(messages).toEqual([]);
  });
  it("cleans up failed startup so a later gesture can retry", async () => {
    const { controller, contexts, module } = host();
    const start = controller.noteOn(60);
    module.reject(new Error("Module unavailable"));
    await expect(start).rejects.toThrow("Module unavailable");
    expect(contexts[0].state).toBe("closed");
    await expect(controller.noteOn(60)).rejects.toThrow("Module unavailable");
    expect(contexts).toHaveLength(2);
  });
});
