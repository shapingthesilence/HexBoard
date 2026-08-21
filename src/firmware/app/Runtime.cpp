#include "../FirmwareModule.h"
#include "DiagnosticsTiming.h"
#include "PlatformCommon.h"
#include "RuntimeDefaults.h"
#include "../hardware/GridScanRotary.h"
#include "../hardware/GridState.h"
#include "../hardware/LedAnimations.h"
#include "../hardware/LedRender.h"
#include "../menu/CommandWheelOverlay.h"
#include "../menu/GeometryMenu.h"
#include "../menu/MenuAndDisplay.h"
#include "../menu/PlayedNotesOverlay.h"
#include "../menu/SynthPresetMenu.h"
#include "../menu/SynthWavetableMenu.h"
#include "../midi/DelegatedControl.h"
#include "../midi/ExternalMidiLedState.h"
#include "../midi/MidiInput.h"
#include "../midi/MidiTransport.h"
#include "../midi/MidiRouting.h"
#include "../sequencer/SequencerMode.h"
#include "../storage/PresetSync.h"
#include "../storage/Settings.h"
#include "../storage/StorageHealth.h"
#include "../storage/SynthPresetStorage.h"
#include "../storage/SynthWavetableStorage.h"
#include "../synth/SynthAudio.h"

// @mainLoop
/*
    An Arduino program runs
    the setup() function once, then
    runs the loop() function on repeat
    until the machine is powered off.

    The RP2040 has two identical cores.
    Anything called from setup() and loop()
    runs on the first core.
    Anything called from setup1() and loop1()
    runs on the second core.

    On the HexBoard, the second core is dedicated to
    the timing-critical synth renderer and rotary input.
    The outer loop refills audio buffers, services delegated
    MIDI when active, and polls the rotary decoder.
  */
namespace {
std::atomic<bool> normalRuntimeReady = false;
std::atomic<bool> bootLedAnimationReady = false;
std::atomic<bool> bootLedSplashComplete = false;
std::atomic<bool> normalLedFrameReady = false;
std::atomic<bool> bootLedAnimationComplete = false;
constexpr uint64_t AUDIO_STARTUP_TIMEOUT_MICROS = 3000000ULL;

bool waitForAudioTransport() {
  const uint64_t deadline = readClock() + AUDIO_STARTUP_TIMEOUT_MICROS;
  while (!audioTransportReady.load(std::memory_order_acquire)) {
    if (readClock() >= deadline) {
      return false;
    }
    tight_loop_contents();
  }
  return true;
}

void waitForBootLedAnimation() {
  while (!bootLedAnimationComplete.load(std::memory_order_acquire)) {
    tight_loop_contents();
  }
}

void waitForBootLedSplash() {
  while (!bootLedSplashComplete.load(std::memory_order_acquire)) {
    tight_loop_contents();
  }
}
}  // namespace

