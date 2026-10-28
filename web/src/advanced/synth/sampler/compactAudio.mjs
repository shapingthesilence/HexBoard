// Host-only preparation for Classic's shared 48 KiB PCM workspace.
import { resample } from "./prepare.mjs";

const hz = midi => 440 * 2 ** ((midi - 69) / 12);
const power = data => data.reduce((sum, x) => sum + x * x, 0) / data.length;
const peak = data => data.reduce((value, x) => Math.max(value, Math.abs(x)), 0);
const periodic = a => a.mode === 1 || a.mode === 3;

export function monoRecording(a, warnings) {
  let mono = a.channels[0].slice();
  if (a.channels.length === 2) {
    const left = power(mono), right = power(a.channels[1]);
    mono = Float32Array.from(mono, (x, i) => (x + a.channels[1][i]) / 2);
    const mixed = power(mono), reference = (left + right) / 2;
    if (reference && mixed < reference / 4) {
      mono = a.channels[left >= right ? 0 : 1].slice();
      warnings.push("Used the stronger stereo channel where mono mixing would cancel the sound.");
    } else if (mixed) {
      const gain = Math.min(Math.sqrt(reference / mixed), 10 ** (3 / 20), .98 / peak(mono));
      if (gain > 1) mono = mono.map(x => x * gain);
    }
    warnings.push("Stereo recordings were downmixed to mono with level protection.");
  }
  return { ...a, channels: [mono], start: 0, end: mono.length, crossfade: 0 };
}

// Measure several parts of the recording, including its loudest transient.
// A Hann-windowed FFT bounds the rate needed to retain 98% of each significant
// window's energy. Root-pitch protection also reserves several harmonics.
function minimumFactor(a) {
  const data = a.channels[0], size = 2048, half = size / 2;
  let loudest = 0;
  for (let i = 1; i < data.length; ++i) if (Math.abs(data[i]) > Math.abs(data[loudest])) loudest = i;
  const starts = new Set([0, loudest - half, data.length / 4, data.length / 2, data.length - size,
    ...(periodic(a) ? [a.loopStart] : [])].map(n => Math.max(0, Math.min(Math.max(0, data.length - size), Math.round(n)))));
  const spectra = [];
  for (const start of starts) {
    const real = new Float64Array(size), imag = new Float64Array(size);
    for (let i = 0; i < size; ++i) real[i] = (data[start + i] ?? 0) * (.5 - .5 * Math.cos(2 * Math.PI * i / (size - 1)));
    for (let i = 1, j = 0; i < size; ++i) {
      let bit = size >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) [real[i], real[j]] = [real[j], real[i]];
    }
    for (let length = 2; length <= size; length *= 2) {
      const angle = -2 * Math.PI / length, wr = Math.cos(angle), wi = Math.sin(angle);
      for (let offset = 0; offset < size; offset += length) {
        let r = 1, im = 0;
        for (let i = 0; i < length / 2; ++i) {
          const x = offset + i, y = x + length / 2;
          const tr = r * real[y] - im * imag[y], ti = r * imag[y] + im * real[y];
          real[y] = real[x] - tr; imag[y] = imag[x] - ti;
          real[x] += tr; imag[x] += ti;
          const next = r * wr - im * wi; im = r * wi + im * wr; r = next;
        }
      }
    }
    const bins = Float64Array.from({ length: half + 1 }, (_, i) => real[i] ** 2 + imag[i] ** 2);
    spectra.push({ bins, total: bins.reduce((sum, value) => sum + value, 0) });
  }
  const maximum = Math.max(...spectra.map(s => s.total));
  let frequency = 0;
  for (const { bins, total } of spectra) {
    if (!total || total < maximum * .01) continue;
    let sum = 0, bin = 0;
    while (bin < half && sum < total * .98) sum += bins[bin++];
    frequency = Math.max(frequency, (bin + 1) * a.rate / size);
  }
  return Math.min(1, Math.max(100 / a.rate, 6 * hz(a.rootMidi) / a.rate, frequency / (.40 * a.rate)));
}

