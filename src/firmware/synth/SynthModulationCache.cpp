#include "SynthAudioInternal.h"

uint8_t synthFxModScaleByDepth[128][128] = {};
uint32_t synthPitchModPositiveQ16ByQ4[SYNTH_PITCH_MOD_RATIO_Q4_COUNT] = {};
uint32_t synthPitchModNegativeQ16ByQ4[SYNTH_PITCH_MOD_RATIO_Q4_COUNT] = {};

uint16_t synthModValueQ8 = 0;
uint32_t synthVibratoPhase = 0;
uint32_t synthVibratoPhaseIncrement = synthVibratoPhaseIncrementOptions[SYNTH_VIBRATO_SPEED_DEFAULT];
uint32_t synthVibratoNoiseState = 0xB5297A4Du;
uint8_t synthVibratoNoiseSegment = 0xFF;
int16_t synthVibratoNoisePreviousSample = 0;
int16_t synthVibratoNoiseCurrentSample = 0;
uint32_t synthLfoPhase = 0;
uint32_t synthLfoPhaseIncrement = synthLfoPhaseIncrementOptions[SYNTH_LFO_SPEED_DEFAULT];
uint32_t synthLfoNoiseState = 0x6D2B79F5u;
uint8_t synthLfoNoiseSegment = 0xFF;
int16_t synthLfoNoisePreviousSample = 0;
int16_t synthLfoNoiseCurrentSample = 0;

SynthModulationAmounts synthBaseModulationCache = {};
std::array<SynthVoiceRenderCache, POLYPHONY_LIMIT> synthVoiceRenderCaches = {};
std::array<bool, POLYPHONY_LIMIT> synthVoiceRenderCacheValid = {};
uint16_t synthSharedWavetableFramePosition = 0;
uint8_t synthControlSampleCountdown = 0;
uint8_t synthWavetableContextTickDivider = 0;

