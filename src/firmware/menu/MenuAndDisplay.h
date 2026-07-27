#pragma once

#include "../FirmwareModule.h"

constexpr uint8_t CONTRAST_AWAKE = 63;
constexpr uint8_t CONTRAST_SCREENSAVER = 1;

extern U8G2_SH1107_SEEED_128X128_F_HW_I2C u8g2;
extern GEM_u8g2 menu;
extern bool screenSaverOn;
extern uint64_t screenTime;
extern const uint64_t screenSaverTimeout;
extern bool flashSaveScreenVisible;
extern bool rotaryInvert;
extern GEMPage menuPageMain;
extern GEMPage menuPageTuning;
extern GEMPage menuPageLayout;
extern GEMPage menuPageScales;
extern GEMPage menuPageSynth;

void wakeDelegatedControlScreenForInput();
void setupMenu();
void populateStorageStatusMenuPage();
void setupGFX();
void screenSaver();
void wakeDisplayFromScreensaver();
void enterDisplayScreensaver();
void restoreInteractiveMenuDisplay();
void drawDelegatedControlScreen();
void restoreMenuAfterDelegatedControl();
bool servicePresetSyncTransfer();
void showFlashSaveScreen();
void closeFlashSaveScreen();
void dismissFlashSaveScreenForMenuInput();
void serviceFlashSaveScreen();
void drawCenteredMenuHeaderTitle(const char* title);
void menuHome();
void menuSynthOptionsHome();
bool handleVirtualListLauncherKey(byte keyCode);
void serviceVirtualListLauncherLabelScroll();
void refreshMenuChoicesForCurrentTuning();
void showOnlyValidKeyChoices();
void applyDeviceDisplayRotation();
void loadDeviceRotationFromCurrentLayout();
void updateLayoutAndRotate();
void syncSettingsToRuntime();
void syncSynthSettingsToRuntime();
void updateSynthMenuVisibility();
void updateEditorMenuVisibility();
void installHardwareSpecificMenuItems();
