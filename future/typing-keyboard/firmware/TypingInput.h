#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace typing {
constexpr size_t KeyCount = 140;
using Report = std::array<uint8_t, 15>;

// Fixed storage shared by the firmware and host tests. No USB or Arduino calls.
class InputState {
 public:
  bool held(size_t index) const { return index < KeyCount && down_[index]; }
  size_t pending() const { return count_; }
  const Report& front() const { return queue_[head_]; }
  void pop() { if (count_) { head_ = (head_ + 1) % queue_.size(); --count_; } }
  void release() {
    down_.fill(false);
    head_ = 0;
    count_ = 1;
    queue_[0] = Report{};
  }
  // False signals overflow: the caller suppresses held physical keys until up.
  bool event(size_t index, bool pressed, const uint8_t (&keys)[KeyCount][2]) {
    if (index >= KeyCount || down_[index] == pressed) return true;
    down_[index] = pressed;
    if (count_ == queue_.size()) { release(); return false; }
    Report report{};
    for (size_t i = 0; i < KeyCount; ++i) if (down_[i]) {
      uint8_t usage = keys[i][0];
      report[0] |= keys[i][1];
      if (usage >= 0xe0 && usage <= 0xe7) report[0] |= 1u << (usage - 0xe0);
      else if (usage >= 4 && usage <= 0x73) report[1 + (usage - 4) / 8] |= 1u << ((usage - 4) % 8);
    }
    queue_[(head_ + count_) % queue_.size()] = report;
    ++count_;
    return true;
  }
 private:
  std::array<bool, KeyCount> down_{};
  std::array<Report, 32> queue_{};
  size_t head_ = 0;
  size_t count_ = 0;
};

class Debouncer {
 public:
  bool update(size_t index, bool raw, uint32_t now) {
    if (index >= KeyCount) return false;
    if (candidate_[index] != raw) { candidate_[index] = raw; changed_[index] = now; }
    if (static_cast<uint32_t>(now - changed_[index]) >= 5000) stable_[index] = candidate_[index];
    return stable_[index];
  }
 private:
  std::array<bool, KeyCount> candidate_{};
  std::array<bool, KeyCount> stable_{};
  std::array<uint32_t, KeyCount> changed_{};
};
}
