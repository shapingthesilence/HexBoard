#pragma once

#include "../FirmwareModule.h"

struct MidiInputMonitorStats {
  uint32_t pendingBytes = 0;
  uint32_t droppedBacklogEpisodes = 0;
  uint32_t lateBacklogEpisodes = 0;
};

void resetMidiInputMonitorStats();
MidiInputMonitorStats midiInputMonitorStats();
bool processIncomingMIDIDelegated();
bool RAM_FUNC(processIncomingMIDI)();
