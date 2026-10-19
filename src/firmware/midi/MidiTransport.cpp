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
#include <tusb.h>
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
// On saturation the host has stopped draining. Discard the stale playback
// backlog, then silence every channel before accepting fresh USB notes.
uint8_t usbMidiRecoveryChannel = 0;
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

namespace {
// Arduino-Pico services TinyUSB in a background IRQ. Its MIDI wrapper does not
// take USB.mutex, so an IRQ can reenter TinyUSB's blocking endpoint mutex.
// Keep access on Core 0, try once, and let the next loop retry if USB owns it.
class UsbMidiAccess {
 public:
  UsbMidiAccess() : acquired_(mutex_try_enter(&USB.mutex, nullptr)) {}
  ~UsbMidiAccess() { if (acquired_) mutex_exit(&USB.mutex); }
  explicit operator bool() const { return acquired_; }
  UsbMidiAccess(const UsbMidiAccess&) = delete;
  UsbMidiAccess& operator=(const UsbMidiAccess&) = delete;
 private:
  bool acquired_;
};

bool writeUsbMidiTransportPacket(const uint8_t packet[4]) {
  UsbMidiAccess access;
  return access && MidiUSB.writePacket(packet);
}
}  // namespace

uint32_t pendingUsbMidiBytes() {
  UsbMidiAccess access;
  return access ? static_cast<uint32_t>(MidiUSB.available()) : 0;
}

int readUsbMidiByte() {
  UsbMidiAccess access;
  return access ? static_cast<int>(MidiUSB.read()) : -1;
}

size_t writeUsbMidiStream(const uint8_t* data, size_t length) {
  UsbMidiAccess access;
  if (!access) return 0;
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
    // The background task skips this IRQ while we hold USB.mutex. Service it
    // here under the same ownership when the transmit FIFO needs to drain.
    tud_task();
    delayMicroseconds(100);
  }

  return written;
}

void clearUsbMidiReliablePacketQueue() {
  usbMidiReliablePacketQueueHead = 0;
  usbMidiReliablePacketQueueCount = 0;
  usbMidiRecoveryChannel = 0;
}

bool enqueueUsbMidiReliablePacket(const uint8_t packet[4]) {
  if (usbMidiReliablePacketQueueCount >= USB_MIDI_RELIABLE_PACKET_QUEUE_CAPACITY) {
    usbMidiReliablePacketQueueHead = 0;
    usbMidiReliablePacketQueueCount = 0;
    usbMidiRecoveryChannel = 1;
    // The lifecycle packet is accounted for locally; recovery silences notes
    // already delivered to the host, rather than wedging the key state.
    return true;
  }

  size_t index = (usbMidiReliablePacketQueueHead + usbMidiReliablePacketQueueCount)
      % USB_MIDI_RELIABLE_PACKET_QUEUE_CAPACITY;
  std::memcpy(usbMidiReliablePacketQueue[index].bytes, packet, sizeof(usbMidiReliablePacketQueue[index].bytes));
  ++usbMidiReliablePacketQueueCount;
  return true;
}

void serviceUsbMidiOutput() {
  if (!MidiUSB.connected()) {
    if (usbMidiReliablePacketQueueCount != 0 || usbMidiRecoveryChannel != 0) {
      clearUsbMidiReliablePacketQueue();
    }
    return;
  }

  while (usbMidiRecoveryChannel != 0) {
    const uint8_t channel = usbMidiRecoveryChannel;
    const uint8_t allNotesOff[4] = {
      0x0B, static_cast<uint8_t>(0xB0 | (channel - 1)), 123, 0
    };
    if (!writeUsbMidiTransportPacket(allNotesOff)) {
      return;
    }
    usbMidiRecoveryChannel = channel == MIDI_CHANNEL_MAX ? 0 : channel + 1;
  }

  uint8_t serviced = 0;
  while (usbMidiReliablePacketQueueCount != 0
         && serviced < USB_MIDI_RELIABLE_PACKET_SERVICE_LIMIT) {
    UsbMidiPacket& packet = usbMidiReliablePacketQueue[usbMidiReliablePacketQueueHead];
    // Probe once without waiting for the USB endpoint or its mutex.
    // This lets a pending note-off leave as soon as the host polls again while
    // a closed host still costs only one constant-time probe per service call.
    if (!writeUsbMidiTransportPacket(packet.bytes)) {
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
  if (usbMidiRecoveryChannel != 0) {
    return reliable;  // Drop stale playback while the host cannot drain.
  }
  if (usbMidiReliablePacketQueueCount != 0) {
    return reliable ? enqueueUsbMidiReliablePacket(packet) : false;
  }

  // Live output never waits for endpoint space. Reliable packets retry from
  // the bounded queue; best-effort controls may be dropped under congestion.
  if (writeUsbMidiTransportPacket(packet)) {
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
  bool usbAccepted = !(midiD & MIDID_USB) || !MidiUSB.connected()
      || UMIDI.sendNoteOff(note, velocity, channel);
  if (midiD & MIDID_SER) {
    SMIDI.sendNoteOff(note, velocity, channel);
  }
  return usbAccepted;
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
