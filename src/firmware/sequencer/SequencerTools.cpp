#include "SequencerTools.h"

#include "../config/FeatureFlags.h"

#if HEXBOARD_ENABLE_SEQUENCER
#include "SequencerManagedNotes.h"
#include "SequencerOverlay.h"
#include "SequencerPlaybackSettings.h"
#include "SequencerTransport.h"
#include "../app/DiagnosticsTiming.h"
#include "../tuning/Tuning.h"

namespace sequencer {
namespace {

constexpr byte kGateChoiceCount = 17;
constexpr byte kVelocityChoiceCount = 27;
constexpr byte kProbabilityChoiceCount = 21;

const uint16_t kGateChoices[kGateChoiceCount] = {
  0, 25, 50, 75, 100, 150, 200, 250, 300, 350, 400, 500, 600, 700, 800, 900, 1000
};

const SequencerTextKey kExactLengthKeys[] = {
  { 50, SequencerKeyAction::InsertChar, '0' },
  { 51, SequencerKeyAction::InsertChar, '1' },
  { 52, SequencerKeyAction::InsertChar, '2' },
  { 53, SequencerKeyAction::InsertChar, '3' },
  { 54, SequencerKeyAction::InsertChar, '4' },
  { 61, SequencerKeyAction::InsertChar, '5' },
  { 62, SequencerKeyAction::InsertChar, '6' },
  { 63, SequencerKeyAction::InsertChar, '7' },
  { 64, SequencerKeyAction::InsertChar, '8' },
  { 65, SequencerKeyAction::InsertChar, '9' },
  { 70, SequencerKeyAction::Backspace, '\0' },
  { kToolsCancelButtonIndex, SequencerKeyAction::Cancel, '\0' }
};

const SequencerToolKey kToolKeys[] = {
  { 50, SequencerToolAction::Length },
  { 51, SequencerToolAction::Velocity },
  { 52, SequencerToolAction::OctaveUp },
  { 53, SequencerToolAction::OctaveDown },
  { 61, SequencerToolAction::Probability },
  { 62, SequencerToolAction::Tie },
  { 63, SequencerToolAction::Copy },
  { kToolsCancelButtonIndex, SequencerToolAction::Cancel }
};

SequencerToolMode currentMode = SequencerToolMode::Normal;
SequencerToolMode returnMode = SequencerToolMode::Normal;
uint64_t modeUntil = 0;
char statusOne[24] = "";
char statusTwo[24] = "";
SequencerStepSnapshot undoSnapshot;
bool undoSnapshotValid = false;
uint16_t quickGateDisplay = kDefaultGatePercent;
uint16_t lengthOriginal = kDefaultGatePercent;
char lengthBuffer[5] = "";
byte lengthBufferLength = 0;
byte velocityEditDisplay = kDefaultVelocity;
byte probabilityEditDisplay = kDefaultProbability;
int8_t copySourceStep = kNoSelectedStep;

byte gateChoiceIndex(uint16_t gatePercent) {
  for (byte i = 0; i < kGateChoiceCount; ++i) {
    if (kGateChoices[i] == gatePercent) {
      return i;
    }
  }

  byte nearestIndex = 0;
  uint16_t nearestDistance = 65535;
  for (byte i = 0; i < kGateChoiceCount; ++i) {
    uint16_t distance = static_cast<uint16_t>(abs(static_cast<int>(kGateChoices[i]) - static_cast<int>(gatePercent)));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = i;
    }
  }
  return nearestIndex;
}

byte velocityChoiceValue(byte choiceIndex) {
  if (choiceIndex >= kVelocityChoiceCount - 1) {
    return 127;
  }
  return static_cast<byte>(choiceIndex * 5);
}

byte velocityChoiceIndex(byte velocity) {
  byte nearestIndex = 0;
  uint16_t nearestDistance = 65535;
  for (byte i = 0; i < kVelocityChoiceCount; ++i) {
    byte choiceValue = velocityChoiceValue(i);
    uint16_t distance = static_cast<uint16_t>(abs(static_cast<int>(choiceValue) - static_cast<int>(velocity)));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = i;
    }
  }
  return nearestIndex;
}

