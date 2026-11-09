#include "CompactSampler.h"
#include "CompactSamplerCodec.h"
#include "SynthAudioInternal.h"
#include "../menu/MenuAndDisplay.h"
#include "../storage/Settings.h"
#include "../storage/StorageHealth.h"
#include "../storage/SynthPresetCatalog.h"
#include "../storage/SynthPresetStorage.h"
#include "../storage/PresetSync.h"
#include <memory>
#include <new>

static_assert(sizeof(SynthSampleWorkspace) == CompactSampler::kPcmBytes, "Shared sample workspace size mismatch");

namespace {
CompactSampler::Directory directory;
EnvelopeParams regionEnvelopes[CompactSampler::kZones];
uint32_t regionDelays[CompactSampler::kZones] = {};
struct Voice {
  CompactSampler::Reader reader;
  uint32_t delay = 0, step = 0, generation = 0;
  // Step with vibrato applied, recomputed only when the step or vibrato changes.
  uint32_t vibratoBase = 0, playStep = 0;
  int16_t zone = -1;
  uint8_t gain = 128;
};
Voice readers[POLYPHONY_LIMIT];
std::atomic<int16_t> pendingRegions[POLYPHONY_LIMIT];
std::atomic<uint32_t> pendingSteps[POLYPHONY_LIMIT];
// Region envelope with the sound's "Inst" overrides applied, prepared on Core 0
// when a note starts and copied by Core 1 when it consumes the attack command.
EnvelopeParams pendingEnvelopes[POLYPHONY_LIMIT];
// Mod wheel vibrato, refreshed on Core 1 at the synth control rate. The amount
// uses the wavetable engine's units: step changes by amount / 2^18.
uint8_t vibratoCountdown = 0;
int32_t vibratoAmount = 0;
std::atomic<bool> active{false};
constexpr size_t kSourceBytes = SYNTH_PRESET_OBJECT_ID_LENGTH;
uint8_t loadedSource[kSourceBytes] = {};
bool loadedValid = false;  // loadedSource names the instrument in the workspace
char requestedName[32] = {};
uint8_t requestedSource[kSourceBytes] = {};
uint8_t envelopeOverride = 0;

void failure(const char* path, const char* stage) { reportStorageHealthIssue(path, stage); }
uint32_t samples(uint16_t ms) { return (uint64_t(ms) * AUDIO_SAMPLE_RATE_HZ + 999) / 1000; }
bool validateFile(const char* path, uint32_t offset, uint32_t length, CompactSampler::Directory& result) {
  File file = LittleFS.open(path, "r");
  if (!file) { failure(path, "sampler open"); return false; }
  uint8_t header[CompactSampler::kHeader];
  if (length < sizeof(header) || length > CompactSampler::kFileBytes || uint64_t(offset) + length > file.size()
      || !file.seek(offset) || file.read(header, sizeof(header)) != sizeof(header)) { failure(path, "sampler header read"); return false; }
  const unsigned assets = CompactSampler::u16(header + 24), zones = CompactSampler::u16(header + 26);
  if (!assets || assets > CompactSampler::kAssets || !zones || zones > CompactSampler::kZones) { failure(path, "sampler counts"); return false; }
  std::vector<uint8_t> metadata(CompactSampler::kHeader + assets * CompactSampler::kAsset + zones * CompactSampler::kZone);
  memcpy(metadata.data(), header, sizeof(header));
  if (file.read(metadata.data() + sizeof(header), metadata.size() - sizeof(header)) != metadata.size() - sizeof(header)
      || !result.decode(metadata.data(), metadata.size()) || length != result.total) { failure(path, "sampler metadata validation"); return false; }
  uint8_t chunk[128]; uint32_t crc = ~0u, remaining = result.frames * 2;
  while (remaining) {
    const unsigned n = std::min<unsigned>(sizeof(chunk), remaining);
    if (file.read(chunk, n) != n) { failure(path, "sampler PCM read"); return false; }
    crc = CompactSampler::crcUpdate(crc, chunk, n); remaining -= n;
  }
  if (~crc != result.pcmCrc) { failure(path, "sampler PCM CRC"); return false; }
  return true;
}
bool sourceIsEmpty(const uint8_t* source) {
  for (size_t i = 0; i < kSourceBytes; ++i) if (source[i]) return false;
  return true;
}
bool pauseWorkspace() {
  if (!audioTransportReady.load(std::memory_order_acquire)) return true;
  setAudioOutputMuteTarget(true);
  const uint32_t start = micros();
  while (!audioOutputMuteSettled(true) && uint32_t(micros() - start) < 30000) tight_loop_contents();
  synthWorkspacePauseAcknowledged.store(false, std::memory_order_release);
  synthWorkspacePauseRequested.store(true, std::memory_order_release);
  const uint32_t wait = micros();
  while (!synthWorkspacePauseAcknowledged.load(std::memory_order_acquire)) {
    if (uint32_t(micros() - wait) > 100000) {
      synthWorkspacePauseRequested.store(false, std::memory_order_release);
      setAudioOutputMuteTarget(false); return false;
    }
  }
  quiesceAudioDmaForFlashWrite();
  return true;
}
void resumeWorkspace() {
  if (!audioTransportReady.load(std::memory_order_acquire)) return;
  synthWorkspacePauseRequested.store(false, std::memory_order_release);
  resumeAudioDmaAfterFlashWrite();
  setAudioOutputMuteTarget(false);
}
void RAM_FUNC(startReader)(unsigned i) {
  Voice& v = readers[i]; v = Voice{};
  v.zone = pendingRegions[i].load(std::memory_order_acquire);
  v.step = pendingSteps[i].load(std::memory_order_acquire);
  v.generation = voiceGenerations[i].load(std::memory_order_relaxed);
  const int16_t owner = synthChannelOwners[i].load(std::memory_order_relaxed);
  if (owner >= SYNTH_PREVIEW_SLOT_START && owner < BTN_COUNT) v.gain = synthPreviewGainForSlot[owner - SYNTH_PREVIEW_SLOT_START];
  EnvelopeState& env = envelopeStates[i]; resetEnvelopeState(env);
  if (v.zone < 0 || unsigned(v.zone) >= directory.zones || !v.step) { publishVoiceFreed(i, v.generation); return; }
  voiceVolumeEnvelopeParams[i] = pendingEnvelopes[i];
  const EnvelopeParams& p = voiceVolumeEnvelopeParams[i];
  v.delay = regionDelays[v.zone]; v.reader.start();
  env.stage = EnvelopeStage::Attack;
  if (!p.attackTicks) advanceEnvelopeFromAttackPeak(p, env);
}
void RAM_FUNC(finishReader)(unsigned i) {
  readers[i].reader.ended = true;
  resetEnvelopeState(envelopeStates[i]);
  if (!synthStealFadeInProgress(i)) publishVoiceFreed(i, readers[i].generation);
}
}

