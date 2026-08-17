#pragma once

#include "../FirmwareModule.h"
#include "PersistentDataModels.h"

void load_synth_wavetables();
void save_synth_wavetables();
void flashSafeSaveSynthWavetables();
void normalizeSynthWavetableFolderPath(char* folderPath, size_t folderPathLength);
void normalizeSynthWavetableMetadata(SynthWavetableSlot& wavetable, const uint8_t* samples = nullptr, size_t sampleLength = 0);
void compactSynthWavetables();
void pruneMissingSynthWavetables();
int findSynthWavetableByObjectId(const uint8_t* objectId);
int findSynthWavetableByName(const char* name);
bool synthWavetableNameIsAvailable(const char* name);
int chooseSynthWavetableWriteSlot(const SynthWavetableSlot& wavetable);
bool resolveSynthWavetableSampleFilePath(const SynthWavetableSlot& wavetable, char* output, size_t outputLength);
bool readSynthWavetableSampleFileRange(const char* samplePath, uint32_t offset, uint8_t* output, size_t length);
size_t synthWavetableSampleFileLength(const char* samplePath);
bool writeSynthWavetableSampleFile(const SynthWavetableSlot& wavetable, const uint8_t* samples, size_t sampleLength);
bool loadSynthWavetableFromCatalog(const char* name);
void removeSynthWavetableSampleFiles(const SynthWavetableSlot& wavetable);