uint8_t RAM_FUNC(smoothedSynthModValue)(uint8_t elapsedTicks = 1) {
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
  if (synthVibratoSpeed > SYNTH_VIBRATO_SPEED_MAX) {
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

uint8_t RAM_FUNC(scaleSynthModAmount)(uint8_t modValue) {
  if (synthModAmount >= SYNTH_MOD_AMOUNT_FULL) {
    return modValue;
  }
  return static_cast<uint8_t>((static_cast<uint16_t>(modValue) * static_cast<uint16_t>(synthModAmount) + 64u) >> 7);
}

uint8_t RAM_FUNC(scaleSynthFxModDepth)(uint8_t depth, uint8_t value) {
  return synthFxModScaleByDepth[depth & 0x7F][value & 0x7F];
}

int16_t RAM_FUNC(effectEnvelopeModValue)(uint8_t envelopeIndex, uint8_t target, const EnvelopeState& env) {
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
  uint8_t scaled = scaleSynthFxModDepth(absDepth, static_cast<uint8_t>(value));
  if (negativeVibrato) {
    return static_cast<int16_t>(absDepth - scaled);
  }
  int16_t signedValue = static_cast<int16_t>(scaled);
  return (depth < 0) ? -signedValue : signedValue;
}

int16_t RAM_FUNC(effectEnvelopePitchModValueQ4)(uint8_t envelopeIndex, const EnvelopeState& env) {
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

void RAM_FUNC(resetCachedEffectEnvelopeModValue)(uint8_t envelopeIndex, uint8_t voiceIndex) {
  cachedEffectEnvelopeModValues[envelopeIndex][voiceIndex] = 0;
}

void RAM_FUNC(startEffectEnvelopeAttack)(uint8_t envelopeIndex, EnvelopeState& env) {
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

void RAM_FUNC(startEffectEnvelopeRelease)(uint8_t envelopeIndex, EnvelopeState& env) {
  EnvelopeParams& params = effectEnvelopeParams[envelopeIndex];
  if (params.releaseTicks == 0 || env.level == 0) {
    resetEnvelopeState(env);
    return;
  }
  env.stage = EnvelopeStage::Release;
  env.releaseIncrement = effectReleaseIncrementForLevel(envelopeIndex, env.level);
}

void RAM_FUNC(updateEffectEnvelopeState)(uint8_t envelopeIndex, EnvelopeState& env, uint8_t elapsedTicks = 1) {
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

void RAM_FUNC(refreshCachedEffectEnvelopeModValue)(uint8_t envelopeIndex,
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

uint32_t RAM_FUNC(applySynthVibrato)(uint32_t increment, int16_t vibratoAmount) {
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

uint16_t SYNTH_HOT_OPTIMIZE RAM_FUNC(applySynthFoldPhaseWarpQ4)(uint16_t phase, int16_t warpAmountQ4) {
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

uint16_t SYNTH_HOT_OPTIMIZE RAM_FUNC(applySynthDutyPhaseWarpQ4)(uint16_t phase, int16_t warpAmountQ4) {
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

uint16_t SYNTH_HOT_OPTIMIZE RAM_FUNC(applySynthPolyPhaseWarpQ4)(uint16_t phase, int16_t warpAmountQ4) {
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



void RAM_FUNC(resetSynthVoiceRenderCache)(uint8_t voiceIndex) {
  if (voiceIndex >= POLYPHONY_LIMIT) {
    return;
  }
  synthVoiceRenderCaches[voiceIndex] = {};
  synthVoiceRenderCacheValid[voiceIndex] = false;
}

void RAM_FUNC(resetSynthVoiceRenderCachePreservingAmpEnvelope)(uint8_t voiceIndex) {
  if (voiceIndex >= POLYPHONY_LIMIT) {
    return;
  }
  uint32_t ampEnvelopeLevelQ8 = synthVoiceRenderCaches[voiceIndex].ampEnvelopeLevelQ8;
  uint32_t ampEnvelopeTargetQ8 = synthVoiceRenderCaches[voiceIndex].ampEnvelopeTargetQ8;
  int32_t ampEnvelopeStepQ8 = synthVoiceRenderCaches[voiceIndex].ampEnvelopeStepQ8;
  uint8_t ampEnvelopeRampSamples = synthVoiceRenderCaches[voiceIndex].ampEnvelopeRampSamples;
  synthVoiceRenderCaches[voiceIndex] = {};
  synthVoiceRenderCaches[voiceIndex].ampEnvelopeLevelQ8 = ampEnvelopeLevelQ8;
  synthVoiceRenderCaches[voiceIndex].ampEnvelopeTargetQ8 = ampEnvelopeTargetQ8;
  synthVoiceRenderCaches[voiceIndex].ampEnvelopeStepQ8 = ampEnvelopeStepQ8;
  synthVoiceRenderCaches[voiceIndex].ampEnvelopeRampSamples = ampEnvelopeRampSamples;
  synthVoiceRenderCacheValid[voiceIndex] = false;
}

void RAM_FUNC(updateSynthVoiceRenderCacheFlags)(SynthVoiceRenderCache& cache) {
  cache.phaseWarpActive =
    (cache.foldWarpAmountQ4 != 0 || cache.dutyWarpAmountQ4 != 0 || cache.polyWarpAmountQ4 != 0) ? 1 : 0;
  cache.slewsActive =
    (cache.phaseIncrementSlewSamples != 0 || cache.warpSlewSamples != 0) ? 1 : 0;
}

void RAM_FUNC(resetSynthRenderCaches)() {
  synthBaseModulationCache = {};
  synthSharedWavetableFramePosition = 0;
  synthControlSampleCountdown = 0;
  synthWavetableContextTickDivider = 0;
  for (uint8_t voiceIndex = 0; voiceIndex < POLYPHONY_LIMIT; ++voiceIndex) {
    resetSynthVoiceRenderCache(voiceIndex);
  }
}

bool RAM_FUNC(retargetSynthWarpSlew)(int16_t amountTarget,
                                            int16_t& amountQ4,
                                            int16_t& amountTargetQ4,
                                            int16_t& amountStepQ4,
                                            uint8_t elapsedTicks) {
  amountTargetQ4 = static_cast<int16_t>(amountTarget * 16);
  int16_t delta = static_cast<int16_t>(amountTargetQ4 - amountQ4);
  if (delta == 0) {
    amountStepQ4 = 0;
    return false;
  }
  amountStepQ4 = static_cast<int16_t>(delta / static_cast<int16_t>(elapsedTicks));
  if (amountStepQ4 == 0 && delta != 0) {
    amountStepQ4 = (delta > 0) ? 1 : -1;
  }
  return true;
}

void RAM_FUNC(snapSynthWarpSlew)(int16_t amountTarget,
                                        int16_t& amountQ4,
                                        int16_t& amountTargetQ4,
                                        int16_t& amountStepQ4) {
  amountTargetQ4 = static_cast<int16_t>(amountTarget * 16);
  amountQ4 = amountTargetQ4;
  amountStepQ4 = 0;
}

void RAM_FUNC(advanceSynthWarpSlew)(int16_t& amountQ4,
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

void RAM_FUNC(retargetSynthVoiceSlews)(SynthVoiceRenderCache& cache,
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
    updateSynthVoiceRenderCacheFlags(cache);
    return;
  }

  cache.phaseIncrementTarget = phaseIncrementTarget;
  if (phaseIncrementTarget == cache.phaseIncrement) {
    cache.phaseIncrementStep = 0;
    cache.phaseIncrementSlewSamples = 0;
  } else if (phaseIncrementTarget >= cache.phaseIncrement) {
    uint32_t difference = phaseIncrementTarget - cache.phaseIncrement;
    uint32_t step = (elapsedTicks == SYNTH_CONTROL_RATE_SAMPLES)
                      ? (difference >> SYNTH_CONTROL_RATE_SHIFT)
                      : (difference / elapsedTicks);
    if (step == 0 && difference != 0) {
      step = 1;
    }
    cache.phaseIncrementStep = static_cast<int32_t>(
      step > static_cast<uint32_t>(std::numeric_limits<int32_t>::max())
        ? static_cast<uint32_t>(std::numeric_limits<int32_t>::max())
        : step);
    cache.phaseIncrementSlewSamples = elapsedTicks;
  } else {
    uint32_t difference = cache.phaseIncrement - phaseIncrementTarget;
    uint32_t step = (elapsedTicks == SYNTH_CONTROL_RATE_SAMPLES)
                      ? (difference >> SYNTH_CONTROL_RATE_SHIFT)
                      : (difference / elapsedTicks);
    if (step == 0 && difference != 0) {
      step = 1;
    }
    cache.phaseIncrementStep = -static_cast<int32_t>(
      step > static_cast<uint32_t>(std::numeric_limits<int32_t>::max())
        ? static_cast<uint32_t>(std::numeric_limits<int32_t>::max())
        : step);
    cache.phaseIncrementSlewSamples = elapsedTicks;
  }

  bool warpSlewActive = false;
  warpSlewActive |= retargetSynthWarpSlew(voiceModulation.foldWarp,
                                          cache.foldWarpAmountQ4,
                                          cache.foldWarpAmountTargetQ4,
                                          cache.foldWarpAmountStepQ4,
                                          elapsedTicks);
  warpSlewActive |= retargetSynthWarpSlew(voiceModulation.dutyWarp,
                                          cache.dutyWarpAmountQ4,
                                          cache.dutyWarpAmountTargetQ4,
                                          cache.dutyWarpAmountStepQ4,
                                          elapsedTicks);
  warpSlewActive |= retargetSynthWarpSlew(voiceModulation.polyWarp,
                                          cache.polyWarpAmountQ4,
                                          cache.polyWarpAmountTargetQ4,
                                          cache.polyWarpAmountStepQ4,
                                          elapsedTicks);
  cache.warpSlewSamples = warpSlewActive ? elapsedTicks : 0;
  updateSynthVoiceRenderCacheFlags(cache);
}

void RAM_FUNC(advanceSynthVoiceSlews)(SynthVoiceRenderCache& cache) {
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
  updateSynthVoiceRenderCacheFlags(cache);
}

void RAM_FUNC(retargetSynthAmpEnvelopeRenderCache)(SynthVoiceRenderCache& cache,
                                                   uint32_t targetAudioLevel,
                                                   uint8_t elapsedTicks,
                                                   bool snap) {
  if (targetAudioLevel > envelopeAudioMaxLevel) {
    targetAudioLevel = envelopeAudioMaxLevel;
  }
  uint32_t targetQ8 = targetAudioLevel << 8;
  cache.ampEnvelopeTargetQ8 = targetQ8;
  if (snap || elapsedTicks == 0) {
    cache.ampEnvelopeLevelQ8 = targetQ8;
    cache.ampEnvelopeStepQ8 = 0;
    cache.ampEnvelopeRampSamples = 0;
    return;
  }

  int32_t delta = static_cast<int32_t>(targetQ8) - static_cast<int32_t>(cache.ampEnvelopeLevelQ8);
  if (delta == 0) {
    cache.ampEnvelopeStepQ8 = 0;
    cache.ampEnvelopeRampSamples = 0;
    return;
  }

  int32_t step = delta / static_cast<int32_t>(elapsedTicks);
  if (step == 0) {
    step = (delta > 0) ? 1 : -1;
  }
  cache.ampEnvelopeStepQ8 = step;
  cache.ampEnvelopeRampSamples = elapsedTicks;
}

uint16_t RAM_FUNC(synthWavetableMipHarmonicLimit)(uint8_t level) {
  switch (level) {
    case 0: return SYNTH_WAVETABLE_MIP_HARMONIC_LIMIT_0;
    case 1: return SYNTH_WAVETABLE_MIP_HARMONIC_LIMIT_1;
    case 2: return SYNTH_WAVETABLE_MIP_HARMONIC_LIMIT_2;
    case 3: return SYNTH_WAVETABLE_MIP_HARMONIC_LIMIT_3;
    case 4: return SYNTH_WAVETABLE_MIP_HARMONIC_LIMIT_4;
    default: return SYNTH_WAVETABLE_MIP_HARMONIC_LIMIT_5;
  }
}

uint32_t RAM_FUNC(synthAdjustedSafeHarmonicQ8ForPhaseIncrement)(uint32_t phaseIncrement) {
  constexpr uint32_t kMaxSafeHarmonicQ8 =
    static_cast<uint32_t>(std::numeric_limits<uint16_t>::max()) << SYNTH_WAVETABLE_MIP_BLEND_FRACTION_BITS;
  if (phaseIncrement == 0) {
    return kMaxSafeHarmonicQ8;
  }
  uint64_t safeHarmonicQ8 = (1ull << (31u + SYNTH_WAVETABLE_MIP_BLEND_FRACTION_BITS)) / phaseIncrement;
  if (safeHarmonicQ8 > kMaxSafeHarmonicQ8) {
    safeHarmonicQ8 = kMaxSafeHarmonicQ8;
  }
  return static_cast<uint32_t>(safeHarmonicQ8);
}

uint8_t RAM_FUNC(synthBrightestSafeWavetableMipLevel)(uint32_t safeHarmonicQ8, uint8_t levelCount) {
  for (uint8_t level = 0; level < levelCount; ++level) {
    uint32_t levelLimitQ8 =
      static_cast<uint32_t>(synthWavetableMipHarmonicLimit(level)) << SYNTH_WAVETABLE_MIP_BLEND_FRACTION_BITS;
    if (levelLimitQ8 <= safeHarmonicQ8) {
      return level;
    }
  }
  return static_cast<uint8_t>(levelCount - 1);
}

SynthWavetableMipSelection RAM_FUNC(synthWavetableMipSelectionForMaxPhaseIncrement)(uint32_t maxExpectedPhaseIncrement) {
  uint8_t levelCount = activeSynthWavetableMipLevelCount;
  if (levelCount <= 1) {
    return { 0, 0, 255 };
  }
  if (levelCount > SYNTH_WAVETABLE_MIP_LEVEL_COUNT) {
    levelCount = SYNTH_WAVETABLE_MIP_LEVEL_COUNT;
  }

  uint32_t safeHarmonicQ8 = synthAdjustedSafeHarmonicQ8ForPhaseIncrement(maxExpectedPhaseIncrement);
  uint8_t brightLevel = synthBrightestSafeWavetableMipLevel(safeHarmonicQ8, levelCount);
  uint8_t dullLevel = static_cast<uint8_t>(brightLevel + 1);
  if (dullLevel >= levelCount) {
    return { brightLevel, brightLevel, 255 };
  }

  uint32_t brightLimitQ8 =
    static_cast<uint32_t>(synthWavetableMipHarmonicLimit(brightLevel)) << SYNTH_WAVETABLE_MIP_BLEND_FRACTION_BITS;
  uint32_t blendMargin = brightLimitQ8 >> SYNTH_WAVETABLE_MIP_BLEND_MARGIN_SHIFT;
  if (blendMargin == 0) {
    blendMargin = 1;
  }
  if (safeHarmonicQ8 <= brightLimitQ8) {
    return { brightLevel, dullLevel, 0 };
  }
  uint32_t blendEnd = brightLimitQ8 + blendMargin;
  if (safeHarmonicQ8 >= blendEnd) {
    return { brightLevel, dullLevel, 255 };
  }
  uint32_t intoMargin = safeHarmonicQ8 - brightLimitQ8;
  uint8_t brightBlend = static_cast<uint8_t>(
    ((intoMargin * 255u) + (blendMargin / 2u)) / blendMargin);
  return { brightLevel, dullLevel, brightBlend };
}

SynthWavetableReadContext RAM_FUNC(wavetableReadContextFromFramePosition)(uint16_t framePosition,
                                                                                 uint8_t frameCount,
                                                                                 uint8_t mipLevel) {
  if (mipLevel >= activeSynthWavetableMipLevelCount) {
    mipLevel = activeSynthWavetableMipLevelCount > 0 ? activeSynthWavetableMipLevelCount - 1 : 0;
  }
  if (frameCount <= 1) {
    return { activeSynthWavetableMipFrame(mipLevel, 0), nullptr, 0 };
  }

  uint8_t frameIndex = static_cast<uint8_t>(framePosition >> 8);
  uint8_t frameFrac = static_cast<uint8_t>(framePosition & 0xFF);
  uint8_t maxFrameIndex = static_cast<uint8_t>(frameCount - 1);
  if (frameIndex >= maxFrameIndex) {
    return { activeSynthWavetableMipFrame(mipLevel, maxFrameIndex), nullptr, 0 };
  }
  if (frameFrac == 0) {
    return { activeSynthWavetableMipFrame(mipLevel, frameIndex), nullptr, 0 };
  }
  return { activeSynthWavetableMipFrame(mipLevel, frameIndex), activeSynthWavetableMipFrame(mipLevel, frameIndex + 1), frameFrac };
}

uint16_t SYNTH_HOT_OPTIMIZE RAM_FUNC(readActiveWavetableFrameSample)(uint16_t phase,
                                                                            const byte* frame) {
  uint16_t sampleIndex = synthWaveSampleIndexFromPhase16(phase);
  return static_cast<uint16_t>(frame[sampleIndex] << 8);
}

uint16_t SYNTH_HOT_OPTIMIZE RAM_FUNC(readActiveWavetableInterpolatedFrameSample)(uint16_t phase,
                                                                                       const SynthWavetableReadContext& context) {
  uint16_t sampleIndex = synthWaveSampleIndexFromPhase16(phase);
  int16_t sampleA = context.frameA[sampleIndex];
  int16_t sampleB = context.frameB[sampleIndex];
  return static_cast<uint16_t>((sampleA << 8) + ((sampleB - sampleA) * static_cast<int16_t>(context.frameFrac)));
}

int16_t RAM_FUNC(clampSynthModAccumulator)(int16_t value) {
  if (value > 127) {
    return 127;
  }
  if (value < -127) {
    return -127;
  }
  return value;
}

int16_t RAM_FUNC(clampSynthPitchModAccumulatorQ4)(int16_t valueQ4) {
  if (valueQ4 > SYNTH_PITCH_MOD_MAX_Q4) {
    return SYNTH_PITCH_MOD_MAX_Q4;
  }
  if (valueQ4 < -SYNTH_PITCH_MOD_MAX_Q4) {
    return -SYNTH_PITCH_MOD_MAX_Q4;
  }
  return valueQ4;
}

void RAM_FUNC(addSynthPitchTargetAmountQ4)(int16_t amountQ4,
                                                  int16_t& pitchAmountQ4) {
  if (amountQ4 == 0) {
    return;
  }
  pitchAmountQ4 = clampSynthPitchModAccumulatorQ4(static_cast<int16_t>(pitchAmountQ4 + amountQ4));
}

void RAM_FUNC(addSynthPitchCeilingAmountQ4)(int16_t amountQ4,
                                                   int16_t& pitchCeilingQ4) {
  if (amountQ4 <= 0) {
    return;
  }
  pitchCeilingQ4 = clampSynthPitchModAccumulatorQ4(static_cast<int16_t>(pitchCeilingQ4 + amountQ4));
}

int16_t RAM_FUNC(synthPitchModDepthCeilingQ4)(uint8_t amountSetting) {
  int16_t depth = synthEffectAmountDepth(amountSetting);
  if (depth == 0) {
    return 0;
  }
  uint16_t absDepth = static_cast<uint16_t>(depth > 0 ? depth : -depth);
  uint16_t ceilingQ4 = static_cast<uint16_t>(absDepth * SYNTH_PITCH_MOD_Q4_SCALE);
  if (ceilingQ4 > SYNTH_PITCH_MOD_MAX_Q4) {
    ceilingQ4 = SYNTH_PITCH_MOD_MAX_Q4;
  }
  return static_cast<int16_t>(ceilingQ4);
}

int16_t RAM_FUNC(combinedWavetablePositionAmount)(int16_t positionModAmount) {
  int16_t amount = static_cast<int16_t>(synthWavetablePosition) + positionModAmount;
  if (amount > 127) {
    return 127;
  }
  if (amount < 0) {
    return 0;
  }
  return amount;
}

int16_t RAM_FUNC(nextSynthNoiseSample)(uint32_t& noiseState) {
  noiseState ^= noiseState << 13;
  noiseState ^= noiseState >> 17;
  noiseState ^= noiseState << 5;
  return static_cast<int16_t>(static_cast<uint8_t>(noiseState >> 24)) - 128;
}

void RAM_FUNC(updateSynthSmoothNoiseSegment)(uint32_t phase,
                                             uint32_t& noiseState,
                                             uint8_t& noiseSegment,
                                             int16_t& previousSample,
                                             int16_t& currentSample) {
  uint8_t segment = phase >> 28;
  if (segment == noiseSegment) {
    return;
  }
  noiseSegment = segment;
  previousSample = currentSample;
  currentSample = nextSynthNoiseSample(noiseState);
}

void RAM_FUNC(updateSynthLfoNoiseSegment)() {
  updateSynthSmoothNoiseSegment(synthLfoPhase,
                                synthLfoNoiseState,
                                synthLfoNoiseSegment,
                                synthLfoNoisePreviousSample,
                                synthLfoNoiseCurrentSample);
}

int16_t RAM_FUNC(readSynthLfoSmoothNoiseSample)() {
  updateSynthLfoNoiseSegment();
  uint8_t frac = static_cast<uint8_t>(synthLfoPhase >> 20);
  int16_t delta = static_cast<int16_t>(synthLfoNoiseCurrentSample - synthLfoNoisePreviousSample);
  return static_cast<int16_t>(synthLfoNoisePreviousSample + ((static_cast<int32_t>(delta) * frac) >> 8));
}

int16_t RAM_FUNC(readSynthVibratoSmoothNoiseSample)() {
  updateSynthSmoothNoiseSegment(synthVibratoPhase,
                                synthVibratoNoiseState,
                                synthVibratoNoiseSegment,
                                synthVibratoNoisePreviousSample,
                                synthVibratoNoiseCurrentSample);
  uint8_t frac = static_cast<uint8_t>(synthVibratoPhase >> 20);
  int16_t delta = static_cast<int16_t>(synthVibratoNoiseCurrentSample - synthVibratoNoisePreviousSample);
  return static_cast<int16_t>(synthVibratoNoisePreviousSample + ((static_cast<int32_t>(delta) * frac) >> 8));
}

int16_t RAM_FUNC(readSynthLfoSample)() {
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
    case SYNTH_LFO_WAVE_NOISE:
      updateSynthLfoNoiseSegment();
      return synthLfoNoiseCurrentSample;
    case SYNTH_LFO_WAVE_SMOOTH_NOISE:
      return readSynthLfoSmoothNoiseSample();
    case SYNTH_LFO_WAVE_SINE:
    default: {
      uint16_t sinePhase = synthWaveSampleIndexFromPhase32(synthLfoPhase);
      return static_cast<int16_t>(synthVibratoSine[sinePhase]) - 128;
    }
  }
}

int16_t RAM_FUNC(synthLfoModValue)(uint8_t elapsedTicks = 1) {
  int16_t depth = synthEffectAmountDepth(synthLfoAmount);
  if (depth == 0) {
    return 0;
  }
  synthLfoPhase += synthLfoPhaseIncrement * static_cast<uint32_t>(elapsedTicks ? elapsedTicks : 1);
  int16_t sample = readSynthLfoSample();
  int32_t scaled = static_cast<int32_t>(sample) * static_cast<int32_t>(depth);
  return static_cast<int16_t>(scaled >> 7);
}

int16_t RAM_FUNC(synthLfoPitchModValueQ4)(uint8_t elapsedTicks = 1) {
  int16_t depth = synthEffectAmountDepth(synthLfoAmount);
  if (depth == 0) {
    return 0;
  }
  synthLfoPhase += synthLfoPhaseIncrement * static_cast<uint32_t>(elapsedTicks ? elapsedTicks : 1);
  int16_t sample = readSynthLfoSample();
  int32_t scaledQ4 = static_cast<int32_t>(sample) * static_cast<int32_t>(depth);
  return clampSynthPitchModAccumulatorQ4(static_cast<int16_t>(scaledQ4 >> 3));
}

void RAM_FUNC(addSynthTargetAmount)(uint8_t target,
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

uint32_t RAM_FUNC(synthPitchRatioQ16FromAmountQ4)(int16_t pitchAmountQ4) {
  uint16_t depthQ4 = static_cast<uint16_t>(pitchAmountQ4 > 0 ? pitchAmountQ4 : -pitchAmountQ4);
  if (depthQ4 > SYNTH_PITCH_MOD_MAX_Q4) {
    depthQ4 = SYNTH_PITCH_MOD_MAX_Q4;
  }
  uint16_t halfRangeDepthQ4 = depthQ4 >> 1;
  return (pitchAmountQ4 > 0) ? synthPitchModPositiveQ16ByQ4[halfRangeDepthQ4]
                             : synthPitchModNegativeQ16ByQ4[halfRangeDepthQ4];
}

uint32_t RAM_FUNC(applySynthPitchMod)(uint32_t increment, int16_t pitchAmountQ4) {
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

bool RAM_FUNC(synthControlTickDue)() {
  if (synthControlSampleCountdown == 0) {
    synthControlSampleCountdown = SYNTH_CONTROL_RATE_SAMPLES - 1;
    return true;
  }
  --synthControlSampleCountdown;
  return false;
}

void RAM_FUNC(refreshSynthBaseModulationCache)(uint8_t elapsedTicks) {
  synthBaseModulationCache = {};
  const uint8_t synthModValue = scaleSynthModAmount(smoothedSynthModValue(elapsedTicks));
  if (synthModTarget == SYNTH_MOD_TARGET_PITCH) {
    int16_t pitchAmountQ4 = static_cast<int16_t>(synthModValue * SYNTH_PITCH_MOD_Q4_SCALE);
    addSynthPitchTargetAmountQ4(pitchAmountQ4, synthBaseModulationCache.pitch);
    addSynthPitchCeilingAmountQ4(pitchAmountQ4, synthBaseModulationCache.pitchCeiling);
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
    addSynthPitchCeilingAmountQ4(synthPitchModDepthCeilingQ4(synthLfoAmount),
                                 synthBaseModulationCache.pitchCeiling);
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

void RAM_FUNC(advanceSynthFrequencyControl)(uint8_t voiceIndex, uint8_t elapsedTicks) {
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

void RAM_FUNC(refreshSynthVoiceRenderCache)(uint8_t voiceIndex,
                                                   uint8_t elapsedTicks,
                                                   bool activeWavetableHasFrames,
                                                   bool perVoiceWavetablePosition,
                                                   bool refreshWavetableContext,
                                                   uint8_t activeWaveFrameCount,
                                                   bool& synthVibratoSampleReady,
                                                   int16_t& synthVibratoSample) {
  SynthModulationAmounts voiceModulation = synthBaseModulationCache;
  for (uint8_t envelopeIndex = 0; envelopeIndex < SYNTH_FX_ENVELOPE_COUNT; ++envelopeIndex) {
    refreshCachedEffectEnvelopeModValue(envelopeIndex, voiceIndex, elapsedTicks);
    if (synthEffectEnvelopeActive[envelopeIndex]) {
      if (effectEnvelopeTarget[envelopeIndex] == SYNTH_MOD_TARGET_PITCH) {
        int16_t envelopePitchQ4 = effectEnvelopePitchModValueQ4(envelopeIndex,
                                                                effectEnvelopeStates[envelopeIndex][voiceIndex]);
        addSynthPitchTargetAmountQ4(envelopePitchQ4, voiceModulation.pitch);
        addSynthPitchCeilingAmountQ4(envelopePitchQ4, voiceModulation.pitchCeiling);
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

  uint32_t basePhaseIncrement = synth[voiceIndex].increment;
  uint32_t phaseIncrement = basePhaseIncrement;
  uint32_t maxExpectedPhaseIncrement = basePhaseIncrement;
  if (voiceModulation.pitch != 0) {
    phaseIncrement = applySynthPitchMod(phaseIncrement, voiceModulation.pitch);
  }
  if (voiceModulation.pitchCeiling > 0) {
    maxExpectedPhaseIncrement = applySynthPitchMod(maxExpectedPhaseIncrement, voiceModulation.pitchCeiling);
  }
  if (voiceModulation.vibrato != 0) {
    if (!synthVibratoSampleReady) {
      if (elapsedTicks != 0) {
        synthVibratoPhase += synthVibratoPhaseIncrement * static_cast<uint32_t>(elapsedTicks);
      }
      synthVibratoSample = (synthVibratoSpeed == SYNTH_VIBRATO_SPEED_NOISE)
        ? readSynthVibratoSmoothNoiseSample()
        : static_cast<int16_t>(synthVibratoSine[synthWaveSampleIndexFromPhase32(synthVibratoPhase)]) - 128;
      synthVibratoSampleReady = true;
    }
    int16_t voiceVibratoAmount = synthVibratoSample * voiceModulation.vibrato;
    if (voiceVibratoAmount != 0) {
      phaseIncrement = applySynthVibrato(phaseIncrement, voiceVibratoAmount);
    }
    uint16_t maxVibratoAmount = static_cast<uint16_t>(voiceModulation.vibrato < 0
      ? -voiceModulation.vibrato
      : voiceModulation.vibrato) * 128u;
    maxExpectedPhaseIncrement = applySynthVibrato(maxExpectedPhaseIncrement, static_cast<int16_t>(maxVibratoAmount));
  }

  SynthVoiceRenderCache& cache = synthVoiceRenderCaches[voiceIndex];
  retargetSynthVoiceSlews(cache,
                          phaseIncrement,
                          voiceModulation,
                          elapsedTicks,
                          elapsedTicks == 0 || !synthVoiceRenderCacheValid[voiceIndex]);
  if (activeWavetableHasFrames && refreshWavetableContext) {
    SynthWavetableMipSelection mipSelection =
      synthWavetableMipSelectionForMaxPhaseIncrement(maxExpectedPhaseIncrement);
    uint8_t selectedMipLevel =
      (mipSelection.brightLevel == mipSelection.dullLevel
       || mipSelection.brightBlend >= SYNTH_WAVETABLE_MIP_BRIGHT_SELECT_THRESHOLD)
        ? mipSelection.brightLevel
        : mipSelection.dullLevel;
    cache.wavetableMipLevel = selectedMipLevel;
    uint16_t framePosition = perVoiceWavetablePosition
      ? wavetableFramePositionFromAmount(combinedWavetablePositionAmount(voiceModulation.wavetablePosition))
      : synthSharedWavetableFramePosition;
    cache.wavetableContext =
      wavetableReadContextFromFramePosition(framePosition, activeWaveFrameCount, selectedMipLevel);
  } else if (!activeWavetableHasFrames) {
    cache.wavetableContext = { activeSynthWaveTable[0], nullptr, 0 };
    cache.wavetableMipLevel = 0;
  }
  synthVoiceRenderCacheValid[voiceIndex] = true;
}
