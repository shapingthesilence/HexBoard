#include "SynthAudioInternal.h"
#include "../sequencer/SequencerMode.h"
#include "../sequencer/SequencerUsbBackup.h"
#include "../storage/PresetSync.h"
#include "../storage/Settings.h"

// Explicit runtime test, never a boot task or a separate firmware variant.
// All scheduling and reporting run on core 0; the real renderer stays on core 1.
namespace {
constexpr uint64_t phaseMicros = 4000000;
constexpr const char* phases[] = {
  "idle", "single", "eight", "release", "retrigger", "steal",
  "mod_sine", "mod_triangle", "mod_saw", "mod_square", "mod_noise", "mod_smooth_noise",
  "amp_attack", "amp_hold", "amp_decay", "amp_sustain", "amp_release"
};
constexpr size_t phaseCount = sizeof(phases) / sizeof(phases[0]);
byte* const controls[] = {
  &synthDrive, &synthModTarget, &synthModAmount, &synthVibratoSpeed,
  &synthLfoTarget, &synthLfoAmount, &synthLfoWave, &synthLfoSpeed, &synthWavetablePosition,
  &envelopeAttackIndex, &envelopeHoldIndex, &envelopeDecayIndex,
  &envelopeSustainLevel, &envelopeReleaseIndex,
  &effectEnvelopeTarget[0], &effectEnvelopeAmount[0], &effectEnvelopeAttackIndex[0],
  &effectEnvelopeHoldIndex[0], &effectEnvelopeDecayIndex[0],
  &effectEnvelopeSustainLevel[0], &effectEnvelopeReleaseIndex[0],
  &effectEnvelopeTarget[1], &effectEnvelopeAmount[1], &effectEnvelopeAttackIndex[1],
  &effectEnvelopeHoldIndex[1], &effectEnvelopeDecayIndex[1],
  &effectEnvelopeSustainLevel[1], &effectEnvelopeReleaseIndex[1]
};
byte savedControls[sizeof(controls) / sizeof(controls[0])] = {};
SynthPreviewNoteHandle notes[12];
bool active = false, savedAutoSave = false, savedProfiling = false;
int savedWheel = 0, savedWheelTarget = 0;
byte savedDestination = AUDIO_NONE;
uint8_t phase = 0, event = 0;
uint64_t phaseStarted = 0, nextEvent = 0;
uint32_t noteFailures = 0, retuneCount = 0, mainLoopPeak = 0;
uint64_t nextRetune = 0;
uint8_t wheelMin = 127, wheelMax = 0;

bool keysDown() {
  for (byte i = 0; i < FIRST_FLAG_BUTTON_INDEX; ++i) {
    if (h[i].btnState == BTN_STATE_NEWPRESS || h[i].btnState == BTN_STATE_HELD) return true;
  }
  return false;
}

bool unavailable() {
  return keysDown() || delegatedControlState.active || sequencerModeActive()
      || sequencer::isUsbBackupActive() || presetSyncWriteTransfer.active
      || presetSyncReadTransfer.active || playbackMode != SYNTH_POLY
      || !synthRuntimeReady.load(std::memory_order_acquire)
      || !audioTransportReady.load(std::memory_order_acquire)
      || synthWaveTableLoadInProgress || flashWriteInProgress.load(std::memory_order_acquire);
}

void releaseNotes() {
  for (auto& note : notes) stopSynthPreviewNote(note);
}

void play(uint8_t index, uint8_t pitch) {
  stopSynthPreviewNote(notes[index]);
  // Fixed 12-EDO pitches deliberately bypass tuning and MIDI transport. This
  // measures DSP/allocator work, not note preparation or external MIDI latency.
  const float frequency = 130.81278265f * powf(2.0f, pitch / 12.0f);
  if (!startSynthPreviewNote(pitch - 12, frequency, 48 + pitch, 100, notes[index])) ++noteFailures;
}

void chord() {
  for (uint8_t i = 0; i < 8; ++i) play(i, i * 4);
}

void refreshControls() {
  updateSynthModulationParams();
  updateEnvelopeParamsFromSettings();
  updateEffectEnvelopeParamsFromSettings();
  refreshVolumeEnvelopeModulation(true);
}

void configurePhase() {
  event = 0; retuneCount = mainLoopPeak = 0; nextRetune = 0;
  wheelMin = 127; wheelMax = 0;
  nextEvent = runTime + 100000;
  if (phase == 3) {
    // Retain the previous eight notes and release all at once.
    releaseNotes();
  } else {
    releaseNotes();
    resetSynthFreqs();
  }
  if (phase >= 6) {
    // Columns: wheel, LFO, envelope 1, envelope 2. Include the specialized
    // per-voice pitch-envelope path as well as every oscillator warp.
    static constexpr byte targets[6][4] = {
      { SYNTH_MOD_TARGET_FOLD_WARP, SYNTH_MOD_TARGET_DUTY_WARP, SYNTH_MOD_TARGET_POLY_WARP, SYNTH_MOD_TARGET_WAVETABLE_POSITION },
      { SYNTH_MOD_TARGET_VIBRATO, SYNTH_MOD_TARGET_PITCH, SYNTH_MOD_TARGET_WAVETABLE_POSITION, SYNTH_MOD_TARGET_FOLD_WARP },
      { SYNTH_MOD_TARGET_PITCH, SYNTH_MOD_TARGET_WAVETABLE_POSITION, SYNTH_MOD_TARGET_DUTY_WARP, SYNTH_MOD_TARGET_POLY_WARP },
      { SYNTH_MOD_TARGET_FOLD_WARP, SYNTH_MOD_TARGET_VIBRATO, SYNTH_MOD_TARGET_PITCH, SYNTH_MOD_TARGET_WAVETABLE_POSITION },
      { SYNTH_MOD_TARGET_DUTY_WARP, SYNTH_MOD_TARGET_POLY_WARP, SYNTH_MOD_TARGET_VIBRATO, SYNTH_MOD_TARGET_PITCH },
      { SYNTH_MOD_TARGET_WAVETABLE_POSITION, SYNTH_MOD_TARGET_FOLD_WARP, SYNTH_MOD_TARGET_PITCH, SYNTH_MOD_TARGET_DUTY_WARP }
    };
    const auto& target = targets[(phase - 6) % 6];
    synthDrive = SYNTH_DRIVE_DIRTY;
    synthModTarget = phase >= 12 ? SYNTH_MOD_TARGET_AMP_ATTACK + phase - 12
      : target[0];
    synthModAmount = phase & 1 ? 254 : 127; // both modulation polarities
    synthVibratoSpeed = phase & 1 ? SYNTH_VIBRATO_SPEED_NOISE : 11;
    synthLfoTarget = target[1];
    synthLfoAmount = 254;
    synthLfoWave = phase < 12 ? phase - 6 : SYNTH_LFO_WAVE_SMOOTH_NOISE;
    synthLfoSpeed = 19;
    synthWavetablePosition = 63;
    effectEnvelopeTarget[0] = target[2];
    effectEnvelopeTarget[1] = target[3];
    for (uint8_t i = 0; i < 2; ++i) {
      effectEnvelopeAmount[i] = i == 0 ? 254 : 0;
      effectEnvelopeAttackIndex[i] = 8;
      effectEnvelopeHoldIndex[i] = 1;
      effectEnvelopeDecayIndex[i] = 10;
      effectEnvelopeSustainLevel[i] = 48;
      effectEnvelopeReleaseIndex[i] = 10;
    }
    envelopeAttackIndex = 1;
    envelopeHoldIndex = 0;
    envelopeDecayIndex = 8;
    envelopeSustainLevel = 100;
    envelopeReleaseIndex = 10;
    refreshControls();
  }
  if (phase == 1) play(0, 12);
  else if (phase == 2 || phase >= 4) chord();
  phaseStarted = runTime;
  readAndResetISRProfile();
  Serial.print("HBAUDIO begin="); Serial.println(phases[phase]);
}

void finish(const char* result) {
  releaseNotes();
  // Do not reset a newly pressed physical note on an interaction abort.
  if (!keysDown()) resetSynthFreqs();
  for (size_t i = 0; i < sizeof(savedControls); ++i) *controls[i] = savedControls[i];
  modWheel.curValue = savedWheel;
  modWheel.targetValue = savedWheelTarget;
  refreshControls();
  audioD = savedDestination;
  autoSave = savedAutoSave;
  active = false;
  resetSerialDebugAudioStats();
  if (savedProfiling) readAndResetISRProfile();
  Serial.print("HBAUDIO result="); Serial.println(result);
}

void reportPhase() {
  readAndResetISRProfile();
  char line[320];
  snprintf(line, sizeof(line),
    "HBAUDIO phase=%s blocks=%lu avg_us=%lu max_us=%lu budget_us=%lu underruns=%lu overruns=%lu voices_at_peak=%u release_starts=%lu note_failures=%lu wheel_span=%u fx_active=%u lfo_wave=%u retunes=%lu main_us=%lu",
    phases[phase], static_cast<unsigned long>(isrProfileCount),
    static_cast<unsigned long>(isrProfileAvgUs), static_cast<unsigned long>(isrProfileMaxUs),
    static_cast<unsigned long>(isrProfileAvailableUs), static_cast<unsigned long>(isrProfileDmaUnderrunCount),
    static_cast<unsigned long>(isrProfileOverrunCount), isrProfileMaxVoices,
    static_cast<unsigned long>(isrProfileReleaseStartCount), static_cast<unsigned long>(noteFailures),
    wheelMax >= wheelMin ? wheelMax - wheelMin : 0,
    (synthEffectEnvelopeActive[0] ? 1 : 0) | (synthEffectEnvelopeActive[1] ? 2 : 0), synthLfoWave, static_cast<unsigned long>(retuneCount), static_cast<unsigned long>(mainLoopPeak));
  Serial.println(line);
}
} // namespace

