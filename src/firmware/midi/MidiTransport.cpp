#if HEXBOARD_FIRMWARE_UNITY

#include "../FirmwareModule.h"

// @MIDI
/*
    This section of the code handles all
    things related to MIDI messages.
  */
#include <USB.h>         // Arduino-Pico USB descriptor controls
#include <MIDIUSB.h>     // Arduino-Pico Pico SDK USB MIDI wrapper
/*
    These values support correct MIDI output.
    Note frequencies are converted to MIDI note
    and pitch bend messages assuming note 69
    equals concert A4, as defined below.
  */
constexpr float CONCERT_A_HZ = 440.0f;
constexpr float CONCERT_A_MIDI_NOTE = 69.0f;
/*
    Pitch bend messages are calibrated
    to a pitch bend range where
    -8192 to 8191 = -200 to +200 cents,
    or two semitones.
  */
constexpr byte DEFAULT_PITCH_BEND_RANGE_SEMITONES = 2;
/*
    We use pitch bends to retune notes in MPE mode.
    Some setups can adjust to fit this, but some need us to adjust it.
  */
byte MPEpitchBendSemis = 48;
/*
    MIDIUSB registers a Pico SDK/TinyUSB USB MIDI interface. Serial MIDI is
    handled directly so large SysEx frames do not depend on a third-party parser.
  */
// midiD takes the following bitwise flags
constexpr byte MIDID_NONE = 0;
constexpr byte MIDID_USB = 1;
constexpr byte MIDID_SER = 2;
constexpr byte MIDID_BOTH = 3;
byte midiD = MIDID_USB | MIDID_SER;
constexpr uint16_t MIDI_INPUT_DRAIN_BYTE_LIMIT = 512;
constexpr uint32_t SERIAL_MIDI_BAUD = 31250;
constexpr uint64_t USB_MIDI_WRITE_TIMEOUT_MICROS = 50000ULL;
constexpr uint64_t USB_MIDI_PACKET_WRITE_TIMEOUT_MICROS = 2000ULL;
constexpr uint64_t USB_MIDI_PACKET_STALL_BACKOFF_MICROS = 100000ULL;
constexpr size_t MIDI_SYSEX_BUFFER_MAX = 4096;
constexpr uint64_t PRESET_SYNC_TRANSFER_IDLE_MICROS = 250000ULL;
constexpr uint64_t PRESET_SYNC_TRANSFER_TIMEOUT_MICROS = 3000000ULL;
bool presetSyncTransferActive = false;
bool presetSyncTransferScreenVisible = false;
bool presetSyncTransferScreenWokeDisplayFromSleep = false;
uint64_t presetSyncTransferSavedScreenTime = 0;
uint64_t presetSyncTransferLastActivity = 0;
uint64_t presetSyncTransferDeadline = 0;
uint32_t presetSyncTransferFrameCount = 0;
uint8_t presetSyncTransferLastMessage = 0;
uint64_t usbMidiPacketBackoffUntil = 0;

struct MidiInputParser {
  bool inSysEx = false;
  uint8_t runningStatus = 0;
  uint8_t status = 0;
  uint8_t data[2] = { 0, 0 };
  uint8_t dataCount = 0;
  uint8_t dataNeeded = 0;
  std::vector<uint8_t> sysex;
};

MidiInputParser usbMidiInput;
MidiInputParser serialMidiInput;

void resetMidiInputParser(MidiInputParser& parser);
void dispatchIncomingSysEx(MidiInputParser& parser, bool delegatedMode);
bool processIncomingMidiByte(MidiInputParser& parser, uint8_t value, bool delegatedMode);

size_t writeUsbMidiStream(const uint8_t* data, size_t length) {
  if (length == 0 || !MidiUSB.connected()) {
    return 0;
  }

  size_t written = 0;
  uint64_t deadline = readClock() + USB_MIDI_WRITE_TIMEOUT_MICROS;
  while (written < length) {
    if (!MidiUSB.connected()) {
      break;
    }

    if (MidiUSB.write(data[written]) == 1) {
      ++written;
      deadline = readClock() + USB_MIDI_WRITE_TIMEOUT_MICROS;
      continue;
    }

    if (readClock() >= deadline) {
      break;
    }
    delayMicroseconds(100);
  }

  return written;
}

bool writeUsbMidiPacket(const uint8_t packet[4]) {
  if (!MidiUSB.connected()) {
    usbMidiPacketBackoffUntil = 0;
    return false;
  }

  uint64_t now = readClock();
  if (now < usbMidiPacketBackoffUntil) {
    return false;
  }

  uint64_t deadline = now + USB_MIDI_PACKET_WRITE_TIMEOUT_MICROS;
  while (MidiUSB.connected()) {
    if (MidiUSB.writePacket(packet)) {
      usbMidiPacketBackoffUntil = 0;
      return true;
    }
    now = readClock();
    if (now >= deadline) {
      break;
    }
    delayMicroseconds(100);
  }
  usbMidiPacketBackoffUntil = readClock() + USB_MIDI_PACKET_STALL_BACKOFF_MICROS;
  return false;
}

enum class MidiOutputTransport : uint8_t {
  Usb,
  Serial
};

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

HexBoardMidiOut UMIDI(MidiOutputTransport::Usb);
HexBoardMidiOut SMIDI(MidiOutputTransport::Serial);

// What program change number we last sent (General MIDI/Roland MT-32)
byte programChange = 0;

void resetMidiInputParser(MidiInputParser& parser) {
  parser.inSysEx = false;
  parser.runningStatus = 0;
  parser.status = 0;
  parser.dataCount = 0;
  parser.dataNeeded = 0;
  parser.sysex.clear();
}

void setupUSBDescriptors() {
  USB.setManufacturer("Shaping The Silence");
  USB.setProduct("HexBoard");
}

void setupMIDI() {
  MidiUSB.setName("HexBoard MIDI");
  MidiUSB.begin();
  Serial1.begin(SERIAL_MIDI_BAUD);
  usbMidiInput.sysex.reserve(512);
  serialMidiInput.sysex.reserve(512);
  resetMidiInputParser(usbMidiInput);
  resetMidiInputParser(serialMidiInput);
  sendToLog("setupMIDI okay");
}
#endif  // HEXBOARD_FIRMWARE_UNITY
