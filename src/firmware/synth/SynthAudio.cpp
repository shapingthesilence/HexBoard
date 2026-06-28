#include "SynthAudioInternal.h"

volatile uint16_t metronomeBeepSamplesRemaining = 0;
volatile uint32_t metronomeBeepPhaseIncrement = METRONOME_BEEP_NORMAL_INCREMENT;
uint32_t metronomeBeepPhase = 0;

void RAM_FUNC(recordAudioBufferProfileSample)(uint32_t startTime, uint8_t voices, uint8_t flags) {
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

uint32_t RAM_FUNC(oscillatorIncrementFromFrequency)(float frequency) {
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

void RAM_FUNC(smoothUint32Toward)(uint32_t& current, uint32_t target, uint8_t shift) {
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

void RAM_FUNC(smoothUint32Toward)(uint32_t& current, uint32_t target, uint8_t shift, uint8_t elapsedTicks) {
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

void RAM_FUNC(smoothUint16Toward)(uint16_t& current, uint16_t target, uint8_t shift) {
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

void RAM_FUNC(smoothUint16Toward)(uint16_t& current, uint16_t target, uint8_t shift, uint8_t elapsedTicks) {
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

uint32_t RAM_FUNC(ticksFromMicros)(uint32_t micros) {
  if (micros == 0) {
    return 0;
  }
  return static_cast<uint32_t>((static_cast<uint64_t>(micros) * AUDIO_SAMPLE_RATE_HZ + 999999ULL) / 1000000ULL);
}

uint32_t RAM_FUNC(envelopeAudioLevel)(uint32_t level) {
  if (level > envelopeMaxLevel) {
    level = envelopeMaxLevel;
  }
  return level >> ENVELOPE_LEVEL_SCALE_SHIFT;
}

uint16_t RAM_FUNC(releaseIncrementForLevel)(uint32_t level) {
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

uint16_t RAM_FUNC(effectReleaseIncrementForLevel)(uint8_t envelopeIndex, uint32_t level) {
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


int32_t RAM_FUNC(readMetronomeBeepSample)() {
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

bool RAM_FUNC(metronomeBeepSelected)() {
  return metronomeMode == METRONOME_MODE_BEEP;
}

bool RAM_FUNC(metronomeEnabled)() {
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


AudioOutputLevels RAM_FUNC(renderAudioOutputLevels)(byte destination) {
  AudioOutputLevels output;
  if (destination == AUDIO_BOTH) {
    destination = selectedAudioDmaDestination();
  }
  if (destination == AUDIO_NONE) {
    return output;
  }
  if (flashWriteInProgress.load(std::memory_order_relaxed) || synthWaveTableLoadInProgress) {
    return output;
  }
  int32_t mix = 0;    // signed accumulator stays well within int32_t bounds
  const int32_t metronomeSample = readMetronomeBeepSample();
  const bool metronomeAudible = metronomeSample != 0;
  const bool synthControlTick = synthControlTickDue();
  bool synthWavetableContextTick = false;
  if (synthControlTick) {
    refreshSynthBaseModulationCache(SYNTH_CONTROL_RATE_SAMPLES);
    if (synthWavetableContextTickDivider == 0) {
      synthWavetableContextTick = true;
      synthWavetableContextTickDivider = SYNTH_WAVETABLE_CONTEXT_RATE_DIVIDER - 1;
    } else {
      --synthWavetableContextTickDivider;
    }
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
  if (synthControlTick && synthWavetableContextTick) {
    synthSharedWavetableFramePosition =
      (activeWavetableHasFrames && !perVoiceWavetablePosition)
        ? wavetableFramePositionFromAmount(combinedWavetablePositionAmount(synthBaseModulationCache.wavetablePosition))
        : 0;
  }
  for (byte i = 0; i < voiceLimit; i++) {
    EnvelopeState& env = envelopeStates[i];
    bool forceVoiceRenderCacheRefresh = false;

    EnvelopeCommand pendingCommand = consumeEnvelopeCommand(i);
    switch (pendingCommand) {
      case EnvelopeCommand::StartAttack: {
        clearSynthStealFade(i);
        startSynthVoiceAttackInRender(i, env, forceVoiceRenderCacheRefresh);
        break;
      }
      case EnvelopeCommand::StartRelease: {
        clearSynthStealFade(i);
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
      case EnvelopeCommand::StartStealFade:
        releaseRetries[i] = 0;
        releaseRetryCountdown[i] = 0;
        synthStealFadeSamplesRemaining[i] = SYNTH_STEAL_FADE_SAMPLES;
        break;
      case EnvelopeCommand::Reset: {
        clearSynthStealFade(i);
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
        synthVoiceStartTimes[i] = 0;
        synthVoiceReleaseTimes[i] = 0;
        break;
      }
      case EnvelopeCommand::None:
      default:
        break;
    }

    if (!synth[i].targetIncrement && env.stage == EnvelopeStage::Idle) {
      if (synthStealFadeInProgress(i)) {
        finishSynthStealFade(i, env, forceVoiceRenderCacheRefresh);
      }
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
      bool refreshWavetableContext =
        forceVoiceRenderCacheRefresh || !synthVoiceRenderCacheValid[i] || synthWavetableContextTick;
      if (refreshWavetableContext
          && activeWavetableHasFrames
          && !perVoiceWavetablePosition
          && !synthWavetableContextTick) {
        synthSharedWavetableFramePosition =
          wavetableFramePositionFromAmount(combinedWavetablePositionAmount(synthBaseModulationCache.wavetablePosition));
      }
      refreshSynthVoiceRenderCache(i,
                                   (synthControlTick && !forceVoiceRenderCacheRefresh)
                                     ? SYNTH_FX_ENVELOPE_CONTROL_TICKS
                                     : 0,
                                   activeWavetableHasFrames,
                                   perVoiceWavetablePosition,
                                   refreshWavetableContext,
                                   activeWaveFrameCount,
                                   synthVibratoSampleReady,
                                   synthVibratoSample);
    }
    SynthVoiceRenderCache& voiceCache = synthVoiceRenderCaches[i];
    synth[i].counter += voiceCache.phaseIncrement;  // high 16 bits loop from 65535 -> 0
    p = static_cast<uint16_t>(synth[i].counter >> 16);
    if (voiceCache.phaseWarpActive) {
      if (voiceCache.foldWarpAmountQ4 != 0) {
        p = applySynthFoldPhaseWarpQ4(p, voiceCache.foldWarpAmountQ4);
      }
      if (voiceCache.dutyWarpAmountQ4 != 0) {
        p = applySynthDutyPhaseWarpQ4(p, voiceCache.dutyWarpAmountQ4);
      }
      if (voiceCache.polyWarpAmountQ4 != 0) {
        p = applySynthPolyPhaseWarpQ4(p, voiceCache.polyWarpAmountQ4);
      }
    }
    if (voiceCache.slewsActive) {
      advanceSynthVoiceSlews(voiceCache);
    }
    if (activeWavetableHasFrames) {
      const SynthWavetableReadContext& context = voiceCache.wavetableContext;
      p = context.frameB
        ? readActiveWavetableInterpolatedFrameSample(p, context)
        : readActiveWavetableFrameSample(p, context.frameA);
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
    uint32_t audibleEnvAudio = envAudio;
    uint16_t stealFadeGain = synthStealFadeGainQ8(i);
    if (stealFadeGain < 256) {
      s = (s * static_cast<int32_t>(stealFadeGain)) >> 8;
      audibleEnvAudio = (audibleEnvAudio * static_cast<uint32_t>(stealFadeGain)) >> 8;
    }
    s = (s * static_cast<int32_t>(envAudio)) >> 16;
    int16_t owner = synthChannelOwners[i].load(std::memory_order_relaxed);
    if (owner >= SYNTH_PREVIEW_SLOT_START && owner < BTN_COUNT) {
      uint8_t slotIndex = static_cast<uint8_t>(owner - SYNTH_PREVIEW_SLOT_START);
      if (slotIndex < SYNTH_PREVIEW_SLOT_COUNT) {
        // Sequencer preview slots carry per-step velocity into the shared synth mix.
        s = (s * static_cast<int32_t>(synthPreviewVelocityForSlot[slotIndex])) >> 7;
      }
    }

    // Accumulate signed mix
    mix += s;

    // For Step 1 smooth normalization:
    envSum += audibleEnvAudio;
    ++voices;

    if (synthStealFadeInProgress(i)) {
      --synthStealFadeSamplesRemaining[i];
      if (!synthStealFadeInProgress(i)) {
        finishSynthStealFade(i, env, forceVoiceRenderCacheRefresh);
      }
    }
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

  if (destination == AUDIO_AJACK) {
    synthPiezoAmplitude = 0;
    // ----- JACK: fixed midpoint with V1.2 headphone-only output cap -----
    int32_t jackSample = sample;
    if (headphoneVolumeCap < HEADPHONE_VOLUME_CAP_FULL) {
      jackSample = (jackSample * static_cast<int32_t>(headphoneVolumeCap)) >> 7;
    }
    int32_t jack = PWM_MID + jackSample;
    if (jack < 0) jack = 0;
    if (jack > (int32_t)PWM_WRAP) jack = PWM_WRAP;
    output.jack = static_cast<uint16_t>(jack);
    output.voices = voices;
    output.profileFlags = profileFlags;
    applyAudioOutputMute(output, destination);
    return output;
  }

  // ----- PIEZO: midpoint follows "actual amplitude" from envSum -----
  //
  // IMPORTANT: envSum is sum of envelopes (0..~524k). We want ONE full voice
  // (envSum ~ 65535) to produce full piezo amplitude. So we shift by 9 (8-bit),
  // 8 (9-bit), or 7 (10-bit). With multiple voices envSum grows, so we clamp.
  //
  // This makes piezo loud enough and ensures it fades smoothly as envSum falls.
  //
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
  synthPiezoAmplitude += (int16_t)((int32_t)A_target - (int32_t)synthPiezoAmplitude) >> 3;

  // If very small, turn fully off (by now it’s near 0 so this won’t click).
  if (synthPiezoAmplitude <= PIEZO_OFF_THRESHOLD) synthPiezoAmplitude = 0;

  int32_t piezoLevel = 0;
  if (synthPiezoAmplitude > 0) {
    // Scale sample [-SHAPE_CLAMP..SHAPE_CLAMP] -> outPiezo [-synthPiezoAmplitude..+synthPiezoAmplitude].
    // Use a power-of-two fixed-point scale to keep the piezo path cheap in the
    // audio renderer.
    profileFlags |= ISR_PROFILE_FLAG_PIEZO_SCALE;
    int32_t outPiezo = scalePiezoSample(sample, synthPiezoAmplitude);

    // Midpoint follows amplitude: range [0..2*synthPiezoAmplitude]
    piezoLevel = (int32_t)synthPiezoAmplitude + outPiezo;
    int32_t piezoMax = (int32_t)synthPiezoAmplitude * 2;

    if (piezoLevel < 0) piezoLevel = 0;
    if (piezoLevel > piezoMax) piezoLevel = piezoMax;
    if (piezoLevel > (int32_t)PWM_WRAP) piezoLevel = PWM_WRAP;
  }

  output.piezo = static_cast<uint16_t>(piezoLevel);
  output.voices = voices;
  output.profileFlags = profileFlags;
  applyAudioOutputMute(output, destination);
  return output;
}

static void setupSynth(byte pin, byte slice) {
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
