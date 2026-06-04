#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <GEM_u8g2.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>
#include <numeric>
#include <queue>
#include <string>
#include <vector>

#if defined(ARDUINO_ARCH_RP2040)
#include <hardware/flash.h>
#define RAM_FUNC(name) __not_in_flash_func(name)
#else
#define RAM_FUNC(name) name
#endif

#include "LittleFS.h"
#include "hardware/dma.h"
#include "hardware/structs/sio.h"
#include "pico/time.h"
