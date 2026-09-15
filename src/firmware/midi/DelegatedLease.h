#pragma once

#include <atomic>
#include <cstdint>

// RAM-only lease. 32-bit milliseconds avoid non-lock-free 64-bit atomics on
// RP2040; unsigned subtraction also handles the millisecond clock wrapping.
class DelegatedLease {
 public:
  static constexpr uint32_t timeoutMs = 5000;

  void begin(uint32_t token, uint32_t now) {
    lastHeartbeat.store(now, std::memory_order_relaxed);
    session.store(token, std::memory_order_release);
  }
  uint32_t token() const { return session.load(std::memory_order_acquire); }
  bool renew(uint32_t token, uint32_t now) {
    if (token == 0 || token != this->token() || expired(now)) return false;
    lastHeartbeat.store(now, std::memory_order_relaxed);
    return true;
  }
  bool expired(uint32_t now) const {
    // Core 1 can publish a heartbeat after core 0 sampled 'now'. Treat that
    // slightly newer timestamp as future, not as an unsigned full-clock wrap.
    return token() != 0 && static_cast<int32_t>(now - lastHeartbeat.load(std::memory_order_relaxed)) >= static_cast<int32_t>(timeoutMs);
  }
  uint32_t end() { return session.exchange(0, std::memory_order_acq_rel); }

 private:
  std::atomic<uint32_t> session{0};
  std::atomic<uint32_t> lastHeartbeat{0};
};
