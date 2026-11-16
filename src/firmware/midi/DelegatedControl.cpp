#include "../FirmwareModule.h"
#include "DelegatedControl.h"
#include "MidiTransport.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../hardware/GridState.h"
#include "../hardware/LedRender.h"
#include "../storage/PresetSync.h"
#include "../synth/SynthAudio.h"

namespace {
// All MIDI input and session transitions belong to core 0.
uint32_t sessionToken = 0;
constexpr byte sessionProtocolVersion = 2;

uint32_t decodeSessionToken(const uint8_t* bytes) {
  return (static_cast<uint32_t>(bytes[0]) << 21) | (static_cast<uint32_t>(bytes[1]) << 14)
    | (static_cast<uint32_t>(bytes[2]) << 7) | bytes[3];
}

void sendSessionStatus(uint32_t token, byte status) {
  byte message[] = {0x7D, SYSEX_DELEGATED_SESSION_STATUS, sessionProtocolVersion,
    static_cast<byte>((token >> 21) & 127), static_cast<byte>((token >> 14) & 127),
    static_cast<byte>((token >> 7) & 127), static_cast<byte>(token & 127), status};
  withMIDI([&](auto& midi) { midi.sendSysEx(sizeof(message), message); });
}
}  // namespace

bool reportDeviceIdentity(const uint8_t* data, const unsigned int len) {
  if (len == 6 && data[1] == 0x7E && data[3] == 0x06 && data[4] == 0x01) {
    // Respond to a device identity request.
    // TODO: 7D = educational/dev; replace when a manufacturer ID is assigned.
    static byte deviceIdentity[] = {
      0x7E, 0x00, 0x06, 0x02,             // Device ID response
      0x7D,                               // Educational/dev manufacturer ID
      0x01, 0x00,                         // Family, LSB-first
      0x01, 0x00,                         // Model, LSB-first
      Hardware_Version, 0x00, 0x00, 0x00  // Version, LSB-first
    };
    withMIDI([&](auto& M) { M.sendSysEx(sizeof(deviceIdentity), deviceIdentity); });
    return true;
  }
  return false;
}

void notePresetSyncTransferActivity(uint8_t message) {
  uint64_t now = readClock();
  if (!presetSyncTransferActive) {
    presetSyncTransferFrameCount = 0;
  }
  presetSyncTransferActive = true;
  presetSyncTransferLastActivity = now;
  presetSyncTransferDeadline = now + PRESET_SYNC_TRANSFER_TIMEOUT_MICROS;
  presetSyncTransferLastMessage = message;
  ++presetSyncTransferFrameCount;
}

void setDelegatedAppName(const uint8_t* data, const unsigned int len) {
  unsigned int out = 0;
  for (unsigned int i = 0; i < len && out < DELEGATED_APP_NAME_MAX; ++i) {
    uint8_t value = data[i] & 0x7F;
    if (value >= 32 && value <= 126) {
      delegatedControlState.appName[out++].store(static_cast<char>(value), std::memory_order_relaxed);
    }
  }
  if (out == 0) {
    constexpr char defaultName[] = "Host Application";
    for (char value : defaultName) {
      delegatedControlState.appName[out++].store(value, std::memory_order_relaxed);
    }
    return;
  }
  delegatedControlState.appName[out].store('\0', std::memory_order_relaxed);
}

void sendDelegatedEncoderEvent(byte event) {
  byte message[] = { 0x7D, SYSEX_DELEGATED_ENCODER_EVENT, event };
  withMIDI([&](auto& M) { M.sendSysEx(sizeof(message), message); });
}

void releaseActiveDelegatedNotes() {
  for (byte i = 0; i < LED_COUNT; ++i) {
    if (delegatedControlState.activeChannel[i] == 0 || delegatedControlState.activeNote[i] >= 128) {
      continue;
    }
    byte note = delegatedControlState.activeNote[i];
    byte channel = delegatedControlState.activeChannel[i];
    withMIDI([&](auto& M) { M.sendNoteOff(note, 0, channel); });
  }
  clearDelegatedNoteActivity();
}