void hexboardSetup() {
  setupUSBDescriptors();
  Serial.begin(115200);
  setupMIDI();
  resetStorageHealth();
  setupFileSystem();
  Wire.setSDA(SDAPIN);
  Wire.setSCL(SCLPIN);
  setupPins();
  setupGrid();
  detectHardwareVersion();
  load_settings();
  // The splash only needs the saved LED limits and initialized strip. Core 1
  // can render it while core 0 loads the remaining libraries and subsystems.
  bootAnimationEnabled = settingEnabled(SettingKey::BootAnimationEnabled);
  ledRestBrightness = settingValue(SettingKey::RestLedBrightness);
  globalBrightness = settingValue(SettingKey::GlobalBrightness);
  ledCurrentLimitMode = settingValue(SettingKey::LedCurrentLimitMode);
  syncLedCurrentLimit();
  setupLEDs();
  bootLedAnimationReady.store(true, std::memory_order_release);
  load_synth_presets();
  load_synth_wavetables();
  load_geometry_objects();
  restoreSynthStateForProfile(activeProfileIndex);
  setupGFX();
  setupRotary();
  setupMenu();
  setupHardware();
  initializeSynthWaveTables();
  // Keep the OLED blank until every startup task has completed and the menu
  // can accept input. Core 1 may animate the LEDs once their runtime colors
  // and current limit are final.
  waitForBootLedSplash();
  syncSettingsToRuntime(false);
  recomputePitchBendFactor();
  synthRuntimeReady.store(true, std::memory_order_release);
  normalLedFrameReady.store(true, std::memory_order_release);
  restoreSequencerAtStartup();
  populateStorageStatusMenuPage();
  waitForBootLedAnimation();
  if (!waitForAudioTransport()) {
    playbackMode = SYNTH_OFF;
    sendToLog("Audio transport startup timed out; continuing with onboard synth disabled.");
  }
  menuHome();
  normalRuntimeReady.store(true, std::memory_order_release);
}
void hexboardLoop() {        // run on first core
  timeTracker();     // Time tracking functions
  u8g2.serviceTransfer();
  serviceSerialDebugMessages();
  bool presetSyncOwnsUi = servicePresetSyncTransfer();
  bool missingWavetableNoticeOwnsUi =
    !presetSyncOwnsUi && serviceMissingWavetableNotice();
  processEnvelopeReleases();
  retryPendingReleases();
  if (!presetSyncOwnsUi && !missingWavetableNoticeOwnsUi) {
    screenSaver();     // Reduces wear-and-tear on OLED panel
  }
  readHexes();       // Read and store the digital button states of the scanning matrix
  u8g2.serviceTransfer();
  if (presetSyncOwnsUi) {
    dealWithRotary();
    return;
  }
  serviceSequencerMode();
  arpeggiate();      // arpeggiate if synth mode allows it
  runMetronome();    // metronome beep/flash modes share the synth tempo
  updateWheels();    // deal with the pitch/mod wheel
  processIncomingMIDI();  // respond to external MIDI input
  u8g2.serviceTransfer();
  if (servicePresetSyncTransfer()) {
    return;
  }
  animateLEDs();     // deal with animations
  if (!shouldDeferMidiInLedRefresh()) {
    lightUpLEDs();   // refresh LEDs
  }
  u8g2.serviceTransfer();
  if (!missingWavetableNoticeOwnsUi) {
    dealWithRotary();  // deal with menu
  }
  if (delegatedControlState.active) {
    drawDelegatedControlScreen();
    u8g2.serviceTransfer();
    checkAndAutoSave();  // save settings
    return;
  }
  serviceSynthPresetMenuRebuild();
  serviceSynthWavetableMenuRebuild();
  serviceUserGeometryMenuRebuild();
  restoreMenuAfterDelegatedControl();
  serviceVirtualListLauncherLabelScroll();
  serviceFlashSaveScreen();
  missingWavetableNoticeOwnsUi = serviceMissingWavetableNotice();
  if (!flashSaveScreenVisible && !missingWavetableNoticeOwnsUi && sequencerModeActive()) {
    drawSequencerModeDisplay();
  }
  if (!flashSaveScreenVisible && !missingWavetableNoticeOwnsUi) {
    drawCommandWheelOverlay();
  }
  if (!missingWavetableNoticeOwnsUi) {
    drawPlayedNotesOverlay(); // shows the notes of keys pressed on the screen
  }
  u8g2.serviceTransfer();
  checkAndAutoSave();  // save settings
}
void hexboardSetup1() {  // set up on second core
  setupSynthOutputs();
  while (!bootLedAnimationReady.load(std::memory_order_acquire)) {
    tight_loop_contents();
  }
  runBootLedSelfCheckSplash();
  bootLedSplashComplete.store(true, std::memory_order_release);
  while (!normalLedFrameReady.load(std::memory_order_acquire)) {
    tight_loop_contents();
  }
  finishBootLedSelfCheck();
  bootLedAnimationComplete.store(true, std::memory_order_release);
  while (!synthRuntimeReady.load(std::memory_order_acquire)) {
    tight_loop_contents();
  }
  setupAudioDma();
}
void hexboardLoop1() {  // run on second core
  serviceAudioDmaBuffers();
  if (!normalRuntimeReady.load(std::memory_order_acquire)) {
    return;
  }
  if (delegatedControlState.active) {
    processIncomingMIDIDelegated();
  }
  readKnob();
}
