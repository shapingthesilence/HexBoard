#include "../FirmwareModule.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/RuntimeDefaults.h"
#include "../hardware/GridState.h"
#include "MidiRouting.h"
#include "NoteDispatch.h"
#include "../app/PlatformCommon.h"
#include "../menu/PlayedNotesOverlay.h"
#include "../storage/PresetSync.h"
#include "../synth/SynthAudio.h"
#include "../tuning/DynamicJustIntonation.h"

namespace {

struct MappedButtonActiveTone {
  bool midiActive = false;
  bool releaseMidiChannel = false;
  byte midiNote = UNUSED_NOTE;
  byte midiChannel = 0;
  SynthPreviewNoteHandle synth;
};

MappedButtonActiveTone mappedButtonActiveTones[LED_COUNT][USER_GEOMETRY_MAX_CHORD_TONES] = {};
uint8_t mappedButtonMidiNoteDepth[MIDI_CHANNEL_COUNT][MIDI_NOTES_PER_CHANNEL] = {};

const UserGeometryChordAction* RAM_FUNC(findMappedChordAction)(uint8_t id) {
  for (const UserGeometryChordAction& action : userGeometryRuntime.chordActions) {
    if (action.active && action.id == id) {
      return &action;
    }
  }
  return nullptr;
}

byte RAM_FUNC(nearestMidiNote)(float midiPitch) {
  if (midiPitch <= 0.0f) {
    return 0;
  }
  if (midiPitch >= 127.0f) {
    return 127;
  }
  return static_cast<byte>(roundf(midiPitch));
}

int16_t RAM_FUNC(pitchBendForMidiPitch)(float midiPitch, byte midiNote) {
  float residualCents = (midiPitch - static_cast<float>(midiNote)) * 100.0f;
  float bendScale = 8192.0f / (100.0f * static_cast<float>(MPEpitchBendSemis));
  return static_cast<int16_t>(std::clamp<int32_t>(
    static_cast<int32_t>(roundf(residualCents * bendScale)), -8192, 8191
  ));
}

bool RAM_FUNC(resolveMappedTunedMidi)(int16_t pitchSteps,
                                     byte& noteOut,
                                     byte& channelOut,
                                     int16_t& bendOut,
                                     bool& releaseMidiChannelOut) {
  bendOut = 0;
  releaseMidiChannelOut = false;
  int32_t relativeSteps = currentPitchStepsFromReference(pitchSteps);
  if (relativeSteps < std::numeric_limits<int16_t>::min()
      || relativeSteps > std::numeric_limits<int16_t>::max()) {
    return false;
  }
  if (standardMidiMicrotonalActive) {
    int32_t midiIndex = static_cast<int32_t>(currentTuningReferenceMidiNote()) + relativeSteps;
    mapExtendedMidiNote(midiIndex, standardMidiBaseChannel, noteOut, channelOut);
    return isValidMidiChannel(channelOut);
  }

  float midiPitch = stepsToMIDI(static_cast<int16_t>(relativeSteps));
  if (midiPitch < 0.0f || midiPitch >= 128.0f) {
    return false;
  }
  noteOut = nearestMidiNote(midiPitch);
  if (MPEpitchBendsNeeded == 1) {
    channelOut = isValidMidiChannel(defaultMidiChannel) ? defaultMidiChannel : MIDI_CHANNEL_MIN;
    return true;
  }

  uint8_t availableChannels = mpePlayableChannelCount();
  if (availableChannels == 0) {
    return false;
  }
  if (mpeChannelQueueActive) {
    channelOut = takeMPEChannel();
    if (!channelOut) {
      return false;
    }
    releaseMidiChannelOut = true;
  } else {
    channelOut = static_cast<byte>(mpeLowestChannel + positiveMod(pitchSteps, availableChannels));
  }
  bendOut = pitchBendForMidiPitch(midiPitch, noteOut);
  return isValidMidiChannel(channelOut);
}

void RAM_FUNC(startMappedMidiTone)(MappedButtonActiveTone& active,
                                   bool tuned,
                                   int16_t pitchSteps,
                                   byte directMidiNote,
                                   byte directMidiChannel) {
  byte midiNote = directMidiNote;
  byte midiChannel = directMidiChannel;
  int16_t pitchBend = 0;
  bool releaseMidiChannel = false;
  if (tuned) {
    if (!resolveMappedTunedMidi(pitchSteps, midiNote, midiChannel, pitchBend, releaseMidiChannel)) {
      return;
    }
  } else if (midiNote > 127 || !isValidMidiChannel(midiChannel)) {
    return;
  }

  if (tuned && MPEpitchBendsNeeded != 1) {
    withMIDI([&](auto& M) { M.sendPitchBend(pitchBend, midiChannel); });
    if (extraMPE) {
      withMIDI([&](auto& M) {
        M.sendAfterTouch(velWheel.curValue, midiChannel);
        M.sendControlChange(74, CC74value, midiChannel);
      });
    }
  }

  uint8_t& depth = mappedButtonMidiNoteDepth[midiChannel - 1][midiNote];
  if (depth == 0) {
    byte velocity = velWheel.curValue == 0 ? 1 : velWheel.curValue;
    withMIDI([&](auto& M) { M.sendNoteOn(midiNote, velocity, midiChannel); });
  }
  if (depth < std::numeric_limits<uint8_t>::max()) {
    ++depth;
  }
  active.midiActive = true;
  active.releaseMidiChannel = releaseMidiChannel;
  active.midiNote = midiNote;
  active.midiChannel = midiChannel;
}

void RAM_FUNC(stopMappedTone)(MappedButtonActiveTone& active) {
  stopSynthPreviewNote(active.synth);
  if (active.midiActive && isValidMidiChannel(active.midiChannel) && active.midiNote < 128) {
    uint8_t& depth = mappedButtonMidiNoteDepth[active.midiChannel - 1][active.midiNote];
    if (depth > 0) {
      --depth;
    }
    if (depth == 0) {
      withMIDI([&](auto& M) { M.sendNoteOff(active.midiNote, 0, active.midiChannel); });
    }
    if (active.releaseMidiChannel) {
      if (extraMPE) {
        withMIDI([&](auto& M) {
          M.sendAfterTouch(0, active.midiChannel);
          M.sendControlChange(74, CC74value, active.midiChannel);
        });
      }
      releaseMPEChannel(active.midiChannel);
    }
  }
  active = MappedButtonActiveTone{};
}

void RAM_FUNC(startMappedSynthTone)(MappedButtonActiveTone& active,
                                    int16_t pitchSteps,
                                    bool tuned,
                                    byte directMidiNote) {
  float frequency = 0.0f;
  byte displayNote = directMidiNote;
  if (tuned) {
    int32_t relativeSteps = currentPitchStepsFromReference(pitchSteps);
    if (relativeSteps < std::numeric_limits<int16_t>::min()
        || relativeSteps > std::numeric_limits<int16_t>::max()) {
      return;
    }
    frequency = stepsToFrequency(static_cast<int16_t>(relativeSteps));
    displayNote = nearestMidiNote(stepsToMIDI(static_cast<int16_t>(relativeSteps)));
  } else {
    frequency = MIDItoFreq(directMidiNote);
  }
  startSynthPreviewNote(pitchSteps, frequency, displayNote, velWheel.curValue, active.synth);
}

}  // namespace

