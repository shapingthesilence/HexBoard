#pragma once

#include "../FirmwareModule.h"

void sendDelegatedEncoderEvent(byte event);
void notePresetSyncTransferActivity(uint8_t message);
void exitDelegatedControl();
void RAM_FUNC(delegatedButtonEvent)(byte x, bool press);
bool processIncomingSysEx(const uint8_t* data, const unsigned int len);
bool processIncomingDelegatedSysEx(const uint8_t* sysex, const unsigned int len);
