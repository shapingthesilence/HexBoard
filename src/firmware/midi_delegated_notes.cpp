#include "FirmwareModule.h"

#if HEXBOARD_FIRMWARE_UNITY

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

uint16_t mpeChannelBitmap = 0;  // bitmap of available MPE channels (bit N = channel N+1)
byte MPEpitchBendsNeeded;
bool mpeChannelQueueActive = false;

uint8_t mpePlayableChannelCount() {
  if (mpeHighestChannel < mpeLowestChannel) {
    return 0;
  }
  return static_cast<uint8_t>(mpeHighestChannel - mpeLowestChannel + 1);
}

void resetMPEChannelPool() {
  mpeChannelBitmap = 0;
  for (byte ch = mpeLowestChannel; ch <= mpeHighestChannel; ++ch) {
    mpeChannelBitmap |= (1u << (ch - 1));
    sendToLog("added ch " + std::to_string(ch) + " to the MPE pool");
  }
}

byte RAM_FUNC(takeMPEChannel)() {
  if (mpeChannelBitmap == 0) {
    return 0;
  }
  // Always take lowest available channel (equivalent to sorted front() for low-priority,
  // and a reasonable FIFO-like behavior otherwise)
  byte ch = static_cast<byte>(__builtin_ctz(mpeChannelBitmap) + 1);
  mpeChannelBitmap &= ~(1u << (ch - 1));
  return ch;
}

void RAM_FUNC(releaseMPEChannel)(byte ch) {
  if (ch < mpeLowestChannel || ch > mpeHighestChannel) {
    return;
  }
  mpeChannelBitmap |= (1u << (ch - 1));
  sendToLog("returned ch " + std::to_string(ch) + " to the MPE pool");
}

float freqToMIDI(float Hz) {  // formula to convert from Hz to MIDI note
  return CONCERT_A_MIDI_NOTE + 12.0f * log2f(Hz / CONCERT_A_HZ);
}
float MIDItoFreq(float midi) {  // formula to convert from MIDI note to Hz
  return CONCERT_A_HZ * exp2((midi - CONCERT_A_MIDI_NOTE) / 12.0f);
}
float stepsToMIDI(int16_t stepsFromA) {  // return the MIDI pitch associated
  return CONCERT_A_MIDI_NOTE + (static_cast<float>(stepsFromA) * static_cast<float>(current.tuning().stepSize) / 100.0f);
}

// Do the same thing on each defined MIDI interface. This reduces code
// duplication. Search for withMIDI to see how it's used.
template <class F>
inline void withMIDI(F&& f) {
  if (midiD & MIDID_USB) f(UMIDI);
  if (midiD & MIDID_SER) f(SMIDI);
}

// --- Note display overlay when pressing keys ---
constexpr byte DISPLAYED_NOTES_MAX = 6;
constexpr int16_t DISPLAYED_NOTE_UNUSED = INT16_MIN;
constexpr uint64_t DISPLAYED_NOTES_HOLD_MICROS = 2000000ULL;
constexpr uint64_t DISPLAYED_NOTES_RELEASE_GRACE_MICROS = 80000ULL;
constexpr int PLAYED_NOTE_COLUMN_X[3] = { 0, 44, 88 };
constexpr int PLAYED_CHORD_Y = 92;
constexpr int PLAYED_NOTE_BADGE_WIDTH = 42;
constexpr int PLAYED_NOTE_BADGE_HEIGHT = 20;
constexpr int PLAYED_NOTE_BADGE_MARGIN = 2;
constexpr int PLAYED_NOTE_BADGE_BASELINE = 0;
constexpr byte CHORD_NAME_MAX = 18;
bool displayPlayedNotes = false;
bool noteOverlayVisible = false;
bool noteBadgeVisible = false;
bool noteOverlayDirty = true;
bool noteOverlayTemporaryWake = false;
bool noteOverlayWokeDisplayFromSleep = false;
uint64_t noteOverlayHoldUntil = 0;
uint64_t noteOverlayReleaseGraceUntil = 0;
int16_t displayedNotes[DISPLAYED_NOTES_MAX] = {
  DISPLAYED_NOTE_UNUSED, DISPLAYED_NOTE_UNUSED, DISPLAYED_NOTE_UNUSED,
  DISPLAYED_NOTE_UNUSED, DISPLAYED_NOTE_UNUSED, DISPLAYED_NOTE_UNUSED
};
char noteBadgeText[12] = "";

