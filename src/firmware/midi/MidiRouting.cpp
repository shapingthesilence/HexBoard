#include "../FirmwareModule.h"
#include "MidiRouting.h"
#include "MidiTransport.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../app/RuntimeDefaults.h"
#include "../hardware/GridState.h"
#include "../model/ScalePalettePreset.h"

uint16_t mpeChannelBitmap = 0;  // bitmap of available MPE channels (bit N = channel N+1)
byte MPEpitchBendsNeeded;
bool mpeChannelQueueActive = false;

namespace {

int32_t floorDiv(int32_t numerator, int32_t denominator) {
  if (denominator <= 0) {
    return 0;
  }
  int32_t quotient = numerator / denominator;
  int32_t remainder = numerator % denominator;
  if (remainder < 0) {
    --quotient;
  }
  return quotient;
}

uint16_t wrappedTableDegree(int32_t stepsFromA, uint16_t cycleLength) {
  if (cycleLength == 0) {
    return 0;
  }
  int32_t remainder = stepsFromA % static_cast<int32_t>(cycleLength);
  if (remainder < 0) {
    remainder += cycleLength;
  }
  return static_cast<uint16_t>(remainder);
}

int32_t roundedDiv(int32_t numerator, int32_t denominator) {
  if (denominator <= 0) {
    return 0;
  }
  if (numerator >= 0) {
    return (numerator + (denominator / 2)) / denominator;
  }
  return -((-numerator + (denominator / 2)) / denominator);
}

int32_t referenceStepsFromC() {
  if (!userGeometryRuntimeActive) {
    return -current.tuning().spanCtoA();
  }
  int32_t semitonesFromC4 = static_cast<int32_t>(currentTuningReferenceMidiNote()) - 60;
  return roundedDiv(static_cast<int32_t>(current.tuning().cycleLength) * semitonesFromC4, 12);
}

bool centsTableMatchesStandardSemitones() {
  if (!userGeometryRuntimeCentsTableActive
      || userGeometryRuntimeCentsTableLength == 0
      || userGeometryRuntimePeriodMilliCents != static_cast<int32_t>(userGeometryRuntimeCentsTableLength * 100000)) {
    return false;
  }
  for (uint16_t degree = 1; degree <= userGeometryRuntimeCentsTableLength; ++degree) {
    if (userGeometryRuntimeCentsTableMilliCents[degree - 1] != static_cast<int32_t>(degree * 100000)) {
      return false;
    }
  }
  return true;
}

bool referenceHzMatchesStandardMidiNote() {
  return std::fabs(currentTuningReferenceHz() - MIDItoFreq(currentTuningReferenceMidiNote())) < 0.001f;
}

}  // namespace

uint8_t mpePlayableChannelCount() {
  if (mpeHighestChannel < mpeLowestChannel) {
    return 0;
  }
  return static_cast<uint8_t>(mpeHighestChannel - mpeLowestChannel + 1);
}

void resetMPEChannelPool() {
  mpeChannelBitmap = 0;
  for (byte ch = mpeLowestChannel; ch <= mpeHighestChannel; ++ch) {
    mpeChannelBitmap |= (1u << (ch - 1));
    sendToLog("added ch " + std::to_string(ch) + " to the MPE pool");
  }
}

byte RAM_FUNC(takeMPEChannel)() {
  if (mpeChannelBitmap == 0) {
    return 0;
  }
  // Always take lowest available channel (equivalent to sorted front() for low-priority,
  // and a reasonable FIFO-like behavior otherwise)
  byte ch = static_cast<byte>(__builtin_ctz(mpeChannelBitmap) + 1);
  mpeChannelBitmap &= ~(1u << (ch - 1));
  return ch;
}

void RAM_FUNC(releaseMPEChannel)(byte ch) {
  if (ch < mpeLowestChannel || ch > mpeHighestChannel) {
    return;
  }
  mpeChannelBitmap |= (1u << (ch - 1));
  sendToLog("returned ch " + std::to_string(ch) + " to the MPE pool");
}

