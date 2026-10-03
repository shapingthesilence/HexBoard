import { expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFactorySynthWavetables } from "./factoryWavetables.ts";
import { parseHexBoardWavetable } from "./synthWavetables.ts";
import { crc32 } from "../protocol/crc32.ts";

it("bundles every factory device wavetable with matching sample bytes", () => {
  const directory = resolve(import.meta.dirname, "../../../factory-library/wavetables");
  const files = readdirSync(directory, { recursive: true }).filter(file => file.endsWith(".hexwav"));
  const factory = createFactorySynthWavetables();
  expect(factory).toHaveLength(files.length);
  for (const file of files) {
    const name = file.split("/").at(-1).slice(0, -7);
    const wavetable = factory.find(record => record.name === name);
    expect(wavetable, name).toBeDefined();
    const samples = parseHexBoardWavetable(readFileSync(resolve(directory, file)));
    expect(wavetable.samples.length).toBe(samples.length);
    expect(crc32(wavetable.samples)).toBe(crc32(samples));
  }
});