const char* const chromaticNames[12] = {
  "C", "C#", "D", "Eb", "E", "F",
  "F#", "G", "G#", "A", "Bb", "B"
};

struct ChordPattern {
  uint16_t intervals;
  const char* suffix;
};

constexpr uint16_t chordIntervalBit(byte interval) {
  return static_cast<uint16_t>(1U << interval);
}

const ChordPattern chordPatterns[] = {
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(9) | chordIntervalBit(11), "maj13" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(9) | chordIntervalBit(10), "13" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(3) | chordIntervalBit(7) | chordIntervalBit(9) | chordIntervalBit(10), "m13" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(4) | chordIntervalBit(5) | chordIntervalBit(7) | chordIntervalBit(10), "11" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(3) | chordIntervalBit(5) | chordIntervalBit(7) | chordIntervalBit(10), "m11" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(11), "maj9" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(10), "9" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(3) | chordIntervalBit(7) | chordIntervalBit(10), "m9" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(3) | chordIntervalBit(7) | chordIntervalBit(11), "mMaj9" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(9), "6/9" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(3) | chordIntervalBit(7) | chordIntervalBit(9), "m6/9" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(4) | chordIntervalBit(7), "add9" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(3) | chordIntervalBit(7), "madd9" },
  { chordIntervalBit(0) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(11), "maj7" },
  { chordIntervalBit(0) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(10), "7" },
  { chordIntervalBit(0) | chordIntervalBit(3) | chordIntervalBit(7) | chordIntervalBit(10), "m7" },
  { chordIntervalBit(0) | chordIntervalBit(3) | chordIntervalBit(7) | chordIntervalBit(11), "mMaj7" },
  { chordIntervalBit(0) | chordIntervalBit(3) | chordIntervalBit(6) | chordIntervalBit(10), "m7b5" },
  { chordIntervalBit(0) | chordIntervalBit(3) | chordIntervalBit(6) | chordIntervalBit(9), "dim7" },
  { chordIntervalBit(0) | chordIntervalBit(4) | chordIntervalBit(8) | chordIntervalBit(10), "aug7" },
  { chordIntervalBit(0) | chordIntervalBit(4) | chordIntervalBit(8) | chordIntervalBit(11), "augMaj7" },
  { chordIntervalBit(0) | chordIntervalBit(5) | chordIntervalBit(7) | chordIntervalBit(10), "7sus4" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(7) | chordIntervalBit(10), "7sus2" },
  { chordIntervalBit(0) | chordIntervalBit(4) | chordIntervalBit(7) | chordIntervalBit(9), "6" },
  { chordIntervalBit(0) | chordIntervalBit(3) | chordIntervalBit(7) | chordIntervalBit(9), "m6" },
  { chordIntervalBit(0) | chordIntervalBit(4) | chordIntervalBit(7), "" },
  { chordIntervalBit(0) | chordIntervalBit(3) | chordIntervalBit(7), "m" },
  { chordIntervalBit(0) | chordIntervalBit(3) | chordIntervalBit(6), "dim" },
  { chordIntervalBit(0) | chordIntervalBit(4) | chordIntervalBit(8), "aug" },
  { chordIntervalBit(0) | chordIntervalBit(2) | chordIntervalBit(7), "sus2" },
  { chordIntervalBit(0) | chordIntervalBit(5) | chordIntervalBit(7), "sus4" }
};
const byte CHORD_PATTERN_COUNT = sizeof(chordPatterns) / sizeof(chordPatterns[0]);

void clearDisplayedNotes(int16_t* notes);
void copyDisplayedNotes(int16_t* destination, const int16_t* source);
byte rebuildDisplayedNotes(int16_t* notes);
byte displayedNoteCount(const int16_t* notes);
bool displayedNotesEqual(const int16_t* first, const int16_t* second);
bool buildDisplayedChordName(const int16_t* notes, byte count, char* chordText, size_t chordTextSize);
bool newestHeldDisplayedPitch(int16_t& displayedPitchOut);
void formatDisplayedPitch(int16_t displayedPitch, char* noteText, size_t noteTextSize);
void drawCompactPlayedNoteBadge();
void drawPlayedNotesOverlay();
void onToggleDisplayPlayedNotes();
bool setNoteOverlayTemporaryWake(bool enabled);
extern bool screenSaverOn;

void setPitchBendRange(byte Ch, byte semitones) {
  withMIDI([&](auto& M) {
    M.beginRpn(0, Ch);
    M.sendRpnValue(semitones << 7, Ch);
    M.endRpn(Ch);
  });
  sendToLog(
    "set pitch bend range on ch " + std::to_string(Ch) + " to be " + std::to_string(semitones) + " semitones");
}

