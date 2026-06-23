#include "../FirmwareModule.h"
#include "DiagnosticsTiming.h"
#include "PlatformCommon.h"

// @diagnostics
/*
    This section of the code handles
    optional sending of log messages
    to the Serial port
  */
bool debugMessages = false;
bool serialDebugEnabled = false;
bool serialDebugGeneralMessages = true;
bool serialDebugHeapMessages = true;
bool serialDebugAudioMessages = false;

namespace {
constexpr uint64_t SERIAL_DEBUG_REPORT_INTERVAL_MICROS = 2000000ULL;

bool serialDebugGeneralSuppressed = false;
bool serialDebugPeriodicSuppressed = false;
uint32_t serialDebugMinFreeHeap = 0;
uint64_t serialDebugLastReportMicros = 0;
uint32_t serialDebugWorstAudioCpuTenths = 0;
}  // namespace

void captureAndResetISRProfile(bool resumeProfiling);
uint32_t profileCpuTenths(uint32_t usedUs, uint32_t availableUs);
std::string formatProfileCpuPercentTenths(uint32_t cpuTenths);

uint32_t readRuntimeFreeHeapBytes() {
#if defined(ARDUINO_ARCH_RP2040)
  int freeHeap = rp2040.getFreeHeap();
  return freeHeap > 0 ? static_cast<uint32_t>(freeHeap) : 0;
#else
  return 0;
#endif
}

void resetSerialDebugMinFreeHeap() {
  serialDebugMinFreeHeap = 0;
  serialDebugLastReportMicros = runTime;
}

void resetSerialDebugAudioStats() {
  serialDebugWorstAudioCpuTenths = 0;
  if (serialDebugEnabled && serialDebugAudioMessages) {
    captureAndResetISRProfile(true);
  }
}

void updateSerialDebugRuntime() {
  debugMessages = serialDebugEnabled && serialDebugGeneralMessages && !serialDebugGeneralSuppressed;
  if (!serialDebugEnabled) {
    resetSerialDebugMinFreeHeap();
    serialDebugWorstAudioCpuTenths = 0;
  }
}

void setSerialDebugGeneralSuppressed(bool suppressed) {
  serialDebugGeneralSuppressed = suppressed;
  updateSerialDebugRuntime();
}

void setSerialDebugPeriodicSuppressed(bool suppressed) {
  serialDebugPeriodicSuppressed = suppressed;
}

void serviceSerialDebugMessages() {
  if (!serialDebugEnabled) {
    return;
  }

  uint32_t freeHeap = readRuntimeFreeHeapBytes();
  if (freeHeap > 0 && (serialDebugMinFreeHeap == 0 || freeHeap < serialDebugMinFreeHeap)) {
    serialDebugMinFreeHeap = freeHeap;
  }

  if (serialDebugPeriodicSuppressed) {
    return;
  }

  if ((runTime - serialDebugLastReportMicros) < SERIAL_DEBUG_REPORT_INTERVAL_MICROS) {
    return;
  }
  serialDebugLastReportMicros = runTime;

  if (serialDebugHeapMessages) {
    char line[64];
    snprintf(line,
             sizeof(line),
             "Heap free/min: %lu/%lu bytes",
             static_cast<unsigned long>(freeHeap),
             static_cast<unsigned long>(serialDebugMinFreeHeap));
    Serial.println(line);
  }

  if (serialDebugAudioMessages) {
    if (!isrProfilingEnabled) {
      captureAndResetISRProfile(true);
    }
    captureAndResetISRProfile(true);
    uint32_t avgCpuTenths = profileCpuTenths(isrProfileAvgUs, isrProfileAvailableUs);
    uint32_t maxCpuTenths = profileCpuTenths(isrProfileMaxUs, isrProfileAvailableUs);
    if (maxCpuTenths > serialDebugWorstAudioCpuTenths) {
      serialDebugWorstAudioCpuTenths = maxCpuTenths;
    }
    std::string avgCpuText = formatProfileCpuPercentTenths(avgCpuTenths);
    std::string maxCpuText = formatProfileCpuPercentTenths(maxCpuTenths);
    std::string worstCpuText = formatProfileCpuPercentTenths(serialDebugWorstAudioCpuTenths);
    char line[128];
    snprintf(line,
             sizeof(line),
             "Audio cpu avg/max/worst: %s/%s/%s, underruns/overruns/max: %lu/%lu/%lu us",
             avgCpuText.c_str(),
             maxCpuText.c_str(),
             worstCpuText.c_str(),
             static_cast<unsigned long>(isrProfileDmaUnderrunCount),
             static_cast<unsigned long>(isrProfileOverrunCount),
             static_cast<unsigned long>(isrProfileMaxUs));
    Serial.println(line);
  }
}
/*
    ISR cycle profiling — lightweight timing measurement for the
    DMA audio buffer renderer. Tracks min/max/average microseconds
    per filled audio block. Enabled/disabled at runtime via
    isrProfilingEnabled flag. Stats are read and reset atomically
    from Core 0 via readAndResetISRProfile().
  */