std::atomic<bool> synthWorkspacePauseRequested{false};
std::atomic<bool> synthWorkspacePauseAcknowledged{false};

bool RAM_FUNC(compactSamplerActive)() { return active.load(std::memory_order_acquire); }
const char* compactSamplerName() { return compactSamplerActive() ? directory.name : "Wavetable"; }
const char* compactSamplerRequestedName() { return requestedName; }
const uint8_t* compactSamplerRequestedSource() { return requestedSource; }
void requestCompactSampler(const char* name, const uint8_t* sourceObjectId) {
  snprintf(requestedName, sizeof(requestedName), "%s", name && sourceObjectId ? name : "");
  if (requestedName[0]) memcpy(requestedSource, sourceObjectId, kSourceBytes);
  else memset(requestedSource, 0, kSourceBytes);
}
void retargetCompactSamplerSource(const uint8_t* sourceObjectId) {
  if (!requestedName[0] || !sourceObjectId) return;
  if (loadedValid && memcmp(loadedSource, requestedSource, kSourceBytes) == 0) memcpy(loadedSource, sourceObjectId, kSourceBytes);
  memcpy(requestedSource, sourceObjectId, kSourceBytes);
}
uint8_t compactSamplerEnvelopeOverride() { return envelopeOverride; }
void setCompactSamplerEnvelopeOverride(uint8_t mask) { envelopeOverride = mask & SAMPLER_ENVELOPE_OVERRIDE_ALL; }
bool validateCompactSamplerInstrument(const char* path, uint32_t offset, uint32_t length, char* name, size_t capacity) {
  std::unique_ptr<CompactSampler::Directory> d(new(std::nothrow) CompactSampler::Directory);
  if (!d || !fileSystemExists || !validateFile(path, offset, length, *d)) return false;
  snprintf(name, capacity, "%s", d->name);
  return true;
}