void setMPEzone(byte masterCh, byte sizeOfZone) {
  withMIDI([&](auto& M) {
    M.beginRpn(6, masterCh);
    M.sendRpnValue(sizeOfZone << 7, masterCh);
    M.endRpn(masterCh);
  });
  sendToLog(
    "tried sending MIDI msg to set MPE zone, master ch " + std::to_string(masterCh) + ", zone of this size: " + std::to_string(sizeOfZone));
}

void resetTuningMIDI() {
  /*
      One of the ways that microtonal MIDI works
      is via MPE (MIDI polyphonic expression).
      This assigns re-tuned notes to an independent channel
      so they can be pitched separately.

      We can now use microtonal tunings without MPE
      by sending standard MIDI note numbers across
      multiple channels to be retuned by other software
      or hardware.

      If operating in a standard 12-EDO tuning, with MPE
      disabled, or in a tuning with steps that are exact
      multiples of 100 cents, then MPE is not necessary.
    */
  standardMidiMicrotonalActive = false;
  bool tuningIsStandardSemitone = (current.tuning().stepSize == 100.0);
  bool forceMPE = (mpeUserMode == MPE_MODE_FORCE);
  bool disableMPE = (mpeUserMode == MPE_MODE_DISABLE);
  bool mpeOptional = !forceMPE && !useDynamicJustIntonation && !useJustIntonationBPM;

  if (forceMPE) {
    MPEpitchBendsNeeded = 255;
  } else if (disableMPE) {
    standardMidiMicrotonalActive = !tuningIsStandardSemitone;
    MPEpitchBendsNeeded = 1;
  } else if (mpeOptional && tuningIsStandardSemitone) {
    MPEpitchBendsNeeded = 1;  // Standard 12EDO, single-channel mode
  } else {
    MPEpitchBendsNeeded = 255;  // Enables MPE mode when microtonal needs per-note pitch bends
  }
  clampMPEChannelRange();

  uint8_t playableChannels = mpePlayableChannelCount();
  if (playableChannels == 0) {
    mpeLowestChannel = MPE_CHANNEL_MIN;
    mpeHighestChannel = MPE_CHANNEL_MIN;
    playableChannels = mpePlayableChannelCount();
  }

  bool mpeEnabled = (MPEpitchBendsNeeded > 1);

  if (mpeEnabled) {
    byte zoneSize = 0;
    if (mpeHighestChannel > 1) {
      zoneSize = static_cast<byte>(mpeHighestChannel - 1);
    }
    setMPEzone(1, zoneSize);  // Advertise the highest channel we plan to use.
  } else {
    setMPEzone(1, 0);
  }

  mpeChannelQueueActive = false;
  mpeChannelBitmap = 0;

  if (mpeEnabled) {
    bool needsQueue = (MPEpitchBendsNeeded > playableChannels) || mpeLowPriorityMode;
    mpeChannelQueueActive = needsQueue;
    if (needsQueue) {
      resetMPEChannelPool();
    }
  }
  // Reset controllers and ensure every channel uses the appropriate pitch-bend range.
  for (byte i = MIDI_CHANNEL_MIN; i <= MIDI_CHANNEL_MAX; ++i) {
    withMIDI([&](auto& M) { M.sendControlChange(123, 0, i); });
    byte range = DEFAULT_PITCH_BEND_RANGE_SEMITONES;
    if (mpeEnabled && i >= mpeLowestChannel && i <= mpeHighestChannel) {
      range = MPEpitchBendSemis;
    }
    setPitchBendRange(i, range);
  }
}

byte primaryMIDIChannel() {
  if (MPEpitchBendsNeeded == 1 && isValidMidiChannel(defaultMidiChannel)) {
    return defaultMidiChannel;
  }
  return MIDI_CHANNEL_MIN;  // In MPE mode, channel 1 is the master channel.
}

void RAM_FUNC(sendMIDImodulationToCh1)() {
  byte targetChannel = primaryMIDIChannel();
  withMIDI([&](auto& M) { M.sendControlChange(1, modWheel.curValue, targetChannel); });
  sendToLog("sent mod value " + std::to_string(modWheel.curValue) + " to ch " + std::to_string(targetChannel));
}

void RAM_FUNC(sendMIDIpitchBendToCh1)() {
  byte targetChannel = primaryMIDIChannel();
  withMIDI([&](auto& M) { M.sendPitchBend(pbWheel.curValue, targetChannel); });
  sendToLog("sent pb wheel value " + std::to_string(pbWheel.curValue) + " to ch " + std::to_string(targetChannel));
}

