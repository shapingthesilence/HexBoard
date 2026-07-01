#include "../FirmwareModule.h"
#include "DiagnosticsTiming.h"
#include "PlatformCommon.h"
#include "RuntimeDefaults.h"
#include "StabilityBenchmark.h"
#include "../hardware/GridState.h"
#include "../hardware/LedRender.h"
#include "../menu/MenuAndDisplay.h"
#include "../menu/PlayedNotesOverlay.h"
#include "../midi/NoteDispatch.h"
#include "../synth/SynthAudio.h"

volatile bool stabilityBenchmarkActive = false;
volatile uint8_t stabilityBenchmarkLastTaskCore0 = STABILITY_TASK_IDLE;
volatile uint8_t stabilityBenchmarkLastTaskCore1 = STABILITY_TASK_IDLE;

namespace {
constexpr uint8_t BENCHMARK_HELD_NOTE_COUNT = POLYPHONY_LIMIT;
constexpr uint8_t BENCHMARK_NOTE_POOL_COUNT = POLYPHONY_LIMIT + 6;
constexpr uint64_t BENCHMARK_VOICE_STEAL_INTERVAL_MICROS = 50000ULL;
constexpr uint64_t BENCHMARK_MOD_INTERVAL_MICROS = 32000ULL;
constexpr uint64_t BENCHMARK_PITCH_BEND_INTERVAL_MICROS = 128000ULL;
constexpr uint64_t BENCHMARK_DISPLAY_INTERVAL_MICROS = 500000ULL;
constexpr uint64_t BENCHMARK_LOG_INTERVAL_MICROS = 2000000ULL;
constexpr float BENCHMARK_MIN_NOTE_HZ = 1500.0f;
constexpr float BENCHMARK_MAX_NOTE_HZ = 10000.0f;

struct StabilityBenchmarkSavedRuntime {
  bool valid = false;
  byte playbackMode = SYNTH_POLY;
  byte currWave = WAVEFORM_BASIC_WAVETABLE;
  bool synthBuzzerEnabled = false;
  byte synthDrive = SYNTH_DRIVE_OFF;
  byte synthModTarget = SYNTH_MOD_TARGET_FOLD_WARP;
  byte synthModAmount = SYNTH_MOD_AMOUNT_FULL;
  byte synthVibratoSpeed = SYNTH_VIBRATO_SPEED_DEFAULT;
  byte synthWavetablePosition = SYNTH_WAVETABLE_POSITION_DEFAULT;
  byte synthLfoTarget = SYNTH_MOD_TARGET_FOLD_WARP;
  byte synthLfoAmount = SYNTH_FX_AMOUNT_OFF;
  byte synthLfoWave = SYNTH_LFO_WAVE_SINE;
  byte synthLfoSpeed = SYNTH_LFO_SPEED_DEFAULT;
  uint8_t synthPortamentoTimeIndex = 0;
  uint8_t envelopeAttackIndex = 0;
  uint8_t envelopeHoldIndex = 0;
  uint8_t envelopeDecayIndex = 0;
  uint8_t envelopeSustainLevel = 0;
  uint8_t envelopeReleaseIndex = 0;
  std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeTarget = {};
  std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeAmount = {};
  std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeAttackIndex = {};
  std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeHoldIndex = {};
  std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeDecayIndex = {};
  std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeSustainLevel = {};
  std::array<uint8_t, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeReleaseIndex = {};
  byte synthBPM = 120;
  byte arpeggiatorDivision = 32;
  byte arpeggiatorDirection = ARP_DIRECTION_UP;
  byte metronomeMode = METRONOME_MODE_OFF;
  byte metronomeSignatureIndex = 0;
  byte colorMode = RAINBOW_MODE;
  byte animationType = ANIMATE_BUTTON;
  byte ledTestMode = LED_TEST_OFF;
  int16_t modWheelCur = 0;
  int16_t modWheelTarget = 0;
  int16_t pbWheelCur = 0;
  int16_t pbWheelTarget = 0;
  int16_t velWheelCur = 96;
  int16_t velWheelTarget = 96;
};

StabilityBenchmarkSavedRuntime savedRuntime;
byte benchmarkHeldNotes[BENCHMARK_HELD_NOTE_COUNT] = {};
byte benchmarkNotePool[BENCHMARK_NOTE_POOL_COUNT] = {};
uint8_t benchmarkNotePoolCount = 0;
uint8_t benchmarkNextPoolIndex = 0;
uint32_t benchmarkVoiceStealCount = 0;
uint32_t benchmarkNoteEventCount = 0;
uint32_t benchmarkModSweepCount = 0;
uint32_t benchmarkReportCount = 0;
uint32_t benchmarkLoopCount = 0;
uint32_t benchmarkMaxLoopMicros = 0;
uint32_t benchmarkStartFreeHeap = 0;
uint32_t benchmarkMinFreeHeap = 0;
uint64_t benchmarkStartMicros = 0;
uint64_t benchmarkLastVoiceStealMicros = 0;
uint64_t benchmarkLastModMicros = 0;
uint64_t benchmarkLastPitchBendMicros = 0;
uint64_t benchmarkLastDisplayMicros = 0;
uint64_t benchmarkLastLogMicros = 0;
uint64_t benchmarkEncoderHoldStartMicros = 0;
bool benchmarkEncoderHoldLatched = false;
bool benchmarkStopRequested = false;
bool benchmarkModHigh = true;
bool benchmarkPitchBendHigh = true;
bool benchmarkSerialReportEnabled = false;

void updateMinFreeHeap() {
  uint32_t freeHeap = readRuntimeFreeHeapBytes();
  if (freeHeap == 0) {
    return;
  }
  if (benchmarkMinFreeHeap == 0 || freeHeap < benchmarkMinFreeHeap) {
    benchmarkMinFreeHeap = freeHeap;
  }
}

bool noteIsHeld(byte note) {
  for (byte held : benchmarkHeldNotes) {
    if (held == note) {
      return true;
    }
  }
  return false;
}

bool noteIsInPool(byte note) {
  for (uint8_t i = 0; i < benchmarkNotePoolCount; ++i) {
    if (benchmarkNotePool[i] == note) {
      return true;
    }
  }
  return false;
}

bool playableBenchmarkHex(byte index, bool enforceHighRange) {
  if (index >= LED_COUNT || h[index].isCmd || h[index].note >= 128 || h[index].frequency <= 0.0f) {
    return false;
  }
  if (!enforceHighRange) {
    return true;
  }
  return h[index].frequency >= BENCHMARK_MIN_NOTE_HZ && h[index].frequency <= BENCHMARK_MAX_NOTE_HZ;
}

byte findNextBenchmarkHex(bool enforceHighRange) {
  byte bestIndex = UNUSED_NOTE;
  float bestFrequency = -1.0f;
  for (byte i = 0; i < LED_COUNT; ++i) {
    if (!playableBenchmarkHex(i, enforceHighRange) || noteIsInPool(i)) {
      continue;
    }
    if (h[i].frequency > bestFrequency) {
      bestFrequency = h[i].frequency;
      bestIndex = i;
    }
  }
  return bestIndex;
}

void buildBenchmarkNotePool() {
  benchmarkNotePoolCount = 0;
  for (byte& note : benchmarkNotePool) {
    note = UNUSED_NOTE;
  }
  while (benchmarkNotePoolCount < BENCHMARK_NOTE_POOL_COUNT) {
    byte note = findNextBenchmarkHex(true);
    if (note == UNUSED_NOTE) {
      break;
    }
    benchmarkNotePool[benchmarkNotePoolCount++] = note;
  }
  while (benchmarkNotePoolCount < BENCHMARK_NOTE_POOL_COUNT) {
    byte note = findNextBenchmarkHex(false);
    if (note == UNUSED_NOTE) {
      break;
    }
    benchmarkNotePool[benchmarkNotePoolCount++] = note;
  }
}

byte nextUnheldBenchmarkNote() {
  if (benchmarkNotePoolCount == 0) {
    return UNUSED_NOTE;
  }
  for (uint8_t attempts = 0; attempts < benchmarkNotePoolCount; ++attempts) {
    byte note = benchmarkNotePool[benchmarkNextPoolIndex];
    benchmarkNextPoolIndex = static_cast<uint8_t>((benchmarkNextPoolIndex + 1) % benchmarkNotePoolCount);
    if (!noteIsHeld(note)) {
      return note;
    }
  }
  return UNUSED_NOTE;
}

void benchmarkNoteOn(byte note) {
  if (note == UNUSED_NOTE || note >= LED_COUNT) {
    return;
  }
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_NOTE_ON);
  h[note].timePressed = runTime;
  tryMIDInoteOn(note);
  trySynthNoteOn(note);
  ++benchmarkNoteEventCount;
}