bool synthPerformanceTestActive() { return active; }

void startSynthPerformanceTest(bool piezo) {
  if (active) { Serial.println("HBAUDIO error=already_running"); return; }
  if (unavailable() || velWheel.curValue == 0) {
    Serial.println("HBAUDIO error=requires_idle_poly_runtime_and_nonzero_volume"); return;
  }
  // Also refuse outstanding preview notes or release tails owned by a player.
  for (byte i = 0; i < BTN_COUNT; ++i) {
    if (h[i].synthCh) { Serial.println("HBAUDIO error=voices_busy"); return; }
  }
  for (size_t i = 0; i < sizeof(savedControls); ++i) savedControls[i] = *controls[i];
  savedDestination = audioD;
  if (piezo) audioD = AUDIO_PIEZO;
  savedAutoSave = autoSave; autoSave = false;
  savedProfiling = isrProfilingEnabled;
  savedWheel = modWheel.curValue; savedWheelTarget = modWheel.targetValue;
  noteFailures = 0; phase = 0; active = true;
  Serial.print("HBAUDIO version=1 phases=17 phase_ms=4000 frames=");
  Serial.print(activeSynthWaveFrameCount);
  Serial.print(" sampler="); Serial.print(compactSamplerActive() ? 1 : 0);
  Serial.print(" sampler_expression="); Serial.print(compactSamplerActive() ? 1 : 0);
  Serial.print(" destination="); Serial.print(audioD);
  Serial.print(" clock_hz="); Serial.println(HEXBOARD_SYSTEM_CLOCK_HZ);
  configurePhase();
}