//////////////////////////////////////////////////////////////////
//  Dynamic just intonation code start


// HOW BPM SYNC WORKS:
// The idea is to round off the note frequency to a certain precision.
// If you round the note frequencies of a C-E-G chord to integer values (261.626Hz / 329.628Hz / 391.995Hz) -
// you'll get a chord with ratio of 262/294/392.
// As a result, because these frequency values are always a multiple of 1 Hz -
// they all will be guaranteed to finish their wave cycle in 1 second.
// Thus, this chord will beat at 1 Hz if not faster.

// By knowing the pressed keys it is possible to pick better ratios, ideally having 262/327.5/393 (4/5/6) in this example

// TODO: make BPM sync work with dynamic just intonation to make pure just intonation achieveable.
// Without it - this implementation provides you with n-EDO-sized independent JI rings, unconnected to eachother;
// TODO: replace floating point math with integer math;
// TODO: replace std::pair<byte,byte> ratios with precomputed floating(or fixed) point ratios;
// TODO: generate the table of ratios with a constexpr function rather than holding a huge block of hardcoded values in the code;
// TODO: It is a good idea to octave-reduce the ratios, and adjust the code to calculate pitchbend against the octave reduced set of ratios for significant performance improvement;
inline float pitchBendToFrequencyMultiplier(int16_t bendValue) {
  if (bendValue == 0) {
    return 1.0f;
  }
  const float semitoneOffset = (static_cast<float>(bendValue) * static_cast<float>(MPEpitchBendSemis)) / 8192.0f;
  return std::exp2(semitoneOffset / 12.0f);
}

int16_t justIntonationRetune(byte x);

inline int16_t combinedPitchBend(byte index) {
  const int32_t combined = static_cast<int32_t>(h[index].bend) + h[index].jiRetune;
  if (combined > 8191) {
    return 8191;
  }
  if (combined < -8192) {
    return -8192;
  }
  return static_cast<int16_t>(combined);
}


// This is a list of ratios sorted from the simplest ones to the most complex ones. The code searches for a first match that's good enough within 1/4 of an EDO step, literally bruteforcing through the list. As a result - the simplest ratio is chosen before more comples ones, prioritising consonant ratios first. In case not a single good ratio is found - the best one found so far is chosen instead

