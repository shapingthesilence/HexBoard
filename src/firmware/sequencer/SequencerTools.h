#pragma once

#include "../FirmwareModule.h"
#include "SequencerState.h"

namespace sequencer {

enum class SequencerToolMode : byte {
  Normal,
  QuickLength,
  StepCleared,
  StatusMessage,
  ToolsPicker,
  ExactLength,
  ExactVelocity,
  ExactProbability,
  CopyTarget
};

enum class SequencerToolAction : byte {
  Length,
  Velocity,
  OctaveUp,
  OctaveDown,
  Probability,
  Tie,
  Copy,
  Cancel
};

enum class SequencerKeyAction : byte {
  InsertChar,
  Backspace,
  Cancel
};

struct SequencerToolKey {
  byte buttonIndex = 0;
  SequencerToolAction action = SequencerToolAction::Length;
};

struct SequencerTextKey {
  byte buttonIndex = 0;
  SequencerKeyAction action = SequencerKeyAction::InsertChar;
  char character = '\0';
};

constexpr byte kToolsButtonIndex = 29;
constexpr byte kToolsCancelButtonIndex = 102;
constexpr byte kBlueActionButtonIndex = 19;
constexpr uint64_t kSequencerMessageMicros = 2000000ULL;

SequencerToolMode toolMode();
bool toolModeIsModal();
bool toolModeSuppressesNoteEntry();
bool statusMessageIsToolsPrompt();
const char* statusLineOne();
const char* statusLineTwo();
int8_t overlaySourceStepIndex();
int8_t copySourceStepIndex();
uint16_t quickLengthDisplay();
uint16_t exactLengthOriginal();
const char* exactLengthBuffer();
byte exactLengthBufferLength();
byte velocityDisplay();
byte probabilityDisplay();

const SequencerToolKey* toolKeyForButton(byte buttonIndex);
const SequencerTextKey* exactLengthKeyForButton(byte buttonIndex);
const SequencerToolKey* toolKeys();
byte toolKeyCount();
const SequencerTextKey* exactLengthKeys();
byte exactLengthKeyCount();

void resetToolsState();
void serviceTools();
void selectStepForEditing(byte stepIndex, SequencerToolMode nextMode = SequencerToolMode::Normal);
void deselectSelectedStep();
void returnToNormalEditing();
void openToolsForSelectedStep();
void showPersistentStatusMessage(const char* lineOne, const char* lineTwo);
void showStatusMessageAndReturnToTools(const char* lineOne, const char* lineTwo);
void restoreSelectedStepFromUndo();
void clearSelectedStepForHold();
bool handleToolAction(SequencerToolAction action);
bool cancelCurrentToolEdit();
bool handleExactLengthButton(byte buttonIndex);
bool handleEncoderStepSwitch(byte stepIndex);
bool handleRotaryTurn(int8_t direction);
bool handleEncoderClick();

}  // namespace sequencer
