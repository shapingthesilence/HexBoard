#include "../FirmwareModule.h"
#include "DelegatedControl.h"
#include "MidiTransport.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../hardware/GridState.h"
#include "../hardware/LedRender.h"
#include "../storage/PresetSync.h"

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
      delegatedAppName[out++] = static_cast<char>(value);
    }
  }
  if (out == 0) {
    strncpy(delegatedAppName, "Host Application", DELEGATED_APP_NAME_MAX + 1);
  } else {
    delegatedAppName[out] = '\0';
  }
}

void sendDelegatedEncoderEvent(byte event) {
  byte message[] = { 0x7D, SYSEX_DELEGATED_ENCODER_EVENT, event };
  withMIDI([&](auto& M) { M.sendSysEx(sizeof(message), message); });
}

void releaseActiveDelegatedNotes() {
  for (byte i = 0; i < LED_COUNT; ++i) {
    if (delegatedActiveChannel[i] == 0 || delegatedActiveNote[i] >= 128) {
      continue;
    }
    byte note = delegatedActiveNote[i];
    byte channel = delegatedActiveChannel[i];
    withMIDI([&](auto& M) { M.sendNoteOff(note, 0, channel); });
  }
  clearDelegatedNoteActivity();
}

void enterDelegatedControl(const uint8_t* appNameData = nullptr, const unsigned int appNameLen = 0) {
  if (delegatedControl) {
    releaseActiveDelegatedNotes();
  }
  setDelegatedAppName(appNameData, appNameLen);
  delegatedControl = true;
  memset(delegatedColors, 0, sizeof(delegatedColors));
  clearDelegatedNoteActivity();
  delegatedDisplayDirty = true;
  delegatedDisplayWakeRequested = true;
  delegatedReturnToMenuRequested = false;
  // Reset parser state when entering delegated mode.
  setupMIDI();
  sendToLog("delegated = 1");
}

void exitDelegatedControl() {
  if (!delegatedControl) {
    return;
  }
  releaseActiveDelegatedNotes();
  delegatedControl = false;
  delegatedDisplayDirty = false;
  delegatedDisplayWakeRequested = false;
  delegatedReturnToMenuRequested = true;
  sendToLog("delegated = 0");
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
    if (delegatedActiveChannel[x] != 0 && delegatedActiveNote[x] < 128) {
      byte activeNote = delegatedActiveNote[x];
      byte activeChannel = delegatedActiveChannel[x];
      withMIDI([&](auto& M) { M.sendNoteOff(activeNote, 0, activeChannel); });
    }
    byte channel = delegatedNoteMapChannel[x];
    byte note = delegatedNoteMapNote[x];
    delegatedActiveChannel[x] = channel;
    delegatedActiveNote[x] = note;
    withMIDI([&](auto& M) { M.sendNoteOn(note, 127, channel); });
  } else {
    if (delegatedActiveChannel[x] == 0 || delegatedActiveNote[x] >= 128) {
      return;
    }
    byte channel = delegatedActiveChannel[x];
    byte note = delegatedActiveNote[x];
    delegatedActiveChannel[x] = 0;
    delegatedActiveNote[x] = UNUSED_NOTE;
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
    delegatedNoteMapChannel[button] = channel;
    delegatedNoteMapNote[button] = note;
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
    colorDef c = {
      static_cast<float>(hueData) * 360.0f / 127.0f,
      static_cast<byte>(2 * satData + (satData > 63 ? 1 : 0)),
      static_cast<byte>(2 * valData + (valData > 63 ? 1 : 0))
    };
    delegatedColors[led] = getLEDcode(c);
  }
}

void processDelegatedSysEx(const uint8_t* data, const unsigned int len) {
  if (len < 1) {
    return;
  }
  switch (data[0]) {
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
