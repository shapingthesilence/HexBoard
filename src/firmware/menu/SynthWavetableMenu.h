#pragma once

#include "../FirmwareModule.h"

constexpr size_t SYNTH_WAVETABLE_MENU_LABEL_LENGTH = 64;

extern char currentSynthWavetableMenuLabel[SYNTH_WAVETABLE_MENU_LABEL_LENGTH];

void createSynthWavetableMenuItems();
void updateCurrentSynthWavetableMenuLabel();
void requestSynthWavetableMenuRebuild();
void serviceSynthWavetableMenuRebuild();
