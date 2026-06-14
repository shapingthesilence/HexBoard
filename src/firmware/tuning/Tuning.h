#pragma once

#include "../FirmwareModule.h"

constexpr byte TUNING_12EDO = 0;
constexpr byte TUNING_12EDO_ZETA = 1;
constexpr byte TUNING_17EDO = 2;
constexpr byte TUNING_19EDO = 3;
constexpr byte TUNING_22EDO = 4;
constexpr byte TUNING_24EDO = 5;
constexpr byte TUNING_31EDO = 6;
constexpr byte TUNING_31EDO_ZETA = 7;
constexpr byte TUNING_41EDO = 8;
constexpr byte TUNING_43EDO = 9;
constexpr byte TUNING_46EDO = 10;
constexpr byte TUNING_53EDO = 11;
constexpr byte TUNING_58EDO = 12;
constexpr byte TUNING_58EDO_ZETA = 13;
constexpr byte TUNING_72EDO = 14;
constexpr byte TUNING_72EDO_ZETA = 15;
constexpr byte TUNING_80EDO = 16;
constexpr byte TUNING_87EDO = 17;
constexpr byte TUNING_BP = 18;
constexpr byte TUNING_ALPHA = 19;
constexpr byte TUNING_BETA = 20;
constexpr byte TUNING_GAMMA = 21;
constexpr byte TUNINGCOUNT = 22;

constexpr uint16_t MAX_SCALE_DIVISIONS = 87;
constexpr byte ALL_TUNINGS = 255;
constexpr byte CMDB = 192;
constexpr byte UNUSED_NOTE = 255;
constexpr uint32_t CC_MSG_COOLDOWN_MICROSECONDS = 16667;

class tuningDef {
public:
  std::string name;  // limit is 17 characters for GEM menu
  byte cycleLength;  // steps before period/cycle/octave repeats
  float stepSize;    // in cents, 100 = "normal" semitone.
  SelectOptionInt keyChoices[MAX_SCALE_DIVISIONS];
  int spanCtoA() {
    return keyChoices[0].val_int;
  }
};

constexpr uint8_t SYNTH_FX_ENVELOPE_COUNT = 2;
constexpr std::array<uint32_t, 20> envelopeTimeMicrosOptions = {
  0, 5000, 10000, 15000, 20000, 30000, 50000, 75000, 100000, 150000,
  200000, 300000, 500000, 750000, 1000000, 1500000, 2000000, 2500000,
  3000000, 4000000
};
constexpr std::array<uint8_t, 10> legacyEnvelopeTimeIndexToCurrent = {
  0, 1, 2, 4, 6, 8, 10, 12, 14, 16
};
constexpr uint8_t ENVELOPE_LEVEL_SCALE_SHIFT = 7;
constexpr uint32_t envelopeAudioMaxLevel = 65535;
constexpr uint32_t envelopeMaxLevel = envelopeAudioMaxLevel << ENVELOPE_LEVEL_SCALE_SHIFT;
constexpr uint8_t ENVELOPE_MOD_VALUE_SHIFT = ENVELOPE_LEVEL_SCALE_SHIFT + 9;
constexpr uint32_t ENVELOPE_MOD_VALUE_ROUND = 1u << (ENVELOPE_MOD_VALUE_SHIFT - 1);
constexpr uint8_t ENVELOPE_RELEASE_INCREMENT_BUCKET_BITS = 8;
constexpr uint16_t ENVELOPE_RELEASE_INCREMENT_BUCKETS = 1u << ENVELOPE_RELEASE_INCREMENT_BUCKET_BITS;
constexpr uint8_t ENVELOPE_RELEASE_INCREMENT_SHIFT = 16 + ENVELOPE_LEVEL_SCALE_SHIFT - ENVELOPE_RELEASE_INCREMENT_BUCKET_BITS;

enum class EnvelopeStage : uint8_t {
  Idle,
  Attack,
  Hold,
  Decay,
  Sustain,
  Release
};

struct EnvelopeParams {
  uint32_t attackTicks = 0;
  uint32_t holdTicks = 0;
  uint32_t decayTicks = 0;
  uint32_t releaseTicks = 0;
  uint32_t attackIncrement = envelopeMaxLevel;
  uint32_t decayIncrement = envelopeMaxLevel;
  uint32_t sustainLevel = envelopeMaxLevel;
};

extern tuningDef tuningOptions[];
extern EnvelopeParams envelopeParams;
extern std::array<EnvelopeParams, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeParams;
extern std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS> envelopeReleaseIncrementByLevel;
extern std::array<std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS>, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeReleaseIncrementByLevel;

void updateEnvelopeReleaseIncrementTable(EnvelopeParams& params, std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS>& releaseTable);
void updateEnvelopeParamsFromValues(EnvelopeParams& params,
                                    uint8_t& attackIndex,
                                    uint8_t& holdIndex,
                                    uint8_t& decayIndex,
                                    uint8_t& sustainLevel,
                                    uint8_t& releaseIndex,
                                    std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS>& releaseTable);
