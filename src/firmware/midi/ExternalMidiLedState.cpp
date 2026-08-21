#include "../FirmwareModule.h"
#include "ExternalMidiLedState.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../app/RuntimeDefaults.h"
#include "../hardware/GridState.h"

constexpr uint64_t MIDI_IN_LED_COALESCE_MICROS = 1000;
constexpr uint64_t MIDI_IN_LED_MAX_DEFER_MICROS = 8000;

bool midiInLedDirty = false;
uint64_t midiInLedFirstDirtyTime = 0;
uint64_t midiInLedLastDirtyTime = 0;

void markMidiInLedDirty() {
  if (animationType != ANIMATE_MIDI_IN) {
    return;
  }
  uint64_t now = readClock();
  if (!midiInLedDirty) {
    midiInLedDirty = true;
    midiInLedFirstDirtyTime = now;
  }
  midiInLedLastDirtyTime = now;
}

bool shouldDeferMidiInLedRefresh() {
  if (!midiInLedDirty || animationType != ANIMATE_MIDI_IN) {
    return false;
  }

  uint64_t now = readClock();
  bool stillCoalescing = (now - midiInLedLastDirtyTime) < MIDI_IN_LED_COALESCE_MICROS;
  bool maxDeferReached = (now - midiInLedFirstDirtyTime) >= MIDI_IN_LED_MAX_DEFER_MICROS;
  if (stillCoalescing && !maxDeferReached) {
    return true;
  }

  midiInLedDirty = false;
  return false;
}

void RAM_FUNC(applyExternalMidiToHex)(byte midiNote, bool noteOn) {
  if (midiNote >= midiNoteToHexIndices.size()) {
    return;
  }
  auto& targets = midiNoteToHexIndices[midiNote];
  bool changed = false;
  for (size_t byteIndex = 0; byteIndex < targets.bits.size(); ++byteIndex) {
    uint8_t pending = targets.bits[byteIndex];
    while (pending != 0) {
      uint8_t bit = static_cast<uint8_t>(__builtin_ctz(pending));
      uint8_t index = static_cast<uint8_t>(byteIndex * 8 + bit);
      pending &= static_cast<uint8_t>(pending - 1);
      if (index >= LED_COUNT) {
        continue;
      }
      buttonDef& hex = h[index];
      if (noteOn) {
        if (hex.externalNoteDepth < 255) {
          hex.externalNoteDepth++;
          changed = true;
        }
      } else if (hex.externalNoteDepth > 0) {
        hex.externalNoteDepth--;
        changed = true;
      }
    }
  }
  if (changed) {
    markMidiInLedDirty();
  }
}
