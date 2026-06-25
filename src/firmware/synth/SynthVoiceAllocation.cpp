#include "SynthAudioInternal.h"
#include "../sequencer/SequencerTransport.h"

std::queue<byte> synthChQueue;
std::array<std::atomic<bool>, POLYPHONY_LIMIT> channelInUse = {};
std::array<std::atomic<uint32_t>, POLYPHONY_LIMIT> voiceGenerations;
std::array<std::atomic<int16_t>, POLYPHONY_LIMIT> synthChannelOwners;
std::array<uint64_t, POLYPHONY_LIMIT> synthVoiceStartTimes = {};
std::array<uint64_t, POLYPHONY_LIMIT> synthVoiceReleaseTimes = {};
std::array<uint16_t, POLYPHONY_LIMIT> synthStealFadeSamplesRemaining = {};
std::array<int16_t, POLYPHONY_LIMIT> pendingSynthStealOwners = [] {
  std::array<int16_t, POLYPHONY_LIMIT> owners = {};
  owners.fill(NO_SYNTH_OWNER);
  return owners;
}();
std::atomic<uint32_t> nextVoiceGeneration = 1;
std::atomic<bool> flashWriteInProgress = false;
std::array<uint8_t, POLYPHONY_LIMIT> releaseRetries = {};
std::array<uint8_t, POLYPHONY_LIMIT> releaseRetryCountdown = {};

byte arpeggiatingNow = UNUSED_NOTE;
uint64_t arpeggiateTime = 0;
uint64_t arpeggiateLength = 62500;
std::array<byte, BTN_COUNT> arpeggiatorHeldNotes = {};
uint8_t arpeggiatorHeldNoteCount = 0;
std::array<byte, ARPEGGIATOR_SEQUENCE_MAX> arpeggiatorSequence = {};
uint16_t arpeggiatorSequenceLength = 0;
uint16_t arpeggiatorSequenceCursor = 0;
uint32_t arpeggiatorRandomState = 0xA341316Cu;

bool RAM_FUNC(synthStealFadeInProgress)(uint8_t channelIndex) {
  return channelIndex < POLYPHONY_LIMIT && synthStealFadeSamplesRemaining[channelIndex] != 0;
}

bool RAM_FUNC(synthStealHandoffPending)(uint8_t channelIndex) {
  return channelIndex < POLYPHONY_LIMIT
      && (synthStealFadeInProgress(channelIndex)
          || pendingSynthStealOwners[channelIndex] != NO_SYNTH_OWNER);
}

void RAM_FUNC(clearSynthStealFade)(uint8_t channelIndex) {
  if (channelIndex >= POLYPHONY_LIMIT) {
    return;
  }
  synthStealFadeSamplesRemaining[channelIndex] = 0;
  pendingSynthStealOwners[channelIndex] = NO_SYNTH_OWNER;
}

uint16_t RAM_FUNC(synthStealFadeGainQ8)(uint8_t channelIndex) {
  uint16_t remaining = synthStealFadeSamplesRemaining[channelIndex];
  if (remaining == 0 || remaining >= SYNTH_STEAL_FADE_SAMPLES) {
    return 256;
  }
  return static_cast<uint16_t>((static_cast<uint32_t>(remaining) * 256u) / SYNTH_STEAL_FADE_SAMPLES);
}

void RAM_FUNC(startSynthVoiceAttackInRender)(uint8_t channelIndex,
                                             EnvelopeState& env,
                                             bool& forceVoiceRenderCacheRefresh) {
  resetSynthVoiceRenderCache(channelIndex);
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
    EnvelopeState& effectEnv = effectEnvelopeStates[envelopeIndex][channelIndex];
    resetCachedEffectEnvelopeModValue(envelopeIndex, channelIndex);
    if (synthEffectEnvelopeActive[envelopeIndex]) {
      startEffectEnvelopeAttack(envelopeIndex, effectEnv);
    } else {
      resetEnvelopeState(effectEnv);
    }
  }
}

void RAM_FUNC(resetSynthVoiceAfterAbandonedSteal)(uint8_t channelIndex) {
  resetEnvelopeState(envelopeStates[channelIndex]);
  for (uint8_t envelopeIndex = 0; envelopeIndex < SYNTH_FX_ENVELOPE_COUNT; ++envelopeIndex) {
    resetEnvelopeState(effectEnvelopeStates[envelopeIndex][channelIndex]);
    resetCachedEffectEnvelopeModValue(envelopeIndex, channelIndex);
  }
  synth[channelIndex].increment = 0;
  synth[channelIndex].targetIncrement = 0;
  synth[channelIndex].counter = 0;
  clearSynthPortamento(channelIndex);
  resetSynthVoiceRenderCache(channelIndex);
  synthChannelOwners[channelIndex].store(NO_SYNTH_OWNER, std::memory_order_relaxed);
  synthVoiceStartTimes[channelIndex] = 0;
  synthVoiceReleaseTimes[channelIndex] = 0;
  voiceGenerations[channelIndex].store(0, std::memory_order_relaxed);
  publishVoiceFreed(channelIndex);
}