// byte pair was chosen to preserve space. The ratio is "unpacked" later
std::vector<std::pair<byte, byte>> ratios = {
  { 1, 1 },
  { 1, 2 },
  { 2, 1 },
  { 3, 1 },
  { 1, 3 },
  { 1, 4 },
  { 2, 3 },
  { 1, 4 },
  { 4, 1 },
  { 3, 2 },
  { 1, 5 },
  { 5, 1 },
  { 5, 2 },
  { 1, 6 },
  { 3, 4 },
  { 5, 2 },
  { 4, 3 },
  { 6, 1 },
  { 2, 5 },
  { 5, 3 },
  { 1, 7 },
  { 7, 1 },
  { 3, 5 },
  { 2, 7 },
  { 8, 1 },
  { 5, 4 },
  { 1, 8 },
  { 4, 5 },
  { 7, 2 },
  { 9, 1 },
  { 7, 3 },
  { 1, 9 },
  { 3, 7 },
  { 1, 9 },
  { 1, 10 },
  { 10, 1 },
  { 7, 4 },
  { 3, 8 },
  { 8, 3 },
  { 6, 5 },
  { 1, 10 },
  { 8, 3 },
  { 4, 7 },
  { 2, 9 },
  { 9, 2 },
  { 5, 6 },
  { 11, 1 },
  { 7, 5 },
  { 1, 11 },
  { 5, 7 },
  { 5, 8 },
  { 3, 10 },
  { 4, 9 },
  { 3, 10 },
  { 2, 11 },
  { 11, 2 },
  { 12, 1 },
  { 1, 12 },
  { 9, 4 },
  { 5, 8 },
  { 1, 12 },
  { 8, 5 },
  { 10, 3 },
  { 6, 7 },
  { 7, 6 },
  { 12, 1 },
  { 9, 5 },
  { 1, 13 },
  { 3, 11 },
  { 11, 3 },
  { 9, 5 },
  { 5, 9 },
  { 13, 1 },
  { 14, 1 },
  { 13, 2 },
  { 11, 4 },
  { 1, 14 },
  { 2, 13 },
  { 8, 7 },
  { 7, 8 },
  { 4, 11 },
  { 9, 7 },
  { 11, 5 },
  { 7, 9 },
  { 5, 11 },
  { 13, 3 },
  { 3, 13 },
  { 15, 1 },
  { 1, 15 },
  { 4, 13 },
  { 2, 15 },
  { 10, 7 },
  { 2, 15 },
  { 11, 6 },
  { 8, 9 },
  { 16, 1 },
  { 12, 5 },
  { 3, 14 },
  { 7, 10 },
  { 5, 12 },
  { 14, 3 },
  { 9, 8 },
  { 15, 2 },
  { 13, 4 },
  { 1, 16 },
  { 6, 11 },
  { 17, 1 },
  { 1, 17 },
  { 5, 13 },
  { 13, 5 },
  { 4, 15 },
  { 17, 2 },
  { 9, 10 },
  { 2, 17 },
  { 9, 10 },
  { 12, 7 },
  { 10, 9 },
  { 11, 8 },
  { 16, 3 },
  { 3, 16 },
  { 13, 6 },
  { 14, 5 },
  { 15, 4 },
  { 18, 1 },
  { 8, 11 },
  { 1, 18 },
  { 4, 15 },
  { 5, 14 },
  { 6, 13 },
  { 7, 12 },
  { 19, 1 },
  { 11, 9 },
  { 17, 3 },
  { 3, 17 },
  { 9, 11 },
  { 1, 19 },
  { 5, 16 },
  { 20, 1 },
  { 8, 13 },
  { 10, 11 },
  { 20, 1 },
  { 19, 2 },
  { 1, 20 },
  { 11, 10 },
  { 2, 19 },
  { 13, 8 },
  { 17, 4 },
  { 4, 17 },
  { 16, 5 },
  { 1, 20 },
  { 13, 9 },
  { 21, 1 },
  { 7, 15 },
  { 9, 13 },
  { 19, 3 },
  { 17, 5 },
  { 3, 19 },
  { 5, 17 },
  { 15, 7 },
  { 1, 21 },
  { 13, 10 },
  { 3, 20 },
  { 12, 11 },
  { 21, 2 },
  { 18, 5 },
  { 6, 17 },
  { 15, 8 },
  { 3, 20 },
  { 20, 3 },
  { 19, 4 },
  { 5, 18 },
  { 14, 9 },
  { 9, 14 },
  { 8, 15 },
  { 2, 21 },
  { 1, 22 },
  { 17, 6 },
  { 22, 1 },
  { 10, 13 },
  { 11, 12 },
  { 4, 19 },
  { 5, 19 },
  { 1, 23 },
  { 19, 5 },
  { 23, 1 },
  { 18, 7 },
  { 8, 17 },
  { 21, 4 },
  { 22, 3 },
  { 3, 22 },
  { 7, 18 },
  { 6, 19 },
  { 12, 13 },
  { 19, 6 },
  { 2, 23 },
  { 9, 16 },
  { 17, 8 },
  { 24, 1 },
  { 13, 12 },
  { 1, 24 },
  { 23, 2 },
  { 4, 21 },
  { 16, 9 },
  { 9, 17 },
  { 1, 25 },
  { 5, 21 },
  { 25, 1 },
  { 15, 11 },
  { 17, 9 },
  { 3, 23 },
  { 23, 3 },
  { 11, 15 },
  { 21, 5 },
  { 17, 10 },
  { 10, 17 },
  { 19, 8 },
  { 5, 22 },
  { 20, 7 },
  { 22, 5 },
  { 23, 4 },
  { 7, 20 },
  { 1, 26 },
  { 8, 19 },
  { 25, 2 },
  { 26, 1 },
  { 2, 25 },
  { 4, 23 },
  { 5, 23 },
  { 9, 19 },
  { 1, 27 },
  { 13, 15 },
  { 3, 25 },
  { 15, 13 },
  { 23, 5 },
  { 19, 9 },
  { 27, 1 },
  { 25, 3 },
  { 25, 4 },
  { 14, 15 },
  { 27, 2 },
  { 9, 20 },
  { 2, 27 },
  { 26, 3 },
  { 20, 9 },
  { 17, 12 },
  { 1, 28 },
  { 24, 5 },
  { 10, 19 },
  { 12, 17 },
  { 23, 6 },
  { 21, 8 },
  { 11, 18 },
  { 19, 10 },
  { 5, 24 },
  { 4, 25 },
  { 5, 24 },
  { 3, 26 },
  { 18, 11 },
  { 28, 1 },
  { 8, 21 },
  { 6, 23 },
  { 15, 14 },
  { 1, 29 },
  { 29, 1 },
  { 23, 8 },
  { 24, 7 },
  { 7, 24 },
  { 6, 25 },
  { 10, 21 },
  { 30, 1 },
  { 5, 26 },
  { 25, 6 },
  { 11, 20 },
  { 30, 1 },
  { 1, 30 },
  { 16, 15 },
  { 8, 23 },
  { 4, 27 },
  { 2, 29 },
  { 26, 5 },
  { 9, 22 },
  { 29, 2 },
  { 27, 4 },
  { 28, 3 },
  { 15, 16 },
  { 20, 11 },
  { 18, 13 },
  { 22, 9 },
  { 21, 10 },
  { 13, 18 },
  { 12, 19 },
  { 19, 12 },
  { 3, 28 },
  { 17, 15 },
  { 15, 17 },
  { 29, 3 },
  { 31, 1 },
  { 27, 5 },
  { 3, 29 },
  { 9, 23 },
  { 23, 9 },
  { 1, 31 },
  { 5, 27 },
  { 13, 20 },
  { 2, 31 },
  { 28, 5 },
  { 1, 32 },
  { 29, 4 },
  { 25, 8 },
  { 20, 13 },
  { 4, 29 },
  { 8, 25 },
  { 23, 10 },
  { 10, 23 },
  { 5, 28 },
  { 31, 2 },
  { 32, 1 },
  { 33, 1 },
  { 3, 31 },
  { 1, 33 },
  { 5, 29 },
  { 15, 19 },
  { 9, 25 },
  { 31, 3 },
  { 19, 15 },
  { 25, 9 },
  { 29, 5 },
  { 33, 2 },
  { 6, 29 },
  { 17, 18 },
  { 34, 1 },
  { 2, 33 },
  { 32, 3 },
  { 26, 9 },
  { 31, 4 },
  { 27, 8 },
  { 1, 34 },
  { 4, 31 },
  { 18, 17 },
  { 29, 6 },
  { 8, 27 },
  { 12, 23 },
  { 11, 24 },
  { 3, 32 },
  { 9, 26 },
  { 23, 12 },
  { 24, 11 },
  { 5, 31 },
  { 31, 5 },
  { 35, 1 },
  { 1, 35 },
  { 1, 36 },
  { 30, 7 },
  { 24, 13 },
  { 18, 19 },
  { 36, 1 },
  { 6, 31 },
  { 28, 9 },
  { 34, 3 },
  { 36, 1 },
  { 15, 22 },
  { 7, 30 },
  { 8, 29 },
  { 1, 36 },
  { 17, 20 },
  { 29, 8 },
  { 4, 33 },
  { 12, 25 },
  { 10, 27 },
  { 32, 5 },
  { 20, 17 },
  { 3, 34 },
  { 25, 12 },
  { 5, 32 },
  { 2, 35 },
  { 33, 4 },
  { 22, 15 },
  { 9, 28 },
  { 13, 24 },
  { 27, 10 },
  { 35, 2 },
  { 19, 18 },
  { 31, 6 },
  { 9, 29 },
  { 35, 3 },
  { 29, 9 },
  { 5, 33 },
  { 23, 15 },
  { 33, 5 },
  { 15, 23 },
  { 37, 1 },
  { 3, 35 },
  { 1, 37 },
  { 10, 29 },
  { 31, 8 },
  { 5, 34 },
  { 4, 35 },
  { 1, 38 },
  { 35, 4 },
  { 29, 10 },
  { 34, 5 },
  { 37, 2 },
  { 2, 37 },
  { 19, 20 },
  { 8, 31 },
  { 20, 19 },
  { 38, 1 },
  { 31, 9 },
  { 39, 1 },
  { 37, 3 },
  { 3, 37 },
  { 9, 31 },
  { 1, 39 },
  { 38, 3 },
  { 11, 30 },
  { 9, 32 },
  { 26, 15 },
  { 31, 10 },
  { 29, 12 },
  { 32, 9 },
  { 20, 21 },
  { 2, 39 },
  { 35, 6 },
  { 33, 8 },
  { 5, 36 },
  { 37, 4 },
  { 21, 20 },
  { 15, 26 },
  { 40, 1 },
  { 8, 33 },
  { 10, 31 },
  { 30, 11 },
  { 12, 29 },
  { 23, 18 },
  { 17, 24 },
  { 36, 5 },
  { 40, 1 },
  { 1, 40 },
  { 4, 37 },
  { 24, 17 },
  { 39, 2 },
  { 6, 35 },
  { 18, 23 },
  { 3, 38 },
  { 41, 1 },
  { 37, 5 },
  { 5, 37 },
  { 1, 41 },
  { 33, 10 },
  { 3, 40 },
  { 4, 39 },
  { 1, 42 },
  { 37, 6 },
  { 13, 30 },
  { 12, 31 },
  { 42, 1 },
  { 10, 33 },
  { 7, 36 },
  { 36, 7 },
  { 9, 34 },
  { 41, 2 },
  { 35, 8 },
  { 40, 3 },
  { 8, 35 },
  { 5, 38 },
  { 2, 41 },
  { 39, 4 },
  { 38, 5 }
};

