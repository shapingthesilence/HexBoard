#include "SynthAudioInternal.h"

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
byte piezoVolumeCap = HEADPHONE_VOLUME_CAP_FULL;
extern const uint32_t AUDIO_DMA_BUFFER_MICROS =
  (static_cast<uint64_t>(AUDIO_DMA_BUFFER_SAMPLE_COUNT) * 1000000ull) / AUDIO_SAMPLE_RATE_HZ;
volatile uint16_t audioOutputMuteGainQ8 = AUDIO_OUTPUT_MUTE_GAIN_FULL_Q8;
volatile uint16_t audioOutputMuteTargetQ8 = AUDIO_OUTPUT_MUTE_GAIN_FULL_Q8;
uint16_t synthPiezoAmplitude = 0;

constexpr uint8_t SYNTH_DRIVE_LOOKUP_MODE_COUNT = SYNTH_DRIVE_DIRTY - SYNTH_DRIVE_WARM + 1;
constexpr size_t SYNTH_DRIVE_LOOKUP_SAMPLE_COUNT = static_cast<size_t>(SHAPE_CLAMP + 1);
static int16_t synthDriveLookup[SYNTH_DRIVE_LOOKUP_MODE_COUNT][SYNTH_DRIVE_LOOKUP_SAMPLE_COUNT] = {};

void RAM_FUNC(idlePhysicalAudioOutputs)();
void RAM_FUNC(preparePhysicalAudioOutput)(byte destination);
byte RAM_FUNC(selectedAudioDmaDestination)();
void RAM_FUNC(clearSynthPortamento)(uint8_t channelIndex);
void RAM_FUNC(beginSynthPortamento)(uint8_t channelIndex, uint32_t targetIncrement);
void startAudioDmaForDestination(byte destination);

bool audioJackAvailable() {
  return Hardware_Version == HARDWARE_V1_2;
}

bool decodeStoredBuzzerEnabled(uint8_t storedValue) {
  if (!audioJackAvailable()) {
    return true;
  }
  return (storedValue & AUDIO_PIEZO) != 0;
}

byte runtimeAudioDestination(bool buzzerEnabled) {
  if (!audioJackAvailable()) {
    return AUDIO_PIEZO;
  }
  return buzzerEnabled ? AUDIO_PIEZO : AUDIO_AJACK;
}

void syncAudioDestinationToRuntime() {
  audioD = runtimeAudioDestination(synthBuzzerEnabled);
  preparePhysicalAudioOutput(audioD);
}

uint8_t RAM_FUNC(currentSynthVoiceLimit)() {
  return synthPlaybackVoiceLimit(playbackMode);
}

void setAudioOutputMuteTarget(bool muted) {
  audioOutputMuteTargetQ8 = muted ? 0 : AUDIO_OUTPUT_MUTE_GAIN_FULL_Q8;
  __dmb();
}

bool audioOutputMuteSettled(bool muted) {
  uint16_t target = muted ? 0 : AUDIO_OUTPUT_MUTE_GAIN_FULL_Q8;
  return audioOutputMuteGainQ8 == target;
}

void RAM_FUNC(advanceAudioOutputMuteRamp)() {
  uint16_t target = audioOutputMuteTargetQ8;
  uint16_t gain = audioOutputMuteGainQ8;
  if (gain < target) {
    uint16_t next = static_cast<uint16_t>(gain + AUDIO_OUTPUT_MUTE_RAMP_STEP_Q8);
    gain = next > target ? target : next;
  } else if (gain > target) {
    gain = (gain <= AUDIO_OUTPUT_MUTE_RAMP_STEP_Q8)
             ? target
             : static_cast<uint16_t>(gain - AUDIO_OUTPUT_MUTE_RAMP_STEP_Q8);
    if (gain < target) {
      gain = target;
    }
  }
  audioOutputMuteGainQ8 = gain;
}

uint16_t RAM_FUNC(applyAudioOutputMuteLevel)(uint16_t level, byte destination) {
  uint16_t gain = audioOutputMuteGainQ8;
  if (gain >= AUDIO_OUTPUT_MUTE_GAIN_FULL_Q8) {
    return level;
  }
  int32_t idle = (destination == AUDIO_PIEZO) ? PIEZO_IDLE_LEVEL : JACK_IDLE_LEVEL;
  int32_t faded = idle + (((static_cast<int32_t>(level) - idle) * static_cast<int32_t>(gain)) >> 8);
  if (faded < 0) {
    return 0;
  }
  if (faded > PWM_WRAP) {
    return PWM_WRAP;
  }
  return static_cast<uint16_t>(faded);
}

void RAM_FUNC(applyAudioOutputMute)(AudioOutputLevels& output, byte destination) {
  advanceAudioOutputMuteRamp();
  if (destination == AUDIO_PIEZO) {
    output.piezo = applyAudioOutputMuteLevel(output.piezo, AUDIO_PIEZO);
  } else if (destination == AUDIO_AJACK) {
    output.jack = applyAudioOutputMuteLevel(output.jack, AUDIO_AJACK);
  }
}

