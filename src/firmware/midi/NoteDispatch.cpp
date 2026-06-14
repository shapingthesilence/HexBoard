#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"
#include "MidiRouting.h"
#include "NoteDispatch.h"
#include "../app/PlatformCommon.h"
#include "../menu/PlayedNotesOverlay.h"
#include "../tuning/DynamicJustIntonation.h"

void RAM_FUNC(tryMIDInoteOn)(byte x) {
  if (displayPlayedNotes && screenSaverOn) {
    setNoteOverlayTemporaryWake(true);
    noteOverlayDirty = true;
  }

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
      pressedKeyIDs.push_back(x);  // Dynamic JI pressed key tracking
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
      noteOverlayDirty = true;

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
    auto pressedKey = std::find(pressedKeyIDs.begin(), pressedKeyIDs.end(), x);
    if (pressedKey != pressedKeyIDs.end()) {
      pressedKeyIDs.erase(pressedKey);  // Dynamic JI pressed key tracking
    }
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
    noteOverlayDirty = true;
    h[x].MIDIch = 0;
  }
}

/*
    Eight voice polyphony can be simulated.
    Any more voices and the
    resolution is too low to distinguish;
    also, the code becomes too slow to keep
    up with the poll interval. This value
    can be safely reduced below eight if
    there are issues.

    Note this is NOT the same as the MIDI
    polyphony limit, which is 15 (based
    on using channel 2 through 16 for
    polyphonic expression mode).
  */
#define POLYPHONY_LIMIT 8

inline uint8_t RAM_FUNC(synthPlaybackVoiceLimit)(byte mode) {
  if (mode == SYNTH_POLY) {
    return POLYPHONY_LIMIT;
  }
  if (mode == SYNTH_OFF) {
    return 0;
  }
  return 1;
}

inline uint8_t RAM_FUNC(currentSynthVoiceLimit)() {
  return synthPlaybackVoiceLimit(playbackMode);
}
#endif  // HEXBOARD_FIRMWARE_UNITY
