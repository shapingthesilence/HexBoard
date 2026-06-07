#include "FirmwareModule.h"

#if HEXBOARD_FIRMWARE_UNITY

// @init
#include <Arduino.h>  // this is necessary to talk to the Hexboard!
#include <Wire.h>     // this is necessary to connect with I2C devices (such as the oled display)
constexpr byte SDAPIN = 16;
constexpr byte SCLPIN = 17;
#include <GEM_u8g2.h>  // library of code to create menu objects on the B&W display
#include <algorithm>
#include <array>
#include <atomic>
#include <cstdio>
#include <cstring>
#if defined(ARDUINO_ARCH_RP2040) //This is to enable RAM functions on the RP2040 specifically in case we port this to other architectures later
#include <hardware/flash.h>     // to access the __not_in_flash_func
#define RAM_FUNC(name) __not_in_flash_func(name) // macro to keep code clean - use RAM_FUNC(yourFunctionName) to have it run from RAM
#else
#define RAM_FUNC(name) name // do nothing on other architectures
#endif
#include <cmath>
#include <numeric>     // need that GCD function, son
#include <string>      // standard C++ library string classes (use "std::string" to invoke it); these do not cause the memory corruption that Arduino::String does.
#include <limits>
#include <queue>       // standard C++ library construction for various FIFO pools (use "std::queue" to invoke it)
#include <vector>
#include "LittleFS.h"  // code to use a portion of the 16MB flash chip space as a file system
#include "pico/time.h" // Allows me to set delays that don't disable interrupts
#include "hardware/structs/sio.h" // For fast GPIO read/write
#include "hardware/dma.h"

enum class EnvelopeCommand : uint8_t;
enum class SettingKey : uint8_t;
class colorDef;
struct SettingsHeader;
struct SynthPresetSlot;
struct SynthPresetSlotV7;
struct SynthPresetSlotV6;
struct LegacySynthPresetSlot;
struct SynthPresetMenuAction;
struct SynthPresetMenuFolderNode;
struct ParsedSynthWavetableObject;
struct SynthWavetableSlot;
extern volatile uint32_t audioDmaUnderrunCount;

// Software-detected hardware revision.
constexpr byte HARDWARE_UNKNOWN = 0;
constexpr byte HARDWARE_V1_1 = 1;
constexpr byte HARDWARE_V1_2 = 2;
byte Hardware_Version = HARDWARE_UNKNOWN;
constexpr byte MIDI_CHANNEL_MIN = 1;
constexpr byte MIDI_CHANNEL_MAX = 16;
constexpr byte MIDI_CHANNEL_COUNT = MIDI_CHANNEL_MAX - MIDI_CHANNEL_MIN + 1;
constexpr byte MPE_CHANNEL_MIN = 2;
constexpr int32_t MIDI_NOTES_PER_CHANNEL = 128;

bool isValidMidiChannel(byte channel) {
  return (channel >= MIDI_CHANNEL_MIN) && (channel <= MIDI_CHANNEL_MAX);
}

// @helpers
//might be redundant
std::vector<byte> pressedKeyIDs = {};
std::array<std::vector<uint8_t>, 128> midiNoteToHexIndices = {};

