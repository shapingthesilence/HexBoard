#include "SequencerPerformanceMonitor.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "../app/DiagnosticsTiming.h"
#include "../storage/Settings.h"

namespace sequencer {
namespace {

constexpr uint64_t kPerformanceRefreshMicros = 250000ULL;
constexpr uint16_t kMaxDisplayedPercent = 999;

bool g_active = false;
bool g_previousIsrProfilingEnabled = false;
uint64_t g_lastSampleAt = 0;
SequencerPerformanceSnapshot g_snapshot;

uint16_t audioPercentFromProfile() {
  if (isrProfileCount == 0 || isrProfileAvailableUs == 0) {
    return 0;
  }

  uint32_t percent = static_cast<uint32_t>(
    (static_cast<uint64_t>(isrProfileAvgUs) * 100ULL + (isrProfileAvailableUs / 2ULL)) /
    isrProfileAvailableUs);
  return static_cast<uint16_t>(percent > kMaxDisplayedPercent ? kMaxDisplayedPercent : percent);
}

void refreshHeapStats() {
#if defined(ARDUINO_ARCH_RP2040)
  int usedHeap = rp2040.getUsedHeap();
  int totalHeap = rp2040.getTotalHeap();
  g_snapshot.heapUsedBytes = usedHeap > 0 ? static_cast<uint32_t>(usedHeap) : 0;
  g_snapshot.heapTotalBytes = totalHeap > 0 ? static_cast<uint32_t>(totalHeap) : 0;
#else
  g_snapshot.heapUsedBytes = 0;
  g_snapshot.heapTotalBytes = 0;
#endif
}

void refreshStorageStats() {
  FSInfo storageInfo;
  if (fileSystemExists && LittleFS.info(storageInfo)) {
    g_snapshot.storageAvailable = true;
    g_snapshot.storageUsedBytes = storageInfo.usedBytes;
    g_snapshot.storageTotalBytes = storageInfo.totalBytes;
    return;
  }

  g_snapshot.storageAvailable = false;
  g_snapshot.storageUsedBytes = 0;
  g_snapshot.storageTotalBytes = 0;
}

}  // namespace

bool performanceMonitorActive() {
  return g_active;
}

void resetPerformanceMonitorState() {
  if (g_active) {
    hidePerformanceMonitor();
  }
  g_active = false;
  g_lastSampleAt = 0;
  g_snapshot = SequencerPerformanceSnapshot{};
}

void showPerformanceMonitor() {
  if (g_active) {
    refreshPerformanceMonitorStats(false);
    return;
  }

  g_previousIsrProfilingEnabled = isrProfilingEnabled;
  g_active = true;
  g_lastSampleAt = 0;
  resetMidiInputMonitorStats();
  isrProfilingEnabled = true;
  readAndResetISRProfile();
  refreshPerformanceMonitorStats(true);
}

void hidePerformanceMonitor() {
  if (!g_active) {
    return;
  }

  g_active = false;
  g_lastSampleAt = 0;
  isrProfilingEnabled = g_previousIsrProfilingEnabled;
}

void refreshPerformanceMonitorStats(bool forceRefresh) {
  if (!g_active) {
    return;
  }

  if (!forceRefresh &&
      g_lastSampleAt != 0 &&
      (runTime - g_lastSampleAt) < kPerformanceRefreshMicros) {
    return;
  }

  refreshHeapStats();
  refreshStorageStats();
  readAndResetISRProfile();
  g_snapshot.audioEnginePercent = audioPercentFromProfile();
  g_snapshot.midi = midiInputMonitorStats();
  g_lastSampleAt = runTime;
}

const SequencerPerformanceSnapshot& performanceMonitorSnapshot() {
  return g_snapshot;
}

void formatPerformanceMonitorByteLabel(uint64_t bytes, char* out, size_t outSize) {
  if (out == nullptr || outSize == 0) {
    return;
  }

  if (bytes >= (1024ULL * 1024ULL)) {
    snprintf(out,
             outSize,
             "%lluM",
             static_cast<unsigned long long>((bytes + (512ULL * 1024ULL)) / (1024ULL * 1024ULL)));
  } else if (bytes >= 1024ULL) {
    snprintf(out, outSize, "%lluK", static_cast<unsigned long long>((bytes + 512ULL) / 1024ULL));
  } else {
    snprintf(out, outSize, "%lluB", static_cast<unsigned long long>(bytes));
  }
}

}  // namespace sequencer
#else
namespace sequencer {

bool performanceMonitorActive() {
  return false;
}

void resetPerformanceMonitorState() {
}

void showPerformanceMonitor() {
}

void hidePerformanceMonitor() {
}

void refreshPerformanceMonitorStats(bool /*forceRefresh*/) {
}

const SequencerPerformanceSnapshot& performanceMonitorSnapshot() {
  static SequencerPerformanceSnapshot snapshot;
  return snapshot;
}

void formatPerformanceMonitorByteLabel(uint64_t /*bytes*/, char* out, size_t outSize) {
  if (out != nullptr && outSize > 0) {
    out[0] = '\0';
  }
}

}  // namespace sequencer
#endif
