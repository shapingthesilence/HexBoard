#include "../FirmwareModule.h"
#include "DynamicJustIntonation.h"
#include "../app/RuntimeDefaults.h"
#include "../hardware/GridState.h"
#include "../midi/MidiRouting.h"
#include "../model/ScalePalettePreset.h"
#include "Tuning.h"
#include <array>
#include <cmath>
#include <utility>

//  Dynamic just intonation code start


// HOW BPM SYNC WORKS:
// The idea is to round off the note frequency to a certain precision.
// If you round the note frequencies of a C-E-G chord to integer values (261.626Hz / 329.628Hz / 391.995Hz) -
// you'll get a chord with ratio of 262/294/392.
// As a result, because these frequency values are always a multiple of 1 Hz -
// they all will be guaranteed to finish their wave cycle in 1 second.
// Thus, this chord will beat at 1 Hz if not faster.

// By knowing the pressed keys it is possible to pick better ratios, ideally having 262/327.5/393 (4/5/6) in this example

// TODO: replace floating point math with integer math;
// TODO: generate the table of ratios with a constexpr function rather than holding a huge block of hardcoded values in the code;
// TODO: Any future ratio-cache optimization must preserve full interval precision, not just single-note pitch error.
inline float centsToFrequencyMultiplier(float cents) {
  if (cents == 0.0f) {
    return 1.0f;
  }
  return std::exp2(cents / 1200.0f);
}

inline uint8_t largestPrimeFactor(byte value) {
  uint8_t largest = 1;
  uint8_t remainder = value;
  for (uint8_t factor = 2; factor <= remainder; ++factor) {
    while ((remainder % factor) == 0) {
      largest = factor;
      remainder /= factor;
    }
  }
  return largest;
}

// Distinct 2:1-equivalence classes from the simple-to-complex ratio table.
// Normalization is a search representation, independent of the tuning's period.
static constexpr std::pair<byte, byte> ratios[] = {
  { 1, 1 },
  { 3, 2 },
  { 4, 3 },
  { 8, 5 },
  { 5, 4 },
  { 5, 3 },
  { 8, 7 },
  { 7, 4 },
  { 6, 5 },
  { 9, 8 },
  { 7, 6 },
  { 16, 9 },
  { 12, 7 },
  { 11, 8 },
  { 7, 5 },
  { 16, 11 },
  { 10, 7 },
  { 9, 5 },
  { 16, 13 },
  { 12, 11 },
  { 11, 6 },
  { 10, 9 },
  { 13, 8 },
  { 9, 7 },
  { 11, 10 },
  { 14, 9 },
  { 20, 11 },
  { 13, 12 },
  { 24, 13 },
  { 15, 8 },
  { 16, 15 },
  { 17, 16 },
  { 32, 17 },
  { 20, 13 },
  { 13, 10 },
  { 19, 16 },
  { 11, 9 },
  { 17, 12 },
  { 24, 17 },
  { 18, 11 },
  { 32, 19 },
  { 13, 9 },
  { 21, 16 },
  { 28, 15 },
  { 18, 13 },
  { 19, 12 },
  { 17, 10 },
  { 24, 19 },
  { 20, 17 },
  { 15, 14 },
  { 32, 21 },
  { 20, 19 },
  { 32, 23 },
  { 19, 10 },
  { 23, 16 },
  { 18, 17 },
  { 32, 25 },
  { 40, 21 },
  { 25, 16 },
  { 15, 11 },
  { 17, 9 },
  { 24, 23 },
  { 23, 12 },
  { 22, 15 },
  { 21, 20 },
  { 40, 23 },
  { 36, 19 },
  { 32, 27 },
  { 26, 15 },
  { 48, 25 },
  { 15, 13 },
  { 23, 20 },
  { 19, 18 },
  { 27, 16 },
  { 25, 24 },
  { 32, 29 },
  { 29, 16 },
  { 17, 15 },
  { 30, 17 },
  { 29, 24 },
  { 31, 16 },
  { 27, 20 },
  { 48, 29 },
  { 36, 23 },
  { 23, 18 },
  { 32, 31 },
  { 40, 27 },
  { 33, 32 },
  { 48, 31 },
  { 64, 33 },
  { 40, 29 },
  { 30, 19 },
  { 36, 25 },
  { 31, 24 },
  { 19, 15 },
  { 25, 18 },
  { 29, 20 },
  { 40, 31 },
  { 31, 20 },
  { 35, 32 },
  { 64, 35 },
  { 36, 29 },
  { 35, 24 },
  { 29, 18 },
  { 40, 33 },
  { 23, 15 },
  { 33, 20 },
  { 30, 23 },
  { 37, 32 },
  { 48, 35 },
  { 64, 37 },
  { 31, 18 },
  { 39, 32 },
  { 37, 24 },
  { 48, 37 },
  { 36, 31 },
  { 64, 39 },
  { 41, 32 },
  { 37, 20 },
  { 40, 37 },
  { 64, 41 },
};