void updateEnvelopeParamsFromSettings();
void updateEffectEnvelopeParamsFromSettings();
void updateEffectEnvelopeParamsFromSettings(uint8_t envelopeIndex);
void updateArpeggiatorTiming();
void updateArpeggiatorDirection();
void updateSynthPortamentoSettings();
void updateSynthMenuVisibility();
void updateTuningMenuVisibility();
void syncDynamicJIRatioCandidates();
void initializeSynthWaveTables();
void loadSelectedSynthWaveform();
void loadSelectedSynthWavetable();
void selectFallbackSynthWavetable();
void selectCompatibilitySynthWavetableForLegacyWaveform(byte waveform, bool updatePosition);
bool loadSynthWavetableFromCatalog(const char* folderPath, const char* name);
void RAM_FUNC(resetSynthRenderCaches)();
void synthWaveformChanged();
void playbackModeChanged();
void updateMetronomeTiming();
void metronomeModeChanged();
void RAM_FUNC(runMetronome)();
inline void RAM_FUNC(clearSynthPortamento)(uint8_t channelIndex);
inline void RAM_FUNC(beginSynthPortamento)(uint8_t channelIndex, uint32_t targetIncrement);
inline bool RAM_FUNC(metronomeBrightnessSelected)();
inline bool RAM_FUNC(metronomeSideButtonsSelected)();
inline bool RAM_FUNC(metronomeVisualFlashActive)();
void refreshMidiRouting();
void save_settings();
bool loadUserSynthWavetableFromFile();
void save_user_wavetable();
void load_synth_presets();
void save_synth_presets();
void load_synth_wavetables();
void save_synth_wavetables();
bool loadCurrentSynthWavetableReference();
void flashSafeSaveCurrentSynthWavetableReference();
void flashSafeSaveSynthWavetables();
void flashSafeSaveUserSynthWavetable();
void applyUploadedSynthWavetableSamples(const uint8_t* samples);
bool saveParsedSynthWavetable(const ParsedSynthWavetableObject& wavetable);
void normalizeSynthWavetableFolderPath(char* folderPath, size_t folderPathLength);
void requestSynthWavetableMenuRebuild();
void serviceSynthWavetableMenuRebuild();
void saveSynthPresetToSlot(uint16_t presetIndex);
void saveSynthPresetAsNew(const char* folderPath);
void loadSynthPresetFromSlot(uint16_t presetIndex);
void captureCurrentSynthPreset(SynthPresetSlot& preset);
void applySynthPresetToSettings(const SynthPresetSlot& preset);
bool processPresetSyncSysEx(const uint8_t* data, const unsigned int len);
bool processIncomingMIDI();
bool servicePresetSyncTransfer();
void copyCurrentSettingsToProfile(uint8_t profileIndex);
void markSettingsDirty();
void menuHome();
void menuSynthOptionsHome();
void rebuildSynthPresetMenuItems();
void requestSynthPresetMenuRebuild();
void serviceSynthPresetMenuRebuild();
void showOnlyValidLayoutChoices();
void showOnlyValidScaleChoices();
void showOnlyValidKeyChoices();
void applyDeviceDisplayRotation();
void loadDeviceRotationFromCurrentLayout();
void updateLayoutAndRotate();
void setupHardware();
uint32_t RAM_FUNC(getLEDcode)(colorDef c);
void RAM_FUNC(applyLedCurrentLimitToFrame)();
void RAM_FUNC(resetVelocityLEDs)();
void RAM_FUNC(resetWheelLEDs)();
uint32_t RAM_FUNC(applyNotePixelColor)(byte x);
bool migrateSettingsFromVersion(File& f, const SettingsHeader& header, uint8_t settingsPerProfile);
/*
    C++ returns a negative value for
    negative N % D. This function
    guarantees the mod value is always
    positive.
  */
int RAM_FUNC(positiveMod)(int n, int d) {
  return (((n % d) + d) % d);
}
/*
    There may already exist linear interpolation
    functions in the standard library. This one is helpful
    because it will do the weighting division for you.
    It only works on byte values since it's intended
    to blend color values together. A better C++
    coder may be able to allow automatic type casting here.
  */
byte byteLerp(byte xOne, byte xTwo, float yOne, float yTwo, float y) {
  float weight = (y - yOne) / (yTwo - yOne);
  int temp = xOne + ((xTwo - xOne) * weight);
  if (temp < xOne) { temp = xOne; }
  if (temp > xTwo) { temp = xTwo; }
  return temp;
}

/*
    A HexBoard note can travel outside the 0-127 MIDI
    note range. When that happens, we keep the note
    value within one MIDI channel and move the overflow
    into a channel offset instead.
  */
void splitExtendedMidiNote(int32_t midiIndex, int32_t& channelOffsetOut, byte& noteOut) {
  channelOffsetOut = midiIndex / MIDI_NOTES_PER_CHANNEL;
  int32_t remainder = midiIndex % MIDI_NOTES_PER_CHANNEL;
  if (remainder < 0) {
    remainder += MIDI_NOTES_PER_CHANNEL;
    channelOffsetOut -= 1;
  }
  noteOut = static_cast<byte>(remainder);
}

byte wrapMidiChannel(byte baseChannel, int32_t offset) {
  if (!isValidMidiChannel(baseChannel)) {
    baseChannel = MIDI_CHANNEL_MIN;
  }
  int32_t index = static_cast<int32_t>(baseChannel - MIDI_CHANNEL_MIN) + offset;
  index %= MIDI_CHANNEL_COUNT;
  if (index < 0) {
    index += MIDI_CHANNEL_COUNT;
  }
  return static_cast<byte>(index + MIDI_CHANNEL_MIN);
}

void mapExtendedMidiNote(int32_t midiIndex, byte baseChannel, byte& noteOut, byte& channelOut) {
  int32_t channelOffset = 0;
  splitExtendedMidiNote(midiIndex, channelOffset, noteOut);
  channelOut = wrapMidiChannel(baseChannel, channelOffset);
}

int32_t midiChannelOffset(int32_t midiIndex) {
  int32_t channelOffset = 0;
  byte unusedNote = 0;
  splitExtendedMidiNote(midiIndex, channelOffset, unusedNote);
  return channelOffset;
}


#endif  // HEXBOARD_FIRMWARE_UNITY
