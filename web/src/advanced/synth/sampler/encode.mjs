import { crc32, resample, downsample, rate } from "./prepare.mjs";
const align = (n, q = 512) => Math.ceil(n / q) * q;
const pitch = (n) => Math.round((Math.log2(440) + (n - 69) / 12) * 2 ** 24);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = (v, name) => {
  if (!Number.isFinite(v)) throw Error(`Invalid ${name}.`);
  return v;
};
export function defaultPerformance() {
  return {
    format: "hexboard.performance.v1",
    values: [
      0, 0, 2, 0, 1, 65, 0, 0, 0, 0, 0, 90, 0, 32768, 0, 0, 1, 1200, 0, 16, 1,
      0, 2, 0,
    ],
    steps: Array.from({ length: 32 }, () => ({
      on: true,
      tie: false,
      velocity: 100,
      probability: 100,
      ratchets: 1,
    })),
  };
}
export function performanceRecord(
  engine = 0,
  performance = defaultPerformance(),
) {
  const p = performance,
    max = [
      1, 5, 5, 2, 4, 100, 75, 1, 1, 1, 1, 127, 1, 65535, 2, 1, 1, 2400, 1, 32,
      1, 1, 5, 0,
    ];
  if (
    !Number.isInteger(engine) ||
    engine < 0 ||
    engine > 4 ||
    !p ||
    p.values?.length !== 24 ||
    p.steps?.length !== 32 ||
    p.values.some((x, i) => !Number.isInteger(x) || x < 0 || x > max[i]) ||
    !p.values[4] ||
    p.values[5] < 5 ||
    !p.values[11] ||
    p.values[17] < 400 ||
    !p.values[19]
  )
    throw Error("Invalid patch response/arpeggiator settings.");
  const b = new Uint8Array(184),
    v = new DataView(b.buffer);
  b[0] = 1;
  b[1] = engine;
  p.values.forEach((n, i) => v.setUint16(4 + i * 2, n, true));
  p.steps.forEach((s, i) => {
    if (
      typeof s.on !== "boolean" ||
      typeof s.tie !== "boolean" ||
      !Number.isInteger(s.velocity) ||
      s.velocity < 0 ||
      s.velocity > 127 ||
      !Number.isInteger(s.probability) ||
      s.probability < 0 ||
      s.probability > 100 ||
      !Number.isInteger(s.ratchets) ||
      s.ratchets < 1 ||
      s.ratchets > 4 ||
      (s.tie && s.ratchets !== 1)
    )
      throw Error("Invalid arpeggiator step.");
    v.setUint32(
      52 + i * 4,
      +s.on |
        (+s.tie << 1) |
        (s.velocity << 2) |
        (s.probability << 9) |
        (s.ratchets << 16),
      true,
    );
  });
  v.setUint32(180, crc32(b.subarray(0, 180)), true);
  return b;
}
export function decodePerformance(bytes) {
  if (
    bytes.length !== 184 ||
    bytes[0] !== 1 ||
    bytes[1] > 4 ||
    bytes[2] ||
    bytes[3]
  )
    throw Error("Invalid patch performance record.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(180, true) !== crc32(bytes.subarray(0, 180)))
    throw Error("Patch performance checksum failed.");
  const p = defaultPerformance();
  p.values = Array.from({ length: 24 }, (_, i) => v.getUint16(4 + i * 2, true));
  p.steps = Array.from({ length: 32 }, (_, i) => {
    const n = v.getUint32(52 + i * 4, true);
    if (n & ~0x7ffff) throw Error("Invalid arpeggiator step.");
    return {
      on: !!(n & 1),
      tie: !!(n & 2),
      velocity: (n >> 2) & 127,
      probability: (n >> 9) & 127,
      ratchets: (n >> 16) & 7,
    };
  });
  performanceRecord(bytes[1], p);
  return { velocityEngine: bytes[1], performance: p };
}
export const defaults = {
  attack: 5,
  decay: 150,
  sustain: 1,
  release: 500,
  cutoff: 18000,
  resonance: 0.7,
  pressure: 0.15,
  pressureGain: 0,
  space: 0,
  fastRelease: 110,
  releaseResponse: 0.9,
  releaseCurve: 1.5,
  pedalRelease: 150,
};
function settingsFor(input) {
  const s = { ...defaults, ...input };
  for (const [k, v] of Object.entries(s)) finite(v, k);
  if (
    s.attack < 0 ||
    s.attack > 10000 ||
    s.decay < 0 ||
    s.decay > 20000 ||
    s.sustain < 0 ||
    s.sustain > 1 ||
    s.release < 0 ||
    s.release > 20000 ||
    s.cutoff < 40 ||
    s.cutoff > 20000 ||
    s.resonance < 0.5 ||
    s.resonance > 4 ||
    s.fastRelease < 5 ||
    s.fastRelease > 20000 ||
    s.pedalRelease < 5 ||
    s.pedalRelease > 20000 ||
    s.releaseCurve < 0.25 ||
    s.releaseCurve > 4 ||
    ["pressure", "pressureGain", "releaseResponse", "space"].some(
      (k) => s[k] < 0 || s[k] > 1,
    )
  )
    throw Error("Sound controls exceed the device range.");
  return s;
}
export function trimRecording(src) {
  if (
    !src ||
    !Array.isArray(src.channels) ||
    src.channels.length < 1 ||
    src.channels.length > 2 ||
    !Number.isFinite(src.rate) ||
    src.rate < 100 ||
    src.rate > 384000 ||
    src.channels.some(
      (c) =>
        !(c instanceof Float32Array) || c.length !== src.channels[0].length,
    )
  )
    throw Error("Invalid recording.");
  const start = src.start ?? 0,
    end = src.end ?? src.channels[0].length;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > src.channels[0].length ||
    end - start < 4
  )
    throw Error("Trim must leave at least four frames.");
  const channels = src.channels.map((c) => c.slice(start, end));
  for (const c of channels)
    for (const x of c)
      if (!Number.isFinite(x))
        throw Error("Recording contains invalid samples.");
  let ls = (src.loopStart ?? start) - start,
    le = (src.loopEnd ?? end) - start,
    mode = src.mode ?? 0;
  if (![0, 1, 2, 3].includes(mode)) throw Error("Invalid playback mode.");
  if (mode === 1 || mode === 3) {
    if (
      !Number.isInteger(ls) ||
      !Number.isInteger(le) ||
      ls < 0 ||
      le > channels[0].length ||
      le - ls < 1
    )
      throw Error(
        "Loop must lie inside the trimmed recording and contain at least one frame.",
      );
  } else ls = le = 0;
  return {
    channels,
    rate: src.rate,
    rootMidi: src.rootMidi,
    mode,
    loopStart: ls,
    loopEnd: le,
    normalize: !!src.normalize,
    name: src.name ?? "Recording",
    crossfade: src.crossfade ?? 0,
  };
}
function convertRate(src, factor) {
  let channels = resample(src.channels, rate / factor, false),
    ls = 0,
    le = 0;
  if (src.mode === 1 || src.mode === 3) {
    ls = Math.round(src.loopStart * factor);
    const loop = resample(
      src.channels.map((c) => c.subarray(src.loopStart, src.loopEnd)),
      rate / factor,
      true,
    );
    le = ls + loop[0].length;
    if (le > channels[0].length)
      channels = channels.map((c) => {
        const out = new Float32Array(le);
        out.set(c);
        return out;
      });
    channels.forEach((c, i) => c.set(loop[i], ls));
  }
  if (channels[0].length < 4)
    channels = channels.map((c) => {
      const padded = new Float32Array(4);
      padded.set(c);
      return padded;
    });
  return { ...src, channels, loopStart: ls, loopEnd: le };
}
export function crossfadeFrames(src) {
  if (src.mode !== 1 && src.mode !== 3) return 0;
  const start = src.loopStart ?? src.start ?? 0, end = src.loopEnd ?? src.end ?? src.channels[0].length;
  const maximum = Math.floor((end - start) / 4);
  if (maximum < 2) return 0;
  const requested = Math.round(((src.crossfade ?? 0) * src.rate) / 1000);
  return requested > 0 ? Math.min(maximum, Math.max(2, requested)) : 0;
}
export function crossfadeRecording(src) {
  const ls = src.loopStart ?? src.start ?? 0, le = src.loopEnd ?? src.end ?? src.channels[0].length,
    fade = crossfadeFrames(src);
  if (!fade) return src;
  return {
    ...src,
    channels: src.channels.map((c) => {
      const out = new Float32Array(c.length + fade);
      out.set(c.subarray(0, le));
      for (let i = 0; i < fade; i++) {
        const t = i / (fade - 1);
        out[le + i] =
          c[Math.min(c.length - 1, le + i)] * (1 - t) + c[ls + i] * t;
      }
      out.set(c.subarray(le), le + fade);
      // Preserve the release-tail join as well as the sustain wrap. The
      // original tail duration is retained; only its first few frames blend.
      if (src.mode === 3) {
        const count = Math.min(fade, c.length - le);
        for (let i = 0; i < count; ++i) {
          const t = count > 1 ? i / (count - 1) : 1;
          out[le + fade + i] = c[ls + (fade + i) % (le - ls)] * (1 - t) + c[le + i] * t;
        }
      }
      return out;
    }),
    loopStart: ls + fade,
    loopEnd: le + fade,
    crossfade: 0,
  };
}
function baseRecording(src) {
  const t = trimRecording(src);
  finite(t.rootMidi, "root pitch");
  if (pitch(t.rootMidi) < 0 || pitch(t.rootMidi) > 16 * 2 ** 24)
    throw Error("Root pitch exceeds the device range.");
  const looped = t.mode === 1 || t.mode === 3;
  const frames = looped ? Math.max(1, Math.round((t.loopEnd - t.loopStart) * rate / t.rate)) : 0;
  const factor = looped ? frames / (t.loopEnd - t.loopStart) : rate / t.rate;
  // Resample the attack and tail on the same time scale as the exact integer
  // loop. Root calibration then preserves their pitch and duration as well.
  let converted = { ...t, channels: resample(t.channels, rate / factor, false), rate,
    crossfade: t.crossfade * t.rate * factor / rate };
  if (looped) {
    const loop = resample(
      t.channels.map((c) => c.subarray(t.loopStart, t.loopEnd)),
      rate / factor,
      true,
    );
    // HBS playback uses 44.1 kHz. Correct the root per tracking slope below
    // so rounding a short loop to whole frames cannot detune it.
    converted.loopPitchShift = 12 * Math.log2(rate * (t.loopEnd - t.loopStart) / (frames * t.rate));
    converted.loopStart = Math.round(t.loopStart * factor);
    converted.loopEnd = converted.loopStart + loop[0].length;
    if (converted.loopEnd > converted.channels[0].length)
      converted.channels = converted.channels.map((c) => {
        const out = new Float32Array(converted.loopEnd);
        out.set(c);
        return out;
      });
    converted.channels.forEach((c, i) => c.set(loop[i], converted.loopStart));
  }
  if (converted.channels[0].length > rate * 1800)
    throw Error("Recordings longer than 30 minutes are unsupported.");
  if (converted.channels[0].length < 4) converted.channels = converted.channels.map(c => { const out = new Float32Array(4); out.set(c); return out; });
  return crossfadeRecording(converted);
}

