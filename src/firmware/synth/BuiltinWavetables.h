#pragma once

#include "../FirmwareModule.h"
#include "SynthDefaults.h"

struct BuiltinSynthWavetableDefinition {
  const char* name;
  const char* folderPath;
  const byte* samples;
  size_t sampleLength;
  byte waveforms[8];
  uint8_t waveformCount;
};

extern const byte waveSineSource[];
extern const BuiltinSynthWavetableDefinition builtinSynthWavetables[];
extern const size_t SYNTH_BUILTIN_WAVETABLE_COUNT;

const byte* synthWaveformSource(byte waveform);
size_t synthBuiltinWavetableCount();
const BuiltinSynthWavetableDefinition* synthBuiltinWavetableAt(size_t index);
int findBuiltinSynthWavetableByName(const char* name);
uint8_t wavetablePositionForAnchor(uint8_t anchorIndex, uint8_t anchorCount);
