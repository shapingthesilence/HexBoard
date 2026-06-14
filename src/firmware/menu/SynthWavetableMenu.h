#pragma once

#include "../FirmwareModule.h"

extern char currentSynthWavetableMenuLabel[SYNTH_WAVETABLE_MENU_LABEL_LENGTH];

void createSynthWavetableMenuItems();
void updateCurrentSynthWavetableMenuLabel();
void requestSynthWavetableMenuRebuild();
void serviceSynthWavetableMenuRebuild();
