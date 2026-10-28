// Pure browser/Node preparation. No WebAudio resampling assumptions; output
// duration and each level's source-time scale are explicit in HBS2.
export const rate = 44100,
  magic = 0x32534248;
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  return c >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 255];
  return ~crc >>> 0;
}
const align = (n) => Math.ceil(n / 512) * 512;
const sinc = (x) =>
  Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
function window(x) {
  return (
    0.35875 +
    0.48829 * Math.cos(Math.PI * x) +
    0.14128 * Math.cos(2 * Math.PI * x) +
    0.01168 * Math.cos(3 * Math.PI * x)
  );
}
function wrap(n, length) {
  return ((n % length) + length) % length;
}
export function downsample(channels, periodic = false) {
  const length = channels[0].length,
    out = channels.map(() => new Float32Array(Math.ceil(length / 2))),
    half = 128,
    weights = [];
  let sum = 0;
  for (let k = -half; k <= half; k++) {
    const w = 0.45 * sinc(0.45 * k) * window(k / half);
    weights.push(w);
    sum += w;
  }
  for (let c = 0; c < channels.length; c++)
    for (let n = 0; n < out[c].length; n++) {
      let v = 0;
      if (periodic) {
        const position = (n * length) / out[c].length,
          center = Math.floor(position),
          cutoff = (0.45 * out[c].length) / length;
        let norm = 0;
        for (let k = center - half; k <= center + half; k++) {
          const d = k - position,
            w = 2 * cutoff * sinc(2 * cutoff * d) * window(d / half);
          v += channels[c][wrap(k, length)] * w;
          norm += w;
        }
        out[c][n] = v / norm;
      } else {
        for (let k = -half; k <= half; k++) {
          const i = 2 * n + k;
          v += (i >= 0 && i < length ? channels[c][i] : 0) * weights[k + half];
        }
        out[c][n] = v / sum;
      }
    }
  return out;
}
export function resample(channels, inputRate, periodic = false) {
  if (
    !Number.isFinite(inputRate) ||
    inputRate < 100 ||
    inputRate > 44100 * 4096 ||
    channels.length < 1 ||
    channels.length > 2 ||
    channels.some(
      (c) =>
        !(c instanceof Float32Array) ||
        c.length !== channels[0].length ||
        c.some((v) => !Number.isFinite(v)),
    )
  )
    throw Error("Invalid recording.");
  if (inputRate === rate) return channels.map((c) => c.slice());
  const length = Math.round((channels[0].length * rate) / inputRate),
    out = channels.map(() => new Float32Array(length)),
    cutoff = 0.46 * Math.min(1, rate / inputRate),
    radius = Math.ceil(64 / Math.min(1, rate / inputRate));
  for (let n = 0; n < length; n++) {
    const at = (n * inputRate) / rate,
      center = Math.floor(at);
    let norm = 0;
    const sums = channels.map(() => 0);
    for (let k = center - radius; k <= center + radius; k++) {
      const d = k - at,
        w = 2 * cutoff * sinc(2 * cutoff * d) * window(d / radius);
      norm += w;
      for (let c = 0; c < channels.length; c++)
        sums[c] +=
          (periodic
            ? channels[c][wrap(k, channels[c].length)]
            : k >= 0 && k < channels[c].length
              ? channels[c][k]
              : 0) * w;
    }
    for (let c = 0; c < out.length; c++) out[c][n] = sums[c] / norm;
  }
  return out;
}
export function wav(bytes) {
  const v = new DataView(bytes),
    tag = (at) => String.fromCharCode(...new Uint8Array(bytes, at, 4));
  if (
    v.byteLength < 12 ||
    tag(0) !== "RIFF" ||
    tag(8) !== "WAVE" ||
    v.getUint32(4, true) + 8 > v.byteLength
  )
    throw Error("Choose a complete PCM or float WAV file.");
  let fmt, data, loopStart, loopEnd, rootMidi;
  for (let at = 12; at + 8 <= v.byteLength; ) {
    const size = v.getUint32(at + 4, true),
      end = at + 8 + size;
    if (end > v.byteLength) throw Error("Truncated WAV chunk.");
    if (tag(at) === "fmt ") {
      if (size < 16) throw Error("Invalid WAV format.");
      fmt = {
        kind: v.getUint16(at + 8, true),
        channels: v.getUint16(at + 10, true),
        rate: v.getUint32(at + 12, true),
        block: v.getUint16(at + 20, true),
        bits: v.getUint16(at + 22, true),
      };
    }
    if (tag(at) === "data") data = { at: at + 8, size };
    if (tag(at) === "smpl") {
      if (size < 36) throw Error("Truncated WAV sampler metadata.");
      rootMidi =
        v.getUint32(at + 20, true) + v.getUint32(at + 24, true) / 4294967296;
      const count = v.getUint32(at + 36, true);
      if (size < 36 + count * 24) throw Error("Truncated WAV loop metadata.");
      if (count) {
        if (
          v.getUint32(at + 48, true) !== 0 ||
          v.getUint32(at + 60, true) !== 0 ||
          v.getUint32(at + 64, true) !== 0
        )
          throw Error("Only infinite forward WAV loops are supported.");
        loopStart = v.getUint32(at + 52, true);
        loopEnd = v.getUint32(at + 56, true) + 1;
      }
    }
    at = end + (size & 1);
  }
  // Public multisample libraries commonly use WAVE_FORMAT_EXTENSIBLE for
  // ordinary stereo PCM24. Validate its GUID and channel layout explicitly.
  if (fmt?.kind === 65534) {
    let at = 12;
    while (at + 8 <= v.byteLength && tag(at) !== "fmt ")
      at += 8 + v.getUint32(at + 4, true) + (v.getUint32(at + 4, true) & 1);
    const size = v.getUint32(at + 4, true),
      base = at + 8,
      tail = [0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113];
    if (
      size < 40 ||
      v.getUint16(base + 16, true) !== 22 ||
      v.getUint16(base + 18, true) !== fmt.bits ||
      tail.some((x, i) => v.getUint8(base + 26 + i) !== x) ||
      ![0, fmt.channels === 1 ? 4 : 3].includes(v.getUint32(base + 20, true))
    )
      throw Error("Unsupported extensible WAV layout.");
    fmt.kind = v.getUint16(base + 24, true);
  }
  if (
    !fmt ||
    !data ||
    ![1, 2].includes(fmt.channels) ||
    !(
      (fmt.kind === 1 && [16, 24, 32].includes(fmt.bits)) ||
      (fmt.kind === 3 && fmt.bits === 32)
    ) ||
    fmt.block !== (fmt.channels * fmt.bits) / 8 ||
    data.size % fmt.block
  )
    throw Error("Use mono/stereo PCM16, PCM24, PCM32 or float32 WAV.");
  const channels = Array.from(
    { length: fmt.channels },
    () => new Float32Array(data.size / fmt.block),
  );
  for (let n = 0; n < channels[0].length; n++)
    for (let c = 0; c < fmt.channels; c++) {
      const at = data.at + n * fmt.block + (c * fmt.bits) / 8;
      let value;
      if (fmt.kind === 3) value = v.getFloat32(at, true);
      else if (fmt.bits === 16) value = v.getInt16(at, true) / 32768;
      else if (fmt.bits === 32) value = v.getInt32(at, true) / 2147483648;
      else {
        let x =
          v.getUint8(at) |
          (v.getUint8(at + 1) << 8) |
          (v.getUint8(at + 2) << 16);
        if (x & 0x800000) x -= 0x1000000;
        value = x / 8388608;
      }
      if (!Number.isFinite(value))
        throw Error("Recording contains invalid samples.");
      channels[c][n] = value;
    }
  if (
    loopEnd !== undefined &&
    (!(loopEnd > loopStart) || loopEnd > channels[0].length)
  )
    throw Error("WAV loop exceeds recording.");
  return { channels, rate: fmt.rate, loopStart, loopEnd, rootMidi };
}
const logPitch = (midi) =>
  Math.round((Math.log2(440) + (midi - 69) / 12) * 2 ** 24);
export function suggestRoot(channels) {
  // Advisory autocorrelation only. Anti-aliasing never depends on this result.
  const data = channels[0],
    count = Math.min(8192, data.length),
    begin = Math.min(
      Math.floor(data.length * 0.1),
      Math.max(0, data.length - count),
    );
  if (count < 1024) return undefined;
  let best = 0,
    lag = 0;
  for (let k = 22; k <= Math.min(1102, Math.floor(count / 3)); k++) {
    let cross = 0,
      a = 0,
      b = 0;
    for (let i = 0; i < count - k; i += 2) {
      const x = data[begin + i],
        y = data[begin + i + k];
      cross += x * y;
      a += x * x;
      b += y * y;
    }
    const score = cross / Math.sqrt(a * b + 1e-30);
    if (score > best) {
      best = score;
      lag = k;
    }
    if (best > 0.98 && k > lag * 1.1) break;
  }
  if (best < 0.85) return undefined;
  const hz = rate / lag;
  return { midi: 69 + 12 * Math.log2(hz / 440), confidence: best };
}
export { preparePatch } from "./encode.mjs";
