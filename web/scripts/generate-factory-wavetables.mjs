import {wavetableSources,buildWaveformSourceMap} from './factory-wavetable-sources.mjs';
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  crunchSerumWavetable,
  parseHexBoardWavetable,
  renderInterpolatedAnchorWavetable,
  SYNTH_WAVETABLE_MIP_SAMPLE_BYTES,
  SYNTH_WAVETABLE_SAMPLE_COUNT
} from "../src/catalogs/synthWavetables.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const sourcePath = resolve(repoRoot, "src/firmware/synth/BuiltinWavetables.cpp");
const webOutputPath = resolve(repoRoot, "web/src/catalogs/factoryWavetables.ts");
const firmwareOutputPath = resolve(repoRoot, "src/firmware/synth/BuiltinWavetableData.cpp");
const libraryOutputPath = resolve(repoRoot, "factory-library/wavetables");
const sampleCount = SYNTH_WAVETABLE_SAMPLE_COUNT;


const source = await readFile(sourcePath, "utf8");

async function renderBuiltinWavetable(definition, waveformSamples) {
  let samples;
  if (definition.kind === "anchors") {
    samples = renderInterpolatedAnchorWavetable(definition.waveforms.map((waveform) => waveformSamples.get(waveform)));
  } else if (definition.kind === "wav") {
    const bytes = await readFile(resolve(repoRoot, definition.path));
    samples = crunchSerumWavetable(bytes);
  } else {
    throw new Error(`Unsupported wavetable source kind ${definition.kind}`);
  }
  if (samples.length !== SYNTH_WAVETABLE_MIP_SAMPLE_BYTES) {
    throw new Error(`${definition.name} rendered ${samples.length} bytes; expected ${SYNTH_WAVETABLE_MIP_SAMPLE_BYTES}`);
  }
  return {
    ...definition,
    samples
  };
}

function cIdentifier(name) {
  return name
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .replace(/(?:^|\s+)([A-Za-z0-9])/g, (_, letter) => letter.toUpperCase())
    .replace(/[^A-Za-z0-9]/g, "")
    .replace(/^([0-9])/, "_$1");
}

function chunkCBytes(values) {
  const lines = [];
  for (let index = 0; index < values.length; index += 16) {
    lines.push(`  ${Array.from(values.slice(index, index + 16), (value) => `0x${value.toString(16).padStart(2, "0")}`).join(", ")}`);
  }
  return lines.join(",\n");
}

function renderFirmwareData(renderedWavetables) {
  let output = `// Generated from web/scripts/generate-factory-wavetables.mjs.\n`;
  output += `// Do not edit by hand; run npm run generate:factory-wavetables after changing built-in wavetable sources.\n\n`;
  output += `#include "../FirmwareModule.h"\n`;
  output += `#include "BuiltinWavetables.h"\n`;
  output += `#include "../storage/PersistentDataModels.h"\n\n`;
  output += `namespace {\n\n`;
  for (const wavetable of renderedWavetables) {
    wavetable.cName = `builtinWavetable${cIdentifier(wavetable.name)}Samples`;
    output += `const byte ${wavetable.cName}[] __in_flash("synth_wavetables") = {\n`;
    output += `${chunkCBytes(wavetable.samples)}\n`;
    output += `};\n\n`;
  }
  output += `}  // namespace\n\n`;
  output += `const BuiltinSynthWavetableDefinition builtinSynthWavetables[] = {\n`;
  for (const wavetable of renderedWavetables) {
    const menuWaveforms = wavetable.menuWaveforms ?? [];
    const menuWaveformInitializer = menuWaveforms.length > 0 ? `{ ${menuWaveforms.join(", ")} }` : "{ 0 }";
    output += `  { ${JSON.stringify(wavetable.name)}, SYNTH_WAVETABLE_BUILTIN_FOLDER, ${wavetable.cName}, SYNTH_WAVETABLE_MIP_SAMPLE_BYTES, ${menuWaveformInitializer}, ${menuWaveforms.length} },\n`;
  }
  output += `};\n\n`;
  output += `extern const size_t SYNTH_BUILTIN_WAVETABLE_COUNT =\n`;
  output += `  sizeof(builtinSynthWavetables) / sizeof(builtinSynthWavetables[0]);\n`;
  return output;
}

