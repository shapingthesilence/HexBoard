#pragma once

#include "../FirmwareModule.h"
#include "SynthDefaults.h"

struct BuiltinSynthWavetableDefinition {
  const char* name;
  const char* folderPath;
  byte waveforms[4];
  uint8_t waveformCount;
};

extern const byte waveSineSource[];

bool isValidSynthWaveform(byte waveform);
const byte* synthWaveformSource(byte waveform);
size_t synthBuiltinWavetableCount();
const BuiltinSynthWavetableDefinition* synthBuiltinWavetableAt(size_t index);
bool synthWavetableFolderMatches(const char* candidateFolderPath, const char* tableFolderPath);
int findBuiltinSynthWavetable(const char* folderPath, const char* name);
uint8_t compatibilityWavetablePositionForAnchor(uint8_t anchorIndex, uint8_t anchorCount);