byte probabilityChoiceValue(byte choiceIndex) {
  if (choiceIndex >= kProbabilityChoiceCount - 1) {
    return 100;
  }
  return static_cast<byte>(choiceIndex * 5);
}

byte probabilityChoiceIndex(byte probability) {
  byte nearestIndex = 0;
  uint16_t nearestDistance = 65535;
  for (byte i = 0; i < kProbabilityChoiceCount; ++i) {
    byte choiceValue = probabilityChoiceValue(i);
    uint16_t distance = static_cast<uint16_t>(abs(static_cast<int>(choiceValue) - static_cast<int>(probability)));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = i;
    }
  }
  return nearestIndex;
}

void markToolsDirty() {
  markOverlayDirty();
}

void loadEditDisplaysFromSelectedStep() {
  if (!hasSelectedStep()) {
    quickGateDisplay = kDefaultGatePercent;
    lengthOriginal = kDefaultGatePercent;
    velocityEditDisplay = kDefaultVelocity;
    probabilityEditDisplay = kDefaultProbability;
    lengthBuffer[0] = '\0';
    lengthBufferLength = 0;
    return;
  }

  const SequencerStep& target = step(static_cast<byte>(selectedStepIndex()));
  quickGateDisplay = target.gatePercent;
  lengthOriginal = target.gatePercent;
  velocityEditDisplay = target.velocity;
  probabilityEditDisplay = target.probability;
  lengthBuffer[0] = '\0';
  lengthBufferLength = 0;
}

void setMode(SequencerToolMode nextMode) {
  currentMode = nextMode;
  markToolsDirty();
}

void showStatusMessage(const char* lineOne, const char* lineTwo, SequencerToolMode nextReturnMode, uint64_t until) {
  snprintf(statusOne, sizeof(statusOne), "%s", (lineOne != nullptr) ? lineOne : "");
  snprintf(statusTwo, sizeof(statusTwo), "%s", (lineTwo != nullptr) ? lineTwo : "");
  returnMode = nextReturnMode;
  modeUntil = until;
  setMode(SequencerToolMode::StatusMessage);
}

void enterExactLength() {
  loadEditDisplaysFromSelectedStep();
  setMode(SequencerToolMode::ExactLength);
}

void exitExactLength(bool saveChanges) {
  if (hasSelectedStep()) {
    byte selected = static_cast<byte>(selectedStepIndex());
    uint16_t finalValue = lengthOriginal;
    if (saveChanges && lengthBufferLength > 0) {
      finalValue = static_cast<uint16_t>(atoi(lengthBuffer));
      if (finalValue > 1000) {
        finalValue = 1000;
      }
    }
    if (setStepGatePercent(selected, finalValue)) {
      releasePlaybackForStep(selected);
    }
    quickGateDisplay = step(selected).gatePercent;
    lengthOriginal = quickGateDisplay;
  }
  lengthBuffer[0] = '\0';
  lengthBufferLength = 0;
  setMode(SequencerToolMode::ToolsPicker);
}

void enterExactVelocity() {
  loadEditDisplaysFromSelectedStep();
  setMode(SequencerToolMode::ExactVelocity);
}

void exitExactVelocity(bool saveChanges) {
  if (hasSelectedStep()) {
    byte selected = static_cast<byte>(selectedStepIndex());
    if (saveChanges && setStepVelocity(selected, velocityEditDisplay)) {
      releasePlaybackForStep(selected);
    }
    velocityEditDisplay = step(selected).velocity;
  }
  setMode(SequencerToolMode::ToolsPicker);
}

void enterExactProbability() {
  loadEditDisplaysFromSelectedStep();
  setMode(SequencerToolMode::ExactProbability);
}

void exitExactProbability(bool saveChanges) {
  if (hasSelectedStep()) {
    byte selected = static_cast<byte>(selectedStepIndex());
    if (saveChanges && setStepProbability(selected, probabilityEditDisplay)) {
      releasePlaybackForStep(selected);
    }
    probabilityEditDisplay = step(selected).probability;
  }
  setMode(SequencerToolMode::ToolsPicker);
}

void enterCopyTarget() {
  if (!hasSelectedStep()) {
    return;
  }
  copySourceStep = selectedStepIndex();
  setMode(SequencerToolMode::CopyTarget);
}