void RAM_FUNC(finishSynthStealFade)(uint8_t channelIndex,
                                           EnvelopeState& env,
                                           bool& forceVoiceRenderCacheRefresh) {
  int16_t owner = pendingSynthStealOwners[channelIndex];
  clearSynthStealFade(channelIndex);
  if (owner < 0 || owner >= BTN_COUNT || h[owner].synthCh != static_cast<byte>(channelIndex + 1)) {
    resetSynthVoiceAfterAbandonedSteal(channelIndex);
    return;
  }
  synthChannelOwners[channelIndex].store(owner, std::memory_order_relaxed);
  synthVoiceReleaseTimes[channelIndex] = 0;
  setSynthFreq(h[owner].frequency, static_cast<byte>(channelIndex + 1), true);
  startSynthVoiceAttackInRender(channelIndex, env, forceVoiceRenderCacheRefresh);
}


void RAM_FUNC(beginEnvelopeAttack)(uint8_t channel) {
  channelInUse[channel].store(true, std::memory_order_relaxed);
  synthVoiceReleaseTimes[channel] = 0;
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
  synthVoiceReleaseTimes[channel] = runTime ? runTime : 1;
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
    synthVoiceStartTimes[i] = 0;
    synthVoiceReleaseTimes[i] = 0;
    clearSynthStealFade(i);
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
        uint8_t channelIndex = h[i].synthCh - 1;
        if (channelIndex < POLYPHONY_LIMIT
            && !synthStealHandoffPending(channelIndex)
            && synthChannelOwners[channelIndex].load(std::memory_order_relaxed) == static_cast<int16_t>(i)) {
          setSynthFreq(h[i].frequency, h[i].synthCh);  // pass all notes thru synth again if the pitch bend changes
        }
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
      synthVoiceStartTimes[i] = 0;
      synthVoiceReleaseTimes[i] = 0;
      clearSynthStealFade(i);
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

bool RAM_FUNC(synthVoiceOwnerValid)(int16_t owner) {
  return owner >= 0 && owner < BTN_COUNT;
}

uint64_t RAM_FUNC(synthVoiceStartOrder)(uint8_t channelIndex) {
  uint64_t startTime = synthVoiceStartTimes[channelIndex];
  if (startTime != 0) {
    return startTime;
  }
  return voiceGenerations[channelIndex].load(std::memory_order_relaxed);
}

bool RAM_FUNC(synthVoicePitchComesBefore)(int16_t leftOwner, int16_t rightOwner) {
  if (h[leftOwner].frequency < h[rightOwner].frequency) {
    return true;
  }
  if (h[leftOwner].frequency > h[rightOwner].frequency) {
    return false;
  }
  if (h[leftOwner].midiNoteIndex < h[rightOwner].midiNoteIndex) {
    return true;
  }
  if (h[leftOwner].midiNoteIndex > h[rightOwner].midiNoteIndex) {
    return false;
  }
  return leftOwner < rightOwner;
}

bool RAM_FUNC(synthVoiceDuplicatesNote)(int16_t owner, byte newNote) {
  if (!synthVoiceOwnerValid(owner) || newNote >= BTN_COUNT) {
    return false;
  }
  return h[owner].midiNoteIndex == h[newNote].midiNoteIndex
      || h[owner].stepsFromC == h[newNote].stepsFromC
      || h[owner].frequency == h[newNote].frequency;
}

bool RAM_FUNC(synthVoiceIsHeld)(uint8_t channelIndex, int16_t owner) {
  return synthVoiceOwnerValid(owner)
      && synthVoiceReleaseTimes[channelIndex] == 0
      && h[owner].synthCh == static_cast<byte>(channelIndex + 1);
}

bool RAM_FUNC(synthVoiceCanBeStolen)(uint8_t channelIndex, int16_t owner) {
  return channelIndex < currentSynthVoiceLimit()
      && channelInUse[channelIndex].load(std::memory_order_relaxed)
      && !synthStealHandoffPending(channelIndex)
      && synthVoiceOwnerValid(owner)
      && voiceGenerations[channelIndex].load(std::memory_order_relaxed) != 0;
}

int8_t RAM_FUNC(findGuardedLowestHeldSynthVoice)() {
  int8_t guardedIndex = -1;
  uint8_t voiceLimit = currentSynthVoiceLimit();
  for (uint8_t i = 0; i < voiceLimit; ++i) {
    int16_t owner = synthChannelOwners[i].load(std::memory_order_relaxed);
    if (!synthVoiceCanBeStolen(i, owner) || !synthVoiceIsHeld(i, owner)) {
      continue;
    }
    if (guardedIndex < 0) {
      guardedIndex = static_cast<int8_t>(i);
      continue;
    }
    int16_t guardedOwner = synthChannelOwners[guardedIndex].load(std::memory_order_relaxed);
    if (synthVoicePitchComesBefore(owner, guardedOwner)) {
      guardedIndex = static_cast<int8_t>(i);
    }
  }
  return guardedIndex;
}

bool RAM_FUNC(stealOldestSynthVoice)(byte newNote, byte& channelOut, int16_t& previousOwner) {
  previousOwner = NO_SYNTH_OWNER;
  int8_t guardedLowestHeld = findGuardedLowestHeldSynthVoice();
  int8_t oldestDuplicateIndex = -1;
  int8_t oldestReleasedIndex = -1;
  int8_t oldestHeldIndex = -1;
  uint64_t oldestDuplicateStart = std::numeric_limits<uint64_t>::max();
  uint64_t oldestReleaseTime = std::numeric_limits<uint64_t>::max();
  uint64_t oldestHeldStart = std::numeric_limits<uint64_t>::max();
  uint8_t voiceLimit = currentSynthVoiceLimit();

  for (uint8_t i = 0; i < voiceLimit; ++i) {
    int16_t owner = synthChannelOwners[i].load(std::memory_order_relaxed);
    if (!synthVoiceCanBeStolen(i, owner) || static_cast<int8_t>(i) == guardedLowestHeld) {
      continue;
    }

    uint64_t startOrder = synthVoiceStartOrder(i);
    if (synthVoiceDuplicatesNote(owner, newNote) && startOrder < oldestDuplicateStart) {
      oldestDuplicateStart = startOrder;
      oldestDuplicateIndex = static_cast<int8_t>(i);
    }

    uint64_t releaseTime = synthVoiceReleaseTimes[i];
    if (releaseTime != 0) {
      if (releaseTime < oldestReleaseTime) {
        oldestReleaseTime = releaseTime;
        oldestReleasedIndex = static_cast<int8_t>(i);
      }
      continue;
    }

    if (startOrder < oldestHeldStart) {
      oldestHeldStart = startOrder;
      oldestHeldIndex = static_cast<int8_t>(i);
    }
  }

  int8_t selectedIndex = oldestDuplicateIndex;
  if (selectedIndex < 0) {
    selectedIndex = oldestReleasedIndex;
  }
  if (selectedIndex < 0) {
    selectedIndex = oldestHeldIndex;
  }
  if (selectedIndex < 0) {
    return false;
  }
  previousOwner = synthChannelOwners[selectedIndex].load(std::memory_order_relaxed);
  channelOut = static_cast<byte>(selectedIndex + 1);
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
      if (!stealOldestSynthVoice(x, stolenChannel, previousOwner)) {
        sendToLog("synth channels all firing, so did not add one");
        return;
      }
      uint8_t stolenIndex = stolenChannel - 1;
      if (previousOwner >= 0 && previousOwner < BTN_COUNT) {
        if (h[previousOwner].synthCh == stolenChannel) {
          h[previousOwner].synthCh = 0;
        }
      }
      h[x].synthCh = stolenChannel;
      synthChannelOwners[stolenIndex].store(static_cast<int16_t>(x), std::memory_order_relaxed);
      voiceGenerations[stolenIndex].store(nextVoiceGeneration.fetch_add(1, std::memory_order_relaxed), std::memory_order_relaxed);
      synthVoiceStartTimes[stolenIndex] = h[x].timePressed ? h[x].timePressed : runTime;
      synthVoiceReleaseTimes[stolenIndex] = 0;
      pendingSynthStealOwners[stolenIndex] = static_cast<int16_t>(x);
      synthStealFadeSamplesRemaining[stolenIndex] = 0;
      channelInUse[stolenIndex].store(true, std::memory_order_relaxed);
      releaseRetries[stolenIndex] = 0;
      releaseRetryCountdown[stolenIndex] = 0;
      clearPendingVoiceFreed(stolenIndex);
      publishEnvelopeCommand(stolenIndex, EnvelopeCommand::StartStealFade);
      sendToLog("stole synth channel " + std::to_string(stolenChannel));
      return;
    }
    byte channel = synthChQueue.front();
    synthChQueue.pop();
    h[x].synthCh = channel;
    synthChannelOwners[channel - 1].store(static_cast<int16_t>(x), std::memory_order_relaxed);
    voiceGenerations[channel - 1].store(nextVoiceGeneration.fetch_add(1, std::memory_order_relaxed), std::memory_order_relaxed);
    synthVoiceStartTimes[channel - 1] = h[x].timePressed ? h[x].timePressed : runTime;
    synthVoiceReleaseTimes[channel - 1] = 0;
    clearSynthStealFade(channel - 1);
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
  sequencer::releasePlaybackNotesForPanic();

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
