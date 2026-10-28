import { crc32, resample } from "./prepare.mjs";
import { trimRecording, crossfadeRecording, defaults, defaultPerformance } from "./encode.mjs";

export const compactLimits = Object.freeze({ pcmBytes: 49152, assets: 16, zones: 32, slots: 32, voices: 8 });
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
function shrink(a) {
  const periodic = a.mode === 1 || a.mode === 3;
  let factor = .5, loop;
  if (periodic) {
    const length = a.loopEnd - a.loopStart, frames = Math.max(2, Math.round(length / 2));
    if (frames >= length) throw Error("This short loop cannot be reduced further.");
    factor = frames / length;
    loop = resample(a.channels.map(c => c.subarray(a.loopStart, a.loopEnd)), 44100 / factor, true);
  }
  const channels = resample(a.channels, 44100 / factor, false), start = periodic ? Math.round(a.loopStart * factor) : 0;
  const end = periodic ? start + loop[0].length : 0;
  const out = channels.map((c, i) => {
    const data = new Float32Array(Math.max(2, c.length, end)); data.set(c);
    if (loop) data.set(loop[i], start);
    return data;
  });
  return { ...a, channels: out, start: 0, end: out[0].length, rate: a.rate * factor, loopStart: start, loopEnd: end };
}
export function readCompactPatch(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 64) throw Error("Incomplete Classic instrument.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), assets = [], zones = [];
  const count=v.getUint16(24,true), regions=v.getUint16(26,true), frames=v.getUint32(12,true), metadata=64+count*32+regions*48;
  if (String.fromCharCode(...bytes.subarray(0,4))!=="HBC1" || v.getUint16(4,true)!==1 || v.getUint16(6,true)!==64 || !count || count>16 || !regions || regions>32 || frames*2>49152 || bytes.length!==metadata+frames*2 || v.getUint32(8,true)!==bytes.length) throw Error("Invalid Classic instrument bounds.");
  const checked=Uint8Array.from(bytes.subarray(0,metadata)), stored=v.getUint32(20,true);checked.fill(0,20,24);
  if(crc32(checked)!==stored||crc32(bytes.subarray(metadata))!==v.getUint32(16,true))throw Error("Classic instrument checksum failed.");
  let end=0;
  for(let i=0;i<count;++i){const at=64+i*32,offset=v.getUint32(at,true),length=v.getUint32(at+4,true),mode=bytes[at+24],loopStart=v.getUint32(at+8,true),loopEnd=v.getUint32(at+12,true),rate=v.getFloat32(at+16,true),root=v.getFloat32(at+20,true);
    if(offset!==end||length<2||offset+length>frames||mode>3||!Number.isFinite(rate)||rate<100||rate>384000||!Number.isFinite(root)||root<1||root>50000||([1,3].includes(mode)?loopStart>=loopEnd||loopEnd>length:loopStart||loopEnd))throw Error("Invalid Classic recording.");
    end+=length;assets.push({name:`Recording ${i+1}`,channels:[Float32Array.from({length},(_,n)=>v.getInt16(metadata+(offset+n)*2,true)/32767)],rate,rootMidi:69+12*Math.log2(root/440),mode,loopStart,loopEnd});
  }
  if(end!==frames)throw Error("Invalid Classic sample pool.");
  for(let i=0;i<regions;++i){const at=64+count*32+i*48;const z={asset:v.getUint16(at,true),velocityLow:bytes[at+2],velocityHigh:bytes[at+3],lowMidi:69+12*Math.log2(v.getFloat32(at+4,true)/440),highMidi:69+12*Math.log2(v.getFloat32(at+8,true)/440),gain:v.getUint16(at+12,true)/32768,keyTrack:v.getUint16(at+14,true)/256,attack:v.getUint16(at+16,true),decay:v.getUint16(at+18,true),sustain:v.getUint16(at+20,true)/65535,release:v.getUint16(at+22,true),delay:v.getUint16(at+24,true),hold:v.getUint16(at+26,true)};
    if(z.asset>=count||!Number.isFinite(z.lowMidi)||!Number.isFinite(z.highMidi)||z.lowMidi>=z.highMidi)throw Error("Invalid Classic region.");zones.push(z);
  }
  return {name:new TextDecoder().decode(bytes.subarray(32,64)).split("\0")[0],assets,zones,settings:{...defaults,space:0,pressure:0,pressureGain:0},performance:defaultPerformance()};
}
export async function prepareCompactPatch(patch, progress = () => {}) {
  if (!patch?.assets?.length) throw Error("Add a recording first.");
  const warnings = [], settings = { ...defaults, ...patch.settings };
  if (!patch.zones?.length || patch.zones.length > compactLimits.zones) throw Error("Classic requires 1–32 mapped regions.");
  const used = [...new Set(patch.zones.map(z => z.asset))];
  if (used.length > compactLimits.assets) throw Error("Classic supports at most 16 recordings per instrument.");
  let assets = used.map(i => {
    const a = crossfadeRecording(trimRecording(patch.assets[i]));
    if (!Number.isFinite(a.rootMidi) || a.rootMidi < -24 || a.rootMidi > 150) throw Error("Invalid root pitch.");
    if (a.channels.length === 2) warnings.push("Stereo recordings were downmixed to mono.");
    const mono = Float32Array.from(a.channels[0], (x, n) => a.channels.length === 2 ? (x + a.channels[1][n]) / 2 : x);
    if (a.normalize) { let peak = 0; for (const x of mono) peak = Math.max(peak, Math.abs(x)); if (peak) for (let n = 0; n < mono.length; ++n) mono[n] *= .95 / peak; }
    return { ...a, channels: [mono], start: 0, end: mono.length, crossfade: 0 };
  });
  const sourceBytes = assets.reduce((n, a) => n + a.channels[0].length * 2, 0);
  // Reduction is explicit in the report and in the converted audition patch.
  let reductions = 0;
  while (assets.reduce((n, a) => n + a.channels[0].length * 2, 0) > compactLimits.pcmBytes) {
    if (++reductions > 5) throw Error("This instrument cannot fit Classic sample RAM. Trim recordings or use fewer regions.");
    assets = assets.map(a => shrink(a));
  }
  if (reductions) warnings.push(`Reduced source rates in ${reductions} pass${reductions === 1 ? "" : "es"} to fit 48 KiB sample RAM; audition the converted instrument.`);
  warnings.push("Classic uses mono linear interpolation and eight shared voice slots. Tone filters, pressure, room reverb and patch response/arp recall are omitted; board tuning, bends and arpeggiator remain available.");
  const zones = patch.zones.map(z => {
    if (z.key !== undefined || z.fixed || z.roundRobin || z.choke) throw Error("Classic currently supports pitched instruments. Remove fixed-key, round-robin and choke mappings.");
    const r = { ...z, asset: used.indexOf(z.asset), lowMidi: z.lowMidi ?? -.5, highMidi: z.highMidi ?? 127.5,
      velocityLow: z.velocityLow ?? 1, velocityHigh: z.velocityHigh ?? 127,
      gain: z.gain ?? 1, keyTrack: z.keyTrack ?? 1, attack: z.attack ?? settings.attack,
      decay: z.decay ?? settings.decay, sustain: z.sustain ?? settings.sustain,
      release: Math.max(4, z.release ?? settings.release), delay: z.delay ?? 0, hold: z.hold ?? 0,
      pan: 0, cutoff: 20000 };
    for (const k of ["lowMidi", "highMidi", "gain", "keyTrack", "attack", "decay", "sustain", "release", "delay", "hold"]) if (!Number.isFinite(r[k])) throw Error(`Invalid region ${k}.`);
    if (r.lowMidi >= r.highMidi || r.lowMidi < -60 || r.highMidi > 150 || r.gain < 0 || r.gain >= 2 || r.keyTrack < 0 || r.keyTrack > 2 || r.attack < 0 || r.attack > 10000 || r.decay < 0 || r.decay > 20000 || r.sustain < 0 || r.sustain > 1 || r.release > 20000 || r.delay < 0 || r.delay > 10000 || r.hold < 0 || r.hold > 20000 || !Number.isInteger(r.velocityLow) || !Number.isInteger(r.velocityHigh) || r.velocityLow < 1 || r.velocityHigh > 127 || r.velocityLow > r.velocityHigh) throw Error("Region exceeds Classic limits.");
    r.keyTrack = Math.round(r.keyTrack * 256) / 256;
    const a = assets[r.asset];
    if (r.keyTrack > 0) {
      const maxMidi = a.rootMidi + 12 * Math.log2(63.99 * 40690 / a.rate) / r.keyTrack;
      const minMidi = a.rootMidi + 12 * Math.log2(40690 / (65536 * a.rate)) / r.keyTrack;
      const low = Math.max(r.lowMidi, minMidi), high = Math.min(r.highMidi, maxMidi);
      if (low >= high) throw Error("This region lies outside Classic’s playback range. Adjust its root pitch or sample rate.");
      if (low !== r.lowMidi || high !== r.highMidi) warnings.push(`Limited a region’s playable range to MIDI ${low.toFixed(1)}–${high.toFixed(1)} for Classic. Notes outside its map remain silent.`);
      r.lowMidi = low; r.highMidi = high;
    }
    return r;
  });
  for (let i = 0; i < zones.length; ++i) for (let j = 0; j < i; ++j) {
    const a = zones[i], b = zones[j];
    if (a.lowMidi < b.highMidi && b.lowMidi < a.highMidi && a.velocityLow <= b.velocityHigh && b.velocityLow <= a.velocityHigh) throw Error("Classic needs non-overlapping pitch/velocity regions. Convert simultaneous source layers first.");
  }
  const metadata = 64 + assets.length * 32 + zones.length * 48, pcmBytes = assets.reduce((n, a) => n + a.channels[0].length * 2, 0);
  const bytes = new Uint8Array(metadata + pcmBytes), v = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("HBC1")); v.setUint16(4, 1, true); v.setUint16(6, 64, true);
  v.setUint32(8, bytes.length, true); v.setUint32(12, pcmBytes / 2, true); v.setUint16(24, assets.length, true); v.setUint16(26, zones.length, true);
  bytes.set(new TextEncoder().encode((patch.name ?? "Instrument").replace(/[^\x20-\x7e]/g, "_").slice(0, 31)), 32);
  let frame = 0;
  assets.forEach((a, i) => {
    progress({ label: "Preparing Classic samples…", asset: i, total: assets.length, level: 0 });
    if (a.rate < 100 || a.rate > 384000 || !Number.isFinite(a.rate)) throw Error("Converted sample rate exceeds Classic limits.");
    const at = 64 + i * 32;
    v.setUint32(at, frame, true); v.setUint32(at + 4, a.channels[0].length, true);
    v.setUint32(at + 8, a.loopStart ?? 0, true); v.setUint32(at + 12, a.loopEnd ?? 0, true);
    v.setFloat32(at + 16, a.rate, true); v.setFloat32(at + 20, hz(a.rootMidi), true); bytes[at + 24] = a.mode ?? 0;
    for (const x of a.channels[0]) v.setInt16(metadata + frame++ * 2, Math.max(-32768, Math.min(32767, Math.round(x * 32767))), true);
  });
  zones.forEach((z, i) => {
    const at = 64 + assets.length * 32 + i * 48;
    v.setUint16(at, z.asset, true); bytes[at + 2] = z.velocityLow; bytes[at + 3] = z.velocityHigh;
    v.setFloat32(at + 4, hz(z.lowMidi), true); v.setFloat32(at + 8, hz(z.highMidi), true);
    v.setUint16(at + 12, Math.min(65535, Math.round(z.gain * 32768)), true); v.setUint16(at + 14, Math.round(z.keyTrack * 256), true);
    for (const [offset, value] of [[16,z.attack],[18,z.decay],[20,z.sustain*65535],[22,z.release],[24,z.delay],[26,z.hold]]) v.setUint16(at + offset, Math.round(value), true);
  });
  v.setUint32(16, crc32(bytes.subarray(metadata)), true); v.setUint32(20, crc32(bytes.subarray(0, metadata)), true);
  const auditionPatch = { ...patch, assets, zones, settings: { ...settings, cutoff: 20000, resonance: .5, pressure: 0, pressureGain: 0, space: 0, releaseResponse: 0 }, performance: defaultPerformance() };
  return { bytes, assets: assets.map(a => ({name:a.name,frames:a.channels[0].length,levels:1,channels:1})), sourceBytes, residentBytes: pcmBytes, streaming: false, warnings: [...new Set(warnings)], auditionPatch };
}