void benchmarkNoteOff(byte note) {
  if (note == UNUSED_NOTE || note >= LED_COUNT) {
    return;
  }
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_NOTE_OFF);
  tryMIDInoteOff(note);
  trySynthNoteOff(note);
  h[note].timePressed = 0;
  h[note].animate = false;
  ++benchmarkNoteEventCount;
}

void saveRuntimeState() {
  savedRuntime.valid = true;
  savedRuntime.playbackMode = playbackMode;
  savedRuntime.currWave = currWave;
  savedRuntime.synthBuzzerEnabled = synthBuzzerEnabled;
  savedRuntime.synthDrive = synthDrive;
  savedRuntime.synthModTarget = synthModTarget;
  savedRuntime.synthModAmount = synthModAmount;
  savedRuntime.synthVibratoSpeed = synthVibratoSpeed;
  savedRuntime.synthWavetablePosition = synthWavetablePosition;
  savedRuntime.synthLfoTarget = synthLfoTarget;
  savedRuntime.synthLfoAmount = synthLfoAmount;
  savedRuntime.synthLfoWave = synthLfoWave;
  savedRuntime.synthLfoSpeed = synthLfoSpeed;
  savedRuntime.synthPortamentoTimeIndex = synthPortamentoTimeIndex;
  savedRuntime.envelopeAttackIndex = envelopeAttackIndex;
  savedRuntime.envelopeHoldIndex = envelopeHoldIndex;
  savedRuntime.envelopeDecayIndex = envelopeDecayIndex;
  savedRuntime.envelopeSustainLevel = envelopeSustainLevel;
  savedRuntime.envelopeReleaseIndex = envelopeReleaseIndex;
  savedRuntime.effectEnvelopeTarget = effectEnvelopeTarget;
  savedRuntime.effectEnvelopeAmount = effectEnvelopeAmount;
  savedRuntime.effectEnvelopeAttackIndex = effectEnvelopeAttackIndex;
  savedRuntime.effectEnvelopeHoldIndex = effectEnvelopeHoldIndex;
  savedRuntime.effectEnvelopeDecayIndex = effectEnvelopeDecayIndex;
  savedRuntime.effectEnvelopeSustainLevel = effectEnvelopeSustainLevel;
  savedRuntime.effectEnvelopeReleaseIndex = effectEnvelopeReleaseIndex;
  savedRuntime.synthBPM = synthBPM;
  savedRuntime.arpeggiatorDivision = arpeggiatorDivision;
  savedRuntime.arpeggiatorDirection = arpeggiatorDirection;
  savedRuntime.metronomeMode = metronomeMode;
  savedRuntime.metronomeSignatureIndex = metronomeSignatureIndex;
  savedRuntime.colorMode = colorMode;
  savedRuntime.animationType = animationType;
  savedRuntime.ledTestMode = ledTestMode;
  savedRuntime.modWheelCur = modWheel.curValue;
  savedRuntime.modWheelTarget = modWheel.targetValue;
  savedRuntime.pbWheelCur = pbWheel.curValue;
  savedRuntime.pbWheelTarget = pbWheel.targetValue;
  savedRuntime.velWheelCur = velWheel.curValue;
  savedRuntime.velWheelTarget = velWheel.targetValue;
}

