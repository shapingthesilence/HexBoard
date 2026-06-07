#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"

//  Dynamic just intonation code start


// HOW BPM SYNC WORKS:
// The idea is to round off the note frequency to a certain precision.
// If you round the note frequencies of a C-E-G chord to integer values (261.626Hz / 329.628Hz / 391.995Hz) -
// you'll get a chord with ratio of 262/294/392.
// As a result, because these frequency values are always a multiple of 1 Hz -
// they all will be guaranteed to finish their wave cycle in 1 second.
// Thus, this chord will beat at 1 Hz if not faster.

// By knowing the pressed keys it is possible to pick better ratios, ideally having 262/327.5/393 (4/5/6) in this example

// TODO: make BPM sync work with dynamic just intonation to make pure just intonation achieveable.
// Without it - this implementation provides you with n-EDO-sized independent JI rings, unconnected to eachother;
// TODO: replace floating point math with integer math;
// TODO: generate the table of ratios with a constexpr function rather than holding a huge block of hardcoded values in the code;
// TODO: It is a good idea to octave-reduce the ratios, and adjust the code to calculate pitchbend against the octave reduced set of ratios for significant performance improvement;
inline float centsToFrequencyMultiplier(float cents) {
  if (cents == 0.0f) {
    return 1.0f;
  }
  return std::exp2(cents / 1200.0f);
}

int16_t justIntonationRetune(byte x);

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

inline bool ratioIsInSelectedJITable(const std::pair<byte, byte>& ratio) {
  return largestPrimeFactor(ratio.first) <= dynamicJIRatioTable
      && largestPrimeFactor(ratio.second) <= dynamicJIRatioTable;
}

// This is a list of ratios sorted from the simplest ones to the most complex ones. The code searches for a first match that's good enough within 1/4 of an EDO step, literally bruteforcing through the list. As a result - the simplest ratio is chosen before more comples ones, prioritising consonant ratios first. In case not a single good ratio is found - the best one found so far is chosen instead

