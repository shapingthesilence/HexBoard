#pragma once

#include "../FirmwareModule.h"
#include "../app/PlatformCommon.h"
#include <MIDIUSB.h>

constexpr float CONCERT_A_HZ = 440.0f;
constexpr float CONCERT_A_MIDI_NOTE = 69.0f;
constexpr byte DEFAULT_PITCH_BEND_RANGE_SEMITONES = 2;

constexpr byte MIDID_NONE = 0;
constexpr byte MIDID_USB = 1;
constexpr byte MIDID_SER = 2;
constexpr byte MIDID_BOTH = 3;
constexpr uint16_t MIDI_INPUT_DRAIN_BYTE_LIMIT = 512;
constexpr size_t MIDI_SYSEX_BUFFER_MAX = 4096;

extern byte MPEpitchBendSemis;
extern byte midiD;
extern byte programChange;
constexpr uint64_t PRESET_SYNC_TRANSFER_IDLE_MICROS = 250000ULL;
constexpr uint64_t PRESET_SYNC_TRANSFER_TIMEOUT_MICROS = 3000000ULL;

extern bool presetSyncTransferActive;
extern bool presetSyncTransferScreenVisible;
extern bool presetSyncTransferScreenWokeDisplayFromSleep;
extern uint64_t presetSyncTransferSavedScreenTime;
extern uint64_t presetSyncTransferLastActivity;
extern uint64_t presetSyncTransferDeadline;
extern uint32_t presetSyncTransferFrameCount;
extern uint8_t presetSyncTransferLastMessage;

struct MidiInputParser {
  bool inSysEx = false;
  uint8_t runningStatus = 0;
  uint8_t status = 0;
  uint8_t data[2] = { 0, 0 };
  uint8_t dataCount = 0;
  uint8_t dataNeeded = 0;
  std::vector<uint8_t> sysex;
};

enum class MidiOutputTransport : uint8_t {
  Usb,
  Serial
};

size_t writeUsbMidiStream(const uint8_t* data, size_t length);
bool writeUsbMidiPacket(const uint8_t packet[4]);

class HexBoardMidiOut {
public:
  explicit HexBoardMidiOut(MidiOutputTransport transport) : transport_(transport) {}

  void sendNoteOn(byte note, byte velocity, byte channel) {
    sendChannel3(0x90, 0x09, note, velocity, channel);
  }

  void sendNoteOff(byte note, byte velocity, byte channel) {
    sendChannel3(0x80, 0x08, note, velocity, channel);
  }

  void sendControlChange(byte control, byte value, byte channel) {
    sendChannel3(0xB0, 0x0B, control, value, channel);
  }

  void sendProgramChange(byte program, byte channel) {
    sendChannel2(0xC0, 0x0C, program, channel);
  }

  void sendAfterTouch(byte pressure, byte channel) {
    sendChannel2(0xD0, 0x0D, pressure, channel);
  }

  void sendPitchBend(int value, byte channel) {
    if (!isValidMidiChannel(channel)) {
      return;
    }
    int bend = std::clamp(value, -8192, 8191) + 8192;
    sendChannel3(0xE0, 0x0E, bend & 0x7F, (bend >> 7) & 0x7F, channel);
  }

  void beginRpn(uint16_t parameter, byte channel) {
    sendControlChange(100, parameter & 0x7F, channel);
    sendControlChange(101, (parameter >> 7) & 0x7F, channel);
  }

  void sendRpnValue(uint16_t value, byte channel) {
    sendControlChange(6, (value >> 7) & 0x7F, channel);
    sendControlChange(38, value & 0x7F, channel);
  }

  void endRpn(byte channel) {
    sendControlChange(100, 0x7F, channel);
    sendControlChange(101, 0x7F, channel);
  }

  void sendSysEx(unsigned length, const byte* data) {
    uint8_t start = 0xF0;
    uint8_t end = 0xF7;
    if (transport_ == MidiOutputTransport::Usb) {
      writeUsbMidiStream(&start, 1);
      writeUsbMidiStream(data, length);
      writeUsbMidiStream(&end, 1);
    } else {
      Serial1.write(start);
      Serial1.write(data, length);
      Serial1.write(end);
    }
  }

  void sendRealTime(uint8_t status) {
    if (status < 0xF8) {
      return;
    }
    if (transport_ == MidiOutputTransport::Usb) {
      uint8_t packet[4] = { 0x0F, status, 0, 0 };
      writeUsbMidiPacket(packet);
    } else {
      Serial1.write(status);
    }
  }

private:
  MidiOutputTransport transport_;

  void sendChannel2(uint8_t statusBase, uint8_t cin, uint8_t data1, byte channel) {
    if (!isValidMidiChannel(channel)) {
      return;
    }
    uint8_t status = statusBase | ((channel - 1) & 0x0F);
    if (transport_ == MidiOutputTransport::Usb) {
      uint8_t packet[4] = { cin, status, static_cast<uint8_t>(data1 & 0x7F), 0 };
      writeUsbMidiPacket(packet);
    } else {
      Serial1.write(status);
      Serial1.write(data1 & 0x7F);
    }
  }

  void sendChannel3(uint8_t statusBase, uint8_t cin, uint8_t data1, uint8_t data2, byte channel) {
    if (!isValidMidiChannel(channel)) {
      return;
    }
    uint8_t status = statusBase | ((channel - 1) & 0x0F);
    data1 &= 0x7F;
    data2 &= 0x7F;
    if (transport_ == MidiOutputTransport::Usb) {
      uint8_t packet[4] = { cin, status, data1, data2 };
      writeUsbMidiPacket(packet);
    } else {
      Serial1.write(status);
      Serial1.write(data1);
      Serial1.write(data2);
    }
  }
};

extern MidiInputParser usbMidiInput;
extern MidiInputParser serialMidiInput;
extern HexBoardMidiOut UMIDI;
extern HexBoardMidiOut SMIDI;

template <class F>
inline void withMIDI(F&& f) {
  if (midiD & MIDID_USB) f(UMIDI);
  if (midiD & MIDID_SER) f(SMIDI);
}

void setupUSBDescriptors();
void setupMIDI();
void resetMidiInputParser(MidiInputParser& parser);
void dispatchIncomingSysEx(MidiInputParser& parser, bool delegatedMode);
bool processIncomingMidiByte(MidiInputParser& parser, uint8_t value, bool delegatedMode);
