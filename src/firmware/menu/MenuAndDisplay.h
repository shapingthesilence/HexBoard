#pragma once

#include "../FirmwareModule.h"

void setupMenu();
void setupGFX();
void screenSaver();
void drawDelegatedControlScreen();
void restoreMenuAfterDelegatedControl();
bool servicePresetSyncTransfer();
void menuHome();
void menuSynthOptionsHome();
void showOnlyValidLayoutChoices();
void showOnlyValidScaleChoices();
void showOnlyValidKeyChoices();
void applyDeviceDisplayRotation();
void loadDeviceRotationFromCurrentLayout();
void updateLayoutAndRotate();
void syncSettingsToRuntime();
void updateSynthMenuVisibility();
void updateTuningMenuVisibility();
