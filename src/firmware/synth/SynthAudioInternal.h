#pragma once

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

#include "hardware/pwm.h"
#include "hardware/irq.h"
#include "hardware/gpio.h"

#if defined(__GNUC__) && !defined(__clang__)
#define SYNTH_HOT_OPTIMIZE __attribute__((optimize("O2")))
#else
#define SYNTH_HOT_OPTIMIZE
#endif

#ifndef PWM_BITS
#define PWM_BITS 10
#endif

#if (PWM_BITS == 8)
constexpr uint16_t PWM_WRAP = 254;
constexpr int32_t PWM_MID = 127;
constexpr int32_t SHAPE_CLAMP = 127;
constexpr int OUTPUT_SHIFT = 8;
constexpr int ENV_TO_A_SHIFT = 9;
#elif (PWM_BITS == 10)
constexpr uint16_t PWM_WRAP = 1023;
constexpr int32_t PWM_MID = 512;
constexpr int32_t SHAPE_CLAMP = 511;
constexpr int OUTPUT_SHIFT = 6;
constexpr int ENV_TO_A_SHIFT = 7;
#elif (PWM_BITS == 9)
constexpr uint16_t PWM_WRAP = 511;
constexpr int32_t PWM_MID = 256;
constexpr int32_t SHAPE_CLAMP = 255;
constexpr int OUTPUT_SHIFT = 7;
constexpr int ENV_TO_A_SHIFT = 8;
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
constexpr uint32_t AUDIO_DMA_SYS_CLOCK_HZ = HEXBOARD_SYSTEM_CLOCK_HZ;
constexpr uint32_t AUDIO_SAMPLE_RATE_HZ =
  AUDIO_DMA_SYS_CLOCK_HZ / (static_cast<uint32_t>(AUDIO_DMA_TIMER_WRAP) + 1u) / AUDIO_DMA_PWM_STEPS;
static_assert(AUDIO_SAMPLE_RATE_HZ == SYNTH_WAVETABLE_MIP_SAMPLE_RATE_HZ,
              "Wavetable mip selection sample-rate estimate must match the audio DMA rate.");
constexpr uint8_t AUDIO_PWM_CC_LEVEL_SHIFT = 16;
constexpr uint16_t AUDIO_OUTPUT_MUTE_GAIN_FULL_Q8 = 256;
constexpr uint8_t AUDIO_OUTPUT_MUTE_RAMP_STEP_Q8 = 3;
constexpr uint8_t AUDIO_OUTPUT_MUTE_RAMP_SAMPLE_DIVIDER = 2;

#define EQUAL_LOUDNESS_ADJUST true

#define TRANSITION_SQUARE 220.0
#define TRANSITION_SAW_LOW 440.0
#define TRANSITION_SAW_HIGH 880.0
#define TRANSITION_TRIANGLE 1760.0

