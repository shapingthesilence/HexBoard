#pragma once

#include "../FirmwareModule.h"

constexpr byte TUNING_12EDO = 0;
constexpr byte TUNINGCOUNT = 1;

constexpr uint16_t MAX_SCALE_DIVISIONS = 128;
constexpr size_t TUNING_KEY_LABEL_LENGTH = 8;  // 7 visible chars plus NUL.
constexpr byte ALL_TUNINGS = 255;
constexpr byte CMDB = 192;
constexpr byte UNUSED_NOTE = 255;
constexpr uint32_t CC_MSG_COOLDOWN_MICROSECONDS = 16667;

struct tuningDef {
  const char* name;  // limit is 17 characters for GEM menu
  byte cycleLength;  // steps before period/cycle/octave repeats
  float stepSize;    // in cents, 100 = "normal" semitone.
  SelectOptionInt keyChoices[MAX_SCALE_DIVISIONS];
  int spanCtoA() const {
    return keyChoices[0].val_int;
  }
};

constexpr uint8_t SYNTH_FX_ENVELOPE_COUNT = 2;
constexpr std::array<uint32_t, 20> envelopeTimeMicrosOptions = {
  0, 5000, 10000, 15000, 20000, 30000, 50000, 75000, 100000, 150000,
  200000, 300000, 500000, 750000, 1000000, 1500000, 2000000, 2500000,
  3000000, 4000000
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

extern const tuningDef tuningOptions[];
extern EnvelopeParams envelopeParams;
extern std::array<EnvelopeParams, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeParams;
extern std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS> envelopeReleaseIncrementByLevel;
extern std::array<std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS>, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeReleaseIncrementByLevel;

float ratioToCents(float ratio);
void updateEnvelopeReleaseIncrementTable(EnvelopeParams& params, std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS>& releaseTable);
void updateEnvelopeParamsFromValues(EnvelopeParams& params,
                                    uint8_t& attackIndex,
                                    uint8_t& holdIndex,
                                    uint8_t& decayIndex,
                                    uint8_t& sustainLevel,
                                    uint8_t& releaseIndex,
                                    std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS>& releaseTable);