void applyBenchmarkPatch() {
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_PATCH);
  playbackMode = SYNTH_POLY;
  currWave = WAVEFORM_BASIC_WAVETABLE;
  synthBuzzerEnabled = savedRuntime.synthBuzzerEnabled;
  syncAudioDestinationToRuntime();
  synthDrive = SYNTH_DRIVE_DIRTY;
  synthModTarget = SYNTH_MOD_TARGET_POLY_WARP;
  synthModAmount = SYNTH_MOD_AMOUNT_FULL;
  synthVibratoSpeed = 11;
  synthWavetablePosition = 64;
  synthLfoTarget = SYNTH_MOD_TARGET_DUTY_WARP;
  synthLfoAmount = SYNTH_FX_AMOUNT_FULL;
  synthLfoWave = SYNTH_LFO_WAVE_SQUARE;
  synthLfoSpeed = 19;
  synthPortamentoTimeIndex = 6;

  envelopeAttackIndex = 1;
  envelopeHoldIndex = 0;
  envelopeDecayIndex = 1;
  envelopeSustainLevel = 127;
  envelopeReleaseIndex = 8;

  effectEnvelopeTarget[0] = SYNTH_MOD_TARGET_FOLD_WARP;
  effectEnvelopeAmount[0] = SYNTH_FX_AMOUNT_FULL;
  effectEnvelopeAttackIndex[0] = 1;
  effectEnvelopeHoldIndex[0] = 6;
  effectEnvelopeDecayIndex[0] = 0;
  effectEnvelopeSustainLevel[0] = 127;
  effectEnvelopeReleaseIndex[0] = 8;

  effectEnvelopeTarget[1] = SYNTH_MOD_TARGET_VIBRATO;
  effectEnvelopeAmount[1] = SYNTH_FX_AMOUNT_FULL;
  effectEnvelopeAttackIndex[1] = 1;
  effectEnvelopeHoldIndex[1] = 6;
  effectEnvelopeDecayIndex[1] = 0;
  effectEnvelopeSustainLevel[1] = 127;
  effectEnvelopeReleaseIndex[1] = 8;

  synthBPM = 240;
  arpeggiatorDivision = 32;
  arpeggiatorDirection = ARP_DIRECTION_RANDOM;
  metronomeMode = METRONOME_MODE_BEEP;
  metronomeSignatureIndex = 0;
  animationType = ANIMATE_BEAMS;
  ledTestMode = LED_TEST_OFF;

  modWheel.curValue = 127;
  modWheel.targetValue = 127;
  pbWheel.curValue = 0;
  pbWheel.targetValue = 0;
  velWheel.curValue = 127;
  velWheel.targetValue = 127;

  updateSynthModulationParams();
  updateSynthPortamentoSettings();
  updateEnvelopeParamsFromSettings();
  updateEffectEnvelopeParamsFromSettings();
  updateArpeggiatorDirection();
  updateArpeggiatorTiming();
  updateMetronomeTiming();
  recomputePitchBendFactor();
  resetSynthRenderCaches();
  resetSynthFreqs();
  setLEDcolorCodes();
}