constexpr uint8_t SYNTH_PITCH_SMOOTH_SHIFT = 9;
constexpr uint8_t SYNTH_MOD_SMOOTH_SHIFT = 9;
constexpr uint32_t audioPhaseIncrementFromHz(uint16_t hz) {
  return static_cast<uint32_t>((static_cast<uint64_t>(hz) * 4294967296ULL) / AUDIO_SAMPLE_RATE_HZ);
}
constexpr uint32_t audioPhaseIncrementFromMilliHz(uint32_t milliHz) {
  return static_cast<uint32_t>((static_cast<uint64_t>(milliHz) * 4294967296ULL) / (static_cast<uint64_t>(AUDIO_SAMPLE_RATE_HZ) * 1000ULL));
}
constexpr std::array<uint32_t, SYNTH_VIBRATO_SPEED_MAX + 1> synthVibratoPhaseIncrementOptions = {
  audioPhaseIncrementFromHz(1), audioPhaseIncrementFromHz(2),
  audioPhaseIncrementFromHz(3), audioPhaseIncrementFromHz(4),
  audioPhaseIncrementFromHz(5), audioPhaseIncrementFromHz(6),
  audioPhaseIncrementFromHz(7), audioPhaseIncrementFromHz(8),
  audioPhaseIncrementFromHz(9), audioPhaseIncrementFromHz(10),
  audioPhaseIncrementFromHz(11), audioPhaseIncrementFromHz(12),
  audioPhaseIncrementFromHz(12)
};
constexpr std::array<uint32_t, 20> synthLfoPhaseIncrementOptions = {
  audioPhaseIncrementFromMilliHz(50), audioPhaseIncrementFromMilliHz(100),
  audioPhaseIncrementFromMilliHz(200), audioPhaseIncrementFromMilliHz(333),
  audioPhaseIncrementFromMilliHz(500), audioPhaseIncrementFromMilliHz(750),
  audioPhaseIncrementFromMilliHz(1000), audioPhaseIncrementFromMilliHz(1250),
  audioPhaseIncrementFromMilliHz(1500), audioPhaseIncrementFromMilliHz(2000),
  audioPhaseIncrementFromMilliHz(2500), audioPhaseIncrementFromMilliHz(3000),
  audioPhaseIncrementFromMilliHz(4000), audioPhaseIncrementFromMilliHz(5000),
  audioPhaseIncrementFromMilliHz(6000), audioPhaseIncrementFromMilliHz(8000),
  audioPhaseIncrementFromMilliHz(10000), audioPhaseIncrementFromMilliHz(12000),
  audioPhaseIncrementFromMilliHz(16000), audioPhaseIncrementFromMilliHz(20000)
};
constexpr uint16_t METRONOME_BEEP_SAMPLE_COUNT =
  static_cast<uint16_t>((40000ULL * AUDIO_SAMPLE_RATE_HZ + 999999ULL) / 1000000ULL);
constexpr uint32_t METRONOME_BEEP_NORMAL_INCREMENT = audioPhaseIncrementFromHz(1200);
constexpr uint32_t METRONOME_BEEP_ACCENT_INCREMENT = audioPhaseIncrementFromHz(1800);

constexpr int16_t SYNTH_PITCH_MOD_Q4_SCALE = 16;
constexpr int16_t SYNTH_PITCH_MOD_MAX_Q4 = 127 * SYNTH_PITCH_MOD_Q4_SCALE;
constexpr uint16_t SYNTH_PITCH_MOD_RATIO_Q4_COUNT = (SYNTH_PITCH_MOD_MAX_Q4 / 2) + 1;
constexpr uint16_t SYNTH_STEAL_FADE_SAMPLES = 64;
constexpr int16_t NO_SYNTH_OWNER = -1;
// Hidden matrix slots after the hardware-detection flag are borrowed for
// Sequencer OB Synth preview/playback notes that are not physical key presses.
constexpr byte SYNTH_PREVIEW_SLOT_START = FIRST_FLAG_BUTTON_INDEX + 1;
constexpr byte SYNTH_PREVIEW_SLOT_COUNT = BTN_COUNT - SYNTH_PREVIEW_SLOT_START;
constexpr uint8_t releaseRetryLimit = 2;
constexpr uint8_t releaseRetryDelayLoops = 2;
constexpr uint16_t ARPEGGIATOR_SEQUENCE_MAX = BTN_COUNT * 2;

struct AudioOutputLevels {
  uint16_t piezo = 0;
  uint16_t jack = JACK_IDLE_LEVEL;
  uint8_t voices = 0;
  uint8_t profileFlags = 0;
};

struct EnvelopeState {
  uint32_t level = 0;
  uint16_t releaseIncrement = 0;
  uint32_t holdTicksRemaining = 0;
  EnvelopeStage stage = EnvelopeStage::Idle;
};

enum class EnvelopeCommand : uint8_t {
  None,
  StartAttack,
  StartRelease,
  StartStealFade,
  Reset
};

