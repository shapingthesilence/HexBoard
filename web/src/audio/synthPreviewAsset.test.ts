import { build } from "vite";
import { describe, expect, it } from "vitest";
import workletSource from "./synth-preview-worklet.js?raw";

describe("published audio worklet", () => {
  it.each(["/", "/HexBoard/", "/HexBoard/development/"])("uses a matching content-hashed asset under %s", async base => {
    // Exercise Vite's real asset pipeline without writing build output or
    // depending on a particular hash. Each app version must name its processor.
    const result = await build({
      configFile: false,
      base,
      publicDir: false,
      logLevel: "silent",
      build: {
        write: false,
        rollupOptions: {
          input: "src/audio/synthPreview.ts",
          preserveEntrySignatures: "strict"
        }
      }
    });
    const output = (Array.isArray(result) ? result[0] : result);
    if (!("output" in output)) throw new Error("Expected a Rollup build result");
    const asset = output.output.find(item => item.type === "asset" && /^assets\/synth-preview-worklet-[\w-]+\.js$/.test(item.fileName));
    expect(asset?.type).toBe("asset");
    if (asset?.type !== "asset") throw new Error("Missing content-hashed audio worklet");
    expect(String(asset.source)).toBe(workletSource);
    const entry = output.output.find(item => item.type === "chunk" && item.isEntry);
    if (entry?.type !== "chunk") throw new Error("Missing preview controller entry");
    expect(entry.code).toContain(`${base}${asset.fileName}`);
    expect(entry.code).not.toContain(`${base}synth-preview-worklet.js`);
  });
});
