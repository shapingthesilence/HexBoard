#include "../FirmwareModule.h"
#include "DiagnosticsTiming.h"
#include "PlatformCommon.h"
#include "RuntimeDefaults.h"
#include "StabilityBenchmark.h"
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
  load_synth_presets();
  load_synth_wavetables();
  load_geometry_objects();
  restoreSynthStateForProfile(activeProfileIndex);
  setupLEDs();
  setupGFX();
  setupRotary();
  setupMenu();
  setupHardware();
  initializeSynthWaveTables();
  syncSettingsToRuntime();
  recomputePitchBendFactor();
  synthRuntimeReady.store(true, std::memory_order_release);
  if (!waitForAudioTransport()) {
    playbackMode = SYNTH_OFF;
    sendToLog("Audio transport startup timed out; continuing with onboard synth disabled.");
  }
  restoreSequencerAtStartup();
  populateStorageStatusMenuPage();
  runBootLedSelfCheck();
  normalRuntimeReady.store(true, std::memory_order_release);
}
void hexboardLoop() {        // run on first core
  timeTracker();     // Time tracking functions
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_DISPLAY);
  u8g2.serviceTransfer();
  serviceSerialDebugMessages();
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_PRESET_TRANSFER);
  bool presetSyncOwnsUi = servicePresetSyncTransfer();
  bool missingWavetableNoticeOwnsUi =
    !presetSyncOwnsUi && serviceMissingWavetableNotice();
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_ENVELOPE_RELEASE);
  processEnvelopeReleases();
  retryPendingReleases();
  if (!presetSyncOwnsUi && !missingWavetableNoticeOwnsUi) {
    screenSaver();     // Reduces wear-and-tear on OLED panel
  }
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_BUTTON_SCAN);
  readHexes();       // Read and store the digital button states of the scanning matrix
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_DISPLAY);
  u8g2.serviceTransfer();
  if (presetSyncOwnsUi) {
    stabilityBenchmarkSetCore0Task(STABILITY_TASK_ROTARY_MENU);
    dealWithRotary();
    return;
  }
  serviceSequencerMode();
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_ARPEGGIATOR);
  arpeggiate();      // arpeggiate if synth mode allows it
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_METRONOME);
  runMetronome();    // metronome beep/flash modes share the synth tempo
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_WHEELS);
  updateWheels();    // deal with the pitch/mod wheel
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_MIDI_IN);
  processIncomingMIDI();  // respond to external MIDI input
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_DISPLAY);
  u8g2.serviceTransfer();
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_PRESET_TRANSFER);
  if (servicePresetSyncTransfer()) {
    return;
  }
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_LED_ANIMATE);
  animateLEDs();     // deal with animations
  if (!shouldDeferMidiInLedRefresh()) {
    stabilityBenchmarkSetCore0Task(STABILITY_TASK_LED_RENDER);
    lightUpLEDs();   // refresh LEDs
  }
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_DISPLAY);
  u8g2.serviceTransfer();
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_ROTARY_MENU);
  if (!missingWavetableNoticeOwnsUi) {
    dealWithRotary();  // deal with menu
  }
  if (delegatedControlState.active && !stabilityBenchmarkIsActive()) {
    stabilityBenchmarkSetCore0Task(STABILITY_TASK_DISPLAY);
    drawDelegatedControlScreen();
    u8g2.serviceTransfer();
    stabilityBenchmarkSetCore0Task(STABILITY_TASK_AUTOSAVE);
    checkAndAutoSave();  // save settings
    return;
  }
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_MENU_REBUILD);
  serviceSynthPresetMenuRebuild();
  serviceSynthWavetableMenuRebuild();
  serviceUserGeometryMenuRebuild();
  restoreMenuAfterDelegatedControl();
  serviceVirtualListLauncherLabelScroll();
  serviceFlashSaveScreen();
  missingWavetableNoticeOwnsUi = serviceMissingWavetableNotice();
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_DISPLAY);
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
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_BENCHMARK);
  serviceStabilityBenchmark();
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_AUTOSAVE);
  checkAndAutoSave();  // save settings
}
void hexboardSetup1() {  // set up on second core
  setupSynthOutputs();
  while (!synthRuntimeReady.load(std::memory_order_acquire)) {
    tight_loop_contents();
  }
  setupAudioDma();
}
void hexboardLoop1() {  // run on second core
  stabilityBenchmarkSetCore1Task(STABILITY_TASK_AUDIO_DMA);
  serviceAudioDmaBuffers();
  if (!normalRuntimeReady.load(std::memory_order_acquire)) {
    return;
  }
  if (delegatedControlState.active) {
    stabilityBenchmarkSetCore1Task(STABILITY_TASK_DELEGATED_MIDI);
    processIncomingMIDIDelegated();
  }
  stabilityBenchmarkSetCore1Task(STABILITY_TASK_ENCODER_SCAN);
  readKnob();
}
