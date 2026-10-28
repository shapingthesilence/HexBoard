#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>

// HBC1: bounded, native-rate mono PCM16. No Arduino or storage dependencies.
namespace CompactSampler {
constexpr unsigned kHeader = 64, kAsset = 32, kZone = 48;
constexpr unsigned kAssets = 16, kZones = 32, kPcmBytes = 49152, kSlots = 32;
constexpr unsigned kMetadata = kHeader + kAssets * kAsset + kZones * kZone;
constexpr unsigned kFileBytes = kMetadata + kPcmBytes;
inline uint16_t u16(const uint8_t* p) { return p[0] | (uint16_t(p[1]) << 8); }
inline uint32_t u32(const uint8_t* p) { return u16(p) | (uint32_t(u16(p + 2)) << 16); }
inline float f32(const uint8_t* p) { uint32_t n = u32(p); float f; memcpy(&f, &n, 4); return f; }
inline uint32_t crcUpdate(uint32_t crc, const uint8_t* p, size_t n) {
  while (n--) { crc ^= *p++; for (unsigned i = 0; i < 8; ++i) crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1))); }
  return crc;
}
struct Asset {
  uint32_t offset = 0, frames = 0, loopStart = 0, loopEnd = 0;
  float rate = 0, rootHz = 0;
  uint8_t mode = 0;
};
struct Zone {
  float low = 0, high = 0;
  uint16_t asset = 0, gain = 32768, track = 256;
  uint16_t attack = 0, decay = 0, sustain = 65535, release = 0, delay = 0, hold = 0;
  uint8_t velocityLow = 1, velocityHigh = 127;
};
struct Directory {
  uint32_t total = 0, frames = 0, pcmCrc = 0;
  uint16_t assets = 0, zones = 0;
  char name[32] = {};
  Asset recordings[kAssets];
  Zone regions[kZones];
  unsigned metadataBytes() const { return kHeader + assets * kAsset + zones * kZone; }
  bool decode(const uint8_t* p, size_t n) {
    if (n < kHeader || memcmp(p, "HBC1", 4) || u16(p + 4) != 1 || u16(p + 6) != kHeader || u32(p + 28)) return false;
    assets = u16(p + 24); zones = u16(p + 26); total = u32(p + 8); frames = u32(p + 12); pcmCrc = u32(p + 16);
    if (!assets || assets > kAssets || !zones || zones > kZones || !frames || frames > kPcmBytes / 2 || n != metadataBytes() || total != n + frames * 2) return false;
    uint32_t crc = crcUpdate(~0u, p, 20); const uint8_t zero[4] = {};
    crc = crcUpdate(crc, zero, 4); crc = crcUpdate(crc, p + 24, n - 24);
    if (~crc != u32(p + 20) || !memchr(p + 32, 0, 32)) return false;
    for (unsigned i = 32; i < 64; ++i) if (p[i] > 126 || (p[i] && p[i] < 32)) return false;
    memcpy(name, p + 32, 32);
    uint32_t end = 0;
    for (unsigned i = 0; i < assets; ++i) {
      const uint8_t* b = p + kHeader + i * kAsset; Asset& a = recordings[i];
      a.offset = u32(b); a.frames = u32(b + 4); a.loopStart = u32(b + 8); a.loopEnd = u32(b + 12);
      a.rate = f32(b + 16); a.rootHz = f32(b + 20); a.mode = b[24];
      if (a.offset != end || a.frames < 2 || a.frames > frames - end || !std::isfinite(a.rate) || a.rate < 100 || a.rate > 384000 || !std::isfinite(a.rootHz) || a.rootHz < 1 || a.rootHz > 50000 || a.mode > 3) return false;
      if (a.mode == 1 || a.mode == 3) { if (a.loopStart >= a.loopEnd || a.loopEnd > a.frames) return false; }
      else if (a.loopStart || a.loopEnd) return false;
      for (unsigned j = 25; j < kAsset; ++j) if (b[j]) return false;
      end += a.frames;
    }
    if (end != frames) return false;
    for (unsigned i = 0; i < zones; ++i) {
      const uint8_t* b = p + kHeader + assets * kAsset + i * kZone; Zone& z = regions[i];
      z.asset = u16(b); z.velocityLow = b[2]; z.velocityHigh = b[3]; z.low = f32(b + 4); z.high = f32(b + 8);
      z.gain = u16(b + 12); z.track = u16(b + 14); z.attack = u16(b + 16); z.decay = u16(b + 18); z.sustain = u16(b + 20); z.release = u16(b + 22); z.delay = u16(b + 24); z.hold = u16(b + 26);
      if (z.asset >= assets || !z.velocityLow || z.velocityLow > z.velocityHigh || z.velocityHigh > 127 || !std::isfinite(z.low) || !std::isfinite(z.high) || z.low <= 0 || z.low >= z.high || z.high > 100000 || z.track > 512 || z.attack > 10000 || z.decay > 20000 || z.release > 20000 || z.delay > 10000 || z.hold > 20000) return false;
      for (unsigned j = 28; j < kZone; ++j) if (b[j]) return false;
      for (unsigned j = 0; j < i; ++j) { const Zone& q = regions[j]; if (z.low < q.high && q.low < z.high && z.velocityLow <= q.velocityHigh && q.velocityLow <= z.velocityHigh) return false; }
    }
    return true;
  }
  int region(float hz, unsigned velocity) const {
    for (unsigned i = 0; i < zones; ++i) { const Zone& z = regions[i]; if (hz >= z.low && hz < z.high && velocity >= z.velocityLow && velocity <= z.velocityHigh) return int(i); }
    return -1;
  }
};

// Core 1 owns readers. Q16.16 positions are bounded by the 24,576-frame pool.
struct Reader {
  uint32_t position = 0;
  bool ended = true, released = false;
  void start() { position = 0; ended = released = false; }
  __attribute__((always_inline)) inline int32_t read(const Asset& a, const int16_t* pool, uint32_t step) {
    if (ended || !step) return 0;
    const bool looping = a.mode == 1 || (a.mode == 3 && !released);
    const uint32_t boundary = looping ? a.loopEnd : a.frames;
    uint32_t index = position >> 16;
    if (index >= boundary) {
      if (!looping) { ended = true; return 0; }
      const uint32_t start = a.loopStart << 16, length = (a.loopEnd - a.loopStart) << 16;
      position = start + (position - start) % length; index = position >> 16;
    }
    uint32_t next = index + 1;
    if (next >= boundary) next = looping ? a.loopStart : index;
    const int32_t x = pool[a.offset + index], y = pool[a.offset + next];
    const int32_t value = x + (((y - x) * int32_t((position >> 8) & 255)) >> 8);
    position += step;
    return value;
  }
};
}