function plan(a, factor) {
  if (factor >= 1) return { factor: 1, frames: a.channels[0].length, loopStart: a.loopStart, loopEnd: a.loopEnd };
  let loopStart = 0, loopEnd = 0;
  if (periodic(a)) {
    const length = a.loopEnd - a.loopStart;
    const frames = Math.max(2, Math.ceil(length * factor));
    if (frames >= length) return plan(a, 1);
    factor = frames / length;
    loopStart = Math.round(a.loopStart * factor);
    loopEnd = loopStart + frames;
  }
  return { factor, loopStart, loopEnd, frames: Math.max(4, Math.round(a.channels[0].length * factor), loopEnd) };
}

function convert(a, p) {
  if (p.factor === 1) return a;
  const channels = resample(a.channels, 44100 / p.factor, false);
  const data = new Float32Array(p.frames); data.set(channels[0]);
  if (periodic(a)) {
    const loop = resample([a.channels[0].subarray(a.loopStart, a.loopEnd)], 44100 / p.factor, true)[0];
    data.set(loop, p.loopStart);
  }
  return { ...a, channels: [data], rate: a.rate * p.factor, start: 0, end: data.length, loopStart: p.loopStart, loopEnd: p.loopEnd };
}

export function fitCompactRecordings(source, budget, warnings, progress) {
  const frames = assets => assets.reduce((sum, a) => sum + a.channels[0].length, 0);
  let assets = source;
  if (frames(assets) > budget) {
    // Continuous loops never read their trailing data, even after note-off.
    // Loop-until-release recordings retain their audible release tails.
    assets = assets.map(a => {
      if (a.mode !== 1 || a.loopEnd === a.channels[0].length) return a;
      return { ...a, channels: [a.channels[0].slice(0, a.loopEnd)], end: a.loopEnd };
    });
    if (frames(assets) < frames(source)) warnings.push("Removed unreachable data after continuous sustain loops; release tails were retained.");
  }
  if (frames(assets) > budget) {
    const floors = assets.map(minimumFactor);
    const plans = extra => assets.map((a, i) => plan(a, floors[i] + (1 - floors[i]) * extra));
    const count = p => p.reduce((sum, a) => sum + a.frames, 0);
    const minimum = count(plans(0));
    if (minimum > budget) throw Error(`This recording map needs about ${Math.ceil(minimum * 2 / 1024)} KiB of sample RAM at the protected rates; Classic has 48 KiB. Trim long recordings or use fewer recordings / a smaller preset. Conversion stopped before making the sound muffled or nearly silent.`);
    let low = 0, high = 1;
    for (let i = 0; i < 28; ++i) { const mid = (low + high) / 2; if (count(plans(mid)) <= budget) low = mid; else high = mid; }
    const allocation = plans(low);
    let correction = 0;
    assets = assets.map((a, i) => {
      progress({ label: "Preserving tone and level…", asset: i, total: assets.length, level: 0 });
      const converted = convert(a, allocation[i]);
      if (allocation[i].factor === 1) return converted;
      const before = power(a.channels[0]), after = power(converted.channels[0]);
      if (before > 1e-12 && after < before * 10 ** (-1.5 / 10)) throw Error(`“${a.name}” loses too much signal during reduction. Trim the recording or use a smaller preset; conversion stopped to protect its tone and volume.`);
      // Preserve relative recording levels, with a small bounded correction
      // and peak headroom. Never amplify a destroyed high note or noise floor.
      const gain = after ? Math.min(Math.sqrt(before / after), 10 ** (1.5 / 20), .98 / peak(converted.channels[0])) : 1;
      if (gain > 1) {
        converted.channels[0] = converted.channels[0].map(x => x * gain);
        correction = Math.max(correction, 20 * Math.log10(gain));
      }
      return converted;
    });
    warnings.push("Reduced source rates once using a per-recording tone budget; short and high-pitched recordings retain the rates they need.");
    for (let i = 0; i < assets.length; ++i) {
      if (assets[i].rate < source[i].rate) warnings.push(`${assets[i].name}: ${(source[i].rate / 1000).toFixed(1)} → ${(assets[i].rate / 1000).toFixed(1)} kHz.`);
    }
    if (correction >= .05) warnings.push(`Restored up to ${correction.toFixed(1)} dB of reduction loss with peak headroom.`);
  }
  // User-requested normalization belongs after all conversion filters.
  return assets.map(a => {
    if (!a.normalize) return a;
    const maximum = peak(a.channels[0]);
    return maximum ? { ...a, normalize: false, channels: [a.channels[0].map(x => x * .95 / maximum)] } : { ...a, normalize: false };
  });
}
