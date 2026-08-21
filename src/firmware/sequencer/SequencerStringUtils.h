#pragma once

#include <stddef.h>
#include <string.h>

namespace sequencer {

inline void copyBoundedString(char* destination,
                              size_t destinationLength,
                              const char* source) {
  if (destination == nullptr || destinationLength == 0) {
    return;
  }
  if (source == nullptr) {
    destination[0] = '\0';
    return;
  }
  size_t copied = 0;
  while (copied + 1 < destinationLength && source[copied] != '\0') {
    destination[copied] = source[copied];
    ++copied;
  }
  destination[copied] = '\0';
}

inline bool appendBoundedString(char* destination,
                                size_t destinationLength,
                                const char* suffix) {
  if (destination == nullptr || suffix == nullptr) {
    return false;
  }
  size_t used = 0;
  while (used < destinationLength && destination[used] != '\0') {
    ++used;
  }
  if (used == destinationLength) {
    return false;
  }
  const size_t suffixLength = strlen(suffix);
  if (used + suffixLength >= destinationLength) {
    return false;
  }
  memcpy(destination + used, suffix, suffixLength + 1);
  return true;
}

}  // namespace sequencer
