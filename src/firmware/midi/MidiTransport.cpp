#include "../FirmwareModule.h"
#include "MidiTransport.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"

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
/*
    Pitch bend messages are calibrated
    to a pitch bend range where
    -8192 to 8191 = -200 to +200 cents,
    or two semitones.
  */
/*
    We use pitch bends to retune notes in MPE mode.
    Some setups can adjust to fit this, but some need us to adjust it.
  */
byte MPEpitchBendSemis = 48;
/*
    MIDIUSB registers a Pico SDK/TinyUSB USB MIDI interface. Serial MIDI is
    handled directly so large SysEx frames do not depend on a third-party parser.
  */
byte midiD = MIDID_USB | MIDID_SER;
constexpr uint32_t SERIAL_MIDI_BAUD = 31250;
constexpr uint64_t USB_MIDI_WRITE_TIMEOUT_MICROS = 50000ULL;
constexpr uint64_t USB_MIDI_PACKET_WRITE_TIMEOUT_MICROS = 2000ULL;
constexpr uint64_t USB_MIDI_PACKET_STALL_BACKOFF_MICROS = 100000ULL;
bool presetSyncTransferActive = false;
bool presetSyncTransferScreenVisible = false;
bool presetSyncTransferScreenWokeDisplayFromSleep = false;
uint64_t presetSyncTransferSavedScreenTime = 0;
uint64_t presetSyncTransferLastActivity = 0;
uint64_t presetSyncTransferDeadline = 0;
uint32_t presetSyncTransferFrameCount = 0;
uint8_t presetSyncTransferLastMessage = 0;
uint64_t usbMidiPacketBackoffUntil = 0;

MidiInputParser usbMidiInput;
MidiInputParser serialMidiInput;

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
