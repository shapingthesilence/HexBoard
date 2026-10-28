import { crc32 } from "./prepare.mjs";
import { decodePerformance, defaults, defaultPerformance } from "./encode.mjs";
export function readBank(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    u16 = (p) => v.getUint16(p, true),
    u32 = (p) => v.getUint32(p, true),
    midi = (x) => (x / 2 ** 24 - Math.log2(440)) * 12 + 69;
  if (
    bytes.length < 128 ||
    u32(0) !== 0x32534248 ||
    u16(4) !== 3 ||
    u16(6) !== 128 ||
    u32(8) !== 44100 ||
    u32(20) !== bytes.length
  )
    throw Error("Choose a current HBS instrument.");
  const header = bytes.slice(0, 128);
  header.fill(0, 36, 40);
  if (crc32(header) !== u32(36))
    throw Error("Instrument header checksum failed.");
  const a = u16(12),
    l = u16(14),
    z = u16(16),
    flags = u16(18),
    meta = u32(24),
    pages = u32(40),
    end = 128 + a * 48 + l * 16 + z * 48 + pages * 4;
  if (
    !a ||
    a > 128 ||
    !l ||
    l > 1536 ||
    !z ||
    z > 256 ||
    flags & ~3 ||
    end + (flags & 2 ? 184 : 0) > meta ||
    meta > bytes.length ||
    crc32(bytes.subarray(128, meta)) !== u32(28) ||
    crc32(bytes.subarray(meta)) !== u32(32)
  )
    throw Error("Instrument bounds or checksum failed.");
  const assets = Array.from({ length: a }, (_, i) => {
    const p = 128 + i * 48,
      frames = u32(p),
      level = u16(p + 20),
      channels = bytes[p + 24],
      mode = bytes[p + 25],
      r = 128 + a * 48 + level * 16,
      offset = u32(r);
    if (
      level >= l ||
      ![1, 2].includes(channels) ||
      mode > 3 ||
      frames < 4 ||
      offset < meta ||
      offset + frames * channels * 2 > bytes.length ||
      u32(r + 4) !== frames ||
      crc32(bytes.subarray(offset, offset + frames * channels * 2)) !==
        u32(r + 8)
    )
      throw Error("Invalid recording bounds or checksum.");
    return {
      name: `Recording ${i + 1}`,
      channels: Array.from({ length: channels }, (_, c) =>
        Float32Array.from(
          { length: frames },
          (_, n) => v.getInt16(offset + (n * channels + c) * 2, true) / 32768,
        ),
      ),
      rate: 44100,
      rootMidi: midi(v.getInt32(p + 4, true)),
      mode,
      loopStart: u32(p + 8),
      loopEnd: u32(p + 12),
    };
  });
  const zones = Array.from({ length: z }, (_, i) => {
    const p = 128 + a * 48 + l * 16 + i * 48,
      key = u16(p + 10);
    if (u16(p + 8) >= a) throw Error("Invalid region recording.");
    return {
      asset: u16(p + 8),
      lowMidi: midi(v.getInt32(p, true)),
      highMidi: midi(v.getInt32(p + 4, true) + 1),
      key: key === 65535 ? undefined : key,
      velocityLow: bytes[p + 12],
      velocityHigh: bytes[p + 13],
      choke: bytes[p + 14],
      roundRobin: bytes[p + 15],
      gain: u16(p + 16) / 32768,
      pan: v.getInt16(p + 18, true) / 32767,
      fixed: !!bytes[p + 20],
      color: bytes[p + 24]
        ? "#" +
          Array.from(bytes.subarray(p + 21, p + 24), (x) =>
            x.toString(16).padStart(2, "0"),
          ).join("")
        : undefined,
      attack: u16(p + 25),
      release: u16(p + 27),
      cutoff: u16(p + 29),
      velocityCurve: bytes[p + 31],
      decay: u16(p + 32) === 65535 ? undefined : u16(p + 32),
      sustain: u16(p + 32) === 65535 ? undefined : u16(p + 34) / 65535,
      delay: u16(p + 36),
      hold: u16(p + 38),
      keyTrack: u16(p + 40) / 100,
    };
  });
  const performance =
    flags & 2
      ? decodePerformance(bytes.subarray(end, end + 184))
      : { velocityEngine: 0, performance: defaultPerformance() };
  return {
    name: new TextDecoder()
      .decode(bytes.subarray(64, 96))
      .replace(/\0.*$/s, ""),
    assets,
    zones,
    settings: {
      ...defaults,
      attack: u16(48),
      decay: u16(50),
      sustain: u16(52) / 65535,
      release: u16(54),
      cutoff: u16(56),
      resonance: 0.5 + (u16(58) / 65535) * 3.5,
      pressure: u16(60) / 65535,
      space: u16(62) / 65535,
      fastRelease: u16(96),
      releaseResponse: u16(98) / 65535,
      releaseCurve: 0.25 + (u16(100) / 65535) * 3.75,
      pedalRelease: u16(102),
      pressureGain: u16(104) / 65535,
    },
    ...performance,
    preparedSource: bytes,
  };
}
