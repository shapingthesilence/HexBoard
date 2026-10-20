#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

// CDC commands are line-delimited, bounded, and independent of saved settings.
class SerialDebugCommandParser {
 public:
  static constexpr int NoCommand = -2;
  static constexpr int Query = -1;
  static constexpr int AudioTestStart = -3;
  static constexpr int AudioTestStop = -4;

  int consume(uint8_t byte) {
    if (byte == '\r') return NoCommand;
    if (byte != '\n') {
      if (length_ < sizeof(line_)) line_[length_++] = byte;
      else overflow_ = true;
      return NoCommand;
    }
    int command = NoCommand;
    if (!overflow_) {
      if (length_ == 6 && memcmp(line_, "HBDBG?", 6) == 0) command = Query;
      else if (length_ == 7 && memcmp(line_, "HBAUD 1", 7) == 0) command = AudioTestStart;
      else if (length_ == 7 && memcmp(line_, "HBAUD 0", 7) == 0) command = AudioTestStop;
      else if ((length_ == 7 || length_ == 8) && memcmp(line_, "HBDBG ", 6) == 0) {
        const uint8_t first = line_[6];
        if (first >= '0' && first <= '9') {
          int flags = first - '0';
          if (length_ == 8) {
            const uint8_t second = line_[7];
            flags = second >= '0' && second <= '9' ? flags * 10 + second - '0' : 16;
          }
          if (flags <= 15) command = flags;
        }
      }
    }
    reset();
    return command;
  }

  void reset() { length_ = 0; overflow_ = false; }

 private:
  uint8_t line_[8] = {};
  size_t length_ = 0;
  bool overflow_ = false;
};