void enterDelegatedControl(const uint8_t* appNameData = nullptr, const unsigned int appNameLen = 0) {
  const uint32_t previousToken = sessionToken;
  sessionToken = 0;
  if (previousToken != 0) sendSessionStatus(previousToken, 0);
  if (delegatedControlState.active) {
    releaseActiveDelegatedNotes();
  }
  setDelegatedAppName(appNameData, appNameLen);
  for (auto& color : delegatedControlState.ledHsv) {
    color.store(0, std::memory_order_relaxed);
  }
  clearDelegatedNoteActivity();
  delegatedControlState.displayDirty = true;
  delegatedControlState.displayWakeRequested = true;
  delegatedControlState.returnToMenuRequested = false;
  // Mode changes reset parsers only. Reopening Serial1 tears down its live
  // UART/FIFO; USB and serial endpoints belong to boot initialization.
  resetMidiInputParser(usbMidiInput);
  resetMidiInputParser(serialMidiInput);
  delegatedControlState.displayRotation = 0xff;
  delegatedControlState.active.store(true, std::memory_order_release);
  sendToLog("delegated = 1");
}

void exitDelegatedControl() {
  if (!delegatedControlState.active.exchange(false, std::memory_order_acq_rel)) {
    return;
  }
  releaseActiveDelegatedNotes();
  const uint32_t previousToken = sessionToken;
  sessionToken = 0;
  resetMidiInputParser(usbMidiInput);
  resetMidiInputParser(serialMidiInput);
  delegatedControlState.displayRotation = 0xff;
  if (previousToken != 0) sendSessionStatus(previousToken, 0);
  delegatedControlState.displayDirty = false;
  delegatedControlState.displayWakeRequested = false;
  delegatedControlState.returnToMenuRequested = true;
  sendToLog("delegated = 0");
}

void processSessionEnter(const uint8_t* data, unsigned int len) {
  if (len < 5 || data[0] != sessionProtocolVersion) return;
  const uint32_t token = decodeSessionToken(data + 1);
  if (token == 0) return;
  if (delegatedControlState.active) {
    if (sessionToken == token) sendSessionStatus(token, 1);
    else sendSessionStatus(token, 2);  // Busy: another host owns the surface.
    return;
  }
  for (byte i = 0; i < LED_COUNT; ++i) {
    if (h[i].btnState & 1) {
      sendSessionStatus(token, 2);  // Release held controls before changing owners.
      return;
    }
  }
  // A fresh session entry is processed in normal mode on core 0.
  panicStopOutput();
  resetDelegatedNoteMap();
  enterDelegatedControl(data + 5, len - 5);
  sessionToken = token;
  sendSessionStatus(token, 1);
}

void RAM_FUNC(delegatedButtonEvent)(byte x, bool press) {
  if (x >= LED_COUNT) {
    byte channel = x / 100;  // 0-based hundreds digit
    byte note = x % 100;
    if (press) {
      withMIDI([&](auto& M) { M.sendNoteOn(note, 127, channel + 1); });
    } else {
      withMIDI([&](auto& M) { M.sendNoteOff(note, 0, channel + 1); });
    }
    return;
  }

  if (press) {
    if (delegatedControlState.activeChannel[x] != 0 && delegatedControlState.activeNote[x] < 128) {
      byte activeNote = delegatedControlState.activeNote[x];
      byte activeChannel = delegatedControlState.activeChannel[x];
      withMIDI([&](auto& M) { M.sendNoteOff(activeNote, 0, activeChannel); });
    }
    byte channel = delegatedControlState.noteMapChannel[x];
    byte note = delegatedControlState.noteMapNote[x];
    delegatedControlState.activeChannel[x] = channel;
    delegatedControlState.activeNote[x] = note;
    withMIDI([&](auto& M) { M.sendNoteOn(note, 127, channel); });
  } else {
    if (delegatedControlState.activeChannel[x] == 0 || delegatedControlState.activeNote[x] >= 128) {
      return;
    }
    byte channel = delegatedControlState.activeChannel[x];
    byte note = delegatedControlState.activeNote[x];
    delegatedControlState.activeChannel[x] = 0;
    delegatedControlState.activeNote[x] = UNUSED_NOTE;
    withMIDI([&](auto& M) { M.sendNoteOff(note, 0, channel); });
  }
}

