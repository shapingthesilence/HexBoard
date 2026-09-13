import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  crunchSerumWavetable,
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

const wavetableSources = [
  {
    name: "Basic Shapes",
    kind: "anchors",
    waveforms: ["WAVEFORM_SINE", "WAVEFORM_TRIANGLE", "WAVEFORM_SAW", "WAVEFORM_SQUARE"],
    menuWaveforms: ["WAVEFORM_SINE", "WAVEFORM_TRIANGLE", "WAVEFORM_SAW", "WAVEFORM_SQUARE"]
  },
  {
    name: "Classic",
    kind: "anchors",
    waveforms: ["WAVEFORM_STRINGS", "WAVEFORM_CLARINET"],
    menuWaveforms: ["WAVEFORM_STRINGS", "WAVEFORM_CLARINET"]
  },
  {
    name: "Vowels",
    kind: "wav",
    path: "src/Default Wavetables/Vowels.wav",
    menuWaveforms: []
  },
  {
    name: "HarshDigitalBois",
    kind: "wav",
    path: "src/Default Wavetables/Matthew Parker Wavetables/HarshDigitalBois/MP HarshDigitalBois.wav",
    menuWaveforms: [
      "WAVEFORM_MP_BOX_SAW",
      "WAVEFORM_MP_SYNC_THE_TITANIC",
      "WAVEFORM_MP_STARDEW",
      "WAVEFORM_MP",
      "WAVEFORM_MP_MERV"
    ]
  },
  {
    name: "RustyBlade",
    kind: "wav",
    path: "src/Default Wavetables/Matthew Parker Wavetables/RustyBlade/RustyBlade.wav",
    menuWaveforms: [
      "WAVEFORM_MP_FRIENDLY_SQUARE",
      "WAVEFORM_MP_KOOLAID",
      "WAVEFORM_MP_RICH_REPEATER",
      "WAVEFORM_MP_WOO"
    ]
  },
  {
    name: "RoundThe808",
    kind: "wav",
    path: "src/Default Wavetables/Matthew Parker Wavetables/RoundThe808/MP RoundThe808.wav",
    menuWaveforms: [
      "WAVEFORM_MP_PRETTY_SHAPE",
      "WAVEFORM_MP_ROUNDED_TRIANGLE",
      "WAVEFORM_MP_QUICK_808"
    ]
  },
  {
    name: "GlassyBells",
    kind: "wav",
    path: "src/Default Wavetables/Matthew Parker Wavetables/GlassyBells/MP GlassyBells.wav",
    menuWaveforms: [
      "WAVEFORM_MP_GLASSY",
      "WAVEFORM_MP_WEIRD_WIZARD",
      "WAVEFORM_MP_OVAL",
      "WAVEFORM_MP_M_BELLISH"
    ]
  }
];

const source = await readFile(sourcePath, "utf8");

function parseWaveformArrays() {
  const arrays = new Map();
  const arrayRegex = /const byte (\w+)\[\] __in_flash\("synth_waveforms"\) = \{([\s\S]*?)\};/g;
  for (const match of source.matchAll(arrayRegex)) {
    const values = [...match[2].matchAll(/\b\d+\b/g)].map((value) => Number(value[0]));
    if (values.length !== sampleCount) {
      throw new Error(`${match[1]} has ${values.length} samples; expected ${sampleCount}`);
    }
    arrays.set(match[1], Uint8Array.from(values));
  }
  return arrays;
}