void stopSynthPerformanceTest() { if (active) finish("cancelled"); }

void serviceSynthPerformanceTest() {
  if (!active) return;
  if (unavailable() || !isrProfilingEnabled) { finish("interrupted"); return; }
  mainLoopPeak = std::max<uint32_t>(mainLoopPeak, std::min<uint64_t>(UINT32_MAX, lapTime));
  if (runTime - phaseStarted >= phaseMicros) {
    reportPhase();
    if (++phase == phaseCount) { finish("complete"); return; }
    configurePhase();
  }
  if (phase >= 6) {
    // A continuous triangle sweep prevents the wheel and pitch/warp slews from
    // settling into their cheap steady-state paths. Normal wheel servicing
    // continues later in the main loop, including its existing MIDI behavior.
    const uint32_t position = ((runTime - phaseStarted) / 4000) % 254;
    modWheel.curValue = position <= 127 ? position : 254 - position;
    modWheel.targetValue = modWheel.curValue;
    if (modWheel.curValue < wheelMin) wheelMin = modWheel.curValue;
    if (modWheel.curValue > wheelMax) wheelMax = modWheel.curValue;
  }
  if (phase >= 6 && compactSamplerActive() && runTime >= nextRetune) {
    nextRetune = runTime + 10000; // 100 Hz expression, outside the audio core.
    const float bend = 2.0f * (modWheel.curValue / 63.5f - 1.0f);
    for (unsigned i = 0; i < 12; ++i) {
      if (!notes[i].active || notes[i].slot < 0) continue;
      const auto& key = h[notes[i].slot];
      if (!key.synthCh) continue;
      const float cents = (i & 1) ? .18f : -.18f;
      setSynthFreq(key.frequency * powf(2.f, (bend + cents) / 12.f), key.synthCh);
      ++retuneCount;
    }
  }
  if (runTime < nextEvent) return;
  nextEvent = runTime + 100000; // at most one bounded event per main-loop visit
  ++event;
  if (phase == 4 || phase >= 6) {
    if (event % 4 == 0) releaseNotes();
    if (event % 4 == 1) chord();
  } else if (phase == 5) {
    // Twelve logical owners compete for eight physical voices.
    play(event % 12, (event * 7) % 48);
  }
}
