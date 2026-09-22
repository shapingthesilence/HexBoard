#include "../src/firmware/hardware/LedFrameEncoding.h"
#include "../src/firmware/hardware/LedColorMath.h"
#include "../src/firmware/hardware/LedBankState.h"
#include <cassert>
#include <initializer_list>
#include <cmath>
#include <cstdio>

int main() {
  // Interleave production, DMA selection and delayed IRQ acknowledgement.
  // A reserved bank must never be selected while the producer is writing it.
  for (unsigned scenario = 1; scenario <= 128; ++scenario) {
    LedBankState state;
    int dmaBank = 0, reserved = -1, lastPublished = 0;
    bool irqPending = false;
    uint32_t random = scenario;
    for (unsigned step = 0; step < 10000; ++step) {
      random = random * 1664525u + 1013904223u;
      switch (random >> 30) {
        case 0:
          if (reserved < 0) reserved = state.available();
          break;
        case 1:
          if (reserved >= 0) {
            state.pending = reserved;
            lastPublished = reserved;
            reserved = -1;
          }
          break;
        case 2:
          dmaBank = state.replay;
          irqPending = true;
          break;
        case 3:
          if (irqPending) { state.acknowledge(dmaBank); irqPending = false; }
          break;
      }
      assert(reserved < 0 || (reserved != dmaBank && reserved != state.replay && reserved != lastPublished));
    }
  }
  uint16_t previousGamma = 0;
  for (unsigned value = 0; value <= 65535; ++value) {
    uint16_t gamma = gammaChannel16(value);
    assert(gamma >= previousGamma);
    assert(std::abs(gamma - std::pow(value / 65535.0, 2.6) * 65535.0) < 2);
    previousGamma = gamma;
  }
  assert(gammaChannel16(0) == 0 && gammaChannel16(65535) == 65535);
  assert(hsvColor16(0, 255, 255) == LedColor(65535, 0, 0));
  assert(hsvColor16(12345, 0, 255) == LedColor(65535, 65535, 65535));
  assert(hsvColor16(54321, 255, 0) == LedColor(0));
  // Fractional brightness survives HSV and gamma; it is not expanded gamma8.
  LedColor dim = gammaColor16(hsvColor16(0, 255, 24));
  assert(dim.r > 0 && dim.r < 257 && dim.g == 0 && dim.b == 0);

  for (unsigned phases : {1u, 2u, 4u}) {
    unsigned previous[4] = {};
    for (unsigned input = 0; input <= 65535; ++input) {
      unsigned q = quantizeLedChannel(input, phases);
      unsigned total = 0;
      for (unsigned phase = 0; phase < phases; ++phase) {
        unsigned value = ledChannelPhase(q, phases, phase);
        assert(value <= 255 && value >= previous[phase]);
        previous[phase] = value;
        total += value;
        if (input == 0) assert(value == 0);
        if (input == 65535) assert(value == 255);
      }
      assert(total == q);
      double expected = input * (255.0 * phases) / 65535.0;
      assert(std::abs(total - expected) <= 0.500001);
    }
  }
  constexpr unsigned count = 140;
  constexpr unsigned phaseWords = 106;
  LedColor frame[count];
  uint32_t words[4 * phaseWords];
  auto byteAt = [&](unsigned phase, unsigned index) {
    return (words[phase * phaseWords + 1 + index / 4] >> (24 - 8 * (index % 4))) & 255;
  };
  // Orange inputs with a sub-step change encode identically at every depth.
  // A real green-channel change must still publish; changing a different pixel
  // must preserve the unchanged pixel's complete ordered phase sequence.
  uint32_t reference[4 * phaseWords];
  for (unsigned phases : {1u, 2u, 4u}) {
    for (auto& pixel : frame) pixel = LedColor(1028, 514, 0);
    encodeLimitedLedBank(reference, frame, count, phases, 0);
    frame[0].r += 1;
    encodeLimitedLedBank(words, frame, count, phases, 0);
    assert(memcmp(words, reference, sizeof(words)) == 0);
    frame[1].g += 257;
    encodeLimitedLedBank(words, frame, count, phases, 0);
    assert(memcmp(words, reference, sizeof(words)) != 0);
    for (unsigned phase = 0; phase < 4; ++phase) {
      assert((words[phase * phaseWords + 1] & 0xffffff00u) ==
             (reference[phase * phaseWords + 1] & 0xffffff00u));
    }
    // Changes hidden by a below-idle current limit also produce the same bank.
    encodeLimitedLedBank(reference, frame, count, phases, 140);
    frame[0] = LedColor(65535, 65535, 0);
    encodeLimitedLedBank(words, frame, count, phases, 140);
    assert(memcmp(words, reference, sizeof(words)) == 0);
  }
  // Sweep the complete UI range: only headers change, all phases get the same
  // delay, and every 4us edit changes the transmitted bank (including black).
  static_assert(LED_DEFAULT_DITHER_BITS == 8, "Startup dithering default");
  static_assert(ledDitherDepth(false) == 8 && ledDitherDepth(true) == 10, "Dither toggle");
  assert(normalizeLedFramePeriod(-1) == 4328);
  assert(normalizeLedFramePeriod(999999) == 6000);
  assert(normalizeLedFramePeriod(4329) == 4328);
  assert(normalizeLedFramePeriod(4331) == 4332);
  for (unsigned black = 0; black < 2; ++black) {
    for (auto& pixel : frame) pixel = black ? LedColor(0) : LedColor(1028, 514, 0);
    encodeLimitedLedBank(reference, frame, count, 4, 0);
    for (int period = 4328; period <= 6000; period += 4) {
      assert(decodeLedFramePeriod(period & 255, period >> 8) == period);
      memcpy(words, reference, sizeof(words));
      setLedBankFramePeriod(words, count, period);
      if (period != 4328) assert(memcmp(words, reference, sizeof(words)) != 0);
      for (unsigned phase = 0; phase < 4; ++phase) {
        uint32_t header = words[phase * phaseWords];
        unsigned bitCount = (header & LED_FRAME_BIT_COUNT_MASK) + 1;
        unsigned resetIterations = (header >> LED_FRAME_BIT_COUNT_BITS) + 1;
        assert(bitCount == 3360);
        assert(resetIterations * 32 >= 1024); // >=128us at 8MHz
        assert(bitCount * 10 + resetIterations * 32 + 4 == unsigned(period * 8 + 4));
        assert(memcmp(words + phase * phaseWords + 1, reference + phase * phaseWords + 1,
                      (phaseWords - 1) * sizeof(uint32_t)) == 0);
      }
    }
  }
  uint32_t seed = 123;
  for (unsigned trial = 0; trial < 32; ++trial) {
    for (auto& pixel : frame) {
      auto next = [&]() -> uint16_t { seed = seed * 1664525u + 1013904223u; return seed >> 16; };
      pixel = trial == 0 ? LedColor(65535,65535,65535) : LedColor(next(),next(),next());
    }
    for (unsigned phases : {1u, 2u, 4u}) {
      encodeLimitedLedBank(words, frame, count, phases, 0);
      for (unsigned pixel = 0; pixel < count; ++pixel) {
        uint16_t channels[] = {frame[pixel].g, frame[pixel].r, frame[pixel].b};
        for (unsigned channel = 0; channel < 3; ++channel) {
          unsigned sum = 0;
          for (unsigned phase = 0; phase < 4; ++phase) sum += byteAt(phase, pixel * 3 + channel);
          assert(sum == quantizeLedChannel(channels[channel], phases) * (4 / phases));
        }
      }
      if (phases <= 2) {
        for (unsigned i = 0; i < phaseWords; ++i) assert(words[i] == words[2 * phaseWords + i]);
      }
      for (unsigned limit : {1u, 140u, 141u, 160u, 500u, 1500u, 5000u}) {
        encodeLimitedLedBank(words, frame, count, phases, limit);
        for (unsigned phase = 0; phase < 4; ++phase) {
          assert((words[phase * phaseWords] & LED_FRAME_BIT_COUNT_MASK) == count * 24 - 1);
          assert((words[phase * phaseWords] >> LED_FRAME_BIT_COUNT_BITS) == 31);
          unsigned sum = 0;
          for (unsigned i = 0; i < count * 3; ++i) sum += byteAt(phase, i);
          if (limit <= count) assert(sum == 0);
          else assert(sum * 20 <= (limit - count) * 255);
        }
      }
    }
  }
  puts("LED gamma, quantization, GRB packing, phase averages, current bounds, bank handoff and frame-period sweep passed");
}
