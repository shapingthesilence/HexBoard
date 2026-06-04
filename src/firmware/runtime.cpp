#include "FirmwareModule.h"

#if HEXBOARD_FIRMWARE_UNITY

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

    On the HexBoard, the second core is
    dedicated to two timing-critical tasks:
    running the synth emulator, and tracking
    the rotary knob inputs.
    Everything else runs on the first core.
  */
void hexboardSetup() {
  setupUSBDescriptors();
  Serial.begin(115200);
  irq_set_enabled(ALARM_IRQ, false);
  setupMIDI();
  // Give the USB stack time to complete enumeration before any flash
  // operations (which disable interrupts and starve the USB IRQ handler).
  // Timeout after 2 s so the board still boots when no USB host is present.
  {
    unsigned long usbWaitStart = millis();
    while (!MidiUSB.connected() && (millis() - usbWaitStart < 2000)) {
      delay(1);
    }
  }
  setupFileSystem();
  Wire.setSDA(SDAPIN);
  Wire.setSCL(SCLPIN);
  setupPins();
  setupGrid();
  detectHardwareVersion();
  load_settings();
  load_synth_presets();
  setupLEDs();
  setupGFX();
  setupRotary();
  setupMenu();
  setupHardware();
  initializeSynthWaveTables();
  syncSettingsToRuntime();
  recomputePitchBendFactor();
  synthRuntimeReady.store(true, std::memory_order_release);
  runBootLedSelfCheck();
}
void hexboardLoop() {        // run on first core
  timeTracker();     // Time tracking functions
  if (servicePresetSyncTransfer()) {
    return;
  }
  processEnvelopeReleases();
  retryPendingReleases();
  screenSaver();     // Reduces wear-and-tear on OLED panel
  readHexes();       // Read and store the digital button states of the scanning matrix
  arpeggiate();      // arpeggiate if synth mode allows it
  runMetronome();    // metronome beep/flash modes share the synth tempo
  updateWheels();    // deal with the pitch/mod wheel
  processIncomingMIDI();  // respond to external MIDI input
  if (servicePresetSyncTransfer()) {
    return;
  }
  animateLEDs();     // deal with animations
  if (!shouldDeferMidiInLedRefresh()) {
    lightUpLEDs();   // refresh LEDs
  }
  dealWithRotary();  // deal with menu
  serviceSynthPresetMenuRebuild();
  drawPlayedNotesOverlay(); // shows the notes of keys pressed on the screen
  checkAndAutoSave();  // save settings
}
void hexboardSetup1() {  // set up on second core
  setupSynth(PIEZO_PIN, PIEZO_SLICE);
  setupSynth(AJACK_PIN, AJACK_SLICE);
  while (!synthRuntimeReady.load(std::memory_order_acquire)) {
    tight_loop_contents();
  }
  setupAudioDma();
}
void hexboardLoop1() {  // run on second core
  serviceAudioDmaBuffers();
  if (delegatedControl) {
    processIncomingMIDIDelegated();
  }
  readKnob();
}

#endif  // HEXBOARD_FIRMWARE_UNITY
