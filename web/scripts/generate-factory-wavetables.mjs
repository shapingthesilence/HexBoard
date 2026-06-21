import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const sourcePath = resolve(repoRoot, "src/firmware/synth/BuiltinWavetables.cpp");
const outputPath = resolve(repoRoot, "web/src/catalogs/factoryWavetables.ts");
const sampleCount = 512;

const source = await readFile(sourcePath, "utf8");

function parseWaveformArrays() {
  const arrays = new Map();
  const arrayRegex = /const byte (\w+)\[\] __in_flash\("synth_waveforms"\) = \{([\s\S]*?)\};/g;
  for (const match of source.matchAll(arrayRegex)) {
    const values = [...match[2].matchAll(/\b\d+\b/g)].map((value) => Number(value[0]));
    if (values.length !== sampleCount) {
      throw new Error(`${match[1]} has ${values.length} samples; expected ${sampleCount}`);
    }
    arrays.set(match[1], values);
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

function parseWavetableDefinitions() {
  const definitionMatch = source.match(/constexpr BuiltinSynthWavetableDefinition builtinSynthWavetables\[\] = \{([\s\S]*?)\n\};/);
  if (!definitionMatch) {
    throw new Error("Could not find builtinSynthWavetables definitions");
  }

  const definitions = [];
  const definitionRegex = /\{\s*"([^"]+)",\s*SYNTH_WAVETABLE_BUILTIN_FOLDER,\s*\{([^}]*)\},\s*(\d+)\s*\}/g;
  for (const match of definitionMatch[1].matchAll(definitionRegex)) {
    const waveforms = [...match[2].matchAll(/WAVEFORM_[A-Z0-9_]+/g)].map((value) => value[0]);
    definitions.push({
      name: match[1],
      waveforms: waveforms.slice(0, Number(match[3]))
    });
  }
  if (definitions.length === 0) {
    throw new Error("No built-in wavetable definitions parsed");
  }
  return definitions;
}

function chunkValues(values) {
  const lines = [];
  for (let index = 0; index < values.length; index += 16) {
    lines.push(`  ${values.slice(index, index + 16).join(", ")}`);
  }
  return lines.join(",\n");
}

function generatedWave(waveform) {
  const values = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const phase = (sampleIndex << 7) & 0xFFFF;
    let sample16 = 32768;

    if (waveform === "WAVEFORM_TRIANGLE") {
      if (phase < 0x4000) {
        sample16 = (0x8000 + (phase << 1)) & 0xFFFF;
      } else if (phase < 0xC000) {
        sample16 = (0xFFFF - ((phase - 0x4000) << 1)) & 0xFFFF;
      } else {
        sample16 = ((phase - 0xC000) << 1) & 0xFFFF;
      }
    } else if (waveform === "WAVEFORM_SAW") {
      sample16 = (phase + 32768) & 0xFFFF;
    } else if (waveform === "WAVEFORM_SQUARE") {
      if (phase === 0) {
        sample16 = 32768;
      } else {
        const shiftedPhase = (phase + 32768) & 0xFFFF;
        sample16 = shiftedPhase > 32768 ? 65535 : 0;
      }
    } else {
      throw new Error(`Unsupported generated waveform ${waveform}`);
    }

    values.push(sample16 >> 8);
  }
  return values;
}

function tsGeneratedNameForWaveform(waveform) {
  return `${waveform.toLowerCase()
    .replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase())
    .replace(/^waveform/, "generated")}Samples`;
}

const arrays = parseWaveformArrays();
const waveformSources = parseWaveformSourceMap();
const definitions = parseWavetableDefinitions();
const generatedWaveforms = ["WAVEFORM_TRIANGLE", "WAVEFORM_SAW", "WAVEFORM_SQUARE"];
const allWaveforms = new Set();
for (const definition of definitions) {
  for (const waveform of definition.waveforms) {
    allWaveforms.add(waveform);
  }
}
for (const waveform of allWaveforms) {
  if (!waveformSources.has(waveform) && !generatedWaveforms.includes(waveform)) {
    throw new Error(`No source for ${waveform}`);
  }
}

const arrayNamesByFirmwareName = new Map();
let output = `// Generated from src/firmware/synth/BuiltinWavetables.cpp.\n`;
output += `// Run npm run generate:factory-wavetables after changing firmware built-in anchors.\n\n`;
output += `import { deterministicObjectId, objectIdToHex } from "./objectId.ts";\n`;
output += `import { renderInterpolatedAnchorWavetable } from "./synthWavetables.ts";\n\n`;
output += `export interface FactorySynthWavetable {\n`;
output += `  objectIdHex: string;\n`;
output += `  name: string;\n`;
output += `  folderPath: string;\n`;
output += `  samples: Uint8Array;\n`;
output += `}\n\n`;
output += `const factoryWavetableFolder = "/Built In";\n\n`;

for (const arrayName of [...arrays.keys()].sort()) {
  const tsName = arrayName.replace(/Source$/, "Samples");
  arrayNamesByFirmwareName.set(arrayName, tsName);
  output += `const ${tsName} = Uint8Array.from([\n${chunkValues(arrays.get(arrayName))}\n]);\n\n`;
}

for (const waveform of generatedWaveforms) {
  const tsName = tsGeneratedNameForWaveform(waveform);
  arrayNamesByFirmwareName.set(waveform, tsName);
  output += `const ${tsName} = Uint8Array.from([\n${chunkValues(generatedWave(waveform))}\n]);\n\n`;
}

output += `const waveformSources: Record<string, Uint8Array> = {\n`;
for (const waveform of [...allWaveforms].sort()) {
  const firmwareArrayName = waveformSources.get(waveform) ?? waveform;
  const tsName = arrayNamesByFirmwareName.get(firmwareArrayName);
  if (!tsName) {
    throw new Error(`No TypeScript source for ${waveform}`);
  }
  output += `  ${waveform}: ${tsName},\n`;
}
output += `};\n\n`;

output += `const factoryWavetableDefinitions = [\n`;
for (const definition of definitions) {
  output += `  { name: ${JSON.stringify(definition.name)}, waveforms: [${definition.waveforms.map((waveform) => JSON.stringify(waveform)).join(", ")}] },\n`;
}
output += `] as const;\n\n`;

output += `export function createFactorySynthWavetables(): FactorySynthWavetable[] {\n`;
output += `  return factoryWavetableDefinitions.map((definition) => ({\n`;
output += `    objectIdHex: objectIdToHex(deterministicObjectId(\`factory-wavetable:\${definition.name}\`)),\n`;
output += `    name: definition.name,\n`;
output += `    folderPath: factoryWavetableFolder,\n`;
output += `    samples: renderInterpolatedAnchorWavetable(definition.waveforms.map((waveform) => waveformSources[waveform]))\n`;
output += `  }));\n`;
output += `}\n`;

await writeFile(outputPath, output, "utf8");
console.log(`Generated ${outputPath} (${definitions.length} wavetables from ${arrays.size} waveform arrays)`);