int16_t centsToRelativePitchBend(float cents) {
  return round(cents * (8192.0 / (100.0 * MPEpitchBendSemis)));
}

int16_t justIntonationRetune(byte x) {
  if (useDynamicJustIntonation == false && useJustIntonationBPM == false) {
    h[x].jiRetune = 0;
    h[x].jiFrequencyMultiplier = 1.0f;
    return 0;
  }
  int16_t pitchAdjustment = 0;
  float pitchAdjustmentCents = 0;
  float basePitchOffset = 0;
  if (useJustIntonationBPM) {
    float buttonStepsFromA = -current.tuning().spanCtoA() - h[x].stepsFromC;
    // It was planned to use integer math but floating point arithmetics works fast enough so far
    float rounding = ((float)justIntonationBPM / 60.0 * justIntonationBPM_Multiplier);
    pitchAdjustmentCents = (buttonStepsFromA * current.tuning().stepSize) - ratioToCents(round(440.0 / rounding) / round(h[x].frequency / rounding));

    if (pressedKeyIDs.size() > 1 && useDynamicJustIntonation) {
      basePitchOffset = ((-current.tuning().spanCtoA() - h[pressedKeyIDs[0]].stepsFromC) * current.tuning().stepSize) - ratioToCents(round(440.0 / rounding) / round(h[pressedKeyIDs[0]].frequency / rounding));
    } else {
      pitchAdjustment += centsToRelativePitchBend(pitchAdjustmentCents);
    }
  }
  if (useDynamicJustIntonation && pressedKeyIDs.size() > 1) {
    //bool ratioFound = false;  // I might need this one later
    bool preferSmallRatios = true;  // if false - the closest found ratio will be chosen from the ratio table

    // detune within a 1/4 of a step, avoid wild detuning but cover the entire pitch range
    float errorThreshold = current.tuning().stepSize / 4.0;
    float deviation = INFINITY;
      float EDOCents = ratioToCents(h[pressedKeyIDs[0]].frequency / h[x].frequency);
    std::pair<byte, byte> selectedRatio;

    for (int i = 0; i < ratios.size(); i++) {
      auto ratio = ratios[i];
      float ratio0 = ratio.first;
      float ratio1 = ratio.second;
      //if(h[pressedKeyIDs[0]].note < h[x].note)
      //{
      //  std::swap(ratio1,ratio0);
      //}
      float ratioCents = ratioToCents(ratio0 / ratio1);

      if (std::abs(deviation) > std::abs(ratioCents - EDOCents)) {
        deviation = (EDOCents - ratioCents);
        selectedRatio.first = ratio0;
        selectedRatio.second = ratio1;
        if (preferSmallRatios && std::abs(deviation) < errorThreshold) {
          //ratioFound = true;
            break;
          }
        }
      }
    //if(ratioFound)
    {
    pitchAdjustment += centsToRelativePitchBend(deviation + basePitchOffset);
    }
  }
  h[x].jiRetune = pitchAdjustment;
  h[x].jiFrequencyMultiplier = pitchBendToFrequencyMultiplier(pitchAdjustment);
  return pitchAdjustment;
}

