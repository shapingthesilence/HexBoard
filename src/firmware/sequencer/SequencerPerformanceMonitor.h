#pragma once

#include "../FirmwareModule.h"
#include "../midi/MidiInput.h"

namespace sequencer {

struct SequencerPerformanceSnapshot {
  uint16_t audioEnginePercent = 0;
  uint32_t heapUsedBytes = 0;
  uint32_t heapTotalBytes = 0;
  bool storageAvailable = false;
  uint64_t storageUsedBytes = 0;
  uint64_t storageTotalBytes = 0;
  MidiInputMonitorStats midi = {};
};

bool performanceMonitorActive();
void resetPerformanceMonitorState();
void showPerformanceMonitor();
void hidePerformanceMonitor();
void refreshPerformanceMonitorStats(bool forceRefresh);
const SequencerPerformanceSnapshot& performanceMonitorSnapshot();
void formatPerformanceMonitorByteLabel(uint64_t bytes, char* out, size_t outSize);

}  // namespace sequencer