// Extend the sparse low-prime tables without adding primes: normalized 3^k,
// |k| = 4..26. The seven simpler classes (k = -3..3) are already above.
// These are used only for nearest-ratio fallback, after the simple candidates.
static constexpr float fallbackRatioCents[] = {
  407.82000346f,  // k = 4
  792.17999654f,  // k = -4
  1109.77500433f,  // k = 5
  90.22499567f,  // k = -5
  611.73000519f,  // k = 6
  588.26999481f,  // k = -6
  113.68500606f,  // k = 7
  1086.31499394f,  // k = -7
  815.64000692f,  // k = 8
  384.35999308f,  // k = -8
  317.59500779f,  // k = 9
  882.40499221f,  // k = -9
  1019.55000865f,  // k = 10
  180.44999135f,  // k = -10
  521.50500952f,  // k = 11
  678.49499048f,  // k = -11
  23.46001038f,  // k = 12
  1176.53998962f,  // k = -12
  725.41501125f,  // k = 13
  474.58498875f,  // k = -13
  227.37001212f,  // k = 14
  972.62998788f,  // k = -14
  929.32501298f,  // k = 15
  270.67498702f,  // k = -15
  431.28001385f,  // k = 16
  768.71998615f,  // k = -16
  1133.23501471f,  // k = 17
  66.76498529f,  // k = -17
  635.19001558f,  // k = 18
  564.80998442f,  // k = -18
  137.14501644f,  // k = 19
  1062.85498356f,  // k = -19
  839.10001731f,  // k = 20
  360.89998269f,  // k = -20
  341.05501817f,  // k = 21
  858.94498183f,  // k = -21
  1043.01001904f,  // k = 22
  156.98998096f,  // k = -22
  544.96501990f,  // k = 23
  655.03498010f,  // k = -23
  46.92002077f,  // k = 24
  1153.07997923f,  // k = -24
  748.87502163f,  // k = 25
  451.12497837f,  // k = -25
  250.83002250f,  // k = 26
  949.16997750f,  // k = -26
};

bool PressedKeySet::add(byte key) {
  if (key >= BTN_COUNT || active[key]) {
    return false;
  }
  active[key] = true;
  prevKey[key] = tail;
  nextKey[key] = INVALID_INDEX;
  if (tail != INVALID_INDEX) {
    nextKey[tail] = key;
  } else {
    head = key;
  }
  tail = key;
  ++count;
  return true;
}

bool PressedKeySet::remove(byte key) {
  if (key >= BTN_COUNT || !active[key]) {
    return false;
  }
  uint8_t prev = prevKey[key];
  uint8_t next = nextKey[key];
  if (prev != INVALID_INDEX) {
    nextKey[prev] = next;
  } else {
    head = next;
  }
  if (next != INVALID_INDEX) {
    prevKey[next] = prev;
  } else {
    tail = prev;
  }
  active[key] = false;
  prevKey[key] = INVALID_INDEX;
  nextKey[key] = INVALID_INDEX;
  --count;
  return true;
}