void RAM_FUNC(tryMIDInoteOn)(byte x) {
  if (displayPlayedNotes && screenSaverOn) {
    setNoteOverlayTemporaryWake(true);
    noteOverlayDirty = true;
  }

  // This gets called on any non-command hex that is not scale-locked.
  if (h[x].note >= 128) {
    return;
  }
  if (!(h[x].MIDIch)) {
    if (MPEpitchBendsNeeded == 1) {
      if (standardMidiMicrotonalActive) {
        h[x].MIDIch = h[x].mappedMidiChannel ? h[x].mappedMidiChannel : defaultMidiChannel;
      } else {
        h[x].MIDIch = defaultMidiChannel;
      }
    } else {
      uint8_t availableChannels = mpePlayableChannelCount();
      if (availableChannels == 0) {
        sendToLog("No MPE channels configured; skipped MIDI note");
      } else if (mpeChannelQueueActive) {
        byte channel = takeMPEChannel();
        if (!channel) {
          sendToLog("MPE pool was empty so did not play a MIDI note");
        } else {
          h[x].MIDIch = channel;
          sendToLog("Assigned MPE ch " + std::to_string(h[x].MIDIch) + " from pool");
        }
      } else {
        h[x].MIDIch = static_cast<byte>(mpeLowestChannel + positiveMod(h[x].stepsFromC, availableChannels));
      }
    }

    if (h[x].MIDIch) {
      pressedKeyIDs.push_back(x);  // Dynamic JI pressed key tracking
      justIntonationRetune(x);
      int16_t pitchBendValue = 0;
      // First, send the pitch bend (if applicable)
      if (MPEpitchBendsNeeded != 1) {
        pitchBendValue = combinedPitchBend(x);
        withMIDI([&](auto& M) { M.sendPitchBend(pitchBendValue, h[x].MIDIch); });  // ch 1-16
        if (extraMPE) { // if the extra MPE messages are enabled
          withMIDI([&](auto& M) {
            M.sendAfterTouch(velWheel.curValue, h[x].MIDIch);  // Channel Pressure
            M.sendControlChange(74, CC74value, h[x].MIDIch);   // CC74 (Timbre)
          });
        }
      }
      // Then, send the note-on message
      withMIDI([&](auto& M) { M.sendNoteOn(h[x].note, velWheel.curValue, h[x].MIDIch); });  // ch 1-16
      noteOverlayReleaseGraceUntil = 0;
      noteOverlayDirty = true;

      sendToLog(
        "Sent MIDI pitch bend: " + std::to_string(pitchBendValue) + " to ch " + std::to_string(h[x].MIDIch));
      sendToLog(
        "Sent MIDI noteOn: " + std::to_string(h[x].note) + " vel " + std::to_string(velWheel.curValue) + " ch " + std::to_string(h[x].MIDIch));
    }
  }
}