void restoreRuntimeState() {
  if (!savedRuntime.valid) {
    return;
  }
  playbackMode = savedRuntime.playbackMode;
  currWave = savedRuntime.currWave;
  synthBuzzerEnabled = savedRuntime.synthBuzzerEnabled;
  syncAudioDestinationToRuntime();
  synthDrive = savedRuntime.synthDrive;
  synthModTarget = savedRuntime.synthModTarget;
  synthModAmount = savedRuntime.synthModAmount;
  synthVibratoSpeed = savedRuntime.synthVibratoSpeed;
  synthWavetablePosition = savedRuntime.synthWavetablePosition;
  synthLfoTarget = savedRuntime.synthLfoTarget;
  synthLfoAmount = savedRuntime.synthLfoAmount;
  synthLfoWave = savedRuntime.synthLfoWave;
  synthLfoSpeed = savedRuntime.synthLfoSpeed;
  synthPortamentoTimeIndex = savedRuntime.synthPortamentoTimeIndex;
  envelopeAttackIndex = savedRuntime.envelopeAttackIndex;
  envelopeHoldIndex = savedRuntime.envelopeHoldIndex;
  envelopeDecayIndex = savedRuntime.envelopeDecayIndex;
  envelopeSustainLevel = savedRuntime.envelopeSustainLevel;
  envelopeReleaseIndex = savedRuntime.envelopeReleaseIndex;
  effectEnvelopeTarget = savedRuntime.effectEnvelopeTarget;
  effectEnvelopeAmount = savedRuntime.effectEnvelopeAmount;
  effectEnvelopeAttackIndex = savedRuntime.effectEnvelopeAttackIndex;
  effectEnvelopeHoldIndex = savedRuntime.effectEnvelopeHoldIndex;
  effectEnvelopeDecayIndex = savedRuntime.effectEnvelopeDecayIndex;
  effectEnvelopeSustainLevel = savedRuntime.effectEnvelopeSustainLevel;
  effectEnvelopeReleaseIndex = savedRuntime.effectEnvelopeReleaseIndex;
  synthBPM = savedRuntime.synthBPM;
  arpeggiatorDivision = savedRuntime.arpeggiatorDivision;
  arpeggiatorDirection = savedRuntime.arpeggiatorDirection;
  metronomeMode = savedRuntime.metronomeMode;
  metronomeSignatureIndex = savedRuntime.metronomeSignatureIndex;
  colorMode = savedRuntime.colorMode;
  animationType = savedRuntime.animationType;
  ledTestMode = savedRuntime.ledTestMode;
  modWheel.curValue = savedRuntime.modWheelCur;
  modWheel.targetValue = savedRuntime.modWheelTarget;
  pbWheel.curValue = savedRuntime.pbWheelCur;
  pbWheel.targetValue = savedRuntime.pbWheelTarget;
  velWheel.curValue = savedRuntime.velWheelCur;
  velWheel.targetValue = savedRuntime.velWheelTarget;

  updateSynthModulationParams();
  updateSynthPortamentoSettings();
  updateEnvelopeParamsFromSettings();
  updateEffectEnvelopeParamsFromSettings();
  updateArpeggiatorDirection();
  updateArpeggiatorTiming();
  updateMetronomeTiming();
  recomputePitchBendFactor();
  resetSynthRenderCaches();
  resetSynthFreqs();
  setLEDcolorCodes();
  savedRuntime.valid = false;
}

