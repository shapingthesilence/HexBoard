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
    {
      { "C", -9 }, { "C#", -8 }, { "D", -7 }, { "Eb", -6 },
      { "E", -5 }, { "F", -4 }, { "F#", -3 }, { "G", -2 },
      { "G#", -1 }, { "A", 0 }, { "Bb", 1 }, { "B", 2 }
    }
  }
};
