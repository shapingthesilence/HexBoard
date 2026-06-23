#pragma once

#include "../FirmwareModule.h"
#include "../storage/PersistentDataModels.h"
#include "SynthDefaults.h"

void updateEnvelopeParamsFromSettings();
void updateEffectEnvelopeParamsFromSettings();
void updateEffectEnvelopeParamsFromSettings(uint8_t envelopeIndex);
void updateArpeggiatorTiming();
void updateArpeggiatorDirection();
void updateSynthPortamentoSettings();
void updateSynthModulationParams();
void initializeSynthWaveTables();
void loadSelectedSynthWaveform();
void loadSelectedSynthWavetable();
void selectFallbackSynthWavetable();
void selectCompatibilitySynthWavetableForLegacyWaveform(byte waveform, bool updatePosition);
bool legacyWaveformCompatibilityReference(byte waveform, const char*& folderPath, const char*& name, uint8_t& position);
bool decodeStoredBuzzerEnabled(uint8_t storedValue);
void syncAudioDestinationToRuntime();
void setCurrentSynthWavetableReference(const char* folderPath, const char* name);
void setActiveSynthWaveFrameCount(uint8_t frameCount);
void setupAudioDma();
void serviceAudioDmaBuffers();
void setAudioOutputMuteTarget(bool muted);
bool audioOutputMuteSettled(bool muted);
void recomputePitchBendFactor();
void RAM_FUNC(resetSynthRenderCaches)();
void synthWaveformChanged();
void playbackModeChanged();
void sendProgramChange();
void RAM_FUNC(resetSynthFreqs)();
void RAM_FUNC(updateSynthWithNewFreqs)();
void updateMetronomeTiming();
void metronomeModeChanged();
void RAM_FUNC(runMetronome)();
void RAM_FUNC(arpeggiate)();
void RAM_FUNC(setSynthFreq)(float frequency, byte channel, bool resetPhase = false, bool allowPortamento = false);
void RAM_FUNC(processEnvelopeReleases)();
void RAM_FUNC(retryPendingReleases)();
void RAM_FUNC(trySynthNoteOn)(byte x);
void RAM_FUNC(trySynthNoteOff)(byte x);
void panicStopOutput();
void setupSynthOutputs();
bool RAM_FUNC(metronomeBrightnessSelected)();
bool RAM_FUNC(metronomeSideButtonsSelected)();
bool RAM_FUNC(metronomeVisualFlashActive)();

extern byte activeSynthWaveTable[SYNTH_WAVETABLE_FRAME_COUNT][SYNTH_WAVE_SAMPLE_COUNT];
extern byte activeSynthWavetableMipExtraSamples[SYNTH_WAVETABLE_MIP_EXTRA_SAMPLE_BYTES];
extern volatile bool synthWaveTableLoadInProgress;
extern volatile uint8_t activeSynthWavetableMipLevelCount;
extern byte loadedSynthWaveform;
extern char loadedSynthWavetableName[SYNTH_WAVETABLE_NAME_LENGTH];
extern char loadedSynthWavetableFolderPath[SYNTH_WAVETABLE_FOLDER_LENGTH];
extern bool userSynthWavetableAvailable;
extern bool synthBuzzerEnabled;
extern byte headphoneVolumeCap;
extern const uint32_t AUDIO_DMA_BUFFER_MICROS;
extern std::atomic<bool> flashWriteInProgress;
extern std::atomic<bool> synthRuntimeReady;

bool isSupportedSynthWavetableSampleLength(size_t sampleLength);
void loadActiveSynthWavetableSamples(const uint8_t* samples, size_t sampleLength);
void rebuildActiveSynthWavetableFixedMipsFromBase();
void setActiveSynthWavetableMipLevelCount(uint8_t levelCount);
