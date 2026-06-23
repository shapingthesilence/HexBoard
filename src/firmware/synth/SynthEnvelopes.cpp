#include "SynthAudioInternal.h"

void RAM_FUNC(resetEnvelopeState)(EnvelopeState& env) {
  env.level = 0;
  env.releaseIncrement = 0;
  env.holdTicksRemaining = 0;
  env.stage = EnvelopeStage::Idle;
}

std::array<EnvelopeState, POLYPHONY_LIMIT> envelopeStates;
std::array<std::array<EnvelopeState, POLYPHONY_LIMIT>, SYNTH_FX_ENVELOPE_COUNT> effectEnvelopeStates;
int16_t cachedEffectEnvelopeModValues[SYNTH_FX_ENVELOPE_COUNT][POLYPHONY_LIMIT] = {};

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
// Publish the newest command for one voice. The command byte is written first,
// then a memory barrier makes sure core 1 cannot observe the new sequence
// number before the matching command value is visible.
void RAM_FUNC(publishEnvelopeCommand)(uint8_t channel, EnvelopeCommand command) {
  envelopeCommandValues[channel] = static_cast<uint8_t>(command);
  __dmb();
  envelopeCommandPublishedSeq[channel] = static_cast<uint8_t>(envelopeCommandPublishedSeq[channel] + 1);
}

// Read the newest command once. Returning None means nothing new arrived since
// the last ISR iteration for this voice.
EnvelopeCommand RAM_FUNC(consumeEnvelopeCommand)(uint8_t channel) {
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
void RAM_FUNC(publishVoiceFreed)(uint8_t channel) {
  __dmb();
  voiceFreedPublishedSeq[channel] = static_cast<uint8_t>(voiceFreedPublishedSeq[channel] + 1);
}

// Core 0 checks whether core 1 has published a newer "voice finished" event.
bool RAM_FUNC(consumeVoiceFreed)(uint8_t channel) {
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
void RAM_FUNC(clearPendingVoiceFreed)(uint8_t channel) {
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

int16_t synthEffectAmountDepth(uint8_t amountSetting) {
  return static_cast<int16_t>(amountSetting) - static_cast<int16_t>(SYNTH_FX_AMOUNT_OFF);
}

void RAM_FUNC(advanceEnvelopeFromAttackPeak)(const EnvelopeParams& params, EnvelopeState& env) {
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

void RAM_FUNC(updateEnvelopeHoldStage)(const EnvelopeParams& params, EnvelopeState& env) {
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