void drawBenchmarkScreen(bool stopped) {
  wakeDisplayFromScreensaver();
  screenTime = 0;

  uint64_t elapsedSeconds = (runTime > benchmarkStartMicros)
                              ? ((runTime - benchmarkStartMicros) / 1000000ULL)
                              : 0;
  char line[28];
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x13_tf);
  u8g2.drawStr(0, 12, stopped ? "Stability Done" : "Stability Test");
  snprintf(line, sizeof(line), "Time:%lus", static_cast<unsigned long>(elapsedSeconds));
  u8g2.drawStr(0, 28, line);
  snprintf(line, sizeof(line), "C0:%s", stabilityBenchmarkTaskName(stabilityBenchmarkLastTaskCore0));
  u8g2.drawStr(0, 44, line);
  snprintf(line, sizeof(line), "C1:%s", stabilityBenchmarkTaskName(stabilityBenchmarkLastTaskCore1));
  u8g2.drawStr(0, 60, line);
  snprintf(line, sizeof(line), "Und:%lu Ov:%lu",
           static_cast<unsigned long>(stopped ? isrProfileDmaUnderrunCount : audioDmaUnderrunCount),
           static_cast<unsigned long>(stopped ? isrProfileOverrunCount : isrCycleOverrunCount));
  u8g2.drawStr(0, 76, line);
  snprintf(line, sizeof(line), "HeapMin:%lu", static_cast<unsigned long>(benchmarkMinFreeHeap));
  u8g2.drawStr(0, 92, line);
  snprintf(line, sizeof(line), "AudMax:%luus",
           static_cast<unsigned long>(stopped ? isrProfileMaxUs : isrCycleMax));
  u8g2.drawStr(0, 108, line);
  snprintf(line, sizeof(line), "%s", stopped ? "Hold exit done" : "Hold enc 5s exit");
  u8g2.drawStr(0, 124, line);
  u8g2.sendBuffer();
}