namespace {
// source nullptr loads the wavetable engine.
bool loadInstrument(const uint8_t* source) {
  if (source ? loadedValid && compactSamplerActive() && memcmp(source, loadedSource, kSourceBytes) == 0
             : !compactSamplerActive()) return true;
  std::unique_ptr<CompactSampler::Directory> candidate;
  char path[SYNTH_PRESET_STORAGE_PATH_LENGTH] = {};
  uint32_t offset = 0, length = 0;
  if (source) {
    candidate.reset(new(std::nothrow) CompactSampler::Directory);
    if (!candidate || !fileSystemExists || !synthPresetInstrumentRange(source, path, sizeof(path), offset, length)
        || !validateFile(path, offset, length, *candidate)) return false;
  }
  if (!pauseWorkspace()) { failure(path, "sampler workspace pause timeout"); return false; }
  resetSynthFreqs(); active.store(false, std::memory_order_release);
  for (unsigned i = 0; i < POLYPHONY_LIMIT; ++i) { readers[i] = Voice{}; resetEnvelopeState(envelopeStates[i]); clearPendingVoiceFreed(i); consumeEnvelopeCommand(i); }
  bool ok = true;
  loadedValid = false;
  if (candidate) {
    new (&synthSampleWorkspace.sampler) SynthPcmSamples;
    File f = LittleFS.open(path, "r");
    ok = f && f.seek(offset + candidate->metadataBytes()) && f.read(reinterpret_cast<uint8_t*>(synthSampleWorkspace.sampler.frames), candidate->frames * 2) == candidate->frames * 2;
    if (ok) ok = ~CompactSampler::crcUpdate(~0u, reinterpret_cast<const uint8_t*>(synthSampleWorkspace.sampler.frames), candidate->frames * 2) == candidate->pcmCrc;
    if (ok) {
      directory = *candidate;
      for (unsigned z = 0; z < directory.zones; ++z) {
        const auto& r = directory.regions[z]; EnvelopeParams& p = regionEnvelopes[z];
        p.attackTicks = samples(r.attack); p.holdTicks = samples(r.hold); p.decayTicks = samples(r.decay); p.releaseTicks = samples(std::max<uint16_t>(4, r.release));
        p.sustainLevel = uint32_t(r.sustain) << ENVELOPE_LEVEL_SCALE_SHIFT;
        p.attackIncrement = p.attackTicks ? std::max<uint32_t>(1, envelopeMaxLevel / p.attackTicks) : envelopeMaxLevel;
        p.decayIncrement = p.decayTicks ? std::max<uint32_t>(1, (envelopeMaxLevel - p.sustainLevel) / p.decayTicks) : envelopeMaxLevel;
        regionDelays[z] = samples(r.delay);
      }
      memcpy(loadedSource, source, kSourceBytes);
      loadedValid = true;
      active.store(true, std::memory_order_release);
    } else failure(path, "sampler load/readback CRC");
  }
  if (!active.load(std::memory_order_relaxed)) {
    new (&synthSampleWorkspace.wavetable) SynthWavetableSamples;
    loadedSynthWavetableName[0] = 0;
    if (!ok) selectFallbackSynthWavetable();
    loadSelectedSynthWavetable();
  }
  resumeWorkspace();
  return ok;
}
}  // namespace

void reloadCompactSamplerSource(const uint8_t* sourceObjectId) {
  if (!sourceObjectId || !loadedValid || memcmp(loadedSource, sourceObjectId, kSourceBytes) != 0) return;
  loadedValid = false;
  syncCompactSamplerSelection();
}

bool useCompactSamplerWavetableEngine() {
  if (!loadInstrument(nullptr)) return false;
  if (requestedName[0]) { requestCompactSampler("", nullptr); markSettingsDirty(); updateSynthMenuVisibility(); }
  return true;
}
// A sound whose instrument cannot be loaded plays the wavetable engine but
// keeps its request, so saving it does not lose the instrument.
void syncCompactSamplerSelection() {
  if (requestedName[0] && !sourceIsEmpty(requestedSource) && loadInstrument(requestedSource)) return;
  loadInstrument(nullptr);
}

