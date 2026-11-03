// Authoritative Classic source catalog, shared by both preparation paths.
export const wavetableSources = [
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

export function buildWaveformSourceMap(source,definitions,sampleCount=512){
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


  const arrays = parseWaveformArrays();
  const waveformSources = parseWaveformSourceMap();
  const generatedWaveforms = ["WAVEFORM_TRIANGLE", "WAVEFORM_SAW", "WAVEFORM_SQUARE"];
  const allWaveforms = new Set();
  for (const definition of definitions) {
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
