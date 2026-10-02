#pragma once
#include <algorithm>
#include <stdint.h>

// Operates on a render-only copy; the saved envelope remains unchanged.
// Target values 7..11 are the wheel-only AHDSR destinations.
template <typename Params>
inline void RAM_FUNC(applyVolumeEnvelopeModulation)(Params& params, uint8_t target,
    uint8_t amount, uint32_t maxTicks, uint32_t maxLevel) {
  if (amount == 0 || target < 7 || target > 11) return;
  auto raise = [amount](uint32_t base, uint32_t maximum) {
    return base + ((maximum - base) * amount + 63u) / 127u;
  };
  switch (target) {
    case 7: params.attackTicks = raise(params.attackTicks, maxTicks); break;
    case 8: params.holdTicks = raise(params.holdTicks, maxTicks); break;
    case 9: params.decayTicks = raise(params.decayTicks, maxTicks); break;
    case 10: params.sustainLevel = raise(params.sustainLevel, maxLevel); break;
    case 11: params.releaseTicks = raise(params.releaseTicks, maxTicks); break;
  }
  params.attackIncrement = params.attackTicks == 0 ? maxLevel
    : std::max<uint32_t>(1, (maxLevel + params.attackTicks - 1) / params.attackTicks);
  const uint32_t difference = maxLevel - params.sustainLevel;
  params.decayIncrement = params.decayTicks == 0 || difference == 0 ? maxLevel
    : std::max<uint32_t>(1, (difference + params.decayTicks - 1) / params.decayTicks);
}