class oscillator {
public:
  uint32_t increment = 0;
  uint32_t targetIncrement = 0;
  uint32_t counter = 0;
  uint32_t glideStep = 0;
  uint32_t glideSamplesRemaining = 0;
  byte a = 127;
  byte b = 128;
  byte c = 255;
  uint16_t ab = 0;
  uint16_t cd = 0;
  byte eq = 0;
};

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
  int16_t pitchCeiling = 0;
  int16_t wavetablePosition = 0;
};

struct SynthVoiceRenderCache {
  uint32_t phaseIncrement = 0;
  uint32_t phaseIncrementTarget = 0;
  int32_t phaseIncrementStep = 0;
  uint8_t phaseIncrementSlewSamples = 0;
  uint32_t ampEnvelopeLevelQ8 = 0;
  uint32_t ampEnvelopeTargetQ8 = 0;
  int32_t ampEnvelopeStepQ8 = 0;
  uint8_t ampEnvelopeRampSamples = 0;
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
  uint8_t phaseWarpActive = 0;
  uint8_t slewsActive = 0;
  uint8_t wavetableMipLevel = 0;
  SynthWavetableReadContext wavetableContext = { activeSynthWaveTable[0], nullptr, 0 };
};

struct SynthWavetableMipSelection {
  uint8_t brightLevel;
  uint8_t dullLevel;
  uint8_t brightBlend;
};

extern byte audioD;
extern volatile uint16_t audioOutputMuteGainQ8;
extern volatile uint16_t audioOutputMuteTargetQ8;
extern uint16_t synthPiezoAmplitude;
extern volatile byte headphoneVolumeGain;
extern volatile byte piezoVolumeGain;

extern byte synthVibratoSine[SYNTH_WAVE_SAMPLE_COUNT];
extern volatile uint8_t activeSynthWaveFrameCount;
extern uint16_t synthWavetableFramePositionByAmount[128];
extern uint8_t synthFxModScaleByDepth[128][128];
extern uint32_t synthPitchModPositiveQ16ByQ4[SYNTH_PITCH_MOD_RATIO_Q4_COUNT];
extern uint32_t synthPitchModNegativeQ16ByQ4[SYNTH_PITCH_MOD_RATIO_Q4_COUNT];

extern std::array<EnvelopeState, POLYPHONY_LIMIT> envelopeStates;
extern std::array<std::array<EnvelopeState, POLYPHONY_LIMIT>, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeStates;
extern int16_t cachedEffectEnvelopeModValues[SYNTH_FX_ENVELOPE_COUNT][POLYPHONY_LIMIT];
extern std::array<bool, SYNTH_FX_ENVELOPE_COUNT> synthEffectEnvelopeActive;
extern volatile uint8_t envelopeCommandValues[POLYPHONY_LIMIT];
extern volatile uint8_t envelopeCommandPublishedSeq[POLYPHONY_LIMIT];
extern std::array<uint8_t, POLYPHONY_LIMIT> envelopeCommandConsumedSeq;
extern volatile uint8_t voiceFreedPublishedSeq[POLYPHONY_LIMIT];
extern std::array<uint8_t, POLYPHONY_LIMIT> voiceFreedConsumedSeq;
extern std::array<std::atomic<bool>, POLYPHONY_LIMIT> channelInUse;
extern std::array<std::atomic<uint32_t>, POLYPHONY_LIMIT> voiceGenerations;
extern std::array<std::atomic<int16_t>, POLYPHONY_LIMIT> synthChannelOwners;
extern std::array<uint64_t, POLYPHONY_LIMIT> synthVoiceStartTimes;
extern std::array<uint64_t, POLYPHONY_LIMIT> synthVoiceReleaseTimes;
extern std::array<uint16_t, POLYPHONY_LIMIT> synthStealFadeSamplesRemaining;
extern std::array<int16_t, POLYPHONY_LIMIT> pendingSynthStealOwners;
extern std::array<byte, SYNTH_PREVIEW_SLOT_COUNT> synthPreviewGainForSlot;
extern std::atomic<uint32_t> nextVoiceGeneration;
extern float pitchBendFactor;
extern std::array<uint8_t, POLYPHONY_LIMIT> releaseRetries;
extern std::array<uint8_t, POLYPHONY_LIMIT> releaseRetryCountdown;

