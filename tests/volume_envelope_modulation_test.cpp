#define RAM_FUNC(name) name
#include "../src/firmware/synth/VolumeEnvelopeModulation.h"
#include <cassert>
#include "../src/firmware/synth/ModWheelAmount.h"

struct Params {
  uint32_t attackTicks = 41, holdTicks = 41, decayTicks = 41, releaseTicks = 41;
  uint32_t attackIncrement = 0, decayIncrement = 0, sustainLevel = 1000000;
};
int main() {
  constexpr uint32_t full = 65535u << 7;
  constexpr uint32_t fourSeconds = 162760;
  const Params base;
  for (uint8_t target = 7; target <= 11; ++target) {
    uint32_t previous = 0;
    for (uint8_t amount = 0; amount <= 127; ++amount) {
      Params params = base;
      applyVolumeEnvelopeModulation(params, target, amount, fourSeconds, full);
      const uint32_t value = target == 7 ? params.attackTicks : target == 8 ? params.holdTicks
        : target == 9 ? params.decayTicks : target == 10 ? params.sustainLevel : params.releaseTicks;
      assert(value >= previous);
      assert(value <= (target == 10 ? full : fourSeconds));
      if (amount == 127) assert(value == (target == 10 ? full : fourSeconds));
      if (target != 7) assert(params.attackTicks == base.attackTicks);
      if (target != 8) assert(params.holdTicks == base.holdTicks);
      if (target != 9) assert(params.decayTicks == base.decayTicks);
      if (target != 10) assert(params.sustainLevel == base.sustainLevel);
      if (target != 11) assert(params.releaseTicks == base.releaseTicks);
      previous = value;
    }
  }
  for (uint8_t value = 0; value <= 127; ++value) {
    assert(scaleSynthWheelDepth(value, 0) == 0);
    for (uint8_t depth = 1; depth <= 127; ++depth) {
      const int16_t legacy = depth == 127 ? value : (value * depth + 64u) >> 7;
      assert(scaleSynthWheelDepth(value, depth) == legacy);
      assert(scaleSynthWheelDepth(value, 127 + depth) == -legacy);
    }
  }
  for (uint8_t target = 7; target <= 11; ++target) {
    uint32_t previous = target == 10 ? base.sustainLevel : 41;
    for (int16_t amount = 0; amount >= -127; --amount) {
      Params params = base;
      applyVolumeEnvelopeModulation(params, target, amount, fourSeconds, full);
      const uint32_t value = target == 7 ? params.attackTicks : target == 8 ? params.holdTicks
        : target == 9 ? params.decayTicks : target == 10 ? params.sustainLevel : params.releaseTicks;
      assert(value <= previous);
      if (amount == -127) assert(value == 0);
      previous = value;
    }
  }
  for (uint8_t target : {0, 6, 12}) {
    Params params = base;
    applyVolumeEnvelopeModulation(params, target, 127, fourSeconds, full);
    assert(params.attackTicks == base.attackTicks && params.sustainLevel == base.sustainLevel);
  }
}
