#define HEXBOARD_FIRMWARE_UNITY 1

#include "FirmwareModule.h"
#include "HexBoardFirmware.h"
#include "app/PlatformCommon.h"
#include "app/RuntimeDefaults.h"
#include "app/DiagnosticsTiming.h"
#include "midi/MidiTransport.h"
#include "midi/MidiRouting.h"

#include "hardware/GridState.cpp"
#include "hardware/LedRender.cpp"
#include "tuning/DynamicJustIntonation.cpp"
#include "midi/NoteDispatch.cpp"
#include "synth/BuiltinWavetables.cpp"
#include "synth/SynthAudio.cpp"
#include "menu/MenuAndDisplay.cpp"
#include "hardware/GridScanRotary.cpp"
#include "app/Runtime.cpp"
