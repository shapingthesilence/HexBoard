#pragma once

#include "../FirmwareModule.h"
#include "PersistentDataModels.h"

void saveCurrentSynthWavetableReference();
bool loadCurrentSynthWavetableReference();
void flashSafeSaveCurrentSynthWavetableReference();
bool loadUserSynthWavetableFromFile();
void save_user_wavetable();
void flashSafeSaveUserSynthWavetable();
void applyUploadedSynthWavetableSamples(const uint8_t* samples);
void load_synth_wavetables();
void save_synth_wavetables();
void flashSafeSaveSynthWavetables();
void normalizeSynthWavetableBuiltInFolderAlias(char* folderPath, size_t folderPathLength);
void normalizeSynthWavetableFolderPath(char* folderPath, size_t folderPathLength);
void normalizeSynthWavetableMetadata(SynthWavetableSlot& wavetable, const uint8_t* samples = nullptr);
void compactSynthWavetables();
void pruneMissingSynthWavetables();
int findSynthWavetableByObjectId(const uint8_t* objectId);
int findSynthWavetableByFolderAndName(const char* folderPath, const char* name);
int chooseSynthWavetableWriteSlot(const SynthWavetableSlot& wavetable);
bool writeSynthWavetableSampleFile(const SynthWavetableSlot& wavetable, const uint8_t* samples);
bool loadSynthWavetableFromCatalog(const char* folderPath, const char* name);
void removeSynthWavetableSampleFiles(const SynthWavetableSlot& wavetable);
void synthWavetableObjectIdToLegacySamplePath(const uint8_t* objectId, char* output, size_t outputLength);
