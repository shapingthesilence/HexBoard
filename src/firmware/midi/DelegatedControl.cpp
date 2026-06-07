#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"

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

void onToggleDelegated() {
  if (delegatedControl) {
    memset(delegatedColors, 0, sizeof(delegatedColors));
    // Reset parser state when entering delegated mode.
    setupMIDI();
  }
  sendToLog("delegated = " + std::to_string(delegatedControl));
}

void toggleDelegated() {
  delegatedControl = !delegatedControl;
  onToggleDelegated();
}

void delegatedButtonEvent(byte x, bool press) {
  byte channel = x / 100;  // 0-based hundreds digit
  byte note = x % 100;
  if (press) {
    withMIDI([&](auto& M) { M.sendNoteOn(note, 127, channel + 1); });
  } else {
    withMIDI([&](auto& M) { M.sendNoteOff(note, 0, channel + 1); });
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
      break;
    case SYSEX_DELEGATED_EXIT:
      toggleDelegated();
      break;
    case SYSEX_LED:
      processLedSysEx(&data[1], len - 1);
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
  if ((len == 4) && (data[1] == 0x7D) && (data[2] == SYSEX_DELEGATED_ENTER)) {
    toggleDelegated();
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
#endif  // HEXBOARD_FIRMWARE_UNITY
