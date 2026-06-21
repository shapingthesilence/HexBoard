#pragma once

#include "../FirmwareModule.h"

void createUserGeometryMenuItems();
void rebuildUserGeometryMenuItems();
void requestUserGeometryMenuRebuild();
void serviceUserGeometryMenuRebuild();
void openUserGeometryTuningMenu();
void openUserGeometryLayoutMenu();
void openUserGeometryScaleMenu();
bool handleUserGeometryMenuKey(byte keyCode);
