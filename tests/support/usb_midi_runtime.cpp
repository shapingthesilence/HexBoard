#include "midi/MidiTransport.h"

#include <iostream>

void resetTransport() {
  MidiUSB = {};
  USB.mutex = false;
  // Exercise the public disconnect path rather than the private queue state.
  MidiUSB.online = false;
  serviceUsbMidiOutput();
  MidiUSB.online = true;
  clockReads = waits = 0;
}

int main() {
  const uint8_t bend[4] = {0x0E, 0xE1, 0, 64};
  const uint8_t note[4] = {0x09, 0x91, 60, 100};
  const uint8_t off[4] = {0x08, 0x81, 60, 0};
  const uint8_t control[4] = {0x0B, 0xB1, 1, 64};

  resetTransport();
  assert(!writeUsbMidiPacket(control));
  assert(MidiUSB.attempts == 1 && clockReads == 0 && waits == 0);
  MidiUSB.slots = 1;
  assert(writeUsbMidiPacket(control)); // No stale backoff after congestion.

  resetTransport();
  assert(writeUsbMidiPacket(bend, true));
  assert(writeUsbMidiPacket(note, true));
  assert(writeUsbMidiPacket(off, true));
  assert(!writeUsbMidiPacket(control)); // Controls cannot overtake queued notes.
  assert(MidiUSB.sent.empty() && clockReads == 0 && waits == 0);
  MidiUSB.slots = 3;
  serviceUsbMidiOutput();
  assert(MidiUSB.sent.size() == 3);
  assert(std::memcmp(MidiUSB.sent[0].data(), bend, 4) == 0);
  assert(std::memcmp(MidiUSB.sent[1].data(), note, 4) == 0);
  assert(std::memcmp(MidiUSB.sent[2].data(), off, 4) == 0);

  resetTransport();
  USB.mutex = true;
  MidiUSB.slots = 64;
  for (int i = 0; i < 40; ++i) assert(writeUsbMidiPacket(note, true));
  assert(MidiUSB.attempts == 0 && USB.mutex && clockReads == 0 && waits == 0);
  USB.mutex = false;
  serviceUsbMidiOutput();
  assert(MidiUSB.sent.size() == 16);
  serviceUsbMidiOutput();
  assert(MidiUSB.sent.size() == 32);
  serviceUsbMidiOutput();
  assert(MidiUSB.sent.size() == 40);

  resetTransport();
  for (int i = 0; i < 129; ++i) assert(writeUsbMidiPacket(note, true));
  MidiUSB.slots = 5;
  serviceUsbMidiOutput();
  assert(MidiUSB.sent.size() == 5);
  // While recovering, accept/drop stale lifecycle packets without replaying them.
  assert(writeUsbMidiPacket(off, true));
  MidiUSB.slots = 64;
  serviceUsbMidiOutput();
  assert(MidiUSB.sent.size() == 16);
  for (size_t i = 0; i < 16; ++i) {
    const std::array<uint8_t, 4> expected = {0x0B, static_cast<uint8_t>(0xB0 + i), 123, 0};
    assert(MidiUSB.sent[i] == expected);
  }
  assert(writeUsbMidiPacket(note, true));
  assert(MidiUSB.sent.size() == 17);

  resetTransport();
  assert(writeUsbMidiPacket(note, true));
  MidiUSB.online = false;
  assert(!writeUsbMidiPacket(off, true));
  MidiUSB.online = true;
  MidiUSB.slots = 64;
  serviceUsbMidiOutput();
  assert(MidiUSB.sent.empty());
  assert(writeUsbMidiPacket(note, true));
  assert(MidiUSB.sent.size() == 1);
  assert(clockReads == 0 && waits == 0);
  std::cout << "USB MIDI congestion, ordering, mutex, service limit, overflow, and reconnect passed\n";
}