void processDelegatedNoteMapSysEx(const uint8_t* data, const unsigned int len) {
  if ((len % 4) != 0) {
    sendToLog("delegated note map SysEx has malformed trailing bytes; ignoring incomplete record");
  }
  for (unsigned int idx = 0; idx + 4 <= len; idx += 4) {
    uint16_t button = (data[idx] << 7) + data[idx + 1];
    byte channel = data[idx + 2] & 0x7F;
    byte note = data[idx + 3] & 0x7F;
    if (button >= LED_COUNT) {
      sendToLog("delegated note map: button " + std::to_string(button) + " is out of range; ignoring");
      continue;
    }
    if (channel < 1 || channel > 16) {
      sendToLog("delegated note map: channel " + std::to_string(channel) + " is out of range; ignoring");
      continue;
    }
    delegatedControlState.noteMapChannel[button] = channel;
    delegatedControlState.noteMapNote[button] = note;
  }
}

void processLedSysEx(const uint8_t* data, const unsigned int len) {
  // Repeated records: LED number (14 bits), hue (7 bits), saturation (7 bits), value (7 bits).
  for (unsigned int idx = 0; idx + 5 <= len; idx += 5) {
    uint16_t led = (data[idx] << 7) + data[idx + 1];
    if (led >= LED_COUNT) {
      sendToLog("LED SysEx: led " + std::to_string(led) + " is out of range; ignoring");
      continue;
    }
    byte hueData = data[idx + 2] & 0x7F;
    byte satData = data[idx + 3] & 0x7F;
    byte valData = data[idx + 4] & 0x7F;
    delegatedControlState.ledHsv[led].store(
      (static_cast<uint32_t>(hueData) << 16) | (static_cast<uint32_t>(satData) << 8) | valData,
      std::memory_order_relaxed);
  }
}

void processDelegatedSysEx(const uint8_t* data, const unsigned int len) {
  if (len < 1) {
    return;
  }
  switch (data[0]) {
    case SYSEX_DELEGATED_DISPLAY_ROTATION:
      if (len == 6 && data[5] < 4 && sessionToken != 0 && decodeSessionToken(data + 1) == sessionToken) {
        delegatedControlState.displayRotation.store(data[5], std::memory_order_relaxed);
        delegatedControlState.displayDirty.store(true, std::memory_order_release);
      }
      break;
    case SYSEX_DELEGATED_SESSION_ENTER:
      processSessionEnter(data + 1, len - 1);
      break;
    case SYSEX_DELEGATED_SESSION_EXIT:
      if (len == 5 && sessionToken != 0 && decodeSessionToken(data + 1) == sessionToken) {
        exitDelegatedControl();
      }
      break;
    case SYSEX_DELEGATED_ENTER:
      enterDelegatedControl(&data[1], len - 1);
      break;
    case SYSEX_DELEGATED_EXIT:
      exitDelegatedControl();
      break;
    case SYSEX_LED:
      processLedSysEx(&data[1], len - 1);
      break;
    case SYSEX_DELEGATED_NOTE_MAP:
      processDelegatedNoteMapSysEx(&data[1], len - 1);
      break;
    case SYSEX_DELEGATED_NOTE_MAP_RESET:
      resetDelegatedNoteMap();
      break;
    default:
      sendToLog("ignoring unknown delegated SysEx code " + std::to_string(data[0]));
      break;
  }
}

bool processIncomingSysEx(const uint8_t* data, const unsigned int len) {
  if (reportDeviceIdentity(data, len)) {
    return true;
  }
  if (processPresetSyncSysEx(data, len)) {
    return true;
  }
  if (len >= 9 && data[0] == 0xF0 && data[len - 1] == 0xF7 && data[1] == 0x7D && data[2] == SYSEX_DELEGATED_SESSION_ENTER) {
    processSessionEnter(data + 3, len - 4);
    return true;
  }
  if ((len >= 4) && (data[0] == 0xF0) && (data[len - 1] == 0xF7) && (data[1] == 0x7D) && (data[2] == SYSEX_DELEGATED_ENTER)) {
    enterDelegatedControl(&data[3], len - 4);
    return true;
  }
  return false;
}

bool processIncomingDelegatedSysEx(const uint8_t* sysex, const unsigned int len) {
  if (len <= 3 || reportDeviceIdentity(sysex, len)) {
    return true;
  }
  if ((sysex[0] != 0xF0) || (sysex[len - 1] != 0xF7)) {
    sendToLog("invalid delegated SysEx received; ignoring");
    return true;
  }
  if (sysex[1] != 0x7D) {
    sendToLog("delegated incoming: ignoring SysEx vendor " + std::to_string(sysex[1]));
    return true;
  }
  if (processPresetSyncSysEx(sysex, len)) {
    return true;
  }
  processDelegatedSysEx(&sysex[2], len - 3);
  return true;
}