// byte pair was chosen to preserve space. The ratio is "unpacked" later
std::vector<std::pair<byte, byte>> ratios = {
  { 1, 1 },
  { 1, 2 },
  { 2, 1 },
  { 3, 1 },
  { 1, 3 },
  { 1, 4 },
  { 2, 3 },
  { 1, 4 },
  { 4, 1 },
  { 3, 2 },
  { 1, 5 },
  { 5, 1 },
  { 5, 2 },
  { 1, 6 },
  { 3, 4 },
  { 5, 2 },
  { 4, 3 },
  { 6, 1 },
  { 2, 5 },
  { 5, 3 },
  { 1, 7 },
  { 7, 1 },
  { 3, 5 },
  { 2, 7 },
  { 8, 1 },
  { 5, 4 },
  { 1, 8 },
  { 4, 5 },
  { 7, 2 },
  { 9, 1 },
  { 7, 3 },
  { 1, 9 },
  { 3, 7 },
  { 1, 9 },
  { 1, 10 },
  { 10, 1 },
  { 7, 4 },
  { 3, 8 },
  { 8, 3 },
  { 6, 5 },
  { 1, 10 },
  { 8, 3 },
  { 4, 7 },
  { 2, 9 },
  { 9, 2 },
  { 5, 6 },
  { 11, 1 },
  { 7, 5 },
  { 1, 11 },
  { 5, 7 },
  { 5, 8 },
  { 3, 10 },
  { 4, 9 },
  { 3, 10 },
  { 2, 11 },
  { 11, 2 },
  { 12, 1 },
  { 1, 12 },
  { 9, 4 },
  { 5, 8 },
  { 1, 12 },
  { 8, 5 },
  { 10, 3 },
  { 6, 7 },
  { 7, 6 },
  { 12, 1 },
  { 9, 5 },
  { 1, 13 },
  { 3, 11 },
  { 11, 3 },
  { 9, 5 },
  { 5, 9 },
  { 13, 1 },
  { 14, 1 },
  { 13, 2 },
  { 11, 4 },
  { 1, 14 },
  { 2, 13 },
  { 8, 7 },
  { 7, 8 },
  { 4, 11 },
  { 9, 7 },
  { 11, 5 },
  { 7, 9 },
  { 5, 11 },
  { 13, 3 },
  { 3, 13 },
  { 15, 1 },
  { 1, 15 },
  { 4, 13 },
  { 2, 15 },
  { 10, 7 },
  { 2, 15 },
  { 11, 6 },
  { 8, 9 },
  { 16, 1 },
  { 12, 5 },
  { 3, 14 },
  { 7, 10 },
  { 5, 12 },
  { 14, 3 },
  { 9, 8 },
  { 15, 2 },
  { 13, 4 },
  { 1, 16 },
  { 6, 11 },
  { 17, 1 },
  { 1, 17 },
  { 5, 13 },
  { 13, 5 },
  { 4, 15 },
  { 17, 2 },
  { 9, 10 },
  { 2, 17 },
  { 9, 10 },
  { 12, 7 },
  { 10, 9 },
  { 11, 8 },
  { 16, 3 },
  { 3, 16 },
  { 13, 6 },
  { 14, 5 },
  { 15, 4 },
  { 18, 1 },
  { 8, 11 },
  { 1, 18 },
  { 4, 15 },
  { 5, 14 },
  { 6, 13 },
  { 7, 12 },
  { 19, 1 },
  { 11, 9 },
  { 17, 3 },
  { 3, 17 },
  { 9, 11 },
  { 1, 19 },
  { 5, 16 },
  { 20, 1 },
  { 8, 13 },
  { 10, 11 },
  { 20, 1 },
  { 19, 2 },
  { 1, 20 },
  { 11, 10 },
  { 2, 19 },
  { 13, 8 },
  { 17, 4 },
  { 4, 17 },
  { 16, 5 },
  { 1, 20 },
  { 13, 9 },
  { 21, 1 },
  { 7, 15 },
  { 9, 13 },
  { 19, 3 },
  { 17, 5 },
  { 3, 19 },
  { 5, 17 },
  { 15, 7 },
  { 1, 21 },
  { 13, 10 },
  { 3, 20 },
  { 12, 11 },
  { 21, 2 },
  { 18, 5 },
  { 6, 17 },
  { 15, 8 },
  { 3, 20 },
  { 20, 3 },
  { 19, 4 },
  { 5, 18 },
  { 14, 9 },
  { 9, 14 },
  { 8, 15 },
  { 2, 21 },
  { 1, 22 },
  { 17, 6 },
  { 22, 1 },
  { 10, 13 },
  { 11, 12 },
  { 4, 19 },
  { 5, 19 },
  { 1, 23 },
  { 19, 5 },
  { 23, 1 },
  { 18, 7 },
  { 8, 17 },
  { 21, 4 },
  { 22, 3 },
  { 3, 22 },
  { 7, 18 },
  { 6, 19 },
  { 12, 13 },
  { 19, 6 },
  { 2, 23 },
  { 9, 16 },
  { 17, 8 },
  { 24, 1 },
  { 13, 12 },
  { 1, 24 },
  { 23, 2 },
  { 4, 21 },
  { 16, 9 },
  { 9, 17 },
  { 1, 25 },
  { 5, 21 },
  { 25, 1 },
  { 15, 11 },
  { 17, 9 },
  { 3, 23 },
  { 23, 3 },
  { 11, 15 },
  { 21, 5 },
  { 17, 10 },
  { 10, 17 },
  { 19, 8 },
  { 5, 22 },
  { 20, 7 },
  { 22, 5 },
  { 23, 4 },
  { 7, 20 },
  { 1, 26 },
  { 8, 19 },
  { 25, 2 },
  { 26, 1 },
  { 2, 25 },
  { 4, 23 },
  { 5, 23 },
  { 9, 19 },
  { 1, 27 },
  { 13, 15 },
  { 3, 25 },
  { 15, 13 },
  { 23, 5 },
  { 19, 9 },
  { 27, 1 },
  { 25, 3 },
  { 25, 4 },
  { 14, 15 },
  { 27, 2 },
  { 9, 20 },
  { 2, 27 },
  { 26, 3 },
  { 20, 9 },
  { 17, 12 },
  { 1, 28 },
  { 24, 5 },
  { 10, 19 },
  { 12, 17 },
  { 23, 6 },
  { 21, 8 },
  { 11, 18 },
  { 19, 10 },
  { 5, 24 },
  { 4, 25 },
  { 5, 24 },
  { 3, 26 },
  { 18, 11 },
  { 28, 1 },
  { 8, 21 },
  { 6, 23 },
  { 15, 14 },
  { 1, 29 },
  { 29, 1 },
  { 23, 8 },
  { 24, 7 },
  { 7, 24 },
  { 6, 25 },
  { 10, 21 },
  { 30, 1 },
  { 5, 26 },
  { 25, 6 },
  { 11, 20 },
  { 30, 1 },
  { 1, 30 },
  { 16, 15 },
  { 8, 23 },
  { 4, 27 },
  { 2, 29 },
  { 26, 5 },
  { 9, 22 },
  { 29, 2 },
  { 27, 4 },
  { 28, 3 },
  { 15, 16 },
  { 20, 11 },
  { 18, 13 },
  { 22, 9 },
  { 21, 10 },
  { 13, 18 },
  { 12, 19 },
  { 19, 12 },
  { 3, 28 },
  { 17, 15 },
  { 15, 17 },
  { 29, 3 },
  { 31, 1 },
  { 27, 5 },
  { 3, 29 },
  { 9, 23 },
  { 23, 9 },
  { 1, 31 },
  { 5, 27 },
  { 13, 20 },
  { 2, 31 },
  { 28, 5 },
  { 1, 32 },
  { 29, 4 },
  { 25, 8 },
  { 20, 13 },
  { 4, 29 },
  { 8, 25 },
  { 23, 10 },
  { 10, 23 },
  { 5, 28 },
  { 31, 2 },
  { 32, 1 },
  { 33, 1 },
  { 3, 31 },
  { 1, 33 },
  { 5, 29 },
  { 15, 19 },
  { 9, 25 },
  { 31, 3 },
  { 19, 15 },
  { 25, 9 },
  { 29, 5 },
  { 33, 2 },
  { 6, 29 },
  { 17, 18 },
  { 34, 1 },
  { 2, 33 },
  { 32, 3 },
  { 26, 9 },
  { 31, 4 },
  { 27, 8 },
  { 1, 34 },
  { 4, 31 },
  { 18, 17 },
  { 29, 6 },
  { 8, 27 },
  { 12, 23 },
  { 11, 24 },
  { 3, 32 },
  { 9, 26 },
  { 23, 12 },
  { 24, 11 },
  { 5, 31 },
  { 31, 5 },
  { 35, 1 },
  { 1, 35 },
  { 1, 36 },
  { 30, 7 },
  { 24, 13 },
  { 18, 19 },
  { 36, 1 },
  { 6, 31 },
  { 28, 9 },
  { 34, 3 },
  { 36, 1 },
  { 15, 22 },
  { 7, 30 },
  { 8, 29 },
  { 1, 36 },
  { 17, 20 },
  { 29, 8 },
  { 4, 33 },
  { 12, 25 },
  { 10, 27 },
  { 32, 5 },
  { 20, 17 },
  { 3, 34 },
  { 25, 12 },
  { 5, 32 },
  { 2, 35 },
  { 33, 4 },
  { 22, 15 },
  { 9, 28 },
  { 13, 24 },
  { 27, 10 },
  { 35, 2 },
  { 19, 18 },
  { 31, 6 },
  { 9, 29 },
  { 35, 3 },
  { 29, 9 },
  { 5, 33 },
  { 23, 15 },
  { 33, 5 },
  { 15, 23 },
  { 37, 1 },
  { 3, 35 },
  { 1, 37 },
  { 10, 29 },
  { 31, 8 },
  { 5, 34 },
  { 4, 35 },
  { 1, 38 },
  { 35, 4 },
  { 29, 10 },
  { 34, 5 },
  { 37, 2 },
  { 2, 37 },
  { 19, 20 },
  { 8, 31 },
  { 20, 19 },
  { 38, 1 },
  { 31, 9 },
  { 39, 1 },
  { 37, 3 },
  { 3, 37 },
  { 9, 31 },
  { 1, 39 },
  { 38, 3 },
  { 11, 30 },
  { 9, 32 },
  { 26, 15 },
  { 31, 10 },
  { 29, 12 },
  { 32, 9 },
  { 20, 21 },
  { 2, 39 },
  { 35, 6 },
  { 33, 8 },
  { 5, 36 },
  { 37, 4 },
  { 21, 20 },
  { 15, 26 },
  { 40, 1 },
  { 8, 33 },
  { 10, 31 },
  { 30, 11 },
  { 12, 29 },
  { 23, 18 },
  { 17, 24 },
  { 36, 5 },
  { 40, 1 },
  { 1, 40 },
  { 4, 37 },
  { 24, 17 },
  { 39, 2 },
  { 6, 35 },
  { 18, 23 },
  { 3, 38 },
  { 41, 1 },
  { 37, 5 },
  { 5, 37 },
  { 1, 41 },
  { 33, 10 },
  { 3, 40 },
  { 4, 39 },
  { 1, 42 },
  { 37, 6 },
  { 13, 30 },
  { 12, 31 },
  { 42, 1 },
  { 10, 33 },
  { 7, 36 },
  { 36, 7 },
  { 9, 34 },
  { 41, 2 },
  { 35, 8 },
  { 40, 3 },
  { 8, 35 },
  { 5, 38 },
  { 2, 41 },
  { 39, 4 },
  { 38, 5 }
};