float freqToMIDI(float Hz) {  // formula to convert from Hz to MIDI note
  return CONCERT_A_MIDI_NOTE + 12.0f * log2f(Hz / CONCERT_A_HZ);
}
float MIDItoFreq(float midi) {  // formula to convert from MIDI note to Hz
  return CONCERT_A_HZ * exp2((midi - CONCERT_A_MIDI_NOTE) / 12.0f);
}

uint8_t currentTuningReferenceMidiNote() {
  if (userGeometryRuntimeActive) {
    return userGeometryRuntimeReferenceMidiNote;
  }
  return static_cast<uint8_t>(CONCERT_A_MIDI_NOTE);
}

float currentTuningReferenceHz() {
  if (userGeometryRuntimeActive && userGeometryRuntimeReferenceHz > 0.0f) {
    return userGeometryRuntimeReferenceHz;
  }
  return CONCERT_A_HZ;
}

float currentTuningNominalStepSizeCents() {
  if (userGeometryRuntimeActive
      && userGeometryRuntimeCentsTableActive
      && userGeometryRuntimeCentsTableLength > 0
      && userGeometryRuntimePeriodMilliCents > 0) {
    return (static_cast<float>(userGeometryRuntimePeriodMilliCents) / 1000.0f)
           / static_cast<float>(userGeometryRuntimeCentsTableLength);
  }
  return current.tuning().stepSize;
}

int32_t currentPitchStepsFromReference(int16_t stepsFromC) {
  if (!userGeometryRuntimeActive) {
    return current.pitchRelToA4(stepsFromC);
  }
  return static_cast<int32_t>(stepsFromC) + current.transpose - referenceStepsFromC();
}

float stepsToCentsFromReference(int16_t stepsFromReference) {
  if (userGeometryRuntimeActive
      && userGeometryRuntimeCentsTableActive
      && userGeometryRuntimeCentsTableLength > 0
      && userGeometryRuntimePeriodMilliCents > 0) {
    uint16_t cycleLength = userGeometryRuntimeCentsTableLength;
    int32_t periodOffset = floorDiv(stepsFromReference, cycleLength);
    uint16_t degree = wrappedTableDegree(stepsFromReference, cycleLength);
    int64_t milliCents = static_cast<int64_t>(periodOffset) * userGeometryRuntimePeriodMilliCents;
    if (degree > 0) {
      milliCents += userGeometryRuntimeCentsTableMilliCents[degree - 1];
    }
    return static_cast<float>(milliCents) / 1000.0f;
  }
  return static_cast<float>(stepsFromReference) * static_cast<float>(current.tuning().stepSize);
}

float stepsToFrequency(int16_t stepsFromReference) {
  float referenceHz = currentTuningReferenceHz();
  if (referenceHz <= 0.0f) {
    return 0.0f;
  }
  return referenceHz * exp2f(stepsToCentsFromReference(stepsFromReference) / 1200.0f);
}

float stepsToMIDI(int16_t stepsFromReference) {  // return the MIDI pitch associated
  float frequency = stepsToFrequency(stepsFromReference);
  return frequency > 0.0f ? freqToMIDI(frequency) : -1.0f;
}

bool currentTuningIsStandardSemitone() {
  if (!referenceHzMatchesStandardMidiNote()) {
    return false;
  }
  if (userGeometryRuntimeActive && userGeometryRuntimeCentsTableActive) {
    return centsTableMatchesStandardSemitones();
  }
  return current.tuning().stepSize == 100.0f;
}

void sendSysExToConfiguredMidiOutputs(unsigned length, const byte* data) {
  withMIDI([&](auto& M) { M.sendSysEx(length, data); });
}

void setPitchBendRange(byte Ch, byte semitones) {
  withMIDI([&](auto& M) {
    M.beginRpn(0, Ch);
    M.sendRpnValue(semitones << 7, Ch);
    M.endRpn(Ch);
  });
  sendToLog(
    "set pitch bend range on ch " + std::to_string(Ch) + " to be " + std::to_string(semitones) + " semitones");
}

void setMPEzone(byte masterCh, byte sizeOfZone) {
  withMIDI([&](auto& M) {
    M.beginRpn(6, masterCh);
    M.sendRpnValue(sizeOfZone << 7, masterCh);
    M.endRpn(masterCh);
  });
  sendToLog(
    "tried sending MIDI msg to set MPE zone, master ch " + std::to_string(masterCh) + ", zone of this size: " + std::to_string(sizeOfZone));
}

