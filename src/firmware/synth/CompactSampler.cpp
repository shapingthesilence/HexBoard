#include "CompactSampler.h"
#include "CompactSamplerCodec.h"
#include "SynthAudioInternal.h"
#include "../storage/Settings.h"
#include "../storage/StorageHealth.h"
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
  int16_t zone = -1;
  uint8_t gain = 128;
};
Voice readers[POLYPHONY_LIMIT];
std::atomic<int16_t> pendingRegions[POLYPHONY_LIMIT];
std::atomic<uint32_t> pendingSteps[POLYPHONY_LIMIT];
std::atomic<bool> active{false};
uint8_t loadedSlot = 255;

void failure(const char* path, const char* stage) { reportStorageHealthIssue(path, stage); }
uint32_t samples(uint16_t ms) { return (uint64_t(ms) * AUDIO_SAMPLE_RATE_HZ + 999) / 1000; }
bool validateFile(const char* path, CompactSampler::Directory& result) {
  File file = LittleFS.open(path, "r");
  if (!file) { failure(path, "sampler open"); return false; }
  uint8_t header[CompactSampler::kHeader];
  if (file.read(header, sizeof(header)) != sizeof(header)) { failure(path, "sampler header read"); return false; }
  const unsigned assets = CompactSampler::u16(header + 24), zones = CompactSampler::u16(header + 26);
  if (!assets || assets > CompactSampler::kAssets || !zones || zones > CompactSampler::kZones) { failure(path, "sampler counts"); return false; }
  std::vector<uint8_t> metadata(CompactSampler::kHeader + assets * CompactSampler::kAsset + zones * CompactSampler::kZone);
  memcpy(metadata.data(), header, sizeof(header));
  if (file.read(metadata.data() + sizeof(header), metadata.size() - sizeof(header)) != metadata.size() - sizeof(header)
      || !result.decode(metadata.data(), metadata.size()) || file.size() != result.total) { failure(path, "sampler metadata validation"); return false; }
  uint8_t chunk[128]; uint32_t crc = ~0u, remaining = result.frames * 2;
  while (remaining) {
    const unsigned n = std::min<unsigned>(sizeof(chunk), remaining);
    if (file.read(chunk, n) != n) { failure(path, "sampler PCM read"); return false; }
    crc = CompactSampler::crcUpdate(crc, chunk, n); remaining -= n;
  }
  if (~crc != result.pcmCrc) { failure(path, "sampler PCM CRC"); return false; }
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
  voiceVolumeEnvelopeParams[i] = regionEnvelopes[v.zone];
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
uint8_t compactSamplerSlot() { return loadedSlot; }
const char* compactSamplerName() { return compactSamplerActive() ? directory.name : "Wavetable"; }
void compactSamplerPath(uint8_t slot, char* path, size_t capacity) { snprintf(path, capacity, "/sampler/%02u.hbc", slot); }
bool compactSamplerFileInfo(uint8_t slot, char* name, size_t capacity, uint32_t& bytes) {
  if (slot >= CompactSampler::kSlots || !fileSystemExists) return false;
  char path[32]; compactSamplerPath(slot, path, sizeof(path)); File f = LittleFS.open(path, "r");
  uint8_t h[64];
  if (!f || f.read(h, sizeof(h)) != sizeof(h) || memcmp(h, "HBC1", 4) || !memchr(h + 32, 0, 32)) return false;
  bytes = f.size(); snprintf(name, capacity, "%s", reinterpret_cast<char*>(h + 32)); return true;
}
bool selectCompactSampler(uint8_t slot, bool persist) {
  if (slot != 255 && slot >= CompactSampler::kSlots) return false;
  if (slot == loadedSlot && (slot == 255 || compactSamplerActive())) return true;
  std::unique_ptr<CompactSampler::Directory> candidate;
  char path[32] = {};
  if (slot != 255) {
    candidate.reset(new(std::nothrow) CompactSampler::Directory);
    compactSamplerPath(slot, path, sizeof(path));
    if (!candidate || !fileSystemExists || !validateFile(path, *candidate)) return false;
  }
  if (!pauseWorkspace()) { failure(path, "sampler workspace pause timeout"); return false; }
  resetSynthFreqs(); active.store(false, std::memory_order_release);
  for (unsigned i = 0; i < POLYPHONY_LIMIT; ++i) { readers[i] = Voice{}; resetEnvelopeState(envelopeStates[i]); clearPendingVoiceFreed(i); consumeEnvelopeCommand(i); }
  bool ok = true;
  if (candidate) {
    new (&synthSampleWorkspace.sampler) SynthPcmSamples;
    File f = LittleFS.open(path, "r");
    ok = f && f.seek(candidate->metadataBytes()) && f.read(reinterpret_cast<uint8_t*>(synthSampleWorkspace.sampler.frames), candidate->frames * 2) == candidate->frames * 2;
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
      active.store(true, std::memory_order_release);
    } else failure(path, "sampler load/readback CRC");
  }
  loadedSlot = ok ? slot : 255;
  if (!active.load(std::memory_order_relaxed)) {
    new (&synthSampleWorkspace.wavetable) SynthWavetableSamples;
    loadedSynthWavetableName[0] = 0;
    if (!ok) selectFallbackSynthWavetable();
    loadSelectedSynthWavetable();
  }
  if (persist && ok) { settings[static_cast<uint8_t>(SettingKey::SamplerSlot)] = slot; markSettingsDirty(); }
  resumeWorkspace(); return ok;
}
void syncCompactSamplerSelection() {
  const uint8_t requested = settingValue(SettingKey::SamplerSlot);
  if (!selectCompactSampler(requested, false)) selectCompactSampler(255, false);
}
bool installCompactSampler(const char* stagedPath, uint16_t slot) {
  if (slot >= CompactSampler::kSlots) return false;
  std::unique_ptr<CompactSampler::Directory> d(new(std::nothrow) CompactSampler::Directory);
  if (!d || !validateFile(stagedPath, *d)) return false;
  char path[32]; compactSamplerPath(slot, path, sizeof(path));
  if (LittleFS.exists(path)) return false; // New slots only; existing instruments survive interrupted installs.
  if (!LittleFS.exists("/sampler") && !LittleFS.mkdir("/sampler")) return false;
  return LittleFS.rename(stagedPath, path);
}
bool deleteCompactSampler(uint8_t slot) {
  if (slot >= CompactSampler::kSlots || !fileSystemExists) return false;
  if (loadedSlot == slot && !selectCompactSampler(255)) return false;
  char path[32]; compactSamplerPath(slot, path, sizeof(path));
  beginFlashSafeWrite(); const bool ok = LittleFS.remove(path); endFlashSafeWrite(); return ok;
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
      if (v.delay) --v.delay;
      else {
        updateAmpEnvelopeState(env, voiceVolumeEnvelopeParams[i], 1);
        const auto& z = directory.regions[v.zone];
        int32_t s = v.reader.read(directory.recordings[z.asset], synthSampleWorkspace.sampler.frames, v.step);
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
  if (!n || n > 2) { presetSyncSendNack(transaction, request, PRESET_SYNC_ERROR_BAD_LENGTH); return; }
  if (synthPerformanceTestActive() || presetSyncReadTransfer.active || presetSyncWriteTransfer.active) { presetSyncSendNack(transaction, request, PRESET_SYNC_ERROR_BUSY); return; }
  std::vector<uint8_t> out{p[0]};
  if (p[0] == 0 && n == 1) {
    out.push_back(loadedSlot == 255 ? 127 : loadedSlot); out.push_back(CompactSampler::kAssets); out.push_back(CompactSampler::kZones);
    presetSyncAppendU21(out, CompactSampler::kPcmBytes); presetSyncAppendU28(out, rp2040.getFreeHeap());
    presetSyncAppendAscii(out, compactSamplerName(), 31);
  } else if (p[0] == 1 && n == 2 && p[1] < CompactSampler::kSlots) {
    char name[32] = {}; uint32_t bytes = 0; const bool exists = compactSamplerFileInfo(p[1], name, sizeof(name), bytes);
    out.push_back(p[1]); out.push_back(exists); presetSyncAppendU21(out, bytes); presetSyncAppendAscii(out, name, 31);
  } else if (p[0] == 2 && n == 2 && (p[1] < CompactSampler::kSlots || p[1] == 127)) {
    if (!selectCompactSampler(p[1] == 127 ? 255 : p[1])) { presetSyncSendNack(transaction, request, PRESET_SYNC_ERROR_VALIDATION_FAILED); return; }
    out.push_back(p[1]);
  } else if (p[0] == 3 && n == 2 && p[1] < CompactSampler::kSlots) {
    if (!deleteCompactSampler(p[1])) { presetSyncSendNack(transaction, request, PRESET_SYNC_ERROR_OBJECT_MISSING); return; }
    out.push_back(p[1]);
  } else if (p[0] == 4 && n == 1) {
    if (!saveCurrentSettingsForStartup()) { presetSyncSendNack(transaction, request, PRESET_SYNC_ERROR_STORAGE_FULL); return; }
  } else { presetSyncSendNack(transaction, request, PRESET_SYNC_ERROR_BAD_LENGTH); return; }
  presetSyncSendFrame(response, transaction, out);
}