void logBenchmarkSummary(const char* state) {
  if (!benchmarkSerialReportEnabled) {
    return;
  }
  char line[220];
  uint64_t elapsedSeconds = (runTime > benchmarkStartMicros)
                              ? ((runTime - benchmarkStartMicros) / 1000000ULL)
                              : 0;
  snprintf(line,
           sizeof(line),
           "Stability benchmark %s: time=%lus heap start/min=%lu/%lu audio min/avg/max/count=%lu/%lu/%lu/%lu us underruns=%lu overruns=%lu maxVoices=%u noteEvents=%lu voiceSteals=%lu maxLoop=%luus C0=%s C1=%s",
           state,
           static_cast<unsigned long>(elapsedSeconds),
           static_cast<unsigned long>(benchmarkStartFreeHeap),
           static_cast<unsigned long>(benchmarkMinFreeHeap),
           static_cast<unsigned long>(isrProfileMinUs),
           static_cast<unsigned long>(isrProfileAvgUs),
           static_cast<unsigned long>(isrProfileMaxUs),
           static_cast<unsigned long>(isrProfileCount),
           static_cast<unsigned long>(isrProfileDmaUnderrunCount),
           static_cast<unsigned long>(isrProfileOverrunCount),
           static_cast<unsigned int>(isrProfileMaxVoices),
           static_cast<unsigned long>(benchmarkNoteEventCount),
           static_cast<unsigned long>(benchmarkVoiceStealCount),
           static_cast<unsigned long>(benchmarkMaxLoopMicros),
           stabilityBenchmarkTaskName(stabilityBenchmarkLastTaskCore0),
           stabilityBenchmarkTaskName(stabilityBenchmarkLastTaskCore1));
  Serial.println(line);
}

void logBenchmarkLiveStatus() {
  if (!benchmarkSerialReportEnabled) {
    return;
  }
  char line[180];
  uint64_t elapsedSeconds = (runTime > benchmarkStartMicros)
                              ? ((runTime - benchmarkStartMicros) / 1000000ULL)
                              : 0;
  snprintf(line,
           sizeof(line),
           "Stability benchmark live: time=%lus heapMin=%lu underruns=%lu overruns=%lu audioMax=%luus voiceSteals=%lu C0=%s C1=%s",
           static_cast<unsigned long>(elapsedSeconds),
           static_cast<unsigned long>(benchmarkMinFreeHeap),
           static_cast<unsigned long>(audioDmaUnderrunCount),
           static_cast<unsigned long>(isrCycleOverrunCount),
           static_cast<unsigned long>(isrCycleMax),
           static_cast<unsigned long>(benchmarkVoiceStealCount),
           stabilityBenchmarkTaskName(stabilityBenchmarkLastTaskCore0),
           stabilityBenchmarkTaskName(stabilityBenchmarkLastTaskCore1));
  Serial.println(line);
}

void startHeldBenchmarkNotes() {
  for (byte& note : benchmarkHeldNotes) {
    note = UNUSED_NOTE;
  }
  uint8_t notesToStart = std::min<uint8_t>(BENCHMARK_HELD_NOTE_COUNT, benchmarkNotePoolCount);
  for (uint8_t i = 0; i < notesToStart; ++i) {
    byte note = benchmarkNotePool[i];
    benchmarkHeldNotes[i] = note;
    benchmarkNoteOn(note);
  }
  benchmarkNextPoolIndex = notesToStart % std::max<uint8_t>(benchmarkNotePoolCount, 1);
}

void releaseBenchmarkNotes() {
  for (byte& note : benchmarkHeldNotes) {
    benchmarkNoteOff(note);
    note = UNUSED_NOTE;
  }
  for (uint8_t i = 0; i < benchmarkNotePoolCount; ++i) {
    benchmarkNoteOff(benchmarkNotePool[i]);
  }
}

void runVoiceStealStep() {
  if (benchmarkNotePoolCount <= BENCHMARK_HELD_NOTE_COUNT) {
    return;
  }
  byte nextNote = nextUnheldBenchmarkNote();
  if (nextNote == UNUSED_NOTE) {
    return;
  }
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_VOICE_STEAL);
  uint8_t slot = static_cast<uint8_t>(benchmarkVoiceStealCount % BENCHMARK_HELD_NOTE_COUNT);
  byte oldNote = benchmarkHeldNotes[slot];
  benchmarkNoteOn(nextNote);
  benchmarkNoteOff(oldNote);
  benchmarkHeldNotes[slot] = nextNote;
  ++benchmarkVoiceStealCount;
}

