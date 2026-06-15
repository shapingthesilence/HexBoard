#include "../FirmwareModule.h"
#include "BuiltinWavetables.h"
#include "SynthAudio.h"
#include "../app/DiagnosticsTiming.h"
#include "../app/PlatformCommon.h"
#include "../app/RuntimeDefaults.h"
#include "../hardware/GridState.h"
#include "../hardware/HardwareConfig.h"
#include "../hardware/LedRender.h"
#include "../midi/MidiRouting.h"
#include "../midi/MidiTransport.h"
#include "../storage/SynthWavetableStorage.h"
#include "../tuning/DynamicJustIntonation.h"
#include "SynthDefaults.h"

// @synth
/*
    This section of the code handles audio
    output via the piezo buzzer and/or the
    headphone jack (on hardware v1.2 only)
  */
#include "hardware/pwm.h"  // library of code to access the processor's built in pulse wave modulation features
#include "hardware/irq.h"  // library of code to let you interrupt code execution to run something of higher priority
#include "hardware/gpio.h"
/*
    It is more convenient to pre-define the correct
    pulse wave modulation slice and channel associated
    with the PIEZO_PIN on this processor (see RP2040
    manual) than to have it looked up each time.
  */
byte audioD = AUDIO_AJACK;
bool synthBuzzerEnabled = false;
byte headphoneVolumeCap = HEADPHONE_VOLUME_CAP_FULL;
byte synthOutputSmoothing = SYNTH_OUTPUT_SMOOTHING_OFF;

void RAM_FUNC(idlePhysicalAudioOutputs)();
void RAM_FUNC(preparePhysicalAudioOutput)(byte destination);
inline void RAM_FUNC(clearSynthPortamento)(uint8_t channelIndex);
inline void RAM_FUNC(beginSynthPortamento)(uint8_t channelIndex, uint32_t targetIncrement);

inline bool audioJackAvailable() {
  return Hardware_Version == HARDWARE_V1_2;
}

bool decodeStoredBuzzerEnabled(uint8_t storedValue) {
  if (!audioJackAvailable()) {
    return true;
  }
  return (storedValue & AUDIO_PIEZO) != 0;
}

inline byte runtimeAudioDestination(bool buzzerEnabled) {
  if (!audioJackAvailable()) {
    return AUDIO_PIEZO;
  }
  return buzzerEnabled ? AUDIO_PIEZO : AUDIO_AJACK;
}

void syncAudioDestinationToRuntime() {
  audioD = runtimeAudioDestination(synthBuzzerEnabled);
  preparePhysicalAudioOutput(audioD);
}

inline uint8_t RAM_FUNC(currentSynthVoiceLimit)() {
  return synthPlaybackVoiceLimit(playbackMode);
}

// ============================================================
// PWM AUDIO CONFIG
// ============================================================
// Set PWM_BITS to 8, 9, or 10 to control PWM resolution.
// 8-bit: wrap=254 (the 1.2-era default, and the safer fallback if the current
//         synth path sounds too harsh in the upper registers)
// 9-bit: wrap=511 (middle-ground test mode: lower quantization noise than 8-bit
//        while keeping the carrier about an octave higher than 10-bit)
// 10-bit: wrap=1023 (the default compromise: lower quantization noise, but a
//         much lower PWM carrier)
//
// At the project's 250MHz build target with clkdiv=1 and phase-correct PWM:
// - 8-bit carrier is about 488kHz
// - 9-bit carrier is about 244kHz
// - 10-bit carrier is about 122kHz
//
// High notes, especially sine waves, can sound noticeably harsher with 10-bit
// PWM on typical output stages because the PWM residue sits much closer to the
// audio band. We still keep 10-bit as the default compromise, but 8-bit
// remains a one-line fallback if the jack path gets too "screamy."
#ifndef PWM_BITS
#define PWM_BITS 10
#endif

#if (PWM_BITS == 8)
  constexpr uint16_t PWM_WRAP = 254;
  constexpr int32_t  PWM_MID  = 127;
  constexpr int32_t  SHAPE_CLAMP = 127;
  constexpr int      OUTPUT_SHIFT = 8;   // derived above
  constexpr int      ENV_TO_A_SHIFT = 9; // 65535 >> 9 ~= 127
#elif (PWM_BITS == 10)
  constexpr uint16_t PWM_WRAP = 1023;
  constexpr int32_t  PWM_MID  = 512;
  constexpr int32_t  SHAPE_CLAMP = 511;
  constexpr int      OUTPUT_SHIFT = 6;   // derived above
  constexpr int      ENV_TO_A_SHIFT = 7; // 65535 >> 7 ~= 512
#elif (PWM_BITS == 9)
  constexpr uint16_t PWM_WRAP = 511;
  constexpr int32_t  PWM_MID  = 256;
  constexpr int32_t  SHAPE_CLAMP = 255;
  constexpr int      OUTPUT_SHIFT = 7;   // midway between 8-bit and 10-bit gain staging
  constexpr int      ENV_TO_A_SHIFT = 8; // 65535 >> 8 ~= 256
#else
  #error "PWM_BITS must be 8, 9, or 10"
#endif
constexpr uint16_t PIEZO_OFF_THRESHOLD = (PWM_BITS == 8) ? 1 : ((PWM_BITS == 9) ? 2 : 4);
constexpr uint16_t PIEZO_IDLE_LEVEL = 0;
constexpr uint16_t JACK_IDLE_LEVEL = static_cast<uint16_t>(PWM_MID);
constexpr int32_t METRONOME_BEEP_LEVEL = SHAPE_CLAMP / 3;
constexpr uint8_t AUDIO_DMA_TIMER_SLICE = 7;
constexpr uint8_t AUDIO_DMA_PWM_STEPS = 6;
constexpr uint16_t AUDIO_DMA_TIMER_WRAP = 1023;
constexpr uint16_t AUDIO_DMA_BUFFER_SAMPLE_COUNT = 64;
constexpr uint32_t AUDIO_DMA_SYS_CLOCK_HZ = 250000000u;
constexpr uint32_t AUDIO_SAMPLE_RATE_HZ =
  AUDIO_DMA_SYS_CLOCK_HZ / (static_cast<uint32_t>(AUDIO_DMA_TIMER_WRAP) + 1u) / AUDIO_DMA_PWM_STEPS;
extern const uint32_t AUDIO_DMA_BUFFER_MICROS =
  (static_cast<uint64_t>(AUDIO_DMA_BUFFER_SAMPLE_COUNT) * 1000000ull) / AUDIO_SAMPLE_RATE_HZ;
constexpr uint8_t AUDIO_PWM_CC_LEVEL_SHIFT = 16;

struct AudioOutputLevels {
  uint16_t piezo = 0;
  uint16_t jack = JACK_IDLE_LEVEL;
  uint8_t voices = 0;
  uint8_t profileFlags = 0;
};

struct SmoothedAudioOutputLevels {
  int32_t piezoQ8 = static_cast<int32_t>(PIEZO_IDLE_LEVEL) << 8;
  int32_t jackQ8 = static_cast<int32_t>(JACK_IDLE_LEVEL) << 8;
};

SmoothedAudioOutputLevels smoothedAudioOutputLevels = {};

inline uint16_t RAM_FUNC(smoothAudioOutputLevel)(uint16_t target, int32_t& stateQ8, uint8_t smoothing) {
  int32_t targetQ8 = static_cast<int32_t>(target) << 8;
  if (smoothing == SYNTH_OUTPUT_SMOOTHING_OFF) {
    stateQ8 = targetQ8;
    return target;
  }
  stateQ8 += (targetQ8 - stateQ8) >> smoothing;
  int32_t rounded = (stateQ8 + 128) >> 8;
  if (rounded < 0) {
    return 0;
  }
  if (rounded > static_cast<int32_t>(PWM_WRAP)) {
    return PWM_WRAP;
  }
  return static_cast<uint16_t>(rounded);
}

inline void RAM_FUNC(applySynthOutputSmoothing)(AudioOutputLevels& output) {
  uint8_t smoothing = synthOutputSmoothing;
  if (smoothing > SYNTH_OUTPUT_SMOOTHING_MAX) {
    smoothing = SYNTH_OUTPUT_SMOOTHING_MAX;
  }
  output.piezo = smoothAudioOutputLevel(output.piezo, smoothedAudioOutputLevels.piezoQ8, smoothing);
  output.jack = smoothAudioOutputLevel(output.jack, smoothedAudioOutputLevels.jackQ8, smoothing);
}

inline void RAM_FUNC(writeAudioOutputLevels)(uint16_t piezoLevel, uint16_t jackLevel) {
  if (audioD & AUDIO_PIEZO) {
    pwm_set_chan_level(PIEZO_SLICE, PIEZO_CHNL, piezoLevel);
  } else {
    pwm_set_chan_level(PIEZO_SLICE, PIEZO_CHNL, PIEZO_IDLE_LEVEL);
  }

  if (audioD & AUDIO_AJACK) {
    pwm_set_chan_level(AJACK_SLICE, AJACK_CHNL, jackLevel);
  } else {
    pwm_set_chan_level(AJACK_SLICE, AJACK_CHNL, JACK_IDLE_LEVEL);
  }
}

inline int32_t RAM_FUNC(scalePiezoSample)(int32_t sample, uint16_t amplitude) {
#if (PWM_BITS == 8)
  constexpr uint8_t PIEZO_SCALE_SHIFT = 7;
#elif (PWM_BITS == 9)
  constexpr uint8_t PIEZO_SCALE_SHIFT = 8;
#else
  constexpr uint8_t PIEZO_SCALE_SHIFT = 9;
#endif
  return (sample * static_cast<int32_t>(amplitude)) >> PIEZO_SCALE_SHIFT;
}

