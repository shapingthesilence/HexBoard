#pragma once

#include "../FirmwareModule.h"

constexpr uint64_t STABILITY_BENCHMARK_EXIT_HOLD_MICROS = 5000000ULL;

enum StabilityBenchmarkTask : uint8_t {
  STABILITY_TASK_IDLE = 0,
  STABILITY_TASK_START,
  STABILITY_TASK_PATCH,
  STABILITY_TASK_NOTE_ON,
  STABILITY_TASK_VOICE_STEAL,
  STABILITY_TASK_NOTE_OFF,
  STABILITY_TASK_MOD_SWEEP,
  STABILITY_TASK_REPORT,
  STABILITY_TASK_STOP,
  STABILITY_TASK_PRESET_SYNC,
  STABILITY_TASK_PRESET_TRANSFER,
  STABILITY_TASK_ENVELOPE_RELEASE,
  STABILITY_TASK_BUTTON_SCAN,
  STABILITY_TASK_ARPEGGIATOR,
  STABILITY_TASK_METRONOME,
  STABILITY_TASK_WHEELS,
  STABILITY_TASK_MIDI_IN,
  STABILITY_TASK_LED_ANIMATE,
  STABILITY_TASK_LED_RENDER,
  STABILITY_TASK_ROTARY_MENU,
  STABILITY_TASK_MENU_REBUILD,
  STABILITY_TASK_DISPLAY,
  STABILITY_TASK_AUTOSAVE,
  STABILITY_TASK_AUDIO_DMA,
  STABILITY_TASK_ENCODER_SCAN,
  STABILITY_TASK_DELEGATED_MIDI,
  STABILITY_TASK_BENCHMARK
};

extern volatile bool stabilityBenchmarkActive;
extern volatile uint8_t stabilityBenchmarkLastTaskCore0;
extern volatile uint8_t stabilityBenchmarkLastTaskCore1;

inline bool stabilityBenchmarkIsActive() {
  return stabilityBenchmarkActive;
}

inline void stabilityBenchmarkSetCore0Task(StabilityBenchmarkTask task) {
  if (stabilityBenchmarkActive) {
    stabilityBenchmarkLastTaskCore0 = static_cast<uint8_t>(task);
  }
}

inline void stabilityBenchmarkSetCore1Task(StabilityBenchmarkTask task) {
  if (stabilityBenchmarkActive) {
    stabilityBenchmarkLastTaskCore1 = static_cast<uint8_t>(task);
  }
}

const char* stabilityBenchmarkTaskName(uint8_t task);
void startStabilityBenchmark();
void requestStopStabilityBenchmark();
void stopStabilityBenchmark();
void serviceStabilityBenchmark();
void handleStabilityBenchmarkEncoder(bool buttonPressed,
                                     bool justPressed,
                                     bool justReleased,
                                     uint64_t nowMicros);