bool RAM_FUNC(mappedButtonHasAdvancedAction)(byte x) {
  return x < LED_COUNT
         && userGeometryRuntime.active
         && userGeometryRuntime.buttonOutputMode[x] != PRESET_SYNC_BUTTON_OUTPUT_TUNED;
}

void RAM_FUNC(tryMappedButtonActionOn)(byte x) {
  if (!mappedButtonHasAdvancedAction(x)) {
    return;
  }
  tryMappedButtonActionOff(x);

  uint8_t outputMode = userGeometryRuntime.buttonOutputMode[x];
  if (outputMode == PRESET_SYNC_BUTTON_OUTPUT_DIRECT_MIDI) {
    MappedButtonActiveTone& active = mappedButtonActiveTones[x][0];
    byte note = userGeometryRuntime.buttonMidiNote[x];
    byte channel = userGeometryRuntime.buttonMidiChannel[x];
    startMappedMidiTone(active, false, h[x].stepsFromC, note, channel);
    startMappedSynthTone(active, h[x].stepsFromC, false, note);
    return;
  }

  const UserGeometryChordAction* action = findMappedChordAction(userGeometryRuntime.buttonChordActionId[x]);
  if (!action) {
    return;
  }
  bool tuned = action->pitchMode == PRESET_SYNC_CHORD_PITCH_TUNING_STEPS;
  for (uint8_t tone = 0; tone < action->toneCount && tone < USER_GEOMETRY_MAX_CHORD_TONES; ++tone) {
    MappedButtonActiveTone& active = mappedButtonActiveTones[x][tone];
    if (tuned) {
      int16_t pitchSteps = static_cast<int16_t>(std::clamp<int32_t>(
        static_cast<int32_t>(h[x].stepsFromC) + action->intervals[tone],
        std::numeric_limits<int16_t>::min(),
        std::numeric_limits<int16_t>::max()
      ));
      startMappedMidiTone(active, true, pitchSteps, 0, 0);
      startMappedSynthTone(active, pitchSteps, true, 0);
    } else {
      int16_t midiNote = static_cast<int16_t>(userGeometryRuntime.buttonChordRootMidiNote[x]) + action->intervals[tone];
      if (midiNote < 0 || midiNote > 127 || !isValidMidiChannel(action->midiChannel)) {
        continue;
      }
      startMappedMidiTone(active, false, h[x].stepsFromC, static_cast<byte>(midiNote), action->midiChannel);
      startMappedSynthTone(active, h[x].stepsFromC, false, static_cast<byte>(midiNote));
    }
  }
}