// The region's envelope with each overridden stage taken from the current
// sound's amp envelope. Release stays at least 4 ms, like region releases.
EnvelopeParams samplerEnvelopeForRegion(int region) {
  EnvelopeParams merged = (region >= 0 && unsigned(region) < directory.zones) ? regionEnvelopes[region] : EnvelopeParams{};
  const uint8_t mask = envelopeOverride;
  if (!mask) return merged;
  const EnvelopeParams& sound = envelopeParams;
  if (mask & SAMPLER_ENVELOPE_OVERRIDE_ATTACK) merged.attackTicks = sound.attackTicks;
  if (mask & SAMPLER_ENVELOPE_OVERRIDE_HOLD) merged.holdTicks = sound.holdTicks;
  if (mask & SAMPLER_ENVELOPE_OVERRIDE_DECAY) merged.decayTicks = sound.decayTicks;
  if (mask & SAMPLER_ENVELOPE_OVERRIDE_SUSTAIN) merged.sustainLevel = sound.sustainLevel;
  if (mask & SAMPLER_ENVELOPE_OVERRIDE_RELEASE) merged.releaseTicks = std::max<uint32_t>(samples(4), sound.releaseTicks);
  merged.attackIncrement = merged.attackTicks ? std::max<uint32_t>(1, envelopeMaxLevel / merged.attackTicks) : envelopeMaxLevel;
  merged.decayIncrement = (merged.decayTicks && merged.sustainLevel < envelopeMaxLevel)
    ? std::max<uint32_t>(1, (envelopeMaxLevel - merged.sustainLevel) / merged.decayTicks)
    : envelopeMaxLevel;
  return merged;
}

void RAM_FUNC(refreshSamplerVibrato)() {
  const int16_t wheel = scaleSynthModAmount(smoothedSynthModValue(SYNTH_CONTROL_RATE_SAMPLES));
  if (!wheel) { vibratoAmount = 0; return; }
  synthVibratoPhase += synthVibratoPhaseIncrement * SYNTH_CONTROL_RATE_SAMPLES;
  const int16_t sample = synthVibratoSpeed == SYNTH_VIBRATO_SPEED_NOISE
    ? readSynthVibratoSmoothNoiseSample()
    : static_cast<int16_t>(int16_t(synthVibratoSine[synthWaveSampleIndexFromPhase32(synthVibratoPhase)]) - 128);
  vibratoAmount = int32_t(sample) * wheel;
}


// Called on Core 0 before publishing attack/steal commands. Retunes preserve
// the captured region and update only a single atomic reader increment.
void RAM_FUNC(prepareCompactSamplerFrequency)(uint8_t channel, float nativeHz, float bentHz, bool start) {
  if (!compactSamplerActive() || channel >= POLYPHONY_LIMIT) return;
  int region = pendingRegions[channel].load(std::memory_order_relaxed);
  if (start) {
    unsigned velocity = 127;
    const int16_t owner = synthChannelOwners[channel].load(std::memory_order_relaxed);
    if (owner >= SYNTH_PREVIEW_SLOT_START && owner < BTN_COUNT) velocity = synthPreviewVelocityForSlot[owner - SYNTH_PREVIEW_SLOT_START];
    region = directory.region(nativeHz, velocity);
    pendingEnvelopes[channel] = samplerEnvelopeForRegion(region);
    pendingRegions[channel].store(region, std::memory_order_relaxed);
  }
  uint32_t step = 0;
  if (region >= 0 && unsigned(region) < directory.zones) {
    const auto& z = directory.regions[region]; const auto& a = directory.recordings[z.asset];
    const float ratio = z.track == 256 ? bentHz / a.rootHz : powf(bentHz / a.rootHz, z.track / 256.0f);
    const float increment = ratio * a.rate * (65536.0f / AUDIO_SAMPLE_RATE_HZ);
    if (std::isfinite(increment) && increment >= 1 && increment <= 64 * 65536) step = uint32_t(increment + .5f);
  }
  pendingSteps[channel].store(step, std::memory_order_release);
}

