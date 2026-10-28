import { prepareCompactPatch } from "./compact.mjs";
import {
  preparePatch,
  wav,
  suggestRoot,
  resample,
  rate,
  type Patch,
} from "./prepare.mjs";
self.onmessage = async (event: MessageEvent) => {
  try {
    const request = event.data;
    if (request.operation === "import") {
      const recordings = request.files.map(
        (file: { name: string; bytes: ArrayBuffer }) => {
          const decoded = wav(file.bytes),
            channels = request.target === "classic" ? decoded.channels : resample(decoded.channels, decoded.rate),
            outputRate = request.target === "classic" ? decoded.rate : rate,
            root = suggestRoot(request.target === "classic" ? resample(decoded.channels, decoded.rate) : channels);
          return {
            name: file.name.replace(/\.wav$/i, ""),
            channels,
            rate: outputRate,
            rootMidi:
              decoded.rootMidi ??
              (root ? Math.round(root.midi * 100) / 100 : 60),
            confidence: root?.confidence ?? 0,
            loopStart: decoded.loopStart === undefined ? undefined : Math.round(decoded.loopStart * outputRate / decoded.rate),
            loopEnd: decoded.loopEnd === undefined ? undefined : Math.round(decoded.loopEnd * outputRate / decoded.rate),
            mode: decoded.loopEnd ? 1 : 0,
          };
        },
      );
      self.postMessage({ result: recordings });
      return;
    }
    const result = await (request.target === "classic" ? prepareCompactPatch : preparePatch)(request.patch as Patch, (progress) =>
      self.postMessage({ progress }),
    );
    self.postMessage({ result }, { transfer: [result.bytes.buffer] });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
