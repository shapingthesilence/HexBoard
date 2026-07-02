#include "SynthAudioInternal.h"

byte activeSynthWaveTable[SYNTH_WAVETABLE_FRAME_COUNT][SYNTH_WAVE_SAMPLE_COUNT] = {};
byte activeSynthWavetableMipExtraSamples[SYNTH_WAVETABLE_MIP_EXTRA_SAMPLE_BYTES] = {};
byte synthVibratoSine[SYNTH_WAVE_SAMPLE_COUNT] = {};
volatile bool synthWaveTableLoadInProgress = false;
byte loadedSynthWaveform = 255;
char loadedSynthWavetableName[SYNTH_WAVETABLE_NAME_LENGTH] = {};
char loadedSynthWavetableFolderPath[SYNTH_WAVETABLE_FOLDER_LENGTH] = {};
volatile uint8_t activeSynthWaveFrameCount = 1;
volatile uint8_t activeSynthWavetableMipLevelCount = 1;
uint16_t synthWavetableFramePositionByAmount[128] = {};
bool userSynthWavetableAvailable = false;

oscillator synth[POLYPHONY_LIMIT];
byte attenuation[] = { 64, 24, 17, 14, 12, 11, 10, 9, 8 };
float pitchBendFactor = 1.0f;

uint16_t RAM_FUNC(synthWaveSampleIndexFromPhase16)(uint16_t phase) {
  return phase >> SYNTH_WAVE_PHASE_FRACTION_BITS;
}

uint16_t RAM_FUNC(synthWaveSampleIndexFromPhase32)(uint32_t phase) {
  return phase >> (32 - SYNTH_WAVE_SAMPLE_BITS);
}

uint8_t RAM_FUNC(synthWaveInterpolationFraction)(uint16_t phase) {
  return static_cast<uint8_t>((phase & SYNTH_WAVE_PHASE_FRACTION_MASK) << (8 - SYNTH_WAVE_PHASE_FRACTION_BITS));
}

uint16_t RAM_FUNC(synthWavePhaseFromSampleIndex)(uint16_t sampleIndex) {
  return static_cast<uint16_t>(sampleIndex << SYNTH_WAVE_PHASE_FRACTION_BITS);
}

size_t RAM_FUNC(synthWavetableMipExtraLevelOffset)(uint8_t level) {
  if (level <= 1) {
    return 0;
  }
  return static_cast<size_t>(level - 1) * SYNTH_WAVETABLE_SAMPLE_BYTES;
}

byte* RAM_FUNC(activeSynthWavetableMipFrame)(uint8_t level, uint8_t frameIndex) {
  if (level == 0) {
    return activeSynthWaveTable[frameIndex];
  }
  return activeSynthWavetableMipExtraSamples
    + synthWavetableMipExtraLevelOffset(level)
    + (static_cast<size_t>(frameIndex) * SYNTH_WAVETABLE_MIP_SAMPLES_PER_FRAME);
}

bool isSupportedSynthWavetableSampleLength(size_t sampleLength) {
  return sampleLength == SYNTH_WAVETABLE_SAMPLE_BYTES
      || sampleLength == SYNTH_WAVETABLE_MIP_SAMPLE_BYTES;
}

void setActiveSynthWavetableMipLevelCount(uint8_t levelCount) {
  if (levelCount < 1) {
    levelCount = 1;
  } else if (levelCount > SYNTH_WAVETABLE_MIP_LEVEL_COUNT) {
    levelCount = SYNTH_WAVETABLE_MIP_LEVEL_COUNT;
  }
  __dmb();
  activeSynthWavetableMipLevelCount = levelCount;
}

void rebuildActiveSynthWavetableFixedMipsFromBase() {
  for (uint8_t level = 1; level < SYNTH_WAVETABLE_MIP_LEVEL_COUNT; ++level) {
    for (uint8_t frameIndex = 0; frameIndex < SYNTH_WAVETABLE_FRAME_COUNT; ++frameIndex) {
      const byte* previousFrame = activeSynthWavetableMipFrame(level - 1, frameIndex);
      byte* frame = activeSynthWavetableMipFrame(level, frameIndex);
      for (uint16_t sampleIndex = 0; sampleIndex < SYNTH_WAVETABLE_MIP_SAMPLES_PER_FRAME; ++sampleIndex) {
        uint16_t previousIndex = (sampleIndex == 0) ? (SYNTH_WAVETABLE_MIP_SAMPLES_PER_FRAME - 1) : (sampleIndex - 1);
        uint16_t nextIndex = static_cast<uint16_t>(sampleIndex + 1);
        if (nextIndex >= SYNTH_WAVETABLE_MIP_SAMPLES_PER_FRAME) {
          nextIndex = 0;
        }
        uint16_t filtered = static_cast<uint16_t>(previousFrame[previousIndex])
                          + static_cast<uint16_t>(previousFrame[sampleIndex] << 1)
                          + static_cast<uint16_t>(previousFrame[nextIndex])
                          + 2u;
        frame[sampleIndex] = static_cast<byte>(filtered >> 2);
      }
    }
  }
  setActiveSynthWavetableMipLevelCount(SYNTH_WAVETABLE_MIP_LEVEL_COUNT);
}

