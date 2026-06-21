#pragma once

#include "../FirmwareModule.h"

constexpr uint8_t ISR_PROFILE_FLAG_RELEASE_START = 0x01;
constexpr uint8_t ISR_PROFILE_FLAG_PIEZO_SCALE = 0x02;

extern bool debugMessages;
extern bool serialDebugEnabled;
extern bool serialDebugGeneralMessages;
extern bool serialDebugHeapMessages;
extern bool serialDebugAudioMessages;
extern uint64_t runTime;
extern uint64_t lapTime;
extern uint64_t loopTime;
extern volatile bool isrProfilingEnabled;
extern volatile uint32_t isrCycleMin;
extern volatile uint32_t isrCycleMax;
extern volatile uint64_t isrCycleSum;
extern volatile uint32_t isrCycleCount;
extern volatile uint32_t isrCycleAvailableUs;
extern volatile uint32_t isrCycleOverrunCount;
extern volatile uint32_t isrCycleReleaseStartCount;
extern volatile uint32_t isrCyclePiezoScaleCount;
extern volatile uint8_t isrCycleMaxVoices;
extern volatile uint8_t isrCycleMaxFlags;
extern volatile uint32_t isrProfileMinUs;
extern volatile uint32_t isrProfileMaxUs;
extern volatile uint32_t isrProfileAvgUs;
extern volatile uint32_t isrProfileCount;
extern volatile uint32_t isrProfileAvailableUs;
extern volatile uint32_t isrProfileOverrunCount;
extern volatile uint32_t isrProfileReleaseStartCount;
extern volatile uint32_t isrProfilePiezoScaleCount;
extern volatile uint32_t isrProfileDmaUnderrunCount;
extern volatile uint8_t isrProfileMaxVoices;
extern volatile uint8_t isrProfileMaxFlags;

#define sendToLog(msg) do { if (debugMessages) { Serial.println((std::string(msg)).c_str()); } } while(0)

uint64_t RAM_FUNC(readClock)();
uint32_t readRuntimeFreeHeapBytes();
void resetSerialDebugMinFreeHeap();
void resetSerialDebugAudioStats();
void updateSerialDebugRuntime();
void serviceSerialDebugMessages();
void setSerialDebugGeneralSuppressed(bool suppressed);
void setSerialDebugPeriodicSuppressed(bool suppressed);
void timeTracker();
void readAndResetISRProfile();
void startISRProfileCapture();
void stopISRProfileCaptureAndLog();
