#pragma once

#include "../FirmwareModule.h"

void assignPitches();
void applyScale();
void applyLayout();
bool hexIsInCurrentScale(byte hexIndex);
void restoreDefaultVisibleButtonRoles();
void applyUserGeometryButtonOverrides();