void exitCopyTarget() {
  copySourceStep = kNoSelectedStep;
  setMode(SequencerToolMode::ToolsPicker);
}

void insertExactLengthChar(char character) {
  if (lengthBufferLength >= 4 || character < '0' || character > '9') {
    return;
  }
  lengthBuffer[lengthBufferLength++] = character;
  lengthBuffer[lengthBufferLength] = '\0';

  uint16_t value = static_cast<uint16_t>(atoi(lengthBuffer));
  if (value > 1000) {
    snprintf(lengthBuffer, sizeof(lengthBuffer), "1000");
    lengthBufferLength = 4;
    value = 1000;
  }
  quickGateDisplay = value;
  markToolsDirty();
}

void backspaceExactLengthChar() {
  if (lengthBufferLength == 0) {
    return;
  }
  --lengthBufferLength;
  lengthBuffer[lengthBufferLength] = '\0';
  quickGateDisplay = (lengthBufferLength > 0) ? static_cast<uint16_t>(atoi(lengthBuffer)) : lengthOriginal;
  markToolsDirty();
}

void applyTranspose(int16_t pitchStepDelta, const char* toolName) {
  if (!hasSelectedStep()) {
    showStatusMessageAndReturnToTools(toolName, "Select step");
    return;
  }

  byte selected = static_cast<byte>(selectedStepIndex());
  SequencerTransposeResult result = transposeStep(selected, pitchStepDelta, current.transpose, current.tuning().cycleLength);
  switch (result) {
    case SequencerTransposeResult::Changed:
      releasePlaybackForStep(selected);
      setMode(SequencerToolMode::ToolsPicker);
      return;
    case SequencerTransposeResult::Empty:
      showStatusMessageAndReturnToTools("Step empty", "Add notes first");
      return;
    case SequencerTransposeResult::OutOfRange:
      showStatusMessageAndReturnToTools(toolName, "Range 0-9");
      return;
    case SequencerTransposeResult::Unchanged:
    default:
      showStatusMessageAndReturnToTools(toolName, "Step unchanged");
      return;
  }
}

}  // namespace

SequencerToolMode toolMode() {
  return currentMode;
}

bool toolModeIsModal() {
  return currentMode == SequencerToolMode::ToolsPicker ||
         currentMode == SequencerToolMode::ExactLength ||
         currentMode == SequencerToolMode::ExactVelocity ||
         currentMode == SequencerToolMode::ExactProbability ||
         currentMode == SequencerToolMode::CopyTarget ||
         (currentMode == SequencerToolMode::StatusMessage && returnMode == SequencerToolMode::ToolsPicker);
}

bool toolModeSuppressesNoteEntry() {
  return toolModeIsModal();
}

bool statusMessageIsToolsPrompt() {
  return currentMode == SequencerToolMode::StatusMessage &&
         strcmp(statusOne, "Select step") == 0 &&
         strcmp(statusTwo, "Then open tools") == 0;
}

const char* statusLineOne() {
  return statusOne;
}

const char* statusLineTwo() {
  return statusTwo;
}

int8_t overlaySourceStepIndex() {
  if (currentMode == SequencerToolMode::CopyTarget && copySourceStep >= 0) {
    return copySourceStep;
  }
  return selectedStepIndex();
}

int8_t copySourceStepIndex() {
  return copySourceStep;
}

uint16_t quickLengthDisplay() {
  return quickGateDisplay;
}

uint16_t exactLengthOriginal() {
  return lengthOriginal;
}

const char* exactLengthBuffer() {
  return lengthBuffer;
}

byte exactLengthBufferLength() {
  return lengthBufferLength;
}

byte velocityDisplay() {
  return velocityEditDisplay;
}

byte probabilityDisplay() {
  return probabilityEditDisplay;
}

const SequencerToolKey* toolKeyForButton(byte buttonIndex) {
  for (byte i = 0; i < toolKeyCount(); ++i) {
    if (kToolKeys[i].buttonIndex == buttonIndex) {
      return &kToolKeys[i];
    }
  }
  return nullptr;
}