function lowpass(data, cutoff, periodic = false) {
  if (cutoff >= 0.46) return data.slice();
  const half = 64,
    weights = new Float64Array(half * 2 + 1);
  let norm = 0;
  for (let k = -half; k <= half; k++) {
    const w =
      (k === 0
        ? 2 * cutoff
        : Math.sin(2 * Math.PI * cutoff * k) / (Math.PI * k)) *
      (0.42 +
        0.5 * Math.cos((Math.PI * k) / half) +
        0.08 * Math.cos((2 * Math.PI * k) / half));
    weights[k + half] = w;
    norm += w;
  }
  const out = new Float32Array(data.length);
  for (let n = 0; n < out.length; n++) {
    let sum = 0;
    for (let k = -half; k <= half; k++) {
      const at = n + k;
      sum +=
        (periodic
          ? data[((at % data.length) + data.length) % data.length]
          : at >= 0 && at < data.length
            ? data[at]
            : 0) * weights[k + half];
    }
    out[n] = sum / norm;
  }
  return out;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
export async function preparePatch(input, onProgress = () => {}) {
  if (!input?.assets?.length || input.assets.length > 128)
    throw Error("Use 1–128 recordings per instrument.");
  const settings = settingsFor(input.settings),
    perf = performanceRecord(
      input.velocityEngine ?? 0,
      input.performance ?? defaultPerformance(),
    ),
    warnings = [];
  const quality = input.pitchQuality ?? "balanced";
  if (!["balanced", "clean", "character"].includes(quality))
    throw Error("Invalid pitch quality.");
  let source = input.assets.map(baseRecording);
  let zones = (
    input.zones ??
    source.map((_, asset) => ({ asset, lowMidi: -0.5, highMidi: 127.5 }))
  ).map((z) => ({ ...z }));
  if (!zones.length || zones.length > 256)
    throw Error("Use 1–256 zones per instrument.");
  for (const z of zones) {
    if (!Number.isInteger(z.asset) || !source[z.asset])
      throw Error("A zone has no recording.");
    const lo = z.lowMidi ?? -0.5,
      hi = z.highMidi ?? 127.5;
    if (
      !Number.isFinite(lo) ||
      !Number.isFinite(hi) ||
      lo >= hi ||
      pitch(lo) < -16 * 2 ** 24 ||
      pitch(hi) > 16 * 2 ** 24
    )
      throw Error("Invalid key range.");
    z.lowMidi = lo;
    z.highMidi = hi;
  }
  for (let i = 0; i < zones.length; i++)
    for (let j = 0; j < i; j++) {
      const a = zones[i],
        b = zones[j],
        ka = a.key ?? 65535,
        kb = b.key ?? 65535;
      if (ka !== kb && ka !== 65535 && kb !== 65535) continue;
      if ((a.roundRobin ?? 0) !== (b.roundRobin ?? 0)) continue;
      if (
        a.lowMidi < b.highMidi &&
        b.lowMidi < a.highMidi &&
        (a.velocityLow ?? 1) <= (b.velocityHigh ?? 127) &&
        (b.velocityLow ?? 1) <= (a.velocityHigh ?? 127)
      )
        throw Error(
          "Regions overlap without round robin. Split the key/velocity ranges or import a layered source preset to render its layers.",
        );
    }
  // Root compensation must use the same tracking slope as the device. A
  // recording shared by different slopes needs a separate calibrated root.
  const corrected = [], assignment = new Map();
  let maximumCorrection = 0;
  for (let original = 0; original < source.length; ++original) {
    const a = source[original], shift = a.loopPitchShift ?? 0;
    const mapped = zones.filter(z => z.asset === original), groups = new Map();
    for (const z of mapped) {
      const track = z.fixed ? 0 : Math.round((z.keyTrack ?? 1) * 100) / 100;
      if (!Number.isFinite(track) || track < 0 || track > 2) throw Error("Invalid key tracking.");
      if (z.keyTrack !== undefined) z.keyTrack = track;
      const key = Math.abs(shift) > 1e-12 ? track : 1;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(z);
    }
    if (!groups.size) groups.set(1, []);
    for (const [track, members] of groups) {
      const rootMidi = a.rootMidi + (track ? shift / track : 0);
      if (!Number.isFinite(rootMidi) || pitch(rootMidi) < 0 || pitch(rootMidi) > 16 * 2 ** 24) throw Error("Loop pitch correction exceeds the supported root range. Use normal key tracking or a longer loop.");
      const id = corrected.length; corrected.push({ ...a, rootMidi });
      members.forEach(z => assignment.set(z, id));
      if (!track && Math.abs(shift) * 100 > .01) throw Error(`Fixed-pitch loop ${a.name} would detune by ${Math.abs(shift * 100).toFixed(3)} cents when converted to 44.1 kHz. Use pitched key tracking or a longer loop; export stopped to preserve pitch.`);
      else maximumCorrection = Math.max(maximumCorrection, Math.abs(shift * 100));
    }
  }
  if (corrected.length > 128) throw Error("Loop pitch calibration needs more than 128 recordings. Use fewer tracking slopes.");
  source = corrected; zones = zones.map(z => ({ ...z, asset: assignment.get(z) }));
  if (maximumCorrection > .01) warnings.push(`Calibrated short-loop rounding by up to ${maximumCorrection.toFixed(3)} cents; loop repetition pitch is preserved.`);
  const estimate = source.reduce(
      (n, a) => n + a.channels[0].length * a.channels.length * 4,
      0,
    ),
    region = source.some(
      (a) =>
        (a.mode === 1 || a.mode === 3) &&
        (a.loopStart !== 0 || a.loopEnd !== a.channels[0].length),
    );
  const streaming =
    input.storage === "streaming" ||
    (input.storage !== "resident" && (estimate > 5.5 * 1048576 || region));
  if (input.storage === "resident" && region)
    throw Error("Region loops require the SD instrument profile.");
  const assets = [],
    newZones = [];
  if (quality === "character")
    warnings.push(
      "Character mode allows audible aliasing during upward stretching. Pitch copies still keep the reader within its safe rate.",
    );
  if (streaming) {
    if (source.some((a) => a.channels.length > 1))
      warnings.push(
        "Stereo recordings are downmixed to mono for the SD instrument.",
      );
    for (let original = 0; original < source.length; original++) {
      const a = source[original],
        originalZones = zones.filter((z) => z.asset === original);
      if (!originalZones.length) continue;
      const covered = new Map(originalZones.map((z) => [z, z.lowMidi]));
      for (let level = 0; level < 12; level++) {
        const looped = a.mode === 1 || a.mode === 3,
          len = looped ? a.loopEnd - a.loopStart : 0,
          factor =
            level === 0
              ? 1
              : looped
                ? Math.max(1, Math.ceil(len / 2 ** level)) / len
                : 2 ** -level;
        const shift = -12 * Math.log2(factor),
          variantZones = [];
        for (const z of originalZones) {
          const track = z.fixed ? 0 : (z.keyTrack ?? 1),
            max = track ? a.rootMidi + (9.7 + shift) / track : Infinity;
          const start = covered.get(z),
            end = Math.min(z.highMidi, max);
          if (start < end) {
            variantZones.push({ ...z, lowMidi: start, highMidi: end });
            covered.set(z, end);
          }
        }
        if (!variantZones.length && level === 0) continue;
        if (variantZones.length) {
          const variant = level ? convertRate(a, factor) : a;
          let mono = new Float32Array(variant.channels[0].length);
          for (const c of variant.channels)
            for (let i = 0; i < mono.length; i++)
              mono[i] += c[i] / variant.channels.length;
          const track =
            variantZones.find((z) => !z.fixed && (z.keyTrack ?? 1) > 0)
              ?.keyTrack ?? 1;
          if (variantZones.some((z) => !z.fixed && (z.keyTrack ?? 1) !== track))
            throw Error(
              "Split zones with different key tracking before export.",
            );
          const root = a.rootMidi + shift / (track || 1),
            maxRate = Math.max(
              ...variantZones.map((z) =>
                z.fixed
                  ? 1
                  : 2 **
                    (((z.highMidi - root) * (z.keyTrack ?? 1) +
                      (quality === "clean" ? 2.25 : 0)) /
                      12),
              ),
            ),
            cutoff =
              quality === "character" ? 0.46 : 0.46 / Math.max(1, maxRate);
          const filtered = lowpass(mono, cutoff);
          if (looped) {
            const loop = lowpass(
              mono.subarray(variant.loopStart, variant.loopEnd),
              cutoff,
              true,
            );
            filtered.set(loop, variant.loopStart);
          }
          const id = assets.length;
          if (id >= 128)
            throw Error(
              "Pitch protection requires more than 128 recordings. Narrow the range or reduce velocity layers.",
            );
          assets.push({
            ...variant,
            name: a.name,
            rootMidi: root,
            channels: [filtered],
            levels: [filtered],
            firstLevel: id,
          });
          variantZones.forEach((z) => newZones.push({ ...z, asset: id }));
        }
        if (originalZones.every((z) => covered.get(z) >= z.highMidi)) break;
        await tick();
      }
      if (originalZones.some((z) => covered.get(z) < z.highMidi))
        throw Error(
          "This key range exceeds the available protected sample levels. Narrow it or resample the preset.",
        );
      onProgress({
        asset: original,
        total: source.length,
        level: 0,
        label: `Preparing ${a.name}`,
      });
      await tick();
    }
    zones = newZones;
  } else {
    let nextLevel = 0;
    for (let i = 0; i < source.length; i++) {
      const a = source[i],
        levels = [a.channels];
      while (levels.length < 12 && levels.at(-1)[0].length > 4) {
        levels.push(downsample(levels.at(-1), a.mode === 1 || a.mode === 3));
        onProgress({
          asset: i,
          total: source.length,
          level: levels.length,
          label: `Preparing ${a.name}`,
        });
        await tick();
      }
      assets.push({ ...a, levels, firstLevel: nextLevel });
      nextLevel += levels.length;
    }
  }
  if (zones.length > 256)
    throw Error(
      "Pitch protection requires more than 256 zones. Narrow the map or reduce layers.",
    );
  let peak = 0;
  for (const a of assets)
    for (const data of a.levels)
      for (const c of streaming ? [data] : data)
        for (const x of c) peak = Math.max(peak, Math.abs(x));
  const headroom = Math.min(1, 0.98 / (peak || 1));
  let count = 0;
  const encoded = assets.map((a, ai) => {
    let localPeak = 0;
    if (a.normalize)
      for (const level of a.levels)
        for (const c of streaming ? [level] : level)
          for (const x of c) localPeak = Math.max(localPeak, Math.abs(x));
    const gain = a.normalize ? 0.95 / (localPeak || 1) : headroom;
    const levels = a.levels.map((raw, li) => {
      const cs = streaming ? [raw] : raw,
        frames = cs[0].length,
        pcm = new Int16Array(frames * cs.length);
      let seed = ((ai + 1) * 0x12345 + li + 1) >>> 0;
      const rand = () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return (seed >>> 0) / 4294967296;
      };
      for (let n = 0; n < frames; n++)
        for (let c = 0; c < cs.length; c++)
          pcm[n * cs.length + c] = clamp(
            Math.round(cs[c][n] * gain * 32768 + (rand() - rand()) * 0.5),
            -32768,
            32767,
          );
      return pcm;
    });
    const out = { ...a, firstLevel: count, levels };
    count += levels.length;
    return out;
  });
  const residentBytes = encoded.reduce(
    (n, a) => n + a.levels.reduce((x, p) => x + p.byteLength, 0),
    0,
  );
  if (!streaming && residentBytes > 5.5 * 1048576)
    throw Error(
      "This stereo instrument exceeds memory. Choose automatic or SD export.",
    );
  const quantum = streaming ? 4096 : 512,
    pages = streaming
      ? encoded.reduce(
          (n, a) => n + align(a.levels[0].byteLength, 4096) / 4096,
          0,
        )
      : 0;
  if (pages > 65535)
    throw Error("This instrument exceeds the 256 MiB SD bank limit.");
  const base = 128 + encoded.length * 48 + count * 16 + zones.length * 48,
    metadata = align(base + pages * 4 + 184, quantum),
    total =
      metadata +
      encoded.reduce(
        (n, a) =>
          n + a.levels.reduce((m, p) => m + align(p.byteLength, quantum), 0),
        0,
      ),
    bytes = new Uint8Array(total),
    v = new DataView(bytes.buffer),
    u16 = (at, x) => v.setUint16(at, x, true),
    u32 = (at, x) => v.setUint32(at, x, true);
  u32(0, 0x32534248);
  u16(4, 3);
  u16(6, 128);
  u32(8, rate);
  u16(12, encoded.length);
  u16(14, count);
  u16(16, zones.length);
  u16(18, 2 | +streaming);
  u32(20, total);
  u32(24, metadata);
  u32(40, pages);
  u32(44, +streaming);
  [
    settings.attack,
    settings.decay,
    settings.sustain * 65535,
    settings.release,
    settings.cutoff,
    ((settings.resonance - 0.5) / 3.5) * 65535,
    settings.pressure * 65535,
    settings.space * 65535,
  ].forEach((n, i) => u16(48 + i * 2, Math.round(n)));
  bytes.set(
    new TextEncoder().encode(input.name ?? "New instrument").slice(0, 32),
    64,
  );
  [
    settings.fastRelease,
    settings.releaseResponse * 65535,
    ((settings.releaseCurve - 0.25) / 3.75) * 65535,
    settings.pedalRelease,
    settings.pressureGain * 65535,
  ].forEach((n, i) => u16(96 + i * 2, Math.round(n)));
  let pcmAt = metadata,
    levelIndex = 0,
    pageIndex = 0;
  encoded.forEach((a, i) => {
    const at = 128 + i * 48;
    u32(at, a.channels[0].length);
    u32(at + 4, pitch(a.rootMidi));
    u32(at + 8, a.loopStart);
    u32(at + 12, a.loopEnd);
    u16(at + 20, a.firstLevel);
    u16(at + 22, a.levels.length);
    bytes[at + 24] = a.channels.length;
    bytes[at + 25] = a.mode;
    for (const pcm of a.levels) {
      const record = 128 + encoded.length * 48 + levelIndex++ * 16;
      u32(record, pcmAt);
      u32(record + 4, pcm.length / a.channels.length);
      const data = new Uint8Array(pcm.buffer);
      bytes.set(data, pcmAt);
      u32(record + 8, crc32(data));
      if (streaming)
        for (let p = 0; p < align(data.length, 4096); p += 4096)
          u32(
            base + pageIndex++ * 4,
            crc32(bytes.subarray(pcmAt + p, pcmAt + p + 4096)),
          );
      pcmAt += align(data.length, quantum);
    }
  });
  zones.forEach((z, i) => {
    const vl = z.velocityLow ?? 1,
      vh = z.velocityHigh ?? 127,
      key = z.key ?? 65535,
      gain = z.gain ?? 1,
      pan = z.pan ?? 0,
      track = z.keyTrack ?? 1,
      attack = z.attack ?? settings.attack,
      release = z.release ?? settings.release,
      cutoff = z.cutoff ?? 20000,
      curve = z.velocityCurve ?? 0;
    if (
      ![
        gain,
        pan,
        track,
        attack,
        release,
        cutoff,
        z.decay ?? 0,
        z.sustain ?? 1,
        z.delay ?? 0,
        z.hold ?? 0,
      ].every(Number.isFinite) ||
      (z.decay ?? 0) < 0 ||
      (z.decay ?? 0) > 20000 ||
      (z.sustain ?? 1) < 0 ||
      (z.sustain ?? 1) > 1 ||
      (z.delay ?? 0) < 0 ||
      (z.delay ?? 0) > 10000 ||
      (z.hold ?? 0) < 0 ||
      (z.hold ?? 0) > 20000 ||
      !Number.isInteger(z.choke ?? 0) ||
      (z.choke ?? 0) < 0 ||
      (z.choke ?? 0) > 16 ||
      !Number.isInteger(z.roundRobin ?? 0) ||
      (z.roundRobin ?? 0) < 0 ||
      (z.roundRobin ?? 0) > 15 ||
      !Number.isInteger(vl) ||
      !Number.isInteger(vh) ||
      vl < 1 ||
      vl > vh ||
      vh > 127 ||
      !Number.isInteger(key) ||
      !(key === 65535 || (key >= 0 && key < 133)) ||
      !Number.isFinite(gain) ||
      gain < 0 ||
      gain >= 2 ||
      !Number.isFinite(pan) ||
      Math.abs(pan) > 1 ||
      !Number.isFinite(track) ||
      track < 0 ||
      track > 2 ||
      attack < 0 ||
      attack > 10000 ||
      release < 0 ||
      release > 20000 ||
      cutoff < 40 ||
      cutoff > 20000 ||
      !Number.isInteger(curve) ||
      curve < 0 ||
      curve > 103
    )
      throw Error("A zone exceeds the device range.");
    const at = 128 + encoded.length * 48 + count * 16 + i * 48;
    u32(at, pitch(z.lowMidi));
    u32(at + 4, pitch(z.highMidi) - 1);
    u16(at + 8, z.asset);
    u16(at + 10, key);
    bytes[at + 12] = vl;
    bytes[at + 13] = vh;
    bytes[at + 14] = z.choke ?? 0;
    bytes[at + 15] = z.roundRobin ?? 0;
    u16(at + 16, Math.round(gain * 32768));
    v.setInt16(at + 18, Math.round(pan * 32767), true);
    bytes[at + 20] = +!!z.fixed;
    if (z.color) {
      if (!/^#[0-9a-f]{6}$/i.test(z.color) || key === 65535)
        throw Error("Key colors need a mapped key.");
      const rgb = parseInt(z.color.slice(1), 16);
      bytes[at + 21] = rgb >>> 16;
      bytes[at + 22] = rgb >>> 8;
      bytes[at + 23] = rgb;
      bytes[at + 24] = 1;
    }
    u16(at + 25, Math.round(attack));
    u16(at + 27, Math.round(release));
    u16(at + 29, Math.round(cutoff));
    bytes[at + 31] = curve;
    u16(at + 32, z.decay === undefined ? 65535 : Math.round(z.decay));
    u16(at + 34, Math.round((z.sustain ?? 1) * 65535));
    u16(at + 36, Math.round(z.delay ?? 0));
    u16(at + 38, Math.round(z.hold ?? 0));
    u16(at + 40, Math.round(track * 100));
  });
  bytes.set(perf, base + pages * 4);
  u32(28, crc32(bytes.subarray(128, metadata)));
  u32(32, crc32(bytes.subarray(metadata)));
  u32(36, crc32(bytes.subarray(0, 128)));
  return {
    bytes,
    assets: encoded.map((a) => ({
      name: a.name,
      frames: a.channels[0].length,
      levels: a.levels.length,
      channels: a.channels.length,
    })),
    sourceBytes: source.reduce(
      (n, a) => n + a.channels[0].length * a.channels.length * 2,
      0,
    ),
    residentBytes,
    streaming,
    warnings,
  };
}
