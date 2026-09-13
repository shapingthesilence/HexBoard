import { afterEach, describe, expect, it, vi } from "vitest";
import { SynthPreviewController } from "./synthPreview.ts";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function host() {
  const module = deferred();
  const messages: any[] = [];
  const contexts: FakeContext[] = [];
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
    port = { postMessage: (message: any) => messages.push(message) };
    connect() {}
    disconnect() {}
  });
  const controller = new SynthPreviewController();
  controller.setPatch({ wavetableName: "Basic Shapes", wavetableFolderPath: "/Built In", values: {}, wavetableSamples: new Uint8Array(8192) });
  return { controller, contexts, messages, module };
}
afterEach(() => vi.unstubAllGlobals());
describe("browser audio lifecycle", () => {
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
