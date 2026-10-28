import {
  BasicSoundBank,
  BasicSample,
  BasicInstrument,
  BasicPreset,
  SoundBankLoader,
  GeneratorTypes as G,
  SpessaSynthProcessor,
} from "spessasynth_core";
import { wav, rate } from "./prepare.mjs";
import { defaults, defaultPerformance, trimRecording } from "./encode.mjs";
const tick = () => new Promise((r) => setTimeout(r, 0)),
  clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const noteName = (n) => {
  const k = Math.round(n);
  return (
    ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
      ((k % 12) + 12) % 12
    ] +
    (Math.floor(k / 12) - 1)
  );
};
export function validateRIFF(buffer) {
  const v = new DataView(buffer),
    text = (p, n = 4) => String.fromCharCode(...new Uint8Array(buffer, p, n));
  if (
    v.byteLength < 12 ||
    text(0) !== "RIFF" ||
    text(8) !== "sfbk" ||
    v.getUint32(4, true) + 8 !== v.byteLength
  )
    throw Error("Choose a complete SF2 or SF3 SoundFont.");
  const walk = (start, end) => {
    for (let p = start; p < end; ) {
      if (p + 8 > end) throw Error("Truncated SoundFont chunk.");
      const n = v.getUint32(p + 4, true),
        next = p + 8 + n;
      if (next > end) throw Error("SoundFont chunk exceeds its container.");
      if (text(p) === "LIST") {
        if (n < 4) throw Error("Invalid SoundFont list.");
        walk(p + 12, next);
      }
      p = next + (n & 1);
      if (p > end) throw Error("Truncated SoundFont padding.");
    }
  };
  walk(12, v.byteLength);
}
export async function openSoundFont(buffer) {
  validateRIFF(buffer);
  const bank = SoundBankLoader.fromArrayBuffer(buffer);
  await bank.ready;
  if (!bank.presets.length) throw Error("This SoundFont has no presets.");
  return {
    bank,
    presets: bank.presets.map((p, id) => ({
      id,
      name: p.name,
      bank: p.bankMSB * 128 + p.bankLSB,
      program: p.program,
      drums: p.isDrum,
    })),
  };
}
const range = (r, low, high) => ({
  low: r.min < 0 ? low : r.min,
  high: r.max < 0 ? high : r.max,
});
const tc = (v, max) =>
  v <= -32768 ? 0 : clamp(1000 * 2 ** (v / 1200), 0, max);
const over = (a, b) =>
  a.lowMidi < b.highMidi &&
  b.lowMidi < a.highMidi &&
  a.velocityLow <= b.velocityHigh &&
  b.velocityLow <= a.velocityHigh;
