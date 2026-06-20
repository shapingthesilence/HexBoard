#pragma once

#include "../FirmwareModule.h"

constexpr uint8_t CONTRAST_AWAKE = 63;
constexpr uint8_t CONTRAST_SCREENSAVER = 1;

extern U8G2_SH1107_SEEED_128X128_F_HW_I2C u8g2;
extern GEM_u8g2 menu;
extern uint64_t screenTime;
extern const uint64_t screenSaverTimeout;
extern bool rotaryInvert;
extern GEMPage menuPageMain;
extern GEMPage menuPageTuning;
extern GEMPage menuPageLayout;
extern GEMPage menuPageScales;
extern GEMPage menuPageSynth;
extern GEMPage menuPageSynthPresetSave;
extern GEMPage menuPageSynthPresetLoad;
extern GEMPage menuPageSynthWavetableLoad;

void wakeDelegatedControlScreenForInput();
void setupMenu();
void setupGFX();
void screenSaver();
void drawDelegatedControlScreen();
void restoreMenuAfterDelegatedControl();
bool servicePresetSyncTransfer();
void showFlashSaveScreen();
void closeFlashSaveScreen();
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
void installHardwareSpecificMenuItems();
