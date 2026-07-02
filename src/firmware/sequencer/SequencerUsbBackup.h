#pragma once

#include "../FirmwareModule.h"

namespace sequencer {

void setupUsbBackup();
bool enterUsbBackupMode();
void exitUsbBackupMode();
bool isUsbBackupActive();
void serviceUsbBackup();

void getUsbBackupStatusLines(char* lineOneOut, size_t lineOneSize,
                             char* lineTwoOut, size_t lineTwoSize);
bool consumeUsbBackupUiRefreshRequested();

}  // namespace sequencer