volatile bool isrProfilingEnabled = false;
volatile uint32_t isrCycleMin   = UINT32_MAX;
volatile uint32_t isrCycleMax   = 0;
volatile uint64_t isrCycleSum   = 0;
volatile uint32_t isrCycleCount = 0;
volatile uint32_t isrProfileMinUs  = 0;
volatile uint32_t isrProfileMaxUs  = 0;
volatile uint32_t isrProfileAvgUs  = 0;
volatile uint32_t isrProfileCount  = 0;
volatile uint32_t isrCycleAvailableUs = 0;
volatile uint32_t isrProfileAvailableUs = 0;
volatile uint32_t isrCycleOverrunCount = 0;
volatile uint32_t isrCycleReleaseStartCount = 0;
volatile uint32_t isrCyclePiezoScaleCount = 0;
volatile uint8_t isrCycleMaxVoices = 0;
volatile uint8_t isrCycleMaxFlags = 0;
volatile uint32_t isrProfileOverrunCount = 0;
volatile uint32_t isrProfileReleaseStartCount = 0;
volatile uint32_t isrProfilePiezoScaleCount = 0;
volatile uint32_t isrProfileDmaUnderrunCount = 0;
volatile uint8_t isrProfileMaxVoices = 0;
volatile uint8_t isrProfileMaxFlags = 0;

void captureAndResetISRProfile(bool resumeProfiling) {
  // Briefly disable profiling to get a consistent snapshot
  isrProfilingEnabled = false;
  __dmb();  // data memory barrier
  isrProfileMinUs = (isrCycleMin == UINT32_MAX) ? 0 : isrCycleMin;
  isrProfileMaxUs = isrCycleMax;
  isrProfileCount = isrCycleCount;
  isrProfileAvgUs = (isrProfileCount > 0) ? (uint32_t)(isrCycleSum / isrProfileCount) : 0;
  isrProfileAvailableUs = isrCycleAvailableUs;
  isrProfileOverrunCount = isrCycleOverrunCount;
  isrProfileReleaseStartCount = isrCycleReleaseStartCount;
  isrProfilePiezoScaleCount = isrCyclePiezoScaleCount;
  isrProfileDmaUnderrunCount = audioDmaUnderrunCount;
  isrProfileMaxVoices = isrCycleMaxVoices;
  isrProfileMaxFlags = isrCycleMaxFlags;
  // Reset counters
  isrCycleMin = UINT32_MAX;
  isrCycleMax = 0;
  isrCycleSum = 0;
  isrCycleCount = 0;
  isrCycleAvailableUs = 0;
  isrCycleOverrunCount = 0;
  isrCycleReleaseStartCount = 0;
  isrCyclePiezoScaleCount = 0;
  audioDmaUnderrunCount = 0;
  isrCycleMaxVoices = 0;
  isrCycleMaxFlags = 0;
  __dmb();
  isrProfilingEnabled = resumeProfiling;
}

void readAndResetISRProfile() {
  captureAndResetISRProfile(true);
}

void startISRProfileCapture() {
  captureAndResetISRProfile(true);
  sendToLog("ISR profile started.");
}

uint32_t profileCpuTenths(uint32_t usedUs, uint32_t availableUs) {
  if (availableUs == 0) {
    return 0;
  }
  return static_cast<uint32_t>(
    (static_cast<uint64_t>(usedUs) * 1000ull + (availableUs / 2u)) / availableUs);
}

std::string formatProfileCpuPercentTenths(uint32_t tenths) {
  return std::to_string(tenths / 10u) + "." + std::to_string(tenths % 10u) + "%";
}

std::string formatProfileCpuPercent(uint32_t usedUs, uint32_t availableUs) {
  if (availableUs == 0) {
    return "n/a";
  }
  return formatProfileCpuPercentTenths(profileCpuTenths(usedUs, availableUs));
}

void stopISRProfileCaptureAndLog() {
  captureAndResetISRProfile(false);
  std::string maxFlags = "";
  if (isrProfileMaxFlags & ISR_PROFILE_FLAG_RELEASE_START) {
    maxFlags += "release";
  }
  if (isrProfileMaxFlags & ISR_PROFILE_FLAG_PIEZO_SCALE) {
    if (!maxFlags.empty()) {
      maxFlags += "+";
    }
    maxFlags += "piezo";
  }
  if (maxFlags.empty()) {
    maxFlags = "steady";
  }
  sendToLog(
    "Audio profile min/avg/max/count: " +
    std::to_string(isrProfileMinUs) + "/" +
    std::to_string(isrProfileAvgUs) + "/" +
    std::to_string(isrProfileMaxUs) + " us, " +
    std::to_string(isrProfileCount) + " blocks, cpu min/avg/max: " +
    formatProfileCpuPercent(isrProfileMinUs, isrProfileAvailableUs) + "/" +
    formatProfileCpuPercent(isrProfileAvgUs, isrProfileAvailableUs) + "/" +
    formatProfileCpuPercent(isrProfileMaxUs, isrProfileAvailableUs) + ", overruns: " +
    std::to_string(isrProfileOverrunCount) + ", release starts: " +
    std::to_string(isrProfileReleaseStartCount) + ", piezo blocks: " +
    std::to_string(isrProfilePiezoScaleCount) + ", max voices/flags: " +
    std::to_string(isrProfileMaxVoices) + "/" + maxFlags +
    ", dma underruns: " + std::to_string(isrProfileDmaUnderrunCount));
}

// @timing
/*
    This section of the code handles basic
    timekeeping stuff
  */
#include "hardware/timer.h"  // library of code to access the processor's clock functions
uint64_t runTime = 0;        // Program loop consistent variable for time in microseconds since power on
uint64_t lapTime = 0;        // Used to keep track of how long each loop takes. Useful for rate-limiting.
uint64_t loopTime = 0;       // Used to check speed of the loop
uint64_t RAM_FUNC(readClock)() {
  uint64_t temp = timer_hw->timerawh;
  return (temp << 32) | timer_hw->timerawl;
}
void timeTracker() {
  lapTime = runTime - loopTime;
  loopTime = runTime;     // Update previousTime variable to give us a reference point for next loop
  runTime = readClock();  // Store the current time in a uniform variable for this program loop
}