void PressedKeySet::clear() {
  nextKey.fill(INVALID_INDEX);
  prevKey.fill(INVALID_INDEX);
  active.fill(false);
  count = 0;
  head = INVALID_INDEX;
  tail = INVALID_INDEX;
}

uint8_t PressedKeySet::size() const {
  return count;
}

byte PressedKeySet::operator[](uint8_t ordinal) const {
  uint8_t key = head;
  while (key != INVALID_INDEX && ordinal > 0) {
    key = nextKey[key];
    --ordinal;
  }
  return key == INVALID_INDEX ? 0 : key;
}

PressedKeySet pressedKeyIDs;

namespace {
constexpr size_t DYNAMIC_JI_RATIO_COUNT = sizeof(ratios) / sizeof(ratios[0]);
constexpr size_t DYNAMIC_JI_FALLBACK_COUNT = sizeof(fallbackRatioCents) / sizeof(fallbackRatioCents[0]);
// Cache full-precision interval cents in RAM at settings sync, rather than
// evaluating a logarithm for each candidate on every press.
std::array<float, DYNAMIC_JI_RATIO_COUNT + DYNAMIC_JI_FALLBACK_COUNT> activeDynamicJIRatioCents = {};
uint16_t activeDynamicJIRatioCount = 0;
uint16_t simpleDynamicJIRatioCount = 0;

inline bool ratioIsInSelectedJITable(const std::pair<byte, byte>& ratio) {
  return largestPrimeFactor(ratio.first) <= dynamicJIRatioTable
      && largestPrimeFactor(ratio.second) <= dynamicJIRatioTable;
}
}  // namespace

void syncDynamicJIRatioCandidates() {
  activeDynamicJIRatioCount = 0;
  for (uint16_t i = 0; i < DYNAMIC_JI_RATIO_COUNT; ++i) {
    if (ratioIsInSelectedJITable(ratios[i])) {
      activeDynamicJIRatioCents[activeDynamicJIRatioCount++] = ratioToCents(
        static_cast<float>(ratios[i].first) / static_cast<float>(ratios[i].second));
    }
  }
  if (activeDynamicJIRatioCount == 0) {
    activeDynamicJIRatioCents[activeDynamicJIRatioCount++] = 0.0f;
  }
  simpleDynamicJIRatioCount = activeDynamicJIRatioCount;
  for (float cents : fallbackRatioCents) {
    activeDynamicJIRatioCents[activeDynamicJIRatioCount++] = cents;
  }
}

int16_t centsToRelativePitchBend(float cents) {
  int32_t bend = static_cast<int32_t>(round(cents * (8192.0 / (100.0 * MPEpitchBendSemis))));
  if (bend > 8191) {
    return 8191;
  }
  if (bend < -8192) {
    return -8192;
  }
  return static_cast<int16_t>(bend);
}

byte nearestMidiNoteForPitch(float midiPitch) {
  if (midiPitch <= 0.0f) {
    return 0;
  }
  if (midiPitch >= 127.0f) {
    return 127;
  }
  return static_cast<byte>(round(midiPitch));
}

int16_t pitchBendForMidiPitch(float midiPitch, byte midiNote) {
  float residualCents = (midiPitch - static_cast<float>(midiNote)) * 100.0f;
  return centsToRelativePitchBend(residualCents);
}

void prepareActiveMidiPitch(byte x) {
  h[x].activeMidiNote = h[x].note;
  h[x].activePitchBend = h[x].bend;
  if (MPEpitchBendsNeeded == 1) {
    return;
  }
  // assignPitches() already chose the nearest note and residual bend for the
  // static tuning. Recalculate them on a press only when live JI can move the
  // pitch away from those cached values.
  if (!useDynamicJustIntonation && !useJustIntonationBPM) {
    return;
  }

  float finalMidiPitch = h[x].midiPitch;
  finalMidiPitch += h[x].jiRetuneCents / 100.0f;
  h[x].activeMidiNote = nearestMidiNoteForPitch(finalMidiPitch);
  h[x].activePitchBend = pitchBendForMidiPitch(finalMidiPitch, h[x].activeMidiNote);
}