void resetTuningMIDI() {
  /*
      One of the ways that microtonal MIDI works
      is via MPE (MIDI polyphonic expression).
      This assigns re-tuned notes to an independent channel
      so they can be pitched separately.

      We can now use microtonal tunings without MPE
      by sending standard MIDI note numbers across
      multiple channels to be retuned by other software
      or hardware.

      If operating in a standard 12-EDO tuning, with MPE
      disabled, or in a tuning with steps that are exact
      multiples of 100 cents, then MPE is not necessary.
    */
  standardMidiMicrotonalActive = false;
  bool tuningIsStandardSemitone = currentTuningIsStandardSemitone();
  bool forceMPE = (mpeUserMode == MPE_MODE_FORCE);
  bool disableMPE = (mpeUserMode == MPE_MODE_DISABLE);
  bool mpeOptional = !forceMPE && !useDynamicJustIntonation && !useJustIntonationBPM;

  if (forceMPE) {
    MPEpitchBendsNeeded = 255;
  } else if (disableMPE) {
    standardMidiMicrotonalActive = !tuningIsStandardSemitone;
    MPEpitchBendsNeeded = 1;
  } else if (mpeOptional && tuningIsStandardSemitone) {
    MPEpitchBendsNeeded = 1;  // Standard 12EDO, single-channel mode
  } else {
    MPEpitchBendsNeeded = 255;  // Enables MPE mode when microtonal needs per-note pitch bends
  }
  clampMPEChannelRange();

  uint8_t playableChannels = mpePlayableChannelCount();
  if (playableChannels == 0) {
    mpeLowestChannel = MPE_CHANNEL_MIN;
    mpeHighestChannel = MPE_CHANNEL_MIN;
    playableChannels = mpePlayableChannelCount();
  }

  bool mpeEnabled = (MPEpitchBendsNeeded > 1);

  if (mpeEnabled) {
    byte zoneSize = 0;
    if (mpeHighestChannel > 1) {
      zoneSize = static_cast<byte>(mpeHighestChannel - 1);
    }
    setMPEzone(1, zoneSize);  // Advertise the highest channel we plan to use.
  } else {
    setMPEzone(1, 0);
  }

  mpeChannelQueueActive = false;
  mpeChannelBitmap = 0;

  if (mpeEnabled) {
    bool needsQueue = (MPEpitchBendsNeeded > playableChannels) || mpeLowPriorityMode;
    mpeChannelQueueActive = needsQueue;
    if (needsQueue) {
      resetMPEChannelPool();
    }
  }
  // Reset controllers and ensure every channel uses the appropriate pitch-bend range.
  for (byte i = MIDI_CHANNEL_MIN; i <= MIDI_CHANNEL_MAX; ++i) {
    withMIDI([&](auto& M) { M.sendControlChange(123, 0, i); });
    byte range = DEFAULT_PITCH_BEND_RANGE_SEMITONES;
    if (mpeEnabled && i >= mpeLowestChannel && i <= mpeHighestChannel) {
      range = MPEpitchBendSemis;
    }
    setPitchBendRange(i, range);
  }
}

byte primaryMIDIChannel() {
  if (MPEpitchBendsNeeded == 1 && isValidMidiChannel(defaultMidiChannel)) {
    return defaultMidiChannel;
  }
  return MIDI_CHANNEL_MIN;  // In MPE mode, channel 1 is the master channel.
}

void RAM_FUNC(sendMIDImodulationToCh1)() {
  byte targetChannel = primaryMIDIChannel();
  withMIDI([&](auto& M) { M.sendControlChange(1, modWheel.curValue, targetChannel); });
  sendToLog("sent mod value " + std::to_string(modWheel.curValue) + " to ch " + std::to_string(targetChannel));
}

void RAM_FUNC(sendMIDIpitchBendToCh1)() {
  byte targetChannel = primaryMIDIChannel();
  withMIDI([&](auto& M) { M.sendPitchBend(pbWheel.curValue, targetChannel); });
  sendToLog("sent pb wheel value " + std::to_string(pbWheel.curValue) + " to ch " + std::to_string(targetChannel));
}