void loadActiveSynthWavetableSamples(const uint8_t* samples, size_t sampleLength) {
  if (samples == nullptr || !isSupportedSynthWavetableSampleLength(sampleLength)) {
    return;
  }
  memcpy(&activeSynthWaveTable[0][0], samples, SYNTH_WAVETABLE_SAMPLE_BYTES);
  if (sampleLength == SYNTH_WAVETABLE_MIP_SAMPLE_BYTES) {
    memcpy(activeSynthWavetableMipExtraSamples,
           samples + SYNTH_WAVETABLE_SAMPLE_BYTES,
           SYNTH_WAVETABLE_MIP_EXTRA_SAMPLE_BYTES);
    setActiveSynthWavetableMipLevelCount(SYNTH_WAVETABLE_MIP_LEVEL_COUNT);
  } else {
    rebuildActiveSynthWavetableFixedMipsFromBase();
  }
}

uint16_t RAM_FUNC(interpolatedWaveSample)(const byte* table, uint16_t phase) {
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
uint16_t RAM_FUNC(readTriangleWaveSample)(uint16_t phase) {
  if (phase < 0x4000u) {
    return static_cast<uint16_t>(0x8000u + (phase << 1));
  }
  if (phase < 0xC000u) {
    return static_cast<uint16_t>(0xFFFFu - ((phase - 0x4000u) << 1));
  }
  return static_cast<uint16_t>((phase - 0xC000u) << 1);
}

uint16_t RAM_FUNC(readSquareWaveSample)(uint16_t phase) {
  constexpr int32_t split = 32768;
  if (phase == 0) {
    return 32768;
  }
  uint16_t shiftedPhase = static_cast<uint16_t>(phase + static_cast<uint16_t>(split));
  return (static_cast<int32_t>(shiftedPhase) > split) ? 65535 : 0;
}

uint16_t RAM_FUNC(readHybridWaveSample)(const oscillator& voice, uint8_t phaseIndex) {
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

uint8_t sample16ToWaveByte(uint16_t sample) {
  return static_cast<uint8_t>(sample >> 8);
}

void loadBuiltinSynthWavetableSamples(const BuiltinSynthWavetableDefinition& table) {
  loadActiveSynthWavetableSamples(table.samples, table.sampleLength);
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
  rebuildActiveSynthWavetableFixedMipsFromBase();
  setActiveSynthWaveFrameCount(SYNTH_WAVETABLE_FRAME_COUNT);
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
  for (uint8_t frameIndex = 0; frameIndex < boundedFrameCount; ++frameIndex) {
    synthWavetableFramePositionByAmount[SYNTH_WAVETABLE_FRAME_POSITION_AMOUNTS[frameIndex]] =
      static_cast<uint16_t>(frameIndex) << 8;
  }
}

void initializeSynthFxModScaleLookup() {
  for (uint16_t depth = 0; depth < 128; ++depth) {
    for (uint16_t value = 0; value < 128; ++value) {
      synthFxModScaleByDepth[depth][value] =
        static_cast<uint8_t>((value * (depth + 1u)) >> 7);
    }
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

void initializeSynthWaveTables() {
  memcpy(synthVibratoSine, waveSineSource, SYNTH_WAVE_SAMPLE_COUNT);
  initializeSynthDriveLookup();
  initializeSynthFxModScaleLookup();
  initializeSynthPitchModLookup();
  setActiveSynthWaveFrameCount(1);
  setActiveSynthWavetableMipLevelCount(1);
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
    loadBuiltinSynthWavetableSamples(*builtinTable);
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
      loadBuiltinSynthWavetableSamples(*fallbackTable);
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

uint16_t RAM_FUNC(wavetableFramePositionFromAmount)(int16_t positionAmount) {
  if (positionAmount <= 0) {
    return 0;
  }
  uint8_t amount = positionAmount > 127 ? 127 : static_cast<uint8_t>(positionAmount);
  return synthWavetableFramePositionByAmount[amount];
}

uint16_t RAM_FUNC(readLoadedWaveFrameSample)(uint16_t phase) {
  return static_cast<uint16_t>(activeSynthWaveTable[0][synthWaveSampleIndexFromPhase16(phase)] << 8);
}


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

void RAM_FUNC(clearSynthPortamento)(uint8_t channelIndex) {
  synth[channelIndex].glideStep = 0;
  synth[channelIndex].glideSamplesRemaining = 0;
}

void RAM_FUNC(beginSynthPortamento)(uint8_t channelIndex, uint32_t targetIncrement) {
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