int16_t justIntonationRetune(byte x) {
  if (useDynamicJustIntonation == false && useJustIntonationBPM == false) {
    h[x].jiRetune = 0;
    h[x].jiRetuneCents = 0.0f;
    h[x].jiFrequencyMultiplier = 1.0f;
    return 0;
  }
  float pitchAdjustmentCents = 0.0f;
  bool matchedDynamicRatio = false;
  if (useDynamicJustIntonation && pressedKeyIDs.size() > 1) {
    const byte anchor = pressedKeyIDs[0];
    const float errorThreshold = currentTuningNominalStepSizeCents() / 4.0f;
    const float intervalCents = ratioToCents(h[anchor].frequency / h[x].frequency);

    if (activeDynamicJIRatioCount == 0) {
      syncDynamicJIRatioCandidates();
    }
    if (std::isfinite(intervalCents)) {
      // A power-of-two lift preserves rational ratios for every tuning,
      // including tritaves and arbitrary cents-table repeat periods.
      const float foldedCents = intervalCents - 1200.0f * std::floor(intervalCents / 1200.0f);
      const bool allowUnison = intervalCents == 0.0f || std::abs(intervalCents) >= 600.0f;
      float bestDeviation = 0.0f;
      float bestError = INFINITY;
      for (uint16_t i = 0; i < activeDynamicJIRatioCount; ++i) {
        const float ratioCents = activeDynamicJIRatioCents[i];
        // Distinct pitches close to the anchor must not fall back to 1:1.
        if (!allowUnison && ratioCents == 0.0f) continue;
        float deviation = foldedCents - ratioCents;
        if (deviation > 600.0f) deviation -= 1200.0f;
        else if (deviation < -600.0f) deviation += 1200.0f;
        const float error = std::abs(deviation);
        if (error < bestError) {
          bestDeviation = deviation;
          bestError = error;
        }
        // Preserve the simple-ratio preference. If none is close enough,
        // finish the bounded scan and use the nearest ratio from either tier.
        if (i < simpleDynamicJIRatioCount && error < errorThreshold) break;
      }
      pitchAdjustmentCents = bestDeviation + h[anchor].jiRetuneCents;
      matchedDynamicRatio = true;
    }
  }
  // A matched interval already inherits the anchor's BPM correction. Only
  // quantize independently for the first note or an invalid source interval.
  if (useJustIntonationBPM && !matchedDynamicRatio) {
    const float rounding = static_cast<float>(justIntonationBPM / 60.0 * justIntonationBPM_Multiplier);
    if (rounding > 0.0f) {
      const double roundedReference = round(currentTuningReferenceHz() / rounding);
      const double roundedNote = round(h[x].frequency / rounding);
      // Valid settings can round low notes (or the reference) to zero.
      if (roundedReference > 0.0 && roundedNote > 0.0
          && std::isfinite(roundedReference) && std::isfinite(roundedNote)) {
        const int16_t stepsFromReference = static_cast<int16_t>(currentPitchStepsFromReference(h[x].stepsFromC));
        pitchAdjustmentCents = -stepsToCentsFromReference(stepsFromReference)
                             - ratioToCents(roundedReference / roundedNote);
      }
    }
  }
  int16_t pitchAdjustment = centsToRelativePitchBend(pitchAdjustmentCents);
  h[x].jiRetune = pitchAdjustment;
  h[x].jiRetuneCents = pitchAdjustmentCents;
  h[x].jiFrequencyMultiplier = centsToFrequencyMultiplier(pitchAdjustmentCents);
  return pitchAdjustment;
}