struct DynamicJIRatioCandidate {
  byte numerator;
  byte denominator;
  float cents;
};

std::vector<DynamicJIRatioCandidate> activeDynamicJIRatios = {};

void syncDynamicJIRatioCandidates() {
  activeDynamicJIRatios.clear();
  activeDynamicJIRatios.reserve(ratios.size());
  for (const auto& ratio : ratios) {
    if (ratioIsInSelectedJITable(ratio)) {
      activeDynamicJIRatios.push_back({
        ratio.first,
        ratio.second,
        ratioToCents(static_cast<float>(ratio.first) / static_cast<float>(ratio.second))
      });
    }
  }
  if (activeDynamicJIRatios.empty()) {
    activeDynamicJIRatios.push_back({ 1, 1, 0.0f });
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

  float finalMidiPitch = h[x].midiPitch;
  if (useDynamicJustIntonation || useJustIntonationBPM) {
    finalMidiPitch += h[x].jiRetuneCents / 100.0f;
  }
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
  float basePitchOffset = 0;
  if (useJustIntonationBPM) {
    float buttonStepsFromA = -current.tuning().spanCtoA() - h[x].stepsFromC;
    // It was planned to use integer math but floating point arithmetics works fast enough so far
    float rounding = ((float)justIntonationBPM / 60.0 * justIntonationBPM_Multiplier);
    pitchAdjustmentCents = (buttonStepsFromA * current.tuning().stepSize) - ratioToCents(round(440.0 / rounding) / round(h[x].frequency / rounding));

    if (pressedKeyIDs.size() > 1 && useDynamicJustIntonation) {
      basePitchOffset = ((-current.tuning().spanCtoA() - h[pressedKeyIDs[0]].stepsFromC) * current.tuning().stepSize) - ratioToCents(round(440.0 / rounding) / round(h[pressedKeyIDs[0]].frequency / rounding));
    }
  }
  if (useDynamicJustIntonation && pressedKeyIDs.size() > 1) {
    //bool ratioFound = false;  // I might need this one later
    bool preferSmallRatios = true;  // if false - the closest found ratio will be chosen from the ratio table

    // detune within a 1/4 of a step, avoid wild detuning but cover the entire pitch range
    float errorThreshold = current.tuning().stepSize / 4.0;
    float deviation = INFINITY;
      float EDOCents = ratioToCents(h[pressedKeyIDs[0]].frequency / h[x].frequency);
    std::pair<byte, byte> selectedRatio;

    if (activeDynamicJIRatios.empty()) {
      syncDynamicJIRatioCandidates();
    }
    for (int i = 0; i < activeDynamicJIRatios.size(); i++) {
      auto ratio = activeDynamicJIRatios[i];
      //if(h[pressedKeyIDs[0]].note < h[x].note)
      //{
      //  std::swap(ratio1,ratio0);
      //}
      float ratioCents = ratio.cents;

      if (std::abs(deviation) > std::abs(ratioCents - EDOCents)) {
        deviation = (EDOCents - ratioCents);
        selectedRatio.first = ratio.numerator;
        selectedRatio.second = ratio.denominator;
        if (preferSmallRatios && std::abs(deviation) < errorThreshold) {
          //ratioFound = true;
            break;
          }
        }
      }
    //if(ratioFound)
    {
      pitchAdjustmentCents = deviation + basePitchOffset;
    }
  }
  int16_t pitchAdjustment = centsToRelativePitchBend(pitchAdjustmentCents);
  h[x].jiRetune = pitchAdjustment;
  h[x].jiRetuneCents = pitchAdjustmentCents;
  h[x].jiFrequencyMultiplier = centsToFrequencyMultiplier(pitchAdjustmentCents);
  return pitchAdjustment;
}
#endif  // HEXBOARD_FIRMWARE_UNITY