void runModulationSweepStep() {
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_MOD_SWEEP);
  benchmarkModHigh = !benchmarkModHigh;
  modWheel.curValue = benchmarkModHigh ? 127 : 0;
  modWheel.targetValue = modWheel.curValue;
  velWheel.curValue = 127;
  velWheel.targetValue = 127;
  ++benchmarkModSweepCount;
}

void runPitchBendStep() {
  benchmarkPitchBendHigh = !benchmarkPitchBendHigh;
  pbWheel.curValue = benchmarkPitchBendHigh ? 4096 : -4096;
  pbWheel.targetValue = pbWheel.curValue;
  updateSynthWithNewFreqs();
}
}  // namespace

const char* stabilityBenchmarkTaskName(uint8_t task) {
  switch (task) {
    case STABILITY_TASK_START: return "Start";
    case STABILITY_TASK_PATCH: return "Patch";
    case STABILITY_TASK_NOTE_ON: return "NoteOn";
    case STABILITY_TASK_VOICE_STEAL: return "Steal";
    case STABILITY_TASK_NOTE_OFF: return "NoteOff";
    case STABILITY_TASK_MOD_SWEEP: return "Mod";
    case STABILITY_TASK_REPORT: return "Report";
    case STABILITY_TASK_STOP: return "Stop";
    case STABILITY_TASK_PRESET_SYNC: return "Sync";
    case STABILITY_TASK_PRESET_TRANSFER: return "Transfer";
    case STABILITY_TASK_ENVELOPE_RELEASE: return "EnvRel";
    case STABILITY_TASK_BUTTON_SCAN: return "Buttons";
    case STABILITY_TASK_ARPEGGIATOR: return "Arp";
    case STABILITY_TASK_METRONOME: return "Metro";
    case STABILITY_TASK_WHEELS: return "Wheels";
    case STABILITY_TASK_MIDI_IN: return "MidiIn";
    case STABILITY_TASK_LED_ANIMATE: return "LedAnim";
    case STABILITY_TASK_LED_RENDER: return "LedShow";
    case STABILITY_TASK_ROTARY_MENU: return "Rotary";
    case STABILITY_TASK_MENU_REBUILD: return "MenuReb";
    case STABILITY_TASK_DISPLAY: return "Display";
    case STABILITY_TASK_AUTOSAVE: return "AutoSave";
    case STABILITY_TASK_AUDIO_DMA: return "AudioDma";
    case STABILITY_TASK_ENCODER_SCAN: return "EncScan";
    case STABILITY_TASK_DELEGATED_MIDI: return "DelMidi";
    case STABILITY_TASK_BENCHMARK: return "Bench";
    case STABILITY_TASK_IDLE:
    default:
      return "Idle";
  }
}

void startStabilityBenchmark() {
  if (stabilityBenchmarkActive) {
    return;
  }

  saveRuntimeState();
  benchmarkSerialReportEnabled = serialDebugEnabled;
  setSerialDebugGeneralSuppressed(true);
  setSerialDebugPeriodicSuppressed(true);
  benchmarkStopRequested = false;
  benchmarkEncoderHoldStartMicros = 0;
  benchmarkEncoderHoldLatched = false;
  benchmarkVoiceStealCount = 0;
  benchmarkNoteEventCount = 0;
  benchmarkModSweepCount = 0;
  benchmarkReportCount = 0;
  benchmarkLoopCount = 0;
  benchmarkMaxLoopMicros = 0;
  benchmarkStartMicros = runTime;
  benchmarkLastVoiceStealMicros = runTime;
  benchmarkLastModMicros = runTime;
  benchmarkLastPitchBendMicros = runTime;
  benchmarkLastDisplayMicros = 0;
  benchmarkLastLogMicros = runTime;
  benchmarkModHigh = true;
  benchmarkPitchBendHigh = true;
  stabilityBenchmarkLastTaskCore0 = STABILITY_TASK_START;
  stabilityBenchmarkLastTaskCore1 = STABILITY_TASK_IDLE;
  stabilityBenchmarkActive = true;

  panicStopOutput();
  applyBenchmarkPatch();
  buildBenchmarkNotePool();
  startISRProfileCapture();
  benchmarkStartFreeHeap = readRuntimeFreeHeapBytes();
  benchmarkMinFreeHeap = benchmarkStartFreeHeap;
  startHeldBenchmarkNotes();
  updateMinFreeHeap();
  drawBenchmarkScreen(false);
  if (benchmarkSerialReportEnabled) {
    Serial.println("Stability benchmark started. Hold encoder for 5 seconds to exit.");
  }
}