const SequencerTextKey* exactLengthKeyForButton(byte buttonIndex) {
  for (byte i = 0; i < exactLengthKeyCount(); ++i) {
    if (kExactLengthKeys[i].buttonIndex == buttonIndex) {
      return &kExactLengthKeys[i];
    }
  }
  return nullptr;
}

const SequencerToolKey* toolKeys() {
  return kToolKeys;
}

byte toolKeyCount() {
  return sizeof(kToolKeys) / sizeof(kToolKeys[0]);
}

const SequencerTextKey* exactLengthKeys() {
  return kExactLengthKeys;
}

byte exactLengthKeyCount() {
  return sizeof(kExactLengthKeys) / sizeof(kExactLengthKeys[0]);
}

void resetToolsState() {
  currentMode = SequencerToolMode::Normal;
  returnMode = SequencerToolMode::Normal;
  modeUntil = 0;
  statusOne[0] = '\0';
  statusTwo[0] = '\0';
  undoSnapshot = SequencerStepSnapshot{};
  undoSnapshotValid = false;
  quickGateDisplay = kDefaultGatePercent;
  lengthOriginal = kDefaultGatePercent;
  lengthBuffer[0] = '\0';
  lengthBufferLength = 0;
  velocityEditDisplay = kDefaultVelocity;
  probabilityEditDisplay = kDefaultProbability;
  copySourceStep = kNoSelectedStep;
}

void serviceTools() {
  if (currentMode == SequencerToolMode::QuickLength && modeUntil != 0 && runTime >= modeUntil) {
    modeUntil = 0;
    setMode(SequencerToolMode::Normal);
    return;
  }
  if (currentMode == SequencerToolMode::StatusMessage &&
      modeUntil != static_cast<uint64_t>(-1) &&
      modeUntil != 0 &&
      runTime >= modeUntil) {
    modeUntil = 0;
    setMode(returnMode);
  }
}

void selectStepForEditing(byte stepIndex, SequencerToolMode nextMode) {
  if (stepIndex >= kStepCount) {
    return;
  }
  selectStep(stepIndex);
  snapshotStep(stepIndex, undoSnapshot);
  undoSnapshotValid = true;
  loadEditDisplaysFromSelectedStep();
  copySourceStep = (nextMode == SequencerToolMode::CopyTarget) ? copySourceStep : kNoSelectedStep;
  currentMode = nextMode;
  returnMode = SequencerToolMode::Normal;
  modeUntil = 0;
  markToolsDirty();
}

void deselectSelectedStep() {
  stopPreviewNotes();
  deselectStep();
  currentMode = SequencerToolMode::Normal;
  copySourceStep = kNoSelectedStep;
  undoSnapshotValid = false;
  hideSelectedStepOverlay();
}

void openToolsForSelectedStep() {
  if (!hasSelectedStep()) {
    showPersistentStatusMessage("Select step", "Then open tools");
    return;
  }
  setMode(SequencerToolMode::ToolsPicker);
}

void showPersistentStatusMessage(const char* lineOne, const char* lineTwo) {
  showStatusMessage(lineOne, lineTwo, SequencerToolMode::Normal, static_cast<uint64_t>(-1));
}

void showStatusMessageAndReturnToTools(const char* lineOne, const char* lineTwo) {
  showStatusMessage(lineOne, lineTwo, SequencerToolMode::ToolsPicker, runTime + kSequencerMessageMicros);
}

void restoreSelectedStepFromUndo() {
  if (!hasSelectedStep() || !undoSnapshotValid) {
    return;
  }
  byte selected = static_cast<byte>(selectedStepIndex());
  restoreStep(selected, undoSnapshot);
  releasePlaybackForStep(selected);
  loadEditDisplaysFromSelectedStep();
  setMode(SequencerToolMode::Normal);
}

void clearSelectedStepForHold() {
  if (!hasSelectedStep()) {
    return;
  }
  byte selected = static_cast<byte>(selectedStepIndex());
  clearStepNotesAndTie(selected);
  stopPreviewNotes();
  releasePlaybackForStep(selected);
  loadEditDisplaysFromSelectedStep();
  setMode(SequencerToolMode::StepCleared);
}