extern oscillator synth[POLYPHONY_LIMIT];

class SynthChannelQueue {
public:
  bool empty() const {
    return count_ == 0;
  }

  void clear() {
    head_ = 0;
    count_ = 0;
    queued_.fill(false);
  }

  bool push(byte channel) {
    if (channel == 0 || channel > channels_.size()) {
      return false;
    }
    const size_t channelIndex = channel - 1;
    if (queued_[channelIndex]) {
      return true;
    }
    if (count_ >= channels_.size()) {
      return false;
    }
    channels_[(head_ + count_) % channels_.size()] = channel;
    queued_[channelIndex] = true;
    ++count_;
    return true;
  }

  byte front() const {
    return count_ == 0 ? 0 : channels_[head_];
  }

  void pop() {
    if (count_ == 0) {
      return;
    }
    queued_[channels_[head_] - 1] = false;
    head_ = (head_ + 1) % channels_.size();
    --count_;
  }

private:
  std::array<byte, POLYPHONY_LIMIT> channels_ = {};
  std::array<bool, POLYPHONY_LIMIT> queued_ = {};
  uint8_t head_ = 0;
  uint8_t count_ = 0;
};

extern SynthChannelQueue synthChQueue;
extern byte attenuation[];
extern uint16_t synthModValueQ8;
extern uint32_t synthVibratoPhase;
extern uint32_t synthVibratoPhaseIncrement;
extern uint32_t synthLfoPhase;
extern uint32_t synthLfoPhaseIncrement;
extern volatile uint16_t metronomeBeepSamplesRemaining;
extern volatile uint32_t metronomeBeepPhaseIncrement;
extern uint32_t metronomeBeepPhase;
extern byte arpeggiatingNow;
extern uint64_t arpeggiateTime;
extern uint64_t arpeggiateLength;
extern std::array<byte, BTN_COUNT> arpeggiatorHeldNotes;
extern uint8_t arpeggiatorHeldNoteCount;
extern std::array<byte, ARPEGGIATOR_SEQUENCE_MAX> arpeggiatorSequence;
extern uint16_t arpeggiatorSequenceLength;
extern uint16_t arpeggiatorSequenceCursor;
extern uint32_t arpeggiatorRandomState;

extern SynthModulationAmounts synthBaseModulationCache;
extern std::array<SynthVoiceRenderCache, POLYPHONY_LIMIT> synthVoiceRenderCaches;
extern std::array<bool, POLYPHONY_LIMIT> synthVoiceRenderCacheValid;
extern uint16_t synthSharedWavetableFramePosition;
extern uint8_t synthControlSampleCountdown;
extern uint8_t synthWavetableContextTickDivider;

AudioOutputLevels RAM_FUNC(renderAudioOutputLevels)(byte destination);
byte RAM_FUNC(selectedAudioDmaDestination)();
void RAM_FUNC(writeAudioOutputLevels)(uint16_t piezoLevel, uint16_t jackLevel);
void RAM_FUNC(applyAudioOutputMute)(AudioOutputLevels& output, byte destination);
int32_t RAM_FUNC(scalePiezoSample)(int32_t sample, uint16_t amplitude);
int32_t RAM_FUNC(applySynthDrive)(int32_t sample);
uint8_t RAM_FUNC(perceptualAudioGain7)(uint8_t value);
uint16_t RAM_FUNC(perceptualAudioGain16)(uint16_t value);
void RAM_FUNC(recordAudioBufferProfileSample)(uint32_t startTime, uint8_t voices, uint8_t flags);

