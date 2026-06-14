#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"
#include "DelegatedControl.h"
#include "ExternalMidiLedState.h"
#include "MidiInput.h"
#include "MidiTransport.h"

uint8_t midiDataLengthForStatus(uint8_t status) {
  switch (status & 0xF0) {
    case 0x80:
    case 0x90:
    case 0xA0:
    case 0xB0:
    case 0xE0:
      return 2;
    case 0xC0:
    case 0xD0:
      return 1;
    default:
      return 0;
  }
}

void processIncomingChannelMessage(uint8_t status, uint8_t data1, uint8_t data2, bool delegatedMode) {
  if (delegatedMode) {
    return;
  }

  switch (status & 0xF0) {
    case 0x80:
      applyExternalMidiToHex(data1, false);
      break;
    case 0x90:
      applyExternalMidiToHex(data1, data2 != 0);
      break;
    default:
      break;
  }
}

void dispatchIncomingSysEx(MidiInputParser& parser, bool delegatedMode) {
  if (delegatedMode) {
    processIncomingDelegatedSysEx(parser.sysex.data(), static_cast<unsigned int>(parser.sysex.size()));
  } else {
    processIncomingSysEx(parser.sysex.data(), static_cast<unsigned int>(parser.sysex.size()));
  }
  resetMidiInputParser(parser);
}

bool processIncomingMidiByte(MidiInputParser& parser, uint8_t value, bool delegatedMode) {
  if (value >= 0xF8) {
    return true;
  }

  if (parser.inSysEx) {
    if (value == 0xF0) {
      parser.sysex.clear();
    }
    if (parser.sysex.size() >= MIDI_SYSEX_BUFFER_MAX) {
      sendToLog("incoming SysEx exceeded buffer; discarded");
      resetMidiInputParser(parser);
      return true;
    }
    parser.sysex.push_back(value);
    if (value == 0xF7) {
      dispatchIncomingSysEx(parser, delegatedMode);
    }
    return true;
  }

  if (value == 0xF0) {
    resetMidiInputParser(parser);
    parser.inSysEx = true;
    parser.sysex.push_back(value);
    return true;
  }

  if (value & 0x80) {
    parser.status = value;
    parser.dataCount = 0;
    parser.dataNeeded = midiDataLengthForStatus(value);
    if (parser.dataNeeded > 0) {
      parser.runningStatus = value;
    } else {
      parser.runningStatus = 0;
    }
    return true;
  }

  if (parser.dataNeeded == 0) {
    if (parser.runningStatus == 0) {
      return true;
    }
    parser.status = parser.runningStatus;
    parser.dataNeeded = midiDataLengthForStatus(parser.status);
    parser.dataCount = 0;
  }

  if (parser.dataCount < sizeof(parser.data)) {
    parser.data[parser.dataCount++] = value & 0x7F;
  }

  if (parser.dataCount >= parser.dataNeeded) {
    processIncomingChannelMessage(parser.status, parser.data[0], parser.dataNeeded > 1 ? parser.data[1] : 0, delegatedMode);
    parser.dataCount = 0;
    parser.dataNeeded = midiDataLengthForStatus(parser.runningStatus);
    parser.status = parser.runningStatus;
  }

  return true;
}

bool processIncomingUsbMidi(bool delegatedMode) {
  bool processed = false;
  uint16_t drainedBytes = 0;
  while (MidiUSB.available() > 0 && drainedBytes < MIDI_INPUT_DRAIN_BYTE_LIMIT) {
    int value = MidiUSB.read();
    if (value < 0) {
      break;
    }
    ++drainedBytes;
    processed = processIncomingMidiByte(usbMidiInput, static_cast<uint8_t>(value), delegatedMode) || processed;
  }
  return processed || drainedBytes > 0;
}

bool processIncomingSerialMidi(bool delegatedMode) {
  bool processed = false;
  uint16_t drainedBytes = 0;
  while (Serial1.available() > 0 && drainedBytes < MIDI_INPUT_DRAIN_BYTE_LIMIT) {
    int value = Serial1.read();
    if (value < 0) {
      break;
    }
    ++drainedBytes;
    processed = processIncomingMidiByte(serialMidiInput, static_cast<uint8_t>(value), delegatedMode) || processed;
  }
  return processed || drainedBytes > 0;
}

bool processIncomingMIDIDelegated() {
  bool processed = false;
  if (midiD & MIDID_USB) {
    processed = processIncomingUsbMidi(true) || processed;
  }
  if (midiD & MIDID_SER) {
    processed = processIncomingSerialMidi(true) || processed;
  }
  return processed;
}

bool RAM_FUNC(processIncomingMIDI)() {
  if (delegatedControl) {
    return false;
  }
  bool processed = false;
  if (midiD & MIDID_USB) {
    processed = processIncomingUsbMidi(false) || processed;
  }
  if (midiD & MIDID_SER) {
    processed = processIncomingSerialMidi(false) || processed;
  }
  return processed;
}
#endif  // HEXBOARD_FIRMWARE_UNITY