function encodeHexWav(samples) {
  const headerBytes = 44;
  const bytes = Buffer.alloc(headerBytes + samples.length);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(samples.length, 24);
  bytes.writeUInt32LE(samples.length, 28);
  bytes.writeUInt16LE(1, 32);
  bytes.writeUInt16LE(8, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(samples.length, 40);
  Buffer.from(samples).copy(bytes, headerBytes);
  return bytes;
}

function renderWebFactoryData(renderedWavetables, basicShapes) {
  let output = `// Generated from web/scripts/generate-factory-wavetables.mjs.\n`;
  output += `// Do not edit by hand; run npm run generate:factory-wavetables after changing built-in wavetable sources.\n\n`;
  output += `import { deterministicObjectId, objectIdToHex } from "./objectId.ts";\n\n`;
  output += `export interface FactorySynthWavetable {\n`;
  output += `  objectIdHex: string;\n`;
  output += `  name: string;\n`;
  output += `  folderPath: string;\n`;
  output += `  samples: Uint8Array;\n`;
  output += `}\n\n`;

  output += `const factoryWavetableDefinitions = [\n`;
  for (const wavetable of renderedWavetables) {
    const base64 = Buffer.from(wavetable.samples).toString("base64");
    output += `  { name: ${JSON.stringify(wavetable.name)}, folderPath: ${JSON.stringify(wavetable.folderPath)}, samplesBase64: ${JSON.stringify(base64)} },\n`;
  }
  output += `] as const;\n\n`;
  output += `function decodeBase64Bytes(encoded: string): Uint8Array {\n`;
  output += `  const binary = atob(encoded);\n`;
  output += `  const output = new Uint8Array(binary.length);\n`;
  output += `  for (let index = 0; index < binary.length; index += 1) {\n`;
  output += `    output[index] = binary.charCodeAt(index);\n`;
  output += `  }\n`;
  output += `  return output;\n`;
  output += `}\n\n`;
  output += `export function createBasicShapesSamples(): Uint8Array {\n  return decodeBase64Bytes(${JSON.stringify(Buffer.from(basicShapes.samples).toString("base64"))});\n}\n\n`;
  output += `export function createFactorySynthWavetables(): FactorySynthWavetable[] {\n`;
  output += `  return factoryWavetableDefinitions.map((definition) => ({\n`;
  output += `    objectIdHex: objectIdToHex(deterministicObjectId(\`factory-wavetable:\${definition.folderPath}:\${definition.name}\`)),\n`;
  output += `    name: definition.name,\n`;
  output += `    folderPath: definition.folderPath,\n`;
  output += `    samples: decodeBase64Bytes(definition.samplesBase64)\n`;
  output += `  }));\n`;
  output += `}\n`;
  return output;
}

const waveformSamples = buildWaveformSourceMap(source,wavetableSources,sampleCount);
const renderedWavetables = [];
for (const definition of wavetableSources) {
  renderedWavetables.push(await renderBuiltinWavetable(definition, waveformSamples));
}

// Basic Shapes is the immutable rescue wavetable. Everything else ships in
// LittleFS so it can be renamed, edited, or erased like user-created content.
await writeFile(firmwareOutputPath, renderFirmwareData(renderedWavetables.slice(0, 1)), "utf8");
await mkdir(libraryOutputPath, { recursive: true });
for (const wavetable of renderedWavetables.slice(1)) {
  await writeFile(resolve(libraryOutputPath, `${wavetable.name}.hexwav`), encodeHexWav(wavetable.samples));
}

console.log(`Generated ${firmwareOutputPath} (Basic Shapes rescue wavetable)`);
// Authored .hexwav catalog records are source too; preserve and bundle them.
async function readFactoryCatalog(directory, folderPath = "/") {
  const records = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      records.push(...await readFactoryCatalog(path, `${folderPath === "/" ? "" : folderPath}/${entry.name}`));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".hexwav")) {
      records.push({ name: entry.name.slice(0, -7), folderPath,
        samples: parseHexBoardWavetable(await readFile(path)) });
    }
  }
  return records;
}
const factoryCatalog = await readFactoryCatalog(libraryOutputPath);
await writeFile(webOutputPath, renderWebFactoryData(factoryCatalog, renderedWavetables[0]), "utf8");

console.log(`Generated ${webOutputPath} (${factoryCatalog.length} editable factory wavetables)`);
console.log(`Generated ${libraryOutputPath} (${factoryCatalog.length} editable factory wavetables)`);