function parseWaveformSourceMap() {
  const switchMatch = source.match(/const byte\* synthWaveformSource\(byte waveform\) \{[\s\S]*?switch \(waveform\) \{([\s\S]*?)\n\s*default:/);
  if (!switchMatch) {
    throw new Error("Could not find synthWaveformSource switch");
  }

  const waveformSources = new Map();
  for (const match of switchMatch[1].matchAll(/case\s+(WAVEFORM_[A-Z0-9_]+):\s+return\s+(\w+);/g)) {
    waveformSources.set(match[1], match[2]);
  }
  return waveformSources;
}

function generatedWave(waveform) {
  const values = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const phase = (sampleIndex << 7) & 0xffff;
    let sample16 = 32768;

    if (waveform === "WAVEFORM_TRIANGLE") {
      if (phase < 0x4000) {
        sample16 = (0x8000 + (phase << 1)) & 0xffff;
      } else if (phase < 0xc000) {
        sample16 = (0xffff - ((phase - 0x4000) << 1)) & 0xffff;
      } else {
        sample16 = ((phase - 0xc000) << 1) & 0xffff;
      }
    } else if (waveform === "WAVEFORM_SAW") {
      sample16 = (phase + 32768) & 0xffff;
    } else if (waveform === "WAVEFORM_SQUARE") {
      if (phase === 0) {
        sample16 = 32768;
      } else {
        const shiftedPhase = (phase + 32768) & 0xffff;
        sample16 = shiftedPhase > 32768 ? 65535 : 0;
      }
    } else {
      throw new Error(`Unsupported generated waveform ${waveform}`);
    }

    values.push(sample16 >> 8);
  }
  return Uint8Array.from(values);
}

function buildWaveformSourceMap() {
  const arrays = parseWaveformArrays();
  const waveformSources = parseWaveformSourceMap();
  const generatedWaveforms = ["WAVEFORM_TRIANGLE", "WAVEFORM_SAW", "WAVEFORM_SQUARE"];
  const allWaveforms = new Set();
  for (const definition of wavetableSources) {
    for (const waveform of definition.waveforms ?? []) {
      allWaveforms.add(waveform);
    }
    for (const waveform of definition.menuWaveforms ?? []) {
      allWaveforms.add(waveform);
    }
  }

  const rendered = new Map();
  for (const waveform of allWaveforms) {
    if (generatedWaveforms.includes(waveform)) {
      rendered.set(waveform, generatedWave(waveform));
      continue;
    }
    const firmwareArrayName = waveformSources.get(waveform);
    if (!firmwareArrayName || !arrays.has(firmwareArrayName)) {
      throw new Error(`No source for ${waveform}`);
    }
    rendered.set(waveform, arrays.get(firmwareArrayName));
  }
  return rendered;
}

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
  output += `const factoryWavetableFolder = "/";\n\n`;
  output += `const factoryWavetableDefinitions = [\n`;
  for (const wavetable of renderedWavetables) {
    const base64 = Buffer.from(wavetable.samples).toString("base64");
    output += `  { name: ${JSON.stringify(wavetable.name)}, samplesBase64: ${JSON.stringify(base64)} },\n`;
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
  output += `    objectIdHex: objectIdToHex(deterministicObjectId(\`factory-wavetable:\${factoryWavetableFolder}:\${definition.name}\`)),\n`;
  output += `    name: definition.name,\n`;
  output += `    folderPath: factoryWavetableFolder,\n`;
  output += `    samples: decodeBase64Bytes(definition.samplesBase64)\n`;
  output += `  }));\n`;
  output += `}\n`;
  return output;
}

const waveformSamples = buildWaveformSourceMap();
const renderedWavetables = [];
for (const definition of wavetableSources) {
  renderedWavetables.push(await renderBuiltinWavetable(definition, waveformSamples));
}

// Basic Shapes is the immutable rescue wavetable. Everything else ships in
// LittleFS so it can be renamed, edited, or erased like user-created content.
await writeFile(firmwareOutputPath, renderFirmwareData(renderedWavetables.slice(0, 1)), "utf8");
await writeFile(webOutputPath, renderWebFactoryData(renderedWavetables.slice(1), renderedWavetables[0]), "utf8");
await mkdir(libraryOutputPath, { recursive: true });
for (const entry of await readdir(libraryOutputPath, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.toLowerCase().endsWith(".hexwav")) {
    await unlink(resolve(libraryOutputPath, entry.name));
  }
}
for (const wavetable of renderedWavetables.slice(1)) {
  await writeFile(resolve(libraryOutputPath, `${wavetable.name}.hexwav`), encodeHexWav(wavetable.samples));
}

console.log(`Generated ${firmwareOutputPath} (Basic Shapes rescue wavetable)`);
console.log(`Generated ${webOutputPath} (${renderedWavetables.length - 1} editable factory wavetables)`);
console.log(`Generated ${libraryOutputPath} (${renderedWavetables.length - 1} editable factory wavetables)`);
