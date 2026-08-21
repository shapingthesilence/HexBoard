#include "Tuning.h"

float ratioToCents(float ratio) {
  return 1200.0f * (std::log(ratio) / std::log(2.0f));
}

EnvelopeParams envelopeParams;
std::array<EnvelopeParams, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeParams;
std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS> envelopeReleaseIncrementByLevel = {};
std::array<std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS>, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeReleaseIncrementByLevel = {};

// Immutable rescue tuning used only when no valid geometry catalog is
// available. The editable factory tunings are generated from
// factory-library/geometry/ into /geometry/*.hgb.
const tuningDef tuningOptions[] = {
  {
    "12 EDO Rescue",
    12,
    100.0f,
    -9
  }
};