void RAM_FUNC(tryMIDInoteOff)(byte x) {
  // this gets called on any non-command hex
  // that is not scale-locked.
  if (h[x].MIDIch) {  // but just in case, check
    withMIDI([&](auto& M) { M.sendNoteOff(h[x].note, velWheel.curValue, h[x].MIDIch); });
    pressedKeyIDs.pop_back();  // Dynamic JI pressed key tracking
    h[x].jiRetune = 0;
    h[x].jiFrequencyMultiplier = 1.0f;
    sendToLog(
      "sent note off: " + std::to_string(h[x].note) + " vel " + std::to_string(velWheel.curValue) + " ch " + std::to_string(h[x].MIDIch));
    if (mpeChannelQueueActive && h[x].MIDIch >= mpeLowestChannel && h[x].MIDIch <= mpeHighestChannel) {
      if (extraMPE) { //if the extra MPE messages are enabled
        withMIDI([&](auto& M) {
          M.sendAfterTouch(0, h[x].MIDIch);                 // Channel Pressure
          M.sendControlChange(74, CC74value, h[x].MIDIch);  // CC74 (Timbre)
        });
      }
      releaseMPEChannel(h[x].MIDIch);
    }
    noteOverlayReleaseGraceUntil = runTime + DISPLAYED_NOTES_RELEASE_GRACE_MICROS;
    noteOverlayDirty = true;
    h[x].MIDIch = 0;
  }
}

/*
    Eight voice polyphony can be simulated.
    Any more voices and the
    resolution is too low to distinguish;
    also, the code becomes too slow to keep
    up with the poll interval. This value
    can be safely reduced below eight if
    there are issues.

    Note this is NOT the same as the MIDI
    polyphony limit, which is 15 (based
    on using channel 2 through 16 for
    polyphonic expression mode).
  */
#define POLYPHONY_LIMIT 8

inline uint8_t RAM_FUNC(synthPlaybackVoiceLimit)(byte mode) {
  if (mode == SYNTH_POLY) {
    return POLYPHONY_LIMIT;
  }
  if (mode == SYNTH_OFF) {
    return 0;
  }
  return 1;
}

inline uint8_t RAM_FUNC(currentSynthVoiceLimit)() {
  return synthPlaybackVoiceLimit(playbackMode);
}

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