inline int32_t RAM_FUNC(applySynthDrive)(int32_t sample) {
  uint16_t gainQ8 = 256;
  switch (synthDrive) {
    case SYNTH_DRIVE_WARM: gainQ8 = 256; break;
    case SYNTH_DRIVE_EDGE: gainQ8 = 384; break;
    case SYNTH_DRIVE_DIRTY: gainQ8 = 640; break;
    case SYNTH_DRIVE_OFF:
    default:
      return sample;
  }

  int32_t x = (sample * static_cast<int32_t>(gainQ8)) >> 8;
  if (x > SHAPE_CLAMP) x = SHAPE_CLAMP;
  if (x < -SHAPE_CLAMP) x = -SHAPE_CLAMP;

  const bool negative = x < 0;
  const uint32_t mag = negative ? static_cast<uint32_t>(-x) : static_cast<uint32_t>(x);
#if (PWM_BITS == 8)
  constexpr uint8_t DRIVE_CLAMP_SHIFT = 7;
#elif (PWM_BITS == 9)
  constexpr uint8_t DRIVE_CLAMP_SHIFT = 8;
#else
  constexpr uint8_t DRIVE_CLAMP_SHIFT = 9;
#endif
  uint32_t cubeTerm = (((mag * mag) >> DRIVE_CLAMP_SHIFT) * mag) >> DRIVE_CLAMP_SHIFT;
  int32_t shaped = ((3 * static_cast<int32_t>(mag)) - static_cast<int32_t>(cubeTerm)) >> 1;
  if (shaped > SHAPE_CLAMP) shaped = SHAPE_CLAMP;
  return negative ? -shaped : shaped;
}
byte activeSynthWaveTable[SYNTH_WAVETABLE_FRAME_COUNT][SYNTH_WAVE_SAMPLE_COUNT] = {};
byte synthVibratoSine[SYNTH_WAVE_SAMPLE_COUNT] = {};
volatile bool synthWaveTableLoadInProgress = false;
byte loadedSynthWaveform = 255;
char loadedSynthWavetableName[SYNTH_WAVETABLE_NAME_LENGTH] = {};
char loadedSynthWavetableFolderPath[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
volatile uint8_t activeSynthWaveFrameCount = 1;
uint16_t synthWavetableFramePositionByAmount[128] = {};
uint8_t synthFxModScaleByDepth[128][128] = {};
bool userSynthWavetableAvailable = false;
void setActiveSynthWaveFrameCount(uint8_t frameCount);
constexpr int16_t SYNTH_PITCH_MOD_Q4_SCALE = 16;
constexpr int16_t SYNTH_PITCH_MOD_MAX_Q4 = 127 * SYNTH_PITCH_MOD_Q4_SCALE;
constexpr uint16_t SYNTH_PITCH_MOD_RATIO_Q4_COUNT = (SYNTH_PITCH_MOD_MAX_Q4 / 2) + 1;
uint32_t synthPitchModPositiveQ16ByQ4[SYNTH_PITCH_MOD_RATIO_Q4_COUNT] = {};
uint32_t synthPitchModNegativeQ16ByQ4[SYNTH_PITCH_MOD_RATIO_Q4_COUNT] = {};
void initializeSynthPitchModLookup();
/*
    The sine wavetable benefits the most from
    interpolation because it has the fewest
    intentional harmonics to mask staircase
    artifacts in the upper registers.

    The phase accumulator already runs at 16-bit
    precision. With 512-entry tables, the high
    9 bits select a sample and the low 7 bits
    provide the fractional weight between adjacent
    8-bit table entries. The returned sample is
    in the same 0..65535 range used by the rest
    of the synth path.
  */
inline uint16_t RAM_FUNC(synthWaveSampleIndexFromPhase16)(uint16_t phase) {
  return phase >> SYNTH_WAVE_PHASE_FRACTION_BITS;
}

inline uint16_t RAM_FUNC(synthWaveSampleIndexFromPhase32)(uint32_t phase) {
  return phase >> (32 - SYNTH_WAVE_SAMPLE_BITS);
}

inline uint8_t RAM_FUNC(synthWaveInterpolationFraction)(uint16_t phase) {
  return static_cast<uint8_t>((phase & SYNTH_WAVE_PHASE_FRACTION_MASK) << (8 - SYNTH_WAVE_PHASE_FRACTION_BITS));
}

inline uint16_t RAM_FUNC(synthWavePhaseFromSampleIndex)(uint16_t sampleIndex) {
  return static_cast<uint16_t>(sampleIndex << SYNTH_WAVE_PHASE_FRACTION_BITS);
}

inline uint16_t RAM_FUNC(interpolatedWaveSample)(const byte* table, uint16_t phase) {
  uint16_t index = synthWaveSampleIndexFromPhase16(phase);
  uint16_t nextIndex = static_cast<uint16_t>(index + 1);
  if (nextIndex >= SYNTH_WAVE_SAMPLE_COUNT) {
    nextIndex = 0;
  }
  uint8_t frac = synthWaveInterpolationFraction(phase);
  int32_t sampleA = table[index];
  int32_t sampleB = table[nextIndex];
  return static_cast<uint16_t>((sampleA << 8) + ((sampleB - sampleA) * static_cast<int32_t>(frac)));
}
/*
    The hybrid synth sound blends between
    square, saw, and triangle waveforms
    at different frequencies. Said frequencies
    are controlled via constants here.
  */
#define TRANSITION_SQUARE 220.0
#define TRANSITION_SAW_LOW 440.0
#define TRANSITION_SAW_HIGH 880.0
#define TRANSITION_TRIANGLE 1760.0
/*
    The audio sample interval is set by a dedicated PWM
    timer slice that paces DMA writes into the output PWM
    compare register. With the default 1023 timer wrap and
    /6 divider at the 250 MHz build target, the sample rate
    is about 40.7 kHz.
  */
constexpr uint32_t POLL_INTERVAL_IN_MICROSECONDS =
  (1000000u + (AUDIO_SAMPLE_RATE_HZ / 2u)) / AUDIO_SAMPLE_RATE_HZ;
constexpr uint8_t SYNTH_PITCH_SMOOTH_SHIFT = 9;
constexpr uint8_t SYNTH_MOD_SMOOTH_SHIFT = 9;
constexpr uint32_t audioPhaseIncrementFromHz(uint16_t hz) {
  return static_cast<uint32_t>((static_cast<uint64_t>(hz) * 4294967296ULL) / AUDIO_SAMPLE_RATE_HZ);
}
constexpr uint32_t audioPhaseIncrementFromMilliHz(uint32_t milliHz) {
  return static_cast<uint32_t>((static_cast<uint64_t>(milliHz) * 4294967296ULL) / (static_cast<uint64_t>(AUDIO_SAMPLE_RATE_HZ) * 1000ULL));
}
constexpr std::array<uint32_t, 12> synthVibratoPhaseIncrementOptions = {
  audioPhaseIncrementFromHz(1),
  audioPhaseIncrementFromHz(2),
  audioPhaseIncrementFromHz(3),
  audioPhaseIncrementFromHz(4),
  audioPhaseIncrementFromHz(5),
  audioPhaseIncrementFromHz(6),
  audioPhaseIncrementFromHz(7),
  audioPhaseIncrementFromHz(8),
  audioPhaseIncrementFromHz(9),
  audioPhaseIncrementFromHz(10),
  audioPhaseIncrementFromHz(11),
  audioPhaseIncrementFromHz(12)
};
constexpr std::array<uint32_t, 20> synthLfoPhaseIncrementOptions = {
  audioPhaseIncrementFromMilliHz(50),
  audioPhaseIncrementFromMilliHz(100),
  audioPhaseIncrementFromMilliHz(200),
  audioPhaseIncrementFromMilliHz(333),
  audioPhaseIncrementFromMilliHz(500),
  audioPhaseIncrementFromMilliHz(750),
  audioPhaseIncrementFromMilliHz(1000),
  audioPhaseIncrementFromMilliHz(1250),
  audioPhaseIncrementFromMilliHz(1500),
  audioPhaseIncrementFromMilliHz(2000),
  audioPhaseIncrementFromMilliHz(2500),
  audioPhaseIncrementFromMilliHz(3000),
  audioPhaseIncrementFromMilliHz(4000),
  audioPhaseIncrementFromMilliHz(5000),
  audioPhaseIncrementFromMilliHz(6000),
  audioPhaseIncrementFromMilliHz(8000),
  audioPhaseIncrementFromMilliHz(10000),
  audioPhaseIncrementFromMilliHz(12000),
  audioPhaseIncrementFromMilliHz(16000),
  audioPhaseIncrementFromMilliHz(20000)
};
constexpr uint16_t METRONOME_BEEP_SAMPLE_COUNT =
  static_cast<uint16_t>((40000ULL * AUDIO_SAMPLE_RATE_HZ + 999999ULL) / 1000000ULL);
constexpr uint32_t METRONOME_BEEP_NORMAL_INCREMENT = audioPhaseIncrementFromHz(1200);
constexpr uint32_t METRONOME_BEEP_ACCENT_INCREMENT = audioPhaseIncrementFromHz(1800);

inline void RAM_FUNC(recordISRProfileSample)(uint32_t startTime, uint8_t voices, uint8_t flags) {
  uint32_t dt = timer_hw->timerawl - startTime;
  isrCycleAvailableUs = POLL_INTERVAL_IN_MICROSECONDS;
  if (dt < isrCycleMin) {
    isrCycleMin = dt;
  }
  if (dt > isrCycleMax) {
    isrCycleMax = dt;
    isrCycleMaxVoices = voices;
    isrCycleMaxFlags = flags;
  }
  if (dt > POLL_INTERVAL_IN_MICROSECONDS) {
    isrCycleOverrunCount++;
  }
  if (flags & ISR_PROFILE_FLAG_PIEZO_SCALE) {
    isrCyclePiezoScaleCount++;
  }
  isrCycleSum += dt;
  isrCycleCount++;
}

inline void RAM_FUNC(recordAudioBufferProfileSample)(uint32_t startTime, uint8_t voices, uint8_t flags) {
  uint32_t dt = timer_hw->timerawl - startTime;
  isrCycleAvailableUs = AUDIO_DMA_BUFFER_MICROS;
  if (dt < isrCycleMin) {
    isrCycleMin = dt;
  }
  if (dt > isrCycleMax) {
    isrCycleMax = dt;
    isrCycleMaxVoices = voices;
    isrCycleMaxFlags = flags;
  }
  if (dt > AUDIO_DMA_BUFFER_MICROS) {
    isrCycleOverrunCount++;
  }
  if (flags & ISR_PROFILE_FLAG_PIEZO_SCALE) {
    isrCyclePiezoScaleCount++;
  }
  isrCycleSum += dt;
  isrCycleCount++;
}

inline uint32_t RAM_FUNC(oscillatorIncrementFromFrequency)(float frequency) {
  if (frequency <= 0.0f) {
    return 0;
  }
  constexpr float incrementScale = 4294967296.0f / static_cast<float>(AUDIO_SAMPLE_RATE_HZ);
  float increment = frequency * incrementScale;
  const float maxIncrement = static_cast<float>(std::numeric_limits<uint32_t>::max());
  if (increment >= maxIncrement) {
    return std::numeric_limits<uint32_t>::max();
  }
  return static_cast<uint32_t>(round(increment));
}

inline void RAM_FUNC(smoothUint32Toward)(uint32_t& current, uint32_t target, uint8_t shift) {
  if (current == target) {
    return;
  }
  if (target > current) {
    uint32_t step = (target - current) >> shift;
    if (step == 0) {
      step = 1;
    }
    current += step;
    if (current > target) {
      current = target;
    }
  } else {
    uint32_t step = (current - target) >> shift;
    if (step == 0) {
      step = 1;
    }
    current -= step;
    if (current < target) {
      current = target;
    }
  }
}

inline void RAM_FUNC(smoothUint32Toward)(uint32_t& current, uint32_t target, uint8_t shift, uint8_t elapsedTicks) {
  if (elapsedTicks == 0 || current == target) {
    return;
  }
  if (target > current) {
    uint32_t difference = target - current;
    uint64_t step = difference >> shift;
    if (step == 0) {
      step = 1;
    }
    step *= elapsedTicks;
    current += static_cast<uint32_t>(step >= difference ? difference : step);
  } else {
    uint32_t difference = current - target;
    uint64_t step = difference >> shift;
    if (step == 0) {
      step = 1;
    }
    step *= elapsedTicks;
    current -= static_cast<uint32_t>(step >= difference ? difference : step);
  }
}

inline void RAM_FUNC(smoothUint16Toward)(uint16_t& current, uint16_t target, uint8_t shift) {
  if (current == target) {
    return;
  }
  if (target > current) {
    uint16_t step = (target - current) >> shift;
    if (step == 0) {
      step = 1;
    }
    current += step;
    if (current > target) {
      current = target;
    }
  } else {
    uint16_t step = (current - target) >> shift;
    if (step == 0) {
      step = 1;
    }
    current -= step;
    if (current < target) {
      current = target;
    }
  }
}

inline void RAM_FUNC(smoothUint16Toward)(uint16_t& current, uint16_t target, uint8_t shift, uint8_t elapsedTicks) {
  if (elapsedTicks == 0 || current == target) {
    return;
  }
  if (target > current) {
    uint16_t difference = target - current;
    uint32_t step = difference >> shift;
    if (step == 0) {
      step = 1;
    }
    step *= elapsedTicks;
    current += static_cast<uint16_t>(step >= difference ? difference : step);
  } else {
    uint16_t difference = current - target;
    uint32_t step = difference >> shift;
    if (step == 0) {
      step = 1;
    }
    step *= elapsedTicks;
    current -= static_cast<uint16_t>(step >= difference ? difference : step);
  }
}

inline uint32_t RAM_FUNC(ticksFromMicros)(uint32_t micros) {
  if (micros == 0) {
    return 0;
  }
  return static_cast<uint32_t>((static_cast<uint64_t>(micros) * AUDIO_SAMPLE_RATE_HZ + 999999ULL) / 1000000ULL);
}

inline uint32_t RAM_FUNC(envelopeAudioLevel)(uint32_t level) {
  if (level > envelopeMaxLevel) {
    level = envelopeMaxLevel;
  }
  return level >> ENVELOPE_LEVEL_SCALE_SHIFT;
}

inline uint16_t RAM_FUNC(releaseIncrementForLevel)(uint32_t level) {
  if (level == 0) {
    return 1;
  }
  uint32_t bucket = (level - 1) >> ENVELOPE_RELEASE_INCREMENT_SHIFT;
  if (bucket >= envelopeReleaseIncrementByLevel.size()) {
    bucket = envelopeReleaseIncrementByLevel.size() - 1;
  }
  uint16_t increment = envelopeReleaseIncrementByLevel[bucket];
  return increment ? increment : 1;
}

inline uint16_t RAM_FUNC(effectReleaseIncrementForLevel)(uint8_t envelopeIndex, uint32_t level) {
  if (level == 0) {
    return 1;
  }
  uint32_t bucket = (level - 1) >> ENVELOPE_RELEASE_INCREMENT_SHIFT;
  if (bucket >= effectEnvelopeReleaseIncrementByLevel[envelopeIndex].size()) {
    bucket = effectEnvelopeReleaseIncrementByLevel[envelopeIndex].size() - 1;
  }
  uint16_t increment = effectEnvelopeReleaseIncrementByLevel[envelopeIndex][bucket];
  return increment ? increment : 1;
}

struct EnvelopeState {
  uint32_t level = 0;
  uint16_t releaseIncrement = 0;
  uint32_t holdTicksRemaining = 0;
  EnvelopeStage stage = EnvelopeStage::Idle;
};

inline void RAM_FUNC(resetEnvelopeState)(EnvelopeState& env) {
  env.level = 0;
  env.releaseIncrement = 0;
  env.holdTicksRemaining = 0;
  env.stage = EnvelopeStage::Idle;
}

std::array<EnvelopeState, POLYPHONY_LIMIT> envelopeStates;
std::array<std::array<EnvelopeState, POLYPHONY_LIMIT>, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeStates;
int16_t cachedEffectEnvelopeModValues[SYNTH_FX_ENVELOPE_COUNT][POLYPHONY_LIMIT] = {};
enum class EnvelopeCommand : uint8_t {
  None,
  StartAttack,
  StartRelease,
  Reset
};

// Core 0 publishes the latest envelope command for each voice, and the audio
// ISR on core 1 consumes it. The sequence byte tells the consumer whether a
// newer command has arrived since the last poll.
volatile uint8_t envelopeCommandValues[POLYPHONY_LIMIT] = {};
volatile uint8_t envelopeCommandPublishedSeq[POLYPHONY_LIMIT] = {};
std::array<uint8_t, POLYPHONY_LIMIT> envelopeCommandConsumedSeq = {};

// The opposite direction is simpler: core 1 only needs to tell core 0 that a
// voice has fully finished and can return to the free list. A sequence byte is
// enough because "voice finished" is an idempotent event.
volatile uint8_t voiceFreedPublishedSeq[POLYPHONY_LIMIT] = {};
std::array<uint8_t, POLYPHONY_LIMIT> voiceFreedConsumedSeq = {};
std::array<std::atomic<bool>, POLYPHONY_LIMIT> channelInUse = {};
std::array<std::atomic<uint32_t>, POLYPHONY_LIMIT> voiceGenerations;
std::array<std::atomic<int16_t>, POLYPHONY_LIMIT> synthChannelOwners;
std::atomic<uint32_t> nextVoiceGeneration = 1;
// Flag set by Core 0 before flash writes. When true, the audio renderer outputs
// silence so DMA resumes cleanly after flash operations (which disable all
// interrupts on both cores of the RP2040).
std::atomic<bool> flashWriteInProgress = false;
constexpr int16_t NO_SYNTH_OWNER = -1;
float pitchBendFactor = 1.0f;
std::array<uint8_t, POLYPHONY_LIMIT> releaseRetries = {};
std::array<uint8_t, POLYPHONY_LIMIT> releaseRetryCountdown = {};

constexpr uint8_t releaseRetryLimit = 2;
constexpr uint8_t releaseRetryDelayLoops = 2;

// Publish the newest command for one voice. The command byte is written first,
// then a memory barrier makes sure core 1 cannot observe the new sequence
// number before the matching command value is visible.
inline void RAM_FUNC(publishEnvelopeCommand)(uint8_t channel, EnvelopeCommand command) {
  envelopeCommandValues[channel] = static_cast<uint8_t>(command);
  __dmb();
  envelopeCommandPublishedSeq[channel] = static_cast<uint8_t>(envelopeCommandPublishedSeq[channel] + 1);
}

// Read the newest command once. Returning None means nothing new arrived since
// the last ISR iteration for this voice.
inline EnvelopeCommand RAM_FUNC(consumeEnvelopeCommand)(uint8_t channel) {
  uint8_t publishedSeq = envelopeCommandPublishedSeq[channel];
  if (publishedSeq == envelopeCommandConsumedSeq[channel]) {
    return EnvelopeCommand::None;
  }
  __dmb();
  EnvelopeCommand command = static_cast<EnvelopeCommand>(envelopeCommandValues[channel]);
  envelopeCommandConsumedSeq[channel] = publishedSeq;
  return command;
}

// Core 1 uses this when a release truly reaches zero. Core 0 later consumes
// the event and pushes the voice back into the available-channel queue.
inline void RAM_FUNC(publishVoiceFreed)(uint8_t channel) {
  __dmb();
  voiceFreedPublishedSeq[channel] = static_cast<uint8_t>(voiceFreedPublishedSeq[channel] + 1);
}

// Core 0 checks whether core 1 has published a newer "voice finished" event.
inline bool RAM_FUNC(consumeVoiceFreed)(uint8_t channel) {
  uint8_t publishedSeq = voiceFreedPublishedSeq[channel];
  if (publishedSeq == voiceFreedConsumedSeq[channel]) {
    return false;
  }
  __dmb();
  voiceFreedConsumedSeq[channel] = publishedSeq;
  return true;
}

// When core 0 immediately reuses a voice, any older pending "voice finished"
// event for that same channel must be ignored so it cannot free the new note.
inline void RAM_FUNC(clearPendingVoiceFreed)(uint8_t channel) {
  __dmb();
  voiceFreedConsumedSeq[channel] = voiceFreedPublishedSeq[channel];
}

void updateEnvelopeReleaseIncrementTable(EnvelopeParams& params, std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS>& releaseTable) {
  for (size_t bucket = 0; bucket < releaseTable.size(); ++bucket) {
    uint32_t bucketLevel = static_cast<uint32_t>(bucket + 1) << ENVELOPE_RELEASE_INCREMENT_SHIFT;
    if (bucketLevel > envelopeMaxLevel) {
      bucketLevel = envelopeMaxLevel;
    }
    uint32_t increment = (params.releaseTicks == 0)
                           ? std::numeric_limits<uint16_t>::max()
                           : std::max<uint32_t>(
                               1,
                               (bucketLevel + (params.releaseTicks >> 1)) / params.releaseTicks);
    if (increment > std::numeric_limits<uint16_t>::max()) {
      increment = std::numeric_limits<uint16_t>::max();
    }
    releaseTable[bucket] = static_cast<uint16_t>(increment);
  }
}

void updateEnvelopeParamsFromValues(EnvelopeParams& params,
                                    uint8_t& attackIndex,
                                    uint8_t& holdIndex,
                                    uint8_t& decayIndex,
                                    uint8_t& sustainLevel,
                                    uint8_t& releaseIndex,
                                    std::array<uint16_t, ENVELOPE_RELEASE_INCREMENT_BUCKETS>& releaseTable) {
  auto clampIndex = [](uint8_t& index) {
    if (index >= envelopeTimeMicrosOptions.size()) {
      index = static_cast<uint8_t>(envelopeTimeMicrosOptions.size() - 1);
    }
  };

  clampIndex(attackIndex);
  clampIndex(holdIndex);
  clampIndex(decayIndex);
  clampIndex(releaseIndex);

  uint32_t attackMicros = envelopeTimeMicrosOptions[attackIndex];
  params.attackTicks = ticksFromMicros(attackMicros);
  params.attackIncrement = (params.attackTicks == 0)
                             ? envelopeMaxLevel
                             : std::max<uint32_t>(1, (envelopeMaxLevel + params.attackTicks - 1) / params.attackTicks);

  uint32_t holdMicros = envelopeTimeMicrosOptions[holdIndex];
  params.holdTicks = ticksFromMicros(holdMicros);

  sustainLevel = std::min<uint8_t>(127, sustainLevel);
  params.sustainLevel = (static_cast<uint32_t>(sustainLevel) * envelopeMaxLevel) / 127;

  uint32_t decayMicros = envelopeTimeMicrosOptions[decayIndex];
  params.decayTicks = ticksFromMicros(decayMicros);
  if (params.decayTicks == 0 || params.sustainLevel >= envelopeMaxLevel) {
    params.decayIncrement = envelopeMaxLevel;
  } else {
    uint32_t difference = envelopeMaxLevel - params.sustainLevel;
    params.decayIncrement = std::max<uint32_t>(1, (difference + params.decayTicks - 1) / params.decayTicks);
  }

  uint32_t releaseMicros = envelopeTimeMicrosOptions[releaseIndex];
  params.releaseTicks = ticksFromMicros(releaseMicros);
  updateEnvelopeReleaseIncrementTable(params, releaseTable);
}

void updateEnvelopeParamsFromSettings() {
  updateEnvelopeParamsFromValues(envelopeParams,
                                 envelopeAttackIndex,
                                 envelopeHoldIndex,
                                 envelopeDecayIndex,
                                 envelopeSustainLevel,
                                 envelopeReleaseIndex,
                                 envelopeReleaseIncrementByLevel);
}

std::array<bool, SYNTH_FX_ENVELOPE_COUNT> synthEffectEnvelopeActive = { false, false };

inline int16_t synthEffectAmountDepth(uint8_t amountSetting) {
  return static_cast<int16_t>(amountSetting) - static_cast<int16_t>(SYNTH_FX_AMOUNT_OFF);
}

inline void RAM_FUNC(advanceEnvelopeFromAttackPeak)(const EnvelopeParams& params, EnvelopeState& env) {
  env.level = envelopeMaxLevel;
  if (params.holdTicks != 0) {
    env.stage = EnvelopeStage::Hold;
    env.holdTicksRemaining = params.holdTicks;
  } else if (params.decayTicks == 0 || params.sustainLevel >= envelopeMaxLevel) {
    env.stage = EnvelopeStage::Sustain;
    env.level = params.sustainLevel;
    env.holdTicksRemaining = 0;
  } else {
    env.stage = EnvelopeStage::Decay;
    env.holdTicksRemaining = 0;
  }
}

inline void RAM_FUNC(updateEnvelopeHoldStage)(const EnvelopeParams& params, EnvelopeState& env) {
  env.level = envelopeMaxLevel;
  if (env.holdTicksRemaining > 1) {
    --env.holdTicksRemaining;
    return;
  }
  env.holdTicksRemaining = 0;
  if (params.decayTicks == 0 || params.sustainLevel >= envelopeMaxLevel) {
    env.stage = EnvelopeStage::Sustain;
    env.level = params.sustainLevel;
  } else {
    env.stage = EnvelopeStage::Decay;
  }
}

void updateEffectEnvelopeParamsFromSettings(uint8_t envelopeIndex) {
  if (envelopeIndex >= SYNTH_FX_ENVELOPE_COUNT) {
    return;
  }
  updateEnvelopeParamsFromValues(effectEnvelopeParams[envelopeIndex],
                                 effectEnvelopeAttackIndex[envelopeIndex],
                                 effectEnvelopeHoldIndex[envelopeIndex],
                                 effectEnvelopeDecayIndex[envelopeIndex],
                                 effectEnvelopeSustainLevel[envelopeIndex],
                                 effectEnvelopeReleaseIndex[envelopeIndex],
                                 effectEnvelopeReleaseIncrementByLevel[envelopeIndex]);
  bool envelopeShapeActive = (effectEnvelopeAttackIndex[envelopeIndex] != 0)
                          || (effectEnvelopeHoldIndex[envelopeIndex] != 0)
                          || (effectEnvelopeDecayIndex[envelopeIndex] != 0)
                          || (effectEnvelopeSustainLevel[envelopeIndex] != 0)
                          || (effectEnvelopeReleaseIndex[envelopeIndex] != 0);
  synthEffectEnvelopeActive[envelopeIndex] = envelopeShapeActive && synthEffectAmountDepth(effectEnvelopeAmount[envelopeIndex]) != 0;
}

void updateEffectEnvelopeParamsFromSettings() {
  for (uint8_t envelopeIndex = 0; envelopeIndex < SYNTH_FX_ENVELOPE_COUNT; ++envelopeIndex) {
    updateEffectEnvelopeParamsFromSettings(envelopeIndex);
  }
}
/*
    This defines which hardware alarm
    and interrupt address are used
    to time the call of the poll() function.
  */
#define ALARM_NUM 2
#define ALARM_IRQ TIMER_IRQ_2
void disableAudioAlarmInterrupt() {
  irq_set_enabled(ALARM_IRQ, false);
}
/*
    A basic EQ level can be stored to perform
    simple loudness adjustments at certain
    frequencies where human hearing is sensitive.

    By default it's off but you can change this
    flag to "true" to enable it. This may also
    be moved to a Advanced menu option.
  */
#define EQUAL_LOUDNESS_ADJUST true
/*
    This class defines a virtual oscillator.
    It stores an oscillation frequency in
    the form of an increment value, which is
    how much a counter would have to be increased
    every time the poll() interval is reached,
    such that the high 16 bits of the phase counter
    loop across the waveform at the right frequency.

    The value of the counter is useful for reading
    a waveform sample, so that an analog signal
    can be emulated by reading the sample at each
    poll() based on how far the phase has moved
    through one waveform cycle.
  */
class oscillator {
public:
  uint32_t increment = 0;        // current Q16.16 phase increment smoothed by the audio renderer
  uint32_t targetIncrement = 0;  // target Q16.16 phase increment from the control path
  uint32_t counter = 0;          // Q16.16 phase accumulator; high 16 bits are the waveform phase
  uint32_t glideStep = 0;        // linear portamento step in Q16.16 increment units
  uint32_t glideSamplesRemaining = 0;
  byte a = 127;
  byte b = 128;
  byte c = 255;
  uint16_t ab = 0;
  uint16_t cd = 0;
  byte eq = 0;
};
oscillator synth[POLYPHONY_LIMIT];  // maximum polyphony
std::queue<byte> synthChQueue;
byte attenuation[] = { 64, 24, 17, 14, 12, 11, 10, 9, 8 };  // RAM-resident; read by poll() every audio tick.
uint16_t synthModValueQ8 = 0;
uint32_t synthVibratoPhase = 0;
uint32_t synthVibratoPhaseIncrement = synthVibratoPhaseIncrementOptions[SYNTH_VIBRATO_SPEED_DEFAULT];
uint32_t synthLfoPhase = 0;
uint32_t synthLfoPhaseIncrement = synthLfoPhaseIncrementOptions[SYNTH_LFO_SPEED_DEFAULT];
volatile uint16_t metronomeBeepSamplesRemaining = 0;
volatile uint32_t metronomeBeepPhaseIncrement = METRONOME_BEEP_NORMAL_INCREMENT;
uint32_t metronomeBeepPhase = 0;

byte arpeggiatingNow = UNUSED_NOTE;  // if this is 255, set to off (0% duty cycle)
uint64_t arpeggiateTime = 0;         // Used to keep track of when this note started playing in ARPEG mode
uint64_t arpeggiateLength = 62500;   // default: 1/32 note at 120 BPM
constexpr uint16_t ARPEGGIATOR_SEQUENCE_MAX = BTN_COUNT * 2;
std::array<byte, BTN_COUNT> arpeggiatorHeldNotes = {};
uint8_t arpeggiatorHeldNoteCount = 0;
std::array<byte, ARPEGGIATOR_SEQUENCE_MAX> arpeggiatorSequence = {};
uint16_t arpeggiatorSequenceLength = 0;
uint16_t arpeggiatorSequenceCursor = 0;
uint32_t arpeggiatorRandomState = 0xA341316Cu;

inline uint8_t RAM_FUNC(smoothedSynthModValue)(uint8_t elapsedTicks = 1) {
  int16_t targetValue = modWheel.curValue;
  if (targetValue < 0) {
    targetValue = 0;
  } else if (targetValue > 127) {
    targetValue = 127;
  }
  const uint16_t targetQ8 = static_cast<uint16_t>(targetValue) << 8;
  smoothUint16Toward(synthModValueQ8, targetQ8, SYNTH_MOD_SMOOTH_SHIFT, elapsedTicks);
  return static_cast<uint8_t>((synthModValueQ8 + 128u) >> 8);
}

void updateSynthModulationParams() {
  if (synthModTarget > SYNTH_MOD_TARGET_MAX) {
    synthModTarget = SYNTH_MOD_TARGET_FOLD_WARP;
  }
  if (synthModAmount > SYNTH_MOD_AMOUNT_FULL) {
    synthModAmount = SYNTH_MOD_AMOUNT_FULL;
  }
  for (uint8_t envelopeIndex = 0; envelopeIndex < SYNTH_FX_ENVELOPE_COUNT; ++envelopeIndex) {
    if (effectEnvelopeTarget[envelopeIndex] > SYNTH_MOD_TARGET_MAX) {
      effectEnvelopeTarget[envelopeIndex] = SYNTH_MOD_TARGET_FOLD_WARP;
    }
    if (effectEnvelopeAmount[envelopeIndex] > SYNTH_FX_AMOUNT_FULL) {
      effectEnvelopeAmount[envelopeIndex] = SYNTH_FX_AMOUNT_FULL;
    }
  }
  if (synthVibratoSpeed >= synthVibratoPhaseIncrementOptions.size()) {
    synthVibratoSpeed = SYNTH_VIBRATO_SPEED_DEFAULT;
  }
  synthVibratoPhaseIncrement = synthVibratoPhaseIncrementOptions[synthVibratoSpeed];
  if (synthWavetablePosition > SYNTH_MOD_AMOUNT_FULL) {
    synthWavetablePosition = SYNTH_WAVETABLE_POSITION_DEFAULT;
  }
  if (synthLfoTarget > SYNTH_MOD_TARGET_MAX) {
    synthLfoTarget = SYNTH_MOD_TARGET_FOLD_WARP;
  }
  if (synthLfoAmount > SYNTH_FX_AMOUNT_FULL) {
    synthLfoAmount = SYNTH_FX_AMOUNT_OFF;
  }
  if (synthLfoWave > SYNTH_LFO_WAVE_MAX) {
    synthLfoWave = SYNTH_LFO_WAVE_SINE;
  }
  if (synthLfoSpeed >= synthLfoPhaseIncrementOptions.size()) {
    synthLfoSpeed = SYNTH_LFO_SPEED_DEFAULT;
  }
  synthLfoPhaseIncrement = synthLfoPhaseIncrementOptions[synthLfoSpeed];
}

void updateSynthPortamentoSettings() {
  if (synthPortamentoTimeIndex >= envelopeTimeMicrosOptions.size()) {
    synthPortamentoTimeIndex = 0;
  }
  synthPortamentoTicks = ticksFromMicros(envelopeTimeMicrosOptions[synthPortamentoTimeIndex]);
}

inline uint8_t RAM_FUNC(scaleSynthModAmount)(uint8_t modValue) {
  if (synthModAmount >= SYNTH_MOD_AMOUNT_FULL) {
    return modValue;
  }
  return static_cast<uint8_t>((static_cast<uint16_t>(modValue) * static_cast<uint16_t>(synthModAmount) + 64u) >> 7);
}

inline int16_t RAM_FUNC(effectEnvelopeModValue)(uint8_t envelopeIndex, uint8_t target, const EnvelopeState& env) {
  int16_t depth = synthEffectAmountDepth(effectEnvelopeAmount[envelopeIndex]);
  if (depth == 0) {
    return 0;
  }
  bool negativeVibrato = target == SYNTH_MOD_TARGET_VIBRATO && depth < 0;
  if (env.stage == EnvelopeStage::Idle && !negativeVibrato) {
    return 0;
  }

  uint32_t level = env.level;
  if (level > envelopeMaxLevel) {
    level = envelopeMaxLevel;
  }
  uint32_t value = (level + ENVELOPE_MOD_VALUE_ROUND) >> ENVELOPE_MOD_VALUE_SHIFT;
  if (value > 127) {
    value = 127;
  }

  uint8_t absDepth = static_cast<uint8_t>(depth > 0 ? depth : -depth);
  uint8_t scaled = synthFxModScaleByDepth[absDepth][value];
  if (negativeVibrato) {
    return static_cast<int16_t>(absDepth - scaled);
  }
  int16_t signedValue = static_cast<int16_t>(scaled);
  return (depth < 0) ? -signedValue : signedValue;
}

inline int16_t RAM_FUNC(effectEnvelopePitchModValueQ4)(uint8_t envelopeIndex, const EnvelopeState& env) {
  int16_t depth = synthEffectAmountDepth(effectEnvelopeAmount[envelopeIndex]);
  if (depth == 0 || env.stage == EnvelopeStage::Idle) {
    return 0;
  }

  uint32_t level = env.level;
  if (level > envelopeMaxLevel) {
    level = envelopeMaxLevel;
  }
  uint32_t audioLevel = envelopeAudioLevel(level);
  uint16_t absDepthQ4 = static_cast<uint16_t>(depth > 0 ? depth : -depth) * SYNTH_PITCH_MOD_Q4_SCALE;
  uint16_t scaledQ4 = static_cast<uint16_t>(((audioLevel + 1u) * static_cast<uint32_t>(absDepthQ4)) >> 16);
  int16_t signedValueQ4 = static_cast<int16_t>(scaledQ4);
  return (depth < 0) ? -signedValueQ4 : signedValueQ4;
}

inline void RAM_FUNC(resetCachedEffectEnvelopeModValue)(uint8_t envelopeIndex, uint8_t voiceIndex) {
  cachedEffectEnvelopeModValues[envelopeIndex][voiceIndex] = 0;
}

inline void RAM_FUNC(startEffectEnvelopeAttack)(uint8_t envelopeIndex, EnvelopeState& env) {
  EnvelopeParams& params = effectEnvelopeParams[envelopeIndex];
  env.releaseIncrement = 0;
  env.holdTicksRemaining = 0;
  if (params.attackTicks == 0) {
    advanceEnvelopeFromAttackPeak(params, env);
  } else {
    env.stage = EnvelopeStage::Attack;
    env.level = 0;
  }
}

inline void RAM_FUNC(startEffectEnvelopeRelease)(uint8_t envelopeIndex, EnvelopeState& env) {
  EnvelopeParams& params = effectEnvelopeParams[envelopeIndex];
  if (params.releaseTicks == 0 || env.level == 0) {
    resetEnvelopeState(env);
    return;
  }
  env.stage = EnvelopeStage::Release;
  env.releaseIncrement = effectReleaseIncrementForLevel(envelopeIndex, env.level);
}

inline void RAM_FUNC(updateEffectEnvelopeState)(uint8_t envelopeIndex, EnvelopeState& env, uint8_t elapsedTicks = 1) {
  EnvelopeParams& params = effectEnvelopeParams[envelopeIndex];
  uint32_t tickScale = elapsedTicks ? elapsedTicks : 1;
  switch (env.stage) {
    case EnvelopeStage::Attack: {
      uint32_t increment = params.attackIncrement * tickScale;
      uint32_t nextLevel = env.level + increment;
      if (env.level >= envelopeMaxLevel || nextLevel >= envelopeMaxLevel) {
        advanceEnvelopeFromAttackPeak(params, env);
      } else {
        env.level = nextLevel;
      }
      break;
    }
    case EnvelopeStage::Hold:
      env.level = envelopeMaxLevel;
      if (env.holdTicksRemaining > tickScale) {
        env.holdTicksRemaining -= tickScale;
      } else {
        env.holdTicksRemaining = 0;
        if (params.decayTicks == 0 || params.sustainLevel >= envelopeMaxLevel) {
          env.stage = EnvelopeStage::Sustain;
          env.level = params.sustainLevel;
        } else {
          env.stage = EnvelopeStage::Decay;
        }
      }
      break;
    case EnvelopeStage::Decay:
      if (params.decayTicks == 0 || params.sustainLevel >= envelopeMaxLevel) {
        env.stage = EnvelopeStage::Sustain;
        env.level = params.sustainLevel;
      } else if (env.level > params.sustainLevel) {
        uint32_t decrement = params.decayIncrement * tickScale;
        uint32_t nextLevel = (env.level > decrement) ? (env.level - decrement) : 0;
        if (nextLevel <= params.sustainLevel) {
          env.level = params.sustainLevel;
          env.stage = EnvelopeStage::Sustain;
        } else {
          env.level = nextLevel;
        }
      } else {
        env.level = params.sustainLevel;
        env.stage = EnvelopeStage::Sustain;
      }
      break;
    case EnvelopeStage::Sustain:
      env.level = params.sustainLevel;
      break;
    case EnvelopeStage::Release: {
      uint32_t releaseDecrement = static_cast<uint32_t>(env.releaseIncrement) * tickScale;
      if (params.releaseTicks == 0 || env.releaseIncrement == 0 || env.level <= releaseDecrement) {
        resetEnvelopeState(env);
      } else {
        env.level -= releaseDecrement;
      }
      break;
    }
    case EnvelopeStage::Idle:
    default:
      env.level = 0;
      break;
  }
}

inline void RAM_FUNC(refreshCachedEffectEnvelopeModValue)(uint8_t envelopeIndex,
                                                          uint8_t voiceIndex,
                                                          uint8_t elapsedTicks) {
  if (!synthEffectEnvelopeActive[envelopeIndex]) {
    resetCachedEffectEnvelopeModValue(envelopeIndex, voiceIndex);
    return;
  }
  EnvelopeState& effectEnv = effectEnvelopeStates[envelopeIndex][voiceIndex];
  if (elapsedTicks != 0) {
    updateEffectEnvelopeState(envelopeIndex, effectEnv, elapsedTicks);
  }
  if (effectEnvelopeTarget[envelopeIndex] == SYNTH_MOD_TARGET_PITCH) {
    cachedEffectEnvelopeModValues[envelopeIndex][voiceIndex] = 0;
    return;
  }
  cachedEffectEnvelopeModValues[envelopeIndex][voiceIndex] =
    effectEnvelopeModValue(envelopeIndex, effectEnvelopeTarget[envelopeIndex], effectEnv);
}

inline uint32_t RAM_FUNC(applySynthVibrato)(uint32_t increment, int16_t vibratoAmount) {
  if (vibratoAmount == 0) {
    return increment;
  }

  int32_t offset = (static_cast<int32_t>(increment >> 16) * static_cast<int32_t>(vibratoAmount)) >> 2;
  if (offset < 0) {
    uint32_t negativeOffset = static_cast<uint32_t>(-offset);
    return (negativeOffset >= increment) ? 0 : (increment - negativeOffset);
  }

  uint32_t positiveOffset = static_cast<uint32_t>(offset);
  if (std::numeric_limits<uint32_t>::max() - increment < positiveOffset) {
    return std::numeric_limits<uint32_t>::max();
  }
  return increment + positiveOffset;
}

inline uint16_t RAM_FUNC(applySynthFoldPhaseWarpQ4)(uint16_t phase, int16_t warpAmountQ4) {
  if (warpAmountQ4 == 0) {
    return phase;
  }
  uint16_t triangle = (phase & 0x8000) ? static_cast<uint16_t>(0xFFFFu - phase) : phase;
  uint16_t depthQ4 = static_cast<uint16_t>(warpAmountQ4 < 0 ? -warpAmountQ4 : warpAmountQ4);
  uint32_t scaleQ4 = static_cast<uint32_t>(depthQ4) * 5u;
  uint16_t offset = static_cast<uint16_t>((static_cast<uint32_t>(triangle) * scaleQ4) >> 12);
  return (warpAmountQ4 < 0) ? static_cast<uint16_t>(phase - offset)
                            : static_cast<uint16_t>(phase + offset);
}

inline uint16_t RAM_FUNC(applySynthDutyPhaseWarpQ4)(uint16_t phase, int16_t warpAmountQ4) {
  if (warpAmountQ4 == 0) {
    return phase;
  }
  uint16_t depthQ4 = static_cast<uint16_t>(warpAmountQ4 < 0 ? -warpAmountQ4 : warpAmountQ4);
  uint16_t offset = static_cast<uint16_t>(depthQ4 << 3);
  bool upperHalf = (phase & 0x8000u) != 0;
  bool addOffset = (warpAmountQ4 > 0) ? !upperHalf : upperHalf;
  return addOffset ? static_cast<uint16_t>(phase + offset)
                   : static_cast<uint16_t>(phase - offset);
}

inline uint16_t RAM_FUNC(applySynthPolyPhaseWarpQ4)(uint16_t phase, int16_t warpAmountQ4) {
  if (warpAmountQ4 == 0) {
    return phase;
  }
  uint16_t triangle = (phase & 0x8000) ? static_cast<uint16_t>(0xFFFFu - phase) : phase;
  uint16_t depthQ4 = static_cast<uint16_t>(warpAmountQ4 < 0 ? -warpAmountQ4 : warpAmountQ4);
  uint16_t curve = static_cast<uint16_t>(
    (static_cast<uint32_t>(triangle) * static_cast<uint32_t>(0x8000u - triangle)) >> 14);
  uint16_t offset = static_cast<uint16_t>((static_cast<uint32_t>(curve) * depthQ4) >> 11);
  return (warpAmountQ4 < 0) ? static_cast<uint16_t>(phase - offset)
                            : static_cast<uint16_t>(phase + offset);
}

inline uint16_t RAM_FUNC(readTriangleWaveSample)(uint16_t phase) {
  if (phase < 0x4000u) {
    return static_cast<uint16_t>(0x8000u + (phase << 1));
  }
  if (phase < 0xC000u) {
    return static_cast<uint16_t>(0xFFFFu - ((phase - 0x4000u) << 1));
  }
  return static_cast<uint16_t>((phase - 0xC000u) << 1);
}

inline uint16_t RAM_FUNC(readSquareWaveSample)(uint16_t phase) {
  constexpr int32_t split = 32768;
  if (phase == 0) {
    return 32768;
  }
  uint16_t shiftedPhase = static_cast<uint16_t>(phase + static_cast<uint16_t>(split));
  return (static_cast<int32_t>(shiftedPhase) > split) ? 65535 : 0;
}

inline uint16_t RAM_FUNC(readHybridWaveSample)(const oscillator& voice, uint8_t phaseIndex) {
  uint8_t rampWidth = (voice.b > voice.a) ? static_cast<uint8_t>(voice.b - voice.a) : 0;
  uint8_t crossingOffset = (rampWidth > 1) ? (rampWidth / 2) : 1;
  uint8_t crossingIndex = static_cast<uint8_t>(voice.a + crossingOffset);
  uint8_t t = static_cast<uint8_t>(phaseIndex + crossingIndex);
  if (phaseIndex == 0) {
    return 32768;
  }
  if (t <= voice.a) {
    return 0;
  }
  if (t < voice.b) {
    return static_cast<uint16_t>((t - voice.a) * voice.ab);
  }
  if (t <= voice.c) {
    return 65535;
  }
  return static_cast<uint16_t>((256 - t) * voice.cd);
}

inline uint8_t sample16ToWaveByte(uint16_t sample) {
  return static_cast<uint8_t>(sample >> 8);
}

uint8_t readCompatibilityWaveformSample(byte waveform, uint16_t sampleIndex) {
  const byte* source = synthWaveformSource(waveform);
  if (source) {
    return source[sampleIndex];
  }

  uint16_t phase = synthWavePhaseFromSampleIndex(sampleIndex);
  switch (waveform) {
    case WAVEFORM_TRIANGLE:
      return sample16ToWaveByte(readTriangleWaveSample(phase));
    case WAVEFORM_SAW:
      return sample16ToWaveByte(static_cast<uint16_t>(phase + 32768u));
    case WAVEFORM_SQUARE:
      return sample16ToWaveByte(readSquareWaveSample(phase));
    case WAVEFORM_HYBRID:
    case WAVEFORM_SINE:
    default:
      return waveSineSource[sampleIndex];
  }
}

void generateCompatibilitySynthWavetable(const BuiltinSynthWavetableDefinition& table) {
  const uint8_t anchorCount = std::max<uint8_t>(1, table.waveformCount);
  const uint16_t lastAnchorPosition = static_cast<uint16_t>(anchorCount - 1) << 8;
  for (uint8_t frameIndex = 0; frameIndex < SYNTH_WAVETABLE_FRAME_COUNT; ++frameIndex) {
    if (anchorCount == 1 || frameIndex == SYNTH_WAVETABLE_LAST_FRAME) {
      byte waveform = table.waveforms[anchorCount - 1];
      for (uint16_t sampleIndex = 0; sampleIndex < SYNTH_WAVE_SAMPLE_COUNT; ++sampleIndex) {
        activeSynthWaveTable[frameIndex][sampleIndex] = readCompatibilityWaveformSample(waveform, sampleIndex);
      }
      continue;
    }

    uint16_t anchorPosition = static_cast<uint16_t>(
      (static_cast<uint32_t>(frameIndex) * lastAnchorPosition) / SYNTH_WAVETABLE_LAST_FRAME
    );
    uint8_t anchorA = static_cast<uint8_t>(anchorPosition >> 8);
    uint8_t frameFrac = static_cast<uint8_t>(anchorPosition & 0xFF);
    uint8_t anchorB = static_cast<uint8_t>(std::min<uint8_t>(anchorA + 1, anchorCount - 1));
    for (uint16_t sampleIndex = 0; sampleIndex < SYNTH_WAVE_SAMPLE_COUNT; ++sampleIndex) {
      uint8_t sampleA = readCompatibilityWaveformSample(table.waveforms[anchorA], sampleIndex);
      uint8_t sampleB = readCompatibilityWaveformSample(table.waveforms[anchorB], sampleIndex);
      int16_t delta = static_cast<int16_t>(sampleB) - static_cast<int16_t>(sampleA);
      activeSynthWaveTable[frameIndex][sampleIndex] =
        static_cast<uint8_t>(static_cast<int16_t>(sampleA) + ((delta * static_cast<int16_t>(frameFrac)) >> 8));
    }
  }
  setActiveSynthWaveFrameCount(SYNTH_WAVETABLE_FRAME_COUNT);
}

void setCurrentSynthWavetableReference(const char* folderPath, const char* name) {
  const char* normalizedFolderPath = folderPath && folderPath[0] ? folderPath : SYNTH_WAVETABLE_ROOT_FOLDER;
  if (strcmp(normalizedFolderPath, "Built In") == 0
      || strcmp(normalizedFolderPath, "%2FBuilt In") == 0
      || strcmp(normalizedFolderPath, "%2fBuilt In") == 0) {
    normalizedFolderPath = SYNTH_WAVETABLE_BUILTIN_FOLDER;
  }
  snprintf(currentSynthWavetableFolderPath,
           sizeof(currentSynthWavetableFolderPath),
           "%s",
           normalizedFolderPath);
  snprintf(currentSynthWavetableName,
           sizeof(currentSynthWavetableName),
           "%s",
           name && name[0] ? name : SYNTH_WAVETABLE_BASIC_NAME);
  currentSynthWavetableReferenceValid = true;
}

bool legacyWaveformCompatibilityReference(byte waveform,
                                          const char*& folderPath,
                                          const char*& name,
                                          uint8_t& position) {
  for (size_t i = 0; i < synthBuiltinWavetableCount(); ++i) {
    const BuiltinSynthWavetableDefinition* table = synthBuiltinWavetableAt(i);
    if (!table) {
      continue;
    }
    for (uint8_t anchorIndex = 0; anchorIndex < table->waveformCount; ++anchorIndex) {
      if (table->waveforms[anchorIndex] == waveform) {
        folderPath = table->folderPath;
        name = table->name;
        position = compatibilityWavetablePositionForAnchor(anchorIndex, table->waveformCount);
        return true;
      }
    }
  }

  if (waveform == WAVEFORM_BASIC_WAVETABLE) {
    folderPath = SYNTH_WAVETABLE_BUILTIN_FOLDER;
    name = SYNTH_WAVETABLE_BASIC_NAME;
    position = synthWavetablePosition;
    return true;
  }
  if (waveform == WAVEFORM_USER_WAVETABLE) {
    folderPath = "/User";
    name = "UserTbl";
    position = synthWavetablePosition;
    return true;
  }

  folderPath = SYNTH_WAVETABLE_BUILTIN_FOLDER;
  name = SYNTH_WAVETABLE_BASIC_NAME;
  position = 0;
  return false;
}

void selectCompatibilitySynthWavetableForLegacyWaveform(byte waveform, bool updatePosition) {
  const char* folderPath = SYNTH_WAVETABLE_BUILTIN_FOLDER;
  const char* name = SYNTH_WAVETABLE_BASIC_NAME;
  uint8_t position = synthWavetablePosition;
  legacyWaveformCompatibilityReference(waveform, folderPath, name, position);
  setCurrentSynthWavetableReference(folderPath, name);
  if (updatePosition) {
    synthWavetablePosition = position;
  }
}

void selectFallbackSynthWavetable() {
  setCurrentSynthWavetableReference(SYNTH_WAVETABLE_BUILTIN_FOLDER, SYNTH_WAVETABLE_BASIC_NAME);
}

uint8_t readBasicWavetableAnchorSample(uint8_t anchor, uint16_t sampleIndex) {
  uint16_t phase = synthWavePhaseFromSampleIndex(sampleIndex);
  switch (anchor) {
    case 0:
      return waveSineSource[sampleIndex];
    case 1:
      return sample16ToWaveByte(readTriangleWaveSample(phase));
    case 2:
      return sample16ToWaveByte(static_cast<uint16_t>(phase + 32768u));
    case 3:
    default:
      return sample16ToWaveByte(readSquareWaveSample(phase));
  }
}

void fillGeneratedWaveFrame(byte waveform, uint8_t frameIndex) {
  byte* frame = activeSynthWaveTable[frameIndex];
  for (uint16_t sampleIndex = 0; sampleIndex < SYNTH_WAVE_SAMPLE_COUNT; ++sampleIndex) {
    uint16_t phase = synthWavePhaseFromSampleIndex(sampleIndex);
    switch (waveform) {
      case WAVEFORM_SQUARE:
        frame[sampleIndex] = sample16ToWaveByte(readSquareWaveSample(phase));
        break;
      case WAVEFORM_SAW:
        frame[sampleIndex] = sample16ToWaveByte(static_cast<uint16_t>(phase + 32768u));
        break;
      case WAVEFORM_TRIANGLE:
        frame[sampleIndex] = sample16ToWaveByte(readTriangleWaveSample(phase));
        break;
      case WAVEFORM_HYBRID:
      default:
        frame[sampleIndex] = waveSineSource[sampleIndex];
        break;
    }
  }
}

void generateBasicSynthWavetable() {
  constexpr uint8_t anchorCount = 4;
  constexpr uint16_t lastAnchorPosition = (anchorCount - 1) << 8;
  for (uint8_t frameIndex = 0; frameIndex < SYNTH_WAVETABLE_FRAME_COUNT; ++frameIndex) {
    if (frameIndex == SYNTH_WAVETABLE_LAST_FRAME) {
      for (uint16_t sampleIndex = 0; sampleIndex < SYNTH_WAVE_SAMPLE_COUNT; ++sampleIndex) {
        activeSynthWaveTable[frameIndex][sampleIndex] = readBasicWavetableAnchorSample(anchorCount - 1, sampleIndex);
      }
      continue;
    }
    uint16_t anchorPosition = static_cast<uint16_t>(
      (static_cast<uint32_t>(frameIndex) * lastAnchorPosition) / SYNTH_WAVETABLE_LAST_FRAME
    );
    uint8_t anchorA = static_cast<uint8_t>(anchorPosition >> 8);
    uint8_t frameFrac = static_cast<uint8_t>(anchorPosition & 0xFF);
    uint8_t anchorB = static_cast<uint8_t>(anchorA + 1);
    for (uint16_t sampleIndex = 0; sampleIndex < SYNTH_WAVE_SAMPLE_COUNT; ++sampleIndex) {
      uint8_t sampleA = readBasicWavetableAnchorSample(anchorA, sampleIndex);
      uint8_t sampleB = readBasicWavetableAnchorSample(anchorB, sampleIndex);
      int16_t delta = static_cast<int16_t>(sampleB) - static_cast<int16_t>(sampleA);
      activeSynthWaveTable[frameIndex][sampleIndex] =
        static_cast<uint8_t>(static_cast<int16_t>(sampleA) + ((delta * static_cast<int16_t>(frameFrac)) >> 8));
    }
  }
}

void loadFallbackUserSynthWavetable() {
  memcpy(activeSynthWaveTable[0], waveSineSource, SYNTH_WAVE_SAMPLE_COUNT);
  userSynthWavetableAvailable = false;
}

void rebuildSynthWavetableFramePositionLookup(uint8_t frameCount) {
  uint8_t boundedFrameCount = frameCount;
  if (boundedFrameCount < 1) {
    boundedFrameCount = 1;
  } else if (boundedFrameCount > SYNTH_WAVETABLE_FRAME_COUNT) {
    boundedFrameCount = SYNTH_WAVETABLE_FRAME_COUNT;
  }

  uint16_t lastFrame = static_cast<uint16_t>(boundedFrameCount - 1);
  for (uint8_t amount = 0; amount < 128; ++amount) {
    synthWavetableFramePositionByAmount[amount] =
      lastFrame == 0 ? 0 : static_cast<uint16_t>((static_cast<uint32_t>(amount) * lastFrame * 256u) / 127u);
  }
}

void setActiveSynthWaveFrameCount(uint8_t frameCount) {
  uint8_t boundedFrameCount = frameCount;
  if (boundedFrameCount < 1) {
    boundedFrameCount = 1;
  } else if (boundedFrameCount > SYNTH_WAVETABLE_FRAME_COUNT) {
    boundedFrameCount = SYNTH_WAVETABLE_FRAME_COUNT;
  }
  rebuildSynthWavetableFramePositionLookup(boundedFrameCount);
  __dmb();
  activeSynthWaveFrameCount = boundedFrameCount;
}

void initializeSynthFxModLookup() {
  for (uint8_t depth = 0; depth < 128; ++depth) {
    for (uint8_t value = 0; value < 128; ++value) {
      synthFxModScaleByDepth[depth][value] = static_cast<uint8_t>((static_cast<uint16_t>(value) * (static_cast<uint16_t>(depth) + 1u)) >> 7);
    }
  }
}

void initializeSynthWaveTables() {
  memcpy(synthVibratoSine, waveSineSource, SYNTH_WAVE_SAMPLE_COUNT);
  initializeSynthFxModLookup();
  initializeSynthPitchModLookup();
  setActiveSynthWaveFrameCount(1);
  resetSynthRenderCaches();
  loadedSynthWaveform = 255;
  loadedSynthWavetableName[0] = '\0';
  loadedSynthWavetableFolderPath[0] = '\0';
}

void loadSelectedSynthWavetable() {
  if (!currentSynthWavetableReferenceValid) {
    selectCompatibilitySynthWavetableForLegacyWaveform(currWave, false);
  }
  if (strncmp(loadedSynthWavetableName, currentSynthWavetableName, sizeof(loadedSynthWavetableName)) == 0
      && strncmp(loadedSynthWavetableFolderPath, currentSynthWavetableFolderPath, sizeof(loadedSynthWavetableFolderPath)) == 0) {
    return;
  }

  synthWaveTableLoadInProgress = true;
  bool loaded = false;
  int builtinIndex = findBuiltinSynthWavetable(currentSynthWavetableFolderPath, currentSynthWavetableName);
  const BuiltinSynthWavetableDefinition* builtinTable =
    builtinIndex >= 0 ? synthBuiltinWavetableAt(static_cast<size_t>(builtinIndex)) : nullptr;
  if (builtinTable) {
    generateCompatibilitySynthWavetable(*builtinTable);
    loaded = true;
  } else if (loadSynthWavetableFromCatalog(currentSynthWavetableFolderPath, currentSynthWavetableName)) {
    loaded = true;
  } else if (strcmp(currentSynthWavetableFolderPath, "/User") == 0
             && strcmp(currentSynthWavetableName, "UserTbl") == 0
             && loadUserSynthWavetableFromFile()) {
    loaded = true;
  } else {
    selectFallbackSynthWavetable();
    const BuiltinSynthWavetableDefinition* fallbackTable = synthBuiltinWavetableAt(0);
    if (fallbackTable) {
      generateCompatibilitySynthWavetable(*fallbackTable);
    } else {
      generateBasicSynthWavetable();
    }
    loaded = true;
  }

  if (loaded) {
    currWave = WAVEFORM_BASIC_WAVETABLE;
    snprintf(loadedSynthWavetableName, sizeof(loadedSynthWavetableName), "%s", currentSynthWavetableName);
    snprintf(loadedSynthWavetableFolderPath, sizeof(loadedSynthWavetableFolderPath), "%s", currentSynthWavetableFolderPath);
  }
  loadedSynthWaveform = currWave;
  resetSynthRenderCaches();
  synthWaveTableLoadInProgress = false;
}

void loadSelectedSynthWaveform() {
  currentSynthWavetableReferenceValid = false;
  selectCompatibilitySynthWavetableForLegacyWaveform(currWave, true);
  loadSelectedSynthWavetable();
}

inline uint16_t RAM_FUNC(wavetableFramePositionFromAmount)(int16_t positionAmount) {
  if (positionAmount <= 0) {
    return 0;
  }
  uint8_t amount = positionAmount > 127 ? 127 : static_cast<uint8_t>(positionAmount);
  return synthWavetableFramePositionByAmount[amount];
}

inline uint16_t RAM_FUNC(readLoadedWaveFrameSample)(uint16_t phase) {
  return static_cast<uint16_t>(activeSynthWaveTable[0][synthWaveSampleIndexFromPhase16(phase)] << 8);
}

struct SynthWavetableReadContext {
  const byte* frameA;
  const byte* frameB;
  uint8_t frameFrac;
};

struct SynthModulationAmounts {
  int16_t foldWarp = 0;
  int16_t dutyWarp = 0;
  int16_t polyWarp = 0;
  int16_t vibrato = 0;
  int16_t pitch = 0;
  int16_t wavetablePosition = 0;
};

struct SynthVoiceRenderCache {
  uint32_t phaseIncrement = 0;
  uint32_t phaseIncrementTarget = 0;
  int32_t phaseIncrementStep = 0;
  uint8_t phaseIncrementSlewSamples = 0;
  int16_t foldWarpAmountQ4 = 0;
  int16_t foldWarpAmountTargetQ4 = 0;
  int16_t foldWarpAmountStepQ4 = 0;
  int16_t dutyWarpAmountQ4 = 0;
  int16_t dutyWarpAmountTargetQ4 = 0;
  int16_t dutyWarpAmountStepQ4 = 0;
  int16_t polyWarpAmountQ4 = 0;
  int16_t polyWarpAmountTargetQ4 = 0;
  int16_t polyWarpAmountStepQ4 = 0;
  uint8_t warpSlewSamples = 0;
  SynthWavetableReadContext wavetableContext = { activeSynthWaveTable[0], nullptr, 0 };
};

SynthModulationAmounts synthBaseModulationCache = {};
std::array<SynthVoiceRenderCache, POLYPHONY_LIMIT> synthVoiceRenderCaches = {};
std::array<bool, POLYPHONY_LIMIT> synthVoiceRenderCacheValid = {};
SynthWavetableReadContext synthSharedWavetableReadContext = { activeSynthWaveTable[0], nullptr, 0 };
uint8_t synthControlSampleCountdown = 0;

inline void RAM_FUNC(resetSynthVoiceRenderCache)(uint8_t voiceIndex) {
  if (voiceIndex >= POLYPHONY_LIMIT) {
    return;
  }
  synthVoiceRenderCaches[voiceIndex] = {};
  synthVoiceRenderCacheValid[voiceIndex] = false;
}

void RAM_FUNC(resetSynthRenderCaches)() {
  synthBaseModulationCache = {};
  synthSharedWavetableReadContext = { activeSynthWaveTable[0], nullptr, 0 };
  synthControlSampleCountdown = 0;
  for (uint8_t voiceIndex = 0; voiceIndex < POLYPHONY_LIMIT; ++voiceIndex) {
    resetSynthVoiceRenderCache(voiceIndex);
  }
}

inline void RAM_FUNC(retargetSynthWarpSlew)(int16_t amountTarget,
                                            int16_t& amountQ4,
                                            int16_t& amountTargetQ4,
                                            int16_t& amountStepQ4,
                                            uint8_t elapsedTicks) {
  amountTargetQ4 = static_cast<int16_t>(amountTarget * 16);
  int16_t delta = static_cast<int16_t>(amountTargetQ4 - amountQ4);
  amountStepQ4 = static_cast<int16_t>(delta / static_cast<int16_t>(elapsedTicks));
  if (amountStepQ4 == 0 && delta != 0) {
    amountStepQ4 = (delta > 0) ? 1 : -1;
  }
}

inline void RAM_FUNC(snapSynthWarpSlew)(int16_t amountTarget,
                                        int16_t& amountQ4,
                                        int16_t& amountTargetQ4,
                                        int16_t& amountStepQ4) {
  amountTargetQ4 = static_cast<int16_t>(amountTarget * 16);
  amountQ4 = amountTargetQ4;
  amountStepQ4 = 0;
}

inline void RAM_FUNC(advanceSynthWarpSlew)(int16_t& amountQ4,
                                           int16_t amountTargetQ4,
                                           int16_t amountStepQ4,
                                           bool finalSample) {
  if (finalSample) {
    amountQ4 = amountTargetQ4;
    return;
  }
  int16_t next = static_cast<int16_t>(amountQ4 + amountStepQ4);
  if ((amountStepQ4 > 0 && next > amountTargetQ4)
      || (amountStepQ4 < 0 && next < amountTargetQ4)) {
    next = amountTargetQ4;
  }
  amountQ4 = next;
}

inline void RAM_FUNC(retargetSynthVoiceSlews)(SynthVoiceRenderCache& cache,
                                              uint32_t phaseIncrementTarget,
                                              const SynthModulationAmounts& voiceModulation,
                                              uint8_t elapsedTicks,
                                              bool snap) {
  if (snap || elapsedTicks == 0) {
    cache.phaseIncrement = phaseIncrementTarget;
    cache.phaseIncrementTarget = phaseIncrementTarget;
    cache.phaseIncrementStep = 0;
    cache.phaseIncrementSlewSamples = 0;
    snapSynthWarpSlew(voiceModulation.foldWarp,
                      cache.foldWarpAmountQ4,
                      cache.foldWarpAmountTargetQ4,
                      cache.foldWarpAmountStepQ4);
    snapSynthWarpSlew(voiceModulation.dutyWarp,
                      cache.dutyWarpAmountQ4,
                      cache.dutyWarpAmountTargetQ4,
                      cache.dutyWarpAmountStepQ4);
    snapSynthWarpSlew(voiceModulation.polyWarp,
                      cache.polyWarpAmountQ4,
                      cache.polyWarpAmountTargetQ4,
                      cache.polyWarpAmountStepQ4);
    cache.warpSlewSamples = 0;
    return;
  }

  cache.phaseIncrementTarget = phaseIncrementTarget;
  if (phaseIncrementTarget >= cache.phaseIncrement) {
    uint32_t difference = phaseIncrementTarget - cache.phaseIncrement;
    uint32_t step = (elapsedTicks == 8)
                      ? (difference >> 3)
                      : (difference / elapsedTicks);
    if (step == 0 && difference != 0) {
      step = 1;
    }
    cache.phaseIncrementStep = static_cast<int32_t>(
      step > static_cast<uint32_t>(std::numeric_limits<int32_t>::max())
        ? static_cast<uint32_t>(std::numeric_limits<int32_t>::max())
        : step);
  } else {
    uint32_t difference = cache.phaseIncrement - phaseIncrementTarget;
    uint32_t step = (elapsedTicks == 8)
                      ? (difference >> 3)
                      : (difference / elapsedTicks);
    if (step == 0 && difference != 0) {
      step = 1;
    }
    cache.phaseIncrementStep = -static_cast<int32_t>(
      step > static_cast<uint32_t>(std::numeric_limits<int32_t>::max())
        ? static_cast<uint32_t>(std::numeric_limits<int32_t>::max())
        : step);
  }
  cache.phaseIncrementSlewSamples = elapsedTicks;

  retargetSynthWarpSlew(voiceModulation.foldWarp,
                        cache.foldWarpAmountQ4,
                        cache.foldWarpAmountTargetQ4,
                        cache.foldWarpAmountStepQ4,
                        elapsedTicks);
  retargetSynthWarpSlew(voiceModulation.dutyWarp,
                        cache.dutyWarpAmountQ4,
                        cache.dutyWarpAmountTargetQ4,
                        cache.dutyWarpAmountStepQ4,
                        elapsedTicks);
  retargetSynthWarpSlew(voiceModulation.polyWarp,
                        cache.polyWarpAmountQ4,
                        cache.polyWarpAmountTargetQ4,
                        cache.polyWarpAmountStepQ4,
                        elapsedTicks);
  cache.warpSlewSamples = elapsedTicks;
}

inline void RAM_FUNC(advanceSynthVoiceSlews)(SynthVoiceRenderCache& cache) {
  if (cache.phaseIncrementSlewSamples != 0) {
    --cache.phaseIncrementSlewSamples;
    if (cache.phaseIncrementSlewSamples == 0) {
      cache.phaseIncrement = cache.phaseIncrementTarget;
    } else if (cache.phaseIncrementStep > 0) {
      uint32_t step = static_cast<uint32_t>(cache.phaseIncrementStep);
      uint32_t remaining = cache.phaseIncrementTarget - cache.phaseIncrement;
      cache.phaseIncrement += (step >= remaining) ? remaining : step;
    } else if (cache.phaseIncrementStep < 0) {
      uint32_t step = static_cast<uint32_t>(-cache.phaseIncrementStep);
      uint32_t remaining = cache.phaseIncrement - cache.phaseIncrementTarget;
      cache.phaseIncrement -= (step >= remaining) ? remaining : step;
    } else {
      cache.phaseIncrement = cache.phaseIncrementTarget;
    }
  }

  if (cache.warpSlewSamples != 0) {
    --cache.warpSlewSamples;
    bool finalSample = cache.warpSlewSamples == 0;
    advanceSynthWarpSlew(cache.foldWarpAmountQ4,
                         cache.foldWarpAmountTargetQ4,
                         cache.foldWarpAmountStepQ4,
                         finalSample);
    advanceSynthWarpSlew(cache.dutyWarpAmountQ4,
                         cache.dutyWarpAmountTargetQ4,
                         cache.dutyWarpAmountStepQ4,
                         finalSample);
    advanceSynthWarpSlew(cache.polyWarpAmountQ4,
                         cache.polyWarpAmountTargetQ4,
                         cache.polyWarpAmountStepQ4,
                         finalSample);
  }
}

inline SynthWavetableReadContext RAM_FUNC(wavetableReadContextFromFramePosition)(uint16_t framePosition,
                                                                                 uint8_t frameCount) {
  if (frameCount <= 1) {
    return { activeSynthWaveTable[0], nullptr, 0 };
  }

  uint8_t frameIndex = static_cast<uint8_t>(framePosition >> 8);
  uint8_t frameFrac = static_cast<uint8_t>(framePosition & 0xFF);
  uint8_t maxFrameIndex = static_cast<uint8_t>(frameCount - 1);
  if (frameIndex >= maxFrameIndex) {
    return { activeSynthWaveTable[maxFrameIndex], nullptr, 0 };
  }
  if (frameFrac == 0) {
    return { activeSynthWaveTable[frameIndex], nullptr, 0 };
  }
  return { activeSynthWaveTable[frameIndex], activeSynthWaveTable[frameIndex + 1], frameFrac };
}

inline uint16_t RAM_FUNC(readActiveWavetableSampleWithContext)(uint16_t phase,
                                                               const SynthWavetableReadContext& context) {
  uint16_t sampleIndex = synthWaveSampleIndexFromPhase16(phase);
  int16_t sampleA = context.frameA[sampleIndex];
  if (!context.frameB) {
    return static_cast<uint16_t>(sampleA << 8);
  }
  int16_t sampleB = context.frameB[sampleIndex];
  return static_cast<uint16_t>((sampleA << 8) + ((sampleB - sampleA) * static_cast<int16_t>(context.frameFrac)));
}

inline uint16_t RAM_FUNC(readActiveWavetableSampleAtFramePosition)(uint16_t phase,
                                                                   uint16_t framePosition,
                                                                   uint8_t frameCount) {
  return readActiveWavetableSampleWithContext(phase, wavetableReadContextFromFramePosition(framePosition, frameCount));
}

inline uint16_t RAM_FUNC(readActiveWavetableSample)(uint16_t phase,
                                                    int16_t positionAmount,
                                                    uint8_t frameCount) {
  return readActiveWavetableSampleAtFramePosition(phase, wavetableFramePositionFromAmount(positionAmount), frameCount);
}

inline int16_t RAM_FUNC(clampSynthModAccumulator)(int16_t value) {
  if (value > 127) {
    return 127;
  }
  if (value < -127) {
    return -127;
  }
  return value;
}

inline int16_t RAM_FUNC(clampSynthPitchModAccumulatorQ4)(int16_t valueQ4) {
  if (valueQ4 > SYNTH_PITCH_MOD_MAX_Q4) {
    return SYNTH_PITCH_MOD_MAX_Q4;
  }
  if (valueQ4 < -SYNTH_PITCH_MOD_MAX_Q4) {
    return -SYNTH_PITCH_MOD_MAX_Q4;
  }
  return valueQ4;
}

inline void RAM_FUNC(addSynthPitchTargetAmountQ4)(int16_t amountQ4,
                                                  int16_t& pitchAmountQ4) {
  if (amountQ4 == 0) {
    return;
  }
  pitchAmountQ4 = clampSynthPitchModAccumulatorQ4(static_cast<int16_t>(pitchAmountQ4 + amountQ4));
}

inline int16_t RAM_FUNC(combinedWavetablePositionAmount)(int16_t positionModAmount) {
  int16_t amount = static_cast<int16_t>(synthWavetablePosition) + positionModAmount;
  if (amount > 127) {
    return 127;
  }
  if (amount < 0) {
    return 0;
  }
  return amount;
}

inline int16_t RAM_FUNC(readSynthLfoSample)() {
  uint16_t sinePhase = synthWaveSampleIndexFromPhase32(synthLfoPhase);
  uint8_t phase = synthLfoPhase >> 24;
  switch (synthLfoWave) {
    case SYNTH_LFO_WAVE_TRIANGLE:
      if (phase < 64) {
        return static_cast<int16_t>(phase * 2);
      }
      if (phase < 128) {
        return static_cast<int16_t>(127 - ((phase - 64) * 2));
      }
      if (phase < 192) {
        return static_cast<int16_t>(-((phase - 128) * 2));
      }
      return static_cast<int16_t>(-127 + ((phase - 192) * 2));
    case SYNTH_LFO_WAVE_SAW:
      return static_cast<int16_t>(phase) - 128;
    case SYNTH_LFO_WAVE_SQUARE:
      return (phase < 128) ? 127 : -127;
    case SYNTH_LFO_WAVE_SINE:
    default:
      return static_cast<int16_t>(synthVibratoSine[sinePhase]) - 128;
  }
}

inline int16_t RAM_FUNC(synthLfoModValue)(uint8_t elapsedTicks = 1) {
  int16_t depth = synthEffectAmountDepth(synthLfoAmount);
  if (depth == 0) {
    return 0;
  }
  synthLfoPhase += synthLfoPhaseIncrement * static_cast<uint32_t>(elapsedTicks ? elapsedTicks : 1);
  int16_t sample = readSynthLfoSample();
  int32_t scaled = static_cast<int32_t>(sample) * static_cast<int32_t>(depth);
  return static_cast<int16_t>(scaled >> 7);
}

inline int16_t RAM_FUNC(synthLfoPitchModValueQ4)(uint8_t elapsedTicks = 1) {
  int16_t depth = synthEffectAmountDepth(synthLfoAmount);
  if (depth == 0) {
    return 0;
  }
  synthLfoPhase += synthLfoPhaseIncrement * static_cast<uint32_t>(elapsedTicks ? elapsedTicks : 1);
  int16_t sample = readSynthLfoSample();
  int32_t scaledQ4 = static_cast<int32_t>(sample) * static_cast<int32_t>(depth);
  return clampSynthPitchModAccumulatorQ4(static_cast<int16_t>(scaledQ4 >> 3));
}

inline void RAM_FUNC(addSynthTargetAmount)(uint8_t target,
                                           int16_t amount,
                                           int16_t& foldWarpAmount,
                                           int16_t& dutyWarpAmount,
                                           int16_t& polyWarpAmount,
                                           int16_t& vibratoAmount,
                                           int16_t& pitchAmount,
                                           int16_t& wavetablePositionAmount) {
  if (amount == 0) {
    return;
  }
  int16_t* destination = nullptr;
  switch (target) {
    case SYNTH_MOD_TARGET_FOLD_WARP:
      destination = &foldWarpAmount;
      break;
    case SYNTH_MOD_TARGET_DUTY_WARP:
      destination = &dutyWarpAmount;
      break;
    case SYNTH_MOD_TARGET_POLY_WARP:
      destination = &polyWarpAmount;
      break;
    case SYNTH_MOD_TARGET_VIBRATO:
      destination = &vibratoAmount;
      break;
    case SYNTH_MOD_TARGET_PITCH:
      addSynthPitchTargetAmountQ4(static_cast<int16_t>(amount * SYNTH_PITCH_MOD_Q4_SCALE), pitchAmount);
      return;
    case SYNTH_MOD_TARGET_WAVETABLE_POSITION:
      destination = &wavetablePositionAmount;
      break;
    default:
      return;
  }
  *destination = clampSynthModAccumulator(static_cast<int16_t>(*destination + amount));
}

constexpr uint32_t RAM_FUNC(SYNTH_PITCH_MOD_POSITIVE_Q16)[128] = {
  65536, 66982, 68461, 69972, 71516, 73095, 74708, 76357,
  78042, 79765, 81525, 83325, 85164, 87043, 88965, 90928,
  92935, 94986, 97083, 99226, 101416, 103654, 105942, 108280,
  110670, 113113, 115609, 118161, 120769, 123434, 126159, 128943,
  131789, 134698, 137671, 140710, 143815, 146990, 150234, 153550,
  156939, 160403, 163943, 167561, 171260, 175040, 178903, 182852,
  186888, 191012, 195228, 199537, 203941, 208443, 213043, 217746,
  222551, 227464, 232484, 237615, 242860, 248220, 253699, 259298,
  265021, 270871, 276849, 282960, 289205, 295588, 302112, 308780,
  315595, 322561, 329680, 336957, 344394, 351995, 359764, 367705,
  375821, 384116, 392594, 401259, 410115, 419167, 428419, 437874,
  447539, 457417, 467513, 477831, 488378, 499157, 510174, 521434,
  532943, 544706, 556728, 569016, 581575, 594411, 607531, 620940,
  634645, 648653, 662969, 677602, 692558, 707843, 723467, 739435,
  755755, 772436, 789484, 806909, 824719, 842922, 861526, 880542,
  899976, 919840, 940142, 960893, 982101, 1003777, 1025932, 1048576
};

constexpr uint32_t RAM_FUNC(SYNTH_PITCH_MOD_NEGATIVE_Q16)[128] = {
  65536, 64121, 62736, 61381, 60056, 58759, 57490, 56249,
  55034, 53845, 52683, 51545, 50432, 49343, 48277, 47235,
  46215, 45217, 44240, 43285, 42350, 41436, 40541, 39665,
  38809, 37971, 37151, 36348, 35564, 34796, 34044, 33309,
  32590, 31886, 31197, 30524, 29864, 29220, 28589, 27971,
  27367, 26776, 26198, 25632, 25079, 24537, 24007, 23489,
  22982, 22485, 22000, 21525, 21060, 20605, 20160, 19725,
  19299, 18882, 18474, 18075, 17685, 17303, 16929, 16564,
  16206, 15856, 15514, 15179, 14851, 14530, 14216, 13909,
  13609, 13315, 13028, 12746, 12471, 12202, 11938, 11680,
  11428, 11181, 10940, 10704, 10473, 10246, 10025, 9809,
  9597, 9390, 9187, 8988, 8794, 8604, 8419, 8237,
  8059, 7885, 7715, 7548, 7385, 7226, 7070, 6917,
  6768, 6621, 6478, 6338, 6202, 6068, 5937, 5808,
  5683, 5560, 5440, 5323, 5208, 5095, 4985, 4878,
  4772, 4669, 4568, 4470, 4373, 4279, 4186, 4096
};

uint32_t interpolatedSynthPitchRatioFromBaseTable(const uint32_t* table, uint16_t halfRangeDepthQ4) {
  uint8_t index = static_cast<uint8_t>(halfRangeDepthQ4 >> 4);
  uint8_t frac = static_cast<uint8_t>(halfRangeDepthQ4 & 0x0F);
  uint32_t ratioA = table[index];
  if (frac == 0) {
    return ratioA;
  }
  uint32_t ratioB = table[index + 1];
  int32_t delta = static_cast<int32_t>(ratioB) - static_cast<int32_t>(ratioA);
  return static_cast<uint32_t>(static_cast<int32_t>(ratioA) + ((delta * static_cast<int32_t>(frac)) >> 4));
}

void initializeSynthPitchModLookup() {
  for (uint16_t depthQ4 = 0; depthQ4 < SYNTH_PITCH_MOD_RATIO_Q4_COUNT; ++depthQ4) {
    synthPitchModPositiveQ16ByQ4[depthQ4] =
      interpolatedSynthPitchRatioFromBaseTable(SYNTH_PITCH_MOD_POSITIVE_Q16, depthQ4);
    synthPitchModNegativeQ16ByQ4[depthQ4] =
      interpolatedSynthPitchRatioFromBaseTable(SYNTH_PITCH_MOD_NEGATIVE_Q16, depthQ4);
  }
}

inline uint32_t RAM_FUNC(synthPitchRatioQ16FromAmountQ4)(int16_t pitchAmountQ4) {
  uint16_t depthQ4 = static_cast<uint16_t>(pitchAmountQ4 > 0 ? pitchAmountQ4 : -pitchAmountQ4);
  if (depthQ4 > SYNTH_PITCH_MOD_MAX_Q4) {
    depthQ4 = SYNTH_PITCH_MOD_MAX_Q4;
  }
  uint16_t halfRangeDepthQ4 = depthQ4 >> 1;
  return (pitchAmountQ4 > 0) ? synthPitchModPositiveQ16ByQ4[halfRangeDepthQ4]
                             : synthPitchModNegativeQ16ByQ4[halfRangeDepthQ4];
}

inline uint32_t RAM_FUNC(applySynthPitchMod)(uint32_t increment, int16_t pitchAmountQ4) {
  if (pitchAmountQ4 == 0) {
    return increment;
  }
  uint32_t ratioQ16 = synthPitchRatioQ16FromAmountQ4(pitchAmountQ4);
  uint64_t scaled = (static_cast<uint64_t>(increment) * ratioQ16) >> 16;
  if (scaled > std::numeric_limits<uint32_t>::max()) {
    return std::numeric_limits<uint32_t>::max();
  }
  return static_cast<uint32_t>(scaled);
}

inline bool RAM_FUNC(synthControlTickDue)() {
  if (synthControlSampleCountdown == 0) {
    synthControlSampleCountdown = SYNTH_CONTROL_RATE_SAMPLES - 1;
    return true;
  }
  --synthControlSampleCountdown;
  return false;
}

inline void RAM_FUNC(refreshSynthBaseModulationCache)(uint8_t elapsedTicks) {
  synthBaseModulationCache = {};
  const uint8_t synthModValue = scaleSynthModAmount(smoothedSynthModValue(elapsedTicks));
  if (synthModTarget == SYNTH_MOD_TARGET_PITCH) {
    addSynthPitchTargetAmountQ4(static_cast<int16_t>(synthModValue * SYNTH_PITCH_MOD_Q4_SCALE),
                                synthBaseModulationCache.pitch);
  } else {
    addSynthTargetAmount(synthModTarget,
                         synthModValue,
                         synthBaseModulationCache.foldWarp,
                         synthBaseModulationCache.dutyWarp,
                         synthBaseModulationCache.polyWarp,
                         synthBaseModulationCache.vibrato,
                         synthBaseModulationCache.pitch,
                         synthBaseModulationCache.wavetablePosition);
  }
  if (synthLfoTarget == SYNTH_MOD_TARGET_PITCH) {
    addSynthPitchTargetAmountQ4(synthLfoPitchModValueQ4(elapsedTicks),
                                synthBaseModulationCache.pitch);
  } else {
    addSynthTargetAmount(synthLfoTarget,
                         synthLfoModValue(elapsedTicks),
                         synthBaseModulationCache.foldWarp,
                         synthBaseModulationCache.dutyWarp,
                         synthBaseModulationCache.polyWarp,
                         synthBaseModulationCache.vibrato,
                         synthBaseModulationCache.pitch,
                         synthBaseModulationCache.wavetablePosition);
  }
}

inline void RAM_FUNC(advanceSynthFrequencyControl)(uint8_t voiceIndex, uint8_t elapsedTicks) {
  if (elapsedTicks == 0) {
    return;
  }

  oscillator& voice = synth[voiceIndex];
  uint8_t remainingTicks = elapsedTicks;
  if (voice.glideSamplesRemaining > 0) {
    uint32_t glideTicks = voice.glideSamplesRemaining < remainingTicks
                            ? voice.glideSamplesRemaining
                            : remainingTicks;
    uint64_t step = static_cast<uint64_t>(voice.glideStep ? voice.glideStep : 1) * glideTicks;
    if (voice.targetIncrement > voice.increment) {
      uint32_t remaining = voice.targetIncrement - voice.increment;
      voice.increment += static_cast<uint32_t>(step >= remaining ? remaining : step);
    } else if (voice.targetIncrement < voice.increment) {
      uint32_t remaining = voice.increment - voice.targetIncrement;
      voice.increment -= static_cast<uint32_t>(step >= remaining ? remaining : step);
    }

    voice.glideSamplesRemaining -= glideTicks;
    remainingTicks = static_cast<uint8_t>(remainingTicks - glideTicks);
    if (voice.glideSamplesRemaining == 0 || voice.increment == voice.targetIncrement) {
      voice.increment = voice.targetIncrement;
      clearSynthPortamento(voiceIndex);
    }
  }

  if (remainingTicks != 0) {
    smoothUint32Toward(voice.increment, voice.targetIncrement, SYNTH_PITCH_SMOOTH_SHIFT, remainingTicks);
  }
}

inline void RAM_FUNC(refreshSynthVoiceRenderCache)(uint8_t voiceIndex,
                                                   uint8_t elapsedTicks,
                                                   bool activeWavetableHasFrames,
                                                   bool perVoiceWavetablePosition,
                                                   uint8_t activeWaveFrameCount,
                                                   bool& synthVibratoSampleReady,
                                                   int16_t& synthVibratoSample) {
  SynthModulationAmounts voiceModulation = synthBaseModulationCache;
  for (uint8_t envelopeIndex = 0; envelopeIndex < SYNTH_FX_ENVELOPE_COUNT; ++envelopeIndex) {
    refreshCachedEffectEnvelopeModValue(envelopeIndex, voiceIndex, elapsedTicks);
    if (synthEffectEnvelopeActive[envelopeIndex]) {
      if (effectEnvelopeTarget[envelopeIndex] == SYNTH_MOD_TARGET_PITCH) {
        addSynthPitchTargetAmountQ4(effectEnvelopePitchModValueQ4(envelopeIndex,
                                                                  effectEnvelopeStates[envelopeIndex][voiceIndex]),
                                    voiceModulation.pitch);
      } else {
        addSynthTargetAmount(effectEnvelopeTarget[envelopeIndex],
                             cachedEffectEnvelopeModValues[envelopeIndex][voiceIndex],
                             voiceModulation.foldWarp,
                             voiceModulation.dutyWarp,
                             voiceModulation.polyWarp,
                             voiceModulation.vibrato,
                             voiceModulation.pitch,
                             voiceModulation.wavetablePosition);
      }
    }
  }

  advanceSynthFrequencyControl(voiceIndex, elapsedTicks);

  uint32_t phaseIncrement = synth[voiceIndex].increment;
  if (voiceModulation.pitch != 0) {
    phaseIncrement = applySynthPitchMod(phaseIncrement, voiceModulation.pitch);
  }
  if (voiceModulation.vibrato != 0) {
    if (!synthVibratoSampleReady) {
      if (elapsedTicks != 0) {
        synthVibratoPhase += synthVibratoPhaseIncrement * static_cast<uint32_t>(elapsedTicks);
      }
      synthVibratoSample =
        static_cast<int16_t>(synthVibratoSine[synthWaveSampleIndexFromPhase32(synthVibratoPhase)]) - 128;
      synthVibratoSampleReady = true;
    }
    int16_t voiceVibratoAmount = synthVibratoSample * voiceModulation.vibrato;
    if (voiceVibratoAmount != 0) {
      phaseIncrement = applySynthVibrato(phaseIncrement, voiceVibratoAmount);
    }
  }

  SynthVoiceRenderCache& cache = synthVoiceRenderCaches[voiceIndex];
  retargetSynthVoiceSlews(cache,
                          phaseIncrement,
                          voiceModulation,
                          elapsedTicks,
                          elapsedTicks == 0 || !synthVoiceRenderCacheValid[voiceIndex]);
  if (activeWavetableHasFrames) {
    cache.wavetableContext = perVoiceWavetablePosition
                               ? wavetableReadContextFromFramePosition(
                                   wavetableFramePositionFromAmount(
                                     combinedWavetablePositionAmount(voiceModulation.wavetablePosition)),
                                   activeWaveFrameCount)
                               : synthSharedWavetableReadContext;
  } else {
    cache.wavetableContext = { activeSynthWaveTable[0], nullptr, 0 };
  }
  synthVoiceRenderCacheValid[voiceIndex] = true;
}

inline int32_t RAM_FUNC(readMetronomeBeepSample)() {
  uint16_t remaining = metronomeBeepSamplesRemaining;
  if (remaining == 0) {
    return 0;
  }

  metronomeBeepSamplesRemaining = remaining - 1;
  metronomeBeepPhase += metronomeBeepPhaseIncrement;
  int32_t sample = (metronomeBeepPhase & 0x80000000u) ? METRONOME_BEEP_LEVEL : -METRONOME_BEEP_LEVEL;
  return (sample * static_cast<int32_t>(velWheel.curValue)) >> 7;
}

bool RAM_FUNC(metronomeBrightnessSelected)() {
  return metronomeMode == METRONOME_MODE_BRIGHTNESS;
}

bool RAM_FUNC(metronomeSideButtonsSelected)() {
  return metronomeMode == METRONOME_MODE_SIDE_BUTTONS;
}

inline bool RAM_FUNC(metronomeBeepSelected)() {
  return metronomeMode == METRONOME_MODE_BEEP;
}

inline bool RAM_FUNC(metronomeEnabled)() {
  return metronomeMode != METRONOME_MODE_OFF;
}

bool RAM_FUNC(metronomeVisualFlashActive)() {
  return (metronomeBrightnessSelected() || metronomeSideButtonsSelected()) && runTime < metronomeVisualFlashUntil;
}

void RAM_FUNC(resetMetronomeState)() {
  metronomeBeatCursor = 0;
  metronomeNextBeatTime = 0;
  metronomeVisualFlashUntil = 0;
  metronomeAccent = false;
  metronomeBeepSamplesRemaining = 0;
}

void updateMetronomeTiming() {
  if (metronomeMode > METRONOME_MODE_SIDE_BUTTONS) {
    metronomeMode = METRONOME_MODE_OFF;
  }
  if (metronomeSignatureIndex >= METRONOME_SIGNATURE_COUNT) {
    metronomeSignatureIndex = 0;
  }

  const MetronomeSignature& signature = metronomeSignatures[metronomeSignatureIndex];
  metronomeBeatsPerMeasure = signature.beats ? signature.beats : 1;
  uint8_t noteValue = signature.noteValue ? signature.noteValue : 4;

  uint32_t bpm = synthBPM;
  if (bpm == 0) {
    bpm = 1;
  }
  uint64_t wholeNoteMicros = (240000000ULL + (bpm / 2)) / bpm;
  metronomeBeatIntervalMicros = (wholeNoteMicros + (noteValue / 2)) / noteValue;
  if (metronomeBeatIntervalMicros == 0) {
    metronomeBeatIntervalMicros = 1;
  }
  resetMetronomeState();
}

void RAM_FUNC(triggerMetronomeBeat)(bool accent) {
  constexpr uint64_t METRONOME_VISUAL_FLASH_MICROS = 125000;
  metronomeAccent = accent;

  if (metronomeBrightnessSelected() || metronomeSideButtonsSelected()) {
    metronomeVisualFlashUntil = runTime + METRONOME_VISUAL_FLASH_MICROS;
  }
  if (metronomeBeepSelected()) {
    metronomeBeepPhaseIncrement = accent ? METRONOME_BEEP_ACCENT_INCREMENT : METRONOME_BEEP_NORMAL_INCREMENT;
    metronomeBeepSamplesRemaining = METRONOME_BEEP_SAMPLE_COUNT;
  }
}

void RAM_FUNC(runMetronome)() {
  if (!metronomeEnabled() || delegatedControl) {
    return;
  }

  if (metronomeNextBeatTime == 0) {
    metronomeNextBeatTime = runTime;
  }

  while (runTime >= metronomeNextBeatTime) {
    bool accent = (metronomeBeatCursor == 0);
    triggerMetronomeBeat(accent);
    metronomeBeatCursor = static_cast<uint8_t>((metronomeBeatCursor + 1) % metronomeBeatsPerMeasure);
    metronomeNextBeatTime += metronomeBeatIntervalMicros;
  }
}

void metronomeModeChanged() {
  resetMetronomeState();
}

void updateArpeggiatorTiming() {
  uint32_t bpm = synthBPM;
  if (bpm == 0) {
    bpm = 1;
  }
  uint32_t division = arpeggiatorDivision;
  if (division == 0) {
    division = 1;
  }

  const uint64_t wholeNoteMicros = (240000000ULL + (bpm / 2)) / bpm;  // four quarter notes in microseconds
  arpeggiateLength = (wholeNoteMicros + (division / 2)) / division;
  if (arpeggiateLength == 0) {
    arpeggiateLength = 1;
  }
  updateMetronomeTiming();
}

void updateArpeggiatorDirection() {
  if (arpeggiatorDirection >= ARP_DIRECTION_COUNT) {
    arpeggiatorDirection = ARP_DIRECTION_UP;
  }
  arpeggiatorSequenceCursor = 0;
}

AudioOutputLevels RAM_FUNC(renderAudioOutputLevels)() {
  AudioOutputLevels output;
  if (flashWriteInProgress.load(std::memory_order_relaxed) || synthWaveTableLoadInProgress) {
    return output;
  }
  int32_t mix = 0;    // signed accumulator stays well within int32_t bounds
  const int32_t metronomeSample = readMetronomeBeepSample();
  const bool metronomeAudible = metronomeSample != 0;
  const bool synthControlTick = synthControlTickDue();
  if (synthControlTick) {
    refreshSynthBaseModulationCache(SYNTH_CONTROL_RATE_SAMPLES);
  }
  int16_t synthVibratoSample = 0;
  bool synthVibratoSampleReady = false;
  // ============================================================
  // Smooth poly loudness normalization
  // Old behavior: scale by integer "voices" count.
  // Problem: when a voice fades out and becomes inactive, voices--
  // causes a sudden gain jump (audible).
  //
  // New behavior: compute an "effective voice count" from the sum of
  // envelope levels. As a voice releases, its envelope contribution
  // smoothly approaches 0, so the normalization changes smoothly too.
  // ============================================================
  uint32_t envSum = 0;   // sum of audible envelope levels across active voices (0..8*65535)
  byte voices = 0;
  uint8_t profileFlags = 0;

  uint16_t p;
  byte t;
  const uint8_t voiceLimit = currentSynthVoiceLimit();
  const uint8_t activeWaveFrameCount = activeSynthWaveFrameCount;
  const bool activeWavetableHasFrames = activeWaveFrameCount > 1;
  const bool perVoiceWavetablePosition =
    activeWavetableHasFrames
    && ((synthEffectEnvelopeActive[0] && effectEnvelopeTarget[0] == SYNTH_MOD_TARGET_WAVETABLE_POSITION)
        || (synthEffectEnvelopeActive[1] && effectEnvelopeTarget[1] == SYNTH_MOD_TARGET_WAVETABLE_POSITION));
  if (synthControlTick) {
    synthSharedWavetableReadContext =
      (activeWavetableHasFrames && !perVoiceWavetablePosition)
        ? wavetableReadContextFromFramePosition(
            wavetableFramePositionFromAmount(
              combinedWavetablePositionAmount(synthBaseModulationCache.wavetablePosition)),
            activeWaveFrameCount)
        : SynthWavetableReadContext{ activeSynthWaveTable[0], nullptr, 0 };
  }
  for (byte i = 0; i < voiceLimit; i++) {
    EnvelopeState& env = envelopeStates[i];
    bool forceVoiceRenderCacheRefresh = false;

    EnvelopeCommand pendingCommand = consumeEnvelopeCommand(i);
    switch (pendingCommand) {
      case EnvelopeCommand::StartAttack: {
        resetSynthVoiceRenderCache(i);
        forceVoiceRenderCacheRefresh = true;
        env.releaseIncrement = 0;
        env.holdTicksRemaining = 0;
        if (envelopeParams.attackTicks == 0) {
          advanceEnvelopeFromAttackPeak(envelopeParams, env);
        } else {
          env.stage = EnvelopeStage::Attack;
          env.level = 0;
        }
        for (uint8_t envelopeIndex = 0; envelopeIndex < SYNTH_FX_ENVELOPE_COUNT; ++envelopeIndex) {
          EnvelopeState& effectEnv = effectEnvelopeStates[envelopeIndex][i];
          resetCachedEffectEnvelopeModValue(envelopeIndex, i);
          if (synthEffectEnvelopeActive[envelopeIndex]) {
            startEffectEnvelopeAttack(envelopeIndex, effectEnv);
          } else {
            resetEnvelopeState(effectEnv);
          }
        }
        break;
      }
      case EnvelopeCommand::StartRelease: {
        resetSynthVoiceRenderCache(i);
        forceVoiceRenderCacheRefresh = true;
        releaseRetries[i] = 0;
        releaseRetryCountdown[i] = 0;
        if (envelopeParams.releaseTicks == 0 || env.level == 0) {
          env.level = 0;
          env.stage = EnvelopeStage::Idle;
          synth[i].increment = 0;
          synth[i].targetIncrement = 0;
          synth[i].counter = 0;
          clearSynthPortamento(i);
          resetSynthVoiceRenderCache(i);
          publishVoiceFreed(i);
        } else {
          env.stage = EnvelopeStage::Release;
          profileFlags |= ISR_PROFILE_FLAG_RELEASE_START;
          if (isrProfilingEnabled) {
            isrCycleReleaseStartCount++;
          }
          env.releaseIncrement = releaseIncrementForLevel(env.level);
        }
        for (uint8_t envelopeIndex = 0; envelopeIndex < SYNTH_FX_ENVELOPE_COUNT; ++envelopeIndex) {
          EnvelopeState& effectEnv = effectEnvelopeStates[envelopeIndex][i];
          if (synthEffectEnvelopeActive[envelopeIndex]) {
            startEffectEnvelopeRelease(envelopeIndex, effectEnv);
            if (effectEnv.stage == EnvelopeStage::Idle) {
              resetCachedEffectEnvelopeModValue(envelopeIndex, i);
            }
          } else {
            resetEnvelopeState(effectEnv);
            resetCachedEffectEnvelopeModValue(envelopeIndex, i);
          }
        }
        break;
      }
      case EnvelopeCommand::Reset: {
        resetSynthVoiceRenderCache(i);
        resetEnvelopeState(env);
        for (uint8_t envelopeIndex = 0; envelopeIndex < SYNTH_FX_ENVELOPE_COUNT; ++envelopeIndex) {
          resetEnvelopeState(effectEnvelopeStates[envelopeIndex][i]);
          resetCachedEffectEnvelopeModValue(envelopeIndex, i);
        }
        synth[i].increment = 0;
        synth[i].targetIncrement = 0;
        synth[i].counter = 0;
        clearSynthPortamento(i);
        channelInUse[i].store(false, std::memory_order_relaxed);
        voiceGenerations[i].store(0, std::memory_order_relaxed);
        break;
      }
      case EnvelopeCommand::None:
      default:
        break;
    }

    if (!synth[i].targetIncrement && env.stage == EnvelopeStage::Idle) {
      continue;
    }

    switch (env.stage) {
      case EnvelopeStage::Attack: {
        uint32_t nextLevel = env.level + envelopeParams.attackIncrement;
        if (env.level >= envelopeMaxLevel || nextLevel >= envelopeMaxLevel) {
          advanceEnvelopeFromAttackPeak(envelopeParams, env);
        } else {
          env.level = nextLevel;
        }
        break;
      }
      case EnvelopeStage::Hold:
        updateEnvelopeHoldStage(envelopeParams, env);
        break;
      case EnvelopeStage::Decay:
        if (envelopeParams.decayTicks == 0 || envelopeParams.sustainLevel >= envelopeMaxLevel) {
          env.stage = EnvelopeStage::Sustain;
          env.level = envelopeParams.sustainLevel;
        } else if (env.level > envelopeParams.sustainLevel) {
          uint32_t nextLevel = (env.level > envelopeParams.decayIncrement) ? (env.level - envelopeParams.decayIncrement) : 0;
          if (nextLevel <= envelopeParams.sustainLevel) {
            env.level = envelopeParams.sustainLevel;
            env.stage = EnvelopeStage::Sustain;
          } else {
            env.level = nextLevel;
          }
        } else {
          env.level = envelopeParams.sustainLevel;
          env.stage = EnvelopeStage::Sustain;
        }
        break;
      case EnvelopeStage::Sustain:
        env.level = envelopeParams.sustainLevel;
        break;
      case EnvelopeStage::Release:
        if (envelopeParams.releaseTicks == 0 || env.releaseIncrement == 0 || env.level <= env.releaseIncrement) {
          env.level = 0;
          env.stage = EnvelopeStage::Idle;
          synth[i].increment = 0;
          synth[i].targetIncrement = 0;
          synth[i].counter = 0;
          clearSynthPortamento(i);
          resetSynthVoiceRenderCache(i);
          publishVoiceFreed(i);
        } else {
          env.level -= env.releaseIncrement;
        }
        break;
      case EnvelopeStage::Idle:
      default:
        env.level = 0;
        synth[i].increment = 0;
        synth[i].targetIncrement = 0;
        synth[i].counter = 0;
        clearSynthPortamento(i);
        resetSynthVoiceRenderCache(i);
        for (uint8_t envelopeIndex = 0; envelopeIndex < SYNTH_FX_ENVELOPE_COUNT; ++envelopeIndex) {
          resetEnvelopeState(effectEnvelopeStates[envelopeIndex][i]);
          resetCachedEffectEnvelopeModValue(envelopeIndex, i);
        }
        continue;
    }

    if (env.stage == EnvelopeStage::Idle || env.level == 0 || !synth[i].targetIncrement) {
      continue;
    }

    if (synthControlTick || forceVoiceRenderCacheRefresh || !synthVoiceRenderCacheValid[i]) {
      refreshSynthVoiceRenderCache(i,
                                   (synthControlTick && !forceVoiceRenderCacheRefresh)
                                     ? SYNTH_FX_ENVELOPE_CONTROL_TICKS
                                     : 0,
                                   activeWavetableHasFrames,
                                   perVoiceWavetablePosition,
                                   activeWaveFrameCount,
                                   synthVibratoSampleReady,
                                   synthVibratoSample);
    }
    SynthVoiceRenderCache& voiceCache = synthVoiceRenderCaches[i];
    synth[i].counter += voiceCache.phaseIncrement;  // high 16 bits loop from 65535 -> 0
    p = static_cast<uint16_t>(synth[i].counter >> 16);
    if (voiceCache.foldWarpAmountQ4 != 0) {
      p = applySynthFoldPhaseWarpQ4(p, voiceCache.foldWarpAmountQ4);
    }
    if (voiceCache.dutyWarpAmountQ4 != 0) {
      p = applySynthDutyPhaseWarpQ4(p, voiceCache.dutyWarpAmountQ4);
    }
    if (voiceCache.polyWarpAmountQ4 != 0) {
      p = applySynthPolyPhaseWarpQ4(p, voiceCache.polyWarpAmountQ4);
    }
    advanceSynthVoiceSlews(voiceCache);
    if (activeWavetableHasFrames) {
      p = readActiveWavetableSampleWithContext(p, voiceCache.wavetableContext);
    } else {
      t = p >> 8;
      switch (currWave) {
        case WAVEFORM_SAW:
          p = static_cast<uint16_t>(p + 32768);
          break;
        case WAVEFORM_TRIANGLE: p = readTriangleWaveSample(p); break;
        case WAVEFORM_SQUARE: p = readSquareWaveSample(p); break;
        case WAVEFORM_HYBRID: p = readHybridWaveSample(synth[i], t); break;
        case WAVEFORM_SINE:
        case WAVEFORM_BASIC_WAVETABLE:
          p = interpolatedWaveSample(activeSynthWaveTable[0], p);
          break;
        case WAVEFORM_STRINGS:
        case WAVEFORM_CLARINET:
        case WAVEFORM_MP:
        case WAVEFORM_MP_BOX_SAW:
        case WAVEFORM_MP_FRIENDLY_SQUARE:
        case WAVEFORM_MP_GLASSY:
        case WAVEFORM_MP_KOOLAID:
        case WAVEFORM_MP_MERV:
        case WAVEFORM_MP_M_BELLISH:
        case WAVEFORM_MP_OVAL:
        case WAVEFORM_MP_PRETTY_SHAPE:
        case WAVEFORM_MP_QUICK_808:
        case WAVEFORM_MP_RICH_REPEATER:
        case WAVEFORM_MP_ROUNDED_TRIANGLE:
        case WAVEFORM_MP_STARDEW:
        case WAVEFORM_MP_SYNC_THE_TITANIC:
        case WAVEFORM_MP_WEIRD_WIZARD:
        case WAVEFORM_MP_WOO:
        case WAVEFORM_USER_WAVETABLE:
          p = readLoadedWaveFrameSample(p);
          break;
        default: break;
      }
    }

    // Convert unipolar 0..65535 waveform into bipolar signed audio sample.
    // Centering improves headroom and reduces asymmetric clipping.
    int32_t s = (int32_t)p - 32768;  // -32768..+32767

    // Apply crude "equal loudness" compensation.
    // eq is 0..8. Treat 8 as roughly "neutral" gain.
    s = (s * (int32_t)synth[i].eq) >> 3;

    // Apply the audible envelope level (0..65535). The envelope state keeps
    // fractional bits for long times, but the mix multiply stays 32-bit.
    uint32_t envAudio = envelopeAudioLevel(env.level);
    s = (s * static_cast<int32_t>(envAudio)) >> 16;

    // Accumulate signed mix
    mix += s;

    // For Step 1 smooth normalization:
    envSum += envAudio;
    ++voices;
  }

  // Compute effective voices in Q8 (fixed-point, 8 fractional bits).
  // Approximate division by 65535 using >> 8, since 65535 ≈ 65536.
  // Examples:
  //  - 1 full voice: envSum ≈ 65535 => (envSum + 128) >> 8 ≈ 256  => 1.00 voices
  //  - 8 full voices: envSum ≈ 524280 => >> 8 ≈ 2048 => 8.00 voices
  uint16_t effectiveVoicesQ8 = (uint16_t)((envSum + 128u) >> 8);  // 0..2048

  // Convert to table index 0..8 and fractional part for interpolation
  uint8_t vInt = effectiveVoicesQ8 >> 8;          // 0..8
  uint8_t vFrac = effectiveVoicesQ8 & 0xFF;       // 0..255

  if (vInt > 8) vInt = 8;                         // safety

  // Smoothly interpolate attenuation between adjacent entries.
  // attenuation[] is in "64 == full scale" units.
  uint8_t a0 = attenuation[vInt];
  uint8_t a1 = attenuation[(vInt < 8) ? (vInt + 1) : 8];

  // Linear interpolation: a = a0 + (a1 - a0) * frac
  int16_t da = (int16_t)a1 - (int16_t)a0;
  uint16_t attenSmooth = (uint16_t)((int16_t)a0 + ((da * (int16_t)vFrac) >> 8));  // 0..64-ish

  // Only apply this smoothing in poly mode, keep mono behavior the same.
  uint16_t attenFinal = isPolyPlaybackMode(playbackMode) ? attenSmooth : attenuation[0];

  // Apply poly/mono attenuation where 64 = unity.
  // Note: mix is bounded by ±(POLYPHONY_LIMIT * ~256) ≈ ±2048 after envelope,
  // attenFinal ≤ 64, velWheel ≤ 127. Worst-case product ≈ 16.6M, well within int32_t.
  int32_t scaled = mix;
  scaled = (scaled * (int32_t)attenFinal) >> 6;     // divide by 64

  // Apply master volume where 127 ~= unity (use >>7 as approx /128)
  scaled = (scaled * (int32_t)velWheel.curValue) >> 7;

  // ============================================================
  // OUTPUT STAGE (JACK + PIEZO)
  //
  // We intentionally drive the two outputs differently:
  //
  // 1) Audio Jack (slice 4): classic centered PWM "DAC"
  //    - Fixed midpoint at PWM_MID (127 for 8-bit, 256 for 9-bit, 512 for 10-bit)
  //    - Symmetric headroom, lowest distortion into an audio path
  //
  // 2) Piezo (slice 3): "moving midpoint" drive
  //    - Midpoint follows the *actual amplitude* derived from envSum
  //    - Prevents the piezo from sitting at half supply when quiet
  //    - Midpoint glides down as the last voice fades (no sudden hiss stop)
  //
  // This keeps jack quality higher while making the piezo less noisy.
  // ============================================================

  // ------------------------------------------------------------
  // 1) Build a normalized signed sample from the mixed signal.
  //
  // "scaled" already includes:
  //   - mix of all voices (signed)
  //   - smooth poly attenuation (attenFinal)
  //   - master volume (velWheel)
  //
  // We still need to convert it to a small signed number suitable for PWM.
  //
  // IMPORTANT: This OUTPUT_SHIFT is the main gain staging control.
  // If output is too quiet, decrease it. If it clips/distorts, increase it.
  // Higher PWM resolutions can typically use slightly smaller shifts.
  // ------------------------------------------------------------
  // JACK idle behavior: stay centered.
  // PIEZO idle behavior: off (0).
  if ((voices == 0 || velWheel.curValue == 0) && !metronomeAudible) {
    output.voices = voices;
    output.profileFlags = profileFlags;
    applySynthOutputSmoothing(output);
    return output;
  }

  // Convert scaled mix -> signed sample in [-SHAPE_CLAMP..SHAPE_CLAMP]
  int32_t sample = 0;
  if (voices != 0 && velWheel.curValue != 0) {
    sample = scaled >> OUTPUT_SHIFT;
    if (sample >  SHAPE_CLAMP) sample =  SHAPE_CLAMP;
    if (sample < -SHAPE_CLAMP) sample = -SHAPE_CLAMP;
    if (synthDrive != SYNTH_DRIVE_OFF) {
      sample = applySynthDrive(sample);
    }
  }
  sample += metronomeSample;
  if (sample >  SHAPE_CLAMP) sample =  SHAPE_CLAMP;
  if (sample < -SHAPE_CLAMP) sample = -SHAPE_CLAMP;

  // ----- JACK: fixed midpoint with V1.2 headphone-only output cap -----
  int32_t jackSample = sample;
  if (headphoneVolumeCap < HEADPHONE_VOLUME_CAP_FULL) {
    jackSample = (jackSample * static_cast<int32_t>(headphoneVolumeCap)) >> 7;
  }
  int32_t jack = PWM_MID + jackSample;
  if (jack < 0) jack = 0;
  if (jack > (int32_t)PWM_WRAP) jack = PWM_WRAP;
  uint16_t jackLevel = (uint16_t)jack;

  // ----- PIEZO: midpoint follows "actual amplitude" from envSum -----
  //
  // IMPORTANT: envSum is sum of envelopes (0..~524k). We want ONE full voice
  // (envSum ~ 65535) to produce full piezo amplitude. So we shift by 9 (8-bit),
  // 8 (9-bit), or 7 (10-bit). With multiple voices envSum grows, so we clamp.
  //
  // This makes piezo loud enough and ensures it fades smoothly as envSum falls.
  //
  static uint16_t piezoA = 0; // smoothed midpoint/amplitude in PWM units [0..PWM_MID]

  // Map envSum -> A_target in [0..PWM_MID]
  uint32_t A_target = (envSum + (1u << (ENV_TO_A_SHIFT - 1))) >> ENV_TO_A_SHIFT;
  if (A_target > (uint32_t)PWM_MID) A_target = PWM_MID;

  // Apply master volume (0..127, where 127 is full). Keep it consistent with jack scaling.
  A_target = (A_target * (uint32_t)velWheel.curValue) >> 7;
  if (metronomeAudible && A_target < static_cast<uint32_t>(PWM_MID)) {
    // The beep sample is already volume-scaled. Give it full piezo headroom so
    // the moving-midpoint drive does not attenuate it a second time.
    A_target = PWM_MID;
  }

  // Smooth A so the piezo hiss doesn't abruptly stop (and to avoid end-click).
  // Smaller shift = faster response; larger = smoother.
  piezoA += (int16_t)((int32_t)A_target - (int32_t)piezoA) >> 3;

  // If very small, turn fully off (by now it’s near 0 so this won’t click).
  if (piezoA <= PIEZO_OFF_THRESHOLD) piezoA = 0;

  int32_t piezoLevel = 0;
  if (!(audioD & AUDIO_PIEZO)) {
    piezoA = 0;
  } else if (piezoA > 0) {
    // Scale sample [-SHAPE_CLAMP..SHAPE_CLAMP] -> outPiezo [-piezoA..+piezoA].
    // Use a power-of-two fixed-point scale to keep the piezo path cheap in the
    // audio renderer.
    profileFlags |= ISR_PROFILE_FLAG_PIEZO_SCALE;
    int32_t outPiezo = scalePiezoSample(sample, piezoA);

    // Midpoint follows amplitude: range [0..2*piezoA]
    piezoLevel = (int32_t)piezoA + outPiezo;
    int32_t piezoMax = (int32_t)piezoA * 2;

    if (piezoLevel < 0) piezoLevel = 0;
    if (piezoLevel > piezoMax) piezoLevel = piezoMax;
    if (piezoLevel > (int32_t)PWM_WRAP) piezoLevel = PWM_WRAP;
  }
  uint16_t piezoOut = (uint16_t)piezoLevel;

  output.piezo = piezoOut;
  output.jack = jackLevel;
  output.voices = voices;
  output.profileFlags = profileFlags;
  applySynthOutputSmoothing(output);
  return output;
}

// Legacy direct renderer retained for diagnostics/fallback; the normal synth
// output path is DMA-buffered.
void RAM_FUNC(poll)() {
  hw_clear_bits(&timer_hw->intr, 1u << ALARM_NUM);
  timer_hw->alarm[ALARM_NUM] = readClock() + POLL_INTERVAL_IN_MICROSECONDS;
  uint32_t _isrStart = isrProfilingEnabled ? timer_hw->timerawl : 0;
  AudioOutputLevels output = renderAudioOutputLevels();
  writeAudioOutputLevels(output.piezo, output.jack);
  if (_isrStart) {
    recordISRProfileSample(_isrStart, output.voices, output.profileFlags);
  }
}

uint32_t audioDmaBuffers[2][AUDIO_DMA_BUFFER_SAMPLE_COUNT] = {};
uint32_t audioDmaSilenceBuffer[AUDIO_DMA_BUFFER_SAMPLE_COUNT] = {};
volatile bool audioDmaBufferReady[2] = { false, false };
volatile bool audioDmaBufferFree[2] = { true, true };
volatile uint8_t audioDmaActiveBuffer = 0;
volatile uint32_t audioDmaUnderrunCount = 0;
int audioDmaChannel = -1;
byte audioDmaActiveDestination = AUDIO_NONE;
uint8_t audioDmaActiveSlice = AJACK_SLICE;
uintptr_t audioDmaWriteAddress = 0;
dma_channel_config audioDmaConfig;
std::atomic<bool> synthRuntimeReady = false;

inline byte RAM_FUNC(selectedAudioDmaDestination)() {
  byte destination = audioD;
  if (destination & AUDIO_AJACK) {
    return AUDIO_AJACK;
  }
  if (destination & AUDIO_PIEZO) {
    return AUDIO_PIEZO;
  }
  return AUDIO_NONE;
}

inline uint8_t RAM_FUNC(audioDmaSliceForDestination)(byte destination) {
  return (destination == AUDIO_PIEZO) ? PIEZO_SLICE : AJACK_SLICE;
}

inline uint16_t RAM_FUNC(audioDmaLevelForDestination)(const AudioOutputLevels& levels, byte destination) {
  if (destination == AUDIO_PIEZO) {
    return levels.piezo;
  }
  if (destination == AUDIO_AJACK) {
    return levels.jack;
  }
  return JACK_IDLE_LEVEL;
}

inline uint32_t RAM_FUNC(audioDmaEncodeLevel)(uint16_t level) {
  return static_cast<uint32_t>(level) << AUDIO_PWM_CC_LEVEL_SHIFT;
}

void RAM_FUNC(idlePiezoOutput)() {
  pwm_set_chan_level(PIEZO_SLICE, PIEZO_CHNL, PIEZO_IDLE_LEVEL);
  gpio_put(PIEZO_PIN, 0);
  gpio_set_dir(PIEZO_PIN, GPIO_OUT);
  gpio_set_function(PIEZO_PIN, GPIO_FUNC_SIO);
}

void RAM_FUNC(centerJackOutput)() {
  gpio_set_function(AJACK_PIN, GPIO_FUNC_PWM);
  pwm_set_chan_level(AJACK_SLICE, AJACK_CHNL, JACK_IDLE_LEVEL);
}

void RAM_FUNC(idlePhysicalAudioOutputs)() {
  idlePiezoOutput();
  centerJackOutput();
}

void RAM_FUNC(preparePhysicalAudioOutput)(byte destination) {
  if (destination == AUDIO_PIEZO) {
    pwm_set_chan_level(PIEZO_SLICE, PIEZO_CHNL, PIEZO_IDLE_LEVEL);
    gpio_set_function(PIEZO_PIN, GPIO_FUNC_PWM);
    centerJackOutput();
  } else if (destination == AUDIO_AJACK) {
    idlePiezoOutput();
    centerJackOutput();
  } else {
    idlePhysicalAudioOutputs();
  }
}

void RAM_FUNC(setInactiveAudioOutputsForDestination)(byte destination) {
  preparePhysicalAudioOutput(destination);
}

void RAM_FUNC(startAudioDmaTransfer)(uint8_t bufferIndex) {
  audioDmaActiveBuffer = bufferIndex;
  audioDmaBufferReady[bufferIndex] = false;
  audioDmaBufferFree[bufferIndex] = false;
  __dmb();
  dma_channel_set_read_addr(audioDmaChannel, audioDmaBuffers[bufferIndex], false);
  dma_channel_set_write_addr(audioDmaChannel, reinterpret_cast<void*>(audioDmaWriteAddress), false);
  dma_channel_set_trans_count(audioDmaChannel, AUDIO_DMA_BUFFER_SAMPLE_COUNT, true);
}

void RAM_FUNC(startAudioDmaSilenceTransfer)() {
  __dmb();
  dma_channel_set_read_addr(audioDmaChannel, audioDmaSilenceBuffer, false);
  dma_channel_set_write_addr(audioDmaChannel, reinterpret_cast<void*>(audioDmaWriteAddress), false);
  dma_channel_set_trans_count(audioDmaChannel, AUDIO_DMA_BUFFER_SAMPLE_COUNT, true);
}

void RAM_FUNC(audioDmaIrqHandler)() {
  if (audioDmaChannel < 0) {
    return;
  }
  dma_hw->ints0 = 1u << audioDmaChannel;

  uint8_t finishedBuffer = audioDmaActiveBuffer;
  audioDmaBufferFree[finishedBuffer] = true;
  uint8_t nextBuffer = static_cast<uint8_t>(finishedBuffer ^ 1u);
  if (audioDmaBufferReady[nextBuffer]) {
    startAudioDmaTransfer(nextBuffer);
  } else {
    ++audioDmaUnderrunCount;
    startAudioDmaSilenceTransfer();
  }
}

void fillAudioDmaSilenceBuffer(byte destination) {
  uint16_t level = (destination == AUDIO_PIEZO) ? PIEZO_IDLE_LEVEL : JACK_IDLE_LEVEL;
  uint32_t encoded = audioDmaEncodeLevel(level);
  for (uint16_t i = 0; i < AUDIO_DMA_BUFFER_SAMPLE_COUNT; ++i) {
    audioDmaSilenceBuffer[i] = encoded;
  }
}

void RAM_FUNC(fillAudioDmaBuffer)(uint8_t bufferIndex, byte destination) {
  uint32_t profileStart = isrProfilingEnabled ? timer_hw->timerawl : 0;
  uint8_t maxVoices = 0;
  uint8_t combinedFlags = 0;
  uint32_t* buffer = audioDmaBuffers[bufferIndex];
  for (uint16_t sampleIndex = 0; sampleIndex < AUDIO_DMA_BUFFER_SAMPLE_COUNT; ++sampleIndex) {
    AudioOutputLevels levels = renderAudioOutputLevels();
    if (levels.voices > maxVoices) {
      maxVoices = levels.voices;
    }
    combinedFlags |= levels.profileFlags;
    buffer[sampleIndex] = audioDmaEncodeLevel(audioDmaLevelForDestination(levels, destination));
  }
  if (profileStart) {
    recordAudioBufferProfileSample(profileStart, maxVoices, combinedFlags);
  }
  __dmb();
  audioDmaBufferFree[bufferIndex] = false;
  audioDmaBufferReady[bufferIndex] = true;
}

void stopAudioDma() {
  if (audioDmaChannel >= 0) {
    dma_channel_abort(audioDmaChannel);
  }
  audioDmaBufferReady[0] = false;
  audioDmaBufferReady[1] = false;
  audioDmaBufferFree[0] = true;
  audioDmaBufferFree[1] = true;
  idlePhysicalAudioOutputs();
}

void startAudioDmaForDestination(byte destination) {
  stopAudioDma();
  audioDmaActiveDestination = destination;
  audioDmaActiveSlice = audioDmaSliceForDestination(destination);
  audioDmaWriteAddress = reinterpret_cast<uintptr_t>(&pwm_hw->slice[audioDmaActiveSlice].cc);
  setInactiveAudioOutputsForDestination(destination);
  fillAudioDmaSilenceBuffer(destination);

  if (destination == AUDIO_NONE || audioDmaChannel < 0) {
    return;
  }

  dma_channel_configure(audioDmaChannel,
                        &audioDmaConfig,
                        reinterpret_cast<void*>(audioDmaWriteAddress),
                        audioDmaBuffers[0],
                        AUDIO_DMA_BUFFER_SAMPLE_COUNT,
                        false);
  fillAudioDmaBuffer(0, destination);
  fillAudioDmaBuffer(1, destination);
  startAudioDmaTransfer(0);
}

void serviceAudioDmaBuffers() {
  if (audioDmaChannel < 0) {
    return;
  }

  byte destination = selectedAudioDmaDestination();
  if (destination != audioDmaActiveDestination) {
    startAudioDmaForDestination(destination);
    return;
  }

  for (uint8_t bufferIndex = 0; bufferIndex < 2; ++bufferIndex) {
    if (audioDmaBufferFree[bufferIndex] && !audioDmaBufferReady[bufferIndex]) {
      fillAudioDmaBuffer(bufferIndex, destination);
    }
  }
}

void setupAudioDmaTimer() {
  pwm_set_phase_correct(AUDIO_DMA_TIMER_SLICE, false);
  pwm_set_wrap(AUDIO_DMA_TIMER_SLICE, AUDIO_DMA_TIMER_WRAP);
  pwm_set_clkdiv(AUDIO_DMA_TIMER_SLICE, static_cast<float>(AUDIO_DMA_PWM_STEPS));
  pwm_set_chan_level(AUDIO_DMA_TIMER_SLICE, PWM_CHAN_A, 0);
  pwm_set_enabled(AUDIO_DMA_TIMER_SLICE, true);
}

void setupAudioDma() {
  setupAudioDmaTimer();
  audioDmaChannel = dma_claim_unused_channel(true);
  audioDmaConfig = dma_channel_get_default_config(audioDmaChannel);
  channel_config_set_transfer_data_size(&audioDmaConfig, DMA_SIZE_32);
  channel_config_set_read_increment(&audioDmaConfig, true);
  channel_config_set_write_increment(&audioDmaConfig, false);
  channel_config_set_dreq(&audioDmaConfig, pwm_get_dreq(AUDIO_DMA_TIMER_SLICE));
  dma_channel_set_irq0_enabled(audioDmaChannel, true);
  irq_set_exclusive_handler(DMA_IRQ_0, audioDmaIrqHandler);
  irq_set_priority(DMA_IRQ_0, 0x00);
  irq_set_enabled(DMA_IRQ_0, true);
  startAudioDmaForDestination(selectedAudioDmaDestination());
}
// RUN ON CORE 1
byte isoTwoTwentySix(float f) {
  /*
      a very crude implementation of ISO 226
      equal loudness curves
        Hz dB  Amp ~ sqrt(10^(dB/10))
       200  0  8
       800 -3  6
      1500  0  8
      3250 -6  4
      5000  0  8
    */
  if ((f < 8.0) || (f > 12500.0)) {  // really crude low- and high-pass
    return 0;
  } else {
    if (EQUAL_LOUDNESS_ADJUST) {
      if ((f <= 200.0) || (f >= 5000.0)) {
        return 8;
      } else {
        if (f < 1500.0) {
          return 6 + 2 * (float)(abs(f - 800) / 700);
        } else {
          return 4 + 4 * (float)(abs(f - 3250) / 1750);
        }
      }
    } else {
      return 8;
    }
  }
}
void recomputePitchBendFactor() {
  pitchBendFactor = exp2(pbWheel.curValue * DEFAULT_PITCH_BEND_RANGE_SEMITONES / 98304.0f);
}

inline void RAM_FUNC(clearSynthPortamento)(uint8_t channelIndex) {
  synth[channelIndex].glideStep = 0;
  synth[channelIndex].glideSamplesRemaining = 0;
}

inline void RAM_FUNC(beginSynthPortamento)(uint8_t channelIndex, uint32_t targetIncrement) {
  uint32_t remaining = synthPortamentoTicks;
  if (remaining == 0 || synth[channelIndex].increment == 0 || synth[channelIndex].targetIncrement == 0) {
    clearSynthPortamento(channelIndex);
    synth[channelIndex].increment = targetIncrement;
    return;
  }

  uint32_t currentIncrement = synth[channelIndex].increment;
  if (currentIncrement == targetIncrement) {
    clearSynthPortamento(channelIndex);
    return;
  }

  uint32_t distance = (targetIncrement > currentIncrement)
                        ? (targetIncrement - currentIncrement)
                        : (currentIncrement - targetIncrement);
  uint32_t step = distance / remaining;
  synth[channelIndex].glideStep = step ? step : 1;
  synth[channelIndex].glideSamplesRemaining = remaining;
}

void RAM_FUNC(setSynthFreq)(float frequency, byte channel, bool resetPhase, bool allowPortamento) {
  if (channel == 0) {
    return;
  }
  byte c = channel - 1;
  float tunedFrequency = frequency;
  if ((useDynamicJustIntonation || useJustIntonationBPM) && c < POLYPHONY_LIMIT) {
    int16_t owner = synthChannelOwners[c].load(std::memory_order_relaxed);
    if (owner >= 0 && owner < BTN_COUNT) {
      tunedFrequency *= h[owner].jiFrequencyMultiplier;
    }
  }
  float f = tunedFrequency * pitchBendFactor;
  uint32_t newIncrement = oscillatorIncrementFromFrequency(f);
  if (newIncrement == 0) {
    synth[c].increment = 0;
    synth[c].targetIncrement = 0;
    synth[c].counter = 0;
    clearSynthPortamento(c);
    synth[c].eq = 0;
    return;
  }

  bool canPortamento = allowPortamento
                    && synthPortamentoTicks > 0
                    && synth[c].increment != 0
                    && synth[c].targetIncrement != 0;
  if (canPortamento) {
    synth[c].targetIncrement = newIncrement;
    beginSynthPortamento(c, newIncrement);
  } else {
    clearSynthPortamento(c);
    if (resetPhase) {
      synth[c].counter = 0;
    }
    if (resetPhase || allowPortamento || synth[c].increment == 0 || synth[c].targetIncrement == 0) {
      synth[c].increment = newIncrement;
    }
    synth[c].targetIncrement = newIncrement;
  }
  synth[c].eq = isoTwoTwentySix(f);
  if (currWave == WAVEFORM_HYBRID) {
    if (f < TRANSITION_SQUARE) {
      synth[c].b = 128;
    } else if (f < TRANSITION_SAW_LOW) {
      synth[c].b = (byte)(128 + 127 * (f - TRANSITION_SQUARE) / (TRANSITION_SAW_LOW - TRANSITION_SQUARE));
    } else if (f < TRANSITION_SAW_HIGH) {
      synth[c].b = 255;
    } else if (f < TRANSITION_TRIANGLE) {
      synth[c].b = (byte)(127 + 128 * (TRANSITION_TRIANGLE - f) / (TRANSITION_TRIANGLE - TRANSITION_SAW_HIGH));
    } else {
      synth[c].b = 127;
    }
    if (f < TRANSITION_SAW_LOW) {
      synth[c].a = 255 - synth[c].b;
      synth[c].c = 255;
    } else {
      synth[c].a = 0;
      synth[c].c = synth[c].b;
    }
    if (synth[c].a > 126) {
      synth[c].ab = 65535;
    } else {
      synth[c].ab = 65535 / (synth[c].b - synth[c].a - 1);
    }
    synth[c].cd = 65535 / (256 - synth[c].c);
  }
}

void RAM_FUNC(beginEnvelopeAttack)(uint8_t channel) {
  channelInUse[channel].store(true, std::memory_order_relaxed);
  releaseRetries[channel] = 0;
  releaseRetryCountdown[channel] = 0;
  // Reusing a voice discards any older "voice finished" event that core 1 may
  // have published for the previous note on this channel.
  clearPendingVoiceFreed(channel);
  publishEnvelopeCommand(channel, EnvelopeCommand::StartAttack);
}

void RAM_FUNC(beginEnvelopeRelease)(uint8_t channel) {
  if (channel >= POLYPHONY_LIMIT) {
    return;
  }
  releaseRetries[channel] = releaseRetryLimit;
  releaseRetryCountdown[channel] = 0;
  publishEnvelopeCommand(channel, EnvelopeCommand::StartRelease);
}

// USE THIS IN MONO OR ARPEG MODE ONLY

int RAM_FUNC(arpeggiatorHeldIndex)(byte x) {
  for (uint8_t i = 0; i < arpeggiatorHeldNoteCount; ++i) {
    if (arpeggiatorHeldNotes[i] == x) {
      return i;
    }
  }
  return -1;
}

void RAM_FUNC(clearArpeggiatorHeldNotes)() {
  arpeggiatorHeldNoteCount = 0;
  arpeggiatorSequenceLength = 0;
  arpeggiatorSequenceCursor = 0;
}

void RAM_FUNC(registerArpeggiatorNoteOff)(byte x) {
  int index = arpeggiatorHeldIndex(x);
  if (index < 0) {
    return;
  }
  for (uint8_t i = static_cast<uint8_t>(index); i + 1 < arpeggiatorHeldNoteCount; ++i) {
    arpeggiatorHeldNotes[i] = arpeggiatorHeldNotes[i + 1];
  }
  --arpeggiatorHeldNoteCount;
  if (arpeggiatorHeldNoteCount == 0) {
    arpeggiatorSequenceCursor = 0;
  }
}

void RAM_FUNC(registerArpeggiatorNoteOn)(byte x) {
  if (x >= BTN_COUNT || h[x].isCmd || h[x].note >= 128) {
    return;
  }
  registerArpeggiatorNoteOff(x);
  if (arpeggiatorHeldNoteCount < BTN_COUNT) {
    arpeggiatorHeldNotes[arpeggiatorHeldNoteCount++] = x;
  }
}

bool RAM_FUNC(arpeggiatorPitchComesBefore)(byte left, byte right) {
  if (h[left].frequency < h[right].frequency) {
    return true;
  }
  if (h[left].frequency > h[right].frequency) {
    return false;
  }
  if (h[left].midiNoteIndex < h[right].midiNoteIndex) {
    return true;
  }
  if (h[left].midiNoteIndex > h[right].midiNoteIndex) {
    return false;
  }
  if (h[left].timePressed != h[right].timePressed) {
    return h[left].timePressed < h[right].timePressed;
  }
  return left < right;
}

void RAM_FUNC(appendArpeggiatorSequenceNote)(byte note) {
  if (arpeggiatorSequenceLength < ARPEGGIATOR_SEQUENCE_MAX) {
    arpeggiatorSequence[arpeggiatorSequenceLength++] = note;
  }
}

void RAM_FUNC(sortArpeggiatorSequenceByPitch)(bool descending) {
  for (uint16_t i = 1; i < arpeggiatorSequenceLength; ++i) {
    byte value = arpeggiatorSequence[i];
    uint16_t j = i;
    while (j > 0) {
      bool comesBefore = arpeggiatorPitchComesBefore(value, arpeggiatorSequence[j - 1]);
      if (descending) {
        comesBefore = arpeggiatorPitchComesBefore(arpeggiatorSequence[j - 1], value);
      }
      if (!comesBefore) {
        break;
      }
      arpeggiatorSequence[j] = arpeggiatorSequence[j - 1];
      --j;
    }
    arpeggiatorSequence[j] = value;
  }
}

void RAM_FUNC(buildArpeggiatorSequence)() {
  arpeggiatorSequenceLength = 0;
  if (arpeggiatorHeldNoteCount == 0) {
    arpeggiatorSequenceCursor = 0;
    return;
  }

  switch (arpeggiatorDirection) {
    case ARP_DIRECTION_ORDER_PLAYED:
      for (uint8_t i = 0; i < arpeggiatorHeldNoteCount; ++i) {
        appendArpeggiatorSequenceNote(arpeggiatorHeldNotes[i]);
      }
      break;
    case ARP_DIRECTION_REVERSE_PLAYED:
      for (uint8_t i = arpeggiatorHeldNoteCount; i > 0; --i) {
        appendArpeggiatorSequenceNote(arpeggiatorHeldNotes[i - 1]);
      }
      break;
    case ARP_DIRECTION_DOWN:
    case ARP_DIRECTION_DOWN_UP:
      for (uint8_t i = 0; i < arpeggiatorHeldNoteCount; ++i) {
        appendArpeggiatorSequenceNote(arpeggiatorHeldNotes[i]);
      }
      sortArpeggiatorSequenceByPitch(true);
      if (arpeggiatorDirection == ARP_DIRECTION_DOWN_UP && arpeggiatorSequenceLength > 2) {
        for (uint16_t i = arpeggiatorSequenceLength - 2; i > 0; --i) {
          appendArpeggiatorSequenceNote(arpeggiatorSequence[i]);
        }
      }
      break;
    case ARP_DIRECTION_UP_DOWN:
    case ARP_DIRECTION_UP:
    default:
      for (uint8_t i = 0; i < arpeggiatorHeldNoteCount; ++i) {
        appendArpeggiatorSequenceNote(arpeggiatorHeldNotes[i]);
      }
      sortArpeggiatorSequenceByPitch(false);
      if (arpeggiatorDirection == ARP_DIRECTION_UP_DOWN && arpeggiatorSequenceLength > 2) {
        for (uint16_t i = arpeggiatorSequenceLength - 2; i > 0; --i) {
          appendArpeggiatorSequenceNote(arpeggiatorSequence[i]);
        }
      }
      break;
  }

  if (arpeggiatorSequenceCursor >= arpeggiatorSequenceLength) {
    arpeggiatorSequenceCursor = 0;
  }
}

void RAM_FUNC(setArpeggiatorCursorAfter)(byte note) {
  if (arpeggiatorDirection == ARP_DIRECTION_RANDOM) {
    return;
  }
  buildArpeggiatorSequence();
  for (uint16_t i = 0; i < arpeggiatorSequenceLength; ++i) {
    if (arpeggiatorSequence[i] == note) {
      arpeggiatorSequenceCursor = static_cast<uint16_t>((i + 1) % arpeggiatorSequenceLength);
      return;
    }
  }
}

byte RAM_FUNC(findNewestHeldNote)() {
  return arpeggiatorHeldNoteCount == 0 ? UNUSED_NOTE : arpeggiatorHeldNotes[arpeggiatorHeldNoteCount - 1];
}

byte RAM_FUNC(findNextArpeggiatedNote)() {
  if (arpeggiatorHeldNoteCount == 0) {
    return UNUSED_NOTE;
  }
  if (arpeggiatorDirection == ARP_DIRECTION_RANDOM) {
    arpeggiatorRandomState = (arpeggiatorRandomState * 1664525u) + 1013904223u + static_cast<uint32_t>(runTime);
    return arpeggiatorHeldNotes[(arpeggiatorRandomState >> 16) % arpeggiatorHeldNoteCount];
  }

  buildArpeggiatorSequence();
  if (arpeggiatorSequenceLength == 0) {
    return UNUSED_NOTE;
  }
  byte nextNote = arpeggiatorSequence[arpeggiatorSequenceCursor];
  arpeggiatorSequenceCursor = static_cast<uint16_t>((arpeggiatorSequenceCursor + 1) % arpeggiatorSequenceLength);
  return nextNote;
}

void RAM_FUNC(replaceMonoSynthWith)(byte x, bool retriggerEnvelope = true, bool allowPortamento = false, bool forceRetrigger = false) {
  if (arpeggiatingNow == x && !forceRetrigger) {
    return;
  }
  bool hadActiveNote = arpeggiatingNow != UNUSED_NOTE && channelInUse[0].load(std::memory_order_relaxed);
  if (arpeggiatingNow != UNUSED_NOTE && arpeggiatingNow < BTN_COUNT) {
    h[arpeggiatingNow].synthCh = 0;
  }
  arpeggiatingNow = x;
  if (arpeggiatingNow != UNUSED_NOTE) {
    h[arpeggiatingNow].synthCh = 1;
    synthChannelOwners[0].store(static_cast<int16_t>(arpeggiatingNow), std::memory_order_relaxed);
    if (retriggerEnvelope || !hadActiveNote) {
      voiceGenerations[0].store(nextVoiceGeneration.fetch_add(1, std::memory_order_relaxed), std::memory_order_relaxed);
      beginEnvelopeAttack(0);
    }
    bool usePortamento = allowPortamento && hadActiveNote;
    bool shouldResetPhase = (retriggerEnvelope || !hadActiveNote) && !(usePortamento && synthPortamentoTicks > 0);
    setSynthFreq(h[arpeggiatingNow].frequency, 1, shouldResetPhase, usePortamento);
  } else {
    synthChannelOwners[0].store(NO_SYNTH_OWNER, std::memory_order_relaxed);
    beginEnvelopeRelease(0);
  }
}

void RAM_FUNC(resetSynthFreqs)() {
  while (!synthChQueue.empty()) {
    synthChQueue.pop();
  }
  nextVoiceGeneration.store(1, std::memory_order_relaxed);
  for (byte i = 0; i < POLYPHONY_LIMIT; i++) {
    synth[i].increment = 0;
    synth[i].targetIncrement = 0;
    synth[i].counter = 0;
    clearSynthPortamento(i);
    publishEnvelopeCommand(i, EnvelopeCommand::Reset);
    channelInUse[i].store(false, std::memory_order_relaxed);
    voiceGenerations[i].store(0, std::memory_order_relaxed);
    synthChannelOwners[i].store(NO_SYNTH_OWNER, std::memory_order_relaxed);
    clearPendingVoiceFreed(i);
    releaseRetries[i] = 0;
    releaseRetryCountdown[i] = 0;
  }
  for (byte i = 0; i < BTN_COUNT; i++) {
    h[i].synthCh = 0;
  }
  arpeggiatingNow = UNUSED_NOTE;
  clearArpeggiatorHeldNotes();
  if (isPolyPlaybackMode(playbackMode)) {
    uint8_t voiceLimit = currentSynthVoiceLimit();
    for (byte i = 0; i < voiceLimit; i++) {
      synthChQueue.push(i + 1);
    }
  }
}

void synthWaveformChanged() {
  resetSynthFreqs();
  loadSelectedSynthWaveform();
}

void sendProgramChange() {
  if (programChange == 0) {
    return;  // 0 indicates "no program" selected yet.
  }
  byte targetChannel = primaryMIDIChannel();
  withMIDI([&](auto& M) { M.sendProgramChange(programChange - 1, targetChannel); });
}

void RAM_FUNC(updateSynthWithNewFreqs)() {
  recomputePitchBendFactor();
  byte targetChannel = primaryMIDIChannel();
  withMIDI([&](auto& M) { M.sendPitchBend(pbWheel.curValue, targetChannel); });
  for (byte i = 0; i < BTN_COUNT; i++) {
    if (!(h[i].isCmd)) {
      if (h[i].synthCh) {
        setSynthFreq(h[i].frequency, h[i].synthCh);  // pass all notes thru synth again if the pitch bend changes
      }
    }
  }
}

void RAM_FUNC(processEnvelopeReleases)() {
  for (uint8_t i = 0; i < POLYPHONY_LIMIT; ++i) {
    if (consumeVoiceFreed(i)) {
      channelInUse[i].store(false, std::memory_order_relaxed);
      voiceGenerations[i].store(0, std::memory_order_relaxed);
      int16_t owner = synthChannelOwners[i].load(std::memory_order_relaxed);
      synthChannelOwners[i].store(NO_SYNTH_OWNER, std::memory_order_relaxed);
      if (owner >= 0 && owner < BTN_COUNT) {
        if (h[owner].synthCh == static_cast<byte>(i + 1)) {
          h[owner].synthCh = 0;
        }
      }
      if (isPolyPlaybackMode(playbackMode) && i < currentSynthVoiceLimit()) {
        synthChQueue.push(i + 1);
      }
      releaseRetries[i] = 0;
      releaseRetryCountdown[i] = 0;
    }
  }
}

void RAM_FUNC(retryPendingReleases)() {
  uint8_t voiceLimit = currentSynthVoiceLimit();
  for (uint8_t i = 0; i < voiceLimit; ++i) {
    uint8_t retries = releaseRetries[i];
    if (retries == 0) {
      continue;
    }
    if (!channelInUse[i].load(std::memory_order_relaxed)) {
      releaseRetries[i] = 0;
      releaseRetryCountdown[i] = 0;
      continue;
    }
    if (releaseRetryCountdown[i] > 0) {
      --releaseRetryCountdown[i];
      continue;
    }
    publishEnvelopeCommand(i, EnvelopeCommand::StartRelease);
    releaseRetryCountdown[i] = releaseRetryDelayLoops;
    releaseRetries[i] = static_cast<uint8_t>(retries - 1);
  }
}

bool RAM_FUNC(stealOldestSynthVoice)(byte& channelOut, int16_t& previousOwner) {
  previousOwner = NO_SYNTH_OWNER;
  uint32_t oldestGeneration = std::numeric_limits<uint32_t>::max();
  int8_t oldestIndex = -1;
  uint8_t voiceLimit = currentSynthVoiceLimit();
  for (uint8_t i = 0; i < voiceLimit; ++i) {
    if (!channelInUse[i].load(std::memory_order_relaxed)) {
      continue;
    }
    if (synthChannelOwners[i].load(std::memory_order_relaxed) == NO_SYNTH_OWNER) {
      continue;
    }
    uint32_t generation = voiceGenerations[i].load(std::memory_order_relaxed);
    if (generation == 0) {
      continue;
    }
    if (generation < oldestGeneration) {
      oldestGeneration = generation;
      oldestIndex = static_cast<int8_t>(i);
    }
  }
  if (oldestIndex < 0) {
    return false;
  }
  previousOwner = synthChannelOwners[oldestIndex].load(std::memory_order_relaxed);
  channelOut = static_cast<byte>(oldestIndex + 1);
  return true;
}

void RAM_FUNC(trySynthNoteOn)(byte x) {
  if (playbackMode == SYNTH_OFF) {
    return;
  }
  if (isPolyPlaybackMode(playbackMode)) {
    processEnvelopeReleases();
    if (synthChQueue.empty()) {
      byte stolenChannel = 0;
      int16_t previousOwner = NO_SYNTH_OWNER;
      if (!stealOldestSynthVoice(stolenChannel, previousOwner)) {
        sendToLog("synth channels all firing, so did not add one");
        return;
      }
      if (previousOwner >= 0 && previousOwner < BTN_COUNT) {
        if (h[previousOwner].synthCh == stolenChannel) {
          h[previousOwner].synthCh = 0;
        }
      }
      h[x].synthCh = stolenChannel;
      synthChannelOwners[stolenChannel - 1].store(static_cast<int16_t>(x), std::memory_order_relaxed);
      voiceGenerations[stolenChannel - 1].store(nextVoiceGeneration.fetch_add(1, std::memory_order_relaxed), std::memory_order_relaxed);
      beginEnvelopeAttack(stolenChannel - 1);
      setSynthFreq(h[x].frequency, stolenChannel, true);
      sendToLog("stole synth channel " + std::to_string(stolenChannel));
      return;
    }
    byte channel = synthChQueue.front();
    synthChQueue.pop();
    h[x].synthCh = channel;
    synthChannelOwners[channel - 1].store(static_cast<int16_t>(x), std::memory_order_relaxed);
    voiceGenerations[channel - 1].store(nextVoiceGeneration.fetch_add(1, std::memory_order_relaxed), std::memory_order_relaxed);
    beginEnvelopeAttack(channel - 1);
    setSynthFreq(h[x].frequency, channel, true);
    sendToLog("popped " + std::to_string(channel) + " off the synth queue");
  } else if (h[x].MIDIch) {
    registerArpeggiatorNoteOn(x);
    if (playbackMode == SYNTH_ARPEGGIO) {
      replaceMonoSynthWith(x, true, false, true);
      setArpeggiatorCursorAfter(x);
    } else if (playbackMode == SYNTH_MONO_LEGATO) {
      replaceMonoSynthWith(x, false, true);
    } else {
      replaceMonoSynthWith(x, true, true);
    }
  }
}

void RAM_FUNC(trySynthNoteOff)(byte x) {
  if (playbackMode && !isPolyPlaybackMode(playbackMode)) {
    registerArpeggiatorNoteOff(x);
    if (arpeggiatingNow == x) {
      byte nextNote = (playbackMode == SYNTH_ARPEGGIO) ? findNextArpeggiatedNote() : findNewestHeldNote();
      if (playbackMode == SYNTH_ARPEGGIO) {
        replaceMonoSynthWith(nextNote, true, false, true);
      } else if (playbackMode == SYNTH_MONO_LEGATO) {
        replaceMonoSynthWith(nextNote, false, true);
      } else {
        replaceMonoSynthWith(nextNote, true, true);
      }
    }
    return;
  }

  if (!isPolyPlaybackMode(playbackMode)) {
    return;
  }

  if (h[x].synthCh) {
    uint8_t channel = h[x].synthCh;
    h[x].synthCh = 0;
    beginEnvelopeRelease(channel - 1);
    return;
  }

  // Fallback: the direct channel assignment was already cleared (e.g., by a voice steal),
  // but the synth voice is still owned by this hex. Look it up by owner.
  for (uint8_t i = 0; i < POLYPHONY_LIMIT; ++i) {
    if (!channelInUse[i].load(std::memory_order_relaxed)) {
      continue;
    }
    if (synthChannelOwners[i].load(std::memory_order_relaxed) == static_cast<int16_t>(x)) {
      synthChannelOwners[i].store(NO_SYNTH_OWNER, std::memory_order_relaxed);
      beginEnvelopeRelease(i);
      break;
    }
  }
}

void panicStopOutput() {
  sendToLog("Panic: stopping all MIDI and synth output.");

  for (byte channel = 1; channel <= 16; ++channel) {
    withMIDI([&](auto& M) {
      M.sendControlChange(120, 0, channel);
      M.sendControlChange(123, 0, channel);
    });
  }

  for (byte i = 0; i < BTN_COUNT; ++i) {
    h[i].MIDIch = 0;
    h[i].activeMidiNote = UNUSED_NOTE;
    h[i].activePitchBend = 0;
    h[i].synthCh = 0;
    h[i].externalNoteDepth = 0;
    h[i].timePressed = 0;
    h[i].animate = 0;
  }

  pressedKeyIDs.clear();
  arpeggiatingNow = UNUSED_NOTE;
  resetSynthFreqs();
  refreshMidiRouting();
  clearLEDs();
}


void setupSynth(byte pin, byte slice) {
  gpio_set_function(pin, GPIO_FUNC_PWM);          // set that pin as PWM
  pwm_set_phase_correct(slice, true);             // phase correct sounds better
  pwm_set_wrap(slice, PWM_WRAP);                  // essentionally sets the "bit-rate"
  pwm_set_clkdiv(slice, 1.0f);                    // run at full clock speed
  pwm_set_chan_level(slice, PIEZO_CHNL, 0);       // initialize at zero to prevent whining sound
  pwm_set_enabled(slice, true);                   // ENGAGE!
  resetSynthFreqs();
  sendToLog("synth is ready.");
}

void setupSynthOutputs() {
  setupSynth(PIEZO_PIN, PIEZO_SLICE);
  setupSynth(AJACK_PIN, AJACK_SLICE);
}

void RAM_FUNC(arpeggiate)() {
  if (delegatedControl) {
    return;
  }
  if (playbackMode == SYNTH_ARPEGGIO) {
    if (runTime - arpeggiateTime > arpeggiateLength) {
      arpeggiateTime = runTime;
      replaceMonoSynthWith(findNextArpeggiatedNote(), true, false, true);
    }
  }
}