int32_t RAM_FUNC(renderCompactSamplerMix)(uint32_t& envSum, uint8_t& voices, uint8_t& flags) {
  int32_t mix = 0;
  // The sampler always uses the mod wheel for vibrato (Wheel FX is hidden).
  const bool vibratoTick = vibratoCountdown == 0;
  if (vibratoTick) {
    vibratoCountdown = SYNTH_CONTROL_RATE_SAMPLES - 1;
    refreshSamplerVibrato();
  } else {
    --vibratoCountdown;
  }
  for (unsigned i = 0; i < currentSynthVoiceLimit(); ++i) {
    Voice& v = readers[i]; EnvelopeState& env = envelopeStates[i];
    switch (consumeEnvelopeCommand(i)) {
      case EnvelopeCommand::StartAttack: clearSynthStealFade(i); startReader(i); break;
      case EnvelopeCommand::StartRelease:
        releaseRetries[i] = releaseRetryCountdown[i] = 0;
        if (!v.reader.ended && v.zone >= 0 && directory.recordings[directory.regions[v.zone].asset].mode != 2 && !v.reader.released) {
          v.reader.released = true; env.stage = EnvelopeStage::Release;
          env.releaseIncrement = std::min<uint32_t>(65535, std::max<uint32_t>(1, env.level / voiceVolumeEnvelopeParams[i].releaseTicks));
          flags |= ISR_PROFILE_FLAG_RELEASE_START; if (isrProfilingEnabled) ++isrCycleReleaseStartCount;
        }
        break;
      case EnvelopeCommand::StartStealFade: synthStealFadeSamplesRemaining[i] = SYNTH_STEAL_FADE_SAMPLES; break;
      case EnvelopeCommand::Reset: v = Voice{}; resetEnvelopeState(env); clearSynthStealFade(i); break;
      default: break;
    }
    if (!v.reader.ended && v.zone >= 0) {
      if (!synthStealFadeInProgress(i)) v.step = pendingSteps[i].load(std::memory_order_acquire);
      if (vibratoTick || v.step != v.vibratoBase) { v.vibratoBase = v.step; v.playStep = CompactSampler::vibratoStep(v.step, vibratoAmount); }
      if (v.delay) --v.delay;
      else {
        updateAmpEnvelopeState(env, voiceVolumeEnvelopeParams[i], 1);
        const auto& z = directory.regions[v.zone];
        int32_t s = v.reader.read(directory.recordings[z.asset], synthSampleWorkspace.sampler.frames, v.playStep);
        if (!v.step || v.reader.ended || env.stage == EnvelopeStage::Idle || (env.stage == EnvelopeStage::Sustain && !env.level)) finishReader(i);
        else {
          uint32_t level = envelopeAudioLevel(env.level);
          s = (s * int32_t(level)) >> 16;
          s = (s * int32_t(z.gain)) >> 15;
          s = (s * v.gain) >> 7;
          const uint16_t fade = synthStealFadeGainQ8(i);
          mix += (s * fade) >> 8; envSum += (level * fade) >> 8; ++voices;
        }
      }
    }
    if (synthStealFadeInProgress(i) && !--synthStealFadeSamplesRemaining[i]) {
      const int16_t owner = pendingSynthStealOwners[i]; clearSynthStealFade(i);
      if (owner >= 0 && owner < BTN_COUNT && h[owner].synthCh == i + 1) startReader(i);
      else { v.generation = voiceGenerations[i].load(std::memory_order_relaxed); finishReader(i); }
    }
  }
  return mix;
}

void handleCompactSamplerRequest(uint16_t transaction, const uint8_t* p, size_t n) {
  constexpr uint8_t request = 0x36, response = 0x37;
  if (n != 1) { presetSyncSendNack(transaction, request, PRESET_SYNC_ERROR_BAD_LENGTH); return; }
  if (synthPerformanceTestActive() || presetSyncReadTransfer.active || presetSyncWriteTransfer.active) { presetSyncSendNack(transaction, request, PRESET_SYNC_ERROR_BUSY); return; }
  std::vector<uint8_t> out{p[0]};
  if (p[0] == 0) {
    // 0 = a sampler sound's instrument is playing, 127 = the wavetable engine.
    out.push_back(compactSamplerActive() ? 0 : 127); out.push_back(CompactSampler::kAssets); out.push_back(CompactSampler::kZones);
    presetSyncAppendU21(out, CompactSampler::kPcmBytes); presetSyncAppendU28(out, rp2040.getFreeHeap());
    presetSyncAppendAscii(out, compactSamplerName(), 31);
  } else if (p[0] == 4) {
    if (!saveCurrentSettingsForStartup()) { presetSyncSendNack(transaction, request, PRESET_SYNC_ERROR_STORAGE_FULL); return; }
  } else { presetSyncSendNack(transaction, request, PRESET_SYNC_ERROR_BAD_LENGTH); return; }
  presetSyncSendFrame(response, transaction, out);
}
