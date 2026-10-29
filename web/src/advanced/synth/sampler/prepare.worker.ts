import { analyzePitch, midiForHz, suggestLoops, sourcePitchWindow } from "./analysis.ts";
import { readBank } from "./bank.mjs";
import { readCompactPatch } from "./compact.mjs";
import { verifyPreparedTuning } from "./verifyTuning.ts";
import { prepareCompactPatch } from "./compact.mjs";
import {
  preparePatch,
  wav,
  type Patch,
} from "./prepare.mjs";
self.onmessage = async (event: MessageEvent) => {
  try {
    const request = event.data;
    if (request.operation === "suggestLoops") {
      const suggestions = request.assets.map((a: import("./prepare.mjs").Recording) => {
        if ([1, 3].includes(a.mode ?? 0)) return null;
        const [begin,finish] = sourcePitchWindow(a);
        if (finish <= begin) return null;
        const analysis = analyzePitch(a, begin, finish);
        return suggestLoops(a, begin, finish, analysis).find(c => c.style === "Compact") ?? null;
      });
      self.postMessage({ result: suggestions }); return;
    }
    if (request.operation === "import") {
      const recordings = request.files.map(
        (file: { name: string; bytes: ArrayBuffer }) => {
          const decoded = wav(file.bytes),
            channels = decoded.channels,
            outputRate = decoded.rate,
            source = {channels,rate:outputRate,rootMidi:60},
            window = sourcePitchWindow(source),
            analysis = analyzePitch(source,window[0],window[1],4),
            root = analysis.hz && analysis.confidence >= .85 && analysis.spread <= 25 ? { midi: midiForHz(analysis.hz), confidence: analysis.confidence } : undefined;
          return {
            name: file.name.replace(/\.wav$/i, ""),
            channels,
            rate: outputRate,
            rootMidi:
              decoded.rootMidi ??
              (root ? root.midi : 60),
            pitchSource: decoded.rootMidi !== undefined ? "metadata" : root ? "analysis" : "fallback",
            pitchConfidence: analysis.confidence,
            pitchVariation: analysis.spread,
            pitchSuggestion: analysis.hz && analysis.confidence >= .7 && analysis.spread <= 25 ? midiForHz(analysis.hz) : undefined,
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
    self.postMessage({ progress: { label: "Checking converted loop tuning…", asset: 0, total: 1, level: 0 } });
    const decoded = request.target === "classic" ? readCompactPatch(result.bytes) : readBank(result.bytes, { loopWindows: true });
    result.warnings.push(...verifyPreparedTuning(request.patch, decoded));
    self.postMessage({ result }, { transfer: [result.bytes.buffer] });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
