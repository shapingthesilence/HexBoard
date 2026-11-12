#pragma once

#include "../FirmwareModule.h"

void createUserGeometryMenuItems();
void rebuildUserGeometryMenuItems();
void requestUserGeometryMenuRebuild();
void serviceUserGeometryMenuRebuild();
// Auditions the tuning, layout or scale resting under the cursor.
void serviceUserGeometryMenuAudition();
void openUserGeometryTuningMenu();
void openUserGeometryLayoutMenu();
void openUserGeometryScaleMenu();