export function directSoundFont(bank, id) {
  const preset = bank.presets[id];
  if (!preset) throw Error("Preset no longer exists.");
  const input = preset.toFlattenedInstrument().zones,
    assets = [],
    zones = [],
    report = new Set(),
    cache = new Map(),
    sampleForAsset = [];
  let complex = false,
    bakeRequired = false;
  const g = (z, k, d = 0) => z.getGenerator(G[k], d);
  for (const z of input) {
    const s = z.sample;
    if (s.sampleType & 0x8000)
      throw Error("ROM SoundFont samples require external ROM data.");
    const data = s.getAudioData(),
      keys = range(z.keyRange, 0, 127),
      vel = range(z.velRange, 0, 127);
    if (keys.low > keys.high || vel.low > vel.high || vel.high === 0) continue;
    let start =
        g(z, "startAddrsOffset") + 32768 * g(z, "startAddrsCoarseOffset"),
      end =
        data.length +
        g(z, "endAddrOffset") +
        32768 * g(z, "endAddrsCoarseOffset"),
      ls =
        s.loopStart +
        g(z, "startloopAddrsOffset") +
        32768 * g(z, "startloopAddrsCoarseOffset"),
      le =
        s.loopEnd +
        g(z, "endloopAddrsOffset") +
        32768 * g(z, "endloopAddrsCoarseOffset");
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > data.length ||
      end - start < 4
    )
      throw Error(`Invalid sample bounds in ${s.name ?? s.sampleName}.`);
    const mode = g(z, "sampleModes") & 3,
      loop = mode === 1 || mode === 3;
    if (loop && (ls < start || le > end || le - ls < 4))
      throw Error("SoundFont loop exceeds the sample.");
    const root = g(z, "overridingRootKey", s.originalKey);
    if (root < 0 || root > 127)
      throw Error("SoundFont sample has no usable root pitch.");
    const cents =
        g(z, "coarseTune") * 100 + g(z, "fineTune") + s.pitchCorrection,
      track = g(z, "scaleTuning", 100) / 100,
      fixedKey = g(z, "keyNum", -1),
      fixedVel = g(z, "velocity", -1),
      sampleRate =
        s.sampleRate *
        2 **
          ((cents + (fixedKey >= 0 ? (fixedKey - root) * track * 100 : 0)) /
            1200);
    const cacheKey = [
      bank.samples.indexOf(s),
      start,
      end,
      ls,
      le,
      mode,
      root,
      sampleRate,
    ].join(":");
    let asset = cache.get(cacheKey);
    if (asset === undefined) {
      asset = assets.length;
      cache.set(cacheKey, asset);
      sampleForAsset.push(s);
      assets.push({
        name: s.name ?? s.sampleName ?? `Sample ${asset + 1}`,
        channels: [data.slice(start, end)],
        rate: sampleRate,
        rootMidi: root,
        mode: loop ? mode : 0,
        loopStart: loop ? ls - start : 0,
        loopEnd: loop ? le - start : 0,
      });
    }
    const zone = {
      asset,
      lowMidi: keys.low - 0.5,
      highMidi: keys.high + 0.5,
      velocityLow: Math.max(1, vel.low),
      velocityHigh: vel.high,
      gain: 10 ** (-g(z, "initialAttenuation") / 200),
      pan: clamp(g(z, "pan") / 500, -1, 1),
      attack: tc(g(z, "attackVolEnv", -12000), 10000),
      decay: tc(g(z, "decayVolEnv", -12000), 20000),
      sustain: 10 ** (-g(z, "sustainVolEnv") / 200),
      release: tc(g(z, "releaseVolEnv", -12000), 20000),
      delay: tc(g(z, "delayVolEnv", -12000), 10000),
      hold: tc(g(z, "holdVolEnv", -12000), 20000),
      cutoff: clamp(
        8.176 * 2 ** (g(z, "initialFilterFc", 13500) / 1200),
        40,
        20000,
      ),
      keyTrack: fixedKey >= 0 ? 0 : track,
      velocityCurve: 1,
      choke: clamp(g(z, "exclusiveClass"), 0, 16),
    };
    if (zone.gain >= 2 || track < 0 || track > 2 || fixedVel >= 0)
      complex = bakeRequired = true;
    const motion = [
      "modLfoToPitch",
      "vibLfoToPitch",
      "modEnvToPitch",
      "modLfoToFilterFc",
      "modEnvToFilterFc",
      "modLfoToVolume",
      "initialFilterQ",
      "keyNumToVolEnvHold",
      "keyNumToVolEnvDecay",
    ];
    if (motion.some((k) => g(z, k) !== 0) || z.modulators.length) {
      complex = true;
      report.add(
        "Source modulation requires adaptation; live MIDI-controller modulation is replaced by the patch response controls.",
      );
    }
    if (g(z, "chorusEffectsSend") || g(z, "reverbEffectsSend"))
      report.add(
        "Source chorus/reverb sends are omitted. Add effects on the instrument.",
      );
    zones.push(zone);
  }
  const removed = new Set();
  for (let i = 0; i < zones.length; i++) {
    if (removed.has(i)) continue;
    const a = zones[i],
      sample = sampleForAsset[a.asset];
    if (!sample.linkedSample) continue;
    const other = zones.findIndex(
      (b, j) =>
        j > i &&
        !removed.has(j) &&
        sampleForAsset[b.asset] === sample.linkedSample &&
        [
          "lowMidi",
          "highMidi",
          "velocityLow",
          "velocityHigh",
          "gain",
          "attack",
          "decay",
          "sustain",
          "release",
          "delay",
          "hold",
          "cutoff",
          "keyTrack",
        ].every((k) => a[k] === b[k]) &&
        Math.abs(a.pan) === 1 &&
        b.pan === -a.pan,
    );
    if (other < 0) continue;
    const b = zones[other],
      left = a.pan < 0 ? a : b,
      right = a.pan > 0 ? a : b,
      l = assets[left.asset],
      r = assets[right.asset];
    if (
      l.rate !== r.rate ||
      l.rootMidi !== r.rootMidi ||
      l.channels[0].length !== r.channels[0].length ||
      l.mode !== r.mode ||
      l.loopStart !== r.loopStart ||
      l.loopEnd !== r.loopEnd
    )
      continue;
    const id = assets.length;
    assets.push({ ...l, channels: [l.channels[0], r.channels[0]] });
    sampleForAsset.push(sample);
    zones[i] = { ...a, asset: id, pan: 0 };
    removed.add(other);
  }
  for (let i = zones.length - 1; i >= 0; i--)
    if (removed.has(i)) zones.splice(i, 1);
  const used = [...new Set(zones.map((z) => z.asset))],
    compact = used.map((i) => assets[i]);
  for (const z of zones) z.asset = used.indexOf(z.asset);
  assets.splice(0, assets.length, ...compact);
  if (!zones.length) throw Error("This preset has no playable regions.");
  // Stereo SoundFonts often contain independent left/right zones. Baking these
  // together also preserves stacked orchestral layers without spending readers.
  if (zones.some((z, i) => zones.slice(0, i).some((other) => over(z, other)))) {
    complex = bakeRequired = true;
    report.add(
      "Simultaneous source layers are combined into one recording per key/velocity region.",
    );
  }
  if (assets.length > 128 || zones.length > 256) {
    complex = bakeRequired = true;
    report.add(
      "The source map is consolidated to fit 128 recordings and 256 regions.",
    );
  }
  return {
    patch: {
      name: preset.name,
      assets,
      zones,
      settings: { ...defaults, releaseResponse: 0 },
      velocityEngine: 0,
      performance: defaultPerformance(),
      provenance: `SoundFont preset ${preset.bankMSB}:${preset.bankLSB}:${preset.program} — ${preset.name}`,
    },
    complex,
    bakeRequired,
    report: [...report],
  };
}
export async function bakeSoundFont(
  bank,
  id,
  progress = () => {},
  options = {},
) {
  const direct = directSoundFont(bank, id),
    all = direct.patch.zones,
    lo = Math.max(0, Math.ceil(Math.min(...all.map((z) => z.lowMidi)) + 0.5)),
    hi = Math.min(
      127,
      Math.floor(Math.max(...all.map((z) => z.highMidi)) - 0.5),
    ),
    spacing = Math.max(1, Math.ceil((hi - lo + 1) / 32)),
    layers = options.layers ?? 4,
    seconds = options.seconds ?? 6;
  const synth = new SpessaSynthProcessor(rate, {
    effectsEnabled: false,
    eventsEnabled: false,
    maxBufferSize: 128,
  });
  await synth.ready;
  // The processor owns and destroys its banks. Keep the source chooser and
  // subsequent conversions independent of that lifetime.
  const renderBank = SoundBankLoader.fromArrayBuffer(bank.writeSF2());
  await renderBank.ready;
  const selected = renderBank.presets[id];
  await synth.soundBankManager.addSoundBank(renderBank, "import");
  synth.midiChannels[0].preset = selected;
  const assets = [],
    zones = [];
  try {
    for (let root = lo; root <= hi; root += spacing)
      for (let layer = 0; layer < layers; layer++) {
        const vlow = Math.floor((layer * 127) / layers) + 1,
          vhigh = Math.floor(((layer + 1) * 127) / layers),
          velocity = Math.round((vlow + vhigh) / 2),
          keyHigh = Math.min(hi + 0.5, root + spacing - 0.5);
        if (
          !all.some(
            (z) =>
              root >= z.lowMidi &&
              root < z.highMidi &&
              velocity >= z.velocityLow &&
              velocity <= z.velocityHigh,
          )
        )
          continue;
        synth.stopAll(true);
        synth.noteOn(0, root, velocity);
        const frames = Math.round(rate * seconds),
          left = new Float32Array(frames),
          right = new Float32Array(frames);
        for (let at = 0; at < frames; at += 128)
          synth.process(left, right, at, Math.min(128, frames - at));
        let tail = frames;
        while (
          tail > rate * 0.25 &&
          Math.abs(left[tail - 1]) + Math.abs(right[tail - 1]) < 0.00003
        )
          tail--;
        tail = Math.min(frames, tail + 256);
        const sustained = all.some(
            (z) =>
              root >= z.lowMidi &&
              root < z.highMidi &&
              [1, 3].includes(direct.patch.assets[z.asset].mode),
          ),
          looped = sustained && tail > rate * 5;
        assets.push({
          name: `${noteName(root)} · velocity ${vlow}–${vhigh}`,
          channels: [left.subarray(0, tail), right.subarray(0, tail)],
          rate,
          rootMidi: root,
          mode: looped ? 1 : 0,
          loopStart: looped ? frames - rate * 2 : 0,
          loopEnd: looped ? frames : 0,
          crossfade: looped ? 40 : 0,
        });
        zones.push({
          asset: assets.length - 1,
          lowMidi: root - 0.5,
          highMidi: keyHigh,
          velocityLow: vlow,
          velocityHigh: vhigh,
          attack: 0,
          decay: 0,
          sustain: 1,
          release: Math.max(
            60,
            ...all
              .filter((z) => root >= z.lowMidi && root < z.highMidi)
              .map((z) => z.release),
          ),
          velocityCurve: 2,
        });
        progress({
          label: `Rendering ${bank.presets[id].name} · ${noteName(root)} · layer ${layer + 1}/${layers}`,
        });
        await tick();
      }
  } finally {
    synth.destroy();
  }
  if (!assets.length)
    throw Error("The source preset rendered no playable notes.");
  return {
    ...direct.patch,
    assets,
    zones,
    report: [
      ...direct.report,
      `Adapted by rendering up to ${seconds} seconds per recording, ${layers} velocity layers and ${spacing}-semitone spacing. Sustained recordings use a crossfaded final two-second loop; long evolving tails and continuous modulation are approximated.`,
      "Stereo source layers are preserved for browser audition; SD export may downmix to mono.",
    ],
  };
}
export async function convertSoundFont(
  bank,
  id,
  progress = () => {},
  options = {},
) {
  const result = directSoundFont(bank, id);
  if (
    result.complex &&
    (options.adaptation !== "compact" || result.bakeRequired)
  )
    return bakeSoundFont(bank, id, progress);
  return {
    ...result.patch,
    report: [
      ...result.report,
      ...(result.complex
        ? [
            "Compact adaptation keeps the original recordings and loops. Unsupported LFO/envelope motion, filter resonance and custom MIDI modulation are omitted.",
          ]
        : []),
    ],
  };
}
export function sfzNote(value) {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const m = /^([a-g])([#b]?)(-?\d+)$/i.exec(value);
  if (!m) throw Error(`Invalid SFZ note: ${value}`);
  return (
    (+m[3] + 1) * 12 +
    { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] +
    { "": 0, "#": 1, b: -1 }[m[2]]
  );
}
export function normalizePath(path) {
  const parts = [];
  for (const p of path.replaceAll("\\", "/").split("/")) {
    if (p === "..") {
      if (!parts.length)
        throw Error("A sample path leaves the imported folder.");
      parts.pop();
    } else if (p && p !== ".") parts.push(p);
  }
  return parts.join("/");
}
export function sfzRegions(text) {
  text = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const control = {},
    global = {},
    out = [];
  let master = {},
    group = {},
    region,
    section;
  const pattern =
    /<([^>]+)>|([a-zA-Z_][\w]*)\s*=\s*(.*?)(?=\s+[a-zA-Z_][\w]*\s*=|\s*<[^>]+>|$)/gs;
  const finish = () => {
    if (region)
      out.push({ ...control, ...global, ...master, ...group, ...region });
  };
  for (const m of text.matchAll(pattern)) {
    if (m[1]) {
      finish();
      region = undefined;
      section = m[1].trim();
      if (section === "global") {
        for (const k of Object.keys(global)) delete global[k];
        master = {};
        group = {};
      } else if (section === "master") {
        master = {};
        group = {};
      } else if (section === "group") group = {};
      else if (section === "region") region = {};
      else if (section !== "control")
        throw Error(`Unsupported SFZ section <${section}>.`);
    } else {
      const target =
        section === "control"
          ? control
          : section === "global"
            ? global
            : section === "master"
              ? master
              : section === "group"
                ? group
                : region;
      if (!target) throw Error("SFZ opcode outside a section.");
      target[m[2]] = m[3].trim().replace(/^"|"$/g, "");
    }
  }
  finish();
  if (!out.length) throw Error("SFZ has no regions.");
  return out;
}
export async function expandSFZ(
  path,
  files,
  stack = [],
  definitions = new Map(),
) {
  path = normalizePath(path);
  if (stack.includes(path) || stack.length > 16)
    throw Error("Recursive or excessive SFZ includes.");
  const f = files.get(path.toLowerCase());
  if (!f) throw Error(`Missing SFZ include: ${path}`);
  const text = await f.text(),
    parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  let result = "";
  for (const line of text.split(/\r?\n/)) {
    const def = /^\s*#define\s+(\$\w+)\s+(.*)$/.exec(line),
      inc = /^\s*#include\s+"([^"]+)"/.exec(line);
    if (def) {
      definitions.set(def[1], def[2]);
      continue;
    }
    let expanded = line.replace(/\$\w+/g, (key) => {
      if (!definitions.has(key)) throw Error(`Undefined SFZ macro ${key}.`);
      return definitions.get(key);
    });
    if (inc) {
      const target = inc[1].replace(
        /\$\w+/g,
        (key) => definitions.get(key) ?? key,
      );
      result +=
        (await expandSFZ(
          parent + target,
          files,
          [...stack, path],
          definitions,
        )) + "\n";
    } else if (/^\s*#/.test(expanded))
      throw Error("Unsupported SFZ preprocessor directive.");
    else result += expanded + "\n";
  }
  return result;
}
export function mappedSoundFont(patch) {
  const bank = new BasicSoundBank(),
    inst = new BasicInstrument(),
    preset = new BasicPreset(bank);
  inst.name = patch.name ?? "Imported map";
  preset.name = inst.name;
  preset.createZone(inst);
  const samples = [];
  const time = (ms) =>
    ms <= 0 ? -32768 : Math.round(1200 * Math.log2(ms / 1000));
  for (const z of patch.zones.filter((z) => !z.roundRobin)) {
    const a = trimRecording(patch.assets[z.asset]),
      root = Math.round(a.rootMidi);
    for (let channel = 0; channel < a.channels.length; channel++) {
      const sample = new BasicSample(
        a.name,
        a.rate,
        root,
        Math.round((root - a.rootMidi) * 100),
        1,
        a.loopStart,
        a.loopEnd,
      );
      sample.setAudioData(a.channels[channel], a.rate);
      samples.push(sample);
      const zone = inst.createZone(sample);
      zone.keyRange.min = Math.max(0, Math.ceil(z.lowMidi ?? -0.5));
      zone.keyRange.max = Math.min(127, Math.ceil(z.highMidi ?? 127.5) - 1);
      zone.velRange.min = z.velocityLow ?? 1;
      zone.velRange.max = z.velocityHigh ?? 127;
      const settings = patch.settings ?? defaults;
      const generators = {
        sampleModes: a.mode === 1 || a.mode === 3 ? a.mode : 0,
        initialAttenuation: Math.round(
          -200 * Math.log10(Math.max(1e-9, z.gain ?? 1)),
        ),
        pan:
          a.channels.length === 2
            ? channel === 0
              ? -500
              : 500
            : Math.round((z.pan ?? 0) * 500),
        scaleTuning: Math.round((z.keyTrack ?? 1) * 100),
        attackVolEnv: time(z.attack ?? settings.attack),
        decayVolEnv: time(z.decay ?? settings.decay),
        sustainVolEnv: Math.round(
          -200 * Math.log10(Math.max(1e-9, z.sustain ?? settings.sustain)),
        ),
        releaseVolEnv: time(z.release ?? settings.release),
        delayVolEnv: time(z.delay ?? 0),
        holdVolEnv: time(z.hold ?? 0),
        initialFilterFc: Math.round(
          1200 * Math.log2((z.cutoff ?? settings.cutoff) / 8.176),
        ),
      };
      for (const [key, value] of Object.entries(generators))
        zone.setGenerator(G[key], value);
      if (z.velocityCurve === 2) zone.setGenerator(G.velocity, 127);
    }
  }
  bank.addSamples(...samples);
  bank.addInstruments(inst);
  bank.addPresets(preset);
  return bank;
}

export async function importSFZ(path, files, progress = () => {}) {
  const regions = sfzRegions(await expandSFZ(path, files)),
    assets = [],
    zones = [],
    report = new Set(),
    lookup = new Map(),
    parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  const supported = new Set(
    "sample default_path lokey hikey key pitch_keycenter lovel hivel volume pan tune transpose offset end loop_mode loop_start loop_end ampeg_delay ampeg_attack ampeg_hold ampeg_decay ampeg_sustain ampeg_release amp_veltrack cutoff pitch_keytrack seq_length seq_position group off_by trigger label_key group_label label_cc7 fil_type width".split(
      " ",
    ),
  );
  for (const r of regions) {
    for (const key of Object.keys(r))
      if (!supported.has(key))
        report.add(`SFZ ${key} is omitted; the original value is ${r[key]}.`);
    if (r.trigger && r.trigger !== "attack") {
      report.add(`Regions with trigger=${r.trigger} are omitted.`);
      continue;
    }
    if (!r.sample) throw Error("SFZ region has no sample.");
    const filePath = normalizePath(parent + (r.default_path ?? "") + r.sample),
      file = files.get(filePath.toLowerCase());
    if (!file)
      throw Error(
        `Missing recording: ${filePath}. Import the SFZ and its complete sample folder together.`,
      );
    let decoded = lookup.get(filePath);
    if (!decoded) {
      decoded = wav(await file.arrayBuffer());
      lookup.set(filePath, decoded);
    }
    const n = (key, fallback) => {
        const x = Number(r[key] ?? fallback);
        if (!Number.isFinite(x)) throw Error(`Invalid SFZ ${key}.`);
        return x;
      },
      start = n("offset", 0),
      end = n("end", decoded.channels[0].length - 1) + 1,
      mode = r.loop_mode ?? (decoded.loopEnd ? "loop_continuous" : "no_loop"),
      modeNumber = {
        no_loop: 0,
        loop_continuous: 1,
        one_shot: 2,
        loop_sustain: 3,
      }[mode];
    if (modeNumber === undefined) throw Error(`Unsupported loop mode ${mode}.`);
    const root =
        sfzNote(r.pitch_keycenter ?? r.key ?? "60") -
        n("transpose", 0) -
        n("tune", 0) / 100,
      asset = assets.length;
    assets.push({
      name: file.name.replace(/\.wav$/i, ""),
      ...decoded,
      rootMidi: root,
      mode: modeNumber,
      start,
      end,
      loopStart: n("loop_start", decoded.loopStart ?? start),
      loopEnd:
        r.loop_end === undefined
          ? (decoded.loopEnd ?? end)
          : n("loop_end", 0) + 1,
    });
    const seq = n("seq_length", 1),
      pos = n("seq_position", 1);
    if (seq > 16 || pos > seq || pos < 1)
      throw Error("SFZ round robin exceeds sixteen positions.");
    if (seq > 1)
      report.add("Round robin regions use the device’s per-note sequence.");
    zones.push({
      asset,
      lowMidi: sfzNote(r.key ?? r.lokey ?? "0") - 0.5,
      highMidi: sfzNote(r.key ?? r.hikey ?? "127") + 0.5,
      velocityLow: Math.max(1, n("lovel", 0)),
      velocityHigh: n("hivel", 127),
      gain: 10 ** (n("volume", 0) / 20),
      pan: n("pan", 0) / 100,
      attack: n("ampeg_attack", 0.001) * 1000,
      decay: n("ampeg_decay", 0) * 1000,
      sustain: n("ampeg_sustain", 100) / 100,
      release: n("ampeg_release", 0.15) * 1000,
      delay: n("ampeg_delay", 0) * 1000,
      hold: n("ampeg_hold", 0) * 1000,
      cutoff: Math.min(20000, n("cutoff", 20000)),
      keyTrack: n("pitch_keytrack", 100) / 100,
      velocityCurve:
        n("amp_veltrack", 100) === 0
          ? 2
          : 3 + Math.round(clamp(n("amp_veltrack", 100), 0, 100)),
      roundRobin: seq > 1 ? pos - 1 : 0,
      choke: clamp(n("group", 0), 0, 16),
    });
    if (r.off_by && r.off_by !== r.group)
      report.add(
        "Independent SFZ off_by groups are replaced by self-choking groups.",
      );
    if (r.fil_type && r.fil_type !== "lpf_2p")
      report.add(`Filter ${r.fil_type} becomes a two-pole low-pass.`);
    if (r.width && +r.width !== 100)
      report.add("Stereo width control is omitted.");
  }
  const overlap = zones.some((z, i) =>
    zones
      .slice(0, i)
      .some((o) => over(z, o) && !(z.roundRobin || o.roundRobin)),
  );
  const patch = {
    name: path
      .split("/")
      .at(-1)
      .replace(/\.sfz$/i, ""),
    assets,
    zones,
    settings: { ...defaults, releaseResponse: 0 },
    velocityEngine: 0,
    performance: defaultPerformance(),
    report: [...report],
    provenance: path,
  };
  if (overlap) {
    const baked = await bakeSoundFont(mappedSoundFont(patch), 0, progress);
    return {
      ...baked,
      provenance: path,
      report: [
        ...patch.report,
        ...baked.report,
        "Simultaneous SFZ layers are rendered into a bounded map. SFZ velocity behavior is approximated with four captured layers; round-robin variations use their first position during layer rendering.",
      ],
    };
  }
  return patch;
}