bool handleToolAction(SequencerToolAction action) {
  if (!hasSelectedStep()) {
    showStatusMessageAndReturnToTools("Select step", "Then open tools");
    return true;
  }

  switch (action) {
    case SequencerToolAction::Length:
      enterExactLength();
      return true;
    case SequencerToolAction::Velocity:
      enterExactVelocity();
      return true;
    case SequencerToolAction::OctaveUp:
      {
        int cycleLength = current.tuning().cycleLength;
        applyTranspose(static_cast<int16_t>((cycleLength > 0) ? cycleLength : 12), "Oct+");
      }
      return true;
    case SequencerToolAction::OctaveDown:
      {
        int cycleLength = current.tuning().cycleLength;
        applyTranspose(-static_cast<int16_t>((cycleLength > 0) ? cycleLength : 12), "Oct-");
      }
      return true;
    case SequencerToolAction::Probability:
      enterExactProbability();
      return true;
    case SequencerToolAction::Tie:
      {
        byte selected = static_cast<byte>(selectedStepIndex());
        if (setStepTie(selected, !step(selected).tie)) {
          releasePlaybackForStep(selected);
        }
        setMode(SequencerToolMode::ToolsPicker);
      }
      return true;
    case SequencerToolAction::Copy:
      enterCopyTarget();
      return true;
    case SequencerToolAction::Cancel:
      setMode(SequencerToolMode::Normal);
      return true;
  }
  return true;
}

bool handleExactLengthButton(byte buttonIndex) {
  if (currentMode != SequencerToolMode::ExactLength) {
    return false;
  }

  const SequencerTextKey* key = exactLengthKeyForButton(buttonIndex);
  if (key == nullptr) {
    return true;
  }

  switch (key->action) {
    case SequencerKeyAction::InsertChar:
      insertExactLengthChar(key->character);
      break;
    case SequencerKeyAction::Backspace:
      backspaceExactLengthChar();
      break;
    case SequencerKeyAction::Cancel:
      exitExactLength(false);
      break;
  }
  return true;
}

bool handleEncoderStepSwitch(byte stepIndex) {
  if (currentMode == SequencerToolMode::ToolsPicker) {
    selectStepForEditing(stepIndex, SequencerToolMode::ToolsPicker);
    return true;
  }
  if (currentMode == SequencerToolMode::ExactVelocity) {
    selectStepForEditing(stepIndex, SequencerToolMode::ExactVelocity);
    return true;
  }
  if (currentMode == SequencerToolMode::ExactProbability) {
    selectStepForEditing(stepIndex, SequencerToolMode::ExactProbability);
    return true;
  }
  return false;
}

bool handleRotaryTurn(int8_t direction) {
  if (direction == 0) {
    return false;
  }

  if (currentMode == SequencerToolMode::ExactVelocity) {
    byte currentIndex = velocityChoiceIndex(velocityEditDisplay);
    int nextIndex = static_cast<int>(currentIndex) + direction;
    if (nextIndex < 0) {
      nextIndex = 0;
    } else if (nextIndex >= kVelocityChoiceCount) {
      nextIndex = kVelocityChoiceCount - 1;
    }
    velocityEditDisplay = velocityChoiceValue(static_cast<byte>(nextIndex));
    markToolsDirty();
    return true;
  }

  if (currentMode == SequencerToolMode::ExactProbability) {
    byte currentIndex = probabilityChoiceIndex(probabilityEditDisplay);
    int nextIndex = static_cast<int>(currentIndex) + direction;
    if (nextIndex < 0) {
      nextIndex = 0;
    } else if (nextIndex >= kProbabilityChoiceCount) {
      nextIndex = kProbabilityChoiceCount - 1;
    }
    probabilityEditDisplay = probabilityChoiceValue(static_cast<byte>(nextIndex));
    markToolsDirty();
    return true;
  }

  if (currentMode == SequencerToolMode::ExactLength ||
      currentMode == SequencerToolMode::ToolsPicker ||
      currentMode == SequencerToolMode::CopyTarget ||
      (currentMode == SequencerToolMode::StatusMessage && returnMode == SequencerToolMode::ToolsPicker)) {
    return true;
  }

  if (!hasSelectedStep() ||
      (currentMode != SequencerToolMode::Normal && currentMode != SequencerToolMode::QuickLength)) {
    return false;
  }

  byte selected = static_cast<byte>(selectedStepIndex());
  uint16_t currentGate = step(selected).gatePercent;
  byte currentIndex = gateChoiceIndex(currentGate);
  int nextIndex = static_cast<int>(currentIndex) + direction;
  if (nextIndex < 0) {
    nextIndex = 0;
  } else if (nextIndex >= kGateChoiceCount) {
    nextIndex = kGateChoiceCount - 1;
  }

  uint16_t newGate = kGateChoices[nextIndex];
  if (newGate != currentGate && setStepGatePercent(selected, newGate)) {
    releasePlaybackForStep(selected);
  }
  quickGateDisplay = step(selected).gatePercent;
  modeUntil = runTime + kSequencerMessageMicros;
  setMode(SequencerToolMode::QuickLength);
  return true;
}