void RAM_FUNC(tryMappedButtonActionOff)(byte x) {
  if (x >= LED_COUNT) {
    return;
  }
  for (MappedButtonActiveTone& active : mappedButtonActiveTones[x]) {
    stopMappedTone(active);
  }
}

void RAM_FUNC(releaseAllMappedButtonActions)() {
  for (byte button = 0; button < LED_COUNT; ++button) {
    tryMappedButtonActionOff(button);
  }
  memset(mappedButtonMidiNoteDepth, 0, sizeof(mappedButtonMidiNoteDepth));
}

void RAM_FUNC(tryMIDInoteOn)(byte x) {
  // This gets called on any non-command hex that is not scale-locked.
  if (h[x].note >= 128) {
    return;
  }
  if (!(h[x].MIDIch)) {
    if (MPEpitchBendsNeeded == 1) {
      if (standardMidiMicrotonalActive) {
        h[x].MIDIch = h[x].mappedMidiChannel ? h[x].mappedMidiChannel : defaultMidiChannel;
      } else {
        h[x].MIDIch = defaultMidiChannel;
      }
    } else {
      uint8_t availableChannels = mpePlayableChannelCount();
      if (availableChannels == 0) {
        sendToLog("No MPE channels configured; skipped MIDI note");
      } else if (mpeChannelQueueActive) {
        byte channel = takeMPEChannel();
        if (!channel) {
          sendToLog("MPE pool was empty so did not play a MIDI note");
        } else {
          h[x].MIDIch = channel;
          sendToLog("Assigned MPE ch " + std::to_string(h[x].MIDIch) + " from pool");
        }
      } else {
        h[x].MIDIch = static_cast<byte>(mpeLowestChannel + positiveMod(h[x].stepsFromC, availableChannels));
      }
    }

    if (h[x].MIDIch) {
      pressedKeyIDs.add(x);  // Dynamic JI pressed key tracking
      justIntonationRetune(x);
      prepareActiveMidiPitch(x);
      int16_t pitchBendValue = 0;
      // First, send the pitch bend (if applicable)
      if (MPEpitchBendsNeeded != 1) {
        pitchBendValue = h[x].activePitchBend;
        withMIDI([&](auto& M) { M.sendPitchBend(pitchBendValue, h[x].MIDIch); });  // ch 1-16
        if (extraMPE) { // if the extra MPE messages are enabled
          withMIDI([&](auto& M) {
            M.sendAfterTouch(velWheel.curValue, h[x].MIDIch);  // Channel Pressure
            M.sendControlChange(74, CC74value, h[x].MIDIch);   // CC74 (Timbre)
          });
        }
      }
      // Then, send the note-on message
      withMIDI([&](auto& M) { M.sendNoteOn(h[x].activeMidiNote, velWheel.curValue, h[x].MIDIch); });  // ch 1-16
      noteOverlayReleaseGraceUntil = 0;
      if (noteDisplayEnabled()) {
        schedulePlayedNotesOverlayUpdate(screenSaverOn);
      }

      sendToLog(
        "Sent MIDI pitch bend: " + std::to_string(pitchBendValue) + " to ch " + std::to_string(h[x].MIDIch));
      sendToLog(
        "Sent MIDI noteOn: " + std::to_string(h[x].activeMidiNote) + " vel " + std::to_string(velWheel.curValue) + " ch " + std::to_string(h[x].MIDIch));
    }
  }
}

void RAM_FUNC(tryMIDInoteOff)(byte x) {
  // this gets called on any non-command hex
  // that is not scale-locked.
  if (h[x].MIDIch) {  // but just in case, check
    byte noteOff = (h[x].activeMidiNote < 128) ? h[x].activeMidiNote : h[x].note;
    withMIDI([&](auto& M) { M.sendNoteOff(noteOff, velWheel.curValue, h[x].MIDIch); });
    pressedKeyIDs.remove(x);  // Dynamic JI pressed key tracking
    h[x].jiRetune = 0;
    h[x].jiRetuneCents = 0.0f;
    h[x].jiFrequencyMultiplier = 1.0f;
    h[x].activeMidiNote = UNUSED_NOTE;
    h[x].activePitchBend = 0;
    sendToLog(
      "sent note off: " + std::to_string(noteOff) + " vel " + std::to_string(velWheel.curValue) + " ch " + std::to_string(h[x].MIDIch));
    if (mpeChannelQueueActive && h[x].MIDIch >= mpeLowestChannel && h[x].MIDIch <= mpeHighestChannel) {
      if (extraMPE) { //if the extra MPE messages are enabled
        withMIDI([&](auto& M) {
          M.sendAfterTouch(0, h[x].MIDIch);                 // Channel Pressure
          M.sendControlChange(74, CC74value, h[x].MIDIch);  // CC74 (Timbre)
        });
      }
      releaseMPEChannel(h[x].MIDIch);
    }
    noteOverlayReleaseGraceUntil = runTime + DISPLAYED_NOTES_RELEASE_GRACE_MICROS;
    h[x].MIDIch = 0;
    if (noteDisplayEnabled()) {
      schedulePlayedNotesOverlayUpdate(false);
    }
  }
}