void requestStopStabilityBenchmark() {
  if (stabilityBenchmarkActive) {
    benchmarkStopRequested = true;
  }
}

void stopStabilityBenchmark() {
  if (!stabilityBenchmarkActive) {
    return;
  }
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_STOP);
  releaseBenchmarkNotes();
  stopISRProfileCaptureAndLog();
  updateMinFreeHeap();
  panicStopOutput();
  restoreRuntimeState();
  benchmarkStopRequested = false;
  benchmarkEncoderHoldStartMicros = 0;
  benchmarkEncoderHoldLatched = false;
  stabilityBenchmarkActive = false;
  menuHome();
  drawBenchmarkScreen(true);
  logBenchmarkSummary("stopped");
  benchmarkSerialReportEnabled = false;
  setSerialDebugPeriodicSuppressed(false);
  setSerialDebugGeneralSuppressed(false);
  stabilityBenchmarkLastTaskCore0 = STABILITY_TASK_IDLE;
  stabilityBenchmarkLastTaskCore1 = STABILITY_TASK_IDLE;
}

void serviceStabilityBenchmark() {
  if (!stabilityBenchmarkActive) {
    return;
  }
  stabilityBenchmarkSetCore0Task(STABILITY_TASK_BENCHMARK);
  ++benchmarkLoopCount;
  if (lapTime > benchmarkMaxLoopMicros) {
    benchmarkMaxLoopMicros = static_cast<uint32_t>(std::min<uint64_t>(lapTime, UINT32_MAX));
  }
  updateMinFreeHeap();

  if (benchmarkStopRequested) {
    stopStabilityBenchmark();
    return;
  }

  uint64_t now = runTime;
  if ((now - benchmarkLastModMicros) >= BENCHMARK_MOD_INTERVAL_MICROS) {
    benchmarkLastModMicros = now;
    runModulationSweepStep();
  }
  if ((now - benchmarkLastPitchBendMicros) >= BENCHMARK_PITCH_BEND_INTERVAL_MICROS) {
    benchmarkLastPitchBendMicros = now;
    runPitchBendStep();
  }
  if ((now - benchmarkLastVoiceStealMicros) >= BENCHMARK_VOICE_STEAL_INTERVAL_MICROS) {
    benchmarkLastVoiceStealMicros = now;
    runVoiceStealStep();
  }
  if (benchmarkLastDisplayMicros == 0 || (now - benchmarkLastDisplayMicros) >= BENCHMARK_DISPLAY_INTERVAL_MICROS) {
    stabilityBenchmarkSetCore0Task(STABILITY_TASK_REPORT);
    benchmarkLastDisplayMicros = now;
    ++benchmarkReportCount;
    drawBenchmarkScreen(false);
  }
  if ((now - benchmarkLastLogMicros) >= BENCHMARK_LOG_INTERVAL_MICROS) {
    benchmarkLastLogMicros = now;
    logBenchmarkLiveStatus();
  }
}

void handleStabilityBenchmarkEncoder(bool buttonPressed,
                                     bool justPressed,
                                     bool justReleased,
                                     uint64_t nowMicros) {
  if (!stabilityBenchmarkActive) {
    return;
  }
  if (justPressed) {
    benchmarkEncoderHoldStartMicros = nowMicros;
    benchmarkEncoderHoldLatched = false;
  } else if (buttonPressed
             && benchmarkEncoderHoldStartMicros != 0
             && !benchmarkEncoderHoldLatched
             && (nowMicros - benchmarkEncoderHoldStartMicros) >= STABILITY_BENCHMARK_EXIT_HOLD_MICROS) {
    benchmarkEncoderHoldLatched = true;
    requestStopStabilityBenchmark();
  }
  if (justReleased || !buttonPressed) {
    benchmarkEncoderHoldStartMicros = 0;
    benchmarkEncoderHoldLatched = false;
  }
}