bool handleEncoderClick() {
  if (currentMode == SequencerToolMode::CopyTarget) {
    exitCopyTarget();
    return true;
  }
  if (currentMode == SequencerToolMode::ExactLength) {
    exitExactLength(true);
    return true;
  }
  if (currentMode == SequencerToolMode::ExactVelocity) {
    exitExactVelocity(true);
    return true;
  }
  if (currentMode == SequencerToolMode::ExactProbability) {
    exitExactProbability(true);
    return true;
  }
  if (currentMode == SequencerToolMode::ToolsPicker) {
    return true;
  }
  if (currentMode == SequencerToolMode::StatusMessage) {
    setMode(returnMode);
    return true;
  }
  if (hasSelectedStep()) {
    deselectSelectedStep();
    return true;
  }
  return false;
}

}  // namespace sequencer
#else
namespace sequencer {

SequencerToolMode toolMode() {
  return SequencerToolMode::Normal;
}

bool toolModeIsModal() {
  return false;
}

bool toolModeSuppressesNoteEntry() {
  return false;
}

bool statusMessageIsToolsPrompt() {
  return false;
}

const char* statusLineOne() {
  return "";
}

const char* statusLineTwo() {
  return "";
}

int8_t overlaySourceStepIndex() {
  return -1;
}

int8_t copySourceStepIndex() {
  return -1;
}

uint16_t quickLengthDisplay() {
  return kDefaultGatePercent;
}

uint16_t exactLengthOriginal() {
  return kDefaultGatePercent;
}

const char* exactLengthBuffer() {
  return "";
}

byte exactLengthBufferLength() {
  return 0;
}

byte velocityDisplay() {
  return kDefaultVelocity;
}

byte probabilityDisplay() {
  return kDefaultProbability;
}

const SequencerToolKey* toolKeyForButton(byte /*buttonIndex*/) {
  return nullptr;
}

const SequencerTextKey* exactLengthKeyForButton(byte /*buttonIndex*/) {
  return nullptr;
}

const SequencerToolKey* toolKeys() {
  return nullptr;
}

byte toolKeyCount() {
  return 0;
}

const SequencerTextKey* exactLengthKeys() {
  return nullptr;
}

byte exactLengthKeyCount() {
  return 0;
}

void resetToolsState() {
}

void serviceTools() {
}

void selectStepForEditing(byte /*stepIndex*/, SequencerToolMode /*nextMode*/) {
}

void deselectSelectedStep() {
}

void openToolsForSelectedStep() {
}

void showPersistentStatusMessage(const char* /*lineOne*/, const char* /*lineTwo*/) {
}

void showStatusMessageAndReturnToTools(const char* /*lineOne*/, const char* /*lineTwo*/) {
}

void restoreSelectedStepFromUndo() {
}

void clearSelectedStepForHold() {
}

bool handleToolAction(SequencerToolAction /*action*/) {
  return false;
}

bool handleExactLengthButton(byte /*buttonIndex*/) {
  return false;
}

bool handleEncoderStepSwitch(byte /*stepIndex*/) {
  return false;
}

bool handleRotaryTurn(int8_t /*direction*/) {
  return false;
}

bool handleEncoderClick() {
  return false;
}

}  // namespace sequencer
#endif