void RAM_FUNC(writeAudioOutputLevels)(uint16_t piezoLevel, uint16_t jackLevel) {
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

int32_t RAM_FUNC(scalePiezoSample)(int32_t sample, uint16_t amplitude) {
#if (PWM_BITS == 8)
  constexpr uint8_t PIEZO_SCALE_SHIFT = 7;
#elif (PWM_BITS == 9)
  constexpr uint8_t PIEZO_SCALE_SHIFT = 8;
#else
  constexpr uint8_t PIEZO_SCALE_SHIFT = 9;
#endif
  return (sample * static_cast<int32_t>(amplitude)) >> PIEZO_SCALE_SHIFT;
}

static uint16_t synthDriveGainQ8(byte driveMode) {
  switch (driveMode) {
    case SYNTH_DRIVE_WARM: return 256;
    case SYNTH_DRIVE_EDGE: return 384;
    case SYNTH_DRIVE_DIRTY: return 640;
    case SYNTH_DRIVE_OFF:
    default:
      return 256;
  }
}

static int16_t shapeSynthDriveMagnitude(int32_t magnitude, byte driveMode) {
  uint16_t gainQ8 = synthDriveGainQ8(driveMode);

  int32_t x = (magnitude * static_cast<int32_t>(gainQ8)) >> 8;
  if (x > SHAPE_CLAMP) x = SHAPE_CLAMP;

  const uint32_t mag = static_cast<uint32_t>(x);
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
  return static_cast<int16_t>(shaped);
}

void initializeSynthDriveLookup() {
  for (byte driveMode = SYNTH_DRIVE_WARM; driveMode <= SYNTH_DRIVE_DIRTY; ++driveMode) {
    int16_t* table = synthDriveLookup[driveMode - SYNTH_DRIVE_WARM];
    for (int32_t magnitude = 0; magnitude <= SHAPE_CLAMP; ++magnitude) {
      table[static_cast<size_t>(magnitude)] = shapeSynthDriveMagnitude(magnitude, driveMode);
    }
  }
}

int32_t RAM_FUNC(applySynthDrive)(int32_t sample) {
  byte driveMode = synthDrive;
  if (driveMode == SYNTH_DRIVE_OFF || driveMode > SYNTH_DRIVE_DIRTY) {
    return sample;
  }
  if (sample > SHAPE_CLAMP) sample = SHAPE_CLAMP;
  if (sample < -SHAPE_CLAMP) sample = -SHAPE_CLAMP;
  bool negative = sample < 0;
  uint16_t magnitude = static_cast<uint16_t>(negative ? -sample : sample);
  int32_t shaped = synthDriveLookup[driveMode - SYNTH_DRIVE_WARM][magnitude];
  return negative ? -shaped : shaped;
}

uint32_t audioDmaBuffers[2][AUDIO_DMA_BUFFER_SAMPLE_COUNT] = {};
uint32_t audioDmaSilenceBuffer[AUDIO_DMA_BUFFER_SAMPLE_COUNT] = {};
volatile bool audioDmaBufferReady[2] = { false, false };
volatile bool audioDmaBufferFree[2] = { true, true };
volatile uint8_t audioDmaActiveBuffer = 0;
volatile uint32_t audioDmaUnderrunCount = 0;
volatile bool audioDmaPausedForFlashWrite = false;
int audioDmaChannel = -1;
byte audioDmaActiveDestination = AUDIO_NONE;
uint8_t audioDmaActiveSlice = AJACK_SLICE;
uintptr_t audioDmaWriteAddress = 0;
dma_channel_config audioDmaConfig;
std::atomic<bool> synthRuntimeReady = false;

byte RAM_FUNC(selectedAudioDmaDestination)() {
  byte destination = audioD;
  if (destination & AUDIO_AJACK) {
    return AUDIO_AJACK;
  }
  if (destination & AUDIO_PIEZO) {
    return AUDIO_PIEZO;
  }
  return AUDIO_NONE;
}

uint8_t RAM_FUNC(audioDmaSliceForDestination)(byte destination) {
  return (destination == AUDIO_PIEZO) ? PIEZO_SLICE : AJACK_SLICE;
}

uint16_t RAM_FUNC(audioDmaLevelForDestination)(const AudioOutputLevels& levels, byte destination) {
  if (destination == AUDIO_PIEZO) {
    return levels.piezo;
  }
  if (destination == AUDIO_AJACK) {
    return levels.jack;
  }
  return JACK_IDLE_LEVEL;
}

uint32_t RAM_FUNC(audioDmaEncodeLevel)(uint16_t level) {
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
  if (audioDmaPausedForFlashWrite) {
    return;
  }

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
    AudioOutputLevels levels = renderAudioOutputLevels(destination);
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
    dma_hw->ints0 = 1u << audioDmaChannel;
  }
  audioDmaBufferReady[0] = false;
  audioDmaBufferReady[1] = false;
  audioDmaBufferFree[0] = true;
  audioDmaBufferFree[1] = true;
  idlePhysicalAudioOutputs();
}

void quiesceAudioDmaForFlashWrite() {
  audioDmaPausedForFlashWrite = true;
  __dmb();
  if (audioDmaChannel >= 0) {
    dma_channel_abort(audioDmaChannel);
    dma_hw->ints0 = 1u << audioDmaChannel;
  }
  audioDmaBufferReady[0] = false;
  audioDmaBufferReady[1] = false;
  audioDmaBufferFree[0] = true;
  audioDmaBufferFree[1] = true;
  idlePhysicalAudioOutputs();
}

void resumeAudioDmaAfterFlashWrite() {
  if (audioDmaChannel >= 0) {
    startAudioDmaForDestination(selectedAudioDmaDestination());
  }
  __dmb();
  audioDmaPausedForFlashWrite = false;
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
  if (audioDmaPausedForFlashWrite) {
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