uint8_t RAM_FUNC(currentSynthVoiceLimit)();
uint32_t RAM_FUNC(oscillatorIncrementFromFrequency)(float frequency);
void RAM_FUNC(smoothUint32Toward)(uint32_t& current, uint32_t target, uint8_t shift);
void RAM_FUNC(smoothUint32Toward)(uint32_t& current, uint32_t target, uint8_t shift, uint8_t elapsedTicks);
void RAM_FUNC(smoothUint16Toward)(uint16_t& current, uint16_t target, uint8_t shift);
void RAM_FUNC(smoothUint16Toward)(uint16_t& current, uint16_t target, uint8_t shift, uint8_t elapsedTicks);
uint32_t RAM_FUNC(ticksFromMicros)(uint32_t micros);
uint32_t RAM_FUNC(envelopeAudioLevel)(uint32_t level);
uint16_t RAM_FUNC(releaseIncrementForLevel)(uint32_t level);
uint16_t RAM_FUNC(effectReleaseIncrementForLevel)(uint8_t envelopeIndex, uint32_t level);
void RAM_FUNC(resetEnvelopeState)(EnvelopeState& env);
void RAM_FUNC(publishEnvelopeCommand)(uint8_t channel, EnvelopeCommand command);
EnvelopeCommand RAM_FUNC(consumeEnvelopeCommand)(uint8_t channel);
void RAM_FUNC(publishVoiceFreed)(uint8_t channel);
bool RAM_FUNC(consumeVoiceFreed)(uint8_t channel);
void RAM_FUNC(clearPendingVoiceFreed)(uint8_t channel);
void RAM_FUNC(advanceEnvelopeFromAttackPeak)(const EnvelopeParams& params, EnvelopeState& env);
void RAM_FUNC(updateEnvelopeHoldStage)(const EnvelopeParams& params, EnvelopeState& env);
void RAM_FUNC(updateAmpEnvelopeState)(EnvelopeState& env, uint8_t elapsedTicks);
void RAM_FUNC(resetCachedEffectEnvelopeModValue)(uint8_t envelopeIndex, uint8_t voiceIndex);
void RAM_FUNC(startEffectEnvelopeAttack)(uint8_t envelopeIndex, EnvelopeState& env);
void RAM_FUNC(startEffectEnvelopeRelease)(uint8_t envelopeIndex, EnvelopeState& env);
void RAM_FUNC(updateEffectEnvelopeState)(uint8_t envelopeIndex, EnvelopeState& env, uint8_t elapsedTicks);
void RAM_FUNC(refreshCachedEffectEnvelopeModValue)(uint8_t envelopeIndex, uint8_t voiceIndex, uint8_t elapsedTicks);
int16_t RAM_FUNC(effectEnvelopePitchModValueQ4)(uint8_t envelopeIndex, const EnvelopeState& env);

uint16_t RAM_FUNC(synthWaveSampleIndexFromPhase16)(uint16_t phase);
uint16_t RAM_FUNC(synthWaveSampleIndexFromPhase32)(uint32_t phase);
uint8_t RAM_FUNC(synthWaveInterpolationFraction)(uint16_t phase);
uint16_t RAM_FUNC(synthWavePhaseFromSampleIndex)(uint16_t sampleIndex);
byte* RAM_FUNC(activeSynthWavetableMipFrame)(uint8_t level, uint8_t frameIndex);
uint16_t RAM_FUNC(interpolatedWaveSample)(const byte* table, uint16_t phase);
uint16_t RAM_FUNC(readTriangleWaveSample)(uint16_t phase);
uint16_t RAM_FUNC(readSquareWaveSample)(uint16_t phase);
uint16_t RAM_FUNC(readHybridWaveSample)(const oscillator& voice, uint8_t phaseIndex);
uint16_t RAM_FUNC(wavetableFramePositionFromAmount)(int16_t positionAmount);
uint16_t RAM_FUNC(readLoadedWaveFrameSample)(uint16_t phase);
SynthWavetableReadContext RAM_FUNC(wavetableReadContextFromFramePosition)(uint16_t framePosition, uint8_t frameCount, uint8_t mipLevel);
uint16_t SYNTH_HOT_OPTIMIZE RAM_FUNC(readActiveWavetableFrameSample)(uint16_t phase, const byte* frame);
uint16_t SYNTH_HOT_OPTIMIZE RAM_FUNC(readActiveWavetableInterpolatedFrameSample)(uint16_t phase, const SynthWavetableReadContext& context);
void RAM_FUNC(clearSynthPortamento)(uint8_t channelIndex);

