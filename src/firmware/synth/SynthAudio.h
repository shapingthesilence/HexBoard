#pragma once

#include "../FirmwareModule.h"

enum class EnvelopeCommand : uint8_t;

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
void setupAudioDma();
void serviceAudioDmaBuffers();
inline void recomputePitchBendFactor();
void RAM_FUNC(resetSynthRenderCaches)();
void synthWaveformChanged();
void playbackModeChanged();
void updateMetronomeTiming();
void metronomeModeChanged();
void RAM_FUNC(runMetronome)();
void RAM_FUNC(arpeggiate)();
void RAM_FUNC(setSynthFreq)(float frequency, byte channel, bool resetPhase = false, bool allowPortamento = false);
void RAM_FUNC(beginEnvelopeAttack)(uint8_t channel);
void RAM_FUNC(beginEnvelopeRelease)(uint8_t channel);
void RAM_FUNC(processEnvelopeReleases)();
void RAM_FUNC(retryPendingReleases)();
void RAM_FUNC(trySynthNoteOn)(byte x);
void RAM_FUNC(trySynthNoteOff)(byte x);
void panicStopOutput();
void setupSynth(byte pin, byte slice);
inline void RAM_FUNC(clearSynthPortamento)(uint8_t channelIndex);
inline void RAM_FUNC(beginSynthPortamento)(uint8_t channelIndex, uint32_t targetIncrement);
inline bool RAM_FUNC(metronomeBrightnessSelected)();
inline bool RAM_FUNC(metronomeSideButtonsSelected)();
inline bool RAM_FUNC(metronomeVisualFlashActive)();
