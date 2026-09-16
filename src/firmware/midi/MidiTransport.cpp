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
constexpr size_t USB_MIDI_RELIABLE_PACKET_QUEUE_CAPACITY = 128;
constexpr uint8_t USB_MIDI_RELIABLE_PACKET_SERVICE_LIMIT = 16;

struct UsbMidiPacket {
  uint8_t bytes[4] = { 0, 0, 0, 0 };
};

// MIDI output is produced and serviced by Core 0. Keeping lifecycle packets
// here lets ordinary USB output fail fast when the host stops polling without
// allowing an MPE note-off or per-note bend to disappear with it.
std::array<UsbMidiPacket, USB_MIDI_RELIABLE_PACKET_QUEUE_CAPACITY> usbMidiReliablePacketQueue = {};
uint8_t usbMidiReliablePacketQueueHead = 0;
uint8_t usbMidiReliablePacketQueueCount = 0;
uint64_t usbMidiPacketBackoffUntil = 0;
bool presetSyncTransferActive = false;
bool presetSyncTransferScreenVisible = false;
bool presetSyncTransferScreenWokeDisplayFromSleep = false;
uint64_t presetSyncTransferSavedScreenTime = 0;
uint64_t presetSyncTransferLastActivity = 0;
uint64_t presetSyncTransferDeadline = 0;
uint32_t presetSyncTransferFrameCount = 0;
uint8_t presetSyncTransferLastMessage = 0;
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

void clearUsbMidiReliablePacketQueue() {
  usbMidiReliablePacketQueueHead = 0;
  usbMidiReliablePacketQueueCount = 0;
  usbMidiPacketBackoffUntil = 0;
}

bool tryWriteUsbMidiPacket(const uint8_t packet[4]) {
  if (!MidiUSB.connected()) {
    clearUsbMidiReliablePacketQueue();
    return false;
  }

  uint64_t now = readClock();
  if (now < usbMidiPacketBackoffUntil) {
    return false;
  }

  // A closed host can leave the TinyUSB TX FIFO full. The short retry keeps
  // this path responsive, and the backoff prevents every subsequent control
  // update from paying that cost until the host resumes polling.
  uint64_t deadline = now + USB_MIDI_PACKET_WRITE_TIMEOUT_MICROS;
  while (MidiUSB.connected()) {
    if (MidiUSB.writePacket(packet)) {
      usbMidiPacketBackoffUntil = 0;
      return true;
    }
    if (readClock() >= deadline) {
      break;
    }
    delayMicroseconds(100);
  }

  usbMidiPacketBackoffUntil = readClock() + USB_MIDI_PACKET_STALL_BACKOFF_MICROS;
  return false;
}

bool enqueueUsbMidiReliablePacket(const uint8_t packet[4]) {
  if (usbMidiReliablePacketQueueCount >= USB_MIDI_RELIABLE_PACKET_QUEUE_CAPACITY) {
    return false;
  }

  size_t index = (usbMidiReliablePacketQueueHead + usbMidiReliablePacketQueueCount)
      % USB_MIDI_RELIABLE_PACKET_QUEUE_CAPACITY;
  std::memcpy(usbMidiReliablePacketQueue[index].bytes, packet, sizeof(usbMidiReliablePacketQueue[index].bytes));
  ++usbMidiReliablePacketQueueCount;
  return true;
}

void serviceUsbMidiOutput() {
  if (!MidiUSB.connected()) {
    if (usbMidiReliablePacketQueueCount != 0 || usbMidiPacketBackoffUntil != 0) {
      clearUsbMidiReliablePacketQueue();
    }
    return;
  }

  uint8_t serviced = 0;
  while (usbMidiReliablePacketQueueCount != 0
         && serviced < USB_MIDI_RELIABLE_PACKET_SERVICE_LIMIT) {
    UsbMidiPacket& packet = usbMidiReliablePacketQueue[usbMidiReliablePacketQueueHead];
    // Probe once without waiting or lifting the ordinary 100 ms backoff.
    // This lets a pending note-off leave as soon as the host polls again while
    // a closed host still costs only one constant-time FIFO check per loop.
    if (!MidiUSB.writePacket(packet.bytes)) {
      return;
    }
    usbMidiReliablePacketQueueHead = static_cast<uint8_t>(
        (usbMidiReliablePacketQueueHead + 1) % USB_MIDI_RELIABLE_PACKET_QUEUE_CAPACITY);
    --usbMidiReliablePacketQueueCount;
    ++serviced;
  }
}

bool writeUsbMidiPacket(const uint8_t packet[4], bool reliable) {
  if (!MidiUSB.connected()) {
    clearUsbMidiReliablePacketQueue();
    return false;
  }

  // Preserve packet order: a best-effort packet must not overtake a queued
  // MPE lifecycle packet on the same USB endpoint.
  serviceUsbMidiOutput();
  if (usbMidiReliablePacketQueueCount != 0) {
    return reliable ? enqueueUsbMidiReliablePacket(packet) : false;
  }

  if (tryWriteUsbMidiPacket(packet)) {
    return true;
  }
  if (!MidiUSB.connected()) {
    clearUsbMidiReliablePacketQueue();
    return false;
  }
  return reliable ? enqueueUsbMidiReliablePacket(packet) : false;
}

HexBoardMidiOut UMIDI(MidiOutputTransport::Usb);
HexBoardMidiOut SMIDI(MidiOutputTransport::Serial);

bool sendNoteOffToConfiguredMidiOutputs(byte note, byte velocity, byte channel) {
  if ((midiD & MIDID_USB) && !UMIDI.sendNoteOff(note, velocity, channel)) {
    return false;
  }
  if (midiD & MIDID_SER) {
    SMIDI.sendNoteOff(note, velocity, channel);
  }
  return true;
}

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
  resetMidiInputParser(usbMidiInput);
  resetMidiInputParser(serialMidiInput);
  sendToLog("setupMIDI okay");
}