uint8_t RAM_FUNC(smoothedSynthModValue)(uint8_t elapsedTicks);
uint8_t RAM_FUNC(scaleSynthModAmount)(uint8_t modValue);
uint8_t RAM_FUNC(scaleSynthFxModDepth)(uint8_t depth, uint8_t value);
int16_t RAM_FUNC(synthEffectAmountDepth)(uint8_t amountSetting);
int16_t RAM_FUNC(clampSynthModAccumulator)(int16_t value);
int16_t RAM_FUNC(clampSynthPitchModAccumulatorQ4)(int16_t valueQ4);
void RAM_FUNC(addSynthPitchTargetAmountQ4)(int16_t amountQ4, int16_t& pitchAmountQ4);
void RAM_FUNC(addSynthPitchCeilingAmountQ4)(int16_t amountQ4, int16_t& pitchCeilingQ4);
int16_t RAM_FUNC(synthPitchModDepthCeilingQ4)(uint8_t amountSetting);
int16_t RAM_FUNC(combinedWavetablePositionAmount)(int16_t positionModAmount);
bool RAM_FUNC(synthControlTickDue)();
void RAM_FUNC(refreshSynthBaseModulationCache)(uint8_t elapsedTicks);
void RAM_FUNC(refreshSynthVoiceRenderCache)(uint8_t voiceIndex,
                                            uint8_t elapsedTicks,
                                            bool activeWavetableHasFrames,
                                            bool perVoiceWavetablePosition,
                                            bool refreshWavetableContext,
                                            uint8_t activeWaveFrameCount,
                                            bool& synthVibratoSampleReady,
                                            int16_t& synthVibratoSample);
void RAM_FUNC(resetSynthVoiceRenderCache)(uint8_t voiceIndex);
void RAM_FUNC(resetSynthVoiceRenderCachePreservingAmpEnvelope)(uint8_t voiceIndex);
void RAM_FUNC(advanceSynthVoiceSlews)(SynthVoiceRenderCache& cache);
void RAM_FUNC(retargetSynthAmpEnvelopeRenderCache)(SynthVoiceRenderCache& cache,
                                                    uint32_t targetAudioLevel,
                                                    uint8_t elapsedTicks,
                                                    bool snap,
                                                    bool applyPerceptualTaper);
uint16_t SYNTH_HOT_OPTIMIZE RAM_FUNC(applySynthFoldPhaseWarpQ4)(uint16_t phase, int16_t warpAmountQ4);
uint16_t SYNTH_HOT_OPTIMIZE RAM_FUNC(applySynthDutyPhaseWarpQ4)(uint16_t phase, int16_t warpAmountQ4);
uint16_t SYNTH_HOT_OPTIMIZE RAM_FUNC(applySynthPolyPhaseWarpQ4)(uint16_t phase, int16_t warpAmountQ4);
void initializeSynthDriveLookup();
void initializeSynthFxModScaleLookup();
void initializeSynthPitchModLookup();

bool RAM_FUNC(synthStealFadeInProgress)(uint8_t channelIndex);
bool RAM_FUNC(synthStealHandoffPending)(uint8_t channelIndex);
void RAM_FUNC(clearSynthStealFade)(uint8_t channelIndex);
uint16_t RAM_FUNC(synthStealFadeGainQ8)(uint8_t channelIndex);
void RAM_FUNC(startSynthVoiceAttackInRender)(uint8_t channelIndex, EnvelopeState& env, bool& forceVoiceRenderCacheRefresh);
void RAM_FUNC(resetSynthVoiceAfterAbandonedSteal)(uint8_t channelIndex);
void RAM_FUNC(finishSynthStealFade)(uint8_t channelIndex, EnvelopeState& env, bool& forceVoiceRenderCacheRefresh);
